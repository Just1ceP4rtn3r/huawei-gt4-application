#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
: "${GT4_IPHONE_HOST:?Set GT4_IPHONE_HOST or configure .local/iphone.env}"
exec ssh -F /dev/null -o BatchMode=yes -o ConnectTimeout=8 \
  -o UserKnownHostsFile="$GT4_ROOT/.local/ssh/known_hosts" \
  -o StrictHostKeyChecking=yes "root@$GT4_IPHONE_HOST" "$@"
