/**
 * 抓取源注册表。
 *
 * 所有域名与栏目路径均经实测确认（HTTP 200 且能解析出带日期的列表项）。
 * 按站点模板（template）分组，适配层据此选择解析策略：
 *
 * - `webplus`  华农主站及各二级单位通用的 WebPlus CMS，
 *              文章形态 `/YYYY/MMDD/cNNNaNNNNN/page.htm`
 * - `listing`  与 webplus 同构但列表区结构更自由（如图书馆新闻栏目）
 * - `module`   就业创业信息网（第三方招聘系统），
 *              链接形态 `/detail/news?id=NNNN&menu_id=NNNN`
 *
 * 新增单位只需在此追加一条，无需改动解析逻辑。
 */

export type SourceTemplate = "webplus" | "listing" | "module";

export type SourceKind = "college" | "department" | "service" | "media";

export interface CrawlSource {
  /** 稳定 id，用于去重与增量游标 */
  id: string;
  /** 展示名，同时作为通知的 source 字段 */
  name: string;
  kind: SourceKind;
  template: SourceTemplate;
  /** 站点根 */
  base: string;
  /** 列表页；留空表示从 base 首页解析 */
  listUrl?: string;
  /** 默认分类 slug，抓到的条目按此归类 */
  category: string;
  /** 二级单位简称，用于标题归属判断 */
  alias?: string[];
  /** 微信侧对应公众号名（可选） */
  wechat?: string;
  /** 是否启用 */
  enabled?: boolean;
}

export const CRAWL_SOURCES: CrawlSource[] = [
  // ══════════ 教学单位（26 个学院） ══════════
  {
    id: "nxy",
    name: "华南农业大学农学院",
    kind: "college",
    template: "webplus",
    base: "https://nxy.scau.edu.cn/",
    category: "departments",
    alias: ["农学院"],
    wechat: "华南农业大学农学院",
  },
  {
    id: "zb",
    name: "华南农业大学植物保护学院",
    kind: "college",
    template: "webplus",
    base: "https://zb.scau.edu.cn/",
    category: "departments",
    alias: ["植保学院", "植物保护学院"],
    wechat: "华南农业大学植物保护学院",
  },
  {
    id: "lf",
    name: "华南农业大学林学与风景园林学院",
    kind: "college",
    template: "webplus",
    base: "https://lf.scau.edu.cn/",
    category: "departments",
    alias: ["林风学院", "林学与风景园林学院"],
    wechat: "华南农业大学林学与风景园林学院",
  },
  {
    id: "yy",
    name: "华南农业大学园艺学院",
    kind: "college",
    template: "webplus",
    base: "https://yy.scau.edu.cn/",
    category: "departments",
    alias: ["园艺学院"],
    wechat: "华南农业大学园艺学院",
  },
  {
    id: "vet",
    name: "华南农业大学兽医学院",
    kind: "college",
    template: "webplus",
    base: "https://vet.scau.edu.cn/",
    listUrl: "https://vet.scau.edu.cn/tzgg/list.htm",
    category: "departments",
    alias: ["兽医学院"],
    wechat: "华南农业大学兽医学院",
  },
  {
    id: "dongke",
    name: "华南农业大学动物科学学院",
    kind: "college",
    template: "webplus",
    base: "https://dongke.scau.edu.cn/",
    category: "departments",
    alias: ["动科学院", "动物科学学院"],
    wechat: "华南农业大学动物科学学院",
  },
  {
    id: "zyhjxy",
    name: "华南农业大学资源环境学院",
    kind: "college",
    template: "webplus",
    base: "https://zyhjxy.scau.edu.cn/",
    category: "departments",
    alias: ["资环学院", "资源环境学院"],
    wechat: "华南农业大学资源环境学院",
  },
  {
    id: "hy",
    name: "华南农业大学海洋学院",
    kind: "college",
    template: "webplus",
    base: "https://hy.scau.edu.cn/",
    category: "departments",
    alias: ["海洋学院"],
    wechat: "华南农业大学海洋学院",
  },
  {
    id: "life",
    name: "华南农业大学生命科学学院",
    kind: "college",
    template: "webplus",
    base: "https://life.scau.edu.cn/",
    category: "departments",
    alias: ["生科学院", "生命科学学院"],
    wechat: "华南农业大学生命科学学院",
  },
  {
    id: "gcxy",
    name: "华南农业大学工程学院",
    kind: "college",
    template: "webplus",
    base: "https://gcxy.scau.edu.cn/",
    category: "departments",
    alias: ["工程学院"],
    wechat: "华南农业大学工程学院",
  },
  {
    id: "spxy",
    name: "华南农业大学食品学院",
    kind: "college",
    template: "webplus",
    base: "https://spxy.scau.edu.cn/",
    category: "departments",
    alias: ["食品学院"],
    wechat: "华南农业大学食品学院",
  },
  {
    id: "wcce",
    name: "华南农业大学水利与土木工程学院",
    kind: "college",
    template: "webplus",
    base: "https://wcce.scau.edu.cn/",
    category: "departments",
    alias: ["水利与土木工程学院"],
    wechat: "华南农业大学水利与土木工程学院",
  },
  {
    id: "info",
    name: "华南农业大学数学与信息学院",
    kind: "college",
    template: "webplus",
    base: "https://info.scau.edu.cn/",
    category: "departments",
    alias: ["数信学院", "数学与信息学院"],
    wechat: "华南农业大学数学与信息学院",
  },
  {
    id: "dzxy",
    name: "华南农业大学人工智能与低空技术学院",
    kind: "college",
    template: "webplus",
    base: "https://dzxy.scau.edu.cn/",
    category: "departments",
    alias: ["人工智能与低空技术学院", "电子工程学院"],
    wechat: "华南农业大学人工智能与低空技术学院",
  },
  {
    id: "cmce",
    name: "华南农业大学材料与化学工程学院",
    kind: "college",
    template: "webplus",
    base: "https://cmce.scau.edu.cn/",
    category: "departments",
    alias: ["材料与化学工程学院"],
    wechat: "华南农业大学材料与化学工程学院",
  },
  {
    id: "cfb",
    name: "华南农业大学生物质学院",
    kind: "college",
    template: "webplus",
    base: "https://cfb.scau.edu.cn/",
    category: "departments",
    alias: ["生物质学院"],
    wechat: "华南农业大学生物质学院",
  },
  {
    id: "mkszyxy",
    name: "华南农业大学马克思主义学院",
    kind: "college",
    template: "webplus",
    base: "https://mkszyxy.scau.edu.cn/",
    category: "departments",
    alias: ["马克思主义学院"],
    wechat: "华南农业大学马克思主义学院",
  },
  {
    id: "cem",
    name: "华南农业大学经济管理学院",
    kind: "college",
    template: "webplus",
    base: "https://cem.scau.edu.cn/",
    category: "departments",
    alias: ["经管学院", "经济管理学院"],
    wechat: "华南农业大学经济管理学院",
  },
  {
    id: "ggglxy",
    name: "华南农业大学公共管理学院",
    kind: "college",
    template: "webplus",
    base: "https://ggglxy.scau.edu.cn/",
    category: "departments",
    alias: ["公管学院", "公共管理学院"],
    wechat: "华南农业大学公共管理学院",
  },
  {
    id: "rw",
    name: "华南农业大学人文与法学学院",
    kind: "college",
    template: "webplus",
    base: "https://rw.scau.edu.cn/",
    category: "departments",
    alias: ["人文与法学学院"],
    wechat: "华南农业大学人文与法学学院",
  },
  {
    id: "sfs",
    name: "华南农业大学外国语学院",
    kind: "college",
    template: "webplus",
    base: "https://sfs.scau.edu.cn/",
    category: "departments",
    alias: ["外国语学院"],
    wechat: "华南农业大学外国语学院",
  },
  {
    id: "art",
    name: "华南农业大学湾区设计与艺术学院",
    kind: "college",
    template: "webplus",
    base: "https://art.scau.edu.cn/",
    category: "departments",
    alias: ["艺术学院", "湾区设计与艺术学院"],
    wechat: "华南农业大学艺术学院",
  },
  {
    id: "tyb",
    name: "华南农业大学体育学院",
    kind: "college",
    template: "webplus",
    base: "https://tyb.scau.edu.cn/",
    category: "departments",
    alias: ["体育学院", "体育运动委员会"],
    wechat: "华南农业大学体育学院",
  },
  {
    id: "jxjy",
    name: "华南农业大学继续教育学院",
    kind: "college",
    template: "webplus",
    base: "https://jxjy.scau.edu.cn/",
    category: "departments",
    alias: ["继续教育学院"],
  },
  {
    id: "cie",
    name: "华南农业大学国际教育学院",
    kind: "college",
    template: "webplus",
    base: "https://cie.scau.edu.cn/",
    category: "exchange",
    alias: ["国际教育学院"],
    wechat: "华南农业大学国际教育学院",
  },
  {
    id: "gdic",
    name: "华南农业大学广州都柏林国际生命科学与技术学院",
    kind: "college",
    template: "webplus",
    base: "https://gdic.scau.edu.cn/",
    category: "exchange",
    alias: ["都柏林国际学院"],
  },

  // ══════════ 机关部处与职能部门 ══════════
  {
    id: "jwc",
    name: "华南农业大学本科生院",
    kind: "department",
    template: "webplus",
    base: "https://jwc.scau.edu.cn/",
    category: "academics",
    alias: ["本科生院", "教务处"],
    wechat: "华南农业大学本科生院",
  },
  {
    id: "yjsy",
    name: "华南农业大学研究生院",
    kind: "department",
    template: "webplus",
    base: "https://yjsy.scau.edu.cn/",
    category: "academics",
    alias: ["研究生院"],
    wechat: "华南农业大学研究生院",
  },
  {
    id: "hr",
    name: "华南农业大学人力资源处",
    kind: "department",
    template: "webplus",
    base: "https://hr.scau.edu.cn/",
    category: "recruitment",
    alias: ["人力资源处", "人事处"],
    wechat: "华南农业大学人事处",
  },
  {
    id: "kyy",
    name: "华南农业大学科学研究院",
    kind: "department",
    template: "webplus",
    base: "https://kyy.scau.edu.cn/",
    category: "research",
    alias: ["科学研究院"],
    wechat: "华南农业大学科学研究院",
  },
  {
    id: "xtw",
    name: "华南农业大学团委",
    kind: "department",
    template: "webplus",
    base: "https://xtw.scau.edu.cn/",
    category: "clubs",
    alias: ["校团委"],
    wechat: "华南农业大学团委",
  },
  {
    id: "fao",
    name: "华南农业大学国际交流处",
    kind: "department",
    template: "webplus",
    base: "https://fao.scau.edu.cn/",
    category: "exchange",
    alias: ["国际交流处"],
    wechat: "华南农业大学国际交流处",
  },
  {
    id: "hqglc",
    name: "华南农业大学后勤管理处",
    kind: "service",
    template: "webplus",
    base: "https://hqglc.scau.edu.cn/",
    category: "life",
    alias: ["后勤管理处", "总务部"],
    wechat: "华南农业大学后勤管理处",
  },
  {
    id: "xyy",
    name: "华南农业大学校医院",
    kind: "service",
    template: "webplus",
    base: "https://xyy.scau.edu.cn/",
    category: "life",
    alias: ["校医院"],
    wechat: "华南农业大学医院",
  },
  {
    id: "xxgk",
    name: "华南农业大学信息公开",
    kind: "department",
    template: "webplus",
    base: "https://xxgk.scau.edu.cn/",
    listUrl: "https://xxgk.scau.edu.cn/2224/list.htm",
    category: "campus",
    alias: ["信息公开"],
  },
  {
    id: "xzc",
    name: "华南农业大学乡村振兴与社会服务处",
    kind: "department",
    template: "webplus",
    base: "https://xzc.scau.edu.cn/",
    category: "campus",
    alias: ["乡村振兴与社会服务处"],
  },
  {
    id: "dwllc",
    name: "华南农业大学对外联络处",
    kind: "department",
    template: "webplus",
    base: "https://dwllc.scau.edu.cn/",
    category: "campus",
    alias: ["对外联络处", "校友会"],
  },
  {
    id: "metc",
    name: "华南农业大学信息网络中心",
    kind: "service",
    template: "webplus",
    base: "https://metc.scau.edu.cn/",
    category: "services",
    alias: ["信息网络中心"],
  },
  {
    id: "fzghc",
    name: "华南农业大学发展规划处",
    kind: "department",
    template: "webplus",
    base: "https://fzghc.scau.edu.cn/",
    category: "campus",
    alias: ["发展规划处"],
  },

  // ══════════ 教辅单位 ══════════
  {
    id: "lib",
    name: "华南农业大学图书馆",
    kind: "service",
    template: "listing",
    base: "https://lib.scau.edu.cn/",
    listUrl: "https://lib.scau.edu.cn/xwtz/list.htm",
    category: "services",
    alias: ["图书馆"],
    wechat: "华南农业大学图书馆",
  },
  {
    id: "cszx",
    name: "华南农业大学测试中心",
    kind: "service",
    template: "webplus",
    base: "https://cszx.scau.edu.cn/",
    category: "research",
    alias: ["测试中心", "实验动物中心"],
  },
  {
    id: "syxl",
    name: "华南农业大学基础实验与实践训练中心",
    kind: "service",
    template: "webplus",
    base: "https://syxl.scau.edu.cn/",
    category: "academics",
    alias: ["基础实验与实践训练中心"],
  },
  {
    id: "wbg",
    name: "华南农业大学文博馆",
    kind: "service",
    template: "webplus",
    base: "https://wbg.scau.edu.cn/",
    category: "campus",
    alias: ["文博馆", "档案馆"],
  },
  {
    id: "jd",
    name: "华南农业大学科教基地服务中心",
    kind: "service",
    template: "webplus",
    base: "https://jd.scau.edu.cn/",
    category: "life",
    alias: ["科教基地服务中心", "基地管理处"],
  },
  {
    id: "cgglxt",
    name: "华南农业大学采购招标中心",
    kind: "department",
    template: "webplus",
    base: "https://cgglxt.scau.edu.cn/",
    category: "campus",
    alias: ["采购招标中心"],
    // 该站为纯 JS 单页应用，HTML 中无列表内容，静态抓取拿不到条目。
    // 需要接入其内部接口或改用浏览器渲染后再启用。
    enabled: false,
  },

  // ══════════ 第三方模板站点 ══════════
  {
    id: "jyzx",
    name: "华南农业大学就业指导中心",
    kind: "department",
    template: "module",
    base: "https://jyzx.scau.edu.cn/",
    category: "careers",
    alias: ["就业指导中心"],
    wechat: "华南农业大学就业指导中心",
    // 该站列表由前端 JS 渲染，HTML 中只有「学校概况/联系我们」等导航链接，
    // 抓不到真实招聘通知；静态抓取会产出错误条目，故停用。
    // 需接入其 JSON 接口或浏览器渲染后再启用。
    enabled: false,
  },
  {
    id: "zsb",
    name: "华南农业大学招生办公室",
    kind: "department",
    template: "webplus",
    base: "https://zsb.scau.edu.cn/",
    category: "campus",
    alias: ["招生办公室"],
  },
  {
    id: "yzb",
    name: "华南农业大学研究生招生",
    kind: "department",
    template: "webplus",
    base: "https://yzb.scau.edu.cn/",
    category: "academics",
    alias: ["研究生招生"],
  },
  {
    id: "scauxyh",
    name: "华南农业大学校友会",
    kind: "department",
    template: "webplus",
    base: "https://scauxyh.scau.edu.cn/",
    category: "campus",
    alias: ["校友会"],
  },
  {
    id: "hnr",
    name: "华南农业大学华农人物网",
    kind: "media",
    template: "webplus",
    base: "https://hnr.scau.edu.cn/",
    category: "campus",
    alias: ["华农人物"],
    // 人物志栏目：列表项是人物简介（标题为「姓名 生卒 职务」），
    // 详情页标题是「记某某教授」，与列表不对应，不属于通知，停用。
    enabled: false,
  },
  {
    id: "main",
    name: "华南农业大学",
    kind: "media",
    template: "webplus",
    base: "https://www.scau.edu.cn/",
    category: "campus",
    alias: ["学校要闻"],
    wechat: "华南农业大学",
  },
];

export const SOURCE_BY_ID = new Map(CRAWL_SOURCES.map((s) => [s.id, s]));

export function enabledSources(): CrawlSource[] {
  return CRAWL_SOURCES.filter((s) => s.enabled !== false);
}

export function sourcesByKind(kind: SourceKind): CrawlSource[] {
  return CRAWL_SOURCES.filter((s) => s.kind === kind);
}

/** 带公众号的源，用于微信侧采集规划 */
export function wechatSources(): CrawlSource[] {
  return CRAWL_SOURCES.filter((s) => !!s.wechat);
}
