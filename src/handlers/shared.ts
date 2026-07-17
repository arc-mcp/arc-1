/**
 * Shared primitives for the intent handlers: the MCP tool-result type and its two constructors.
 *
 * `textResult`/`errorResult` are used by every handler, so they live in a dependency-free module
 * that handler modules can import without pulling in the whole dispatcher.
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

/**
 * Serialize a tool result for the LLM. Compact, not pretty-printed.
 *
 * Two-space indentation plus newlines cost 15-37% of every JSON result — measured post-bounding:
 * where-used 11,856 -> 8,781 tokens, transport list 5,689 -> 3,581, SAPSearch 2,922 -> 2,472,
 * DEVC listing 5,372 -> 4,404. The output is still JSON (models are trained on it), so this is
 * whitespace only — NOT a token-optimized notation like TOON, which trades single-digit savings
 * for up to -36pp accuracy (arXiv 2605.29676).
 *
 * Use for every LLM-facing JSON payload. Human-facing output (audit previews, CLI rendering) is
 * formatted at its own layer, so nothing readable is lost.
 */
export function toolJson(value: unknown): string {
  return JSON.stringify(value);
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
