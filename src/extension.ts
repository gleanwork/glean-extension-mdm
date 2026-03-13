import * as vscode from "vscode";

import { activateAntigravity } from "./hosts/antigravity";
import { resolveConfig } from "./config";
import { activateCursor, deactivateCursor } from "./hosts/cursor";
import { detectIde } from "./ide-detect";
import * as log from "./log";
import { activateWindsurf } from "./hosts/windsurf";

export async function activate(context: vscode.ExtensionContext) {
  // Push log disposable first — LIFO order means it disposes last,
  // keeping the log channel alive for other dispose calls.
  context.subscriptions.push({ dispose: () => log.dispose() });

  const ide = detectIde();
  log.info(
    `Glean version: ${context.extension.packageJSON.version} on ${ide} ${vscode.version}`,
  );

  if (ide === "unknown") {
    log.info("Not running in Cursor, Windsurf, or Antigravity, skipping activation");
    return;
  }

  const extensionUrl = vscode.workspace
    .getConfiguration("glean")
    .get<string>("mcpServerUrl", "");
  const config = resolveConfig(extensionUrl, (msg) => log.info(msg));

  if (!config) {
    log.warn("No Glean MDM config found");
    return;
  }

  if (ide === "cursor") {
    await activateCursor(context, config);
  } else if (ide === "windsurf") {
    await activateWindsurf(context, config);
  } else if (ide === "antigravity") {
    await activateAntigravity(context, config);
  }
}

export function deactivate() {
  deactivateCursor();
}
