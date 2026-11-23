#!/usr/bin/env python3
"""把 out/ 增量同步到 S3 兼容对象存储（默认 Cloudflare R2），作为站点源站。

凭据（环境变量可覆盖路径）：
  R2_CRED   默认 <project>/.r2.json，内容 {"endpoint": "...", "access_key": "...", "secret_key": "..."}
  R2_STATE  默认 <project>/data/r2-state.json，内容 {key: [size, md5hex]}，用于增量判断
  R2_OUT    默认 <project>/out
  R2_BUCKET 目标桶名（必填，或写在 .r2.json 的 "bucket" 字段里）

注意：R2 自定义域没有 index 文档，所以每个含 index.html 的目录要额外放一条
      key 为 "<dir>/" 的对象（Content-Type 显式 text/html），否则 /foo 会 404。

--seed      用远端 listing 初始化状态（首次切换源站时用，避免全量重传）
--prune     删除远端多余对象（谨慎，默认关）
--dry       只打印将要做的事

用法：R2_BUCKET=your-bucket python3 r2_deploy.py [--seed] [--prune] [--dry]
"""
import argparse
import hashlib
import json
import mimetypes
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

PROJECT = os.environ.get("APP_DIR") or os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("R2_OUT") or os.path.join(PROJECT, "out")
CRED = os.environ.get("R2_CRED") or os.path.join(PROJECT, ".r2.json")
STATE = os.environ.get("R2_STATE") or os.path.join(PROJECT, "data", "r2-state.json")
DEFAULT_BUCKET = ""

EXTRA = {
    '.webmanifest': 'application/manifest+json',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
}
IMMUTABLE_PREFIX = ('media/', '_next/static/')
SHORT = 'public, max-age=60, s-maxage=900, stale-while-revalidate=86400, stale-if-error=86400'
IMMUTABLE = 'public, max-age=31536000, immutable'


def ctype(key):
    if key.endswith('/'):
        return 'text/html; charset=utf-8'
    ext = os.path.splitext(key)[1].lower()
    if ext in EXTRA:
        return EXTRA[ext]
    if key.endswith('_headers'):
        return 'text/plain; charset=utf-8'
    return mimetypes.guess_type(key)[0] or 'application/octet-stream'


def cache(key):
    return IMMUTABLE if key.startswith(IMMUTABLE_PREFIX) else SHORT


def local_map():
    m = {}
    for root, _dirs, files in os.walk(OUT):
        for f in files:
            p = os.path.join(root, f)
            rel = os.path.relpath(p, OUT)
            with open(p, 'rb') as fh:
                data = fh.read()
            m[rel] = (len(data), hashlib.md5(data).hexdigest())
            if f == 'index.html':
                d = os.path.dirname(rel)
                if d:
                    m[d + '/'] = (len(data), hashlib.md5(data).hexdigest())
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', action='store_true')
    ap.add_argument('--prune', action='store_true')
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--workers', type=int, default=8)
    a = ap.parse_args()

    import boto3
    c = json.load(open(CRED))
    bucket = os.environ.get('R2_BUCKET') or c.get('bucket') or DEFAULT_BUCKET
    if not bucket:
        sys.exit('缺少目标桶：请设 R2_BUCKET，或在 R2_CRED 指向的 JSON 里加 "bucket" 字段')
    kw = {'aws_access_key_id': c['access_key'], 'aws_secret_access_key': c['secret_key']}
    s3 = boto3.client('s3', endpoint_url=c['endpoint'], region_name='auto', **kw)

    loc = local_map()
    print(f'local: {len(loc)} keys, {sum(v[0] for v in loc.values())/1e6:.0f} MB', flush=True)

    state = {}
    if a.seed:
        tok = None
        n = 0
        while True:
            kwl = {'Bucket': bucket, 'MaxKeys': 1000}
            if tok:
                kwl['ContinuationToken'] = tok
            r = s3.list_objects_v2(**kwl)
            for o in r.get('Contents', []):
                state[o['Key']] = [o['Size'], o['ETag'].strip('"')]
                n += 1
            if not r.get('IsTruncated'):
                break
            tok = r.get('NextContinuationToken')
        print(f'seeded from remote: {n} keys', flush=True)
    elif os.path.exists(STATE):
        state = json.load(open(STATE))
        print(f'state: {len(state)} keys', flush=True)

    changed = [k for k, v in loc.items() if state.get(k) != list(v)]
    print(f'to upload: {len(changed)}', flush=True)
    if a.dry or not changed:
        for k in changed[:20]:
            print('  ', k)
        return 0

    fails = []
    t0 = time.time()

    def put(key):
        p = os.path.join(OUT, key) if not key.endswith('/') else os.path.join(OUT, key[:-1], 'index.html')
        try:
            with open(p, 'rb') as fh:
                body = fh.read()
            s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType=ctype(key), CacheControl=cache(key))
        except Exception as e:  # noqa: BLE001
            fails.append((key, str(e)[:100]))

    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        list(ex.map(put, changed))
    for k in changed:
        if not any(f[0] == k for f in fails):
            state[k] = list(loc[k])

    if a.prune:
        extra = [k for k in state if k not in loc]
        print(f'prune: {len(extra)} remote-only keys', flush=True)
        for k in extra[:5000]:
            try:
                s3.delete_object(Bucket=bucket, Key=k)
                state.pop(k, None)
            except Exception as e:  # noqa: BLE001
                print('del fail', k, str(e)[:80])

    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(state, open(STATE, 'w'))
    print(json.dumps({'uploaded': len(changed) - len(fails), 'failed': len(fails),
                      'seconds': round(time.time() - t0, 1),
                      'fail_sample': fails[:5]}, ensure_ascii=False))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
