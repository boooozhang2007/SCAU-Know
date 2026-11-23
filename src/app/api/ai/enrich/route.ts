import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { readNotices, writeNotices } from "@/lib/crawl/store";
import { enrichNotice, getAiConfig, isAiConfigured } from "@/lib/ai/enrich";
import { AI_SCHEMA_VERSION } from "@/lib/ai/extract-rules";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  const notices = await readNotices();
  const cfg = getAiConfig();
  const enriched = notices.filter((n) => Boolean(n.ai)).length;
  const aiCount = notices.filter((n) => n.ai?.enrichedBy === "ai").length;
  return NextResponse.json({
    aiConfigured: isAiConfigured(),
    provider: cfg.provider,
    model: cfg.model,
    total: notices.length,
    enriched,
    aiCount,
  });
}

export async function POST(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  let body: { limit?: number; onlyMissing?: boolean; forceAi?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* 允许空请求体 */
  }

  const limit = Math.min(Math.max(body.limit ?? 30, 1), 200);
  const forceAi = Boolean(body.forceAi);
  const onlyMissing = forceAi ? false : (body.onlyMissing ?? true);
  const notices = await readNotices();

  let updated = 0;
  let aiUpdated = 0;
  for (let i = 0; i < notices.length && updated < limit; i++) {
    const n = notices[i];
    if (onlyMissing && n.ai) continue;
    if (
      forceAi &&
      n.ai?.enrichedBy === "ai" &&
      (n.ai.schemaVersion ?? 1) >= AI_SCHEMA_VERSION
    ) {
      continue;
    }
    n.ai = await enrichNotice(n);
    if (n.ai.enrichedBy === "ai") aiUpdated++;
    updated++;
  }

  if (updated > 0) {
    await writeNotices(notices);
  }

  const cfg = getAiConfig();
  return NextResponse.json({
    ok: true,
    aiConfigured: isAiConfigured(),
    provider: cfg.provider,
    model: cfg.model,
    updated,
    aiUpdated,
    total: notices.length,
  });
}
