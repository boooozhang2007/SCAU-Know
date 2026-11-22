import type { Metadata } from "next";
import { loadNotices } from "@/lib/data";
import { SiteShell } from "@/components/site-shell";
import { AdminConsole } from "@/components/admin-console";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "监控后台｜「华农知道」SCAU Know",
  description: "华农知道公众号接入、Excel 关键字监控、AI 解析与静态发布控制台。",
};

export default async function AdminPage() {
  const now = new Date().toISOString();
  const { notices } = await loadNotices(new Date());

  return (
    <SiteShell
      notices={notices}
      heading="监控后台"
      hideCategoryNav
      now={now}
    >
      <AdminConsole />
    </SiteShell>
  );
}
