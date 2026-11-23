/**
 * AI 结构化抽取与语义相关性判定模块。
 *
 * - 当配置 `AI_API_KEY` 时：调用 OpenAI 兼容接口（支持 DeepSeek / Qwen / OpenAI / Gemini OpenAI 网关）
 *   输出严格 JSON 结构化元数据（干净标题、摘要、分类、华农学科、活动起止时间、地点、受众、重要度、是否发送提醒）。
 * - 未配置 `AI_API_KEY` 或调用降级时：使用确定性规则生成同样完整的结构化元数据，确保零密钥即可完整运行。
 */

import { CATEGORIES, SUBJECTS, type SubjectSlug } from "@/lib/site";
import { inferSubject } from "@/lib/sources";
import type { NoticeAiMeta } from "@/lib/types";
import type { CrawledNotice } from "@/lib/crawl/engine";
import { isAiReady, readEffectiveAiConfigSync } from "./config";

const VALID_CATEGORY_SLUGS = new Set(CATEGORIES.map((c) => c.slug));
const VALID_SUBJECT_SLUGS = new Set<string>(SUBJECTS.map((s) => s.slug));

export function isAiConfigured(): boolean {
  return isAiReady(readEffectiveAiConfigSync());
}

export function getAiConfig() {
  return readEffectiveAiConfigSync();
}

function buildRuleAiMeta(notice: CrawledNotice): NoticeAiMeta {
  const fullText = [
    notice.title,
    notice.summary,
    ...notice.paragraphs,
    ...(notice.attachments ?? []).map((a) => `${a.name}\n${a.parsedText ?? ""}`),
  ].join("\n");

  const audience: string[] = [];
  if (/本科生|本科/.test(fullText)) audience.push("本科生");
  if (/研究生|硕士|博士/.test(fullText)) audience.push("研究生");
  if (/教职工|教师|老师/.test(fullText)) audience.push("教职工");
  if (/新生|2026级/.test(fullText)) audience.push("新生");
  if (audience.length === 0) audience.push("全校师生");

  const deadlineMatch = fullText.match(
    /(?:报名截止|截止时间|截至|报名时间)[:：\s]*((?:20\d{2}年)?\d{1,2}月\d{1,2}日(?:\s*\d{1,2}[:：]\d{2})?)/,
  );

  let importance = 2;
  if (/奖学金|助学金|选课|退补选|期末考试|学位申请|答辩|推免|保研|转专业|停水|停电/.test(fullText)) {
    importance = 5;
  } else if (/公示|名单|招募|报名|双选会|招聘会|宣讲会|放假|调休|体检/.test(fullText)) {
    importance = 4;
  } else if (/讲座|报告|论坛|竞赛|大赛|志愿|培训/.test(fullText)) {
    importance = 3;
  }

  const tags: string[] = [];
  if (notice.attachments?.length) tags.push("含附件");
  if (notice.attachments?.some((a) => a.ext === "xlsx" || a.ext === "xls")) tags.push("含名单表格");
  if (notice.registration) tags.push("需报名");
  if (notice.startsAt) tags.push("有排期");

  const shouldNotify =
    importance >= 4 ||
    Boolean(notice.attachments?.some((a) => a.sheets && a.sheets.length > 0)) ||
    /截止|公示|考试|选课/.test(notice.title);

  const notifyReason = shouldNotify
    ? importance >= 5
      ? "涉及高优先教务/资助/生活变动"
      : notice.attachments?.some((a) => a.sheets?.length)
        ? "包含表格附件（可能含学生名单或分组）"
        : "包含报名/公示/重要时间节点"
    : "常规资讯类动态";

  return {
    cleanTitle: notice.title,
    summary: notice.summary,
    category: VALID_CATEGORY_SLUGS.has(notice.category) ? notice.category : "campus",
    subject: inferSubject(notice.source, notice.title),
    startsAt: notice.startsAt,
    endsAt: notice.endsAt,
    venue: notice.venue,
    audience,
    registrationRequired: notice.registration,
    registrationDeadline: deadlineMatch?.[1] ?? null,
    importance,
    tags,
    shouldNotify,
    notifyReason,
    enrichedBy: "rules",
    enrichedAt: new Date().toISOString(),
  };
}

function buildContextExcerpt(notice: CrawledNotice): string {
  const parts = [
    `标题: ${notice.title}`,
    `来源单位: ${notice.source}`,
    `发布时间: ${notice.publishedAt}`,
    `当前分类: ${notice.category}`,
    `正文:\n${notice.paragraphs.join("\n")}`,
  ];
  const tables = notice.blocks?.filter((b) => b.type === "table") ?? [];
  if (tables.length > 0) {
    const tableText = tables
      .slice(0, 3)
      .map((t, idx) => {
        const rows = t.rows
          .slice(0, 8)
          .map((row) => row.map((cell) => cell.text.trim()).join(" | "))
          .filter(Boolean)
          .join("\n");
        const head = t.caption ? `表格${idx + 1}(${t.caption})` : `表格${idx + 1}`;
        return rows ? `${head}:\n${rows}` : "";
      })
      .filter(Boolean)
      .join("\n");
    if (tableText) {
      parts.push(`正文表格:\n${tableText}`);
    }
  }
  if (notice.attachments?.length) {
    const attText = notice.attachments
      .map((a) => `附件《${a.name}》(${a.ext}): ${(a.parsedText ?? "").slice(0, 600)}`)
      .join("\n");
    parts.push(`附件摘要:\n${attText}`);
  }
  return parts.join("\n\n").slice(0, 3600);
}

function parseJsonFromLlm(raw: string): Record<string, unknown> {
  const noThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const stripped = noThink.replace(/^```(?:json)?\s*|\s*```$/gi, "").trim();
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    const first = stripped.indexOf("{");
    const last = stripped.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(stripped.slice(first, last + 1)) as Record<string, unknown>;
    }
    throw new Error("无法从模型输出中提取 JSON");
  }
}

async function callAiJson(
  systemPrompt: string,
  userPrompt: string,
  temperatureOverride?: number,
  timeoutOverride?: number,
): Promise<Record<string, unknown> | null> {
  const cfg = getAiConfig();
  if (!isAiReady(cfg)) return null;

  const ctrl = new AbortController();
  const timeoutMs = timeoutOverride ?? cfg.timeoutMs;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.apiKey) {
      headers.Authorization = `Bearer ${cfg.apiKey}`;
    }
    const body: Record<string, unknown> = {
      model: cfg.model,
      temperature: temperatureOverride ?? cfg.temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    };
    if (process.env.AI_DISABLE_THINKING === "1") {
      body.chat_template_kwargs = { thinking: false };
    }
    if (cfg.useJsonMode) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(`${cfg.apiBase}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    return parseJsonFromLlm(raw);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 对单条通知执行结构化解析（已配置可用 AI 模型时走大模型，否则自动使用规则引擎）。
 */
export async function enrichNotice(notice: CrawledNotice): Promise<NoticeAiMeta> {
  const cfg = getAiConfig();
  if (!isAiReady(cfg)) {
    return buildRuleAiMeta(notice);
  }

  const fallback = buildRuleAiMeta(notice);
  const extraHint = cfg.customInstructions.trim()
    ? `\n\n额外学校/站点偏好要求：\n${cfg.customInstructions.trim()}`
    : "";

  const systemPrompt = `你是华南农业大学校园通知结构化解析助手。请根据给定的校园通知原文与附件文本，输出严格 JSON（不要 markdown 代码块），包含以下字段：
- cleanTitle: string（精简去噪后的标题，不超过80字）
- summary: string（80~140字重点摘要，突出面向对象、核心事项、时间地点与截止节点）
- category: 必须是以下之一：${[...VALID_CATEGORY_SLUGS].join(", ")}
- subject: 必须是以下之一：${[...VALID_SUBJECT_SLUGS].join(", ")}（general表示全校通用）
- startsAt: string | null（活动开始 ISO 8601 带+08:00，无明确活动时间则 null）
- endsAt: string | null（活动结束 ISO 8601 带+08:00，无则 null）
- venue: string | null（具体地点或线上会议号，无则 null）
- audience: string[]（例如 ["本科生", "2026级", "农学院"]）
- registrationRequired: boolean
- registrationDeadline: string | null（如 "2026-11-25 17:00" 或 null）
- importance: integer 1..5（5=教务考试/奖助/紧急停水停电，4=公示名单/招聘/招募截止，3=讲座文体，2=一般动态，1=常规宣传）
- tags: string[]（最多4个短标签）
- shouldNotify: boolean（是否值得主动推送提醒）
- notifyReason: string（15~40字说明提醒原因）${extraHint}`;

  const parsed = await callAiJson(systemPrompt, buildContextExcerpt(notice));
  if (!parsed) return fallback;

  const category =
    typeof parsed.category === "string" && VALID_CATEGORY_SLUGS.has(parsed.category)
      ? parsed.category
      : fallback.category;
  const subject =
    typeof parsed.subject === "string" && VALID_SUBJECT_SLUGS.has(parsed.subject)
      ? (parsed.subject as SubjectSlug)
      : fallback.subject;

  return {
    cleanTitle:
      typeof parsed.cleanTitle === "string" && parsed.cleanTitle.trim()
        ? parsed.cleanTitle.trim().slice(0, 120)
        : fallback.cleanTitle,
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim().slice(0, 260)
        : fallback.summary,
    category,
    subject,
    startsAt:
      typeof parsed.startsAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(parsed.startsAt)
        ? parsed.startsAt
        : fallback.startsAt,
    endsAt:
      typeof parsed.endsAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(parsed.endsAt)
        ? parsed.endsAt
        : fallback.endsAt,
    venue:
      typeof parsed.venue === "string" && parsed.venue.trim()
        ? parsed.venue.trim().slice(0, 60)
        : fallback.venue,
    audience: Array.isArray(parsed.audience)
      ? parsed.audience.filter((x): x is string => typeof x === "string").slice(0, 5)
      : fallback.audience,
    registrationRequired:
      typeof parsed.registrationRequired === "boolean"
        ? parsed.registrationRequired
        : fallback.registrationRequired,
    registrationDeadline:
      typeof parsed.registrationDeadline === "string"
        ? parsed.registrationDeadline.slice(0, 40)
        : fallback.registrationDeadline,
    importance:
      typeof parsed.importance === "number" && parsed.importance >= 1 && parsed.importance <= 5
        ? Math.round(parsed.importance)
        : fallback.importance,
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.filter((x): x is string => typeof x === "string").slice(0, 4)
      : fallback.tags,
    shouldNotify:
      typeof parsed.shouldNotify === "boolean" ? parsed.shouldNotify : fallback.shouldNotify,
    notifyReason:
      typeof parsed.notifyReason === "string" && parsed.notifyReason.trim()
        ? parsed.notifyReason.trim().slice(0, 100)
        : fallback.notifyReason,
    enrichedBy: "ai",
    enrichedAt: new Date().toISOString(),
  };
}

/**
 * 阶段二：用于监控规则的 AI 语义相关性判定。
 */
export async function evaluateAiRelevance(
  notice: CrawledNotice,
  userPrompt: string,
): Promise<{ matched: boolean; confidence: number; reason: string }> {
  const prompt = userPrompt.trim();
  if (!prompt) return { matched: false, confidence: 0, reason: "" };

  if (!isAiConfigured()) {
    // 无密钥时回退为中文词元重合度判定
    const tokens = prompt
      .split(/[\s,，。；;、/|]+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 2);
    const hay = buildContextExcerpt(notice).toLowerCase();
    const hits = tokens.filter((t) => hay.includes(t));
    const ratio = tokens.length > 0 ? hits.length / Math.min(tokens.length, 4) : 0;
    const confidence = Math.min(0.95, Number(ratio.toFixed(2)));
    return {
      matched: hits.length > 0 && confidence >= 0.45,
      confidence,
      reason: hits.length > 0 ? `关键词语义命中：${hits.join("、")}` : "未命中规则关键词",
    };
  }

  const parsed = await callAiJson(
    '判断校园通知是否符合用户的订阅关注需求。返回严格 JSON：{"matched": boolean, "confidence": 0~1之间小数, "reason": "30字以内理由"}。',
    `用户关注需求：${prompt}\n\n通知内容：\n${buildContextExcerpt(notice)}`,
    0,
    18000,
  );
  if (!parsed) {
    return { matched: false, confidence: 0, reason: "AI 接口请求失败或超时" };
  }
  return {
    matched: Boolean(parsed.matched),
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}
