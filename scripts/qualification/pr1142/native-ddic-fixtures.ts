/** Fixed two-owner local DDIC plan. Pure data; no native imports, configuration or execution. */
export const DDIC_PROTOCOL = 'pr1142-native-ddic-foundation-v1';
export const DDIC_NODE = 'v22.21.1';
export function ddicFixtures(suffix: string) {
  if (!/^[A-F0-9]{16}$/.test(suffix)) throw new Error('Fresh fixed DDIC suffix required.');
  const domain = `ZARC1_DM_${suffix}`,
    element = `ZARC1_DE_${suffix}`;
  return [
    {
      type: 'DOMA' as const,
      name: domain,
      owner: `/sap/bc/adt/ddic/domains/${domain}`,
      packageName: '$TMP',
      description: `ARC1 DDIC domain ${suffix}`,
      dependencies: [] as string[],
      create: {
        dataType: 'CHAR',
        length: '4',
        outputLength: '4',
        lowercase: true,
        signExists: false,
        fixedValues: [
          { low: 'A', description: 'First value' },
          { low: 'B', description: 'Second value' },
        ],
      },
      update: { description: `ARC1 DDIC updated ${suffix}` },
    },
    {
      type: 'DTEL' as const,
      name: element,
      owner: `/sap/bc/adt/ddic/dataelements/${element}`,
      packageName: '$TMP',
      description: `ARC1 DDIC element ${suffix}`,
      dependencies: [`/sap/bc/adt/ddic/domains/${domain}`],
      create: {
        domainName: domain,
        shortLabel: 'DDIC',
        mediumLabel: 'DDIC fixture',
        longLabel: 'DDIC foundation fixture',
        headingLabel: 'DDIC foundation',
        deactivateInputHistory: true,
        changeDocument: false,
      },
      update: { shortLabel: 'Changed' },
    },
  ];
}
export type DdicFixture = ReturnType<typeof ddicFixtures>[number];
export const DDIC_STAGES = [
  'create-DOMA',
  'activate-DOMA',
  'stale-DOMA',
  'update-DOMA',
  'reactivate-DOMA',
  'create-DTEL',
  'activate-DTEL',
  'stale-DTEL',
  'update-DTEL',
  'reactivate-DTEL',
  'delete-DTEL',
  'delete-DOMA',
] as const;
export type DdicStage = (typeof DDIC_STAGES)[number];
