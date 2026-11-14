#!/bin/bash
set -euo pipefail
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT/../../scripts/env.sh"
exec /usr/bin/python3 -u "$PROJECT/relay/relay.py" "$@"
