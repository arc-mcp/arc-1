/** Qualified classic persisted ITF reads through the caller's guarded ADT session. */
import type { AdtClient } from '../client.js';
import { findTextMatches, readClassicText, readClassicTextBatch } from './reader.js';
import { withStoredTextSession } from './source.js';
import type { TextDiscovery } from './types.js';

export { TextReadError, type TextReadErrorCode } from './errors.js';
export { normalizeTextKey } from './key.js';
export {
  type ClassicTextBatchItem,
  type ClassicTextResult,
  findTextMatches,
  readClassicText,
  readClassicTextBatch,
} from './reader.js';
export { withStoredTextSession } from './source.js';
export type { StoredTextHeader, StoredTextSource, TextDiscovery, TextKey } from './types.js';

/** The SAP client comes from the trusted selected target, never from a tool argument. */
export function readStoredText(client: AdtClient, key: unknown) {
  return withStoredTextSession(client, client.sapClient, (source) => readClassicText(source, key));
}

export function readStoredTextBatch(client: AdtClient, keys: unknown[]) {
  return withStoredTextSession(client, client.sapClient, (source) => readClassicTextBatch(source, keys));
}

export function discoverStoredTexts(client: AdtClient, query: TextDiscovery) {
  return withStoredTextSession(client, client.sapClient, (source) => source.discover(query));
}

/** Search only the bounded exact-key batch supplied by the caller, including ITF commands. */
export function searchStoredTexts(client: AdtClient, keys: unknown[], phrase: string) {
  // Validate the phrase before making any SAP request.
  findTextMatches([], phrase);
  return withStoredTextSession(client, client.sapClient, async (source) => {
    const results = await readClassicTextBatch(source, keys);
    return {
      ...findTextMatches(results, phrase),
      requested: results.length,
      succeeded: results.filter((item) => item.status === 'ok').length,
      errors: results.filter((item) => item.status === 'error'),
    };
  });
}
