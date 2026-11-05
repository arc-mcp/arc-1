/** One retained owner only. Empty source payloads carry no create/update authority. */
import { collectionsFixtures } from './native-ddic-collections-fixtures.js';
export const STRUCTURE_CLEANUP = 'pr1142-native-ddic-structure-cleanup-v1';
export const STRUCTURE_SUFFIX = '0B9644EAD7A6';
export const STRUCTURE_RECEIPT = Object.freeze({
  sourceHash: 'd43f070a565b803b577110c004c64a1cc10e77bfed5714b103dc04b319208ce4',
  sourceBytes: 203,
  nativeVersion: 'new',
  metadataCanonicalHash: '58870ac3ac091641811982131fd4e6269e8eb3962ce967ba55182d461667d854',
  metadataRawHash: 'cc6696dc72c0130c10bb36207764e83b061737c5a404183fe2413de4986a7be3',
});
export function structureCleanupFixtures(suffix: string) {
  if (suffix !== STRUCTURE_SUFFIX) throw new Error('Only the exact retained structure is admitted.');
  const structure = collectionsFixtures(suffix).find((fixture) => fixture.type === 'TABL/DS');
  if (!structure) throw new Error('Fixed structure definition missing.');
  return [
    {
      ...structure,
      create: { source: '' },
      update: { source: '' },
      retainedReceipt: STRUCTURE_RECEIPT,
    },
  ];
}
export type StructureCleanupFixture = ReturnType<typeof structureCleanupFixtures>[number];
export const structureCleanupStages = ['delete-TABL/DS'] as const;
export const STRUCTURE_HISTORY = Object.freeze({
  audit: '51dd955f9098f9ed04549d0941c393eb1ecabaa572b426afb2709ac4640b0e42',
  ledger: '0b1001d5ba246bf1178ee1a331b4f476ff71b6796a1cb9991f5e3078a3143a10',
  intent: '14cf1b6c681bc14a734dd11c7c36964719b5c6c6cd1d2afdfd3d983273820618',
  result: '69ee03b39d67b22ff71d6e43c8a0e744e05b8586943429bc878fb308680961b5',
});
