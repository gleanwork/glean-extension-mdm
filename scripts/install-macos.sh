#!/bin/bash
#
# MDM install script for macOS.
# Installs the Glean extension into Cursor and deploys the config file.
#
# Usage: install-macos.sh <glean_mcp_url> [server_name]
#
# This script is intended to be run by MDM (Jamf, Intune, etc.) as root.

set -euo pipefail

CONFIG_DIR="/Library/Application Support/Glean MDM"
CONFIG_PATH="${CONFIG_DIR}/mcp-config.json"

GLEAN_MCP_URL="${1:-}"
SERVER_NAME="${2:-glean-default}"

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

  if [ -x "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" ]; then
    echo "/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
    return
  fi

  return 1
}

CURSOR_CMD=$(find_cursor_cli) || {
  echo "Error: 'cursor' CLI not found in PATH or known install locations."
  exit 1
}

echo "Found cursor CLI at: ${CURSOR_CMD}"

TARGET_USER="$(stat -f '%Su' /dev/console 2>/dev/null || logname 2>/dev/null || echo "$USER")"

echo "Target user: ${TARGET_USER}"

if [ "$TARGET_USER" = "root" ] || [ "$TARGET_USER" = "loginwindow" ] || [ -z "$TARGET_USER" ]; then
  echo "Error: Could not determine a non-root target user."
  exit 1
fi

TARGET_HOME=$(eval echo "~${TARGET_USER}")

echo "Target home: ${TARGET_HOME}"

# Remove any previous installation to avoid ownership conflicts on reinstall
rm -rf "${TARGET_HOME}/.cursor/extensions/glean.glean-"*
sudo -H -u "$TARGET_USER" "$CURSOR_CMD" --uninstall-extension glean.glean-mdm 2>/dev/null || true
sudo -H -u "$TARGET_USER" "$CURSOR_CMD" --uninstall-extension glean.glean 2>/dev/null || true

echo "Installing extension as ${TARGET_USER}..."
sudo -H -u "$TARGET_USER" "$CURSOR_CMD" --install-extension glean.glean --force
echo "Extension installed successfully."
