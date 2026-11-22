"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Bot,
  CheckCircle2,
  Clock,
  CloudUpload,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Sliders,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import {
  AI_PROVIDER_PRESETS,
  PRESET_MAP,
  isLocalAiBase,
  type AiProviderId,
  type FetchedAiModel,
  type PublicAiSettings,
} from "@/lib/ai/presets";
import type { AlertDeliveryLog, AlertRule, ChannelType } from "@/lib/monitor/rules";
import type { ScheduleConfig, ScheduleStatus } from "@/lib/crawl/scheduler";

interface WempMpItem {
  id: string;
  mp_name: string;
  mp_cover?: string;
  mp_intro?: string;
  status?: number;
  article_count?: number;
  sync_time?: string | number;
  update_time?: string | number;
}

interface WempSysInfoClient {
  coreVersion?: string;
  wxLogin: boolean;
  wxAppName?: string;
  expiryTime?: string;
  articleTotal: number;
  hasContentCount: number;
  noContentCount: number;
  mpAllCount: number;
  queueRunning: boolean;
  pendingTasks: number;
  currentTaskName?: string;
  taskCount: number;
  gatherModel?: string;
  gatherContent?: string;
  maxPage?: string;
}

function notifyFrontendSync() {
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel("scau-know-sync");
      bc.postMessage({ type: "updated", at: Date.now() });
      bc.close();
    }
  } catch {
    /* 忽略 */
  }
  try {
    localStorage.setItem("scau-know-sync-ping", String(Date.now()));
  } catch {
    /* 忽略 */
  }
}

function formatWempSyncTime(raw?: string | number | null): string {
  if (raw === undefined || raw === null || raw === "" || raw === 0 || raw === "0") {
    return "待首次同步";
  }
  let date: Date;
  if (typeof raw === "number" || /^\d+$/.test(String(raw).trim())) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return "待首次同步";
    date = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    date = new Date(String(raw));
  }
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) {
    return "待首次同步";
  }
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface PlaceholderItem {
  key: string;
  label: string;
  example: string;
}

const CHANNEL_META: {
  type: ChannelType;
  label: string;
  endpointLabel: string;
  endpointPh: string;
  tokenLabel?: string;
  tokenPh?: string;
  recipientLabel?: string;
  recipientPh?: string;
}[] = [
  {
    type: "webhook",
    label: "自定义 Webhook (JSON)",
    endpointLabel: "Webhook URL",
    endpointPh: "https://example.com/hook",
    tokenLabel: "Bearer Token（选填）",
    tokenPh: "secret-token",
  },
  {
    type: "wxpusher",
    label: "WxPusher 微信推送",
    endpointLabel: "WxPusher AppToken",
    endpointPh: "AT_xxxx",
    recipientLabel: "接收人 UID（多个逗号分隔）",
    recipientPh: "UID_xxxx",
  },
  {
    type: "pushplus",
    label: "PushPlus 微信推送",
    endpointLabel: "PushPlus Token",
    endpointPh: "32位 token",
  },
  {
    type: "serverchan",
    label: "Server酱 微信推送",
    endpointLabel: "SendKey",
    endpointPh: "SCTxxxx",
  },
  {
    type: "bark",
    label: "Bark (iOS)",
    endpointLabel: "Bark 推送 URL",
    endpointPh: "https://api.day.app/你的Key",
  },
  {
    type: "feishu",
    label: "飞书机器人",
    endpointLabel: "飞书 Webhook URL",
    endpointPh: "https://open.feishu.cn/open-apis/bot/v2/hook/...",
  },
  {
    type: "dingtalk",
    label: "钉钉机器人",
    endpointLabel: "钉钉 Webhook URL",
    endpointPh: "https://oapi.dingtalk.com/robot/send?access_token=...",
  },
  {
    type: "resend",
    label: "Resend 邮件",
    endpointLabel: "发件人（可选）",
    endpointPh: "SCAU Know <noreply@yourdomain.com>",
    tokenLabel: "Resend API Key",
    tokenPh: "re_xxxx",
    recipientLabel: "收件人邮箱",
    recipientPh: "student@stu.scau.edu.cn",
  },
];

export function AdminConsole() {
  const [tab, setTab] = useState<"wemp" | "ai" | "alerts" | "ops">("wemp");
  const [adminSecret, setAdminSecret] = useState("");
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);

  // Tab 1: we-mp-rss
  const [wempLoading, setWempLoading] = useState(false);
  const [wempState, setWempState] = useState<{
    configured?: boolean;
    baseUrl?: string;
    sysInfo?: WempSysInfoClient | null;
    qrStatus?: { login_status?: boolean; qr_code?: boolean } | null;
    mps?: WempMpItem[];
    error?: string;
  }>({});
  const [articleUrl, setArticleUrl] = useState("");
  const [mpKeyword, setMpKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<
    { fakeid: string; nickname: string; alias?: string; signature?: string }[]
  >([]);

  // Tab 2: 监控规则与占位符模板
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [logs, setLogs] = useState<AlertDeliveryLog[]>([]);
  const [placeholders, setPlaceholders] = useState<PlaceholderItem[]>([]);
  const [defaultTemplate, setDefaultTemplate] = useState("");

  const [ruleName, setRuleName] = useState("我的奖学金与名单监控");
  const [subscriber, setSubscriber] = useState("");
  const [keywordsStr, setKeywordsStr] = useState("奖学金, 选课, 补考");
  const [scopes, setScopes] = useState<AlertRule["scopes"]>([
    "title",
    "body",
    "attachment",
    "xlsx",
  ]);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("面向计算机/信息类本科生的竞赛、科研或奖学金通知");
  const [channelType, setChannelType] = useState<ChannelType>("webhook");
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [recipient, setRecipient] = useState("");
  const [template, setTemplate] = useState("");
  const [previewText, setPreviewText] = useState("");

  // Tab 3: 采集 / AI / 静态发布
  const [aiStats, setAiStats] = useState<{
    aiConfigured: boolean;
    provider?: string;
    model: string;
    total: number;
    enriched: number;
    aiCount: number;
  } | null>(null);
  const [opsBusy, setOpsBusy] = useState(false);

  // Tab AI: AI 模型与解析热配置
  const [aiSettings, setAiSettings] = useState<PublicAiSettings | null>(null);
  const [aiDraft, setAiDraft] = useState<{
    provider: AiProviderId;
    apiBase: string;
    apiKey: string;
    model: string;
    enabled: boolean;
    temperature: number;
    timeoutMs: number;
    useJsonMode: boolean;
    customInstructions: string;
  }>({
    provider: "deepseek",
    apiBase: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-chat",
    enabled: true,
    temperature: 0.1,
    timeoutMs: 25000,
    useJsonMode: true,
    customInstructions: "",
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedAiModel[]>([]);
  const [modelsEndpoint, setModelsEndpoint] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [showAllModels, setShowAllModels] = useState(false);
  const [aiProbeStatus, setAiProbeStatus] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  // Tab 3: 定时抓取与前端自动同步调度
  const [schedStatus, setSchedStatus] = useState<ScheduleStatus | null>(null);
  const [schedDraft, setSchedDraft] = useState<ScheduleConfig | null>(null);
  const [schedSaving, setSchedSaving] = useState(false);

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (adminSecret.trim()) h["x-admin-secret"] = adminSecret.trim();
    return h;
  }, [adminSecret]);

  const loadWemp = useCallback(async () => {
    setWempLoading(true);
    try {
      const r = await fetch("/api/admin/wemp", { headers: authHeaders() });
      const j = await r.json();
      setWempState(j);
    } catch (e) {
      setWempState({ error: e instanceof Error ? e.message : "加载失败" });
    } finally {
      setWempLoading(false);
    }
  }, [authHeaders]);

  const loadAlerts = useCallback(async () => {
    try {
      const r = await fetch("/api/alerts", { headers: authHeaders() });
      if (!r.ok) return;
      const j = await r.json();
      setRules(j.rules ?? []);
      setLogs(j.logs ?? []);
      setPlaceholders(j.placeholders ?? []);
      setDefaultTemplate(j.defaultTemplate ?? "");
      setTemplate((prev) => prev || j.defaultTemplate || "");
    } catch {
      /* 忽略 */
    }
  }, [authHeaders]);

  const loadAiStats = useCallback(async () => {
    try {
      const r = await fetch("/api/ai/enrich", { headers: authHeaders() });
      if (r.ok) setAiStats(await r.json());
    } catch {
      /* 忽略 */
    }
  }, [authHeaders]);

  const loadAiSettings = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/ai", { headers: authHeaders(), cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { ok?: boolean; settings?: PublicAiSettings };
      if (j.ok && j.settings) {
        const s = j.settings;
        setAiSettings(s);
        setAiDraft({
          provider: s.provider,
          apiBase: s.apiBase,
          apiKey: "",
          model: s.model,
          enabled: s.enabled,
          temperature: s.temperature,
          timeoutMs: s.timeoutMs,
          useJsonMode: s.useJsonMode,
          customInstructions: s.customInstructions,
        });
      }
    } catch {
      /* 忽略 */
    }
  }, [authHeaders]);

  const loadSchedule = useCallback(
    async (syncDraft = false) => {
      try {
        const r = await fetch("/api/schedule", {
          headers: authHeaders(),
          cache: "no-store",
        });
        if (!r.ok) return;
        const j = (await r.json()) as ScheduleStatus;
        setSchedStatus(j);
        setSchedDraft((prev) => (syncDraft || !prev ? j.config : prev));
      } catch {
        /* 忽略 */
      }
    },
    [authHeaders],
  );

  useEffect(() => {
    void loadWemp();
    void loadAlerts();
    void loadAiStats();
    void loadAiSettings();
    void loadSchedule(true);
  }, [loadWemp, loadAlerts, loadAiStats, loadAiSettings, loadSchedule]);

  // Tab 3 打开时每 15 秒轻量刷新一次定时调度实时状态
  useEffect(() => {
    if (tab !== "ops") return;
    const t = setInterval(() => {
      void loadSchedule(false);
    }, 15_000);
    return () => clearInterval(t);
  }, [tab, loadSchedule]);

  const postWemp = async (
    body: Record<string, unknown>,
    formatOk:
      | string
      | ((res: Record<string, unknown>) => { ok?: boolean; msg: string }),
  ) => {
    setWempLoading(true);
    setBanner(null);
    try {
      const r = await fetch("/api/admin/wemp", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as Record<string, unknown>;
      if (!r.ok || j.ok === false) {
        setBanner({ ok: false, msg: String(j.error || "请求失败") });
      } else {
        const formatted =
          typeof formatOk === "function" ? formatOk(j) : { ok: true, msg: formatOk };
        setBanner({ ok: formatted.ok ?? true, msg: formatted.msg });
        if (Array.isArray(j.list)) {
          setSearchResults(
            j.list as {
              fakeid: string;
              nickname: string;
              alias?: string;
              signature?: string;
            }[],
          );
        }
        await loadWemp();
      }
    } catch (e) {
      setBanner({ ok: false, msg: e instanceof Error ? e.message : "网络错误" });
    } finally {
      setWempLoading(false);
    }
  };

  const buildDraftRule = (): AlertRule => ({
    id: `draft_${Date.now()}`,
    name: ruleName.trim() || "未命名规则",
    enabled: true,
    subscriberName: subscriber.trim() || undefined,
    keywords: keywordsStr
      .split(/[,，\n]+/)
      .map((s) => s.trim())
      .filter(Boolean),
    scopes,
    aiRelevance: aiEnabled
      ? { enabled: true, prompt: aiPrompt.trim(), minConfidence: 0.6 }
      : undefined,
    template: template || defaultTemplate,
    channel: {
      type: channelType,
      endpoint: endpoint.trim(),
      token: token.trim() || undefined,
      recipient: recipient.trim() || undefined,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    const r = await fetch("/api/alerts", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(buildDraftRule()),
    });
    const j = await r.json();
    if (r.ok && j.ok) {
      setRules(j.rules);
      setBanner({ ok: true, msg: `已保存监控规则「${j.rule.name}」` });
    } else {
      setBanner({ ok: false, msg: j.error || "保存失败" });
    }
  };

  const handlePreviewOrTest = async (send: boolean) => {
    setBanner(null);
    const r = await fetch("/api/alerts/test", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ rule: buildDraftRule(), send }),
    });
    const j = await r.json();
    if (r.ok && j.ok) {
      setPreviewText(j.rendered);
      if (send) {
        setBanner({
          ok: Boolean(j.delivery?.ok),
          msg: j.delivery?.ok
            ? "测试消息已成功推送到目标通道！"
            : `测试发送失败：${j.delivery?.error || "请检查通道配置"}`,
        });
      }
    } else {
      setBanner({ ok: false, msg: j.error || "预览失败" });
    }
  };

  const toggleRuleEnabled = async (rule: AlertRule) => {
    const r = await fetch("/api/alerts", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }),
    });
    const j = await r.json();
    if (r.ok && j.ok) setRules(j.rules);
  };

  const deleteRule = async (id: string) => {
    const r = await fetch(`/api/alerts?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    const j = await r.json();
    if (r.ok && j.ok) setRules(j.rules);
  };

  const handleSelectProvider = (provider: AiProviderId) => {
    const preset = PRESET_MAP.get(provider);
    setAiDraft((prev) => ({
      ...prev,
      provider,
      apiBase: preset?.apiBase ? preset.apiBase : prev.apiBase,
      model: preset?.defaultModel ? preset.defaultModel : prev.model,
    }));
    setFetchedModels([]);
    setModelsEndpoint("");
    setModelFilter("");
    setShowAllModels(false);
    setAiProbeStatus(null);
  };

  const handleFetchModels = async () => {
    setAiProbeStatus(null);
    const base = aiDraft.apiBase.trim();
    if (!base) {
      setAiProbeStatus({ ok: false, message: "请先选择服务商或填写 API Base URL。" });
      return;
    }
    const local = isLocalAiBase(base, aiDraft.provider);
    if (!local && !aiDraft.apiKey.trim() && !aiSettings?.hasApiKey) {
      setAiProbeStatus({
        ok: false,
        message: "请先在上方填写 API Key（或使用已保存密钥）后再自动获取模型列表。",
      });
      return;
    }

    setFetchingModels(true);
    try {
      const r = await fetch("/api/admin/ai", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          action: "fetch_models",
          apiBase: base,
          apiKey: aiDraft.apiKey.trim() || undefined,
        }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        endpointUsed?: string;
        models?: FetchedAiModel[];
        error?: string;
      };
      if (r.ok && j.ok && Array.isArray(j.models)) {
        setFetchedModels(j.models);
        setModelsEndpoint(j.endpointUsed ?? "");
        setModelFilter("");
        setShowAllModels(false);
        if (!aiDraft.model.trim() && j.models[0]) {
          setAiDraft((prev) => ({ ...prev, model: j.models![0].id }));
        }
        setAiProbeStatus({
          ok: true,
          message: `已从 ${j.endpointUsed} 获取 ${j.models.length} 个可用模型，可在下方点击选择或直接保存。`,
        });
      } else {
        setAiProbeStatus({
          ok: false,
          message: j.error || "自动获取模型列表失败，请检查接口地址与密钥权限。",
        });
      }
    } catch (e) {
      setAiProbeStatus({
        ok: false,
        message: e instanceof Error ? e.message : "网络请求失败，未能获取模型列表。",
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTestAi = async () => {
    setAiProbeStatus(null);
    const base = aiDraft.apiBase.trim();
    const model = aiDraft.model.trim();
    if (!base || !model) {
      setAiProbeStatus({ ok: false, message: "请先填写 API Base URL 与模型名称后再测试。" });
      return;
    }
    const local = isLocalAiBase(base, aiDraft.provider);
    if (!local && !aiDraft.apiKey.trim() && !aiSettings?.hasApiKey) {
      setAiProbeStatus({
        ok: false,
        message: "请先填写 API Key（或保存密钥）后再发起连通性测试。",
      });
      return;
    }

    setTestingAi(true);
    try {
      const r = await fetch("/api/admin/ai", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          action: "test",
          apiBase: base,
          apiKey: aiDraft.apiKey.trim() || undefined,
          model,
          useJsonMode: aiDraft.useJsonMode,
          timeoutMs: aiDraft.timeoutMs,
        }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        latencyMs?: number;
        model?: string;
        replyPreview?: string;
        error?: string;
      };
      if (r.ok && j.ok) {
        setAiProbeStatus({
          ok: true,
          message: `连通测试通过（${j.latencyMs ?? 0}ms · 模型 ${j.model ?? model}）：${j.replyPreview ?? "JSON 响应正常"}`,
        });
      } else {
        setAiProbeStatus({
          ok: false,
          message: `测试失败（${j.latencyMs ?? 0}ms）：${j.error || "请检查接口、模型名或超时设置"}`,
        });
      }
    } catch (e) {
      setAiProbeStatus({
        ok: false,
        message: e instanceof Error ? e.message : "连通测试网络异常",
      });
    } finally {
      setTestingAi(false);
    }
  };

  const handleSaveAiSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setAiSaving(true);
    setBanner(null);
    setAiProbeStatus(null);
    try {
      const r = await fetch("/api/admin/ai", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          provider: aiDraft.provider,
          apiBase: aiDraft.apiBase,
          apiKey: aiDraft.apiKey.trim() ? aiDraft.apiKey.trim() : undefined,
          model: aiDraft.model,
          enabled: aiDraft.enabled,
          temperature: aiDraft.temperature,
          timeoutMs: aiDraft.timeoutMs,
          useJsonMode: aiDraft.useJsonMode,
          customInstructions: aiDraft.customInstructions,
        }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        settings?: PublicAiSettings;
        error?: string;
      };
      if (r.ok && j.ok && j.settings) {
        setAiSettings(j.settings);
        setAiDraft((prev) => ({
          ...prev,
          provider: j.settings!.provider,
          apiBase: j.settings!.apiBase,
          apiKey: "",
          model: j.settings!.model,
          enabled: j.settings!.enabled,
          temperature: j.settings!.temperature,
          timeoutMs: j.settings!.timeoutMs,
          useJsonMode: j.settings!.useJsonMode,
          customInstructions: j.settings!.customInstructions,
        }));
        const okMsg = `已保存 AI 配置并热生效（${PRESET_MAP.get(j.settings.provider)?.label ?? j.settings.provider} · ${j.settings.model}）`;
        setBanner({ ok: true, msg: okMsg });
        setAiProbeStatus({ ok: true, message: okMsg });
        await loadAiStats();
      } else {
        const errMsg = j.error || "保存 AI 配置失败";
        setBanner({ ok: false, msg: errMsg });
        setAiProbeStatus({ ok: false, message: errMsg });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "网络错误";
      setBanner({ ok: false, msg: errMsg });
      setAiProbeStatus({ ok: false, message: errMsg });
    } finally {
      setAiSaving(false);
    }
  };

  const handleClearSavedKey = async () => {
    setAiSaving(true);
    setAiProbeStatus(null);
    try {
      const r = await fetch("/api/admin/ai", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ clearApiKey: true }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        settings?: PublicAiSettings;
        error?: string;
      };
      if (r.ok && j.ok && j.settings) {
        setAiSettings(j.settings);
        setAiDraft((prev) => ({ ...prev, apiKey: "" }));
        setAiProbeStatus({
          ok: true,
          message:
            j.settings.keySource === "env"
              ? "已清除后台保存的密钥，当前将回退使用环境变量中的 AI_API_KEY。"
              : "已清除后台保存的 API 密钥。",
        });
        await loadAiStats();
      } else {
        setAiProbeStatus({ ok: false, message: j.error || "清除密钥失败" });
      }
    } finally {
      setAiSaving(false);
    }
  };

  const handleBatchEnrich = async (forceAi: boolean) => {
    setOpsBusy(true);
    setBanner(null);
    try {
      const r = await fetch("/api/ai/enrich", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          limit: forceAi ? 25 : 30,
          onlyMissing: !forceAi,
          forceAi,
        }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        aiConfigured?: boolean;
        model?: string;
        updated?: number;
        aiUpdated?: number;
        error?: string;
      };
      setBanner({
        ok: Boolean(j.ok),
        msg: j.ok
          ? `结构化解析完成：本次更新 ${j.updated ?? 0} 条（其中大模型写入 ${j.aiUpdated ?? 0} 条，当前模式：${j.aiConfigured ? `AI ${j.model ?? ""}` : "内置规则引擎"}）`
          : j.error || "解析失败",
      });
      if (j.ok) notifyFrontendSync();
      await loadAiStats();
      await loadSchedule(false);
    } finally {
      setOpsBusy(false);
    }
  };

  const filteredModels = fetchedModels.filter((m) => {
    const q = modelFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      m.id.toLowerCase().includes(q) ||
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.ownedBy && m.ownedBy.toLowerCase().includes(q))
    );
  });
  const visibleModels = showAllModels ? filteredModels : filteredModels.slice(0, 36);
  const currentPreset = PRESET_MAP.get(aiDraft.provider);

  const channelMeta =
    CHANNEL_META.find((c) => c.type === channelType) ?? CHANNEL_META[0];

  return (
    <div className="page-shell admin-shell">
      <div className="admin-head">
        <div>
          <h1>监控与接入后台</h1>
          <p className="page-sub">
            管理 we-mp-rss 公众号接入、附件与 Excel 名单监控、AI 结构化解析及静态 CDN 发布。
          </p>
        </div>
        <div className="admin-secret-box">
          <label htmlFor="admin-secret-input">管理密钥（可选）</label>
          <input
            id="admin-secret-input"
            type="password"
            value={adminSecret}
            onChange={(e) => setAdminSecret(e.target.value)}
            placeholder="仅配置 ADMIN_SECRET 时填写"
          />
        </div>
      </div>

      <div className="admin-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className="admin-tab"
          aria-selected={tab === "wemp"}
          onClick={() => setTab("wemp")}
        >
          <Link2 />
          <span>公众号接入（we-mp-rss）</span>
        </button>
        <button
          type="button"
          role="tab"
          className="admin-tab"
          aria-selected={tab === "ai"}
          onClick={() => setTab("ai")}
        >
          <Bot />
          <span>AI 模型与解析</span>
        </button>
        <button
          type="button"
          role="tab"
          className="admin-tab"
          aria-selected={tab === "alerts"}
          onClick={() => setTab("alerts")}
        >
          <Bell />
          <span>监控规则与占位符提醒</span>
        </button>
        <button
          type="button"
          role="tab"
          className="admin-tab"
          aria-selected={tab === "ops"}
          onClick={() => setTab("ops")}
        >
          <CloudUpload />
          <span>采集、AI 解析与静态发布</span>
        </button>
      </div>

      {banner && (
        <div className="admin-banner" data-ok={banner.ok ? "true" : "false"}>
          {banner.msg}
        </div>
      )}

      {/* ── Tab 1: we-mp-rss ── */}
      {tab === "wemp" && (
        <div className="admin-grid">
          <section className="admin-card">
            <div className="admin-card-head">
              <h2>服务连接状态</h2>
              <button
                type="button"
                className="plain-button plain-button-sm"
                disabled={wempLoading}
                onClick={() => void loadWemp()}
              >
                <RefreshCw className={wempLoading ? "spin" : ""} />
                <span>刷新状态</span>
              </button>
            </div>
            <div className="admin-kv">
              <div>
                <span>服务地址</span>
                <strong>{wempState.baseUrl || "未配置 WEMP_BASE_URL"}</strong>
              </div>
              <div>
                <span>微信授权</span>
                <strong>
                  {wempState.sysInfo
                    ? wempState.sysInfo.wxLogin
                      ? `已授权在线（${wempState.sysInfo.wxAppName || "公众号后台"}${
                          wempState.sysInfo.expiryTime
                            ? ` · 有效至 ${wempState.sysInfo.expiryTime}`
                            : ""
                        }）`
                      : "待扫码或登录已过期"
                    : wempState.qrStatus?.login_status
                      ? "已授权在线"
                      : "未连接或加载中"}
                </strong>
              </div>
              <div>
                <span>已接入公众号</span>
                <strong>{wempState.mps?.length ?? 0} 个</strong>
              </div>
              <div>
                <span>wemp 文章池</span>
                <strong>
                  {wempState.sysInfo
                    ? `${wempState.sysInfo.articleTotal} 篇 · 含正文 ${wempState.sysInfo.hasContentCount} 篇`
                    : "-"}
                </strong>
              </div>
              <div>
                <span>wemp 队列与配置</span>
                <strong>
                  {wempState.sysInfo
                    ? `待处理 ${wempState.sysInfo.pendingTasks} 项${
                        wempState.sysInfo.currentTaskName
                          ? ` · 正在采 ${wempState.sysInfo.currentTaskName}`
                          : " · 空闲"
                      } · ${wempState.sysInfo.gatherModel || "-"} 模式 / 正文${
                        wempState.sysInfo.gatherContent === "True" ? "开启" : "关闭"
                      } / max_page=${wempState.sysInfo.maxPage || "-"} / 定时任务 ${
                        wempState.sysInfo.taskCount
                      }`
                    : "-"}
                </strong>
              </div>
            </div>
            {wempState.error && <p className="admin-err">异常：{wempState.error}</p>}

            <div className="admin-btn-row">
              <button
                type="button"
                className="primary-button"
                disabled={wempLoading}
                onClick={() =>
                  void postWemp({ action: "pull_to_site" }, (res) => {
                    const pulled = Number(res.pulled ?? 0);
                    const added = Number(res.added ?? 0);
                    const total = Number(res.total ?? 0);
                    if (pulled <= 0) {
                      return {
                        ok: false,
                        msg: "we-mp-rss 当前文章库为 0 篇，本次未拉取到新文章（可先点击「分批触发公众号拉新」或清空积压队列等待微信频控恢复）",
                      };
                    }
                    notifyFrontendSync();
                    void loadAiStats();
                    void loadSchedule(false);
                    return {
                      ok: true,
                      msg: `已从 we-mp-rss 拉取 ${pulled} 篇公众号文章，新增入库 ${added} 篇（库内共 ${total} 条）`,
                    };
                  })
                }
              >
                <Database style={{ width: 15, height: 15 }} />
                <span>拉取公众号文章并同步封面入库</span>
              </button>
              <button
                type="button"
                className="plain-button"
                disabled={wempLoading}
                onClick={() =>
                  void postWemp({ action: "sync_all", batchSize: 8 }, (res) => {
                    const synced = Number(res.synced ?? 0);
                    const failed = Number(res.failed ?? 0);
                    const totalMps = Number(res.totalMps ?? 0);
                    const rateLimited = Boolean(res.rateLimited);
                    return {
                      ok: failed === 0 && !rateLimited,
                      msg: `本批已向 ${synced}/${totalMps} 个公众号发送拉新指令（失败 ${failed}${
                        rateLimited ? "，已触发微信频控自动暂停" : ""
                      }）`,
                    };
                  })
                }
              >
                <RefreshCw style={{ width: 15, height: 15 }} />
                <span>分批触发公众号拉新（防频控，每次 8 个）</span>
              </button>
              {(wempState.sysInfo?.pendingTasks ?? 0) > 0 && (
                <button
                  type="button"
                  className="plain-button"
                  disabled={wempLoading}
                  onClick={() =>
                    void postWemp(
                      { action: "clear_queue" },
                      "已清空 we-mp-rss 待执行采集队列，当前收尾完成后队列将恢复空闲",
                    )
                  }
                >
                  <Trash2 style={{ width: 15, height: 15 }} />
                  <span>清空积压队列（{wempState.sysInfo?.pendingTasks} 项）</span>
                </button>
              )}
            </div>
          </section>

          <section className="admin-card">
            <h2>通过单篇文章链接快速接入公众号</h2>
            <p className="admin-hint">
              粘贴任意微信文章链接（如 <code>https://mp.weixin.qq.com/s/...</code>），自动识别所属公众号并订阅。
            </p>
            <div className="admin-input-row">
              <input
                type="url"
                value={articleUrl}
                onChange={(e) => setArticleUrl(e.target.value)}
                placeholder="https://mp.weixin.qq.com/s/..."
              />
              <button
                type="button"
                className="primary-button"
                disabled={wempLoading || !articleUrl.trim()}
                onClick={() =>
                  void postWemp(
                    { action: "add_by_article", articleUrl: articleUrl.trim() },
                    "已通过文章链接识别并加入监控",
                  )
                }
              >
                <Plus style={{ width: 15, height: 15 }} />
                <span>解析并加入</span>
              </button>
            </div>

            <h2 style={{ marginTop: 18 }}>按名称搜索并接入公众号</h2>
            <div className="admin-input-row">
              <input
                type="text"
                value={mpKeyword}
                onChange={(e) => setMpKeyword(e.target.value)}
                placeholder="例如：华南农业大学团委 / 农学院"
              />
              <button
                type="button"
                className="plain-button"
                disabled={wempLoading || !mpKeyword.trim()}
                onClick={() =>
                  void postWemp(
                    { action: "search", keyword: mpKeyword.trim() },
                    "搜索完成，可在下方选择加入",
                  )
                }
              >
                <Search style={{ width: 14, height: 14 }} />
                <span>搜索</span>
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={wempLoading || !mpKeyword.trim()}
                onClick={() =>
                  void postWemp(
                    { action: "add_by_keyword", keyword: mpKeyword.trim() },
                    `已添加公众号「${mpKeyword.trim()}」`,
                  )
                }
              >
                <span>一键添加</span>
              </button>
            </div>

            {searchResults.length > 0 && (
              <ul className="admin-search-list">
                {searchResults.slice(0, 6).map((c) => (
                  <li key={c.fakeid}>
                    <div>
                      <strong>{c.nickname}</strong>
                      <span>{c.signature?.slice(0, 60)}</span>
                    </div>
                    <button
                      type="button"
                      className="plain-button plain-button-sm"
                      onClick={() =>
                        void postWemp(
                          { action: "add_by_keyword", keyword: c.nickname },
                          `已添加「${c.nickname}」`,
                        )
                      }
                    >
                      加入
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="admin-card admin-card-full">
            <h2>已订阅公众号列表（{wempState.mps?.length ?? 0}）</h2>
            <div className="admin-mp-grid">
              {(wempState.mps ?? []).map((mp) => (
                <div key={mp.id} className="admin-mp-item">
                  <div className="admin-mp-info">
                    <strong>{mp.mp_name}</strong>
                    <span>
                      {typeof mp.article_count === "number"
                        ? `文章 ${mp.article_count} 篇 · `
                        : ""}
                      最近同步：{formatWempSyncTime(mp.sync_time)} · {mp.id}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="plain-button plain-button-sm"
                    disabled={wempLoading}
                    onClick={() =>
                      void postWemp(
                        { action: "sync_mp", mpId: mp.id },
                        `已触发更新「${mp.mp_name}」`,
                      )
                    }
                  >
                    同步
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ── Tab AI: AI 模型与解析配置 ── */}
      {tab === "ai" && (
        <div className="admin-grid">
          <form
            className="admin-card admin-ai-form"
            aria-labelledby="ai-settings-heading"
            onSubmit={handleSaveAiSettings}
          >
            <div className="admin-card-head">
              <h2 id="ai-settings-heading">大模型接入与结构化解析配置</h2>
              <button
                type="button"
                className="plain-button plain-button-sm"
                onClick={() => {
                  void loadAiSettings();
                  void loadAiStats();
                }}
              >
                <RefreshCw />
                <span>刷新配置</span>
              </button>
            </div>
            <p className="admin-hint">
              支持所有 OpenAI 兼容接口（DeepSeek / 通义千问 / 智谱 / Kimi / 硅基流动 / Gemini / Ollama 本地）。保存后立即热生效，无需重启服务。
            </p>

            <fieldset className="admin-fieldset">
              <legend className="admin-legend">
                <KeyRound style={{ width: 14, height: 14 }} />
                <span>1. 接口服务商与鉴权</span>
              </legend>

              <div className="msg-field">
                <label htmlFor="ai-provider-select">服务商预设</label>
                <select
                  id="ai-provider-select"
                  className="admin-select"
                  value={aiDraft.provider}
                  onChange={(e) => handleSelectProvider(e.target.value as AiProviderId)}
                >
                  {AI_PROVIDER_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {currentPreset && <span className="admin-field-help">{currentPreset.hint}</span>}
              </div>

              <div className="msg-field">
                <label htmlFor="ai-api-base">API Base URL（含 /v1 或兼容路径）</label>
                <input
                  id="ai-api-base"
                  type="url"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={aiDraft.apiBase}
                  onChange={(e) =>
                    setAiDraft((prev) => ({ ...prev, apiBase: e.target.value }))
                  }
                  placeholder="https://api.deepseek.com/v1"
                  required
                />
              </div>

              <div className="msg-field">
                <label htmlFor="ai-api-key">
                  API Key（{isLocalAiBase(aiDraft.apiBase, aiDraft.provider) ? "本地服务可留空" : "留空则保留当前已存密钥"}）
                </label>
                <div className="admin-input-pw-wrap">
                  <input
                    id="ai-api-key"
                    type={showApiKey ? "text" : "password"}
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoComplete="off"
                    value={aiDraft.apiKey}
                    onChange={(e) =>
                      setAiDraft((prev) => ({ ...prev, apiKey: e.target.value }))
                    }
                    placeholder={
                      aiSettings?.hasApiKey
                        ? `已存在密钥（${aiSettings.apiKeyMasked}），输入新密钥可覆盖`
                        : isLocalAiBase(aiDraft.apiBase, aiDraft.provider)
                          ? "本地服务可不填 API Key"
                          : "输入 sk-... 或平台 API Key"
                    }
                  />
                  <button
                    type="button"
                    className="admin-pw-toggle"
                    aria-pressed={showApiKey}
                    aria-label={showApiKey ? "隐藏 API 密钥" : "显示 API 密钥"}
                    onClick={() => setShowApiKey((v) => !v)}
                  >
                    {showApiKey ? <EyeOff /> : <Eye />}
                  </button>
                </div>
                <div className="admin-key-meta">
                  <span className="admin-field-help">
                    {aiSettings?.keySource === "saved"
                      ? `当前生效：后台文件安全保存（${aiSettings.apiKeyMasked}），不会在界面回传明文。`
                      : aiSettings?.keySource === "env"
                        ? `当前生效：环境变量 AI_API_KEY（${aiSettings.apiKeyMasked}）。`
                        : isLocalAiBase(aiDraft.apiBase, aiDraft.provider)
                          ? "当前使用本地推理地址，可免密直连。"
                          : "尚未配置有效密钥；未配置时自动降级为内置规则解析。"}
                  </span>
                  {aiSettings?.keySource === "saved" && (
                    <button
                      type="button"
                      className="plain-button plain-button-sm"
                      disabled={aiSaving}
                      onClick={() => void handleClearSavedKey()}
                    >
                      清空已存密钥
                    </button>
                  )}
                </div>
              </div>
            </fieldset>

            <fieldset className="admin-fieldset">
              <legend className="admin-legend">
                <Sparkles style={{ width: 14, height: 14 }} />
                <span>2. 模型选择（支持自动获取模型列表）</span>
              </legend>

              <div className="msg-field">
                <label htmlFor="ai-model-input">模型 ID</label>
                <div className="admin-input-row">
                  <input
                    id="ai-model-input"
                    type="text"
                    list="ai-models-datalist"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={aiDraft.model}
                    onChange={(e) =>
                      setAiDraft((prev) => ({ ...prev, model: e.target.value }))
                    }
                    placeholder="例如 deepseek-chat / qwen-plus / gemini-2.5-flash"
                    required
                  />
                  <button
                    type="button"
                    className="plain-button"
                    disabled={fetchingModels}
                    onClick={() => void handleFetchModels()}
                  >
                    <RefreshCw className={fetchingModels ? "spin" : ""} />
                    <span>{fetchingModels ? "获取中..." : "自动获取模型"}</span>
                  </button>
                </div>
                <datalist id="ai-models-datalist">
                  {(fetchedModels.length > 0
                    ? fetchedModels.map((m) => m.id)
                    : currentPreset?.defaultModel
                      ? [currentPreset.defaultModel]
                      : []
                  ).map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
              </div>

              {fetchedModels.length > 0 && (
                <div className="admin-model-picker">
                  <div className="msg-field">
                    <label htmlFor="ai-model-filter">
                      筛选已获取模型（共 {fetchedModels.length} 个
                      {modelsEndpoint ? ` · 来源 ${modelsEndpoint}` : ""}）
                    </label>
                    <input
                      id="ai-model-filter"
                      type="search"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={modelFilter}
                      onChange={(e) => setModelFilter(e.target.value)}
                      placeholder="按关键词搜索模型 ID，如 chat / flash / r1 / qwen..."
                    />
                  </div>
                  <div className="admin-model-chips">
                    {visibleModels.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="admin-model-chip"
                        aria-pressed={aiDraft.model === m.id}
                        onClick={() =>
                          setAiDraft((prev) => ({ ...prev, model: m.id }))
                        }
                      >
                        <span>{m.id}</span>
                        {m.category !== "chat" && (
                          <em data-cat={m.category}>
                            {m.category === "reasoning" ? "推理" : "非对话"}
                          </em>
                        )}
                      </button>
                    ))}
                    {filteredModels.length === 0 && (
                      <span className="admin-field-help">未找到匹配「{modelFilter}」的模型。</span>
                    )}
                  </div>
                  {filteredModels.length > 36 && !showAllModels && (
                    <button
                      type="button"
                      className="plain-button plain-button-sm"
                      onClick={() => setShowAllModels(true)}
                    >
                      展开全部 {filteredModels.length} 个模型
                    </button>
                  )}
                </div>
              )}
            </fieldset>

            <fieldset className="admin-fieldset">
              <legend className="admin-legend">
                <Sliders style={{ width: 14, height: 14 }} />
                <span>3. 解析行为与高级参数</span>
              </legend>

              <div className="admin-scopes">
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={aiDraft.enabled}
                    onChange={(e) =>
                      setAiDraft((prev) => ({ ...prev, enabled: e.target.checked }))
                    }
                  />
                  <span>启用大模型解析（取消后保留配置并临时切换回本地规则引擎）</span>
                </label>
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={aiDraft.useJsonMode}
                    onChange={(e) =>
                      setAiDraft((prev) => ({ ...prev, useJsonMode: e.target.checked }))
                    }
                  />
                  <span>强制 JSON 输出模式（response_format=json_object）</span>
                </label>
              </div>

              <div className="admin-form-grid">
                <div className="msg-field">
                  <label htmlFor="ai-temperature">采样温度 Temperature (0~1.5)</label>
                  <input
                    id="ai-temperature"
                    type="number"
                    min={0}
                    max={1.5}
                    step={0.1}
                    inputMode="decimal"
                    value={aiDraft.temperature}
                    onChange={(e) =>
                      setAiDraft((prev) => ({
                        ...prev,
                        temperature: Number.isFinite(Number(e.target.value))
                          ? Number(e.target.value)
                          : 0.1,
                      }))
                    }
                  />
                </div>
                <div className="msg-field">
                  <label htmlFor="ai-timeout">单条请求超时 (ms)</label>
                  <input
                    id="ai-timeout"
                    type="number"
                    min={3000}
                    max={120000}
                    step={1000}
                    inputMode="numeric"
                    value={aiDraft.timeoutMs}
                    onChange={(e) =>
                      setAiDraft((prev) => ({
                        ...prev,
                        timeoutMs: Number.isFinite(Number(e.target.value))
                          ? Number(e.target.value)
                          : 25000,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="msg-field">
                <label htmlFor="ai-custom-instructions">华农补充解析偏好（可选）</label>
                <textarea
                  id="ai-custom-instructions"
                  rows={3}
                  value={aiDraft.customInstructions}
                  onChange={(e) =>
                    setAiDraft((prev) => ({
                      ...prev,
                      customInstructions: e.target.value,
                    }))
                  }
                  placeholder="例如：重点识别五山/启林南/泰山/华山校区地点，以及丁颖创新班、卢永根书院等受众群体..."
                />
              </div>
            </fieldset>

            <div className="admin-btn-row">
              <button type="submit" className="primary-button" disabled={aiSaving}>
                <Save />
                <span>{aiSaving ? "保存中..." : "保存并热生效"}</span>
              </button>
              <button
                type="button"
                className="plain-button"
                disabled={testingAi}
                onClick={() => void handleTestAi()}
              >
                <Zap className={testingAi ? "spin" : ""} />
                <span>{testingAi ? "测试中..." : "测试连通性"}</span>
              </button>
            </div>

            <div role="status" aria-live="polite" className="admin-ai-live-region">
              {aiProbeStatus && (
                <div
                  className="admin-ai-status"
                  data-ok={aiProbeStatus.ok ? "true" : "false"}
                >
                  {aiProbeStatus.message}
                </div>
              )}
            </div>
          </form>

          <section className="admin-card">
            <h2>当前生效状态与全站批量解析</h2>
            <div className="admin-kv">
              <div>
                <span>解析引擎状态</span>
                <strong>
                  {aiSettings?.configured
                    ? `大模型已就绪（${PRESET_MAP.get(aiSettings.provider)?.label ?? aiSettings.provider}）`
                    : aiSettings?.enabled === false
                      ? "已手动关闭大模型（使用内置规则引擎）"
                      : "未配置有效密钥（自动降级为内置规则引擎）"}
                </strong>
              </div>
              <div>
                <span>生效模型</span>
                <strong>{aiSettings?.model || aiStats?.model || "gpt-4o-mini"}</strong>
              </div>
              <div>
                <span>密钥来源</span>
                <strong>
                  {aiSettings?.keySource === "saved"
                    ? `后台保存 (${aiSettings.apiKeyMasked})`
                    : aiSettings?.keySource === "env"
                      ? `环境变量 (${aiSettings.apiKeyMasked})`
                      : aiSettings && !aiSettings.requiresApiKey
                        ? "本地免密服务"
                        : "未配置"}
                </strong>
              </div>
              <div>
                <span>结构化覆盖进度</span>
                <strong>
                  {aiStats?.enriched ?? 0} / {aiStats?.total ?? 0}（大模型 {aiStats?.aiCount ?? 0} 条）
                </strong>
              </div>
            </div>

            <p className="admin-hint" style={{ marginTop: 14 }}>
              新抓取的通知（当启用定时或手动采集且开启自动解析时）会按上述配置自动抽取
              <code>cleanTitle</code>、<code>summary</code>、<code>startsAt/venue</code>、
              <code>audience</code> 与 <code>importance</code>；若某监控规则启用了第二阶段 AI
              相关性筛选，也将复用此模型配置。
            </p>

            <div className="admin-btn-row">
              <button
                type="button"
                className="primary-button"
                disabled={opsBusy}
                onClick={() => void handleBatchEnrich(false)}
              >
                <Sparkles />
                <span>补充缺失结构化摘要（30 条）</span>
              </button>
              <button
                type="button"
                className="plain-button"
                disabled={opsBusy || !aiSettings?.configured}
                onClick={() => void handleBatchEnrich(true)}
              >
                <CheckCircle2 />
                <span>升级规则条目为 AI 解析（25 条）</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ── Tab 2: 监控规则与占位符模板 ── */}
      {tab === "alerts" && (
        <div className="admin-grid">
          <form className="admin-card" onSubmit={handleSaveRule}>
            <h2>新建精确 / AI 监控规则</h2>

            <div className="admin-form-grid">
              <div className="msg-field">
                <label htmlFor="rule-name">规则名称</label>
                <input
                  id="rule-name"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  required
                />
              </div>

              <div className="msg-field">
                <label htmlFor="rule-sub">接收人称呼（对应 &#123;&#123;subscriber&#125;&#125;）</label>
                <input
                  id="rule-sub"
                  value={subscriber}
                  onChange={(e) => setSubscriber(e.target.value)}
                  placeholder="例如：张三同学"
                />
              </div>
            </div>

            <div className="msg-field" style={{ marginTop: 10 }}>
              <label htmlFor="rule-kw">
                监控关键词 / 姓名 / 学号（逗号或换行分隔，支持匹配 Excel 表格每一行）
              </label>
              <input
                id="rule-kw"
                value={keywordsStr}
                onChange={(e) => setKeywordsStr(e.target.value)}
                placeholder="例如：张三, 2024250101, 奖学金公示"
              />
            </div>

            <div className="admin-scopes">
              <span>匹配范围：</span>
              {(
                [
                  ["title", "标题"],
                  ["body", "正文"],
                  ["attachment", "PDF/DOCX附件"],
                  ["xlsx", "Excel表格行"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="admin-check">
                  <input
                    type="checkbox"
                    checked={scopes.includes(k)}
                    onChange={(e) =>
                      setScopes((prev) =>
                        e.target.checked ? [...prev, k] : prev.filter((x) => x !== k),
                      )
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <div className="admin-ai-box">
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  onChange={(e) => setAiEnabled(e.target.checked)}
                />
                <Bot style={{ width: 15, height: 15 }} />
                <span>启用第二阶段 AI 语义相关性判定（关键词未命中时由 AI 补充筛选）</span>
              </label>
              {aiEnabled && (
                <input
                  type="text"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="描述你关注的通知条件..."
                />
              )}
            </div>

            <div className="admin-form-grid" style={{ marginTop: 10 }}>
              <div className="msg-field">
                <label htmlFor="ch-type">推送通道</label>
                <select
                  id="ch-type"
                  className="admin-select"
                  value={channelType}
                  onChange={(e) => setChannelType(e.target.value as ChannelType)}
                >
                  {CHANNEL_META.map((c) => (
                    <option key={c.type} value={c.type}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="msg-field">
                <label htmlFor="ch-ep">{channelMeta.endpointLabel}</label>
                <input
                  id="ch-ep"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder={channelMeta.endpointPh}
                />
              </div>
              {channelMeta.tokenLabel && (
                <div className="msg-field">
                  <label htmlFor="ch-tk">{channelMeta.tokenLabel}</label>
                  <input
                    id="ch-tk"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={channelMeta.tokenPh}
                  />
                </div>
              )}
              {channelMeta.recipientLabel && (
                <div className="msg-field">
                  <label htmlFor="ch-rc">{channelMeta.recipientLabel}</label>
                  <input
                    id="ch-rc"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder={channelMeta.recipientPh}
                  />
                </div>
              )}
            </div>

            <div className="msg-field" style={{ marginTop: 12 }}>
              <label htmlFor="rule-tpl">个性化通知模板（点击下方占位符即可插入）</label>
              <div className="placeholder-chips">
                {placeholders.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className="placeholder-chip"
                    title={`${p.label} · 示例：${p.example}`}
                    onClick={() => setTemplate((t) => `${t}{{${p.key}}}`)}
                  >
                    {p.label} <code>{`{{${p.key}}}`}</code>
                  </button>
                ))}
              </div>
              <textarea
                id="rule-tpl"
                rows={5}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
              />
            </div>

            <div className="admin-btn-row">
              <button type="submit" className="primary-button">
                <Plus style={{ width: 15, height: 15 }} />
                <span>保存规则</span>
              </button>
              <button
                type="button"
                className="plain-button"
                onClick={() => void handlePreviewOrTest(false)}
              >
                <span>预览渲染效果</span>
              </button>
              <button
                type="button"
                className="plain-button"
                onClick={() => void handlePreviewOrTest(true)}
              >
                <Send style={{ width: 14, height: 14 }} />
                <span>真实发送测试</span>
              </button>
            </div>

            {previewText && (
              <pre className="admin-preview-box">{previewText}</pre>
            )}
          </form>

          <section className="admin-card">
            <h2>已生效规则（{rules.length}）</h2>
            {rules.length === 0 ? (
              <p className="admin-hint">暂无规则，请在左侧创建。命中通知与 Excel 行时将自动推送。</p>
            ) : (
              <ul className="admin-rule-list">
                {rules.map((r) => (
                  <li key={r.id} className="admin-rule-item">
                    <div>
                      <strong>{r.name}</strong>
                      <span>
                        关键词：{r.keywords.join("、") || "仅按维度/AI"} · 通道：{r.channel.type}
                      </span>
                    </div>
                    <div className="admin-rule-actions">
                      <button
                        type="button"
                        className="plain-button plain-button-sm"
                        onClick={() => void toggleRuleEnabled(r)}
                      >
                        {r.enabled ? "已启用" : "已停用"}
                      </button>
                      <button
                        type="button"
                        className="plain-button plain-button-sm"
                        aria-label="删除规则"
                        onClick={() => void deleteRule(r.id)}
                      >
                        <Trash2 style={{ width: 13, height: 13 }} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <h2 style={{ marginTop: 22 }}>最近提醒投递日志（{logs.length}）</h2>
            {logs.length === 0 ? (
              <p className="admin-hint">暂无投递记录。</p>
            ) : (
              <ul className="admin-log-list">
                {logs.slice(0, 12).map((l) => (
                  <li key={l.id} className="admin-log-item">
                    <div className="admin-log-top">
                      <strong>{l.ruleName}</strong>
                      <span className="guestbook-status" data-status={l.ok ? "done" : "working"}>
                        {l.ok ? "已送达" : "失败"}
                      </span>
                    </div>
                    <div className="admin-log-title">{l.noticeTitle}</div>
                    <div className="admin-log-meta">
                      {l.matchedSummary} {l.error ? `· ${l.error}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* ── Tab 3: 采集、AI 与静态发布 ── */}
      {tab === "ops" && (
        <div className="admin-grid">
          <section className="admin-card admin-card-full">
            <div className="admin-card-head">
              <h2>
                <Clock
                  style={{ width: 16, height: 16, verticalAlign: -3, marginRight: 6 }}
                />
                定时抓取与前端自动同步调度
              </h2>
              <button
                type="button"
                className="plain-button plain-button-sm"
                onClick={() => void loadSchedule(false)}
              >
                <RefreshCw />
                <span>刷新状态</span>
              </button>
            </div>

            <div className="admin-kv">
              <div>
                <span>定时引擎状态</span>
                <strong>
                  {schedStatus?.running
                    ? "正在抓取执行中..."
                    : schedStatus?.config.enabled
                      ? "运行中（自动调度已开启）"
                      : "已暂停"}
                </strong>
              </div>
              <div>
                <span>上次运行结果</span>
                <strong>
                  {schedStatus?.lastRunAt
                    ? `${new Date(schedStatus.lastRunAt).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })} · ${
                        schedStatus.lastResult?.ok
                          ? `新增 ${schedStatus.lastResult.added} / 共 ${schedStatus.lastResult.total} 条`
                          : `失败: ${schedStatus.lastResult?.error ?? "异常"}`
                      }`
                    : "暂无定时运行记录"}
                </strong>
              </div>
              <div>
                <span>下次预计抓取</span>
                <strong>
                  {schedStatus?.nextRunAt
                    ? new Date(schedStatus.nextRunAt).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })
                    : schedStatus?.running
                      ? "本次结束后重排"
                      : "已暂停"}
                </strong>
              </div>
              <div>
                <span>前端无感同步</span>
                <strong>
                  {schedStatus?.config.frontendSyncSeconds
                    ? `每 ${schedStatus.config.frontendSyncSeconds} 秒自动检测`
                    : "已关闭"}
                </strong>
              </div>
            </div>

            {schedDraft && (
              <div className="admin-schedule-box">
                <div className="admin-schedule-grid">
                  <div className="field-row">
                    <label>定时抓取周期</label>
                    <select
                      className="admin-select"
                      value={schedDraft.intervalMinutes}
                      onChange={(e) =>
                        setSchedDraft({
                          ...schedDraft,
                          intervalMinutes: Number(e.target.value),
                        })
                      }
                    >
                      <option value={5}>每 5 分钟</option>
                      <option value={15}>每 15 分钟</option>
                      <option value={30}>每 30 分钟（推荐）</option>
                      <option value={60}>每 1 小时</option>
                      <option value={120}>每 2 小时</option>
                      <option value={360}>每 6 小时</option>
                      <option value={720}>每 12 小时</option>
                      <option value={1440}>每天一次（24小时）</option>
                    </select>
                  </div>

                  <div className="field-row">
                    <label>每源单次抓取上限</label>
                    <select
                      className="admin-select"
                      value={schedDraft.limitPerSource}
                      onChange={(e) =>
                        setSchedDraft({
                          ...schedDraft,
                          limitPerSource: Number(e.target.value),
                        })
                      }
                    >
                      <option value={5}>5 条 / 站（轻量快）</option>
                      <option value={10}>10 条 / 站（均衡）</option>
                      <option value={15}>15 条 / 站</option>
                      <option value={20}>20 条 / 站（深度）</option>
                    </select>
                  </div>

                  <div className="field-row">
                    <label>前端页面自动同步间隔</label>
                    <select
                      className="admin-select"
                      value={schedDraft.frontendSyncSeconds}
                      onChange={(e) =>
                        setSchedDraft({
                          ...schedDraft,
                          frontendSyncSeconds: Number(e.target.value),
                        })
                      }
                    >
                      <option value={0}>关闭前端自动轮询</option>
                      <option value={15}>每 15 秒（高实时）</option>
                      <option value={30}>每 30 秒</option>
                      <option value={60}>每 60 秒（默认，省流量）</option>
                      <option value={120}>每 2 分钟</option>
                      <option value={300}>每 5 分钟</option>
                    </select>
                  </div>
                </div>

                <div className="admin-scopes">
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      checked={schedDraft.enabled}
                      onChange={(e) =>
                        setSchedDraft({ ...schedDraft, enabled: e.target.checked })
                      }
                    />
                    <span>启用后台定时抓取</span>
                  </label>
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      checked={schedDraft.includeWechat}
                      onChange={(e) =>
                        setSchedDraft({
                          ...schedDraft,
                          includeWechat: e.target.checked,
                        })
                      }
                    />
                    <span>同步微信公众号 (we-mp-rss)</span>
                  </label>
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      checked={schedDraft.autoEnrich}
                      onChange={(e) =>
                        setSchedDraft({
                          ...schedDraft,
                          autoEnrich: e.target.checked,
                        })
                      }
                    />
                    <span>新增自动 AI/规则解析</span>
                  </label>
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      checked={schedDraft.autoAlerts}
                      onChange={(e) =>
                        setSchedDraft({
                          ...schedDraft,
                          autoAlerts: e.target.checked,
                        })
                      }
                    />
                    <span>新增自动触发提醒</span>
                  </label>
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      checked={schedDraft.autoExportStatic}
                      onChange={(e) =>
                        setSchedDraft({
                          ...schedDraft,
                          autoExportStatic: e.target.checked,
                        })
                      }
                    />
                    <span>新增自动导出静态快照 & CDN Hook</span>
                  </label>
                </div>

                <div className="admin-btn-row">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={schedSaving}
                    onClick={async () => {
                      setSchedSaving(true);
                      setBanner(null);
                      try {
                        const r = await fetch("/api/schedule", {
                          method: "PUT",
                          headers: authHeaders(),
                          body: JSON.stringify(schedDraft),
                        });
                        const j = (await r.json()) as ScheduleStatus & {
                          ok?: boolean;
                          error?: string;
                        };
                        if (r.ok) {
                          setSchedStatus(j);
                          setSchedDraft(j.config);
                          notifyFrontendSync();
                          setBanner({
                            ok: true,
                            msg: `已保存定时调度配置：${
                              j.config.enabled
                                ? `每 ${j.config.intervalMinutes} 分钟定时抓取，前端每 ${j.config.frontendSyncSeconds} 秒自动同步`
                                : "后台定时抓取已暂停"
                            }`,
                          });
                        } else {
                          setBanner({ ok: false, msg: j.error || "保存调度配置失败" });
                        }
                      } finally {
                        setSchedSaving(false);
                      }
                    }}
                  >
                    <Save style={{ width: 15, height: 15 }} />
                    <span>保存调度配置</span>
                  </button>

                  <button
                    type="button"
                    className="plain-button"
                    disabled={opsBusy || Boolean(schedStatus?.running)}
                    onClick={async () => {
                      setOpsBusy(true);
                      setBanner(null);
                      try {
                        const r = await fetch("/api/schedule", {
                          method: "POST",
                          headers: authHeaders(),
                          body: JSON.stringify({ action: "run_now" }),
                        });
                        const j = (await r.json()) as ScheduleStatus & {
                          ok?: boolean;
                          error?: string;
                          result?: {
                            added?: number;
                            total?: number;
                            wechatCount?: number;
                          };
                        };
                        setSchedStatus(j);
                        const wechatCount =
                          j.result?.wechatCount ?? j.lastResult?.wechatCount ?? 0;
                        setBanner({
                          ok: Boolean(r.ok && j.ok),
                          msg: j.ok
                            ? `手动调度完成：新增 ${j.result?.added ?? 0} 条（含微信 ${wechatCount} 条），库内共 ${j.result?.total ?? 0} 条`
                            : j.error || "执行失败",
                        });
                        if (r.ok && j.ok) notifyFrontendSync();
                        await loadAiStats();
                      } finally {
                        setOpsBusy(false);
                      }
                    }}
                  >
                    {opsBusy || schedStatus?.running ? (
                      <>
                        <RefreshCw
                          className="spin"
                          style={{ width: 14, height: 14 }}
                        />
                        <span>正在执行抓取（约 30-60 秒）...</span>
                      </>
                    ) : (
                      <>
                        <Play style={{ width: 14, height: 14 }} />
                        <span>立即运行一次定时任务</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {schedStatus && schedStatus.history.length > 0 && (
              <div className="admin-history-wrap">
                <h3 className="admin-subhead">最近执行记录（{schedStatus.history.length}）</h3>
                <ul className="admin-history-list">
                  {schedStatus.history.slice(0, 8).map((h, i) => (
                    <li key={`${h.startedAt}-${i}`} className="admin-history-item">
                      <span>
                        <strong>{h.trigger === "timer" ? "定时" : "手动"}</strong> ·{" "}
                        {new Date(h.startedAt).toLocaleString("zh-CN", {
                          timeZone: "Asia/Shanghai",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span>
                        {h.ok
                          ? `新增 ${h.added} / 共 ${h.total} 条（微信 ${h.wechatCount}）· ${Math.round(
                              h.durationMs / 1000,
                            )}s`
                          : `失败：${h.error || "异常"}`}
                      </span>
                      <span
                        className="guestbook-status"
                        data-status={h.ok ? "done" : "working"}
                      >
                        {h.ok ? "成功" : "失败"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="admin-card">
            <h2>全站采集与 AI 结构化解析</h2>
            <div className="admin-kv">
              <div>
                <span>AI 接口配置</span>
                <strong>
                  {aiStats?.aiConfigured
                    ? `已就绪 (${aiStats.provider ? `${aiStats.provider} · ` : ""}${aiStats.model})`
                    : "未配密钥或已禁用（当前使用内置规则解析）"}
                </strong>
              </div>
              <div>
                <span>已结构化条目</span>
                <strong>
                  {aiStats?.enriched ?? 0} / {aiStats?.total ?? 0}（大模型 {aiStats?.aiCount ?? 0}）
                </strong>
              </div>
            </div>

            <div className="admin-btn-row">
              <button
                type="button"
                className="plain-button"
                onClick={() => setTab("ai")}
              >
                <Bot />
                <span>配置 AI 模型与密钥</span>
              </button>

              <button
                type="button"
                className="primary-button"
                disabled={opsBusy}
                onClick={async () => {
                  setOpsBusy(true);
                  setBanner(null);
                  try {
                    const r = await fetch("/api/crawl", {
                      method: "POST",
                      headers: authHeaders(),
                      body: JSON.stringify({ limitPerSource: 10, fetchDetail: true }),
                    });
                    const j = await r.json();
                    setBanner({
                      ok: Boolean(j.ok),
                      msg: j.ok
                        ? `采集完成：新增 ${j.added} 条，库内 ${j.total} 条（微信 ${j.wechat?.count ?? 0} 条）`
                        : j.error || "采集失败",
                    });
                    if (j.ok) notifyFrontendSync();
                    await loadAiStats();
                    await loadSchedule(false);
                  } finally {
                    setOpsBusy(false);
                  }
                }}
              >
                <RefreshCw className={opsBusy ? "spin" : ""} />
                <span>运行全量采集 + 附件解析 + 监控匹配</span>
              </button>

              <button
                type="button"
                className="plain-button"
                disabled={opsBusy}
                onClick={() => void handleBatchEnrich(false)}
              >
                <Sparkles style={{ width: 15, height: 15 }} />
                <span>批量补充结构化摘要与重要度</span>
              </button>

              {aiStats?.aiConfigured && (
                <button
                  type="button"
                  className="plain-button"
                  disabled={opsBusy}
                  onClick={() => void handleBatchEnrich(true)}
                >
                  <CheckCircle2 style={{ width: 15, height: 15 }} />
                  <span>升级规则条目为 AI 解析</span>
                </button>
              )}
            </div>
          </section>

          <section className="admin-card">
            <h2>静态快照导出与 CDN 自动部署</h2>
            <p className="admin-hint">
              导出静态分片 JSON 至 <code>public/static-data/</code>，并通过 Deploy Hook / GitHub Actions 触发 Cloudflare Pages 或 Vercel 自动编译分发静态站。
            </p>
            <div className="admin-btn-row">
              <button
                type="button"
                className="primary-button"
                disabled={opsBusy}
                onClick={async () => {
                  setOpsBusy(true);
                  setBanner(null);
                  try {
                    const r = await fetch("/api/export-static", {
                      method: "POST",
                      headers: authHeaders(),
                      body: JSON.stringify({ triggerDeploy: true }),
                    });
                    const j = await r.json();
                    setBanner({
                      ok: Boolean(j.ok),
                      msg: j.ok
                        ? `已导出 ${j.total} 条数据 (${j.filesWritten?.length ?? 0} 个静态文件)，触发 ${j.deployTriggers?.length ?? 0} 个 Deploy Hook`
                        : j.error || "导出失败",
                    });
                  } finally {
                    setOpsBusy(false);
                  }
                }}
              >
                <CloudUpload style={{ width: 15, height: 15 }} />
                <span>导出静态快照并触发 CI/CD 部署</span>
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
