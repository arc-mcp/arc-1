/** Exact SAP text identity. Only fixed-width trailing ASCII padding is normalized. */
import { TextReadError } from './errors.js';
import type { TextKey } from './types.js';

const KEY_LENGTHS = { TDOBJECT: 10, TDNAME: 70, TDID: 4, TDSPRAS: 1 } as const;

export function normalizeTextKey(value: unknown): TextKey {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TextReadError('INVALID_KEY', 'provide an exact object, name, ID and SAP language key');
  const input = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const [field, length] of Object.entries(KEY_LENGTHS)) {
    const item = input[field];
    if (
      typeof item !== 'string' ||
      item.length > length ||
      /\p{Surrogate}/u.test(item) ||
      Array.from(item).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw new TextReadError('INVALID_KEY', `invalid ${field}`);
    const normalized = item.replace(/ +$/u, '');
    if (!normalized) throw new TextReadError('INVALID_KEY', `empty ${field}`);
    result[field] = normalized;
  }
  return result as unknown as TextKey;
}
