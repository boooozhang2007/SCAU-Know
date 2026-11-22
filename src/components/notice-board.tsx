"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import type { Notice } from "@/lib/types";
import {
  CATEGORIES,
  SUBJECTS,
  type CategoryIntent,
  type SubjectSlug,
} from "@/lib/site";
import {
  categoryName,
  formatShortTime,
  formatShortTimeCompact,
  matchesQuery,
  sortByPublished,
  subjectName,
} from "@/lib/format";
import { shortSourceName } from "@/lib/sources";
import {
  DESKTOP_COL_OPTIONS,
  MOBILE_COL_OPTIONS,
  usePreferences,
} from "@/lib/preferences";
import {
  ColumnPicker,
  NoticeCard,
  ViewModePicker,
} from "./notice";
import { WaterfallGrid } from "./waterfall";
import { Icon } from "./icon";

const DetailSheet = dynamic(
  () => import("./detail-sheet").then((m) => m.DetailSheet),
  { ssr: false },
);

/** 首页每个板块初始展示条数，避免一次渲染上百条 DOM，超出提供「查看全部」入口 */
const HOME_SECTION_LIMIT = 18;
/** 单分类页每批加载条数 */
const PAGE_BATCH = 30;

export function NoticeBoard({
  notices,
  heading,
  activeCategory,
  activeCluster,
  activeSource,
  initialNoticeId,
  now,
  initialQuery = "",
  singleSection = false,
  isPartial = false,
  loadingFull = false,
  totalCount,
  categoryCounts,
  searchIndex,
  onRequestFullData,
  onOpenSources,
}: {
  notices: Notice[];
  heading: string;
  activeCategory?: string | null;
  activeCluster?: CategoryIntent | null;
  activeSource?: string | null;
  initialNoticeId?: string | null;
  now: string;
  initialQuery?: string;
  singleSection?: boolean;
  isPartial?: boolean;
  loadingFull?: boolean;
  totalCount?: number;
  categoryCounts?: Record<string, number>;
  searchIndex?: Record<string, string> | null;
  onRequestFullData?: () => void;
  onOpenSources?: () => void;
}) {
  const router = useRouter();
  const {
    lang,
    starred,
    isStarred,
    viewMode,
    setViewMode,
    desktopCols,
    setDesktopCols,
    mobileCols,
    setMobileCols,
  } = usePreferences();
  const en = lang === "en";

  const nowDate = useMemo(() => new Date(now), [now]);
  const [selectedSubjects, setSelectedSubjects] = useState<SubjectSlug[]>([]);
  const [includeGeneral, setIncludeGeneral] = useState(true);
  const [subjectOpen, setSubjectOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_BATCH);
  const [sheetActivated, setSheetActivated] = useState<boolean>(() => Boolean(initialNoticeId));
  const [openNotice, setOpenNotice] = useState<Notice | null>(() => {
    if (!initialNoticeId) return null;
    return notices.find((n) => n.id === initialNoticeId) ?? null;
  });
  const subjectWrapRef = useRef<HTMLDivElement>(null);
  const lazySentinelRef = useRef<HTMLDivElement>(null);
  const handledDeepLinkRef = useRef<string | null>(
    initialNoticeId && notices.some((n) => n.id === initialNoticeId) ? initialNoticeId : null,
  );

  const handleOpenNotice = useCallback((n: Notice) => {
    setSheetActivated(true);
    setOpenNotice(n);
  }, []);

  // 路由切换时重置分页，并响应深链 ?notice=xxx（若未在首屏切片内则直拉单条详情）
  useEffect(() => {
    setVisibleCount(PAGE_BATCH);
  }, [activeCategory, activeCluster, activeSource, initialQuery]);

  useEffect(() => {
    if (!initialNoticeId) {
      handledDeepLinkRef.current = null;
      return;
    }
    if (handledDeepLinkRef.current === initialNoticeId) return;

    const found = notices.find((n) => n.id === initialNoticeId);
    if (found) {
      handledDeepLinkRef.current = initialNoticeId;
      setSheetActivated(true);
      setOpenNotice(found);
      return;
    }

    const ctrl = new AbortController();
    const isStatic = process.env.NEXT_PUBLIC_STATIC_MODE === "1";
    const detailUrl = isStatic
      ? `/static-data/details/${encodeURIComponent(initialNoticeId)}.json`
      : `/api/notices?id=${encodeURIComponent(initialNoticeId)}`;

    fetch(detailUrl, {
      cache: isStatic ? "default" : "no-cache",
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: (Notice & { ok?: boolean; notice?: Notice }) | null) => {
        const full =
          payload && "notice" in payload && payload.ok && payload.notice
            ? payload.notice
            : payload && "id" in payload && payload.id
              ? (payload as Notice)
              : null;
        if (full) {
          handledDeepLinkRef.current = initialNoticeId;
          setSheetActivated(true);
          setOpenNotice(full);
        }
      })
      .catch(() => {});

    return () => ctrl.abort();
  }, [initialNoticeId, notices]);

  // 交互筛选时自动拉取全量摘要
  useEffect(() => {
    if (!isPartial || !onRequestFullData) return;
    if (
      subjectOpen ||
      selectedSubjects.length > 0 ||
      viewMode === "star-only" ||
      (viewMode === "star-first" && starred.length > 0)
    ) {
      onRequestFullData();
    }
  }, [
    isPartial,
    onRequestFullData,
    subjectOpen,
    selectedSubjects.length,
    viewMode,
    starred.length,
  ]);

  // 学科筛选弹层外部点击 / Esc 关闭
  useEffect(() => {
    if (!subjectOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (subjectWrapRef.current && !subjectWrapRef.current.contains(e.target as Node)) {
        setSubjectOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSubjectOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [subjectOpen]);

  // 统计当前范围内各学科条目数（用于学科筛选气泡）
  const baseScoped = useMemo(() => {
    let list = notices;
    if (activeCategory) list = list.filter((n) => n.category === activeCategory);
    if (activeCluster) list = list.filter((n) => n.cluster === activeCluster);
    if (activeSource) list = list.filter((n) => n.source === activeSource);
    if (initialQuery.trim()) {
      list = list.filter((n) => matchesQuery(n, initialQuery, searchIndex?.[n.id]));
    }
    return list;
  }, [notices, activeCategory, activeCluster, activeSource, initialQuery, searchIndex]);

  const subjectCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of baseScoped) {
      counts[n.subject] = (counts[n.subject] ?? 0) + 1;
    }
    return counts;
  }, [baseScoped]);

  const filtered = useMemo(() => {
    let list = baseScoped;

    // 真实学科多选过滤（勾选具体学科时可选同时包含「学科通用」）
    if (selectedSubjects.length > 0) {
      const picked = new Set<SubjectSlug>(selectedSubjects);
      if (includeGeneral) picked.add("general");
      list = list.filter((n) => picked.has(n.subject));
    }

    // 浏览方式：只看星标 / 星标优先 / 时间排序
    if (viewMode === "star-only") {
      list = list.filter((n) => isStarred(n.source));
    }

    const sorted = sortByPublished(list);
    if (viewMode === "star-first" && starred.length > 0) {
      return sorted
        .map((n) => ({
          n,
          star: isStarred(n.source) ? 1 : 0,
          ts: Date.parse(n.publishedAt) || 0,
        }))
        .sort((a, b) => (b.star !== a.star ? b.star - a.star : b.ts - a.ts))
        .map((x) => x.n);
    }

    return sorted;
  }, [baseScoped, selectedSubjects, includeGeneral, viewMode, isStarred, starred.length]);

  const sections = useMemo(() => {
    const map = new Map<string, Notice[]>();
    for (const n of filtered) {
      const arr = map.get(n.category) ?? [];
      arr.push(n);
      map.set(n.category, arr);
    }
    return CATEGORIES.filter((c) => map.has(c.slug)).map((c) => ({
      category: c,
      items: map.get(c.slug)!,
    }));
  }, [filtered]);

  const toggleSubject = (slug: SubjectSlug) => {
    startTransition(() => {
      setSelectedSubjects((prev) =>
        prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
      );
    });
  };

  const handleViewModeChange = useCallback(
    (mode: Parameters<typeof setViewMode>[0]) => {
      startTransition(() => setViewMode(mode));
    },
    [setViewMode],
  );

  const handleDesktopColsChange = useCallback(
    (cols: number) => {
      startTransition(() => setDesktopCols(cols));
    },
    [setDesktopCols],
  );

  const handleMobileColsChange = useCallback(
    (cols: number) => {
      startTransition(() => setMobileCols(cols));
    },
    [setMobileCols],
  );

  const handleCloseDetail = useCallback(() => setOpenNotice(null), []);

  const hasFilters =
    Boolean(initialQuery.trim()) ||
    Boolean(activeSource) ||
    selectedSubjects.length > 0 ||
    viewMode === "star-only";

  const resolvedHeading = (() => {
    if (initialQuery.trim()) {
      return en ? `Search: ${initialQuery.trim()}` : `搜索：${initialQuery.trim()}`;
    }
    if (activeCategory) return categoryName(activeCategory, lang);
    if (activeCluster === "activity") return en ? "All Events" : "全部活动";
    if (activeCluster === "information") return en ? "All Notices" : "全部通知";
    return en && heading === "全部" ? "All" : heading;
  })();

  const clearAllFilters = () => {
    setSelectedSubjects([]);
    if (viewMode === "star-only") setViewMode("time");
    if (initialQuery.trim() || activeSource) {
      router.push(activeCategory ? `/category/${activeCategory}` : "/");
    }
  };

  const isSingleFeed = singleSection || Boolean(activeCategory);

  // 多板块模式：当用户开始向下滚动并接近第 2 个板块底部时自动加载其余板块
  useEffect(() => {
    if (!isPartial || isSingleFeed || !onRequestFullData) return;
    const el = lazySentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const tryTrigger = () => {
      if (window.scrollY <= 24) return;
      const rect = el.getBoundingClientRect();
      if (rect.top <= window.innerHeight + 350) {
        onRequestFullData();
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (window.scrollY > 24 && entries.some((e) => e.isIntersecting)) {
          onRequestFullData();
        }
      },
      { rootMargin: "0px 0px 350px 0px" },
    );
    io.observe(el);
    window.addEventListener("scroll", tryTrigger, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", tryTrigger);
    };
  }, [isPartial, isSingleFeed, onRequestFullData]);

  const boardTotalDisplay =
    !hasFilters && isPartial
      ? isSingleFeed && activeCategory && categoryCounts?.[activeCategory] !== undefined
        ? categoryCounts[activeCategory]
        : !activeCluster && totalCount !== undefined
          ? totalCount
          : filtered.length
      : filtered.length;

  return (
    <>
      <div className="board-toolbar">
        <div className="board-title-group">
          <div className="board-title">
            {isSingleFeed && (
              <Link
                href="/"
                className="board-back-link"
                aria-label={en ? "Back to all notices" : "返回全部通知"}
              >
                <ArrowLeft />
                <span>{en ? "All" : "返回全部"}</span>
              </Link>
            )}
            <h2>{resolvedHeading}</h2>
            <span className="board-total">
              {boardTotalDisplay}
              <span className="sr-only">{en ? " notices" : " 条通知"}</span>
            </span>
          </div>

          {!isSingleFeed && !hasFilters && (
            <button
              type="button"
              className="board-promo"
              onClick={() => onOpenSources?.()}
            >
              <Sparkles className="board-promo-icon" aria-hidden="true" />
              <span className="board-promo-text">
                {en
                  ? "50 official SCAU portals indexed · Star your colleges for instant updates"
                  : "已聚合华农 50 个学院与部处官网，支持星标常用院系与按学科精准筛选"}
              </span>
              <ArrowUpRight className="board-promo-arrow" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="board-tools">
          <ViewModePicker
            value={viewMode}
            onChange={handleViewModeChange}
            starCount={starred.length}
          />

          {/* 学科筛选下拉浮层 */}
          <div className="dropdown-wrap" ref={subjectWrapRef}>
            <button
              type="button"
              className="toolbar-select subject-trigger"
              data-active={selectedSubjects.length > 0 ? "true" : undefined}
              data-open={subjectOpen ? "true" : undefined}
              aria-label={en ? "Filter by discipline" : "学科筛选"}
              aria-expanded={subjectOpen}
              aria-haspopup="dialog"
              onClick={() => setSubjectOpen((v) => !v)}
            >
              <SlidersHorizontal className="toolbar-filter-icon" aria-hidden="true" />
              <span>{en ? "Disciplines" : "学科"}</span>
              {selectedSubjects.length > 0 && (
                <span className="toolbar-badge">{selectedSubjects.length}</span>
              )}
            </button>

            {subjectOpen && (
              <div
                className="subject-popover"
                role="region"
                aria-label={en ? "Filter by discipline" : "按学科筛选"}
              >
                <div className="subject-popover-head">
                  <strong>{en ? "Disciplines" : "学科筛选"}</strong>
                  <button
                    type="button"
                    className="subject-reset-btn"
                    disabled={selectedSubjects.length === 0}
                    onClick={() => setSelectedSubjects([])}
                  >
                    {en ? "All disciplines" : "全部学科"}
                  </button>
                </div>

                <div className="subject-check-grid">
                  {SUBJECTS.map((s) => {
                    const checked = selectedSubjects.includes(s.slug);
                    const count = subjectCounts[s.slug] ?? 0;
                    return (
                      <button
                        key={s.slug}
                        type="button"
                        className="subject-option"
                        data-selected={checked ? "true" : undefined}
                        aria-pressed={checked}
                        title={s.desc}
                        onClick={() => toggleSubject(s.slug)}
                      >
                        <span className="subject-checkbox" aria-hidden="true">
                          {checked && <Check />}
                        </span>
                        <span className="subject-option-name">
                          {en ? s.nameEn : s.name}
                        </span>
                        <span className="subject-option-count">{count}</span>
                      </button>
                    );
                  })}
                </div>

                <label
                  className="subject-general-toggle"
                  data-disabled={selectedSubjects.length === 0 ? "true" : undefined}
                >
                  <input
                    type="checkbox"
                    checked={includeGeneral}
                    disabled={selectedSubjects.length === 0}
                    onChange={(e) => setIncludeGeneral(e.target.checked)}
                  />
                  <span>
                    {en ? "Also include General notices" : "同时显示「学科通用」通知"}
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="column-control">
            <ColumnPicker
              value={desktopCols}
              options={DESKTOP_COL_OPTIONS}
              onChange={handleDesktopColsChange}
            />
            <ColumnPicker
              value={mobileCols}
              options={MOBILE_COL_OPTIONS}
              onChange={handleMobileColsChange}
              mobile
            />
          </div>
        </div>
      </div>

      {/* 激活中的筛选条件标签栏 */}
      {hasFilters && (
        <div className="active-filters-bar">
          {initialQuery.trim() && (
            <button
              type="button"
              className="active-filter-chip"
              onClick={() =>
                router.push(activeCategory ? `/category/${activeCategory}` : "/")
              }
            >
              <span>
                {en ? `Keyword: ${initialQuery.trim()}` : `关键词：${initialQuery.trim()}`}
              </span>
              <X aria-hidden="true" />
            </button>
          )}

          {activeSource && (
            <button
              type="button"
              className="active-filter-chip"
              onClick={() =>
                router.push(activeCategory ? `/category/${activeCategory}` : "/")
              }
            >
              <span>
                {en ? `Source: ${shortSourceName(activeSource)}` : `来源：${shortSourceName(activeSource)}`}
              </span>
              <X aria-hidden="true" />
            </button>
          )}

          {viewMode === "star-only" && (
            <button
              type="button"
              className="active-filter-chip"
              onClick={() => setViewMode("time")}
            >
              <Star className="chip-star" aria-hidden="true" />
              <span>{en ? "Starred sources only" : "只看星标来源"}</span>
              <X aria-hidden="true" />
            </button>
          )}

          {selectedSubjects.map((slug) => (
            <button
              key={slug}
              type="button"
              className="active-filter-chip"
              onClick={() => toggleSubject(slug)}
            >
              <span>{subjectName(slug, lang)}</span>
              <X aria-hidden="true" />
            </button>
          ))}

          <button
            type="button"
            className="active-filter-clear"
            onClick={clearAllFilters}
          >
            {en ? "Clear all" : "重置筛选"}
          </button>
        </div>
      )}

      {/* 通知墙主体 */}
      <div id="board-results" className="board-results">
        <span className="sr-only" role="status">
          {en
            ? `Found ${filtered.length} notices`
            : `找到 ${filtered.length} 条通知`}
        </span>

        {sections.length === 0 ? (
          loadingFull || (isPartial && (hasFilters || Boolean(activeCluster))) ? (
            <div className="empty-state" role="status" aria-live="polite">
              <strong>{en ? "Loading matching notices..." : "正在加载全部通知…"}</strong>
              <p>
                {en
                  ? "Fetching the complete campus index for filtering and search."
                  : "正在从全站通知摘要中检索匹配结果，请稍候。"}
              </p>
            </div>
          ) : (
            <div className="empty-state">
              <SearchX />
              <strong>
                {viewMode === "star-only" && starred.length === 0
                  ? en
                    ? "No starred sources yet"
                    : "还没有星标任何学院或部门"
                  : en
                    ? "No matching notices"
                    : "没有匹配的条目"}
              </strong>
              <p>
                {viewMode === "star-only" && starred.length === 0
                  ? en
                    ? "Open Sources Directory to star the colleges and departments you follow."
                    : "前往「信息来源」星标常用学院或部门，即可在此聚焦查看。"
                  : en
                    ? "Try another keyword or reset your filters."
                    : "换个关键词，或重置学科与来源筛选后再试。"}
              </p>
              <div className="empty-state-actions">
                {viewMode === "star-only" && onOpenSources && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={onOpenSources}
                  >
                    <Star style={{ width: 14, height: 14 }} />
                    <span>{en ? "Choose Sources" : "去星标常用来源"}</span>
                  </button>
                )}
                {hasFilters && (
                  <button
                    type="button"
                    className="plain-button"
                    onClick={clearAllFilters}
                  >
                    <X style={{ width: 14, height: 14 }} />
                    <span>{en ? "Reset filters" : "清除条件"}</span>
                  </button>
                )}
              </div>
            </div>
          )
        ) : isSingleFeed ? (
          /* 单分类全页流式布局（不限高度，底部支持加载更多） */
          (() => {
            const items = filtered;
            const visibleItems = items.slice(0, visibleCount);
            const categoryTrueTotal =
              !hasFilters &&
              isPartial &&
              activeCategory &&
              categoryCounts?.[activeCategory] !== undefined
                ? categoryCounts[activeCategory]
                : items.length;
            const remainingCount = Math.max(0, categoryTrueTotal - visibleItems.length);
            const hasMore = remainingCount > 0;
            const onlyCat = sections[0]?.category;
            let priorityAssigned = 0;
            return (
              <section
                className="notice-section notice-section-full"
                data-tone={onlyCat?.tone}
              >
                <WaterfallGrid cols={desktopCols} mobileCols={mobileCols} gap={11}>
                  {visibleItems.map((n, i) => {
                    const isPriority = Boolean(n.cover) && priorityAssigned < 2;
                    if (isPriority) priorityAssigned++;
                    return (
                      <NoticeCard
                        key={n.id}
                        notice={n}
                        index={i}
                        lang={lang}
                        starred={isStarred(n.source)}
                        onOpen={handleOpenNotice}
                        priorityCover={isPriority}
                        timeDesktop={formatShortTime(n.publishedAt, nowDate, lang)}
                        timeMobile={formatShortTimeCompact(n.publishedAt, nowDate, lang)}
                      />
                    );
                  })}
                </WaterfallGrid>

                {hasMore && (
                  <div className="load-more-wrap">
                    <button
                      type="button"
                      className="plain-button load-more-btn"
                      disabled={loadingFull}
                      onClick={() => {
                        if (isPartial) onRequestFullData?.();
                        startTransition(() => setVisibleCount((c) => c + PAGE_BATCH));
                      }}
                    >
                      {loadingFull
                        ? en
                          ? "Loading..."
                          : "正在加载更多…"
                        : en
                          ? `Load more (${remainingCount} left)`
                          : `加载更多（剩余 ${remainingCount} 条）`}
                    </button>
                  </div>
                )}
              </section>
            );
          })()
        ) : (
          /* 首页/多板块分区瀑布流：首屏仅挂载前 2 板块，滚到底部时自动拉取并展开其余板块 */
          <>
            <div className="notice-sections">
              {sections.map(({ category, items }, sectionIdx) => {
                const previewItems = items.slice(0, HOME_SECTION_LIMIT);
                const sectionTotal =
                  !hasFilters && isPartial && categoryCounts?.[category.slug] !== undefined
                    ? categoryCounts[category.slug]
                    : items.length;
                const truncated = sectionTotal > HOME_SECTION_LIMIT;
                const scrollable = previewItems.length > desktopCols * 2;
                const deferred = sectionIdx >= 2;
                let priorityAssigned = 0;
                return (
                  <section
                    key={category.slug}
                    className={
                      deferred
                        ? "notice-section notice-section-deferred"
                        : "notice-section"
                    }
                    data-tone={category.tone}
                    aria-labelledby={`notice-section-${category.slug}`}
                  >
                    <div className="section-heading">
                      <span className="section-icon">
                        <Icon name={category.icon} />
                      </span>
                      <h2 id={`notice-section-${category.slug}`}>
                        {en ? category.nameEn : category.name}
                      </h2>
                      <span className="section-count">
                        {en ? `${sectionTotal}` : `${sectionTotal}条`}
                      </span>
                      <Link
                        className="section-more"
                        href={
                          initialQuery.trim()
                            ? `/category/${category.slug}?q=${encodeURIComponent(initialQuery.trim())}`
                            : `/category/${category.slug}`
                        }
                        aria-label={
                          en
                            ? `View more ${category.nameEn}`
                            : `查看更多${category.name}`
                        }
                      >
                        <span>{en ? "View more" : "查看更多"}</span>
                        <ArrowRight />
                      </Link>
                    </div>

                    <div
                      className={`notice-section-scroll ${scrollable ? "is-scrollable" : ""}`}
                      tabIndex={scrollable ? 0 : undefined}
                      role="region"
                      aria-label={
                        en
                          ? `${category.nameEn} notices`
                          : `${category.name}通知列表`
                      }
                    >
                      <WaterfallGrid cols={desktopCols} mobileCols={mobileCols} gap={10}>
                        {previewItems.map((n, i) => {
                          const isPriority =
                            sectionIdx === 0 && Boolean(n.cover) && priorityAssigned < 2;
                          if (isPriority) priorityAssigned++;
                          return (
                            <NoticeCard
                              key={n.id}
                              notice={n}
                              index={i}
                              lang={lang}
                              starred={isStarred(n.source)}
                              onOpen={handleOpenNotice}
                              priorityCover={isPriority}
                              timeDesktop={formatShortTime(n.publishedAt, nowDate, lang)}
                              timeMobile={formatShortTimeCompact(n.publishedAt, nowDate, lang)}
                            />
                          );
                        })}
                      </WaterfallGrid>

                      {truncated && (
                        <div className="section-tail-more">
                          <Link
                            href={`/category/${category.slug}`}
                            className="section-tail-link"
                          >
                            <span>
                              {en
                                ? `View all ${sectionTotal} in ${category.nameEn}`
                                : `查看「${category.name}」全部 ${sectionTotal} 条`}
                            </span>
                            <ArrowRight />
                          </Link>
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>

            {isPartial && (
              <div ref={lazySentinelRef} className="board-lazy-sentinel">
                <button
                  type="button"
                  className="plain-button board-lazy-btn"
                  disabled={loadingFull}
                  onClick={() => onRequestFullData?.()}
                >
                  {loadingFull
                    ? en
                      ? "Loading remaining categories..."
                      : "正在展开其余板块通知…"
                    : en
                      ? `Load remaining ${Math.max(0, CATEGORIES.length - sections.length)} categories`
                      : `展开其余 ${Math.max(0, CATEGORIES.length - sections.length)} 个板块全部通知`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {sheetActivated && <DetailSheet notice={openNotice} onClose={handleCloseDetail} />}
    </>
  );
}
