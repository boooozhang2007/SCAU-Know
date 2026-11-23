/**
 * 华南农业大学校园通知结构化抽取与校验规则引擎（v2）。
 *
 * 兼具两个职责：
 * 1. 无密钥 / 离线降级时，独立产出高准确率的体裁、重要通知标记、时间、地点、面向对象与行动摘要；
 * 2. 配置大模型时，作为 LLM 输出后的确定性清洗、时间锚定与防幻觉校验闭环，
 *    也用于读取期自动修复存量 v1 脏数据（如地点拖尾、上午12:30误转00:30、回顾贴污染日历等）。
 */

import {
  cleanTextSpacing,
  normalizeCstIso,
  sanitizeEventRange,
  toCstParts,
} from "@/lib/format";
import { shortSourceName } from "@/lib/sources";
import type { NoticeAttachment, NoticeKind } from "@/lib/types";

export const AI_SCHEMA_VERSION = 2;

const pad = (n: number) => String(n).padStart(2, "0");

const VALID_KINDS = new Set<NoticeKind>([
  "action",
  "event",
  "announcement",
  "recruitment",
  "recap",
  "editorial",
]);

export function isValidNoticeKind(v: unknown): v is NoticeKind {
  return typeof v === "string" && VALID_KINDS.has(v as NoticeKind);
}

/** 华农地点尾部噪声截断词（匹配即截断至行尾，防止把紧随其后的「报告摘要 / 主讲人 / 欢迎参加」吞进地点） */
const VENUE_STOP_RE =
  /(?:\s*(?:报告(?:摘要|内容|题目|简介)?\s*[:：]?|内容摘要|讲座摘要|摘要\s*[:：]|主讲人(?:简介)?|报告人(?:简介)?|演讲人|嘉宾(?:简介)?|主持人|特邀嘉宾|分享人|授课教师|课程简介|活动简介|活动内容|活动对象|面向对象|参加人员|参会人员|参会对象|报名方式|报名链接|报名时间|报名入口|截止时间|联系方式|联系人|联系电话|咨询电话|注意事项|参会要求|温馨提示|备注|附件\d*|来源\s*[:：]|编辑\s*[:：]|审核\s*[:：]|欢迎各位|欢迎广大|欢迎师生|欢迎全校|欢迎有兴趣|欢迎大家|欢迎参加|请各位|请广大|请参加|请提前|扫描下方|扫码|长按|点击|https?:\/\/|www\.))[\s\S]*$/i;

const NOISE_VENUE_RE =
  /^(?:另行通知|待定|待通知|未定|见附件|详见附件|详见通知|详见正文|见正文|详见|无|暂无|不限(?:地点|场地)?|本校|我校|校内|线下|线上|线上线下|各学院|各单位|各班|自定|教室|会议室|报告厅)$/;

/** 清洗并规范化地点字段（去除标签前缀、WebPlus 断空格与尾部噪声） */
export function cleanVenue(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  let v = cleanTextSpacing(raw)
    .replace(/^(?:活动地点|举办地点|会议地点|报告地点|讲座地点|宣讲地点|培训地点|比赛地点|考试地点|答辩地点|集合地点|报送地点|线下地点|线上会议号|线上平台|地点|地址)\s*[:：]?\s*/i, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(VENUE_STOP_RE, "")
    .replace(/[。！？!;；].*$/, "")
    .replace(/[，,]\s*(?:欢迎|请|届时|如需|具体|详情|可|由).*$/, "")
    // 消除华农楼栋/教室常见的断空格：第五教学楼 D 栋 302 室 -> 第五教学楼D栋302室，华南农业大学东区 运动场 -> 华南农业大学东区运动场
    .replace(/([第\u4e00-\u9fa5])\s+([A-Za-z0-9])\s*([栋座楼室号层厅])/g, "$1$2$3")
    .replace(/([A-Za-z])\s+(\d{2,4})\s*(室|号|教室|会议室|报告厅)?/g, "$1$2$3")
    .replace(/([\u4e00-\u9fa5]{2,})\s+(\d{3,4}(?:室|号)?)\b/g, "$1$2")
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])(?![或与及和])/g, "$1$2")
    .replace(/(腾讯会议|飞书会议|钉钉会议)\s*[:：]\s*/g, "$1 ")
    .replace(/^[（(\s\-—·:：]+/, "")
    .replace(/[\s\-—·:：,，、]+$/, "")
    .trim();

  // 去掉未闭合的尾部括号（如被源文截断的 "（位于华南农业大学田家炳综合训练馆南侧"）
  const openIdx = Math.max(v.lastIndexOf("（"), v.lastIndexOf("("));
  const closeIdx = Math.max(v.lastIndexOf("）"), v.lastIndexOf(")"));
  if (openIdx >= 0 && openIdx > closeIdx) {
    const before = v.slice(0, openIdx).trim();
    if (before.length >= 4) v = before;
  }

  if (
    v.length < 2 ||
    v.length > 44 ||
    NOISE_VENUE_RE.test(v) ||
    /^不限(?:地点|场地)/.test(v) ||
    /访问网上系统|自行访问|详见下方|二维码|公众号后台/.test(v)
  ) {
    return null;
  }
  return v;
}

/** 信息体裁判定：严格区分「行动/预告/公示/招募」与「已发生回顾/节气科普水文」 */
export function inferNoticeKind(params: {
  title: string;
  paragraphs: string[];
  source: string;
  category: string;
  publishedAt: string;
}): NoticeKind {
  const title = cleanTextSpacing(params.title);
  const lead = cleanTextSpacing(params.paragraphs.slice(0, 4).join(" "));
  const body = cleanTextSpacing(params.paragraphs.join("\n"));

  // 1) 明确的节气 / 科普 / 娱乐 / 校园生活自媒体非通知类文章
  if (
    /^(?:二十四节气|【紫荆心晴】|立春|雨水|惊蛰|春分|清明|谷雨|立夏|小满|芒种|夏至|小暑|大暑|立秋|处暑|白露|秋分|寒露|霜降|立冬|小雪|大雪|冬至)/.test(
      title,
    ) ||
    /并非老年人专利|读懂血管健康|到底有多[“"']?爽|这名同学火了|富帅与富美|爱拼文化|考研数学之间的区别|运动链.*开链运动|读完研.*下属/.test(
      title,
    ) ||
    /表白墙|万能墙|健身小帮手|UTips校园资讯/.test(params.source)
  ) {
    if (!/通知|报名|征集|招募|考试|截止|公示|讲座|宣讲/.test(title)) {
      return "editorial";
    }
  }

  // 2) 明确的结果公示 / 拟录取 / 获奖名单 / 制度印发
  if (
    /公示|拟录取|拟推荐|拟获奖|拟表彰|拟选聘|立项名单|获奖名单|评审结果|考核结果|选拔结果|关于印发|实施细则|管理办法|评价方案/.test(
      title,
    )
  ) {
    // 兼含"赛事圆满收官（含获奖名单）"的，如果主要是获奖公示也归入 announcement 或 recap
    if (/圆满收官|圆满落幕|完美收官/.test(title) && !/公示/.test(title)) {
      return "recap";
    }
    return "announcement";
  }

  // 3) 明确的已发生新闻回顾 / 喜报 / 会议报道（不能当成未来活动放进日历）
  const hasFutureCueInTitle =
    /预告|通知|报名|招募|招新|诚聘|招聘|征集|须知|提醒|邀您|来袭|开启|开展|举办.*通知|关于举办|关于开展|关于参加|关于做好|学术报告[:：]|讲座论坛[:：]|时\s*间\s*[:：]/.test(
      title,
    );
  const strongRecapTitle =
    /喜报|圆满收官|圆满落幕|完美收官|圆满结束|顺利举行|成功举办|成功召开|拉下帷幕|回顾|通讯稿|获批立项|勇夺|斩获|取得亮眼成果|佳绩|调研|致辞|召开.*会$|赴.*开展.*活动|应邀来我院作|在华农举办$|开讲$/.test(
      title,
    );
  if (strongRecapTitle && !hasFutureCueInTitle) {
    return "recap";
  }

  // 检查正文首段是否为典型新闻报道过去时叙述（且标题不是通知/预告）
  const pastNarrativeInLead =
    /(?:受邀(?:走进|在|为)|应邀(?:出席|来|在)|圆满收官|圆满落幕|顺利举办|成功举办|共有\d+余?人参加|近[一二三四五六七八九十百\d]+人参加|现场比拼|斩获.*奖|勇夺.*军|开展了.*讲座|做了一场专题讲座|召开.*学习会)/.test(
      lead,
    );
  if (pastNarrativeInLead && !hasFutureCueInTitle) {
    return "recap";
  }

  // 4) 招募 / 招聘 / 招新 / 征集
  if (
    /招聘会|双选会|校园招聘|秋季招聘|春季招聘|公开招聘|诚聘|招收|博士后|招募|招新|征集|选聘|招生简章|招生宣传大使|实习|选拔.*队员|队员招募/.test(
      title,
    )
  ) {
    return "recruitment";
  }

  // 5) 强行动/教务/考试/申报/办理类通知
  if (
    /考试|选课|退补选|缴费|相片采集|图像采集|学位|毕业论文|答辩|推免|保研|转专业|学籍|停水|停电|断网|放假|调休|体检|专项检查|交叉互评|奖学金|助学金|助学贷款|资助|综测|评优|评奖|模范引领|项目申报|结题|中期检查|教学评估|报销|变更通知|考生须知|入学须知|办理须知/.test(
      title,
    )
  ) {
    return "action";
  }

  // 6) 预告 / 讲座 / 文体活动 / 竞赛 / 培训
  if (
    /预告|讲座|学术报告|论坛|沙龙|讲坛|晚会|音乐会|嘉年华|柿子节|演出|比赛|大赛|公开课|工作坊|训练营|培训|宣讲会|活动|竞赛|展演|游园会/.test(
      title,
    ) ||
    ["arts", "lectures", "skills", "careers", "clubs"].includes(params.category)
  ) {
    // 二次确认：如果正文中只有过去日期且无任何未来/报名线索，仍是回顾
    if (
      /共有\d+余?人参加|圆满落幕|圆满结束|顺利完成|做了一场/.test(body.slice(0, 400)) &&
      !/报名|将于|定于|预告|诚邀|欢迎.*参加/.test(title + " " + lead)
    ) {
      return "recap";
    }
    return "event";
  }

  if (/通知|公告|安排|提醒|申报|申请|提交|报送/.test(title)) {
    return "action";
  }

  return "editorial";
}

function to24hSmart(hour: number, period?: string): number {
  let h = hour;
  if ((period === "下午" || period === "晚上" || period === "晚") && h >= 1 && h <= 11) {
    h += 12;
  } else if (period === "凌晨" && h === 12) {
    h = 0;
  }
  return h;
}

function inferYearForMonthDay(
  month: number,
  day: number,
  pubParts: { y: number; m: number; d: number },
  allowPastDays = 14,
): number {
  let y = pubParts.y;
  const candidateUtc = Date.UTC(y, month - 1, day);
  const pubUtc = Date.UTC(pubParts.y, pubParts.m - 1, pubParts.d);
  const diffDays = (candidateUtc - pubUtc) / 86400000;
  // 若发布在年底（10~12月）而通知里写 1~3 月，自动跨到下一年
  if (diffDays < -240) {
    y += 1;
  } else if (diffDays > 240 && allowPastDays > 0) {
    y -= 1;
  }
  return y;
}

function buildIsoFromParts(
  y: number,
  mo: number,
  d: number,
  hh = 0,
  mm = 0,
): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  return normalizeCstIso(`${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00+08:00`);
}

function isReasonableEventDate(iso: string, pubIso: string): boolean {
  const eMs = Date.parse(iso);
  const pMs = Date.parse(pubIso);
  if (Number.isNaN(eMs)) return false;
  if (Number.isNaN(pMs)) return true;
  const diffDays = (eMs - pMs) / 86400000;
  // 允许在发布前 7 天（如当天补发）至发布后 365 天内；排除 1909/2035 等历史或规划年份
  return diffDays >= -7 && diffDays <= 365;
}

/** 从文本提取规范化截止时间（如 "2026-11-25 17:00" 或 "2026-11-25"） */
export function extractDeadlineFromText(
  text: string,
  publishedAt: string,
): string | null {
  const normPub = normalizeCstIso(publishedAt) ?? new Date().toISOString();
  const pubParts = toCstParts(normPub);

  const patterns = [
    /(?:报名截止(?:时间)?|提交截止(?:时间)?|申报截止(?:时间)?|公示截止(?:时间)?|截止时间|截止日期|截\s*至)\s*[:：为至]?\s*(?:(20\d{2})\s*[-/.年]\s*)?(\d{1,2})\s*[-/.月]\s*(\d{1,2})日?(?:[（(][^)）]{0,10}[)）])?\s*(上午|下午|晚上|晚|中午)?\s*(?:(\d{1,2})\s*[:：点时]\s*(\d{2})?)?/,
    /(?:请于|须于|需于|应于|务必于|请务必在|请在)\s*(?:(20\d{2})\s*[-/.年]\s*)?(\d{1,2})\s*[-/.月]\s*(\d{1,2})日?(?:[（(][^)）]{0,10}[)）])?\s*(上午|下午|晚上|晚|中午)?\s*(?:(\d{1,2})\s*[:：点时]\s*(\d{2})?)?\s*(?:前|之前)(?:完成|提交|报送|报名|核对|告知|发送|反馈|缴纳|上传|填报|交回|联系)/,
    /公示期(?:为|自)?[^。\n]{0,28}?(?:至|—|–|-|~)\s*(?:(20\d{2})\s*[-/.年]\s*)?(\d{1,2})\s*[-/.月]\s*(\d{1,2})日?/,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const y = m[1] ? Number(m[1]) : inferYearForMonthDay(mo, d, pubParts);
    const hasHour = m[5] !== undefined;
    const hh = hasHour ? to24hSmart(Number(m[5]), m[4]) : 0;
    const mm = m[6] !== undefined ? Number(m[6]) : 0;
    const iso = buildIsoFromParts(y, mo, d, hh, mm);
    if (!iso || !isReasonableEventDate(iso, normPub)) continue;
    return hasHour ? `${y}-${pad(mo)}-${pad(d)} ${pad(hh)}:${pad(mm)}` : `${y}-${pad(mo)}-${pad(d)}`;
  }

  return null;
}

/** 从标题与正文中提取活动地点（支持显式标签、线上会议号与华农常见地标） */
export function extractVenueFromText(text: string): string | null {
  // 1) 显式标签
  const labelRe =
    /(?:活动地点|举办地点|会议地点|报告地点|讲座地点|宣讲地点|培训地点|比赛地点|考试地点|答辩地点|报送地点|集合地点|演出地点|地\s*点)\s*[:：]\s*([^\n]{2,80})/;
  const lm = text.match(labelRe);
  if (lm) {
    const cleaned = cleanVenue(lm[1]);
    if (cleaned) return cleaned;
  }

  // 2) 线上会议号（如 腾讯会议 895-278-082）
  const onlineRe =
    /(腾讯会议|飞书会议|钉钉会议|Zoom)\s*(?:会议号|号|ID|房间号)?\s*[:：]?\s*([0-9][0-9\-\s]{6,14}[0-9])/i;
  const om = text.match(onlineRe);
  if (om) {
    const code = om[2].replace(/\s+/g, "");
    return cleanVenue(`${om[1]} ${code}`);
  }

  // 3) 自然语句里的华农具体地点（如 "计划将于 12月5日 在 华南农业大学东区 运动场 举行哦！"）
  const proseRe =
    /(?:将于|定于|拟于|将在|定在)[^。\n]{0,36}?在\s*((?:华南农业大学)?\s*(?:五山校区|东区|西区|南区|北区|华山|泰山|燕山|启林|跃进|第[一二三四五六]教学楼|教[一二三四五]|红满堂|丁颖礼堂|行政楼|图书馆|体育馆|运动场|学生活动中心|温氏楼|[\u4e00-\u9fa5]{2,10}(?:学院|系|楼|中心|馆))[^\n，。；;！!]{0,24}?)\s*(?:举行|举办|召开|开展|开讲|进行|上演)/;
  const pm = text.match(proseRe);
  if (pm) {
    const cleaned = cleanVenue(pm[1]);
    if (cleaned) return cleaned;
  }

  return null;
}

/** 从标题与正文中提取活动起止时间（区分过去回顾、自动跨年、修复上午12点） */
export function extractScheduleFromText(params: {
  title: string;
  paragraphs: string[];
  attachments?: NoticeAttachment[];
  publishedAt: string;
  category: string;
  noticeKind: NoticeKind;
  existingStartsAt?: string | null;
  existingEndsAt?: string | null;
}): { startsAt: string | null; endsAt: string | null } {
  // 活动回顾、喜报、节气科普不进入活动日历
  if (params.noticeKind === "recap" || params.noticeKind === "editorial") {
    return { startsAt: null, endsAt: null };
  }

  const normPub = normalizeCstIso(params.publishedAt) ?? new Date().toISOString();
  const pubParts = toCstParts(normPub);

  // 先清洗已有值
  const cleanedExisting = sanitizeEventRange(params.existingStartsAt, params.existingEndsAt);
  let startsAt =
    cleanedExisting.startsAt && isReasonableEventDate(cleanedExisting.startsAt, normPub)
      ? cleanedExisting.startsAt
      : null;
  let endsAt = startsAt ? cleanedExisting.endsAt : null;

  if (startsAt && endsAt) {
    return { startsAt, endsAt };
  }

  const title = cleanTextSpacing(params.title);
  const bodyLines = params.paragraphs.map(cleanTextSpacing).filter(Boolean);
  const attSnippets = (params.attachments ?? [])
    .map((a) => cleanTextSpacing((a.parsedText ?? "").slice(0, 800)))
    .filter(Boolean);
  const joined = [title, ...bodyLines, ...attSnippets].join("\n");

  const isEventLike =
    params.noticeKind === "event" ||
    ["arts", "lectures", "skills", "careers", "clubs"].includes(params.category) ||
    /讲座|报告|论坛|比赛|大赛|宣讲|演出|培训|考试|答辩|工作坊|沙龙|晚会|嘉年华|公开课|检查|采集/.test(
      title,
    );

  // 1) 显式时间标签（覆盖标题如 "时 间 ：2026年11月20日 15:00" 与正文 "报告时间："）
  const labelPrefix = isEventLike
    ? "(?:活动时间|报告时间|讲座时间|会议时间|举办时间|开始时间|演出时间|比赛时间|宣讲时间|培训时间|考试时间|答辩时间|检查时间|采集时间|公开展演时间|开赛时间|时\\s*间)"
    : "(?:活动时间|报告时间|讲座时间|会议时间|举办时间|开始时间|演出时间|比赛时间|宣讲时间|培训时间|考试时间|答辩时间|检查时间|采集时间)";

  const labelRe = new RegExp(
    `${labelPrefix}\\s*[:：]\\s*(?:(20\\d{2})\\s*[-/.年]\\s*)?(\\d{1,2})\\s*[-/.月]\\s*(\\d{1,2})日?(?:\\s*[（(][^)）]{0,12}[)）])?\\s*(上午|下午|晚上|晚|中午|凌晨)?\\s*(?:(\\d{1,2})\\s*[:：点时]\\s*(\\d{2})?)?(?:\\s*[-–—~至到]\\s*(?:(?:(20\\d{2})\\s*[-/.年]\\s*)?(\\d{1,2})\\s*[-/.月]\\s*(\\d{1,2})日?\\s*)?(上午|下午|晚上|晚|中午|凌晨)?\\s*(?:(\\d{1,2})\\s*[:：点时]\\s*(\\d{2})?)?)?`,
  );

  const lm = joined.match(labelRe);
  if (lm) {
    const mo1 = Number(lm[2]);
    const d1 = Number(lm[3]);
    const y1 = lm[1] ? Number(lm[1]) : inferYearForMonthDay(mo1, d1, pubParts);
    const period1 = lm[4];
    const hh1 = lm[5] !== undefined ? to24hSmart(Number(lm[5]), period1) : 0;
    const mm1 = lm[6] !== undefined ? Number(lm[6]) : 0;
    const candStart = buildIsoFromParts(y1, mo1, d1, hh1, mm1);
    if (candStart && isReasonableEventDate(candStart, normPub)) {
      if (!startsAt) startsAt = candStart;
      // 解析结束时间（同日时刻或跨日日期）
      if (!endsAt) {
        if (lm[8] !== undefined && lm[9] !== undefined) {
          const mo2 = Number(lm[8]);
          const d2 = Number(lm[9]);
          const y2 = lm[7] ? Number(lm[7]) : inferYearForMonthDay(mo2, d2, pubParts);
          const hh2 = lm[11] !== undefined ? to24hSmart(Number(lm[11]), lm[10] || period1) : 0;
          const mm2 = lm[12] !== undefined ? Number(lm[12]) : 0;
          endsAt = buildIsoFromParts(y2, mo2, d2, hh2, mm2);
        } else if (lm[11] !== undefined) {
          const hh2 = to24hSmart(Number(lm[11]), lm[10] || period1);
          const mm2 = lm[12] !== undefined ? Number(lm[12]) : 0;
          endsAt = buildIsoFromParts(y1, mo1, d1, hh2, mm2);
        }
      }
    }
  }

  // 2) 自然语句预告形态（如 "计划将于12月5日在华南农业大学东区运动场举行" / "11月21日星期六19:30"）
  if (!startsAt && isEventLike) {
    const prosePatterns = [
      /(?:计划)?(?:将于|定于|拟于|定在)\s*(?:(20\d{2})\s*[-/.年]\s*)?(\d{1,2})\s*[-/.月]\s*(\d{1,2})日?(?:\s*(?:[（(][^)）]{0,10}[)）]|星期[一二三四五六日天]|周[一二三四五六日天]))?\s*(上午|下午|晚上|晚|中午)?\s*(?:(\d{1,2})\s*[:：点时]\s*(\d{2})?)?(?:\s*[-–—~至]\s*(上午|下午|晚上|晚|中午)?\s*(\d{1,2})\s*[:：点时]\s*(\d{2})?)?/,
      /(?:(20\d{2})\s*[-/.年]\s*)?(\d{1,2})\s*月\s*(\d{1,2})日?\s*(?:[（(](?:星期|周)[一二三四五六日天][)）]|(?:星期|周)[一二三四五六日天])\s*(上午|下午|晚上|晚|中午)?\s*(\d{1,2})\s*[:：点时]\s*(\d{2})(?:\s*[-–—~至]\s*(上午|下午|晚上|晚|中午)?\s*(\d{1,2})\s*[:：点时]\s*(\d{2}))?/,
    ];
    for (const re of prosePatterns) {
      const pm = joined.match(re);
      if (!pm) continue;
      // 跳过紧接在"截止/截至/前提交"语境后的日期，避免把报名截止当成活动开始时间
      const idx = pm.index ?? 0;
      const before = joined.slice(Math.max(0, idx - 12), idx);
      const after = joined.slice(idx + pm[0].length, idx + pm[0].length + 8);
      if (/截止|截至/.test(before) || /^前(?:完成|提交|报送|报名|核对)/.test(after)) {
        continue;
      }
      const mo = Number(pm[2]);
      const d = Number(pm[3]);
      const y = pm[1] ? Number(pm[1]) : inferYearForMonthDay(mo, d, pubParts);
      const period1 = pm[4];
      const hh1 = pm[5] !== undefined ? to24hSmart(Number(pm[5]), period1) : 0;
      const mm1 = pm[6] !== undefined ? Number(pm[6]) : 0;
      const candStart = buildIsoFromParts(y, mo, d, hh1, mm1);
      if (!candStart || !isReasonableEventDate(candStart, normPub)) continue;
      startsAt = candStart;
      if (!endsAt && pm[8] !== undefined) {
        const hh2 = to24hSmart(Number(pm[8]), pm[7] || period1);
        const mm2 = pm[9] !== undefined ? Number(pm[9]) : 0;
        endsAt = buildIsoFromParts(y, mo, d, hh2, mm2);
      }
      break;
    }
  }

  return sanitizeEventRange(startsAt, endsAt);
}

/** 规范化与去重面向对象标签（防幻觉、去冗余） */
export function normalizeAudience(rawList?: unknown): string[] {
  if (!Array.isArray(rawList)) return [];
  const cleaned = rawList
    .filter((x): x is string => typeof x === "string")
    .map((s) => cleanTextSpacing(s).replace(/^[面向针对限]+/, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 18 && !/^(无|暂无|未知|不限)$/.test(s));

  const uniq: string[] = [];
  for (const item of cleaned) {
    if (uniq.includes(item)) continue;
    uniq.push(item);
  }
  // 如果已有更精确的群体（如 "2027届本科毕业生"），剔除宽泛重复项（如 "本科生" 或 "全校师生"）
  const filtered = uniq.filter((item) => {
    if (item === "全校师生" && uniq.length > 1) return false;
    if (item === "本科生" && uniq.some((o) => o !== item && o.includes("本科"))) return false;
    if (item === "研究生" && uniq.some((o) => o !== item && (o.includes("研究生") || o.includes("硕博")))) {
      return false;
    }
    return true;
  });
  return filtered.slice(0, 3);
}

/** 基于标题优先 + 正文校验的精准面向对象提取（杜绝因 "2026年" 误标 "新生"） */
export function extractAudienceFromText(params: {
  title: string;
  paragraphs: string[];
  source: string;
  attachments?: NoticeAttachment[];
}): string[] {
  const title = cleanTextSpacing(params.title);
  const headText = cleanTextSpacing(params.paragraphs.slice(0, 6).join("\n"));
  const attNames = (params.attachments ?? []).map((a) => a.name).join(" ");
  const focus = `${title}\n${headText.slice(0, 900)}\n${attNames}`;
  const out: string[] = [];

  // 1) 特定届毕业生（如 2027届普通本科毕业生 / 2026届毕业生）
  const gradM = focus.match(/(20\d{2}届)(?:普通)?(本科|研究生|硕博)?毕业生/);
  if (gradM) {
    out.push(`${gradM[1]}${gradM[2] ?? ""}毕业生`);
  } else if (/应届本科毕业生|应届毕业生/.test(focus)) {
    out.push(/本科/.test(focus) ? "应届本科毕业生" : "应届毕业生");
  }

  // 2) 特定年级（必须带 "级" 或明确非引流模板的 "新生"，绝不能把 "2026年" 或公众号页眉 "新生群" 误判为面向对象！）
  const isExamTitle = /四[、,，]?六级|口语考试|考研/.test(title);
  const gradeM = focus.match(/(20\d{2}级)(?:本科|研究生|博士|硕士|国际班)?(新生|学生|本科生|研究生)?/);
  if (gradeM && !gradM && !isExamTitle) {
    const suffix = gradeM[2] || (focus.includes(`${gradeM[1]}新生`) ? "新生" : "学生");
    out.push(`${gradeM[1]}${suffix}`);
  } else if (
    !gradM &&
    !isExamTitle &&
    /(?:大一|本研|本科|研究生)?新生(?!群|攻略|福利|指南)/.test(
      `${title} ${headText.replace(/华农人聚集地[\s\S]{0,60}/g, "").slice(0, 260)}`,
    )
  ) {
    out.push(/研究生新生/.test(focus) ? "研究生新生" : "新生");
  }

  // 3) 特定考试/角色群体
  if (/四[、,，]?六级.*考生|口语考试考生/.test(focus)) {
    out.push("四六级考生");
  }
  if (/博士后/.test(title)) out.push("博士后");
  const isStudentNoticeTitle = /宿舍|学生|本科|研究生|团委|社团|志愿|奖学金|助学金|大赛|竞赛|晚会/.test(
    title,
  );
  if (
    /专家库|专任教师|青年教师|教学比赛|研究生导师|导师资格|班主任|辅导员|教职工|全体教师/.test(
      isStudentNoticeTitle ? title : `${title} ${headText.slice(0, 260)}`,
    )
  ) {
    if (/班主任/.test(title)) out.push("班主任");
    else if (/导师/.test(title)) out.push("研究生导师");
    else if (/专家库|科研项目|重点专项|基金/.test(title)) out.push("教师与科研人员");
    else out.push("教职工");
  }
  if (/公开招聘|诚聘|应聘/.test(title)) {
    out.push("应聘人员");
  }

  // 4) 常规身份（优先看标题与前 400 字，避免被文末通用落款污染）
  const primary = `${title}\n${headText.slice(0, 400)}`;
  if (out.length === 0 || !out.some((x) => /教师|教职工|应聘|博士后|导师|班主任/.test(x))) {
    if (/本科生|本科教学|本科毕业|普通本科/.test(primary) && !out.some((x) => x.includes("本科"))) {
      out.push("本科生");
    }
    if (/研究生|硕士|博士生|硕博/.test(primary) && !/博士后/.test(title) && !out.some((x) => x.includes("研究生"))) {
      out.push("研究生");
    }
  }

  if (/志愿者/.test(title) && out.length === 0) out.push("志愿者");
  if (/国际班|中外合作/.test(title) && out.length === 0) out.push("国际班学生");
  if (/党员|党支部|入党/.test(title) && out.length === 0) out.push("党员师生");

  // 5) 如果发布源为具体学院且无更具体身份，标出该学院师生
  if (out.length === 0) {
    const shortSrc = shortSourceName(params.source);
    if (/学院/.test(shortSrc) && /我院|本院|全院|各班|院内/.test(primary)) {
      out.push(`${shortSrc}师生`);
    } else {
      out.push("全校师生");
    }
  }

  return normalizeAudience(out);
}

/** 检查是否为公众号搬运的明显过期历史信息（如 2026 年发出的 2022/2023 年秋招/春招） */
function isOutdatedRepost(title: string, publishedAt: string): boolean {
  const pubYear = toCstParts(normalizeCstIso(publishedAt) ?? new Date().toISOString()).y;
  const yearM = title.match(/(20\d{2})(?:年|年度|届)?(?:春季|秋季|春招|秋招|校园招聘|校考)/);
  if (!yearM) return false;
  const titleYear = Number(yearM[1]);
  return pubYear - titleYear >= 2;
}

export interface ImportanceEvaluation {
  importance: number;
  isImportant: boolean;
  importantReason: string;
  actionSummary?: string;
  shouldNotify: boolean;
  notifyReason: string;
}

/**
 * 多维度重要通知判定（规则引擎与 LLM 后置校验共用）：
 * - 严格按体裁与标题权重评分，杜绝科普文/喜报误标、绝不漏掉毕业/考试/奖助/选课/停水电等关键通知。
 */
export function evaluateImportanceByRules(params: {
  title: string;
  paragraphs: string[];
  source: string;
  category: string;
  publishedAt: string;
  noticeKind: NoticeKind;
  startsAt?: string | null;
  registrationDeadline?: string | null;
  registration?: boolean;
  attachments?: NoticeAttachment[];
}): ImportanceEvaluation {
  const title = cleanTextSpacing(params.title);
  const lead = cleanTextSpacing(params.paragraphs.slice(0, 4).join(" "));
  const hasSheets = Boolean(params.attachments?.some((a) => a.sheets && a.sheets.length > 0));
  const hasAtts = Boolean(params.attachments && params.attachments.length > 0);

  // 1) 回顾、喜报、节气、生活水文或明显过期旧帖：永不标为重要通知
  if (params.noticeKind === "recap" || params.noticeKind === "editorial") {
    return {
      importance: params.noticeKind === "recap" ? 2 : 1,
      isImportant: false,
      importantReason: "",
      shouldNotify: false,
      notifyReason: params.noticeKind === "recap" ? "活动回顾/喜报动态" : "校园资讯/非行动类推文",
    };
  }
  if (isOutdatedRepost(title, params.publishedAt)) {
    return {
      importance: 1,
      isImportant: false,
      importantReason: "",
      shouldNotify: false,
      notifyReason: "历史过期刊发内容",
    };
  }

  // 2) Level 5：强必办 / 强利害 / 紧急校园变动（以标题为核心信号，避免正文偶发词误触）
  const level5Rules: { re: RegExp; reason: string }[] = [
    { re: /停水|停电|断网|停课|紧急通知|台风|暴雨预警|安全预警/, reason: "校园紧急生活/安全变动" },
    { re: /放假|调休|校历调整/, reason: "放假调休与教学安排" },
    { re: /选课|退补选|重修|缓考|期末考试|补考|四[、,，]?六级|CET|考研.*须知|体测/, reason: "关键考试/选课教务安排" },
    { re: /学历证书.*相片采集|毕业.*图像采集|毕业论文|学位申请|学位授予|论文答辩|最长学习年限|学籍预警/, reason: "涉及毕业资格与学籍学位" },
    { re: /推免|保研|转专业|分流/, reason: "推免保研/专业分流关键节点" },
    { re: /国家奖学金|国家励志奖学金|国家助学金|奖学金|助学金|助学贷款|综合测评|综测|资助/, reason: "奖助学金评选与资助事项" },
    { re: /学费|缴费通知|医保.*参保|新生入学须知|宿舍.*(?:消防安全|专项检查|安全检查|检查通知)|全校宿舍检查/, reason: "重要生活/缴费/安全必办" },
  ];
  for (const r of level5Rules) {
    if (r.re.test(title)) {
      const actionSummary = params.registrationDeadline
        ? `请留意截止时间：${params.registrationDeadline}`
        : undefined;
      return {
        importance: 5,
        isImportant: true,
        importantReason: r.reason,
        actionSummary,
        shouldNotify: true,
        notifyReason: r.reason,
      };
    }
  }

  // 3) Level 4：官方公示名单 / 高价值截止申报 / 大型招聘与竞赛
  const level4Rules: { re: RegExp; reason: string }[] = [
    { re: /公示|拟录取|拟推荐|拟获奖|拟表彰|拟选聘/, reason: "官方结果公示（留意异议期）" },
    { re: /双选会|大型招聘会|秋季招聘|春季招聘|公开招聘/, reason: "重要校园招聘与求职机会" },
    { re: /大创|大学生创新训练|挑战杯|职业规划大赛|模范引领计划|卓越班|交换|交流项目.*报名/, reason: "重点项目/竞赛/交流报名" },
    { re: /国家重点研发计划|项目申报指南|教改项目|创新创业学分/, reason: "重要科研/教学申报节点" },
    { re: /公众号变更通知|系统上线|空间预约系统/, reason: "校园服务渠道与系统变更" },
  ];
  for (const r of level4Rules) {
    if (r.re.test(title)) {
      const actionSummary = params.registrationDeadline
        ? `请在 ${params.registrationDeadline} 前完成办理或反馈`
        : hasSheets
          ? "附详细名单/表格，建议核对相关信息"
          : undefined;
      return {
        importance: 4,
        isImportant: true,
        importantReason: r.reason,
        actionSummary,
        shouldNotify: true,
        notifyReason: r.reason,
      };
    }
  }

  // 带明确截止时间且为行动办理/招募类通知，且不是普通小推送
  if (
    params.registrationDeadline &&
    (params.noticeKind === "action" || params.noticeKind === "announcement") &&
    /通知|报名|申报|提交|核对|申请|征集/.test(title)
  ) {
    return {
      importance: 4,
      isImportant: true,
      importantReason: "含明确办理/报名截止时间",
      actionSummary: `请于 ${params.registrationDeadline} 前按要求完成`,
      shouldNotify: true,
      notifyReason: `需在 ${params.registrationDeadline} 前完成`,
    };
  }

  // 含工作表名单附件的正式通知
  if (hasSheets && /通知|名单|汇总|结果|课程表/.test(title)) {
    return {
      importance: 4,
      isImportant: true,
      importantReason: "含名单/安排表格附件",
      actionSummary: "正文或附件包含具体名单/安排表，建议查阅",
      shouldNotify: true,
      notifyReason: "包含名单或安排表格附件",
    };
  }

  // 4) Level 3：有排期/可参与的讲座、大型活动、竞赛、培训、招募
  if (
    params.noticeKind === "event" ||
    params.noticeKind === "recruitment" ||
    Boolean(params.startsAt) ||
    /讲座|报告|论坛|晚会|嘉年华|比赛|大赛|招募|招新|宣讲|培训|公开课/.test(title)
  ) {
    const actionSummary = params.registrationDeadline
      ? `报名截止：${params.registrationDeadline}`
      : params.registration
        ? "需提前报名或预约参加"
        : undefined;
    return {
      importance: 3,
      isImportant: false,
      importantReason: "",
      actionSummary,
      shouldNotify: Boolean(params.registration && params.registrationDeadline),
      notifyReason: params.registration ? "可报名参与的校园活动/讲座" : "近期校园讲座或公开活动",
    };
  }

  // 5) Level 2：常规正式通知
  const reason = hasAtts ? "常规院系/部处通知（含附件）" : "常规校园动态";
  return {
    importance: 2,
    isImportant: false,
    importantReason: "",
    actionSummary: /请于/.test(lead) && params.registrationDeadline ? `截止：${params.registrationDeadline}` : undefined,
    shouldNotify: false,
    notifyReason: reason,
  };
}

export interface RuleAnalysisOutput {
  schemaVersion: number;
  noticeKind: NoticeKind;
  startsAt: string | null;
  endsAt: string | null;
  venue: string | null;
  audience: string[];
  registrationRequired: boolean;
  registrationDeadline: string | null;
  importance: number;
  isImportant: boolean;
  importantReason: string;
  actionSummary?: string;
  tags: string[];
  shouldNotify: boolean;
  notifyReason: string;
}

/** 一次性对单条通知执行完整 v2 规则结构化分析 */
export function analyzeNoticeByRules(params: {
  title: string;
  summary?: string;
  paragraphs: string[];
  source: string;
  category: string;
  publishedAt: string;
  startsAt?: string | null;
  endsAt?: string | null;
  venue?: string | null;
  registration?: boolean;
  attachments?: NoticeAttachment[];
}): RuleAnalysisOutput {
  const title = cleanTextSpacing(params.title);
  const paragraphs = params.paragraphs.map(cleanTextSpacing).filter(Boolean);
  const noticeKind = inferNoticeKind({
    title,
    paragraphs,
    source: params.source,
    category: params.category,
    publishedAt: params.publishedAt,
  });

  const fullText = [
    title,
    cleanTextSpacing(params.summary ?? ""),
    ...paragraphs,
    ...(params.attachments ?? []).map((a) => `${a.name}\n${(a.parsedText ?? "").slice(0, 800)}`),
  ]
    .filter(Boolean)
    .join("\n");

  const registrationDeadline =
    noticeKind === "recap" || noticeKind === "editorial"
      ? null
      : extractDeadlineFromText(fullText, params.publishedAt);

  const schedule = extractScheduleFromText({
    title,
    paragraphs,
    attachments: params.attachments,
    publishedAt: params.publishedAt,
    category: params.category,
    noticeKind,
    existingStartsAt: params.startsAt,
    existingEndsAt: params.endsAt,
  });

  const venue =
    noticeKind === "editorial"
      ? null
      : cleanVenue(params.venue) ??
        (noticeKind === "recap" ? null : extractVenueFromText(fullText));

  const audience = extractAudienceFromText({
    title,
    paragraphs,
    source: params.source,
    attachments: params.attachments,
  });

  const registrationRequired =
    noticeKind === "recap" || noticeKind === "editorial"
      ? false
      : Boolean(
          params.registration ||
            registrationDeadline ||
            /报名|预约|申请|申报|征集|招募|招新|扫码参加|填写.*问卷/.test(
              `${title}\n${paragraphs.slice(0, 5).join("\n")}`,
            ),
        );

  const imp = evaluateImportanceByRules({
    title,
    paragraphs,
    source: params.source,
    category: params.category,
    publishedAt: params.publishedAt,
    noticeKind,
    startsAt: schedule.startsAt,
    registrationDeadline,
    registration: registrationRequired,
    attachments: params.attachments,
  });

  const tags: string[] = [];
  if (imp.isImportant) tags.push("重要通知");
  if (registrationRequired) tags.push("需报名");
  if (schedule.startsAt) tags.push("有排期");
  if (params.attachments?.some((a) => a.sheets && a.sheets.length > 0)) {
    tags.push("含名单表格");
  } else if (params.attachments?.length) {
    tags.push("含附件");
  }

  return {
    schemaVersion: AI_SCHEMA_VERSION,
    noticeKind,
    startsAt: schedule.startsAt,
    endsAt: schedule.endsAt,
    venue,
    audience,
    registrationRequired,
    registrationDeadline,
    importance: imp.importance,
    isImportant: imp.isImportant,
    importantReason: imp.importantReason,
    actionSummary: imp.actionSummary,
    tags: tags.slice(0, 4),
    shouldNotify: imp.shouldNotify,
    notifyReason: imp.notifyReason,
  };
}
