/**
 * Long-term SAP user authorization trace (STUSERTRACE) decoding.
 *
 * The trace itself is stored in SUAUTHVALTRC. Its FIELD1..FIELD0 columns are
 * positional values; TOBJ supplies the matching authorization-field names.
 */

import { type AdtClient, clampPreviewRows } from './client.js';
import type { AuthorizationTraceResult, AuthorizationTraceState, AuthTraceEntry } from './types.js';

const AUTH_TRACE_COLUMNS = [
  'USERNAME',
  'NAME',
  'TYPE',
  'OBJECT',
  'RC',
  'FIELD1',
  'FIELD2',
  'FIELD3',
  'FIELD4',
  'FIELD5',
  'FIELD6',
  'FIELD7',
  'FIELD8',
  'FIELD9',
  'FIELD0',
  'ABAPPROG',
  'ABAPLINE',
  'FIRSTCALL',
] as const;

const TRACE_FIELD_COLUMNS = [
  'FIELD1',
  'FIELD2',
  'FIELD3',
  'FIELD4',
  'FIELD5',
  'FIELD6',
  'FIELD7',
  'FIELD8',
  'FIELD9',
  'FIELD0',
] as const;

const TOBJ_FIELD_COLUMNS = [
  'FIEL1',
  'FIEL2',
  'FIEL3',
  'FIEL4',
  'FIEL5',
  'FIEL6',
  'FIEL7',
  'FIEL8',
  'FIEL9',
  'FIEL0',
] as const;

const AUTH_RC_LABELS: Record<number, string> = {
  0: 'passed',
  4: 'No authorization',
  12: 'No authorization',
};

function rcLabel(rc: number): string {
  return AUTH_RC_LABELS[rc] ?? `denied (rc=${rc})`;
}

/** Convert SAP's UTC YYYYMMDDHHMMSS FIRSTCALL value to ISO-8601. */
export function parseFirstCallTs(raw: string): string {
  if (!/^\d{14}$/.test(raw)) return '';

  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  const second = Number(raw.slice(12, 14));
  const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  if (
    timestamp.getUTCFullYear() !== year ||
    timestamp.getUTCMonth() !== month - 1 ||
    timestamp.getUTCDate() !== day ||
    timestamp.getUTCHours() !== hour ||
    timestamp.getUTCMinutes() !== minute ||
    timestamp.getUTCSeconds() !== second
  ) {
    return '';
  }

  return timestamp.toISOString();
}

/** Decode raw SUAUTHVALTRC rows into the stable SAPDiagnose response shape. */
export function decodeAuthTraceRows(
  rows: Record<string, string>[],
  fieldNames: Record<string, string[]>,
  opts: { maxResults: number },
): AuthTraceEntry[] {
  const entries = rows.map((row): AuthTraceEntry => {
    const authObject = row.OBJECT ?? '';
    const names = fieldNames[authObject] ?? [];
    const fields: Record<string, string> = {};

    TRACE_FIELD_COLUMNS.forEach((column, index) => {
      const value = row[column] ?? '';
      if (!value) return;
      fields[names[index] || column] = value;
    });

    const rc = Number(row.RC);
    const program = row.ABAPPROG ?? '';
    const line = row.ABAPLINE ?? '';

    return {
      user: row.USERNAME ?? '',
      application: row.NAME || row.TYPE || '',
      authObject,
      rc,
      result: rcLabel(rc),
      fields,
      codeLocation: program ? `${program}${line ? `:${line}` : ''}` : '',
      firstSeen: parseFirstCallTs(row.FIRSTCALL ?? ''),
    };
  });

  entries.sort((left, right) => {
    if (!left.firstSeen) return right.firstSeen ? 1 : 0;
    if (!right.firstSeen) return -1;
    return right.firstSeen.localeCompare(left.firstSeen);
  });

  return entries.slice(0, opts.maxResults);
}

export interface GetAuthorizationTraceOptions {
  user?: string;
  authObject?: string;
  onlyFailures?: boolean;
  maxResults?: number;
}

function buildAuthorizationTraceState(hasEntries: boolean): AuthorizationTraceState {
  const warnings = [
    'ARC-1 cannot read the current STUSERTRACE kernel/profile state through ADT. Existing rows may be historical and do not prove that tracing is currently active.',
  ];
  if (!hasEntries) {
    warnings.push(
      'No entries matched. The trace may be inactive (N), active with filters (F) that do not match, active but not yet exercised, or the request filters may be too narrow.',
    );
  }

  const activation = hasEntries
    ? undefined
    : {
        values: {
          N: 'Inactive.',
          F: 'Active only for filters maintained in STUSERTRACE (recommended for targeted production diagnosis).',
          Y: 'Active for all users and application types; broad collection.',
        },
        temporary:
          'In RZ11, choose Change Value and set auth/auth_user_trace to F (targeted) or Y (all users/applications). Select Change on All Servers when every application-server instance must participate. A dynamic RZ11 change is lost after an instance restart.',
        filteredSetup:
          'For F, open STUSERTRACE, choose Change Filter, and add at least one target user/application/object filter; F without a filter records nothing. Then reproduce the denied operation and query again.',
        persistent:
          'For restart-persistent activation, have SAP Basis maintain auth/auth_user_trace=F (or Y) in DEFAULT.PFL through the approved profile-maintenance workflow (RZ10 or operating-system profile maintenance), then apply it through the normal restart process.',
        authorizations:
          'Changing STUSERTRACE filters requires S_ADMI_FCD value STUF; evaluating trace data requires S_ADMI_FCD value STUR.',
      };

  return {
    status: 'unknown',
    parameter: 'auth/auth_user_trace',
    warnings,
    verify:
      'In SAP GUI, open RZ11 and display auth/auth_user_trace. STUSERTRACE also shows Inactive, Active (No filter), or Active with filter.',
    ...(activation ? { activation } : {}),
  };
}

/** Read and decode the on-prem STUSERTRACE authorization trace. */
export async function getAuthorizationTrace(
  client: AdtClient,
  opts: GetAuthorizationTraceOptions = {},
): Promise<AuthorizationTraceResult> {
  const maxResults = clampPreviewRows(opts.maxResults);
  const where: Array<{ field: string; op: string; value: string }> = [];
  if (opts.user) where.push({ field: 'USERNAME', op: '=', value: opts.user });
  if (opts.authObject) where.push({ field: 'OBJECT', op: '=', value: opts.authObject });
  if (opts.onlyFailures) where.push({ field: 'RC', op: '<>', value: '0' });

  const traceResult = await client.runTableQuery('SUAUTHVALTRC', {
    columns: [...AUTH_TRACE_COLUMNS],
    where,
    maxRows: maxResults,
  });

  const objects = Array.from(new Set(traceResult.rows.map((row) => row.OBJECT).filter(Boolean)));
  const fieldNames: Record<string, string[]> = {};

  if (objects.length > 0) {
    const metadataResult = await client.runTableQuery('TOBJ', {
      columns: ['OBJCT', ...TOBJ_FIELD_COLUMNS],
      where: [{ field: 'OBJCT', op: 'IN', value: objects.join(',') }],
      maxRows: 200,
    });

    for (const row of metadataResult.rows) {
      const object = row.OBJCT ?? '';
      if (!object) continue;
      const names = TOBJ_FIELD_COLUMNS.map((column) => row[column] ?? '');
      while (names.at(-1) === '') names.pop();
      fieldNames[object] = names;
    }
  }

  const entries = decodeAuthTraceRows(traceResult.rows, fieldNames, { maxResults });
  const onlyFailures = opts.onlyFailures === true;
  const note =
    entries.length === 0
      ? 'No authorization-trace entries matched. Review traceState warnings and activation guidance, then reproduce the operation or widen the filters.'
      : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${onlyFailures ? ' (rc<>0)' : ''}. ` +
        `Entries may be historical; verify the current trace state in RZ11. Results are capped at ${maxResults}; narrow the filters when more entries may exist.`;

  return {
    trace: 'STUSERTRACE (long-term user authorization trace, table SUAUTHVALTRC)',
    traceState: buildAuthorizationTraceState(entries.length > 0),
    filters: {
      user: opts.user ?? null,
      authObject: opts.authObject ?? null,
      onlyFailures,
    },
    count: entries.length,
    entries,
    note,
  };
}
