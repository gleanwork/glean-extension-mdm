import type * as vscode from "vscode";

/**
 * Cursor-specific MCP extension API.
 * Extends the vscode namespace with cursor.mcp.registerServer/unregisterServer.
 * These types are not part of the standard @types/vscode package.
 */
declare module "vscode" {
  export namespace cursor {
    export namespace mcp {
      export interface StdioServerConfig {
        name: string;
        server: {
          command: string;
          args: string[];
          env: Record<string, string>;
        };
      }

      export interface RemoteServerConfig {
        name: string;
        server: {
          url: string;
          headers?: Record<string, string>;
        };
      }

      export type ExtMCPServerConfig = StdioServerConfig | RemoteServerConfig;

      export const registerServer: (config: ExtMCPServerConfig) => Promise<void>;
      export const unregisterServer: (serverName: string) => void;
    }
  }
}

export interface GleanMdmConfig {
  serverName: string;
  url: string;
  gaMeasurementId?: string;
  gaApiSecret?: string;
}

export interface McpClientInfo {
  clientKey: string;
  url: string | undefined;
  state: string | undefined;
}
