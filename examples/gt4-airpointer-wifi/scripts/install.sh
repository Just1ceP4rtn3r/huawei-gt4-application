#!/bin/bash
set -euo pipefail
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT/../../scripts/env.sh"
export PATH="$GT4_ROOT/tools/node-v16.20.2-darwin-arm64/bin:$PATH"
[ -f "$PROJECT/build/GT4 AirPointer.bin" ] || { echo 'Missing signed AirPointer package. Build with --signed first.' >&2; exit 1; }
/usr/bin/python3 "$PROJECT/scripts/verify-bin.py" "$PROJECT/build/GT4 AirPointer.bin"
"$GT4_ROOT/tools/frida-agent/node_modules/.bin/esbuild" "$GT4_ROOT/scripts/phone-bridge.js" \
  --bundle --format=iife --outfile="$PROJECT/build/install-agent.js"
exec /usr/bin/python3 -u "$PROJECT/scripts/install-channel.py" --install "$PROJECT/build/GT4 AirPointer.bin" "$@"
