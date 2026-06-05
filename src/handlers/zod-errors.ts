/**
 * Format Zod validation errors into LLM-friendly messages.
 *
 * Produces structured error text with field paths and expected values,
 * consistent with the existing errorResult() pattern in intent.ts.
 */

/**
 * Format a ZodError into an LLM-friendly multi-line string.
 *
 * Example output:
 *   Invalid arguments for SAPRead:
 *     - "type": expected one of: PROG, CLAS, INTF, ..., got "PROGG"
 *     - "maxRows": expected number, got string
 *
 *   Hint: Fix the fields listed above, then retry — do NOT resend the same arguments unchanged.
 *   Tip: omit optional fields you do not need (do not send empty strings or null for them).
 */
// biome-ignore lint/suspicious/noExplicitAny: accepts any Zod error shape
export function formatZodError(error: { issues: ReadonlyArray<any> }, toolName: string): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'input';

    // Zod v4 uses 'code' to distinguish issue types
    if (issue.code === 'invalid_value' && issue.values) {
      return `${path}: expected one of: ${issue.values.join(', ')}`;
    }

    if (issue.code === 'invalid_type') {
      if (issue.input === undefined) {
        return `${path}: required (expected ${issue.expected ?? 'value'})`;
      }
      return `${path}: expected ${issue.expected ?? 'value'}, got ${typeof issue.input}`;
    }

    if (issue.code === 'unrecognized_keys' && issue.keys) {
      return `Unknown parameter(s): ${issue.keys.join(', ')}`;
    }

    return `${path}: ${issue.message}`;
  });

  return [
    `Invalid arguments for ${toolName}:`,
    ...issues.map((i) => `  - ${i}`),
    '',
    'Hint: Fix the fields listed above, then retry — do NOT resend the same arguments unchanged.',
    'Tip: omit optional fields you do not need (do not send empty strings or null for them).',
  ].join('\n');
}
