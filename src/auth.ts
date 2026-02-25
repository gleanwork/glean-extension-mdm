import * as vscode from "vscode";
import * as log from "./log";

const SIGN_IN_REMINDER_MS = 10 * 60 * 1000; // 10 minutes
const MIN_UNFOCUSED_MS = 60 * 1000; // 1 minute
let signInInterval: ReturnType<typeof setInterval> | null = null;
let lastUnfocusedAt: number = performance.now();

/**
 * Watches the auth state of a registered MCP server by accessing the
 * cursor-mcp extension's exported lease API. Falls back to an unconditional
 * sign-in prompt when the lease API is unavailable.
 */
export function watchAuthState(
  context: vscode.ExtensionContext,
  getServerName: () => string | null,
) {
  context.subscriptions.push({ dispose: stopSignInReminder });

  const lease = getMcpLease();
  if (!lease || typeof lease.onDidChange !== "function") {
    log.warn("Cannot watch auth state: lease or onDidChange not available, falling back to sign-in prompt");
    startSignInReminder();
    return;
  }

  log.info("Watching MCP auth state via lease.onDidChange");

  const disposable = lease.onDidChange(() => {
    checkAuthAndPrompt(lease, getServerName());
  });

  if (disposable?.dispose) {
    context.subscriptions.push(disposable);
  }

  context.subscriptions.push( 
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) {
        lastUnfocusedAt = performance.now();
        return;
      }

      const elapsed = performance.now() - lastUnfocusedAt;
      log.info(`Window re-focused after ${Math.round(elapsed / 1000)}s`);

      if (elapsed >= MIN_UNFOCUSED_MS) {
        stopSignInReminder();
        checkAuthAndPrompt(lease, getServerName());
      }
    })
  );
}

function getMcpLease(): any | null {
  const mcpExt = vscode.extensions.getExtension("anysphere.cursor-mcp");
  if (!mcpExt) {
    log.warn("anysphere.cursor-mcp extension not found");
    return null;
  }

  const api = mcpExt.isActive ? mcpExt.exports : null;
  if (typeof api?.getMcpLease !== "function") {
    log.warn("getMcpLease not available on cursor-mcp extension");
    return null;
  }

  return api.getMcpLease();
}

function toLeaseClientKey(serverName: string): string {
  return `user-glean.glean-mdm-extension-${serverName}`;
}

async function checkAuthAndPrompt(lease: any, serverName: string | null): Promise<void> {
  if (!serverName) {
    return;
  }

  const clientKey = toLeaseClientKey(serverName);

  try {
    const clients = await lease.getClients();
    const client = clients?.[clientKey];
    if (!client || typeof client.getState !== "function") {
      return;
    }

    const state = await client.getState({});
    log.info(`Auth state for "${clientKey}": kind=${state?.kind}`);

    if (state?.kind === "ready") {
      stopSignInReminder();
    } else if (state?.kind === "requires_authentication") {
      startSignInReminder();
    }
  } catch (err) {
    log.error("Failed to check auth state:", err);
  }
}

function startSignInReminder() {
  if (signInInterval) {
    return;
  }
  log.info("Starting sign-in reminder interval");
  promptSignIn();
  signInInterval = setInterval(() => promptSignIn(), SIGN_IN_REMINDER_MS);
}

function stopSignInReminder() {
  if (!signInInterval) {
    return;
  }
  log.info("Stopping sign-in reminder interval");
  clearInterval(signInInterval);
  signInInterval = null;
}

async function promptSignIn() {
  const action = await vscode.window.showInformationMessage(
    "Glean MCP server requires authentication. Sign in to start using Glean tools in Cursor.",
    "Sign in"
  );

  if (action === "Sign in") {
    await vscode.commands.executeCommand("aiSettings.action.open.mcp");
  }
}
