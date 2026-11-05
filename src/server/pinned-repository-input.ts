/** Pure action/type/field contract. Native adapters independently prove owners and enforce their limits. */
import { PINNED_METADATA_INPUTS } from '../adt/pinned-ddic-owner.js';
import { SDO_TYPES } from '../adt/server-driven.js';

export const PINNED_DECLARATIVE_TYPES = ['DDLS', 'DCLS', 'DDLX', 'BDEF', 'SRVD'] as const;
export const PINNED_DDIC_TYPES = [
  ...new Set([
    'DOMA',
    'DTEL',
    'TTYP',
    'MSAG',
    'ENQU',
    'TABL',
    'TABL/DT',
    'TABL/DS',
    'TABL/DTT',
    'TABL/DTI',
    ...SDO_TYPES,
  ]),
];
export const PINNED_REPOSITORY_TYPES = [
  'CLAS',
  'INTF',
  'PROG',
  'INCL',
  'FUNC',
  'FUGR',
  ...PINNED_DECLARATIVE_TYPES,
  ...PINNED_DDIC_TYPES,
  'ENHO',
  'SKTD',
  'SRVB',
];
const common = ['action', 'type', 'name', 'transport'];
const binding = ['description', 'serviceDefinition', 'odataVersion', 'category', 'version'];
const classIncludes = ['definitions', 'implementations', 'macros', 'testclasses'];

export function pinnedRepositoryFields(args: Record<string, unknown>): readonly string[] | undefined {
  const type = String(args.type),
    action = String(args.action);
  if (!PINNED_REPOSITORY_TYPES.includes(type) || !['create', 'update', 'delete'].includes(action)) return;
  const creating = action === 'create',
    deleting = action === 'delete';
  if (type === 'TABL/DTT' && action !== 'update') return;
  if (type === 'FUGR' && action === 'update') return;
  if (deleting) return [...common, ...(['FUNC', 'INCL'].includes(type) ? ['group'] : [])];
  if (type === 'SRVB') return [...common, ...binding, creating ? 'package' : 'expectedMetadataHash'];
  if (type === 'ENHO' || type === 'SKTD')
    return [
      ...common,
      'source',
      ...(type === 'ENHO' ? ['description'] : ['shortTexts']),
      ...(creating
        ? ['package', ...(type === 'SKTD' ? ['refObjectType', 'refObjectName', 'refObjectDescription'] : [])]
        : ['expectedMetadataHash', ...(type === 'SKTD' ? ['dryRun'] : [])]),
    ];
  if (type === 'TABL/DTT') return [...common, 'source', 'expectedMetadataHash'];
  if (Object.hasOwn(PINNED_METADATA_INPUTS, type))
    return [...common, 'description', ...PINNED_METADATA_INPUTS[type]!, creating ? 'package' : 'expectedMetadataHash'];
  return [
    ...common,
    'source',
    ...(creating ? ['package', 'description'] : ['expectedSourceHash']),
    ...(['INCL', 'FUNC'].includes(type) ? ['group'] : []),
    ...(type === 'FUNC' ? ['parameters', ...(creating ? ['processingType', 'updateTaskKind'] : [])] : []),
    ...(!creating && type === 'CLAS' ? ['include'] : []),
  ];
}

export const PINNED_REPOSITORY_FIELDS = [
  ...new Set(
    PINNED_REPOSITORY_TYPES.flatMap((type) =>
      ['create', 'update', 'delete'].flatMap((action) => pinnedRepositoryFields({ type, action }) ?? []),
    ),
  ),
];

export function acceptsPinnedRepository(args: Record<string, unknown>): boolean {
  const fields = pinnedRepositoryFields(args);
  return (
    !!fields &&
    Object.entries(args).every(([key, value]) => value === undefined || fields.includes(key)) &&
    (args.include === undefined || classIncludes.includes(String(args.include))) &&
    (args.expectedMetadataHash === undefined ||
      (typeof args.expectedMetadataHash === 'string' && /^[a-f0-9]{64}$/.test(args.expectedMetadataHash)))
  );
}

/** The existing batch implementation deliberately refuses these combinations; no schema may promise them. */
export const PINNED_BATCH_CREATE_TYPES = PINNED_REPOSITORY_TYPES.filter(
  (type) => !['FUGR', 'ENHO', 'SKTD', 'TABL/DTT', ...SDO_TYPES].includes(type),
);
export const PINNED_ACTIVATION_TYPES = PINNED_REPOSITORY_TYPES.filter((type) => !['APLO', 'UIAD'].includes(type));
export function acceptsPinnedActivation(args: Record<string, unknown>): boolean {
  if (args.preaudit !== undefined && args.preaudit !== true) return false;
  if (args.objects !== undefined) {
    return (
      args.type === undefined &&
      args.name === undefined &&
      args.group === undefined &&
      Array.isArray(args.objects) &&
      args.objects.length > 0 &&
      args.objects.length <= 10 &&
      args.objects.every((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const item = value as Record<string, unknown>;
        return (
          Object.keys(item).every((key) => ['type', 'name', 'group'].includes(key)) &&
          PINNED_ACTIVATION_TYPES.includes(String(item.type)) &&
          !['FUGR', 'ENHO', 'SKTD'].includes(String(item.type)) &&
          (item.group === undefined || item.type === 'FUNC')
        );
      })
    );
  }
  return (
    PINNED_ACTIVATION_TYPES.includes(String(args.type)) &&
    (args.group === undefined || ['FUNC', 'INCL'].includes(String(args.type)))
  );
}

export function acceptsPinnedBatchCreate(args: Record<string, unknown>): boolean {
  return (
    Array.isArray(args.objects) &&
    args.objects.length > 0 &&
    args.objects.length <= 10 &&
    args.objects.every((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const item = value as Record<string, unknown>;
      return (
        PINNED_BATCH_CREATE_TYPES.includes(String(item.type)) &&
        (item.group === undefined || item.type === 'FUNC') &&
        acceptsPinnedRepository({ ...item, action: 'create' })
      );
    })
  );
}
