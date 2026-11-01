/** Content preconditions are checked against fresh editable bytes while holding the SAP lock. */
import { createHash } from 'node:crypto';
import { AdtSafetyError } from './errors.js';

export function sourceHash(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

/** ADT normalizes CRLF and terminal newlines; all other editable source bytes must agree. */
export function editableSourceEquals(left: string, right: string): boolean {
  const comparable = (source: string) => {
    const text = source.replace(/\r\n/g, '\n');
    let end = text.length;
    while (end > 0 && text.charCodeAt(end - 1) === 10) end--;
    return text.slice(0, end);
  };
  return comparable(left) === comparable(right);
}

export function assertSourceHash(source: string, expected: string | undefined, sourceUrl: string): void {
  if (expected !== undefined && sourceHash(source) !== expected) {
    throw new AdtSafetyError(
      `Source changed, or expectedSourceHash came from a different object/include. No write was made. Checked ${sourceUrl}. Re-read the same object, include and group with SAPRead(format="editable"), review the changes, and pass its sourceHash.`,
    );
  }
}
