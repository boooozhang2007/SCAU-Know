"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CalendarDays,
  ChartColumn,
  Check,
  Database,
  ExternalLink,
  Info,
  LibraryBig,
  MessageCirclePlus,
  Search,
  Send,
  Star,
  TrendingUp,
  X,
} from "lucide-react";
import { SITE } from "@/lib/site";
import type { SourceRef } from "@/lib/types";
import { usePreferences } from "@/lib/preferences";
import { LogoMark } from "./brand";
import { ModalDialog } from "./dialog";

const STATIC_MODE = process.env.NEXT_PUBLIC_STATIC_MODE === "1";

export type PanelKind = "info" | "sources" | "message" | "stats" | null;

export interface StatsData {
  today: number;
  week: number;
  total: number;
  activityCount: number;
  infoCount: number;
  noticeTotal: number;
  days: { label: string; value: number }[];
}

interface GuestMessage {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  status: "done" | "working" | "pending";
  reply?: string;
}

const MSG_KEY = "scau-know-guestbook-v1";

const SEED_MESSAGES: GuestMessage[] = [
  {
    id: "seed-1",
    author: "数信院同学",
    body: "希望能把数学与信息学院和人工智能与低空技术学院的学术报告同步进活动日历，经常错过报告时间！",
    createdAt: "2026-11-20 14:22",
    status: "done",
    reply: "已优化报告时间与地点解析，现已自动同步到「活动日历」并支持按学科筛选。",
  },
  {
    id: "seed-2",
    author: "匿名华农同学",
    body: "建议卡片来源不要全部显示成「华南农业大学...」，改成学院简称会清爽很多～",
    createdAt: "2026-11-19 21:08",
    status: "done",
    reply: "已上线简称映射，卡片展示清晰简称，详情弹层与来源目录保留官方全称。",
  },
  {
    id: "seed-3",
    author: "五山常驻选手",
    body: "期待后续接入华农就业指导中心宣讲会接口与紫荆校园公众号文章聚合！",
    createdAt: "2026-11-18 11:35",
    status: "working",
    reply: "已在数据源中预留公众号 RSS 与就业中心接口适配，持续推进中。",
  },
];

export function PanelHost({
  panel,
  onClose,
  sources,
  stats,
}: {
  panel: PanelKind;
  onClose: () => void;
  sources: SourceRef[];
  stats: StatsData;
}) {
  const { lang } = usePreferences();
  const en = lang === "en";

  const titleId = panel ? `panel-title-${panel}` : undefined;
  const isWide = panel === "sources" || panel === "message";

  return (
    <ModalDialog
      open={Boolean(panel)}
      onClose={onClose}
      className={`modal-dialog ${isWide ? "modal-dialog-lg" : "modal-dialog-md"}`}
      labelledBy={titleId}
    >
      {panel === "info" && <InfoPanel onClose={onClose} en={en} titleId={titleId!} />}
      {panel === "sources" && (
        <SourcesPanel sources={sources} onClose={onClose} en={en} titleId={titleId!} />
      )}
      {panel === "stats" && (
        <StatsPanel stats={stats} onClose={onClose} en={en} titleId={titleId!} />
      )}
      {panel === "message" && (
        <MessagePanel onClose={onClose} en={en} titleId={titleId!} />
      )}
    </ModalDialog>
  );
}

function InfoPanel({
  onClose,
  en,
  titleId,
}: {
  onClose: () => void;
  en: boolean;
  titleId: string;
}) {
  return (
    <>
      <div className="modal-header">
        <div className="modal-title-row">
          <Info className="modal-title-icon" aria-hidden="true" />
          <h2 id={titleId} className="modal-title">
            {en ? `About ${SITE.nameEn}` : `关于「${SITE.name}」`}
          </h2>
          <span className="version-badge">{SITE.version}</span>
        </div>
        <button
          type="button"
          className="modal-close"
          aria-label={en ? "Close" : "关闭"}
          onClick={onClose}
        >
          <X />
        </button>
      </div>

      <div className="modal-body">
        <div className="info-hero">
          <LogoMark className="info-hero-logo" />
          <div>
            <strong className="info-hero-name">
              {en ? SITE.nameEn : `「${SITE.name}」${SITE.nameEn}`}
            </strong>
            <p className="info-hero-sub">
              {en ? SITE.descriptionEn : SITE.description}
            </p>
          </div>
        </div>

        <dl className="detail-facts">
          <div className="detail-fact">
            <dt>{en ? "University" : "所属高校"}</dt>
            <dd>{en ? SITE.fullNameEn : SITE.fullName}</dd>
          </div>
          <div className="detail-fact">
            <dt>{en ? "Motto" : "校训"}</dt>
            <dd>{SITE.motto.join(" · ")}</dd>
          </div>
          <div className="detail-fact">
            <dt>{en ? "Founded" : "建校年份"}</dt>
            <dd>{en ? SITE.founded : `${SITE.founded} 年`}</dd>
          </div>
          <div className="detail-fact">
            <dt>{en ? "Brand Color" : "华农标准绿"}</dt>
            <dd className="color-swatch-cell">
              <span
                className="color-swatch"
                style={{ background: SITE.standardGreen }}
                aria-hidden="true"
              />
              <span>{SITE.standardGreen}</span>
            </dd>
          </div>
        </dl>

        <div className="info-shortcuts">
          <strong>{en ? "Keyboard Shortcuts" : "快捷操作"}</strong>
          <div className="shortcut-row">
            <span>
              <kbd>/</kbd> {en ? "Focus search" : "快速搜索"}
            </span>
            <span>
              <kbd>Esc</kbd> {en ? "Close dialog" : "关闭弹窗"}
            </span>
          </div>
        </div>

        <p className="panel-note">
          {en
            ? "Independent student-oriented portal for SCAU public campus feeds. Standard green #007848 follows the 115th anniversary SCAU VIS."
            : "本站点聚合华南农业大学各学院、职能部门及教辅单位官网公开通知，标准绿 #007848 取自 2024 年 115 周年校庆视觉形象识别系统。"}
        </p>

        {!STATIC_MODE && (
          <div className="modal-foot-actions">
            <Link href="/sources" className="plain-button" onClick={onClose}>
              <Database style={{ width: 15, height: 15 }} />
              <span>{en ? "Crawler Status" : "查看采集状态"}</span>
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

function SourcesPanel({
  sources,
  onClose,
  en,
  titleId,
}: {
  sources: SourceRef[];
  onClose: () => void;
  en: boolean;
  titleId: string;
}) {
  const router = useRouter();
  const { isStarred, toggleStar, starAll, clearStars, starred } = usePreferences();
  const [kw, setKw] = useState("");
  const [tab, setTab] = useState<"all" | "college" | "department" | "service" | "starred">("all");

  const filtered = useMemo(() => {
    const q = kw.trim().toLowerCase();
    return sources.filter((s) => {
      if (tab === "starred" && !isStarred(s.name)) return false;
      if (tab !== "all" && tab !== "starred" && s.kind !== tab) return false;
      if (q) {
        return (
          s.name.toLowerCase().includes(q) ||
          s.shortName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [sources, kw, tab, isStarred]);

  const TABS: { key: typeof tab; label: string; labelEn: string }[] = [
    { key: "all", label: `全部 ${sources.length}`, labelEn: `All (${sources.length})` },
    { key: "college", label: "教学单位", labelEn: "Colleges" },
    { key: "department", label: "机关部处", labelEn: "Offices" },
    { key: "service", label: "教辅服务", labelEn: "Services" },
    { key: "starred", label: `已星标 ${starred.length}`, labelEn: `Starred (${starred.length})` },
  ];

  return (
    <>
      <div className="modal-header">
        <div className="modal-title-row">
          <LibraryBig className="modal-title-icon" aria-hidden="true" />
          <h2 id={titleId} className="modal-title">
            {en ? "Sources Directory" : "信息来源"}
          </h2>
          <span className="modal-count-pill">{sources.length}</span>
        </div>
        <button
          type="button"
          className="modal-close"
          aria-label={en ? "Close" : "关闭"}
          onClick={onClose}
        >
          <X />
        </button>
      </div>

      <div className="modal-body">
        <p className="panel-lede">
          {en
            ? "Star colleges or departments you care about to prioritize them on the board and calendar."
            : "星标常用学院或职能部门，即可在通知墙和活动日历中优先查看或只看星标。"}
        </p>

        <div className="sources-toolbar">
          <div className="search-wrap sources-search">
            <Search className="search-icon" aria-hidden="true" />
            <input
              type="search"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder={en ? "Search colleges or offices..." : "搜索学院、部处或简称..."}
              aria-label={en ? "Filter sources" : "搜索信息来源"}
            />
            {kw && (
              <button
                type="button"
                className="search-clear"
                aria-label={en ? "Clear" : "清空"}
                onClick={() => setKw("")}
              >
                <X />
              </button>
            )}
          </div>

          <div className="sources-bulk-actions">
            <button
              type="button"
              className="plain-button plain-button-sm"
              onClick={() => starAll(filtered.map((s) => s.name))}
            >
              <Star style={{ width: 13, height: 13 }} />
              <span>{en ? "Star visible" : "全选星标"}</span>
            </button>
            {starred.length > 0 && (
              <button
                type="button"
                className="plain-button plain-button-sm"
                onClick={clearStars}
              >
                <span>{en ? "Clear" : "清空星标"}</span>
              </button>
            )}
          </div>
        </div>

        <div className="sources-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              className="sources-tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {en ? t.labelEn : t.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="sources-empty">
            {tab === "starred"
              ? en
                ? "No starred sources yet. Click the star button next to any source."
                : "暂无星标来源，点击任意单位右侧的星标按钮即可添加。"
              : en
                ? "No matching sources."
                : "未找到匹配的发布单位。"}
          </div>
        ) : (
          <ul className="source-list">
            {filtered.map((s) => {
              const star = isStarred(s.name);
              return (
                <li key={s.name} className="source-item" data-tone={s.tone}>
                  <span className="source-item-dot" aria-hidden="true" />
                  <div className="source-item-info">
                    <span className="source-item-name" title={s.name}>
                      {s.shortName}
                    </span>
                    <span className="source-item-full">{s.name}</span>
                  </div>
                  <span className="source-item-count">
                    {en ? `${s.count}` : `${s.count} 条`}
                  </span>
                  <button
                    type="button"
                    className="source-row-btn"
                    onClick={() => {
                      onClose();
                      router.push(`/?source=${encodeURIComponent(s.name)}`);
                    }}
                  >
                    {en ? "View" : "查看"}
                  </button>
                  <button
                    type="button"
                    className="source-row-star"
                    data-starred={star ? "true" : undefined}
                    aria-pressed={star}
                    aria-label={star ? `取消星标 ${s.shortName}` : `星标 ${s.shortName}`}
                    title={star ? (en ? "Unstar" : "取消星标") : en ? "Star" : "星标"}
                    onClick={() => toggleStar(s.name)}
                  >
                    <Star />
                  </button>
                  <a
                    className="source-row-ext"
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={en ? `Visit ${s.name}` : `访问 ${s.name} 官网`}
                    title={en ? "Open official site" : "打开官网"}
                  >
                    <ExternalLink />
                  </a>
                </li>
              );
            })}
          </ul>
        )}

        {!STATIC_MODE && (
          <div className="modal-foot-actions">
            <Link href="/sources" className="plain-button" onClick={onClose}>
              <Database style={{ width: 15, height: 15 }} />
              <span>{en ? "Full Crawler Diagnostics" : "前往采集状态页"}</span>
              <ArrowUpRight style={{ width: 14, height: 14 }} />
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

function StatsPanel({
  stats,
  onClose,
  en,
  titleId,
}: {
  stats: StatsData;
  onClose: () => void;
  en: boolean;
  titleId: string;
}) {
  const max = Math.max(...stats.days.map((d) => d.value), 1);

  return (
    <>
      <div className="modal-header">
        <div className="modal-title-row">
          <ChartColumn className="modal-title-icon" aria-hidden="true" />
          <h2 id={titleId} className="modal-title">
            {en ? "Site Statistics" : "访问量与数据概览"}
          </h2>
        </div>
        <button
          type="button"
          className="modal-close"
          aria-label={en ? "Close" : "关闭"}
          onClick={onClose}
        >
          <X />
        </button>
      </div>

      <div className="modal-body">
        <div className="stat-cards">
          <div className="stat-card">
            <span className="stat-label">
              <CalendarDays /> {en ? "Today" : "今日访问量"}
            </span>
            <strong className="stat-value">
              {stats.today.toLocaleString("zh-CN")}
            </strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">
              <TrendingUp /> {en ? "Last 7 Days" : "近 7 天"}
            </span>
            <strong className="stat-value">
              {stats.week.toLocaleString("zh-CN")}
            </strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">
              <ChartColumn /> {en ? "Total" : "累计访问量"}
            </span>
            <strong className="stat-value">
              {stats.total.toLocaleString("zh-CN")}
            </strong>
          </div>
        </div>

        <div className="stat-section-head">
          <strong>{en ? "7-Day Trend" : "近 7 天访问趋势"}</strong>
          <span>{en ? "Demo telemetry" : "演示统计"}</span>
        </div>

        <div className="stat-chart" aria-label={en ? "7-day visits trend" : "近 7 日访问趋势"}>
          {stats.days.map((d) => (
            <div key={d.label} className="stat-bar-item">
              <span className="stat-bar-num">{d.value.toLocaleString("zh-CN")}</span>
              <div className="stat-bar-track">
                <div
                  className="stat-bar-fill"
                  style={{ height: `${Math.max(12, (d.value / max) * 100)}%` }}
                  title={`${d.label}：${d.value}`}
                />
              </div>
              <span className="stat-bar-label">{d.label}</span>
            </div>
          ))}
        </div>

        <div className="stat-table-wrap">
          <div className="stat-section-head">
            <strong>{en ? "Indexed Content" : "库内信息构成"}</strong>
          </div>
          <table className="stat-table">
            <thead>
              <tr>
                <th>{en ? "Group" : "板块"}</th>
                <th>{en ? "Items" : "收录条数"}</th>
                <th>{en ? "Share" : "占比"}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{en ? "Events" : "活动类"}</td>
                <td className="stat-num-cell">{stats.activityCount}</td>
                <td className="stat-num-cell">
                  {Math.round((stats.activityCount / Math.max(stats.noticeTotal, 1)) * 100)}%
                </td>
              </tr>
              <tr>
                <td>{en ? "Notices" : "通知类"}</td>
                <td className="stat-num-cell">{stats.infoCount}</td>
                <td className="stat-num-cell">
                  {Math.round((stats.infoCount / Math.max(stats.noticeTotal, 1)) * 100)}%
                </td>
              </tr>
              <tr className="stat-row-total">
                <td>{en ? "Total" : "总计"}</td>
                <td className="stat-num-cell">{stats.noticeTotal}</td>
                <td className="stat-num-cell">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function MessagePanel({
  onClose,
  en,
  titleId,
}: {
  onClose: () => void;
  en: boolean;
  titleId: string;
}) {
  const [nickname, setNickname] = useState("");
  const [body, setBody] = useState("");
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [messages, setMessages] = useState<GuestMessage[]>(SEED_MESSAGES);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MSG_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as GuestMessage[];
        if (Array.isArray(saved) && saved.length > 0) {
          setMessages([...saved, ...SEED_MESSAGES]);
        }
      }
    } catch {
      /* 忽略 */
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const content = body.trim();
    if (!content) return;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const entry: GuestMessage = {
      id: `user-${Date.now()}`,
      author: nickname.trim() || (en ? "Anonymous SCAUer" : "匿名华农同学"),
      body: content,
      createdAt: stamp,
      status: "pending",
    };

    const userEntries = messages.filter((m) => m.id.startsWith("user-"));
    const nextUser = [entry, ...userEntries];
    setMessages([entry, ...messages]);
    try {
      window.localStorage.setItem(MSG_KEY, JSON.stringify(nextUser));
    } catch {
      /* 忽略 */
    }

    setBody("");
    setJustSubmitted(true);
    setTimeout(() => setJustSubmitted(false), 2500);
  };

  const STATUS_TEXT: Record<GuestMessage["status"], { zh: string; en: string }> = {
    done: { zh: "已处理", en: "Resolved" },
    working: { zh: "处理中", en: "In progress" },
    pending: { zh: "待查看", en: "Pending" },
  };

  return (
    <>
      <div className="modal-header">
        <div className="modal-title-row">
          <MessageCirclePlus
            className="modal-title-icon"
            data-tone="amber"
            aria-hidden="true"
          />
          <h2 id={titleId} className="modal-title">
            {en ? "Feedback & Suggestions" : "留言区"}
          </h2>
        </div>
        <button
          type="button"
          className="modal-close"
          aria-label={en ? "Close" : "关闭"}
          onClick={onClose}
        >
          <X />
        </button>
      </div>

      <div className="modal-body">
        <p className="panel-lede">
          {en
            ? "Report missing notices, suggest a SCAU department or WeChat account, or leave product feedback."
            : "关于项目的问题、建议，或想补充华农的某个学院/公众号信息源，都欢迎在这里留言。"}
        </p>

        <form className="msg-form-card" onSubmit={handleSubmit}>
          <div className="msg-field">
            <label htmlFor="msg-nickname">{en ? "Nickname" : "昵称"}</label>
            <input
              id="msg-nickname"
              type="text"
              maxLength={32}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={en ? "Optional (defaults to Anonymous)" : "可选，不填则匿名"}
            />
          </div>

          <div className="msg-field">
            <label htmlFor="msg-body">{en ? "Message" : "留言内容"}</label>
            <textarea
              id="msg-body"
              rows={3}
              maxLength={800}
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                en
                  ? "Share your feedback or paste a source URL..."
                  : "写下你的问题、建议或想补充的华农公众号/网站链接..."
              }
            />
          </div>

          <div className="msg-form-footer">
            <span className="msg-counter">
              {body.length}/800
            </span>
            <div className="msg-submit-group">
              {justSubmitted && (
                <span className="msg-toast">
                  <Check /> {en ? "Submitted" : "已记录留言"}
                </span>
              )}
              <button
                type="submit"
                className="primary-button"
                disabled={!body.trim()}
              >
                <Send style={{ width: 14, height: 14 }} />
                <span>{en ? "Submit" : "提交留言"}</span>
              </button>
            </div>
          </div>
        </form>

        <div className="guestbook-section">
          <div className="guestbook-head">
            <strong>{en ? "Community Notes" : "大家的留言"}</strong>
            <span className="modal-count-pill">{messages.length}</span>
          </div>

          <ul className="guestbook-list">
            {messages.map((m) => (
              <li key={m.id} className="guestbook-item">
                <div className="guestbook-item-top">
                  <span className="guestbook-author">{m.author}</span>
                  <time className="guestbook-time">{m.createdAt}</time>
                  <span className="guestbook-status" data-status={m.status}>
                    {en ? STATUS_TEXT[m.status].en : STATUS_TEXT[m.status].zh}
                  </span>
                </div>
                <p className="guestbook-body">{m.body}</p>
                {m.reply && (
                  <p className="guestbook-reply">
                    <strong>{en ? "Reply: " : "开发者回复："}</strong>
                    {m.reply}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
