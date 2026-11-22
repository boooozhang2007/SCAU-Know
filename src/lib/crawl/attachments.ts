import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import JSZip from "jszip";
import { createExtractorFromData } from "node-unrar-js";
import { extractText } from "unpdf";
import type { NoticeAttachment, ParsedSheet } from "@/lib/types";

const ATTACHMENTS_DIR = process.env.BAUHINIA_DATA_DIR
  ? path.join(path.resolve(process.env.BAUHINIA_DATA_DIR), "attachments")
  : path.join(process.cwd(), "data", "attachments");

const MAX_FILES_PER_NOTICE = 6;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const MAX_STORED_ROWS = 80;
const MAX_STORED_COLS = 16;
const MAX_TEXT_CHARS = 30000;
const MAX_ARCHIVE_ENTRIES = 12;
const MAX_ARCHIVE_TOTAL_BYTES = 40 * 1024 * 1024;

export const SPREADSHEET_EXTS = new Set([
  "xlsx",
  "xls",
  "xlsm",
  "xlsb",
  "csv",
  "tsv",
  "ods",
  "et",
]);

export const PRESENTATION_EXTS = new Set(["ppt", "pptx", "pptm", "ppsx", "dps", "odp"]);
export const ARCHIVE_EXTS = new Set(["zip", "rar"]);
export const IMAGE_ATT_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);

export const KNOWN_ATTACHMENT_EXTS = new Set([
  "pdf",
  "ofd",
  "doc",
  "docx",
  "docm",
  "wps",
  "rtf",
  "odt",
  "txt",
  "md",
  "xml",
  ...SPREADSHEET_EXTS,
  ...PRESENTATION_EXTS,
  ...ARCHIVE_EXTS,
  "7z",
  ...IMAGE_ATT_EXTS,
]);

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-word.document.macroenabled.12": "docm",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel.sheet.macroenabled.12": "xlsm",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12": "xlsb",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12": "pptm",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow": "ppsx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/x-rar-compressed": "rar",
  "application/vnd.rar": "rar",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

const CJK_SPACED_RE =
  /([\u4e00-\u9fa5，。！？；：、“”‘’（）《》【】])\s+([\u4e00-\u9fa5，。！？；：、“”‘’（）《》【】])/g;
const NEW_PDF_PARA_RE =
  /^(?:[一二三四五六七八九十]+[、.．]|[（(][一二三四五六七八九十0-9]+[）)]|\d+[.、）)]|[①②③④⑤⑥⑦⑧⑨⑩]|附件\s*\d*[：:. ]|各[^\n]{1,24}[：:]|注[：:]|特此通知|华南农业大学|[\u4e00-\u9fa5]{2,14}(?:学院|处|部|馆|中心|办公室)$)/;

/** 将 PDF 抽取文本清洗为可读自然段，避免孤立页码和硬换行断句 */
export function formatPdfText(raw: string): string {
  const rawLines = raw.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").split("\n");

  const merged: string[] = [];
  for (const rawLine of rawLines) {
    let line = rawLine.trim();
    if (!line) continue;
    if (/^(?:[-—–·\s]*\d{1,3}[-—–·\s]*|第\s*\d+\s*页(?:\s*[/／共]\s*\d+\s*页)?)$/.test(line)) {
      continue;
    }

    line = line
      .replace(/\u201e(20\d{2})\u201f/g, "〔$1〕")
      .replace(CJK_SPACED_RE, "$1$2")
      .replace(CJK_SPACED_RE, "$1$2")
      .replace(/(20\d)\s+(\d)\s*年/g, "$1$2年")
      .replace(/(\d)\s+([年月日%％])/g, "$1$2")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

    if (!line) continue;

    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.length >= 16 &&
      !/[。！？；：:…]$/.test(prev) &&
      !NEW_PDF_PARA_RE.test(line)
    ) {
      const joiner = /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(line) ? " " : "";
      merged[merged.length - 1] = `${prev}${joiner}${line}`;
    } else {
      merged.push(line);
    }
  }

  return merged.join("\n").slice(0, 20000);
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function normalizePlainText(raw: string, maxChars = 16000): string {
  return raw
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

/** 自动识别 UTF-8 BOM / UTF-16 BOM / UTF-8 / GB18030 文本编码 */
export function decodeTextBuffer(buf: Buffer): string {
  if (buf.byteLength === 0) return "";
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buf.subarray(3));
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString("utf16le");
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(buf);
    } catch {
      return buf.toString("utf8");
    }
  }
}

function decodeArchiveEntryName(bytes: Uint8Array | string[] | Buffer): string {
  if (Array.isArray(bytes)) return bytes.join("");
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(buf);
    } catch {
      return buf.toString("latin1");
    }
  }
}

function decodeHtmlEntities(s: string): string {
  const ENT: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&ldquo;": "“",
    "&rdquo;": "”",
    "&lsquo;": "‘",
    "&rsquo;": "’",
    "&mdash;": "—",
    "&ndash;": "–",
    "&hellip;": "…",
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const cp = parseInt(h, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const cp = parseInt(d, 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
    })
    .replace(/&[a-z]+;/gi, (m) => ENT[m.toLowerCase()] ?? m);
}

/** 仅认可白名单扩展名，防止 `"1.个人成长材料..."` 被 `path.extname` 误判 */
function extractKnownExt(candidate: string): string | null {
  const clean = candidate.split("?")[0].split("#")[0].trim();
  const ext = path.extname(clean).replace(".", "").toLowerCase();
  if (!ext || !KNOWN_ATTACHMENT_EXTS.has(ext)) return null;
  return ext;
}

function parseContentDispositionFilename(header?: string): string | null {
  if (!header) return null;
  const star = header.match(/filename\*\s*=\s*(?:UTF-8''|[^']*')([^;\r\n]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/^["']|["']$/g, "").trim());
    } catch {
      return star[1].trim();
    }
  }
  const plain = header.match(/filename\s*=\s*("?)([^";\r\n]+)\1/i);
  return plain?.[2]?.trim() || null;
}

/** 通过文件魔数及内部容器目录嗅探真实格式 */
export async function sniffBufferKind(buf: Buffer): Promise<string | null> {
  if (buf.byteLength < 4) return null;
  if (buf.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 4).toString("ascii") === "GIF8") return "gif";
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  if (buf.subarray(0, 6).toString("ascii") === "Rar!\x1a\x07" || buf.subarray(0, 4).toString("ascii") === "Rar!") {
    return "rar";
  }

  // RTF 文档
  const headText = buf.subarray(0, Math.min(buf.byteLength, 512)).toString("latin1");
  if (/^\s*\{\\rtf/i.test(headText)) return "rtf";

  // 伪装为 .doc 的 MHTML 或 HTML 文档（国内办公系统常见导出）
  if (
    /MIME-Version:/i.test(headText) &&
    /Content-Type:\s*(?:multipart|text\/html)/i.test(headText)
  ) {
    return "mhtml";
  }
  if (/^\s*(?:<!DOCTYPE\s+html|<html|<meta\b|<table\b)/i.test(headText)) {
    return "html";
  }

  // OLE2 Compound Binary (.doc / .xls / .ppt / .wps / .et / .dps)
  if (
    buf.byteLength >= 8 &&
    buf[0] === 0xd0 &&
    buf[1] === 0xcf &&
    buf[2] === 0x11 &&
    buf[3] === 0xe0
  ) {
    try {
      const cfb = XLSX.CFB.read(buf, { type: "buffer" });
      if (XLSX.CFB.find(cfb, "WordDocument")) return "doc";
      if (XLSX.CFB.find(cfb, "Workbook") || XLSX.CFB.find(cfb, "Book")) return "xls";
      if (XLSX.CFB.find(cfb, "PowerPoint Document")) return "ppt";
      if (XLSX.CFB.find(cfb, "Contents")) return "wps";
    } catch {
      /* 回退 */
    }
    return "ole2";
  }

  // ZIP / OOXML / ODF / OFD
  if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)) {
    try {
      const zip = await JSZip.loadAsync(buf, { decodeFileName: decodeArchiveEntryName });
      if (zip.file("word/document.xml")) return "docx";
      if (zip.file("xl/workbook.xml")) return "xlsx";
      if (zip.file("ppt/presentation.xml")) return "pptx";
      if (zip.file("OFD.xml") || zip.file("ofd.xml")) return "ofd";
      const mimeFile = zip.file("mimetype");
      if (mimeFile) {
        const mimeStr = (await mimeFile.async("string")).trim().toLowerCase();
        if (mimeStr.includes("opendocument.text")) return "odt";
        if (mimeStr.includes("opendocument.spreadsheet")) return "ods";
        if (mimeStr.includes("opendocument.presentation")) return "odp";
      }
      return "zip";
    } catch {
      return "zip";
    }
  }

  return null;
}

/** 构造安全本地文件名，并结合 URL / HTTP 响应头 / 文件魔数精确识别真实扩展名 */
export async function resolveAttachmentMeta(
  rawName: string,
  url: string,
  opts?: { contentDisposition?: string; contentType?: string; buf?: Buffer },
): Promise<{ safeName: string; ext: string; sniffedKind: string | null }> {
  let clean = rawName.replace(/[\\/:*?"<>|\r\n]+/g, "_").trim();
  const cdName = parseContentDispositionFilename(opts?.contentDisposition);
  if ((!clean || clean.length < 2) && cdName) {
    clean = cdName.replace(/[\\/:*?"<>|\r\n]+/g, "_").trim();
  }

  const sniffed = opts?.buf ? await sniffBufferKind(opts.buf) : null;
  const sniffMapped =
    sniffed === "html" || sniffed === "mhtml"
      ? "doc"
      : sniffed === "ole2"
        ? "doc"
        : sniffed;

  let ext = extractKnownExt(clean) ?? "";
  if (!ext && cdName) ext = extractKnownExt(cdName) ?? "";
  if (!ext) {
    try {
      ext = extractKnownExt(new URL(url).pathname) ?? "";
    } catch {
      /* 忽略 */
    }
  }
  if (!ext && opts?.contentType) {
    const ct = opts.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    ext = CONTENT_TYPE_TO_EXT[ct] ?? "";
  }
  if ((!ext || ext === "bin") && sniffMapped) {
    ext = sniffMapped;
  }

  if (!clean) clean = `attachment.${ext || "bin"}`;
  const existingKnown = extractKnownExt(clean);
  if (!existingKnown && ext) {
    clean = `${clean}.${ext}`;
  }
  return {
    safeName: clean.slice(0, 120),
    ext: ext || "bin",
    sniffedKind: sniffed,
  };
}

function decodeQuotedPrintable(raw: string, encoding: string): string {
  const unfolded = raw.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < unfolded.length; i++) {
    const ch = unfolded[i];
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(unfolded.slice(i + 1, i + 3))) {
      bytes.push(parseInt(unfolded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(unfolded.charCodeAt(i) & 0xff);
    }
  }
  const buf = Buffer.from(bytes);
  const enc = encoding.toLowerCase();
  if (enc.includes("gb") || enc.includes("2312")) {
    try {
      return new TextDecoder("gb18030").decode(buf);
    } catch {
      /* ignore */
    }
  }
  return decodeTextBuffer(buf);
}

/** 解析伪装为 `.doc` 的 HTML / MHTML 文档 */
export function extractHtmlDocText(buf: Buffer): string {
  let content = decodeTextBuffer(buf);

  if (/MIME-Version:/i.test(content.slice(0, 512))) {
    const htmlPart = content.match(
      /Content-Type:\s*text\/html([^]*?)(?:\r?\n--[^\r\n]+|$)/i,
    );
    if (htmlPart) {
      const partText = htmlPart[1];
      const splitIdx = partText.search(/\r?\n\r?\n/);
      const hdr = splitIdx >= 0 ? partText.slice(0, splitIdx) : "";
      const body = splitIdx >= 0 ? partText.slice(splitIdx).trim() : partText;
      const charset = hdr.match(/charset=["']?([^"'\s;]+)/i)?.[1] ?? "utf-8";
      if (/quoted-printable/i.test(hdr)) {
        content = decodeQuotedPrintable(body, charset);
      } else if (/base64/i.test(hdr)) {
        const b64 = Buffer.from(body.replace(/\s+/g, ""), "base64");
        content = decodeTextBuffer(b64);
      } else {
        content = body;
      }
    }
  }

  const cleaned = content
    .replace(/<(head|script|style|xml|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|section)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ");

  return normalizePlainText(decodeHtmlEntities(cleaned), 16000);
}

/** 解析 `.rtf` 文档：正确处理 `\uN` Unicode 转义与连续 GB18030 `\'hh` 十六进制字节 */
export function extractRtfText(buf: Buffer): string {
  const src = buf.toString("latin1");
  const SKIP_DEST = new Set([
    "fonttbl",
    "colortbl",
    "stylesheet",
    "info",
    "pict",
    "object",
    "header",
    "footer",
    "headerl",
    "headerr",
    "headerf",
    "footerl",
    "footerr",
    "footerf",
    "footnote",
    "listtable",
    "listoverridetable",
    "rsidtbl",
    "datastore",
    "themedata",
    "colorschememapping",
    "latentstyles",
    "pgdsctbl",
    "generator",
  ]);
  const hexDec = new TextDecoder("gb18030");
  const out: string[] = [];
  const hexBytes: number[] = [];
  const stack: { uc: number; skip: boolean }[] = [{ uc: 1, skip: false }];
  let skipChars = 0;

  const flushHex = () => {
    if (hexBytes.length > 0) {
      out.push(hexDec.decode(new Uint8Array(hexBytes)));
      hexBytes.length = 0;
    }
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const top = stack[stack.length - 1] ?? { uc: 1, skip: false };

    if (ch === "{") {
      flushHex();
      stack.push({ uc: top.uc, skip: top.skip });
      i++;
      continue;
    }
    if (ch === "}") {
      flushHex();
      if (stack.length > 1) stack.pop();
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "\\") {
      const next = src[i + 1] ?? "";
      if (next === "'" && /^[0-9a-fA-F]{2}$/.test(src.slice(i + 2, i + 4))) {
        if (!top.skip) {
          if (skipChars > 0) skipChars--;
          else hexBytes.push(parseInt(src.slice(i + 2, i + 4), 16));
        }
        i += 4;
        continue;
      }
      flushHex();
      if (next === "*" && !top.skip) {
        top.skip = true;
        i += 2;
        continue;
      }
      if (next === "\\" || next === "{" || next === "}") {
        if (!top.skip) {
          if (skipChars > 0) skipChars--;
          else out.push(next);
        }
        i += 2;
        continue;
      }
      if (next === "~") {
        if (!top.skip) out.push(" ");
        i += 2;
        continue;
      }
      if (next === "\n" || next === "\r") {
        if (!top.skip) out.push("\n");
        i += 2;
        continue;
      }

      const wordM = src.slice(i + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/);
      if (wordM) {
        const word = wordM[1];
        const arg = wordM[2] !== undefined ? parseInt(wordM[2], 10) : undefined;
        i += 1 + wordM[0].length;
        if (word === "uc" && arg !== undefined) {
          top.uc = Math.max(0, arg);
          continue;
        }
        if (word === "bin" && arg !== undefined && arg > 0) {
          i += arg;
          continue;
        }
        if (SKIP_DEST.has(word)) {
          top.skip = true;
          continue;
        }
        if (top.skip) continue;
        if (word === "u" && arg !== undefined) {
          const code = arg < 0 ? arg + 65536 : arg;
          if (code >= 0 && code <= 0x10ffff) {
            out.push(String.fromCodePoint(code));
          }
          skipChars = top.uc;
        } else if (word === "par" || word === "line") {
          out.push("\n");
        } else if (word === "tab" || word === "cell") {
          out.push(word === "cell" ? " | " : "\t");
        } else if (word === "row") {
          out.push("\n");
        } else if (word === "emdash") {
          out.push("—");
        } else if (word === "endash") {
          out.push("–");
        } else if (word === "lquote") {
          out.push("‘");
        } else if (word === "rquote") {
          out.push("’");
        } else if (word === "ldblquote") {
          out.push("“");
        } else if (word === "rdblquote") {
          out.push("”");
        }
        continue;
      }
      i += 2;
      continue;
    }

    flushHex();
    if (!top.skip) {
      if (skipChars > 0) skipChars--;
      else out.push(ch);
    }
    i++;
  }
  flushHex();
  return normalizePlainText(out.join(""), 16000);
}

/** 通过 ZIP 回退读取 OOXML Word (docx/docm) 正文（涵盖文本框、SmartArt 等 mammoth 遗漏结构） */
async function extractDocxXmlFallback(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf, { decodeFileName: decodeArchiveEntryName });
  const xmlFiles = Object.keys(zip.files)
    .filter((k) => /^word\/(?:document|header\d*|footer\d*)\.xml$/i.test(k))
    .sort();
  const paras: string[] = [];
  for (const name of xmlFiles) {
    const f = zip.file(name);
    if (!f) continue;
    const xml = await f.async("string");
    const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
    let pm: RegExpExecArray | null;
    while ((pm = pRe.exec(xml))) {
      const texts: string[] = [];
      const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi;
      let tm: RegExpExecArray | null;
      while ((tm = tRe.exec(pm[1]))) {
        texts.push(decodeHtmlEntities(tm[1]));
      }
      const line = texts.join("").trim();
      if (line) paras.push(line);
    }
  }
  return normalizePlainText(paras.join("\n"), 16000);
}

/** 解析 OpenDocument (`.odt` / `.odp`) content.xml */
async function extractOdfText(buf: Buffer, isPresentation: boolean): Promise<string> {
  const zip = await JSZip.loadAsync(buf, { decodeFileName: decodeArchiveEntryName });
  const contentFile = zip.file("content.xml");
  if (!contentFile) return "";
  const xml = await contentFile.async("string");

  if (isPresentation) {
    const slides = xml.split(/<draw:page\b[^>]*>/i).slice(1);
    if (slides.length > 0) {
      const pages = slides
        .map((chunk, idx) => {
          const lines: string[] = [];
          const pRe = /<text:(?:p|h)\b[^>]*>([\s\S]*?)<\/text:(?:p|h)>/gi;
          let pm: RegExpExecArray | null;
          while ((pm = pRe.exec(chunk))) {
            const plain = decodeHtmlEntities(pm[1].replace(/<[^>]+>/g, " "))
              .replace(/\s+/g, " ")
              .trim();
            if (plain) lines.push(plain);
          }
          return lines.length ? `[第 ${idx + 1} 页]\n${lines.join("\n")}` : "";
        })
        .filter(Boolean);
      return normalizePlainText(pages.join("\n\n"), 16000);
    }
  }

  const lines: string[] = [];
  const pRe = /<text:(?:p|h)\b[^>]*>([\s\S]*?)<\/text:(?:p|h)>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pRe.exec(xml))) {
    const plain = decodeHtmlEntities(pm[1].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (plain) lines.push(plain);
  }
  return normalizePlainText(lines.join("\n"), 16000);
}

/** 解析 OOXML 演示文稿 (`.pptx` / `.pptm` / `.ppsx`) */
async function extractPptxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf, { decodeFileName: decodeArchiveEntryName });
  const slideKeys = Object.keys(zip.files)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/i)?.[1] ?? "0");
      const nb = Number(b.match(/slide(\d+)\.xml/i)?.[1] ?? "0");
      return na - nb;
    });

  const sections: string[] = [];
  for (const key of slideKeys.slice(0, 100)) {
    const file = zip.file(key);
    if (!file) continue;
    const slideNum = key.match(/slide(\d+)\.xml/i)?.[1] ?? "?";
    const xml = await file.async("string");
    const lines: string[] = [];
    const pRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi;
    let pm: RegExpExecArray | null;
    while ((pm = pRe.exec(xml))) {
      const runs: string[] = [];
      const tRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi;
      let tm: RegExpExecArray | null;
      while ((tm = tRe.exec(pm[1]))) {
        runs.push(decodeHtmlEntities(tm[1]));
      }
      const line = runs.join("").trim();
      if (line) lines.push(line);
    }
    if (lines.length > 0) {
      sections.push(`[第 ${slideNum} 页]\n${lines.join("\n")}`);
    }
  }
  return normalizePlainText(sections.join("\n\n"), 16000);
}

/** 解析旧版二进制 PowerPoint (`.ppt` / `.dps`) Record 流中的文本原子 */
export function extractPptBinaryText(buf: Buffer): string {
  const cfb = XLSX.CFB.read(buf, { type: "buffer" });
  const entry = XLSX.CFB.find(cfb, "PowerPoint Document");
  if (!entry?.content) return "";
  const stream = Buffer.isBuffer(entry.content)
    ? entry.content
    : Buffer.from(entry.content);

  const chunks: string[] = [];
  const gbDec = new TextDecoder("gb18030");

  const walk = (start: number, end: number, depth: number) => {
    if (depth > 16) return;
    let offset = start;
    while (offset + 8 <= end) {
      const verInst = stream.readUInt16LE(offset);
      const recType = stream.readUInt16LE(offset + 2);
      const recLen = stream.readUInt32LE(offset + 4);
      const bodyStart = offset + 8;
      const bodyEnd = Math.min(end, bodyStart + recLen);
      if (recLen > end - bodyStart && (verInst & 0x0f) !== 0x0f) break;

      if ((verInst & 0x0f) === 0x0f) {
        walk(bodyStart, bodyEnd, depth + 1);
      } else if (recType === 0x0fa0) {
        // TextCharsAtom (UTF-16LE)
        const text = stream
          .subarray(bodyStart, bodyEnd)
          .toString("utf16le")
          .replace(/[\r\x0b]/g, "\n")
          .trim();
        if (text) chunks.push(text);
      } else if (recType === 0x0fa8) {
        // TextBytesAtom (single-byte / ANSI / CP936)
        const text = gbDec
          .decode(stream.subarray(bodyStart, bodyEnd))
          .replace(/[\r\x0b]/g, "\n")
          .trim();
        if (text) chunks.push(text);
      }
      if (bodyEnd <= offset) break;
      offset = bodyEnd;
    }
  };

  walk(0, stream.byteLength, 0);
  return normalizePlainText(chunks.join("\n"), 16000);
}

/** 解析国家版式文档 OFD (`.ofd`) 页面文字 */
async function extractOfdText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf, { decodeFileName: decodeArchiveEntryName });
  const pageKeys = Object.keys(zip.files)
    .filter((k) => /Pages\/Page_\d+\/Content\.xml$/i.test(k))
    .sort((a, b) => {
      const na = Number(a.match(/Page_(\d+)/i)?.[1] ?? "0");
      const nb = Number(b.match(/Page_(\d+)/i)?.[1] ?? "0");
      return na - nb;
    });

  const sections: string[] = [];
  for (let i = 0; i < pageKeys.slice(0, 60).length; i++) {
    const file = zip.file(pageKeys[i]);
    if (!file) continue;
    const xml = await file.async("string");
    const words: string[] = [];
    const tcRe = /<(?:ofd:)?TextCode\b[^>]*>([\s\S]*?)<\/(?:ofd:)?TextCode>/gi;
    let tm: RegExpExecArray | null;
    while ((tm = tcRe.exec(xml))) {
      const w = decodeHtmlEntities(tm[1]);
      if (w) words.push(w);
    }
    const line = words.join("").trim();
    if (line) sections.push(`[第 ${i + 1} 页]\n${line}`);
  }
  return normalizePlainText(sections.join("\n\n"), 16000);
}

function cellToString(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).replace(/\s+/g, " ").trim();
}

export function parseWorkbookBuffer(
  buf: Buffer,
  {
    limitRows = MAX_STORED_ROWS,
    limitCols = MAX_STORED_COLS,
    ext = "xlsx",
  }: { limitRows?: number; limitCols?: number; ext?: string } = {},
): { sheets: ParsedSheet[]; parsedText: string } {
  const wb =
    ext === "csv" || ext === "tsv"
      ? XLSX.read(decodeTextBuffer(buf), {
          type: "string",
          FS: ext === "tsv" ? "\t" : ",",
          cellDates: true,
        })
      : XLSX.read(buf, { type: "buffer", cellDates: true, codepage: 936 });

  const sheets: ParsedSheet[] = [];
  const textParts: string[] = [];

  for (const sheetName of wb.SheetNames.slice(0, 8)) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rawGrid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      blankrows: false,
      defval: "",
    });
    const cleanRows = rawGrid
      .map((row) => (Array.isArray(row) ? row.map(cellToString) : []))
      .filter((row) => row.some((c) => c.length > 0));

    if (cleanRows.length === 0) continue;

    let headerIdx = 0;
    if (cleanRows.length > 1) {
      const firstNonEmpty = cleanRows[0].filter(Boolean).length;
      const secondNonEmpty = cleanRows[1].filter(Boolean).length;
      if (firstNonEmpty <= 1 && secondNonEmpty >= 2) headerIdx = 1;
    }

    const colWidth = Math.min(
      limitCols,
      Math.max(...cleanRows.slice(headerIdx, headerIdx + 20).map((r) => r.length), 1),
    );
    const headers = Array.from({ length: colWidth }, (_, c) =>
      cleanRows[headerIdx]?.[c] || `列${c + 1}`,
    );
    const dataRows = cleanRows
      .slice(headerIdx + 1, headerIdx + 1 + limitRows)
      .map((r) => Array.from({ length: colWidth }, (_, c) => r[c] ?? ""));

    sheets.push({
      name: sheetName,
      headers,
      rows: dataRows,
      totalRows: Math.max(0, cleanRows.length - headerIdx - 1),
    });

    const lines = cleanRows
      .slice(0, 1200)
      .map((r) => r.filter(Boolean).join(" | "))
      .filter(Boolean);
    textParts.push(`[工作表: ${sheetName}]\n${lines.join("\n")}`);
  }

  return {
    sheets,
    parsedText: textParts.join("\n\n").slice(0, MAX_TEXT_CHARS),
  };
}

/**
 * 在进行精确规则匹配（如姓名/学号查找）时，直接从磁盘读取完整工作簿，不受预览行数限制。
 */
export async function loadFullWorkbookSheets(localPath: string): Promise<ParsedSheet[]> {
  const buf = await fs.readFile(localPath);
  const ext = path.extname(localPath).replace(".", "").toLowerCase() || "xlsx";
  return parseWorkbookBuffer(buf, { limitRows: 10000, limitCols: 40, ext }).sheets;
}

interface ArchiveEntry {
  name: string;
  read: () => Promise<Buffer>;
}

async function listZipEntries(buf: Buffer): Promise<ArchiveEntry[]> {
  const zip = await JSZip.loadAsync(buf, { decodeFileName: decodeArchiveEntryName });
  const out: ArchiveEntry[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    out.push({ name, read: () => entry.async("nodebuffer") });
  }
  return out;
}

async function listRarEntries(buf: Buffer): Promise<ArchiveEntry[]> {
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  const extractor = await createExtractorFromData({ data: copy.buffer });
  const extracted = extractor.extract();
  const out: ArchiveEntry[] = [];
  for (const item of extracted.files) {
    if (item.fileHeader.flags.directory || !item.extraction) continue;
    const raw = item.extraction;
    const entryBuf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    out.push({
      name: item.fileHeader.name,
      read: async () => entryBuf,
    });
  }
  return out;
}

function shouldSkipArchivePath(entryName: string): boolean {
  const clean = entryName.replace(/\\/g, "/");
  return (
    clean.startsWith("__MACOSX/") ||
    clean.includes("/__MACOSX/") ||
    /(?:^|\/)(?:\.DS_Store|Thumbs\.db|~\$[^/]+)$/i.test(clean)
  );
}

export interface ParsedAttachmentResult {
  parsedText?: string;
  sheets?: ParsedSheet[];
  archiveFiles?: string[];
  needsOcr?: boolean;
}

/**
 * 统一多格式附件正文与表格抽取器：
 * 覆盖 PDF / DOC / DOCX / DOCM / WPS / RTF / ODT / OFD / XLS / XLSX / XLSM / XLSB / CSV / TSV / ODS / ET /
 * PPT / PPTX / PPTM / PPSX / DPS / ODP / TXT / MD / XML / ZIP / RAR 及伪装 HTML/MHTML 文档。
 */
export async function parseAttachmentBuffer(
  buf: Buffer,
  extHint: string,
  depth = 0,
): Promise<ParsedAttachmentResult> {
  const sniffed = await sniffBufferKind(buf);
  let effectiveExt = extHint.toLowerCase();

  if (sniffed === "html" || sniffed === "mhtml") {
    return { parsedText: extractHtmlDocText(buf) };
  }
  if (sniffed === "rtf") {
    return { parsedText: extractRtfText(buf) };
  }
  if (
    sniffed &&
    (["docx", "xlsx", "pptx", "ofd", "odt", "ods", "odp", "pdf", "doc", "xls", "ppt"].includes(
      sniffed,
    ) ||
      effectiveExt === "bin" ||
      !KNOWN_ATTACHMENT_EXTS.has(effectiveExt))
  ) {
    effectiveExt = sniffed;
  }

  if (SPREADSHEET_EXTS.has(effectiveExt)) {
    return parseWorkbookBuffer(buf, { ext: effectiveExt });
  }

  if (effectiveExt === "docx" || effectiveExt === "docm") {
    let text = "";
    try {
      const res = await mammoth.extractRawText({ buffer: buf });
      text = normalizePlainText(res.value, 16000);
    } catch {
      /* 使用 XML 兜底 */
    }
    if (text.length < 16) {
      try {
        const xmlText = await extractDocxXmlFallback(buf);
        if (xmlText.length > text.length) text = xmlText;
      } catch {
        /* ignore */
      }
    }
    return { parsedText: text };
  }

  if (effectiveExt === "doc" || effectiveExt === "wps") {
    try {
      const extractor = new WordExtractor();
      const doc = await extractor.extract(buf);
      const parts = [
        doc.getHeaders?.({ includeFooters: false }) ?? "",
        doc.getBody?.() ?? "",
        doc.getTextboxes?.() ?? "",
        doc.getFootnotes?.() ?? "",
        doc.getEndnotes?.() ?? "",
        doc.getFooters?.() ?? "",
      ]
        .map((s) => s.trim())
        .filter(Boolean);
      const text = normalizePlainText(parts.join("\n\n"), 16000);
      if (text) return { parsedText: text };
    } catch {
      /* 少数 WPS/非标 doc 尝试文本兜底 */
    }
    return {};
  }

  if (effectiveExt === "odt" || effectiveExt === "odp") {
    const text = await extractOdfText(buf, effectiveExt === "odp");
    return { parsedText: text };
  }

  if (effectiveExt === "pptx" || effectiveExt === "pptm" || effectiveExt === "ppsx") {
    const text = await extractPptxText(buf);
    return { parsedText: text };
  }

  if (effectiveExt === "ppt" || effectiveExt === "dps") {
    const text = extractPptBinaryText(buf);
    return { parsedText: text };
  }

  if (effectiveExt === "ofd") {
    const text = await extractOfdText(buf);
    return { parsedText: text };
  }

  if (effectiveExt === "pdf") {
    const pdf = await extractText(new Uint8Array(buf), { mergePages: true });
    const txt = formatPdfText(String(pdf.text ?? ""));
    return {
      parsedText: txt,
      ...(txt.length < 40 && buf.byteLength > 20 * 1024 ? { needsOcr: true } : {}),
    };
  }

  if (effectiveExt === "txt" || effectiveExt === "md" || effectiveExt === "xml") {
    let raw = decodeTextBuffer(buf);
    if (effectiveExt === "xml") {
      raw = decodeHtmlEntities(raw.replace(/<[^>]+>/g, " "));
    }
    return { parsedText: normalizePlainText(raw, 16000) };
  }

  if ((effectiveExt === "zip" || effectiveExt === "rar") && depth < 1) {
    const entries =
      effectiveExt === "zip" ? await listZipEntries(buf) : await listRarEntries(buf);
    const validEntries = entries.filter((e) => !shouldSkipArchivePath(e.name));
    const archiveFiles = validEntries.map((e) => e.name.replace(/\\/g, "/"));
    const mergedSheets: ParsedSheet[] = [];
    const textSections: string[] = [`[压缩包内共 ${archiveFiles.length} 个文件]`];
    let totalExtractedBytes = 0;

    for (const entry of validEntries.slice(0, MAX_ARCHIVE_ENTRIES)) {
      const displayName = entry.name.replace(/\\/g, "/");
      const baseName = path.posix.basename(displayName);
      let entryBuf: Buffer;
      try {
        entryBuf = await entry.read();
      } catch {
        textSections.push(`── ${displayName}（解压读取失败）`);
        continue;
      }

      if (entryBuf.byteLength === 0 || entryBuf.byteLength > MAX_FILE_BYTES) continue;
      if (totalExtractedBytes + entryBuf.byteLength > MAX_ARCHIVE_TOTAL_BYTES) break;
      totalExtractedBytes += entryBuf.byteLength;

      const entryExt = extractKnownExt(baseName) ?? "bin";
      try {
        const inner = await parseAttachmentBuffer(entryBuf, entryExt, depth + 1);
        if (inner.sheets?.length && mergedSheets.length < 12) {
          for (const sh of inner.sheets) {
            if (mergedSheets.length >= 12) break;
            mergedSheets.push({
              ...sh,
              name: `${baseName} · ${sh.name}`.slice(0, 64),
            });
          }
        }
        if (inner.parsedText?.trim()) {
          textSections.push(`── ${displayName} ──\n${inner.parsedText.slice(0, 6000)}`);
        }
      } catch {
        textSections.push(`── ${displayName}（暂不支持或加密文件）`);
      }
    }

    if (archiveFiles.length > MAX_ARCHIVE_ENTRIES) {
      textSections.push(`（其余 ${archiveFiles.length - MAX_ARCHIVE_ENTRIES} 个文件未展开）`);
    }

    return {
      archiveFiles,
      ...(mergedSheets.length ? { sheets: mergedSheets } : {}),
      parsedText: textSections.join("\n\n").slice(0, MAX_TEXT_CHARS),
    };
  }

  return {};
}

interface DownloadedFile {
  buf: Buffer;
  contentDisposition?: string;
  contentType?: string;
}

async function downloadFile(url: string, referer?: string): Promise<DownloadedFile> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "User-Agent": UA, Accept: "*/*" };
    if (referer) headers.Referer = referer;
    const res = await fetch(url, { headers, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_FILE_BYTES) throw new Error(`附件过大 (${Math.round(len / 1048576)}MB)`);
    const arr = await res.arrayBuffer();
    if (arr.byteLength === 0) throw new Error("空文件");
    if (arr.byteLength > MAX_FILE_BYTES) throw new Error("附件超过 20MB 上限");

    const buf = Buffer.from(arr);
    // 只有返回真实网页错误页才拒收；含 Office 命名空间的伪装 `.doc` 放行并解析
    if (ct.includes("text/html") && !/\.html?$/i.test(url)) {
      const head = buf.subarray(0, 600).toString("latin1");
      const isWordHtml =
        /urn:schemas-microsoft-com:office:(?:word|office)|ProgId=Word\.Document/i.test(head);
      if (!isWordHtml) {
        throw new Error("返回 HTML 错误页而非附件文件");
      }
    }

    return {
      buf,
      contentDisposition: res.headers.get("content-disposition") ?? undefined,
      contentType: ct || undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 供存量附件重解析与改名修复复用（零网络下载） */
export async function parseAttachmentFile(
  localPath: string,
  rawName: string,
  url: string,
): Promise<
  ParsedAttachmentResult & {
    safeName: string;
    ext: string;
    size: number;
    sha256: string;
  }
> {
  const buf = await fs.readFile(localPath);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const { safeName, ext } = await resolveAttachmentMeta(rawName, url, { buf });
  const parsed = await parseAttachmentBuffer(buf, ext, 0);
  return {
    safeName,
    ext,
    size: buf.byteLength,
    sha256,
    ...parsed,
  };
}

export async function downloadAndParseAttachments(
  items: { name: string; url: string; embedded?: boolean }[],
  referer?: string,
): Promise<NoticeAttachment[]> {
  const results: NoticeAttachment[] = [];
  await fs.mkdir(ATTACHMENTS_DIR, { recursive: true });

  for (const item of items.slice(0, MAX_FILES_PER_NOTICE)) {
    const preMeta = await resolveAttachmentMeta(item.name, item.url);
    const id = createHash("sha256").update(item.url).digest("hex").slice(0, 12);

    try {
      const dl = await downloadFile(item.url, referer);
      const { safeName, ext } = await resolveAttachmentMeta(item.name, item.url, {
        contentDisposition: dl.contentDisposition,
        contentType: dl.contentType,
        buf: dl.buf,
      });

      const sha256 = createHash("sha256").update(dl.buf).digest("hex");
      const sha16 = sha256.slice(0, 16);
      const storedName = `${sha16}_${safeName}`;
      const localPath = path.join(ATTACHMENTS_DIR, storedName);

      try {
        await fs.access(localPath);
      } catch {
        const tmp = `${localPath}.tmp`;
        await fs.writeFile(tmp, dl.buf);
        await fs.rename(tmp, localPath);
      }

      const base: NoticeAttachment = {
        id,
        name: safeName,
        ext,
        url: item.url,
        localPath,
        size: dl.buf.byteLength,
        sha256,
        ...(item.embedded ? { embedded: true } : {}),
      };

      const parsed = await parseAttachmentBuffer(dl.buf, ext, 0);
      if (parsed.sheets?.length) base.sheets = parsed.sheets;
      if (parsed.parsedText) base.parsedText = parsed.parsedText;
      if (parsed.archiveFiles?.length) base.archiveFiles = parsed.archiveFiles;
      if (parsed.needsOcr) base.needsOcr = true;

      results.push(base);
    } catch (e) {
      results.push({
        id,
        name: preMeta.safeName,
        ext: preMeta.ext,
        url: item.url,
        ...(item.embedded ? { embedded: true } : {}),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return results;
}
