/** Stable failure categories for the stored-text reader and codec. */
export type TextReadErrorCode =
  | 'INVALID_KEY'
  | 'NOT_FOUND'
  | 'UNSUPPORTED_PROFILE'
  | 'UNSUPPORTED_PERSISTENCE'
  | 'NON_ITF_TEXT'
  | 'REFERENCE_ERROR'
  | 'REFERENCE_CYCLE'
  | 'REFERENCE_LIMIT'
  | 'INCONSISTENT_READ'
  | 'CORRUPT_CLUSTER'
  | 'LIMIT_EXCEEDED';

/** Messages must describe the failure without including text keys, contents, or raw SAP errors. */
export class TextReadError extends Error {
  readonly code: TextReadErrorCode;

  constructor(code: TextReadErrorCode, message: string, options?: { cause?: unknown }) {
    super(`STXL: ${message}`, options);
    this.name = 'TextReadError';
    this.code = code;
  }
}
