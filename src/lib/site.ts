/**
 * 「华农知道」SCAU Know 站点配置
 *
 * 视觉与校园元素取自华南农业大学官方口径：
 * - 标准色 #007848（2024 年 115 周年校庆视觉形象识别系统）
 * - 校训：修德 博学 求实 创新
 * - 建校：1909 年广东全省农事试验场暨附设农业讲习所
 * - 校园名片：五湖四海一片林的紫荆校园
 */

export const SITE = {
  name: "华农知道",
  nameEn: "SCAU Know",
  fullName: "华南农业大学",
  fullNameEn: "South China Agricultural University",
  campus: "scau",
  version: "V2.0",
  motto: ["修德", "博学", "求实", "创新"],
  founded: 1909,
  /** 学校视觉形象识别系统标准绿 */
  standardGreen: "#007848",
  description:
    "聚合华南农业大学公开活动、学术讲座、招募、教务与校园通知，一站查看时间、地点与原文。",
  descriptionEn:
    "Aggregating public events, academic lectures, recruitment, and campus notices across South China Agricultural University.",
  location: "广州市天河区五山路 483 号",
  locationEn: "Wushan, Tianhe District, Guangzhou",
  campusLinks: [
    { label: "华农官网", labelEn: "SCAU Home", href: "https://www.scau.edu.cn/" },
    { label: "本科生院", labelEn: "Academics", href: "https://jwc.scau.edu.cn/" },
    { label: "图书馆", labelEn: "Library", href: "https://lib.scau.edu.cn/" },
  ],
} as const;

export type CategoryIntent = "activity" | "information";

export type Tone =
  | "leaf"
  | "water"
  | "amber"
  | "rose"
  | "lilac"
  | "peach"
  | "iris"
  | "ochre"
  | "slate";

export interface Category {
  slug: string;
  name: string;
  nameEn: string;
  /** 板块分组 */
  cluster: CategoryIntent;
  /** 语义色板 */
  tone: Tone;
  /** 分类说明，用于 title 与筛选提示 */
  hint: string;
  /** 图标 key，对应 lucide 图标 */
  icon: string;
}

export const CLUSTERS: {
  key: CategoryIntent;
  label: string;
  labelEn: string;
  tone: Tone;
  icon: string;
}[] = [
  { key: "activity", label: "活动", labelEn: "Events", tone: "peach", icon: "calendar-days" },
  { key: "information", label: "通知", labelEn: "Notices", tone: "water", icon: "newspaper" },
];

export const CATEGORIES: Category[] = [
  // ── 活动 ──────────────────────────────────────────────
  {
    slug: "arts",
    name: "文体",
    nameEn: "Arts & Sports",
    cluster: "activity",
    tone: "lilac",
    hint: "演出、展览、比赛、晚会与校园文艺体育活动",
    icon: "palette",
  },
  {
    slug: "clubs",
    name: "社团",
    nameEn: "Clubs",
    cluster: "activity",
    tone: "leaf",
    hint: "社团招新、兴趣小组、志愿活动与校园社群",
    icon: "users",
  },
  {
    slug: "lectures",
    name: "讲座",
    nameEn: "Lectures",
    cluster: "activity",
    tone: "water",
    hint: "学术讲座、名家讲坛、报告会与学术沙龙",
    icon: "presentation",
  },
  {
    slug: "skills",
    name: "学习",
    nameEn: "Skills",
    cluster: "activity",
    tone: "amber",
    hint: "技能培训、阅读分享、学科竞赛与课外实践",
    icon: "lightbulb",
  },
  {
    slug: "careers",
    name: "就业",
    nameEn: "Careers",
    cluster: "activity",
    tone: "rose",
    hint: "实习招聘、校园宣讲、双选会与职业发展机会",
    icon: "briefcase",
  },
  {
    slug: "exchange",
    name: "留学",
    nameEn: "Exchange",
    cluster: "activity",
    tone: "slate",
    hint: "交换留学、境外暑校、访学与出国项目申请",
    icon: "compass",
  },
  // ── 通知 ──────────────────────────────────────────────
  {
    slug: "campus",
    name: "校园",
    nameEn: "Campus",
    cluster: "information",
    tone: "amber",
    hint: "学校新闻、活动回顾、人物故事与校园综合消息",
    icon: "megaphone",
  },
  {
    slug: "research",
    name: "科研",
    nameEn: "Research",
    cluster: "information",
    tone: "water",
    hint: "科研成果、学术进展、学术会议纪要与研究资讯",
    icon: "flask",
  },
  {
    slug: "departments",
    name: "院系",
    nameEn: "Colleges",
    cluster: "information",
    tone: "lilac",
    hint: "院系通知、院系新闻、培养介绍与单位动态",
    icon: "book-open",
  },
  {
    slug: "life",
    name: "生活",
    nameEn: "Life",
    cluster: "information",
    tone: "peach",
    hint: "食宿出行、运动健身、假期安全、场馆开放与生活指南",
    icon: "coffee",
  },
  {
    slug: "academics",
    name: "学业",
    nameEn: "Academics",
    cluster: "information",
    tone: "iris",
    hint: "选课考试、学籍学位、证书课程与学分办理指南",
    icon: "graduation-cap",
  },
  {
    slug: "scholarships",
    name: "奖学金",
    nameEn: "Scholarships",
    cluster: "information",
    tone: "ochre",
    hint: "奖学金、助学贷款、补助、综测与荣誉评选",
    icon: "award",
  },
  {
    slug: "services",
    name: "服务",
    nameEn: "Services",
    cluster: "information",
    tone: "water",
    hint: "住宿餐饮、场馆、网络、维修、校园卡与系统办理",
    icon: "wrench",
  },
  {
    slug: "recruitment",
    name: "招聘",
    nameEn: "Hiring",
    cluster: "information",
    tone: "rose",
    hint: "教职工招聘、博士后招收、人才引进与项目聘用",
    icon: "user-plus",
  },
];

export const CATEGORY_MAP = new Map(CATEGORIES.map((c) => [c.slug, c]));

export function categoriesOf(cluster: CategoryIntent): Category[] {
  return CATEGORIES.filter((c) => c.cluster === cluster);
}

/** 华南农业大学学科分类体系（用于学科筛选与详情页标签） */
export type SubjectSlug =
  | "general"
  | "agri"
  | "vet"
  | "life"
  | "eng"
  | "econ"
  | "humanities"
  | "art";

export interface Subject {
  slug: SubjectSlug;
  name: string;
  nameEn: string;
  desc: string;
}

export const SUBJECTS: Subject[] = [
  { slug: "general", name: "学科通用", nameEn: "General", desc: "全校性通知、机关部处与公共服务" },
  { slug: "agri", name: "农林园艺", nameEn: "Agriculture & Forestry", desc: "农学、植保、园艺、林风、资环、海洋" },
  { slug: "vet", name: "动科兽医", nameEn: "Animal & Veterinary", desc: "动物科学、兽医与畜牧学科" },
  { slug: "life", name: "生命食品", nameEn: "Life & Food Science", desc: "生命科学、食品、生物质、都柏林学院" },
  { slug: "eng", name: "信息机电", nameEn: "Engineering & AI", desc: "数信、人工智能与低空、工程、水利土木、材化" },
  { slug: "econ", name: "经济管理", nameEn: "Economics & Mgmt", desc: "经济管理、公共管理" },
  { slug: "humanities", name: "人文社科", nameEn: "Humanities", desc: "人文法学、外语、马院、体育、继教、国教" },
  { slug: "art", name: "艺术设计", nameEn: "Art & Design", desc: "湾区设计与艺术学院" },
];

export const SUBJECT_MAP = new Map(SUBJECTS.map((s) => [s.slug, s]));
