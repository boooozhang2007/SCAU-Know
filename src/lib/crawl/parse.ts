import path from "node:path";
import type { NoticeBlock, TableBlock, TableCell } from "@/lib/types";

/**
 * 列表页解析器。
 *
 * 华农各二级单位站点均基于 WebPlus CMS，但列表区模板差异很大：
 * 有的把日期放在 `<a>` 内，有的放在同级 `<li>` 的 `<span>` 里，
 * 有的把完整标题放在 `title` 属性而正文被截断。
 * 这里用「取文章链接所在的 li 块 → 在块内找日期与标题」的统一策略覆盖全部形态，
 * 并对第三方招聘系统（module 模板）单独处理。
 */

export interface ParsedItem {
  url: string;
  title: string;
  /** YYYY-MM-DD，解析不到为 null */
  date: string | null;
}

/** WebPlus 文章链接：/2026/1120/c1234a567890/page.htm */
const WEBPLUS_ART = /\/20\d{2}\/\d{4}\/c\d+a\d+\/page\.(?:htm|psp)/;
/** 招聘系统文章链接：/detail/news?id=1234 */
const MODULE_ART = /\/detail\/(?:news|notices?)\?id=\d+/;

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&mdash;": "—",
  "&hellip;": "…",
};

export function decodeText(s: string): string {
  return s
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAV_NOISE =
  /^(查看详情|更多|详情|联系我们|首页|上一页|下一页|尾页|English|学校主页|进入导航|管理登录|返回|打印|关闭|阅读全文)$/;

/** 从文本块中提取第一个合法日期 */
function pickDate(block: string): string | null {
  // 常规形态：2026-11-20 / 2026/11/20 / 2026年11月20日
  const m = block.match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  // 拆分形态：<p>12</p><span>2026-11</span>（日与年月分处两个标签）
  const split = block.match(
    /<p[^>]*>\s*(\d{1,2})\s*<\/p>[\s\S]{0,120}?(20\d{2})\s*[-/.年]\s*(\d{1,2})/,
  );
  if (split) {
    const d = Number(split[1]);
    const y = Number(split[2]);
    const mo = Number(split[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  // 反向拆分：<span>2026-11</span> ... <p>12</p>
  const split2 = block.match(
    /(20\d{2})\s*[-/.年]\s*(\d{1,2})[\s\S]{0,120}?<p[^>]*>\s*(\d{1,2})\s*<\/p>/,
  );
  if (split2) {
    const y = Number(split2[1]);
    const mo = Number(split2[2]);
    const d = Number(split2[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  return null;
}

/** WebPlus 常把标题重复两遍，折叠之 */
function collapseDuplicate(title: string): string {
  const n = title.length;
  if (n >= 12 && n % 2 === 0) {
    const half = title.slice(0, n / 2);
    if (title === half + half) return half;
  }
  // 「标题标题」但不严格等长的情况：首尾重复
  const mid = Math.floor(n / 2);
  for (let off = 0; off <= 2; off++) {
    const h = title.slice(0, mid - off);
    if (h.length > 8 && title.startsWith(h + h)) return h;
  }
  return title;
}

function normalizeTitle(raw: string): string {
  let t = decodeText(raw);
  // 去掉前缀日期
  t = t.replace(/^[\s|·\-–—]*20\d{2}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?[\s|·\-–—]*/, "");
  // 去掉尾随日期
  t = t.replace(/[\s|·\-–—]*20\d{2}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?[\s|·\-–—]*$/, "");
  t = t.replace(/^[\s|·\-–—]+|[\s|·\-–—]+$/g, "");
  return collapseDuplicate(t).trim();
}

/**
 * WebPlus / listing 模板：按 <li> 块解析。
 * 同时兜底处理「文章链接不在 li 内」的模板（直接取 a 及其邻近文本）。
 */
export function parseWebplusList(html: string, baseUrl: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const seen = new Set<string>();

  const push = (rawHref: string, titleRaw: string, date: string | null) => {
    let href = rawHref.trim();
    if (!href || /^(javascript|mailto|tel):/i.test(href)) return;
    try {
      href = new URL(href, baseUrl).href;
    } catch {
      return;
    }
    if (!WEBPLUS_ART.test(href)) return;
    const title = normalizeTitle(titleRaw);
    if (!title || title.length < 4 || NAV_NOISE.test(title)) return;
    if (seen.has(href)) return;
    seen.add(href);
    items.push({ url: href, title: title.slice(0, 180), date });
  };

  // 策略一：li 块内解析（覆盖大多数模板）
  const liRe = /<li[\s>][\s\S]{0,3000}?<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html))) {
    collectFromBlock(m[0], push);
  }

  // 策略二：div / tr 块解析（图书馆等表格型列表）
  const blockRe = /<(div|tr)[\s>][\s\S]{0,3000}?<\/\1>/gi;
  while ((m = blockRe.exec(html))) {
    collectFromBlock(m[0], push);
  }

  // 策略三：兜底，直接扫描 a 标签并用邻近文本补日期
  const aRe = /<a[^>]+href=['"]([^'"]+)['"]([^>]*)>([\s\S]{0,400}?)<\/a>/gi;
  let a: RegExpExecArray | null;
  while ((a = aRe.exec(html))) {
    const href = a[1];
    if (!WEBPLUS_ART.test(href)) continue;
    const attrs = a[2] ?? "";
    const titleAttr = attrs.match(/\btitle=['"]([^'"]{4,300})['"]/i);
    const ctx = html.slice(Math.max(0, a.index - 400), a.index + 600);
    push(href, titleAttr ? titleAttr[1] : (a[3] ?? ""), pickDate(ctx));
  }

  // 有日期的条目优先（导航链接通常没有日期）
  const dated = items.filter((i) => i.date);
  return dated.length >= 3 ? dated : items;
}

/** 在一个容器块内找出所有文章链接并推送 */
function collectFromBlock(
  block: string,
  push: (href: string, title: string, date: string | null) => void,
) {
  // 用非贪婪匹配 href，允许 title 属性内含引号
  const aRe = /<a\s[^>]*?href=['"]([^'"]+)['"][^>]*>([\s\S]{0,400}?)<\/a>/gi;
  let a: RegExpExecArray | null;
  const date = pickDate(block);
  while ((a = aRe.exec(block))) {
    const href = a[1];
    if (!WEBPLUS_ART.test(href)) continue;
    const full = a[0];
    const titleAttr = full.match(/\btitle=(['"])([\s\S]*?)\1/i);
    push(href, titleAttr ? titleAttr[2] : (a[2] ?? ""), date);
  }
}

/** 第三方招聘系统模板：/detail/news?id=NNNN */
export function parseModuleList(html: string, baseUrl: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const seen = new Set<string>();

  // 栏目导航页（学校概况 / 部门概况 / 联系我们）不是通知，menu_id 落在这些值上
  const NAV_MENU_IDS = new Set(["1001", "1022", "1023", "1024"]);

  const liRe = /<li[\s>][\s\S]{0,2000}?<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html))) {
    const block = m[0];
    const aRe = /<a[^>]+href=['"]([^'"]*\/detail\/(?:news|notices?)\?[^'"]*)['"][^>]*>([\s\S]{0,300}?)<\/a>/gi;
    let a: RegExpExecArray | null;
    while ((a = aRe.exec(block))) {
      const rawHref = a[1];
      // 站外链接（如第三方求职平台）不纳入
      if (!/^(\/|https?:\/\/[a-z0-9.-]*jyzx\.scau\.edu\.cn)/i.test(rawHref)) continue;
      const menuId = rawHref.match(/[?&]menu_id=(\d+)/)?.[1];
      if (menuId && NAV_MENU_IDS.has(menuId)) continue;

      let href = rawHref;
      try {
        href = new URL(rawHref, baseUrl).href;
      } catch {
        continue;
      }
      const title = normalizeTitle(a[2] ?? "");
      if (!title || title.length < 4 || NAV_NOISE.test(title)) continue;
      if (NAV_TITLE.test(title)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      items.push({ url: href, title: title.slice(0, 180), date: pickDate(block) });
    }
  }
  return items;
}

/** 导航类标题，出现在列表里说明抓到的是栏目页而非文章 */
const NAV_TITLE =
  /^(学校概况|部门概况|学院概况|联系我们|首页|简介|机构设置|师资队伍|人才培养|招生就业|党建工作|学生工作|学科建设|科学研究|校友工作|English|宏志助航.*|基地介绍|新闻动态|师资介绍|学员风采|政策法规|办事指南|资料下载)$/;

export interface ExtractedAttachmentRef {
  name: string;
  url: string;
  embedded?: boolean;
}

const ATTACHMENT_EXT_RE =
  /\.(pdf|ofd|docx?|docm|wps|rtf|odt|xlsx?|xlsm|xlsb|csv|tsv|ods|et|pptx?|pptm|ppsx|dps|odp|txt|md|zip|rar|7z)(?:$|[?#])/i;
const WEBPAGE_EXT_RE =
  /\.(?:htm|html|jsp|jspx|asp|aspx|php|shtml|do|action)(?:$|[?#])/i;
const SKIP_IMG_RE =
  /^(data:|about:|javascript:)|(\/_ueditor\/themes\/|\/(spacer|blank|pixel|icon(?:[_-][a-z0-9]+)?|arrow|dot|loading|logo)\b|\.(ico)(?:$|\?))/i;

const INVALID_ATTR_VALUE_RE = /^(?:undefined|null|none|false|true|nan|#)$/i;

function resolveAssetUrl(raw: string, baseUrl?: string): string | null {
  const clean = raw.trim().replace(/&amp;/g, "&");
  if (!clean || INVALID_ATTR_VALUE_RE.test(clean) || /^(javascript|mailto|tel|data):/i.test(clean)) {
    return null;
  }
  let resolved: string;
  if (baseUrl) {
    try {
      resolved = new URL(clean, baseUrl).href;
    } catch {
      return null;
    }
  } else if (/^https?:\/\//i.test(clean)) {
    resolved = clean;
  } else {
    return null;
  }
  if (/\/(?:undefined|null)(?:$|[?#])/i.test(resolved)) return null;
  return resolved;
}

/** 按优先级挑出合法的图片地址，过滤 WebPlus 常见的 `original-src="undefined"` 占位值 */
function pickValidImgSrc(attrs: string): string | null {
  const candidates = [
    attrs.match(/\bdata-original-src=['"]([^'"]+)['"]/i)?.[1],
    attrs.match(/\boriginal-src=['"]([^'"]+)['"]/i)?.[1],
    attrs.match(/\boriginal=['"]([^'"]+)['"]/i)?.[1],
    attrs.match(/\bdata-src=['"]([^'"]+)['"]/i)?.[1],
    attrs.match(/\bsrc=['"]([^'"]+)['"]/i)?.[1],
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const clean = raw.trim().replace(/&amp;/g, "&");
    if (!clean || INVALID_ATTR_VALUE_RE.test(clean)) continue;
    if (!clean.includes("/") && !clean.includes(".")) continue;
    if (SKIP_IMG_RE.test(clean)) continue;
    return clean;
  }
  return null;
}

/** 提取 `sudyfile-attr="{'title':'...'}"` 内的真实文件名 */
function extractSudyTitle(attrs: string): string | null {
  const attrM = attrs.match(/\bsudyfile-attr=(['"])([\s\S]*?)\1/i);
  if (!attrM) return null;
  const titleM = attrM[2].match(/['"]?title['"]?\s*:\s*(['"])([\s\S]*?)\1/i);
  if (!titleM) return null;
  const t = decodeText(titleM[2]);
  return t.length >= 2 ? t : null;
}

/** 判断一段文字是否仅由附件文件名清单组成（而非真实通知正文） */
export function isAttachmentOnlyText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const extTail =
    /\.(?:pdf|ofd|docx?|docm|wps|rtf|odt|xlsx?|xlsm|xlsb|csv|tsv|ods|et|pptx?|pptm|ppsx|dps|odp|txt|zip|rar|7z)/i;
  if (!new RegExp(`${extTail.source}\\s*$`, "i").test(trimmed)) return false;
  const parts = trimmed
    .split(new RegExp(`(?<=${extTail.source})\\s+`, "i"))
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) => {
    if (!new RegExp(`${extTail.source}$`, "i").test(part)) return false;
    const base = part
      .replace(/^(?:附件|附表)\s*[0-9一二三四五六七八九十]*\s*[:：.]?\s*/, "")
      .replace(new RegExp(`${extTail.source}$`, "i"), "")
      .trim();
    if (!base || base.length > 90 || /[。！？；\n]/.test(base)) return false;
    if ((base.match(/[,，]/g) ?? []).length > 1) return false;
    if (/^(?:请|现将|根据|按照|各位|各班|详情请|点击)/.test(base)) return false;
    return true;
  });
}

/** 平衡定位闭合标签（支持 nested `<div>` / `<table>`） */
export function findBalancedTagClose(
  html: string,
  innerStart: number,
  tagName: string,
): { innerEnd: number; closeEnd: number } | null {
  let depth = 1;
  const tagRe = new RegExp(`</?${tagName}\\b[^>]*>`, "gi");
  tagRe.lastIndex = innerStart;
  let tm: RegExpExecArray | null;
  while ((tm = tagRe.exec(html))) {
    if (tm[0].startsWith("</")) {
      depth--;
      if (depth === 0) {
        return { innerEnd: tm.index, closeEnd: tm.index + tm[0].length };
      }
    } else if (!tm[0].endsWith("/>")) {
      depth++;
    }
  }
  return null;
}

/** 提取独立顶层 `<tr>`（自动跳过嵌套子表里的 `<tr>`） */
function extractTopLevelTrs(tableHtml: string): string[] {
  const trs: string[] = [];
  const openRe = /<(table|tr)\b([^>]*)>/gi;
  const firstOpen = /<table\b[^>]*>/i.exec(tableHtml);
  let pos = firstOpen ? firstOpen.index + firstOpen[0].length : 0;

  while (pos < tableHtml.length) {
    openRe.lastIndex = pos;
    const m = openRe.exec(tableHtml);
    if (!m) break;
    const tag = m[1].toLowerCase();
    const openEnd = m.index + m[0].length;
    if (m[0].endsWith("/>")) {
      pos = openEnd;
      continue;
    }
    if (tag === "table") {
      const sub = findBalancedTagClose(tableHtml, openEnd, "table");
      pos = sub ? sub.closeEnd : openEnd;
      continue;
    }
    const close = findBalancedTagClose(tableHtml, openEnd, "tr");
    if (!close) {
      pos = openEnd;
      continue;
    }
    trs.push(tableHtml.slice(openEnd, close.innerEnd));
    pos = close.closeEnd;
  }
  return trs;
}

/** 解析 HTML `<table>` 为结构化 `TableBlock`，自动跳过 1 列布局壳表与纯图片排版表 */
export function parseHtmlTable(tableHtml: string): TableBlock | null {
  const capM = tableHtml.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
  let caption = capM ? decodeText(capM[1]) : undefined;
  if (caption && caption.length === 0) caption = undefined;

  const trs = extractTopLevelTrs(tableHtml);
  if (trs.length < 2) return null;

  const parsedRows: { cells: TableCell[]; isFirstRowClass: boolean; hasTh: boolean }[] = [];

  for (const trInner of trs) {
    // 跳过内嵌子表以免污染文本
    const cleanedTr = trInner.replace(/<table\b[\s\S]*?<\/table>/gi, " ");
    const cellRe = /<(t[dh])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    const cells: TableCell[] = [];
    let hasTh = false;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(cleanedTr))) {
      const tag = cm[1].toLowerCase();
      const attrs = cm[2] ?? "";
      const rawCell = cm[3]
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/(?:p|div|li)>/gi, " ");
      const text = decodeText(rawCell);
      const rowSpan = Math.max(
        1,
        Number(attrs.match(/\browspan=['"]?(\d+)/i)?.[1] ?? "1") || 1,
      );
      const colSpan = Math.max(
        1,
        Number(attrs.match(/\bcolspan=['"]?(\d+)/i)?.[1] ?? "1") || 1,
      );
      if (tag === "th") hasTh = true;
      cells.push({
        text,
        ...(tag === "th" ? { header: true } : {}),
        ...(rowSpan > 1 ? { rowSpan } : {}),
        ...(colSpan > 1 ? { colSpan } : {}),
      });
    }
    const nonEmpty = cells.some((c) => c.text.length > 0);
    const hasRowSpan = cells.some((c) => (c.rowSpan ?? 1) > 1);
    if (!nonEmpty && !hasRowSpan) continue;
    parsedRows.push({ cells, isFirstRowClass: false, hasTh });
  }

  if (parsedRows.length < 2) return null;
  if (!parsedRows.some((r) => r.cells.length >= 2)) return null;

  const totalChars = parsedRows
    .flatMap((r) => r.cells)
    .reduce((sum, c) => sum + c.text.length, 0);
  if (totalChars < 6) return null;

  // 若首行是跨多列的整行大标题（如「xx汇总表」），吸收为 caption
  if (
    parsedRows.length >= 3 &&
    parsedRows[0].cells.length === 1 &&
    (parsedRows[0].cells[0].colSpan ?? 1) >= 2 &&
    parsedRows[0].cells[0].text
  ) {
    if (!caption) caption = parsedRows[0].cells[0].text;
    parsedRows.shift();
  }

  const hasThead = /<thead\b/i.test(tableHtml);
  const firstTrHasClass = /<tr\b[^>]*class=['"][^'"]*\bfirstRow\b/i.test(trs[0] ?? "");
  const row0 = parsedRows[0];
  const row0ShortLabels =
    row0.cells.length >= 2 &&
    row0.cells.every(
      (c) => c.text.length > 0 && c.text.length <= 24 && !/[。！？；\n]/.test(c.text),
    );
  const firstRowIsHeader =
    hasThead || firstTrHasClass || row0.hasTh || row0ShortLabels;

  if (firstRowIsHeader) {
    row0.cells = row0.cells.map((c) => ({ ...c, header: true }));
    // 若首行有跨行表头（rowSpan === 2）且第 2 行也是纯短标签，把第 2 行一并标为 header
    if (
      parsedRows.length >= 3 &&
      row0.cells.some((c) => (c.rowSpan ?? 1) >= 2) &&
      parsedRows[1].cells.every(
        (c) =>
          c.text.length > 0 && c.text.length <= 20 && !/[。！？；\n]/.test(c.text),
      )
    ) {
      parsedRows[1].cells = parsedRows[1].cells.map((c) => ({ ...c, header: true }));
    }
  }

  const rows = parsedRows.slice(0, 120).map((r) => r.cells);
  const hasSpans = rows.some((r) =>
    r.some((c) => (c.rowSpan ?? 1) > 1 || (c.colSpan ?? 1) > 1),
  );
  const headers = firstRowIsHeader
    ? rows[0].map((c, idx) => c.text || `列${idx + 1}`)
    : [];

  return {
    type: "table",
    ...(caption ? { caption } : {}),
    headers,
    ...(hasSpans ? { hasSpans: true } : {}),
    rows,
  };
}

/** 平衡标签截取 `<div ...>...</div>`，避免正文内嵌子 div 时提前截断 */
function extractBalancedDiv(html: string, openRe: RegExp): string | null {
  const openM = openRe.exec(html);
  if (!openM) return null;
  const innerStart = openM.index + openM[0].length;
  const close = findBalancedTagClose(html, innerStart, "div");
  if (close) return html.slice(innerStart, close.innerEnd);
  return html.slice(innerStart, Math.min(html.length, innerStart + 40000));
}

/** 文章页正文抽取（WebPlus 的 .wp_articlecontent / v_news_content） */
export function extractArticle(
  html: string,
  articleUrl?: string,
): {
  paragraphs: string[];
  blocks: NoticeBlock[];
  images: string[];
  cover: string | null;
  attachments: ExtractedAttachmentRef[];
  summary: string;
  publishedAt: string | null;
  venue: string | null;
  startsAt: string | null;
  /** 页面自身的标题，用于校验列表标题是否对得上 */
  pageTitle: string | null;
} {
  const body =
    extractBalancedDiv(
      html,
      /<div\b[^>]*class=['"][^'"]*\bwp_articlecontent\b[^'"]*['"][^>]*>/i,
    ) ??
    extractBalancedDiv(html, /<div\b[^>]*id=['"]v_news_content['"][^>]*>/i) ??
    extractBalancedDiv(
      html,
      /<div\b[^>]*class=['"][^'"]*\barticle-content\b[^'"]*['"][^>]*>/i,
    ) ??
    extractBalancedDiv(
      html,
      /<div\b[^>]*class=['"][^'"]*\bread-content\b[^'"]*['"][^>]*>/i,
    ) ??
    "";

  const paragraphs: string[] = [];
  const blocks: NoticeBlock[] = [];
  const images: string[] = [];
  const seenPara = new Set<string>();
  const seenImg = new Set<string>();

  const extractImagesFromFragment = (frag: string) => {
    const imgRe = /<img\b([^>]+)>/gi;
    let im: RegExpExecArray | null;
    while ((im = imgRe.exec(frag))) {
      const attrs = im[1];
      const src = pickValidImgSrc(attrs);
      if (!src) continue;
      // 跳过明显小图标（width < 48 或 height < 48）
      const wM = attrs.match(/\bwidth=['"]?(\d+)/i);
      const hM = attrs.match(/\bheight=['"]?(\d+)/i);
      if ((wM && Number(wM[1]) > 0 && Number(wM[1]) < 48) || (hM && Number(hM[1]) > 0 && Number(hM[1]) < 48)) {
        continue;
      }
      const abs = resolveAssetUrl(src, articleUrl);
      if (!abs || seenImg.has(abs)) continue;
      seenImg.add(abs);
      const alt = decodeText(attrs.match(/\balt=['"]([^'"]*)['"]/i)?.[1] ?? "");
      images.push(abs);
      blocks.push({ type: "image", src: abs, originalSrc: abs, alt: alt || undefined });
    }
  };

  // 按顺序扫描正文段落、标题、列表项、图片与内嵌 HTML 表格
  const tokenStartRe = /<(table|p|h[1-6]|li|img)\b([^>]*)>/gi;
  const TABLE_CAPTION_RE =
    /(?:汇总表|推荐表|一览表|明细表|安排表|公示表|名单表?|日程表?|信息表|统计表|成绩表|一览|汇总|公示)$/;
  let pos = 0;

  while (pos < body.length) {
    tokenStartRe.lastIndex = pos;
    const m = tokenStartRe.exec(body);
    if (!m) break;

    const tag = m[1].toLowerCase();
    const openEnd = m.index + m[0].length;

    if (tag === "img") {
      extractImagesFromFragment(m[0]);
      pos = Math.max(pos + 1, openEnd);
      continue;
    }

    if (m[0].endsWith("/>")) {
      pos = Math.max(pos + 1, openEnd);
      continue;
    }

    if (tag === "table") {
      const close = findBalancedTagClose(body, openEnd, "table");
      if (!close) {
        pos = Math.max(pos + 1, openEnd);
        continue;
      }
      const tableHtml = body.slice(m.index, close.closeEnd);
      const tbl = parseHtmlTable(tableHtml);
      if (tbl) {
        // 若表格紧跟在独立短表题段落之后，吸收为 table.caption 并移除重复文本块
        const lastBlk = blocks[blocks.length - 1];
        if (
          !tbl.caption &&
          lastBlk?.type === "text" &&
          lastBlk.text.length <= 50 &&
          TABLE_CAPTION_RE.test(lastBlk.text)
        ) {
          tbl.caption = lastBlk.text;
          blocks.pop();
          if (paragraphs[paragraphs.length - 1] === lastBlk.text) {
            paragraphs.pop();
          }
        }
        blocks.push(tbl);
        pos = Math.max(pos + 1, close.closeEnd);
      } else {
        // 纯布局壳表或图片排版容器：退回扫描其内部段落与图片
        pos = Math.max(pos + 1, openEnd);
      }
      continue;
    }

    const closeIdx = body.toLowerCase().indexOf(`</${tag}>`, openEnd);
    if (closeIdx < 0) {
      pos = Math.max(pos + 1, openEnd);
      continue;
    }
    const inner = body.slice(openEnd, closeIdx);
    // 若外层容器（如 li/p）里面直接包着 table 或嵌套同级块，深入内部解析
    if (/<table\b/i.test(inner) || (tag === "li" && /<(?:p|li)\b/i.test(inner))) {
      pos = Math.max(pos + 1, openEnd);
      continue;
    }

    const minLen = /^h[1-6]$/.test(tag) ? 4 : 8;
    const t = decodeText(inner);
    if (t.length >= minLen && !/^(分享到|上一条|下一条|返回列表|打印|关闭)/.test(t)) {
      const key = t.replace(/\s+/g, "");
      if (!seenPara.has(key)) {
        seenPara.add(key);
        paragraphs.push(t);
        blocks.push({ type: "text", text: t });
      }
    }
    extractImagesFromFragment(inner);
    pos = Math.max(pos + 1, closeIdx + tag.length + 3);
  }

  const hasTableBlock = blocks.some((b) => b.type === "table");
  if (paragraphs.length === 0 && !hasTableBlock) {
    const plain = decodeText(body);
    if (plain.length > 20) {
      const snippet = plain.slice(0, 2000);
      paragraphs.push(snippet);
      blocks.unshift({ type: "text", text: snippet });
    }
  }

  // 附件与内嵌 PDF 播放器提取：优先提取 wp_pdf_player / pdfsrc / iframe PDF，其次普通 <a> 附件
  const attachments: ExtractedAttachmentRef[] = [];
  const seenAtt = new Set<string>();
  const attSearchScope = body || html;

  const pushAttachment = (
    rawHref: string,
    candidateName: string | null,
    embedded = false,
  ) => {
    const absUrl = resolveAssetUrl(rawHref, articleUrl);
    if (!absUrl || seenAtt.has(absUrl)) return;
    seenAtt.add(absUrl);
    let name = decodeText(candidateName || "");
    if (!name || name.length < 2) {
      try {
        name = decodeURIComponent(path.posix.basename(new URL(absUrl).pathname));
      } catch {
        name = embedded ? "正文文档.pdf" : "附件";
      }
    }
    attachments.push({ name, url: absUrl, ...(embedded ? { embedded: true } : {}) });
  };

  const pdfPlayerRe = /<[a-z0-9]+\b([^>]*\b(?:data-)?pdfsrc=['"]([^'"]+)['"][^>]*)>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pdfPlayerRe.exec(attSearchScope))) {
    const attrs = pm[1];
    const rawPdf = pm[2];
    if (!/\.pdf(?:$|[?#])|\/_upload\/article\/files\//i.test(rawPdf)) continue;
    const titleAttr = attrs.match(/\btitle=(['"])([\s\S]*?)\1/i)?.[2];
    pushAttachment(rawPdf, extractSudyTitle(attrs) || titleAttr || null, true);
  }

  const embedPdfRe =
    /<(?:iframe|embed)\b([^>]*\bsrc=['"]([^'"]+)['"][^>]*)>|<object\b([^>]*\bdata=['"]([^'"]+)['"][^>]*)>/gi;
  let em: RegExpExecArray | null;
  while ((em = embedPdfRe.exec(attSearchScope))) {
    const attrs = em[1] ?? em[3] ?? "";
    const rawSrc = em[2] ?? em[4] ?? "";
    if (!/\.pdf(?:$|[?#])/i.test(rawSrc)) continue;
    const titleAttr = attrs.match(/\btitle=(['"])([\s\S]*?)\1/i)?.[2];
    pushAttachment(rawSrc, extractSudyTitle(attrs) || titleAttr || null, true);
  }

  const attRe = /<a\b([^>]+?)href=['"]([^'"]+)['"]([^>]*)>([\s\S]{0,300}?)<\/a>/gi;
  let am: RegExpExecArray | null;
  while ((am = attRe.exec(attSearchScope))) {
    const attrs = `${am[1]} ${am[3]}`;
    const rawHref = am[2];
    if (WEBPAGE_EXT_RE.test(rawHref) || /\/infoplus\/form\//i.test(rawHref)) continue;
    const isUploadFile = /\/_upload\/article\/files\//i.test(rawHref);
    if (!ATTACHMENT_EXT_RE.test(rawHref) && !isUploadFile) continue;
    const titleAttr = attrs.match(/\btitle=(['"])([\s\S]*?)\1/i)?.[2];
    const innerText = decodeText(am[4]);
    pushAttachment(
      rawHref,
      extractSudyTitle(attrs) || innerText || titleAttr || null,
      false,
    );
  }

  // 发布时间：优先带时分（发布时间：2026-11-21 10:30），其次纯日期
  const dtM = html.match(
    /(?:发布时间|发布日期|时\s*间)[:：\s]*(?:<\/?[^>]*>\s*)*(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})日?\s*(?:(\d{1,2})[:：](\d{2}))?/,
  );
  const anyM = html.match(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  const src = dtM ?? anyM;
  const publishedAt = src
    ? `${src[1]}-${String(src[2]).padStart(2, "0")}-${String(src[3]).padStart(2, "0")}` +
      (dtM?.[4] ? `T${String(dtM[4]).padStart(2, "0")}:${dtM[5]}:00` : "")
    : null;

  const cleanedBody = decodeText(body)
    .replace(/(?<=\d)\s+(?=\d)/g, "")
    .replace(/(\d)\s+([年月日时分秒])/g, "$1$2")
    .replace(/([年月日])\s+(\d)/g, "$1$2");

  // 活动地点（仅在明确标签后取值，先解开 HTML 标签再匹配，避免 <span> 打断）
  const venueM = cleanedBody.match(
    /(?:活动地点|举办地点|会议地点|报告地点|讲座地点|地\s*点)\s*[:：]\s*([^\n，。；;]{2,36})/,
  );
  const venue = venueM ? venueM[1].trim() : null;

  /**
   * 活动开始时间。
   * 依次尝试两种可信形态，避免把正文里任意「日期 + 数字」误判成活动时间：
   *   1) 明确标签：「活动时间：2026年11月20日 15:00」
   *   2) 时间区间：「2026年11月20日（周五）15:00-16:30」
   */
  const startsAt = (() => {
    const labelRe =
      /(?:活动时间|报告时间|讲座时间|会议时间|举办时间|开始时间|时\s*间)\s*[:：]\s*(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})日?\s*(?:[（(][^)）]{0,12}[)）])?\s*(上午|下午|晚上|晚)?\s*(\d{1,2})\s*[:：点时]\s*(\d{2})/;
    const rangeRe =
      /(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})日?\s*(?:[（(][^)）]{0,12}[)）])?\s*(上午|下午|晚上|晚)?\s*(\d{1,2})\s*[:：点时]\s*(\d{2})\s*[-–—~至]\s*\d{1,2}\s*[:：点时]\s*\d{2}/;

    const build = (m: RegExpMatchArray | null): string | null => {
      if (!m) return null;
      let hh = Number(m[5]);
      const mm = m[6];
      if ((m[4] === "下午" || m[4] === "晚上" || m[4] === "晚") && hh < 12) hh += 12;
      if (m[4] === "上午" && hh === 12) hh = 0;
      if (hh > 23 || Number(mm) > 59) return null;
      return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${mm}:00+08:00`;
    };

    return build(cleanedBody.match(labelRe)) ?? build(cleanedBody.match(rangeRe));
  })();

  const firstTable = blocks.find((b) => b.type === "table");
  const summary =
    paragraphs[0]?.slice(0, 120) ??
    firstTable?.caption?.slice(0, 120) ??
    firstTable?.headers.join(" / ").slice(0, 120) ??
    "";

  // 页面标题：h1 优先，但部分模板的 h1 是 &nbsp; 占位，需回退到 <title>
  const h1Raw = decodeText(html.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)?.[1] ?? "");
  const titleRaw = decodeText(html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1] ?? "");
  // <title> 常带「_站点名」或「-站点名」后缀，仅当后缀很短（站点名）时才截掉
  const titleClean = titleRaw
    .replace(/\s*[_|]\s*[^_|]{2,16}$/, "")
    .replace(/\s+-\s+[^-]{2,16}$/, "")
    .trim();
  const pageTitle = h1Raw.length >= 4 ? h1Raw : titleClean || null;

  return {
    paragraphs: paragraphs.slice(0, 16),
    blocks: blocks.slice(0, 64),
    images: images.slice(0, 16),
    cover: images[0] ?? null,
    attachments: attachments.slice(0, 8),
    summary,
    publishedAt,
    venue,
    startsAt,
    pageTitle,
  };
}

/** 标题相似度：用于判断列表标题与文章页标题是否指向同一篇 */
export function titleMatches(listTitle: string, pageTitle: string): boolean {
  const norm = (s: string) =>
    s
      .replace(/[\s\u3000]/g, "")
      .replace(/[「」『』【】《》""''（）()［］\[\]—–\-·、，,。.：:；;！!？?…]/g, "")
      .toLowerCase();
  const a = norm(listTitle);
  const b = norm(pageTitle);
  if (!a || !b) return false;
  if (a === b) return true;
  // 一方包含另一方（列表标题常被截断）
  if (a.length >= 6 && b.includes(a)) return true;
  if (b.length >= 6 && a.includes(b)) return true;
  // 前缀重合度
  const n = Math.min(a.length, b.length);
  let same = 0;
  while (same < n && a[same] === b[same]) same++;
  return same / n >= 0.7;
}

/** 按模板分发 */
export function parseListByTemplate(
  template: "webplus" | "listing" | "module",
  html: string,
  baseUrl: string,
): ParsedItem[] {
  if (template === "module") return parseModuleList(html, baseUrl);
  return parseWebplusList(html, baseUrl);
}
