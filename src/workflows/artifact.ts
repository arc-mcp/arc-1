import type { ToolResult } from '../handlers/shared.js';

/** Adapters must invoke the existing authenticated dispatcher/MCP connection. */
export type ToolInvoker = (tool: string, args: Record<string, unknown>) => Promise<ToolResult>;
export class WorkflowCallError extends Error {
  readonly status: 'blocked' | 'error';
  constructor(message: string) {
    super(message);
    this.status = /blocked by safety|Insufficient scope|denied by server policy|not allowed by.*policy/i.test(message)
      ? 'blocked'
      : 'error';
  }
}
export async function callText(call: ToolInvoker, tool: string, args: Record<string, unknown>): Promise<string> {
  const result = await call(tool, args);
  const text = result.content.map((c) => c.text).join('\n');
  if (Buffer.byteLength(text) > 4 * 1024 * 1024)
    throw new WorkflowCallError('Tool output exceeds workflow input budget.');
  if (result.isError) throw new WorkflowCallError(text.slice(0, 2000));
  return text;
}
export async function callJson(call: ToolInvoker, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const text = await callText(call, tool, args);
  try {
    return JSON.parse(text);
  } catch {
    throw new WorkflowCallError('Expected structured tool evidence; update the connected ARC-1 runtime.');
  }
}
export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
/** Standalone, script-free rendering. Source, SQL, Markdown and results stay escaped text. */
export function artifactHtml(title: string, sections: Array<{ title: string; text: string; detail?: string }>): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(title)}</title><style>body{font:16px/1.55 system-ui;background:#f4f6f8;color:#142b3c;max-width:1100px;margin:40px auto;padding:0 24px}h1{font-size:34px}section{background:white;border:1px solid #d7e0e7;border-radius:10px;padding:24px;margin:20px 0}h2{font-size:20px;margin-top:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,monospace}summary{cursor:pointer;color:#145b7f;font-weight:600}details{border-top:1px solid #e0e6eb;padding-top:12px}@media print{body{background:white;margin:0}section{break-inside:avoid}}</style><h1>${escapeHtml(title)}</h1>${sections.map((s) => `<section><h2>${escapeHtml(s.title)}</h2><pre>${escapeHtml(s.text)}</pre>${s.detail ? `<details><summary>Structured evidence</summary><pre>${escapeHtml(s.detail)}</pre></details>` : ''}</section>`).join('')}</html>`;
}
