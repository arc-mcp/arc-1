/** Reviewed mutation surface (ADR-0011): explicit actions; types and fields are the single-target ones. */
import { isPinnedTransportAllowed } from '../adt/safety.js';
import { SAPActivateSchema, SAPWriteSchema, SAPWriteSchemaBtp } from '../handlers/schemas.js';
import type { ServerConfig } from './types.js';

export function pinnedWriteEnabled(config: ServerConfig): boolean {
  return config.allowWrites && config.multiTargetWrite?.enabled === true && config.ppEnabled && config.ppStrict;
}

/**
 * Mutations served by the shared single-target handlers. Explicit keys: a new single-target action
 * is not writable on a pinned target until it is listed here. Types and fields are the handler's own.
 */
export const SHARED_PINNED_ACTIONS: ReadonlySet<string> = new Set([
  'SAPWrite.create',
  'SAPWrite.update',
  'SAPWrite.delete',
  'SAPWrite.edit_method',
  'SAPWrite.edit_unit',
  'SAPWrite.add_unit',
  'SAPWrite.edit_class_definition',
  'SAPWrite.add_method',
  'SAPWrite.edit_method_signature',
  'SAPWrite.delete_method',
  'SAPWrite.change_method_visibility',
  'SAPWrite.edit_text_symbols',
  'SAPWrite.batch_create',
  'SAPWrite.scaffold_rap_handlers',
  'SAPWrite.generate_behavior_implementation',
  'SAPActivate.activate',
]);

/** Single-target input keys; the Zod schemas are what dispatch enforces (`target` is never one). */
function singleTargetKeys(tool: string, config: ServerConfig): ReadonlySet<string> {
  const schema =
    tool === 'SAPActivate' ? SAPActivateSchema : config.systemType === 'btp' ? SAPWriteSchemaBtp : SAPWriteSchema;
  return new Set(Object.keys(schema.shape));
}

function actionOf(tool: string, args: Record<string, unknown>): unknown {
  return args.action ?? (tool === 'SAPActivate' ? 'activate' : undefined);
}

/** Caller-supplied CTS requests, wherever the tool schema carries them. */
function requestedTransports(args: Record<string, unknown>): unknown[] {
  const nested = Array.isArray(args.objects)
    ? args.objects.map((item) => (item as { transport?: unknown })?.transport)
    : [];
  return [args.transport, ...nested].filter((value) => value !== undefined && value !== '');
}

function transportsAllowed(args: Record<string, unknown>, config: ServerConfig): boolean {
  const policy = config.multiTargetWrite;
  return requestedTransports(args).every(
    (id) => typeof id === 'string' && !!policy && isPinnedTransportAllowed(policy, id),
  );
}

/**
 * Admission for SAPWrite/SAPActivate on a pinned target. Called on normalized arguments by the HTTP
 * gate and again by handleToolCall.
 */
export function pinnedMutationAllowed(tool: string, args: Record<string, unknown>, config: ServerConfig): boolean {
  if (!pinnedWriteEnabled(config)) return false;
  if (!SHARED_PINNED_ACTIONS.has(`${tool}.${String(actionOf(tool, args))}`)) return false;
  const keys = singleTargetKeys(tool, config);
  if (Object.entries(args).some(([key, value]) => value !== undefined && !keys.has(key))) return false;
  return args.preaudit !== false && transportsAllowed(args, config);
}
