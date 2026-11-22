import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Database } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { loadNoticeSummaries } from "@/lib/data";
import {
  CRAWL_SOURCES,
  enabledSources,
  sourcesByKind,
  wechatSources,
} from "@/lib/crawl/sources";
import { readState } from "@/lib/crawl/store";
import { wechatMode } from "@/lib/crawl/wechat";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "采集状态｜「华农知道」SCAU Know",
  description: "查看华南农业大学各二级单位采集源状态、覆盖范围与最近运行结果。",
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

export default async function SourcesPage() {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const { notices, fromCrawl, crawledCount } = await loadNoticeSummaries(nowDate);
  const state = await readState();
  const enabled = enabledSources();
  const disabled = CRAWL_SOURCES.filter((s) => s.enabled === false);
  const wx = wechatSources();
  const mode = wechatMode();

  const byKind = (["college", "department", "service", "media"] as const).map((k) => ({
    kind: k,
    items: sourcesByKind(k),
  }));

  const countBySource = new Map<string, number>();
  for (const n of notices) {
    countBySource.set(n.source, (countBySource.get(n.source) ?? 0) + 1);
  }

  const lastReport = state.lastReport;

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
          共配置 {CRAWL_SOURCES.length} 个华农官方信息源，其中 {enabled.length} 个已启用。
          当前展示{fromCrawl ? "实时抓取数据" : "内置演示语料"}，库内共{" "}
          {fromCrawl ? crawledCount : notices.length} 条通知。
        </p>

        <div className="stat-cards sources-kpi-grid">
          <div className="stat-card">
            <span className="stat-label">已启用采集源</span>
            <strong className="stat-value">{enabled.length}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">库内通知总数</span>
            <strong className="stat-value">
              {fromCrawl ? crawledCount : notices.length}
            </strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">预置公众号源</span>
            <strong className="stat-value">{wx.length}</strong>
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
              "已对接自建 we-mp-rss 服务，支持公众号图文、封面镜像与实时 Webhook 同步"}
            {mode === "manual" &&
              "手工导入 data/inbox/，或设置 WECHAT_MODE=rss / wemp"}
            {mode === "rss" && "通过第三方 RSS 服务抓取公众号文章"}
            {mode === "mp" && "调用公众号历史文章接口，需配置 __biz 与 pass_ticket"}
          </span>
        </div>

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
                      <span className="crawl-source-meta">
                        {TEMPLATE_LABEL[s.template]}
                      </span>
                      <span className="crawl-source-count">
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
