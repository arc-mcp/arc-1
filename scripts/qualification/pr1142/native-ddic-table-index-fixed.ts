/** All three consumed prefixes remain closed; only index reactivation and reverse cleanup remain. */
import { TABLE_STAGES, tableFixtures } from './native-ddic-table-fixtures.js';
export const TABLE_INDEX_PROTOCOL = 'pr1142-native-ddic-table-index-tail-v1';
export const TABLE_INDEX_SUFFIX = 'EEE257AEFB75';
export const TABLE_INDEX_STAGES = TABLE_STAGES.slice(15);
export const TABLE_INDEX_RECEIPTS = {
  table: 'b794cbde5bd16db1c25d0390b652611939ef88423a1b0b7c0427fde8a3c614ab',
  settings: 'c9d3c03454d6137f009bbf58916dbfbbcd029ca4ad9a7d7af3484b2c20103e25',
  lock: '398de45a806614b73c56f2ff2feaa4f0cc38ba63cd162da0303aa8cbdab24148',
  indexNew: 'cd9c6e6b0943aa08b52fba069ea4deabd0f964e7dc9a3709eb66e2e129e5ccf3',
  indexActive: '381308254919f7ff7ef08092f41b5116e882fc7f3633f967371ffce02b9cc196',
  tableSource: 'a9b595f9d35811a62397d8d8ff4a846c8b77f531371451eae83665f43ab11a46',
  indexSource: 'c15c3af86fd798d9619cdbe529c2a9f0db921a8d95c16711c4ada6d83a126671',
  indexActiveSource: 'd55a830eebe152115997e708afa29a26481f0f065a75ef10ad725efd6c5b1d65',
} as const;
export function indexTailFixtures(suffix: string) {
  if (suffix !== TABLE_INDEX_SUFFIX) throw new Error('Exact retained index graph required.');
  return tableFixtures(suffix);
}
export const indexTailOwners = () => indexTailFixtures(TABLE_INDEX_SUFFIX).map((f) => f.owner);
