import { loadFullWorkbookSheets } from "@/lib/crawl/attachments";
import type { CrawledNotice } from "@/lib/crawl/engine";
import { inferSubject } from "@/lib/sources";
import { evaluateAiRelevance } from "@/lib/ai/enrich";
import type { AlertRule } from "./rules";

export interface MatchHit {
  where: "xlsx" | "attachment" | "title" | "body" | "ai";
  keyword: string;
  attachmentName?: string;
  sheetName?: string;
  rowIndex?: number;
  rowDetail?: string;
  snippet?: string;
}

export interface RuleMatchResult {
  matched: boolean;
  exactHit: boolean;
  hits: MatchHit[];
  aiReason?: string;
  aiConfidence?: number;
}

function formatRowDetail(headers: string[], row: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < row.length; i++) {
    const val = (row[i] ?? "").trim();
    if (!val) continue;
    const h = (headers[i] ?? `列${i + 1}`).trim();
    parts.push(`${h}: ${val}`);
  }
  return parts.join(" | ").slice(0, 260);
}

/**
 * 两阶段通知与附件精准匹配：
 * - 第一层：精确关键词与正则扫描（支持读取磁盘完整 .xlsx 工作簿全量行，零幻觉且精确到工作表和行号）
 * - 第二层：可选 AI 语义相关性判定
 */
export async function matchNoticeAgainstRule(
  notice: CrawledNotice,
  rule: AlertRule,
): Promise<RuleMatchResult> {
  if (!rule.enabled) {
    return { matched: false, exactHit: false, hits: [] };
  }

  // 基础维度过滤
  const effectiveCategory = notice.ai?.category ?? notice.category;
  const effectiveSubject = notice.ai?.subject ?? inferSubject(notice.source, notice.title);
  const importance = notice.ai?.importance ?? 3;

  if (rule.categories?.length && !rule.categories.includes(effectiveCategory)) {
    return { matched: false, exactHit: false, hits: [] };
  }
  if (rule.sources?.length && !rule.sources.includes(notice.source)) {
    return { matched: false, exactHit: false, hits: [] };
  }
  if (rule.subjects?.length && !rule.subjects.includes(effectiveSubject)) {
    return { matched: false, exactHit: false, hits: [] };
  }
  if (rule.minImportance && importance < rule.minImportance) {
    return { matched: false, exactHit: false, hits: [] };
  }

  const hits: MatchHit[] = [];
  const keywords = (rule.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const regexes = (rule.regexPatterns ?? [])
    .map((p) => {
      try {
        return new RegExp(p, "i");
      } catch {
        return null;
      }
    })
    .filter((x): x is RegExp => Boolean(x));

  const scopes = new Set(
    rule.scopes.length ? rule.scopes : ["title", "body", "attachment", "xlsx"],
  );

  // 1) 标题匹配
  if (scopes.has("title")) {
    const titleLower = notice.title.toLowerCase();
    for (const kw of keywords) {
      if (titleLower.includes(kw.toLowerCase())) {
        hits.push({ where: "title", keyword: kw, snippet: notice.title });
      }
    }
    for (const re of regexes) {
      const m = notice.title.match(re);
      if (m) hits.push({ where: "title", keyword: m[0], snippet: notice.title });
    }
  }

  // 2) 正文与摘要匹配
  if (scopes.has("body")) {
    const bodyText = [notice.summary, ...notice.paragraphs].join("\n");
    const bodyLower = bodyText.toLowerCase();
    for (const kw of keywords) {
      const idx = bodyLower.indexOf(kw.toLowerCase());
      if (idx >= 0) {
        hits.push({
          where: "body",
          keyword: kw,
          snippet: bodyText.slice(Math.max(0, idx - 24), idx + kw.length + 40),
        });
      }
    }
    for (const re of regexes) {
      const m = bodyText.match(re);
      if (m) hits.push({ where: "body", keyword: m[0], snippet: m[0] });
    }
  }

  // 3) 附件通用文本（PDF / DOCX / XLSX 文本）
  if (scopes.has("attachment") && notice.attachments?.length) {
    for (const att of notice.attachments) {
      const text = att.parsedText ?? "";
      if (!text) continue;
      const lower = text.toLowerCase();
      for (const kw of keywords) {
        const idx = lower.indexOf(kw.toLowerCase());
        if (idx >= 0) {
          hits.push({
            where: "attachment",
            keyword: kw,
            attachmentName: att.name,
            snippet: text.slice(Math.max(0, idx - 20), idx + kw.length + 45),
          });
        }
      }
    }
  }

  // 4) Excel 工作表 & 正文内嵌 HTML 表格行级精确匹配
  if (scopes.has("xlsx") || scopes.has("body")) {
    for (const blk of notice.blocks ?? []) {
      if (blk.type !== "table") continue;
      const tblHeaders = blk.headers.length
        ? blk.headers
        : (blk.rows[0]?.every((c) => c.header)
            ? blk.rows[0].map((c, idx) => c.text || `列${idx + 1}`)
            : []);
      for (let rIdx = 0; rIdx < blk.rows.length; rIdx++) {
        const row = blk.rows[rIdx];
        if (row.every((c) => c.header)) continue;
        const cells = row.map((c) => c.text);
        const rowText = cells.join(" ");
        const rowLower = rowText.toLowerCase();
        let matchedKw: string | null = null;
        for (const kw of keywords) {
          if (rowLower.includes(kw.toLowerCase())) {
            matchedKw = kw;
            break;
          }
        }
        if (!matchedKw) {
          for (const re of regexes) {
            const m = rowText.match(re);
            if (m) {
              matchedKw = m[0];
              break;
            }
          }
        }
        if (matchedKw) {
          hits.push({
            where: scopes.has("xlsx") ? "xlsx" : "body",
            keyword: matchedKw,
            sheetName: blk.caption || "正文表格",
            rowIndex: rIdx + 1,
            rowDetail: formatRowDetail(tblHeaders, cells),
          });
        }
      }
    }
  }

  // 4b) Excel/表格文件附件行级精确匹配（直传表格优先读全量工作簿，压缩包内表格使用已提取工作表）
  if (scopes.has("xlsx") && notice.attachments?.length) {
    const DIRECT_SHEET_EXTS = new Set([
      "xlsx",
      "xls",
      "xlsm",
      "xlsb",
      "csv",
      "tsv",
      "ods",
      "et",
    ]);
    for (const att of notice.attachments) {
      const isDirectSheet = DIRECT_SHEET_EXTS.has(att.ext);
      if (!isDirectSheet && !att.sheets?.length) continue;

      let sheets = att.sheets ?? [];
      if (isDirectSheet && att.localPath) {
        try {
          sheets = await loadFullWorkbookSheets(att.localPath);
        } catch {
          /* 若原文件不可读，回退到内存中预览行 */
        }
      }

      for (const sheet of sheets) {
        for (let rIdx = 0; rIdx < sheet.rows.length; rIdx++) {
          const row = sheet.rows[rIdx];
          const rowText = row.join(" ");
          const rowLower = rowText.toLowerCase();
          let matchedKw: string | null = null;

          for (const kw of keywords) {
            if (rowLower.includes(kw.toLowerCase())) {
              matchedKw = kw;
              break;
            }
          }
          if (!matchedKw) {
            for (const re of regexes) {
              const m = rowText.match(re);
              if (m) {
                matchedKw = m[0];
                break;
              }
            }
          }

          if (matchedKw) {
            hits.push({
              where: "xlsx",
              keyword: matchedKw,
              attachmentName: att.name,
              sheetName: sheet.name,
              rowIndex: rIdx + 2, // +1 表头 +1 1-based 行号
              rowDetail: formatRowDetail(sheet.headers, row),
            });
          }
        }
      }
    }
  }

  const exactHit = hits.length > 0;

  // 若规则没填任何关键词/正则，则只看前面维度 + AI 过滤
  const noKeywordFilter = keywords.length === 0 && regexes.length === 0;
  let aiMatched = false;
  let aiReason = "";
  let aiConfidence = 0;

  if (rule.aiRelevance?.enabled && rule.aiRelevance.prompt) {
    if (!exactHit || rule.aiRelevance.requireAi) {
      const aiRes = await evaluateAiRelevance(notice, rule.aiRelevance.prompt);
      aiConfidence = aiRes.confidence;
      aiReason = aiRes.reason;
      aiMatched =
        aiRes.matched && aiRes.confidence >= (rule.aiRelevance.minConfidence ?? 0.6);
      if (aiMatched) {
        hits.push({
          where: "ai",
          keyword: "AI语义匹配",
          snippet: aiRes.reason,
        });
      }
    }
  }

  let matched = false;
  if (rule.aiRelevance?.enabled && rule.aiRelevance.requireAi) {
    matched = (exactHit || noKeywordFilter) && aiMatched;
  } else {
    matched = exactHit || aiMatched || (noKeywordFilter && !rule.aiRelevance?.enabled);
  }

  return {
    matched,
    exactHit,
    hits,
    aiReason: aiReason || notice.ai?.notifyReason,
    aiConfidence,
  };
}
