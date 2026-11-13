#!/bin/bash
# Source this file; all writable tool state stays in the workspace.
GT4_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export GT4_ROOT
export LC_ALL=C
export LANG=C
export TMPDIR="$GT4_ROOT/.local/tmp"
export XDG_CACHE_HOME="$GT4_ROOT/.local/cache"
export XDG_CONFIG_HOME="$GT4_ROOT/.local/home/config"
export XDG_DATA_HOME="$GT4_ROOT/.local/home/data"
export npm_config_cache="$GT4_ROOT/.local/cache/npm"
export npm_config_userconfig="$GT4_ROOT/.local/home/npmrc"
export npm_config_update_notifier=false
export PIP_CACHE_DIR="$GT4_ROOT/.local/cache/pip"
export PYTHONDONTWRITEBYTECODE=1
export PYTHONPYCACHEPREFIX="$GT4_ROOT/.local/cache/pycache"
export PYTHONPATH="$GT4_ROOT/tools/frida-matched${PYTHONPATH:+:$PYTHONPATH}"
export JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=$TMPDIR -Duser.home=$GT4_ROOT/.local/home"
export OHOS_SDK="$GT4_ROOT/tools/ohos-sdk/9"
export NODE16="$GT4_ROOT/tools/node-v16.20.2-darwin-arm64/bin/node"
if [ -z "${GT4_IPHONE_HOST:-}" ] && [ -f "$GT4_ROOT/.local/iphone.env" ]; then
  source "$GT4_ROOT/.local/iphone.env"
fi
export GT4_IPHONE_HOST="${GT4_IPHONE_HOST:-}"
mkdir -p "$TMPDIR" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" \
  "$GT4_ROOT/tools" "$GT4_ROOT/artifacts" "$GT4_ROOT/app" "$GT4_ROOT/.local/logs" "$GT4_ROOT/.local/ssh"
