import * as vscode from "vscode";
import * as log from "./log";
import type { McpClientInfo } from "./types";

const SIGN_IN_REMINDER_MS = 15 * 60 * 1000; // 15 minutes
const LEASE_WAIT_TIMEOUT_MS = 60_000;
let signInInterval: ReturnType<typeof setInterval> | null = null;
let signInStatusBarItem: vscode.StatusBarItem | null = null;

const signInMessage =
  "Search your company's knowledge without leaving your editor. Find docs, examples, and answers right where you work.";
const signInButton = "Sign in to Glean";

const LEASE_POLL_MS = 1_000;

/**
 * Polls getMcpLease() every second until it returns non-null.
 * Returns null if not available within the timeout.
 */
export function waitForLease(): Promise<any | null> {
  const lease = getMcpLease();
  if (lease) {
    log.info("MCP lease available immediately");
    return Promise.resolve(lease);
  }

  log.info("MCP lease not yet available, polling...");

  return new Promise((resolve) => {
    let elapsed = 0;

    const interval = setInterval(() => {
      elapsed += LEASE_POLL_MS;
      const lease = getMcpLease();
      if (lease) {
        clearInterval(interval);
        log.info(`MCP lease became available after ${elapsed}ms`);
        resolve(lease);
      } else if (elapsed >= LEASE_WAIT_TIMEOUT_MS) {
        clearInterval(interval);
        log.warn(
          `MCP lease not available after ${LEASE_WAIT_TIMEOUT_MS}ms, giving up`,
        );
        resolve(null);
      }
    }, LEASE_POLL_MS);
  });
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
  return `user-glean.glean-extension-${serverName}`;
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

export async function checkAuthAndPrompt(
  lease: any,
  clientKey: string | null,
): Promise<void> {
  log.info(`Checking auth state for "${clientKey}"`);
  if (!clientKey) {
    return;
  }

  try {
    const clients = await lease.getClients();
    const client = clients?.[clientKey];
    if (!client || typeof client.getState !== "function") {
      log.info(`Auth state for "${clientKey}" not found`);
      startSignInReminder();
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

export function startSignInReminder() {
  if (signInInterval) {
    return;
  }
  log.info("Starting sign-in reminder interval");
  showSignInStatusBarItem();
  promptSignIn();
  signInInterval = setInterval(() => promptSignIn(), SIGN_IN_REMINDER_MS);
}

export function stopSignInReminder() {
  hideSignInStatusBarItem();
  if (!signInInterval) {
    return;
  }
  log.info("Stopping sign-in reminder interval");
  clearInterval(signInInterval);
  signInInterval = null;
}

function showSignInStatusBarItem() {
  if (signInStatusBarItem) {
    return;
  }
  signInStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  signInStatusBarItem.text = "$(key) Sign in to Glean";
  signInStatusBarItem.tooltip = signInMessage;
  signInStatusBarItem.command = "aiSettings.action.open.mcp";
  signInStatusBarItem.show();
  log.info("Sign-in status bar item shown");
}

function hideSignInStatusBarItem() {
  if (!signInStatusBarItem) {
    return;
  }
  signInStatusBarItem.dispose();
  signInStatusBarItem = null;
  log.info("Sign-in status bar item hidden");
}

async function promptSignIn() {
  const action = await vscode.window.showWarningMessage(
    signInMessage,
    signInButton,
  );

  if (action === signInButton) {
    await vscode.commands.executeCommand("aiSettings.action.open.mcp");
  }
}
