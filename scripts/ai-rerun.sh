#!/bin/bash
# 全量 AI 结构化重跑：分批推进，每批落盘，直到没有缺失 ai 的条目。
# 可用 APP_DIR / ENV_FILE / AI_LOG / BATCH / MAXROUND 覆盖默认值
set -uo pipefail
APP_DIR=${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}
export PATH=${NODE_BIN_DIR:+$NODE_BIN_DIR:}/usr/local/bin:/usr/bin:/bin
export AI_DISABLE_THINKING=1
export NODE_OPTIONS=--max-old-space-size=512
cd "$APP_DIR" || exit 1
ENV_FILE=${ENV_FILE:-$APP_DIR/.env.local}
LOG=${AI_LOG:-$APP_DIR/data/ai-rerun.log}
mkdir -p "$(dirname "$LOG")"
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

BATCH=${BATCH:-25}
MAXROUND=${MAXROUND:-60}

log "=== start batch=$BATCH model=$(grep -o 'AI_MODEL=.*' "$ENV_FILE" 2>/dev/null | cut -d= -f2) ==="
for i in $(seq 1 "$MAXROUND"); do
  STATE=$(python3 scripts/ai-count.py)
  log "round $i $STATE"
  LEFT=$(echo "$STATE" | sed -E 's/.*missing=([0-9]+).*/\1/')
  [ "$LEFT" -eq 0 ] && break
  ./node_modules/.bin/tsx --tsconfig tsconfig.json scripts/enrich-ai.mjs --limit "$BATCH" >>"$LOG" 2>&1
  RC=$?
  [ $RC -ne 0 ] && log "enrich rc=$RC"
done
log "=== done $(python3 scripts/ai-count.py) ==="
