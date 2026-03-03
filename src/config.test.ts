import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "path";

const MOCK_HOME = "/mock-home";

// Derive the expected paths the same way config.ts does internally.
// On darwin (CI + local dev): /Library/Application Support/Glean MDM/mcp-config.json
// On linux: /etc/glean_mdm/mcp-config.json
// On win32: path.join(process.env.PROGRAMDATA ?? "C:\\ProgramData", "Glean MDM", "mcp-config.json")
function expectedSystemPath(): string {
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

const SYSTEM_PATH = expectedSystemPath();
const USER_PATH = path.join(MOCK_HOME, ".glean_mdm", "mcp-config.json");
const DEFAULT_SERVER_NAME = "glean_default_mdm";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("os", () => ({ homedir: () => MOCK_HOME }));

// fs is mocked per-test via spies so we can change behaviour in each case.
import * as fs from "fs";
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof fs>("fs");
  return {
    ...actual,
    readFileSync: vi.fn(() => {
      throw new Error("file not found");
    }),
    existsSync: vi.fn(() => false),
  };
});

const readFileSyncMock = fs.readFileSync as ReturnType<typeof vi.fn>;
const existsSyncMock = fs.existsSync as ReturnType<typeof vi.fn>;

// Import after mocks are set up.
import { resolveConfig, getWatchablePath } from "./config";

// ── Helpers ──────────────────────────────────────────────────────────────────

function stubFileContents(mapping: Record<string, string>) {
  readFileSyncMock.mockImplementation((filePath: string) => {
    if (filePath in mapping) {
      return mapping[filePath];
    }
    throw new Error("file not found");
  });
}

function stubExistence(paths: string[]) {
  existsSyncMock.mockImplementation((p: string) => paths.includes(p));
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  readFileSyncMock.mockImplementation(() => {
    throw new Error("file not found");
  });
  existsSyncMock.mockImplementation(() => false);
});

describe("resolveConfig()", () => {
  it("returns null when no config source exists", () => {
    expect(resolveConfig()).toBeNull();
  });

  it("system config file takes highest priority", () => {
    stubFileContents({
      [SYSTEM_PATH]: JSON.stringify({
        serverName: "system_server",
        url: "https://system.example.com/mcp",
      }),
    });

    expect(resolveConfig()).toEqual({
      serverName: "system_server",
      url: "https://system.example.com/mcp",
    });
  });

  it("falls back to user config when system config missing", () => {
    stubFileContents({
      [USER_PATH]: JSON.stringify({
        serverName: "user_server",
        url: "https://user.example.com/mcp",
      }),
    });

    expect(resolveConfig()).toEqual({
      serverName: "user_server",
      url: "https://user.example.com/mcp",
    });
  });

  it("uses DEFAULT_SERVER_NAME when serverName missing from file", () => {
    stubFileContents({
      [SYSTEM_PATH]: JSON.stringify({ url: "https://example.com/mcp" }),
    });

    expect(resolveConfig()).toEqual({
      serverName: DEFAULT_SERVER_NAME,
      url: "https://example.com/mcp",
    });
  });

  it("returns null for file with missing url", () => {
    stubFileContents({
      [SYSTEM_PATH]: JSON.stringify({ serverName: "orphan" }),
    });

    expect(resolveConfig()).toBeNull();
  });

  it("returns null for file with empty url", () => {
    stubFileContents({
      [SYSTEM_PATH]: JSON.stringify({ serverName: "orphan", url: "" }),
    });

    expect(resolveConfig()).toBeNull();
  });

  it("returns null for malformed JSON file", () => {
    stubFileContents({ [SYSTEM_PATH]: "not-json{{{" });

    expect(resolveConfig()).toBeNull();
  });

  it("system config wins over user config when both exist", () => {
    stubFileContents({
      [SYSTEM_PATH]: JSON.stringify({
        serverName: "system_server",
        url: "https://system.example.com/mcp",
      }),
      [USER_PATH]: JSON.stringify({
        serverName: "user_server",
        url: "https://user.example.com/mcp",
      }),
    });

    expect(resolveConfig()).toEqual({
      serverName: "system_server",
      url: "https://system.example.com/mcp",
    });
  });
});

describe("resolveConfig() with extensionUrl", () => {
  it("extension URL overrides system and user file config", () => {
    stubFileContents({
      [SYSTEM_PATH]: JSON.stringify({
        serverName: "system_server",
        url: "https://system.example.com/mcp",
      }),
      [USER_PATH]: JSON.stringify({
        serverName: "user_server",
        url: "https://user.example.com/mcp",
      }),
    });

    expect(resolveConfig("https://extension.example.com/mcp")).toEqual({
      serverName: DEFAULT_SERVER_NAME,
      url: "https://extension.example.com/mcp",
    });
  });

  it("extension URL uses DEFAULT_SERVER_NAME", () => {
    expect(resolveConfig("https://ext.example.com/mcp")).toEqual({
      serverName: DEFAULT_SERVER_NAME,
      url: "https://ext.example.com/mcp",
    });
  });

  it("falls through to file config when extensionUrl is undefined", () => {
    stubFileContents({
      [SYSTEM_PATH]: JSON.stringify({
        serverName: "system_server",
        url: "https://system.example.com/mcp",
      }),
    });

    expect(resolveConfig(undefined)).toEqual({
      serverName: "system_server",
      url: "https://system.example.com/mcp",
    });
  });

  it("falls through to file config when extensionUrl is empty string", () => {
    stubFileContents({
      [USER_PATH]: JSON.stringify({
        serverName: "user_server",
        url: "https://user.example.com/mcp",
      }),
    });

    expect(resolveConfig("")).toEqual({
      serverName: "user_server",
      url: "https://user.example.com/mcp",
    });
  });

  it("falls through to file config when extensionUrl is whitespace-only", () => {
    stubFileContents({
      [SYSTEM_PATH]: JSON.stringify({
        serverName: "system_server",
        url: "https://system.example.com/mcp",
      }),
    });

    expect(resolveConfig("   ")).toEqual({
      serverName: "system_server",
      url: "https://system.example.com/mcp",
    });
  });

  it("trims whitespace from extension URL", () => {
    expect(resolveConfig("  https://ext.example.com/mcp  ")).toEqual({
      serverName: DEFAULT_SERVER_NAME,
      url: "https://ext.example.com/mcp",
    });
  });
});

describe("getWatchablePath()", () => {
  it("returns system path when it exists", () => {
    stubExistence([SYSTEM_PATH]);

    expect(getWatchablePath()).toBe(SYSTEM_PATH);
  });

  it("returns user path when system path missing", () => {
    stubExistence([USER_PATH]);

    expect(getWatchablePath()).toBe(USER_PATH);
  });

  it("returns null when neither path exists", () => {
    expect(getWatchablePath()).toBeNull();
  });
});
