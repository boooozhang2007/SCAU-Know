"use client";

import {
  Suspense,
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Masthead, SiteFooter } from "@/components/masthead";
import { CategoryNav } from "@/components/category-nav";
import { NoticeBoard } from "@/components/notice-board";
import type { PanelKind, StatsData } from "@/components/panel-host";
import type { Notice, SourceRef } from "@/lib/types";
import { CATEGORY_MAP, type CategoryIntent } from "@/lib/site";
import { toCstParts } from "@/lib/format";
import { STANDALONE_WECHAT_ACCOUNTS } from "@/lib/crawl/wechat-accounts";
import {
  isWechatNotice,
  kindOfSource,
  officialWebsiteUrl,
  shortSourceName,
  wechatAccountsOfSource,
} from "@/lib/sources";
import { usePreferences } from "@/lib/preferences";

const PanelHost = dynamic(
  () => import("@/components/panel-host").then((m) => m.PanelHost),
  { ssr: false },
);

interface LiveNoticesContextValue {
  notices: Notice[];
  now: string;
  syncing: boolean;
  refresh: () => void;
}

interface LowPriorityRequestInit extends RequestInit {
  priority?: "high" | "low" | "auto";
}

const LiveNoticesContext = createContext<LiveNoticesContextValue | null>(null);

const STATIC_MODE = process.env.NEXT_PUBLIC_STATIC_MODE === "1";

let STATIC_FULL_NOTICES_CACHE: Notice[] | null = null;
let SEARCH_INDEX_CACHE: Record<string, string> | null = null;

interface UrlQueryState {
  q: string;
  cluster: CategoryIntent | null;
  source: string | null;
  notice: string | null;
}

function UrlQueryBridge({ onSync }: { onSync: (next: UrlQueryState) => void }) {
  const sp = useSearchParams();
  const q = sp.get("q")?.trim() ?? "";
  const clusterRaw = sp.get("cluster");
  const cluster: CategoryIntent | null =
    clusterRaw === "activity" || clusterRaw === "information" ? clusterRaw : null;
  const source = sp.get("source")?.trim() || null;
  const notice = sp.get("notice")?.trim() || null;

  useEffect(() => {
    onSync({ q, cluster, source, notice });
  }, [q, cluster, source, notice, onSync]);

  return null;
}

export function useLiveNotices(
  fallbackNotices: Notice[],
  fallbackNow: string,
): LiveNoticesContextValue {
  const ctx = useContext(LiveNoticesContext);
  return (
    ctx ?? {
      notices: fallbackNotices,
      now: fallbackNow,
      syncing: false,
      refresh: () => {},
    }
  );
}

/** 基于库内真实通知计算数据概览（无任何演示/虚拟访问量），保证 SSR 与客户端水合一致 */
function buildStats(notices: Notice[], nowIso: string): StatsData {
  const totalNotices = notices.length;
  let activityCount = 0;
  let wechatCount = 0;
  let importantCount = 0;

  const pad = (n: number) => String(n).padStart(2, "0");
  const dayKeyOf = (iso: string): string => {
    const p = toCstParts(iso);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  };

  const nowMs = Date.parse(nowIso) || Date.now();
  const buckets = Array.from({ length: 7 }, (_, i) => {
    const dtIso = new Date(nowMs - (6 - i) * 86400000).toISOString();
    const p = toCstParts(dtIso);
    return {
      key: `${p.y}-${pad(p.m)}-${pad(p.d)}`,
      label: `${pad(p.m)}/${pad(p.d)}`,
      value: 0,
    };
  });
  const bucketMap = new Map(buckets.map((b) => [b.key, b]));

  for (const n of notices) {
    if (n.cluster === "activity") activityCount += 1;
    if (isWechatNotice(n)) wechatCount += 1;
    if (n.important || (n.importance ?? n.ai?.importance ?? 0) >= 4) importantCount += 1;
    const b = bucketMap.get(dayKeyOf(n.publishedAt));
    if (b) b.value += 1;
  }

  const infoCount = totalNotices - activityCount;
  const webCount = totalNotices - wechatCount;
  const days = buckets.map(({ label, value }) => ({ label, value }));
  const today = days[days.length - 1]?.value ?? 0;
  const week = days.reduce((s, d) => s + d.value, 0);

  return {
    today,
    week,
    total: totalNotices,
    activityCount,
    infoCount,
    importantCount,
    webCount,
    wechatCount,
    noticeTotal: totalNotices,
    days,
  };
}

export function SiteShell({
  notices,
  heading,
  activeCategory,
  activeCluster,
  activeSource,
  initialNoticeId,
  now,
  initialQuery = "",
  singleSection = false,
  hideCategoryNav = false,
  initialTotalCount,
  initialCategoryCounts,
  initialPartial = false,
  children,
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
  hideCategoryNav?: boolean;
  initialTotalCount?: number;
  initialCategoryCounts?: Record<string, number>;
  initialPartial?: boolean;
  children?: React.ReactNode;
}) {
  const { lang } = usePreferences();
  const en = lang === "en";

  const [panel, setPanel] = useState<PanelKind>(null);
  const [panelActivated, setPanelActivated] = useState(false);
  const openPanel = useCallback((kind: Exclude<PanelKind, null>) => {
    setPanelActivated(true);
    setPanel(kind);
  }, []);
  const close = useCallback(() => setPanel(null), []);
  const [urlParams, setUrlParams] = useState<UrlQueryState | null>(null);
  const resolvedQuery = STATIC_MODE && urlParams ? urlParams.q : initialQuery;
  const resolvedCluster = STATIC_MODE && urlParams ? urlParams.cluster : activeCluster;
  const resolvedSource = STATIC_MODE && urlParams ? urlParams.source : activeSource;
  const resolvedNoticeId = STATIC_MODE && urlParams ? urlParams.notice : initialNoticeId;

  const [liveNotices, setLiveNotices] = useState<Notice[]>(notices);
  const [liveNow, setLiveNow] = useState<string>(now);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>(now);
  const [isPartial, setIsPartial] = useState<boolean>(Boolean(initialPartial));
  const [loadingFull, setLoadingFull] = useState<boolean>(false);
  const [searchIndex, setSearchIndex] = useState<Record<string, string> | null>(
    () => SEARCH_INDEX_CACHE,
  );
  const [syncing, setSyncing] = useState(false);
  const [autoSyncSec, setAutoSyncSec] = useState<number>(60);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const versionRef = useRef<string | null>(null);
  const syncSecRef = useRef<number>(60);
  const lastCheckRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentIdsRef = useRef<Set<string>>(new Set(notices.map((n) => n.id)));
  const countRef = useRef<number>(notices.length);
  const knownTotalRef = useRef<number>(initialTotalCount ?? notices.length);
  const isPartialRef = useRef<boolean>(Boolean(initialPartial));
  const fullLoadPromiseRef = useRef<Promise<void> | null>(null);
  const topIdRef = useRef<string | null>(notices[0]?.id ?? null);

  isPartialRef.current = isPartial;

  // 路由切换或服务端重传 props 时保持基线同步；若静态会话已缓存全量则直接恢复
  useEffect(() => {
    if (STATIC_MODE && initialPartial && STATIC_FULL_NOTICES_CACHE) {
      const full = STATIC_FULL_NOTICES_CACHE;
      setLiveNotices(full);
      setLiveNow(now);
      setIsPartial(false);
      isPartialRef.current = false;
      currentIdsRef.current = new Set(full.map((n) => n.id));
      countRef.current = full.length;
      knownTotalRef.current = full.length;
      topIdRef.current = full[0]?.id ?? null;
      return;
    }
    setLiveNotices(notices);
    setLiveNow(now);
    setIsPartial(Boolean(initialPartial));
    isPartialRef.current = Boolean(initialPartial);
    currentIdsRef.current = new Set(notices.map((n) => n.id));
    countRef.current = notices.length;
    knownTotalRef.current = initialTotalCount ?? notices.length;
    topIdRef.current = notices[0]?.id ?? null;
  }, [notices, now, initialPartial, initialTotalCount]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg(null);
    }, 3600);
  }, []);

  const ensureFullLoaded = useCallback(async () => {
    if (!isPartialRef.current) return;
    if (STATIC_MODE && STATIC_FULL_NOTICES_CACHE) {
      const cached = STATIC_FULL_NOTICES_CACHE;
      isPartialRef.current = false;
      currentIdsRef.current = new Set(cached.map((n) => n.id));
      countRef.current = cached.length;
      knownTotalRef.current = cached.length;
      topIdRef.current = cached[0]?.id ?? null;
      startTransition(() => {
        setLiveNotices(cached);
        setIsPartial(false);
      });
      return;
    }
    if (fullLoadPromiseRef.current) {
      await fullLoadPromiseRef.current;
      return;
    }

    const run = (async () => {
      setLoadingFull(true);
      try {
        let fetched: Notice[] | null = null;
        if (STATIC_MODE) {
          const res = await fetch("/static-data/notices-summary.json", {
            cache: "default",
          });
          if (res.ok) {
            fetched = (await res.json()) as Notice[];
            STATIC_FULL_NOTICES_CACHE = fetched;
          }
        } else {
          const res = await fetch("/api/notices", { cache: "no-cache" });
          if (res.ok) {
            const payload = (await res.json()) as {
              version?: string;
              notices?: Notice[];
            };
            if (Array.isArray(payload.notices)) {
              fetched = payload.notices;
              if (payload.version) versionRef.current = payload.version;
            }
          }
        }
        if (fetched) {
          isPartialRef.current = false;
          currentIdsRef.current = new Set(fetched.map((n) => n.id));
          countRef.current = fetched.length;
          knownTotalRef.current = fetched.length;
          topIdRef.current = fetched[0]?.id ?? null;
          startTransition(() => {
            setLiveNotices(fetched!);
            setIsPartial(false);
          });
        }
      } catch {
        /* 网络异常时保留已有首屏切片 */
      } finally {
        setLoadingFull(false);
        fullLoadPromiseRef.current = null;
      }
    })();

    fullLoadPromiseRef.current = run;
    await run;
  }, []);

  // 按需补全搜索索引（静态模式下仅在存在关键词时拉取 search-index.json）
  useEffect(() => {
    if (!STATIC_MODE || !resolvedQuery.trim()) return;
    if (SEARCH_INDEX_CACHE) {
      setSearchIndex(SEARCH_INDEX_CACHE);
      return;
    }
    let cancelled = false;
    fetch("/static-data/search-index.json", { cache: "default" })
      .then((r) => (r.ok ? r.json() : null))
      .then((idx: Record<string, string> | null) => {
        if (idx && !cancelled) {
          SEARCH_INDEX_CACHE = idx;
          setSearchIndex(idx);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [resolvedQuery]);

  // 进入筛选/搜索/信息源/统计弹窗时自动拉取全量摘要
  const needsFullForShell =
    isPartial &&
    (Boolean(resolvedQuery.trim()) ||
      Boolean(resolvedCluster) ||
      Boolean(resolvedSource) ||
      panel === "sources" ||
      panel === "stats");

  useEffect(() => {
    if (needsFullForShell) {
      void ensureFullLoaded();
    }
  }, [needsFullForShell, ensureFullLoaded]);

  const performSync = useCallback(
    async ({ forceFull = false }: { forceFull?: boolean } = {}) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      lastCheckRef.current = Date.now();
      if (forceFull) setSyncing(true);

      const isStatic = process.env.NEXT_PUBLIC_STATIC_MODE === "1";

      try {
        let metaVersion = "";
        let metaTotal = countRef.current;
        let metaLatestId: string | null = topIdRef.current;
        let nextSyncSec = syncSecRef.current;
        let metaUpdatedAt = new Date().toISOString();

        if (isStatic) {
          const r = await fetch(`/static-data/manifest.json?t=${Date.now()}`, {
            cache: "no-cache",
            priority: forceFull ? "auto" : "low",
          } as LowPriorityRequestInit);
          if (!r.ok) return;
          const m = (await r.json()) as {
            exportedAt?: string;
            total?: number;
            syncIntervalSec?: number;
          };
          metaTotal = typeof m.total === "number" ? m.total : metaTotal;
          metaUpdatedAt = m.exportedAt ?? metaUpdatedAt;
          metaVersion = `${metaUpdatedAt}:${metaTotal}`;
          if (typeof m.syncIntervalSec === "number") nextSyncSec = m.syncIntervalSec;
        } else {
          const r = await fetch("/api/notices?meta=1", {
            cache: "no-cache",
            priority: forceFull ? "auto" : "low",
          } as LowPriorityRequestInit);
          if (!r.ok) return;
          const m = (await r.json()) as {
            version: string;
            updatedAt: string;
            total: number;
            latestId: string | null;
            syncIntervalSec?: number;
          };
          metaVersion = m.version;
          metaTotal = m.total;
          metaLatestId = m.latestId;
          metaUpdatedAt = m.updatedAt;
          if (typeof m.syncIntervalSec === "number") nextSyncSec = m.syncIntervalSec;
        }

        syncSecRef.current = nextSyncSec;
        setAutoSyncSec(nextSyncSec);

        const isFirst = versionRef.current === null;
        const snapshotBehind =
          metaTotal > 0 &&
          (metaTotal !== knownTotalRef.current ||
            (!isPartialRef.current &&
              Boolean(metaLatestId) &&
              metaLatestId !== topIdRef.current));
        const versionChanged =
          !isFirst && Boolean(metaVersion) && metaVersion !== versionRef.current;

        if (isFirst) {
          versionRef.current = metaVersion;
        }

        if (metaUpdatedAt) {
          setLastSyncedAt(metaUpdatedAt);
        }
        // liveNow 始终保持真实当前时刻（绝不回退到历史抓取时间，以免「今天/昨天」和日历「今天」错位）
        setLiveNow((prev) => {
          const curIso = new Date().toISOString();
          return Date.parse(curIso) > (Date.parse(prev) || 0) ? curIso : prev;
        });

        const shouldFetchFull =
          forceFull || versionChanged || (isFirst && snapshotBehind);

        if (!shouldFetchFull) {
          return;
        }

        setSyncing(true);
        let fetchedNotices: Notice[] | null = null;
        let nextNow = metaUpdatedAt;

        if (isStatic) {
          const fullRes = await fetch(`/static-data/notices-summary.json?t=${Date.now()}`, {
            cache: "no-cache",
            priority: forceFull ? "auto" : "low",
          } as LowPriorityRequestInit);
          if (fullRes.ok) {
            fetchedNotices = (await fullRes.json()) as Notice[];
            STATIC_FULL_NOTICES_CACHE = fetchedNotices;
            nextNow = new Date().toISOString();
          }
        } else {
          const fullRes = await fetch("/api/notices", {
            cache: "no-cache",
            priority: forceFull ? "auto" : "low",
          } as LowPriorityRequestInit);
          if (fullRes.ok) {
            const payload = (await fullRes.json()) as {
              version: string;
              updatedAt: string;
              notices: Notice[];
            };
            fetchedNotices = payload.notices;
            nextNow = payload.updatedAt || new Date().toISOString();
            versionRef.current = payload.version;
          }
        }

        if (!fetchedNotices) return;
        versionRef.current = metaVersion;

        const prevIds = currentIdsRef.current;
        const addedDelta = fetchedNotices.filter((n) => !prevIds.has(n.id)).length;
        const changed =
          addedDelta > 0 ||
          fetchedNotices.length !== knownTotalRef.current ||
          (!isPartialRef.current && fetchedNotices[0]?.id !== topIdRef.current);

        isPartialRef.current = false;
        setLiveNotices(fetchedNotices);
        setIsPartial(false);
        if (nextNow) setLastSyncedAt(nextNow);
        setLiveNow((prev) => {
          const curIso = new Date().toISOString();
          return Date.parse(curIso) > (Date.parse(prev) || 0) ? curIso : prev;
        });
        currentIdsRef.current = new Set(fetchedNotices.map((n) => n.id));
        countRef.current = fetchedNotices.length;
        knownTotalRef.current = fetchedNotices.length;
        topIdRef.current = fetchedNotices[0]?.id ?? null;

        if (addedDelta > 0) {
          showToast(
            en
              ? `Synced ${addedDelta} new notice${addedDelta > 1 ? "s" : ""}`
              : `已自动同步 · 新增 ${addedDelta} 条通知`,
          );
        } else if (changed || forceFull) {
          showToast(
            en
              ? `Up to date (${fetchedNotices.length} notices)`
              : `已同步最新数据 · 共 ${fetchedNotices.length} 条通知`,
          );
        }
      } catch {
        if (forceFull) {
          showToast(en ? "Sync failed, retry later" : "同步检测失败，请稍后重试");
        }
      } finally {
        inFlightRef.current = false;
        setSyncing(false);
      }
    },
    [en, showToast],
  );

  // 客户端自动无感轮询 + 标签页可见性恢复检测
  useEffect(() => {
    let disposed = false;

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const scheduleNext = () => {
      clearTimer();
      if (disposed || document.hidden || syncSecRef.current <= 0) return;
      const delay = Math.max(15, syncSecRef.current) * 1000;
      timerRef.current = setTimeout(async () => {
        if (!disposed && !document.hidden) {
          await performSync({ forceFull: false });
        }
        scheduleNext();
      }, delay);
    };

    const bootstrap = async () => {
      await performSync({ forceFull: false });
      scheduleNext();
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        clearTimer();
      } else {
        const elapsed = Date.now() - lastCheckRef.current;
        if (syncSecRef.current > 0 && elapsed >= 15_000) {
          void performSync({ forceFull: false }).finally(scheduleNext);
        } else {
          scheduleNext();
        }
      }
    };

    const onStorageSync = (e: StorageEvent) => {
      if (e.key === "scau-know-sync-ping") {
        void performSync({ forceFull: true }).finally(scheduleNext);
      }
    };

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        bc = new BroadcastChannel("scau-know-sync");
        bc.onmessage = (ev) => {
          if (ev?.data?.type === "updated") {
            void performSync({ forceFull: true }).finally(scheduleNext);
          }
        };
      } catch {
        bc = null;
      }
    }

    const bootTimer = setTimeout(() => {
      if (!disposed) void bootstrap();
    }, 2500);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("storage", onStorageSync);

    return () => {
      disposed = true;
      clearTimeout(bootTimer);
      clearTimer();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("storage", onStorageSync);
      bc?.close();
    };
  }, [performSync]);

  const computedCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of liveNotices) m[n.category] = (m[n.category] ?? 0) + 1;
    return m;
  }, [liveNotices]);

  const counts =
    isPartial && initialCategoryCounts ? initialCategoryCounts : computedCounts;
  const displayTotalCount =
    isPartial && initialTotalCount ? initialTotalCount : liveNotices.length;

  const sources = useMemo<SourceRef[]>(() => {
    interface SourceAcc {
      count: number;
      webCount: number;
      wechatCount: number;
      tone: Notice["tone"];
      latestWechatUrl?: string;
      latestWechatMs: number;
    }

    const statsByName = new Map<string, SourceAcc>();
    for (const n of liveNotices) {
      const wx = isWechatNotice(n);
      const pubMs = Date.parse(n.publishedAt) || 0;
      const cur = statsByName.get(n.source);
      if (!cur) {
        statsByName.set(n.source, {
          count: 1,
          webCount: wx ? 0 : 1,
          wechatCount: wx ? 1 : 0,
          tone: n.tone,
          latestWechatUrl: wx ? n.url : undefined,
          latestWechatMs: wx ? pubMs : -1,
        });
      } else {
        cur.count += 1;
        if (wx) {
          cur.wechatCount += 1;
          if (pubMs >= cur.latestWechatMs) {
            cur.latestWechatUrl = n.url;
            cur.latestWechatMs = pubMs;
          }
        } else {
          cur.webCount += 1;
        }
      }
    }

    // 合并已预置但当前窗口尚未拉取到文章的独立公众号源，方便在「信息来源」检索与提前星标
    for (const acc of STANDALONE_WECHAT_ACCOUNTS) {
      if (statsByName.has(acc.name)) continue;
      const catTone = (acc.category ? CATEGORY_MAP.get(acc.category)?.tone : undefined) ?? "leaf";
      statsByName.set(acc.name, {
        count: 0,
        webCount: 0,
        wechatCount: 0,
        tone: catTone,
        latestWechatUrl: undefined,
        latestWechatMs: -1,
      });
    }

    return [...statsByName.entries()]
      .map(([name, st]) => {
        const linked = wechatAccountsOfSource(name);
        const wechatAccounts = linked.map((a) => a.name);
        const wechatIds = linked
          .map((a) => a.wechatId)
          .filter((id): id is string => Boolean(id));
        const wechatOnly =
          st.webCount === 0 && (st.wechatCount > 0 || linked.some((a) => !a.sourceId));
        const kind = kindOfSource(name, wechatOnly);
        const url = officialWebsiteUrl(name);
        const wechat =
          linked[0]?.name ?? (st.wechatCount > 0 || kind === "wechat" ? name : undefined);

        return {
          name,
          shortName: shortSourceName(name),
          count: st.count,
          webCount: st.webCount,
          wechatCount: st.wechatCount,
          tone: st.tone,
          kind,
          url,
          wechat,
          wechatId: wechatIds[0],
          wechatAccounts: wechatAccounts.length > 0 ? wechatAccounts : undefined,
          wechatIds: wechatIds.length > 0 ? wechatIds : undefined,
          latestWechatUrl: st.latestWechatUrl,
        } satisfies SourceRef;
      })
      .sort(
        (a, b) =>
          b.count - a.count ||
          b.wechatCount - a.wechatCount ||
          a.name.localeCompare(b.name, "zh"),
      );
  }, [liveNotices]);

  const stats = useMemo(() => buildStats(liveNotices, liveNow), [liveNotices, liveNow]);

  const updatedLabel = useMemo(() => {
    const p = toCstParts(lastSyncedAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}`;
  }, [lastSyncedAt]);

  const handleManualSync = useCallback(() => {
    void performSync({ forceFull: true });
  }, [performSync]);

  const contextVal = useMemo(
    () => ({
      notices: liveNotices,
      now: liveNow,
      syncing,
      refresh: handleManualSync,
    }),
    [liveNotices, liveNow, syncing, handleManualSync],
  );

  return (
    <div className="app-shell" data-campus="scau">
      {STATIC_MODE && (
        <Suspense fallback={null}>
          <UrlQueryBridge onSync={setUrlParams} />
        </Suspense>
      )}
      <a className="skip-link" href="#notices">
        跳转至通知列表
      </a>

      <Masthead
        initialQuery={resolvedQuery}
        totalCount={displayTotalCount}
        onOpenInfo={() => openPanel("info")}
        onOpenSources={() => openPanel("sources")}
        onOpenMessage={() => openPanel("message")}
        onOpenStats={() => openPanel("stats")}
      />

      {!hideCategoryNav && (
        <CategoryNav
          counts={counts}
          activeCategory={activeCategory}
          activeCluster={resolvedCluster}
          currentQuery={resolvedQuery}
        />
      )}

      <LiveNoticesContext.Provider value={contextVal}>
        <main id="notices" className="app-main">
          {children ?? (
            <NoticeBoard
              notices={liveNotices}
              heading={heading}
              activeCategory={activeCategory}
              activeCluster={resolvedCluster}
              activeSource={resolvedSource}
              initialNoticeId={resolvedNoticeId}
              now={liveNow}
              initialQuery={resolvedQuery}
              singleSection={singleSection}
              isPartial={isPartial}
              loadingFull={loadingFull}
              totalCount={displayTotalCount}
              categoryCounts={counts}
              searchIndex={searchIndex}
              onRequestFullData={() => void ensureFullLoaded()}
              onOpenSources={() => openPanel("sources")}
            />
          )}
        </main>
      </LiveNoticesContext.Provider>

      <SiteFooter
        totalCount={displayTotalCount}
        updatedAt={updatedLabel}
        autoSyncSec={autoSyncSec}
        syncing={syncing}
        onManualSync={() => void performSync({ forceFull: true })}
      />

      {panelActivated && (
        <PanelHost panel={panel} onClose={close} sources={sources} stats={stats} />
      )}

      {toastMsg && (
        <div className="sync-toast" role="status" aria-live="polite">
          <RefreshCw aria-hidden="true" />
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  );
}
