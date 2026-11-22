#!/usr/bin/env node
/**
 * 存量通知回补脚本：
 *   1. 重新解析缺少正文 / 只有附件文件名 / 漏采 wp_pdf_player 内嵌 PDF / 一期旧抓取的官网通知
 *   2. 下载并解析正文内嵌 PDF 与附件（DOCX/XLSX/PDF），将内嵌 PDF 提升为正式段落与摘要
 *   3. 识别跳转 CAS 统一身份认证的通知并标记 `requiresAuth: true`
 *   4. 刷新 AI/规则结构化元数据并同步导出 `public/static-data/`
 */

import fs from "node:fs";
import path from "node:path";

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

async function mapLimit(items, limit, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

const SPOTLIGHT_IDS = new Set([
  "info_442989",
  "art_452051",
  "wcce_451128",
  "spxy_451220",
  "spxy_451221",
  "spxy_451044",
  "xxgk_451578",
  "art_450941",
]);

function isBadOrRemoteImg(u) {
  return Boolean(
    u && (/\/(?:undefined|null)(?:$|[?#])/i.test(u) || /^https?:\/\//i.test(u)),
  );
}

function isLocalMediaImg(u) {
  return Boolean(u && (u.startsWith("/api/media/") || u.startsWith("/media/")));
}

function summarizeState(n) {
  const imgBlocks = (n.blocks ?? []).filter((b) => b.type === "image");
  const tableBlocks = (n.blocks ?? []).filter((b) => b.type === "table");
  return {
    id: n.id,
    requiresAuth: Boolean(n.requiresAuth),
    cover: n.cover ?? null,
    imgSrcs: imgBlocks.map((b) => b.src),
    tableCount: tableBlocks.length,
    tables: tableBlocks.map((t) => ({
      caption: t.caption ?? null,
      headers: t.headers,
      rows: t.rows.length,
      hasSpans: Boolean(t.hasSpans),
      sampleRow: t.rows[1]?.map((c) => c.text) ?? null,
    })),
    summary: (n.summary ?? "").slice(0, 60),
    paraCount: n.paragraphs?.length ?? 0,
    blockCount: n.blocks?.length ?? 0,
    attCount: n.attachments?.length ?? 0,
    atts: (n.attachments ?? []).map((a) => ({
      name: a.name,
      ext: a.ext,
      embedded: Boolean(a.embedded),
      textLen: a.parsedText?.length ?? 0,
      sheets: a.sheets?.length ?? 0,
    })),
  };
}

async function main() {
  loadEnvLocal();
  const imagesOnly = process.argv.includes("--images-only");
  const tablesOnly = process.argv.includes("--tables-only");
  const { readNotices, writeNotices } = await import("../src/lib/crawl/store.ts");
  const { fetchPage, hydrateNoticeDetail } = await import("../src/lib/crawl/engine.ts");
  const { mirrorMedia } = await import("../src/lib/crawl/media.ts");
  const { extractArticle, isAttachmentOnlyText, titleMatches } = await import(
    "../src/lib/crawl/parse.ts"
  );
  const { enrichNotice } = await import("../src/lib/ai/enrich.ts");
  const { exportStaticDataSnapshot } = await import("../src/lib/export-static.ts");

  const notices = await readNotices();

  const candidates = notices.filter((n) => {
    if (!n.url || n.url.includes("mp.weixin.qq.com") || n.id.startsWith("wx_")) {
      return false;
    }
    if (tablesOnly) {
      return !n.requiresAuth;
    }
    const badImages =
      isBadOrRemoteImg(n.cover) ||
      Boolean(n.blocks?.some((b) => b.type === "image" && isBadOrRemoteImg(b.src)));
    if (imagesOnly) return badImages;

    const noAtt = !(n.attachments && n.attachments.length > 0);
    const paraList = n.paragraphs ?? [];
    const noBlocks = !(n.blocks && n.blocks.length > 0);
    const emptyOrShort =
      paraList.length === 0 || paraList.join("").length < 100;
    const onlyAttParas =
      paraList.length === 0 || paraList.every((p) => isAttachmentOnlyText(p));
    const oldFetched = (n.fetchedAt ?? "") < "2026-11-21T12:00:00Z";
    const attOnlySummary = isAttachmentOnlyText(n.summary ?? "");

    return (
      badImages ||
      (noAtt && (noBlocks || emptyOrShort || onlyAttParas || oldFetched)) ||
      paraList.length === 0 ||
      onlyAttParas ||
      attOnlySummary
    );
  });

  const beforeSpotlights = new Map();
  for (const n of notices) {
    if (imagesOnly ? candidates.includes(n) : SPOTLIGHT_IDS.has(n.id)) {
      beforeSpotlights.set(n.id, summarizeState(n));
    }
  }

  console.log(
    `共读取 ${notices.length} 条通知，筛选${tablesOnly ? "正文 HTML 表格扫描" : imagesOnly ? "图片异常" : "需检查回补"} ${candidates.length} 条...`,
  );

  let scanned = 0;
  let updatedCount = 0;
  let newEmbeddedPdfs = 0;
  let newlyAttachedNotices = 0;
  let tableNoticesFound = 0;
  let totalTablesExtracted = 0;
  let casCount = 0;
  let failedFetch = 0;

  const workerConcurrency = tablesOnly ? 6 : 4;

  await mapLimit(candidates, workerConcurrency, async (n) => {
    await new Promise((r) => setTimeout(r, 60));
    const fallbackYear = Number((n.publishedAt ?? "").slice(0, 4)) || new Date().getFullYear();

    if (tablesOnly) {
      let page;
      try {
        page = await fetchPage(n.url, { retries: 0 });
      } catch {
        scanned++;
        failedFetch++;
        if (scanned % 40 === 0) console.log(`进度 ${scanned}/${candidates.length}...`);
        return;
      }
      if (page.requiresAuth) {
        scanned++;
        return;
      }
      const quick = extractArticle(page.html, n.url);
      if (quick.pageTitle && !titleMatches(n.title, quick.pageTitle)) {
        scanned++;
        return;
      }
      const quickTables = quick.blocks.filter((b) => b.type === "table");
      if (quickTables.length === 0) {
        scanned++;
        if (scanned % 50 === 0 || scanned === candidates.length) {
          console.log(
            `进度 ${scanned}/${candidates.length} · 含表格通知 ${tableNoticesFound}（共 ${totalTablesExtracted} 张表）`,
          );
        }
        return;
      }
    }

    const detail = await hydrateNoticeDetail(n.url, n.title, {
      mirrorImages: true,
      parseAttachments: true,
      fallbackYear,
    });
    scanned++;

    if (!detail.ok) {
      if (imagesOnly) {
        // 若原文页面已下线（如 410 Gone），仍尝试对已有远程图片直接镜像并清理坏链
        let imgChanged = false;
        let nextCover = undefined;
        if (n.blocks?.length) {
          const nextBlocks = [];
          for (const blk of n.blocks) {
            if (blk.type !== "image") {
              nextBlocks.push(blk);
              continue;
            }
            if (isLocalMediaImg(blk.src)) {
              if (!nextCover) nextCover = blk.src;
              nextBlocks.push(blk);
              continue;
            }
            const mirrored = await mirrorMedia(blk.originalSrc || blk.src, "image", n.url);
            if (mirrored && !/\/(?:undefined|null)(?:$|[?#])/i.test(mirrored)) {
              if (!nextCover) nextCover = mirrored;
              nextBlocks.push({ ...blk, src: mirrored });
            }
            imgChanged = true;
          }
          n.blocks = nextBlocks;
        }
        if (isBadOrRemoteImg(n.cover)) {
          if (nextCover) n.cover = nextCover;
          else {
            const mirroredCover = await mirrorMedia(n.cover, "image", n.url);
            if (mirroredCover && !/\/(?:undefined|null)(?:$|[?#])/i.test(mirroredCover)) {
              n.cover = mirroredCover;
            } else {
              delete n.cover;
            }
          }
          imgChanged = true;
        }
        if (imgChanged) {
          n.fetchedAt = new Date().toISOString();
          updatedCount++;
        } else {
          failedFetch++;
        }
      } else {
        failedFetch++;
      }
      if (scanned % 25 === 0) {
        console.log(`进度 ${scanned}/${candidates.length}...`);
      }
      return;
    }

    let changed = false;

    if (detail.requiresAuth) {
      if (!n.requiresAuth) {
        n.requiresAuth = true;
        changed = true;
      }
      casCount++;
    } else {
      const prevCoverBad = Boolean(n.cover) && isBadOrRemoteImg(n.cover);
      const prevBlocksBad = Boolean(
        n.blocks?.some((b) => b.type === "image" && isBadOrRemoteImg(b.src)),
      );

      if (prevCoverBad || prevBlocksBad) {
        if (detail.cover && !/\/(?:undefined|null)(?:$|[?#])/i.test(detail.cover)) {
          n.cover = detail.cover;
        } else if (prevCoverBad) {
          delete n.cover;
        }
        if (detail.blocks?.length) {
          n.blocks = detail.blocks;
        } else if (prevBlocksBad && n.blocks) {
          n.blocks = n.blocks.filter(
            (b) => !(b.type === "image" && isBadOrRemoteImg(b.src)),
          );
        }
        changed = true;
      }

      const prevAtts = n.attachments ?? [];
      const hadEmbeddedPdf = prevAtts.some((a) => a.embedded && a.ext === "pdf");
      const nextAtts = detail.attachments ?? [];
      const hasEmbeddedPdf = nextAtts.some((a) => a.embedded && a.ext === "pdf");

      if (nextAtts.length > 0 && (nextAtts.length > prevAtts.length || (!hadEmbeddedPdf && hasEmbeddedPdf))) {
        if (prevAtts.length === 0) newlyAttachedNotices++;
        if (!hadEmbeddedPdf && hasEmbeddedPdf) newEmbeddedPdfs++;
        n.attachments = nextAtts;
        changed = true;
      }

      const detailTables = (detail.blocks ?? []).filter((b) => b.type === "table");
      if (detailTables.length > 0) {
        tableNoticesFound++;
        totalTablesExtracted += detailTables.length;
      }

      const prevParaOnlyAtt =
        !(n.paragraphs?.length) || n.paragraphs.every((p) => isAttachmentOnlyText(p));
      const nextParaMeaningful =
        detail.paragraphs.length > 0 && !detail.paragraphs.every((p) => isAttachmentOnlyText(p));
      const prevLen = (n.paragraphs ?? []).join("").length;
      const nextLen = detail.paragraphs.join("").length;
      const hadTableBlocks = Boolean(n.blocks?.some((b) => b.type === "table"));

      if (
        detailTables.length > 0 ||
        (prevParaOnlyAtt && nextParaMeaningful) ||
        (nextParaMeaningful && nextLen > prevLen * 1.15) ||
        (!(n.paragraphs?.length) && detail.paragraphs.length > 0)
      ) {
        n.paragraphs = detail.paragraphs;
        if (detail.blocks?.length) n.blocks = detail.blocks;
        if (detailTables.length > 0 || !hadTableBlocks) changed = true;
      } else if (detail.blocks?.length && !(n.blocks?.length)) {
        n.blocks = detail.blocks;
        changed = true;
      }

      if (detail.cover && !n.cover) {
        n.cover = detail.cover;
        changed = true;
      }

      if (
        detail.summary &&
        ((isAttachmentOnlyText(n.summary ?? "") && !isAttachmentOnlyText(detail.summary)) ||
          (!isAttachmentOnlyText(detail.summary) && detail.summary.length > (n.summary?.length ?? 0)))
      ) {
        n.summary = detail.summary;
        changed = true;
      }

      if (detail.startsAt && !n.startsAt) {
        n.startsAt = detail.startsAt;
        changed = true;
      }
      if (detail.venue && !n.venue) {
        n.venue = detail.venue;
        changed = true;
      }
      if (detail.registration && !n.registration) {
        n.registration = true;
        changed = true;
      }

      if (changed) {
        n.fetchedAt = new Date().toISOString();
        n.ai = await enrichNotice(n);
      }
    }

    if (changed) updatedCount++;

    if (scanned % 25 === 0 || scanned === candidates.length) {
      console.log(`进度 ${scanned}/${candidates.length} · 已更新 ${updatedCount} · 含表格 ${tableNoticesFound}(${totalTablesExtracted}表) · 新内嵌PDF ${newEmbeddedPdfs} · 新补附件 ${newlyAttachedNotices} · CAS ${casCount}`);
    }
  });

  await writeNotices(notices);
  const snap = await exportStaticDataSnapshot();

  console.log("\n=== 回补完成汇总 ===");
  console.log({
    totalNotices: notices.length,
    scanned,
    updatedCount,
    tableNoticesFound,
    totalTablesExtracted,
    newEmbeddedPdfs,
    newlyAttachedNotices,
    casCount,
    failedFetch,
    staticExported: snap.total,
  });

  console.log("\n=== 重点样本修复前后对比 ===");
  const reportIds = imagesOnly
    ? [...beforeSpotlights.keys()]
    : [...SPOTLIGHT_IDS];
  for (const id of reportIds) {
    const after = notices.find((x) => x.id === id);
    console.log(`\n[${id}] BEFORE:`, JSON.stringify(beforeSpotlights.get(id)));
    console.log(`[${id}] AFTER :`, JSON.stringify(after ? summarizeState(after) : null));
  }
}

main().catch((e) => {
  console.error("回补脚本异常：", e);
  process.exit(1);
});
