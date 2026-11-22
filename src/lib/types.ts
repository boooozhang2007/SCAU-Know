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

export interface NoticeAiMeta {
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
  tone: Tone;
  kind: "college" | "department" | "service" | "media";
  url: string;
  wechat?: string;
}
