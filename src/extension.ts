import * as vscode from "vscode";
import { waitForLease, getLeaseClients, toLeaseClientKey, startSignInReminder, stopSignInReminder, checkAuthAndPrompt } from "./auth";
import { resolveConfig } from "./config";
import * as log from "./log";
import type { GleanMdmConfig } from "./types";

let registeredServerName: string | null = null;
let monitoredClientKey: string | null = null;

export function activate(context: vscode.ExtensionContext) {
  log.info("Glean extension activating");
  log.info(`Cursor version: ${vscode.version}, Extension version: ${context.extension.packageJSON.version}`);

  if (!hasCursorMcpApi()) {
    log.warn("Cursor MCP extension API not available");
    vscode.window.showWarningMessage(
      "Glean MDM: This version of Cursor does not support the MCP extension API. Please update Cursor."
    );
    return;
  }

  const extensionUrl = vscode.workspace.getConfiguration("glean").get<string>("mcpServerUrl", "");
  const config = resolveConfig(extensionUrl);
  if (!config) {
    log.warn("No Glean MDM config found (checked MDM file, env vars, and settings)");
    return;
  }

  log.info(`Resolved config: serverName=${config.serverName}, url=${config.url}`);
  initializeWhenReady(context, config);

  context.subscriptions.push(
    { dispose: cleanup },
    { dispose: stopSignInReminder },
    { dispose: () => log.dispose() },
  );
}

export function deactivate() {
  log.info("Glean extension deactivating");
  cleanup();
}

function hasCursorMcpApi(): boolean {
  return !!(vscode as any).cursor?.mcp?.registerServer;
}

async function initializeWhenReady(context: vscode.ExtensionContext, config: GleanMdmConfig) {
  const lease = await waitForLease();
 
  if (!lease) {
    log.warn("No MCP lease available, disabling Glean MDM");
    return;
  }

  await registerServer(config);
  await checkAuthAndPrompt(lease, monitoredClientKey);

  if (typeof lease.onDidChange === "function") {
    log.info("Watching MCP auth state via lease.onDidChange");
    const disposable = lease.onDidChange(() => {
      checkAuthAndPrompt(lease, monitoredClientKey);
    });
    if (disposable?.dispose) {
      context.subscriptions.push(disposable);
    }
  }
}

async function registerServer(config: GleanMdmConfig) {
  const ownClientKey = toLeaseClientKey(config.serverName);
  const existingClients = await getLeaseClients();

  if (existingClients.length > 0) {
    log.info(`Found ${existingClients.length} existing MCP client(s):`);
    for (const c of existingClients) {
      log.info(`  [${c.clientKey}] url=${c.url ?? "(none)"} state=${c.state ?? "unknown"}`);
    }
  }

  const duplicate = existingClients.find(
    (c) => c.url === config.url && c.clientKey !== ownClientKey,
  );

  if (duplicate) {
    log.info(
      `Skipping registration: "${duplicate.clientKey}" already serves ${config.url} (state=${duplicate.state})`,
    );
    if (registeredServerName) {
      log.info(`Unregistering own server "${registeredServerName}" in favor of duplicate`);
      vscode.cursor.mcp.unregisterServer(registeredServerName);
      registeredServerName = null;
    }
    monitoredClientKey = duplicate.clientKey;
    if (duplicate.state === "requires_authentication") {
      startSignInReminder();
    }
    return;
  }

  if (registeredServerName && registeredServerName !== config.serverName) {
    log.info(`Server name changed from "${registeredServerName}" to "${config.serverName}", unregistering old server`);
    vscode.cursor.mcp.unregisterServer(registeredServerName);
  }

  registeredServerName = config.serverName;
  monitoredClientKey = ownClientKey;

  await vscode.cursor.mcp.registerServer({
    name: config.serverName,
    server: {
      url: config.url,
      headers: {
        "X-Glean-Metadata": "MDM",
      },
    },
  });

  log.info(`Registered MCP server "extension-${config.serverName}"`);
}

function cleanup() {
  if (registeredServerName) {
    try {
      log.info(`Unregistering MCP server "${registeredServerName}"`);
      vscode.cursor.mcp.unregisterServer(registeredServerName);
    } catch (err) {
      log.error(`Failed to unregister server: ${err}`);
    }
    registeredServerName = null;
  }
}
