import type { TextElementPart } from './text-elements.js';

/** Read SAP's canonical part bodies, not user input: SAP normalizes keys and resolves
 * dictionary labels. Removed selections are absent or KEY=?..., empty headings KEY=. */
function entries(part: TextElementPart, body: string): Map<string, { maintained: boolean; ddic: boolean }> {
  const result = new Map<string, { maintained: boolean; ddic: boolean }>();
  let ddic = false;
  for (const line of body.split(/\r?\n/)) {
    if (line.trim() === '@DDICReference') ddic = true;
    const equals = line.indexOf('=');
    if (equals < 0) continue;
    const value = line.slice(equals + 1).trim();
    result.set(line.slice(0, equals).trim(), {
      maintained: value !== '' && (part !== 'selections' || value !== '?...'),
      ddic,
    });
    ddic = false;
  }
  return result;
}

/** Describe only losses confirmed by a native read after the PUT, while still locked. */
export function textPartChanges(part: TextElementPart, before: string, after: string): string {
  const next = entries(part, after);
  const removed: string[] = [];
  const references: string[] = [];
  for (const [key, old] of entries(part, before)) {
    const current = next.get(key);
    if ((old.maintained && !current?.maintained) || (part === 'symbols' && !current)) removed.push(key);
    if (old.ddic && !current?.ddic) references.push(key);
  }
  const lines: string[] = [];
  if (removed.length) lines.push(`Removed texts: ${removed.join(', ')}.`);
  if (references.length) lines.push(`Removed dictionary references: ${references.join(', ')}.`);
  if (!lines.length) return '';
  lines.push('To restore them, resend the previous complete part, including its annotations.');
  return `\n${lines.join('\n')}`;
}
