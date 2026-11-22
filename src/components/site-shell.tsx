"use client";

import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Masthead, SiteFooter } from "@/components/masthead";
import { CategoryNav } from "@/components/category-nav";
import { NoticeBoard } from "@/components/notice-board";
import { PanelHost, type PanelKind, type StatsData } from "@/components/panel-host";
import type { Notice, SourceRef } from "@/lib/types";
import type { CategoryIntent } from "@/lib/site";
import { countBySource, toCstParts } from "@/lib/format";
import {
  kindOfSource,
  shortSourceName,
  sourceUrl,
  wechatOfSource,
} from "@/lib/sources";
import { usePreferences } from "@/lib/preferences";

interface LiveNoticesContextValue {
  notices: Notice[];
  now: string;
}

interface LowPriorityRequestInit extends RequestInit {
  priority?: "high" | "low" | "auto";
}

const LiveNoticesContext = createContext<LiveNoticesContextValue | null>(null);

const STATIC_MODE = process.env.NEXT_PUBLIC_STATIC_MODE === "1";

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
  return ctx ?? { notices: fallbackNotices, now: fallbackNow };
}

/** 演示用访问量：以条目总量为基数派生，保证 SSR 与客户端水合一致 */
function buildStats(notices: Notice[], nowIso: string): StatsData {
  const totalNotices = notices.length;
  const activityCount = notices.filter((n) => n.cluster === "activity").length;
  const infoCount = totalNotices - activityCount;
  const seed = totalNotices * 37 + 11;
  const nowMs = new Date(nowIso).getTime();
  const pad = (n: number) => String(n).padStart(2, "0");

  const days = Array.from({ length: 7 }, (_, i) => {
    const dtIso = new Date(nowMs - (6 - i) * 86400000).toISOString();
    const p = toCstParts(dtIso);
    const val = Math.round(420 + ((seed * (i + 5) * 17) % 680));
    return { label: `${pad(p.m)}/${pad(p.d)}`, value: val };
  });

  const week = days.reduce((s, d) => s + d.value, 0);
  return {
    today: days[days.length - 1].value,
    week,
    total: week * 19 + seed * 3,
    activityCount,
    infoCount,
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
  children?: React.ReactNode;
}) {
  const { lang } = usePreferences();
  const en = lang === "en";

  const [panel, setPanel] = useState<PanelKind>(null);
  const close = useCallback(() => setPanel(null), []);
  const [urlParams, setUrlParams] = useState<UrlQueryState | null>(null);
  const resolvedQuery = STATIC_MODE && urlParams ? urlParams.q : initialQuery;
  const resolvedCluster = STATIC_MODE && urlParams ? urlParams.cluster : activeCluster;
  const resolvedSource = STATIC_MODE && urlParams ? urlParams.source : activeSource;
  const resolvedNoticeId = STATIC_MODE && urlParams ? urlParams.notice : initialNoticeId;

  const [liveNotices, setLiveNotices] = useState<Notice[]>(notices);
  const [liveNow, setLiveNow] = useState<string>(now);
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
  const topIdRef = useRef<string | null>(notices[0]?.id ?? null);

  // 路由切换或服务端重传 props 时保持基线同步
  useEffect(() => {
    setLiveNotices(notices);
    setLiveNow(now);
    currentIdsRef.current = new Set(notices.map((n) => n.id));
    countRef.current = notices.length;
    topIdRef.current = notices[0]?.id ?? null;
  }, [notices, now]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg(null);
    }, 3600);
  }, []);

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
          (metaTotal !== countRef.current ||
            (Boolean(metaLatestId) && metaLatestId !== topIdRef.current));
        const versionChanged =
          !isFirst && Boolean(metaVersion) && metaVersion !== versionRef.current;

        if (isFirst) {
          versionRef.current = metaVersion;
        }

        if (metaUpdatedAt) {
          setLiveNow((prev) => {
            const prevMs = new Date(prev).getTime();
            const nextMs = new Date(metaUpdatedAt).getTime();
            if (!Number.isNaN(nextMs) && (Number.isNaN(prevMs) || nextMs > prevMs)) {
              return metaUpdatedAt;
            }
            return prev;
          });
        }

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
          fetchedNotices.length !== countRef.current ||
          fetchedNotices[0]?.id !== topIdRef.current;

        setLiveNotices(fetchedNotices);
        setLiveNow(nextNow);
        currentIdsRef.current = new Set(fetchedNotices.map((n) => n.id));
        countRef.current = fetchedNotices.length;
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

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of liveNotices) m[n.category] = (m[n.category] ?? 0) + 1;
    return m;
  }, [liveNotices]);

  const sources = useMemo<SourceRef[]>(() => {
    const map = countBySource(liveNotices);
    return [...map.entries()]
      .map(([name, count]) => ({
        name,
        shortName: shortSourceName(name),
        count,
        tone: liveNotices.find((n) => n.source === name)?.tone ?? "leaf",
        kind: kindOfSource(name),
        url: sourceUrl(name),
        wechat: wechatOfSource(name),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));
  }, [liveNotices]);

  const stats = useMemo(() => buildStats(liveNotices, liveNow), [liveNotices, liveNow]);

  const updatedLabel = useMemo(() => {
    const p = toCstParts(liveNow);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}`;
  }, [liveNow]);

  const contextVal = useMemo(
    () => ({ notices: liveNotices, now: liveNow }),
    [liveNotices, liveNow],
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
        totalCount={liveNotices.length}
        onOpenInfo={() => setPanel("info")}
        onOpenSources={() => setPanel("sources")}
        onOpenMessage={() => setPanel("message")}
        onOpenStats={() => setPanel("stats")}
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
              onOpenSources={() => setPanel("sources")}
            />
          )}
        </main>
      </LiveNoticesContext.Provider>

      <SiteFooter
        totalCount={liveNotices.length}
        updatedAt={updatedLabel}
        autoSyncSec={autoSyncSec}
        syncing={syncing}
        onManualSync={() => void performSync({ forceFull: true })}
      />

      <PanelHost panel={panel} onClose={close} sources={sources} stats={stats} />

      {toastMsg && (
        <div className="sync-toast" role="status" aria-live="polite">
          <RefreshCw aria-hidden="true" />
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  );
}
