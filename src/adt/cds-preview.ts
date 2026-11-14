/** Native CDS preview identity and response contract. Never query the metadata's SQL-view name. */
import { XMLValidator } from 'fast-xml-parser';
import { DataResponseBudget } from './data-result-context.js';
import { canonicalDataSourceName } from './data-source-name.js';
import type { DataSourceBlocklistGuard } from './data-source-policy.js';
import { AdtApiError, AdtError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { buildTableQuerySql, clampPreviewRows, fitFreestyleSqlLines } from './table-query.js';
import { parseDiscoveryDocument, parseTableContents, parseXml } from './xml-parser.js';

export const CDS_PREVIEW_PATH = '/sap/bc/adt/datapreview/cds';
export const CDS_PREVIEW_MIME = 'application/vnd.sap.adt.datapreview.table.v1+xml';
export interface CdsPreviewOptions {
  columns?: string[];
  where?: Array<{ field: string; op: string; value?: string }>;
  maxRows?: number;
}
interface CdsPreviewTarget {
  ddlSource: string;
  cdsEntityName: string;
  columns: string[];
}

/** Also called by the schema; library callers receive the same input bounds. */
export function validateCdsPreviewOptions(name: string, options: CdsPreviewOptions): void {
  const ddlSource = canonicalDataSourceName(name, 'CDS_PREVIEW DDLS name');
  if ((options.columns?.length ?? 0) > 100 || (options.where?.length ?? 0) > 100)
    throw new AdtError('CDS_PREVIEW accepts at most 100 columns and 100 conditions.');
  if (options.where?.some((condition) => (condition.value?.length ?? 0) > 4096))
    throw new AdtError('CDS_PREVIEW condition values must not exceed 4096 characters.');
  // Validate the structured SQL grammar before any metadata request. Execution uses the resolved entity.
  try {
    fitFreestyleSqlLines(buildTableQuerySql(ddlSource, options.columns, options.where));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid structured query.';
    throw new AdtError(
      message.includes('255-character')
        ? "CDS_PREVIEW: each SQL literal must fit SAP's 255-character lines. Shorten individual condition values."
        : message.replaceAll('TABLE_QUERY', 'CDS_PREVIEW'),
    );
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdtError('Invalid CDS preview metadata.');
  return value as Record<string, unknown>;
}
function root(xml: string, name: string): Record<string, unknown> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new AdtError('Invalid CDS preview XML response.');
  return record(parseXml(xml)[name]);
}
function columns(table: Record<string, unknown>): string[] {
  const entries = Array.isArray(table.columns) ? table.columns : table.columns ? [table.columns] : [];
  if (entries.length === 0) throw new AdtError('CDS preview response has no column metadata.');
  return entries.map((entry) =>
    canonicalDataSourceName(String(record(record(entry).metadata)['@_name'] ?? ''), 'CDS column'),
  );
}
async function metadata(
  http: AdtHttpClient,
  path: string,
  accept: string,
  options: AdtRequestOptions,
): Promise<string> {
  try {
    return (await http.get(path, { Accept: accept }, options)).body;
  } catch (error) {
    if (
      error instanceof AdtApiError &&
      error.statusCode === 403 &&
      error.path === path &&
      path.startsWith(`${CDS_PREVIEW_PATH}/`)
    ) {
      error.extraHint =
        'CDS preview metadata was denied. Ask Basis to run STAUTHTRACE for the SAP user, including S_ADT_RES: ' +
        'permission for /sap/bc/adt/datapreview/cds alone does not cover its child URI. ' +
        'ARC-1 did not try another data route.';
    }
    throw error;
  }
}

export async function resolveCdsPreviewTarget(
  http: AdtHttpClient,
  ddlSource: string,
  options: AdtRequestOptions,
): Promise<CdsPreviewTarget> {
  let listed = http.hasDiscoveryCollection(CDS_PREVIEW_PATH);
  if (listed === undefined) {
    // Discovery is not a data-preview body; bound it separately without spending the row-response allowance.
    const xml = await metadata(http, '/sap/bc/adt/discovery', 'application/atomsvc+xml', {
      ...options,
      deadline: Math.min(options.deadline ?? Infinity, Date.now() + 5000),
      responseBudget: new DataResponseBudget(2 * 1024 * 1024, 'cds-preview-discovery', true),
    });
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
      throw new AdtError('Invalid ADT discovery response for CDS_PREVIEW.');
    listed = parseDiscoveryDocument(xml).has(CDS_PREVIEW_PATH);
  }
  if (!listed) throw new AdtError('CDS_PREVIEW requires the native CDS preview collection in ADT discovery.');
  const encoded = encodeURIComponent(ddlSource);
  const ddl = root(
    await metadata(
      http,
      `/sap/bc/adt/ddic/ddl/sources/${encoded}?version=active`,
      'application/vnd.sap.adt.ddlSource+xml',
      options,
    ),
    'ddlSource',
  );
  if (
    ddl['@_name'] !== ddlSource ||
    ddl['@_type'] !== 'DDLS/DF' ||
    ddl['@_version'] !== 'active' ||
    !['view', 'view entity'].includes(String(ddl['@_source_type']))
  )
    throw new AdtError('CDS_PREVIEW requires an exact active DDLS view or view entity.');
  const table = root(
    await metadata(http, `${CDS_PREVIEW_PATH}/${encoded}/metadata`, CDS_PREVIEW_MIME, options),
    'tableData',
  );
  if (
    table.parameters !== undefined &&
    table.parameters !== '' &&
    !(Array.isArray(table.parameters) && table.parameters.length === 0)
  )
    throw new AdtError('CDS_PREVIEW does not yet support parameterized CDS views.');
  const cdsEntityName = canonicalDataSourceName(String(table.cdsEntityName ?? ''), 'CDS entity');
  return { ddlSource, cdsEntityName, columns: columns(table) };
}

export function buildCdsPreviewSql(target: CdsPreviewTarget, options: CdsPreviewOptions): string {
  const available = new Set(target.columns);
  for (const field of [...(options.columns ?? []), ...(options.where ?? []).map((condition) => condition.field)]) {
    if (!available.has(canonicalDataSourceName(field))) throw new AdtError(`CDS_PREVIEW: unknown column ${field}.`);
  }
  return fitFreestyleSqlLines(buildTableQuerySql(target.cdsEntityName, options.columns, options.where));
}

export function parseCdsPreviewRows(xml: string, maxRows: number) {
  columns(root(xml, 'tableData'));
  const data = parseTableContents(xml);
  return { columns: data.columns, rows: data.rows.slice(0, maxRows), truncated: data.rows.length > maxRows };
}

/** Execute only SQL constructed from the verified entity and its metadata fields. */
export async function executeCdsPreview(
  http: AdtHttpClient,
  policy: DataSourceBlocklistGuard,
  name: string,
  options: CdsPreviewOptions,
  request: AdtRequestOptions,
) {
  validateCdsPreviewOptions(name, options);
  const ddlSource = canonicalDataSourceName(name);
  const maxRows = clampPreviewRows(options.maxRows);
  await policy.rejectBlockedName(ddlSource);
  const target = await resolveCdsPreviewTarget(http, ddlSource, request);
  const sql = buildCdsPreviewSql(target, options);
  await policy.enforceSources([target.cdsEntityName]);
  const params = new URLSearchParams({ rowNumber: String(maxRows + 1), ddlSourceName: ddlSource });
  const response = await http.post(
    `${CDS_PREVIEW_PATH}?${params}`,
    sql,
    'text/plain',
    { Accept: CDS_PREVIEW_MIME },
    request,
  );
  return { ddlSource, cdsEntityName: target.cdsEntityName, ...parseCdsPreviewRows(response.body, maxRows) };
}
