/** Content preconditions are checked against fresh editable bytes while holding the SAP lock. */
import { createHash } from 'node:crypto';
import { AdtSafetyError } from './errors.js';

export function sourceHash(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export function assertSourceHash(source: string, expected: string | undefined, sourceUrl: string): void {
  if (expected !== undefined && sourceHash(source) !== expected) {
    throw new AdtSafetyError(
      `Source changed, or expectedSourceHash came from a different object/include. No write was made. Checked ${sourceUrl}. Re-read the same object, include and group with SAPRead(format="editable"), review the changes, and pass its sourceHash.`,
    );
  }
}

/** A dry run's resultHash: the rebuilt write must equal the approved bytes exactly. */
export function assertResultHash(result: string, expected: string | undefined, sourceUrl: string): void {
  if (expected !== undefined && sourceHash(result) !== expected) {
    throw new AdtSafetyError(
      `The rebuilt change differs from the approved dry run (expectedResultHash). No write was made. Checked ${sourceUrl}. Run the dry run again, review the new diff, and pass its sourceHash and resultHash.`,
    );
  }
}
