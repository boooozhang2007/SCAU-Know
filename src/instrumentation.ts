/**
 * Next.js 服务启动钩子：
 * 在 Node.js 运行时（排除静态编译与构建阶段）自动启动内置定时抓取调度器。
 */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.STATIC_EXPORT !== "1" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { ensureSchedulerStarted } = await import("@/lib/crawl/scheduler");
    const status = await ensureSchedulerStarted();
    console.log(
      `[scau-know] 定时抓取调度器已就绪：enabled=${status.config.enabled}，抓取周期=${status.config.intervalMinutes}分钟，前端同步=${status.config.frontendSyncSeconds}秒，下次抓取=${status.nextRunAt ?? "已暂停"}`,
    );
  }
}
