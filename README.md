# Glean OpenVSX Extension

Brings Glean's AI-powered search and knowledge tools directly into Cursor, Windsurf, and Antigravity, so you can find company information without leaving your editor.

## Configuration

The extension needs a Glean MCP server URL to connect to. It looks for this in the following order, using the first valid URL it finds:

1. **Extension setting** — Set `Glean: Mcp Server Url` in your editor's settings page (`Settings > Extensions > Glean`). When set, this takes priority over all config files.
2. **System config file (MDM-managed)** — Placed by your IT admin via an MDM script (Jamf, Intune, etc.). This is the typical setup for managed devices and requires no action from the user.
   | Platform | Path |
   |----------|------|
   | macOS | `/Library/Application Support/Glean MDM/mcp-config.json` |
   | Windows | `%PROGRAMDATA%\Glean MDM\mcp-config.json` |
   | Linux | `/etc/glean_mdm/mcp-config.json` |
3. **User config file** — For non-managed or development scenarios, place a config file at `~/.glean_mdm/mcp-config.json`.

Config files use the following format:

```json
{
  "serverName": "glean-default",
  "url": "https://your-instance.glean.com/mcp/default"
}
```
