/**
 * Shared explicit runtime/quickfix contracts. Public wiring imports these rows; named native/PP
 * qualification remains a release gate and may narrow them. Internal recording profiles retain
 * their separate contracts; public admission does not infer support from the legacy registry.
 */
import { parsePinnedFlpList, parsePinnedFlpMutation } from '../adt/pinned-flp.js';
import { parsePinnedQuickfixInput, QUICKFIX_FIELDS } from '../adt/pinned-quickfix-input.js';
import { parsePinnedSqlTrace, parsePinnedTraceCancel, parsePinnedTraceStart } from '../adt/pinned-trace.js';
import { SAPDiagnoseSchema, SAPManageSchema } from '../handlers/schemas.js';
import type { PinnedCompanionCapability, PinnedMutationCapability } from './pinned-mutation-capabilities.js';

function accepted<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } },
  parse: (args: Record<string, unknown>) => T,
) {
  return (args: Record<string, unknown>): boolean => {
    const parsed = schema.safeParse(args);
    if (!parsed.success) return false;
    try {
      parse(parsed.data as Record<string, unknown>);
      return true;
    } catch {
      return false;
    }
  };
}

const diagnose = (
  action: string,
  fields: string[],
  parse: (args: Record<string, unknown>) => unknown,
): PinnedMutationCapability => ({
  tool: 'SAPDiagnose',
  action,
  resource: 'trace',
  fields: ['action', ...fields],
  accepts: accepted(SAPDiagnoseSchema, parse),
});

const flp = (action: string, fields: string[]): PinnedMutationCapability => ({
  tool: 'SAPManage',
  action,
  resource: 'flp',
  fields: ['action', ...fields],
  // Validate the raw tile as well: Zod would strip an unknown nested field before the handler sees it.
  accepts: (args) => accepted(SAPManageSchema, () => parsePinnedFlpMutation(args))(args),
});

export const PINNED_RUNTIME_CANDIDATES: readonly PinnedMutationCapability[] = Object.freeze([
  {
    tool: 'SAPDiagnose',
    action: 'apply_quickfix',
    resource: 'quickfix-proposal',
    fields: QUICKFIX_FIELDS,
    accepts: (args) => accepted(SAPDiagnoseSchema, () => parsePinnedQuickfixInput(args))(args),
  },
  diagnose(
    'trace_start',
    ['traceUser', 'processType', 'objectType', 'maxExecutions', 'expiresHours', 'sqlTrace', 'aggregate', 'description'],
    parsePinnedTraceStart,
  ),
  diagnose('trace_cancel', ['id', 'traceUser'], parsePinnedTraceCancel),
  diagnose('set_sql_trace_state', ['sqlOn', 'user'], parsePinnedSqlTrace),
  flp('flp_create_catalog', ['domainId', 'title']),
  flp('flp_create_group', ['groupId', 'title']),
  flp('flp_create_tile', ['catalogId', 'tile']),
  flp('flp_add_tile_to_group', ['groupId', 'catalogId', 'tileInstanceId']),
  flp('flp_delete_catalog', ['catalogId']),
]);

export const PINNED_RUNTIME_COMPANION_CANDIDATES: readonly PinnedCompanionCapability[] = Object.freeze(
  (
    [
      ['flp_list_catalogs', []],
      ['flp_list_groups', []],
      ['flp_list_tiles', ['catalogId']],
    ] as const
  ).map(([action, fields]) => ({
    tool: 'SAPManage' as const,
    action,
    fields: ['action', ...fields],
    accepts: accepted(SAPManageSchema, parsePinnedFlpList),
  })),
);

/** Scenario IDs from docs/research/broader-pinned-pp-writes/native-runtime-contracts.md; a row without one cannot be reviewed. */
export const PINNED_RUNTIME_MISSING_QUALIFICATION: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'SAPDiagnose.apply_quickfix': ['QFX-1', 'QFX-2', 'QFX-3', 'QFX-4'],
  'SAPDiagnose.trace_start': ['TRC-1', 'TRC-2', 'TRC-3', 'TRC-4'],
  'SAPDiagnose.trace_cancel': ['TRC-5'],
  'SAPDiagnose.set_sql_trace_state': ['ST5-1', 'ST5-2', 'ST5-3', 'ST5-4'],
  'SAPManage.flp_create_catalog': ['FLP-1', 'FLP-2', 'FLP-3'],
  'SAPManage.flp_create_group': ['FLP-1', 'FLP-2', 'FLP-4'],
  'SAPManage.flp_create_tile': ['FLP-1', 'FLP-2', 'FLP-5'],
  'SAPManage.flp_add_tile_to_group': ['FLP-1', 'FLP-2', 'FLP-6'],
  'SAPManage.flp_delete_catalog': ['FLP-1', 'FLP-2', 'FLP-7'],
  'SAPManage.flp_list_catalogs': ['FLP-1'],
  'SAPManage.flp_list_groups': ['FLP-1'],
  'SAPManage.flp_list_tiles': ['FLP-1'],
});

type Properties = Record<string, unknown>;

/** Pinned wording and bounds for inputs whose single-target schema promises a default these routes refuse. */
export function pinnedRuntimeProperties(
  tool: string,
  actions: readonly string[],
  properties: Properties,
  principalPropagation: boolean,
): Properties {
  if (tool !== 'SAPDiagnose') return properties;
  const projected = { ...properties };
  const arming = actions.includes('trace_start');
  const controls = arming || actions.includes('trace_cancel');
  if (projected.traceUser && (controls || principalPropagation))
    projected.traceUser = {
      type: 'string',
      description: controls
        ? 'Exact SAP user, required for trace_start and trace_cancel, and for trace_requests on Principal Propagation targets: ARC-1 cannot derive the mapped SAP user from your login name. trace_start and trace_cancel refuse patterns.'
        : 'SAP user for trace_requests, required on Principal Propagation targets: ARC-1 cannot derive the mapped SAP user from your login name. Basic targets retain their connected-user default.',
    };
  if (arming) {
    projected.maxExecutions = {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      description: 'trace_start executions to capture (default 1).',
    };
    projected.expiresHours = {
      type: 'number',
      exclusiveMinimum: 0,
      maximum: 24,
      description: 'trace_start expiry in hours (default and maximum 24).',
    };
  }
  if (actions.includes('set_sql_trace_state')) {
    projected.sqlOn = {
      type: 'boolean',
      description:
        'set_sql_trace_state: true arms ST05 for the exact SAP user in "user" on every application-server instance; false disarms, with native OFF resetting known filters and non-stack properties to inactive defaults. No-op state is preserved. Writes that would clear active non-SQL traces are refused.',
    };
    projected.user = {
      type: 'string',
      description:
        'Exact SAP user: required filter for set_sql_trace_state sqlOn=true (patterns refused), otherwise the dump/feed/authorization_trace filter.',
    };
  }
  return projected;
}

const RUNTIME_SCOPE =
  "Trace requests name one exact SAP user and this route's client; ST05 state covers every application-server instance and is not client-isolated or own-user. Package lists do not apply; SAP authorization decides. Results report unconfirmed outcomes without retry.";

/** Projects the admitted selected-target actions without carrying single-target-only promises. */
export function pinnedRuntimeDescription(tool: string, actions: readonly string[], base: string): string {
  if (tool === 'SAPDiagnose') {
    const lines = base
      .split('\n')
      .filter((line) => line !== RUNTIME_SCOPE)
      .map((line) => {
        if (line.startsWith('Quickfix:') && !actions.includes('apply_quickfix')) return '';
        if (!line.startsWith('- "')) return line;
        const names = [...line.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
        const allowed = names.filter((name) => actions.includes(name));
        if (!allowed.length) return '';
        return allowed.length === names.length
          ? line
          : `- ${allowed.map((name) => `"${name}"`).join(', ')}: available; see the action-specific fields.`;
      })
      .filter(Boolean);
    if (actions.some((action) => ['trace_start', 'trace_cancel', 'set_sql_trace_state'].includes(action)))
      lines.push(RUNTIME_SCOPE);
    return lines.join('\n');
  }
  if (tool === 'SAPTransport') {
    const notes = [`CTS request/task operations; use exact native IDs.`];
    if (actions.includes('create'))
      notes.push(
        'Create a Workbench request; native target/package selects its route. An empty resolved target is local. Use layers/targets value helps.',
      );
    if (
      actions.some((action) => ['release', 'release_recursive', 'delete', 'reassign', 'remove_object'].includes(action))
    )
      notes.push(
        'Explicit management requires write/transports scopes and both request policies. Recursive operations authorize all initial members; expansions stop further submissions. Native errors can have partial effects; never automatically retry. Release affects downstream TMS routes.',
      );
    if (actions.includes('diff'))
      notes.push(
        'Diff: open requests use active source; released requests need attributed revisions. Missing history is not creation or unchanged. Non-source gaps remain explicit; follow nextOffset; pages are not snapshots.',
      );
    if (actions.includes('history'))
      notes.push('History reads current locks/assignment candidates, not complete change history.');
    return notes.join(' ');
  }
  if (tool === 'SAPManage') {
    const notes = [`Selected-target administration.`];
    if (actions.some((action) => ['create_package', 'delete_package', 'change_package'].includes(action)))
      notes.push(
        'Repository management enforces native owners and independent destination/server package and request policies. Package deletion is non-cascading and limited to the supported local contract; $TMP is protected.',
      );
    if (actions.includes('set_api_state'))
      notes.push('API release requires the exact owner and current native contract state.');
    if (actions.some((action) => ['features', 'probe', 'cache_stats'].includes(action)))
      notes.push('Feature/probe/cache companions retain normal read scope and use this selected target.');
    if (actions.some((action) => action.startsWith('flp_')))
      notes.push(
        'Classic catalogs, groups and tiles use PAGE_BUILDER_CUST and are shared with this client’s users; package lists do not apply. Spaces, pages and Work Zone are excluded.',
      );
    if (actions.some((action) => action.startsWith('flp_') && !action.startsWith('flp_list_')))
      notes.push(
        'Mutation requires both explicit * request policies and native platform evidence. Recording remains native-governed/unverified; application 604 never proves absence.',
      );
    return notes.join(' ');
  }
  return base;
}
