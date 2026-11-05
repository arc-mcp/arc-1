/** Explicit public routing contracts; native qualification remains a release gate, never a tool flag. */
import { PINNED_MANAGED_PROFILES } from '../adt/pinned-managed-resources.js';
import { PINNED_CTS_FIELDS, privateCtsInput } from '../handlers/pinned-cts-input.js';
import { SAPManageSchema } from '../handlers/schemas.js';
import type { PinnedCompanionCapability, PinnedMutationCapability } from './pinned-mutation-capabilities.js';
import { PINNED_RUNTIME_CANDIDATES, PINNED_RUNTIME_COMPANION_CANDIDATES } from './pinned-runtime-candidates.js';

function acceptsCts(args: Record<string, unknown>): boolean {
  try {
    privateCtsInput(args);
    return true;
  } catch {
    return false;
  }
}

export const PINNED_MANAGEMENT_CAPABILITIES: readonly PinnedMutationCapability[] = [
  ...PINNED_RUNTIME_CANDIDATES,
  ...PINNED_MANAGED_PROFILES.filter((row) => row.tool === 'SAPManage').map(
    (row): PinnedMutationCapability => ({
      tool: row.tool,
      action: row.action,
      resource: 'package',
      fields: ['action', ...row.fields],
      ...(row.action === 'set_api_state' ? { types: ['CLAS', 'INTF', 'DDLS', 'DCLS', 'BDEF', 'SRVD', 'FUNC'] } : {}),
      accepts: (args) => SAPManageSchema.safeParse(args).success,
    }),
  ),
  ...Object.entries(PINNED_CTS_FIELDS)
    .filter(([action]) => !['layers', 'targets'].includes(action))
    .map(
      ([action, fields]): PinnedMutationCapability => ({
        tool: 'SAPTransport',
        action,
        resource: 'cts',
        fields: ['action', ...fields],
        // CTS type is a full native object key, not a repository-adapter selector.
        accepts: acceptsCts,
      }),
    ),
  ...['publish_srvb', 'unpublish_srvb'].map(
    (action): PinnedMutationCapability => ({
      tool: 'SAPActivate',
      action,
      resource: 'whole-owner',
      types: ['SRVB'],
      fields: ['action', 'type', 'name', 'version', 'service_type', 'expectedMetadataHash'],
      accepts: (args) =>
        args.service_type === 'odatav4' &&
        typeof args.name === 'string' &&
        typeof args.version === 'string' &&
        /^\d{4}$/.test(args.version) &&
        typeof args.expectedMetadataHash === 'string' &&
        /^[a-f0-9]{64}$/.test(args.expectedMetadataHash),
    }),
  ),
];

export const PINNED_MANAGEMENT_COMPANIONS: readonly PinnedCompanionCapability[] = [
  ...PINNED_RUNTIME_COMPANION_CANDIDATES,
  ...['layers', 'targets'].map(
    (action): PinnedCompanionCapability => ({
      tool: 'SAPTransport',
      action,
      fields: ['action'],
      accepts: acceptsCts,
    }),
  ),
  ...['features', 'probe', 'cache_stats'].map(
    (action): PinnedCompanionCapability => ({
      tool: 'SAPManage',
      action,
      fields: ['action'],
      accepts: (args) => SAPManageSchema.safeParse(args).success,
    }),
  ),
];
