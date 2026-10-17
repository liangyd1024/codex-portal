#!/bin/bash
set -e
cd "$(dirname "$0")/.."
if command -v node >/dev/null 2>&1; then
  exec node scripts/install-local.mjs
fi
RCM_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [ -x "$RCM_NODE" ]; then
  exec "$RCM_NODE" scripts/install-local.mjs
fi
printf '需要 Node.js 22 或更新版本。\n'
exit 1
