/** Explicit admitted combinations. Pending PR 2 adapters must not be inferred from the single-target registry. */
export interface PinnedMutationCapability {
  readonly tool: 'SAPWrite' | 'SAPActivate' | 'SAPManage' | 'SAPTransport' | 'SAPDiagnose' | 'SAPLint';
  readonly action: string;
  /** Resource family; each qualified adapter must enforce its native boundary. */
  readonly resource: 'main-source' | 'whole-owner' | 'package' | 'cts' | 'trace' | 'settings' | 'flp';
  /** Absent for operations without an object-type selector; raw fields still have an explicit allowlist. */
  readonly types?: readonly string[];
  readonly fields: readonly string[];
  readonly accepts: (args: Record<string, unknown>) => boolean;
}

const ownerFields = ['action', 'type', 'name'];
const sourceFields = [...ownerFields, 'source', 'transport'];
const rows: PinnedMutationCapability[] = [
  {
    tool: 'SAPWrite',
    action: 'create',
    resource: 'main-source',
    types: ['CLAS', 'INTF'],
    fields: [...sourceFields, 'package', 'description'],
    accepts: () => true,
  },
  {
    tool: 'SAPWrite',
    action: 'update',
    resource: 'main-source',
    types: ['CLAS', 'INTF'],
    fields: [...sourceFields, 'expectedSourceHash'],
    accepts: () => true,
  },
  {
    tool: 'SAPWrite',
    action: 'edit_method',
    resource: 'main-source',
    types: ['CLAS'],
    fields: [...sourceFields, 'method', 'expectedSourceHash'],
    accepts: (args) => !/^(?:lhc_|lcl_|ltc_)/i.test(String(args.method ?? '')),
  },
  {
    tool: 'SAPActivate',
    action: 'activate',
    resource: 'whole-owner',
    types: ['CLAS', 'INTF'],
    fields: ownerFields,
    accepts: () => true,
  },
];
export const PINNED_MUTATION_CAPABILITIES: readonly PinnedMutationCapability[] = Object.freeze(
  rows.map((row) =>
    Object.freeze({
      ...row,
      ...(row.types ? { types: Object.freeze([...row.types]) } : {}),
      fields: Object.freeze([...row.fields]),
    }),
  ),
);

export function pinnedMutationCapability(tool: string, action: unknown): PinnedMutationCapability | undefined {
  return PINNED_MUTATION_CAPABILITIES.find((entry) => entry.tool === tool && entry.action === action);
}

/** Action/type/field admission unions; catalog wording and required fields remain in its projection. */
export function pinnedMutationToolSurface(tool: string, enabled: (capability: PinnedMutationCapability) => boolean) {
  const capabilities = PINNED_MUTATION_CAPABILITIES.filter((entry) => entry.tool === tool && enabled(entry));
  if (!capabilities.length) return undefined;
  return {
    actions: capabilities.map((entry) => entry.action),
    types: [...new Set(capabilities.flatMap((entry) => entry.types ?? []))],
    fields: new Set(capabilities.flatMap((entry) => entry.fields)),
  };
}
