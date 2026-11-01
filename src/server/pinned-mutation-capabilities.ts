/** Explicit admitted combinations. Pending PR 2 adapters must not be inferred from the single-target registry. */

import { SAPLintSchema } from '../handlers/schemas.js';

export interface PinnedMutationCapability {
  readonly tool: 'SAPWrite' | 'SAPActivate' | 'SAPManage' | 'SAPTransport' | 'SAPDiagnose' | 'SAPLint';
  readonly action: string;
  /** Resource family; each qualified adapter must enforce its native boundary. */
  readonly resource: 'repository-source' | 'whole-owner' | 'package' | 'cts' | 'trace' | 'settings' | 'flp';
  /** Absent for operations without an object-type selector; raw fields still have an explicit allowlist. */
  readonly types?: readonly string[];
  readonly fields: readonly string[];
  readonly accepts: (args: Record<string, unknown>) => boolean;
}

export const PINNED_CLASS_INCLUDE_NAMES = Object.freeze([
  'definitions',
  'implementations',
  'macros',
  'testclasses',
] as const);

const ownerFields = ['action', 'type', 'name'];
const sourceFields = [...ownerFields, 'source', 'transport'];
const rows: PinnedMutationCapability[] = [
  {
    tool: 'SAPWrite',
    action: 'create',
    resource: 'repository-source',
    types: ['CLAS', 'INTF'],
    fields: [...sourceFields, 'package', 'description'],
    accepts: () => true,
  },
  {
    tool: 'SAPWrite',
    action: 'update',
    resource: 'repository-source',
    types: ['CLAS', 'INTF'],
    fields: [...sourceFields, 'expectedSourceHash', 'include'],
    accepts: (args) =>
      args.include === undefined ||
      (args.type === 'CLAS' && PINNED_CLASS_INCLUDE_NAMES.some((include) => include === args.include)),
  },
  {
    tool: 'SAPWrite',
    action: 'edit_method',
    resource: 'repository-source',
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
  {
    tool: 'SAPWrite',
    action: 'delete',
    resource: 'whole-owner',
    types: ['CLAS', 'INTF'],
    fields: [...ownerFields, 'transport'],
    accepts: () => true,
  },
  {
    tool: 'SAPLint',
    action: 'set_formatter_settings',
    resource: 'settings',
    fields: ['action', 'indentation', 'style'],
    accepts: (args) => {
      const parsed = SAPLintSchema.safeParse(args);
      return parsed.success && (parsed.data.indentation !== undefined || parsed.data.style !== undefined);
    },
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

export type PinnedCompanionCapability = Pick<PinnedMutationCapability, 'tool' | 'action' | 'fields' | 'accepts'>;

/** New supporting reads are visible only on writable pinned PP connections, with their normal read scope. */
export const PINNED_READ_COMPANIONS: readonly PinnedCompanionCapability[] = Object.freeze([
  Object.freeze({
    tool: 'SAPLint' as const,
    action: 'get_formatter_settings',
    fields: Object.freeze(['action']),
    accepts: (args: Record<string, unknown>) => SAPLintSchema.safeParse(args).success,
  }),
  Object.freeze({
    tool: 'SAPLint' as const,
    action: 'format',
    fields: Object.freeze(['action', 'source']),
    accepts: (args: Record<string, unknown>) => {
      const parsed = SAPLintSchema.safeParse(args);
      return parsed.success && typeof parsed.data.source === 'string' && parsed.data.source.length > 0;
    },
  }),
]);

export function pinnedCompanionCapability(tool: string, action: unknown): PinnedCompanionCapability | undefined {
  return PINNED_READ_COMPANIONS.find((entry) => entry.tool === tool && entry.action === action);
}

export function pinnedCompanionToolSurface(tool: string, enabled: (capability: PinnedCompanionCapability) => boolean) {
  const capabilities = PINNED_READ_COMPANIONS.filter((entry) => entry.tool === tool && enabled(entry));
  return capabilities.length
    ? {
        actions: capabilities.map((entry) => entry.action),
        fields: new Set(capabilities.flatMap((entry) => entry.fields)),
      }
    : undefined;
}
