/**
 * 客户端安全的媒体缩略图 URL 构造器。
 * - 动态模式下对站内 `/api/media/` 光栅图片按需附加 `?w=<bucket>`。
 * - 静态导出模式下将 `/media/(covers|images)/...` 或 `/media/thumbs/..._w1200.webp`
 *   规范映射到预生成的 `/media/thumbs/<dir>_<base>_w<480|1200>.webp`。
 */

const RASTER_EXT_GROUP = "(?:png|jpe?g|webp|bmp|avif)";
const DYNAMIC_RASTER_RE = new RegExp(
  `^\\/api\\/media\\/(?!attachments\\/)(.+)\\.${RASTER_EXT_GROUP}(?:[?#].*)?$`,
  "i",
);
const STATIC_RAW_RASTER_RE = new RegExp(
  `^(https?:\\/\\/[^/]+)?\\/media\\/(covers|images)\\/([^/?#]+)\\.${RASTER_EXT_GROUP}(?:[?#].*)?$`,
  "i",
);
const STATIC_THUMB_RE = /^(.*\/media\/thumbs\/.+_w)(480|640|1200)(\.webp(?:[?#].*)?)$/i;

export function staticWebpThumbPath(src: string, width: 480 | 640 | 1200): string {
  const clean = src.split("?")[0].split("#")[0];
  const m = clean.match(
    new RegExp(
      `^(?:https?:\\/\\/[^/]+)?\\/(?:api\\/)?media\\/(covers|images)\\/([^/]+)\\.${RASTER_EXT_GROUP}$`,
      "i",
    ),
  );
  if (!m) return src;
  const dirKey = m[1].replace(/[^a-zA-Z0-9_-]/g, "_") || "root";
  const baseName = m[2].replace(/[^a-zA-Z0-9_-]/g, "_");
  const originPrefix = clean.match(/^(https?:\/\/[^/]+)/)?.[1] ?? "";
  return `${originPrefix}/media/thumbs/${dirKey}_${baseName}_w${width}.webp`;
}

export function mediaThumbUrl(
  src: string | undefined,
  width: 480 | 640 | 1200,
): string | undefined {
  if (!src) return undefined;

  if (DYNAMIC_RASTER_RE.test(src)) {
    const [withoutHash, hash] = src.split("#");
    const sep = withoutHash.includes("?") ? "&" : "?";
    const next = `${withoutHash}${sep}w=${width}`;
    return hash !== undefined ? `${next}#${hash}` : next;
  }

  const targetBucket: 480 | 1200 = width <= 640 ? 480 : 1200;
  const thumbM = src.match(STATIC_THUMB_RE);
  if (thumbM) {
    return `${thumbM[1]}${targetBucket}${thumbM[3]}`;
  }

  if (STATIC_RAW_RASTER_RE.test(src)) {
    return staticWebpThumbPath(src, targetBucket);
  }

  return src;
}
