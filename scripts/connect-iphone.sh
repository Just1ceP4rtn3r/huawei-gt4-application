#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
: "${GT4_IPHONE_HOST:?Set GT4_IPHONE_HOST or configure .local/iphone.env}"
case "${1:-}" in
  server)
    exec bash "$GT4_ROOT/scripts/ssh.sh" 'HISTFILE=/dev/null; export HISTFILE; exec /var/jb/usr/sbin/frida-server -l 127.0.0.1:27042'
    ;;
  tunnel)
    exec ssh -F /dev/null -o BatchMode=yes -o ConnectTimeout=8 -o ExitOnForwardFailure=yes \
      -o UserKnownHostsFile="$GT4_ROOT/.local/ssh/known_hosts" -o StrictHostKeyChecking=yes \
      -N -L 127.0.0.1:27043:127.0.0.1:27042 "root@$GT4_IPHONE_HOST"
    ;;
  *) echo 'Usage: bash scripts/connect-iphone.sh server|tunnel' >&2; exit 2 ;;
esac
