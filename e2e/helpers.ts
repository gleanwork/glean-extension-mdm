import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type EditorName = "cursor" | "windsurf" | "antigravity";

export interface EditorInfo {
  name: EditorName;
  binaryPath: string;
}

export interface SandboxPaths {
  root: string;
  userData: string;
  extensions: string;
  home: string;
  logFile: string;
  mcpConfigFile: string;
}

export interface TestResult {
  editor: EditorName;
  passed: boolean;
  failures: string[];
}

const EDITOR_BINARY_PATHS: Record<EditorName, string[]> = {
  cursor: [
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
    "/usr/local/bin/cursor",
  ],
  windsurf: [
    "/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf",
    "/usr/local/bin/windsurf",
  ],
  antigravity: [
    "/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity",
    "/usr/local/bin/antigravity",
  ],
};

export function discoverEditors(filter?: string): EditorInfo[] {
  const editorNames: EditorName[] = ["cursor", "windsurf", "antigravity"];
  const filterSet = filter
    ? new Set(filter.split(",").map((s) => s.trim().toLowerCase()))
    : null;

  const found: EditorInfo[] = [];

  for (const name of editorNames) {
    if (filterSet && !filterSet.has(name)) {
      continue;
    }

    const candidates = EDITOR_BINARY_PATHS[name];
    const binaryPath = candidates.find((p) => fs.existsSync(p));

    if (binaryPath) {
      found.push({ name, binaryPath });
      console.log(`Found ${name} at ${binaryPath}`);
    } else {
      console.log(`${name} not found, skipping`);
    }
  }

  return found;
}

export function createSandbox(editorName: EditorName): SandboxPaths {
  const timestamp = Date.now();
  const root = path.join(os.tmpdir(), `glean-e2e-${timestamp}`, editorName);

  const userData = path.join(root, "user-data");
  const extensions = path.join(root, "extensions");
  const home = path.join(root, "home");
  const logFile = path.join(root, "glean-e2e.log");
  const mcpConfigFile = path.join(home, ".glean_mdm", "mcp-config.json");

  // Create directory structure
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(extensions, { recursive: true });
  fs.mkdirSync(path.join(home, ".glean_mdm"), { recursive: true });

  // Pre-create directories that the extension will write to
  if (editorName === "windsurf") {
    fs.mkdirSync(path.join(home, ".codeium", "windsurf"), { recursive: true });
  } else if (editorName === "antigravity") {
    fs.mkdirSync(path.join(home, ".gemini", "antigravity"), {
      recursive: true,
    });
  }

  // Create an empty log file
  fs.writeFileSync(logFile, "");

  return { root, userData, extensions, home, logFile, mcpConfigFile };
}

export function writeTestConfig(
  mcpConfigFile: string,
  config?: { serverName: string; url: string },
): void {
  const data = config ?? {
    serverName: "e2e-test-server",
    url: "https://e2e-test.glean.com/mcp/default",
  };
  fs.writeFileSync(mcpConfigFile, JSON.stringify(data, null, 2), "utf-8");
}

export function cleanupSandbox(sandboxRoot: string): void {
  // Navigate up one level to get the timestamped parent dir
  const parent = path.dirname(sandboxRoot);
  try {
    fs.rmSync(parent, { recursive: true, force: true });
    console.log(`Cleaned up sandbox: ${parent}`);
  } catch (err) {
    console.warn(`Failed to cleanup sandbox ${parent}: ${err}`);
  }
}

export function readLogFile(logFilePath: string): string {
  try {
    return fs.readFileSync(logFilePath, "utf-8");
  } catch {
    return "";
  }
}

export function assertLogContains(
  log: string,
  pattern: string | RegExp,
  description: string,
): string | null {
  const matches =
    typeof pattern === "string" ? log.includes(pattern) : pattern.test(log);
  if (!matches) {
    return `FAIL: ${description} — pattern not found: ${pattern}`;
  }
  return null;
}

export function assertLogNotContains(
  log: string,
  pattern: string | RegExp,
  description: string,
): string | null {
  const matches =
    typeof pattern === "string" ? log.includes(pattern) : pattern.test(log);
  if (matches) {
    return `FAIL: ${description} — unexpected pattern found: ${pattern}`;
  }
  return null;
}

export function assertFileExists(
  filePath: string,
  description: string,
): string | null {
  if (!fs.existsSync(filePath)) {
    return `FAIL: ${description} — file not found: ${filePath}`;
  }
  return null;
}

export function assertFileContains(
  filePath: string,
  content: string,
  description: string,
): string | null {
  if (!fs.existsSync(filePath)) {
    return `FAIL: ${description} — file not found: ${filePath}`;
  }
  const fileContent = fs.readFileSync(filePath, "utf-8");
  if (!fileContent.includes(content)) {
    return `FAIL: ${description} — content not found in ${filePath}`;
  }
  return null;
}

export function waitForLogLine(
  logFilePath: string,
  pattern: string | RegExp,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();

    const check = () => {
      const content = readLogFile(logFilePath);
      const matches =
        typeof pattern === "string"
          ? content.includes(pattern)
          : pattern.test(content);

      if (matches) {
        resolve(true);
        return;
      }

      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }

      setTimeout(check, 500);
    };

    check();
  });
}
