import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Database, MessageCircle } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { loadNoticeSummaries } from "@/lib/data";
import {
  CRAWL_SOURCES,
  SOURCE_BY_ID,
  enabledSources,
  sourcesByKind,
} from "@/lib/crawl/sources";
import {
  STANDALONE_WECHAT_ACCOUNTS,
  WECHAT_ACCOUNTS,
  WECHAT_BY_SOURCE_ID,
  wechatGroupOf,
  type WechatAccount,
} from "@/lib/crawl/wechat-accounts";
import { readState } from "@/lib/crawl/store";
import { getWempConfig, wechatMode, wempListMps, type WempMp } from "@/lib/crawl/wechat";
import { isWechatNotice, shortSourceName } from "@/lib/sources";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "采集状态｜「华农知道」SCAU Know",
  description: "查看华南农业大学各二级单位官网与微信公众号采集源状态、覆盖范围与最近运行结果。",
};

const KIND_LABEL: Record<string, string> = {
  college: "教学单位",
  department: "机关部处",
  service: "教辅与服务",
  media: "媒体与门户",
};

const TEMPLATE_LABEL: Record<string, string> = {
  webplus: "WebPlus 主站",
  listing: "列表型栏目",
  module: "招聘系统",
};

async function tryListWempMps(): Promise<WempMp[]> {
  if (!getWempConfig()) return [];
  try {
    return await Promise.race([
      wempListMps(),
      new Promise<WempMp[]>((resolve) => setTimeout(() => resolve([]), 3000)),
    ]);
  } catch {
    return [];
  }
}

export default async function SourcesPage() {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const [{ notices, fromCrawl, crawledCount }, state, liveMps] = await Promise.all([
    loadNoticeSummaries(nowDate),
    readState(),
    tryListWempMps(),
  ]);
  const enabled = enabledSources();
  const disabled = CRAWL_SOURCES.filter((s) => s.enabled === false);
  const mode = wechatMode();

  const byKind = (["college", "department", "service", "media"] as const).map((k) => ({
    kind: k,
    items: sourcesByKind(k),
  }));

  const countBySource = new Map<string, number>();
  const webCountBySource = new Map<string, number>();
  const wxCountBySource = new Map<string, number>();
  const latestWxUrlBySource = new Map<string, string>();
  const latestWxMsBySource = new Map<string, number>();

  let totalWxNotices = 0;
  for (const n of notices) {
    countBySource.set(n.source, (countBySource.get(n.source) ?? 0) + 1);
    if (isWechatNotice(n)) {
      totalWxNotices += 1;
      wxCountBySource.set(n.source, (wxCountBySource.get(n.source) ?? 0) + 1);
      const ms = Date.parse(n.publishedAt) || 0;
      if (ms >= (latestWxMsBySource.get(n.source) ?? -1)) {
        latestWxMsBySource.set(n.source, ms);
        latestWxUrlBySource.set(n.source, n.url);
      }
    } else {
      webCountBySource.set(n.source, (webCountBySource.get(n.source) ?? 0) + 1);
    }
  }

  const totalNotices = fromCrawl ? crawledCount : notices.length;
  const totalWebNotices = Math.max(0, totalNotices - totalWxNotices);

  // 合并 we-mp-rss 实时订阅号（若在线），方便标注订阅状态与补充未在预置表里的动态号
  const liveMpByName = new Map(liveMps.map((mp) => [mp.mp_name.trim(), mp]));
  const knownWxNames = new Set(WECHAT_ACCOUNTS.map((a) => a.name));
  const extraWxAccounts: WechatAccount[] = [];
  for (const mp of liveMps) {
    const name = mp.mp_name.trim();
    if (!name || knownWxNames.has(name)) continue;
    knownWxNames.add(name);
    extraWxAccounts.push({ name, group: "campus" });
  }
  for (const [srcName, cnt] of wxCountBySource.entries()) {
    if (cnt <= 0 || knownWxNames.has(srcName)) continue;
    if (CRAWL_SOURCES.some((s) => s.name === srcName)) continue;
    knownWxNames.add(srcName);
    extraWxAccounts.push({ name: srcName, group: "campus" });
  }

  const allWechatAccounts = [...WECHAT_ACCOUNTS, ...extraWxAccounts];
  const standaloneOfficialWx = STANDALONE_WECHAT_ACCOUNTS.filter(
    (a) => wechatGroupOf(a) === "official",
  );
  const standaloneCampusWx = [
    ...STANDALONE_WECHAT_ACCOUNTS.filter((a) => wechatGroupOf(a) === "campus"),
    ...extraWxAccounts,
  ];
  const linkedOfficialWx = WECHAT_ACCOUNTS.filter((a) => Boolean(a.sourceId));

  const sortWxAccounts = (list: WechatAccount[]) =>
    [...list].sort((a, b) => {
      const aSrc = a.sourceId ? (SOURCE_BY_ID.get(a.sourceId)?.name ?? a.name) : a.name;
      const bSrc = b.sourceId ? (SOURCE_BY_ID.get(b.sourceId)?.name ?? b.name) : b.name;
      const aCnt = wxCountBySource.get(aSrc) ?? 0;
      const bCnt = wxCountBySource.get(bSrc) ?? 0;
      if (bCnt !== aCnt) return bCnt - aCnt;
      const aLive = liveMpByName.has(a.name) ? 1 : 0;
      const bLive = liveMpByName.has(b.name) ? 1 : 0;
      if (bLive !== aLive) return bLive - aLive;
      return a.name.localeCompare(b.name, "zh");
    });

  const activeWxSourceCount = [...wxCountBySource.values()].filter((v) => v > 0).length;
  const lastReport = state.lastReport;

  const renderWechatRow = (acc: WechatAccount) => {
    const parentSource = acc.sourceId ? SOURCE_BY_ID.get(acc.sourceId) : undefined;
    const filterName = parentSource?.name ?? acc.name;
    const wxCnt = wxCountBySource.get(filterName) ?? 0;
    const liveMp = liveMpByName.get(acc.name);
    const latestUrl = latestWxUrlBySource.get(filterName);
    const active = wxCnt > 0 || Boolean(liveMp);

    const metaParts: string[] = [];
    if (acc.wechatId) metaParts.push(`@${acc.wechatId}`);
    if (parentSource) metaParts.push(`归属 ${shortSourceName(parentSource.name)}`);
    else if (liveMp) metaParts.push("we-mp-rss 已订阅");
    else metaParts.push("微信公众号");

    return (
      <li key={acc.name} className="crawl-source-item">
        <span className="crawl-source-dot" data-ok={active ? "true" : "false"} />
        <Link
          href={`/?source=${encodeURIComponent(filterName)}`}
          className="crawl-source-name"
          title={`查看 ${filterName} 的通知`}
        >
          {acc.name}
        </Link>
        <span className="crawl-source-meta" title={metaParts.join(" · ")}>
          {metaParts.join(" · ")}
        </span>
        <span className="crawl-source-count">
          {wxCnt > 0 ? `${wxCnt} 篇` : liveMp ? "已订阅" : "—"}
        </span>
        {latestUrl ? (
          <a
            className="crawl-source-link"
            href={latestUrl}
            target="_blank"
            rel="noreferrer noopener"
            title="打开最新微信文章"
            aria-label={`打开 ${acc.name} 最新微信文章`}
          >
            <ArrowUpRight />
          </a>
        ) : (
          <span className="crawl-source-link is-placeholder" aria-hidden="true" />
        )}
      </li>
    );
  };

  return (
    <SiteShell
      notices={notices}
      heading="采集状态"
      activeCategory={null}
      hideCategoryNav
      now={now}
    >
      <div className="page-shell">
        <div className="page-heading">
          <span className="calendar-title-icon" aria-hidden="true">
            <Database />
          </span>
          <h1>采集状态</h1>
        </div>
        <p className="page-sub">
          共配置 {CRAWL_SOURCES.length} 个华农官网采集源（{enabled.length} 个已启用）与{" "}
          {allWechatAccounts.length} 个微信公众号信息源（当前 {activeWxSourceCount} 个来源已有微信文章入库）。
          当前展示{fromCrawl ? "实时抓取数据" : "内置真实快照"}，库内共 {totalNotices} 条通知
          （官网 {totalWebNotices} 条 · 公众号 {totalWxNotices} 条）。
        </p>

        <div className="stat-cards sources-kpi-grid">
          <div className="stat-card">
            <span className="stat-label">已启用官网源</span>
            <strong className="stat-value">{enabled.length}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">微信公众号源</span>
            <strong className="stat-value">{allWechatAccounts.length}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">库内通知总数</span>
            <strong className="stat-value">{totalNotices}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">公众号文章数</span>
            <strong className="stat-value">{totalWxNotices}</strong>
          </div>
        </div>

        {lastReport && (
          <div className="crawl-banner">
            <span>
              最近一次同步：抓取 <strong>{lastReport.added}</strong> 条，库内{" "}
              <strong>{lastReport.total}</strong> 条，耗时{" "}
              {Math.round(lastReport.durationMs / 1000)} 秒
            </span>
            <span className="crawl-banner-time">
              {new Date(lastReport.finishedAt).toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
              })}
            </span>
          </div>
        )}

        <div className="crawl-mode">
          <strong>微信公众号接入模式：</strong>
          <code>{mode}</code>
          <span className="crawl-mode-hint">
            {mode === "wemp" &&
              `已对接自建 we-mp-rss 服务${liveMps.length > 0 ? `（当前在线订阅 ${liveMps.length} 个公众号）` : ""}，支持公众号图文、封面镜像与实时 Webhook 同步`}
            {mode === "manual" &&
              "手工导入 data/inbox/，或设置 WECHAT_MODE=rss / wemp"}
            {mode === "rss" && "通过第三方 RSS 服务抓取公众号文章"}
            {mode === "mp" && "调用公众号历史文章接口，需配置 __biz 与 pass_ticket"}
          </span>
        </div>

        <section className="crawl-section">
          <h2 className="crawl-section-title">
            <MessageCircle className="crawl-section-wx-icon" aria-hidden="true" />
            <span>微信公众号 · 校内组织与直属服务</span>
            <span className="crawl-section-count">{standaloneOfficialWx.length}</span>
          </h2>
          <ul className="crawl-source-list">
            {sortWxAccounts(standaloneOfficialWx).map(renderWechatRow)}
          </ul>
        </section>

        <section className="crawl-section">
          <h2 className="crawl-section-title">
            <MessageCircle className="crawl-section-wx-icon" aria-hidden="true" />
            <span>微信公众号 · 校园资讯 / 生活 / 求职号</span>
            <span className="crawl-section-count">{standaloneCampusWx.length}</span>
          </h2>
          <ul className="crawl-source-list">
            {sortWxAccounts(standaloneCampusWx).map(renderWechatRow)}
          </ul>
        </section>

        <section className="crawl-section">
          <h2 className="crawl-section-title">
            <MessageCircle className="crawl-section-wx-icon" aria-hidden="true" />
            <span>微信公众号 · 学院与部处关联官方号</span>
            <span className="crawl-section-count">{linkedOfficialWx.length}</span>
          </h2>
          <ul className="crawl-source-list">
            {sortWxAccounts(linkedOfficialWx).map(renderWechatRow)}
          </ul>
        </section>

        {byKind.map(({ kind, items }) =>
          items.length === 0 ? null : (
            <section key={kind} className="crawl-section">
              <h2 className="crawl-section-title">
                {KIND_LABEL[kind]}
                <span className="crawl-section-count">{items.length}</span>
              </h2>
              <ul className="crawl-source-list">
                {items.map((s) => {
                  const off = s.enabled === false;
                  const cnt = countBySource.get(s.name) ?? 0;
                  const wxCnt = wxCountBySource.get(s.name) ?? 0;
                  const linkedWx = WECHAT_BY_SOURCE_ID.get(s.id) ?? [];
                  const hasWx = wxCnt > 0 || linkedWx.length > 0 || Boolean(s.wechat);
                  const last = state.lastRun[s.id];
                  return (
                    <li
                      key={s.id}
                      className="crawl-source-item"
                      data-off={off ? "true" : undefined}
                    >
                      <span
                        className="crawl-source-dot"
                        data-ok={cnt > 0 ? "true" : "false"}
                      />
                      <Link
                        href={`/?source=${encodeURIComponent(s.name)}`}
                        className="crawl-source-name"
                        title={`查看 ${s.name} 的通知`}
                      >
                        {s.name}
                      </Link>
                      {hasWx && (
                        <span
                          className="crawl-source-wx-tag"
                          title={
                            linkedWx.length > 0
                              ? `关联公众号：${linkedWx.map((a) => a.name).join("、")}`
                              : `关联公众号：${s.wechat}`
                          }
                        >
                          {wxCnt > 0 ? `公众号 +${wxCnt}` : "含公众号"}
                        </span>
                      )}
                      <span className="crawl-source-meta">
                        {TEMPLATE_LABEL[s.template]}
                      </span>
                      <span
                        className="crawl-source-count"
                        title={
                          wxCnt > 0
                            ? `官网 ${webCountBySource.get(s.name) ?? 0} 条 + 公众号 ${wxCnt} 条`
                            : undefined
                        }
                      >
                        {off ? "已停用" : cnt > 0 ? `${cnt} 条` : "—"}
                      </span>
                      <span className="crawl-source-time">
                        {last
                          ? new Date(last).toLocaleString("zh-CN", {
                              timeZone: "Asia/Shanghai",
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "未运行"}
                      </span>
                      <a
                        className="crawl-source-link"
                        href={s.listUrl ?? s.base}
                        target="_blank"
                        rel="noreferrer noopener"
                        title="打开源站"
                        aria-label={`打开 ${s.name} 源站`}
                      >
                        <ArrowUpRight />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          ),
        )}

        {disabled.length > 0 && (
          <section className="crawl-section">
            <h2 className="crawl-section-title">
              待适配
              <span className="crawl-section-count">{disabled.length}</span>
            </h2>
            <ul className="crawl-source-list">
              {disabled.map((s) => (
                <li key={s.id} className="crawl-source-item" data-off="true">
                  <span className="crawl-source-dot" data-ok="false" />
                  <span className="crawl-source-name">{s.name}</span>
                  <span className="crawl-source-meta">
                    {s.id === "hnr"
                      ? "人物志栏目，非通知"
                      : "纯 JS 应用，需接口或浏览器渲染"}
                  </span>
                  <span className="crawl-source-count">已停用</span>
                  <span className="crawl-source-time" />
                  <a
                    className="crawl-source-link"
                    href={s.base}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`打开 ${s.name}`}
                  >
                    <ArrowUpRight />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="sources-page-footer">
          <Link className="plain-button" href="/">
            <ArrowLeft style={{ width: 15, height: 15 }} />
            <span>返回全部通知</span>
          </Link>
          <Link className="plain-button" href="/calendar">
            <span>前往活动日历</span>
          </Link>
        </div>
      </div>
    </SiteShell>
  );
}
