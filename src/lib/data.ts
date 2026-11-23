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
  normalizeCstIso,
  safeParseTimestamp,
  sanitizeEventRange,
  sortByPublished,
} from "@/lib/format";
import {
  AI_SCHEMA_VERSION,
  analyzeNoticeByRules,
  cleanVenue,
  normalizeAudience,
} from "@/lib/ai/extract-rules";
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

function fixPublishedAt(
  publishedAt: string,
  url: string,
  now: Date,
  fetchedAt?: string,
): string {
  const norm = normalizeCstIso(publishedAt);
  const pubMs = norm ? Date.parse(norm) : Number.NaN;
  // 严格按北京时间判断：若发布日期无效或落在未来（明天及之后），依次回落到文章 URL 路径日期 / 抓取时间
  if (Number.isNaN(pubMs) || !norm || dayDiffCst(norm, now) > 0) {
    const urlDate = dateFromUrl(url);
    if (urlDate && dayDiffCst(urlDate, now) <= 0) return urlDate;
    const fetchedNorm = normalizeCstIso(fetchedAt);
    if (fetchedNorm && dayDiffCst(fetchedNorm, now) <= 0) return fetchedNorm;
    return normalizeCstIso(now.toISOString()) ?? now.toISOString();
  }
  return norm;
}

function toNotice(n: CrawledNotice, now: Date): Notice {
  const rawAi = n.ai;
  const title = cleanTextSpacing(rawAi?.cleanTitle || n.title);
  const paragraphs = (n.paragraphs ?? []).map(cleanTextSpacing).filter(Boolean);
  const rawSummary = cleanTextSpacing(rawAi?.summary || n.summary || paragraphs[0] || title);
  const publishedAt = fixPublishedAt(n.publishedAt, n.url, now, n.fetchedAt);
  const effectiveCategory =
    rawAi?.category && VALID_CATS.has(rawAi.category) ? rawAi.category : n.category;
  const effectiveSubject: SubjectSlug =
    rawAi?.subject ?? inferSubject(n.source, title);

  const isV2Ai = Boolean(rawAi && rawAi.enrichedBy === "ai" && (rawAi.schemaVersion ?? 1) >= AI_SCHEMA_VERSION);
  const rule = analyzeNoticeByRules({
    title,
    summary: rawSummary,
    paragraphs,
    source: n.source,
    category: effectiveCategory,
    publishedAt,
    startsAt: rawAi?.startsAt ?? n.startsAt,
    endsAt: rawAi?.endsAt ?? n.endsAt,
    venue: rawAi?.venue ?? n.venue ?? null,
    registration: rawAi?.registrationRequired ?? n.registration,
    attachments: n.attachments,
  });

  // v2 真 AI 结果优先使用 LLM 字段并过一遍确定性清洗；旧版 v1 / 无 AI 则自动升级到 v2 规则判定
  const noticeKind = isV2Ai && rawAi?.noticeKind ? rawAi.noticeKind : rule.noticeKind;
  const isNonActionable = noticeKind === "recap" || noticeKind === "editorial";

  const schedule = isNonActionable
    ? { startsAt: null, endsAt: null }
    : isV2Ai
      ? sanitizeEventRange(rawAi?.startsAt ?? rule.startsAt, rawAi?.endsAt ?? rule.endsAt)
      : sanitizeEventRange(rule.startsAt, rule.endsAt);

  const venue = isNonActionable
    ? null
    : cleanVenue(isV2Ai ? rawAi?.venue : null) ?? rule.venue;

  const audience = isV2Ai && rawAi?.audience?.length
    ? normalizeAudience(rawAi.audience)
    : rule.audience;

  const registrationRequired = isNonActionable
    ? false
    : isV2Ai && typeof rawAi?.registrationRequired === "boolean"
      ? rawAi.registrationRequired
      : rule.registrationRequired;

  const registrationDeadline = isNonActionable
    ? null
    : (isV2Ai ? rawAi?.registrationDeadline : null) ?? rule.registrationDeadline;

  const importance = isV2Ai && typeof rawAi?.importance === "number"
    ? (isNonActionable ? Math.min(rawAi.importance, 2) : rawAi.importance)
    : rule.importance;

  const important = isNonActionable
    ? false
    : isV2Ai && typeof rawAi?.isImportant === "boolean"
      ? rawAi.isImportant
      : rule.isImportant;

  const importantReason = important
    ? (isV2Ai && rawAi?.importantReason ? rawAi.importantReason : rule.importantReason || undefined)
    : undefined;

  const actionSummary = isNonActionable
    ? undefined
    : (isV2Ai && rawAi?.actionSummary ? rawAi.actionSummary : rule.actionSummary);

  const mergedAi = rawAi
    ? {
        ...rawAi,
        schemaVersion: isV2Ai ? rawAi.schemaVersion : AI_SCHEMA_VERSION,
        noticeKind,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        venue,
        audience,
        registrationRequired,
        registrationDeadline,
        importance,
        isImportant: important,
        importantReason,
        actionSummary,
      }
    : {
        schemaVersion: AI_SCHEMA_VERSION,
        noticeKind,
        cleanTitle: title,
        summary: rawSummary,
        category: effectiveCategory,
        subject: effectiveSubject,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        venue,
        audience,
        registrationRequired,
        registrationDeadline,
        importance,
        isImportant: important,
        importantReason,
        actionSummary,
        tags: rule.tags,
        shouldNotify: rule.shouldNotify,
        notifyReason: rule.notifyReason,
        enrichedBy: "rules" as const,
        enrichedAt: publishedAt,
      };

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
    venue: venue ?? undefined,
    registration: registrationRequired || undefined,
    registrationDeadline: registrationDeadline ?? undefined,
    audience: audience.length ? audience : undefined,
    noticeKind,
    important: important || undefined,
    importance,
    importantReason,
    actionSummary,
    summary: rawSummary,
    paragraphs,
    cover: n.cover,
    blocks: cleanedBlocks,
    attachments: attachments?.length ? attachments : undefined,
    ai: mergedAi,
    url: n.url,
    isNew: isToday(publishedAt, now),
    ...(n.firstSeen ? { firstSeen: n.firstSeen } : {}),
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

/** 生成用于首屏 SSR / 列表接口的精简 Notice 摘要，保留重要通知/排期/对象等轻量化卡片展示字段 */
export function toNoticeSummary(n: Notice): Notice {
  const trimmedSummary = n.cover
    ? ""
    : n.summary.length > 110
      ? `${n.summary.slice(0, 110)}…`
      : n.summary;
  const attCount = n.attachments?.length || n.attachmentCount || 0;
  const audience = n.audience?.slice(0, 3);
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
    ...(n.registrationDeadline ? { registrationDeadline: n.registrationDeadline } : {}),
    ...(audience && audience.length > 0 ? { audience } : {}),
    ...(n.noticeKind ? { noticeKind: n.noticeKind } : {}),
    ...(n.important ? { important: true } : {}),
    ...(n.importance ? { importance: n.importance } : {}),
    ...(n.importantReason ? { importantReason: n.importantReason } : {}),
    ...(n.actionSummary ? { actionSummary: n.actionSummary } : {}),
    summary: trimmedSummary,
    paragraphs: [],
    ...(attCount > 0 ? { attachmentCount: attCount } : {}),
    summaryOnly: true,
    url: n.url,
    ...(n.cover ? { cover: n.cover } : {}),
    ...(n.isNew ? { isNew: true } : {}),
    ...(n.firstSeen ? { firstSeen: n.firstSeen } : {}),
    ...(n.requiresAuth ? { requiresAuth: true } : {}),
  };
}

/** 按 ID 与「同来源+同规范标题（且排期一致/相近）」双重去重，消除公众号短链/重复抓取导致的重复卡片 */
function deduplicateNotices(list: Notice[]): Notice[] {
  const qualityScore = (x: Notice) =>
    (x.ai?.enrichedBy === "ai" ? 8 : 0) +
    (x.paragraphs.length > 0 ? 4 : 0) +
    (x.attachments?.length ? 2 : 0) +
    (x.cover ? 1 : 0);

  const pickBetter = (a: Notice, b: Notice): Notice => {
    const sa = qualityScore(a);
    const sb = qualityScore(b);
    if (sb !== sa) return sb > sa ? b : a;
    return safeParseTimestamp(b.publishedAt) > safeParseTimestamp(a.publishedAt) ? b : a;
  };

  // 1) 主键 ID 去重
  const byId = new Map<string, Notice>();
  for (const item of list) {
    const prev = byId.get(item.id);
    byId.set(item.id, prev ? pickBetter(prev, item) : item);
  }

  // 2) 同来源 + 同标题去重（保留不同排期日期的同名定期通知，如不同日期的思政公开课）
  const normTitle = (t: string) =>
    t.replace(/[\s\u3000"“”'‘’《》【】（）()\-—–·.,:：;；!！?？|｜]/g, "").toLowerCase();
  const byContent = new Map<string, Notice>();
  for (const item of byId.values()) {
    const startDay = item.startsAt ? cstDateKey(item.startsAt) : "";
    const contentKey = `${item.source}::${normTitle(item.title)}::${startDay}`;
    const prev = byContent.get(contentKey);
    if (!prev) {
      byContent.set(contentKey, item);
      continue;
    }
    const dayGap = Math.abs(
      safeParseTimestamp(item.publishedAt) - safeParseTimestamp(prev.publishedAt),
    ) / 86400000;
    if (dayGap <= 10) {
      byContent.set(contentKey, pickBetter(prev, item));
    } else {
      byContent.set(`${contentKey}::${item.id}`, item);
    }
  }

  return sortByPublished([...byContent.values()]);
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
      const notices = deduplicateNotices(crawled.map((n) => toNotice(n, now)));
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
        crawledCount: notices.length,
      };
      globalThis.__scauNoticesDataCache = fresh;
      return fresh;
    }
  } catch {
    /* 读取失败则回退到内置真实首屏快照 */
  }

  const seed = deduplicateNotices(
    SEED_NOTICES.map((n) => {
      const paragraphs =
        n.paragraphs.length > 0
          ? n.paragraphs
          : (n.blocks ?? [])
              .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
              .map((b) => b.text);
      const publishedAt = fixPublishedAt(n.publishedAt, n.url, now);
      const rule = analyzeNoticeByRules({
        title: n.title,
        summary: n.summary,
        paragraphs,
        source: n.source,
        category: n.category,
        publishedAt,
        startsAt: n.startsAt,
        endsAt: n.endsAt,
        venue: n.venue,
        registration: n.registration,
        attachments: n.attachments,
      });
      const isNonActionable = rule.noticeKind === "recap" || rule.noticeKind === "editorial";
      return {
        ...n,
        publishedAt,
        paragraphs,
        startsAt: isNonActionable ? null : rule.startsAt,
        endsAt: isNonActionable ? null : rule.endsAt,
        venue: isNonActionable ? undefined : (rule.venue ?? undefined),
        registration: rule.registrationRequired || undefined,
        registrationDeadline: rule.registrationDeadline ?? undefined,
        audience: rule.audience.length ? rule.audience : undefined,
        noticeKind: rule.noticeKind,
        important: rule.isImportant || undefined,
        importance: rule.importance,
        importantReason: rule.importantReason || undefined,
        actionSummary: rule.actionSummary,
        subject: n.subject ?? inferSubject(n.source, n.title),
        isNew: isToday(publishedAt, now),
        ...(n.firstSeen ? { firstSeen: n.firstSeen } : {}),
      };
    }),
  );
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
 * 首页第一个「全部」首屏轻量切片（参照 pkuknow.cn/thu）：
 * SSR 仅下发前 `sectionCount`（默认 2 个）非空分类板块、每板块 `perSection`（默认 18 条）与全站分类计数，
 * 其余板块待滚动或交互时由客户端懒加载展开；
 * 活动「全部」/ 通知「全部」（/?cluster=...）则加载全量摘要以平铺瀑布流展示。
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
