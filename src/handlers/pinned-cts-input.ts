/** Private candidate validation, independent of the public SAPTransport schema and action matrix. */
import { AdtSafetyError } from '../adt/errors.js';
import { ctsId, nativeCtsTarget } from '../adt/pinned-cts-evidence.js';
import type { PinnedTransportAction } from '../adt/pinned-transport-scope.js';
import { SAPTransportSchema } from './schemas.js';

export const PINNED_CTS_FIELDS: Record<PinnedTransportAction | 'layers' | 'targets', readonly string[]> = {
  create: ['description', 'package', 'target', 'transportLayer'],
  release: ['id', 'timeoutSeconds'],
  release_recursive: ['id', 'timeoutSeconds'],
  delete: ['id', 'recursive', 'removeLockedObjects'],
  reassign: ['id', 'owner', 'recursive'],
  remove_object: ['id', 'pgmid', 'type', 'name'],
  layers: [],
  targets: [],
};
const fields = PINNED_CTS_FIELDS;
export type CtsInput = ReturnType<typeof SAPTransportSchema.parse> & { action: keyof typeof fields };
export function privateCtsInput(raw: Record<string, unknown>): CtsInput {
  const action = raw.action as keyof typeof fields;
  if (
    !Object.hasOwn(fields, action) ||
    Object.keys(raw).some((key) => key !== 'action' && !fields[action].includes(key))
  )
    throw new AdtSafetyError('Unsupported private CTS action or input field.');
  const parsed = SAPTransportSchema.safeParse(raw);
  if (!parsed.success) throw new AdtSafetyError('Invalid private CTS input.');
  const input = parsed.data as CtsInput;
  if (input.timeoutSeconds !== undefined && input.timeoutSeconds > 300)
    throw new AdtSafetyError('Pinned CTS release timeout cannot exceed 300 seconds.');
  if (!['create', 'layers', 'targets'].includes(action)) ctsId(input.id);
  const text = (value: unknown, limit: number) =>
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value === value.trim() &&
    value.length <= limit &&
    [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
  if (action === 'create') {
    if (!text(input.description, 60)) throw new AdtSafetyError('CTS creation requires a bounded description.');
    if (input.target !== undefined) {
      nativeCtsTarget(input.target);
      if (input.package !== undefined || input.transportLayer !== undefined)
        throw new AdtSafetyError('Choose explicit native target or package routing, not both.');
    } else if (!input.package || !/^(?:\$TMP|[A-Z0-9_/]{1,30})$/.test(input.package))
      throw new AdtSafetyError('Package-routed CTS creation requires an explicit routing package.');
    if (input.transportLayer !== undefined && !/^[A-Z0-9_/]{1,30}$/.test(input.transportLayer))
      throw new AdtSafetyError('Invalid native transport layer.');
  }
  if (action === 'reassign' && (!text(input.owner, 12) || !/^[A-Z0-9_]+$/.test(input.owner!)))
    throw new AdtSafetyError('Reassignment requires an explicit native SAP user.');
  if (
    action === 'remove_object' &&
    (!text(input.name, 120) ||
      !/^[A-Z0-9_]{1,4}$/.test(input.type ?? '') ||
      !/^[A-Z0-9_]{1,4}$/.test(input.pgmid ?? 'R3TR'))
  )
    throw new AdtSafetyError('CTS entry removal requires a complete object selector.');
  return input;
}
