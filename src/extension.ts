import * as fs from "fs";
import * as vscode from "vscode";
import { initAnalytics, trackEvent } from "./analytics";
import { watchAuthState, getLeaseClients, toLeaseClientKey, startSignInReminder } from "./auth";
import { resolveConfig, getWatchablePath } from "./config";
import * as log from "./log";

const LEASE_SETTLE_MS = 5_000;

let registeredServerName: string | null = null;
let monitoredClientKey: string | null = null;
let configWatcher: fs.FSWatcher | null = null;
let registrationTimer: ReturnType<typeof setTimeout> | null = null;

export function activate(context: vscode.ExtensionContext) {
  log.info("Glean MDM extension activating");

  if (!hasCursorMcpApi()) {
    log.warn("Cursor MCP extension API not available");
    vscode.window.showWarningMessage(
      "Glean MDM: This version of Cursor does not support the MCP extension API. Please update Cursor."
    );
    return;
  }

  const config = resolveConfig();
  initAnalytics(context, config?.gaMeasurementId, config?.gaApiSecret);
  trackEvent("extension_activated");

  log.info(`Deferring registration by ${LEASE_SETTLE_MS}ms to let other MCP servers populate`);
  registrationTimer = setTimeout(() => {
    registrationTimer = null;
    registerFromConfig();
  }, LEASE_SETTLE_MS);

  startConfigWatcher(context);
  watchAuthState(context, () => monitoredClientKey);

  context.subscriptions.push(
    { dispose: cleanup },
    { dispose: () => log.dispose() },
  );
}

export function deactivate() {
  log.info("Glean MDM extension deactivating");
  cleanup();
}

function hasCursorMcpApi(): boolean {
  return !!(vscode as any).cursor?.mcp?.registerServer;
}

async function registerFromConfig() {
  const config = resolveConfig();
  if (!config) {
    log.warn("No Glean MDM config found (checked MDM file, env vars, and settings)");
    return;
  }

  log.info(`Resolved config: serverName=${config.serverName}, url=${config.url}`);

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
      startSignInReminder("duplicate_requires_auth");
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

  log.info(`Registered MCP server "${config.serverName}"`);
}

function startConfigWatcher(context: vscode.ExtensionContext) {
  const watchPath = getWatchablePath();
  if (!watchPath) {
    return;
  }

  log.info(`Watching config file: ${watchPath}`);

  try {
    configWatcher = fs.watch(watchPath, { persistent: false }, (eventType) => {
      if (eventType === "change" || eventType === "rename") {
        log.info(`Config file ${eventType} detected, re-registering`);
        registerFromConfig();
      }
    });

    context.subscriptions.push({
      dispose: () => {
        configWatcher?.close();
        configWatcher = null;
      },
    });
  } catch (err) {
    log.error(`Failed to watch config file: ${err}`);
  }
}

function cleanup() {
  if (registrationTimer) {
    clearTimeout(registrationTimer);
    registrationTimer = null;
  }

  if (registeredServerName) {
    try {
      log.info(`Unregistering MCP server "${registeredServerName}"`);
      vscode.cursor.mcp.unregisterServer(registeredServerName);
    } catch (err) {
      log.error(`Failed to unregister server: ${err}`);
    }
    registeredServerName = null;
  }

  configWatcher?.close();
  configWatcher = null;
}
