#!/usr/bin/env node
/**
 * 独立静态编译脚本（方案 B：公网纯静态 CDN `./out/` + 本地/内网私有后台）：
 *   1. 导出精简摘要 `notices-summary.json`、`search-index.json` 与分片详情 `details/<id>.json` 至 `public/static-data/`
 *   2. 仅提取通知实际引用的封面与配图，通过 `sharp` 生成 w480/w1200 WebP 缩略图至 `.static-build/public/media/thumbs/`
 *   3. 自动剔除服务端管理路由与状态页面（`src/app/api`、`src/app/admin`、`src/app/sources`）
 *   4. 将全部页面切换为 `force-static` 并输出紧凑纯静态站点到 `./out/`
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const STAGE = path.join(ROOT, ".static-build");
const OUT_DEST = path.join(ROOT, "out");
const PUBLIC_MEDIA_DIR = path.join(ROOT, "public", "media");
const THUMB_CACHE_DIR = path.join(PUBLIC_MEDIA_DIR, ".thumbs");

const RASTER_EXT_RE = /\.(?:png|jpe?g|webp|bmp|avif)$/i;

function copyFiltered(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    const name = path.basename(src);
    if (["node_modules", ".next", "out", ".static-build", ".git"].includes(name)) {
      return;
    }
    const rel = path.relative(ROOT, src).replace(/\\/g, "/");
    if (
      rel === "src/app/api" ||
      rel === "src/app/admin" ||
      rel === "src/app/sources" ||
      rel === "data/attachments" ||
      rel === "public/media"
    ) {
      return;
    }
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyFiltered(path.join(src, child), path.join(dest, child));
    }
  } else {
    const rel = path.relative(ROOT, src).replace(/\\/g, "/");
    if (rel === "src/instrumentation.ts") {
      return;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function parseLocalMediaRef(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const cleaned = rawUrl.split("?")[0].split("#")[0];
  const m = cleaned.match(/^\/(?:api\/)?media\/(covers|images)\/([^/]+)$/);
  if (!m) return null;
  const dir = m[1];
  const file = m[2];
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  return {
    dir,
    file,
    ext,
    isRaster: RASTER_EXT_RE.test(file),
    safeDir: dir.replace(/[^a-zA-Z0-9_-]/g, "_") || "root",
    safeBase: base.replace(/[^a-zA-Z0-9_-]/g, "_"),
  };
}

async function ensureCachedWebpThumb(srcPath, cachePath, width) {
  try {
    const stat = await fsp.stat(cachePath);
    if (stat.size > 0) return cachePath;
  } catch {
    /* 缓存未命中 */
  }
  const orig = await fsp.readFile(srcPath);
  const out = await sharp(orig, { failOn: "none" })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: width <= 480 ? 72 : 78, effort: 4 })
    .toBuffer();
  await fsp.mkdir(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, out);
  await fsp.rename(tmp, cachePath);
  return cachePath;
}

async function prepareStaticMedia(noticesPath, stageRoot) {
  if (!fs.existsSync(noticesPath)) return;
  const raw = await fsp.readFile(noticesPath, "utf8");
  const notices = JSON.parse(raw);

  const jobs = new Map(); // relKey -> { ref, widths: Set<480 | 1200> }
  const addRef = (url, needW480) => {
    const ref = parseLocalMediaRef(url);
    if (!ref) return;
    const key = `${ref.dir}/${ref.file}`;
    let entry = jobs.get(key);
    if (!entry) {
      entry = { ref, widths: new Set([1200]) };
      jobs.set(key, entry);
    }
    if (needW480) entry.widths.add(480);
  };

  for (const n of notices) {
    if (n.cover) addRef(n.cover, true);
    for (const b of n.blocks || []) {
      if (b.type === "image" && b.src) addRef(b.src, false);
    }
  }

  const stageThumbsDir = path.join(stageRoot, "public", "media", "thumbs");
  await fsp.mkdir(stageThumbsDir, { recursive: true });

  const jobList = [...jobs.values()];
  let cursor = 0;
  let copiedThumbs = 0;
  let copiedRawNonRaster = 0;

  async function worker() {
    while (cursor < jobList.length) {
      const { ref, widths } = jobList[cursor++];
      const origPath = path.join(PUBLIC_MEDIA_DIR, ref.dir, ref.file);
      try {
        await fsp.access(origPath);
      } catch {
        continue;
      }

      if (!ref.isRaster) {
        const dest = path.join(stageRoot, "public", "media", ref.dir, ref.file);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(origPath, dest);
        copiedRawNonRaster++;
        continue;
      }

      for (const w of widths) {
        const thumbName = `${ref.safeDir}_${ref.safeBase}_w${w}.webp`;
        const cachePath = path.join(THUMB_CACHE_DIR, thumbName);
        const destPath = path.join(stageThumbsDir, thumbName);
        try {
          await ensureCachedWebpThumb(origPath, cachePath, w);
          await fsp.copyFile(cachePath, destPath);
          copiedThumbs++;
        } catch {
          const fallbackDest = path.join(stageRoot, "public", "media", ref.dir, ref.file);
          await fsp.mkdir(path.dirname(fallbackDest), { recursive: true });
          await fsp.copyFile(origPath, fallbackDest);
          copiedRawNonRaster++;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: 4 }, () => worker()));
  console.log(
    `[2/5] 已抽取并生成 ${copiedThumbs} 个静态 WebP 缩略图 + ${copiedRawNonRaster} 个非光栅素材`,
  );

  // 将阶段目录内 data/notices.json 的 /api/media/ 路径映射至静态 /media/thumbs/..._w1200.webp
  const rewriteUrl = (u) => {
    if (!u) return u;
    const ref = parseLocalMediaRef(u);
    if (ref?.isRaster) {
      return `/media/thumbs/${ref.safeDir}_${ref.safeBase}_w1200.webp`;
    }
    return u.startsWith("/api/media/") ? u.replace(/^\/api\/media\//, "/media/") : u;
  };
  for (const n of notices) {
    if (n.cover) n.cover = rewriteUrl(n.cover);
    if (Array.isArray(n.blocks)) {
      for (const b of n.blocks) {
        if (b.type === "image" && b.src) b.src = rewriteUrl(b.src);
      }
    }
  }
  await fsp.writeFile(noticesPath, JSON.stringify(notices), "utf8");
}

function patchPagesForStatic(dir, appRoot = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      patchPagesForStatic(full, appRoot);
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      const rel = path.relative(appRoot, full).replace(/\\/g, "/");
      let content = fs.readFileSync(full, "utf8");
      let changed = false;
      if (content.includes('export const dynamic = "force-dynamic"')) {
        content = content.replace(
          /export const dynamic\s*=\s*"force-dynamic";?/g,
          'export const dynamic = "force-static";',
        );
        changed = true;
      }
      // 静态导出路由不能在 Server Component 中读 searchParams，交由客户端 Suspense 查询桥同步
      if (rel === "page.tsx") {
        content = content.replace(
          /export default async function HomePage\([\s\S]*?const \{[^}]+\} = await searchParams;/,
          'export default async function HomePage() {\n  const q: string = "", cluster: string = "", source: string = "", notice: string = "";',
        );
        changed = true;
      } else if (rel === "category/[slug]/page.tsx") {
        content = content.replace(
          /export default async function CategoryPage\(\{\s*params,\s*searchParams,\s*\}: \{\s*params: Promise<\{ slug: string \}>;\s*searchParams: Promise<\{[^}]+\}>;\s*\}\) \{([\s\S]*?)const \{[^}]+\} = await searchParams;/,
          'export default async function CategoryPage({\n  params,\n}: {\n  params: Promise<{ slug: string }>;\n}) {$1const q: string = "", source: string = "", notice: string = "";',
        );
        changed = true;
      } else if (rel === "search/page.tsx") {
        content = content.replace(
          /export default async function SearchPage\([\s\S]*?const \{[^}]+\} = await searchParams;/,
          'export default async function SearchPage() {\n  const q: string = "", cluster: string = "", source: string = "", notice: string = "";',
        );
        changed = true;
      } else if (rel === "calendar/page.tsx") {
        content = content.replace(
          /export default async function CalendarPage\([\s\S]*?const \{[^}]+\} = await searchParams;/,
          'export default async function CalendarPage() {\n  const category: string = "", date: string = "";',
        );
        changed = true;
      }
      if (changed) fs.writeFileSync(full, content, "utf8");
    }
  }
}

async function main() {
  console.log("[1/5] 导出最新静态精简摘要与按条详情快照...");
  execSync("pnpm exec tsx scripts/export-static-data.mjs", {
    cwd: ROOT,
    stdio: "inherit",
  });

  console.log("[2/5] 准备隔离静态构建目录 .static-build/ 并抽取 WebP 缩略图...");
  fs.rmSync(STAGE, { recursive: true, force: true });
  copyFiltered(ROOT, STAGE);

  fs.symlinkSync(
    path.join(ROOT, "node_modules"),
    path.join(STAGE, "node_modules"),
    "junction",
  );

  await prepareStaticMedia(path.join(STAGE, "data", "notices.json"), STAGE);

  console.log("[3/5] 切换静态导出页面参数与内部路由剔除...");
  patchPagesForStatic(path.join(STAGE, "src", "app"));

  try {
    console.log("[4/5] 执行静态编译 next build (STATIC_EXPORT=1) ...");
    execSync("pnpm exec next build", {
      cwd: STAGE,
      stdio: "inherit",
      env: {
        ...process.env,
        STATIC_EXPORT: "1",
        NEXT_PUBLIC_STATIC_MODE: "1",
      },
    });

    console.log("[5/5] 输出纯静态产物到 ./out/ ...");
    fs.rmSync(OUT_DEST, { recursive: true, force: true });
    fs.cpSync(path.join(STAGE, "out"), OUT_DEST, { recursive: true });
    console.log("静态构建完成！./out 目录已剔除管理后台与原始大图，可直接部署至 Cloudflare Pages / Vercel / 对象存储 CDN。");
  } finally {
    fs.rmSync(STAGE, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("静态构建失败：", e);
  process.exit(1);
});
