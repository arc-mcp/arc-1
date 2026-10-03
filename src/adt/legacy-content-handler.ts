import { extractExceptionType } from './errors.js';

/** NW 7.40 reports missing wildcard handlers as a structured 400, not 406/415 (#907). */
export function legacyContentHandlerFallback(
  status: number,
  body: string,
  method: string,
  path: string,
  headers: Record<string, string>,
): Record<string, string> | undefined {
  if (status !== 400 || extractExceptionType(body) !== 'ExceptionContentHandlerNotFound') return undefined;

  // Only object metadata, never class source/includes or lock/activation requests.
  if (method === 'GET' && headers.Accept === '*/*' && /^\/sap\/bc\/adt\/oo\/classes\/[^/]+$/.test(path)) {
    return { Accept: 'application/vnd.sap.adt.oo.classes+xml' };
  }

  // The handler lookup rejected the body before creation. Preserve explicit vendor types.
  if (method === 'POST' && headers['Content-Type'] === 'application/*') {
    if (path === '/sap/bc/adt/oo/classes') {
      return { 'Content-Type': 'application/vnd.sap.adt.oo.classes+xml' };
    }
    if (path === '/sap/bc/adt/programs/programs') {
      return { 'Content-Type': 'application/vnd.sap.adt.programs.programs+xml' };
    }
  }
  return undefined;
}
