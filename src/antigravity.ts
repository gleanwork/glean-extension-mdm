import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";

import * as log from "./log";
import { signInButton, signInMessage } from "./shared";
import type { GleanMdmConfig } from "./types";

const execFileAsync = promisify(execFile);

// --- Types ---

type AntigravityMcpConfig = {
  mcpServers: Record<
    string,
    { serverUrl: string; headers?: Record<string, string> }
  >;
};

type AntigravityMcpStatus =
  | "MCP_SERVER_STATUS_UNSPECIFIED"
  | "MCP_SERVER_STATUS_PENDING"
  | "MCP_SERVER_STATUS_READY"
  | "MCP_SERVER_STATUS_ERROR"
  | "MCP_SERVER_STATUS_NEEDS_OAUTH";

type AntigravityMcpServerState = {
  serverName: string;
  serverUrl: string;
  status: AntigravityMcpStatus;
};

type LSConnection = {
  port: number;
  csrfToken: string;
};

// --- State ---

let signInNotificationVisible = false;

/**
 * Entry point for Antigravity MCP integration. Ensures Glean is registered
 * in the Antigravity MCP config file and starts polling the language server
 * for MCP state changes.
 */
export async function activateAntigravity(
  context: vscode.ExtensionContext,
  config: GleanMdmConfig,
) {
  await registerGleanInConfig(config);
  monitorAntigravityMcpState(context, config);
}

/** Returns the path to Antigravity's MCP config file. */
function getMcpConfigPath(): string {
  return path.join(os.homedir(), ".gemini", "antigravity", "mcp_config.json");
}

/**
 * Ensures Glean is registered in `~/.gemini/antigravity/mcp_config.json`.
 * Reads the existing config (or creates a new one), checks for an existing
 * entry with the same serverUrl to avoid duplicates, and writes the entry
 * if missing. The LS auto-detects config file changes.
 */
async function registerGleanInConfig(config: GleanMdmConfig): Promise<void> {
  const configPath = getMcpConfigPath();
  let data: AntigravityMcpConfig;

  try {
    const content = await fs.readFile(configPath, "utf-8");
    data = JSON.parse(content) as AntigravityMcpConfig;
    if (!data.mcpServers || typeof data.mcpServers !== "object") {
      data.mcpServers = {};
    }
  } catch {
    data = { mcpServers: {} };
  }

  // De-duplicate: check if any existing entry already has our serverUrl
  const existingEntry = Object.entries(data.mcpServers).find(
    ([, entry]) => entry.serverUrl === config.url,
  );

  if (existingEntry) {
    log.info(
      `Glean already configured in Antigravity config under key "${existingEntry[0]}", skipping write`,
    );
    return;
  }

  data.mcpServers[config.serverName] = {
    serverUrl: config.url,
    headers: { "X-Glean-Metadata": "MDM" },
  };

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(data, null, 2), "utf-8");
  log.info(`Wrote Glean MCP config to ${configPath}`);
}

const POLL_INTERVAL_MS = 30_000;
const DISCOVERY_RETRY_DELAYS_MS = [0, 2_000, 4_000, 8_000, 16_000];

/**
 * Attempts to discover the Antigravity language server with exponential
 * backoff retries (0s, 2s, 4s, 8s, 16s) to handle the startup race where
 * the LS may not be running yet when the extension activates.
 */
async function discoverWithRetry(): Promise<LSConnection | null> {
  for (let i = 0; i < DISCOVERY_RETRY_DELAYS_MS.length; i++) {
    const delay = DISCOVERY_RETRY_DELAYS_MS[i];
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const conn = await discoverLanguageServer();
    if (conn) {
      return conn;
    }
    log.info(
      `LS discovery attempt ${i + 1}/${DISCOVERY_RETRY_DELAYS_MS.length} failed`,
    );
  }
  return null;
}

/**
 * Starts a polling loop that checks the Antigravity LS for MCP server states
 * every 30 seconds. Automatically re-discovers the LS connection on failure
 * to handle LS restarts (new port and CSRF token each time). Stops polling
 * once the server reaches a terminal state (READY or NEEDS_OAUTH).
 */
function monitorAntigravityMcpState(
  context: vscode.ExtensionContext,
  config: GleanMdmConfig,
) {
  let connection: LSConnection | null = null;
  let intervalHandle: NodeJS.Timeout | null = null;

  function stopPolling() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
      log.info("Stopped MCP state polling");
    }
  }

  async function poll() {
    // If no connection, try to discover
    if (!connection) {
      connection = await discoverWithRetry();
      if (!connection) {
        log.info(
          "Could not discover Antigravity language server; will retry next poll",
        );
        return;
      }
      log.info(
        `Discovered Antigravity LS at port ${connection.port}`,
      );
    }

    try {
      const states = await getMcpServerStates(connection);
      const done = handleMcpStateChange(states, config, connection);
      if (done) {
        stopPolling();
      }
    } catch (err) {
      log.warn(`MCP state poll failed: ${err}; re-discovering LS`);
      connection = null;
    }
  }

  // Immediate first check
  void poll();

  intervalHandle = setInterval(() => void poll(), POLL_INTERVAL_MS);
  context.subscriptions.push({
    dispose: () => stopPolling(),
  });
}

/**
 * Discovers the Antigravity language server connection details on macOS.
 * Calls `antigravity.getDiagnostics` to parse the HTTP port and PID from
 * LS logs, then extracts the `--csrf_token` CLI arg via `ps -o args`.
 */
async function discoverLanguageServer(): Promise<LSConnection | null> {
  try {
    // Step 1: Parse LS info from getDiagnostics
    const diag = await vscode.commands.executeCommand<string>(
      "antigravity.getDiagnostics",
    );
    if (typeof diag !== "string") {
      return null;
    }

    let httpPort: number | undefined;
    let lsPid: string | undefined;

    const parsed = JSON.parse(diag);
    const lsLogs: string[] = parsed?.languageServerLogs?.logs ?? [];
    for (const line of lsLogs) {
      const httpMatch = line.match(
        /listening on random port at (\d+) for HTTP\b/,
      );
      if (httpMatch) {
        httpPort = parseInt(httpMatch[1], 10);
      }
      const pidMatch = line.match(
        /Starting language server process with pid (\d+)/,
      );
      if (pidMatch) {
        lsPid = pidMatch[1];
      }
    }

    if (!httpPort || !lsPid) {
      return null;
    }

    // Step 2: Extract CSRF token from process command line args
    const { stdout: psArgs } = await execFileAsync("ps", [
      "-o",
      "args",
      "-p",
      lsPid,
    ]);
    const csrfMatch = psArgs.match(/--csrf_token\s+(\S+)/);
    if (!csrfMatch) {
      log.warn("--csrf_token not found in LS process args");
      return null;
    }
    const csrfToken = csrfMatch[1];

    return { port: httpPort, csrfToken };
  } catch {
    return null;
  }
}

/**
 * Makes an HTTP POST request to the Antigravity language server with
 * CSRF and Accept headers.
 */
function httpPost(
  conn: LSConnection,
  reqPath: string,
  body: string,
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: conn.port,
        path: reqPath,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "x-codeium-csrf-token": conn.csrfToken,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, data }),
        );
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Calls the Antigravity language server's ConnectRPC endpoint to retrieve
 * the current state of all registered MCP servers.
 */
async function getMcpServerStates(
  conn: LSConnection,
): Promise<AntigravityMcpServerState[]> {
  const response = await httpPost(
    conn,
    "/exa.language_server_pb.LanguageServerService/GetMcpServerStates",
    JSON.stringify({}),
  );

  if (response.status !== 200) {
    throw new Error(
      `GetMcpServerStates returned HTTP ${response.status}: ${response.data}`,
    );
  }

  const parsed = JSON.parse(response.data);
  const states: AntigravityMcpServerState[] = (
    parsed.states ?? []
  ).map(
    (s: {
      spec?: { serverName?: string; serverUrl?: string };
      status?: string;
    }) => ({
      serverName: s.spec?.serverName ?? "",
      serverUrl: s.spec?.serverUrl ?? "",
      status: (s.status ?? "MCP_SERVER_STATUS_UNSPECIFIED") as AntigravityMcpStatus,
    }),
  );

  return states;
}

/**
 * Processes MCP state changes for the Glean server. Finds the Glean entry
 * by matching serverUrl or serverName, then takes action based on status:
 * READY logs success, NEEDS_OAUTH shows a sign-in notification, ERROR logs
 * the error, and PENDING is a no-op. If Glean is not found, re-registers it.
 * Returns true if polling should stop (terminal state reached).
 */
function handleMcpStateChange(
  states: AntigravityMcpServerState[],
  config: GleanMdmConfig,
  conn: LSConnection,
): boolean {
  const glean = states.find(
    (s) => s.serverUrl === config.url || s.serverName === config.serverName,
  );

  if (!glean) {
    log.info("Glean server not found in MCP states; re-registering");
    void registerGleanInConfig(config);
    return false;
  }

  log.info(`Glean MCP status: ${glean.status}`);

  switch (glean.status) {
    case "MCP_SERVER_STATUS_READY":
      log.info("Glean MCP server is ready");
      signInNotificationVisible = false;
      return true;
    case "MCP_SERVER_STATUS_NEEDS_OAUTH":
      showSignInNotification(conn);
      return true;
    case "MCP_SERVER_STATUS_ERROR":
      log.error(`Glean MCP server error for "${glean.serverName}"`);
      return false;
    case "MCP_SERVER_STATUS_PENDING":
      // Still connecting, keep polling
      return false;
    default:
      return false;
  }
}

/**
 * Shows a warning notification prompting the user to sign in to Glean.
 * Uses a de-dup flag to prevent stacking multiple notifications.
 * Clicking "Sign in to Glean" calls the RefreshMcpServers LS endpoint
 * which initiates the OAuth flow in the language server.
 */
function showSignInNotification(conn: LSConnection) {
  if (signInNotificationVisible) {
    return;
  }
  signInNotificationVisible = true;

  log.info("Showing sign-in notification");
  vscode.window
    .showWarningMessage(signInMessage, signInButton)
    .then((action) => {
      signInNotificationVisible = false;
      if (action === signInButton) {
        log.info("Sign in button clicked — refreshing MCP servers");
        void refreshMcpServers(conn);
      }
    });
}

/**
 * Calls the Antigravity language server's RefreshMcpServers endpoint
 * to trigger an MCP server refresh (e.g., to initiate OAuth flow).
 */
async function refreshMcpServers(conn: LSConnection): Promise<void> {
  try {
    const response = await httpPost(
      conn,
      "/exa.language_server_pb.LanguageServerService/RefreshMcpServers",
      JSON.stringify({}),
    );
    if (response.status === 200) {
      log.info("Called RefreshMcpServers on LS");
    } else {
      log.warn(
        `RefreshMcpServers returned HTTP ${response.status}: ${response.data}`,
      );
    }
  } catch (err) {
    log.warn(`Failed to call RefreshMcpServers: ${err}`);
  }
}
