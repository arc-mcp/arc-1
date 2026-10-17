import { XMLValidator } from 'fast-xml-parser';
import { getCurrentContext } from '../server/context.js';
import { DataResponseBudget } from './data-result-context.js';
import { AdtApiError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { canonicalHostRelativeAdtPath } from './path-safety.js';
import { RequestAttemptBudget } from './request-attempt-budget.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { findDeepNodes, parseXml, toRecordArray } from './xml-parser.js';

export const DDIC_LOG_RELATION = 'http://www.sap.com/adt/relations/ddic/activationlog';
export const DDIC_LOG_MEDIA = 'application/vnd.sap.adt.logs+xml';
interface LogEntry {
  id: string;
  severity: 'error' | 'warning' | 'info' | 'unknown';
  rawSeverity: string;
  messages: Array<{ text: string; key: string; language: string }>;
  references: Array<{ uri: string; relation: string }>;
  children: LogEntry[];
}
export function parseDdicActivationLog(xml: string) {
  if (Buffer.byteLength(xml) > 512 * 1024 || XMLValidator.validate(xml) !== true)
    throw new Error('Invalid or oversized DDIC log XML.');
  const root = parseXml(xml).log;
  if (!root || typeof root !== 'object') throw new Error('Expected an ADT activation log.');
  const log = root as Record<string, unknown>;
  let count = 0;
  let truncated = false;
  const entries = (input: unknown, depth: number): LogEntry[] =>
    toRecordArray(input).flatMap((row) => {
      if (depth > 8 || count >= 250) {
        truncated = true;
        return [];
      }
      count++;
      const clip = (value: unknown) => {
        const s = String(value ?? '');
        if (s.length > 2000) truncated = true;
        return s.slice(0, 2000);
      };
      const rawSeverity = clip(row['@_severity']);
      const messages = toRecordArray(row.message).flatMap((message) => {
        const texts = Array.isArray(message.messageText) ? message.messageText : [message.messageText];
        return texts
          .filter((text) => text !== undefined)
          .map((text) => {
            const node: Record<string, unknown> =
              typeof text === 'object' && text !== null ? (text as Record<string, unknown>) : { '#text': text };
            return { text: clip(node['#text']), key: clip(node['@_key']), language: clip(node['@_language']) };
          });
      });
      const references = toRecordArray(row.link).flatMap((l) => {
        const uri = canonicalHostRelativeAdtPath(String(l['@_href'] ?? ''), '/sap/bc/adt/', {
          allowRawEncodedSlash: true,
        });
        return uri ? [{ uri, relation: clip(l['@_rel']) }] : [];
      });
      return [
        {
          id: clip(row['@_id']),
          rawSeverity,
          severity:
            rawSeverity === 'error'
              ? 'error'
              : rawSeverity === 'warning'
                ? 'warning'
                : rawSeverity === 'information'
                  ? 'info'
                  : 'unknown',
          messages,
          references,
          children: entries(row.entry, depth + 1),
        },
      ];
    });
  const result = entries(log.entry, 1);
  return {
    name: String(log.name ?? '').slice(0, 200),
    type: String(log.type ?? '').slice(0, 200),
    entries: result,
    entryCount: count,
    truncated,
  };
}

/** Only follows the object's advertised, canonical log relation. Never activates or follows nested logs. */
export async function readDdicActivationLog(
  http: AdtHttpClient,
  safety: SafetyConfig,
  object: { type: string; name: string; uri: string },
) {
  checkOperation(safety, OperationType.Read, 'DdicActivationLog');
  if (
    !canonicalHostRelativeAdtPath(object.uri, '/sap/bc/adt/', { allowRawEncodedSlash: true }) ||
    object.uri.includes('?')
  )
    throw new Error('Unsupported or unsafe object URI.');
  const evidence = {
    object,
    retrievedAt: new Date().toISOString(),
    activationTime: null,
    correlation: 'not-established',
    note: 'Latest available log; not correlated to this attempt. Retrieval time is not activation time.',
  };
  const request = {
    deadline: Date.now() + 20_000,
    signal: getCurrentContext()?.signal,
    responseBudget: new DataResponseBudget(512 * 1024, 'ddic-activation-log'),
    attemptBudget: new RequestAttemptBudget(8),
  };
  try {
    const metadata = await http.get(object.uri, undefined, request);
    if (XMLValidator.validate(metadata.body) !== true) throw new Error('Invalid object metadata.');
    const parsed = parseXml(metadata.body);
    const roots = Object.entries(parsed).filter(([key]) => key !== '?xml');
    if (
      roots.length !== 1 ||
      String((roots[0]?.[1] as Record<string, unknown>)?.['@_name'] ?? '').toUpperCase() !== object.name.toUpperCase()
    )
      throw new Error('Object identity was not established by the metadata.');
    const links = findDeepNodes(parsed, 'link').filter(
      (l) => l['@_rel'] === DDIC_LOG_RELATION && l['@_type'] === DDIC_LOG_MEDIA,
    );
    if (!links.length)
      return {
        ...evidence,
        status: 'unsupported',
        reason: 'Object metadata does not advertise an activation-log relation.',
      };
    if (links.length !== 1) throw new Error('Ambiguous activation-log relation.');
    const uri = canonicalHostRelativeAdtPath(String(links[0]!['@_href'] ?? ''), '/sap/bc/adt/ddic/logs/', {
      allowRawEncodedSlash: true,
    });
    if (!uri || uri.includes('?')) throw new Error('Unsupported or unsafe advertised activation-log URI.');
    const response = await http.get(uri, { Accept: DDIC_LOG_MEDIA }, request);
    return {
      ...evidence,
      retrievedAt: new Date().toISOString(),
      status: 'available',
      relation: { uri, mediaType: DDIC_LOG_MEDIA },
      log: parseDdicActivationLog(response.body),
    };
  } catch (error) {
    if (error instanceof AdtApiError && [401, 403, 404].includes(error.statusCode))
      return { ...evidence, status: error.statusCode === 404 ? 'unavailable' : 'denied', httpStatus: error.statusCode };
    throw error;
  }
}
