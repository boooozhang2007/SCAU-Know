# 「华农知道」监控服务与动静分离部署指南

本架构采用 **后台采集/AI/提醒常驻服务器 + 前台纯静态页面 CDN 分发** 模式：
- **你的服务器**：运行 `we-mp-rss`、定时抓站与附件解析引擎、AI 结构化抽取、Excel/关键词提醒推送，以及 `/admin` 管理后台。
- **Cloudflare Pages / Vercel / CDN**：托管 `pnpm build:static` 编译出的纯静态站点 `out/`（含所有页面、`public/static-data/*.json` 与转存图片 `public/media/`），零服务器并发压力。

---

## 1. 环境变量配置

复制 `.env.example` 为 `.env.local` 并填入实际凭据（`.gitignore` 已忽略 `.env*.local`）：

```env
WECHAT_MODE=wemp
WEMP_BASE_URL=https://your-wemp-domain
WEMP_USERNAME=admin
WEMP_PASSWORD=你的密码

# 建议公网部署时设置以下鉴权令牌
ADMIN_SECRET=你的后台管理密钥
CRAWL_SECRET=你的抓取密钥
WECHAT_WEBHOOK_SECRET=你的Webhook校验密钥

# 可选：接入 OpenAI 兼容大模型（DeepSeek / Qwen / OpenAI 等）
AI_API_BASE=https://api.deepseek.com/v1
AI_API_KEY=sk-xxxx
AI_MODEL=deepseek-chat

# 可选：抓取到新通知后自动导出静态快照并触发 CDN 重构建
AUTO_EXPORT_STATIC=true
CF_PAGES_DEPLOY_HOOK=https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/xxxx
# 或 VERCEL_DEPLOY_HOOK=https://api.vercel.com/v1/integrations/deploy/xxxx
# 或 GITHUB_REPO=你的用户名/scau-know 与 GITHUB_TOKEN=ghp_xxxx
```

---

## 2. 公众号接入（`we-mp-rss`）

1. 在 `we-mp-rss` 后台完成一次微信公众平台扫码登录（约 80 小时有效）。
2. 初始化一键接入华农核心公众号（或从文章链接识别）：
   ```bash
   pnpm setup:wemp
   ```
3. 也可以随时打开站点 `/admin` → **「公众号接入（we-mp-rss）」**：
   - 粘贴任意微信公众号文章链接自动识别并订阅；
   - 按关键词搜索并添加学院/社团公众号；
   - 配置 `we-mp-rss` MessageTasks 指向 `https://你的后端域名/api/wechat/webhook?secret=你的Webhook密钥`，实现新推文秒级入库并触发个人提醒。

---

## 3. 定时抓取 + AI 解析 + 前端自动同步

系统内置三种定时调度方式（均统一读写 `data/schedule.json` 配置与运行历史）：

1. **Web 服务内置自启动调度（推荐，零额外进程）**：
   启动 `pnpm start`（或 `next dev`）时，`src/instrumentation.ts` 会自动拉起内置定时调度器（默认每 **30 分钟**抓一次华农官网 + `we-mp-rss` 公众号，并在有新通知时自动导出静态快照）；打开 `/admin` → **「采集、AI 解析与静态发布」** 可随时热修改抓取间隔、每源条数与前端自动同步周期（默认每 **60 秒**无感检测刷新）。
2. **独立守护进程（适用于纯静态站前后端完全分离部署）**：
   ```bash
   pnpm daemon
   ```
   可使用 PM2 / systemd / Windows 任务计划后台常驻运行，仅负责定时采集、解析与触发静态重部署。
3. **系统 Crontab / 定时命令行**：
   ```cron
   */30 * * * * cd /srv/scau-know && pnpm crawl --limit 15 >> logs/crawl.log 2>&1
   ```

抓取流程自动串联：
1. **多源抓取与防盗链转存**：抓华农二级单位网站与 `we-mp-rss` 公众号推文，封面图与正文图片自动下载保存为原分辨率文件，防止外链失效。
2. **附件下载与内容解析**：自动下载 `.xlsx`/`.xls`/`.csv`/`.docx`/`.pdf` 至 `data/attachments/`，解析 Excel 全部工作表与文档全文。
3. **AI 结构化抽取**：调用大模型（未配置密钥时自动降级为确定性规则引擎）产出干净标题、摘要、学科分类、活动时间地点、受众、重要度与推送建议。
4. **个人监控与占位符提醒**：在 `/admin` 创建监控规则（支持精确关键词/学号/姓名扫描 Excel 每一行 + 可选 AI 语义补充），通过占位符模板自定义通知格式并推送到 **WxPusher / PushPlus / Server酱 / Bark / 飞书 / 钉钉 / 邮件 / Webhook**。

---

## 4. 静态编译与 CDN 分发

当需要发布或更新静态站时，本地或 CI 运行：

```bash
pnpm build:static
```

脚本会自动导出 `public/static-data/`，并在隔离临时目录 `.static-build/` 剥离 `/api` 与 `/admin` 后输出纯静态产物到 `./out/`。

- **GitHub Actions 自动部署**：`.github/workflows/deploy-static.yml` 已配置好 `repository_dispatch (crawl-updated)`，只需在 GitHub 仓库 Secrets 中配置 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`，服务器每次抓到新通知即可自动触发云端编译部署到 Cloudflare Pages 全球 CDN。
- **如果只把新通知写到 CDN 不想频繁整站重编译**：可直接定期把 `public/static-data/` 和 `public/media/` 同步到 Cloudflare R2 / OSS（已配置 `MEDIA_CDN_BASE` 时前端资源直走对象存储 CDN）。
