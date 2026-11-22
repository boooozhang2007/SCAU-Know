import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";

const PUBLIC_MEDIA_DIR = path.resolve(process.cwd(), "public", "media");
const THUMB_CACHE_DIR = path.join(PUBLIC_MEDIA_DIR, ".thumbs");
const ATTACHMENTS_DIR = path.resolve(
  process.env.BAUHINIA_DATA_DIR
    ? path.join(path.resolve(process.env.BAUHINIA_DATA_DIR), "attachments")
    : path.join(process.cwd(), "data", "attachments"),
);

const RASTER_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".avif"]);

declare global {
  var __scauThumbInFlight: Map<string, Promise<Buffer>> | undefined;
}

const thumbInFlight =
  globalThis.__scauThumbInFlight ?? (globalThis.__scauThumbInFlight = new Map());

function normalizeWidthBucket(raw: string | null): 480 | 640 | 1200 | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 480) return 480;
  if (n <= 640) return 640;
  return 1200;
}

function buildThumbPath(segs: string[], ext: string, bucket: 480 | 640 | 1200): string {
  const dirKey =
    segs
      .slice(0, -1)
      .join("_")
      .replace(/[^a-zA-Z0-9_-]/g, "_") || "root";
  const baseName = path.basename(segs[segs.length - 1], ext).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(THUMB_CACHE_DIR, `${dirKey}_${baseName}_w${bucket}.webp`);
}

async function getOrCreateThumb(
  srcPath: string,
  thumbPath: string,
  bucket: 480 | 640 | 1200,
): Promise<{ buf: Buffer; isWebp: boolean }> {
  try {
    const cached = await fs.readFile(thumbPath);
    if (cached.byteLength > 0) {
      return { buf: cached, isWebp: true };
    }
  } catch {
    /* 缓存未命中，继续生成 */
  }

  const pending = thumbInFlight.get(thumbPath);
  if (pending) {
    try {
      const buf = await pending;
      return { buf, isWebp: true };
    } catch {
      const orig = await fs.readFile(srcPath);
      return { buf: orig, isWebp: false };
    }
  }

  const task = (async () => {
    const orig = await fs.readFile(srcPath);
    const out = await sharp(orig, { failOn: "none" })
      .rotate()
      .resize({ width: bucket, withoutEnlargement: true })
      .webp({ quality: bucket <= 480 ? 72 : 78, effort: 4 })
      .toBuffer();
    await fs.mkdir(THUMB_CACHE_DIR, { recursive: true });
    const tmp = `${thumbPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, out);
    await fs.rename(tmp, thumbPath);
    return out;
  })();

  thumbInFlight.set(thumbPath, task);
  try {
    const buf = await task;
    return { buf, isWebp: true };
  } catch {
    const orig = await fs.readFile(srcPath);
    return { buf: orig, isWebp: false };
  } finally {
    thumbInFlight.delete(thumbPath);
  }
}

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".ofd": "application/ofd",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
  ".xlsb": "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".et": "application/vnd.ms-excel",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".docm": "application/vnd.ms-word.document.macroEnabled.12",
  ".doc": "application/msword",
  ".wps": "application/msword",
  ".rtf": "application/rtf",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pptm": "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
  ".ppsx": "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
  ".ppt": "application/vnd.ms-powerpoint",
  ".dps": "application/vnd.ms-powerpoint",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
};

function safeResolve(baseDir: string, segments: string[]): string | null {
  if (segments.some((s) => !s || s === "." || s === ".." || s.includes("\\"))) {
    return null;
  }
  const target = path.resolve(baseDir, ...segments);
  const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : `${baseDir}${path.sep}`;
  if (!target.startsWith(baseWithSep)) return null;
  return target;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: segs } = await context.params;
  if (!segs || segs.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let filePath: string | null = null;
  let isAttachment = false;
  if (segs[0] === "attachments") {
    isAttachment = true;
    filePath = safeResolve(ATTACHMENTS_DIR, segs.slice(1));
  } else {
    filePath = safeResolve(PUBLIC_MEDIA_DIR, segs);
  }

  if (!filePath) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const ext = path.extname(filePath).toLowerCase();
    const widthParam = new URL(req.url).searchParams.get("w");
    const bucket =
      !isAttachment && segs[0] !== ".thumbs" && RASTER_EXTS.has(ext)
        ? normalizeWidthBucket(widthParam)
        : null;

    if (bucket) {
      const thumbPath = buildThumbPath(segs, ext, bucket);
      const { buf, isWebp } = await getOrCreateThumb(filePath, thumbPath, bucket);
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": isWebp ? "image/webp" : (MIME_MAP[ext] ?? "application/octet-stream"),
          "Content-Length": String(buf.byteLength),
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const buf = await fs.readFile(filePath);
    const contentType = MIME_MAP[ext] ?? "application/octet-stream";
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    };
    if (isAttachment) {
      const base = path.basename(filePath).replace(/^[a-f0-9]{16}_/i, "");
      headers["Content-Disposition"] = `inline; filename*=UTF-8''${encodeURIComponent(base)}`;
    }
    return new NextResponse(new Uint8Array(buf), { status: 200, headers });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
