#!/usr/bin/env node
/**
 * 存量附件重解析与清洗脚本：
 *   1. 清除早期宽松规则误抓的网页链接伪附件（.jsp / .htm / .html / 表单页）
 *   2. 修复无有效扩展名或中文点号命名的附件（如 `1.个人成长材料（参考样式）`）
 *   3. 使用全新多格式解析器重解析 `.doc` / `.zip` / `.rar` 及未解析的本地附件
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  KNOWN_ATTACHMENT_EXTS,
  parseAttachmentFile,
} from "../src/lib/crawl/attachments";

const ROOT = process.cwd();
const NOTICES_PATH = path.join(ROOT, "data", "notices.json");
const ATTACHMENTS_DIR = path.join(ROOT, "data", "attachments");

const FALSE_WEBPAGE_EXTS = new Set(["jsp", "jspx", "htm", "html", "asp", "aspx", "php"]);

function isFalsePositiveWebpage(att) {
  const ext = (att.ext || "").toLowerCase();
  if (FALSE_WEBPAGE_EXTS.has(ext)) return true;
  if (/\/infoplus\/form\//i.test(att.url || "")) return true;
  if (ext === "bin" && att.error && !/\/_upload\/article\/files\//i.test(att.url || "")) {
    return true;
  }
  if (!KNOWN_ATTACHMENT_EXTS.has(ext) && att.error && !/\/_upload\/article\/files\//i.test(att.url || "")) {
    return true;
  }
  return false;
}

function summarizeByExt(notices) {
  const stats = {};
  for (const n of notices) {
    for (const a of n.attachments || []) {
      const ext = (a.ext || "none").toLowerCase();
      stats[ext] ||= { total: 0, parsed: 0, sheets: 0, err: 0 };
      stats[ext].total++;
      if (a.parsedText) stats[ext].parsed++;
      if (a.sheets?.length) stats[ext].sheets++;
      if (a.error) stats[ext].err++;
    }
  }
  return stats;
}

async function resolveDiskPath(att) {
  if (att.localPath) {
    try {
      await fs.access(att.localPath);
      return att.localPath;
    } catch {
      /* fallback below */
    }
  }
  if (att.sha256) {
    const prefix = `${att.sha256.slice(0, 16)}_`;
    const files = await fs.readdir(ATTACHMENTS_DIR);
    const match = files.find((f) => f.startsWith(prefix));
    if (match) return path.join(ATTACHMENTS_DIR, match);
  }
  return null;
}

async function main() {
  const raw = await fs.readFile(NOTICES_PATH, "utf8");
  const notices = JSON.parse(raw);

  const before = summarizeByExt(notices);
  let removedWebpages = 0;
  let reparsed = 0;
  let fixedNames = 0;

  for (const notice of notices) {
    if (!Array.isArray(notice.attachments) || notice.attachments.length === 0) continue;

    const kept = [];
    for (const att of notice.attachments) {
      if (isFalsePositiveWebpage(att)) {
        removedWebpages++;
        continue;
      }

      const ext = (att.ext || "").toLowerCase();
      const needsReparse =
        ["doc", "wps", "rtf", "ppt", "pptx", "pptm", "ppsx", "dps", "odt", "ods", "odp", "ofd"].includes(ext) ||
        (["zip", "rar"].includes(ext) && !att.archiveFiles?.length) ||
        !KNOWN_ATTACHMENT_EXTS.has(ext) ||
        (!att.parsedText && !att.sheets?.length && Boolean(att.localPath));

      if (needsReparse) {
        const diskPath = await resolveDiskPath(att);
        if (diskPath) {
          try {
            const parsed = await parseAttachmentFile(diskPath, att.name, att.url);
            if (parsed.safeName !== att.name || parsed.ext !== att.ext) {
              fixedNames++;
            }
            const nextStoredName = `${parsed.sha256.slice(0, 16)}_${parsed.safeName}`;
            const nextLocalPath = path.join(ATTACHMENTS_DIR, nextStoredName);
            if (path.resolve(diskPath) !== path.resolve(nextLocalPath)) {
              try {
                await fs.access(nextLocalPath);
              } catch {
                await fs.copyFile(diskPath, nextLocalPath);
              }
            }
            att.name = parsed.safeName;
            att.ext = parsed.ext;
            att.size = parsed.size;
            att.sha256 = parsed.sha256;
            att.localPath = nextLocalPath;
            if (parsed.parsedText) att.parsedText = parsed.parsedText;
            else delete att.parsedText;
            if (parsed.sheets?.length) att.sheets = parsed.sheets;
            else delete att.sheets;
            if (parsed.archiveFiles?.length) att.archiveFiles = parsed.archiveFiles;
            else delete att.archiveFiles;
            if (parsed.needsOcr) att.needsOcr = true;
            else delete att.needsOcr;
            delete att.error;
            reparsed++;
          } catch (err) {
            console.warn(`重解析失败 [${notice.id}] ${att.name}:`, err?.message || err);
          }
        }
      }

      kept.push(att);
    }

    if (kept.length > 0) {
      notice.attachments = kept;
    } else {
      delete notice.attachments;
    }
  }

  const tmp = `${NOTICES_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(notices), "utf8");
  await fs.rename(tmp, NOTICES_PATH);

  const after = summarizeByExt(notices);
  console.log(
    JSON.stringify(
      {
        removedFalseWebpageAttachments: removedWebpages,
        reparsedAttachments: reparsed,
        fixedNamesOrExtensions: fixedNames,
        before,
        after,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("reparse-attachments 异常：", err);
  process.exit(1);
});
