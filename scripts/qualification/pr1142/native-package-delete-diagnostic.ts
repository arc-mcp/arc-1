/** Diagnostic evidence only. It never classifies a refusal or changes an operation result. */

import { createHash } from 'node:crypto';
import { AdtApiError } from '../../../src/adt/errors.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';

const packageHash = (body: string) => createHash('sha256').update(body).digest('hex');

export function packageDeleteDiagnostic(error: unknown, handle: string) {
  if (!(error instanceof AdtApiError)) return { shape: 'unavailable' };
  const body = error.responseBody ?? '';
  const digest = { status: error.statusCode, bytes: Buffer.byteLength(body), sha256: packageHash(body) };
  if (!handle || body.length > 64 * 1024) return { ...digest, shape: 'unavailable' };
  // Persist only bounded semantic diagnostic fields; omit headers, URLs and session/credential fields.
  const safe = (value: string | undefined) => {
    if (value === undefined || value.length > 2048) return undefined;
    const redacted = [handle, encodeURIComponent(handle)].reduce(
      (text, secret) => text.split(secret).join('[OWNING-HANDLE-REDACTED]'),
      value,
    );
    if (/authorization|bearer\s|password|cookie|session|sap-contextid/i.test(redacted))
      return '[SENSITIVE-FIELD-OMITTED]';
    return redacted;
  };
  try {
    const root = nativeXmlRoot(body, 'exception', 'http://www.sap.com/abapxml/types/communicationframework', true);
    type Fields = [string, unknown][];
    const text = (fields: Fields | undefined) => {
      const values = fields?.filter(([k]) => k === 'text');
      if (values?.length !== 1 || typeof values[0][1] !== 'string') return undefined;
      return safe(values[0][1]);
    };
    const entries = root.child('properties', '')?.children('entry', '') ?? [];
    if (entries.length > 32) throw new Error();
    return {
      ...digest,
      shape: 'native-exception-projection',
      namespace: safe(root.child('namespace', '')?.attribute('id', '')),
      type: safe(root.child('type', '')?.attribute('id', '')),
      properties: entries.map((e) => ({
        key: /^T100KEY-[A-Z0-9_-]{1,32}$/.test(e.attribute('key', '') ?? '')
          ? safe(e.attribute('key', ''))
          : '[UNEXPOSED-KEY]',
        value: /^T100KEY-[A-Z0-9_-]{1,32}$/.test(e.attribute('key', '') ?? '')
          ? text(e.canonicalValue({}) as Fields)
          : undefined,
      })),
      messages: ['message', 'localizedMessage'].map((key) => {
        const matches = (root.canonicalValue({}) as Fields).find(
          ([name]) => name === JSON.stringify(['element', '', key]),
        )?.[1] as Fields[] | undefined;
        if (matches && matches.length !== 1) throw new Error();
        const fields = matches?.[0];
        const language = fields?.find(([name]) => name === JSON.stringify(['attribute', '', 'lang']))?.[1];
        return { key, language: safe(typeof language === 'string' ? language : undefined), text: text(fields) };
      }),
      rawBodyRetained: false,
      redacted: body.includes(handle),
    };
  } catch {
    return { ...digest, shape: 'unrecognized', rawBodyRetained: false };
  }
}
