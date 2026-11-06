/** Bounded native checks of explicitly selected stored objects. No source collection or cache. */
import { XMLValidator } from 'fast-xml-parser';
import { getCurrentContext } from '../server/context.js';
import { DataResponseBudget } from './data-result-context.js';
import { extractShortText, parseSyntaxMessage } from './devtools.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { escapeXmlAttr, parseXml } from './xml-parser.js';

export const SYNTAX_BATCH_TYPES = ['CLAS', 'INTF', 'PROG', 'DDLS'] as const;
export const SYNTAX_BATCH_MAX_OBJECTS = 20;
export interface SyntaxBatchObject {
  type: string;
  name: string;
  uri: string;
}

/** Unlike findDeepNodes, retain matches from every sibling container. */
function collectNodes(node: unknown, key: string, depth = 0): Record<string, unknown>[] {
  if (depth > 32) throw new Error('Syntax report nesting exceeds the parser limit.');
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((item) => collectNodes(item, key, depth + 1));
  const matches: Record<string, unknown>[] = [];
  for (const [name, value] of Object.entries(node)) {
    if (name === key) {
      for (const item of Array.isArray(value) ? value : [value])
        matches.push(item && typeof item === 'object' ? item : { '#text': item });
    }
    matches.push(...collectNodes(value, key, depth + 1));
  }
  return matches;
}

function reportMatches(report: Record<string, unknown>, object: SyntaxBatchObject): boolean {
  if (report['@_reporter'] !== 'abapCheckRun') return false;
  const uri = String(report['@_triggeringUri'] ?? '').toLowerCase();
  // SAP can return a literal namespace instead of the percent-encoded name we requested.
  return [object.uri, object.uri.replace(encodeURIComponent(object.name), object.name)].some(
    (candidate) => candidate.toLowerCase() === uri,
  );
}

export function parseSyntaxBatch(xml: string, objects: SyntaxBatchObject[], version: 'active' | 'inactive') {
  if (Buffer.byteLength(xml) > 512 * 1024 || XMLValidator.validate(xml) !== true)
    throw new Error('Invalid or oversized syntax-check response.');
  const parsed = parseXml(xml);
  if (!Object.hasOwn(parsed, 'checkRunReports')) throw new Error('Expected native syntax-check reports.');
  const reports = collectNodes(parsed, 'checkReport');
  if (reports.length > 100) throw new Error('Too many syntax-check reports.');
  if (reports.some((report) => collectNodes(report, 'checkReport').length))
    throw new Error('Nested syntax-check reports have ambiguous message ownership.');
  const messages = (node: unknown) => [...collectNodes(node, 'msg'), ...collectNodes(node, 'checkMessage')];
  const ownedReports = new Set<Record<string, unknown>>();
  const attributedMessages = new Set<Record<string, unknown>>();
  const results = objects.map((object) => {
    const matches = reports.filter((report) => reportMatches(report, object));
    const report = matches.length === 1 ? matches[0] : undefined;
    const nativeMessages = report ? messages(report) : [];
    if (report) {
      ownedReports.add(report);
      for (const message of nativeMessages) attributedMessages.add(message);
    }
    const findings = nativeMessages.map((message) =>
      parseSyntaxMessage({ ...message, '@_shortText': extractShortText(message) }),
    );
    const checked =
      report?.['@_status'] === 'processed' &&
      nativeMessages.every((message) => ['E', 'W', 'I'].includes(String(message['@_type'] ?? '')));
    const hasErrors = findings.some((message) => message.severity === 'error');
    return {
      ...object,
      status: !checked ? 'not-checked' : hasErrors ? 'failed' : 'passed',
      checked,
      hasErrors,
      messages: findings,
      ...(!report ? { statusText: 'Missing or ambiguous object report.' } : {}),
      ...(report?.['@_statusText'] ? { statusText: String(report['@_statusText']) } : {}),
      ...(report?.['@_status'] === 'processed' && !checked
        ? { note: 'Unknown native message severity; result is not certified.' }
        : {}),
    };
  });
  const unexpectedReports = reports
    .filter((report) => !ownedReports.has(report))
    .map((report) => ({
      reporter: String(report['@_reporter'] ?? ''),
      uri: String(report['@_triggeringUri'] ?? ''),
      status: String(report['@_status'] ?? ''),
    }));
  const unattributedMessages = messages(parsed)
    .filter((message) => !attributedMessages.has(message))
    .map((message) => ({ type: String(message['@_type'] ?? ''), text: extractShortText(message) }));
  return {
    status:
      unexpectedReports.length || unattributedMessages.length || results.some((result) => !result.checked)
        ? 'incomplete'
        : results.some((result) => result.hasErrors)
          ? 'failed'
          : 'passed',
    checkedAt: new Date().toISOString(),
    requestedVersion: version,
    sourceEvidence:
      'Stored-source check requested; SAP supplies no immutable source hash or independent version proof.',
    requestedObjectCount: objects.length,
    checkedObjectCount: results.filter((result) => result.checked).length,
    unexpectedReports,
    unattributedMessages,
    results,
  };
}

export async function syntaxCheckBatch(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objects: SyntaxBatchObject[],
  version: 'active' | 'inactive',
) {
  checkOperation(safety, OperationType.Read, 'SyntaxCheckBatch');
  if (
    objects.length < 1 ||
    objects.length > SYNTAX_BATCH_MAX_OBJECTS ||
    new Set(objects.map((object) => object.uri.toLowerCase())).size !== objects.length
  )
    throw new Error('Syntax batch requires 1..20 distinct objects.');
  const body = `<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core">${objects.map((object) => `<chkrun:checkObject adtcore:uri="${escapeXmlAttr(object.uri)}" chkrun:version="${version}"/>`).join('')}</chkrun:checkObjectList>`;
  const response = await http.post(
    '/sap/bc/adt/checkruns',
    body,
    'application/vnd.sap.adt.checkobjects+xml',
    { Accept: 'application/vnd.sap.adt.checkmessages+xml' },
    {
      deadline: Date.now() + 30_000,
      signal: getCurrentContext()?.signal,
      responseBudget: new DataResponseBudget(512 * 1024, 'syntax-batch'),
    },
  );
  return parseSyntaxBatch(response.body, objects, version);
}
