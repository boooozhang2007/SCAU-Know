/**
 * 静态数据快照导出与 CI/CD 部署触发模块：
 *   1. 将精简列表 `notices-summary.json`、按条拆分详情 `details/<id>.json` 与 `manifest.json` 导出至 `public/static-data/`
 *   2. 将通知内所有镜像图片改写为 `/media/thumbs/..._w1200.webp` 静态缩略图路径，并剔除本地磁盘与 `/api/` 内部路径
 *   3. 可选触发 Cloudflare Pages / Vercel Deploy Hook 或 GitHub Actions `repository_dispatch`
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { CATEGORIES } from "@/lib/site";
import { loadNotices, toNoticeSummary } from "@/lib/data";
import { getScheduleStatus } from "@/lib/crawl/scheduler";
import { staticWebpThumbPath } from "@/lib/media-url";
import type { Notice } from "@/lib/types";

const STATIC_DATA_DIR = path.join(process.cwd(), "public", "static-data");
const DETAILS_DIR = path.join(STATIC_DATA_DIR, "details");

const RASTER_MEDIA_RE =
  /^\/(?:api\/)?media\/(?!attachments\/).+\.(?:png|jpe?g|webp|bmp|avif)(?:[?#].*)?$/i;

function isHotlinkBlockedOrig(url?: string): boolean {
  if (!url) return false;
  return /https?:\/\/[^/]*(qpic\.cn|qlogo\.cn|weixin\.qq\.com)/i.test(url);
}

function rewriteMediaForStatic(url: string | undefined, cdnBase: string): string | undefined {
  if (!url) return undefined;
  let next = url;
  if (RASTER_MEDIA_RE.test(url)) {
    next = staticWebpThumbPath(url, 1200);
  } else if (url.startsWith("/api/media/")) {
    next = url.replace(/^\/api\/media\//, "/media/");
  }
  if (cdnBase && next.startsWith("/media/")) {
    return `${cdnBase}${next}`;
  }
  return next;
}

function sanitizeNoticeForStatic(n: Notice, cdnBase: string): Notice {
  const cover = rewriteMediaForStatic(n.cover, cdnBase);
  const blocks = n.blocks?.map((blk) => {
    if (blk.type !== "image") return blk;
    const src = rewriteMediaForStatic(blk.src, cdnBase) ?? blk.src;
    const originalSrc =
      blk.originalSrc && !isHotlinkBlockedOrig(blk.originalSrc) && !blk.originalSrc.startsWith("/api/media/")
        ? blk.originalSrc
        : src;
    return { ...blk, src, originalSrc };
  });
  const attachments = n.attachments?.map((a) => ({
    id: a.id,
    name: a.name,
    ext: a.ext,
    url: a.url,
    size: a.size,
    ...(a.embedded ? { embedded: true } : {}),
    ...(a.needsOcr ? { needsOcr: true } : {}),
    ...(a.archiveFiles?.length ? { archiveFiles: a.archiveFiles } : {}),
    ...(a.sheets?.length ? { sheets: a.sheets } : {}),
    ...(a.parsedText ? { parsedText: a.parsedText } : {}),
    ...(a.error ? { error: a.error } : {}),
  }));

  return {
    ...n,
    cover,
    blocks,
    attachments: attachments?.length ? attachments : undefined,
  };
}

export interface StaticExportSummary {
  exportedAt: string;
  total: number;
  categories: number;
  filesWritten: string[];
  deployTriggers: { target: string; ok: boolean; status?: number; error?: string }[];
}

export async function exportStaticDataSnapshot(): Promise<StaticExportSummary> {
  const now = new Date();
  const { notices, fromCrawl } = await loadNotices(now);
  const cdnBase = (process.env.MEDIA_CDN_BASE ?? "").trim().replace(/\/+$/, "");

  await fs.mkdir(DETAILS_DIR, { recursive: true });
  // 清理旧分片和旧版全量重复文件，保持输出紧凑无冗余
  await fs.rm(path.join(STATIC_DATA_DIR, "notices.json"), { force: true });
  await fs.rm(path.join(STATIC_DATA_DIR, "by-category"), { recursive: true, force: true });

  const existingDetailFiles = await fs.readdir(DETAILS_DIR).catch(() => []);
  const activeDetailNames = new Set(notices.map((n) => `${n.id}.json`));
  for (const fname of existingDetailFiles) {
    if (!activeDetailNames.has(fname)) {
      await fs.rm(path.join(DETAILS_DIR, fname), { force: true });
    }
  }

  const sanitizedFull = notices.map((n) => sanitizeNoticeForStatic(n, cdnBase));
  const summaries = sanitizedFull.map(toNoticeSummary);

  const filesWritten: string[] = [];

  const summaryFile = path.join(STATIC_DATA_DIR, "notices-summary.json");
  await fs.writeFile(summaryFile, JSON.stringify(summaries), "utf8");
  filesWritten.push("public/static-data/notices-summary.json");

  for (const item of sanitizedFull) {
    const detailPath = path.join(DETAILS_DIR, `${item.id}.json`);
    await fs.writeFile(detailPath, JSON.stringify(item), "utf8");
  }
  filesWritten.push(`public/static-data/details/*.json (${sanitizedFull.length})`);

  const counts: Record<string, number> = {};
  for (const cat of CATEGORIES) {
    counts[cat.slug] = summaries.filter((n) => n.category === cat.slug).length;
  }

  const sched = await getScheduleStatus().catch(() => null);
  const manifest = {
    exportedAt: now.toISOString(),
    fromCrawl,
    total: summaries.length,
    syncIntervalSec: sched?.config.frontendSyncSeconds ?? 60,
    counts,
    lastReport: null,
  };
  await fs.writeFile(
    path.join(STATIC_DATA_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  filesWritten.push("public/static-data/manifest.json");

  return {
    exportedAt: now.toISOString(),
    total: summaries.length,
    categories: CATEGORIES.length,
    filesWritten,
    deployTriggers: [],
  };
}

export async function triggerStaticDeployHooks(): Promise<
  StaticExportSummary["deployTriggers"]
> {
  const results: StaticExportSummary["deployTriggers"] = [];

  const cfHook = process.env.CF_PAGES_DEPLOY_HOOK?.trim();
  if (cfHook) {
    try {
      const r = await fetch(cfHook, { method: "POST" });
      results.push({ target: "cloudflare-pages", ok: r.ok, status: r.status });
    } catch (e) {
      results.push({
        target: "cloudflare-pages",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const vercelHook = process.env.VERCEL_DEPLOY_HOOK?.trim();
  if (vercelHook) {
    try {
      const r = await fetch(vercelHook, { method: "POST" });
      results.push({ target: "vercel", ok: r.ok, status: r.status });
    } catch (e) {
      results.push({
        target: "vercel",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const ghRepo = process.env.GITHUB_REPO?.trim();
  const ghToken = process.env.GITHUB_TOKEN?.trim();
  if (ghRepo && ghToken) {
    try {
      const r = await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${ghToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event_type: "crawl-updated" }),
      });
      results.push({ target: "github-actions", ok: r.ok, status: r.status });
    } catch (e) {
      results.push({
        target: "github-actions",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return results;
}
