import { AdtApiError, AdtNetworkError } from './errors.js';
import type { AdtHttpClient, AdtResponse } from './http.js';

/** A failed create response does not prove SAP rejected the mutation. */
export async function postCreate(
  http: AdtHttpClient,
  path: string,
  body: string,
  contentType?: string,
  headers?: Record<string, string>,
): Promise<AdtResponse> {
  try {
    return await http.post(path, body, contentType, headers, { retryTransientErrors: false });
  } catch (error) {
    if (
      error instanceof AdtNetworkError ||
      (error instanceof AdtApiError && (error.statusCode === 429 || error.isServerError))
    ) {
      // Keep the original type, HTTP status and diagnostics for callers and audit.
      error.creationOutcome = 'unknown';
    }
    throw error;
  }
}
