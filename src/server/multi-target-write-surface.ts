/** Reviewed mutation surface; independent of tool advertisement and general single-target schemas. */
import type { ServerConfig } from './types.js';

export const PINNED_WRITE_ACTIONS = ['create', 'update', 'edit_method'] as const;
export const PINNED_WRITE_FIELDS = new Set([
  'action',
  'type',
  'name',
  'source',
  'package',
  'description',
  'transport',
  'method',
  'expectedSourceHash',
]);
export const PINNED_ACTIVATE_FIELDS = new Set(['action', 'type', 'name']);

export function pinnedWriteEnabled(config: ServerConfig): boolean {
  return config.allowWrites && config.multiTargetWrite?.enabled === true && config.ppEnabled && config.ppStrict;
}

/** Called on normalized arguments before Destination lookup. Schema construction may omit type/name. */
export function pinnedMutationAllowed(tool: string, args: Record<string, unknown>, config: ServerConfig): boolean {
  if (!pinnedWriteEnabled(config)) return false;
  const type = args.type;
  if (type !== undefined && type !== 'CLAS' && type !== 'INTF') return false;
  const action = args.action ?? (tool === 'SAPActivate' ? 'activate' : undefined);
  const fields = tool === 'SAPActivate' ? PINNED_ACTIVATE_FIELDS : PINNED_WRITE_FIELDS;
  if (Object.entries(args).some(([key, value]) => value !== undefined && !fields.has(key))) return false;
  if (tool === 'SAPActivate') return action === 'activate';
  if (tool !== 'SAPWrite' || !PINNED_WRITE_ACTIONS.includes(action as (typeof PINNED_WRITE_ACTIONS)[number]))
    return false;
  if (action !== 'create' && (args.package !== undefined || args.description !== undefined)) return false;
  if (action === 'create' && (args.method !== undefined || args.expectedSourceHash !== undefined)) return false;
  if (action !== 'edit_method' && args.method !== undefined) return false;
  if (action === 'edit_method' && (type === 'INTF' || /^(?:lhc_|lcl_|ltc_)/i.test(String(args.method ?? ''))))
    return false;
  return true;
}
