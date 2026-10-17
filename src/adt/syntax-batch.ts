import { XMLBuilder, XMLValidator } from 'fast-xml-parser';
import { getCurrentContext } from '../server/context.js';
import { DataResponseBudget } from './data-result-context.js';
import { extractShortText, parseSyntaxCheckResult } from './devtools.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { escapeXmlAttr, parseXml } from './xml-parser.js';

export const SYNTAX_BATCH_TYPES = ['CLAS', 'PROG', 'INTF', 'DDLS'] as const;
export interface SyntaxBatchObject {
  type: string;
  name: string;
  uri: string;
}
/** Collect every report/message, including siblings; the generic XML helper returns only the first branch. */
function collectNodes(node: unknown, key: string, depth = 0): Record<string, unknown>[] {
  if (depth > 32) throw new Error('Syntax report nesting exceeds the parser limit.');
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((item) => collectNodes(item, key, depth + 1));
  return Object.entries(node).flatMap(([name, value]) => {
    const descendants = collectNodes(value, key, depth + 1);
    if (name !== key) return descendants;
    const matches = (Array.isArray(value) ? value : [value]).map((item) =>
      item && typeof item === 'object' ? (item as Record<string, unknown>) : { '#text': item },
    );
    return [...matches, ...descendants];
  });
}
export function parseSyntaxBatch(xml: string, objects: SyntaxBatchObject[], version: 'active' | 'inactive') {
  if (Buffer.byteLength(xml) > 512 * 1024 || XMLValidator.validate(xml) !== true)
    throw new Error('Invalid or oversized syntax-check response.');
  const parsed = parseXml(xml);
  if (!Object.hasOwn(parsed, 'checkRunReports')) throw new Error('Expected native syntax-check reports.');
  const reports = collectNodes(parsed, 'checkReport');
  const messages = (node: unknown) => [...collectNodes(node, 'msg'), ...collectNodes(node, 'checkMessage')];
  const ownedReports = reports.filter(
    (r) =>
      r['@_reporter'] === 'abapCheckRun' &&
      objects.some((o) => o.uri.toLowerCase() === String(r['@_triggeringUri'] ?? '').toLowerCase()) &&
      reports.filter(
        (other) =>
          other['@_reporter'] === 'abapCheckRun' &&
          String(other['@_triggeringUri'] ?? '').toLowerCase() === String(r['@_triggeringUri'] ?? '').toLowerCase(),
      ).length === 1,
  );
  const attributed = new Set(ownedReports.flatMap(messages));
  const unexpectedReports = reports
    .filter((r) => !ownedReports.includes(r))
    .map((r) => ({
      reporter: String(r['@_reporter'] ?? ''),
      uri: String(r['@_triggeringUri'] ?? ''),
      status: String(r['@_status'] ?? ''),
    }));
  const unattributed = messages(parsed).filter((m) => !attributed.has(m));
  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const results = objects.map((object) => {
    const matches = reports.filter(
      (r) =>
        String(r['@_triggeringUri'] ?? '').toLowerCase() === object.uri.toLowerCase() &&
        r['@_reporter'] === 'abapCheckRun',
    );
    if (matches.length !== 1)
      return {
        ...object,
        status: 'not-checked',
        checked: false,
        requestedVersion: version,
        sourceHash: null,
        note: 'Missing or ambiguous object report.',
      };
    const report = matches[0]!;
    const reportMessages = messages(report);
    // Flatten only message containers before using the existing single-object message mapper.
    // Its generic traversal stops at the first branch, which could otherwise hide a later error.
    const flatReport = {
      ...Object.fromEntries(Object.entries(report).filter(([key]) => key.startsWith('@_'))),
      checkMessage: reportMessages.map((message) => ({ ...message, '@_shortText': extractShortText(message) })),
    };
    const result = parseSyntaxCheckResult(builder.build({ checkRunReports: { checkReport: flatReport } }));
    const checked =
      report['@_status'] === 'processed' &&
      result.checked &&
      reportMessages.every((m) => ['E', 'W', 'I'].includes(String(m['@_type'] ?? '')));
    return {
      ...object,
      ...result,
      checked,
      status: !checked ? 'not-checked' : result.hasErrors ? 'failed' : 'passed',
      requestedVersion: version,
      sourceHash: null,
    };
  });
  return {
    checkedAt: new Date().toISOString(),
    requestedVersion: version,
    sourceEvidence:
      'Stored-source check requested; SAP supplies no immutable source hash or independent version proof.',
    unexpectedReports,
    requestedObjectCount: objects.length,
    checkedObjectCount: results.filter((r) => r.checked).length,
    unattributedMessages: unattributed.map((m) => ({
      type: String(m['@_type'] ?? ''),
      text: extractShortText(m),
    })),
    status:
      unexpectedReports.length || unattributed.length || results.some((r) => !r.checked)
        ? 'incomplete'
        : results.some((r) => r.status === 'failed')
          ? 'failed'
          : 'passed',
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
    objects.length > 20 ||
    new Set(objects.map((o) => o.uri.toLowerCase())).size !== objects.length
  )
    throw new Error('Syntax batch requires 1..20 distinct objects.');
  const body = `<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core">${objects.map((o) => `<chkrun:checkObject adtcore:uri="${escapeXmlAttr(o.uri)}" chkrun:version="${version}"/>`).join('')}</chkrun:checkObjectList>`;
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
