/** Read one saved SLG1 log through SAP's own rendering and authorization service. */
import { getCurrentContext } from '../server/context.js';
import type { AdtClient } from './client.js';
import { AdtError, AdtSafetyError } from './errors.js';
import { checkOperation, OperationType } from './safety.js';

const SERVICE = '/sap/opu/odata/sap/APL_LOG_MANAGEMENT_SRV/';
type Row = Record<string, unknown>;
export interface ApplicationLogInput {
  logNumber: string;
  maxRows?: number;
  offset?: number;
}

function invalidResponse(): never {
  throw new AdtError('SAP application-log service returned an unexpected response. No partial result was accepted.');
}
function string(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== 'string') return invalidResponse();
  return value;
}
function boolean(row: Row, field: string): boolean {
  const value = row[field];
  if (typeof value !== 'boolean') return invalidResponse();
  return value;
}
function collection(body: string, maximum: number): { rows: Row[]; more: boolean } {
  let parsed: { d?: { results?: unknown; __next?: unknown } };
  try {
    parsed = JSON.parse(body);
  } catch {
    return invalidResponse();
  }
  const rows = parsed?.d?.results;
  if (!Array.isArray(rows) || rows.length > maximum) return invalidResponse();
  if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) return invalidResponse();
  const next = parsed.d?.__next;
  if (next !== undefined && (typeof next !== 'string' || !next || rows.length === 0)) return invalidResponse();
  return { rows, more: next !== undefined };
}

export async function readApplicationLog(client: AdtClient, input: ApplicationLogInput) {
  checkOperation(client.safety, OperationType.Query, 'ReadApplicationLog');
  const { logNumber, maxRows = 50, offset = 0 } = input;
  if (
    typeof logNumber !== 'string' ||
    logNumber.length !== 20 ||
    !/^\d{20}$/u.test(logNumber) ||
    !Number.isInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > 100 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 5_000
  )
    throw new AdtError('Use an exact 20-digit logNumber, maxRows 1–100, and offset 0–5000.');
  // An opaque application service may read custom persistence through SAP exits. A table list
  // cannot prove its lineage; do not offer it as a route around a configured data-source policy.
  if (client.safety.blockedDataSources.length > 0)
    throw new AdtSafetyError(
      'Application-log reads are unavailable with SAP_BLOCKED_DATA_SOURCES: the native service has no provable table lineage. Keep the policy in place; inspect the log in SAP.',
    );

  const context = getCurrentContext();
  const scope = context?.dataResultScope ?? client.createDataResultScope();
  const timeout = AbortSignal.timeout(30_000);
  const signal = context?.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
  try {
    await scope.acquire(signal);
    async function get(path: string, parameters: Record<string, string>, maximum: number) {
      checkOperation(client.safety, OperationType.Query, 'ReadApplicationLog');
      const result = await client.http.get(
        `${SERVICE}${path}?${new URLSearchParams(parameters)}`,
        {
          Accept: 'application/json',
        },
        { responseBudget: scope.responseBudget, signal },
      );
      return collection(result.body, maximum);
    }
    // LogNumber is a filter on the overview only. MessageSet's model does not have that field.
    const overview = await get(
      'ApplicationLogOverviewSet',
      {
        $filter: `LogNumber eq '${logNumber}'`,
        $top: '2',
        $format: 'json',
      },
      2,
    );
    if (overview.more || overview.rows.length > 1) return invalidResponse();
    if (overview.rows.length === 0)
      return {
        status: 'not_found_or_not_visible' as const,
        logNumber,
        message: 'No visible saved log for this number. This does not prove that the log does not exist.',
      };
    const header = overview.rows[0]!;
    if (string(header, 'LogNumber') !== logNumber) return invalidResponse();
    const handle = string(header, 'LogHandle');
    if (handle.length !== 22 || !/^[\x21-\x7e]{22}$/u.test(handle)) return invalidResponse();
    // Use the returned key, never a server-supplied URL. Escape both OData and URL syntax.
    const key = encodeURIComponent(handle.replaceAll("'", "''")).replaceAll("'", '%27');
    const page = await get(
      `ApplicationLogOverviewSet('${key}')/ApplicationLogMessageSet`,
      {
        $top: String(maxRows + 1),
        $skip: String(offset),
        $format: 'json',
      },
      maxRows + 1,
    );
    const numbers = new Set<string>();
    const messages = page.rows.map((row) => {
      const number = string(row, 'MessageNumber');
      if (string(row, 'LogHandle') !== handle || number.length !== 6 || !/^\d{6}$/u.test(number) || numbers.has(number))
        return invalidResponse();
      numbers.add(number);
      return {
        number,
        type: string(row, 'Type'),
        text: string(row, 'Text'),
        timestamp: string(row, 'Timestamp'),
        hasLongText: boolean(row, 'HasLongText'),
        hasDetails: boolean(row, 'HasDetailText'),
      };
    });
    const more = messages.length > maxRows || page.more;
    const nextOffset = offset + Math.min(messages.length, maxRows);
    return {
      status: 'ok' as const,
      logNumber,
      header: {
        object: string(header, 'Object'),
        subobject: string(header, 'SubObject'),
        externalNumber: string(header, 'ExternalNumber'),
        severity: string(header, 'Severity'),
        createdAt: string(header, 'CreatedAt'),
      },
      offset,
      messages: messages.slice(0, maxRows),
      more,
      ...(more && nextOffset <= 5_000 ? { nextOffset } : {}),
      ...(more && nextOffset > 5_000 ? { limitReached: true } : {}),
      snapshotGuaranteed: false,
    };
  } catch (error) {
    if (signal.aborted)
      throw new AdtError(
        timeout.aborted
          ? 'Application-log read exceeded its 30-second deadline. No partial result was returned. Inspect this log in SAP; smaller pages may still require SAP to load the whole log.'
          : 'Application-log read was cancelled. No partial result was returned.',
      );
    throw error;
  } finally {
    if (!context?.dataResultScope) scope.release();
  }
}
