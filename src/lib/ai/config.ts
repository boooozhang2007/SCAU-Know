/**
 * 服务端 AI 运行配置持久化、热加载、模型自动发现与连通性检测。
 *
 * - 持久化到 `data/ai-config.json`（已加入 .gitignore），未设置或留空字段自动回退到环境变量。
 * - 通过文件 mtime 缓存实现同步热读取，修改配置后无需重启 Next 服务即可立即生效。
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  AI_PROVIDER_PRESETS,
  PRESET_MAP,
  isLocalAiBase,
  type AiProviderId,
  type AiSettings,
  type FetchedAiModel,
  type PublicAiSettings,
} from "./presets";

const CONFIG_PATH = path.resolve(process.cwd(), "data/ai-config.json");

interface CachedConfig {
  mtimeMs: number;
  stored: Partial<AiSettings>;
}

let cached: CachedConfig | null = null;

function isValidProviderId(val: unknown): val is AiProviderId {
  return typeof val === "string" && PRESET_MAP.has(val as AiProviderId);
}

/**
 * 规范化 OpenAI 兼容接口 Base URL：校验协议并剔除尾部的 `/chat/completions`、`/models` 与多余斜杠。
 */
export function normalizeApiBase(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("API Base URL 格式无效，请以 http:// 或 https:// 开头");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("API Base URL 仅支持 http:// 或 https:// 协议");
  }
  let cleanPath = parsed.pathname.replace(/\/+$/, "");
  cleanPath = cleanPath.replace(/\/chat\/completions$/i, "");
  cleanPath = cleanPath.replace(/\/models$/i, "");
  cleanPath = cleanPath.replace(/\/+$/, "");
  return `${parsed.origin}${cleanPath}`;
}

function inferProviderFromBase(apiBase: string): AiProviderId {
  const lower = apiBase.toLowerCase();
  if (lower.includes("deepseek.com")) return "deepseek";
  if (lower.includes("dashscope.aliyuncs.com")) return "qwen";
  if (lower.includes("bigmodel.cn")) return "zhipu";
  if (lower.includes("moonshot.cn")) return "moonshot";
  if (lower.includes("siliconflow.cn")) return "siliconflow";
  if (lower.includes("generativelanguage.googleapis.com")) return "gemini";
  if (lower.includes("openrouter.ai")) return "openrouter";
  if (isLocalAiBase(apiBase) || lower.includes(":11434")) return "ollama";
  if (lower.includes("api.openai.com")) return "openai";
  return "custom";
}

function getEnvDefaults(): AiSettings {
  const rawBase = process.env.AI_API_BASE?.trim() || "https://api.openai.com/v1";
  let apiBase = "https://api.openai.com/v1";
  try {
    apiBase = normalizeApiBase(rawBase) || "https://api.openai.com/v1";
  } catch {
    apiBase = rawBase.replace(/\/+$/, "");
  }
  const provider = isValidProviderId(process.env.AI_PROVIDER)
    ? process.env.AI_PROVIDER
    : inferProviderFromBase(apiBase);
  const preset = PRESET_MAP.get(provider);
  const apiKey = process.env.AI_API_KEY?.trim() ?? "";
  const model = process.env.AI_MODEL?.trim() || preset?.defaultModel || "gpt-4o-mini";
  return {
    provider,
    apiBase,
    apiKey,
    model,
    enabled: true,
    temperature: 0.1,
    timeoutMs: 25000,
    useJsonMode: true,
    customInstructions: "",
    updatedAt: "",
  };
}

function readStoredSync(): Partial<AiSettings> {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.stored;
    }
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    cached = { mtimeMs: stat.mtimeMs, stored: parsed };
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      cached = null;
      return {};
    }
    return cached?.stored ?? {};
  }
}

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== "number" || !Number.isFinite(val)) return fallback;
  return Math.min(max, Math.max(min, val));
}

function mergeSettings(stored: Partial<AiSettings>): {
  settings: AiSettings;
  keySource: "saved" | "env" | "none";
} {
  const env = getEnvDefaults();
  const provider = isValidProviderId(stored.provider) ? stored.provider : env.provider;
  const preset = PRESET_MAP.get(provider) ?? AI_PROVIDER_PRESETS[0];

  const apiBaseRaw = typeof stored.apiBase === "string" && stored.apiBase.trim()
    ? stored.apiBase.trim()
    : env.apiBase || preset.apiBase;
  let apiBase = apiBaseRaw.replace(/\/+$/, "");
  try {
    apiBase = normalizeApiBase(apiBaseRaw) || apiBase;
  } catch {
    /* 保留已存值以防阻断读取 */
  }

  const savedKey = typeof stored.apiKey === "string" ? stored.apiKey.trim() : "";
  const envKey = env.apiKey.trim();
  const apiKey = savedKey || envKey;
  const keySource: "saved" | "env" | "none" = savedKey ? "saved" : envKey ? "env" : "none";

  const model =
    typeof stored.model === "string" && stored.model.trim()
      ? stored.model.trim()
      : env.model || preset.defaultModel;

  return {
    settings: {
      provider,
      apiBase,
      apiKey,
      model,
      enabled: typeof stored.enabled === "boolean" ? stored.enabled : env.enabled,
      temperature: clampNumber(stored.temperature, 0, 1.5, env.temperature),
      timeoutMs: clampNumber(stored.timeoutMs, 3000, 120000, env.timeoutMs),
      useJsonMode: typeof stored.useJsonMode === "boolean" ? stored.useJsonMode : env.useJsonMode,
      customInstructions:
        typeof stored.customInstructions === "string"
          ? stored.customInstructions.slice(0, 800)
          : "",
      updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : "",
    },
    keySource,
  };
}

export function maskApiKey(key: string): string {
  const clean = key.trim();
  if (!clean) return "";
  if (clean.length <= 8) return `${clean.slice(0, 2)}****`;
  return `${clean.slice(0, 4)}****${clean.slice(-4)}`;
}

/**
 * 同步读取当前生效的 AI 配置（供 enrichNotice / isAiConfigured 热读取使用）。
 */
export function readEffectiveAiConfigSync(): AiSettings {
  return mergeSettings(readStoredSync()).settings;
}

export function isAiReady(settings: AiSettings): boolean {
  if (!settings.enabled || !settings.apiBase || !settings.model) return false;
  const local = isLocalAiBase(settings.apiBase, settings.provider);
  return local || Boolean(settings.apiKey.trim());
}

export async function readAiSettings(): Promise<{
  settings: AiSettings;
  keySource: "saved" | "env" | "none";
}> {
  let stored: Partial<AiSettings> = {};
  try {
    const raw = await fsp.readFile(CONFIG_PATH, "utf-8");
    stored = JSON.parse(raw) as Partial<AiSettings>;
    const stat = await fsp.stat(CONFIG_PATH);
    cached = { mtimeMs: stat.mtimeMs, stored };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      stored = readStoredSync();
    }
  }
  return mergeSettings(stored);
}

export function toPublicAiSettings(
  settings: AiSettings,
  keySource: "saved" | "env" | "none",
): PublicAiSettings {
  const local = isLocalAiBase(settings.apiBase, settings.provider);
  const hasApiKey = Boolean(settings.apiKey.trim());
  return {
    provider: settings.provider,
    apiBase: settings.apiBase,
    model: settings.model,
    enabled: settings.enabled,
    hasApiKey,
    apiKeyMasked: maskApiKey(settings.apiKey),
    keySource,
    requiresApiKey: !local,
    configured: isAiReady(settings),
    temperature: settings.temperature,
    timeoutMs: settings.timeoutMs,
    useJsonMode: settings.useJsonMode,
    customInstructions: settings.customInstructions,
    updatedAt: settings.updatedAt,
  };
}

export interface WriteAiSettingsPatch {
  provider?: AiProviderId;
  apiBase?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  model?: string;
  enabled?: boolean;
  temperature?: number;
  timeoutMs?: number;
  useJsonMode?: boolean;
  customInstructions?: string;
}

export async function writeAiSettings(patch: WriteAiSettingsPatch): Promise<PublicAiSettings> {
  await fsp.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  let existing: Partial<AiSettings> = {};
  try {
    const raw = await fsp.readFile(CONFIG_PATH, "utf-8");
    existing = JSON.parse(raw) as Partial<AiSettings>;
  } catch {
    /* 首次创建 */
  }

  const nextProvider: AiProviderId = isValidProviderId(patch.provider)
    ? patch.provider
    : isValidProviderId(existing.provider)
      ? existing.provider
      : getEnvDefaults().provider;

  const rawBase =
    typeof patch.apiBase === "string"
      ? patch.apiBase
      : typeof existing.apiBase === "string"
        ? existing.apiBase
        : PRESET_MAP.get(nextProvider)?.apiBase || getEnvDefaults().apiBase;
  const apiBase = normalizeApiBase(rawBase);
  if (!apiBase) {
    throw new Error("请填写有效的 API Base URL");
  }

  const model = (
    typeof patch.model === "string"
      ? patch.model
      : typeof existing.model === "string"
        ? existing.model
        : PRESET_MAP.get(nextProvider)?.defaultModel || ""
  ).trim();
  if (!model) {
    throw new Error("请填写或选择一个模型名称");
  }

  let nextApiKey = typeof existing.apiKey === "string" ? existing.apiKey.trim() : "";
  if (patch.clearApiKey) {
    nextApiKey = "";
  } else if (typeof patch.apiKey === "string" && patch.apiKey.trim()) {
    nextApiKey = patch.apiKey.trim();
  }

  const toWrite: Partial<AiSettings> = {
    provider: nextProvider,
    apiBase,
    apiKey: nextApiKey,
    model,
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : (existing.enabled ?? true),
    temperature: clampNumber(
      patch.temperature,
      0,
      1.5,
      typeof existing.temperature === "number" ? existing.temperature : 0.1,
    ),
    timeoutMs: clampNumber(
      patch.timeoutMs,
      3000,
      120000,
      typeof existing.timeoutMs === "number" ? existing.timeoutMs : 25000,
    ),
    useJsonMode:
      typeof patch.useJsonMode === "boolean"
        ? patch.useJsonMode
        : (existing.useJsonMode ?? true),
    customInstructions:
      typeof patch.customInstructions === "string"
        ? patch.customInstructions.trim().slice(0, 800)
        : (existing.customInstructions ?? ""),
    updatedAt: new Date().toISOString(),
  };

  const tmpPath = `${CONFIG_PATH}.tmp`;
  await fsp.writeFile(tmpPath, JSON.stringify(toWrite, null, 2), "utf-8");
  await fsp.rename(tmpPath, CONFIG_PATH);

  const stat = await fsp.stat(CONFIG_PATH);
  cached = { mtimeMs: stat.mtimeMs, stored: toWrite };

  const { settings, keySource } = mergeSettings(toWrite);
  return toPublicAiSettings(settings, keySource);
}

function classifyModel(id: string): FetchedAiModel["category"] {
  const lower = id.toLowerCase();
  if (
    lower.includes("embed") ||
    lower.includes("bge-") ||
    lower.includes("rerank") ||
    lower.includes("whisper") ||
    lower.includes("tts") ||
    lower.includes("audio") ||
    lower.includes("speech") ||
    lower.includes("dall-e") ||
    lower.includes("flux") ||
    lower.includes("image") ||
    lower.includes("moderation") ||
    lower.includes("sdxl")
  ) {
    return "other";
  }
  if (
    lower.includes("reasoner") ||
    lower.includes("r1") ||
    lower.includes("qwq") ||
    /(^|[/:_-])o[134]($|[-_mini])/.test(lower) ||
    lower.includes("thinking")
  ) {
    return "reasoning";
  }
  return "chat";
}

function parseModelsPayload(payload: unknown): FetchedAiModel[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  const seen = new Map<string, FetchedAiModel>();

  const push = (idRaw: unknown, nameRaw?: unknown, ownedByRaw?: unknown) => {
    if (typeof idRaw !== "string") return;
    const id = idRaw.trim().replace(/^models\//i, "");
    if (!id || seen.has(id)) return;
    seen.set(id, {
      id,
      name: typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : undefined,
      ownedBy:
        typeof ownedByRaw === "string" && ownedByRaw.trim() ? ownedByRaw.trim() : undefined,
      category: classifyModel(id),
    });
  };

  // 1) OpenAI /v1/models 格式: { data: [{ id, owned_by }] } 或根数组
  const list = Array.isArray(obj.data)
    ? obj.data
    : Array.isArray(payload)
      ? payload
      : Array.isArray(obj.models)
        ? obj.models
        : null;

  if (list) {
    for (const item of list) {
      if (typeof item === "string") {
        push(item);
      } else if (item && typeof item === "object") {
        const m = item as Record<string, unknown>;
        if (typeof m.id === "string") {
          push(m.id, m.displayName ?? m.name, m.owned_by ?? m.ownedBy);
        } else if (typeof m.name === "string") {
          // Ollama /api/tags 或 Gemini models 格式
          push(m.model ?? m.name, m.displayName ?? m.name, m.details ? "ollama" : undefined);
        }
      }
    }
  }

  const order = { chat: 0, reasoning: 1, other: 2 } as const;
  return Array.from(seen.values()).sort((a, b) => {
    const rankDiff = order[a.category] - order[b.category];
    return rankDiff !== 0 ? rankDiff : a.id.localeCompare(b.id);
  });
}

function buildModelDiscoveryUrls(base: string): string[] {
  const urls: string[] = [`${base}/models`];
  const parsed = new URL(base);
  const pathClean = parsed.pathname.replace(/\/+$/, "");
  if (!pathClean.endsWith("/v1") && !pathClean.endsWith("/v4") && !pathClean.includes("/openai")) {
    urls.push(`${base}/v1/models`);
  }
  if (isLocalAiBase(base) || base.includes(":11434")) {
    urls.push(`${parsed.origin}/api/tags`);
  }
  return Array.from(new Set(urls));
}

export interface FetchModelsResult {
  endpointUsed: string;
  models: FetchedAiModel[];
}

/**
 * 从配置的 OpenAI 兼容接口自动获取可用模型列表。
 */
export async function fetchAvailableModels(
  apiBaseRaw: string,
  apiKey?: string,
): Promise<FetchModelsResult> {
  const base = normalizeApiBase(apiBaseRaw);
  if (!base) {
    throw new Error("请先填写 API Base URL");
  }
  const key = apiKey?.trim() ?? "";
  if (!key && !isLocalAiBase(base)) {
    throw new Error("请先输入或保存 API Key 后再获取模型列表");
  }

  const candidateUrls = buildModelDiscoveryUrls(base);
  let lastError = "未能获取到模型列表";

  for (const url of candidateUrls) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (key) {
        headers.Authorization = `Bearer ${key}`;
      }
      const res = await fetch(url, { method: "GET", headers, signal: ctrl.signal });
      if (!res.ok) {
        let detail = "";
        try {
          const errText = await res.text();
          detail = errText.slice(0, 180);
        } catch {
          /* ignore */
        }
        if (res.status === 401 || res.status === 403) {
          throw new Error(`认证失败（HTTP ${res.status}），请检查 API Key 是否有效`);
        }
        lastError = `接口 ${url} 返回 HTTP ${res.status}${detail ? `：${detail}` : ""}`;
        continue;
      }

      const json = (await res.json()) as unknown;
      const models = parseModelsPayload(json);
      if (models.length > 0) {
        return { endpointUsed: url, models };
      }
      lastError = `接口 ${url} 响应成功但未解析到模型列表`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("认证失败")) {
        throw err;
      }
      lastError = msg.includes("abort") ? `请求 ${url} 超时（12s）` : `${url}: ${msg}`;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(lastError);
}

export interface TestConnectionResult {
  ok: boolean;
  latencyMs: number;
  model: string;
  replyPreview?: string;
  error?: string;
}

/**
 * 发起一次轻量连通性测试，验证 `/chat/completions` 是否可用并可输出 JSON。
 */
export async function testAiConnection(params: {
  apiBase: string;
  apiKey?: string;
  model: string;
  useJsonMode?: boolean;
  timeoutMs?: number;
}): Promise<TestConnectionResult> {
  const base = normalizeApiBase(params.apiBase);
  if (!base) {
    return { ok: false, latencyMs: 0, model: params.model, error: "请先填写 API Base URL" };
  }
  const model = params.model.trim();
  if (!model) {
    return { ok: false, latencyMs: 0, model: "", error: "请先填写或选择模型名称" };
  }
  const key = params.apiKey?.trim() ?? "";
  if (!key && !isLocalAiBase(base)) {
    return { ok: false, latencyMs: 0, model, error: "缺少 API Key，无法发起远端连通测试" };
  }

  const startedAt = Date.now();
  const timeout = clampNumber(params.timeoutMs, 3000, 120000, 20000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key) {
      headers.Authorization = `Bearer ${key}`;
    }
    const payload: Record<string, unknown> = {
      model,
      temperature: 0,
      max_tokens: 48,
      messages: [
        { role: "system", content: "You only reply with valid JSON." },
        { role: "user", content: 'Reply with {"ok":true,"echo":"scau-know"}' },
      ],
    };
    if (params.useJsonMode !== false) {
      payload.response_format = { type: "json_object" };
    }

    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const latencyMs = Date.now() - startedAt;

    if (!res.ok) {
      const errText = (await res.text().catch(() => "")).slice(0, 240);
      const jsonHint =
        params.useJsonMode !== false && /response_format|json_object/i.test(errText)
          ? "（提示：该模型或网关可能不支持 response_format=json_object，可尝试取消勾选「强制 JSON 模式」）"
          : "";
      return {
        ok: false,
        latencyMs,
        model,
        error: `HTTP ${res.status}: ${errText || res.statusText}${jsonHint}`,
      };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    const content = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      return {
        ok: false,
        latencyMs,
        model: data?.model || model,
        error: "接口返回 HTTP 200，但响应 choices[0].message.content 为空",
      };
    }

    return {
      ok: true,
      latencyMs,
      model: data?.model || model,
      replyPreview: content.slice(0, 120),
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      latencyMs,
      model,
      error: msg.includes("abort") ? `请求超时（>${timeout}ms）` : msg,
    };
  } finally {
    clearTimeout(timer);
  }
}
