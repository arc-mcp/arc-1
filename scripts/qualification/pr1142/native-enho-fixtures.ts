/** Fixed owned stub + disabled BAdI; standard spot/interface remain read-only dependencies. */
import type { DdicWorkflowFixture } from './native-ddic-workflow.js';
export const ENHO_PROTOCOL = 'pr1142-native-enhancement-owned-stub-v1';
export const ENHO_SPOT = 'SADT_REST_RFC_APPLICATION';
export const ENHO_BADI = 'BADI_ADT_DISCOVERY_PROVIDER';
export const ENHO_INTERFACE = 'IF_ADT_DISCOVERY_PROVIDER';
export const ENHO_SPOT_URI = '/sap/bc/adt/enhancements/enhsxsb/sadt_rest_rfc_application';
export const ENHO_INTERFACE_URI = '/sap/bc/adt/oo/interfaces/if_adt_discovery_provider';
export interface EnhoFixture extends DdicWorkflowFixture {
  type: 'CLAS' | 'ENHO';
  create: { source: string };
  update: { source?: string; description?: string };
}
export function enhoFixtures(suffix: string): EnhoFixture[] {
  if (!/^[A-F0-9]{12}$/.test(suffix)) throw new Error('Fixed fresh enhancement suffix required.');
  const cls = `ZCL_EH_${suffix}`,
    enho = `ZARC1_EH_${suffix}`,
    impl = `ZARC1_BI_${suffix}`;
  const description = `ARC1 owned ENHO ${suffix}`;
  const entry = {
    name: impl,
    badiDefinition: ENHO_BADI,
    implementingClass: cls,
    shortText: `Owned disabled ${suffix}`,
    active: false,
    default: false,
  };
  const source = `CLASS ${cls.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n    INTERFACES if_adt_discovery_provider.\nENDCLASS.\n\nCLASS ${cls.toLowerCase()} IMPLEMENTATION.\n  METHOD if_adt_discovery_provider~register_workspaces.\n  ENDMETHOD.\nENDCLASS.`;
  return [
    {
      type: 'CLAS',
      name: cls,
      owner: `/sap/bc/adt/oo/classes/${cls.toLowerCase()}`,
      packageName: '$TMP',
      description: `ARC1 owned stub ${suffix}`,
      dependencies: [],
      create: { source },
      update: {},
    },
    {
      type: 'ENHO',
      name: enho,
      owner: `/sap/bc/adt/enhancements/enhoxhb/${enho.toLowerCase()}`,
      packageName: '$TMP',
      description,
      dependencies: [`/sap/bc/adt/oo/classes/${cls.toLowerCase()}`],
      create: {
        source: JSON.stringify({
          enhancementSpot: ENHO_SPOT,
          badiImplementations: [{ ...entry, filter: `URI = '/arc1/qualification/${suffix.toLowerCase()}'` }],
        }),
      },
      update: {
        description: `${description} updated`,
        source: JSON.stringify({ badiImplementations: [{ ...entry, shortText: `Updated disabled ${suffix}` }] }),
      },
    },
  ];
}
export const ENHO_STAGES = [
  'create-CLAS',
  'activate-CLAS',
  'create-ENHO',
  'activate-ENHO',
  'stale-ENHO',
  'update-ENHO',
  'reactivate-ENHO',
  'delete-ENHO',
  'delete-CLAS',
] as const;
