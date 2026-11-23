/**
 * 华南农业大学微信公众号信息源注册表（纯静态数据，浏览器/服务端均可安全导入）。
 *
 * 覆盖全校 26 个学院、校级部处与直属服务官方号、学生组织号及主流华农校园资讯号。
 */

export type WechatAccountGroup = "official" | "campus";

export interface WechatAccount {
  /** 公众号名（与 CRAWL_SOURCES.wechat 或抓取源名对应） */
  name: string;
  /** 微信号，如 scauxmt 或原始 ID */
  wechatId?: string;
  /** 公众号唯一 biz，mp 模式必需 */
  biz?: string;
  /** RSS 地址（rss 模式） */
  rss?: string;
  /** 归属的抓取源 id（CRAWL_SOURCES.id），用于继承官网分类与合并展示 */
  sourceId?: string;
  /** 覆盖默认分类 */
  category?: string;
  /** 分组：校级/院系/团学官方号 vs 校园资讯/生活/求职号 */
  group?: WechatAccountGroup;
}

/** 公众号注册表：覆盖全校 26 个学院、校级部处/服务官方号以及主流第三方华农校园资讯号 */
export const WECHAT_ACCOUNTS: WechatAccount[] = [
  // ── 校级主号与招生就业 ──
  { name: "华南农业大学", wechatId: "scauxmt", sourceId: "main", group: "official" },
  { name: "紫荆华农", wechatId: "zijingscau", category: "campus", group: "official" },
  { name: "华南农业大学招生办", wechatId: "SCAU-ZS", sourceId: "zsb", category: "academics", group: "official" },
  { name: "华南农业大学研究生教育", sourceId: "yjsy", category: "academics", group: "official" },
  { name: "华南农业大学研招办", wechatId: "SCAUYZB", sourceId: "yzb", category: "academics", group: "official" },
  { name: "华南农业大学本科生院", sourceId: "jwc", group: "official" },
  { name: "华南农业大学研究生院", sourceId: "yjsy", group: "official" },
  { name: "华南农业大学就业指导中心", sourceId: "jyzx", category: "careers", group: "official" },
  { name: "华南农大就业指导中心", sourceId: "jyzx", category: "careers", group: "official" },

  // ── 二级学院官方与团学矩阵（覆盖全部 26 个教学学院） ──
  { name: "华南农业大学农学院", sourceId: "nxy", group: "official" },
  { name: "华南农业大学植物保护学院", sourceId: "zb", group: "official" },
  { name: "华南农业大学林学与风景园林学院", sourceId: "lf", group: "official" },
  { name: "SCAU林学与风景园林", wechatId: "Lin_news", sourceId: "lf", group: "official" },
  { name: "SCAU林风青志", wechatId: "lfqingzhi", sourceId: "lf", category: "clubs", group: "official" },
  { name: "华南农业大学园艺学院", sourceId: "yy", group: "official" },
  { name: "华南农业大学兽医学院", wechatId: "scauvet", sourceId: "vet", group: "official" },
  { name: "华南农业大学动物科学学院", sourceId: "dongke", group: "official" },
  { name: "SCAU动物科学学院", sourceId: "dongke", group: "official" },
  { name: "华南农业大学资源环境学院", wechatId: "hnzyhjxy", sourceId: "zyhjxy", group: "official" },
  { name: "华南农业大学海洋学院", sourceId: "hy", group: "official" },
  { name: "华农海洋学院", sourceId: "hy", group: "official" },
  { name: "华南农业大学生命科学学院", sourceId: "life", group: "official" },
  { name: "SCAU生命科学学院", sourceId: "life", group: "official" },
  { name: "华南农业大学工程学院", sourceId: "gcxy", group: "official" },
  { name: "SCAU工程学院", sourceId: "gcxy", group: "official" },
  { name: "华南农业大学食品学院", sourceId: "spxy", group: "official" },
  { name: "食力无限", wechatId: "ysjj-food", sourceId: "spxy", group: "official" },
  { name: "华南农业大学水利与土木工程学院", sourceId: "wcce", group: "official" },
  { name: "SCAU水利团委学生会", wechatId: "scausltx", sourceId: "wcce", category: "clubs", group: "official" },
  { name: "华南农业大学数学与信息学院", sourceId: "info", group: "official" },
  { name: "SCAU数学与信息学院软件学院", wechatId: "SCAU_MIS", sourceId: "info", group: "official" },
  { name: "SCAU数学信息软件团委学生会", wechatId: "SCAUMIStuanxue", sourceId: "info", category: "clubs", group: "official" },
  { name: "华南农业大学人工智能与低空技术学院", sourceId: "dzxy", group: "official" },
  { name: "SCAU人工智能与低空技术学院", sourceId: "dzxy", group: "official" },
  { name: "SCAU电子工程学生会", wechatId: "dzgcxyxsh", sourceId: "dzxy", category: "clubs", group: "official" },
  { name: "SCAU人工智能", wechatId: "scau-AI", sourceId: "dzxy", category: "skills", group: "official" },
  { name: "AIE科联", wechatId: "scaukelian", sourceId: "dzxy", category: "skills", group: "official" },
  { name: "SCAU电子工程权益小助手", wechatId: "dzgcqydy", sourceId: "dzxy", category: "life", group: "official" },
  { name: "华南农业大学材料与化学工程学院", sourceId: "cmce", group: "official" },
  { name: "SCAU材料与化学工程学院", wechatId: "clyhxgcxy2025", sourceId: "cmce", group: "official" },
  { name: "华南农业大学生物质学院", sourceId: "cfb", group: "official" },
  { name: "SCAU生物质学院", sourceId: "cfb", group: "official" },
  { name: "华南农业大学马克思主义学院", sourceId: "mkszyxy", group: "official" },
  { name: "华南农大马克思主义学院", wechatId: "hnnydxmkszyxy", sourceId: "mkszyxy", group: "official" },
  { name: "华南农业大学经济管理学院", wechatId: "SCAU-CEM", sourceId: "cem", group: "official" },
  { name: "华南农业大学公共管理学院", sourceId: "ggglxy", group: "official" },
  { name: "华农公管", sourceId: "ggglxy", group: "official" },
  { name: "华农大社工", wechatId: "SCAU_SW", sourceId: "ggglxy", group: "official" },
  { name: "华南农业大学人文与法学学院", sourceId: "rw", group: "official" },
  { name: "华南农业大学外国语学院", sourceId: "sfs", group: "official" },
  { name: "华南农业大学艺术学院", sourceId: "art", group: "official" },
  { name: "华南农业大学湾区设计与艺术学院", sourceId: "art", group: "official" },
  { name: "华农表演", sourceId: "art", category: "arts", group: "official" },
  { name: "华南农业大学体育学院", sourceId: "tyb", group: "official" },
  { name: "华农大体育", sourceId: "tyb", category: "arts", group: "official" },
  { name: "华南农大继教", wechatId: "SCAU-ZKB800097565", sourceId: "jxjy", category: "academics", group: "official" },
  { name: "华南农业大学国际教育学院", sourceId: "cie", group: "official" },
  { name: "华农国际都柏林学院", wechatId: "SCAU-CIE", sourceId: "cie", category: "exchange", group: "official" },
  { name: "华农国际都柏林学院团委", wechatId: "CIE-GDIC85280035", sourceId: "gdic", category: "exchange", group: "official" },

  // ── 校级部处、直属服务与学生组织 ──
  { name: "华南农业大学人事处", sourceId: "hr", group: "official" },
  { name: "华南农业大学人事人才", sourceId: "hr", category: "recruitment", group: "official" },
  { name: "华南农业大学科学研究院", sourceId: "kyy", group: "official" },
  { name: "华南农业大学区域国别研究院", sourceId: "kyy", category: "research", group: "official" },
  { name: "华南农业大学测试中心", wechatId: "scaucszx", sourceId: "cszx", category: "research", group: "official" },
  { name: "华南农业大学国际交流处", sourceId: "fao", group: "official" },
  { name: "华农国际交流", wechatId: "HNguojijiaoliu", sourceId: "fao", category: "exchange", group: "official" },
  { name: "华南农业大学图书馆", wechatId: "SCAUlibrary", sourceId: "lib", category: "services", group: "official" },
  { name: "华南农业大学信息网络中心", wechatId: "SCAU_INC", sourceId: "metc", category: "services", group: "official" },
  { name: "华南农业大学文博馆", wechatId: "scau-wbg", sourceId: "wbg", category: "campus", group: "official" },
  { name: "华南农业大学校友总会", wechatId: "scauxyjjh", sourceId: "scauxyh", category: "campus", group: "official" },
  { name: "scau校友服务中心", wechatId: "scauxiaoyouhui", sourceId: "scauxyh", category: "campus", group: "official" },
  { name: "华南农业大学团委", wechatId: "scau_xtw", sourceId: "xtw", category: "clubs", group: "official" },
  { name: "华南农业大学校青志中心", wechatId: "scauvolunteer", category: "clubs", group: "official" },
  { name: "华南农业大学学生社团工作部", wechatId: "scausau", category: "clubs", group: "official" },
  { name: "华南农业大学学生会", wechatId: "iSCAUSU", category: "clubs", group: "official" },
  { name: "华南农业大学研究生会", wechatId: "scau-yjs", category: "clubs", group: "official" },
  { name: "华农研究生团委研究生会", wechatId: "scau_yjs", category: "clubs", group: "official" },
  { name: "华南农大军训教官团", category: "clubs", group: "official" },
  { name: "华南农业大学红十字会", wechatId: "scau_redcross", category: "clubs", group: "official" },
  { name: "华南农业大学创新创业学院", category: "skills", group: "official" },
  { name: "华南农业大学普通话水平测试站", category: "skills", group: "official" },
  { name: "华南农业大学财务处", wechatId: "HNNYDXcaiwuchu", category: "services", group: "official" },
  { name: "华农学工", wechatId: "scauyiban", category: "campus", group: "official" },
  { name: "华农勤工", wechatId: "scauqgzx", category: "scholarships", group: "official" },
  { name: "华农党建", wechatId: "SCAU-CPC", category: "campus", group: "official" },
  { name: "紫荆法援LAC", category: "services", group: "official" },
  { name: "华南农业大学心理中心", wechatId: "SCAU_PTC", category: "life", group: "official" },
  { name: "华南农业大学医院", sourceId: "xyy", category: "life", group: "official" },
  { name: "华农社区卫生服务中心", wechatId: "SCAUhospital", sourceId: "xyy", category: "life", group: "official" },
  { name: "华南农业大学医院体检中心", sourceId: "xyy", category: "life", group: "official" },
  { name: "华南农业大学学生医保办公室", wechatId: "scauybb", category: "life", group: "official" },
  { name: "华南农业大学后勤管理处", sourceId: "hqglc", category: "life", group: "official" },
  { name: "华南农业大学总务部", wechatId: "scauhqc", sourceId: "hqglc", category: "life", group: "official" },
  { name: "华南农业大学后勤服务平台", sourceId: "hqglc", category: "life", group: "official" },
  { name: "华农数智后勤", sourceId: "hqglc", category: "life", group: "official" },
  { name: "华南农业大学饮食服务中心", sourceId: "hqglc", category: "life", group: "official" },
  { name: "平安华农", category: "life", group: "official" },

  // ── 第三方华农校园资讯 / 生活 / 求职 / 考研号 ──
  { name: "紫荆万晓生", category: "campus", group: "campus" },
  { name: "紫荆校园菌", wechatId: "GD-zijingteam", category: "campus", group: "campus" },
  { name: "五山宝", wechatId: "iSCAUbaobao", category: "academics", group: "campus" },
  { name: "紫荆白板", category: "campus", group: "campus" },
  { name: "华农小助", wechatId: "scauhelper", category: "services", group: "campus" },
  { name: "华农助手Pro", wechatId: "huanongxiaozhan", category: "campus", group: "campus" },
  { name: "华小农校园墙", wechatId: "yep-gz", category: "campus", group: "campus" },
  { name: "华小农生活圈", category: "campus", group: "campus" },
  { name: "遇见华小农", category: "campus", group: "campus" },
  { name: "华农生活", wechatId: "SCAU6666", category: "life", group: "campus" },
  { name: "华农微生活", wechatId: "scau_live", category: "campus", group: "campus" },
  { name: "生活在华农", category: "life", group: "campus" },
  { name: "华农共享圈", category: "life", group: "campus" },
  { name: "学在华农", category: "academics", group: "campus" },
  { name: "掌上华农", category: "life", group: "campus" },
  { name: "华农校园植物", wechatId: "flscau", category: "campus", group: "campus" },
  { name: "华农UTips校园资讯", wechatId: "UTipsSCAU", category: "campus", group: "campus" },
  { name: "华农表白墙", category: "campus", group: "campus" },
  { name: "华农万能墙", wechatId: "hnwnq1", category: "campus", group: "campus" },
  { name: "华农Job信息墙", category: "careers", group: "campus" },
  { name: "华农实习速递", wechatId: "i___BM", category: "careers", group: "campus" },
  { name: "华农实习就业信息平台", category: "careers", group: "campus" },
  { name: "华农实习就业", wechatId: "huanongsxjy", category: "careers", group: "campus" },
  { name: "华农考研社团", category: "academics", group: "campus" },
  { name: "华农财会金融圈", wechatId: "SCAU-AF", category: "careers", group: "campus" },
  { name: "华农继教院专本连读生活圈", category: "academics", group: "campus" },
  { name: "SCAU健身小帮手", wechatId: "SCAUxiaobangshou", category: "life", group: "campus" },
];

export const WECHAT_BY_NAME = new Map(WECHAT_ACCOUNTS.map((a) => [a.name, a]));

/** 按 CRAWL_SOURCES.id 聚合其关联的全部官方/团学公众号 */
export const WECHAT_BY_SOURCE_ID: Map<string, WechatAccount[]> = (() => {
  const map = new Map<string, WechatAccount[]>();
  for (const acc of WECHAT_ACCOUNTS) {
    if (!acc.sourceId) continue;
    const list = map.get(acc.sourceId);
    if (list) list.push(acc);
    else map.set(acc.sourceId, [acc]);
  }
  return map;
})();

/** 无对应抓取官网的独立公众号信息源 */
export const STANDALONE_WECHAT_ACCOUNTS: WechatAccount[] = WECHAT_ACCOUNTS.filter(
  (a) => !a.sourceId,
);

export function wechatGroupOf(acc: WechatAccount): WechatAccountGroup {
  if (acc.group) return acc.group;
  return acc.sourceId ? "official" : "campus";
}
