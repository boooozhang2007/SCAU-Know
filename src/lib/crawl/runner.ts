/**
 * 抓取调度器：把「校内站点 + 微信公众号(we-mp-rss/RSS) → 合并入库 → AI 结构化抽取 → 规则+AI 提醒 → 可选静态发布」串起来。
 */

import { CRAWL_SOURCES, enabledSources, type CrawlSource } from "./sources";
import { runCrawl, type CrawlReport, type CrawledNotice } from "./engine";
import { wechatMode, crawlWechatRss, crawlWechatWemp } from "./wechat";
import { mergeNotices, readNotices, writeNotices, readState, writeState, saveReport } from "./store";
import { enrichNotice } from "@/lib/ai/enrich";
import { evaluateAndNotify } from "@/lib/monitor/notifier";
import { exportStaticDataSnapshot, triggerStaticDeployHooks } from "@/lib/export-static";

export interface RunOptions {
  /** 只抓指定来源 id */
  only?: string[];
  /** 每站点条目上限 */
  limitPerSource?: number;
  /** 是否抓正文 */
  fetchDetail?: boolean;
  /** 是否下载并解析附件 */
  parseAttachments?: boolean;
  /** 是否镜像图片 */
  mirrorImages?: boolean;
  /** 并发站点数 */
  concurrency?: number;
  /** 是否包含微信侧 */
  includeWechat?: boolean;
  /** 是否对新增条目做 AI/规则结构化解析与通知判定 */
  runEnrich?: boolean;
  /** 是否对新增条目运行监控提醒引擎 */
  runAlerts?: boolean;
  /** 进度回调 */
  onProgress?: (msg: string) => void;
}

export interface RunResult {
  report: CrawlReport;
  added: number;
  total: number;
  wechat: { mode: string; count: number; errors: { account: string; error: string }[] };
  notify: { evaluated: number; triggered: number; delivered: number };
}

function selectSources(only?: string[]): CrawlSource[] {
  const all = enabledSources();
  if (!only?.length) return all;
  const set = new Set(only);
  return all.filter((s) => set.has(s.id));
}

export async function runFullCrawl(opts: RunOptions = {}): Promise<RunResult> {
  const sources = selectSources(opts.only);
  const sourceMap = new Map(CRAWL_SOURCES.map((s) => [s.id, s]));
  const log = opts.onProgress ?? (() => {});

  let siteNotices: CrawledNotice[] = [];
  let report: CrawlReport = {
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    sources: [],
    added: 0,
    total: 0,
  };
  let seen: string[] = [];

  if (sources.length > 0 && opts.only?.[0] !== "__wechat_only__") {
    log(`开始抓取 ${sources.length} 个站点`);
    const siteRes = await runCrawl({
      sources,
      limitPerSource: opts.limitPerSource ?? 20,
      fetchDetail: opts.fetchDetail ?? true,
      parseAttachments: opts.parseAttachments ?? opts.fetchDetail ?? true,
      mirrorImages: opts.mirrorImages ?? opts.fetchDetail ?? true,
      concurrency: opts.concurrency ?? 3,
      onProgress: (r, i, total) => {
        log(
          `[${i + 1}/${total}] ${r.name} — ${r.ok ? `${r.listed} 条列表 / ${r.added} 条入库` : `失败：${r.error}`} (${r.durationMs}ms)`,
        );
      },
    });
    siteNotices = siteRes.notices;
    report = siteRes.report;
    seen = siteRes.seen;
  }

  let wechat: RunResult["wechat"] = { mode: wechatMode(), count: 0, errors: [] };
  const allNotices: CrawledNotice[] = [...siteNotices];

  if (opts.includeWechat !== false) {
    const mode = wechatMode();
    if (mode === "wemp") {
      log("抓取微信公众号（we-mp-rss 模式）");
      try {
        const wx = await crawlWechatWemp(sourceMap, {
          limit: 60,
          mirrorImages: opts.mirrorImages ?? true,
          parseAttachments: opts.parseAttachments ?? true,
        });
        allNotices.push(...wx.notices);
        wechat = { mode, count: wx.notices.length, errors: wx.errors };
        log(
          `微信侧(wemp)：已接入 ${wx.mpCount} 个公众号，拉取 ${wx.notices.length} 条，异常 ${wx.errors.length} 项`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        wechat = { mode, count: 0, errors: [{ account: "we-mp-rss", error: msg }] };
        log(`微信侧(wemp)失败：${msg}`);
      }
    } else if (mode === "rss") {
      log("抓取微信公众号（RSS 模式）");
      const wx = await crawlWechatRss(sourceMap);
      allNotices.push(...wx.notices);
      wechat = { mode, count: wx.notices.length, errors: wx.errors };
      log(`微信侧：${wx.notices.length} 条，失败 ${wx.errors.length} 个账号`);
    } else {
      log(`微信侧模式为 ${mode}，跳过自动抓取（等待导入）`);
    }
  }

  const { total, added, newItems } = await mergeNotices(allNotices);

  // 对新增条目做 AI/规则结构化抽取并持久化
  if (opts.runEnrich !== false && newItems.length > 0) {
    log(`正在对 ${newItems.length} 条新增通知执行结构化解析...`);
    const allStored = await readNotices();
    const byId = new Map(allStored.map((x) => [x.id, x]));
    for (const item of newItems) {
      const meta = await enrichNotice(item);
      item.ai = meta;
      const target = byId.get(item.id);
      if (target) target.ai = meta;
    }
    await writeNotices(allStored);
  }

  // 对新增条目触发精准监控提醒
  let notify = { evaluated: 0, triggered: 0, delivered: 0 };
  if (opts.runAlerts !== false && newItems.length > 0) {
    notify = await evaluateAndNotify(newItems);
    if (notify.triggered > 0) {
      log(`监控提醒：命中 ${notify.triggered} 次，成功发送 ${notify.delivered} 条`);
    }
  }

  // 更新增量游标与报告
  const state = await readState();
  const seenSet = new Set(state.seen);
  for (const u of seen) seenSet.add(u);
  const lastRun = { ...state.lastRun };
  for (const r of report.sources) {
    if (r.ok) lastRun[r.id] = new Date().toISOString();
  }
  await writeState({
    seen: [...seenSet].slice(-20000),
    lastRun,
    lastReport: {
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      durationMs: report.durationMs,
      added,
      total,
    },
  });

  const finalReport: CrawlReport = { ...report, added, total };
  await saveReport(finalReport);

  if (added > 0 && process.env.AUTO_EXPORT_STATIC === "true") {
    log("检测到新增数据，正在导出静态快照并触发 CI/CD Deploy Hook...");
    await exportStaticDataSnapshot();
    await triggerStaticDeployHooks();
  }

  log(`完成：新增 ${added} 条，库内共 ${total} 条，耗时 ${report.durationMs}ms`);

  return { report: finalReport, added, total, wechat, notify };
}
