/**
 * 服务端定时抓取与前端自动同步周期调度器：
 *   - 持久化调度配置与最近运行历史到 `data/schedule.json`
 *   - 使用 `globalThis.__scauKnowScheduler` 单例防止多 chunk / HMR 重复注册定时器
 *   - 互斥锁防并发重叠抓取；修改配置后立即热重排下次执行时间
 *   - 支持新增通知时自动联动静态快照导出与 Deploy Hook
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { runFullCrawl, type RunResult } from "./runner";

const DATA_DIR = process.env.BAUHINIA_DATA_DIR
  ? path.resolve(process.env.BAUHINIA_DATA_DIR)
  : path.join(process.cwd(), "data");

const SCHEDULE_FILE = path.join(DATA_DIR, "schedule.json");

export interface ScheduleConfig {
  /** 是否启用定时抓取 */
  enabled: boolean;
  /** 抓取间隔（分钟，5 ~ 1440） */
  intervalMinutes: number;
  /** 每站点列表抓取上限（3 ~ 30） */
  limitPerSource: number;
  /** 是否包含微信公众号（we-mp-rss / RSS） */
  includeWechat: boolean;
  /** 新增通知是否自动执行 AI/规则结构化解析 */
  autoEnrich: boolean;
  /** 新增通知是否自动匹配提醒规则并推送 */
  autoAlerts: boolean;
  /** 新增通知后是否自动刷新静态快照及触发 CI/CD Deploy Hook */
  autoExportStatic: boolean;
  /** 前端自动无感同步检测周期（秒，0 表示关闭，否则 15 ~ 3600） */
  frontendSyncSeconds: number;
}

export interface ScheduleHistoryItem {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  trigger: "timer" | "manual";
  ok: boolean;
  added: number;
  total: number;
  wechatCount: number;
  error?: string;
}

export interface ScheduleStatus {
  config: ScheduleConfig;
  running: boolean;
  startedAt: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastTrigger: "timer" | "manual" | null;
  lastResult: ScheduleHistoryItem | null;
  history: ScheduleHistoryItem[];
}

interface PersistedSchedule {
  config: ScheduleConfig;
  lastRunAt: string | null;
  lastTrigger: "timer" | "manual" | null;
  lastResult: ScheduleHistoryItem | null;
  history: ScheduleHistoryItem[];
}

interface SchedulerRuntime {
  started: boolean;
  running: boolean;
  startedAt: string | null;
  nextRunAt: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  initPromise: Promise<void> | null;
}

declare global {
  var __scauKnowScheduler: SchedulerRuntime | undefined;
}

function getRuntime(): SchedulerRuntime {
  if (!globalThis.__scauKnowScheduler) {
    globalThis.__scauKnowScheduler = {
      started: false,
      running: false,
      startedAt: null,
      nextRunAt: null,
      timer: null,
      initPromise: null,
    };
  }
  return globalThis.__scauKnowScheduler;
}

function clampInt(val: unknown, fallback: number, min: number, max: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampSyncSec(val: unknown, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  const r = Math.round(n);
  if (r <= 0) return 0;
  return Math.min(3600, Math.max(15, r));
}

export function defaultScheduleConfig(): ScheduleConfig {
  return {
    enabled: process.env.AUTO_CRAWL_ENABLED !== "false",
    intervalMinutes: clampInt(process.env.AUTO_CRAWL_INTERVAL_MINUTES, 30, 5, 1440),
    limitPerSource: 10,
    includeWechat: true,
    autoEnrich: true,
    autoAlerts: true,
    autoExportStatic: true,
    frontendSyncSeconds: clampSyncSec(process.env.FRONTEND_SYNC_SECONDS, 60),
  };
}

function normalizeConfig(
  raw: Partial<ScheduleConfig> | undefined,
  base: ScheduleConfig,
): ScheduleConfig {
  return {
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : base.enabled,
    intervalMinutes: clampInt(
      raw?.intervalMinutes,
      base.intervalMinutes,
      5,
      1440,
    ),
    limitPerSource: clampInt(raw?.limitPerSource, base.limitPerSource, 3, 30),
    includeWechat:
      typeof raw?.includeWechat === "boolean" ? raw.includeWechat : base.includeWechat,
    autoEnrich: typeof raw?.autoEnrich === "boolean" ? raw.autoEnrich : base.autoEnrich,
    autoAlerts: typeof raw?.autoAlerts === "boolean" ? raw.autoAlerts : base.autoAlerts,
    autoExportStatic:
      typeof raw?.autoExportStatic === "boolean"
        ? raw.autoExportStatic
        : base.autoExportStatic,
    frontendSyncSeconds:
      raw?.frontendSyncSeconds !== undefined
        ? clampSyncSec(raw.frontendSyncSeconds, base.frontendSyncSeconds)
        : base.frontendSyncSeconds,
  };
}

async function readPersisted(): Promise<PersistedSchedule> {
  const def = defaultScheduleConfig();
  try {
    const raw = await fs.readFile(SCHEDULE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedSchedule>;
    return {
      config: normalizeConfig(parsed.config, def),
      lastRunAt: parsed.lastRunAt ?? null,
      lastTrigger: parsed.lastTrigger ?? null,
      lastResult: parsed.lastResult ?? null,
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, 20) : [],
    };
  } catch {
    return {
      config: def,
      lastRunAt: null,
      lastTrigger: null,
      lastResult: null,
      history: [],
    };
  }
}

async function writePersisted(data: PersistedSchedule): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${SCHEDULE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, SCHEDULE_FILE);
}

function clearRuntimeTimer(rt: SchedulerRuntime) {
  if (rt.timer) {
    clearTimeout(rt.timer);
    rt.timer = null;
  }
  rt.nextRunAt = null;
}

function isBuildTime(): boolean {
  return (
    process.env.STATIC_EXPORT === "1" ||
    process.env.NEXT_PHASE === "phase-production-build"
  );
}

function scheduleNextTick(data: PersistedSchedule, delayOverrideMs?: number) {
  const rt = getRuntime();
  clearRuntimeTimer(rt);

  if (isBuildTime() || !data.config.enabled || rt.running) {
    return;
  }

  const intervalMs = data.config.intervalMinutes * 60 * 1000;
  let delayMs = delayOverrideMs ?? intervalMs;

  if (delayOverrideMs === undefined && data.lastRunAt) {
    const lastMs = new Date(data.lastRunAt).getTime();
    if (!Number.isNaN(lastMs)) {
      const remaining = lastMs + intervalMs - Date.now();
      delayMs = remaining > 20_000 ? remaining : 20_000;
    }
  }

  delayMs = Math.max(15_000, delayMs);
  rt.nextRunAt = new Date(Date.now() + delayMs).toISOString();
  rt.timer = setTimeout(() => {
    void runLockedCrawl("timer").catch((e) => {
      console.error("[scheduler] 定时抓取异常:", e);
    });
  }, delayMs);
  // 防止定时器阻塞 Node 进程退出或构建收尾
  rt.timer.unref?.();
}

export async function ensureSchedulerStarted(): Promise<ScheduleStatus> {
  const rt = getRuntime();
  if (isBuildTime()) {
    const persisted = await readPersisted();
    return { ...persisted, running: false, startedAt: null, nextRunAt: null };
  }

  if (!rt.started) {
    if (!rt.initPromise) {
      rt.initPromise = (async () => {
        const persisted = await readPersisted();
        // 首次启动落盘默认配置，方便查看与外部工具读取
        try {
          await fs.access(SCHEDULE_FILE);
        } catch {
          await writePersisted(persisted);
        }
        rt.started = true;
        scheduleNextTick(persisted);
      })().finally(() => {
        rt.initPromise = null;
      });
    }
    await rt.initPromise;
  }

  return getScheduleStatus();
}

export async function getScheduleStatus(): Promise<ScheduleStatus> {
  const rt = getRuntime();
  const persisted = await readPersisted();
  return {
    config: persisted.config,
    running: rt.running,
    startedAt: rt.startedAt,
    lastRunAt: persisted.lastRunAt,
    nextRunAt: persisted.config.enabled ? rt.nextRunAt : null,
    lastTrigger: persisted.lastTrigger,
    lastResult: persisted.lastResult,
    history: persisted.history,
  };
}

export async function updateScheduleConfig(
  patch: Partial<ScheduleConfig>,
): Promise<ScheduleStatus> {
  const rt = getRuntime();
  const persisted = await readPersisted();
  const nextConfig = normalizeConfig(patch, persisted.config);
  const nextData: PersistedSchedule = { ...persisted, config: nextConfig };
  await writePersisted(nextData);

  rt.started = true;
  if (!nextConfig.enabled) {
    clearRuntimeTimer(rt);
  } else if (!rt.running) {
    // 热生效：按新周期直接重排下次抓取
    scheduleNextTick(nextData, nextConfig.intervalMinutes * 60 * 1000);
  }

  return getScheduleStatus();
}

export interface CrawlOverrides {
  only?: string[];
  limitPerSource?: number;
  fetchDetail?: boolean;
  concurrency?: number;
  includeWechat?: boolean;
}

export async function runLockedCrawl(
  trigger: "timer" | "manual",
  overrides?: CrawlOverrides,
): Promise<RunResult | null> {
  const rt = getRuntime();
  if (rt.running) {
    if (trigger === "timer") return null;
    const err = new Error("当前已有采集任务正在执行，请稍后再试") as Error & {
      code?: string;
    };
    err.code = "ALREADY_RUNNING";
    throw err;
  }

  const persisted = await readPersisted();
  clearRuntimeTimer(rt);
  rt.started = true;
  rt.running = true;
  const startedAt = new Date().toISOString();
  rt.startedAt = startedAt;
  const startMs = Date.now();

  let runResult: RunResult | null = null;
  let item: ScheduleHistoryItem | null = null;

  try {
    runResult = await runFullCrawl({
      only: overrides?.only,
      limitPerSource: overrides?.limitPerSource ?? persisted.config.limitPerSource,
      fetchDetail: overrides?.fetchDetail ?? true,
      concurrency: overrides?.concurrency ?? 3,
      includeWechat: overrides?.includeWechat ?? persisted.config.includeWechat,
      runEnrich: persisted.config.autoEnrich,
      runAlerts: persisted.config.autoAlerts,
      onProgress: (msg) => console.log(`[crawl:${trigger}] ${msg}`),
    });

    if (
      runResult.added > 0 &&
      persisted.config.autoExportStatic &&
      process.env.AUTO_EXPORT_STATIC !== "true"
    ) {
      const { exportStaticDataSnapshot, triggerStaticDeployHooks } = await import(
        "@/lib/export-static"
      );
      await exportStaticDataSnapshot();
      await triggerStaticDeployHooks();
    }

    const finishedAt = new Date().toISOString();
    item = {
      startedAt,
      finishedAt,
      durationMs: Date.now() - startMs,
      trigger,
      ok: true,
      added: runResult.added,
      total: runResult.total,
      wechatCount: runResult.wechat.count,
    };
  } catch (e) {
    const finishedAt = new Date().toISOString();
    item = {
      startedAt,
      finishedAt,
      durationMs: Date.now() - startMs,
      trigger,
      ok: false,
      added: 0,
      total: persisted.lastResult?.total ?? 0,
      wechatCount: 0,
      error: e instanceof Error ? e.message : String(e),
    };
    throw e;
  } finally {
    rt.running = false;
    rt.startedAt = null;
    if (item) {
      const latest = await readPersisted();
      const updated: PersistedSchedule = {
        ...latest,
        lastRunAt: item.finishedAt,
        lastTrigger: trigger,
        lastResult: item,
        history: [item, ...latest.history].slice(0, 20),
      };
      await writePersisted(updated);
      if (updated.config.enabled) {
        scheduleNextTick(updated, updated.config.intervalMinutes * 60 * 1000);
      }
    } else {
      const latest = await readPersisted();
      if (latest.config.enabled) {
        scheduleNextTick(latest, latest.config.intervalMinutes * 60 * 1000);
      }
    }
  }

  return runResult;
}

export function stopScheduler() {
  const rt = getRuntime();
  clearRuntimeTimer(rt);
  rt.started = false;
}
