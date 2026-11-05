/** Explicit admitted combinations. Pending PR 2 adapters must not be inferred from the single-target registry. */

import { SAPLintSchema } from '../handlers/schemas.js';
import { PINNED_MANAGEMENT_CAPABILITIES, PINNED_MANAGEMENT_COMPANIONS } from './pinned-management-capabilities.js';
import {
  acceptsPinnedActivation,
  acceptsPinnedBatchCreate,
  acceptsPinnedRepository,
  PINNED_ACTIVATION_TYPES,
  PINNED_REPOSITORY_FIELDS,
  PINNED_REPOSITORY_TYPES,
} from './pinned-repository-input.js';

export interface PinnedMutationCapability {
  readonly tool: 'SAPWrite' | 'SAPActivate' | 'SAPManage' | 'SAPTransport' | 'SAPDiagnose' | 'SAPLint';
  readonly action: string;
  /** Resource family; each qualified adapter must enforce its native boundary. */
  readonly resource:
    | 'repository-source'
    | 'text-pool'
    | 'whole-owner'
    | 'package'
    | 'cts'
    | 'trace'
    | 'settings'
    | 'quickfix-proposal'
    | 'flp';
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
    action: 'edit_text_symbols',
    resource: 'text-pool',
    types: ['CLAS', 'PROG', 'FUGR'],
    fields: [...sourceFields, 'textPart'],
    accepts: (args) =>
      (args.textPart === undefined || ['symbols', 'selections', 'headings'].some((part) => part === args.textPart)) &&
      (args.type !== 'CLAS' || args.textPart === undefined || args.textPart === 'symbols'),
  },
  ...['create', 'update', 'delete'].map(
    (action): PinnedMutationCapability => ({
      tool: 'SAPWrite',
      action,
      resource: 'repository-source',
      types: PINNED_REPOSITORY_TYPES,
      fields: PINNED_REPOSITORY_FIELDS,
      accepts: acceptsPinnedRepository,
    }),
  ),
  {
    tool: 'SAPWrite',
    action: 'batch_create',
    resource: 'repository-source',
    fields: ['action', 'objects', 'package', 'transport', 'group', 'activateAtEnd'],
    accepts: acceptsPinnedBatchCreate,
  },
  ...['scaffold_rap_handlers', 'generate_behavior_implementation'].map(
    (action): PinnedMutationCapability => ({
      tool: 'SAPWrite',
      action,
      resource: 'repository-source',
      types: ['CLAS'],
      fields: [
        'action',
        'type',
        'name',
        'bdefName',
        'targetAlias',
        'transport',
        ...(action === 'scaffold_rap_handlers' ? ['autoApply', 'lintBeforeWrite'] : ['dryRun', 'activate']),
      ],
      accepts: () => true,
    }),
  ),
  ...['edit_unit', 'add_unit'].map(
    (action): PinnedMutationCapability => ({
      tool: 'SAPWrite',
      action,
      resource: 'repository-source',
      types: ['PROG', 'INCL'],
      fields: [...sourceFields, 'unit', 'expectedSourceHash', 'group'],
      accepts: (args) => args.group === undefined || args.type === 'INCL',
    }),
  ),
  {
    tool: 'SAPWrite',
    action: 'edit_method',
    resource: 'repository-source',
    types: ['CLAS'],
    fields: [...sourceFields, 'method', 'expectedSourceHash', 'include'],
    accepts: (args) =>
      args.include === undefined ||
      (args.type === 'CLAS' && PINNED_CLASS_INCLUDE_NAMES.some((include) => include === args.include)),
  },
  ...['edit_class_definition', 'edit_method_signature', 'add_method', 'delete_method', 'change_method_visibility'].map(
    (action): PinnedMutationCapability => ({
      tool: 'SAPWrite',
      action,
      resource: 'repository-source',
      types: ['CLAS'],
      fields: [
        ...ownerFields,
        'transport',
        'expectedSourceHash',
        ...(['edit_class_definition', 'edit_method_signature'].includes(action) ? ['source'] : []),
        ...(action !== 'edit_class_definition' ? ['method'] : []),
        ...(['add_method', 'change_method_visibility'].includes(action) ? ['visibility'] : []),
        ...(action === 'add_method' ? ['abstract'] : []),
        ...(action === 'edit_class_definition' ? ['include'] : []),
      ],
      accepts: (args) =>
        args.include === undefined ||
        (action === 'edit_class_definition' &&
          args.type === 'CLAS' &&
          PINNED_CLASS_INCLUDE_NAMES.some((include) => include === args.include)),
    }),
  ),
  {
    tool: 'SAPActivate',
    action: 'activate',
    resource: 'whole-owner',
    types: PINNED_ACTIVATION_TYPES,
    fields: [...ownerFields, 'group', 'preaudit', 'objects'],
    accepts: acceptsPinnedActivation,
  },
  ...PINNED_MANAGEMENT_CAPABILITIES,
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
  ...PINNED_MANAGEMENT_COMPANIONS,
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
