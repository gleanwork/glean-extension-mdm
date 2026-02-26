#!/bin/bash
#
# MDM install script for macOS.
# Installs the Glean MDM extension into Cursor and deploys the config file.
#
# Usage: install-macos.sh <glean_mcp_url> [server_name] [ga_measurement_id] [ga_api_secret]
#
# This script is intended to be run by MDM (Jamf, Intune, etc.) as root.

set -euo pipefail

VSIX_DOWNLOAD_URL="https://github.com/gleanwork/glean-extension-mdm/releases/latest/download/glean-mdm.vsix"
VSIX_PATH="/tmp/glean-mdm.vsix"
CONFIG_DIR="/Library/Application Support/Glean MDM"
CONFIG_PATH="${CONFIG_DIR}/mcp-config.json"

GLEAN_MCP_URL="${1:-}"
SERVER_NAME="${2:-glean_default_mdm}"
GA_MEASUREMENT_ID="${3:-}"
GA_API_SECRET="${4:-}"

if [ -z "$GLEAN_MCP_URL" ]; then
  echo "Error: Glean MCP URL is required as the first argument."
  echo "Usage: $0 <glean_mcp_url> [server_name] [ga_measurement_id] [ga_api_secret]"
  exit 1
fi

# Build optional GA analytics fields
GA_FIELDS=""
if [ -n "$GA_MEASUREMENT_ID" ] && [ -n "$GA_API_SECRET" ]; then
  GA_FIELDS=$(cat <<GAEOF
,
  "gaMeasurementId": "${GA_MEASUREMENT_ID}",
  "gaApiSecret": "${GA_API_SECRET}"
GAEOF
)
fi

# Deploy config file
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_PATH" <<EOF
{
  "serverName": "${SERVER_NAME}",
  "url": "${GLEAN_MCP_URL}"${GA_FIELDS}
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
