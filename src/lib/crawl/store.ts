/**
 * 抓取结果存储。
 *
 * 采用文件持久化（data/ 目录），零外部依赖，便于部署与备份：
 * - `data/notices.json`  归一化后的全部条目
 * - `data/state.json`    增量游标与运行记录
 * - `data/reports/`      每次抓取的报告
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { canonicalNoticeKey, type CrawledNotice, type CrawlReport } from "./engine";
import { isAttachmentOnlyText } from "./parse";

const DATA_DIR = process.env.BAUHINIA_DATA_DIR
  ? path.resolve(process.env.BAUHINIA_DATA_DIR)
  : path.join(process.cwd(), "data");

const NOTICES_FILE = path.join(DATA_DIR, "notices.json");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const REPORTS_DIR = path.join(DATA_DIR, "reports");

export interface StoreState {
  /** 已见 URL，用于增量 */
  seen: string[];
  /** 各站点最近一次成功抓取时间 */
  lastRun: Record<string, string>;
  /** 最近一次报告摘要 */
  lastReport?: Pick<
    CrawlReport,
    "startedAt" | "finishedAt" | "durationMs" | "added" | "total"
  >;
}

const EMPTY_STATE: StoreState = { seen: [], lastRun: {} };

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value), "utf8");
  await fs.rename(tmp, file);
}

export async function readNotices(): Promise<CrawledNotice[]> {
  return readJson<CrawledNotice[]>(NOTICES_FILE, []);
}

export async function writeNotices(notices: CrawledNotice[]): Promise<void> {
  const sorted = [...notices].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
  await writeJson(NOTICES_FILE, sorted);
}

export async function readState(): Promise<StoreState> {
  return readJson<StoreState>(STATE_FILE, EMPTY_STATE);
}

export async function writeState(state: StoreState): Promise<void> {
  await writeJson(STATE_FILE, state);
}

/** 合并字段：新抓条目更新或补齐封面/正文块/附件/AI 元数据 */
function mergeRecord(prev: CrawledNotice | undefined, next: CrawledNotice): CrawledNotice {
  if (!prev) return next;
  const newerTime = new Date(next.publishedAt) > new Date(prev.publishedAt);
  const prevParaEmptyOrAtt =
    !prev.paragraphs?.length || prev.paragraphs.every(isAttachmentOnlyText);
  const nextParaMeaningful =
    Boolean(next.paragraphs?.length) && !next.paragraphs.every(isAttachmentOnlyText);
  const prevTextLen = (prev.paragraphs ?? []).join("").length;
  const nextTextLen = (next.paragraphs ?? []).join("").length;

  const prevBlocksHasTable = Boolean(prev.blocks?.some((b) => b.type === "table"));
  const nextBlocksHasTable = Boolean(next.blocks?.some((b) => b.type === "table"));
  const upgradeToTable = nextBlocksHasTable && !prevBlocksHasTable;

  const useNextParas =
    upgradeToTable ||
    (prevParaEmptyOrAtt && nextParaMeaningful) ||
    (nextParaMeaningful && nextTextLen > prevTextLen * 1.2) ||
    (!prev.paragraphs?.length && Boolean(next.paragraphs?.length));

  const nextSummaryBetter =
    Boolean(next.summary) &&
    ((isAttachmentOnlyText(prev.summary ?? "") && !isAttachmentOnlyText(next.summary)) ||
      (!isAttachmentOnlyText(next.summary) &&
        next.summary.length > (prev.summary?.length ?? 0)));

  const useNextAtts =
    Boolean(next.attachments?.length) &&
    ((next.attachments?.length ?? 0) >= (prev.attachments?.length ?? 0) ||
      next.attachments!.some((a) => a.embedded && a.parsedText));

  const isBadOrRemoteImg = (u?: string) =>
    !u || /\/(?:undefined|null)(?:$|[?#])/i.test(u) || /^https?:\/\//i.test(u);
  const prevCoverBad = Boolean(prev.cover) && isBadOrRemoteImg(prev.cover);
  const nextHasLocalCover = Boolean(
    next.cover && (next.cover.startsWith("/api/media/") || next.cover.startsWith("/media/")),
  );
  const nextCoverValid = Boolean(next.cover) && !/\/(?:undefined|null)(?:$|[?#])/i.test(next.cover!);
  const mergedCover =
    nextHasLocalCover || (prevCoverBad && nextCoverValid)
      ? next.cover
      : prevCoverBad && !nextCoverValid
        ? undefined
        : prev.cover || next.cover;

  const prevBlocksBad = Boolean(
    prev.blocks?.some((b) => b.type === "image" && isBadOrRemoteImg(b.src)),
  );
  const mergedBlocks =
    (useNextParas && next.blocks?.length) ||
    (prevBlocksBad && next.blocks?.length) ||
    (next.blocks?.length && !prev.blocks?.length)
      ? next.blocks
      : prev.blocks;

  return {
    ...prev,
    ...(newerTime ? next : {}),
    cover: mergedCover,
    blocks: mergedBlocks,
    paragraphs: useNextParas ? next.paragraphs : prev.paragraphs,
    attachments: useNextAtts ? next.attachments : prev.attachments,
    ai: next.ai ?? prev.ai,
    summary: nextSummaryBetter ? next.summary : prev.summary,
    startsAt: next.startsAt ?? prev.startsAt,
    venue: next.venue ?? prev.venue,
    registration: next.registration || prev.registration,
    requiresAuth: next.requiresAuth ?? prev.requiresAuth,
    fetchedAt: next.fetchedAt || prev.fetchedAt,
  };
}

/**
 * 合并新抓取的条目。
 * 以 canonicalNoticeKey（微信公众号用 __biz+mid+idx，站点用规范化 URL）为唯一键，
 * 并返回本次真正新增或重要更新的条目列表供 AI 解析与规则提醒使用。
 */
export async function mergeNotices(
  incoming: CrawledNotice[],
): Promise<{ total: number; added: number; newItems: CrawledNotice[] }> {
  const existing = await readNotices();
  const map = new Map<string, CrawledNotice>();
  for (const n of existing) {
    map.set(canonicalNoticeKey(n.url), n);
  }

  let added = 0;
  const newItems: CrawledNotice[] = [];

  for (const n of incoming) {
    const key = canonicalNoticeKey(n.url);
    const prev = map.get(key);
    const merged = mergeRecord(prev, n);
    map.set(key, merged);
    if (!prev) {
      added++;
      newItems.push(merged);
    } else if (new Date(n.publishedAt) > new Date(prev.publishedAt)) {
      added++;
    }
  }

  const allMerged = [...map.values()].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
  await writeJson(NOTICES_FILE, allMerged);
  return { total: allMerged.length, added, newItems };
}

export async function saveReport(report: CrawlReport): Promise<void> {
  await ensureDir(REPORTS_DIR);
  const stamp = report.startedAt.replace(/[:.]/g, "-");
  await writeJson(path.join(REPORTS_DIR, `${stamp}.json`), report);
  const files = (await fs.readdir(REPORTS_DIR)).filter((f) => f.endsWith(".json")).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 30))) {
    await fs.unlink(path.join(REPORTS_DIR, f)).catch(() => {});
  }
}

export async function latestReport(): Promise<CrawlReport | null> {
  try {
    const files = (await fs.readdir(REPORTS_DIR)).filter((f) => f.endsWith(".json")).sort();
    if (files.length === 0) return null;
    return readJson<CrawlReport>(path.join(REPORTS_DIR, files[files.length - 1]), null as never);
  } catch {
    return null;
  }
}

export function dataDir(): string {
  return DATA_DIR;
}
