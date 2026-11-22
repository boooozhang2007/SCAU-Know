#!/usr/bin/env node
/**
 * 预生成首页/列表卡片所需的 WebP 封面缩略图（w640），
 * 与 `/api/media/[...path]?w=640` 共享完全一致的 `.thumbs/` 缓存文件命名规则。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const NOTICES_PATH = path.join(ROOT, "data", "notices.json");
const PUBLIC_MEDIA_DIR = path.join(ROOT, "public", "media");
const THUMB_CACHE_DIR = path.join(PUBLIC_MEDIA_DIR, ".thumbs");
const RASTER_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".avif"]);
const WIDTH = 640;
const CONCURRENCY = 4;

function parseCoverSegments(coverUrl) {
  if (!coverUrl || typeof coverUrl !== "string") return null;
  const cleaned = coverUrl.split("?")[0].split("#")[0];
  const m = cleaned.match(/^\/(?:api\/)?media\/(.+)$/);
  if (!m) return null;
  const segs = m[1].split("/").filter(Boolean);
  if (segs.length === 0 || segs[0] === "attachments" || segs[0] === ".thumbs") return null;
  const ext = path.extname(segs[segs.length - 1]).toLowerCase();
  if (!RASTER_EXTS.has(ext)) return null;
  return { segs, ext };
}

function buildThumbPath(segs, ext) {
  const dirKey =
    segs
      .slice(0, -1)
      .join("_")
      .replace(/[^a-zA-Z0-9_-]/g, "_") || "root";
  const baseName = path.basename(segs[segs.length - 1], ext).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(THUMB_CACHE_DIR, `${dirKey}_${baseName}_w${WIDTH}.webp`);
}

async function main() {
  const raw = await fs.readFile(NOTICES_PATH, "utf8");
  const notices = JSON.parse(raw);

  const uniqueMap = new Map();
  for (const n of notices) {
    const parsed = parseCoverSegments(n.cover);
    if (!parsed) continue;
    const key = parsed.segs.join("/");
    if (!uniqueMap.has(key)) uniqueMap.set(key, parsed);
  }

  const jobs = [...uniqueMap.values()];
  await fs.mkdir(THUMB_CACHE_DIR, { recursive: true });

  let rawBytes = 0;
  let thumbBytes = 0;
  let generated = 0;
  let skippedCached = 0;
  let missing = 0;
  let failed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const srcPath = path.join(PUBLIC_MEDIA_DIR, ...job.segs);
      const thumbPath = buildThumbPath(job.segs, job.ext);
      let srcStat;
      try {
        srcStat = await fs.stat(srcPath);
      } catch {
        missing++;
        continue;
      }
      rawBytes += srcStat.size;

      try {
        const cachedStat = await fs.stat(thumbPath);
        if (cachedStat.size > 0) {
          thumbBytes += cachedStat.size;
          skippedCached++;
          continue;
        }
      } catch {
        /* 需要生成 */
      }

      try {
        const buf = await fs.readFile(srcPath);
        const out = await sharp(buf, { failOn: "none" })
          .rotate()
          .resize({ width: WIDTH, withoutEnlargement: true })
          .webp({ quality: 78, effort: 4 })
          .toBuffer();
        const tmp = `${thumbPath}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tmp, out);
        await fs.rename(tmp, thumbPath);
        thumbBytes += out.byteLength;
        generated++;
      } catch (err) {
        failed++;
        console.warn(`缩略图生成失败 (${job.segs.join("/")}):`, err?.message || err);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const rawMB = (rawBytes / 1048576).toFixed(2);
  const thumbMB = (thumbBytes / 1048576).toFixed(2);
  const pct = rawBytes > 0 ? ((1 - thumbBytes / rawBytes) * 100).toFixed(1) : "0.0";
  console.log(
    JSON.stringify(
      {
        uniqueCovers: jobs.length,
        generated,
        skippedCached,
        missing,
        failed,
        beforeMB: rawMB,
        afterMB: thumbMB,
        savedPercent: `${pct}%`,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("optimize-thumbs 异常：", err);
  process.exit(1);
});
