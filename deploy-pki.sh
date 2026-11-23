#!/bin/bash
# 仅重新构建并部署到 Cloudflare Pages（兜底通道），不跑采集
# 可用 APP_DIR / PAGES_PROJECT / NODE_BIN_DIR 覆盖默认值
set -uo pipefail
APP_DIR=${APP_DIR:-$(cd "$(dirname "$0")" && pwd)}
export PATH=${NODE_BIN_DIR:+$NODE_BIN_DIR:}/usr/local/bin:/usr/bin:/bin
export NODE_OPTIONS=--max-old-space-size=1024
cd "$APP_DIR" || exit 1
L=${DEPLOY_LOG:-$APP_DIR/data/deploy-pages.log}
mkdir -p "$(dirname "$L")"
node scripts/build-static.mjs >>"$L" 2>&1 || { echo "[$(date +%T)] build FAIL" >>"$L"; exit 1; }
set -a; . "$APP_DIR/.cf-deploy.env"; set +a
wrangler pages deploy out --project-name="${PAGES_PROJECT:-scau-know}" --branch=main --commit-dirty=true >>"$L" 2>&1
echo "[$(date +%T)] deploy rc=$?" >>"$L"
