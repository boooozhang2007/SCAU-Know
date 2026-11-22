import { NextResponse } from "next/server";
import { CRAWL_SOURCES } from "@/lib/crawl/sources";
import {
  canonicalNoticeKey,
  inferCategory,
  normalizeUrl,
  toneOf,
  type CrawledNotice,
} from "@/lib/crawl/engine";
import {
  crawlWechatWemp,
  getWempConfig,
  parseWechatHtmlToBlocks,
} from "@/lib/crawl/wechat";
import { mirrorMedia } from "@/lib/crawl/media";
import { mergeNotices } from "@/lib/crawl/store";
import { enrichNotice } from "@/lib/ai/enrich";
import { evaluateAndNotify } from "@/lib/monitor/notifier";

export const dynamic = "force-dynamic";

/**
 * 接收来自 `we-mp-rss` MessageTasks 的实时推送 Webhook，
 * 若请求体自带单篇信息则即时镜像入库，同时支持从 wemp 拉取最新一批补齐正文与封面。
 */
export async function POST(req: Request) {
  const secret = process.env.WECHAT_WEBHOOK_SECRET || process.env.CRAWL_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    const tokenHeader = req.headers.get("x-webhook-secret") ?? "";
    const urlSecret = new URL(req.url).searchParams.get("secret") ?? "";
    if (auth !== `Bearer ${secret}` && tokenHeader !== secret && urlSecret !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let payload: Record<string, unknown> = {};
  try {
    const text = await req.text();
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* 若发来纯文本消息也触发一次 wemp 拉取 */
  }

  const sourceMap = new Map(CRAWL_SOURCES.map((s) => [s.id, s]));
  const incoming: CrawledNotice[] = [];

  // 1) 若携带结构化文章字段，优先即时解析
  if (typeof payload.title === "string" && typeof payload.url === "string") {
    const cleanUrl = normalizeUrl(payload.url);
    const mpName = String(payload.mp_name ?? "华南农业大学").trim();
    const matchedSrc = CRAWL_SOURCES.find(
      (s) => s.wechat === mpName || s.name === mpName || mpName.includes(s.name),
    );
    const category = matchedSrc
      ? inferCategory(matchedSrc, payload.title)
      : "campus";

    const coverRaw = typeof payload.pic_url === "string" ? payload.pic_url : "";
    const cover = coverRaw
      ? (await mirrorMedia(coverRaw, "cover", "https://mp.weixin.qq.com/")) ?? undefined
      : undefined;

    const html = typeof payload.content === "string" ? payload.content : "";
    const parsed = html
      ? await parseWechatHtmlToBlocks(html, cleanUrl, {
          mirrorImages: true,
          parseAttachments: true,
        })
      : { blocks: [], paragraphs: [], firstImage: null, attachments: [] };

    const summary = String(payload.description ?? payload.title).slice(0, 180);
    incoming.push({
      id: `wx_hook_${Buffer.from(canonicalNoticeKey(cleanUrl)).toString("hex").slice(0, 12)}`,
      title: payload.title.slice(0, 180),
      url: cleanUrl,
      source: matchedSrc?.name ?? mpName,
      sourceId: matchedSrc?.id ?? "wx_hook",
      category,
      tone: toneOf(category),
      publishedAt:
        typeof payload.publish_time === "string" && payload.publish_time
          ? new Date(payload.publish_time).toISOString()
          : new Date().toISOString(),
      startsAt: null,
      endsAt: null,
      venue: null,
      registration: /报名|申请|预约|征集|招募/.test(payload.title),
      summary,
      paragraphs: parsed.paragraphs.length ? parsed.paragraphs : [summary],
      cover: cover ?? parsed.firstImage ?? undefined,
      blocks: parsed.blocks.length ? parsed.blocks : undefined,
      attachments: parsed.attachments.length ? parsed.attachments : undefined,
      isNew: true,
      fetchedAt: new Date().toISOString(),
    });
  }

  // 2) 若配置了 we-mp-rss，顺带同步最新 30 条带正文与封面的文章
  if (getWempConfig()) {
    try {
      const wx = await crawlWechatWemp(sourceMap, {
        limit: 30,
        mirrorImages: true,
        parseAttachments: true,
      });
      incoming.push(...wx.notices);
    } catch {
      /* 保留直推条目 */
    }
  }

  const { total, added, newItems } = await mergeNotices(incoming);
  for (const item of newItems) {
    item.ai = await enrichNotice(item);
  }
  const notify = await evaluateAndNotify(newItems);

  return NextResponse.json({
    ok: true,
    received: incoming.length,
    added,
    total,
    notify,
  });
}
