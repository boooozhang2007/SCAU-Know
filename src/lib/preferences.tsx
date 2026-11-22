"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Scheme = "light" | "dark";
export type StoredScheme = Scheme | null;
export type Lang = "zh" | "en";
export type ViewMode = "time" | "star-first" | "star-only";

const SCHEME_KEY = "scau-know-color-scheme";
const LANG_KEY = "scau-know-lang";
const STAR_KEY = "scau-know-starred";
const VIEW_KEY = "scau-know-view-mode";
const DESKTOP_COLS_KEY = "scau-know-cols-desktop";
const MOBILE_COLS_KEY = "scau-know-cols-mobile";

export const DESKTOP_COL_OPTIONS = [3, 4, 5, 6] as const;
export const MOBILE_COL_OPTIONS = [1, 2] as const;

function getSystemScheme(): Scheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredScheme(): StoredScheme {
  try {
    const v = window.localStorage.getItem(SCHEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function applySchemeMeta(stored: StoredScheme) {
  if (typeof document === "undefined") return;
  const content = stored ?? "light dark";
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "color-scheme";
    document.head.appendChild(meta);
  }
  meta.content = content;
  const root = document.documentElement;
  if (stored) {
    root.dataset.theme = stored;
  } else {
    delete root.dataset.theme;
  }
}

interface PreferencesContextValue {
  /** 当前实际渲染的主题 */
  resolvedScheme: Scheme;
  /** 用户显式覆盖值，null 表示跟随系统 */
  storedScheme: StoredScheme;
  toggleScheme: () => void;
  lang: Lang;
  toggleLang: () => void;
  starred: string[];
  isStarred: (source: string) => boolean;
  toggleStar: (source: string) => void;
  starAll: (sources: string[]) => void;
  clearStars: () => void;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  desktopCols: number;
  setDesktopCols: (n: number) => void;
  mobileCols: number;
  setMobileCols: (n: number) => void;
  hydrated: boolean;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [storedScheme, setStoredScheme] = useState<StoredScheme>(null);
  const [systemScheme, setSystemScheme] = useState<Scheme>("light");
  const [lang, setLang] = useState<Lang>("zh");
  const [starred, setStarred] = useState<string[]>([]);
  const [viewMode, setViewModeState] = useState<ViewMode>("time");
  const [desktopCols, setDesktopColsState] = useState<number>(6);
  const [mobileCols, setMobileColsState] = useState<number>(2);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sys: Scheme = mq.matches ? "dark" : "light";
    setSystemScheme(sys);

    const savedScheme = readStoredScheme();
    setStoredScheme(savedScheme);
    applySchemeMeta(savedScheme);

    try {
      const savedLang = window.localStorage.getItem(LANG_KEY);
      if (savedLang === "zh" || savedLang === "en") {
        setLang(savedLang);
        document.documentElement.dataset.language = savedLang;
      }
      const savedStars = window.localStorage.getItem(STAR_KEY);
      if (savedStars) {
        const parsed = JSON.parse(savedStars);
        if (Array.isArray(parsed)) setStarred(parsed.filter((x) => typeof x === "string"));
      }
      const savedView = window.localStorage.getItem(VIEW_KEY);
      if (savedView === "time" || savedView === "star-first" || savedView === "star-only") {
        setViewModeState(savedView);
      }
      const savedD = Number(window.localStorage.getItem(DESKTOP_COLS_KEY));
      if ((DESKTOP_COL_OPTIONS as readonly number[]).includes(savedD)) {
        setDesktopColsState(savedD);
      }
      const savedM = Number(window.localStorage.getItem(MOBILE_COLS_KEY));
      if ((MOBILE_COL_OPTIONS as readonly number[]).includes(savedM)) {
        setMobileColsState(savedM);
      }
    } catch {
      /* 隐私模式下忽略 */
    }

    setHydrated(true);

    // 监听系统配色切换：仅更新 systemScheme，绝不清除用户显式存储的偏好
    const onMqChange = (e: MediaQueryListEvent) => {
      setSystemScheme(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onMqChange);

    // 跨标签页同步
    const onStorage = (e: StorageEvent) => {
      if (e.key === SCHEME_KEY) {
        const next: StoredScheme =
          e.newValue === "light" || e.newValue === "dark" ? e.newValue : null;
        setStoredScheme(next);
        applySchemeMeta(next);
      } else if (e.key === STAR_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed)) setStarred(parsed);
        } catch {
          /* 忽略 */
        }
      } else if (e.key === LANG_KEY && (e.newValue === "zh" || e.newValue === "en")) {
        setLang(e.newValue);
        document.documentElement.dataset.language = e.newValue;
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      mq.removeEventListener("change", onMqChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const resolvedScheme: Scheme = storedScheme ?? systemScheme;

  /**
   * 两态明暗切换（遵循 modern-web-guidance `dark-mode-toggle` 规范）：
   * - 目标 = 当前所见配色的反色
   * - 若目标与系统偏好一致，则删除存储值以恢复跟随系统（content="light dark"）
   * - 若目标与系统偏好不同，则存储目标字面量（"light" 或 "dark"）
   */
  const toggleScheme = useCallback(() => {
    const sys = getSystemScheme();
    const current = readStoredScheme() ?? sys;
    const target: Scheme = current === "dark" ? "light" : "dark";
    const nextStored: StoredScheme = target === sys ? null : target;
    setStoredScheme(nextStored);
    applySchemeMeta(nextStored);
    try {
      if (nextStored === null) {
        window.localStorage.removeItem(SCHEME_KEY);
      } else {
        window.localStorage.setItem(SCHEME_KEY, nextStored);
      }
    } catch {
      /* 即使无法持久化也保持当前页面主题已生效 */
    }
  }, []);

  const toggleLang = useCallback(() => {
    setLang((prev) => {
      const next: Lang = prev === "zh" ? "en" : "zh";
      if (typeof document !== "undefined") {
        document.documentElement.dataset.language = next;
      }
      try {
        window.localStorage.setItem(LANG_KEY, next);
      } catch {
        /* 忽略 */
      }
      return next;
    });
  }, []);

  const starredSet = useMemo(() => new Set(starred), [starred]);

  const isStarred = useCallback((source: string) => starredSet.has(source), [starredSet]);

  const persistStars = useCallback((next: string[]) => {
    setStarred(next);
    try {
      window.localStorage.setItem(STAR_KEY, JSON.stringify(next));
    } catch {
      /* 忽略 */
    }
  }, []);

  const toggleStar = useCallback(
    (source: string) => {
      const next = starredSet.has(source)
        ? starred.filter((s) => s !== source)
        : [...starred, source];
      persistStars(next);
    },
    [starred, starredSet, persistStars],
  );

  const starAll = useCallback(
    (sources: string[]) => {
      const merged = [...new Set([...starred, ...sources])];
      persistStars(merged);
    },
    [starred, persistStars],
  );

  const clearStars = useCallback(() => {
    persistStars([]);
  }, [persistStars]);

  const setViewMode = useCallback((m: ViewMode) => {
    setViewModeState(m);
    try {
      window.localStorage.setItem(VIEW_KEY, m);
    } catch {
      /* 忽略 */
    }
  }, []);

  const setDesktopCols = useCallback((n: number) => {
    setDesktopColsState(n);
    try {
      window.localStorage.setItem(DESKTOP_COLS_KEY, String(n));
    } catch {
      /* 忽略 */
    }
  }, []);

  const setMobileCols = useCallback((n: number) => {
    setMobileColsState(n);
    try {
      window.localStorage.setItem(MOBILE_COLS_KEY, String(n));
    } catch {
      /* 忽略 */
    }
  }, []);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      resolvedScheme,
      storedScheme,
      toggleScheme,
      lang,
      toggleLang,
      starred,
      isStarred,
      toggleStar,
      starAll,
      clearStars,
      viewMode,
      setViewMode,
      desktopCols,
      setDesktopCols,
      mobileCols,
      setMobileCols,
      hydrated,
    }),
    [
      resolvedScheme,
      storedScheme,
      toggleScheme,
      lang,
      toggleLang,
      starred,
      isStarred,
      toggleStar,
      starAll,
      clearStars,
      viewMode,
      setViewMode,
      desktopCols,
      setDesktopCols,
      mobileCols,
      setMobileCols,
      hydrated,
    ],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error("usePreferences must be used within PreferencesProvider");
  }
  return ctx;
}
