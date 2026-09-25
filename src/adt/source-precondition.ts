/** Content preconditions are checked against fresh editable bytes while holding the SAP lock. */
import { createHash } from 'node:crypto';
import { AdtSafetyError } from './errors.js';

export function sourceHash(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export function assertSourceHash(source: string, expected: string | undefined): void {
  if (expected !== undefined && sourceHash(source) !== expected) {
    throw new AdtSafetyError(
      'Source changed since it was read; no write was made. Re-read with SAPRead(format="editable"), review the changes, and pass its sourceHash as expectedSourceHash.',
    );
  }
}
