#!/bin/bash
set -euo pipefail
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT/../../scripts/env.sh"
export PATH="$GT4_ROOT/tools/node-v16.20.2-darwin-arm64/bin:$PATH"
mkdir -p "$PROJECT/build"
export HUASIDELOAD_JS_POSTPROCESSOR="$PROJECT/scripts/compact-watch-js.cjs"
export HUASIDELOAD_OUT_DIR="$PROJECT/build"
bash "$GT4_ROOT/scripts/build-lite.sh" "$PROJECT/watch" debug
/usr/bin/python3 "$PROJECT/scripts/check-lite-js.py"
/usr/bin/python3 "$PROJECT/tests/compiled-jerry-runtime.py"
"$GT4_ROOT/tools/frida-agent/node_modules/.bin/esbuild" "$GT4_ROOT/scripts/phone-bridge.js" \
  --bundle --format=iife --outfile="$PROJECT/build/install-agent.js"
"$GT4_ROOT/tools/frida-agent/node_modules/.bin/esbuild" "$PROJECT/relay/iphone-agent.js" \
  --bundle --format=iife --outfile="$PROJECT/build/iphone-agent.js"
"$GT4_ROOT/tools/frida-agent/node_modules/.bin/esbuild" "$PROJECT/relay/phone-bootstrap.js" \
  --bundle --format=iife --outfile="$PROJECT/build/phone-bootstrap.js"
export CLANG_MODULE_CACHE_PATH="$GT4_ROOT/.local/cache/clang"
export SWIFT_MODULECACHE_PATH="$GT4_ROOT/.local/cache/swift"
/usr/bin/swiftc -swift-version 5 -Onone -module-cache-path "$SWIFT_MODULECACHE_PATH" \
  "$PROJECT/desktop/MouseSink.swift" -o "$PROJECT/build/GT4AirPointerSink" \
  -framework Foundation -framework CoreGraphics
echo "BUILD_OK"
