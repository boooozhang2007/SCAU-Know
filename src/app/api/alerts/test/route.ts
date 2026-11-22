import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { readNotices } from "@/lib/crawl/store";
import type { CrawledNotice } from "@/lib/crawl/engine";
import { matchNoticeAgainstRule } from "@/lib/monitor/matcher";
import { buildTemplateVariables, dispatchAlert } from "@/lib/monitor/notifier";
import type { AlertRule } from "@/lib/monitor/rules";
import { DEFAULT_ALERT_TEMPLATE, renderTemplate } from "@/lib/monitor/template";

export const dynamic = "force-dynamic";

const SAMPLE_NOTICE: CrawledNotice = {
  id: "sample_xlsx_001",
  title: "关于2026年本科生国家奖学金推荐名单的公示",
  url: "https://jwc.scau.edu.cn/",
  source: "华南农业大学本科生院",
  sourceId: "jwc",
  category: "scholarships",
  tone: "ochre",
  publishedAt: new Date().toISOString(),
  startsAt: null,
  endsAt: null,
  venue: null,
  registration: false,
  summary: "现将2026年本科生国家奖学金学院初评推荐名单予以公示，请相关同学核对附件信息。",
  paragraphs: ["请各位同学查看附件Excel公示名单，如有异议请于公示期内向本科生院反馈。"],
  attachments: [
    {
      id: "att_sample",
      name: "2026年本科生国家奖学金推荐名单.xlsx",
      ext: "xlsx",
      url: "https://jwc.scau.edu.cn/sample.xlsx",
      sheets: [
        {
          name: "Sheet1",
          headers: ["序号", "学院", "学号", "姓名", "奖项"],
          rows: [["1", "数学与信息学院", "2024250101", "张三", "国家奖学金"]],
          totalRows: 1,
        },
      ],
    },
  ],
  isNew: true,
  fetchedAt: new Date().toISOString(),
};

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
    // 优先从真实库里找一条能命中的通知做预览，找不到再用含表格的示例通知
    for (const candidate of notices.slice(0, 80)) {
      const m = await matchNoticeAgainstRule(candidate, { ...body.rule, enabled: true });
      if (m.matched) {
        target = candidate;
        break;
      }
    }
  }
  if (!target) {
    target = notices.find((n) => n.attachments?.length) ?? notices[0] ?? SAMPLE_NOTICE;
  }

  const res = await matchNoticeAgainstRule(target, { ...body.rule, enabled: true });
  const previewHits =
    res.hits.length > 0
      ? res.hits
      : [
          {
            where: "xlsx" as const,
            keyword: body.rule.keywords?.[0] || "示例关键词",
            attachmentName: target.attachments?.[0]?.name || "名单附件.xlsx",
            sheetName: target.attachments?.[0]?.sheets?.[0]?.name || "Sheet1",
            rowIndex: 2,
            rowDetail: "示例命中行：可在收到匹配公告时精确展示对应单元格",
          },
        ];

  const vars = buildTemplateVariables(target, body.rule, previewHits, res.aiReason);
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
