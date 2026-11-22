"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { CalendarList } from "@/components/calendar-list";
import { useLiveNotices } from "@/components/site-shell";
import { CATEGORIES, CATEGORY_MAP } from "@/lib/site";
import type { Notice } from "@/lib/types";

const STATIC_MODE = process.env.NEXT_PUBLIC_STATIC_MODE === "1";

function CalendarQueryBridge({
  onCategory,
}: {
  onCategory: (cat: string | null) => void;
}) {
  const sp = useSearchParams();
  const raw = sp.get("category")?.trim() ?? "";
  const resolved = raw && CATEGORY_MAP.has(raw) ? raw : null;

  useEffect(() => {
    onCategory(resolved);
  }, [resolved, onCategory]);

  return null;
}

export function CalendarPageClient({
  initialNotices,
  initialNow,
  activeCat,
}: {
  initialNotices: Notice[];
  initialNow: string;
  activeCat: string | null;
}) {
  const { notices, now } = useLiveNotices(initialNotices, initialNow);
  const [clientCat, setClientCat] = useState<string | null>(activeCat);
  const effectiveCat = STATIC_MODE ? clientCat : activeCat;

  const catMeta = effectiveCat ? CATEGORY_MAP.get(effectiveCat) : null;
  const scoped = effectiveCat
    ? notices.filter((n) => n.category === effectiveCat)
    : notices;
  const eventCount = scoped.filter((n) => n.startsAt).length;

  const filterCats = CATEGORIES.filter((c) =>
    notices.some((n) => n.startsAt && n.category === c.slug),
  );

  return (
    <div className="page-shell calendar-page-shell">
      {STATIC_MODE && (
        <Suspense fallback={null}>
          <CalendarQueryBridge onCategory={setClientCat} />
        </Suspense>
      )}
      <div className="calendar-page-header">
        <div className="page-heading">
          <span className="calendar-title-icon" aria-hidden="true">
            <CalendarDays />
          </span>
          <h1>{catMeta ? `${catMeta.name}日历` : "活动日历"}</h1>
          <span className="board-total">{eventCount}</span>
        </div>
        <p className="page-sub">
          共 {eventCount} 场已识别排期活动，按北京时间（UTC+8）展示，点击日程可查看详情与原文。
        </p>

        {filterCats.length > 0 && (
          <div className="calendar-filter">
            <Link
              className="calendar-cat-chip"
              href="/calendar"
              aria-current={!effectiveCat ? "page" : undefined}
            >
              全部
            </Link>
            {filterCats.map((c) => (
              <Link
                key={c.slug}
                className="calendar-cat-chip"
                href={`/calendar?category=${c.slug}`}
                data-tone={c.tone}
                aria-current={effectiveCat === c.slug ? "page" : undefined}
              >
                {c.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      <CalendarList notices={scoped} now={now} />
    </div>
  );
}
