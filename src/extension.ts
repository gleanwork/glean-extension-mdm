import * as fs from "fs";
import * as vscode from "vscode";
import { watchAuthState } from "./auth";
import { resolveConfig, getWatchablePath } from "./config";
import * as log from "./log";

let registeredServerName: string | null = null;
let configWatcher: fs.FSWatcher | null = null;

export function activate(context: vscode.ExtensionContext) {
  log.info("Glean MCP extension activating");

  if (!hasCursorMcpApi()) {
    log.warn("Cursor MCP extension API not available");
    vscode.window.showWarningMessage(
      "Glean MCP: This version of Cursor does not support the MCP extension API. Please update Cursor."
    );
    return;
  }

  registerFromConfig();
  startConfigWatcher(context);
  watchAuthState(context, () => registeredServerName);

  context.subscriptions.push(
    { dispose: cleanup },
    { dispose: () => log.dispose() },
  );
}

export function deactivate() {
  log.info("Glean MCP extension deactivating");
  cleanup();
}

function hasCursorMcpApi(): boolean {
  return !!(vscode as any).cursor?.mcp?.registerServer;
}

async function registerFromConfig() {
  const config = resolveConfig();
  if (!config) {
    log.warn("No Glean MCP config found (checked MDM file, env vars, and settings)");
    return;
  }

  log.info(`Resolved config: serverName=${config.serverName}, url=${config.url}`);

  if (registeredServerName && registeredServerName !== config.serverName) {
    log.info(`Server name changed from "${registeredServerName}" to "${config.serverName}", unregistering old server`);
    vscode.cursor.mcp.unregisterServer(registeredServerName);
  }

  registeredServerName = config.serverName;

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
