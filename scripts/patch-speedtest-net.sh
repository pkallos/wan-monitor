#!/bin/sh
# Conditionally patch speedtest-net for macOS ARM64 only
# This adds support for darwin/arm64 platform

set -e

# Only patch on macOS ARM64
if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
  echo "Detected macOS ARM64 - applying speedtest-net patch..."

  PATCH_FILE="$(dirname "$0")/../patches/speedtest-net-arm64.patch"
  TARGET_FILE="node_modules/.pnpm/speedtest-net@2.2.0/node_modules/speedtest-net/index.js"

  if [ -f "$TARGET_FILE" ]; then
    # Check if already patched by looking for the specific ARM64 entry with defaultVersion
    if grep -q "defaultVersion: '1.2.0'" "$TARGET_FILE" && grep -A 2 "defaultVersion: '1.2.0'" "$TARGET_FILE" | grep -q "arch: 'arm64'"; then
      echo "speedtest-net already patched, skipping..."
    else
      echo "Applying patch to speedtest-net..."
      cd node_modules/.pnpm/speedtest-net@2.2.0/node_modules/speedtest-net
      patch -p1 < "../../../../../$PATCH_FILE"
      echo "Patch applied successfully!"
    fi
  else
    echo "Warning: speedtest-net not found at expected location, skipping patch"
  fi
else
  echo "Not macOS ARM64 ($(uname -s)/$(uname -m)) - skipping speedtest-net patch"
fi
