import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { readNotices } from "@/lib/crawl/store";
import { matchNoticeAgainstRule } from "@/lib/monitor/matcher";
import { buildTemplateVariables, dispatchAlert } from "@/lib/monitor/notifier";
import type { AlertRule } from "@/lib/monitor/rules";
import { DEFAULT_ALERT_TEMPLATE, renderTemplate } from "@/lib/monitor/template";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  const body = (await req.json()) as {
    rule: AlertRule;
    noticeId?: string;
    send?: boolean;
  };

  const notices = await readNotices();
  let target = body.noticeId
    ? notices.find((n) => n.id === body.noticeId)
    : undefined;

  if (!target && body.rule.keywords?.length) {
    // 优先从真实库里找一条能命中的通知做预览
    for (const candidate of notices.slice(0, 80)) {
      const m = await matchNoticeAgainstRule(candidate, { ...body.rule, enabled: true });
      if (m.matched) {
        target = candidate;
        break;
      }
    }
  }
  if (!target) {
    target = notices.find((n) => n.attachments?.length) ?? notices[0];
  }
  if (!target) {
    return NextResponse.json(
      { ok: false, error: "库内暂无通知数据，请先执行采集后再测试告警规则" },
      { status: 400 },
    );
  }

  const res = await matchNoticeAgainstRule(target, { ...body.rule, enabled: true });
  const vars = buildTemplateVariables(target, body.rule, res.hits, res.aiReason);
  const rendered = renderTemplate(
    body.rule.template || DEFAULT_ALERT_TEMPLATE,
    vars,
  );

  let delivery: { ok: boolean; error?: string } | null = null;
  if (body.send) {
    delivery = await dispatchAlert(
      body.rule.channel,
      `[测试] 【${vars.source_short}】${vars.clean_title}`,
      rendered,
      { test: true, noticeId: target.id, url: target.url },
    );
  }

  return NextResponse.json({
    ok: true,
    noticeTitle: target.title,
    matched: res.matched,
    hits: res.hits,
    rendered,
    delivery,
  });
}
