#!/bin/bash
#
# MDM install script for Linux.
# Installs the Glean extension into Cursor and/or Windsurf and deploys the config file.
#
# Usage: install-linux.sh <glean_mcp_url> [server_name]
#
# This script is intended to be run as root.

set -euo pipefail

CONFIG_DIR="/etc/glean_mdm"
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

# Locate the Windsurf CLI, checking PATH and well-known install locations.
find_windsurf_cli() {
  if command -v windsurf &> /dev/null; then
    echo "windsurf"
    return
  fi

  if [ -x "/usr/local/bin/windsurf" ]; then
    echo "/usr/local/bin/windsurf"
    return
  fi

  if [ -x "/usr/bin/windsurf" ]; then
    echo "/usr/bin/windsurf"
    return
  fi

  if [ -x "/opt/Windsurf/resources/app/bin/windsurf" ]; then
    echo "/opt/Windsurf/resources/app/bin/windsurf"
    return
  fi

  return 1
}

TARGET_USER="$(logname 2>/dev/null || echo "$USER")"

echo "Target user: ${TARGET_USER}"

if [ "$TARGET_USER" = "root" ] || [ -z "$TARGET_USER" ]; then
  echo "Error: Could not determine a non-root target user."
  exit 1
fi

TARGET_HOME=$(eval echo "~${TARGET_USER}")

echo "Target home: ${TARGET_HOME}"

INSTALLED=0

# Install into Cursor if available
if CURSOR_CMD=$(find_cursor_cli); then
  echo "Found cursor CLI at: ${CURSOR_CMD}"

  # Remove any previous installation to avoid ownership conflicts on reinstall
  rm -rf "${TARGET_HOME}/.cursor/extensions/glean.glean-"*
  sudo -H -u "$TARGET_USER" "$CURSOR_CMD" --uninstall-extension glean.glean-mdm 2>/dev/null || true
  sudo -H -u "$TARGET_USER" "$CURSOR_CMD" --uninstall-extension glean.glean 2>/dev/null || true

  echo "Installing Cursor extension as ${TARGET_USER}..."
  sudo -H -u "$TARGET_USER" "$CURSOR_CMD" --install-extension glean.glean
  echo "Cursor extension installed successfully."
  INSTALLED=1
else
  echo "Cursor CLI not found, skipping Cursor installation."
fi

# Install into Windsurf if available
if WINDSURF_CMD=$(find_windsurf_cli); then
  echo "Found windsurf CLI at: ${WINDSURF_CMD}"

  # Remove any previous installation to avoid ownership conflicts on reinstall
  rm -rf "${TARGET_HOME}/.windsurf/extensions/glean.glean-"*
  sudo -H -u "$TARGET_USER" "$WINDSURF_CMD" --uninstall-extension glean.glean-mdm 2>/dev/null || true
  sudo -H -u "$TARGET_USER" "$WINDSURF_CMD" --uninstall-extension glean.glean 2>/dev/null || true

  echo "Installing Windsurf extension as ${TARGET_USER}..."
  sudo -H -u "$TARGET_USER" "$WINDSURF_CMD" --install-extension glean.glean
  echo "Windsurf extension installed successfully."
  INSTALLED=1
else
  echo "Windsurf CLI not found, skipping Windsurf installation."
fi

if [ "$INSTALLED" -eq 0 ]; then
  echo "Error: Neither Cursor nor Windsurf CLI found in PATH or known install locations."
  exit 1
fi
