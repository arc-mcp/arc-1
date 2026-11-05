/** Fixed private batch contract. No public schema/capability row imports this module. */

import { AdtSafetyError } from '../../adt/errors.js';
import { PINNED_BATCH_INPUT_LIMIT } from '../../adt/pinned-batch-bounds.js';
import { isPinnedDdicType, pinnedDdicSelection } from '../../adt/pinned-ddic-owner.js';
import {
  isPinnedDeclarativeType,
  pinnedDeclarativeSelection,
  pinnedFunctionSelection,
} from '../../adt/pinned-repository-owner.js';
import { pinnedBindingSelection } from '../../adt/pinned-service-binding-owner.js';
import { assertPinnedSourceOwner } from '../../adt/pinned-write-policy.js';
import { isServerDrivenObjectType } from '../../adt/server-driven.js';
import { getToolSchema } from '../schemas.js';

const BYTE_LIMIT = 1024 * 1024;
export interface PinnedBatchInput {
  readonly objects: readonly Readonly<Record<string, unknown>>[];
  readonly activateAtEnd: boolean;
}

function snapshot(raw: unknown): Record<string, unknown> {
  let nodes = 0,
    bytes = 0;
  const inspect = (value: unknown, depth: number): void => {
    if (++nodes > 10_000 || depth > 8) throw new AdtSafetyError('Batch input exceeds structural bounds.');
    if (typeof value === 'string') bytes += Buffer.byteLength(value);
    else if (value === undefined || value === null || typeof value === 'boolean') return;
    else if (typeof value === 'number' && Number.isFinite(value)) return;
    else if (Array.isArray(value)) {
      if (value.length > 1000) throw new AdtSafetyError('Batch input array exceeds its bound.');
      for (const item of value) inspect(item, depth + 1);
    } else if (
      typeof value === 'object' &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    ) {
      for (const [key, item] of Object.entries(value)) {
        bytes += Buffer.byteLength(key);
        inspect(item, depth + 1);
      }
    } else throw new AdtSafetyError('Batch input requires finite JSON values.');
    if (bytes > BYTE_LIMIT) throw new AdtSafetyError('Batch input exceeds one MiB.');
  };
  inspect(raw, 0);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AdtSafetyError('Batch input must be an object.');
  return JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
}
export function freezeBatchValue<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeBatchValue(child);
    Object.freeze(value);
  }
  return value;
}
function fields(input: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new AdtSafetyError('Unsupported private batch input field.');
}
/** Zod's legacy nested objects strip unknown fields: refuse that loss before forwarding a batch. */
function noDroppedFields(raw: unknown, parsed: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  if (!parsed || typeof parsed !== 'object') throw new AdtSafetyError('Invalid nested batch input.');
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.hasOwn(parsed, key)) throw new AdtSafetyError('Unsupported nested batch input field.');
    noDroppedFields(value, (parsed as Record<string, unknown>)[key]);
  }
}

export function batchOwnerKey(args: Readonly<Record<string, unknown>>): string {
  const type = args.type as string;
  const family =
    type === 'INCL' || type === 'PROG'
      ? 'PROG'
      : type === 'CLAS' || type === 'INTF'
        ? 'OO'
        : ['TABL', 'TABL/DT', 'TABL/DS'].includes(type)
          ? 'TABL'
          : type;
  return `${family}:${args.name}`;
}

/** Selection is static; native identity/package/recording is independently proved by each adapter. */
export function validateBatchSelection(args: Readonly<Record<string, unknown>>, creation: boolean): void {
  if (args.group !== undefined && args.type !== 'FUNC') throw new AdtSafetyError('Batch group selects FUNC only.');
  if (args.type === 'FUGR' || (args.type === 'INCL' && args.group !== undefined))
    throw new AdtSafetyError('Whole-group generation and group-owned include batches are not qualified.');
  if (args.type === 'FUNC') {
    if (typeof args.group !== 'string' || !args.group)
      throw new AdtSafetyError('Batch FUNC requires an explicit group.');
    pinnedFunctionSelection(args.type, args.name, args.group);
  } else if (isPinnedDeclarativeType(args.type)) pinnedDeclarativeSelection(args.type, args.name);
  else if (args.type === 'SRVB') pinnedBindingSelection(args.name);
  else if (isPinnedDdicType(args.type) || args.type === 'TABL') {
    if (
      args.type === 'APLO' ||
      args.type === 'UIAD' ||
      (creation && (isServerDrivenObjectType(args.type as string) || args.type === 'TABL/DTT'))
    )
      throw new AdtSafetyError('This immediate-active or server-driven create batch combination is not qualified.');
    pinnedDdicSelection(args.type === 'TABL' ? 'TABL/DT' : args.type, args.name);
  } else assertPinnedSourceOwner(args.type, args.name);
}

export function privateBatchInput(raw: unknown, creation: boolean, btp: boolean): PinnedBatchInput {
  const input = snapshot(raw);
  fields(
    input,
    creation
      ? ['action', 'objects', 'package', 'transport', 'group', 'activateAtEnd']
      : ['action', 'objects', 'preaudit'],
  );
  if (
    (input.action ?? (creation ? '' : 'activate')) !== (creation ? 'batch_create' : 'activate') ||
    (input.preaudit !== undefined && input.preaudit !== true) ||
    (input.activateAtEnd !== undefined && typeof input.activateAtEnd !== 'boolean')
  )
    throw new AdtSafetyError('Select a fixed preaudited batch action and boolean activation mode.');
  for (const key of ['package', 'transport', 'group'])
    if (input[key] !== undefined && (typeof input[key] !== 'string' || !(input[key] as string).trim()))
      throw new AdtSafetyError('Batch defaults must be non-empty text.');
  if (!Array.isArray(input.objects) || input.objects.length === 0 || input.objects.length > PINNED_BATCH_INPUT_LIMIT)
    throw new AdtSafetyError('Private batches require 1–10 input objects before deduplication.');
  const seen = new Map<string, Record<string, unknown>>();
  const objects: Record<string, unknown>[] = [];
  for (const rawObject of input.objects) {
    if (!rawObject || typeof rawObject !== 'object' || Array.isArray(rawObject))
      throw new AdtSafetyError('Every batch entry must be an object.');
    let object = rawObject as Record<string, unknown>;
    if (creation) {
      // Validate against the legacy per-item shape, never inherit unrelated top-level defaults.
      const schema = getToolSchema('SAPWrite', btp)!;
      const parsed = schema.safeParse({ action: 'batch_create', objects: [object] });
      if (!parsed.success) throw new AdtSafetyError(`Invalid batch-create item: ${parsed.error.message}`);
      const item = (parsed.data as { objects: Record<string, unknown>[] }).objects[0];
      noDroppedFields(object, item);
      object = {
        ...item,
        action: 'create',
        type: item.type === 'TABL' ? 'TABL/DT' : item.type,
        ...(item.package === undefined && input.package !== undefined ? { package: input.package } : {}),
        ...(item.transport === undefined && input.transport !== undefined ? { transport: input.transport } : {}),
        ...(item.type === 'FUNC' && item.group === undefined && input.group !== undefined
          ? { group: input.group }
          : {}),
      };
      if (typeof object.source === 'string' && Buffer.byteLength(object.source) > 256 * 1024)
        throw new AdtSafetyError('Each batch source is bounded to 256 KiB.');
    } else {
      fields(object, ['type', 'name', 'group']);
      object = { ...object, action: 'activate' };
    }
    for (const field of ['package', 'transport', 'group'])
      if (object[field] !== undefined && (typeof object[field] !== 'string' || !(object[field] as string).trim()))
        throw new AdtSafetyError('Explicit batch package, transport and group values cannot be empty.');
    validateBatchSelection(object, creation);
    const key = batchOwnerKey(object),
      previous = seen.get(key);
    if (previous) {
      if (creation || previous.type !== object.type || previous.group !== object.group)
        throw new AdtSafetyError(`Duplicate or conflicting batch owner: ${key}`);
      continue;
    }
    seen.set(key, object);
    objects.push(object);
  }
  return freezeBatchValue({ objects, activateAtEnd: input.activateAtEnd === true });
}
