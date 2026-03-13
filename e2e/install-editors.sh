#!/bin/bash
set -uo pipefail

# Installs editor binaries on macOS via Homebrew.
# Idempotent: skips editors already installed.
# Best-effort: continues past failures so CI doesn't break.
# The test runner skips missing editors.
# Usage: ./e2e/install-editors.sh

install_cask() {
  local cask="$1" app_name="$2"

  if [ -d "/Applications/${app_name}.app" ]; then
    echo "${app_name} already installed, skipping"
    return 0
  fi

  echo "Installing ${cask} via Homebrew..."
  if ! brew install --cask "$cask" 2>&1; then
    echo "WARNING: Failed to install ${cask}, skipping"
    return 0
  fi

  echo "${cask} installed"
}

install_cask "cursor"       "Cursor"
install_cask "windsurf"     "Windsurf"
install_cask "antigravity"  "Antigravity"

echo ""
echo "Done. Installed editors:"
ls -d /Applications/{Cursor,Windsurf,Antigravity}.app 2>/dev/null || echo "(none found)"
