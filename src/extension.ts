import * as vscode from "vscode";

import { resolveConfig } from "./config";
import { detectIde } from "./ide-detect";
import * as log from "./log";
import type { GleanMdmConfig } from "./types";
import { activateWindsurf } from "./windsurf";

const signInMessage =
  "Search your company's knowledge without leaving your editor. Find docs, examples, and answers right where you work.";
const signInButton = "Sign in to Glean";

type McpClientState =
  | { kind: "ready" }
  | { kind: "loading" }
  | { kind: "requires_authentication" };

type McpClientInfo = {
  key: string;
  url: string | undefined;
  state: McpClientState;
};

interface ExtensionState {
  lastKnownMcpClients: McpClientInfo[];
}

let onDidChangeTimeout: NodeJS.Timeout | null = null;
let leaseHasChanged: boolean = false;

/**
 * Monitors the MCP client state by subscribing to lease changes and debouncing updates. Anytime a MCP client is added, removed, or its state changes, 
 * the handleMcpStateChange function is called. If no MCP clients are detected within 10 seconds, automatically registers the Glean MCP server.
 */
async function monitorMcpState(
  context: vscode.ExtensionContext,
  state: ExtensionState,
  config: GleanMdmConfig,
) {
  const mcpExt = vscode.extensions.getExtension("anysphere.cursor-mcp");
  const { getMcpLease } = await (mcpExt as any).activate();
  const lease = getMcpLease();

  log.info(`MCP lease activated`);
  
  const DEBOUNCE_DELAY_MS = 1000;

  const leaseOnDidChangeHandle = lease.onDidChange(() => {
    log.info(`Lease onDidChange called`);
    leaseHasChanged = true;
    if (onDidChangeTimeout) {
      clearTimeout(onDidChangeTimeout);
    }
    onDidChangeTimeout = setTimeout(async () => {
      const clients = await lease.getClients();
      log.info(`Found: ${Object.keys(clients).length} MCP client(s)`);

      const clientInfos: McpClientInfo[] = [];

      for (const key of Object.keys(clients)) {
        const clientState = (await clients[key].getState()) as McpClientState;
        const url = clients[key].config?.url;
        log.info(`Client: ${key} - ${url} - ${clientState.kind}`);
        clientInfos.push({
          key,
          url,
          state: clientState,
        });
      }

      await handleMcpStateChange(state, clientInfos, config);
    }, DEBOUNCE_DELAY_MS);
  });

  // Wait for 10 seconds to see if any MCP clients are found, and if not, register the Glean MCP server
  // In the case where no MCP clients have been added the lease.onDidChange callback will not be called
  // so we go ahead and register the Glean MCP server to "manually" kick off the change process.
  const timeoutHandle = setTimeout(async () => {
    if (!leaseHasChanged) {
      log.info(`No initial MCP clients found, registering Glean MCP server`);
      await registerGleanMcpServer(config);
    }
  }, 10_000);

  context.subscriptions.push({
    dispose: () => clearTimeout(timeoutHandle),
  });
  context.subscriptions.push(leaseOnDidChangeHandle);
}

/**
 * Handles MCP state changes by determining whether to register, unregister, or prompt
 * sign-in based on the current set of MCP clients and their states.
 */
async function handleMcpStateChange(
  state: ExtensionState,
  clients: McpClientInfo[],
  config: GleanMdmConfig,
) {
  const extensionMcpKey = `user-glean.glean-extension-${config.serverName}`;
  const gleanMcpConfigured = clients.find(
    (c) => c.url === config.url && c.key !== extensionMcpKey,
  );
  const extensionMcpIsRegistered = clients.find(
    (c) => c.key === extensionMcpKey,
  );
  const gleanMcpIsReady = clients.find(
    (c) => c.url === config.url && c.state.kind === "ready",
  );

  log.info(`gleanMcpConfigured: ${!!gleanMcpConfigured}`);
  log.info(`extensionMcpIsRegistered: ${!!extensionMcpIsRegistered}`);
  log.info(`gleanMcpIsReady: ${!!gleanMcpIsReady}`);

  if (!gleanMcpConfigured && !extensionMcpIsRegistered) {
    await registerGleanMcpServer(config);
  } else if (gleanMcpConfigured && extensionMcpIsRegistered) {
    log.info("Unregistering MCP server " + extensionMcpKey);
    vscode.cursor.mcp.unregisterServer(config.serverName);
  } else if (!gleanMcpIsReady) {
    await showNotification();
  }

  state.lastKnownMcpClients = clients;
}

export async function activate(context: vscode.ExtensionContext) {
  // Push log disposable first — LIFO order means it disposes last,
  // keeping the log channel alive for other dispose calls.
  context.subscriptions.push({ dispose: () => log.dispose() });

  const ide = detectIde();
  log.info(
    `Glean version: ${context.extension.packageJSON.version} on ${ide} ${vscode.version}`,
  );

  if (ide === "unknown") {
    log.info("Not running in Cursor or Windsurf, skipping activation");
    return;
  }

  const extensionUrl = vscode.workspace
    .getConfiguration("glean")
    .get<string>("mcpServerUrl", "");
  const config = resolveConfig(extensionUrl, (msg) => log.info(msg));

  if (!config) {
    log.warn("No Glean MDM config found");
    return;
  }

  if (ide === "cursor") {
    const state: ExtensionState = { lastKnownMcpClients: [] };
    context.subscriptions.push({
      dispose: () => {
        state.lastKnownMcpClients = [];
      },
    });
    await monitorMcpState(context, state, config);
  } else if (ide === "windsurf") {
    await activateWindsurf(context, config);
  }
}

/**
 * Shows a warning notification prompting the user to sign in to Glean,
 * and opens the MCP settings if the sign-in button is clicked.
 */
async function showNotification() {
  log.info("Showing the noficiation");
  const action = await vscode.window.showWarningMessage(
    signInMessage,
    signInButton,
  );

  if (action === signInButton) {
    log.info("Sign in button clicked");
    await vscode.commands.executeCommand("aiSettings.action.open.mcp");
  } else {
    log.info("Non-sign-in button clicked");
  }
}

export function deactivate() {
  if (onDidChangeTimeout) {
    clearTimeout(onDidChangeTimeout);
    onDidChangeTimeout = null;
  }
}

/**
 * Registers the Glean MCP server with Cursor using the provided config.
 */
async function registerGleanMcpServer(config: GleanMdmConfig) {
  log.info(`Registered MCP server "extension-${config.serverName}"`);
  await vscode.cursor.mcp.registerServer({
    name: config.serverName,
    server: {
      url: config.url,
      headers: {
        "X-Glean-Metadata": "MDM",
      },
    },
  });
}
