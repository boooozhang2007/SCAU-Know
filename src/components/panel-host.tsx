"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CalendarDays,
  ChartColumn,
  Check,
  Copy,
  Database,
  ExternalLink,
  Info,
  LibraryBig,
  MessageCircle,
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
  importantCount: number;
  webCount: number;
  wechatCount: number;
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
            ? "Independent student-oriented portal for SCAU public campus websites and WeChat official accounts. Standard green #007848 follows the 115th anniversary SCAU VIS."
            : "本站点聚合华南农业大学各学院、职能部门、教辅单位官网及校园微信公众号公开通知，标准绿 #007848 取自 2024 年 115 周年校庆视觉形象识别系统。"}
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

type SourcesTabKey = "all" | "wechat" | "college" | "department" | "service" | "starred";

const SOURCES_TAB_ORDER: readonly SourcesTabKey[] = [
  "all",
  "wechat",
  "college",
  "department",
  "service",
  "starred",
];

function isWechatCapable(s: SourceRef): boolean {
  return s.kind === "wechat" || s.wechatCount > 0 || Boolean(s.wechat);
}

function legacyCopyText(text: string): boolean {
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;inset-block-start:0;opacity:0";
    document.body.append(field);
    field.select();
    try {
      return document.execCommand("copy");
    } finally {
      field.remove();
    }
  } catch {
    return false;
  }
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
  const [tab, setTab] = useState<SourcesTabKey>("all");
  const [copyFeedback, setCopyFeedback] = useState<{
    key: string;
    ok: boolean;
    message: string;
  } | null>(null);

  const tabRefs = useRef<Partial<Record<SourcesTabKey, HTMLButtonElement | null>>>({});
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCopyMsgRef = useRef("");

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const countsByTab = useMemo(() => {
    let wechat = 0;
    let college = 0;
    let department = 0;
    let service = 0;
    for (const s of sources) {
      if (isWechatCapable(s)) wechat += 1;
      if (s.kind === "college") college += 1;
      else if (s.kind === "department") department += 1;
      else if (s.kind === "service") service += 1;
    }
    return { wechat, college, department, service };
  }, [sources]);

  const filtered = useMemo(() => {
    const q = kw.trim().toLowerCase();
    const list = sources.filter((s) => {
      if (tab === "starred" && !isStarred(s.name)) return false;
      if (tab === "wechat" && !isWechatCapable(s)) return false;
      if (
        tab !== "all" &&
        tab !== "starred" &&
        tab !== "wechat" &&
        s.kind !== tab
      ) {
        return false;
      }
      if (q) {
        if (
          (q === "公众号" || q === "微信" || q === "微信公众号" || q === "wechat") &&
          isWechatCapable(s)
        ) {
          return true;
        }
        return (
          s.name.toLowerCase().includes(q) ||
          s.shortName.toLowerCase().includes(q) ||
          Boolean(s.wechat?.toLowerCase().includes(q)) ||
          Boolean(s.wechatId?.toLowerCase().includes(q)) ||
          Boolean(s.wechatAccounts?.some((a) => a.toLowerCase().includes(q))) ||
          Boolean(s.wechatIds?.some((id) => id.toLowerCase().includes(q)))
        );
      }
      return true;
    });

    if (tab === "wechat") {
      return [...list].sort((a, b) => {
        if (b.wechatCount !== a.wechatCount) return b.wechatCount - a.wechatCount;
        const aPure = a.kind === "wechat" ? 1 : 0;
        const bPure = b.kind === "wechat" ? 1 : 0;
        if (bPure !== aPure) return bPure - aPure;
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name, "zh");
      });
    }
    return list;
  }, [sources, kw, tab, isStarred]);

  const TABS: { key: SourcesTabKey; label: string; labelEn: string }[] = [
    { key: "all", label: `全部 ${sources.length}`, labelEn: `All (${sources.length})` },
    {
      key: "wechat",
      label: `公众号 ${countsByTab.wechat}`,
      labelEn: `WeChat (${countsByTab.wechat})`,
    },
    {
      key: "college",
      label: `教学单位 ${countsByTab.college}`,
      labelEn: `Colleges (${countsByTab.college})`,
    },
    {
      key: "department",
      label: `机关部处 ${countsByTab.department}`,
      labelEn: `Offices (${countsByTab.department})`,
    },
    {
      key: "service",
      label: `教辅服务 ${countsByTab.service}`,
      labelEn: `Services (${countsByTab.service})`,
    },
    {
      key: "starred",
      label: `已星标 ${starred.length}`,
      labelEn: `Starred (${starred.length})`,
    },
  ];

  const selectTab = useCallback((next: SourcesTabKey, moveFocus = false) => {
    setTab(next);
    const el = tabRefs.current[next];
    if (el) {
      if (moveFocus) el.focus();
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, []);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
      let nextIdx = -1;
      if (e.key === "ArrowRight") nextIdx = (idx + 1) % SOURCES_TAB_ORDER.length;
      else if (e.key === "ArrowLeft") {
        nextIdx = (idx - 1 + SOURCES_TAB_ORDER.length) % SOURCES_TAB_ORDER.length;
      } else if (e.key === "Home") nextIdx = 0;
      else if (e.key === "End") nextIdx = SOURCES_TAB_ORDER.length - 1;
      if (nextIdx >= 0) {
        e.preventDefault();
        selectTab(SOURCES_TAB_ORDER[nextIdx], true);
      }
    },
    [selectTab],
  );

  const copyWechat = useCallback(
    async (sourceKey: string, value: string, isWechatId: boolean) => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      let ok = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
          ok = true;
        } else {
          ok = legacyCopyText(value);
        }
      } catch {
        ok = legacyCopyText(value);
      }

      let message = ok
        ? en
          ? `Copied ${value}`
          : isWechatId
            ? `已复制微信号「${value}」`
            : `已复制公众号「${value}」`
        : en
          ? "Copy failed"
          : "复制失败，请手动搜索公众号";
      if (message === lastCopyMsgRef.current) message += "\u00A0";
      lastCopyMsgRef.current = message;

      setCopyFeedback({ key: sourceKey, ok, message });
      copyTimerRef.current = setTimeout(() => {
        setCopyFeedback(null);
      }, 2200);
    },
    [en],
  );

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
            ? "Browse SCAU websites and WeChat official accounts. Star your favorites to prioritize them on the board and calendar."
            : "收录华农各学院、部处官网及校园微信公众号，星标常用来源即可在通知墙和活动日历中优先查看或只看星标。"}
        </p>

        <div className="sources-toolbar">
          <div className="search-wrap sources-search">
            <Search className="search-icon" aria-hidden="true" />
            <input
              type="search"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder={
                en
                  ? "Search colleges, offices, or WeChat accounts..."
                  : "搜索学院、部处、公众号或微信号..."
              }
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

        <div
          className="sources-tabs"
          role="tablist"
          aria-label={en ? "Filter sources by category" : "按分类筛选信息来源"}
        >
          {TABS.map((t, idx) => (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[t.key] = el;
              }}
              id={`sources-tab-${t.key}`}
              type="button"
              role="tab"
              className="sources-tab"
              tabIndex={tab === t.key ? 0 : -1}
              aria-selected={tab === t.key}
              onClick={() => selectTab(t.key)}
              onKeyDown={(e) => handleTabKeyDown(e, idx)}
            >
              {en ? t.labelEn : t.label}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          aria-labelledby={`sources-tab-${tab}`}
        >
          {/* 独立于复制按钮的 live region，使用 sticky 浮条确保滚动到任意位置都能看到并向读屏软件播报 */}
          <div
            className="sources-copy-status"
            role="status"
            data-visible={copyFeedback ? "true" : undefined}
            data-failed={copyFeedback && !copyFeedback.ok ? "true" : undefined}
          >
            {copyFeedback?.message ?? ""}
          </div>
          {filtered.length === 0 ? (
            <div className="sources-empty">
              {tab === "starred"
                ? en
                  ? "No starred sources yet. Click the star button next to any source."
                  : "暂无星标来源，点击任意单位或公众号右侧的星标按钮即可添加。"
                : en
                  ? "No matching sources."
                  : "未找到匹配的发布单位或公众号。"}
            </div>
          ) : (
            <ul className="source-list">
              {filtered.map((s) => {
                const star = isStarred(s.name);
                const hasWx = isWechatCapable(s);
                const isPureWx = s.kind === "wechat";
                const copyValue = s.wechatId || s.wechat || s.name;
                const copyIsId = Boolean(s.wechatId);
                const showCopyAction = hasWx && (!s.url || tab === "wechat");
                const copied =
                  copyFeedback?.key === s.name && copyFeedback.ok;
                const copyFailed =
                  copyFeedback?.key === s.name && !copyFeedback.ok;

                const linkedNames = s.wechatAccounts ?? (s.wechat ? [s.wechat] : []);
                const linkedTitle = linkedNames.length
                  ? `${en ? "WeChat: " : "关联公众号："}${linkedNames.join("、")}${
                      s.wechatId ? ` (@${s.wechatId})` : ""
                    }`
                  : undefined;

                let subtitle = s.name;
                if (isPureWx) {
                  const parts = [en ? "WeChat Official Account" : "微信公众号"];
                  if (s.wechatId) parts.push(`@${s.wechatId}`);
                  if (s.name !== s.shortName) parts.push(s.name);
                  subtitle = parts.join(" · ");
                } else if (tab === "wechat" && linkedNames.length > 0) {
                  const preview = linkedNames.slice(0, 2).join(" / ");
                  const more =
                    linkedNames.length > 2
                      ? en
                        ? ` +${linkedNames.length - 2}`
                        : ` 等${linkedNames.length}个号`
                      : "";
                  const idPart = s.wechatId ? ` · @${s.wechatId}` : "";
                  subtitle = `${en ? "WeChat: " : "公众号："}${preview}${more}${idPart}`;
                } else if (hasWx) {
                  const parts = [s.name];
                  if (s.wechatCount > 0) {
                    parts.push(
                      en
                        ? `${s.wechatCount} from WeChat`
                        : `含公众号 ${s.wechatCount} 条`,
                    );
                  } else if (s.wechatId) {
                    parts.push(`@${s.wechatId}`);
                  }
                  subtitle = parts.join(" · ");
                }

                const displayCount =
                  tab === "wechat" && !isPureWx && s.wechatCount > 0
                    ? en
                      ? `${s.wechatCount} wx`
                      : `${s.wechatCount} 篇`
                    : s.count > 0
                      ? en
                        ? `${s.count}`
                        : `${s.count} 条`
                      : en
                        ? "Pending"
                        : "待收录";

                return (
                  <li
                    key={s.name}
                    className="source-item"
                    data-tone={s.tone}
                    data-wechat={isPureWx ? "true" : undefined}
                  >
                    <span className="source-item-dot" aria-hidden="true" />
                    <div className="source-item-info">
                      <div className="source-item-head">
                        <span className="source-item-name" title={s.name}>
                          {s.shortName}
                        </span>
                        {hasWx && (
                          <span
                            className={`source-wechat-pill${isPureWx ? "" : " is-dual"}`}
                            title={linkedTitle}
                          >
                            <MessageCircle aria-hidden="true" />
                            <span>
                              {isPureWx
                                ? en
                                  ? "WeChat"
                                  : "公众号"
                                : en
                                  ? "+WeChat"
                                  : "含公众号"}
                            </span>
                          </span>
                        )}
                      </div>
                      <span className="source-item-full" title={subtitle}>
                        {subtitle}
                      </span>
                    </div>
                    <span
                      className="source-item-count"
                      data-empty={s.count === 0 ? "true" : undefined}
                      title={
                        tab === "wechat" && !isPureWx && s.count > s.wechatCount
                          ? en
                            ? `${s.count} total notices`
                            : `共 ${s.count} 条（官网 ${s.webCount} + 公众号 ${s.wechatCount}）`
                          : undefined
                      }
                    >
                      {displayCount}
                    </span>
                    {s.count > 0 ? (
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
                    ) : (
                      <span className="source-row-btn is-muted" aria-disabled="true">
                        {en ? "None" : "暂无"}
                      </span>
                    )}
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
                    {showCopyAction ? (
                      <button
                        type="button"
                        className="source-row-copy"
                        data-copied={copied ? "true" : undefined}
                        data-failed={copyFailed ? "true" : undefined}
                        aria-label={
                          en
                            ? `Copy WeChat ${copyValue}`
                            : copyIsId
                              ? `复制微信号 ${copyValue}`
                              : `复制公众号名 ${copyValue}`
                        }
                        title={
                          en
                            ? `Copy WeChat: ${copyValue}`
                            : copyIsId
                              ? `复制微信号：${copyValue}`
                              : `复制公众号名：${copyValue}`
                        }
                        onClick={() => void copyWechat(s.name, copyValue, copyIsId)}
                      >
                        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      </button>
                    ) : s.url ? (
                      <a
                        className="source-row-ext"
                        href={s.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={en ? `Visit ${s.name}` : `访问 ${s.name} 官网`}
                        title={en ? "Open official site" : "打开官网"}
                      >
                        <ExternalLink aria-hidden="true" />
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

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
  const pct = (n: number) => Math.round((n / Math.max(stats.noticeTotal, 1)) * 100);

  return (
    <>
      <div className="modal-header">
        <div className="modal-title-row">
          <ChartColumn className="modal-title-icon" aria-hidden="true" />
          <h2 id={titleId} className="modal-title">
            {en ? "Data Overview" : "数据概览"}
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
              <CalendarDays /> {en ? "Today" : "今日收录"}
            </span>
            <strong className="stat-value">
              {stats.today.toLocaleString("zh-CN")}
            </strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">
              <TrendingUp /> {en ? "Last 7 Days" : "近 7 天收录"}
            </span>
            <strong className="stat-value">
              {stats.week.toLocaleString("zh-CN")}
            </strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">
              <ChartColumn /> {en ? "Total Indexed" : "累计收录"}
            </span>
            <strong className="stat-value">
              {stats.total.toLocaleString("zh-CN")}
            </strong>
          </div>
        </div>

        <div className="stat-section-head">
          <strong>{en ? "7-Day Publishing Trend" : "近 7 天发布趋势"}</strong>
          <span>{en ? "Live index" : "实时统计"}</span>
        </div>

        <div className="stat-chart" aria-label={en ? "7-day publishing trend" : "近 7 日发布趋势"}>
          {stats.days.map((d) => (
            <div key={d.label} className="stat-bar-item">
              <span className="stat-bar-num">{d.value.toLocaleString("zh-CN")}</span>
              <div className="stat-bar-track">
                <div
                  className="stat-bar-fill"
                  style={{
                    height: d.value > 0 ? `${Math.max(12, (d.value / max) * 100)}%` : "4%",
                    opacity: d.value > 0 ? 1 : 0.3,
                  }}
                  title={`${d.label}：${d.value} 条`}
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
                <th>{en ? "Group" : "板块 / 渠道"}</th>
                <th>{en ? "Items" : "收录条数"}</th>
                <th>{en ? "Share" : "占比"}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{en ? "Events" : "活动类"}</td>
                <td className="stat-num-cell">{stats.activityCount}</td>
                <td className="stat-num-cell">{pct(stats.activityCount)}%</td>
              </tr>
              <tr>
                <td>{en ? "Notices" : "通知类"}</td>
                <td className="stat-num-cell">{stats.infoCount}</td>
                <td className="stat-num-cell">{pct(stats.infoCount)}%</td>
              </tr>
              <tr>
                <td>{en ? "Important" : "重要通知"}</td>
                <td className="stat-num-cell">{stats.importantCount}</td>
                <td className="stat-num-cell">{pct(stats.importantCount)}%</td>
              </tr>
              <tr>
                <td>{en ? "Official Websites" : "官网来源"}</td>
                <td className="stat-num-cell">{stats.webCount}</td>
                <td className="stat-num-cell">{pct(stats.webCount)}%</td>
              </tr>
              <tr>
                <td>{en ? "WeChat Official Accounts" : "微信公众号"}</td>
                <td className="stat-num-cell">{stats.wechatCount}</td>
                <td className="stat-num-cell">{pct(stats.wechatCount)}%</td>
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
  const [messages, setMessages] = useState<GuestMessage[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MSG_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as GuestMessage[];
        if (Array.isArray(saved)) {
          setMessages(saved.filter((m) => m && typeof m.id === "string" && !m.id.startsWith("seed-")));
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

    const nextUser = [entry, ...messages];
    setMessages(nextUser);
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
            <strong>{en ? "Your Messages" : "留言记录"}</strong>
            <span className="modal-count-pill">{messages.length}</span>
          </div>

          {messages.length === 0 ? (
            <div className="sources-empty">
              {en
                ? "No messages yet. Share your feedback or suggest a SCAU source above."
                : "暂无留言，欢迎在上方提交问题反馈或推荐华农学院/公众号信息源。"}
            </div>
          ) : (
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
          )}
        </div>
      </div>
    </>
  );
}
