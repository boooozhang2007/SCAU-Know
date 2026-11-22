import type { Metadata } from "next";
import { loadNoticeSummaries } from "@/lib/data";
import { SiteShell } from "@/components/site-shell";
import { CalendarPageClient } from "@/components/calendar-page-client";
import { CATEGORY_MAP } from "@/lib/site";

export const metadata: Metadata = {
  title: "活动日历｜「华农知道」SCAU Know",
  description: "按周与日期查看华南农业大学近期学术讲座、校园活动与公开日程。",
};

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const activeCat = category && CATEGORY_MAP.has(category) ? category : null;

  const { notices: NOTICES } = await loadNoticeSummaries(nowDate);

  return (
    <SiteShell
      notices={NOTICES}
      heading="活动日历"
      activeCategory={activeCat}
      hideCategoryNav
      now={now}
    >
      <CalendarPageClient
        initialNotices={NOTICES}
        initialNow={now}
        activeCat={activeCat}
      />
    </SiteShell>
  );
}
