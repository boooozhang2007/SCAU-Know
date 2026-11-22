"use client";

import { usePreferences } from "@/lib/preferences";

export type { Scheme as ThemeMode } from "@/lib/preferences";

/** 兼容层：对外导出与旧代码一致的 useTheme 接口 */
export function useTheme() {
  const { resolvedScheme, toggleScheme, hydrated } = usePreferences();
  return {
    mode: resolvedScheme,
    toggle: toggleScheme,
    mounted: hydrated,
  };
}
