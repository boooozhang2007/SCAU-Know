"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * 响应式最短列瀑布流：
 * - 所有实例共享同一套 matchMedia 断点订阅（消除每板块独立 resize 监听器开销）
 * - 首屏 SSR 与初次水合严格使用确定性预估高度权重（weights）做贪心最短列分配，零水合偏差
 * - 客户端挂载后通过 ResizeObserver 测量实际列高与卡片高度，最多执行 2 轮自校准，收敛列高差
 */
const BREAKPOINTS = [
  { query: "(max-width: 760px)", mobile: true, maxCols: 2 },
  { query: "(max-width: 960px)", mobile: false, maxCols: 3 },
  { query: "(max-width: 1200px)", mobile: false, maxCols: 4 },
  { query: "(max-width: 1400px)", mobile: false, maxCols: 5 },
] as const;

const DEFAULT_SNAPSHOT = 6; // mobile=0, maxCols=6（与桌面首屏服务端渲染一致）
const DEFAULT_CARD_WEIGHT = 180;
const IMBALANCE_THRESHOLD_PX = 150;
const MIN_HEIGHT_DELTA_PX = 6;
const MAX_REFINEMENT_PASSES = 2;

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
  weights,
  className,
}: {
  children: ReactNode;
  cols: number;
  mobileCols?: number;
  gap?: number;
  /** 与 children 一一对应的预估卡片高度（px），用于 SSR 与首次渲染的确定性最短列分配 */
  weights?: number[];
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

  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const containerRef = useRef<HTMLDivElement | null>(null);
  const colRefs = useRef<(HTMLUListElement | null)[]>([]);
  const refineRef = useRef({ sig: "", widthBucket: 0, passes: 0 });
  const colKeyGridRef = useRef<string[][]>([]);

  const { columns, itemSig, colKeyGrid } = useMemo(() => {
    const items = Children.toArray(children);
    const buckets: ReactNode[][] = Array.from({ length: effective }, () => []);
    const keyGrid: string[][] = Array.from({ length: effective }, () => []);
    const colHeights = new Array<number>(effective).fill(0);
    const keys: string[] = new Array(items.length);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = isValidElement(item) && item.key != null ? String(item.key) : String(i);
      keys[i] = key;

      let targetCol = 0;
      for (let c = 1; c < effective; c++) {
        // 严格 `<` 保证初始等高时优先左侧列，使首行按时间从左到右排列
        if (colHeights[c] < colHeights[targetCol]) {
          targetCol = c;
        }
      }

      buckets[targetCol].push(item);
      keyGrid[targetCol].push(key);
      const h = measuredHeights[key] ?? weights?.[i] ?? DEFAULT_CARD_WEIGHT;
      colHeights[targetCol] += h + gap;
    }

    return {
      columns: buckets,
      itemSig: `${effective}:${keys.join(",")}`,
      colKeyGrid: keyGrid,
    };
  }, [children, effective, gap, measuredHeights, weights]);

  colKeyGridRef.current = colKeyGrid;

  useEffect(() => {
    if (refineRef.current.sig !== itemSig) {
      refineRef.current.sig = itemSig;
      refineRef.current.passes = 0;
    }
  }, [itemSig]);

  useEffect(() => {
    if (effective <= 1 || typeof ResizeObserver === "undefined") return;
    const containerEl = containerRef.current;
    if (!containerEl) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let rafId = 0;

    const inspectAndRefine = () => {
      const containerW = containerEl.getBoundingClientRect().width;
      if (containerW <= 0) return;

      const widthBucket = Math.round(containerW / 32);
      if (refineRef.current.widthBucket === 0) {
        refineRef.current.widthBucket = widthBucket;
      } else if (widthBucket !== refineRef.current.widthBucket) {
        refineRef.current.widthBucket = widthBucket;
        refineRef.current.passes = 0;
        setMeasuredHeights((prev) => (Object.keys(prev).length > 0 ? {} : prev));
        return;
      }

      if (refineRef.current.passes >= MAX_REFINEMENT_PASSES) return;

      let minColH = Infinity;
      let maxColH = 0;
      const activeCols = colRefs.current.slice(0, effective);
      for (const ul of activeCols) {
        if (!ul) continue;
        const h = ul.getBoundingClientRect().height;
        if (h < minColH) minColH = h;
        if (h > maxColH) maxColH = h;
      }
      if (!Number.isFinite(minColH) || maxColH - minColH <= IMBALANCE_THRESHOLD_PX) {
        return;
      }

      const nextMeasurements: Record<string, number> = {};
      const keyGrid = colKeyGridRef.current;
      for (let ci = 0; ci < effective; ci++) {
        const ul = activeCols[ci];
        const colKeys = keyGrid[ci];
        if (!ul || !colKeys) continue;
        const lis = ul.children;
        const count = Math.min(lis.length, colKeys.length);
        for (let li = 0; li < count; li++) {
          const rectH = Math.round(lis[li].getBoundingClientRect().height);
          if (rectH > 0) {
            nextMeasurements[colKeys[li]] = rectH;
          }
        }
      }

      if (Object.keys(nextMeasurements).length === 0) return;

      setMeasuredHeights((prev) => {
        let changed = false;
        for (const [k, v] of Object.entries(nextMeasurements)) {
          if (prev[k] === undefined || Math.abs(prev[k] - v) >= MIN_HEIGHT_DELTA_PX) {
            changed = true;
            break;
          }
        }
        if (!changed) return prev;
        refineRef.current.passes += 1;
        return { ...prev, ...nextMeasurements };
      });
    };

    const scheduleCheck = () => {
      if (timer) clearTimeout(timer);
      if (rafId) cancelAnimationFrame(rafId);
      timer = setTimeout(() => {
        rafId = requestAnimationFrame(inspectAndRefine);
      }, 100);
    };

    const ro = new ResizeObserver(scheduleCheck);
    ro.observe(containerEl);
    for (let ci = 0; ci < effective; ci++) {
      const ul = colRefs.current[ci];
      if (ul) ro.observe(ul);
    }
    scheduleCheck();

    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [effective, itemSig]);

  return (
    <div
      ref={containerRef}
      className={`waterfall-columns ${className ?? ""}`}
      style={{ gap: `${gap}px` }}
      role="list"
      aria-label="信息卡片列表"
    >
      {columns.map((col, ci) => (
        <ul
          key={ci}
          ref={(el) => {
            colRefs.current[ci] = el;
          }}
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
