#!/usr/bin/env node
/**
 * 批量补充 AI/规则结构化元数据脚本。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

async function main() {
  loadEnvLocal();
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1] || 50) : 50;
  const concArg = process.argv.indexOf("--concurrency");
  const concurrency = Math.max(1, concArg >= 0 ? Number(process.argv[concArg + 1] || 4) : 4);
  const { readNotices, writeNotices } = await import(
    pathToFileURL(path.join(process.cwd(), "src", "lib", "crawl", "store.ts")).href
  );
  const { enrichNotice, isAiConfigured } = await import(
    pathToFileURL(path.join(process.cwd(), "src", "lib", "ai", "enrich.ts")).href
  );

  const list = await readNotices();
  const pending = list.filter((n) => !n.ai).slice(0, limit);
  let updated = 0;
  // 并发 4 路：每条都是一次长等待的网络调用，串行会把一批 25 条拖到 5–8 分钟
  for (let i = 0; i < pending.length; i += concurrency) {
    const chunk = pending.slice(i, i + concurrency);
    const metas = await Promise.all(chunk.map((n) => enrichNotice(n).catch(() => null)));
    chunk.forEach((n, j) => {
      const meta = metas[j];
      if (!meta) return;
      n.ai = meta;
      updated++;
    });
  }
  if (updated > 0) await writeNotices(list);
  console.log(
    `结构化解析完成：更新 ${updated} / ${list.length} 条（模式：${isAiConfigured() ? "AI大模型" : "规则引擎"}）`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
