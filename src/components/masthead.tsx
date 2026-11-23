"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChartColumn,
  Database,
  Info,
  Languages,
  LibraryBig,
  Menu,
  MessageCirclePlus,
  Moon,
  RefreshCw,
  Search,
  Star,
  Sun,
  X,
} from "lucide-react";
import { SITE } from "@/lib/site";
import { usePreferences } from "@/lib/preferences";
import { BrandWordmark, LogoMark } from "./brand";
import { ModalDialog } from "./dialog";

export function Masthead({
  initialQuery = "",
  totalCount,
  onOpenInfo,
  onOpenSources,
  onOpenMessage,
  onOpenStats,
}: {
  initialQuery?: string;
  totalCount: number;
  onOpenInfo: () => void;
  onOpenSources: () => void;
  onOpenMessage: () => void;
  onOpenStats: () => void;
}) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { resolvedScheme, toggleScheme, lang, toggleLang, starred } = usePreferences();

  const isCalendar = pathname.startsWith("/calendar");
  const isSources = pathname.startsWith("/sources");
  const isAdmin = pathname.startsWith("/admin");
  const isBoard = !isCalendar && !isSources && !isAdmin;
  const en = lang === "en";
  const isStatic = process.env.NEXT_PUBLIC_STATIC_MODE === "1";

  // URL 查询词变化时同步输入框
  useEffect(() => {
    setQ(initialQuery);
  }, [initialQuery]);

  // 键盘快捷键 `/` 聚焦搜索框
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA" &&
        !(document.activeElement as HTMLElement | null)?.isContentEditable
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const submitSearch = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      router.push("/");
      return;
    }
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <header className="masthead">
      {/* 顶部校园与项目导航条 */}
      <div className="campus-bar-wrap">
        <div className="campus-header">
          <nav
            className="campus-switch"
            aria-label={en ? "Campus and project navigation" : "校园与项目导航"}
          >
            <Link
              href="/"
              aria-current={isBoard ? "page" : undefined}
              className="campus-link"
            >
              <span>{en ? "SCAU Know" : "华农知道"}</span>
              {!en && <span className="campus-nav-subtitle">SCAU Know</span>}
            </Link>
            <Link
              href="/calendar"
              aria-current={isCalendar ? "page" : undefined}
              className="campus-link"
            >
              <span>{en ? "Calendar" : "活动日历"}</span>
              {!en && <span className="campus-nav-subtitle">Calendar</span>}
            </Link>
            {!isStatic && (
              <>
                <Link
                  href="/sources"
                  aria-current={isSources ? "page" : undefined}
                  className="campus-link"
                >
                  <span>{en ? "Crawler" : "采集状态"}</span>
                </Link>
                <Link
                  href="/admin"
                  aria-current={isAdmin ? "page" : undefined}
                  className="campus-link"
                >
                  <span>{en ? "Monitor" : "监控后台"}</span>
                </Link>
              </>
            )}
            <span className="campus-divider" aria-hidden="true" />
            {SITE.campusLinks.map((item) => (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noreferrer noopener"
                className="campus-link campus-link-ext"
              >
                <span>{en ? item.labelEn : item.label}</span>
                <ArrowUpRight className="campus-ext-icon" aria-hidden="true" />
              </a>
            ))}
          </nav>

          <div className="campus-header-right">
            <button
              type="button"
              className="campus-star-pill"
              data-has-stars={starred.length > 0 ? "true" : undefined}
              onClick={onOpenSources}
              title={en ? "Manage starred sources" : "管理我星标的学院与部门"}
            >
              <Star className="campus-star-icon" aria-hidden="true" />
              <span>
                {starred.length > 0
                  ? en
                    ? `${starred.length} Starred`
                    : `已星标 ${starred.length}`
                  : en
                    ? "Star Sources"
                    : "星标来源"}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* 主报头：品牌字标 + 搜索框 + 操作图标组 */}
      <div className="masthead-inner">
        <h1 className="brand-title">
          <Link
            className="wordmark"
            aria-label={
              en
                ? "SCAU Know, home"
                : "「华农知道」SCAU Know，返回首页"
            }
            href="/"
          >
            <LogoMark className="brand-mascot" />
            <BrandWordmark />
          </Link>
        </h1>

        {!isCalendar && (
          <form
            className="search-wrap masthead-search"
            role="search"
            action="/search"
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch(q);
            }}
          >
            <Search className="search-icon" aria-hidden="true" />
            <label htmlFor="masthead-search-input" className="sr-only">
              {en ? "Search notices, colleges, or keywords" : "搜索标题、发布单位或关键词"}
            </label>
            <input
              ref={searchInputRef}
              id="masthead-search-input"
              type="search"
              name="q"
              placeholder={en ? "Search notices..." : "搜索通知或学院"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoComplete="off"
            />
            {q ? (
              <button
                type="button"
                className="search-clear"
                aria-label={en ? "Clear search" : "清空搜索"}
                onClick={() => {
                  setQ("");
                  if (pathname.startsWith("/search")) {
                    router.push("/");
                  } else {
                    searchInputRef.current?.focus();
                  }
                }}
              >
                <X />
              </button>
            ) : (
              <kbd className="search-kbd" aria-hidden="true">
                /
              </kbd>
            )}
          </form>
        )}

        <div className="header-actions">
          {isCalendar ? (
            <Link
              className="pill-action-link"
              href="/"
              aria-label={en ? "Back to home" : "返回首页"}
            >
              <ArrowLeft />
              <span>{en ? "Home" : "返回首页"}</span>
            </Link>
          ) : (
            <Link
              className="pill-action-link"
              href="/calendar"
              aria-label={en ? "Activity Calendar" : "活动日历"}
            >
              <CalendarDays />
              <span>{en ? "Calendar" : "活动日历"}</span>
            </Link>
          )}

          {/* 桌面端图标按钮组 */}
          <div className="desktop-action-icons">
            <button
              type="button"
              className="icon-button"
              data-tone="amber"
              aria-label={en ? "Feedback" : "留言区"}
              title={en ? "Feedback & Source Suggestions" : "留言区"}
              onClick={onOpenMessage}
            >
              <MessageCirclePlus />
            </button>
            <button
              type="button"
              className="icon-button icon-button-badge-wrap"
              aria-label={en ? "Sources Directory" : "信息来源"}
              title={en ? "Sources Directory" : "信息来源"}
              onClick={onOpenSources}
            >
              <LibraryBig />
              {starred.length > 0 && <span className="icon-dot" aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={en ? "Data Overview" : "数据概览"}
              title={en ? "Data Overview" : "数据概览"}
              onClick={onOpenStats}
            >
              <ChartColumn />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={en ? "About SCAU Know" : "网站信息"}
              title={en ? "About SCAU Know" : "网站信息"}
              onClick={onOpenInfo}
            >
              <Info />
            </button>
            <button
              type="button"
              className="icon-button theme-toggle-single"
              aria-label={
                resolvedScheme === "dark"
                  ? en
                    ? "Switch to light mode"
                    : "切换到白天模式"
                  : en
                    ? "Switch to dark mode"
                    : "切换到夜间模式"
              }
              title={
                resolvedScheme === "dark"
                  ? en
                    ? "Switch to light mode"
                    : "切换到白天模式"
                  : en
                    ? "Switch to dark mode"
                    : "切换到夜间模式"
              }
              aria-pressed={resolvedScheme === "dark"}
              onClick={toggleScheme}
            >
              {resolvedScheme === "dark" ? <Sun /> : <Moon />}
            </button>
            <button
              type="button"
              className="lang-button"
              aria-label={en ? "切换为中文" : "Switch to English"}
              title={en ? "切换为中文" : "Switch to English"}
              onClick={toggleLang}
            >
              <Languages aria-hidden="true" />
              <span>{en ? "中" : "EN"}</span>
            </button>
          </div>

          {/* 移动端：折叠常用功能入口 */}
          <button
            type="button"
            className="icon-button mobile-menu-trigger"
            aria-label={en ? "Open tools menu" : "展开常用功能"}
            title={en ? "Tools" : "常用功能"}
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu />
          </button>
        </div>
      </div>

      {/* 移动端常用功能弹窗 */}
      <ModalDialog
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        className="modal-dialog modal-dialog-sm"
        labelledBy="mobile-menu-title"
      >
        <div className="modal-header">
          <h2 id="mobile-menu-title" className="modal-title">
            {en ? "Quick Tools" : "常用功能"}
          </h2>
          <button
            type="button"
            className="modal-close"
            aria-label={en ? "Close" : "关闭"}
            onClick={() => setMobileMenuOpen(false)}
          >
            <X />
          </button>
        </div>
        <div className="mobile-menu-grid">
          <Link
            href={isCalendar ? "/" : "/calendar"}
            className="mobile-menu-tile"
            onClick={() => setMobileMenuOpen(false)}
          >
            {isCalendar ? <ArrowLeft /> : <CalendarDays />}
            <span>{isCalendar ? (en ? "Home" : "返回首页") : en ? "Calendar" : "活动日历"}</span>
          </Link>
          {!isStatic && (
            <Link
              href="/sources"
              className="mobile-menu-tile"
              onClick={() => setMobileMenuOpen(false)}
            >
              <Database />
              <span>{en ? "Crawler Status" : "采集状态"}</span>
            </Link>
          )}
          <button
            type="button"
            className="mobile-menu-tile"
            data-tone="amber"
            onClick={() => {
              setMobileMenuOpen(false);
              onOpenMessage();
            }}
          >
            <MessageCirclePlus />
            <span>{en ? "Feedback" : "留言区"}</span>
          </button>
          <button
            type="button"
            className="mobile-menu-tile"
            onClick={() => {
              setMobileMenuOpen(false);
              onOpenSources();
            }}
          >
            <LibraryBig />
            <span>
              {en ? "Sources" : "信息来源"}
              {starred.length > 0 ? ` (${starred.length})` : ""}
            </span>
          </button>
          <button
            type="button"
            className="mobile-menu-tile"
            onClick={() => {
              setMobileMenuOpen(false);
              onOpenStats();
            }}
          >
            <ChartColumn />
            <span>{en ? "Overview" : "数据概览"}</span>
          </button>
          <button
            type="button"
            className="mobile-menu-tile"
            onClick={() => {
              setMobileMenuOpen(false);
              onOpenInfo();
            }}
          >
            <Info />
            <span>{en ? "About" : "网站信息"}</span>
          </button>
          <button
            type="button"
            className="mobile-menu-tile"
            onClick={toggleScheme}
          >
            {resolvedScheme === "dark" ? <Sun /> : <Moon />}
            <span>
              {resolvedScheme === "dark"
                ? en
                  ? "Light Mode"
                  : "白天模式"
                : en
                  ? "Dark Mode"
                  : "夜间模式"}
            </span>
          </button>
          <button
            type="button"
            className="mobile-menu-tile"
            onClick={toggleLang}
          >
            <Languages />
            <span>{en ? "切换中文" : "English"}</span>
          </button>
        </div>
        <p className="mobile-menu-foot">
          {en
            ? `${totalCount} notices indexed across SCAU`
            : `已聚合华南农业大学 ${totalCount} 条校园通知`}
        </p>
      </ModalDialog>
    </header>
  );
}

export function SiteFooter({
  totalCount,
  updatedAt,
  autoSyncSec,
  syncing,
  onManualSync,
}: {
  totalCount: number;
  updatedAt?: string;
  autoSyncSec?: number;
  syncing?: boolean;
  onManualSync?: () => void;
}) {
  const { lang } = usePreferences();
  const en = lang === "en";
  const isStatic = process.env.NEXT_PUBLIC_STATIC_MODE === "1";

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-meta">
          <strong>
            {en ? SITE.nameEn : `「${SITE.name}」${SITE.nameEn}`}
          </strong>
          <span className="footer-sep" aria-hidden="true">·</span>
          <span>
            {en
              ? `${SITE.fullNameEn} · ${totalCount} notices`
              : `${SITE.fullName}公开通知聚合 · 共 ${totalCount} 条`}
          </span>
          {updatedAt && (
            <>
              <span className="footer-sep" aria-hidden="true">·</span>
              <span className="footer-time">
                {en ? `Synced ${updatedAt}` : `最近同步 ${updatedAt}`}
              </span>
            </>
          )}
          {autoSyncSec !== undefined && (
            <span className="footer-sync-pill" data-active={autoSyncSec > 0 ? "true" : "false"}>
              <span className="sync-dot" aria-hidden="true" />
              <span>
                {autoSyncSec > 0
                  ? en
                    ? `Auto-sync (${autoSyncSec}s)`
                    : `自动同步 (${autoSyncSec}s)`
                  : en
                    ? "Auto-sync paused"
                    : "自动同步已关闭"}
              </span>
            </span>
          )}
          {onManualSync && (
            <button
              type="button"
              className="footer-sync-btn"
              disabled={syncing}
              onClick={onManualSync}
              title={en ? "Sync latest notices now" : "立即检测并同步最新通知"}
            >
              <RefreshCw className={syncing ? "spin" : ""} aria-hidden="true" />
              <span>
                {syncing
                  ? en
                    ? "Syncing..."
                    : "同步中..."
                  : en
                    ? "Sync now"
                    : "立即同步"}
              </span>
            </button>
          )}
        </div>
        <div className="footer-links">
          <span className="footer-motto">
            {en ? `Est. ${SITE.founded}` : `校训：${SITE.motto.join(" ")}`}
          </span>
          <Link href="/">{en ? "All Notices" : "全部通知"}</Link>
          <Link href="/calendar">{en ? "Calendar" : "活动日历"}</Link>
          {!isStatic && <Link href="/sources">{en ? "Sources" : "采集状态"}</Link>}
        </div>
      </div>
    </footer>
  );
}
