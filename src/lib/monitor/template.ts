/**
 * 通知模板占位符安全渲染引擎（无 eval，支持 `{{key}}` 与 `{{#if key}}...{{/if}}`）。
 */

export const TEMPLATE_PLACEHOLDERS: { key: string; label: string; example: string }[] = [
  { key: "title", label: "通知原标题", example: "关于2026年本科生国家奖学金评审名单的公示" },
  { key: "clean_title", label: "AI精简标题", example: "2026本科生国家奖学金公示" },
  { key: "category_name", label: "分类名", example: "奖学金" },
  { key: "subject_name", label: "学科名", example: "信息机电" },
  { key: "source", label: "发布单位全称", example: "华南农业大学本科生院" },
  { key: "source_short", label: "发布单位简称", example: "本科生院" },
  { key: "published_at", label: "发布时间", example: "2026-11-21 10:30" },
  { key: "event_time", label: "活动时间", example: "11月22日 14:30–16:30" },
  { key: "venue", label: "活动地点", example: "数学系715" },
  { key: "registration", label: "是否需报名", example: "需报名" },
  { key: "summary", label: "摘要", example: "请各位申报同学于11月25日前核对附件公示名单。" },
  { key: "url", label: "原文链接", example: "https://jwc.scau.edu.cn/..." },
  { key: "importance", label: "重要度(1-5)", example: "5" },
  { key: "matched_keywords", label: "命中关键词", example: "张三, 奖学金" },
  { key: "matched_where", label: "命中位置", example: "Excel附件" },
  { key: "matched_file", label: "命中文件名", example: "2026奖学金推荐名单.xlsx" },
  { key: "matched_sheet", label: "命中工作表", example: "Sheet1" },
  { key: "matched_row", label: "命中行号", example: "47" },
  { key: "matched_row_detail", label: "命中行完整内容", example: "学院: 数信院 | 姓名: 张三 | 金额: 8000" },
  { key: "ai_reason", label: "AI判定理由", example: "包含奖学金公示名单附件" },
  { key: "subscriber", label: "接收人称呼", example: "张三同学" },
];

export const DEFAULT_ALERT_TEMPLATE = `{{#if subscriber}}👋 {{subscriber}}，你有新的华农监控提醒：
{{/if}}【{{category_name}} · {{source_short}}】{{clean_title}}
{{#if matched_file}}🎯 附件命中：{{matched_file}}{{#if matched_sheet}}（{{matched_sheet}} 第{{matched_row}}行）{{/if}}
{{#if matched_row_detail}}📋 行明细：{{matched_row_detail}}
{{/if}}{{/if}}{{#if matched_keywords}}🔑 命中词：{{matched_keywords}}
{{/if}}{{#if event_time}}⏰ 时间：{{event_time}}
{{/if}}{{#if venue}}📍 地点：{{venue}}
{{/if}}{{#if ai_reason}}✨ 说明：{{ai_reason}}
{{/if}}📝 摘要：{{summary}}
🔗 原文：{{url}}`;

/**
 * 安全渲染条件块与双花括号变量，并折叠多余空行。
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | undefined | null>,
): string {
  const safeGet = (key: string) => (vars[key] ?? "").trim();

  // 从内向外迭代处理嵌套 {{#if key}}...{{/if}}（仅匹配最内层不含子 #if 的块）
  let output = template;
  const ifRe = /\{\{#if\s+([a-zA-Z0-9_]+)\s*\}\}((?:(?!\{\{#if\b)[\s\S])*?)\{\{\/if\}\}/g;
  for (let pass = 0; pass < 8; pass++) {
    const next = output.replace(ifRe, (_full, key: string, inner: string) =>
      safeGet(key) ? inner : "",
    );
    if (next === output) break;
    output = next;
  }

  output = output.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key: string) =>
    safeGet(key),
  );

  return output.replace(/\n{3,}/g, "\n\n").trim();
}
