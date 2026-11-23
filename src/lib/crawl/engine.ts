/**
 * 抓取引擎。
 *
 * 设计要点：
 * - 有限并发 + 每站点间隔，避免对学校服务器造成压力
 * - 增量：按站点记录「已见 URL」与「最新发布日期」，只抓新条目
 * - 去重：URL 规范化（微信提取 __biz+mid+idx，站点去锚点与追踪参数）
 * - 分类推断：先看来源默认分类，再按标题关键词细化
 * - 附件解析与图片转存：下载解析 PDF/DOCX/XLSX，并镜像文章内图片
 */

import type { NoticeAiMeta, NoticeAttachment, NoticeBlock } from "@/lib/types";
import type { CrawlSource } from "./sources";
import {
  parseListByTemplate,
  extractArticle,
  isAttachmentOnlyText,
  titleMatches,
  type ParsedItem,
} from "./parse";
import { downloadAndParseAttachments } from "./attachments";
import { mirrorMedia } from "./media";

export interface CrawledNotice {
  /** 稳定主键：来源 id + 文章 id */
  id: string;
  title: string;
  url: string;
  source: string;
  sourceId: string;
  category: string;
  tone: string;
  /** ISO 8601 带 +08:00 */
  publishedAt: string;
  startsAt: string | null;
  endsAt: string | null;
  venue: string | null;
  registration: boolean;
  summary: string;
  paragraphs: string[];
  cover?: string;
  blocks?: NoticeBlock[];
  attachments?: NoticeAttachment[];
  ai?: NoticeAiMeta;
  isNew: boolean;
  fetchedAt: string;
  requiresAuth?: boolean;
}

export interface SourceReport {
  id: string;
  name: string;
  ok: boolean;
  listed: number;
  fetched: number;
  added: number;
  error?: string;
  durationMs: number;
}

export interface CrawlReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sources: SourceReport[];
  added: number;
  total: number;
}

const TONE_BY_CATEGORY: Record<string, string> = {
  arts: "lilac",
  lectures: "water",
  skills: "amber",
  careers: "rose",
  exchange: "slate",
  clubs: "leaf",
  campus: "amber",
  research: "water",
  departments: "lilac",
  life: "peach",
  academics: "iris",
  scholarships: "ochre",
  services: "water",
  recruitment: "rose",
};

/** 标题关键词 → 分类细化规则，按优先级排列 */
const CATEGORY_RULES: { test: RegExp; category: string }[] = [
  { test: /招聘|招录|诚聘|人才引进|博士后招收|岗位/, category: "recruitment" },
  { test: /奖学金|助学金|助学贷款|资助|综测|评优|评奖/, category: "scholarships" },
  {
    test: /技能培训|上机培训|专题培训|培训班|工作坊|训练营|实操|学科竞赛|创新创业大赛|竞赛辅导|读书|阅读分享|经验分享|学习交流|教学比赛|教学创新|公开课/,
    category: "skills",
  },
  { test: /讲座|讲坛|论坛|报告会|学术沙龙|研讨会|学术会议/, category: "lectures" },
  { test: /演出|音乐会|晚会|展览|比赛|大赛|文艺|体育|运动会|摄影展|话剧/, category: "arts" },
  { test: /招聘会|双选会|宣讲会|实习|就业|职业|简历|面试/, category: "careers" },
  { test: /交换|留学|访学|出国|境外|暑校|雅思|托福|公派/, category: "exchange" },
  { test: /选课|考试|学籍|学位|转专业|成绩|教务|培养方案|论文答辩|学分/, category: "academics" },
  { test: /科研|基金|项目申报|成果|论文|专利|实验室安全|仪器/, category: "research" },
  { test: /宿舍|食堂|餐饮|停水|停电|热水|快递|校车|门诊|疫苗|体检|后勤|维修/, category: "life" },
  { test: /社团|招新|志愿|义工|学生会|百团/, category: "clubs" },
  { test: /校园卡|网络|认证|系统|平台|场馆|预约|报修|缴费/, category: "services" },
  { test: /会议|部署|调研|表彰|开学|毕业|典礼|要闻|喜报/, category: "campus" },
];

export function inferCategory(source: CrawlSource, title: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.test.test(title)) return rule.category;
  }
  return source.category;
}

export function toneOf(category: string): string {
  return TONE_BY_CATEGORY[category] ?? "leaf";
}

/** URL 规范化：去锚点、去追踪参数、统一 https */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.hostname === "mp.weixin.qq.com" && u.protocol === "http:") {
      u.protocol = "https:";
    }
    // 微信读书侧返回的公众号短链把 base64url 的 `_` 写成了 `~`，
    // 直接访问会返回「参数错误」；这里统一还原成 `_`。
    if (
      u.hostname === "mp.weixin.qq.com" &&
      u.pathname.startsWith("/s/") &&
      u.pathname.includes("~")
    ) {
      u.pathname = u.pathname.replace(/~/g, "_");
    }
    if (u.hostname !== "mp.weixin.qq.com") {
      u.hash = "";
    }
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|spm|from|share|scene)/i.test(k)) u.searchParams.delete(k);
    }
    return u.href;
  } catch {
    return raw;
  }
}

/** 稳定去重主键：微信公众号文章用 `__biz + mid + idx`，防止 chksm 波动导致重复入库 */
export function canonicalNoticeKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.hostname === "mp.weixin.qq.com") {
      if (u.protocol === "http:") u.protocol = "https:";
      const biz = u.searchParams.get("__biz");
      const mid = u.searchParams.get("mid");
      const idx = u.searchParams.get("idx") ?? "1";
      if (biz && mid) {
        return `wx:${biz}:${mid}:${idx}`;
      }
      u.hash = "";
      u.searchParams.delete("chksm");
      u.searchParams.delete("scene");
      return u.href;
    }
  } catch {
    /* 忽略 */
  }
  return normalizeUrl(rawUrl);
}

/** 从文章 URL 推断发布日期（WebPlus 路径含 /YYYY/MMDD/） */
export function dateFromUrl(url: string): string | null {
  const m = url.match(/\/(20\d{2})\/(\d{2})(\d{2})\/c\d+a\d+\/page\./);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 BauhiniaKnowBot/1.0 (+https://example.invalid/bot)";

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
}

const AUTH_REDIRECT_RE =
  /(?:cas\.scau\.edu\.cn\/|\/lyuapServer\/login|ids\.scau\.edu\.cn\/)/i;

export async function fetchPage(
  url: string,
  { timeoutMs = 15000, retries = 1 }: FetchOptions = {},
): Promise<{ html: string; finalUrl: string; requiresAuth: boolean }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,*/*" },
        signal: ctrl.signal,
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const finalUrl = res.url || url;
      const requiresAuth =
        AUTH_REDIRECT_RE.test(finalUrl) ||
        /<form[^>]+(?:loginForm|casLoginForm)/i.test(html);
      return { html, finalUrl, requiresAuth };
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchText(
  url: string,
  opts: FetchOptions = {},
): Promise<string> {
  const { html } = await fetchPage(url, opts);
  return html;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 并发池 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface CrawlState {
  /** 已抓过的 URL */
  seen: string[];
  /** 每站点最近一次成功时间 */
  lastRun: Record<string, string>;
}

export interface RunCrawlOptions {
  sources: CrawlSource[];
  /** 每个站点最多取多少条列表项 */
  limitPerSource?: number;
  /** 是否抓取文章正文（关闭则只用列表信息，速度快） */
  fetchDetail?: boolean;
  /** 是否下载并解析正文内附件（PDF/DOCX/XLSX） */
  parseAttachments?: boolean;
  /** 是否镜像正文与封面图片到本地/CDN */
  mirrorImages?: boolean;
  /** 并发站点数 */
  concurrency?: number;
  /** 已见 URL，用于增量 */
  seen?: Set<string>;
  /** 进度回调 */
  onProgress?: (report: SourceReport, index: number, total: number) => void;
}

export interface HydratedNoticeDetail {
  ok: boolean;
  requiresAuth: boolean;
  publishedAt: string | null;
  startsAt: string | null;
  venue: string | null;
  registration: boolean;
  summary: string;
  paragraphs: string[];
  cover?: string;
  blocks?: NoticeBlock[];
  attachments?: NoticeAttachment[];
}

function normCompare(s: string): string {
  return s.replace(/[\s\u3000"“”'‘’《》【】（）()\-—–·.,:：;；!！?？]/g, "").toLowerCase();
}

function extractFallbackScheduleFromText(
  text: string,
  pubYear: number,
): { startsAt: string | null; venue: string | null } {
  const labelRe =
    /(?:活动时间|报告时间|讲座时间|会议时间|举办时间|开始时间|截止时间|报名时间|评审时间|时间)\s*[:：]\s*(?:(20\d{2})\s*[-/年.]\s*)?(\d{1,2})\s*[-/月.]\s*(\d{1,2})日?(?:[（(][^)）]{0,12}[)）])?\s*(上午|下午|晚上|晚)?\s*(\d{1,2})\s*[:：点时]\s*(\d{2})/;
  const m = text.match(labelRe);
  let startsAt: string | null = null;
  if (m) {
    const y = m[1] ? Number(m[1]) : pubYear;
    const mo = Number(m[2]);
    const d = Number(m[3]);
    let hh = Number(m[5]);
    const mm = Number(m[6]);
    if ((m[4] === "下午" || m[4] === "晚上" || m[4] === "晚") && hh < 12) hh += 12;
    if (m[4] === "上午" && hh === 12) hh = 0;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && hh <= 23 && mm <= 59) {
      const pad = (n: number) => String(n).padStart(2, "0");
      startsAt = `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00+08:00`;
    }
  }
  const venueM = text.match(
    /(?:活动地点|举办地点|会议地点|报告地点|讲座地点|报送地点|地点)\s*[:：]\s*([^\n，。；;]{2,36})/,
  );
  const candidate = venueM?.[1].trim() ?? null;
  const venue =
    candidate && candidate.length >= 2 && !/^(另行通知|待定|见附件|详见|无)$/.test(candidate)
      ? candidate
      : null;
  return { startsAt, venue };
}

/** 抓取单篇详情页并完成图片镜像、附件下载解析及内嵌 PDF 正文提升（供抓取器与回补脚本复用） */
export async function hydrateNoticeDetail(
  url: string,
  title: string,
  {
    mirrorImages = true,
    parseAttachments = true,
    fallbackYear = new Date().getFullYear(),
  }: { mirrorImages?: boolean; parseAttachments?: boolean; fallbackYear?: number } = {},
): Promise<HydratedNoticeDetail> {
  const empty: HydratedNoticeDetail = {
    ok: false,
    requiresAuth: false,
    publishedAt: null,
    startsAt: null,
    venue: null,
    registration: /报名|申请|预约|征集|招募/.test(title),
    summary: title,
    paragraphs: [],
  };

  let page: { html: string; finalUrl: string; requiresAuth: boolean };
  try {
    page = await fetchPage(url, { retries: 0 });
  } catch {
    return empty;
  }

  if (page.requiresAuth) {
    return {
      ...empty,
      ok: true,
      requiresAuth: true,
    };
  }

  const detail = extractArticle(page.html, url);
  if (detail.pageTitle && !titleMatches(title, detail.pageTitle)) {
    return empty;
  }

  let cover: string | undefined;
  let blocks: NoticeBlock[] = [...detail.blocks];

  if (mirrorImages && blocks.length > 0) {
    const mirrored: NoticeBlock[] = [];
    for (const blk of blocks) {
      if (blk.type === "image") {
        const localSrc = await mirrorMedia(blk.originalSrc, "image", url);
        if (!localSrc) continue;
        if (!cover) cover = localSrc;
        mirrored.push({ ...blk, src: localSrc });
      } else {
        mirrored.push(blk);
      }
    }
    blocks = mirrored;
  } else if (detail.cover) {
    cover = detail.cover;
  }

  let attachments: NoticeAttachment[] | undefined;
  if (parseAttachments && detail.attachments.length > 0) {
    attachments = await downloadAndParseAttachments(detail.attachments, url);
  }

  let paragraphs = detail.paragraphs;
  let summary = detail.summary || title;
  let startsAt = detail.startsAt;
  let venue = detail.venue;

  // 若正文为空或只列了附件文件名，把内嵌 PDF（wp_pdf_player）解析出的正文提升为正式段落与摘要
  const htmlOnlyAtts =
    paragraphs.length === 0 || paragraphs.every((p) => isAttachmentOnlyText(p));
  const embeddedPdf = attachments?.find(
    (a) => a.embedded && a.ext === "pdf" && a.parsedText && a.parsedText.length >= 40,
  );
  if (htmlOnlyAtts && embeddedPdf?.parsedText) {
    const titleNorm = normCompare(title);
    const pdfLines = embeddedPdf.parsedText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    if (pdfLines.length > 0 && normCompare(pdfLines[0]) === titleNorm) {
      pdfLines.shift();
    }
    const promoted = pdfLines.slice(0, 24);
    if (promoted.length > 0) {
      paragraphs = promoted;
      const nonTextBlocks = blocks.filter(
        (b) => b.type === "image" || b.type === "table",
      );
      blocks = [
        ...promoted.map((text): NoticeBlock => ({ type: "text", text })),
        ...nonTextBlocks,
      ];
      const isHeadingOrDocMeta = (p: string) =>
        p.length < 18 ||
        /^(?:[-—–\s]+|第\s*\d+\s*号|华南农[大办]?[〔\[【„]|[\u4e00-\u9fa5]{2,12}文件$|各[^\n]{1,24}[:：]$)/.test(
          p,
        ) ||
        (p.length <= 38 &&
          /(?:通知|决定|公示|公告|方案|细则|办法|实施方案)$/.test(p));
      const bestSummary =
        promoted.find((p) => !isHeadingOrDocMeta(p) && p.length >= 22) ??
        promoted.find((p) => !isHeadingOrDocMeta(p)) ??
        promoted.find((p) => p.length >= 10) ??
        promoted[0];
      if (bestSummary) summary = bestSummary.slice(0, 140);

      if (!startsAt || !venue) {
        const extra = extractFallbackScheduleFromText(
          promoted.join("\n"),
          fallbackYear,
        );
        if (!startsAt) startsAt = extra.startsAt;
        if (!venue) venue = extra.venue;
      }
    }
  }

  const joinedAll = paragraphs.join("\n");
  return {
    ok: true,
    requiresAuth: false,
    publishedAt: detail.publishedAt,
    startsAt,
    venue,
    registration: /报名|申请|预约|征集|招募|申报/.test(`${title}\n${joinedAll}`),
    summary,
    paragraphs,
    cover,
    blocks: blocks.length ? blocks : undefined,
    attachments: attachments?.length ? attachments : undefined,
  };
}

/** 抓取单个站点 */
export async function crawlSource(
  source: CrawlSource,
  opts: RunCrawlOptions,
): Promise<{ notices: CrawledNotice[]; report: SourceReport; seen: string[] }> {
  const started = Date.now();
  const limit = opts.limitPerSource ?? 20;
  const fetchDetail = opts.fetchDetail ?? true;
  const parseAttachments = opts.parseAttachments ?? fetchDetail;
  const mirrorImages = opts.mirrorImages ?? fetchDetail;
  const listUrl = source.listUrl ?? source.base;
  const notices: CrawledNotice[] = [];
  const seenUrls: string[] = [];

  try {
    const html = await fetchText(listUrl);
    let items: ParsedItem[] = parseListByTemplate(source.template, html, source.base);

    // 首页解析不到时，尝试常见栏目兜底
    if (items.length === 0 && !source.listUrl) {
      for (const path of ["tzgg/list.htm", "xwtz/list.htm", "xwzx/list.htm", "news/list.htm"]) {
        try {
          const alt = new URL(path, source.base).href;
          const altHtml = await fetchText(alt, { retries: 0 });
          const altItems = parseListByTemplate(source.template, altHtml, source.base);
          if (altItems.length > 0) {
            items = altItems;
            break;
          }
        } catch {
          /* 继续下一个候选 */
        }
      }
    }

    const picked = items.slice(0, limit);

    // 详情抓取（限并发 4），完成校验、图片镜像、附件解析与内嵌 PDF 提升
    const details = fetchDetail
      ? await mapLimit(picked, 4, async (item) =>
          hydrateNoticeDetail(normalizeUrl(item.url), item.title, {
            mirrorImages,
            parseAttachments,
            fallbackYear:
              Number((item.date ?? dateFromUrl(item.url) ?? "").slice(0, 4)) ||
              new Date().getFullYear(),
          }),
        )
      : picked.map(
          (item): HydratedNoticeDetail => ({
            ok: true,
            requiresAuth: false,
            publishedAt: null,
            startsAt: null,
            venue: null,
            registration: /报名|申请|预约|征集|招募/.test(item.title),
            summary: item.title,
            paragraphs: [],
          }),
        );

    for (let i = 0; i < picked.length; i++) {
      const item = picked[i];
      const detail = details[i];
      if (fetchDetail && !detail.ok) continue;

      const url = normalizeUrl(item.url);
      seenUrls.push(canonicalNoticeKey(url));

      const listDate = item.date ?? dateFromUrl(item.url);
      const pageDate = detail.publishedAt ?? null;
      const publishedAt =
        pageDate && pageDate.includes("T")
          ? pageDate
          : listDate ?? pageDate ?? new Date().toISOString().slice(0, 10);

      const iso = /^\d{4}-\d{2}-\d{2}$/.test(publishedAt)
        ? `${publishedAt}T00:00:00+08:00`
        : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(publishedAt)
          ? `${publishedAt.length === 16 ? `${publishedAt}:00` : publishedAt}+08:00`
          : new Date(publishedAt).toISOString();

      const category = inferCategory(source, item.title);
      const articleId = url.match(/\/c\d+a(\d+)\/page\./) ?? url.match(/[?&]id=(\d+)/);
      const id = `${source.id}_${articleId ? articleId[1] : hash(url)}`;

      notices.push({
        id,
        title: item.title,
        url,
        source: source.name,
        sourceId: source.id,
        category,
        tone: toneOf(category),
        publishedAt: iso,
        startsAt: detail.startsAt,
        endsAt: null,
        venue: detail.venue,
        registration: detail.registration,
        summary: detail.summary || item.title,
        paragraphs: detail.paragraphs,
        cover: detail.cover,
        blocks: detail.blocks,
        attachments: detail.attachments,
        isNew: isToday(iso),
        fetchedAt: new Date().toISOString(),
        ...(detail.requiresAuth ? { requiresAuth: true } : {}),
      });
    }

    return {
      notices,
      seen: seenUrls,
      report: {
        id: source.id,
        name: source.name,
        ok: true,
        listed: items.length,
        fetched: picked.length,
        added: notices.length,
        durationMs: Date.now() - started,
      },
    };
  } catch (e) {
    return {
      notices: [],
      seen: seenUrls,
      report: {
        id: source.id,
        name: source.name,
        ok: false,
        listed: 0,
        fetched: 0,
        added: 0,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - started,
      },
    };
  }
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
  const nowShifted = new Date(now.getTime() + 8 * 3600 * 1000);
  return (
    shifted.getUTCFullYear() === nowShifted.getUTCFullYear() &&
    shifted.getUTCMonth() === nowShifted.getUTCMonth() &&
    shifted.getUTCDate() === nowShifted.getUTCDate()
  );
}

/** 批量抓取 */
export async function runCrawl(opts: RunCrawlOptions): Promise<{
  notices: CrawledNotice[];
  report: CrawlReport;
  seen: string[];
}> {
  const startedAt = new Date();
  const concurrency = opts.concurrency ?? 3;
  const allNotices: CrawledNotice[] = [];
  const allSeen: string[] = [];
  const reports: SourceReport[] = [];

  await mapLimit(opts.sources, concurrency, async (source, i) => {
    const res = await crawlSource(source, opts);
    allNotices.push(...res.notices);
    allSeen.push(...res.seen);
    reports.push(res.report);
    opts.onProgress?.(res.report, i, opts.sources.length);
    await sleep(200);
  });

  const dedup = new Map<string, CrawledNotice>();
  for (const n of allNotices) {
    const key = canonicalNoticeKey(n.url);
    const prev = dedup.get(key);
    if (!prev || new Date(n.publishedAt) > new Date(prev.publishedAt)) {
      dedup.set(key, n);
    }
  }
  const merged = [...dedup.values()].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  const finishedAt = new Date();
  return {
    notices: merged,
    seen: allSeen,
    report: {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      sources: reports.sort((a, b) => a.name.localeCompare(b.name, "zh")),
      added: merged.length,
      total: merged.length,
    },
  };
}
