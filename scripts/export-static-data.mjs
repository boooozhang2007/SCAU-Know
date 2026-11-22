#!/usr/bin/env node
/**
 * 导出静态分片 JSON 数据到 `public/static-data/`，供 CDN 与静态构建使用。
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
  const { exportStaticDataSnapshot } = await import(
    pathToFileURL(path.join(process.cwd(), "src", "lib", "export-static.ts")).href
  );
  const res = await exportStaticDataSnapshot();
  console.log(
    `已导出 ${res.total} 条通知到 ${res.filesWritten.length} 个静态数据文件 (${res.exportedAt})`,
  );
}

main().catch((e) => {
  console.error("导出失败：", e);
  process.exit(1);
});
