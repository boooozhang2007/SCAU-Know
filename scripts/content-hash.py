#!/usr/bin/env python3
"""对 notices.json 算「内容哈希」：剔除每轮都会变的时间戳字段。

用途：pipeline.sh 用它判断"数据有没有真的变"。
直接 md5 整个文件没用——每轮 crawl 都会刷新 fetchedAt / isNew，文件必变，
于是每轮都触发一次全量构建 + 对象存储同步（实测每 30 分钟重传几百个对象）。

用法: content-hash.py [path]    输出 32 位 hex
"""
import hashlib
import json
import os
import sys

VOLATILE = {"fetchedAt", "isNew"}

P = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.environ.get("NOTICES_PATH", os.path.join("data", "notices.json"))
)

try:
    with open(P, encoding="utf-8") as f:
        data = json.load(f)
except (OSError, ValueError):
    print("missing")
    sys.exit(0)


def scrub(item):
    if not isinstance(item, dict):
        return item
    return {k: v for k, v in item.items() if k not in VOLATILE}


payload = json.dumps([scrub(n) for n in data], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
print(hashlib.md5(payload.encode("utf-8")).hexdigest())
