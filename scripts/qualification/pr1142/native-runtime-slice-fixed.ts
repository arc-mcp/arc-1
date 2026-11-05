/** Fixed Basic native-contract representatives; never a PP or public capability grant. */
import { nativeFlpConfig } from './native-flp-fixed.js';
export const RUNTIME_PROTOCOL = 'pr1142-native-runtime-flp-v1';
export const RUNTIME_SUFFIX = '8B71E0C2954FA36D';
export const RUNTIME_STAGES = ['formatter', 'quickfix', 'profiler', 'populated-flp', 'st05'] as const;
export type RuntimeStage = (typeof RUNTIME_STAGES)[number];
export const runtimeFixture = Object.freeze({
  className: `ZCL_RSF_${RUNTIME_SUFFIX}`,
  catalogId: `ZARC1_RC_${RUNTIME_SUFFIX}`,
  groupId: `ZARC1_RP_${RUNTIME_SUFFIX}`,
  title: `ARC1 owned runtime ${RUNTIME_SUFFIX}`,
  tileId: `ARC1_${RUNTIME_SUFFIX}`,
});
export const runtimeClassOwner = `/sap/bc/adt/oo/classes/${runtimeFixture.className.toLowerCase()}`;
export const runtimeStoredSource = `CLASS ${runtimeFixture.className} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS ${runtimeFixture.className} IMPLEMENTATION.
  METHOD run.
    DATA lv_existing TYPE i.
    lv_existing = 1.
  ENDMETHOD.
ENDCLASS.`;
export const runtimeUnsavedSource = runtimeStoredSource.replace('lv_existing = 1.', 'lv_missing = 1.');
export const runtimeProposal =
  '/sap/bc/adt/quickfixes/proposals/providers/refactoring/quickfixes/declare_local_variable';
export const runtimeConfig = () => ({
  ...nativeFlpConfig(),
  allowedPackages: ['$TMP'],
  multiTargetWrite: {
    ...nativeFlpConfig().multiTargetWrite,
    allowedPackages: ['$TMP'],
  },
});
export class RuntimeFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'RuntimeFailure';
  }
}
export const runtimeReason = (error: unknown) => (error instanceof RuntimeFailure ? error.reason : 'unclassified');
