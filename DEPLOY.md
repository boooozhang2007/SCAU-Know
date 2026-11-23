# 「华农知道」SCAU Know — 方案 B 动静分离部署指南

本架构将 **后台采集与管理** 与 **公网访问** 物理隔离：

- **公网展示站（`./out/`）**：纯静态 HTML + WebP 缩略图 + 分片详情 JSON，构建时自动剔除 `/admin`、`/sources`、`/api/*` 与原始大图，可零服务器托管在 Cloudflare Pages、Vercel 或对象存储 CDN，访客无法访问任何采集后台与配置接口。
- **私有采集/后台端（本地电脑或私有 VPS `127.0.0.1:3211`）**：负责定时抓取 48 个校内站点 + `we-mp-rss` 公众号、AI 解析、个人关键词推送，并按需生成静态构建推送至公网 CDN。

---

## 一、首次环境准备

1. 在本地私有端 `.env.local` 配置管理员密钥与公众号/AI 参数（切勿提交至 Git）：
   ```env
   ADMIN_SECRET=你的强随机管理员密码
   WECHAT_MODE=wemp
   WEMP_BASE_URL=https://你的-wemp-rss域名
   WEMP_USERNAME=admin
   WEMP_PASSWORD=你的密码
   ```
2. 本地启动动态后台（仅监听本机回环地址，外网无法直连）：
   ```bash
   pnpm build
   pnpm exec next start -H 127.0.0.1 -p 3211
   ```
   浏览器打开 <http://127.0.0.1:3211/admin> 管理公众号、AI 模型、定时抓取周期与监控规则。

---

## 二、一键构建纯静态公网产物 `./out/`

```bash
pnpm build:static
```

构建脚本 [scripts/build-static.mjs](scripts/build-static.mjs) 会自动完成：
1. 生成极简列表 `public/static-data/notices-summary.json`、`search-index.json`、`manifest.json`（已置空内部采集报告 `lastReport`）与按条拆分的 `public/static-data/details/<id>.json`；首页及分类页首屏仅内嵌首批卡片切片，其余板块在滚动或检索时懒加载。
2. 仅提取通知实际引用的图片并生成 `w480` / `w1200` WebP 缩略图至 `/media/thumbs/`，剔除原始大图目录，单文件体积与总体积远低于 Cloudflare Pages 25 MB / 平台限额。
3. 物理剔除 `src/app/admin`、`src/app/sources`、`src/app/api` 与 `data/attachments`。
4. 保留完整交互能力（首页瀑布流、分类页、活动日历 `?category=`、关键词搜索 `?q=`、来源筛选 `?source=`、通知深链 `?notice=<id>` 与跨标签自动刷新）。

---

## 三、上传 `./out/` 到公网平台（任选其一）

### 方式 1：Cloudflare Pages（推荐，免备案全球 CDN + 原生识别 `_headers`）

```bash
# 安装并登录 Wrangler（仅首次）
pnpm add -g wrangler
wrangler login

# 创建或直接推送到 Cloudflare Pages 项目（例：scau-know）
wrangler pages deploy out --project-name=scau-know
```

`public/_headers` 已自动复制进 `out/_headers`，`/media/thumbs/*` 与 `/_next/static/*` 会生效 1 年强缓存，`/static-data/manifest.json` 与 `notices-summary.json` 会即时更新。

### 方式 2：Vercel（内置 `vercel.json` 适配，需自定义域名）

```bash
pnpm add -g vercel
vercel deploy out --prod
```

仓库已包含 `vercel.json`（可直接连接 GitHub 仓库自动执行 `pnpm build:static` 并设置强缓存头）；注意由于 `*.vercel.app` 在中国大陆不可达，公开服务务必在 Vercel 绑定自定义域名。

### 方式 3：阿里云 OSS / 腾讯云 COS（国内极速访问）

将 `./out/` 全量上传至开启了「静态网站托管」的 Bucket 根目录（默认首页 `index.html`，404 页面可指回 `404.html`），并给 Bucket 绑定自定义域名与 CDN HTTPS。

---

## 四、自动定时更新公网静态站

本地跑着定时抓取后，可用 Windows 任务计划程序或 Linux Crontab 定期构建并推送 `./out/`：

### Windows PowerShell（任务计划程序每 30~60 分钟运行）

```powershell
Set-Location D:\Projects\华农知道\scau-know
pnpm crawl
pnpm build:static
wrangler pages deploy out --project-name=scau-know
```

### Linux / macOS Crontab（每小时 5 分执行）

```cron
5 * * * * cd /opt/scau-know && pnpm crawl && pnpm build:static && wrangler pages deploy out --project-name=scau-know >> /var/log/scau-know-deploy.log 2>&1
```

如果使用 GitHub Actions 构建部署，也可在 `/admin` 触发「导出静态快照」或配置 `CF_PAGES_DEPLOY_HOOK` / `VERCEL_DEPLOY_HOOK` 环境变量自动拉起远端重建。

---

## 三、定时流水线（采集 → 构建 → 增量发布）

生产端把这个仓库放在一台能访问校内站点的机器上，用 systemd timer 每半小时跑一次 `pipeline.sh`：

```
pipeline.sh
├─ run-full.mts                    抓取 48 个校内站 + we-mp-rss 公众号
├─ scripts/ingest-remote-attachments.mjs   解析「只有 IPv6 能到」的站点由外部出口机代取回来的附件（零网络）
├─ scripts/build-static.mjs        产出 out/（HTML + WebP 缩略图 + 分片 details JSON）
├─ r2_deploy.py                    按 md5 增量把 out/ 同步到 S3 兼容对象存储（默认 Cloudflare R2）
└─ ${CF_PURGE_SCRIPT}              清一次页面缓存，让新内容立即生效
```

数据没变化（`data/notices.json` md5 相同）时只跑抓取就退出，不重建、不上传。

全部路径都可用环境变量覆盖，默认值只假设「脚本放在项目根目录」，见 `.env.example` 的「静态发布」段：

| 变量 | 作用 |
| --- | --- |
| `APP_DIR` | 项目目录（默认脚本所在目录） |
| `NODE_BIN_DIR` | node/tsx 所在 bin 目录 |
| `PIPELINE_LOG` | 流水线日志，默认 `$APP_DIR/data/pipeline.log` |
| `R2_BUCKET` / `R2_OUT` / `R2_CRED` / `R2_STATE` | 目标桶与增量状态；凭据 `{endpoint,access_key,secret_key[,bucket]}` |
| `CF_PURGE_SCRIPT` | 部署后清 Cloudflare 缓存的脚本，留空则跳过 |
| `FRP_DEPLOY=1` + `FRP_DEPLOY_SCRIPT` | 额外同步一份回滚副本 |
| `PAGES_DEPLOY=1` + `PAGES_PROJECT` | 兜底部署到 Cloudflare Pages |

### 对象存储的两个坑

1. **自定义域没有 index 文档**：每个含 `index.html` 的目录要额外放一条 key 为 `<dir>/` 的对象（`Content-Type` 显式 `text/html`）；根路径 `/` 用一条边缘重写规则补成 `/index.html`。
2. **无尾斜杠的路径会 404**：`trailingSlash: true` 的产物只有 `calendar/`，访问 `/calendar` 要在边缘把路径补成 `calendar/`（Transform Rule 里必须写 `expression` 动态拼路径，写死 `value` 会报错）。

缓存头：`_next/static/*` 与 `media/*` 一年 immutable，其余页面 `max-age=60, s-maxage=900, stale-while-revalidate=86400`（由 `r2_deploy.py` 写入，`public/_headers` 同步配置边缘规则）。

### 附件抓取

部分校内附件站（如 `webplus.scau.edu.cn`）只走 IPv6，机房直连必然超时。做法是让 `attachment` 抓取直接失败并把 URL 落到 `data/attachment-remote.json`，由一台有 IPv6 的出口机代取后回传，本地只做解析写回，不在生产机上跑任何隧道/代理。
