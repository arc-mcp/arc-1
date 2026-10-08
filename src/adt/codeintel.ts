/**
 * Code intelligence for SAP ADT.
 *
 * - FindDefinition: navigate to symbol definition
 * - FindReferences: where-used analysis
 * - GetCompletion: code completion proposals
 */

import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { escapeXmlAttr, findDeepNodes, parseXml } from './xml-parser.js';

/** Definition target with ADT coordinates: 1-based line, 0-based cursor column. */
export interface DefinitionResult {
  uri: string;
  type: string;
  name: string;
  line?: number;
  column?: number;
}

/** Reference result */
export interface ReferenceResult {
  uri: string;
  type: string;
  name: string;
  line: number;
  column: number;
}

/** Completion proposal: an identifier or keyword SAP offers at the cursor. */
export interface CompletionProposal {
  text: string;
}

/** Completion proposals at a cursor. */
export interface CompletionResult {
  proposals: CompletionProposal[];
  /** SAP confirmed completeness (no `@end` marker). False does not prove more matches exist. */
  complete: boolean;
}

/** Available object type from Where-Used scope discovery */
export interface WhereUsedScopeEntry {
  objectType: string;
  objectTypeDescription: string;
  count: number;
}

/** Where-Used scope — available object types and their counts */
export interface WhereUsedScope {
  entries: WhereUsedScopeEntry[];
}

/** Detailed Where-Used result with additional fields (line, snippet, package) */
export interface WhereUsedResult {
  uri: string;
  type: string;
  name: string;
  line: number;
  column: number;
  packageName: string;
  snippet: string;
  objectDescription: string;
  parentUri?: string;
  isResult?: boolean;
  canHaveChildren?: boolean;
  usageInformation?: {
    direct: boolean;
    productive: boolean;
    raw: string;
  };
}

/** Navigate to definition of a symbol */
export async function findDefinition(
  http: AdtHttpClient,
  safety: SafetyConfig,
  sourceUrl: string,
  line: number,
  column: number,
  source: string,
): Promise<DefinitionResult | null> {
  checkOperation(safety, OperationType.Intelligence, 'FindDefinition');

  // ADT reads the cursor from the URI fragment (`#start=<line>,<column>`). Separate
  // `line`/`column` query parameters are rejected with 400 "I::000".
  const target = `${sourceUrl.split('#')[0]}#start=${line},${column}`;
  const resp = await http.post(
    `/sap/bc/adt/navigation/target?uri=${encodeURIComponent(target)}&filter=definition`,
    source,
    'text/plain',
    { Accept: 'application/xml' },
  );

  // ADT answers `<adtcore:objectReference adtcore:uri="…/source/main#start=30,16"/>`;
  // `navigation` is kept as a fallback.
  const parsed = parseXml(resp.body);
  const nav = findDeepNodes(parsed, 'objectReference')[0] ?? findDeepNodes(parsed, 'navigation')[0];
  if (!nav?.['@_uri']) return null;

  const uri = String(nav['@_uri']);
  const start = /#start=(\d+),(\d+)/.exec(uri);
  return {
    uri,
    type: String(nav['@_type'] ?? ''),
    name: String(nav['@_name'] ?? ''),
    ...(start ? { line: Number(start[1]), column: Number(start[2]) } : {}),
  };
}

/** Find all references to a symbol */
export async function findReferences(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
): Promise<ReferenceResult[]> {
  checkOperation(safety, OperationType.Intelligence, 'FindReferences');

  const resp = await http.get(
    `/sap/bc/adt/repository/informationsystem/usageReferences?uri=${encodeURIComponent(objectUrl)}`,
    { Accept: 'application/xml' },
  );

  const parsed = parseXml(resp.body);
  const refs = findDeepNodes(parsed, 'objectReference');
  return refs.map((ref) => ({
    uri: String(ref['@_uri'] ?? ''),
    type: String(ref['@_type'] ?? ''),
    name: String(ref['@_name'] ?? ''),
    line: 0,
    column: 0,
  }));
}

/**
 * Get available object types for Where-Used analysis (scope discovery).
 *
 * Step 1 of the 2-step scope-based Where-Used API:
 * POST to .../usageReferences/scope with the object URI in the request body.
 * Returns available object types and their reference counts.
 */
export async function getWhereUsedScope(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
): Promise<WhereUsedScope> {
  checkOperation(safety, OperationType.Intelligence, 'FindWhereUsed');

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<usageReferences:scopeRequest xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">',
    `  <usageReferences:objectReference uri="${escapeXmlAttr(objectUrl)}"/>`,
    '</usageReferences:scopeRequest>',
  ].join('\n');

  const resp = await http.post(
    '/sap/bc/adt/repository/informationsystem/usageReferences/scope',
    body,
    'application/xml',
    { Accept: 'application/xml' },
  );

  const parsed = parseXml(resp.body);
  const entries: WhereUsedScopeEntry[] = [];

  // Scope response has objectType entries with type, description, and count
  const scopeNodes = findDeepNodes(parsed, 'objectType');
  for (const node of scopeNodes) {
    entries.push({
      objectType: String(node['@_type'] ?? node['@_name'] ?? ''),
      objectTypeDescription: String(node['@_description'] ?? ''),
      count: Number(node['@_count'] ?? node['@_numberOfResults'] ?? 0),
    });
  }

  return { entries };
}

/**
 * Find Where-Used references via the ADT usageReferences endpoint.
 *
 * POST to .../usageReferences with the object URI as both a query parameter
 * and in the XML request body. SAP requires the SAP-specific content types:
 * - Content-Type: application/vnd.sap.adt.repository.usagereferences.request.v1+xml
 * - Accept: application/vnd.sap.adt.repository.usagereferences.result.v1+xml
 *
 * The response uses a tree structure with `referencedObject` > `adtObject` elements.
 * If objectType is provided, it's included in the request body as a filter.
 */
export async function findWhereUsed(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  objectType?: string,
): Promise<WhereUsedResult[]> {
  checkOperation(safety, OperationType.Intelligence, 'FindWhereUsed');

  const typeFilter = objectType ? `\n  <usageReferences:objectTypeFilter value="${escapeXmlAttr(objectType)}"/>` : '';

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<usageReferences:usageReferenceRequest xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">',
    `  <usageReferences:objectReference uri="${escapeXmlAttr(objectUrl)}"/>${typeFilter}`,
    '</usageReferences:usageReferenceRequest>',
  ].join('\n');

  const url = `/sap/bc/adt/repository/informationsystem/usageReferences?uri=${encodeURIComponent(objectUrl)}`;
  const resp = await http.post(url, body, 'application/vnd.sap.adt.repository.usagereferences.request.v1+xml', {
    Accept: 'application/vnd.sap.adt.repository.usagereferences.result.v1+xml',
  });

  const parsed = parseXml(resp.body);
  const results: WhereUsedResult[] = [];

  // Response uses referencedObject > adtObject tree structure
  const refs = findDeepNodes(parsed, 'referencedObject');
  for (const ref of refs) {
    const adtObj = (ref.adtObject ?? {}) as Record<string, unknown>;
    const pkgRef = (adtObj.packageRef ?? {}) as Record<string, unknown>;
    const usageInfoRaw = String(ref['@_usageInformation'] ?? '');
    const usageTokens = usageInfoRaw
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    results.push({
      uri: String(ref['@_uri'] ?? ''),
      type: String(adtObj['@_type'] ?? ''),
      name: String(adtObj['@_name'] ?? ''),
      line: 0,
      column: 0,
      packageName: String(pkgRef['@_name'] ?? ''),
      snippet: '',
      objectDescription: String(adtObj['@_description'] ?? ''),
      parentUri: asOptionalString(ref['@_parentUri']),
      isResult: parseOptionalBoolean(ref['@_isResult']),
      canHaveChildren: parseOptionalBoolean(ref['@_canHaveChildren']),
      usageInformation:
        usageInfoRaw.length > 0
          ? {
              direct: usageTokens.includes('gradeDirect'),
              productive: usageTokens.includes('includeProductive'),
              raw: usageInfoRaw,
            }
          : undefined,
    });
  }

  return results;
}

/**
 * Augment Where-Used results for an interface URI with implementing classes
 * looked up from `SEOMETAREL` (RELTYPE='1' = interface implementation).
 *
 * SAP's scope-based usageReferences endpoint sometimes does NOT surface
 * interface→implementing-class links directly — the implementations sit
 * inside a `canHaveChildren="true"` Interface Section node, and the snippet
 * expansion endpoint (`/usageReferences/snippets`) returns 404 on every
 * release we've probed (NW 7.50, S/4HANA 2023). The where-used XML response
 * shows `numberOfResults="1"` but with no `isResult="true"` entry. Verified
 * live on `a4h.marianzeis.de` against ZIF_ARC1_TEST → ZCL_ARC1_TEST.
 *
 * `SEOMETAREL` is the canonical OO-relation table; the relationship is
 * recorded there regardless of where-used index state, so this augmentation
 * is more reliable than the HTTP API for this specific edge case.
 *
 * Returns an empty array silently when SQL access isn't available — caller
 * should merge whatever it can get.
 */
export async function findInterfaceImplementersViaSeoMetaRel(
  runQuery: (sql: string, maxRows: number) => Promise<{ columns: string[]; rows: Record<string, string>[] }>,
  interfaceName: string,
): Promise<WhereUsedResult[]> {
  const safe = interfaceName.toUpperCase().replace(/[^A-Z0-9_/]/g, '');
  if (!safe) return [];
  const data = await runQuery(`SELECT CLSNAME FROM SEOMETAREL WHERE REFCLSNAME = '${safe}' AND RELTYPE = '1'`, 100);
  return data.rows.map((row) => {
    const className = String(row.CLSNAME ?? '');
    return {
      uri: `/sap/bc/adt/oo/classes/${className.toLowerCase()}`,
      type: 'CLAS/OC',
      name: className,
      line: 0,
      column: 0,
      packageName: '',
      snippet: '',
      objectDescription: `implements ${interfaceName.toUpperCase()}`,
      isResult: true,
    };
  });
}

function asOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const str = String(value);
  return str.length > 0 ? str : undefined;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  const str = String(value).trim().toLowerCase();
  if (str === 'true') return true;
  if (str === 'false') return false;
  return undefined;
}

/**
 * Get code completion proposals at an ADT cursor (1-based line, 0-based column) in `source`.
 *
 * ADT reads the cursor from the URI fragment (`#start=<line>,<column>`), as for definition, and
 * answers with `asx:abap` / `SCC_COMPLETION` records in `application/vnd.sap.as+xml` (the only type
 * it accepts; `application/xml` is refused with 406). With `signalCompleteness=true` SAP appends an
 * `@end` record for incomplete results. Older backends also emit it for empty lists or invalid
 * positions, so it means completeness is unconfirmed, not necessarily that matches were cut off.
 */
export async function getCompletion(
  http: AdtHttpClient,
  safety: SafetyConfig,
  sourceUrl: string,
  line: number,
  column: number,
  source: string,
): Promise<CompletionResult> {
  checkOperation(safety, OperationType.Intelligence, 'GetCompletion');

  const target = `${sourceUrl.split('#')[0]}#start=${line},${column}`;
  const resp = await http.post(
    `/sap/bc/adt/abapsource/codecompletion/proposal?uri=${encodeURIComponent(target)}&signalCompleteness=true`,
    source,
    'text/plain',
    { Accept: 'application/vnd.sap.as+xml' },
  );

  // SAP_BASIS 758 returns HTTP 200 with no body (or content type) when no proposals match.
  if (resp.statusCode === 200 && resp.body.length === 0) return { proposals: [], complete: true };

  const abap = parseXml(resp.body).abap as { values?: { DATA?: unknown } } | undefined;
  if (!Array.isArray(abap?.values?.DATA)) {
    throw new Error('Unexpected completion response: expected ABAP XML values/DATA.');
  }
  const identifiers = findDeepNodes(abap.values.DATA, 'SCC_COMPLETION')
    .map((node) => String(node.IDENTIFIER ?? ''))
    .filter((identifier) => identifier.length > 0);
  return {
    proposals: identifiers.filter((identifier) => identifier !== '@end').map((text) => ({ text })),
    complete: !identifiers.includes('@end'),
  };
}
