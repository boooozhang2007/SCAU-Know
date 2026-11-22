import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import {
  fetchAvailableModels,
  readAiSettings,
  testAiConnection,
  toPublicAiSettings,
  writeAiSettings,
  type WriteAiSettingsPatch,
} from "@/lib/ai/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  const { settings, keySource } = await readAiSettings();
  return NextResponse.json({
    ok: true,
    settings: toPublicAiSettings(settings, keySource),
    envFallbackConfigured: Boolean(process.env.AI_API_KEY?.trim()),
  });
}

export async function PUT(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  let patch: WriteAiSettingsPatch = {};
  try {
    patch = (await req.json()) as WriteAiSettingsPatch;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是有效 JSON" }, { status: 400 });
  }

  try {
    const saved = await writeAiSettings(patch);
    return NextResponse.json({ ok: true, settings: saved });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

interface PostActionBody {
  action?: "fetch_models" | "test";
  apiBase?: string;
  apiKey?: string;
  model?: string;
  useJsonMode?: boolean;
  timeoutMs?: number;
}

export async function POST(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  let body: PostActionBody = {};
  try {
    body = (await req.json()) as PostActionBody;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是有效 JSON" }, { status: 400 });
  }

  const { settings } = await readAiSettings();
  const apiBase = typeof body.apiBase === "string" && body.apiBase.trim()
    ? body.apiBase.trim()
    : settings.apiBase;
  const apiKey = typeof body.apiKey === "string" && body.apiKey.trim()
    ? body.apiKey.trim()
    : settings.apiKey;

  if (body.action === "fetch_models") {
    try {
      const result = await fetchAvailableModels(apiBase, apiKey);
      return NextResponse.json({
        ok: true,
        endpointUsed: result.endpointUsed,
        models: result.models,
      });
    } catch (err) {
      return NextResponse.json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        models: [],
      });
    }
  }

  if (body.action === "test") {
    const model = typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : settings.model;
    const useJsonMode =
      typeof body.useJsonMode === "boolean" ? body.useJsonMode : settings.useJsonMode;
    const timeoutMs =
      typeof body.timeoutMs === "number" ? body.timeoutMs : settings.timeoutMs;

    const result = await testAiConnection({
      apiBase,
      apiKey,
      model,
      useJsonMode,
      timeoutMs,
    });
    return NextResponse.json(result);
  }

  return NextResponse.json({ ok: false, error: "未知 action，仅支持 fetch_models 或 test" }, { status: 400 });
}
