/** Qualified classic persisted ITF reads through the caller's guarded ADT session. */
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
