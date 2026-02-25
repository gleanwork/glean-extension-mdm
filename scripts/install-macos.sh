#!/bin/bash
#
# MDM install script for macOS.
# Installs the Glean MCP extension into Cursor and deploys the config file.
#
# Usage: install-macos.sh <glean_mcp_url> [server_name]
#
# This script is intended to be run by MDM (Jamf, Intune, etc.) as root.

set -euo pipefail

VSIX_DOWNLOAD_URL="https://example.com/path/to/glean-mcp.vsix"
VSIX_PATH="/tmp/glean-mcp.vsix"
CONFIG_DIR="/Library/Application Support/Glean"
CONFIG_PATH="${CONFIG_DIR}/mcp-config.json"

GLEAN_MCP_URL="${1:-}"
SERVER_NAME="${2:-glean}"

if [ -z "$GLEAN_MCP_URL" ]; then
  echo "Error: Glean MCP URL is required as the first argument."
  echo "Usage: $0 <glean_mcp_url> [server_name]"
  exit 1
fi

# Deploy config file
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_PATH" <<EOF
{
  "serverName": "${SERVER_NAME}",
  "url": "${GLEAN_MCP_URL}"
}
EOF
chmod 644 "$CONFIG_PATH"
echo "Config written to ${CONFIG_PATH}"

# Download and install extension if Cursor CLI is available
if ! command -v cursor &> /dev/null; then
  echo "Warning: 'cursor' CLI not found. Skipping extension install."
  exit 0
fi

echo "Downloading extension from ${VSIX_DOWNLOAD_URL}..."
if curl -fsSL -o "$VSIX_PATH" "$VSIX_DOWNLOAD_URL"; then
  cursor --install-extension "$VSIX_PATH"
  rm -f "$VSIX_PATH"
  echo "Extension installed successfully."
else
  echo "Error: Failed to download extension from ${VSIX_DOWNLOAD_URL}"
  exit 1
fi
