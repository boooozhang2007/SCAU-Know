/**
 * AI 服务商预设与前后端共享类型定义（无 Node 内置模块依赖，可安全导入客户端组件）。
 */

export type AiProviderId =
  | "deepseek"
  | "qwen"
  | "zhipu"
  | "moonshot"
  | "siliconflow"
  | "gemini"
  | "openai"
  | "openrouter"
  | "ollama"
  | "custom";

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  apiBase: string;
  defaultModel: string;
  requiresApiKey: boolean;
  hint: string;
  modelsPathHint?: string;
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek 深度求索",
    apiBase: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    requiresApiKey: true,
    hint: "支持 deepseek-chat / deepseek-reasoner，性价比高，中文通知抽取稳定。",
  },
  {
    id: "qwen",
    label: "阿里云百炼 / 通义千问 (DashScope)",
    apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    requiresApiKey: true,
    hint: "兼容模式接口，支持 qwen-plus / qwen-turbo / qwen-max / qwen3 系列。",
  },
  {
    id: "zhipu",
    label: "智谱 AI (BigModel)",
    apiBase: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    requiresApiKey: true,
    hint: "v4 兼容接口，支持 glm-4-flash / glm-4-plus / glm-4.5 系列。",
  },
  {
    id: "moonshot",
    label: "月之暗面 Kimi (Moonshot)",
    apiBase: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    requiresApiKey: true,
    hint: "长上下文兼容性良好，适合附带长表格或附件文本的通知。",
  },
  {
    id: "siliconflow",
    label: "硅基流动 (SiliconFlow)",
    apiBase: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-72B-Instruct",
    requiresApiKey: true,
    hint: "聚合开源模型网关，支持 DeepSeek-V3/R1 与 Qwen 系列并可自动拉取列表。",
  },
  {
    id: "gemini",
    label: "Google Gemini (OpenAI 兼容网关)",
    apiBase: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    requiresApiKey: true,
    hint: "Google 官方 OpenAI 兼容端点，支持自动获取模型列表。",
  },
  {
    id: "openai",
    label: "OpenAI 官方",
    apiBase: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    requiresApiKey: true,
    hint: "原生支持 Structured JSON Mode（gpt-4o-mini / gpt-4.1-mini 等）。",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    apiBase: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    requiresApiKey: true,
    hint: "多模型路由平台，可通过 /models 自动获取当前可用模型列表。",
  },
  {
    id: "ollama",
    label: "Ollama 本地模型（无需密钥）",
    apiBase: "http://127.0.0.1:11434/v1",
    defaultModel: "qwen2.5:7b",
    requiresApiKey: false,
    hint: "本机或内网 Ollama 服务，会自动探测 /v1/models 与 /api/tags。",
  },
  {
    id: "custom",
    label: "自定义 OpenAI 兼容网关",
    apiBase: "",
    defaultModel: "",
    requiresApiKey: true,
    hint: "填写任意兼容 /v1/chat/completions 与 /v1/models 的中转或自建接口（如 OneAPI / NewAPI / vLLM）。",
  },
];

export interface AiSettings {
  provider: AiProviderId;
  apiBase: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  temperature: number;
  timeoutMs: number;
  useJsonMode: boolean;
  customInstructions: string;
  updatedAt: string;
}

export interface PublicAiSettings {
  provider: AiProviderId;
  apiBase: string;
  model: string;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
  keySource: "saved" | "env" | "none";
  requiresApiKey: boolean;
  configured: boolean;
  temperature: number;
  timeoutMs: number;
  useJsonMode: boolean;
  customInstructions: string;
  updatedAt: string;
}

export interface FetchedAiModel {
  id: string;
  name?: string;
  ownedBy?: string;
  category: "chat" | "reasoning" | "other";
}

export const PRESET_MAP = new Map<AiProviderId, AiProviderPreset>(
  AI_PROVIDER_PRESETS.map((p) => [p.id, p]),
);

/**
 * 判断当前接口地址是否属于无需强制密钥的本地推理服务（如 Ollama / 本机 vLLM）。
 */
export function isLocalAiBase(apiBase: string, provider?: AiProviderId): boolean {
  if (provider === "ollama") return true;
  if (!apiBase) return false;
  try {
    const parsed = new URL(apiBase);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host === "0.0.0.0" ||
      host.endsWith(".local")
    );
  } catch {
    return false;
  }
}
