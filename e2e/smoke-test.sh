#!/bin/bash
set -euo pipefail

# Quick smoke test for a single editor.
# Usage: ./e2e/smoke-test.sh <cursor|windsurf|antigravity>

EDITOR="${1:?Usage: smoke-test.sh <cursor|windsurf|antigravity>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VSIX_PATH="$PROJECT_ROOT/glean.vsix"
TIMEOUT=30

# Resolve editor binary
case "$EDITOR" in
  cursor)
    BINARY="/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
    ;;
  windsurf)
    BINARY="/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf"
    ;;
  antigravity)
    BINARY="/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity"
    ;;
  *)
    echo "Unknown editor: $EDITOR"
    echo "Usage: smoke-test.sh <cursor|windsurf|antigravity>"
    exit 1
    ;;
esac

if [ ! -f "$BINARY" ]; then
  echo "Editor binary not found: $BINARY"
  exit 1
fi

# Build if needed
if [ ! -f "$VSIX_PATH" ]; then
  echo "Building extension..."
  (cd "$PROJECT_ROOT" && npm run compile && npm run package)
fi

# Create sandbox
SANDBOX=$(mktemp -d "/tmp/glean-e2e-smoke-XXXXXX")
SANDBOX_EDITOR="$SANDBOX/$EDITOR"
mkdir -p "$SANDBOX_EDITOR"/{user-data,extensions,home/.glean_mdm}
LOG_FILE="$SANDBOX_EDITOR/glean-e2e.log"
touch "$LOG_FILE"

# Write test config
cat > "$SANDBOX_EDITOR/home/.glean_mdm/mcp-config.json" << 'EOF'
{
  "serverName": "e2e-test-server",
  "url": "https://e2e-test.glean.com/mcp/default"
}
EOF

# Pre-create host-specific directories
case "$EDITOR" in
  windsurf)
    mkdir -p "$SANDBOX_EDITOR/home/.codeium/windsurf"
    ;;
  antigravity)
    mkdir -p "$SANDBOX_EDITOR/home/.gemini/antigravity"
    ;;
esac

echo "Sandbox: $SANDBOX_EDITOR"
echo "Log file: $LOG_FILE"

# Install VSIX
echo "Installing VSIX..."
"$BINARY" --extensions-dir "$SANDBOX_EDITOR/extensions" --install-extension "$VSIX_PATH"

# Launch editor
echo "Launching $EDITOR..."
HOME="$SANDBOX_EDITOR/home" \
GLEAN_E2E_LOG_FILE="$LOG_FILE" \
  "$BINARY" \
    --user-data-dir "$SANDBOX_EDITOR/user-data" \
    --extensions-dir "$SANDBOX_EDITOR/extensions" \
    --new-window \
    --disable-gpu \
    "$SANDBOX_EDITOR/home" &

EDITOR_PID=$!

# Wait for activation
echo "Waiting for activation (timeout: ${TIMEOUT}s)..."
ELAPSED=0
ACTIVATED=false
while [ $ELAPSED -lt $TIMEOUT ]; do
  if grep -q "Glean version:" "$LOG_FILE" 2>/dev/null; then
    ACTIVATED=true
    break
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

# Give extra time for host-specific behavior
if [ "$ACTIVATED" = true ]; then
  echo "Extension activated!"
  sleep 3
else
  echo "Timed out waiting for activation."
fi

# Kill editor
kill "$EDITOR_PID" 2>/dev/null || true
wait "$EDITOR_PID" 2>/dev/null || true

# Show log
echo ""
echo "=== Log output ==="
cat "$LOG_FILE"
echo "=== End log ==="
echo ""

# Basic assertions
PASS=true

if ! grep -q "Glean version:" "$LOG_FILE"; then
  echo "FAIL: Version string not found in log"
  PASS=false
fi

if grep -q "\[ERROR\]" "$LOG_FILE"; then
  echo "WARN: Error lines found in log (may be expected)"
  grep "\[ERROR\]" "$LOG_FILE" | while read -r line; do
    echo "  $line"
  done
fi

if [ "$PASS" = true ]; then
  echo "PASS: $EDITOR smoke test passed"
else
  echo "FAIL: $EDITOR smoke test failed"
fi

# Cleanup
rm -rf "$SANDBOX"
echo "Cleaned up sandbox"

if [ "$PASS" = false ]; then
  exit 1
fi
