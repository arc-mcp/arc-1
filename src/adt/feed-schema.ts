import { createHash } from 'node:crypto';
import { XMLValidator } from 'fast-xml-parser';
import { getCurrentContext } from '../server/context.js';
import { DataResponseBudget } from './data-result-context.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { findDeepNodes, parseXml, toRecordArray } from './xml-parser.js';

export interface FeedFilter {
  attribute: string;
  operator: string;
  values: string[];
}
export interface DumpFeedSchema {
  feed: 'dumps';
  retrievedAt: string;
  fingerprint: string;
  queryDepth: number;
  attributes: Array<{ id: string; type: string; operators: Array<{ id: string; operands: number }> }>;
}
/** Read only the approved dumps schema; omit user-specific variants and arbitrary links. No shared cache. */
export async function readDumpFeedSchema(
  http: AdtHttpClient,
  safety: SafetyConfig,
  request?: AdtRequestOptions,
): Promise<DumpFeedSchema> {
  checkOperation(safety, OperationType.Read, 'DumpFeedSchema');
  const response = await http.get(
    '/sap/bc/adt/feeds',
    { Accept: 'application/atom+xml;type=feed' },
    request ?? {
      deadline: Date.now() + 15_000,
      signal: getCurrentContext()?.signal,
      responseBudget: new DataResponseBudget(256 * 1024, 'feed-schema'),
    },
  );
  return parseDumpFeedSchema(response.body);
}
export function parseDumpFeedSchema(xml: string): DumpFeedSchema {
  if (Buffer.byteLength(xml) > 256 * 1024 || XMLValidator.validate(xml) !== true)
    throw new Error('Invalid or oversized feed schema.');
  const parsed = parseXml(xml);
  const entries = findDeepNodes(parsed, 'entry').filter((e) => e.id === '/sap/bc/adt/runtime/dumps');
  if (entries.length > 1) throw new Error('Ambiguous dumps feed schema.');
  const entry = entries[0];
  if (!entry) throw new Error('The dumps feed does not advertise a filter schema on this target.');
  const dataNodes = toRecordArray(entry.extendedData);
  if (dataNodes.length !== 1) throw new Error('Ambiguous dump filter metadata.');
  const data = dataNodes[0]!;
  if (toRecordArray(data.operators).length !== 1 || toRecordArray(data.attributes).length !== 1)
    throw new Error('Ambiguous dump filter schema containers.');
  const operators = findDeepNodes(data.operators, 'operator');
  if (
    !operators.length ||
    operators.length > 50 ||
    new Set(operators.map((o) => o['@_id'])).size !== operators.length ||
    operators.some(
      (o) =>
        !/^[A-Za-z][A-Za-z0-9]*$/.test(String(o['@_id'] ?? '')) || ![1, 2].includes(Number(o['@_numberOfOperands'])),
    )
  )
    throw new Error('Invalid or ambiguous dump operators.');
  const attributes = findDeepNodes(data.attributes, 'attribute').map((a) => {
    const dataTypes = toRecordArray(a.dataType);
    if (dataTypes.length !== 1 || toRecordArray(a.operators).length !== 1)
      throw new Error('Ambiguous dump attribute metadata.');
    return {
      id: String(a['@_id'] ?? ''),
      type: String(dataTypes[0]?.['@_id'] ?? ''),
      operators: findDeepNodes(a.operators, 'operator').map((op) => {
        const id = String(op['@_id'] ?? '');
        return { id, operands: Number(operators.find((o) => o['@_id'] === id)?.['@_numberOfOperands']) };
      }),
    };
  });
  if (attributes.length > 50 || !attributes.length) throw new Error('Unsupported dump attribute schema.');
  if (
    new Set(attributes.map((a) => a.id)).size !== attributes.length ||
    attributes.some(
      (a) =>
        !/^[A-Za-z][A-Za-z0-9]*$/.test(a.id) ||
        !a.type ||
        !a.operators.length ||
        new Set(a.operators.map((o) => o.id)).size !== a.operators.length ||
        a.operators.some((o) => ![1, 2].includes(o.operands)),
    )
  )
    throw new Error('Invalid or ambiguous dump attributes.');
  const queryDepth = Number(data.queryDepth);
  if (!Number.isSafeInteger(queryDepth) || queryDepth < 1) throw new Error('Invalid dump query depth.');
  return {
    feed: 'dumps',
    retrievedAt: new Date().toISOString(),
    fingerprint: createHash('sha256').update(JSON.stringify({ attributes, queryDepth })).digest('hex'),
    queryDepth,
    attributes,
  };
}
/** Verified unquoted wire grammar. Reject delimiters until an escaping contract is proven. */
export function compileDumpFilters(schema: DumpFeedSchema, filters: FeedFilter[]): string {
  if (!Number.isFinite(schema.queryDepth) || schema.queryDepth < 2 || filters.length < 1 || filters.length > 8)
    throw new Error('Expected 1..8 conjunctive dump filters within the advertised depth.');
  const terms = filters.map((filter) => {
    const attribute = schema.attributes.find((a) => a.id === filter.attribute);
    const operator = attribute?.operators.find((op) => op.id === filter.operator);
    if (
      !attribute ||
      !operator ||
      !/^[A-Za-z][A-Za-z0-9]*$/.test(attribute.id) ||
      !/^[A-Za-z][A-Za-z0-9]*$/.test(operator.id) ||
      ![1, 2].includes(operator.operands) ||
      filter.values.length !== operator.operands
    )
      throw new Error(
        'Filter attribute, operator or operand count is not advertised by this target. Use SAPDiagnose action="feed_schema" for supported attribute and operator names.',
      );
    const values = filter.values.map((value) => {
      if (attribute.type === 'string') {
        if (!/^[A-Za-z0-9_/$.* -]{1,128}$/.test(value) || value !== value.trim())
          throw new Error('Filter value contains unsupported wire delimiters or characters.');
        return value;
      }
      if (attribute.type !== 'dateTime' || !/^\d{14}$/.test(value))
        throw new Error('Datetime filters require UTC YYYYMMDDHHMMSS.');
      const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`;
      const date = new Date(iso);
      if (!Number.isFinite(date.getTime()) || date.toISOString().replace(/[-:T]/g, '').slice(0, 14) !== value)
        throw new Error('Invalid datetime filter.');
      return value;
    });
    if (attribute.type === 'dateTime' && values.length === 2 && values[0]! > values[1]!)
      throw new Error('Datetime range is reversed.');
    return `${operator.id}(${attribute.id},${values.join(',')})`;
  });
  return `and(${terms.join(',')})`;
}
