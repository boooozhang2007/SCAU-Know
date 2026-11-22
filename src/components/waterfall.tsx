"use client";

import { Children, useMemo, useSyncExternalStore, type ReactNode } from "react";

/**
 * 响应式多列瀑布流：
 * - 所有实例共享同一套 matchMedia 断点订阅（消除每板块独立 resize 监听器开销）
 * - 纯列分配不依赖 ResizeObserver 测高，条目顺序稳定、永不丢项
 */
const BREAKPOINTS = [
  { query: "(max-width: 760px)", mobile: true, maxCols: 2 },
  { query: "(max-width: 960px)", mobile: false, maxCols: 3 },
  { query: "(max-width: 1200px)", mobile: false, maxCols: 4 },
  { query: "(max-width: 1400px)", mobile: false, maxCols: 5 },
] as const;

const DEFAULT_SNAPSHOT = 6; // mobile=0, maxCols=6（与桌面首屏服务端渲染一致）

function readBreakpointSnapshot(): number {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return DEFAULT_SNAPSHOT;
  }
  for (const bp of BREAKPOINTS) {
    if (window.matchMedia(bp.query).matches) {
      return (bp.mobile ? 16 : 0) | bp.maxCols;
    }
  }
  return DEFAULT_SNAPSHOT;
}

function getServerSnapshot(): number {
  return DEFAULT_SNAPSHOT;
}

const listeners = new Set<() => void>();
let mqlCleanup: (() => void) | null = null;

function ensureBreakpointListeners() {
  if (mqlCleanup || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }
  const mqls = BREAKPOINTS.map((bp) => window.matchMedia(bp.query));
  const notify = () => {
    for (const cb of listeners) cb();
  };
  for (const mql of mqls) {
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", notify);
    } else {
      mql.addListener(notify);
    }
  }
  mqlCleanup = () => {
    for (const mql of mqls) {
      if (typeof mql.removeEventListener === "function") {
        mql.removeEventListener("change", notify);
      } else {
        mql.removeListener(notify);
      }
    }
    mqlCleanup = null;
  };
}

function subscribeBreakpoints(listener: () => void): () => void {
  listeners.add(listener);
  ensureBreakpointListeners();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && mqlCleanup) {
      mqlCleanup();
    }
  };
}

export function WaterfallGrid({
  children,
  cols,
  mobileCols = 2,
  gap = 10,
  className,
}: {
  children: ReactNode;
  cols: number;
  mobileCols?: number;
  gap?: number;
  className?: string;
}) {
  const snap = useSyncExternalStore(
    subscribeBreakpoints,
    readBreakpointSnapshot,
    getServerSnapshot,
  );
  const isMobile = (snap & 16) !== 0;
  const maxCols = snap & 15;

  const effective = isMobile
    ? Math.max(1, mobileCols)
    : Math.max(1, Math.min(cols, maxCols));

  const columns = useMemo(() => {
    const items = Children.toArray(children);
    const buckets: ReactNode[][] = Array.from({ length: effective }, () => []);
    items.forEach((item, i) => {
      buckets[i % effective].push(item);
    });
    return buckets;
  }, [children, effective]);

  return (
    <div
      className={`waterfall-columns ${className ?? ""}`}
      style={{ gap: `${gap}px` }}
      role="list"
      aria-label="信息卡片列表"
    >
      {columns.map((col, ci) => (
        <ul
          key={ci}
          className="waterfall-col"
          style={{ gap: `${gap}px` }}
          role="presentation"
        >
          {col}
        </ul>
      ))}
    </div>
  );
}
