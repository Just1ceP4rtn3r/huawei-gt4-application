#!/bin/bash
set -euo pipefail
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT/../../scripts/env.sh"
export PATH="$GT4_ROOT/tools/node-v16.20.2-darwin-arm64/bin:$PATH"
export CLANG_MODULE_CACHE_PATH="$GT4_ROOT/.local/cache/clang"
export SWIFT_MODULECACHE_PATH="$GT4_ROOT/.local/cache/swift"
mkdir -p "$PROJECT/build" "$CLANG_MODULE_CACHE_PATH" "$SWIFT_MODULECACHE_PATH"
case "${1:---unsigned}" in
  --unsigned) export HUASIDELOAD_SKIP_SIGN=1 ;;
  --signed)
    unset HUASIDELOAD_SKIP_SIGN
    [ -f "$GT4_ROOT/.local/signing/profiles/com.example.gt4counter.p7b" ] || {
      echo 'Create the new GT4 AirPointer Debug Profile first: .local/signing/profiles/com.example.gt4counter.p7b' >&2
      exit 1
    }
    /usr/bin/python3 "$PROJECT/scripts/validate-signing.py"
    ;;
  *) echo 'Usage: bash examples/gt4-airpointer/scripts/build.sh [--unsigned|--signed]' >&2; exit 2 ;;
esac
export HUASIDELOAD_OUT_DIR="$PROJECT/build"
export HUASIDELOAD_JS_POSTPROCESSOR="$PROJECT/scripts/compact-watch-js.cjs"
bash "$GT4_ROOT/scripts/build-lite.sh" "$PROJECT/watch" debug
/usr/bin/python3 "$PROJECT/tests/jerry_parse_test.py"
/usr/bin/python3 "$PROJECT/tests/jerry_runtime_test.py"
if [ "${1:---unsigned}" = --unsigned ]; then
  cp "$PROJECT/watch/build/out/unsigned.bin" "$PROJECT/build/GT4 AirPointer-unsigned.bin"
else
  /usr/bin/python3 "$PROJECT/scripts/verify-bin.py" "$PROJECT/build/GT4 AirPointer.bin"
fi
/usr/bin/swiftc -swift-version 5 -Onone -module-cache-path "$SWIFT_MODULECACHE_PATH" \
  "$PROJECT/desktop/MouseSink.swift" -o "$PROJECT/build/GT4AirPointerSink" \
  -framework Foundation -framework CoreGraphics
"$GT4_ROOT/tools/frida-agent/node_modules/.bin/esbuild" "$PROJECT/relay/iphone-agent.js" \
  --bundle --format=iife --outfile="$PROJECT/build/iphone-agent.js"
"$GT4_ROOT/tools/frida-agent/node_modules/.bin/esbuild" "$PROJECT/relay/phone-bootstrap.js" \
  --bundle --format=iife --outfile="$PROJECT/build/phone-bootstrap.js"
"$PROJECT/build/GT4AirPointerSink" --self-test
"$NODE16" "$PROJECT/tests/motion.test.mjs"
"$NODE16" "$PROJECT/tests/transport.test.mjs"
"$NODE16" "$PROJECT/tests/protocol.test.mjs"
"$NODE16" "$PROJECT/tests/lifecycle.test.mjs"
"$NODE16" "$PROJECT/tests/compiled-runtime.test.mjs"
"$NODE16" "$PROJECT/tests/managed_controller.test.mjs"
"$NODE16" "$PROJECT/tests/pointer_beacon.test.mjs"
"$NODE16" "$PROJECT/tests/pointer_roundtrip.test.mjs"
"$NODE16" "$PROJECT/tests/message_queue.test.mjs"
/usr/bin/python3 "$PROJECT/tests/pipeline_test.py"
/usr/bin/python3 "$PROJECT/tests/watch_logs_test.py"
/usr/bin/python3 "$PROJECT/tests/manager_test.py"
/usr/bin/python3 - "$PROJECT" "${1:---unsigned}" <<'PY_STATUS'
import datetime,hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1]);mode=sys.argv[2]
binary=p/'build'/('GT4 AirPointer.bin' if mode=='--signed' else 'GT4 AirPointer-unsigned.bin')
report={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'bundleName':'com.example.gt4counter','mode':mode,
        'watchCompile':'passed','desktopCompile':'passed','iphoneAgentBundle':'passed','offlineChecks':'passed',
        'signedProfileValidated':mode=='--signed','binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),
        'deviceSensors':'not_run','deviceP2P':'not_run','deviceInstallation':'not_run','liveMouseInjection':'not_run'}
(p/'build/status.json').write_text(json.dumps(report,indent=2)+'\n')
PY_STATUS
echo 'Build and offline checks passed. Real GT4 sensors/P2P/mouse control require separate device acceptance.'
