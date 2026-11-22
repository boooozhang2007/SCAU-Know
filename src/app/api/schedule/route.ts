import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import {
  ensureSchedulerStarted,
  getScheduleStatus,
  runLockedCrawl,
  updateScheduleConfig,
  type ScheduleConfig,
} from "@/lib/crawl/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  const status = await ensureSchedulerStarted();
  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  let patch: Partial<ScheduleConfig> = {};
  try {
    patch = (await req.json()) as Partial<ScheduleConfig>;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体须为有效 JSON" }, { status: 400 });
  }

  const status = await updateScheduleConfig(patch);
  return NextResponse.json(
    { ok: true, ...status },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  let body: { action?: string } = {};
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    /* 默认按 run_now 处理 */
  }

  if (body.action && body.action !== "run_now") {
    return NextResponse.json({ ok: false, error: "不支持的操作类型" }, { status: 400 });
  }

  try {
    const result = await runLockedCrawl("manual");
    const status = await getScheduleStatus();
    if (!result) {
      return NextResponse.json(
        { ok: false, error: "当前已有采集任务正在执行，请稍后再试", ...status },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { ok: true, result, ...status },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const status = await getScheduleStatus();
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), ...status },
      { status: code === "ALREADY_RUNNING" ? 409 : 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
