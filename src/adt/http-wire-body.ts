import { gzipSync } from 'node:zlib';

const GZIP_DATA_PREVIEW_PATHS = new Set(['/sap/bc/adt/datapreview/freestyle', '/sap/bc/adt/datapreview/ddic']);

export function prepareDataPreviewWireBody(
  enabled: boolean,
  method: string,
  path: string,
  body: string | undefined,
  headers: Record<string, string>,
): string | Buffer | undefined {
  const collectionPath = path.split(/[?#]/, 1)[0] ?? '';
  if (!enabled || method !== 'POST' || !body || !GZIP_DATA_PREVIEW_PATHS.has(collectionPath)) return body;

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'content-encoding') delete headers[key];
  }
  headers['Content-Encoding'] = 'gzip';
  return gzipSync(body);
}
