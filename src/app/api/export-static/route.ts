import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { exportStaticDataSnapshot, triggerStaticDeployHooks } from "@/lib/export-static";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  let triggerDeploy = false;
  try {
    const body = (await req.json()) as { triggerDeploy?: boolean };
    triggerDeploy = Boolean(body.triggerDeploy);
  } catch {
    /* 允许空体 */
  }

  const summary = await exportStaticDataSnapshot();
  if (triggerDeploy) {
    summary.deployTriggers = await triggerStaticDeployHooks();
  }

  return NextResponse.json({ ok: true, ...summary });
}
