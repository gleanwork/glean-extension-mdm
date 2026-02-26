#!/bin/bash
#
# MDM install script for Linux.
# Installs the Glean MDM extension into Cursor and deploys the config file.
#
# Usage: install-linux.sh <glean_mcp_url> [server_name]
#
# This script is intended to be run as root.

set -euo pipefail

VSIX_DOWNLOAD_URL="https://github.com/gleanwork/glean-extension-mdm/releases/latest/download/glean-mdm.vsix"
VSIX_PATH="/tmp/glean-mdm.vsix"
CONFIG_DIR="/etc/glean_mdm"
CONFIG_PATH="${CONFIG_DIR}/mcp-config.json"

GLEAN_MCP_URL="${1:-}"
SERVER_NAME="${2:-glean_default_mdm}"

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

# Locate the Cursor CLI, checking PATH and well-known install locations.
# When MDM runs this script as root, PATH is typically minimal
# (/usr/bin:/bin:/usr/sbin:/sbin) and won't include /usr/local/bin.
find_cursor_cli() {
  if command -v cursor &> /dev/null; then
    echo "cursor"
    return
  fi

  if [ -x "/usr/local/bin/cursor" ]; then
    echo "/usr/local/bin/cursor"
    return
  fi

  if [ -x "/usr/bin/cursor" ]; then
    echo "/usr/bin/cursor"
    return
  fi

  if [ -x "/opt/Cursor/resources/app/bin/cursor" ]; then
    echo "/opt/Cursor/resources/app/bin/cursor"
    return
  fi

  return 1
}

CURSOR_CMD=$(find_cursor_cli) || {
  echo "Error: 'cursor' CLI not found in PATH or known install locations."
  exit 1
}

echo "Found cursor CLI at: ${CURSOR_CMD}"

echo "Downloading extension from ${VSIX_DOWNLOAD_URL}..."
if curl -fsSL -o "$VSIX_PATH" "$VSIX_DOWNLOAD_URL"; then
  "$CURSOR_CMD" --install-extension "$VSIX_PATH"
  rm -f "$VSIX_PATH"
  echo "Extension installed successfully."
else
  echo "Error: Failed to download extension from ${VSIX_DOWNLOAD_URL}"
  exit 1
fi
