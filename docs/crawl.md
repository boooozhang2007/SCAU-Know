# 抓取系统

## 架构

```
sources.ts     源注册表（51 个，按模板分组）
   ↓
parse.ts       多模板解析器（列表 → 条目；文章页 → 正文）
   ↓
engine.ts      抓取引擎（并发限速、增量去重、分类推断）
   ↓
wechat.ts      微信公众号适配（rss / mp / manual 三种接入）
   ↓
runner.ts      调度（站点 + 微信 → 合并入库）
   ↓
store.ts       文件持久化（data/）
   ↓
data.ts        前端数据层（抓取结果优先，空则回退演示语料）
```

## 已接入的源

共 51 个，覆盖华南农业大学全部二级单位：

- 教学单位 26 个（农学院、植保、林风、园艺、兽医、动科、资环、海洋、生科、工程、食品、水利土木、数信、人工智能与低空、材化、生物质、马院、经管、公管、人文法学、外语、湾区设计艺术、体育、继教、国教、都柏林）
- 机关部处 15 个（本科生院、研究生院、人力资源处、科研院、团委、国际交流处、后勤、校医院、信息公开、乡村振兴、对外联络、信息网络中心、发展规划处、采购招标、招生办）
- 教辅与服务 8 个（图书馆、测试中心、基础实验中心、文博馆、科教基地、研究生招生、校友会、华农人物网）
- 媒体门户 1 个（学校主站）

其中 50 个已启用。采购招标中心为纯 JS 单页应用，HTML 内无列表内容，已停用并在状态页标注。

## 三套站点模板

华农各站虽同属 WebPlus CMS，但列表区结构差异很大，解析器按三种策略依次尝试：

`webplus` 文章链接形态 `/2026/1120/c1234a567890/page.htm`，列表项可能在 `<li>`、`<div>` 或 `<tr>` 中，日期可能在 `<a>` 内、同级 `<span>` 里，或被拆成 `<p>12</p><span>2026-11</span>` 两段。解析器按「取文章链接所在容器块 → 块内找日期与标题」统一处理，并优先采用 `title` 属性（列表区常把标题截断显示）。

`listing` 用于图书馆等表格型列表，与 webplus 同构但容器更自由。

`module` 用于就业创业信息网（第三方招聘系统），链接形态 `/detail/news?id=1234`，单独解析。

## 自动抓取

命令行：

```bash
node scripts/crawl.mjs                  # 全量（含正文）
node scripts/crawl.mjs --no-detail      # 只抓列表，约 4 秒跑完 51 个源
node scripts/crawl.mjs --only nxy,zb    # 指定源
node scripts/crawl.mjs --limit 10       # 每站条数
node scripts/crawl.mjs --list           # 列出全部源
```

HTTP 接口：

```bash
curl -X POST http://localhost:3210/api/crawl \
  -H 'Content-Type: application/json' \
  -d '{"limitPerSource":15,"fetchDetail":true}'
```

定时任务（每 2 小时）：

```cron
0 */2 * * * cd /srv/bauhinia-know && node scripts/crawl.mjs >> logs/crawl.log 2>&1
```

生产环境应设置 `CRAWL_SECRET` 环境变量，接口会校验 `Authorization: Bearer <secret>`。

## 微信公众号

微信没有公开的公众号文章列表接口，因此不采用脆弱爬取，而是提供三条可插拔路径，由 `WECHAT_MODE` 选择：

`manual`（默认）手工导入，把记录放进 `data/inbox/` 由导入器归一化。适合无技术条件的账号。

`rss` 通过第三方 RSS 服务（WeRSS / feeddd）把公众号转成 RSS。在 `wechat.ts` 的 `WECHAT_ACCOUNTS` 里给账号填 `rss` 字段，或设置环境变量 `WECHAT_RSS_<ID>`。

`mp` 自建抓取服务，持有公众号后台的 `__biz` 与 `pass_ticket`，调用 `mp.weixin.qq.com/mp/profile_ext` 分页拉取。凭据会过期，属于运行期配置，不写入仓库。

已按学校官方公布的账号清单预置 35 个公众号条目（各学院、职能部门、紫荆华农等），接入时只需补 `rss` 或 `biz` 字段。

## 增量与去重

- 以 URL 规范化后作为唯一键，同 URL 保留发布时间更新的一条
- `data/state.json` 记录已见 URL 与各源最近成功时间
- 抓取失败按源隔离，单个源异常不影响整体，错误写入报告

## 数据文件

```
data/notices.json     归一化后的全部条目
data/state.json       增量游标与最近运行摘要
data/reports/*.json   每次抓取报告（保留最近 30 份）
```

可通过 `BAUHINIA_DATA_DIR` 改变数据目录。

## 分类推断

抓到的条目先按来源默认分类，再按标题关键词细化，规则见 `engine.ts` 的 `CATEGORY_RULES`（招聘、奖学金、讲座、文体、就业、留学、学业、科研、生活、社团、服务、校园）。标题命中第一条规则即采用，未命中则回退来源默认分类。

## 新增一个源

在 `sources.ts` 的 `CRAWL_SOURCES` 追加一条即可，无需改动解析逻辑：

```ts
{
  id: "xxx",
  name: "华南农业大学某某学院",
  kind: "college",
  template: "webplus",
  base: "https://xxx.scau.edu.cn/",
  category: "departments",
  alias: ["某某学院"],
}
```

若首页解析不出条目，指定 `listUrl` 指向其通知栏目。
