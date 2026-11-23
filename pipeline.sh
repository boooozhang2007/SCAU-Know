#!/bin/bash
# 采集 → 静态构建 → 增量同步到对象存储（S3 兼容，默认 Cloudflare R2） → 清边缘缓存
#
# 全部路径与凭据位置可用环境变量覆盖，默认值只假设「脚本放在项目根目录」：
#   APP_DIR            项目目录（默认脚本所在目录）
#   NODE_BIN_DIR       放 node/tsx 的 bin 目录（可选）
#   PIPELINE_LOG       日志路径（默认 $APP_DIR/data/pipeline.log）
#   R2_OUT / R2_CRED / R2_STATE / R2_BUCKET   见 r2_deploy.py
#   CF_PURGE_SCRIPT    清 Cloudflare 缓存的脚本路径（留空则跳过）
#   FRP_DEPLOY=1 + FRP_DEPLOY_SCRIPT=   额外同步一份回滚副本
#   PAGES_DEPLOY=1 + PAGES_PROJECT=     兜底部署到 Cloudflare Pages
set -uo pipefail
# 单实例：定时器与手动/部署触发可能撞车，两个构建同时写 .next 会让 tsc 读到半截文件、报假类型错误
exec 9>/run/scau-pipeline.lock
if ! flock -n 9; then echo "[$(date '+%F %T')] 已有流水线在跑，跳过本次"; exit 0; fi
APP_DIR=${APP_DIR:-$(cd "$(dirname "$0")" && pwd)}
cd "$APP_DIR" || exit 1
export PATH=${NODE_BIN_DIR:+$NODE_BIN_DIR:}${PATH:-/usr/local/bin:/usr/bin:/bin}
LOG=${PIPELINE_LOG:-$APP_DIR/data/pipeline.log}
mkdir -p "$(dirname "$LOG")"
log(){ echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

BEFORE=$(md5sum data/notices.json 2>/dev/null | cut -d' ' -f1)

./node_modules/.bin/tsx --tsconfig tsconfig.json scripts/crawl.mjs --limit 10 --concurrency 2 >>"$LOG" 2>&1
RC=$?
if [ $RC -ne 0 ]; then log "crawl 退出码 $RC，终止"; exit $RC; fi

# 只有 IPv6 能到的站点由远端出口机代取，队列文件在这里解析入库；零网络
./node_modules/.bin/tsx --tsconfig tsconfig.json scripts/ingest-remote-attachments.mjs >>"$LOG" 2>&1 || log "远端附件回填失败（忽略，继续）"

AFTER=$(md5sum data/notices.json 2>/dev/null | cut -d' ' -f1)
if [ "$BEFORE" = "$AFTER" ]; then
  log "数据无变化，跳过构建与部署"
  exit 0
fi

log "数据有更新，开始静态构建"
node scripts/build-static.mjs >>"$LOG" 2>&1 || { log "构建失败"; exit 1; }

log "同步到对象存储（增量）"
if python3 r2_deploy.py >>"$LOG" 2>&1; then
  log "对象存储同步完成"
  # 源站已是对象存储，purge 后回源只多几十 ms，故部署后直接清一次页面缓存让内容立即生效
  if [ -n "${CF_PURGE_SCRIPT:-}" ] && [ -f "$APP_DIR/.cf-cache.env" ]; then
    if python3 "$CF_PURGE_SCRIPT" >>"$LOG" 2>&1; then
      log "Cloudflare 页面缓存已清理"
    else
      log "Cloudflare 缓存清理失败（不影响站点，等 TTL 自然过期）"
    fi
  fi
else
  log "对象存储同步失败，保留旧版本对外服务"; exit 1
fi

# 回滚副本：默认不推（上行带宽有限，全量要几分钟）
if [ "${FRP_DEPLOY:-0}" = "1" ] && [ -n "${FRP_DEPLOY_SCRIPT:-}" ]; then
  log "同步回滚副本"
  python3 "$FRP_DEPLOY_SCRIPT" >>"$LOG" 2>&1
  log "回滚副本同步完成 rc=$?"
fi

if [ "${PAGES_DEPLOY:-0}" = "1" ]; then
  set -a; . "$APP_DIR/.cf-deploy.env"; set +a
  log "部署到 Cloudflare Pages（兜底）"
  wrangler pages deploy out --project-name="${PAGES_PROJECT:-scau-know}" --branch=main --commit-dirty=true >>"$LOG" 2>&1
  log "Pages 部署完成 rc=$?"
fi
