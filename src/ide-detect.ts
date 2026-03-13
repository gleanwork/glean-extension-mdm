import * as vscode from "vscode";

export type IdeType = "cursor" | "windsurf" | "antigravity" | "unknown";

export function detectIde(): IdeType {
  const appName = vscode.env.appName ?? "";
  const uriScheme = vscode.env.uriScheme ?? "";

  if (/cursor/i.test(appName) || /cursor/i.test(uriScheme)) {
    return "cursor";
  }

  if (/windsurf/i.test(appName) || /windsurf/i.test(uriScheme)) {
    return "windsurf";
  }

  if (/antigravity/i.test(appName) || /antigravity/i.test(uriScheme)) {
    return "antigravity";
  }

  return "unknown";
}
