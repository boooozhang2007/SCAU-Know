#!/usr/bin/env python3
"""统计 notices.json 的 ai 覆盖情况。

用法: ai-count.py [path]（默认 $NOTICES_PATH 或 ./data/notices.json）
输出: total=N missing=N ai=N rules=N
"""
import json
import os
import sys

P = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.environ.get("NOTICES_PATH", os.path.join("data", "notices.json"))
)
d = json.load(open(P, encoding="utf-8"))
total = len(d)
none = sum(1 for n in d if not n.get("ai"))
ai = sum(1 for n in d if (n.get("ai") or {}).get("enrichedBy") == "ai")
rules = sum(1 for n in d if (n.get("ai") or {}).get("enrichedBy") == "rules")
print(f"total={total} missing={none} ai={ai} rules={rules}")
