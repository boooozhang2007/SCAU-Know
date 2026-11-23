import type { Metadata } from "next";
import { loadInitialHomeSlice, searchNoticeSummaries } from "@/lib/data";
import { SiteShell } from "@/components/site-shell";
import type { CategoryIntent } from "@/lib/site";

export const metadata: Metadata = {
  title: "搜索｜「华农知道」SCAU Know",
  description: "搜索华南农业大学公开活动、讲座、招募与校园通知。",
};

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cluster?: string; source?: string; notice?: string }>;
}) {
  const { q, cluster, source, notice } = await searchParams;
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const kw = (q ?? "").trim();
  const hydrateId = notice?.trim() || null;
  const hasFilters = Boolean(kw || cluster || source?.trim());
  const slice = hasFilters
    ? await searchNoticeSummaries(kw, nowDate, hydrateId)
    : await loadInitialHomeSlice(nowDate, hydrateId);

  const activeCluster: CategoryIntent | null =
    cluster === "activity" || cluster === "information" ? cluster : null;

  return (
    <SiteShell
      notices={slice.notices}
      heading={kw ? `搜索：${kw}` : "全部"}
      activeCategory={null}
      activeCluster={activeCluster}
      activeSource={source?.trim() || null}
      initialNoticeId={hydrateId}
      initialTotalCount={slice.totalCount}
      initialCategoryCounts={slice.categoryCounts}
      initialPartial={slice.partial}
      singleSection={Boolean(kw)}
      now={now}
      initialQuery={kw}
    />
  );
}
