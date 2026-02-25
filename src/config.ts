import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import type { GleanMcpConfig } from "./types";

const DEFAULT_SERVER_NAME = "glean_default";

/**
 * Platform-specific paths where MDM drops the config file.
 * System-level (requires admin/root to write, readable by all users).
 */
function getSystemConfigPath(): string {
  switch (process.platform) {
    case "darwin":
      return "/Library/Application Support/Glean MDM/mcp-config.json";
    case "win32":
      return path.join(
        process.env.PROGRAMDATA ?? "C:\\ProgramData",
        "Glean MDM",
        "mcp-config.json"
      );
    default:
      return "/etc/glean_mdm/mcp-config.json";
  }
}

/**
 * User-level config path (for non-MDM / dev scenarios).
 */
function getUserConfigPath(): string {
  return path.join(os.homedir(), ".glean_mdm", "mcp-config.json");
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function configFromFile(filePath: string): GleanMcpConfig | null {
  const data = readJsonFile(filePath);
  if (!data || typeof data.url !== "string" || !data.url) {
    return null;
  }
  return {
    serverName:
      typeof data.serverName === "string" && data.serverName
        ? data.serverName
        : DEFAULT_SERVER_NAME,
    url: data.url,
  };
}

function configFromEnv(): GleanMcpConfig | null {
  const url = process.env.GLEAN_MCP_URL;
  if (!url) {
    return null;
  }
  return {
    serverName: process.env.GLEAN_MCP_SERVER_NAME || DEFAULT_SERVER_NAME,
    url,
  };
}

function configFromSettings(): GleanMcpConfig | null {
  const settings = vscode.workspace.getConfiguration("gleanMcp");
  const url = settings.get<string>("serverUrl");
  if (!url) {
    return null;
  }
  return {
    serverName: settings.get<string>("serverName") || DEFAULT_SERVER_NAME,
    url,
  };
}

/**
 * Resolve Glean MCP config using this priority:
 * 1. System-level config file (MDM-managed)
 * 2. User-level config file (~/.glean/mcp-config.json)
 * 3. Environment variables (GLEAN_MCP_URL, GLEAN_MCP_SERVER_NAME)
 * 4. VS Code / Cursor settings (gleanMcp.serverUrl, gleanMcp.serverName)
 */
export function resolveConfig(): GleanMcpConfig | null {
  const systemPath = getSystemConfigPath();
  const systemConfig = configFromFile(systemPath);
  if (systemConfig) {
    return systemConfig;
  }

  const userPath = getUserConfigPath();
  const userConfig = configFromFile(userPath);
  if (userConfig) {
    return userConfig;
  }

  const envConfig = configFromEnv();
  if (envConfig) {
    return envConfig;
  }

  return configFromSettings();
}

/**
 * Returns the path to watch for config file changes.
 * Prefers system config if it exists, else user config.
 */
export function getWatchablePath(): string | null {
  const systemPath = getSystemConfigPath();
  if (fs.existsSync(systemPath)) {
    return systemPath;
  }

  const userPath = getUserConfigPath();
  if (fs.existsSync(userPath)) {
    return userPath;
  }

  return null;
}
