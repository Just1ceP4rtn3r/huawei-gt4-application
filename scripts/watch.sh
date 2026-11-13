#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
export PATH="$GT4_ROOT/tools/node-v16.20.2-darwin-arm64/bin:$PATH"
"$GT4_ROOT/tools/frida-agent/node_modules/.bin/esbuild" "$GT4_ROOT/scripts/phone-bridge.js" \
  --bundle --format=iife --outfile="$GT4_ROOT/.local/tmp/phone-bridge.js"
exec /usr/bin/python3 -u "$GT4_ROOT/scripts/watch-channel.py" "$@"
