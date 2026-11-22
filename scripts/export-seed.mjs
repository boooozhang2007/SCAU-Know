#!/usr/bin/env node
/**
 * 从本地真实采集数据（data/notices.json）筛选各分类代表性公开通知，
 * 清理本地镜像路径与内部字段后导出至 `src/lib/seed-notices.json`，
 * 作为仓库内置的真实首屏数据集（每条均带真实原文 URL）。
 *
 * 用法：
 *   pnpm export:seed
 *   pnpm export:seed -- --per-category 6
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

function parsePerCategoryArg() {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--per-category");
  if (idx >= 0 && args[idx + 1]) {
    const parsed = Number(args[idx + 1]);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 30) {
      return Math.floor(parsed);
    }
  }
  return 6;
}

const VALID_ARTICLE_URL_RE =
  /^https:\/\/(?:[^/]+\.scau\.edu\.cn\/|mp\.weixin\.qq\.com\/s\/)/i;

function hasValidArticleUrl(url) {
  if (!url || !VALID_ARTICLE_URL_RE.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.pathname.length > 1;
  } catch {
    return false;
  }
}

function isScauUrl(url) {
  return /^https:\/\/[^/]+\.scau\.edu\.cn\//i.test(url);
}

function isSafeRemoteImage(url) {
  return Boolean(url && /^https:\/\/[^/]*scau\.edu\.cn\//i.test(url));
}

function hasNonEmptyBody(n) {
  if (Array.isArray(n.paragraphs) && n.paragraphs.length > 0) return true;
  if (Array.isArray(n.blocks)) {
    return n.blocks.some((b) => b.type === "text" || b.type === "table");
  }
  return false;
}

function richnessScore(n) {
  let score = 0;
  if (n.startsAt) score += 2;
  if (Array.isArray(n.blocks) && n.blocks.some((b) => b.type === "table")) {
    score += 1;
  }
  return score;
}

function compareCandidates(a, b) {
  const aScau = isScauUrl(a.url) ? 1 : 0;
  const bScau = isScauUrl(b.url) ? 1 : 0;
  if (aScau !== bScau) return bScau - aScau;

  const aRecent = a.publishedAt >= "2025-01-01" ? 1 : 0;
  const bRecent = b.publishedAt >= "2025-01-01" ? 1 : 0;
  if (aRecent !== bRecent) return bRecent - aRecent;

  const aRich = richnessScore(a);
  const bRich = richnessScore(b);
  if (aRich !== bRich) return bRich - aRich;

  return b.publishedAt.localeCompare(a.publishedAt);
}

function capBlocksPreservingTables(blocks, maxBlocks = 30) {
  if (blocks.length <= maxBlocks) return blocks;
  const tableIndices = new Set();
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === "table") tableIndices.add(i);
  }
  let nonTableBudget = Math.max(0, maxBlocks - tableIndices.size);
  const kept = [];
  for (let i = 0; i < blocks.length && kept.length < maxBlocks; i++) {
    if (tableIndices.has(i)) {
      kept.push(blocks[i]);
    } else if (nonTableBudget > 0) {
      kept.push(blocks[i]);
      nonTableBudget--;
    }
  }
  return kept;
}

function sanitizeAiMeta(ai) {
  if (!ai) return undefined;
  const allowed = {
    cleanTitle: ai.cleanTitle,
    summary: ai.summary,
    category: ai.category,
    subject: ai.subject,
    startsAt: ai.startsAt,
    endsAt: ai.endsAt,
    venue: ai.venue,
    audience: ai.audience,
    registrationRequired: ai.registrationRequired,
    registrationDeadline: ai.registrationDeadline,
    importance: ai.importance,
    tags: ai.tags,
    enrichedBy: ai.enrichedBy,
    enrichedAt: ai.enrichedAt,
  };
  const out = {};
  for (const [k, v] of Object.entries(allowed)) {
    if (v !== undefined) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeNotice(n, parsedTextCap = 300) {
  let cover;
  if (n.cover && Array.isArray(n.blocks)) {
    const matched = n.blocks.find(
      (b) => b.type === "image" && b.src === n.cover && isSafeRemoteImage(b.originalSrc),
    );
    if (matched && matched.type === "image") {
      cover = matched.originalSrc;
    }
  }
  if (!cover && isSafeRemoteImage(n.cover)) {
    cover = n.cover;
  }

  let blocks;
  if (Array.isArray(n.blocks) && n.blocks.length > 0) {
    const cleaned = [];
    for (const blk of n.blocks) {
      if (blk.type === "text") {
        cleaned.push({ type: "text", text: blk.text });
      } else if (blk.type === "table") {
        cleaned.push({
          type: "table",
          ...(blk.caption ? { caption: blk.caption } : {}),
          headers: blk.headers,
          ...(blk.hasSpans ? { hasSpans: true } : {}),
          rows: blk.rows.slice(0, 25),
        });
      } else if (blk.type === "image" && isSafeRemoteImage(blk.originalSrc)) {
        cleaned.push({
          type: "image",
          src: blk.originalSrc,
          originalSrc: blk.originalSrc,
          ...(blk.alt ? { alt: blk.alt } : {}),
        });
      }
    }
    const capped = capBlocksPreservingTables(cleaned, 20);
    if (capped.length > 0) blocks = capped;
  }

  const hasTextBlock = Boolean(blocks?.some((b) => b.type === "text"));
  const paragraphs = hasTextBlock ? [] : (n.paragraphs ?? []).slice(0, 15);

  let attachments;
  if (Array.isArray(n.attachments) && n.attachments.length > 0) {
    const cleanedAtts = [];
    for (const att of n.attachments) {
      if (!att.url || !/^https?:\/\//i.test(att.url)) continue;
      const item = {
        id: att.id,
        name: att.name,
        ext: att.ext,
        url: att.url,
        ...(att.size !== undefined ? { size: att.size } : {}),
        ...(att.embedded ? { embedded: true } : {}),
        ...(att.needsOcr ? { needsOcr: true } : {}),
        ...(att.archiveFiles?.length
          ? { archiveFiles: att.archiveFiles.slice(0, 20) }
          : {}),
        ...(att.sheets?.length
          ? {
              sheets: att.sheets.slice(0, 2).map((s) => ({
                name: s.name,
                headers: s.headers,
                rows: s.rows.slice(0, 10),
                totalRows: s.totalRows,
              })),
            }
          : {}),
        ...(att.parsedText
          ? { parsedText: att.parsedText.slice(0, parsedTextCap) }
          : {}),
      };
      cleanedAtts.push(item);
      if (cleanedAtts.length >= 5) break;
    }
    if (cleanedAtts.length > 0) attachments = cleanedAtts;
  }

  const ai = sanitizeAiMeta(n.ai);

  const out = {
    id: n.id,
    title: n.title,
    category: n.category,
    cluster: n.cluster,
    subject: n.subject,
    tone: n.tone,
    source: n.source,
    publishedAt: n.publishedAt,
    startsAt: n.startsAt ?? null,
    endsAt: n.endsAt ?? null,
    ...(n.venue ? { venue: n.venue } : {}),
    ...(n.registration !== undefined ? { registration: n.registration } : {}),
    summary: n.summary,
    paragraphs,
    ...(blocks ? { blocks } : {}),
    ...(attachments ? { attachments } : {}),
    ...(ai ? { ai } : {}),
    url: n.url,
    ...(cover ? { cover } : {}),
  };
  return out;
}

async function main() {
  loadEnvLocal();
  const perCategory = parsePerCategoryArg();

  const { loadNotices } = await import(
    pathToFileURL(path.join(process.cwd(), "src", "lib", "data.ts")).href
  );
  const { CATEGORIES } = await import(
    pathToFileURL(path.join(process.cwd(), "src", "lib", "site.ts")).href
  );

  const { notices, fromCrawl } = await loadNotices(new Date());
  if (!fromCrawl || notices.length === 0) {
    console.error("未检测到 data/notices.json，请先运行 pnpm crawl");
    process.exit(1);
  }

  const eligible = notices.filter(
    (n) => !n.requiresAuth && hasValidArticleUrl(n.url) && hasNonEmptyBody(n),
  );

  const usedIds = new Set();
  const usedUrls = new Set();
  const chosenRaw = [];
  const perCatCount = {};

  for (const cat of CATEGORIES) {
    const pool = eligible
      .filter((n) => n.category === cat.slug)
      .sort(compareCandidates);

    const catPicked = [];
    const perSourceCount = new Map();

    // Pass 1: 限制单个来源在同分类内最多占 2 条，提升高校部门覆盖多样性
    for (const item of pool) {
      if (catPicked.length >= perCategory) break;
      if (usedIds.has(item.id) || usedUrls.has(item.url)) continue;
      const srcCnt = perSourceCount.get(item.source) ?? 0;
      if (srcCnt >= 2) continue;
      catPicked.push(item);
      usedIds.add(item.id);
      usedUrls.add(item.url);
      perSourceCount.set(item.source, srcCnt + 1);
    }

    // Pass 2: 不足时从剩余候选中补齐
    if (catPicked.length < perCategory) {
      for (const item of pool) {
        if (catPicked.length >= perCategory) break;
        if (usedIds.has(item.id) || usedUrls.has(item.url)) continue;
        catPicked.push(item);
        usedIds.add(item.id);
        usedUrls.add(item.url);
      }
    }

    perCatCount[cat.slug] = catPicked.length;
    chosenRaw.push(...catPicked);
  }

  chosenRaw.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const selected = chosenRaw.map((n) => sanitizeNotice(n, 300));
  let jsonText = JSON.stringify(selected, null, 2);
  if (Buffer.byteLength(`${jsonText}\n`, "utf8") > 400 * 1024) {
    jsonText = JSON.stringify(selected);
  }
  const finalBytes = Buffer.byteLength(`${jsonText}\n`, "utf8");
  if (finalBytes >= 450 * 1024) {
    throw new Error(
      `导出的 seed-notices.json 体积过高（${(finalBytes / 1024).toFixed(1)} KB >= 450 KB），请收紧裁剪策略。`,
    );
  }

  // 安全与链接卫生断言
  if (selected.length < 60) {
    throw new Error(`筛选出的有效通知不足 60 条（实际 ${selected.length} 条），中止导出。`);
  }
  for (const item of selected) {
    if (!/^https:\/\//i.test(item.url) || new URL(item.url).pathname.length <= 1) {
      throw new Error(`检测到无效或首页级 URL：${item.id} -> ${item.url}`);
    }
  }
  const FORBIDDEN_RE =
    /\/api\/media\/|\/media\/(?:covers|images)\/|data\/attachments|qpic\.cn|qlogo\.cn/i;
  if (FORBIDDEN_RE.test(jsonText)) {
    throw new Error("导出的快照中仍包含本地路径或微信防盗链域名，已中止写入。");
  }

  const outPath = path.join(process.cwd(), "src", "lib", "seed-notices.json");
  fs.writeFileSync(outPath, `${jsonText}\n`, "utf8");

  const sizeKb = (Buffer.byteLength(`${jsonText}\n`, "utf8") / 1024).toFixed(1);
  const scauCount = selected.filter((n) => isScauUrl(n.url)).length;
  const wxCount = selected.length - scauCount;
  const eventCount = selected.filter((n) => Boolean(n.startsAt)).length;
  const tableCount = selected.filter((n) =>
    n.blocks?.some((b) => b.type === "table"),
  ).length;
  const attNoticeCount = selected.filter((n) => Boolean(n.attachments?.length)).length;

  console.log(`已导出 ${selected.length} 条真实通知至 src/lib/seed-notices.json (${sizeKb} KB)`);
  console.log(`来源构成：scau.edu.cn ${scauCount} 条 / mp.weixin.qq.com ${wxCount} 条`);
  console.log(`结构特征：含日程事件 ${eventCount} 条 / 含正文表格 ${tableCount} 条 / 含附件 ${attNoticeCount} 条`);
  console.log("各分类数量：", perCatCount);
}

main().catch((e) => {
  console.error("导出内置快照失败：", e);
  process.exit(1);
});
