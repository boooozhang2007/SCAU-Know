#!/usr/bin/env node
/**
 * 华南农业大学微信公众号检索与 we-mp-rss 接入脚本：
 *   - 默认（或 --apply）：解析文章链接 + 四层矩阵扩展检索 + 批量订阅 + 同步首轮文章
 *   - --discover：仅执行只读搜索、去重与华农身份/质量过滤，打印候选列表（不写入 wemp）
 *   - --skip-sync：仅添加公众号，不触发逐号文章抓取（避免批量添加后再遇微信频控）
 *   - --out <file>：将筛选出的候选清单写入 JSON 文件供复核
 *   - --in <file>：从复核后的 JSON 候选文件直接导入（跳过重复搜索）
 */

import fs from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}
loadEnvLocal();

const BASE = (process.env.WEMP_BASE_URL || "").replace(/\/+$/, "");
const USER = process.env.WEMP_USERNAME || "admin";
const PASS = process.env.WEMP_PASSWORD || "";
const SAMPLE_ARTICLE = "https://mp.weixin.qq.com/s/gJkCV2GTZRWAZ24hPgABKA";

// ── Tier A：用户截图指定账号 & 校级职能/直属服务官方号 ──────────────
const TIER_A_ACCOUNTS = [
  // 用户截图中的账号
  { query: "华南农业大学校青志中心", tokens: ["青志"], group: "screenshot", tag: "志愿服务" },
  { query: "华南农业大学校友总会", tokens: ["校友"], group: "screenshot", tag: "校友动态" },
  { query: "华南农业大学心理中心", tokens: ["心理"], group: "screenshot", tag: "健康服务" },
  { query: "华南农业大学信息网络中心", tokens: ["信息网络", "网络中心"], group: "screenshot", tag: "校园信息化" },
  { query: "华南农业大学学生社团工作部", tokens: ["社团"], group: "screenshot", tag: "学生社团" },
  { query: "华南农业大学医院体检中心", tokens: ["体检", "医院"], group: "screenshot", tag: "校医院" },
  { query: "紫荆万晓生", tokens: ["紫荆万晓生"], group: "screenshot", tag: "第三方校园资讯" },

  // 校级机关部处与直属服务
  { query: "华南农业大学本科生院", tokens: ["本科生院", "本科教学"], group: "dept" },
  { query: "华南农业大学教务处", tokens: ["教务"], group: "dept" },
  { query: "华南农业大学研究生教育", tokens: ["研究生教育", "研究生院"], group: "dept" },
  { query: "华南农业大学研招办", tokens: ["研招"], group: "dept" },
  { query: "华南农业大学学生会", tokens: ["学生会"], group: "dept" },
  { query: "华南农业大学研究生会", tokens: ["研究生会"], group: "dept" },
  { query: "华南农业大学总务部", tokens: ["总务"], group: "dept" },
  { query: "华南农业大学后勤服务平台", tokens: ["后勤服务"], group: "dept" },
  { query: "平安华农", tokens: ["平安华农", "保卫"], group: "dept" },
  { query: "华农社区卫生服务中心", tokens: ["社区卫生", "校医院"], group: "dept" },
  { query: "华农国际交流", tokens: ["国际交流"], group: "dept" },
  { query: "华南农业大学创新创业学院", tokens: ["创新创业", "双创"], group: "dept" },
  { query: "华南农业大学财务处", tokens: ["财务"], group: "dept" },
  { query: "华南农业大学学生资助", tokens: ["资助"], group: "dept" },
  { query: "华南农业大学易班", tokens: ["易班"], group: "dept" },
  { query: "华南农业大学文博馆", tokens: ["文博"], group: "dept" },
  { query: "华南农业大学档案馆", tokens: ["档案"], group: "dept" },
  { query: "华南农业大学科学研究院", tokens: ["科学研究院", "科研院"], group: "dept" },
  { query: "华南农业大学区域国别研究院", tokens: ["区域国别"], group: "dept" },
  { query: "华南农业大学人力资源处", tokens: ["人力", "人事"], group: "dept" },
  { query: "华南农业大学测试中心", tokens: ["测试中心"], group: "dept" },
  { query: "华南农大继教", tokens: ["继教", "继续教育"], group: "dept" },
  { query: "华农青年", tokens: ["华农青年"], group: "dept" },
];

// ── Tier B：补齐全部未覆盖的二级学院官方号 ──────────────────────────
const TIER_B_COLLEGES = [
  {
    college: "资源环境学院",
    queries: ["华南农业大学资源环境学院", "SCAU资源环境学院", "SCAU资环", "华农资环"],
    tokens: ["资源环境", "资环"],
  },
  {
    college: "海洋学院",
    queries: ["华南农业大学海洋学院", "SCAU海洋学院", "华农海洋"],
    tokens: ["海洋"],
  },
  {
    college: "食品学院",
    queries: ["食力无限", "华南农业大学食品学院", "SCAU食品学院", "华农食品"],
    tokens: ["食力无限", "食品学院", "食品"],
  },
  {
    college: "水利与土木工程学院",
    queries: ["华南农业大学水利与土木工程学院", "SCAU水利与土木", "SCAU水利团委学生会", "SCAU水土"],
    tokens: ["水利", "土木", "水土"],
  },
  {
    college: "材料与化学工程学院",
    queries: ["SCAU材料与能源", "华南农业大学材料与化学工程学院", "SCAU材能", "华农材能"],
    tokens: ["材料", "材能", "化学工程"],
  },
  {
    college: "生物质学院",
    queries: ["华南农业大学生物质学院", "SCAU生物质学院", "华农生物质"],
    tokens: ["生物质"],
  },
  {
    college: "马克思主义学院",
    queries: ["华南农业大学马克思主义学院", "SCAU马克思主义学院", "华农马院"],
    tokens: ["马克思", "马院"],
  },
  {
    college: "公共管理学院",
    queries: ["华农公管", "华南农业大学公共管理学院", "SCAU公共管理"],
    tokens: ["公管", "公共管理"],
  },
  {
    college: "湾区设计与艺术学院",
    queries: ["华南农业大学湾区设计与艺术学院", "华南农业大学艺术学院", "SCAU艺术学院", "华农艺术青年"],
    tokens: ["湾区设计", "艺术学院", "艺术青年"],
  },
  {
    college: "体育学院",
    queries: ["华南农业大学体育学院", "SCAU体育学院", "华农体育"],
    tokens: ["体育"],
  },
  {
    college: "继续教育学院",
    queries: ["华南农大继教", "华南农业大学继续教育学院"],
    tokens: ["继教", "继续教育"],
  },
  {
    college: "国际教育学院",
    queries: ["华南农业大学国际教育学院", "SCAU国际教育学院", "华农国教"],
    tokens: ["国际教育", "国教"],
  },
  {
    college: "广州都柏林国际生命科学与技术学院",
    queries: ["华南农业大学广州都柏林", "SCAU都柏林", "华农都柏林", "都柏林国际生命科学"],
    tokens: ["都柏林"],
  },
];

// ── Tier C：宽泛分页深度挖掘官方/学院/团学号 ───────────────────────
const TIER_C_BROAD = [
  { query: "华南农业大学", offsets: [0, 10, 20, 30, 40] },
  { query: "SCAU", offsets: [0, 10, 20, 30] },
  { query: "华南农大", offsets: [0, 10] },
];

// ── Tier D：华农第三方校园信息发布公众号 ────────────────────────────
const TIER_D_THIRD_PARTY = [
  "紫荆万晓生",
  "华农小助手",
  "华农百晓生",
  "华农校园通",
  "华农微校园",
  "华农吃喝玩乐",
  "华农生活",
  "华农资讯",
  "华农微帮",
  "华农圈",
  "华农表白墙",
  "华农墙",
  "华农树洞",
  "华农失物招领",
  "华农兼职",
  "华农实习",
  "华农求职",
  "华农考研",
  "华农攻略",
  "五山宝",
  "iSCAU",
  "SCAU小助手",
  "紫荆校园",
  "华南农大校园",
  "华南农大表白墙",
];

// 硬排除：外校名称（含独立学院珠江学院/SCUT/清华/东农等）与纯商业广告/期刊/附属中小学/个人班级噪声
const OTHER_SCHOOL_RE =
  /华中农业大学|华中农大|hzau|狮子山|(?<![牛象])狮山|安徽农业|江西农业|福建农林|四川农业|山东农业|山西农业|河南农业|河北农业|湖南农业|东北农业|东农|neaudag|西北农林|青岛农业|新疆农业|甘肃农业|内蒙古农业|云南农业|南京农业|(?<![华湖河岭东西])南农|中国农业大学|北京农学院|仲恺|华南理工|SCUT\d*|华南师范|华师大|暨南大学|中山大学|珠江学院|华珠|hzjwc|清华大学|清华紫荆|婉西|解放路一小|佛山紫荆|中方县紫荆|紫荆学苑|紫荆商学|中国学生资助|jybzzzx|^易班$/i;

const NOISE_BIZ_RE =
  /保险|财险|人寿|电竞馆|网咖|足浴|美发|美容|牙科|口腔|房产|中介|驾校|酒业|白酒|烟酒|KTV|酒吧|按摩|足疗|整形|医美|宠物店|花店|蛋糕|奶茶|烧烤|火锅|麻辣烫|餐饮管理|商贸|有限公司|水电维修|空调维修|建材|装饰|汽修|学报|期刊|出版社|附属小学|幼儿园|运营趴|kimce|ISCAU\d+|SCAU\d+|GIS\d|EIS\s?\d?班|EIST\d|IMIS\d|20级小帮手|中新实习生|Mantis|小分队/i;

const EXPLICIT_SCAU_RE =
  /华南农业大学|华南农大|SCAU|紫荆华农|紫荆万晓生|食力无限|五山宝|平安华农|华农公管|华农国际交流|华农社区卫生服务中心|iSCAU|华农海洋学院|华农大体育|华农学工|华农勤工|华农党建|华农表演/i;

const CAMPUS_FEATURE_RE =
  /华南农业|SCAU|五山|紫荆|校园|学生|同学|校内|教务|课表|活动|通知|兼职|实习|求职|失物|表白|树洞|攻略|二手|考研|资讯|生活|百晓生|万晓生|小助手|团委|学生会|青年|研究生|校友|后勤|保卫|医院|体检|社团|青志|心理|网络/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isFreqOrAuthStop(msg) {
  return /200013|freq|频|cookie|expired|过期|登录|qr/i.test(String(msg || ""));
}

function fakeIdToMpWxs(fakeid) {
  try {
    const dec = Buffer.from(String(fakeid), "base64").toString("utf8").trim();
    if (/^\d+$/.test(dec)) return `MP_WXS_${dec}`;
  } catch {
    /* ignore */
  }
  return "";
}

function isRejected(c) {
  const hay = `${c.nickname || ""} ${c.alias || ""} ${c.signature || ""}`;
  return (
    OTHER_SCHOOL_RE.test(hay) ||
    NOISE_BIZ_RE.test(hay) ||
    /^易班$/.test((c.nickname || "").trim())
  );
}

function isValidScauCandidate(c, tier, kw = "") {
  const nick = (c.nickname || "").trim();
  if (!nick || isRejected(c)) return false;

  const sig = (c.signature || "").trim();
  const alias = (c.alias || "").trim();
  const allText = `${nick} ${alias} ${sig}`;

  // Tier A / B / C 优先检验显式华农归属
  if (tier === "A" || tier === "B" || tier === "C") {
    if (EXPLICIT_SCAU_RE.test(nick) || EXPLICIT_SCAU_RE.test(alias)) {
      return true;
    }
    // 允许昵称含“华农/紫荆”且签名明确提及华南农业/SCAU
    if (/华农|紫荆/.test(nick) && /华南农业|华南农大|SCAU/i.test(sig)) {
      return true;
    }
    return false;
  }

  // Tier D（第三方校园信息号）更严格：防外校“紫荆”误入，要求必须显式包含华农/SCAU信息
  if (!CAMPUS_FEATURE_RE.test(allText)) return false;
  const hasScauIdentity =
    /华南农|SCAU|华农|华小农|iSCAU|五山宝|紫荆华农|紫荆万晓生|紫荆校园菌|紫荆白板|紫荆法援/i.test(nick) ||
    /华南农业大学|华南农大|SCAU|五山校区|华农学子|华农er|华农校园/i.test(sig);
  if (!hasScauIdentity) return false;

  // 若 signature 为空，仅保留精确命中检索词或显式含华南农业大学/SCAU/典型华农校园第三方号名
  if (!sig) {
    return (
      nick === kw ||
      /华南农业|华南农大|SCAU|紫荆万晓生|五山宝|iSCAU|^(?:华农|华小农|紫荆).{0,8}(?:小助手|百晓生|万晓生|校园通|微校园|表白墙|树洞|失物招领|微帮|攻略|考研|求职|兼职|生活|资讯|圈)/i.test(
        nick,
      )
    );
  }
  return true;
}

function pickBestUnitMatch(candidates, kw, tokens = []) {
  const clean = candidates.filter((c) => !isRejected(c) && isValidScauCandidate(c, "A", kw));
  const matchesToken = (c) => {
    const nick = (c.nickname || "").trim();
    if (!nick) return false;
    // 查询具体部门或学院时，避免误匹配通用校主号“华南农业大学”
    if (kw !== "华南农业大学" && nick === "华南农业大学") return false;
    if (tokens.length === 0) return nick === kw || nick.includes(kw);
    return tokens.some((t) => nick.toLowerCase().includes(t.toLowerCase()));
  };

  const matched = clean.filter(matchesToken);
  if (matched.length === 0) return null;

  return (
    matched.find((c) => c.nickname === kw) ||
    matched.find((c) => /华南农业大学|华南农大|SCAU/i.test(c.nickname)) ||
    matched[0]
  );
}

async function login() {
  const form = new URLSearchParams({ username: USER, password: PASS });
  const r = await fetch(`${BASE}/api/v1/wx/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const j = await r.json();
  if (!j?.data?.access_token) throw new Error("登录失败：" + JSON.stringify(j));
  return j.data.access_token;
}

async function api(token, p, opts = {}) {
  const r = await fetch(`${BASE}${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  const txt = await r.text();
  let j;
  try {
    j = JSON.parse(txt);
  } catch {
    throw new Error(`HTTP ${r.status}: ${txt.slice(0, 160)}`);
  }
  return { status: r.status, json: j };
}

async function listAllMps(token) {
  const all = [];
  const pageSize = 50;
  for (let offset = 0; offset < 500; offset += pageSize) {
    const res = await api(token, `/api/v1/wx/mps?limit=${pageSize}&offset=${offset}`);
    const list = res.json?.data?.list || [];
    all.push(...list);
    if (list.length < pageSize) break;
  }
  return all;
}

function parseCliArgs(argv) {
  const discover = argv.includes("--discover");
  const apply = argv.includes("--apply") || !discover;
  const skipSync = argv.includes("--skip-sync") || discover;
  const val = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : "";
  };
  return {
    discover,
    apply,
    skipSync,
    outFile: val("--out"),
    inFile: val("--in"),
  };
}

async function main() {
  if (!BASE || !PASS) {
    throw new Error("请先在 .env.local 配置 WEMP_BASE_URL 与 WEMP_PASSWORD");
  }
  const opts = parseCliArgs(process.argv.slice(2));
  const token = await login();
  console.log(`已登录 we-mp-rss (${BASE}) | 模式: ${opts.discover ? "discover(只读筛选)" : "apply(筛选并接入)"}`);

  const qr = await api(token, "/api/v1/wx/auth/qr/status");
  console.log("微信授权状态:", JSON.stringify(qr.json));

  const existing = await listAllMps(token);
  const existingNames = new Set(existing.map((m) => String(m.mp_name || "").trim()));
  const existingIds = new Set();
  for (const m of existing) {
    if (m.id) existingIds.add(String(m.id).trim());
    if (m.faker_id) {
      existingIds.add(String(m.faker_id).trim());
      const wxs = fakeIdToMpWxs(m.faker_id);
      if (wxs) existingIds.add(wxs);
    }
  }
  console.log(`当前已订阅公众号数: ${existing.length}`);

  const isAlreadySubscribed = (fakeid, nickname) => {
    if (nickname && existingNames.has(nickname)) return true;
    if (!fakeid) return false;
    if (existingIds.has(fakeid)) return true;
    const wxs = fakeIdToMpWxs(fakeid);
    return Boolean(wxs && existingIds.has(wxs));
  };

  let candidatesToApply = [];
  let stoppedEarly = false;

  if (opts.inFile) {
    const raw = JSON.parse(fs.readFileSync(opts.inFile, "utf8"));
    const list = Array.isArray(raw) ? raw : raw.candidates || [];
    candidatesToApply = list.filter((c) => !isAlreadySubscribed(c.fakeid, c.nickname));
    console.log(`\n从文件读取候选 ${list.length} 条，过滤已订阅后待添加 ${candidatesToApply.length} 条`);
  } else {
    // 仅在 apply 模式下确保参考文章所属号已接入
    if (opts.apply && !opts.discover) {
      console.log(`\n[0] 校验参考文章所属公众号: ${SAMPLE_ARTICLE}`);
      const byArt = await api(
        token,
        `/api/v1/wx/mps/by_article?url=${encodeURIComponent(SAMPLE_ARTICLE)}`,
        { method: "POST" },
      );
      const mpObj = byArt.json?.data?.mp_info || byArt.json?.data || {};
      const artMpName = String(mpObj.mp_name || mpObj.nickname || mpObj.name || "").trim();
      const artMpId = String(mpObj.biz || mpObj.fakeid || mpObj.mp_id || "").trim();
      const artCover = String(mpObj.logo || mpObj.mp_cover || mpObj.round_head_img || "").trim();
      if (artMpName && !isAlreadySubscribed(artMpId, artMpName)) {
        const addRes = await api(token, "/api/v1/wx/mps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mp_name: artMpName,
            ...(artMpId ? { mp_id: artMpId } : {}),
            ...(artCover ? { mp_cover: artCover, avatar: artCover } : {}),
          }),
        });
        if (addRes.json?.code === 0) {
          existingNames.add(artMpName);
          if (artMpId) existingIds.add(artMpId);
        }
      }
    }

    const discoveredMap = new Map();
    const recordCandidate = (c, tier, sourceTag) => {
      if (!c?.fakeid || !c?.nickname) return;
      if (isAlreadySubscribed(c.fakeid, c.nickname)) return;
      if (discoveredMap.has(c.fakeid)) return;
      discoveredMap.set(c.fakeid, {
        tier,
        sourceTag,
        fakeid: c.fakeid,
        nickname: c.nickname.trim(),
        alias: c.alias || "",
        round_head_img: c.round_head_img || "",
        signature: (c.signature || "").trim(),
      });
    };

    const runSearch = async (kw, offset = 0) => {
      await sleep(1500);
      const sr = await api(
        token,
        `/api/v1/wx/mps/search/${encodeURIComponent(kw)}?limit=10&offset=${offset}`,
      );
      const msg = sr.json?.message || sr.json?.detail || "";
      if (sr.status >= 400 || (sr.json?.code && sr.json.code !== 0)) {
        console.log(`  ! 搜索「${kw}」(offset=${offset})受限: ${msg}`);
        if (isFreqOrAuthStop(msg)) {
          stoppedEarly = true;
        }
        return null;
      }
      return sr.json?.data?.list || [];
    };

    // 检查某个部门/学院是否已在现有列表或已发现列表中命中
    const alreadyCoveredByTokens = (tokens) => {
      if (!tokens?.length) return false;
      for (const name of existingNames) {
        if (name !== "华南农业大学" && tokens.some((t) => name.includes(t))) return true;
      }
      for (const item of discoveredMap.values()) {
        if (tokens.some((t) => item.nickname.includes(t))) return true;
      }
      return false;
    };

    // 先跑 Tier C（大面扫描 "华南农业大学" 与 "SCAU"），可一网打尽大量官方号，大幅减少后续单独查询次数
    console.log("\n[1/4] Tier C 宽泛分页挖掘（华南农业大学 / SCAU / 华南农大）...");
    for (const item of TIER_C_BROAD) {
      if (stoppedEarly) break;
      for (const offset of item.offsets) {
        if (stoppedEarly) break;
        const list = await runSearch(item.query, offset);
        if (!list) break;
        for (const c of list) {
          if (isValidScauCandidate(c, "C", item.query)) {
            recordCandidate(c, "C", `broad:${item.query}@${offset}`);
          }
        }
        console.log(
          `  · "${item.query}" offset=${offset} → 返回 ${list.length} 条，累计待接入 ${discoveredMap.size}`,
        );
        if (list.length < 10) break;
      }
    }

    // Tier A：截图指定号 + 尚未命中的校级部门/服务号
    console.log("\n[2/4] Tier A 补全用户截图指定号与校级部门/服务号...");
    for (const target of TIER_A_ACCOUNTS) {
      if (stoppedEarly) break;
      if (existingNames.has(target.query) || (target.group === "dept" && alreadyCoveredByTokens(target.tokens))) {
        console.log(`  - 已覆盖跳过: ${target.query}`);
        continue;
      }
      const list = await runSearch(target.query, 0);
      if (!list) break;
      const pick = pickBestUnitMatch(list, target.query, target.tokens);
      if (pick) {
        recordCandidate(pick, "A", target.group === "screenshot" ? "screenshot" : `dept:${target.query}`);
        console.log(`  + 命中: ${pick.nickname} [${pick.alias || pick.fakeid}]`);
      } else {
        console.log(
          `  - 未精准命中: ${target.query} (候选: ${list.slice(0, 3).map((x) => x.nickname).join(", ")})`,
        );
      }
    }

    // Tier B：补齐未覆盖的 13 个二级学院
    console.log("\n[3/4] Tier B 补齐未覆盖二级学院官方/团学号...");
    for (const col of TIER_B_COLLEGES) {
      if (stoppedEarly) break;
      if (alreadyCoveredByTokens(col.tokens)) {
        console.log(`  - 学院已覆盖跳过: ${col.college}`);
        continue;
      }
      let matchedCol = null;
      for (const q of col.queries) {
        if (stoppedEarly) break;
        const list = await runSearch(q, 0);
        if (!list) break;
        const pick = pickBestUnitMatch(list, q, col.tokens);
        if (pick) {
          matchedCol = pick;
          recordCandidate(pick, "B", `college:${col.college}`);
          console.log(`  + 学院命中 [${col.college}]: ${pick.nickname} (${pick.fakeid})`);
          break;
        }
      }
      if (!matchedCol && !stoppedEarly) {
        console.log(`  ! 学院未搜索到官方/团学号: ${col.college}`);
      }
    }

    // Tier D：第三方校园信息发布号
    console.log("\n[4/4] Tier D 挖掘华农第三方校园资讯/生活/求职公众号...");
    for (const kw of TIER_D_THIRD_PARTY) {
      if (stoppedEarly) break;
      if (existingNames.has(kw) || [...discoveredMap.values()].some((d) => d.nickname === kw)) {
        console.log(`  - 已存在或已收录跳过: ${kw}`);
        continue;
      }
      const list = await runSearch(kw, 0);
      if (!list) break;
      const valid = list.filter((c) => isValidScauCandidate(c, "D", kw));
      for (const c of valid) {
        recordCandidate(c, "D", `3p:${kw}`);
      }
      if (valid.length > 0) {
        console.log(
          `  + 第三方「${kw}」命中 ${valid.length} 个: ${valid.map((v) => v.nickname).join("、")}`,
        );
      } else {
        console.log(
          `  - 第三方「${kw}」无符合条件账号 (原始: ${list.slice(0, 3).map((x) => x.nickname).join(", ")})`,
        );
      }
    }

    candidatesToApply = [...discoveredMap.values()];
    console.log(`\n=== 筛选去重完毕：共发现 ${candidatesToApply.length} 个待接入华农公众号 ===`);
    for (const c of candidatesToApply) {
      console.log(
        `  [${c.tier}|${c.sourceTag}] ${c.nickname}${c.alias ? ` (${c.alias})` : ""} | ${c.fakeid} | ${(c.signature || "").slice(0, 50)}`,
      );
    }

    if (opts.outFile) {
      fs.mkdirSync(path.dirname(path.resolve(opts.outFile)), { recursive: true });
      fs.writeFileSync(
        opts.outFile,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            existingCount: existing.length,
            stoppedEarly,
            candidates: candidatesToApply,
          },
          null,
          2,
        ),
        "utf8",
      );
      console.log(`候选清单已导出至: ${opts.outFile}`);
    }
  }

  if (opts.discover) {
    console.log("\n--discover 模式完成，未执行写入操作。");
    return;
  }

  // 批量加入 we-mp-rss
  console.log(`\n开始批量加入 ${candidatesToApply.length} 个公众号到 we-mp-rss...`);
  let addedCount = 0;
  for (const c of candidatesToApply) {
    if (isAlreadySubscribed(c.fakeid, c.nickname)) continue;
    await sleep(500);
    const addR = await api(token, "/api/v1/wx/mps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mp_name: c.nickname,
        mp_id: c.fakeid,
        mp_cover: c.round_head_img || "",
        avatar: c.round_head_img || "",
        mp_intro: (c.signature || "").slice(0, 250),
      }),
    });
    if (addR.json?.code === 0) {
      addedCount++;
      existingNames.add(c.nickname);
      existingIds.add(c.fakeid);
      console.log(`  + [${addedCount}] 已接入: ${c.nickname} (${c.fakeid})`);
    } else {
      const errMsg = JSON.stringify(addR.json).slice(0, 200);
      console.log(`  ! 添加「${c.nickname}」返回: ${errMsg}`);
      if (isFreqOrAuthStop(errMsg)) {
        stoppedEarly = true;
        break;
      }
    }
  }

  const allMps = await listAllMps(token);
  console.log(`\n最终统计：本次新增 ${addedCount} 个，we-mp-rss 当前累计订阅 ${allMps.length} 个公众号。`);

  if (!opts.skipSync && !stoppedEarly) {
    console.log("\n开始触发文章列表同步...");
    for (const mp of allMps) {
      await sleep(2000);
      const up = await api(
        token,
        `/api/v1/wx/mps/update/${encodeURIComponent(mp.id)}?start_page=0&end_page=1`,
      );
      const msg = up.json?.message || up.json?.detail || "";
      console.log(`  ↻ ${mp.mp_name} (${mp.id}): ${JSON.stringify(up.json).slice(0, 180)}`);
      if (isFreqOrAuthStop(msg)) {
        console.log("  ! 触发微信接口限制/等待授权，停止继续批量刷新。");
        break;
      }
    }
  }
}

main().catch((e) => {
  console.error("执行失败：", e);
  process.exit(1);
});
