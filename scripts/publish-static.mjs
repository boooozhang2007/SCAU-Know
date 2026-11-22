#!/usr/bin/env node
/**
 * 导出静态数据快照并触发 Cloudflare Pages / Vercel / GitHub Actions 部署钩子。
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
  const { exportStaticDataSnapshot, triggerStaticDeployHooks } = await import(
    pathToFileURL(path.join(process.cwd(), "src", "lib", "export-static.ts")).href
  );
  const summary = await exportStaticDataSnapshot();
  const hooks = await triggerStaticDeployHooks();
  console.log("导出静态快照完成：", summary.total, "条");
  console.log("触发 Deploy Hooks：", JSON.stringify(hooks));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
