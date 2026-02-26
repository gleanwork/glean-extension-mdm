import * as vscode from "vscode";
import * as log from "./log";
import type { McpClientInfo } from "./types";
import { trackEvent } from "./analytics";

const SIGN_IN_REMINDER_MS = 15 * 60 * 1000; // 15 minutes
const MIN_UNFOCUSED_MS = 60 * 1000; // 1 minute
let signInInterval: ReturnType<typeof setInterval> | null = null;
let lastUnfocusedAt: number = performance.now();
let isNotificationOpen = false;
const MAX_DISMISSALS = 5;
let dismissCount = 0;

/**
 * Watches the auth state of an MCP server by accessing the cursor-mcp
 * extension's exported lease API. The getClientKey callback returns the
 * lease client key to monitor -- this may be our own registered server
 * or an existing duplicate we deferred to. Falls back to an unconditional
 * sign-in prompt when the lease API is unavailable.
 */
export function watchAuthState(
  context: vscode.ExtensionContext,
  getClientKey: () => string | null,
) {
  context.subscriptions.push({ dispose: stopSignInReminder });

  const lease = getMcpLease();
  if (!lease || typeof lease.onDidChange !== "function") {
    log.warn("Cannot watch auth state: lease or onDidChange not available, falling back to sign-in prompt");
    startSignInReminder("startup_fallback");
    return;
  }

  log.info("Watching MCP auth state via lease.onDidChange");

  const disposable = lease.onDidChange(() => {
    checkAuthAndPrompt(lease, getClientKey(), "auth_state_change");
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
        checkAuthAndPrompt(lease, getClientKey(), "refocus");
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

export function toLeaseClientKey(serverName: string): string {
  return `user-glean.glean-mdm-extension-${serverName}`;
}

export async function getLeaseClients(): Promise<McpClientInfo[]> {
  const lease = getMcpLease();
  if (!lease) {
    return [];
  }

  try {
    const clients = await lease.getClients();
    if (!clients || typeof clients !== "object") {
      return [];
    }

    const results: McpClientInfo[] = [];
    for (const key of Object.keys(clients)) {
      const client = clients[key];
      let state: string | undefined;
      if (typeof client.getState === "function") {
        try {
          const s = await client.getState({});
          state = s?.kind;
        } catch {
          // ignore
        }
      }
      results.push({
        clientKey: key,
        url: client.config?.url,
        state,
      });
    }
    return results;
  } catch (err) {
    log.error("getLeaseClients failed:", err);
    return [];
  }
}

async function checkAuthAndPrompt(lease: any, clientKey: string | null, reason: string): Promise<void> {
  if (!clientKey) {
    return;
  }

  try {
    const clients = await lease.getClients();
    const client = clients?.[clientKey];
    if (!client || typeof client.getState !== "function") {
      return;
    }

    const state = await client.getState({});
    log.info(`Auth state for "${clientKey}": kind=${state?.kind}`);

    if (state?.kind === "ready") {
      trackEvent("auth_complete");
      stopSignInReminder();
    } else if (state?.kind === "requires_authentication") {
      startSignInReminder(reason);
    }
  } catch (err) {
    log.error("Failed to check auth state:", err);
  }
}

export function startSignInReminder(reason: string) {
  if (signInInterval) {
    return;
  }
  log.info("Starting sign-in reminder interval");
  promptSignIn(reason);
  signInInterval = setInterval(() => promptSignIn("reminder"), SIGN_IN_REMINDER_MS);
}

function stopSignInReminder() {
  if (!signInInterval) {
    return;
  }
  log.info("Stopping sign-in reminder interval");
  clearInterval(signInInterval);
  signInInterval = null;
}

async function promptSignIn(reason: string) {
  if (dismissCount >= MAX_DISMISSALS) {
    log.info("Sign-in notification suppressed: user dismissed too many times this session");
    stopSignInReminder();
    return;
  }

  if (isNotificationOpen) {
    log.info("Sign-in notification already open, skipping");
    return;
  }

  trackEvent("notification_shown", { reason });
  isNotificationOpen = true;

  try {
    const action = await vscode.window.showErrorMessage(
      "Glean MCP requires authentication. Sign in to start using Glean in Cursor.",
      "Sign in"
    );

    if (action === "Sign in") {
      trackEvent("sign_in_click", { reason });
      await vscode.commands.executeCommand("aiSettings.action.open.mcp");
    } else {
      dismissCount++;
      trackEvent("sign_in_dismiss", { reason, dismiss_count: String(dismissCount) });
      if (dismissCount >= MAX_DISMISSALS) {
        log.info(`User dismissed sign-in ${MAX_DISMISSALS} times, suppressing further notifications this session`);
        stopSignInReminder();
      }
    }
  } finally {
    isNotificationOpen = false;
  }
}
