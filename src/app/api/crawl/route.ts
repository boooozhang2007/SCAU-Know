import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { ensureSchedulerStarted, runLockedCrawl } from "@/lib/crawl/scheduler";
import { CRAWL_SOURCES, enabledSources } from "@/lib/crawl/sources";
import { readState } from "@/lib/crawl/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 抓取状态 */
export async function GET(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  const state = await readState();
  return NextResponse.json({
    sources: CRAWL_SOURCES.length,
    enabled: enabledSources().length,
    lastRun: state.lastRun,
    lastReport: state.lastReport ?? null,
    seen: state.seen.length,
  });
}

/**
 * 触发抓取（通过 verifyAdminRequest 支持 ADMIN_SECRET / CRAWL_SECRET，内置并发互斥锁）。
 */
export async function POST(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  await ensureSchedulerStarted();

  let body: {
    only?: string[];
    limitPerSource?: number;
    fetchDetail?: boolean;
    concurrency?: number;
    includeWechat?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch {
    /* 允许空 body */
  }

  try {
    const result = await runLockedCrawl("manual", {
      only: body.only,
      limitPerSource: body.limitPerSource,
      fetchDetail: body.fetchDetail,
      concurrency: body.concurrency,
      includeWechat: body.includeWechat,
    });
    if (!result) {
      return NextResponse.json({ ok: false, error: "当前已有采集任务在运行" }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      added: result.added,
      total: result.total,
      wechat: result.wechat,
      report: result.report,
    });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: code === "ALREADY_RUNNING" ? 409 : 500 },
    );
  }
}
