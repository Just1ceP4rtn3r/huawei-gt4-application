#!/bin/bash
set -euo pipefail
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT/../../scripts/env.sh"
export PATH="$GT4_ROOT/tools/node-v16.20.2-darwin-arm64/bin:$PATH"
mkdir -p "$PROJECT/build"
case "${1:---unsigned}" in
 --unsigned) export HUASIDELOAD_SKIP_SIGN=1 ;;
 --signed) unset HUASIDELOAD_SKIP_SIGN; /usr/bin/python3 "$PROJECT/scripts/validate-signing.py" ;;
 *) echo 'Usage: bash examples/gt4-rawfile-test/scripts/build.sh [--unsigned|--signed]' >&2; exit 2 ;;
esac
mkdir -p "$PROJECT/build"
export HUASIDELOAD_OUT_DIR="$PROJECT/build"
export HUASIDELOAD_JS_POSTPROCESSOR="$PROJECT/scripts/compact-watch-js.cjs"
bash "$GT4_ROOT/scripts/build-lite.sh" "$PROJECT/watch" debug
/usr/bin/python3 "$PROJECT/tests/jerry_parse_test.py"
if [ "${1:---unsigned}" = --signed ]; then
 /usr/bin/python3 "$PROJECT/scripts/verify-bin.py" "$PROJECT/build/GT4 AirPointer.bin"
else
 cp "$PROJECT/watch/build/out/unsigned.bin" "$PROJECT/build/GT4 AirPointer-unsigned.bin"
fi
for agent in iphone-agent phone-bootstrap; do
 "$GT4_ROOT/tools/frida-agent/node_modules/.bin/esbuild" "$PROJECT/relay/$agent.js" --bundle --format=iife --outfile="$PROJECT/build/$agent.js"
done
"$NODE16" --test "$PROJECT/tests/rawfile-target.test.mjs"
echo 'Build and offline checks passed; no device connection was made.'
