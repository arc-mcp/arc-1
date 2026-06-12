/**
 * Shared primitives for the intent handlers: the MCP tool-result type and its two constructors.
 *
 * `textResult`/`errorResult` are used by every handler, so they live in a dependency-free module
 * (extracted from intent.ts, Stage B) that handler modules can import without pulling in the whole
 * dispatcher.
 */

/** MCP tool call result */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** True when an error body carries an Open-SQL parser/grammar signature (SAPQuery + error hints). */
export function hasSqlParserSignature(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes('only one select statement is allowed') ||
    normalized.includes('only select statement is allowed') ||
    normalized.includes('invalid query string') ||
    normalized.includes('due to grammar') ||
    normalized.includes('is invalid here') ||
    normalized.includes('is invalid at this position')
  );
}
