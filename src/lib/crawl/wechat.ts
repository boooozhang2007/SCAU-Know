/**
 * 微信公众号采集适配层。
 *
 * 支持四条可插拔路径，由环境变量 `WECHAT_MODE` 决定：
 * 1. `wemp`   —— 对接自建 `we-mp-rss` 服务（默认：当配置了 WEMP_BASE_URL 时自动启用），
 *                支持搜索公众号、通过单篇文章链接识别公众号、拉取全文 HTML、封面图与 Webhook 实时推送。
 * 2. `rss`    —— 通过标准 RSS/Atom 服务拉取公众号文章（支持 <enclosure> / media:content / 正文首图作封面）。
 * 3. `mp`     —— 历史消息接口模式（需运行期 __biz + pass_ticket）。
 * 4. `manual` —— 手工导入模式。
 */

import type { NoticeAttachment, NoticeBlock } from "@/lib/types";
import type { CrawlSource } from "./sources";
import {
  canonicalNoticeKey,
  fetchText,
  inferCategory,
  normalizeUrl,
  toneOf,
  type CrawledNotice,
} from "./engine";
import { decodeText, findBalancedTagClose, parseHtmlTable } from "./parse";
import { mirrorMedia } from "./media";
import { downloadAndParseAttachments } from "./attachments";

import {
  STANDALONE_WECHAT_ACCOUNTS,
  WECHAT_ACCOUNTS,
  WECHAT_BY_NAME,
  WECHAT_BY_SOURCE_ID,
  wechatGroupOf,
  type WechatAccount,
  type WechatAccountGroup,
} from "./wechat-accounts";

export {
  STANDALONE_WECHAT_ACCOUNTS,
  WECHAT_ACCOUNTS,
  WECHAT_BY_NAME,
  WECHAT_BY_SOURCE_ID,
  wechatGroupOf,
  type WechatAccount,
  type WechatAccountGroup,
};

export type WechatMode = "wemp" | "rss" | "mp" | "manual";

/** 解析当前启用的微信接入模式 */
export function wechatMode(): WechatMode {
  const explicit = (process.env.WECHAT_MODE ?? "").toLowerCase();
  if (explicit === "wemp" || explicit === "rss" || explicit === "mp" || explicit === "manual") {
    return explicit;
  }
  if (process.env.WEMP_BASE_URL) return "wemp";
  return "manual";
}

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function extractArticleTimeAndVenue(
  paragraphs: string[],
  publishedAt: string,
): { startsAt: string | null; venue: string | null } {
  const joined = paragraphs.join("\n");
  const pubYear = Number(publishedAt.slice(0, 4)) || new Date().getFullYear();

  const labelRe =
    /(?:活动时间|报告时间|讲座时间|会议时间|举办时间|开始时间|演出时间|比赛时间|宣讲时间|培训时间|时间)\s*[:：]\s*(?:(20\d{2})\s*[-/年.]\s*)?(\d{1,2})\s*[-/月.]\s*(\d{1,2})日?(?:[（(][^)）]{0,12}[)）])?\s*(上午|下午|晚上|晚)?\s*(?:(\d{1,2})\s*[:：点时]\s*(\d{2})?)?/;
  const m = joined.match(labelRe);
  let startsAt: string | null = null;
  if (m) {
    const y = m[1] ? Number(m[1]) : pubYear;
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      let hh = m[5] !== undefined ? Number(m[5]) : 0;
      const mm = m[6] !== undefined ? Number(m[6]) : 0;
      if ((m[4] === "下午" || m[4] === "晚上" || m[4] === "晚") && hh < 12) hh += 12;
      if (m[4] === "上午" && hh === 12) hh = 0;
      if (hh <= 23 && mm <= 59) {
        const pad = (n: number) => String(n).padStart(2, "0");
        startsAt = `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00+08:00`;
      }
    }
  }

  const venueM = joined.match(
    /(?:活动地点|举办地点|会议地点|报告地点|讲座地点|宣讲地点|培训地点|地点)\s*[:：]\s*([^\n。；;]{2,38})/,
  );
  const candidate = venueM?.[1].replace(/[，,].*$/, "").trim() ?? null;
  const venue =
    candidate && candidate.length >= 2 && !/^(另行通知|待定|见附件|详见|无)$/.test(candidate)
      ? candidate
      : null;

  return { startsAt, venue };
}

/**
 * 解析微信文章 HTML（或正文片段）为有序图文块 + 段落 + 潜在附件链接，
 * 并自动将微信防盗链图片镜像转存到本地/CDN，保证前端原图无损展示。
 */
export async function parseWechatHtmlToBlocks(
  html: string,
  articleUrl: string,
  { mirrorImages = true, parseAttachments = true } = {},
): Promise<{
  blocks: NoticeBlock[];
  paragraphs: string[];
  firstImage: string | null;
  attachments: NoticeAttachment[];
}> {
  if (!html) {
    return { blocks: [], paragraphs: [], firstImage: null, attachments: [] };
  }

  const scopeMatch = html.match(
    /<div[^>]+id=['"]js_content['"][^>]*>([\s\S]*?)<\/div>\s*(?:<script|<div[^>]+id=['"]js_tags|$)/i,
  );
  const scope = scopeMatch ? scopeMatch[1] : html;

  const blocks: NoticeBlock[] = [];
  const paragraphs: string[] = [];
  const seenPara = new Set<string>();
  const seenImg = new Set<string>();
  let firstImage: string | null = null;

  const pushImg = async (attrs: string) => {
    const rawSrc =
      attrs.match(/\bdata-src=['"]([^'"]+)['"]/i)?.[1] ??
      attrs.match(/\bdata-original-src=['"]([^'"]+)['"]/i)?.[1] ??
      attrs.match(/\bsrc=['"]([^'"]+)['"]/i)?.[1];
    if (!rawSrc || /^(data:|about:|javascript:)/i.test(rawSrc)) return;
    if (/res\.wx\.qq\.com\/.*\.(svg|gif|png)|emoji/i.test(rawSrc)) return;
    const cleanUrl = rawSrc.replace(/&amp;/g, "&").trim();
    if (!/^https?:\/\//i.test(cleanUrl) || seenImg.has(cleanUrl)) return;
    seenImg.add(cleanUrl);

    const alt = decodeText(attrs.match(/\balt=['"]([^'"]*)['"]/i)?.[1] ?? "");
    const localSrc = mirrorImages
      ? (await mirrorMedia(cleanUrl, "image", "https://mp.weixin.qq.com/")) ?? cleanUrl
      : cleanUrl;
    if (!firstImage) firstImage = localSrc;
    blocks.push({
      type: "image",
      src: localSrc,
      originalSrc: localSrc,
      alt: alt || undefined,
    });
  };

  // 按顺序遍历段、标题、列表项、HTML 表格和独立图片
  const tokenStartRe = /<(table|p|section|h[1-6]|li|img)\b([^>]*)>/gi;
  let pos = 0;
  while (pos < scope.length) {
    tokenStartRe.lastIndex = pos;
    const m = tokenStartRe.exec(scope);
    if (!m) break;

    const tag = m[1].toLowerCase();
    const openEnd = m.index + m[0].length;

    if (tag === "img") {
      await pushImg(m[2]);
      pos = Math.max(pos + 1, openEnd);
      continue;
    }

    if (m[0].endsWith("/>")) {
      pos = Math.max(pos + 1, openEnd);
      continue;
    }

    if (tag === "table") {
      const close = findBalancedTagClose(scope, openEnd, "table");
      if (!close) {
        pos = Math.max(pos + 1, openEnd);
        continue;
      }
      const tbl = parseHtmlTable(scope.slice(m.index, close.closeEnd));
      if (tbl) {
        blocks.push(tbl);
        pos = Math.max(pos + 1, close.closeEnd);
      } else {
        pos = Math.max(pos + 1, openEnd);
      }
      continue;
    }

    const close = findBalancedTagClose(scope, openEnd, tag);
    if (!close) {
      pos = Math.max(pos + 1, openEnd);
      continue;
    }
    const inner = scope.slice(openEnd, close.innerEnd);
    if (
      /<table\b/i.test(inner) ||
      (tag === "section" && /<(?:p|section)\b/i.test(inner)) ||
      (tag === "li" && /<(?:p|li)\b/i.test(inner))
    ) {
      pos = Math.max(pos + 1, openEnd);
      continue;
    }

    const txt = decodeText(inner);
    if (
      txt.length >= 6 &&
      !/^(点击上方|关注我们|长按识别|阅读原文|分享|点赞|在看|来源[丨｜|:]?$)/.test(txt)
    ) {
      const key = txt.replace(/\s+/g, "");
      if (!seenPara.has(key)) {
        seenPara.add(key);
        paragraphs.push(txt);
        blocks.push({ type: "text", text: txt });
      }
    }
    const imgRe = /<img\b([^>]+)>/gi;
    let im: RegExpExecArray | null;
    while ((im = imgRe.exec(inner))) {
      await pushImg(im[1]);
    }
    pos = Math.max(pos + 1, close.closeEnd);
  }

  const hasTableBlock = blocks.some((b) => b.type === "table");
  if (paragraphs.length === 0 && !hasTableBlock) {
    const plain = decodeText(scope);
    if (plain.length > 16) {
      const snippet = plain.slice(0, 2000);
      paragraphs.push(snippet);
      blocks.unshift({ type: "text", text: snippet });
    }
  }

  const attRefs: { name: string; url: string }[] = [];
  if (parseAttachments) {
    const attRe = /<a\b[^>]*href=['"]([^'"]+\.(?:pdf|docx?|xlsx?|csv|zip|rar)(?:\?[^'"]*)?)['"][^>]*>([\s\S]{0,200}?)<\/a>/gi;
    let am: RegExpExecArray | null;
    while ((am = attRe.exec(scope))) {
      try {
        const abs = new URL(am[1].replace(/&amp;/g, "&"), articleUrl).href;
        const name = decodeText(am[2]) || abs.split("/").pop() || "附件";
        attRefs.push({ name, url: abs });
      } catch {
        /* 忽略 */
      }
    }
  }

  const attachments =
    attRefs.length > 0 ? await downloadAndParseAttachments(attRefs, articleUrl) : [];

  return {
    blocks: blocks.slice(0, 64),
    paragraphs: paragraphs.slice(0, 20),
    firstImage,
    attachments,
  };
}

// ══════════════════════════════════════════════════════════════
// 1. `wemp` 模式：对接自建 we-mp-rss 服务
// ══════════════════════════════════════════════════════════════

export interface WempConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export function getWempConfig(): WempConfig | null {
  const baseUrl = (process.env.WEMP_BASE_URL ?? "").replace(/\/+$/, "");
  const username = process.env.WEMP_USERNAME ?? "admin";
  const password = process.env.WEMP_PASSWORD ?? "";
  if (!baseUrl || !password) return null;
  return { baseUrl, username, password };
}

let cachedWempToken: { token: string; expiresAt: number } | null = null;

export async function wempLogin(forceRefresh = false): Promise<string> {
  const cfg = getWempConfig();
  if (!cfg) throw new Error("未配置 WEMP_BASE_URL 或 WEMP_PASSWORD");
  if (!forceRefresh && cachedWempToken && Date.now() < cachedWempToken.expiresAt) {
    return cachedWempToken.token;
  }

  const form = new URLSearchParams();
  form.set("username", cfg.username);
  form.set("password", cfg.password);
  const res = await fetch(`${cfg.baseUrl}/api/v1/wx/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`we-mp-rss 登录失败: HTTP ${res.status}`);
  const payload = (await res.json()) as {
    code?: number;
    message?: string;
    data?: { access_token?: string; expires_in?: number };
  };
  const token = payload.data?.access_token;
  if (!token) throw new Error(`we-mp-rss 未返回 access_token: ${payload.message ?? ""}`);
  const ttlSec = Math.min(payload.data?.expires_in ?? 3600, 3600 * 12);
  cachedWempToken = { token, expiresAt: Date.now() + (ttlSec - 60) * 1000 };
  return token;
}

export async function wempRequest<T = unknown>(
  endpoint: string,
  init: RequestInit = {},
): Promise<T> {
  const cfg = getWempConfig();
  if (!cfg) throw new Error("未配置 WEMP_BASE_URL 或 WEMP_PASSWORD");

  const exec = async (token: string) =>
    fetch(`${cfg.baseUrl}${endpoint}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });

  let token = await wempLogin();
  let res = await exec(token);
  if (res.status === 401) {
    token = await wempLogin(true);
    res = await exec(token);
  }
  const text = await res.text();
  let json: { code?: number; message?: string; detail?: string; data?: T };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`we-mp-rss 返回非 JSON (${res.status}): ${text.slice(0, 160)}`);
  }
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(json.message || json.detail || `we-mp-rss 错误 (${res.status})`);
  }
  return (json.data !== undefined ? json.data : json) as T;
}

export interface WempSysInfo {
  coreVersion?: string;
  wxLogin: boolean;
  wxAppName?: string;
  expiryTime?: string;
  remainingSeconds?: number;
  articleTotal: number;
  hasContentCount: number;
  noContentCount: number;
  mpAllCount: number;
  queueRunning: boolean;
  pendingTasks: number;
  currentTaskName?: string;
}

export async function wempGetSysInfo(): Promise<WempSysInfo> {
  const [sysRaw, mainQRaw] = await Promise.all([
    wempRequest<Record<string, unknown>>("/api/v1/wx/sys/info"),
    wempRequest<Record<string, unknown>>("/api/v1/wx/task-queue/main/status").catch(
      () => null,
    ),
  ]);
  const wx = (sysRaw?.wx as Record<string, unknown> | undefined) ?? {};
  const wxInfo = (wx.info as Record<string, unknown> | undefined) ?? {};
  const extData = (wxInfo.ext_data as Record<string, unknown> | undefined) ?? {};
  const expiry = (wxInfo.expiry as Record<string, unknown> | undefined) ?? {};
  const article = (sysRaw?.article as Record<string, unknown> | undefined) ?? {};
  const queue = (sysRaw?.queue as Record<string, unknown> | undefined) ?? {};
  const currentTask = mainQRaw?.current_task as Record<string, unknown> | null | undefined;

  return {
    coreVersion:
      typeof sysRaw?.core_version === "string" ? sysRaw.core_version : undefined,
    wxLogin: Boolean(wx.login),
    wxAppName:
      typeof extData.wx_app_name === "string" && extData.wx_app_name.trim()
        ? extData.wx_app_name.trim()
        : undefined,
    expiryTime:
      typeof expiry.expiry_time === "string" && expiry.expiry_time.trim()
        ? expiry.expiry_time.trim()
        : undefined,
    remainingSeconds:
      typeof expiry.remaining_seconds === "number"
        ? expiry.remaining_seconds
        : undefined,
    articleTotal: Number(article.all_count ?? 0) || 0,
    hasContentCount: Number(article.has_content_count ?? 0) || 0,
    noContentCount: Number(article.no_content_count ?? 0) || 0,
    mpAllCount: Number(article.mp_all_count ?? 0) || 0,
    queueRunning: Boolean(mainQRaw?.is_running ?? queue.is_running ?? false),
    pendingTasks:
      Number(mainQRaw?.pending_count ?? queue.pending_tasks ?? 0) || 0,
    currentTaskName:
      currentTask && typeof currentTask.task_name === "string"
        ? currentTask.task_name
        : undefined,
  };
}

export async function wempGetConfigs(): Promise<Record<string, string>> {
  const data = await wempRequest<{
    list?: { config_key?: string; config_value?: unknown }[];
  }>("/api/v1/wx/configs?limit=100");
  const out: Record<string, string> = {};
  for (const item of data?.list ?? []) {
    if (item.config_key) {
      out[item.config_key] = String(item.config_value ?? "");
    }
  }
  return out;
}

export async function wempListTasks(): Promise<{
  total: number;
  list: Record<string, unknown>[];
}> {
  const data = await wempRequest<{
    total?: number;
    list?: Record<string, unknown>[];
  }>("/api/v1/wx/message_tasks?limit=20");
  const list = data?.list ?? [];
  return {
    total: typeof data?.total === "number" ? data.total : list.length,
    list,
  };
}

export async function wempClearQueue(
  queueType: "main" | "content" = "main",
): Promise<unknown> {
  return wempRequest(
    `/api/v1/wx/task-queue/clear?queue_type=${encodeURIComponent(queueType)}`,
    { method: "POST" },
  );
}

export interface WempMp {
  id: string;
  mp_name: string;
  mp_cover?: string;
  mp_intro?: string;
  status?: number;
  article_count?: number;
  sync_time?: string;
  update_time?: string;
}

export interface WempArticle {
  id: string;
  mp_id: string;
  mp_name?: string;
  title: string;
  pic_url?: string;
  url?: string;
  description?: string;
  publish_time?: number | string;
  created_at?: string;
  content?: string;
}

export async function wempListMps(): Promise<WempMp[]> {
  const all: WempMp[] = [];
  const pageSize = 50;
  for (let offset = 0; offset < 500; offset += pageSize) {
    const data = await wempRequest<{ list?: WempMp[] }>(
      `/api/v1/wx/mps?limit=${pageSize}&offset=${offset}`,
    );
    const list = data?.list ?? [];
    all.push(...list);
    if (list.length < pageSize) break;
  }
  return all;
}

export async function wempSearchMp(kw: string): Promise<
  {
    fakeid: string;
    nickname: string;
    alias?: string;
    round_head_img?: string;
    signature?: string;
  }[]
> {
  const data = await wempRequest<{
    list?: {
      fakeid: string;
      nickname: string;
      alias?: string;
      round_head_img?: string;
      signature?: string;
    }[];
  }>(`/api/v1/wx/mps/search/${encodeURIComponent(kw)}?limit=10&offset=0`);
  return data?.list ?? [];
}

export async function wempAddMpByArticle(articleUrl: string): Promise<{
  resolved: Record<string, unknown>;
  added: unknown;
}> {
  const resolved = await wempRequest<Record<string, unknown>>(
    `/api/v1/wx/mps/by_article?url=${encodeURIComponent(articleUrl)}`,
    { method: "POST" },
  );

  // `by_article` 返回的结构在不同 we-mp-rss 版本中可能是 mp_info 或扁平字段
  const mpObj = (resolved.mp_info ?? resolved) as Record<string, unknown>;
  const mp_name = String(mpObj.mp_name ?? mpObj.nickname ?? mpObj.name ?? "").trim();
  const mp_id = String(
    mpObj.biz ?? mpObj.fakeid ?? mpObj.mp_id ?? resolved.mp_id ?? mpObj.id ?? "",
  ).trim();
  const mp_cover = String(
    mpObj.logo ?? mpObj.mp_cover ?? mpObj.round_head_img ?? mpObj.avatar ?? "",
  ).trim();
  const mp_intro = String(mpObj.mp_intro ?? mpObj.signature ?? "").trim();

  if (!mp_name) {
    return { resolved, added: resolved };
  }

  try {
    const added = await wempRequest("/api/v1/wx/mps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mp_name,
        ...(mp_id ? { mp_id } : {}),
        ...(mp_cover ? { mp_cover, avatar: mp_cover } : {}),
        ...(mp_intro ? { mp_intro: mp_intro.slice(0, 250) } : {}),
      }),
    });
    return { resolved, added };
  } catch (e) {
    // 若已存在则视为成功
    const msg = e instanceof Error ? e.message : String(e);
    if (/exist|已存在|duplicate/i.test(msg)) {
      return { resolved, added: { alreadyExists: true, mp_name, mp_id } };
    }
    throw e;
  }
}

export async function wempAddMpByKeyword(kw: string): Promise<{
  matched: { fakeid: string; nickname: string; alias?: string; signature?: string };
  result: unknown;
}> {
  const candidates = await wempSearchMp(kw);
  if (candidates.length === 0) {
    throw new Error(`未搜索到公众号：${kw}`);
  }
  const exact =
    candidates.find((c) => c.nickname === kw) ??
    candidates.find((c) => c.nickname.includes(kw)) ??
    candidates[0];

  try {
    const result = await wempRequest("/api/v1/wx/mps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mp_name: exact.nickname,
        mp_id: exact.fakeid,
        mp_cover: exact.round_head_img ?? "",
        avatar: exact.round_head_img ?? "",
        mp_intro: (exact.signature ?? "").slice(0, 250),
      }),
    });
    return { matched: exact, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/exist|已存在|duplicate/i.test(msg)) {
      return { matched: exact, result: { alreadyExists: true } };
    }
    throw e;
  }
}

export async function wempTriggerUpdate(mpId: string, startPage = 0, endPage = 1) {
  return wempRequest(`/api/v1/wx/mps/update/${encodeURIComponent(mpId)}?start_page=${startPage}&end_page=${endPage}`);
}

export async function wempFetchArticles(
  limit = 50,
  offset = 0,
  mpId?: string,
  hasContent = true,
): Promise<WempArticle[]> {
  const all: WempArticle[] = [];
  let curOffset = offset;
  let remaining = Math.max(1, limit);

  while (remaining > 0) {
    const pageLimit = Math.min(remaining, 50);
    const qs = new URLSearchParams({
      limit: String(pageLimit),
      offset: String(curOffset),
    });
    if (hasContent) qs.set("has_content", "true");
    if (mpId) qs.set("mp_id", mpId);
    const data = await wempRequest<{ list?: WempArticle[] }>(
      `/api/v1/wx/articles?${qs.toString()}`,
    );
    const list = data?.list ?? [];
    all.push(...list);
    if (list.length < pageLimit) break;
    curOffset += list.length;
    remaining -= list.length;
  }
  return all;
}

export async function wempFetchArticleDetail(articleId: string): Promise<WempArticle> {
  return wempRequest<WempArticle>(
    `/api/v1/wx/articles/${encodeURIComponent(articleId)}?content=true`,
  );
}

function parsePublishIso(raw: number | string | undefined): string {
  if (typeof raw === "number" && raw > 0) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return new Date(ms).toISOString();
  }
  if (typeof raw === "string" && raw.trim()) {
    if (/^\d+$/.test(raw.trim())) {
      const n = Number(raw.trim());
      return new Date(n < 1e12 ? n * 1000 : n).toISOString();
    }
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function resolveAccountMeta(
  mpName: string,
  sources: Map<string, CrawlSource>,
): { account: WechatAccount | undefined; source: CrawlSource | undefined } {
  const cleanName = mpName.trim();
  const normalized = cleanName.replace(
    /^(?:SCAU|华南农大|华农大|华农)(?!(?:青年|学工|勤工|党建|国际|公管|表演|生活|小助|助手|微生活|共享|表白|万能|财会|继教|考研|实习))/i,
    "华南农业大学",
  );

  // 1) 精确查表（优先原名，其次规范化名称）
  let account = WECHAT_BY_NAME.get(cleanName) ?? WECHAT_BY_NAME.get(normalized);

  // 2) 长名称包含兜底（跳过通用“华南农业大学”，避免所有新号回落到主站）
  if (!account) {
    const specific = WECHAT_ACCOUNTS.filter((a) => a.name !== "华南农业大学").sort(
      (a, b) => b.name.length - a.name.length,
    );
    account = specific.find(
      (a) =>
        cleanName.includes(a.name) ||
        normalized.includes(a.name) ||
        (a.name.length >= 4 && a.name.includes(cleanName)),
    );
  }

  let source = account?.sourceId ? sources.get(account.sourceId) : undefined;
  if (!source) {
    // 若无精确映射，尝试用别名归一化匹配对应学校官方站点（不主动误归属给 main）
    const nonMain = [...sources.values()].filter((s) => s.id !== "main");
    for (const s of nonMain) {
      if (s.wechat === cleanName || s.name === cleanName || s.name === normalized) {
        source = s;
        break;
      }
      if (s.alias?.some((al) => cleanName.includes(al) || normalized.includes(al))) {
        source = s;
        break;
      }
    }
    if (!source && cleanName === "华南农业大学") {
      source = sources.get("main");
    }
  }
  return { account, source };
}

/**
 * 从 we-mp-rss 拉取公众号文章并转换为统一 CrawledNotice（含转存封面、图文块、附件解析）。
 */
export async function crawlWechatWemp(
  sources: Map<string, CrawlSource>,
  {
    limit = 60,
    mirrorImages = true,
    parseAttachments = true,
    syncBeforePull = false,
  }: {
    limit?: number;
    mirrorImages?: boolean;
    parseAttachments?: boolean;
    syncBeforePull?: boolean;
  } = {},
): Promise<{
  notices: CrawledNotice[];
  mpCount: number;
  errors: { account: string; error: string }[];
}> {
  const errors: { account: string; error: string }[] = [];
  const mps = await wempListMps();
  const mpById = new Map(mps.map((m) => [m.id, m]));

  if (syncBeforePull && mps.length > 0) {
    // 防微信 200013 频控：优先挑最久未同步的 10 个公众号，每次间隔 1.5s
    const batch = [...mps]
      .sort((a, b) => (Number(a.sync_time ?? 0) || 0) - (Number(b.sync_time ?? 0) || 0))
      .slice(0, 10);
    for (let i = 0; i < batch.length; i++) {
      const mp = batch[i];
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      try {
        await wempTriggerUpdate(mp.id, 0, 1);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ account: mp.mp_name, error: msg });
        if (/200013|freq|频繁|limit/i.test(msg)) break;
      }
    }
  }

  let articles = await wempFetchArticles(limit, 0, undefined, true);
  if (articles.length === 0) {
    // 若 has_content=true 暂时为空，回退拉取全部列表再按单篇取详情
    articles = await wempFetchArticles(limit, 0, undefined, false);
  }

  const notices: CrawledNotice[] = [];
  const seenKeys = new Set<string>();

  for (const rawArt of articles) {
    try {
      const mpName = rawArt.mp_name || mpById.get(rawArt.mp_id)?.mp_name || "华南农业大学";
      const { account, source } = resolveAccountMeta(mpName, sources);
      const articleUrl = normalizeUrl(
        rawArt.url || `https://mp.weixin.qq.com/s/${rawArt.id}`,
      );
      const canonKey = canonicalNoticeKey(articleUrl);
      if (seenKeys.has(canonKey)) continue;
      seenKeys.add(canonKey);

      let art = rawArt;
      if (!art.content) {
        try {
          art = await wempFetchArticleDetail(rawArt.id);
        } catch {
          /* 保留基础元数据 */
        }
      }

      const publishedAt = parsePublishIso(art.publish_time ?? art.created_at);
      const parsed = await parseWechatHtmlToBlocks(art.content ?? "", articleUrl, {
        mirrorImages,
        parseAttachments,
      });

      let cover: string | undefined;
      if (art.pic_url) {
        cover = mirrorImages
          ? (await mirrorMedia(art.pic_url, "cover", "https://mp.weixin.qq.com/")) ?? undefined
          : art.pic_url;
      }
      if (!cover && parsed.firstImage) {
        cover = parsed.firstImage;
      }

      const title = decodeText(art.title).slice(0, 180);
      if (!title) continue;

      const baseCategory = account?.category ?? source?.category ?? "campus";
      const category = inferCategory(
        source ? { ...source, category: baseCategory } : ({ category: baseCategory } as CrawlSource),
        title,
      );
      const summary =
        decodeText(art.description ?? "").slice(0, 180) ||
        parsed.paragraphs[0]?.slice(0, 180) ||
        title;

      const sched = extractArticleTimeAndVenue(parsed.paragraphs, publishedAt);
      const sourceDisplay = source?.name ?? mpName;

      notices.push({
        id: `wx_${account?.sourceId ?? rawArt.mp_id}_${hashStr(canonKey)}`,
        title,
        url: articleUrl,
        source: sourceDisplay,
        sourceId: `wx_${account?.sourceId ?? rawArt.mp_id}`,
        category,
        tone: toneOf(category),
        publishedAt,
        startsAt: sched.startsAt,
        endsAt: null,
        venue: sched.venue,
        registration: /报名|申请|预约|征集|招募/.test(title),
        summary,
        paragraphs: parsed.paragraphs.length > 0 ? parsed.paragraphs : [summary],
        cover,
        blocks: parsed.blocks.length > 0 ? parsed.blocks : undefined,
        attachments: parsed.attachments.length > 0 ? parsed.attachments : undefined,
        isNew: false,
        fetchedAt: new Date().toISOString(),
      });
    } catch (e) {
      errors.push({
        account: rawArt.mp_name || rawArt.mp_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { notices, mpCount: mps.length, errors };
}

// ══════════════════════════════════════════════════════════════
// 2. `rss` 模式（保留并补全封面图提取）
// ══════════════════════════════════════════════════════════════

interface RssItem {
  title: string;
  link: string;
  pubDate?: string;
  description?: string;
  rawHtml?: string;
  cover?: string;
  author?: string;
}

export function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const entries = blocks.length ? blocks : (xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []);

  for (const b of entries) {
    const title = pick(b, "title");
    const link =
      pick(b, "link") ||
      (b.match(/<link[^>]+href=['"]([^'"]+)['"]/i)?.[1] ?? "");
    const pubDate =
      pick(b, "pubDate") || pick(b, "published") || pick(b, "updated");
    const rawHtml =
      pick(b, "content:encoded") || pick(b, "description") || pick(b, "summary");
    const enclosureCover =
      b.match(/<enclosure[^>]+type=['"]image\/[^'"]+['"][^>]+url=['"]([^'"]+)['"]/i)?.[1] ??
      b.match(/<media:(?:content|thumbnail)[^>]+url=['"]([^'"]+)['"]/i)?.[1] ??
      rawHtml.match(/<img[^>]+(?:data-src|src)=['"]([^'"]+)['"]/i)?.[1];
    const author = pick(b, "author") || pick(b, "dc:creator");
    if (!title || !link) continue;
    items.push({
      title: cleanXml(title),
      link: cleanXml(link),
      pubDate: pubDate ? cleanXml(pubDate) : undefined,
      description: rawHtml ? cleanXml(rawHtml) : undefined,
      rawHtml: rawHtml || undefined,
      cover: enclosureCover ? enclosureCover.replace(/&amp;/g, "&") : undefined,
      author: author ? cleanXml(author) : undefined,
    });
  }
  return items;
}

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function cleanXml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function toIso(dateStr: string | undefined): string {
  if (!dateStr) return new Date().toISOString();
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

export async function rssToNotices(
  items: RssItem[],
  account: WechatAccount,
  source: CrawlSource | undefined,
): Promise<CrawledNotice[]> {
  const out: CrawledNotice[] = [];
  for (const it of items) {
    const category =
      account.category ?? (source ? inferCategory(source, it.title) : "campus");
    const url = normalizeUrl(it.link);
    const canonKey = canonicalNoticeKey(url);
    const id = `wx_${account.sourceId ?? account.name}_${hashStr(canonKey)}`;
    const parsed = it.rawHtml
      ? await parseWechatHtmlToBlocks(it.rawHtml, url, {
          mirrorImages: true,
          parseAttachments: false,
        })
      : { blocks: [], paragraphs: [], firstImage: null, attachments: [] };
    const cover = it.cover
      ? (await mirrorMedia(it.cover, "cover", "https://mp.weixin.qq.com/")) ?? undefined
      : parsed.firstImage ?? undefined;

    out.push({
      id,
      title: it.title.slice(0, 180),
      url,
      source: account.name,
      sourceId: `wx_${account.sourceId ?? account.name}`,
      category,
      tone: toneOf(category),
      publishedAt: toIso(it.pubDate),
      startsAt: null,
      endsAt: null,
      venue: null,
      registration: /报名|申请|预约|征集|招募/.test(it.title),
      summary: (it.description ?? it.title).slice(0, 160),
      paragraphs: parsed.paragraphs.length ? parsed.paragraphs : it.description ? [it.description] : [],
      cover,
      blocks: parsed.blocks.length ? parsed.blocks : undefined,
      isNew: false,
      fetchedAt: new Date().toISOString(),
    });
  }
  return out;
}

export async function crawlWechatRss(
  sources: Map<string, CrawlSource>,
): Promise<{ notices: CrawledNotice[]; errors: { account: string; error: string }[] }> {
  const notices: CrawledNotice[] = [];
  const errors: { account: string; error: string }[] = [];

  for (const acc of WECHAT_ACCOUNTS) {
    const rss = acc.rss ?? process.env[`WECHAT_RSS_${(acc.wechatId ?? acc.name).toUpperCase()}`];
    if (!rss) continue;
    try {
      const xml = await fetchText(rss, { timeoutMs: 20000, retries: 1 });
      const items = parseRss(xml);
      notices.push(...(await rssToNotices(items, acc, sources.get(acc.sourceId ?? ""))));
    } catch (e) {
      errors.push({ account: acc.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { notices, errors };
}

export async function crawlWechatMp(
  account: WechatAccount,
  sources: Map<string, CrawlSource>,
  offset = 0,
  count = 10,
): Promise<CrawledNotice[]> {
  const biz = account.biz ?? process.env[`WECHAT_BIZ_${(account.wechatId ?? account.name).toUpperCase()}`];
  const ticket = process.env.WECHAT_PASS_TICKET;
  if (!biz || !ticket) {
    throw new Error("缺少 __biz 或 pass_ticket，无法调用公众号历史文章接口");
  }
  const url =
    `https://mp.weixin.qq.com/mp/profile_ext?action=getmsg&__biz=${encodeURIComponent(biz)}` +
    `&f=json&offset=${offset}&count=${count}&is_ok=1&pass_ticket=${encodeURIComponent(ticket)}`;

  const raw = await fetchText(url, { timeoutMs: 20000, retries: 0 });
  const payload = JSON.parse(raw) as {
    list?: {
      comm_msg_info?: { datetime?: number; id?: number };
      app_msg_ext_info?: { title?: string; content_url?: string; digest?: string; cover?: string };
    }[];
  };

  const list = payload.list ?? [];
  const out: CrawledNotice[] = [];
  for (const entry of list) {
    const info = entry.app_msg_ext_info;
    const meta = entry.comm_msg_info;
    if (!info?.title || !info.content_url) continue;
    const link = normalizeUrl(info.content_url.replace(/\\\//g, "/"));
    const category =
      account.category ??
      (sources.get(account.sourceId ?? "")
        ? inferCategory(sources.get(account.sourceId ?? "")!, info.title)
        : "campus");
    const cover = info.cover
      ? (await mirrorMedia(info.cover, "cover", "https://mp.weixin.qq.com/")) ?? undefined
      : undefined;

    out.push({
      id: `wx_${account.sourceId ?? account.name}_${meta?.id ?? hashStr(canonicalNoticeKey(link))}`,
      title: info.title.slice(0, 180),
      url: link,
      source: account.name,
      sourceId: `wx_${account.sourceId ?? account.name}`,
      category,
      tone: toneOf(category),
      publishedAt: meta?.datetime
        ? new Date(meta.datetime * 1000).toISOString()
        : new Date().toISOString(),
      startsAt: null,
      endsAt: null,
      venue: null,
      registration: /报名|申请|预约|征集|招募/.test(info.title),
      summary: (info.digest ?? info.title).slice(0, 160),
      paragraphs: info.digest ? [info.digest] : [],
      cover,
      isNew: false,
      fetchedAt: new Date().toISOString(),
    });
  }
  return out;
}

export interface ManualRecord {
  title: string;
  url: string;
  account: string;
  publishedAt?: string;
  summary?: string;
  category?: string;
  cover?: string;
}

export function manualToNotices(
  records: ManualRecord[],
  sources: Map<string, CrawlSource>,
): CrawledNotice[] {
  return records.map((r) => {
    const acc = WECHAT_BY_NAME.get(r.account);
    const src = acc?.sourceId ? sources.get(acc.sourceId) : undefined;
    const category =
      r.category ?? acc?.category ?? (src ? inferCategory(src, r.title) : "campus");
    const url = normalizeUrl(r.url);
    return {
      id: `wx_${acc?.sourceId ?? r.account}_${hashStr(canonicalNoticeKey(url))}`,
      title: r.title.slice(0, 180),
      url,
      source: r.account,
      sourceId: `wx_${acc?.sourceId ?? r.account}`,
      category,
      tone: toneOf(category),
      publishedAt: r.publishedAt
        ? new Date(r.publishedAt).toISOString()
        : new Date().toISOString(),
      startsAt: null,
      endsAt: null,
      venue: null,
      registration: /报名|申请|预约|征集|招募/.test(r.title),
      summary: (r.summary ?? r.title).slice(0, 160),
      paragraphs: r.summary ? [r.summary] : [],
      cover: r.cover,
      isNew: false,
      fetchedAt: new Date().toISOString(),
    };
  });
}
