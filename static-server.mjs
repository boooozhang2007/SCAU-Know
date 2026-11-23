#!/usr/bin/env node
/**
 * 极简静态文件服务器（无依赖），用于给 CDN 回源 / 直连提供 out/ 目录。
 * 特性：gzip、按路径类型给 Cache-Control、目录 index.html、404 回落 404.html。
 * 环境变量：ROOT（默认 ./out）、PORT（默认 2087）、HOST（默认 0.0.0.0）
 */
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.env.ROOT || path.resolve(process.cwd(), "out");
const PORT = Number(process.env.PORT || 2087);
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

const COMPRESSIBLE = new Set([".html", ".txt", ".json", ".js", ".mjs", ".css", ".svg", ".xml", ".map"]);

function cacheControl(p) {
  if (p.startsWith("/_next/static/") || p.startsWith("/media/thumbs/")) {
    return "public, max-age=31536000, immutable";
  }
  if (p.startsWith("/static-data/details/")) {
    return "public, max-age=300, stale-while-revalidate=86400";
  }
  if (p.endsWith(".html") || p === "/") {
    return "public, max-age=300, stale-while-revalidate=600";
  }
  if (p.startsWith("/media/")) return "public, max-age=86400";
  return "public, max-age=600";
}

async function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const rel = path.normalize(clean).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) return null;
  try {
    const st = await fsp.stat(full);
    if (st.isDirectory()) {
      const idx = path.join(full, "index.html");
      await fsp.access(idx);
      return idx;
    }
    return full;
  } catch {
    try {
      const alt = full.endsWith(".html") ? full : full + ".html";
      await fsp.access(alt);
      return alt;
    } catch {
      return null;
    }
  }
}

async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      return res.end("method not allowed");
    }
    const urlPath = req.url || "/";
    let file = await resolveFile(urlPath);
    let status = 200;
    if (!file) {
      status = 404;
      file = path.join(ROOT, "404.html");
      try {
        await fsp.access(file);
      } catch {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        return res.end("not found");
      }
    }
    const ext = path.extname(file).toLowerCase();
    const st = await fsp.stat(file);
    const headers = {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": status === 404 ? "no-cache" : cacheControl(urlPath),
      vary: "Accept-Encoding",
      "last-modified": st.mtime.toUTCString(),
      "x-served-by": "scau-static",
    };
    const accept = String(req.headers["accept-encoding"] || "");
    const gz = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(accept) && st.size > 1024;
    if (gz) headers["content-encoding"] = "gzip";

    if (req.method === "HEAD") {
      if (!gz) headers["content-length"] = String(st.size);
      res.writeHead(status, headers);
      return res.end();
    }
    if (gz) {
      res.writeHead(status, headers);
      return fs.createReadStream(file).pipe(zlib.createGzip({ level: 6 })).pipe(res);
    }
    headers["content-length"] = String(st.size);
    res.writeHead(status, headers);
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("server error: " + e.message);
  }
}

const srv = process.env.TLS_CERT
  ? createTlsServer({ cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) }, handler)
  : createServer(handler);
srv.listen(PORT, HOST, () => {
  console.log("scau-static listening on " + HOST + ":" + PORT + (process.env.TLS_CERT ? " (tls)" : "") + ", root=" + ROOT);
});
