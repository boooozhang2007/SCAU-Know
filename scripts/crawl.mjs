#!/usr/bin/env node
/**
 * 抓取命令行。
 *
 * 用法：
 *   node scripts/crawl.mjs                 # 全量抓取（含正文）
 *   node scripts/crawl.mjs --no-detail     # 只抓列表，快
 *   node scripts/crawl.mjs --no-attachments # 跳过附件下载与解析
 *   node scripts/crawl.mjs --no-images     # 跳过图片本地镜像
 *   node scripts/crawl.mjs --no-wechat     # 跳过微信公众号抓取
 *   node scripts/crawl.mjs --no-enrich     # 跳过 AI / 规则结构化抽取
 *   node scripts/crawl.mjs --no-alerts     # 跳过监控提醒触发
 *   node scripts/crawl.mjs --only nxy,zb   # 只抓指定站点
 *   node scripts/crawl.mjs --limit 10      # 每站 10 条
 *   node scripts/crawl.mjs --list          # 列出所有源
 *
 * 定时运行（Linux crontab，每 2 小时）：
 *   0 *&#47;2 * * * cd /srv/bauhinia-know && node scripts/crawl.mjs >> logs/crawl.log 2>&1
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";

// 直接调用 TS 源码：用 Next 自带的 SWC 编译过于笨重，
// 这里改用 tsx 风格的手写加载（若环境有 tsx 则优先使用）。
import fs from "node:fs";
import path from "node:path";

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
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  const val = (f, d) => {
    const i = args.indexOf(f);
    return i >= 0 && args[i + 1] ? args[i + 1] : d;
  };

  if (has("--list")) {
    const { CRAWL_SOURCES } = await import("../src/lib/crawl/sources.ts");
    console.log(`共 ${CRAWL_SOURCES.length} 个源：\n`);
    for (const s of CRAWL_SOURCES) {
      console.log(
        `${s.id.padEnd(12)} ${s.kind.padEnd(11)} ${s.template.padEnd(8)} ${s.name}`,
      );
    }
    return;
  }

  const { runFullCrawl } = await import("../src/lib/crawl/runner.ts");
  const only = val("--only", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const result = await runFullCrawl({
    only: only.length ? only : undefined,
    limitPerSource: Number(val("--limit", "20")),
    fetchDetail: !has("--no-detail"),
    parseAttachments: has("--no-attachments") ? false : undefined,
    mirrorImages: has("--no-images") ? false : undefined,
    includeWechat: has("--no-wechat") ? false : undefined,
    runEnrich: has("--no-enrich") ? false : undefined,
    runAlerts: has("--no-alerts") ? false : undefined,
    concurrency: Number(val("--concurrency", "3")),
    onProgress: (m) => console.log(m),
  });

  const failed = result.report.sources.filter((s) => !s.ok);
  console.log(`\n新增 ${result.added} 条，库内 ${result.total} 条`);
  if (failed.length) {
    console.log(`\n失败 ${failed.length} 个源：`);
    for (const f of failed) console.log(`  ${f.name}: ${f.error}`);
  }
}

main().catch((e) => {
  console.error("抓取失败：", e);
  process.exit(1);
});
