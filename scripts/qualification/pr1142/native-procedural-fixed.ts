/** Fixed disposable function graph; native Basic evidence is never PP qualification. */
import type { FmParameter } from '../../../src/adt/fm-signature.js';
import { pinnedFunctionSelection } from "../../../src/adt/pinned-repository-owner.js";
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

export const PROCEDURAL_PROTOCOL = 'pr1142-native-procedural-text-v1';
export const PROCEDURAL_SUFFIX = '6D7A93E20B45C18F';
export const GROUP = `ZARC1_PT_${PROCEDURAL_SUFFIX}`;
export const MODULE = `ZARC1_PM_${PROCEDURAL_SUFFIX}`;
export const INCLUDE = `L${GROUP}F01`;
export const MARKER = `ARC1 procedural ${PROCEDURAL_SUFFIX}`;
export const selected = {
  FUGR: pinnedFunctionSelection('FUGR', GROUP),
  FUNC: pinnedFunctionSelection('FUNC', MODULE, GROUP),
  INCL: pinnedFunctionSelection('INCL', INCLUDE, GROUP),
};
export const POOL = `/sap/bc/adt/textelements/functiongroups/${GROUP}`;
export const owners = [selected.FUGR.objectUrl, selected.FUNC.objectUrl, selected.INCL.objectUrl];
export const initialParameters: FmParameter[] = [
  { kind: 'importing', name: 'IV_TEXT', type: 'STRING', byValue: true, default: "'MiXeD'" },
];
export const updatedParameters: FmParameter[] = [
  ...initialParameters,
  { kind: 'importing', name: 'IV_COUNT', type: 'I', byValue: true, optional: true },
];
export const MODULE_SOURCE = `FUNCTION ${MODULE}.\n  DATA(lv_text) = iv_text.\n  " ${MARKER}\nENDFUNCTION.\n`;
export const PRESERVED_FORM = `FORM preserved.\n  DATA lv_value TYPE i.\n  lv_value = 1.\nENDFORM.`;
export const EDITED_FORM = `FORM changed.\n  DATA lv_value TYPE i.\n  lv_value = 3.\nENDFORM.`;
export const ADDED_FORM = `FORM added.\n  DATA lv_value TYPE i.\n  lv_value = 4.\nENDFORM.`;
export const INCLUDE_SOURCE = `* ${MARKER}\n${PRESERVED_FORM}\n\nFORM changed.\n  DATA lv_value TYPE i.\n  lv_value = 2.\nENDFORM.\n`;
export const TEXTS = {
  symbols: `@MaxLength:60\n001=${MARKER}\n`,
  selections: '',
  headings: `listHeader=${MARKER}\n`,
};
export const STAGES = [
  'preflight',
  'group-create',
  'group-generate',
  'module-create',
  'module-activate',
  'module-stale-hash',
  'module-signature',
  'include-create',
  'include-edit',
  'include-add',
  'include-activate',
  'empty-symbols',
  'text-headings',
  'text-symbols',
  'text-selections',
  'clear-symbols',
  'module-final-activate',
  'include-delete',
  'module-delete',
  'group-delete',
  'final',
] as const;
export type ProceduralStage = (typeof STAGES)[number];
export const proceduralConfig = () => ({
  ...DEFAULT_CONFIG,
  client: '001',
  targetId: 'A4H/001',
  systemType: 'onprem' as const,
  abapRelease: '758',
  allowWrites: true,
  allowedPackages: ['$TMP'],
  lintBeforeWrite: false,
  checkBeforeWrite: false,
  minimalErrors: true,
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: [] as string[],
    serverAllowedTransports: [] as string[],
  },
});
export class ProceduralFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ProceduralFailure';
  }
}

export const proceduralFailure = (error: unknown) =>
  error instanceof ProceduralFailure ? error.reason : 'native-or-evidence-refusal';
