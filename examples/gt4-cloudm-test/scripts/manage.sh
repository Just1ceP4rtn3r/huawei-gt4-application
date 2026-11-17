#!/bin/bash
set -euo pipefail
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT/../../scripts/env.sh"
cd "$GT4_ROOT"
exec /usr/bin/python3 "$PROJECT/relay/manager.py" "$@"
