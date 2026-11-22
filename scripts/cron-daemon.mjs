#!/usr/bin/env node
/**
 * 独立定时抓取守护进程（适合与纯静态前端分离开部署的后台服务器）：
 *   pnpm daemon
 * 或配合 PM2 / systemd / Windows 任务计划常驻运行，按 data/schedule.json 配置周期定时抓站与同步公众号。
 */

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
  const { ensureSchedulerStarted, stopScheduler } = await import(
    "../src/lib/crawl/scheduler.ts"
  );

  const status = await ensureSchedulerStarted();
  console.log(
    `[daemon] 华农知道独立定时调度器已启动：enabled=${status.config.enabled}，周期=${status.config.intervalMinutes}分钟，下次执行=${status.nextRunAt ?? "未启用"}`,
  );

  // 因 scheduler timer 默认 .unref()，这里用轻量心跳保持守护进程常驻并每分钟刷新调度检查
  const keepAlive = setInterval(() => {
    void ensureSchedulerStarted();
  }, 60_000);

  const shutdown = () => {
    clearInterval(keepAlive);
    stopScheduler();
    console.log("\n[daemon] 已安全停止定时调度器");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("守护进程启动失败：", e);
  process.exit(1);
});
