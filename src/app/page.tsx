import { loadInitialHomeSlice, loadNoticeSummaries } from "@/lib/data";
import { SiteShell } from "@/components/site-shell";
import { CATEGORIES, type CategoryIntent } from "@/lib/site";

// 抓取结果随时可能更新，禁用静态化
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    cluster?: string;
    source?: string;
    notice?: string;
  }>;
}) {
  const { q, cluster, source, notice } = await searchParams;
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const hydrateId = notice?.trim() || null;
  const hasFilters = Boolean(q?.trim() || cluster || source?.trim());

  let notices;
  let totalCount: number;
  let categoryCounts: Record<string, number> | undefined;
  let partial = false;

  if (!hasFilters) {
    const slice = await loadInitialHomeSlice(nowDate, hydrateId);
    notices = slice.notices;
    totalCount = slice.totalCount;
    categoryCounts = slice.categoryCounts;
    partial = slice.partial;
  } else {
    const all = await loadNoticeSummaries(nowDate, hydrateId);
    notices = all.notices;
    totalCount = all.notices.length;
    categoryCounts = {};
    for (const cat of CATEGORIES) {
      categoryCounts[cat.slug] = all.notices.filter((n) => n.category === cat.slug).length;
    }
  }

  const activeCluster: CategoryIntent | null =
    cluster === "activity" || cluster === "information" ? cluster : null;

  return (
    <SiteShell
      notices={notices}
      heading="全部"
      activeCategory={null}
      activeCluster={activeCluster}
      activeSource={source?.trim() || null}
      initialNoticeId={hydrateId}
      initialQuery={q?.trim() || ""}
      initialTotalCount={totalCount}
      initialCategoryCounts={categoryCounts}
      initialPartial={partial}
      now={now}
    />
  );
}
