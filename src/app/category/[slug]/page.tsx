import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CATEGORIES, CATEGORY_MAP } from "@/lib/site";
import { SiteShell } from "@/components/site-shell";
import { loadNoticeSummaries } from "@/lib/data";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const cat = CATEGORY_MAP.get(slug);
  if (!cat) return {};
  return {
    title: `${cat.name}｜「华农知道」SCAU Know`,
    description: cat.hint,
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; source?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const { q, source, notice } = await searchParams;
  const cat = CATEGORY_MAP.get(slug);
  if (!cat) notFound();

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const { notices } = await loadNoticeSummaries(nowDate, notice?.trim() || null);

  return (
    <SiteShell
      notices={notices}
      heading={cat.name}
      activeCategory={slug}
      activeSource={source?.trim() || null}
      initialNoticeId={notice?.trim() || null}
      initialQuery={q?.trim() || ""}
      singleSection
      now={now}
    />
  );
}
