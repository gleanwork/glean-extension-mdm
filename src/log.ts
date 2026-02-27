import * as vscode from "vscode";
import * as util from "util";

let outputChannel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Glean");
  }
  return outputChannel;
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }
      return util.inspect(arg, { depth: 4, colors: false, maxStringLength: 1000 });
    })
    .join(" ");
}

function write(level: string, args: unknown[]) {
  const timestamp = new Date().toISOString();
  const message = formatArgs(args);
  getChannel().appendLine(`${timestamp} [${level}] ${message}`);
}

export function info(...args: unknown[]) {
  write("INFO", args);
}

export function warn(...args: unknown[]) {
  write("WARN", args);
}

export function error(...args: unknown[]) {
  write("ERROR", args);
}

export function debug(...args: unknown[]) {
  write("DEBUG", args);
}

export function dispose() {
  outputChannel?.dispose();
  outputChannel = undefined;
}
