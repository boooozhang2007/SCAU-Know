import type { Notice } from "./types";
import { CATEGORIES, CATEGORY_MAP, SUBJECT_MAP, type SubjectSlug } from "./site";

const WEEK_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 站点统一时区：Asia/Shanghai (UTC+8)，固定偏移，避免服务端/客户端不一致 */
const TZ_OFFSET = 8 * 60;

const pad = (n: number) => String(n).padStart(2, "0");

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}

/**
 * 将各种形态的日期/时间字符串规范化为带 `+08:00` 的标准 ISO 8601 字符串：
 * - 纯日期 `2026-11-25` → `2026-11-25T00:00:00+08:00`（防止被 JS 按 UTC 解析偏移成 08:00）
 * - 无时区时间 `2026-11-25 14:30` / `2026-11-5T9:00` → 自动补零并绑定 `+08:00`
 * - 带 `Z` 或偏移量的标准 ISO → 转为北京时间 `+08:00` 输出
 * - 非法日历日期（如 2 月 30 日）返回 null，避免 NaN 破坏排序
 */
export function normalizeCstIso(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;

  // 1) 完整 ISO 带明确时区（Z 或 ±HH:MM / ±HHMM），且允许月/日/时未补零
  const withTz = s.match(
    /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?[T\s]+(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i,
  );
  if (withTz) {
    const y = Number(withTz[1]);
    const mo = Number(withTz[2]);
    const d = Number(withTz[3]);
    const hh = Number(withTz[4]);
    const mm = Number(withTz[5]);
    const ss = Number(withTz[6] ?? "0");
    if (!isValidCalendarDate(y, mo, d) || hh > 23 || mm > 59 || ss > 59) return null;
    let tz = withTz[7].toUpperCase();
    if (/^[+-]\d{4}$/.test(tz)) tz = `${tz.slice(0, 3)}:${tz.slice(3)}`;
    if (tz === "+08:00") {
      return `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}+08:00`;
    }
    const isoCandidate = `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}${tz}`;
    const ms = Date.parse(isoCandidate);
    if (Number.isNaN(ms)) return null;
    const shifted = new Date(ms + TZ_OFFSET * 60 * 1000);
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}+08:00`;
  }

  // 2) 无时区日期时间（按北京时间解释）
  const localDt = s.match(
    /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[（(][^)）]{0,10}[)）])?[T\s]+(上午|下午|晚上|晚|中午|凌晨)?\s*(\d{1,2})[:：点时](\d{2})(?:[:：](\d{2}))?$/,
  );
  if (localDt) {
    const y = Number(localDt[1]);
    const mo = Number(localDt[2]);
    const d = Number(localDt[3]);
    const period = localDt[4];
    let hh = Number(localDt[5]);
    const mm = Number(localDt[6]);
    const ss = Number(localDt[7] ?? "0");
    if ((period === "下午" || period === "晚上" || period === "晚") && hh >= 1 && hh <= 11) {
      hh += 12;
    } else if (period === "凌晨" && hh === 12) {
      hh = 0;
    }
    if (!isValidCalendarDate(y, mo, d) || hh > 23 || mm > 59 || ss > 59) return null;
    return `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}+08:00`;
  }

  // 3) 纯日期（按北京时间零点 / 全天）
  const dateOnly = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const mo = Number(dateOnly[2]);
    const d = Number(dateOnly[3]);
    if (!isValidCalendarDate(y, mo, d)) return null;
    return `${y}-${pad(mo)}-${pad(d)}T00:00:00+08:00`;
  }

  return null;
}

/** 校验并修复活动起止时间区间（杜绝 10:30–00:30 或 endsAt < startsAt 等异常） */
export function sanitizeEventRange(
  rawStartsAt?: string | null,
  rawEndsAt?: string | null,
): { startsAt: string | null; endsAt: string | null } {
  const startsAt = normalizeCstIso(rawStartsAt);
  if (!startsAt) return { startsAt: null, endsAt: null };
  let endsAt = normalizeCstIso(rawEndsAt);
  if (!endsAt) return { startsAt, endsAt: null };

  const sMs = Date.parse(startsAt);
  const eMs = Date.parse(endsAt);
  if (Number.isNaN(sMs) || Number.isNaN(eMs)) {
    return { startsAt, endsAt: null };
  }

  if (eMs <= sMs) {
    const sp = toCstParts(startsAt);
    const ep = toCstParts(endsAt);
    const sameDay = sp.y === ep.y && sp.m === ep.m && sp.d === ep.d;
    // 修复旧逻辑把「上午10:30-12:30」误转为 00:30 的历史脏数据
    if (sameDay && ep.hh === 0 && sp.hh >= 7 && sp.hh <= 12) {
      const fixed = `${ep.y}-${pad(ep.m)}-${pad(ep.d)}T12:${pad(ep.mm)}:00+08:00`;
      if (Date.parse(fixed) > sMs) {
        endsAt = fixed;
      } else {
        endsAt = null;
      }
    } else if (sameDay && sp.hh >= 12 && ep.hh >= 1 && ep.hh <= 11 && ep.hh + 12 > sp.hh) {
      // 修复「下午2:00-4:30」后半段漏加 12 小时的情况
      const fixed = `${ep.y}-${pad(ep.m)}-${pad(ep.d)}T${pad(ep.hh + 12)}:${pad(ep.mm)}:00+08:00`;
      endsAt = Date.parse(fixed) > sMs ? fixed : null;
    } else {
      endsAt = null;
    }
  }

  // 防御异常超长跨度（超过 120 天大概率是把整学期/年度写成了结束时间）
  if (endsAt && Date.parse(endsAt) - sMs > 120 * 86400 * 1000) {
    endsAt = null;
  }

  return { startsAt, endsAt };
}

export function safeParseTimestamp(iso?: string | null): number {
  if (!iso) return 0;
  const norm = normalizeCstIso(iso);
  const ms = Date.parse(norm ?? iso);
  return Number.isNaN(ms) ? 0 : ms;
}

export function toCstParts(iso: string) {
  const norm = normalizeCstIso(iso);
  const d = new Date(norm ?? iso);
  if (Number.isNaN(d.getTime())) {
    return { y: 1970, m: 1, d: 1, hh: 0, mm: 0, w: 4 };
  }
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
  const clean = sanitizeEventRange(startsAt, endsAt);
  if (!clean.startsAt) return null;
  const s = toCstParts(clean.startsAt);
  const hasStartClock = !(s.hh === 0 && s.mm === 0);
  const sDate = lang === "en" ? `${s.m}/${s.d}` : `${s.m}月${s.d}日`;
  const sText = hasStartClock ? `${sDate} ${pad(s.hh)}:${pad(s.mm)}` : sDate;
  if (!clean.endsAt) return sText;
  const e = toCstParts(clean.endsAt);
  const hasEndClock = !(e.hh === 0 && e.mm === 0);
  const sameDay = s.y === e.y && s.m === e.m && s.d === e.d;
  if (sameDay) {
    return hasStartClock && hasEndClock ? `${sText}–${pad(e.hh)}:${pad(e.mm)}` : sText;
  }
  const eDate = lang === "en" ? `${e.m}/${e.d}` : `${e.m}月${e.d}日`;
  const eText = hasEndClock ? `${eDate} ${pad(e.hh)}:${pad(e.mm)}` : eDate;
  return `${sText} — ${eText}`;
}

/** 日历卡片与移动端时间轴专用时间文案（正确处理全天、同日区间、跨日区间） */
export function formatCalendarClock(
  startsAt: string,
  endsAt?: string | null,
  lang: "zh" | "en" = "zh",
): { text: string; slotKey: string; slotLabel: string; allDay: boolean } {
  const clean = sanitizeEventRange(startsAt, endsAt);
  if (!clean.startsAt) {
    const label = lang === "en" ? "All day" : "全天";
    return { text: label, slotKey: "allday", slotLabel: label, allDay: true };
  }
  const s = toCstParts(clean.startsAt);
  const hasStartClock = !(s.hh === 0 && s.mm === 0);
  const startClock = `${pad(s.hh)}:${pad(s.mm)}`;
  const allDayLabel = lang === "en" ? "All day" : "全天";

  if (!clean.endsAt) {
    return hasStartClock
      ? { text: startClock, slotKey: startClock, slotLabel: startClock, allDay: false }
      : { text: allDayLabel, slotKey: "allday", slotLabel: allDayLabel, allDay: true };
  }

  const e = toCstParts(clean.endsAt);
  const hasEndClock = !(e.hh === 0 && e.mm === 0);
  const sameDay = s.y === e.y && s.m === e.m && s.d === e.d;

  if (sameDay) {
    if (hasStartClock && hasEndClock) {
      return {
        text: `${startClock}–${pad(e.hh)}:${pad(e.mm)}`,
        slotKey: startClock,
        slotLabel: startClock,
        allDay: false,
      };
    }
    return hasStartClock
      ? { text: startClock, slotKey: startClock, slotLabel: startClock, allDay: false }
      : { text: allDayLabel, slotKey: "allday", slotLabel: allDayLabel, allDay: true };
  }

  const sDate = lang === "en" ? `${s.m}/${s.d}` : `${s.m}月${s.d}日`;
  const eDate = lang === "en" ? `${e.m}/${e.d}` : `${e.m}月${e.d}日`;
  const text = hasStartClock
    ? `${startClock} (${sDate}—${eDate})`
    : `${sDate} — ${eDate}`;
  return {
    text,
    slotKey: hasStartClock ? startClock : "allday",
    slotLabel: hasStartClock ? startClock : allDayLabel,
    allDay: !hasStartClock,
  };
}

/** 紧凑截止时间徽标（用于卡片与详情） */
export function formatDeadlineChip(
  deadline?: string | null,
  lang: "zh" | "en" = "zh",
): string | null {
  if (!deadline) return null;
  const norm = normalizeCstIso(deadline);
  if (norm) {
    const p = toCstParts(norm);
    const hasClock = !(p.hh === 0 && p.mm === 0);
    const date = lang === "en" ? `${p.m}/${p.d}` : `${p.m}月${p.d}日`;
    const body = hasClock ? `${date} ${pad(p.hh)}:${pad(p.mm)}` : date;
    return lang === "en" ? `Due ${body}` : `${body}截止`;
  }
  const clean = deadline.trim();
  if (!clean) return null;
  return lang === "en" ? `Due ${clean}` : `${clean}截止`;
}

/**
 * 活动日历严格时间排序比较器：
 * 1. 按 CST 日期升序
 * 2. 同日内，有明确时刻的活动按时刻升序排在前面；无具体时刻（全天 / 00:00）排在当日最后
 * 3. 同开始时刻：按结束时间升序 → 重要通知优先 → 最新发布优先 → ID 稳定兜底
 */
export function compareCalendarEvents(a: Notice, b: Notice): number {
  const aIso = normalizeCstIso(a.startsAt);
  const bIso = normalizeCstIso(b.startsAt);
  if (!aIso && !bIso) return a.id.localeCompare(b.id);
  if (!aIso) return 1;
  if (!bIso) return -1;

  const ap = toCstParts(aIso);
  const bp = toCstParts(bIso);
  const aDay = ap.y * 10000 + ap.m * 100 + ap.d;
  const bDay = bp.y * 10000 + bp.m * 100 + bp.d;
  if (aDay !== bDay) return aDay - bDay;

  const aAllDay = ap.hh === 0 && ap.mm === 0;
  const bAllDay = bp.hh === 0 && bp.mm === 0;
  if (aAllDay !== bAllDay) return aAllDay ? 1 : -1;

  const aMin = ap.hh * 60 + ap.mm;
  const bMin = bp.hh * 60 + bp.mm;
  if (aMin !== bMin) return aMin - bMin;

  const aEnd = safeParseTimestamp(a.endsAt) || Number.MAX_SAFE_INTEGER;
  const bEnd = safeParseTimestamp(b.endsAt) || Number.MAX_SAFE_INTEGER;
  if (aEnd !== bEnd) return aEnd - bEnd;

  const aImp = a.important ? 1 : 0;
  const bImp = b.important ? 1 : 0;
  if (aImp !== bImp) return bImp - aImp;

  const pubDiff = safeParseTimestamp(b.publishedAt) - safeParseTimestamp(a.publishedAt);
  if (pubDiff !== 0) return pubDiff;
  return a.id.localeCompare(b.id);
}

/** 紧凑活动开始徽标（用于卡片展示） */
export function formatEventChip(startsAt: string, lang: "zh" | "en" = "zh"): string {
  const norm = normalizeCstIso(startsAt);
  if (!norm) return "";
  const s = toCstParts(norm);
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

/** 按发布时间倒序（单次预解析规范化时间戳 + 确定性兜底排序，避免 NaN 或同时间戳抖动） */
export function sortByPublished(list: Notice[]): Notice[] {
  return list
    .map((n) => ({ n, ts: safeParseTimestamp(n.publishedAt) }))
    .sort((a, b) => (b.ts !== a.ts ? b.ts - a.ts : b.n.id.localeCompare(a.n.id)))
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
    (n.audience ?? n.ai?.audience ?? []).join(" "),
    n.importantReason ?? n.ai?.importantReason ?? "",
    n.actionSummary ?? n.ai?.actionSummary ?? "",
    n.registrationDeadline ?? n.ai?.registrationDeadline ?? "",
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
