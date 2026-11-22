import { promises as fs } from "node:fs";
import path from "node:path";
import type { SubjectSlug } from "@/lib/site";

const DATA_DIR = process.env.BAUHINIA_DATA_DIR
  ? path.resolve(process.env.BAUHINIA_DATA_DIR)
  : path.join(process.cwd(), "data");

const RULES_FILE = path.join(DATA_DIR, "alert-rules.json");
const LOGS_FILE = path.join(DATA_DIR, "alert-logs.json");

export type ChannelType =
  | "webhook"
  | "wxpusher"
  | "pushplus"
  | "serverchan"
  | "bark"
  | "feishu"
  | "dingtalk"
  | "resend";

export interface AlertChannel {
  type: ChannelType;
  /** webhook / bark / feishu / dingtalk URL 或通道令牌 */
  endpoint: string;
  /** 通道密钥/发信邮箱/wxpusher uid 等附加参数 */
  token?: string;
  /** 收件邮箱或用户 UID */
  recipient?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  subscriberName?: string;
  keywords: string[];
  regexPatterns?: string[];
  scopes: ("title" | "body" | "attachment" | "xlsx")[];
  categories?: string[];
  sources?: string[];
  subjects?: SubjectSlug[];
  minImportance?: number;
  aiRelevance?: {
    enabled: boolean;
    prompt: string;
    minConfidence: number;
    requireAi?: boolean;
  };
  template: string;
  channel: AlertChannel;
  createdAt: string;
  updatedAt: string;
}

export interface AlertDeliveryLog {
  id: string;
  ruleId: string;
  ruleName: string;
  noticeId: string;
  noticeTitle: string;
  channelType: ChannelType;
  ok: boolean;
  error?: string;
  matchedSummary: string;
  renderedMessage: string;
  sentAt: string;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, val: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(val, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function readAlertRules(): Promise<AlertRule[]> {
  return readJson<AlertRule[]>(RULES_FILE, []);
}

export async function writeAlertRules(rules: AlertRule[]): Promise<void> {
  await writeJson(RULES_FILE, rules);
}

export async function readAlertLogs(): Promise<AlertDeliveryLog[]> {
  return readJson<AlertDeliveryLog[]>(LOGS_FILE, []);
}

export async function appendAlertLog(entry: AlertDeliveryLog): Promise<void> {
  const prev = await readAlertLogs();
  const next = [entry, ...prev].slice(0, 300);
  await writeJson(LOGS_FILE, next);
}

export async function hasDelivered(ruleId: string, noticeId: string): Promise<boolean> {
  const logs = await readAlertLogs();
  return logs.some((l) => l.ruleId === ruleId && l.noticeId === noticeId && l.ok);
}
