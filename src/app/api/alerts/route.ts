import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import {
  readAlertLogs,
  readAlertRules,
  writeAlertRules,
  type AlertRule,
} from "@/lib/monitor/rules";
import { DEFAULT_ALERT_TEMPLATE, TEMPLATE_PLACEHOLDERS } from "@/lib/monitor/template";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  const [rules, logs] = await Promise.all([readAlertRules(), readAlertLogs()]);
  return NextResponse.json({
    rules,
    logs,
    placeholders: TEMPLATE_PLACEHOLDERS,
    defaultTemplate: DEFAULT_ALERT_TEMPLATE,
  });
}

export async function POST(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  const body = (await req.json()) as Partial<AlertRule>;
  const now = new Date().toISOString();
  const rules = await readAlertRules();

  const rule: AlertRule = {
    id: body.id || `rule_${Date.now()}`,
    name: (body.name ?? "新监控规则").trim(),
    enabled: body.enabled ?? true,
    subscriberName: body.subscriberName?.trim() || undefined,
    keywords: Array.isArray(body.keywords)
      ? body.keywords.map((k) => String(k).trim()).filter(Boolean)
      : [],
    regexPatterns: Array.isArray(body.regexPatterns)
      ? body.regexPatterns.map((k) => String(k).trim()).filter(Boolean)
      : undefined,
    scopes: body.scopes?.length ? body.scopes : ["title", "body", "attachment", "xlsx"],
    categories: body.categories?.length ? body.categories : undefined,
    sources: body.sources?.length ? body.sources : undefined,
    subjects: body.subjects?.length ? body.subjects : undefined,
    minImportance: body.minImportance,
    aiRelevance: body.aiRelevance,
    template: body.template?.trim() || DEFAULT_ALERT_TEMPLATE,
    channel: body.channel ?? { type: "webhook", endpoint: "" },
    createdAt: now,
    updatedAt: now,
  };

  rules.unshift(rule);
  await writeAlertRules(rules);
  return NextResponse.json({ ok: true, rule, rules });
}

export async function PUT(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  const body = (await req.json()) as Partial<AlertRule> & { id: string };
  if (!body.id) {
    return NextResponse.json({ error: "missing rule id" }, { status: 400 });
  }
  const rules = await readAlertRules();
  const idx = rules.findIndex((r) => r.id === body.id);
  if (idx < 0) {
    return NextResponse.json({ error: "rule not found" }, { status: 404 });
  }

  rules[idx] = {
    ...rules[idx],
    ...body,
    id: rules[idx].id,
    createdAt: rules[idx].createdAt,
    updatedAt: new Date().toISOString(),
  };
  await writeAlertRules(rules);
  return NextResponse.json({ ok: true, rule: rules[idx], rules });
}

export async function DELETE(req: Request) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const rules = await readAlertRules();
  const next = rules.filter((r) => r.id !== id);
  await writeAlertRules(next);
  return NextResponse.json({ ok: true, rules: next });
}
