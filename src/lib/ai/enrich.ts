/**
 * AI 结构化抽取与语义相关性判定模块（v2）。
 *
 * 设计要点：
 * 1. 先判信息体裁（action / event / announcement / recruitment / recap / editorial），
 *    从源头杜绝「新闻回顾污染活动日历」「喜报/科普误标重要通知」。
 * 2. 上下文显著性裁剪：显式注入北京时间发布日与星期作为相对日期锚点，
 *    除首段外定向保留全文中含时间/地点/截止/面向对象/报名线索的段落，避免长推文尾部信息被截断。
 * 3. LLM + 确定性后置校验闭环：强制规范 CST (+08:00) 时间戳、校验起止顺序、清洗地点尾部噪声、
 *    防幻觉校验面向对象与重要度交叉校验；未配置密钥时无缝降级为同套 v2 确定性规则引擎。
 */

import { CATEGORIES, SUBJECTS, type SubjectSlug } from "@/lib/site";
import { inferSubject } from "@/lib/sources";
import {
  cleanTextSpacing,
  formatFullTime,
  normalizeCstIso,
  sanitizeEventRange,
  toCstParts,
} from "@/lib/format";
import type { NoticeAiMeta, NoticeKind } from "@/lib/types";
import type { CrawledNotice } from "@/lib/crawl/engine";
import { isAiReady, readEffectiveAiConfigSync } from "./config";
import {
  AI_SCHEMA_VERSION,
  analyzeNoticeByRules,
  cleanVenue,
  isValidNoticeKind,
  normalizeAudience,
} from "./extract-rules";

const VALID_CATEGORY_SLUGS = new Set(CATEGORIES.map((c) => c.slug));
const VALID_SUBJECT_SLUGS = new Set<string>(SUBJECTS.map((s) => s.slug));

export function isAiConfigured(): boolean {
  return isAiReady(readEffectiveAiConfigSync());
}

export function getAiConfig() {
  return readEffectiveAiConfigSync();
}

function buildRuleAiMeta(notice: CrawledNotice): NoticeAiMeta {
  const analysis = analyzeNoticeByRules({
    title: notice.title,
    summary: notice.summary,
    paragraphs: notice.paragraphs ?? [],
    source: notice.source,
    category: notice.category,
    publishedAt: notice.publishedAt,
    startsAt: notice.startsAt,
    endsAt: notice.endsAt,
    venue: notice.venue,
    registration: notice.registration,
    attachments: notice.attachments,
  });

  return {
    schemaVersion: AI_SCHEMA_VERSION,
    noticeKind: analysis.noticeKind,
    cleanTitle: cleanTextSpacing(notice.title),
    summary: cleanTextSpacing(notice.summary || notice.paragraphs?.[0] || notice.title).slice(0, 200),
    category: VALID_CATEGORY_SLUGS.has(notice.category) ? notice.category : "campus",
    subject: inferSubject(notice.source, notice.title),
    startsAt: analysis.startsAt,
    endsAt: analysis.endsAt,
    venue: analysis.venue,
    audience: analysis.audience,
    registrationRequired: analysis.registrationRequired,
    registrationDeadline: analysis.registrationDeadline,
    importance: analysis.importance,
    isImportant: analysis.isImportant,
    importantReason: analysis.importantReason || undefined,
    actionSummary: analysis.actionSummary,
    tags: analysis.tags,
    shouldNotify: analysis.shouldNotify,
    notifyReason: analysis.notifyReason,
    enrichedBy: "rules",
    enrichedAt: new Date().toISOString(),
  };
}

/** 线索段落识别：确保长推文中段/尾部的时间、地点、对象、截止与报名说明不会被截断 */
const SALIENT_CUE_RE =
  /(?:时间|日期|地点|地址|教室|报告厅|会议室|礼堂|运动场|教学楼|腾讯会议|飞书会议|雨课堂|截止|截至|报名|预约|申请|申报|面向|对象|年级|本科|研究生|毕业生|新生|教职工|停水|停电|放假|调休|公示|异议|缴费|考试|选课|答辩|推免|奖学金|助学金|\d{1,2}月\d{1,2}日|\d{1,2}[:：]\d{2})/;

function buildContextExcerpt(notice: CrawledNotice): string {
  const normPub = normalizeCstIso(notice.publishedAt) ?? notice.publishedAt;
  const pubReadable = formatFullTime(normPub, "zh");

  const cleanedParas = (notice.paragraphs ?? []).map(cleanTextSpacing).filter(Boolean);
  const pickedParas: string[] = [];
  const pickedIdx = new Set<number>();

  // 1) 始终保留前 5 段（交代背景与主体）
  for (let i = 0; i < Math.min(5, cleanedParas.length); i++) {
    pickedParas.push(cleanedParas[i]);
    pickedIdx.add(i);
  }
  // 2) 定向补充中后段含时间/地点/对象/截止/重要事项的段落
  let extraChars = 0;
  for (let i = 5; i < cleanedParas.length && extraChars < 1800; i++) {
    const p = cleanedParas[i];
    if (SALIENT_CUE_RE.test(p)) {
      pickedParas.push(p);
      pickedIdx.add(i);
      extraChars += p.length;
    }
  }
  // 3) 若正文不长则补全剩余段落
  for (let i = 5; i < cleanedParas.length && pickedParas.join("\n").length < 2400; i++) {
    if (!pickedIdx.has(i)) {
      pickedParas.push(cleanedParas[i]);
    }
  }

  const parts = [
    `标题: ${cleanTextSpacing(notice.title)}`,
    `来源单位: ${notice.source}`,
    `发布时间: ${pubReadable}（ISO: ${normPub}，以下所有相对日期请以此北京时间锚定）`,
    `抓取预判分类: ${notice.category}`,
    `正文:\n${pickedParas.join("\n").slice(0, 2800)}`,
  ];

  const tables = notice.blocks?.filter((b) => b.type === "table") ?? [];
  if (tables.length > 0) {
    const tableText = tables
      .slice(0, 3)
      .map((t, idx) => {
        const rows = t.rows
          .slice(0, 10)
          .map((row) => row.map((cell) => cleanTextSpacing(cell.text)).join(" | "))
          .filter(Boolean)
          .join("\n");
        const head = t.caption ? `表格${idx + 1}(${cleanTextSpacing(t.caption)})` : `表格${idx + 1}`;
        return rows ? `${head}:\n${rows}` : "";
      })
      .filter(Boolean)
      .join("\n");
    if (tableText) {
      parts.push(`正文表格:\n${tableText.slice(0, 900)}`);
    }
  }

  if (notice.attachments?.length) {
    const attText = notice.attachments
      .slice(0, 5)
      .map((a) => {
        const sheetHint = a.sheets?.length
          ? `[含${a.sheets.length}张表格，共${a.sheets.reduce((s, sh) => s + sh.totalRows, 0)}行]`
          : "";
        const textPreview = cleanTextSpacing((a.parsedText ?? "").slice(0, 500));
        return `附件《${a.name}》(${a.ext})${sheetHint}${textPreview ? `: ${textPreview}` : ""}`;
      })
      .join("\n");
    parts.push(`附件信息:\n${attText.slice(0, 1000)}`);
  }

  return parts.join("\n\n").slice(0, 4800);
}

function normalizeDeadlineValue(raw: unknown, publishedAt: string): string | null {
  if (typeof raw !== "string") return null;
  const s = cleanTextSpacing(raw);
  if (!s || /^(null|none|无|暂无)$/i.test(s)) return null;
  const normIso = normalizeCstIso(s);
  if (normIso) {
    const p = toCstParts(normIso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return p.hh === 0 && p.mm === 0
      ? `${p.y}-${pad(p.m)}-${pad(p.d)}`
      : `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}`;
  }
  // 补齐缺年份的 "11月25日 17:00"
  const md = s.match(/^(\d{1,2})\s*[-/.月]\s*(\d{1,2})日?(?:\s*(\d{1,2})[:：](\d{2}))?$/);
  if (md) {
    const pub = toCstParts(normalizeCstIso(publishedAt) ?? new Date().toISOString());
    const pad = (n: number) => String(n).padStart(2, "0");
    const mo = Number(md[1]);
    const d = Number(md[2]);
    let y = pub.y;
    if (pub.m >= 10 && mo <= 3) y += 1;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return md[3]
        ? `${y}-${pad(mo)}-${pad(d)} ${pad(Number(md[3]))}:${md[4]}`
        : `${y}-${pad(mo)}-${pad(d)}`;
    }
  }
  return s.slice(0, 36);
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
 * 对单条通知执行结构化解析（已配置可用 AI 模型时走大模型 + 确定性后置校验，否则自动使用 v2 规则引擎）。
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

  const systemPrompt = `你是「华农知道」（华南农业大学校园通知聚合平台）的结构化情报解析助手。
请仔细阅读通知标题、来源、发布时间（北京时间）、正文、表格与附件，先判断信息体裁，再严格输出合法 JSON（不要 markdown 代码块，不要任何多余解释）。

## 字段定义与严格规范
1. noticeKind: 必须是以下之一：
   - "action": 需办理/必看通知（选课、考试、缴费、毕业照采集、学位答辩、奖助学金申报、放假调休、停水停电、安全检查等）
   - "event": 即将举办或正在进行的活动/讲座/论坛/比赛/晚会/宣讲会/培训预告
   - "announcement": 结果公示、拟录取/拟获奖名单、政策制度印发
   - "recruitment": 招新、志愿者招募、教职工/博士后招聘、校园双选/实习岗位、项目征集
   - "recap": 已结束的活动回顾、赛事收官报道、喜报获奖新闻、领导调研/会议通讯稿
   - "editorial": 节气问候、健康科普、生活随笔、自媒体水文、非行动类校园闲聊
2. cleanTitle: string（去噪精简标题，去除"重磅！""速看！"或重复前缀，保留核心主语与事件，≤70字）
3. summary: string（70~140字信息密度高的摘要，直接说清：面向谁、做什么、何时何地、如何办理/截止时间）
4. category: 必须是以下之一：${[...VALID_CATEGORY_SLUGS].join(", ")}
5. subject: 必须是以下之一：${[...VALID_SUBJECT_SLUGS].join(", ")}（general=全校通用）
6. startsAt: string | null（活动/讲座/考试/检查的实际开始时间，必须是带 +08:00 的 ISO 8601，如 "2026-11-26T14:30:00+08:00"；若只给日期不给具体时刻则用 "YYYY-MM-DDT00:00:00+08:00"）
   - 严禁把"文章发布时间"或"报名截止时间"填进 startsAt！
   - 若 noticeKind 为 "recap" 或 "editorial"（已发生的新闻回顾/科普水文），startsAt 和 endsAt 必须为 null！
   - 相对日期（如"本周五""12月5日""明晚7点"）请严格按给定"发布时间"换算；注意中文"上午10:30-12:30"结束时间是 12:30（中午），绝不是 00:30！
7. endsAt: string | null（活动实际结束 ISO 8601 带 +08:00，必须晚于 startsAt，无明确结束时间则 null）
8. venue: string | null（纯地点或线上会议号，如 "第五教学楼D栋302室"、"东区运动场"、"腾讯会议 895-278-082"；严禁夹带"报告摘要""主讲人""欢迎各位师生"等后续文字；未提及或"另行通知/待定"填 null）
9. audience: string[]（最多3个精准面向群体，如 ["2027届本科毕业生"]、["四六级考生"]、["本科生", "研究生"]、["教师与科研人员"]、["农学院学生"]；严禁把"2026年"误判为"新生"；仅当确属全校泛指时才填 ["全校师生"]）
10. registrationRequired: boolean（是否需要主动报名/预约/提交材料/填报系统；回顾与科普必为 false）
11. registrationDeadline: string | null（报名/提交/公示异议截止时间，格式 "YYYY-MM-DD HH:mm" 或 "YYYY-MM-DD"，无则 null）
12. importance: integer 1..5，严格按对学生的切身利害与紧迫度打分：
   - 5: 必办/强利害/紧急（选课退补选、期末/四六级/考研考试、毕业照采集/学位答辩/学籍预警、推免转专业、奖助学金/综测、学费医保缴费、停水停电/放假调休/紧急安全）
   - 4: 重要公示与高价值节点（官方公示名单/拟录取/异议期、大创/挑战杯/交换交流等带截止期的重点申报、大型双选会/招聘会、宿舍消防检查、重要服务系统变更）
   - 3: 值得关注的近期活动（有明确排期的学术讲座/论坛、晚会/嘉年华/竞赛预告、社团/志愿招募、技能培训）
   - 2: 常规院系动态或受众较窄的一般通知
   - 1: 活动回顾、喜报、二十四节气、科普推文、自媒体水文、过期历史招聘
13. isImportant: boolean（是否应在首页与日历标出「重要」红/橙徽标：仅当 importance >= 4 且 noticeKind 不属于 recap/editorial 且未过时才为 true）
14. importantReason: string（若 isImportant=true，用 8~18 字说明为何重要，如"涉毕业学历注册，需按期采集"；否则空字符串 ""）
15. actionSummary: string（若有需要读者执行的动作，用 10~28 字写明行动指引，如"11月24日22:00前在公众号后台核对志愿名单"；无行动要求则 ""）
16. tags: string[]（最多4个短标签，如 ["重要通知", "需报名", "含名单表格"]）
17. shouldNotify: boolean（是否值得主动推送提醒）
18. notifyReason: string（12~36字说明提醒或忽略原因）${extraHint}`;

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

  let noticeKind: NoticeKind = isValidNoticeKind(parsed.noticeKind)
    ? parsed.noticeKind
    : fallback.noticeKind ?? "action";
  // 规则引擎识别出明确节气/水文或明显已收官回顾时，防止小模型误标为未来活动
  if (
    (fallback.noticeKind === "editorial" && noticeKind === "event") ||
    (fallback.noticeKind === "recap" &&
      /圆满收官|圆满落幕|喜报|勇夺|斩获|回顾|通讯稿/.test(notice.title))
  ) {
    noticeKind = fallback.noticeKind;
  }

  const isNonActionable = noticeKind === "recap" || noticeKind === "editorial";

  // 严格清洗与校验活动时间区间（杜绝缺时区、10:30–00:30、回顾贴进入日历）
  const rawStart =
    typeof parsed.startsAt === "string" && parsed.startsAt.trim() ? parsed.startsAt : null;
  const rawEnd =
    typeof parsed.endsAt === "string" && parsed.endsAt.trim() ? parsed.endsAt : null;
  const sanitizedSchedule = isNonActionable
    ? { startsAt: null, endsAt: null }
    : sanitizeEventRange(rawStart ?? fallback.startsAt, rawEnd ?? fallback.endsAt);

  // 严格清洗地点（即使小模型把"报告摘要"粘在地点后也能立刻剥离）
  const venue = isNonActionable
    ? null
    : cleanVenue(typeof parsed.venue === "string" ? parsed.venue : null) ??
      cleanVenue(fallback.venue);

  // 规范化面向对象
  const aiAudience = normalizeAudience(parsed.audience);
  const audience = aiAudience.length > 0 ? aiAudience : fallback.audience ?? ["全校师生"];

  const registrationDeadline = isNonActionable
    ? null
    : normalizeDeadlineValue(parsed.registrationDeadline, notice.publishedAt) ??
      fallback.registrationDeadline ??
      null;

  const registrationRequired = isNonActionable
    ? false
    : typeof parsed.registrationRequired === "boolean"
      ? parsed.registrationRequired
      : Boolean(fallback.registrationRequired || registrationDeadline);

  // 重要度与「重要通知」交叉校验：
  // 1) 回顾/科普/水文最高 2 分且永不标重要
  // 2) 规则引擎命中明确 5 级必办（毕业照/四六级/选课/奖学金/停水电）时，防止小模型漏标
  let importance =
    typeof parsed.importance === "number" && parsed.importance >= 1 && parsed.importance <= 5
      ? Math.round(parsed.importance)
      : fallback.importance ?? 2;
  if (isNonActionable) {
    importance = Math.min(importance, 2);
  } else if ((fallback.importance ?? 0) >= 5 && importance < 4) {
    importance = 5;
  }

  const isImportant = isNonActionable
    ? false
    : typeof parsed.isImportant === "boolean"
      ? parsed.isImportant || importance >= 4
      : importance >= 4;
  if (isImportant && importance < 4) importance = 4;

  const importantReason = isImportant
    ? (typeof parsed.importantReason === "string" && parsed.importantReason.trim()
        ? cleanTextSpacing(parsed.importantReason).slice(0, 28)
        : fallback.importantReason || "涉及重要教务/公示/截止节点")
    : undefined;

  const actionSummary = isNonActionable
    ? undefined
    : typeof parsed.actionSummary === "string" && parsed.actionSummary.trim()
      ? cleanTextSpacing(parsed.actionSummary).slice(0, 60)
      : fallback.actionSummary;

  const rawTags = Array.isArray(parsed.tags)
    ? parsed.tags
        .filter((x): x is string => typeof x === "string")
        .map((t) => cleanTextSpacing(t))
        .filter((t) => t.length >= 2 && t.length <= 10)
    : [];
  const tags = Array.from(
    new Set([
      ...(isImportant ? ["重要通知"] : []),
      ...(rawTags.length > 0 ? rawTags : fallback.tags ?? []),
    ]),
  ).slice(0, 4);

  const shouldNotify = isNonActionable
    ? false
    : typeof parsed.shouldNotify === "boolean"
      ? parsed.shouldNotify || isImportant
      : Boolean(fallback.shouldNotify || isImportant);

  return {
    schemaVersion: AI_SCHEMA_VERSION,
    noticeKind,
    cleanTitle:
      typeof parsed.cleanTitle === "string" && parsed.cleanTitle.trim()
        ? cleanTextSpacing(parsed.cleanTitle).slice(0, 120)
        : fallback.cleanTitle,
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? cleanTextSpacing(parsed.summary).slice(0, 260)
        : fallback.summary,
    category,
    subject,
    startsAt: sanitizedSchedule.startsAt,
    endsAt: sanitizedSchedule.endsAt,
    venue,
    audience,
    registrationRequired,
    registrationDeadline,
    importance,
    isImportant,
    importantReason,
    actionSummary,
    tags,
    shouldNotify,
    notifyReason:
      typeof parsed.notifyReason === "string" && parsed.notifyReason.trim()
        ? cleanTextSpacing(parsed.notifyReason).slice(0, 100)
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
