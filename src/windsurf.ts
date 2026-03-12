import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";

import * as log from "./log";
import type { GleanMdmConfig } from "./types";

const execFileAsync = promisify(execFile);

const signInMessage =
  "Search your company's knowledge without leaving your editor. Find docs, examples, and answers right where you work.";
const signInButton = "Sign in to Glean";

// --- Types ---

type WindsurfMcpConfig = {
  mcpServers: Record<
    string,
    { serverUrl: string; headers?: Record<string, string> }
  >;
};

type WindsurfMcpStatus =
  | "MCP_SERVER_STATUS_UNSPECIFIED"
  | "MCP_SERVER_STATUS_PENDING"
  | "MCP_SERVER_STATUS_READY"
  | "MCP_SERVER_STATUS_ERROR"
  | "MCP_SERVER_STATUS_NEEDS_OAUTH";

type WindsurfMcpServerState = {
  serverName: string;
  serverUrl: string;
  status: WindsurfMcpStatus;
};

type LSConnection = {
  port: number;
  csrfToken: string;
};

// --- State ---

let signInNotificationVisible = false;

// --- Entry point ---

export async function activateWindsurf(
  context: vscode.ExtensionContext,
  config: GleanMdmConfig,
) {
  await registerGleanInConfig(config);
  monitorWindsurfMcpState(context, config);
}

// --- Config file management ---

function getMcpConfigPath(): string {
  return path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json");
}

async function registerGleanInConfig(config: GleanMdmConfig): Promise<void> {
  const configPath = getMcpConfigPath();
  let data: WindsurfMcpConfig;

  try {
    const content = await fs.readFile(configPath, "utf-8");
    data = JSON.parse(content) as WindsurfMcpConfig;
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
      `Glean already configured in Windsurf config under key "${existingEntry[0]}", skipping write`,
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

  try {
    await vscode.commands.executeCommand("windsurf.refreshMcpServers");
    log.info("Called windsurf.refreshMcpServers");
  } catch (err) {
    log.warn(`Failed to call windsurf.refreshMcpServers: ${err}`);
  }
}

// --- Polling / monitoring ---

const POLL_INTERVAL_MS = 15_000;
const DISCOVERY_RETRY_DELAYS_MS = [0, 2_000, 4_000, 8_000, 16_000];

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

function monitorWindsurfMcpState(
  context: vscode.ExtensionContext,
  config: GleanMdmConfig,
) {
  let connection: LSConnection | null = null;

  async function poll() {
    // If no connection, try to discover
    if (!connection) {
      connection = await discoverWithRetry();
      if (!connection) {
        log.info(
          "Could not discover Windsurf language server; will retry next poll",
        );
        return;
      }
      log.info(
        `Discovered Windsurf LS at port ${connection.port}`,
      );
    }

    try {
      const states = await getMcpServerStates(connection);
      handleMcpStateChange(states, config);
    } catch (err) {
      log.warn(`MCP state poll failed: ${err}; re-discovering LS`);
      connection = null;
    }
  }

  // Immediate first check
  void poll();

  const intervalHandle = setInterval(() => void poll(), POLL_INTERVAL_MS);
  context.subscriptions.push({
    dispose: () => clearInterval(intervalHandle),
  });
}

// --- LS discovery (macOS) ---

async function discoverLanguageServer(): Promise<LSConnection | null> {
  try {
    // Find PID
    const { stdout: pgrepOut } = await execFileAsync("pgrep", [
      "-f",
      "language_server_macos_arm",
    ]);
    const pid = pgrepOut.trim().split("\n")[0];
    if (!pid) {
      return null;
    }

    // Extract CSRF token from process environment
    const { stdout: psOut } = await execFileAsync("ps", [
      "eww",
      "-o",
      "command",
      "-p",
      pid,
    ]);
    const csrfMatch = psOut.match(/WINDSURF_CSRF_TOKEN=(\S+)/);
    if (!csrfMatch) {
      log.warn("WINDSURF_CSRF_TOKEN not found in LS process environment");
      return null;
    }
    const csrfToken = csrfMatch[1];

    // Discover port via lsof
    const { stdout: lsofOut } = await execFileAsync("lsof", [
      "-a",
      "-iTCP",
      "-sTCP:LISTEN",
      "-P",
      "-n",
      "-p",
      pid,
    ]);

    let port: number | undefined;
    for (const line of lsofOut.split("\n")) {
      if (!line.startsWith("language_")) {
        continue;
      }
      const portMatch = line.match(/:(\d+)\s+\(LISTEN\)/);
      if (portMatch) {
        port = parseInt(portMatch[1], 10);
        break;
      }
    }

    if (!port) {
      log.warn("Could not discover LS port from lsof output");
      return null;
    }

    return { port, csrfToken };
  } catch {
    return null;
  }
}

// --- ConnectRPC call ---

async function getMcpServerStates(
  conn: LSConnection,
): Promise<WindsurfMcpServerState[]> {
  const body = JSON.stringify({});

  const response = await new Promise<{ status: number; data: string }>(
    (resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: conn.port,
          path: "/exa.language_server_pb.LanguageServerService/GetMcpServerStates",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
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
    },
  );

  if (response.status !== 200) {
    throw new Error(
      `GetMcpServerStates returned HTTP ${response.status}: ${response.data}`,
    );
  }

  log.info(`GetMcpServerStates raw response: ${response.data}`);

  const parsed = JSON.parse(response.data);
  const states: WindsurfMcpServerState[] = (
    parsed.states ?? []
  ).map(
    (s: {
      spec?: { serverName?: string; serverUrl?: string };
      status?: string;
    }) => ({
      serverName: s.spec?.serverName ?? "",
      serverUrl: s.spec?.serverUrl ?? "",
      status: (s.status ?? "MCP_SERVER_STATUS_UNSPECIFIED") as WindsurfMcpStatus,
    }),
  );

  return states;
}

// --- State change handling ---

function handleMcpStateChange(
  states: WindsurfMcpServerState[],
  config: GleanMdmConfig,
) {
  const glean = states.find(
    (s) => s.serverUrl === config.url || s.serverName === config.serverName,
  );

  if (!glean) {
    log.info("Glean server not found in MCP states; re-registering");
    void registerGleanInConfig(config);
    return;
  }

  log.info(`Glean MCP status: ${glean.status}`);

  switch (glean.status) {
    case "MCP_SERVER_STATUS_READY":
      log.info("Glean MCP server is ready");
      signInNotificationVisible = false;
      break;
    case "MCP_SERVER_STATUS_NEEDS_OAUTH":
      showSignInNotification();
      break;
    case "MCP_SERVER_STATUS_ERROR":
      log.error(`Glean MCP server error for "${glean.serverName}"`);
      break;
    case "MCP_SERVER_STATUS_PENDING":
      // Still connecting, no-op
      break;
  }
}

// --- Notification ---

function showSignInNotification() {
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
        vscode.commands.executeCommand("windsurf.refreshMcpServers");
      }
    });
}
