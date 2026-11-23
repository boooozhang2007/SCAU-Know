#!/usr/bin/env node
/**
 * 重抓「下载失败」的附件（error 字段存在）。
 * 直连失败时 attachments.ts 会自动经由 IPv6 出口机代理重试
 * （ATTACHMENT_PROXY_URL，默认 http://127.0.0.1:13128）。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { downloadAndParseAttachments } from "../src/lib/crawl/attachments";

const ROOT = process.cwd();
const NOTICES_PATH = path.join(ROOT, "data", "notices.json");

const notices = JSON.parse(await fs.readFile(NOTICES_PATH, "utf8"));
let fixed = 0;
let stillFailed = 0;

for (const notice of notices) {
  const failed = (notice.attachments || []).filter((a) => a && a.error);
  if (!failed.length) continue;
  console.log(`\n[${notice.id}] ${notice.title?.slice(0, 40)} — ${failed.length} 个失败附件`);
  const items = failed.map((a) => ({ name: a.name, url: a.url, embedded: a.embedded }));
  const results = await downloadAndParseAttachments(items, notice.url);
  for (const res of results) {
    const idx = notice.attachments.findIndex((a) => a.url === res.url);
    if (idx === -1) continue;
    if (res.error) {
      stillFailed++;
      console.log(`  ✗ ${res.name} — ${res.error}`);
    } else {
      fixed++;
      notice.attachments[idx] = res;
      console.log(`  ✓ ${res.name} (${res.size} B, text=${res.parsedText?.length ?? 0})`);
    }
  }
}

await fs.writeFile(NOTICES_PATH, JSON.stringify(notices, null, 2), "utf8");
console.log(`\n完成：修复 ${fixed}，仍失败 ${stillFailed}`);
