#!/bin/sh
# Explicit setup; never invoked by npm's dependency lifecycle.
set -eu
if [ "$(uname -s)" != Darwin ]; then
  echo '当前自动准备脚本仅支持 macOS。' >&2
  exit 1
fi
RCM_BOOTSTRAP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$RCM_BOOTSTRAP_ROOT"
RCM_BREW=$(command -v brew || true)
if [ -z "$RCM_BREW" ] && [ -x /opt/homebrew/bin/brew ]; then RCM_BREW=/opt/homebrew/bin/brew; fi
if [ -z "$RCM_BREW" ] && [ -x /usr/local/bin/brew ]; then RCM_BREW=/usr/local/bin/brew; fi
require_brew() {
  if [ -z "$RCM_BREW" ]; then
    echo '缺少所需工具且没有 Homebrew。请从 https://brew.sh/ 安装 Homebrew，或自行安装 Node.js 22.12+、Python 3 和 age 后重试。' >&2
    exit 1
  fi
}
# Homebrew must not automatically remove old versions or cached files.
export HOMEBREW_NO_INSTALL_CLEANUP=1
if ! command -v node >/dev/null 2>&1 || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||a===22&&b>=12?0:1)'; then
  require_brew
  "$RCM_BREW" install node@24
  RCM_NODE_PREFIX=$("$RCM_BREW" --prefix node@24)
  PATH="$RCM_NODE_PREFIX/bin:$PATH"
  export PATH
fi
if ! command -v python3 >/dev/null 2>&1 || ! python3 --version >/dev/null 2>&1; then
  require_brew
  "$RCM_BREW" install python3
  RCM_BREW_PREFIX=$("$RCM_BREW" --prefix)
  PATH="$RCM_BREW_PREFIX/bin:$PATH"
  export PATH
fi
if ! command -v age >/dev/null 2>&1 || ! command -v age-keygen >/dev/null 2>&1; then
  require_brew
  "$RCM_BREW" install age
  RCM_BREW_PREFIX=$("$RCM_BREW" --prefix)
  PATH="$RCM_BREW_PREFIX/bin:$PATH"
  export PATH
fi
# Diagnose before downloading project dependencies. Codex and browser onboarding
# belong to the user; do not modify their installations or authentication.
node scripts/configure.mjs doctor "$@"
if [ -d node_modules ]; then
  echo '保留已有依赖目录并检查版本；不自动清空目录。'
  npm run typecheck
else
  npm ci --ignore-scripts --no-audit --no-fund
fi
node scripts/configure.mjs init "$@"
npm test
exec npm run deploy -- --ref HEAD
