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
  const { readNotices, writeNotices } = await import(
    pathToFileURL(path.join(process.cwd(), "src", "lib", "crawl", "store.ts")).href
  );
  const { enrichNotice, isAiConfigured } = await import(
    pathToFileURL(path.join(process.cwd(), "src", "lib", "ai", "enrich.ts")).href
  );

  const list = await readNotices();
  let updated = 0;
  for (const n of list) {
    if (updated >= limit) break;
    if (n.ai) continue;
    n.ai = await enrichNotice(n);
    updated++;
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
