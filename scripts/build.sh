#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
export PATH="$GT4_ROOT/tools/node-v16.20.2-darwin-arm64/bin:$PATH"
MODE="${1:---unsigned}"
case "$MODE" in
  --unsigned) export HUASIDELOAD_SKIP_SIGN=1 ;;
  --signed) unset HUASIDELOAD_SKIP_SIGN
    for file in gt4counter-debug.cer profiles/com.example.gt4counter.p7b; do
      [ -f "$GT4_ROOT/.local/signing/$file" ] || { echo "Missing signing material: .local/signing/$file" >&2; exit 1; }
    done ;;
  *) echo 'Usage: bash scripts/build.sh [--unsigned|--signed]' >&2; exit 2 ;;
esac
if [ "$MODE" = --signed ]; then
  /usr/bin/python3 "$GT4_ROOT/scripts/validate-signing.py"
fi
bash "$GT4_ROOT/scripts/build-lite.sh" "$GT4_ROOT/examples/gt4-counter" debug
if [ "$MODE" = --unsigned ]; then
  cp "$GT4_ROOT/examples/gt4-counter/build/out/unsigned.bin" "$GT4_ROOT/artifacts/GT4 Counter-unsigned.bin"
else
  /usr/bin/python3 "$GT4_ROOT/scripts/verify-bin.py" "$GT4_ROOT/artifacts/GT4 Counter.bin"
fi
