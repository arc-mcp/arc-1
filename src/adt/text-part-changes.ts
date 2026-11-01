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

interface TextEntry {
  value: string;
  ddic: boolean;
  maintained: boolean;
  maxLength?: number;
}
/** Verification rejects ambiguous input instead of silently overwriting keys. */
function comparableEntries(part: TextElementPart, body: string): Map<string, TextEntry> | undefined {
  const result = new Map<string, TextEntry>();
  let ddic = false,
    maxLength: number | undefined;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.trim() === '@DDICReference') {
      if (ddic) return undefined;
      ddic = true;
      continue;
    }
    const length = /^@MaxLength:(\d+)$/.exec(line.trim());
    if (length) {
      if (maxLength !== undefined || !Number.isSafeInteger(Number(length[1]))) return undefined;
      maxLength = Number(length[1]);
      continue;
    }
    const equals = line.indexOf('=');
    if (equals < 1) return undefined;
    // Native selection keys are padded; case is canonicalized by SAP. Preserve leading value spaces.
    const key = line.slice(0, equals).trim().toUpperCase(),
      value = line.slice(equals + 1).trimEnd();
    if (!key || result.has(key)) return undefined;
    result.set(key, {
      value,
      ddic,
      maxLength,
      maintained: value.trim() !== '' && (part !== 'selections' || value !== '?...'),
    });
    ddic = false;
    maxLength = undefined;
  }
  return ddic || maxLength !== undefined ? undefined : result;
}

/** Verify whole-part semantics before activation. DDIC labels may resolve differently, but keys and reference markers must survive. */
export function textPartMatchesRequest(part: TextElementPart, requested: string, stored: string): boolean {
  const expected = comparableEntries(part, requested),
    actual = comparableEntries(part, stored);
  if (!expected || !actual) return false;
  for (const [key, entry] of expected) {
    const found = actual.get(key);
    if (!found) {
      if (entry.maintained || entry.ddic) return false;
      continue;
    }
    if (entry.ddic !== found.ddic) return false;
    if (!entry.ddic && (entry.maintained || found.maintained) && entry.value !== found.value) return false;
    if (entry.maxLength !== undefined && entry.maxLength !== found.maxLength) return false;
  }
  for (const [key, entry] of actual) if (!expected.has(key) && (entry.maintained || entry.ddic)) return false;
  return true;
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
