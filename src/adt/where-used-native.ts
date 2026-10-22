/** Optional native scope and snippet reads. No cached per-user SAP results. */
import { XMLBuilder } from 'fast-xml-parser';
import type { AdtClient } from './client.js';
import { parseWhereUsedResponse } from './codeintel.js';
import { DataResponseBudget } from './data-result-context.js';
import { AdtApiError } from './errors.js';
import type { AdtRequestOptions } from './http-deadline.js';
import { AdtAnalysisDeadlineError, isDeadlineFailure } from './request-attempt-budget.js';
import { checkOperation, OperationType } from './safety.js';
import { escapeXmlAttr, findDeepNodes, parseXml } from './xml-parser.js';

const BASE = '/sap/bc/adt/repository/informationsystem/';
const NS = 'http://www.sap.com/adt/ris/usageReferences';
const builder = new XMLBuilder({ ignoreAttributes: false, suppressBooleanAttributes: false });
export interface UsageOptions {
  packages?: string[];
  detail?: 'objects' | 'positions' | 'snippets';
}

export function matchesUsageType(type: string, filter: string): boolean {
  const wanted = filter.trim().toUpperCase();
  const actual = type.trim().toUpperCase();
  return actual === wanted || actual.startsWith(`${wanted}/`);
}

async function post(client: AdtClient, path: string, body: string, family: string, options: AdtRequestOptions) {
  try {
    return await client.http.post(
      `${BASE}${path}`,
      body,
      `application/vnd.sap.adt.repository.${family}.request.v1+xml`,
      { Accept: `application/vnd.sap.adt.repository.${family}.result.v1+xml` },
      options,
    );
  } catch (error) {
    if (isDeadlineFailure(error, options)) throw new AdtAnalysisDeadlineError();
    throw error;
  }
}

/** Discovery can contain many workspaces; the generic first-match XML helper is insufficient. */
function discoveryNodes(root: unknown, key: string): Record<string, unknown>[] {
  const pending: unknown[] = [root];
  const found: Record<string, unknown>[] = [];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    for (const [name, value] of Object.entries(node)) {
      if (name === key) found.push(...((Array.isArray(value) ? value : [value]) as Record<string, unknown>[]));
      else if (value && typeof value === 'object') pending.push(value);
    }
  }
  return found;
}

export async function loadNativeUsages(client: AdtClient, uri: string, options: UsageOptions) {
  checkOperation(client.safety, OperationType.Intelligence, 'FindWhereUsed');
  const requestOptions: AdtRequestOptions = {
    deadline: Date.now() + 30_000,
    responseBudget: new DataResponseBudget(8 * 1024 * 1024, 'where-used'),
  };
  let discovery: Record<string, unknown> = {};
  try {
    discovery = parseXml(
      (
        await client.http.get(
          '/sap/bc/adt/discovery',
          { Accept: 'application/atomsvc+xml' },
          { ...requestOptions, probe: true },
        )
      ).body,
    );
  } catch (error) {
    if (isDeadlineFailure(error, requestOptions)) throw new AdtAnalysisDeadlineError();
    // Discovery can be denied independently of the read endpoints (S_ADT_RES).
    if (!(error instanceof AdtApiError)) throw error;
  }
  const supportsScope = discoveryNodes(discovery, 'templateLink').some(
    (n) => n['@_rel'] === 'http://www.sap.com/adt/relations/informationsystem/usageReferences/scope',
  );
  const supportsSnippets = discoveryNodes(discovery, 'collection').some(
    (n) =>
      typeof n['@_href'] === 'string' &&
      new URL(n['@_href'], 'https://discovery.invalid').pathname === `${BASE}usageSnippets`,
  );
  let scopeXml = '';
  if (supportsScope && options.packages?.length) {
    const response = await post(
      client,
      `usageReferences/scope?uri=${encodeURIComponent(uri)}`,
      `<usageScopeRequest xmlns="${NS}"><affectedObjects/></usageScopeRequest>`,
      'usagereferences.scope',
      requestOptions,
    );
    const scope = findDeepNodes(parseXml(response.body), 'usageScopeResult')[0];
    if (!scope) throw new Error('SAP returned an invalid where-used scope.');
    // Scope categories are not result types. Keep all types; objectType is filtered locally.
    for (const type of findDeepNodes(scope, 'type')) type['@_isSelected'] = 'true';
    // Ordinary mode enables indirect references even when its response echoes false; keep SAP's proposed grade.
    const echoed: Record<string, unknown> = {};
    for (const key of ['objectIdentifier', 'grade', 'objectTypes', 'programs', 'payload'])
      if (scope[key] !== undefined) echoed[key] = scope[key];
    if (options.packages?.length) echoed.propertyFilter = { '@_filter': `package:${options.packages.join(',')}` };
    scopeXml = builder.build({ scope: echoed });
  }
  const response = await post(
    client,
    `usageReferences?uri=${encodeURIComponent(uri)}`,
    `<usageReferenceRequest xmlns="${NS}">${scopeXml}<affectedObjects/></usageReferenceRequest>`,
    'usagereferences',
    requestOptions,
  );
  return {
    ...parseWhereUsedResponse(response.body, true),
    supportsSnippets,
    deadline: requestOptions.deadline!,
    scopeFiltering: scopeXml ? ('server' as const) : ('client' as const),
  };
}

export interface UsageSnippet {
  objectIdentifier: string;
  uri: string;
  matches: string;
  content: string;
}

export async function loadUsageSnippets(
  client: AdtClient,
  identifiers: string[],
  deadline: number,
): Promise<UsageSnippet[]> {
  checkOperation(client.safety, OperationType.Intelligence, 'UsageSnippets');
  if (identifiers.length > 10 || identifiers.some((id) => id.length > 4096))
    throw new Error('Where-used snippet request exceeds its identifier limit.');
  if (identifiers.length === 0) return [];
  const body = `<usageSnippetRequest xmlns="${NS}"><objectIdentifiers>${identifiers.map((id) => `<objectIdentifier optional="false">${escapeXmlAttr(id)}</objectIdentifier>`).join('')}</objectIdentifiers><affectedObjects/></usageSnippetRequest>`;
  const response = await post(client, 'usageSnippets', body, 'usagesnippets', {
    deadline,
    responseBudget: new DataResponseBudget(2 * 1024 * 1024, 'where-used snippets'),
  });
  const root = findDeepNodes(parseXml(response.body, true), 'usageSnippetResult')[0];
  if (!root) throw new Error('SAP returned an invalid usage snippet response.');
  return findDeepNodes(root, 'codeSnippetObject').flatMap((object) =>
    findDeepNodes(object, 'codeSnippet').map((snippet) => ({
      objectIdentifier: String(object.objectIdentifier ?? ''),
      uri: String(snippet['@_uri'] ?? ''),
      matches: String(snippet['@_matches'] ?? ''),
      content: String(snippet.content ?? ''),
    })),
  );
}
