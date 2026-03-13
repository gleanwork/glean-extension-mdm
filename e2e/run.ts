import { execSync, spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";

import {
  type EditorInfo,
  type EditorName,
  type TestResult,
  discoverEditors,
  createSandbox,
  writeTestConfig,
  cleanupSandbox,
  readLogFile,
  assertLogContains,
  assertFileExists,
  assertFileContains,
  waitForLogLine,
} from "./helpers";

const ACTIVATION_TIMEOUT_MS = 30_000;
const PROJECT_ROOT = path.resolve(__dirname, "..");

function buildExtension(): void {
  console.log("\n=== Building extension ===");
  execSync("npm run compile", { cwd: PROJECT_ROOT, stdio: "inherit" });
  execSync("npm run package", { cwd: PROJECT_ROOT, stdio: "inherit" });
  console.log("Build complete.\n");
}

function installVsix(editor: EditorInfo, extensionsDir: string): void {
  const vsixPath = path.join(PROJECT_ROOT, "glean.vsix");
  if (!fs.existsSync(vsixPath)) {
    throw new Error(`VSIX not found at ${vsixPath}. Run 'npm run package' first.`);
  }

  console.log(`Installing VSIX into ${extensionsDir}...`);
  execSync(
    `"${editor.binaryPath}" --extensions-dir "${extensionsDir}" --install-extension "${vsixPath}"`,
    { cwd: PROJECT_ROOT, stdio: "inherit" },
  );
}

async function launchEditorAndWait(
  editor: EditorInfo,
  sandbox: ReturnType<typeof createSandbox>,
): Promise<{ exitCode: number | null }> {
  console.log(`Launching ${editor.name}...`);

  const child = spawn(
    editor.binaryPath,
    [
      "--user-data-dir",
      sandbox.userData,
      "--extensions-dir",
      sandbox.extensions,
      "--new-window",
      "--disable-gpu",
      sandbox.home,
    ],
    {
      env: {
        ...process.env,
        HOME: sandbox.home,
        GLEAN_E2E_LOG_FILE: sandbox.logFile,
      },
      stdio: "inherit",
    },
  );

  // Wait for the activation log line or timeout
  const activated = await waitForLogLine(
    sandbox.logFile,
    "Glean version:",
    ACTIVATION_TIMEOUT_MS,
  );

  if (activated) {
    console.log(`${editor.name}: Extension activated successfully`);

    // Give extra time for host-specific behavior (config writes, MCP registration)
    if (editor.name === "cursor") {
      // Wait for MCP lease or the 10s fallback registration
      await waitForLogLine(
        sandbox.logFile,
        /MCP lease activated|No initial MCP clients found|Failed to activate/,
        15_000,
      );
    } else {
      // Wait for config file write
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  } else {
    console.log(
      `${editor.name}: Timed out waiting for activation (${ACTIVATION_TIMEOUT_MS}ms)`,
    );
  }

  // Kill the editor process
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
    // Force kill after 5s if it doesn't exit gracefully
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
  });

  return { exitCode: child.exitCode };
}

function runAssertions(
  editor: EditorInfo,
  sandbox: ReturnType<typeof createSandbox>,
  withConfig: boolean,
): TestResult {
  const logContent = readLogFile(sandbox.logFile);
  const failures: string[] = [];

  const check = (result: string | null) => {
    if (result) failures.push(result);
  };

  if (logContent.length === 0) {
    failures.push(
      "FAIL: Log file is empty — extension may not have activated at all",
    );
    return { editor: editor.name, passed: false, failures };
  }

  if (withConfig) {
    // Test 1: Extension activated with version string
    check(
      assertLogContains(
        logContent,
        "Glean version:",
        "Extension should log version on activation",
      ),
    );

    // Test 2: IDE correctly detected
    check(
      assertLogContains(
        logContent,
        `on ${capitalize(editor.name)}`,
        `IDE should be detected as ${editor.name}`,
      ),
    );

    // Test 3: Config resolved
    check(
      assertLogContains(
        logContent,
        "e2e-test.glean.com",
        "Config should resolve the test URL",
      ),
    );

    // Test 4: No crash errors (allow expected errors)
    const logLines = logContent.split("\n");
    for (const line of logLines) {
      if (
        line.includes("[ERROR]") &&
        !line.includes("MCP server error") && // Expected when LS not running
        !line.includes("Failed to activate") // Expected when MCP lease unavailable
      ) {
        failures.push(`FAIL: Unexpected error in log: ${line.trim()}`);
      }
    }

    // Editor-specific assertions
    if (editor.name === "windsurf") {
      const windsurfConfig = path.join(
        sandbox.home,
        ".codeium",
        "windsurf",
        "mcp_config.json",
      );
      check(
        assertFileExists(
          windsurfConfig,
          "Windsurf MCP config file should be created",
        ),
      );
      check(
        assertFileContains(
          windsurfConfig,
          "e2e-test.glean.com",
          "Windsurf config should contain test URL",
        ),
      );
      check(
        assertFileContains(
          windsurfConfig,
          "X-Glean-Metadata",
          "Windsurf config should contain MDM header",
        ),
      );
    }

    if (editor.name === "antigravity") {
      const antigravityConfig = path.join(
        sandbox.home,
        ".gemini",
        "antigravity",
        "mcp_config.json",
      );
      check(
        assertFileExists(
          antigravityConfig,
          "Antigravity MCP config file should be created",
        ),
      );
      check(
        assertFileContains(
          antigravityConfig,
          "e2e-test.glean.com",
          "Antigravity config should contain test URL",
        ),
      );
      check(
        assertFileContains(
          antigravityConfig,
          "X-Glean-Metadata",
          "Antigravity config should contain MDM header",
        ),
      );
    }

    if (editor.name === "cursor") {
      check(
        assertLogContains(
          logContent,
          /Registered MCP server|MCP lease activated|No initial MCP clients found/,
          "Cursor should attempt MCP registration",
        ),
      );
    }

    // Windsurf/Antigravity: LS discovery should fail gracefully
    if (editor.name === "windsurf" || editor.name === "antigravity") {
      check(
        assertLogContains(
          logContent,
          /Could not discover|LS discovery attempt/,
          "LS discovery should fail gracefully when no LS is running",
        ),
      );
    }
  } else {
    // No-config scenario
    check(
      assertLogContains(
        logContent,
        "Glean version:",
        "Extension should still log version without config",
      ),
    );
    check(
      assertLogContains(
        logContent,
        "No Glean MDM config found",
        "Should warn when no config is present",
      ),
    );
  }

  return {
    editor: editor.name,
    passed: failures.length === 0,
    failures,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function testEditor(
  editor: EditorInfo,
  withConfig: boolean,
): Promise<TestResult> {
  const scenario = withConfig ? "with-config" : "no-config";
  console.log(
    `\n=== Testing ${editor.name} (${scenario}) ===`,
  );

  const sandbox = createSandbox(editor.name);
  console.log(`Sandbox: ${sandbox.root}`);

  if (withConfig) {
    writeTestConfig(sandbox.mcpConfigFile);
    console.log(`Wrote test config to ${sandbox.mcpConfigFile}`);
  }

  try {
    installVsix(editor, sandbox.extensions);
    await launchEditorAndWait(editor, sandbox);

    console.log(`\nLog file contents:`);
    const logContent = readLogFile(sandbox.logFile);
    console.log(logContent || "(empty)");

    const result = runAssertions(editor, sandbox, withConfig);
    return result;
  } finally {
    cleanupSandbox(sandbox.root);
  }
}

async function main() {
  const editorFilter = process.env.GLEAN_E2E_EDITORS;
  const skipBuild = process.env.GLEAN_E2E_SKIP_BUILD === "true";

  console.log("=== Glean MDM Extension E2E Tests ===\n");

  // Step 1: Discover editors
  const editors = discoverEditors(editorFilter);
  if (editors.length === 0) {
    console.error(
      "No editors found. Install Cursor, Windsurf, or Antigravity, or set GLEAN_E2E_EDITORS.",
    );
    process.exit(1);
  }
  console.log(`Found ${editors.length} editor(s): ${editors.map((e) => e.name).join(", ")}\n`);

  // Step 2: Build extension
  if (!skipBuild) {
    buildExtension();
  } else {
    console.log("Skipping build (GLEAN_E2E_SKIP_BUILD=true)\n");
  }

  // Step 3: Run tests for each editor
  const results: TestResult[] = [];

  for (const editor of editors) {
    // Test with config
    const withConfigResult = await testEditor(editor, true);
    results.push(withConfigResult);

    // Test without config (no-config scenario)
    const noConfigResult = await testEditor(editor, false);
    results.push({
      ...noConfigResult,
      editor: `${noConfigResult.editor} (no-config)` as EditorName,
    });
  }

  // Step 4: Report results
  console.log("\n=== Results ===\n");

  let anyFailed = false;
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`${status}: ${result.editor}`);
    for (const failure of result.failures) {
      console.log(`  ${failure}`);
      anyFailed = true;
    }
  }

  console.log(
    `\n${results.filter((r) => r.passed).length}/${results.length} tests passed`,
  );

  if (anyFailed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("E2E test runner failed:", err);
  process.exit(1);
});
