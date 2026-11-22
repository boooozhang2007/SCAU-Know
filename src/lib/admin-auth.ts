import { NextResponse } from "next/server";

/**
 * 校验后台管理接口访问权限（当设置了 ADMIN_SECRET 或 CRAWL_SECRET 时生效）。
 * 本地未配置密钥时直接放行，方便开箱即用开发测试。
 */
export function verifyAdminRequest(req: Request): NextResponse | null {
  const secret = process.env.ADMIN_SECRET || process.env.CRAWL_SECRET;
  if (!secret) return null;

  const auth = req.headers.get("authorization") ?? "";
  const headerSecret = req.headers.get("x-admin-secret") ?? "";
  if (auth === `Bearer ${secret}` || headerSecret === secret) {
    return null;
  }
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
