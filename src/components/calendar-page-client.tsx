"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDays, X } from "lucide-react";
import { CalendarList } from "@/components/calendar-list";
import { useLiveNotices } from "@/components/site-shell";
import { CATEGORY_MAP } from "@/lib/site";
import { usePreferences } from "@/lib/preferences";
import { categoryName } from "@/lib/format";
import type { Notice } from "@/lib/types";

const STATIC_MODE = process.env.NEXT_PUBLIC_STATIC_MODE === "1";

function CalendarQueryBridge({
  onSync,
}: {
  onSync: (next: { category: string | null; date: string | null }) => void;
}) {
  const sp = useSearchParams();
  const rawCat = sp.get("category")?.trim() ?? "";
  const category = rawCat && CATEGORY_MAP.has(rawCat) ? rawCat : null;
  const rawDate = sp.get("date")?.trim() ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;

  useEffect(() => {
    onSync({ category, date });
  }, [category, date, onSync]);

  return null;
}

export function CalendarPageClient({
  initialNotices,
  initialNow,
  activeCat,
  initialDate = null,
}: {
  initialNotices: Notice[];
  initialNow: string;
  activeCat: string | null;
  initialDate?: string | null;
}) {
  const { notices, now, syncing, refresh } = useLiveNotices(initialNotices, initialNow);
  const { lang } = usePreferences();
  const en = lang === "en";
  const [clientQuery, setClientQuery] = useState<{
    category: string | null;
    date: string | null;
  }>({ category: activeCat, date: initialDate });

  const effectiveCat = STATIC_MODE ? clientQuery.category : activeCat;
  const effectiveDate = STATIC_MODE ? clientQuery.date : initialDate;

  const scoped = effectiveCat
    ? notices.filter((n) => n.category === effectiveCat)
    : notices;

  return (
    <div className="page-shell calendar-page-shell">
      {STATIC_MODE && (
        <Suspense fallback={null}>
          <CalendarQueryBridge onSync={setClientQuery} />
        </Suspense>
      )}

      <div className="calendar-page-header">
        <div className="page-heading">
          <span className="calendar-title-icon" aria-hidden="true">
            <CalendarDays />
          </span>
          <h1>
            {effectiveCat
              ? en
                ? `${categoryName(effectiveCat, lang)} Calendar`
                : `${categoryName(effectiveCat, lang)}日历`
              : en
                ? "Activity Calendar"
                : "活动日历"}
          </h1>
          {effectiveCat && (
            <Link
              href="/calendar"
              className="active-filter-chip"
              title={en ? "Clear category filter" : "查看全部分类活动"}
            >
              <span>{categoryName(effectiveCat, lang)}</span>
              <X aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      <CalendarList
        notices={scoped}
        now={now}
        initialDate={effectiveDate}
        syncing={syncing}
        onRefresh={refresh}
      />
    </div>
  );
}
