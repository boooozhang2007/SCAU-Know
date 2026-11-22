import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const MEDIA_ROOT = path.join(process.cwd(), "public", "media");
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 20000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

function isWechatCdn(rawUrl: string): boolean {
  return /https?:\/\/[^/]*(qpic\.cn|qlogo\.cn|weixin\.qq\.com)/i.test(rawUrl);
}

function guessExt(contentType: string, rawUrl: string): string {
  const ct = contentType.split(";")[0]?.trim().toLowerCase();
  if (ct && EXT_BY_MIME[ct]) return EXT_BY_MIME[ct];
  try {
    const u = new URL(rawUrl);
    const fmt = u.searchParams.get("wx_fmt")?.toLowerCase();
    if (fmt && /^(jpg|jpeg|png|webp|gif|bmp)$/.test(fmt)) {
      return fmt === "jpeg" ? "jpg" : fmt;
    }
    const ext = path.extname(u.pathname).replace(".", "").toLowerCase();
    if (/^(jpg|jpeg|png|webp|gif|svg|avif|bmp)$/.test(ext)) {
      return ext === "jpeg" ? "jpg" : ext;
    }
  } catch {
    /* 忽略 */
  }
  return "jpg";
}

type FetchImageResult =
  | { ok: true; buf: Buffer; contentType: string }
  | { ok: false; permanent: boolean };

async function fetchImageBytes(
  rawUrl: string,
  referer?: string,
): Promise<FetchImageResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "User-Agent": UA,
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    };
    if (referer) headers.Referer = referer;
    const res = await fetch(rawUrl, { headers, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) {
      return {
        ok: false,
        permanent: res.status === 404 || res.status === 410 || res.status === 400,
      };
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().startsWith("image/") && !ct.includes("octet-stream")) {
      return { ok: false, permanent: true };
    }
    const lenHeader = Number(res.headers.get("content-length") ?? "0");
    if (lenHeader > MAX_IMAGE_BYTES) return { ok: false, permanent: true };
    const arr = await res.arrayBuffer();
    if (arr.byteLength === 0 || arr.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, permanent: true };
    }
    return { ok: true, buf: Buffer.from(arr), contentType: ct };
  } catch {
    return { ok: false, permanent: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 将远程图片按原始像素体积无损转存到 `public/media/{covers|images}/<sha16>.<ext>`，
 * 避免公众号图片因防盗链或链接过期导致前端无法加载，并支持原图尺寸展示。
 */
export async function mirrorMedia(
  rawUrl: string,
  kind: "cover" | "image",
  referer?: string,
): Promise<string | null> {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (/\/(?:undefined|null)(?:$|[?#])/i.test(trimmed)) return null;

  const isWx = isWechatCdn(trimmed);
  const firstReferer = referer ?? (isWx ? "https://mp.weixin.qq.com/" : undefined);

  const candidates = [trimmed];
  if (/_d(\.[a-z0-9]+)(?=$|\?)/i.test(trimmed)) {
    // WebPlus `_d` 原图偶发超过 16MB 或加载超时，自动降级尝试同目录标准图
    candidates.push(trimmed.replace(/_d(\.[a-z0-9]+)(?=$|\?)/i, "$1"));
  }

  let downloaded: { buf: Buffer; contentType: string } | null = null;
  let allPermanent = true;

  for (const cand of candidates) {
    let res = await fetchImageBytes(cand, firstReferer);
    if (!res.ok && firstReferer) {
      // 微信图片有时需要空 Referer 才可拉取，降级重试一次
      const resNoRef = await fetchImageBytes(cand, undefined);
      if (resNoRef.ok) res = resNoRef;
      else if (!resNoRef.permanent) res = resNoRef;
    }
    if (res.ok) {
      downloaded = { buf: res.buf, contentType: res.contentType };
      break;
    }
    if (!res.permanent) allPermanent = false;
  }

  if (!downloaded) {
    if (isWx || allPermanent) return null;
    return trimmed;
  }

  const hash = createHash("sha256").update(downloaded.buf).digest("hex").slice(0, 16);
  const ext = guessExt(downloaded.contentType, trimmed);
  const dirName = kind === "cover" ? "covers" : "images";
  const targetDir = path.join(MEDIA_ROOT, dirName);
  const fileName = `${hash}.${ext}`;
  const fullPath = path.join(targetDir, fileName);

  await fs.mkdir(targetDir, { recursive: true });
  try {
    await fs.access(fullPath);
  } catch {
    const tmp = `${fullPath}.tmp`;
    await fs.writeFile(tmp, downloaded.buf);
    await fs.rename(tmp, fullPath);
  }

  const cdnBase = (process.env.MEDIA_CDN_BASE ?? "").replace(/\/+$/, "");
  const isStatic = process.env.STATIC_EXPORT === "1";
  const prefix = isStatic ? `/media/${dirName}/${fileName}` : `/api/media/${dirName}/${fileName}`;
  return cdnBase ? `${cdnBase}/media/${dirName}/${fileName}` : prefix;
}
