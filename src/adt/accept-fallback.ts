import { AdtApiError } from './errors.js';

/** Text-part PUTs use 406 for application errors too. SADT_RESOURCE identifies
 * framework negotiation; changing Accept cannot fix a structured application error. */
export function acceptFallback(
  body: string,
  accept: string | undefined,
  method: string,
  path: string,
): string | undefined {
  if (
    method === 'PUT' &&
    /^\/sap\/bc\/adt\/textelements\/(classes|programs|functiongroups)\/[^/]+\/source\/(symbols|selections|headings)$/.test(
      path,
    )
  ) {
    const props = AdtApiError.extractProperties(body);
    const id = props['T100KEY-ID'] ?? props['T100KEY-MSGID'];
    if (id && id !== 'SADT_RESOURCE') return undefined;
  }

  const inferred = body.match(/application\/[\w.+-]+(?:\/[\w.+-]+)?/)?.[0];
  if (inferred && inferred !== accept) return inferred;
  if (accept && accept !== '*/*' && accept !== 'application/xml') return 'application/xml';
  if (accept === 'application/xml') return '*/*';
  return undefined;
}
