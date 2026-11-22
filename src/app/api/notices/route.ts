import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { loadNoticeById, loadNoticeSummaries, loadNotices } from "@/lib/data";
import { readState } from "@/lib/crawl/store";
import { getScheduleStatus } from "@/lib/crawl/scheduler";

export const dynamic = "force-dynamic";

const DATA_DIR = process.env.BAUHINIA_DATA_DIR
  ? path.resolve(process.env.BAUHINIA_DATA_DIR)
  : path.join(process.cwd(), "data");

const NOTICES_FILE = path.join(DATA_DIR, "notices.json");

interface MetaCache {
  mtimeMs: number;
  size: number;
  version: string;
  total: number;
  latestId: string | null;
  updatedAt: string;
}

declare global {
  var __scauNoticesMetaCache: MetaCache | undefined;
}

async function readNoticesMeta(): Promise<Omit<MetaCache, "mtimeMs" | "size">> {
  try {
    const stat = await fs.stat(NOTICES_FILE);
    const cached = globalThis.__scauNoticesMetaCache;
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return {
        version: cached.version,
        total: cached.total,
        latestId: cached.latestId,
        updatedAt: cached.updatedAt,
      };
    }

    const raw = await fs.readFile(NOTICES_FILE, "utf8");
    const parsed = JSON.parse(raw) as { id?: string }[];
    const total = Array.isArray(parsed) ? parsed.length : 0;
    const latestId = total > 0 ? (parsed[0]?.id ?? null) : null;
    const state = await readState();
    const updatedAt =
      state.lastReport?.finishedAt ?? new Date(stat.mtimeMs).toISOString();
    const version = `${Math.round(stat.mtimeMs)}:${stat.size}:${total}:${latestId ?? ""}`;

    globalThis.__scauNoticesMetaCache = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      version,
      total,
      latestId,
      updatedAt,
    };
    return { version, total, latestId, updatedAt };
  } catch {
    return {
      version: "seed:0",
      total: 0,
      latestId: null,
      updatedAt: new Date().toISOString(),
    };
  }
}

function latestIso(a: string, b?: string | null): string {
  if (!b) return a;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isNaN(tb) && (Number.isNaN(ta) || tb > ta)) return b;
  return a;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const singleId = url.searchParams.get("id")?.trim();
  if (singleId) {
    const notice = await loadNoticeById(singleId, new Date());
    if (!notice) {
      return NextResponse.json(
        { ok: false, error: "not found" },
        { status: 404, headers: { "Cache-Control": "no-cache" } },
      );
    }
    return NextResponse.json(
      { ok: true, notice },
      { headers: { "Cache-Control": "no-cache" } },
    );
  }

  const metaOnly = url.searchParams.get("meta") === "1";
  const wantFull = url.searchParams.get("full") === "1";
  const [meta, sched] = await Promise.all([readNoticesMeta(), getScheduleStatus()]);
  const syncIntervalSec = sched.config.frontendSyncSeconds;
  const updatedAt = latestIso(meta.updatedAt, sched.lastRunAt);

  if (metaOnly) {
    return NextResponse.json(
      { ...meta, updatedAt, syncIntervalSec },
      { headers: { "Cache-Control": "no-cache" } },
    );
  }

  const now = new Date();
  const { notices } = wantFull ? await loadNotices(now) : await loadNoticeSummaries(now);
  return NextResponse.json(
    {
      version: meta.version,
      updatedAt: updatedAt || now.toISOString(),
      total: notices.length,
      latestId: notices[0]?.id ?? null,
      syncIntervalSec,
      notices,
    },
    { headers: { "Cache-Control": "no-cache" } },
  );
}
