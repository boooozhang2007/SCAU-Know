import type { CategoryIntent, SubjectSlug, Tone } from "./site";

export interface TableCell {
  text: string;
  header?: boolean;
  rowSpan?: number;
  colSpan?: number;
}

export interface TableBlock {
  type: "table";
  caption?: string;
  headers: string[];
  hasSpans?: boolean;
  rows: TableCell[][];
}

export type NoticeBlock =
  | { type: "text"; text: string }
  | { type: "image"; src: string; originalSrc: string; alt?: string }
  | TableBlock;

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
}

export interface NoticeAttachment {
  id: string;
  name: string;
  ext: string;
  url: string;
  localPath?: string;
  size?: number;
  sha256?: string;
  parsedText?: string;
  sheets?: ParsedSheet[];
  archiveFiles?: string[];
  needsOcr?: boolean;
  embedded?: boolean;
  error?: string;
}

export type NoticeKind =
  | "action"
  | "event"
  | "announcement"
  | "recruitment"
  | "recap"
  | "editorial";

export interface NoticeAiMeta {
  /** 结构化抽取 schema 版本（v2 起包含体裁判定、重要通知标记与精准对象/地点清洗） */
  schemaVersion?: number;
  /** 信息体裁：行动办理 / 活动预告 / 公示公告 / 招募招聘 / 活动回顾 / 校园资讯 */
  noticeKind?: NoticeKind;
  cleanTitle?: string;
  summary?: string;
  category?: string;
  subject?: SubjectSlug;
  startsAt?: string | null;
  endsAt?: string | null;
  venue?: string | null;
  audience?: string[];
  registrationRequired?: boolean;
  registrationDeadline?: string | null;
  importance?: number;
  /** 是否自动标为重要通知 */
  isImportant?: boolean;
  /** 重要通知判定理由（短句） */
  importantReason?: string;
  /** 一句话行动指引（如 "11月25日前登录教务系统完成选课"） */
  actionSummary?: string;
  tags?: string[];
  shouldNotify?: boolean;
  notifyReason?: string;
  enrichedBy: "ai" | "rules";
  enrichedAt: string;
}

export interface Notice {
  id: string;
  title: string;
  /** 分类 slug */
  category: string;
  cluster: CategoryIntent;
  /** 华农学科归属 */
  subject: SubjectSlug;
  tone: Tone;
  /** 发布单位全称（对应公众号/官网栏目） */
  source: string;
  /** ISO 8601，带 +08:00 */
  publishedAt: string;
  /** 活动开始时间，无则为 null */
  startsAt?: string | null;
  /** 活动结束时间，无则为 null */
  endsAt?: string | null;
  /** 活动地点 */
  venue?: string;
  /** 是否需报名 */
  registration?: boolean;
  /** 报名/提交截止时间 */
  registrationDeadline?: string | null;
  /** 面向对象（精简标签，列表与详情共用） */
  audience?: string[];
  /** 信息体裁 */
  noticeKind?: NoticeKind;
  /** 是否自动标为重要通知 */
  important?: boolean;
  /** 重要度评分 1..5 */
  importance?: number;
  /** 标为重要通知的简短原因 */
  importantReason?: string;
  /** 一句话行动指引 */
  actionSummary?: string;
  /** 摘要 */
  summary: string;
  /** 正文段落 */
  paragraphs: string[];
  /** 图文混排有序块 */
  blocks?: NoticeBlock[];
  /** 附件及其解析内容 */
  attachments?: NoticeAttachment[];
  /** 列表摘要模式下的附件总数 */
  attachmentCount?: number;
  /** 标记当前对象是否为精简列表摘要（弹窗打开时按需拉取正文与附件） */
  summaryOnly?: boolean;
  /** 精简列表模式下供前端搜索的表格/附件索引片段 */
  searchSnippet?: string;
  /** AI / 规则结构化元数据 */
  ai?: NoticeAiMeta;
  /** 原文链接 */
  url: string;
  /** 封面图，可为空 */
  cover?: string;
  /** 是否今日新收录 */
  isNew?: boolean;
  /** 是否需要校内 CAS 统一身份认证登录后查看 */
  requiresAuth?: boolean;
}

export interface SourceRef {
  name: string;
  shortName: string;
  count: number;
  /** 来自官网抓取的通知条数 */
  webCount: number;
  /** 来自微信公众号的通知条数 */
  wechatCount: number;
  tone: Tone;
  kind: "college" | "department" | "service" | "media" | "wechat";
  /** 官方站点链接（纯公众号源无独立官网时为空） */
  url?: string;
  /** 对应或关联的主微信公众号名 */
  wechat?: string;
  /** 主微信公众号微信号 */
  wechatId?: string;
  /** 关联的全部公众号名（含院系团学/子号，用于展示与检索） */
  wechatAccounts?: string[];
  /** 关联的全部微信号（用于检索） */
  wechatIds?: string[];
  /** 最新一篇微信文章链接 */
  latestWechatUrl?: string;
}
