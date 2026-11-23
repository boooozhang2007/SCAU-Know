import { CRAWL_SOURCES, type SourceKind } from "@/lib/crawl/sources";
import {
  WECHAT_BY_NAME,
  WECHAT_BY_SOURCE_ID,
  type WechatAccount,
} from "@/lib/crawl/wechat-accounts";
import type { SubjectSlug } from "./site";

/**
 * 来源单位映射与元数据解析。
 * 自动整合 CRAWL_SOURCES 全部 51 个二级单位，并补充常见校内单位别名。
 */

const EXTRA_URLS: Record<string, string> = {
  华南农业大学党委宣传部: "https://www.scau.edu.cn/",
  华南农业大学档案馆: "https://wbg.scau.edu.cn/",
  华南农业大学教育发展基金会: "https://dwllc.scau.edu.cn/",
  华南农业大学语言文字工作委员会: "https://jwc.scau.edu.cn/",
  华南农业大学人事处: "https://hr.scau.edu.cn/",
  华南农业大学学生工作部: "https://www.scau.edu.cn/",
  华南农业大学党委学生工作部: "https://www.scau.edu.cn/",
  华南农业大学学生资助管理中心: "https://www.scau.edu.cn/",
  华南农业大学保卫处: "https://xxgk.scau.edu.cn/",
  华南农业大学实验室与设备管理处: "https://kyy.scau.edu.cn/",
  华南农业大学体育运动委员会: "https://tyb.scau.edu.cn/",
  华南农业大学饮食服务中心: "https://hqglc.scau.edu.cn/",
  华南农业大学艺术学院: "https://art.scau.edu.cn/",
  华南农业大学电子工程学院: "https://dzxy.scau.edu.cn/",
  华南农业大学学生会: "https://xtw.scau.edu.cn/",
  华南农业大学社团联合会: "https://xtw.scau.edu.cn/",
  华南农业大学青年志愿者协会: "https://xtw.scau.edu.cn/",
  华南农业大学艺术团: "https://xtw.scau.edu.cn/",
  华南农业大学茶文化协会: "https://xtw.scau.edu.cn/",
  华南农业大学绿野文学社: "https://xtw.scau.edu.cn/",
  华南农业大学机器人协会: "https://gcxy.scau.edu.cn/",
};

export const SOURCE_URL: Record<string, string> = {
  ...EXTRA_URLS,
  ...Object.fromEntries(CRAWL_SOURCES.map((s) => [s.name, s.listUrl ?? s.base])),
};

const SOURCE_META_BY_NAME = new Map(CRAWL_SOURCES.map((s) => [s.name, s]));

/** 卡片上使用的简洁来源简称，避免「华南农业大学...」被截断成同一前缀 */
const SHORT_NAME_OVERRIDES: Record<string, string> = {
  华南农业大学: "华农官网",
  华南农业大学广州都柏林国际生命科学与技术学院: "都柏林学院",
  华南农业大学人工智能与低空技术学院: "人工智能与低空",
  华南农业大学基础实验与实践训练中心: "基础实验中心",
  华南农业大学林学与风景园林学院: "林风学院",
  华南农业大学乡村振兴与社会服务处: "乡村振兴处",
  华南农业大学水利与土木工程学院: "水利土木学院",
  华南农业大学材料与化学工程学院: "材化学院",
  华南农业大学湾区设计与艺术学院: "湾区设计艺术",
  华南农业大学科教基地服务中心: "科教基地中心",
  华南农业大学语言文字工作委员会: "语委办",
  华南农业大学实验室与设备管理处: "实设处",
  华南农业大学学生资助管理中心: "学生资助中心",
  华南农业大学教育发展基金会: "教育基金会",
};

export function shortSourceName(source: string): string {
  if (SHORT_NAME_OVERRIDES[source]) return SHORT_NAME_OVERRIDES[source];
  const stripped = source.replace(/^华南农业大学/, "").trim();
  return stripped || "华农官网";
}

/** 根据发布单位与标题推断所属学科 */
const SOURCE_SUBJECT: Record<string, SubjectSlug> = {
  // 农林园艺
  华南农业大学农学院: "agri",
  华南农业大学植物保护学院: "agri",
  华南农业大学林学与风景园林学院: "agri",
  华南农业大学园艺学院: "agri",
  华南农业大学资源环境学院: "agri",
  华南农业大学海洋学院: "agri",
  // 动科兽医
  华南农业大学兽医学院: "vet",
  华南农业大学动物科学学院: "vet",
  // 生命食品
  华南农业大学生命科学学院: "life",
  华南农业大学食品学院: "life",
  华南农业大学生物质学院: "life",
  华南农业大学广州都柏林国际生命科学与技术学院: "life",
  // 信息机电
  华南农业大学工程学院: "eng",
  华南农业大学水利与土木工程学院: "eng",
  华南农业大学数学与信息学院: "eng",
  华南农业大学人工智能与低空技术学院: "eng",
  华南农业大学电子工程学院: "eng",
  华南农业大学材料与化学工程学院: "eng",
  华南农业大学机器人协会: "eng",
  // 经济管理
  华南农业大学经济管理学院: "econ",
  华南农业大学公共管理学院: "econ",
  // 人文社科
  华南农业大学马克思主义学院: "humanities",
  华南农业大学人文与法学学院: "humanities",
  华南农业大学外国语学院: "humanities",
  华南农业大学体育学院: "humanities",
  华南农业大学继续教育学院: "humanities",
  华南农业大学国际教育学院: "humanities",
  华南农业大学绿野文学社: "humanities",
  // 艺术设计
  华南农业大学湾区设计与艺术学院: "art",
  华南农业大学艺术学院: "art",
  华南农业大学艺术团: "art",
};

export function inferSubject(source: string, title = ""): SubjectSlug {
  const bySource = SOURCE_SUBJECT[source];
  if (bySource) return bySource;
  if (/水稻|作物|育种|园艺|植保|林学|风景园林|土壤|农业装备|海洋|水产/.test(title)) {
    return "agri";
  }
  if (/兽医|畜牧|动物医学|温氏班|养殖/.test(title)) return "vet";
  if (/生命科学|食品|生物|基因|蛋白/.test(title)) return "life";
  if (/人工智能|算法|计算机|数学|机器人|低空|工程|土木|水利|材料|化学/.test(title)) {
    return "eng";
  }
  if (/经济|金融|管理|贸易|会计|营销/.test(title)) return "econ";
  if (/法学|宪法|外语|英语|思政|人文|文学|历史|体育/.test(title)) return "humanities";
  if (/艺术|设计|音乐会|美术|书法|摄影展|服装/.test(title)) return "art";
  return "general";
}

export type ExtendedSourceKind = SourceKind | "wechat";

export function isWechatNotice(notice: { id?: string; url?: string }): boolean {
  if (notice.id?.startsWith("wx_")) return true;
  if (notice.url && /mp\.weixin\.qq\.com/i.test(notice.url)) return true;
  return false;
}

export function kindOfSource(source: string, wechatOnly = false): ExtendedSourceKind {
  const meta = SOURCE_META_BY_NAME.get(source);
  if (meta) return meta.kind;
  const wx = WECHAT_BY_NAME.get(source);
  if (wx && !wx.sourceId) return "wechat";
  if (wechatOnly) return "wechat";
  if (/学院/.test(source)) return "college";
  if (/馆|医院|中心|后勤|饮食/.test(source)) return "service";
  if (source === "华南农业大学") return "media";
  return "department";
}

/** 返回某来源单位关联的全部微信公众号（含院系官方号与团学/子号） */
export function wechatAccountsOfSource(source: string): WechatAccount[] {
  const meta = SOURCE_META_BY_NAME.get(source);
  const result: WechatAccount[] = [];
  const seen = new Set<string>();
  const push = (acc: WechatAccount) => {
    if (seen.has(acc.name)) return;
    seen.add(acc.name);
    result.push(acc);
  };

  if (meta) {
    for (const acc of WECHAT_BY_SOURCE_ID.get(meta.id) ?? []) {
      push(acc);
    }
    if (meta.wechat && !seen.has(meta.wechat)) {
      push({ name: meta.wechat, sourceId: meta.id, group: "official" });
    }
    return result;
  }

  const direct = WECHAT_BY_NAME.get(source);
  if (direct) push(direct);
  return result;
}

export function wechatOfSource(source: string): string | undefined {
  const list = wechatAccountsOfSource(source);
  return list[0]?.name ?? SOURCE_META_BY_NAME.get(source)?.wechat;
}

export function wechatIdOfSource(source: string): string | undefined {
  const list = wechatAccountsOfSource(source);
  return list.find((a) => Boolean(a.wechatId))?.wechatId;
}

const FALLBACK = "https://www.scau.edu.cn/";

/** 返回来源单位的真实官网地址；独立公众号返回 undefined，避免误链到主站 */
export function officialWebsiteUrl(source: string): string | undefined {
  const meta = SOURCE_META_BY_NAME.get(source);
  if (meta) return meta.listUrl ?? meta.base;
  const wx = WECHAT_BY_NAME.get(source);
  if (wx && !wx.sourceId) return undefined;
  return EXTRA_URLS[source];
}

/**
 * 解析某条通知的原文地址。
 * 优先使用采集到的 permalink；留空时回退到来源单位栏目页。
 */
export function resolveUrl(source: string, permalink?: string): string {
  const p = permalink?.trim();
  if (p && /^https?:\/\//i.test(p)) return p;
  return SOURCE_URL[source] ?? FALLBACK;
}

export function sourceUrl(source: string): string {
  return SOURCE_URL[source] ?? FALLBACK;
}

/** 展示用的来源域名：优先从原文 permalink 解析真实跳转域名 */
export function sourceHost(source: string, permalink?: string): string {
  try {
    return new URL(resolveUrl(source, permalink)).host;
  } catch {
    return "www.scau.edu.cn";
  }
}
