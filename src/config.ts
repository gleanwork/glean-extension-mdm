import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { GleanMdmConfig } from "./types";

const DEFAULT_SERVER_NAME = "glean_default_mdm";

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

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function configFromFile(filePath: string): GleanMdmConfig | null {
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

export type LogFn = (message: string) => void;

/**
 * Resolve Glean MDM config using this priority:
 * 1. Extension setting (glean.mcpServerUrl)
 * 2. System-level config file (MDM-managed)
 * 3. User-level config file (~/.glean_mdm/mcp-config.json)
 */
export function resolveConfig(extensionUrl?: string, logger?: LogFn): GleanMdmConfig | null {
  const log = logger ?? (() => {});

  const trimmed = extensionUrl?.trim();
  if (trimmed) {
    if (!isValidUrl(trimmed)) {
      log(`Extension setting: invalid URL "${trimmed}", skipping`);
    } else {
      log(`Extension setting: url=${trimmed}`);
      return { serverName: DEFAULT_SERVER_NAME, url: trimmed };
    }
  } else {
    log("Extension setting: not configured");
  }

  const systemPath = getSystemConfigPath();
  const systemConfig = configFromFile(systemPath);
  if (systemConfig) {
    if (!isValidUrl(systemConfig.url)) {
      log(`System config (${systemPath}): invalid URL "${systemConfig.url}", skipping`);
    } else {
      log(`System config (${systemPath}): serverName=${systemConfig.serverName}, url=${systemConfig.url}`);
      return systemConfig;
    }
  } else {
    log(`System config (${systemPath}): not found`);
  }

  const userPath = getUserConfigPath();
  const userConfig = configFromFile(userPath);
  if (userConfig) {
    if (!isValidUrl(userConfig.url)) {
      log(`User config (${userPath}): invalid URL "${userConfig.url}", skipping`);
    } else {
      log(`User config (${userPath}): serverName=${userConfig.serverName}, url=${userConfig.url}`);
      return userConfig;
    }
  } else {
    log(`User config (${userPath}): not found`);
  }

  return null;
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

