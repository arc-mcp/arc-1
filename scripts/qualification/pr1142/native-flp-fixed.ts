import { DEFAULT_CONFIG } from '../../../src/server/types.js';
/** Fixed qualification scope, not tool input or a production capability grant. */
export const FLP_PROTOCOL = 'pr1142-native-flp-cust-v1';
export const FLP_SUFFIX = '3D5C96A8170F42BE';
export const FLP_ORIGIN = 'https://a4h.marianzeis.de';
export const FLP_SERVICE = '/sap/opu/odata/UI2/PAGE_BUILDER_CUST';
export type FlpStage = 'page' | 'catalog';
export const flpFixtures = {
  page: { stage: 'page', id: `ZARC1_FLP_P_${FLP_SUFFIX}`, title: `ARC1 owned empty Page ${FLP_SUFFIX}` },
  catalog: { stage: 'catalog', id: `ZARC1_FLP_C_${FLP_SUFFIX}`, title: `ARC1 owned empty catalog ${FLP_SUFFIX}` },
} as const;
export const flpKey = (stage: FlpStage) =>
  stage === 'page' ? flpFixtures.page.id : `X-SAP-UI2-CATALOGPAGE:${flpFixtures.catalog.id}`;
export const flpOwner = (stage: FlpStage) =>
  `${FLP_SERVICE}/${stage === 'page' ? 'Pages' : 'Catalogs'}('${encodeURIComponent(flpKey(stage))}')`;
export const flpPage = (stage: FlpStage) => `${FLP_SERVICE}/Pages('${encodeURIComponent(flpKey(stage))}')`;
export const flpCreateInput = (stage: FlpStage) =>
  stage === 'page'
    ? { action: 'flp_create_group', groupId: flpFixtures.page.id, title: flpFixtures.page.title }
    : { action: 'flp_create_catalog', domainId: flpFixtures.catalog.id, title: flpFixtures.catalog.title };
export const flpPayload = (stage: FlpStage) =>
  JSON.stringify(
    stage === 'page'
      ? { id: flpFixtures.page.id, title: flpFixtures.page.title, catalogId: '/UI2/FLPD_CATALOG', layout: '' }
      : { domainId: flpFixtures.catalog.id, title: flpFixtures.catalog.title, type: 'CATALOG_PAGE' },
  );
export class FlpQualificationFailure extends Error {
  constructor(
    readonly reason:
      | 'binding'
      | 'runtime'
      | 'intent'
      | 'baseline'
      | 'prior-stage'
      | 'configuration'
      | 'stopped'
      | 'scope'
      | 'metadata'
      | 'create-response'
      | 'create-unconfirmed'
      | 'owner'
      | 'drift'
      | 'nonempty'
      | 'delete-response'
      | 'lookup'
      | 'session-cleanup'
      | 'claimed'
      | 'unclassified',
  ) {
    super(reason);
    this.name = 'FlpQualificationFailure';
  }
}
export const flpFailure = (error: unknown) =>
  error instanceof FlpQualificationFailure ? error.reason : 'unclassified';
export function nativeFlpConfig() {
  return {
    ...DEFAULT_CONFIG,
    client: '001',
    targetId: 'A4H/001',
    systemType: 'onprem' as const,
    abapRelease: '758',
    allowWrites: true,
    ppEnabled: true,
    ppStrict: true,
    multiTargetEndpoints: true,
    minimalErrors: true,
    multiTargetWrite: {
      enabled: true,
      target: 'A4H/001',
      allowedPackages: [] as string[],
      allowedTransports: ['*'],
      serverAllowedTransports: ['*'],
    },
  };
}
