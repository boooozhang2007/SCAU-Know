import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { CRAWL_SOURCES } from "@/lib/crawl/sources";
import {
  crawlWechatWemp,
  getWempConfig,
  wempAddMpByArticle,
  wempAddMpByKeyword,
  wempClearQueue,
  wempFetchArticles,
  wempGetConfigs,
  wempGetSysInfo,
  wempListMps,
  wempListTasks,
  wempRequest,
  wempSearchMp,
  wempTriggerUpdate,
} from "@/lib/crawl/wechat";
import { mergeNotices, readNotices, writeNotices } from "@/lib/crawl/store";
import { enrichNotice } from "@/lib/ai/enrich";
import { evaluateAndNotify } from "@/lib/monitor/notifier";
import { exportStaticDataSnapshot } from "@/lib/export-static";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  const cfg = getWempConfig();
  if (!cfg) {
    return NextResponse.json({
      configured: false,
      error: "未配置 WEMP_BASE_URL 或 WEMP_PASSWORD",
      mps: [],
    });
  }

  try {
    const [sysInfoRaw, mpsRaw, configs, tasks, recentArticles] = await Promise.all([
      wempGetSysInfo().catch(() => null),
      wempListMps(),
      wempGetConfigs().catch(() => null),
      wempListTasks().catch(() => null),
      wempFetchArticles(200, 0, undefined, false).catch(() => []),
    ]);

    const countByMp = new Map<string, number>();
    for (const art of recentArticles) {
      if (art.mp_id) {
        countByMp.set(art.mp_id, (countByMp.get(art.mp_id) ?? 0) + 1);
      }
    }
    const hasPoolArticles =
      (sysInfoRaw?.articleTotal ?? 0) > 0 || recentArticles.length > 0;

    const mps = mpsRaw.map((mp) => {
      const counted = countByMp.get(mp.id);
      if (counted !== undefined) {
        return { ...mp, article_count: counted };
      }
      if (hasPoolArticles && typeof mp.article_count === "number") {
        return mp;
      }
      return { ...mp, article_count: undefined };
    });

    const sysInfo = sysInfoRaw
      ? {
          ...sysInfoRaw,
          taskCount: tasks?.total ?? 0,
          gatherModel: configs?.["gather.model"] ?? undefined,
          gatherContent: configs?.["gather.content"] ?? undefined,
          maxPage: configs?.["max_page"] ?? undefined,
        }
      : null;

    return NextResponse.json({
      configured: true,
      baseUrl: cfg.baseUrl,
      sysInfo,
      qrStatus: { login_status: sysInfo?.wxLogin ?? false },
      mps,
    });
  } catch (e) {
    return NextResponse.json(
      {
        configured: true,
        baseUrl: cfg.baseUrl,
        error: e instanceof Error ? e.message : String(e),
        mps: [],
      },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  const body = (await req.json()) as {
    action:
      | "search"
      | "add_by_keyword"
      | "add_by_article"
      | "sync_mp"
      | "sync_all"
      | "clear_queue"
      | "pull_to_site"
      | "create_webhook_task";
    keyword?: string;
    articleUrl?: string;
    mpId?: string;
    batchSize?: number;
    webhookUrl?: string;
    cronExp?: string;
  };

  try {
    switch (body.action) {
      case "search": {
        if (!body.keyword?.trim()) {
          return NextResponse.json({ error: "请输入公众号名称关键词" }, { status: 400 });
        }
        const list = await wempSearchMp(body.keyword.trim());
        return NextResponse.json({ ok: true, list });
      }

      case "add_by_keyword": {
        if (!body.keyword?.trim()) {
          return NextResponse.json({ error: "请输入公众号名称" }, { status: 400 });
        }
        const res = await wempAddMpByKeyword(body.keyword.trim());
        return NextResponse.json({ ok: true, ...res });
      }

      case "add_by_article": {
        if (!body.articleUrl?.trim()) {
          return NextResponse.json({ error: "请粘贴公众号文章链接" }, { status: 400 });
        }
        const res = await wempAddMpByArticle(body.articleUrl.trim());
        return NextResponse.json({ ok: true, ...res });
      }

      case "sync_mp": {
        if (!body.mpId?.trim()) {
          return NextResponse.json({ error: "缺少 mpId" }, { status: 400 });
        }
        const res = await wempTriggerUpdate(body.mpId.trim(), 0, 1);
        return NextResponse.json({ ok: true, res });
      }

      case "clear_queue": {
        await wempClearQueue("main");
        return NextResponse.json({ ok: true });
      }

      case "sync_all": {
        const mps = await wempListMps();
        const batchSize = Math.min(15, Math.max(1, Math.round(body.batchSize ?? 8)));
        const batch = [...mps]
          .sort(
            (a, b) =>
              (Number(a.sync_time ?? 0) || 0) - (Number(b.sync_time ?? 0) || 0),
          )
          .slice(0, batchSize);
        const results: { name: string; ok: boolean; error?: string }[] = [];
        let rateLimited = false;

        for (let i = 0; i < batch.length; i++) {
          const mp = batch[i];
          if (i > 0) await new Promise((r) => setTimeout(r, 2000));
          try {
            await wempTriggerUpdate(mp.id, 0, 1);
            results.push({ name: mp.mp_name, ok: true });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            results.push({ name: mp.mp_name, ok: false, error: msg });
            if (/200013|freq|频繁|limit/i.test(msg)) {
              rateLimited = true;
              break;
            }
          }
        }
        const synced = results.filter((r) => r.ok).length;
        const failed = results.length - synced;
        return NextResponse.json({
          ok: true,
          synced,
          failed,
          totalMps: mps.length,
          batchSize,
          rateLimited,
          results,
        });
      }

      case "pull_to_site": {
        const sourceMap = new Map(CRAWL_SOURCES.map((s) => [s.id, s]));
        const wx = await crawlWechatWemp(sourceMap, {
          limit: 80,
          mirrorImages: true,
          parseAttachments: true,
        });
        const { total, added, newItems } = await mergeNotices(wx.notices);
        if (newItems.length > 0) {
          const allStored = await readNotices();
          const byId = new Map(allStored.map((x) => [x.id, x]));
          for (const n of newItems) {
            const meta = await enrichNotice(n);
            n.ai = meta;
            const target = byId.get(n.id);
            if (target) target.ai = meta;
          }
          await writeNotices(allStored);
        }
        if (added > 0) {
          await exportStaticDataSnapshot().catch(() => {});
        }
        const notify = await evaluateAndNotify(newItems);
        return NextResponse.json({
          ok: true,
          pulled: wx.notices.length,
          added,
          total,
          notify,
          errors: wx.errors,
        });
      }

      case "create_webhook_task": {
        if (!body.webhookUrl?.trim()) {
          return NextResponse.json({ error: "缺少 webhookUrl" }, { status: 400 });
        }
        const task = await wempRequest("/api/v1/wx/message_tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "华农知道实时推送",
            web_hook_url: body.webhookUrl.trim(),
            message_template:
              '{"title":"{{title}}","url":"{{url}}","mp_name":"{{mp_name}}","pic_url":"{{pic_url}}","description":"{{description}}","publish_time":"{{publish_time}}"}',
            mps_id: "",
            message_type: 0,
            cron_exp: body.cronExp || "0 */1 * * *",
            status: 1,
          }),
        });
        return NextResponse.json({ ok: true, task });
      }

      default:
        return NextResponse.json({ error: "未知操作" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
