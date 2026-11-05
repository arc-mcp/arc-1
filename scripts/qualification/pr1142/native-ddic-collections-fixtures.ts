/** Fixed representative metadata graph; 16-character DDIC names share a fresh 48-bit suffix. */
export const COLLECTIONS_PROTOCOL = 'pr1142-native-ddic-collections-v1';
export function collectionsFixtures(suffix: string) {
  if (!/^[A-F0-9]{12}$/.test(suffix)) throw new Error('Fresh fixed collections suffix required.');
  const structure = `ZSCC${suffix}`,
    tableType = `ZTCC${suffix}`,
    messages = `ZMCC${suffix}`;
  const source = (length: number) => `@EndUserText.label : 'ARC1 collections ${suffix}'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
define structure ${structure.toLowerCase()} {
  entry_code : abap.char(4);
  entry_text : abap.char(${length});
}
`;
  return [
    {
      type: 'TABL/DS' as const,
      name: structure,
      owner: `/sap/bc/adt/ddic/structures/${structure}`,
      packageName: '$TMP',
      description: `ARC1 collections ${suffix}`,
      dependencies: [] as string[],
      create: { source: source(20) },
      update: { source: source(30) },
    },
    {
      type: 'TTYP' as const,
      name: tableType,
      owner: `/sap/bc/adt/ddic/tabletypes/${tableType}`,
      packageName: '$TMP',
      description: `ARC1 table type ${suffix}`,
      dependencies: [`/sap/bc/adt/ddic/structures/${structure}`],
      create: { rowType: 'CHAR', rowTypeKind: 'builtin', rowTypeLength: '4' },
      update: { rowType: structure, rowTypeKind: 'structure' },
    },
    {
      type: 'MSAG' as const,
      name: messages,
      owner: `/sap/bc/adt/messageclass/${messages}`,
      packageName: '$TMP',
      description: `ARC1 messages ${suffix}`,
      dependencies: [] as string[],
      create: {
        messages: [
          { number: '001', shortText: 'Original collection &1' },
          { number: '002', shortText: 'Preserved message' },
          { number: '003', shortText: 'Removed message' },
        ],
      },
      update: {
        messages: [
          { number: '001', shortText: 'Updated collection &1' },
          { number: '002', shortText: 'Preserved message' },
          { number: '004', shortText: 'Added message' },
        ],
      },
    },
  ];
}
export type CollectionsFixture = ReturnType<typeof collectionsFixtures>[number];
export const COLLECTIONS_STAGES = [
  'create-TABL/DS',
  'activate-TABL/DS',
  'stale-TABL/DS',
  'update-TABL/DS',
  'reactivate-TABL/DS',
  'create-TTYP',
  'activate-TTYP',
  'stale-TTYP',
  'update-TTYP',
  'reactivate-TTYP',
  'create-MSAG',
  'activate-MSAG',
  'update-MSAG',
  'reactivate-MSAG',
  'delete-MSAG',
  'delete-TTYP',
  'delete-TABL/DS',
] as const;
