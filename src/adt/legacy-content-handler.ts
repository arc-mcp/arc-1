import { extractExceptionType } from './errors.js';

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
