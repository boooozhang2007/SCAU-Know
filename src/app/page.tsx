import { loadNoticeSummaries } from "@/lib/data";
import { SiteShell } from "@/components/site-shell";
import type { CategoryIntent } from "@/lib/site";

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
  const { notices } = await loadNoticeSummaries(nowDate, notice?.trim() || null);

  const activeCluster: CategoryIntent | null =
    cluster === "activity" || cluster === "information" ? cluster : null;

  return (
    <SiteShell
      notices={notices}
      heading="全部"
      activeCategory={null}
      activeCluster={activeCluster}
      activeSource={source?.trim() || null}
      initialNoticeId={notice?.trim() || null}
      initialQuery={q?.trim() || ""}
      now={now}
    />
  );
}
