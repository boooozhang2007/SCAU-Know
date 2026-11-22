import { promises as fs } from "node:fs";
import path from "node:path";
import { NOTICES as SEED_NOTICES } from "@/lib/notices";
import type { Notice } from "@/lib/types";
import type { CrawledNotice } from "@/lib/crawl/engine";
import { readNotices } from "@/lib/crawl/store";
import {
  cleanTextSpacing,
  cstDateKey,
  dayDiffCst,
  isToday,
  matchesQuery,
  sortByPublished,
} from "@/lib/format";
import { inferSubject } from "@/lib/sources";
import { CATEGORIES, type SubjectSlug } from "@/lib/site";

const DATA_DIR = process.env.BAUHINIA_DATA_DIR
  ? path.resolve(process.env.BAUHINIA_DATA_DIR)
  : path.join(process.cwd(), "data");
const NOTICES_FILE = path.join(DATA_DIR, "notices.json");

interface NoticesMemoryCache {
  mtimeMs: number;
  size: number;
  dayKey: string;
  notices: Notice[];
  summaries: Notice[];
  byId: Map<string, Notice>;
  fromCrawl: boolean;
  crawledCount: number;
}

declare global {
  var __scauNoticesDataCache: NoticesMemoryCache | undefined;
}

const VALID_CATS = new Set(CATEGORIES.map((c) => c.slug));

/**
 * 数据源统一入口。
 *
 * 优先读取抓取结果（data/notices.json），并在加载期完成：
 * 1. 修正 WebPlus 常见中文/数字断空格脏数据
 * 2. 校准异常的「未来发布日期」（回落到文章 URL 路径自带的 /YYYY/MMDD/）
 * 3. 从正文补全被旧正则漏掉的活动时间区间（startsAt / endsAt）与地点（venue）
 * 4. 动态计算「今日收录」（isNew）与华农学科归属（subject）
 */

const TONES = new Set([
  "leaf",
  "water",
  "amber",
  "rose",
  "lilac",
  "peach",
  "iris",
  "ochre",
  "slate",
]);

function clusterOf(category: string): Notice["cluster"] {
  return ["arts", "lectures", "skills", "careers", "exchange", "clubs"].includes(category)
    ? "activity"
    : "information";
}

function dateFromUrl(url: string): string | null {
  const m = url.match(/\/(20\d{2})\/(\d{2})(\d{2})\/c\d+a\d+\/page\./);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function to24h(hour: number, period?: string): number {
  let h = hour;
  if ((period === "下午" || period === "晚上" || period === "晚") && h < 12) h += 12;
  if (period === "上午" && h === 12) h = 0;
  return h;
}

const NOISE_VENUE = /^(另行通知|待定|见附件|详见|无|线上|线下)$/;

function sanitizeVenue(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const candidate = cleanTextSpacing(raw).replace(/[，,].*$/, "").trim();
  if (
    candidate.length < 2 ||
    candidate.length > 36 ||
    NOISE_VENUE.test(candidate) ||
    /访问网上系统|自行访问/.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

/** 从清洗后的正文中补提活动起止时间与地点 */
function recoverSchedule(
  cleanedParagraphs: string[],
  publishedAt: string,
  category: string,
  title: string,
  existingStartsAt: string | null,
  existingEndsAt: string | null,
  existingVenue: string | null,
): {
  startsAt: string | null;
  endsAt: string | null;
  venue: string | null;
} {
  const joined = cleanedParagraphs.join("\n");
  const pubYear = Number(publishedAt.slice(0, 4)) || new Date().getFullYear();

  let startsAt = existingStartsAt;
  let endsAt = existingEndsAt;
  let venue = sanitizeVenue(existingVenue);

  const isEventLike =
    ["arts", "lectures", "skills", "careers", "clubs"].includes(category) ||
    /讲座|报告|论坛|比赛|大赛|宣讲|演出|培训|考试|答辩|工作坊|沙龙/.test(title);

  if (!startsAt || !endsAt) {
    const prefix = isEventLike
      ? "(?:活动时间|报告时间|讲座时间|会议时间|举办时间|开始时间|演出时间|比赛时间|宣讲时间|培训时间|考试时间|时\\s*间)"
      : "(?:活动时间|报告时间|讲座时间|会议时间|举办时间|开始时间|演出时间|比赛时间|宣讲时间|培训时间|考试时间)";
    const labelRe = new RegExp(
      `${prefix}\\s*[:：]\\s*(?:(20\\d{2})\\s*[-/年.]\\s*)?(\\d{1,2})\\s*[-/月.]\\s*(\\d{1,2})日?(?:[（(][^)）]{0,12}[)）])?\\s*(上午|下午|晚上|晚)?\\s*(?:(\\d{1,2})\\s*[:：点时]\\s*(\\d{2})?)?(?:\\s*[-–—~至]\\s*(上午|下午|晚上|晚)?\\s*(\\d{1,2})\\s*[:：点时]\\s*(\\d{2})?)?`,
    );
    const m = joined.match(labelRe);
    if (m) {
      const y = m[1] ? Number(m[1]) : pubYear;
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        const period1 = m[4];
        const hh1 = m[5] !== undefined ? to24h(Number(m[5]), period1) : 0;
        const mm1 = m[6] !== undefined ? Number(m[6]) : 0;
        if (hh1 <= 23 && mm1 <= 59) {
          if (!startsAt) {
            startsAt = `${y}-${pad(mo)}-${pad(d)}T${pad(hh1)}:${pad(mm1)}:00+08:00`;
          }
          if (!endsAt && m[8] !== undefined) {
            const period2 = m[7] || period1;
            const hh2 = to24h(Number(m[8]), period2);
            const mm2 = m[9] !== undefined ? Number(m[9]) : 0;
            if (hh2 <= 23 && mm2 <= 59) {
              endsAt = `${y}-${pad(mo)}-${pad(d)}T${pad(hh2)}:${pad(mm2)}:00+08:00`;
            }
          }
        }
      }
    }
  }

  if (!venue) {
    const venueRe =
      /(?:活动地点|举办地点|会议地点|报告地点|讲座地点|宣讲地点|培训地点|比赛地点|地\s*点)\s*[:：]\s*([^\n。；;]{2,42})/;
    const vm = joined.match(venueRe);
    if (vm) {
      venue = sanitizeVenue(vm[1]);
    }
  }

  return { startsAt, endsAt, venue };
}

function fixPublishedAt(publishedAt: string, url: string, now: Date): string {
  const pubMs = new Date(publishedAt).getTime();
  // 严格按北京时间判断：若发布日期落在未来（明天及之后），回落到文章 URL 路径日期
  if (Number.isNaN(pubMs) || dayDiffCst(publishedAt, now) > 0) {
    const urlDate = dateFromUrl(url);
    if (urlDate) return urlDate;
  }
  return publishedAt;
}

function toNotice(n: CrawledNotice, now: Date): Notice {
  const ai = n.ai;
  const title = cleanTextSpacing(ai?.cleanTitle || n.title);
  const paragraphs = (n.paragraphs ?? []).map(cleanTextSpacing).filter(Boolean);
  const rawSummary = cleanTextSpacing(ai?.summary || n.summary || paragraphs[0] || title);
  const publishedAt = fixPublishedAt(n.publishedAt, n.url, now);
  const effectiveCategory =
    ai?.category && VALID_CATS.has(ai.category) ? ai.category : n.category;
  const effectiveSubject: SubjectSlug =
    ai?.subject ?? inferSubject(n.source, title);

  const schedule = recoverSchedule(
    paragraphs,
    publishedAt,
    effectiveCategory,
    title,
    ai?.startsAt ?? n.startsAt,
    ai?.endsAt ?? n.endsAt,
    ai?.venue ?? n.venue ?? null,
  );

  const isStaticBuild = process.env.STATIC_EXPORT === "1";
  const attachments = n.attachments?.map((att) => ({
    ...att,
    localPath:
      !isStaticBuild && att.localPath
        ? `/api/media/attachments/${encodeURIComponent(path.basename(att.localPath))}`
        : undefined,
  }));

  const cleanedBlocks = n.blocks?.map((blk) => {
    if (blk.type === "text") {
      return { ...blk, text: cleanTextSpacing(blk.text) };
    }
    if (blk.type === "table") {
      return {
        ...blk,
        caption: blk.caption ? cleanTextSpacing(blk.caption) : undefined,
        headers: blk.headers.map(cleanTextSpacing),
        rows: blk.rows.map((row) =>
          row.map((cell) => ({ ...cell, text: cleanTextSpacing(cell.text) })),
        ),
      };
    }
    return blk;
  });

  return {
    id: n.id,
    title,
    category: effectiveCategory,
    cluster: clusterOf(effectiveCategory),
    subject: effectiveSubject,
    tone: (TONES.has(n.tone) ? n.tone : "leaf") as Notice["tone"],
    source: n.source,
    publishedAt,
    startsAt: schedule.startsAt,
    endsAt: schedule.endsAt,
    venue: schedule.venue ?? undefined,
    registration: ai?.registrationRequired ?? n.registration,
    summary: rawSummary,
    paragraphs,
    cover: n.cover,
    blocks: cleanedBlocks,
    attachments: attachments?.length ? attachments : undefined,
    ai,
    url: n.url,
    isNew: isToday(publishedAt, now),
    requiresAuth: n.requiresAuth || undefined,
  };
}

export function buildSearchSnippet(n: Notice): string | undefined {
  const parts: string[] = [];
  if (n.summary) parts.push(n.summary);
  for (const b of n.blocks ?? []) {
    if (b.type !== "table") continue;
    if (b.caption) parts.push(b.caption);
    if (b.headers.length > 0) parts.push(b.headers.join(" "));
    for (const row of b.rows.slice(0, 6)) {
      parts.push(row.map((c) => c.text).join(" "));
    }
  }
  if (n.attachments?.length) {
    parts.push(n.attachments.map((a) => a.name).join(" "));
  }
  if (n.paragraphs.length > 0) {
    const paraJoined = n.paragraphs.join(" ").slice(0, 240);
    if (paraJoined) parts.push(paraJoined);
  }
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  return joined ? joined.slice(0, 420) : undefined;
}

/** 生成用于首屏 SSR / 列表接口的极简 Notice 摘要，剔除 AI 元数据、搜索索引与有封面时的摘要文本 */
export function toNoticeSummary(n: Notice): Notice {
  const trimmedSummary = n.cover
    ? ""
    : n.summary.length > 110
      ? `${n.summary.slice(0, 110)}…`
      : n.summary;
  const attCount = n.attachments?.length || n.attachmentCount || 0;
  return {
    id: n.id,
    title: n.title,
    category: n.category,
    cluster: n.cluster,
    subject: n.subject,
    tone: n.tone,
    source: n.source,
    publishedAt: n.publishedAt,
    ...(n.startsAt ? { startsAt: n.startsAt } : {}),
    ...(n.endsAt ? { endsAt: n.endsAt } : {}),
    ...(n.venue ? { venue: n.venue } : {}),
    ...(n.registration ? { registration: true } : {}),
    summary: trimmedSummary,
    paragraphs: [],
    ...(attCount > 0 ? { attachmentCount: attCount } : {}),
    summaryOnly: true,
    url: n.url,
    ...(n.cover ? { cover: n.cover } : {}),
    ...(n.isNew ? { isNew: true } : {}),
    ...(n.requiresAuth ? { requiresAuth: true } : {}),
  };
}

async function getCachedBundle(now: Date): Promise<NoticesMemoryCache> {
  const dayKey = cstDateKey(now.toISOString());
  try {
    const stat = await fs.stat(NOTICES_FILE);
    const hit = globalThis.__scauNoticesDataCache;
    if (
      hit &&
      hit.fromCrawl &&
      hit.mtimeMs === stat.mtimeMs &&
      hit.size === stat.size &&
      hit.dayKey === dayKey
    ) {
      return hit;
    }

    const crawled = await readNotices();
    if (crawled.length > 0) {
      const notices = crawled.map((n) => toNotice(n, now));
      const summaries = notices.map(toNoticeSummary);
      const byId = new Map<string, Notice>(notices.map((n) => [n.id, n]));
      const fresh: NoticesMemoryCache = {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        dayKey,
        notices,
        summaries,
        byId,
        fromCrawl: true,
        crawledCount: crawled.length,
      };
      globalThis.__scauNoticesDataCache = fresh;
      return fresh;
    }
  } catch {
    /* 读取失败则回退到内置真实首屏快照 */
  }

  const seed = SEED_NOTICES.map((n) => ({
    ...n,
    paragraphs:
      n.paragraphs.length > 0
        ? n.paragraphs
        : (n.blocks ?? [])
            .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
            .map((b) => b.text),
    subject: n.subject ?? inferSubject(n.source, n.title),
    isNew: isToday(n.publishedAt, now),
  }));
  return {
    mtimeMs: 0,
    size: 0,
    dayKey,
    notices: seed,
    summaries: seed.map(toNoticeSummary),
    byId: new Map(seed.map((n) => [n.id, n])),
    fromCrawl: false,
    crawledCount: 0,
  };
}

/** 读取全部通知（完整版，带文件 mtime + size + 日期键内存缓存） */
export async function loadNotices(now = new Date()): Promise<{
  notices: Notice[];
  fromCrawl: boolean;
  crawledCount: number;
}> {
  const bundle = await getCachedBundle(now);
  return {
    notices: bundle.notices,
    fromCrawl: bundle.fromCrawl,
    crawledCount: bundle.crawledCount,
  };
}

/**
 * 读取用于列表首屏与 `/api/notices` 的精简摘要集合；
 * 若存在 `?notice=<id>` 深链参数则同步保留该条的完整正文与表格以实现首屏直出。
 */
export async function loadNoticeSummaries(
  now = new Date(),
  hydrateNoticeId?: string | null,
): Promise<{
  notices: Notice[];
  fromCrawl: boolean;
  crawledCount: number;
}> {
  const bundle = await getCachedBundle(now);

  let notices = bundle.summaries;
  if (hydrateNoticeId) {
    const full = bundle.byId.get(hydrateNoticeId);
    if (full) {
      notices = bundle.summaries.map((item) =>
        item.id === hydrateNoticeId ? full : item,
      );
    }
  }

  return {
    notices,
    fromCrawl: bundle.fromCrawl,
    crawledCount: bundle.crawledCount,
  };
}

export interface InitialBoardSlice {
  notices: Notice[];
  totalCount: number;
  categoryCounts: Record<string, number>;
  partial: boolean;
  fromCrawl: boolean;
  crawledCount: number;
}

function computeCategoryCounts(list: Notice[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const n of list) {
    counts[n.category] = (counts[n.category] ?? 0) + 1;
  }
  return counts;
}

function withHydratedNotice(
  sliced: Notice[],
  byId: Map<string, Notice>,
  hydrateNoticeId?: string | null,
): Notice[] {
  if (!hydrateNoticeId) return sliced;
  const full = byId.get(hydrateNoticeId);
  if (!full) return sliced;
  const idx = sliced.findIndex((item) => item.id === hydrateNoticeId);
  if (idx >= 0) {
    const next = [...sliced];
    next[idx] = full;
    return next;
  }
  return [...sliced, full];
}

/**
 * 首页首屏轻量切片（参照 pkuknow.cn/thu）：
 * SSR 仅下发前 `sectionCount`（默认 2 个）非空板块、每板块 `perSection`（默认 18 条）与全站分类计数，
 * 其余板块待滚动或交互时由客户端懒加载 `/static-data/notices-summary.json` 展开。
 */
export async function loadInitialHomeSlice(
  now = new Date(),
  hydrateNoticeId?: string | null,
  sectionCount = 2,
  perSection = 18,
): Promise<InitialBoardSlice> {
  const bundle = await getCachedBundle(now);
  const byCategory = new Map<string, Notice[]>();
  for (const item of bundle.summaries) {
    const arr = byCategory.get(item.category) ?? [];
    arr.push(item);
    byCategory.set(item.category, arr);
  }

  const picked: Notice[] = [];
  let takenSections = 0;
  for (const cat of CATEGORIES) {
    if (takenSections >= sectionCount) break;
    const rawBucket = byCategory.get(cat.slug);
    if (!rawBucket || rawBucket.length === 0) continue;
    picked.push(...sortByPublished(rawBucket).slice(0, perSection));
    takenSections++;
  }

  const sliced = withHydratedNotice(picked, bundle.byId, hydrateNoticeId);
  return {
    notices: sliced,
    totalCount: bundle.summaries.length,
    categoryCounts: computeCategoryCounts(bundle.summaries),
    partial: sliced.length < bundle.summaries.length,
    fromCrawl: bundle.fromCrawl,
    crawledCount: bundle.crawledCount,
  };
}

/**
 * 单分类页首屏轻量切片：仅下发当前分类前 `limit`（默认 30 条）摘要与全站分类计数。
 */
export async function loadInitialCategorySlice(
  slug: string,
  now = new Date(),
  hydrateNoticeId?: string | null,
  limit = 30,
): Promise<InitialBoardSlice> {
  const bundle = await getCachedBundle(now);
  const scoped = sortByPublished(bundle.summaries.filter((n) => n.category === slug)).slice(
    0,
    limit,
  );
  const sliced = withHydratedNotice(scoped, bundle.byId, hydrateNoticeId);
  return {
    notices: sliced,
    totalCount: bundle.summaries.length,
    categoryCounts: computeCategoryCounts(bundle.summaries),
    partial: sliced.length < bundle.summaries.length,
    fromCrawl: bundle.fromCrawl,
    crawledCount: bundle.crawledCount,
  };
}

/**
 * 活动日历页首屏切片：仅下发包含排期时间（`startsAt`）的摘要条目。
 */
export async function loadInitialCalendarSlice(
  now = new Date(),
): Promise<InitialBoardSlice> {
  const bundle = await getCachedBundle(now);
  const scheduled = bundle.summaries.filter((n) => Boolean(n.startsAt));
  return {
    notices: scheduled,
    totalCount: bundle.summaries.length,
    categoryCounts: computeCategoryCounts(bundle.summaries),
    partial: scheduled.length < bundle.summaries.length,
    fromCrawl: bundle.fromCrawl,
    crawledCount: bundle.crawledCount,
  };
}

/** 按 ID O(1) 读取单条完整通知 */
export async function loadNoticeById(
  id: string,
  now = new Date(),
): Promise<Notice | null> {
  const bundle = await getCachedBundle(now);
  return bundle.byId.get(id) ?? null;
}

/**
 * 搜索页专用的轻量摘要加载：确保整库数量与来源分布不变，同时对全文/深表格命中的条目保留检索可见性。
 */
export async function searchNoticeSummaries(
  query: string,
  now = new Date(),
  hydrateNoticeId?: string | null,
): Promise<InitialBoardSlice> {
  const kw = query.trim();
  if (!kw) {
    const res = await loadNoticeSummaries(now, hydrateNoticeId);
    return {
      notices: res.notices,
      totalCount: res.notices.length,
      categoryCounts: computeCategoryCounts(res.notices),
      partial: false,
      fromCrawl: res.fromCrawl,
      crawledCount: res.crawledCount,
    };
  }

  const bundle = await getCachedBundle(now);
  const kwLower = kw.toLowerCase();
  const notices = bundle.summaries.map((sum, idx) => {
    if (hydrateNoticeId && sum.id === hydrateNoticeId) {
      return bundle.notices[idx];
    }
    const full = bundle.notices[idx];
    const extraSnippet = buildSearchSnippet(full);
    const fullMatched =
      matchesQuery(full, kw, extraSnippet) ||
      full.paragraphs.some((p) => p.toLowerCase().includes(kwLower));
    if (fullMatched && !matchesQuery(sum, kw)) {
      return {
        ...sum,
        searchSnippet: `${sum.searchSnippet ?? ""} ${kw}`.trim(),
      };
    }
    return sum;
  });

  return {
    notices,
    totalCount: bundle.summaries.length,
    categoryCounts: computeCategoryCounts(bundle.summaries),
    partial: false,
    fromCrawl: bundle.fromCrawl,
    crawledCount: bundle.crawledCount,
  };
}
