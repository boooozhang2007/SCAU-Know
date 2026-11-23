#!/usr/bin/env node
/**
 * 把 远端出口机代取的附件（data/attachment-remote.json + data/attachments/<sha16>_<name>）
 * 解析并回填进 data/notices.json。
 *
 * 背景：广州机不允许跑代理/隧道（腾讯云 AUP），而 webplus.scau.edu.cn 只通 IPv6；
 * 因此由 远端出口机的定时任务抓取文件、推回本机，本脚本只做本地解析与写回，零网络。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseAttachmentFile } from "../src/lib/crawl/attachments";

const ROOT = process.cwd();
const NOTICES_PATH = path.join(ROOT, "data", "notices.json");
const REMOTE_PATH = path.join(ROOT, "data", "attachment-remote.json");

let remote = [];
try {
  remote = JSON.parse(await fs.readFile(REMOTE_PATH, "utf8"));
} catch {
  console.log("没有待回填的远端附件（data/attachment-remote.json 不存在）");
  process.exit(0);
}
if (!Array.isArray(remote) || remote.length === 0) {
  console.log("远端附件队列为空");
  process.exit(0);
}

const notices = JSON.parse(await fs.readFile(NOTICES_PATH, "utf8"));
let fixed = 0;
const done = new Set();

for (const item of remote) {
  const target = notices.find((n) => (n.attachments || []).some((a) => a?.url === item.url));
  if (!target) {
    console.warn(`跳过（notices 里找不到该附件）: ${item.name}`);
    done.add(item.url);
    continue;
  }
  const idx = target.attachments.findIndex((a) => a?.url === item.url);
  if (idx === -1) {
    done.add(item.url);
    continue;
  }
  try {
    await fs.access(item.localPath);
    const parsed = await parseAttachmentFile(item.localPath, item.name, item.url);
    const base = {
      id: target.attachments[idx].id,
      name: parsed.safeName,
      ext: parsed.ext,
      url: item.url,
      localPath: item.localPath,
      size: parsed.size,
      sha256: item.sha256,
      ...(target.attachments[idx].embedded ? { embedded: true } : {}),
      ...(parsed.sheets?.length ? { sheets: parsed.sheets } : {}),
      ...(parsed.parsedText ? { parsedText: parsed.parsedText } : {}),
      ...(parsed.archiveFiles?.length ? { archiveFiles: parsed.archiveFiles } : {}),
      ...(parsed.needsOcr ? { needsOcr: true } : {}),
    };
    target.attachments[idx] = base;
    fixed += 1;
    done.add(item.url);
    console.log(`✓ ${parsed.ext.toUpperCase()} ${parsed.safeName} (${parsed.size} B, text=${parsed.parsedText?.length ?? 0})`);
  } catch (e) {
    console.warn(`✗ 解析失败 ${item.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

await fs.writeFile(NOTICES_PATH, JSON.stringify(notices, null, 2), "utf8");
const remain = remote.filter((r) => !done.has(r.url));
await fs.writeFile(REMOTE_PATH, JSON.stringify(remain, null, 2), "utf8");
console.log(`回填完成：${fixed} 个，剩余 ${remain.length} 个留待下轮`);
