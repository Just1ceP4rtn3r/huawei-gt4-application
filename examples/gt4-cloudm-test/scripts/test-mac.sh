#!/bin/bash
set -euo pipefail
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT/../../scripts/env.sh"
if [[ "${1:-}" == "--help" ]]; then
  echo 'Usage: bash app/GT4AirPointerWiFiInstall/scripts/test-mac.sh [--enable]'
  echo 'Default: manually join GT4 Wi-Fi, dry-run. --enable posts real mouse input. Ctrl-C stops and cleans owned services.'
  exit 0
fi
if [ -f "$GT4_ROOT/.local/gt4-airpointer-wifi.env" ]; then
  set -a
  source "$GT4_ROOT/.local/gt4-airpointer-wifi.env"
  set +a
fi
for arg in "$@"; do
  case "$arg" in --enable) ;; *) echo "Unknown option" >&2; exit 2;; esac
done
exec /usr/bin/python3 "$PROJECT/scripts/test-mac.py" "$@"
