import { AdtApiError, extractExceptionType } from './errors.js';

/** NW 7.40 reports missing wildcard handlers as a structured 400, not 406/415 (#907). */
export function legacyContentHandlerFallback(
  status: number,
  body: string,
  method: string,
  negotiationKey: string,
  headers: Record<string, string>,
): Record<string, string> | undefined {
  if (status !== 400 || extractExceptionType(body) !== 'ExceptionContentHandlerNotFound') return undefined;

  // Object metadata only; /source and /includes keep their own types.
  if (method === 'GET' && headers.Accept === '*/*' && /^\/sap\/bc\/adt\/oo\/classes\/[^/]+$/.test(negotiationKey)) {
    return { Accept: 'application/vnd.sap.adt.oo.classes+xml' };
  }

  // The handler lookup rejected the body before creation. Preserve explicit vendor types.
  if (method === 'POST' && headers['Content-Type'] === 'application/*') {
    if (negotiationKey === '/sap/bc/adt/oo/classes') {
      return { 'Content-Type': 'application/vnd.sap.adt.oo.classes+xml' };
    }
    if (negotiationKey === '/sap/bc/adt/programs/programs') {
      return { 'Content-Type': 'application/vnd.sap.adt.programs.programs+xml' };
    }
  }
  return undefined;
}

/** Old handlers can return empty HTML for unmapped ADT paths (#996). Do not infer data or write success. */
export function rejectEmptyAdtHtmlResponse(
  status: number,
  contentType: string | undefined,
  body: string,
  path: string,
): void {
  if (
    status !== 200 ||
    !path.startsWith('/sap/bc/adt/') ||
    contentType?.split(';', 1)[0]?.trim() !== 'text/html' ||
    body.trim() !== ''
  )
    return;
  const error = new AdtApiError('Unexpected empty HTML response from ADT.', status, path, body);
  error.extraHint =
    'No ADT result was returned. This does not establish an empty result, a missing object, or a successful write. Verify the endpoint and read back any attempted changes before retrying.';
  throw error;
}
