#!/usr/bin/env python3
"""剥掉 data/notices.json 里的 ai 字段，用于全量重跑结构化抽取。

用法: ai-strip.py [all|rules|v1] [--apply]
  all    删掉所有 ai 字段
  rules  只删「规则引擎生成」的（enrichedBy != "ai"），保留真 AI 结果
  v1     删掉所有旧版（schemaVersion < 2 或非真 AI），便于升级重跑 v2 抽取
默认只打印统计，加 --apply 才写回（写前留 .bak-strip-<时间戳> 硬链接备份）。

路径可用 NOTICES_PATH 覆盖，默认 ./data/notices.json
"""
import json
import os
import sys
import time

P = os.environ.get("NOTICES_PATH", os.path.join("data", "notices.json"))
mode = sys.argv[1] if len(sys.argv) > 1 else "all"
apply = "--apply" in sys.argv

with open(P, encoding="utf-8") as f:
    data = json.load(f)

removed = 0
kept = 0
for n in data:
    a = n.get("ai")
    if not a:
        continue
    by = (a or {}).get("enrichedBy")
    ver = (a or {}).get("schemaVersion") or 1
    if (
        mode == "all"
        or (mode == "rules" and by != "ai")
        or (mode == "v1" and (by != "ai" or ver < 2))
    ):
        n.pop("ai", None)
        removed += 1
    else:
        kept += 1

print(f"mode={mode} total={len(data)} removed={removed} kept={kept} apply={apply}")
if apply and removed:
    bak = f"{P}.bak-strip-{time.strftime('%Y%m%d-%H%M%S')}"
    os.link(P, bak)
    tmp = P + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, P)
    print("written", P, "backup", bak)
