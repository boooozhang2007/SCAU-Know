import type { Notice } from "./types";
import { CATEGORIES, CATEGORY_MAP, SUBJECT_MAP, type SubjectSlug } from "./site";

const WEEK_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 站点统一时区：Asia/Shanghai (UTC+8)，固定偏移，避免服务端/客户端不一致 */
const TZ_OFFSET = 8 * 60;

export function toCstParts(iso: string) {
  const d = new Date(iso);
  const shifted = new Date(d.getTime() + TZ_OFFSET * 60 * 1000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    hh: shifted.getUTCHours(),
    mm: shifted.getUTCMinutes(),
    w: shifted.getUTCDay(),
  };
}

/** 以 CST 计算的“今天”零点（用 UTC 毫秒承载） */
export function todayCst(now = new Date()): Date {
  const shifted = new Date(now.getTime() + TZ_OFFSET * 60 * 1000);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
}

export function dayDiffCst(iso: string, now = new Date()): number {
  const t = toCstParts(iso);
  const target = Date.UTC(t.y, t.m - 1, t.d);
  const base = todayCst(now).getTime();
  return Math.round((target - base) / 86400000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 卡片上的短时间：今天 10:30 / 昨天 16:40 / 前天 / 11月18日 */
export function formatShortTime(
  iso: string,
  now = new Date(),
  lang: "zh" | "en" = "zh",
): string {
  const { hh, mm, m, d } = toCstParts(iso);
  const diff = dayDiffCst(iso, now);
  const hasClock = !(hh === 0 && mm === 0);
  const clock = `${pad(hh)}:${pad(mm)}`;

  if (lang === "en") {
    if (diff === 0) return hasClock ? `Today ${clock}` : "Today";
    if (diff === -1) return hasClock ? `Yesterday ${clock}` : "Yesterday";
    if (diff === 1) return hasClock ? `Tomorrow ${clock}` : "Tomorrow";
    return `${m}/${d}`;
  }

  if (!hasClock) {
    if (diff === 0) return "今天";
    if (diff === -1) return "昨天";
    if (diff === -2) return "前天";
    if (diff === 1) return "明天";
    return `${m}月${d}日`;
  }
  if (diff === 0) return `今天 ${clock}`;
  if (diff === -1) return `昨天 ${clock}`;
  if (diff === -2) return `前天 ${clock}`;
  if (diff === 1) return `明天 ${clock}`;
  return `${m}月${d}日`;
}

/** 移动端紧凑写法 */
export function formatShortTimeCompact(
  iso: string,
  now = new Date(),
  lang: "zh" | "en" = "zh",
): string {
  const { hh, mm, m, d } = toCstParts(iso);
  const diff = dayDiffCst(iso, now);
  const hasClock = !(hh === 0 && mm === 0);
  const clock = `${pad(hh)}:${pad(mm)}`;
  if (lang === "en") {
    if (diff === 0) return hasClock ? clock : "Today";
    if (diff === -1) return "Yest";
    return `${m}/${d}`;
  }
  if (!hasClock) {
    if (diff === 0) return "今天";
    if (diff === -1) return "昨天";
    if (diff === -2) return "前天";
    if (diff === 1) return "明天";
    return `${m}/${d}`;
  }
  if (diff === 0) return `今天${clock}`;
  if (diff === -1) return `昨天${clock}`;
  if (diff === -2) return `前天${clock}`;
  if (diff === 1) return `明天${clock}`;
  return `${m}/${d}`;
}

/** 详情页完整时间：2026-11-21 10:30（无时分则 2026年11月21日 周六） */
export function formatFullTime(iso: string, lang: "zh" | "en" = "zh"): string {
  const { y, m, d, hh, mm, w } = toCstParts(iso);
  if (lang === "en") {
    const base = `${y}-${pad(m)}-${pad(d)} (${WEEK_EN[w]})`;
    return hh === 0 && mm === 0 ? base : `${base} ${pad(hh)}:${pad(mm)}`;
  }
  const base = `${y}年${m}月${d}日 ${WEEK_ZH[w]}`;
  return hh === 0 && mm === 0 ? base : `${base} ${pad(hh)}:${pad(mm)}`;
}

/** 活动时间区间 */
export function formatRange(
  startsAt?: string | null,
  endsAt?: string | null,
  lang: "zh" | "en" = "zh",
): string | null {
  if (!startsAt) return null;
  const s = toCstParts(startsAt);
  const hasStartClock = !(s.hh === 0 && s.mm === 0);
  const sDate = lang === "en" ? `${s.m}/${s.d}` : `${s.m}月${s.d}日`;
  const sText = hasStartClock ? `${sDate} ${pad(s.hh)}:${pad(s.mm)}` : sDate;
  if (!endsAt) return sText;
  const e = toCstParts(endsAt);
  const hasEndClock = !(e.hh === 0 && e.mm === 0);
  const sameDay = s.y === e.y && s.m === e.m && s.d === e.d;
  if (sameDay) {
    return hasEndClock ? `${sText}–${pad(e.hh)}:${pad(e.mm)}` : sText;
  }
  const eDate = lang === "en" ? `${e.m}/${e.d}` : `${e.m}月${e.d}日`;
  const eText = hasEndClock ? `${eDate} ${pad(e.hh)}:${pad(e.mm)}` : eDate;
  return `${sText} — ${eText}`;
}

/** 紧凑活动开始徽标（用于卡片展示） */
export function formatEventChip(startsAt: string, lang: "zh" | "en" = "zh"): string {
  const s = toCstParts(startsAt);
  const hasClock = !(s.hh === 0 && s.mm === 0);
  const date = lang === "en" ? `${s.m}/${s.d}` : `${s.m}月${s.d}日`;
  return hasClock ? `${date} ${pad(s.hh)}:${pad(s.mm)}` : date;
}

export function isToday(iso: string, now = new Date()): boolean {
  return dayDiffCst(iso, now) === 0;
}

/** 日历分组用：CST 日期 key (YYYY-MM-DD) */
export function cstDateKey(iso: string): string {
  const { y, m, d } = toCstParts(iso);
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function cstTimeLabel(iso: string, lang: "zh" | "en" = "zh"): {
  text: string;
  allDay: boolean;
} {
  const { hh, mm } = toCstParts(iso);
  if (hh === 0 && mm === 0) {
    return { text: lang === "en" ? "All day" : "全天", allDay: true };
  }
  return { text: `${pad(hh)}:${pad(mm)}`, allDay: false };
}

export function cstDateHead(
  key: string,
  lang: "zh" | "en" = "zh",
): {
  date: string;
  week: string;
  dayNum: number;
  monthNum: number;
} {
  const [y, m, d] = key.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return {
    date: lang === "en" ? `${m}/${d}` : `${m}月${d}日`,
    week: lang === "en" ? WEEK_EN[w] : WEEK_ZH[w],
    dayNum: d,
    monthNum: m,
  };
}

/** 计算包含 key 的周一日期 key（周一作为一周起始） */
export function mondayOfKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + offset);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDaysKey(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function formatWeekRange(mondayKey: string, lang: "zh" | "en" = "zh"): string {
  const sundayKey = addDaysKey(mondayKey, 6);
  const a = cstDateHead(mondayKey, lang);
  const b = cstDateHead(sundayKey, lang);
  return `${a.date} — ${b.date}`;
}

/** 按发布时间倒序（单次预解析时间戳，避免排序比较器重复构造 Date） */
export function sortByPublished(list: Notice[]): Notice[] {
  return list
    .map((n) => ({ n, ts: Date.parse(n.publishedAt) || 0 }))
    .sort((a, b) => b.ts - a.ts)
    .map((x) => x.n);
}

/** 统计每个分类的条目数 */
export function countByCategory(list: Notice[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of list) m.set(n.category, (m.get(n.category) ?? 0) + 1);
  return m;
}

/** 统计来源 */
export function countBySource(list: Notice[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of list) m.set(n.source, (m.get(n.source) ?? 0) + 1);
  return m;
}

export function categoryName(slug: string, lang: "zh" | "en" = "zh"): string {
  const c = CATEGORY_MAP.get(slug);
  if (!c) return slug;
  return lang === "en" ? c.nameEn : c.name;
}

export function subjectName(slug: SubjectSlug, lang: "zh" | "en" = "zh"): string {
  const s = SUBJECT_MAP.get(slug);
  if (!s) return slug;
  return lang === "en" ? s.nameEn : s.name;
}

/** 板块顺序：活动在前，通知在后，各按 CATEGORIES 声明顺序 */
export function sectionOrder(): string[] {
  return CATEGORIES.map((c) => c.slug);
}

/** 清理 WebPlus 正文里常见的中文字/数字被拆出空格的排版脏数据 */
export function cleanTextSpacing(text: string): string {
  return text
    .replace(/(?<=\d)\s+(?=\d)/g, "")
    .replace(/(\d)\s+([年月日时分秒])/g, "$1$2")
    .replace(/([年月日])\s+(\d)/g, "$1$2")
    .replace(/([\u4e00-\u9fa5])\s+([，。、；：！？）》】」』])/g, "$1$2")
    .replace(/([（《【「『])\s+([\u4e00-\u9fa5])/g, "$1$2")
    .replace(/\s+[:：]\s*/g, "：")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 关键词检索：标题、来源、摘要、分类名、学科名、地点、正文表格 */
export function matchesQuery(
  n: Notice,
  q: string,
  extraSearchText?: string,
): boolean {
  if (!q) return true;
  const kw = q.trim().toLowerCase();
  if (!kw) return true;
  const tableText = (n.blocks ?? [])
    .filter((b): b is Extract<typeof b, { type: "table" }> => b.type === "table")
    .flatMap((t) => [
      t.caption ?? "",
      ...t.headers,
      ...t.rows.flatMap((r) => r.map((c) => c.text)),
    ])
    .join(" ");
  const hay = [
    n.title,
    n.source,
    n.summary,
    categoryName(n.category, "zh"),
    categoryName(n.category, "en"),
    subjectName(n.subject, "zh"),
    n.venue ?? "",
    n.searchSnippet ?? "",
    extraSearchText ?? "",
    tableText,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(kw);
}

/** 判断摘要是否比标题提供了额外信息，避免卡片与详情页重复显示相同一句话 */
export function meaningfulSummary(title: string, summary: string): string | null {
  const s = summary.trim();
  if (!s || s.length < 14) return null;
  const norm = (str: string) => str.replace(/[\s「」『』【】《》“”"':：，。、\-—]/g, "");
  const nt = norm(title);
  const ns = norm(s);
  if (!ns || nt === ns || nt.includes(ns)) return null;
  if (s.length <= 18 && /[:：]$/.test(s)) return null;
  return s;
}
