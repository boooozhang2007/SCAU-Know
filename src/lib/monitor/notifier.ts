import type { CrawledNotice } from "@/lib/crawl/engine";
import { categoryName, formatFullTime, formatRange, subjectName } from "@/lib/format";
import { inferSubject, shortSourceName } from "@/lib/sources";
import {
  appendAlertLog,
  hasDelivered,
  readAlertRules,
  type AlertChannel,
  type AlertRule,
} from "./rules";
import { matchNoticeAgainstRule, type MatchHit } from "./matcher";
import { DEFAULT_ALERT_TEMPLATE, renderTemplate } from "./template";

const WHERE_LABEL: Record<MatchHit["where"], string> = {
  xlsx: "Excel 表格",
  attachment: "文档附件",
  title: "通知标题",
  body: "通知正文",
  ai: "AI 语义",
};

export function buildTemplateVariables(
  notice: CrawledNotice,
  rule: AlertRule,
  hits: MatchHit[],
  aiReason?: string,
): Record<string, string> {
  const firstXlsx = hits.find((h) => h.where === "xlsx");
  const primaryHit = firstXlsx ?? hits[0];
  const category = notice.ai?.category ?? notice.category;
  const subject = notice.ai?.subject ?? inferSubject(notice.source, notice.title);
  const startsAt = notice.ai?.startsAt ?? notice.startsAt;
  const endsAt = notice.ai?.endsAt ?? notice.endsAt;
  const venue = notice.ai?.venue ?? notice.venue ?? "";
  const summary = notice.ai?.summary ?? notice.summary ?? "";
  const cleanTitle = notice.ai?.cleanTitle ?? notice.title;

  return {
    title: notice.title,
    clean_title: cleanTitle,
    category_name: categoryName(category),
    subject_name: subjectName(subject),
    source: notice.source,
    source_short: shortSourceName(notice.source),
    published_at: formatFullTime(notice.publishedAt),
    event_time: formatRange(startsAt, endsAt) ?? "",
    venue: venue || "",
    registration: notice.registration || notice.ai?.registrationRequired ? "需报名" : "",
    summary,
    url: notice.url,
    importance: String(notice.ai?.importance ?? 3),
    matched_keywords: [...new Set(hits.map((h) => h.keyword).filter(Boolean))].join("、"),
    matched_where: primaryHit ? WHERE_LABEL[primaryHit.where] : "",
    matched_file: primaryHit?.attachmentName ?? "",
    matched_sheet: primaryHit?.sheetName ?? "",
    matched_row: primaryHit?.rowIndex ? String(primaryHit.rowIndex) : "",
    matched_row_detail: primaryHit?.rowDetail ?? "",
    ai_reason: aiReason || notice.ai?.notifyReason || "",
    subscriber: rule.subscriberName ?? "",
  };
}

export async function dispatchAlert(
  channel: AlertChannel,
  title: string,
  content: string,
  meta: Record<string, unknown> = {},
): Promise<{ ok: boolean; error?: string }> {
  const endpoint = channel.endpoint?.trim();
  const token = channel.token?.trim();

  try {
    switch (channel.type) {
      case "webhook": {
        if (!endpoint) throw new Error("未配置 Webhook URL");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;
        const r = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ title, content, ...meta }),
        });
        if (!r.ok) throw new Error(`Webhook HTTP ${r.status}`);
        return { ok: true };
      }

      case "feishu": {
        if (!endpoint) throw new Error("未配置飞书机器人 Webhook");
        const r = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msg_type: "text",
            content: { text: `${title}\n\n${content}` },
          }),
        });
        const j = (await r.json()) as { code?: number; StatusCode?: number; msg?: string };
        if (!r.ok || (j.code !== undefined && j.code !== 0) || (j.StatusCode !== undefined && j.StatusCode !== 0)) {
          throw new Error(j.msg || `飞书 HTTP ${r.status}`);
        }
        return { ok: true };
      }

      case "dingtalk": {
        if (!endpoint) throw new Error("未配置钉钉机器人 Webhook");
        const r = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msgtype: "text",
            text: { content: `${title}\n\n${content}` },
          }),
        });
        const j = (await r.json()) as { errcode?: number; errmsg?: string };
        if (!r.ok || (j.errcode !== undefined && j.errcode !== 0)) {
          throw new Error(j.errmsg || `钉钉 HTTP ${r.status}`);
        }
        return { ok: true };
      }

      case "bark": {
        if (!endpoint) throw new Error("未配置 Bark 推送地址");
        const base = endpoint.replace(/\/+$/, "");
        const r = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            body: content,
            url: typeof meta.url === "string" ? meta.url : undefined,
            group: "华农知道",
          }),
        });
        if (!r.ok) throw new Error(`Bark HTTP ${r.status}`);
        return { ok: true };
      }

      case "pushplus": {
        const pushToken = token || endpoint;
        if (!pushToken) throw new Error("未配置 PushPlus Token");
        const r = await fetch("https://www.pushplus.plus/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: pushToken,
            title,
            content: content.replace(/\n/g, "<br/>"),
            template: "html",
          }),
        });
        const j = (await r.json()) as { code?: number; msg?: string };
        if (!r.ok || (j.code !== undefined && j.code !== 200)) {
          throw new Error(j.msg || `PushPlus HTTP ${r.status}`);
        }
        return { ok: true };
      }

      case "serverchan": {
        const sendKey = token || endpoint;
        if (!sendKey) throw new Error("未配置 Server酱 SendKey");
        const apiUrl = sendKey.startsWith("http")
          ? sendKey
          : `https://sctapi.ftqq.com/${encodeURIComponent(sendKey)}.send`;
        const form = new URLSearchParams({ title, desp: content });
        const r = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        });
        if (!r.ok) throw new Error(`Server酱 HTTP ${r.status}`);
        return { ok: true };
      }

      case "wxpusher": {
        const appToken = token || endpoint;
        const uid = channel.recipient?.trim();
        if (!appToken || !uid) throw new Error("WxPusher 需提供 appToken 与接收人 UID");
        const r = await fetch("https://wxpusher.zjiecode.com/api/send/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appToken,
            content,
            summary: title.slice(0, 90),
            contentType: 1,
            uids: uid.split(",").map((s) => s.trim()).filter(Boolean),
            url: typeof meta.url === "string" ? meta.url : undefined,
          }),
        });
        const j = (await r.json()) as { code?: number; msg?: string };
        if (!r.ok || j.code !== 1000) {
          throw new Error(j.msg || `WxPusher HTTP ${r.status}`);
        }
        return { ok: true };
      }

      case "resend": {
        const apiKey = token;
        const to = channel.recipient?.trim();
        const from = endpoint || "SCAU Know <onboarding@resend.dev>";
        if (!apiKey || !to) throw new Error("Resend 需提供 API Key 与收件邮箱");
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            from,
            to: to.split(",").map((s) => s.trim()).filter(Boolean),
            subject: title,
            text: content,
          }),
        });
        if (!r.ok) throw new Error(`Resend HTTP ${r.status}`);
        return { ok: true };
      }

      default:
        throw new Error(`不支持的通道类型: ${channel.type}`);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function evaluateAndNotify(notices: CrawledNotice[]): Promise<{
  evaluated: number;
  triggered: number;
  delivered: number;
}> {
  if (notices.length === 0) return { evaluated: 0, triggered: 0, delivered: 0 };
  const rules = (await readAlertRules()).filter((r) => r.enabled);
  if (rules.length === 0) return { evaluated: notices.length, triggered: 0, delivered: 0 };

  let triggered = 0;
  let delivered = 0;

  for (const notice of notices) {
    for (const rule of rules) {
      if (await hasDelivered(rule.id, notice.id)) continue;

      const res = await matchNoticeAgainstRule(notice, rule);
      if (!res.matched) continue;

      // 若 AI 认为无需推送，且没有精确关键词/表格名单命中，则静默跳过
      if (notice.ai?.shouldNotify === false && !res.exactHit) {
        continue;
      }

      triggered++;
      const vars = buildTemplateVariables(notice, rule, res.hits, res.aiReason);
      const rendered = renderTemplate(rule.template || DEFAULT_ALERT_TEMPLATE, vars);
      const pushTitle = `【${vars.source_short}】${vars.clean_title}`;

      const dispatchRes = await dispatchAlert(rule.channel, pushTitle, rendered, {
        ruleId: rule.id,
        noticeId: notice.id,
        url: notice.url,
        hits: res.hits,
      });

      if (dispatchRes.ok) delivered++;

      await appendAlertLog({
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ruleId: rule.id,
        ruleName: rule.name,
        noticeId: notice.id,
        noticeTitle: notice.title,
        channelType: rule.channel.type,
        ok: dispatchRes.ok,
        error: dispatchRes.error,
        matchedSummary: res.hits
          .slice(0, 3)
          .map((h) => `${WHERE_LABEL[h.where]}:${h.keyword}${h.rowIndex ? `(第${h.rowIndex}行)` : ""}`)
          .join("；") || "维度订阅命中",
        renderedMessage: rendered,
        sentAt: new Date().toISOString(),
      });
    }
  }

  return { evaluated: notices.length, triggered, delivered };
}
