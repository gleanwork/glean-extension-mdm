# Glean MCP — Cursor Extension for MDM

A Cursor extension that automatically connects the Glean MCP server when Cursor launches. Designed for enterprise MDM (Mobile Device Management) deployment.

## How it works

1. MDM deploys a config file with the Glean instance URL to a well-known path
2. MDM installs this extension into Cursor via `cursor --install-extension`
3. On launch, the extension reads the config and registers the Glean MCP server
4. The user signs in via Cursor's built-in OAuth flow

## Config file

MDM deploys a JSON file to a platform-specific path:

| Platform | Path |
|----------|------|
| macOS    | `/Library/Application Support/Glean/mcp-config.json` |
| Windows  | `C:\ProgramData\Glean\mcp-config.json` |
| Linux    | `/etc/glean/mcp-config.json` |

Format:

```json
{
  "serverName": "glean",
  "url": "https://company-be.glean.com/mcp/default"
}
```

A user-level config at `~/.glean/mcp-config.json` is also supported for development.

## Config resolution order

1. System config file (MDM-managed, paths above)
2. User config file (`~/.glean/mcp-config.json`)
3. Environment variables: `GLEAN_MCP_URL`, `GLEAN_MCP_SERVER_NAME`
4. Cursor settings: `gleanMcp.serverUrl`, `gleanMcp.serverName`

## MDM deployment

Install scripts are provided in `scripts/`. Each script downloads the `.vsix` from a configured URL, installs it via the Cursor CLI, and writes the config file.

```bash
# macOS (run as root via MDM)
./scripts/install-macos.sh https://company-be.glean.com/mcp/default

# Windows (run as admin via MDM)
.\scripts\install-windows.ps1 -GleanMcpUrl https://company-be.glean.com/mcp/default

# Linux (run as root)
./scripts/install-linux.sh https://company-be.glean.com/mcp/default
```

The download URL is defined at the top of each script (`VSIX_DOWNLOAD_URL` / `$VsixDownloadUrl`). Update it to point to your hosted `.vsix` before deploying.

## Development

```bash
npm install
npm run compile
# Press F5 in Cursor to launch Extension Development Host
```

## Packaging

```bash
npm run package
# Produces glean-mcp.vsix
```
