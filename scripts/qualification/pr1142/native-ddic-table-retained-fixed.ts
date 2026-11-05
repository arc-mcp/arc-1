/** One consumed table CREATE/source PUT; no name, stage or owner override. */
import { TABLE_STAGES, tableFixtures } from './native-ddic-table-fixtures.js';
export const TABLE_RETAINED_PROTOCOL = 'pr1142-native-ddic-table-retained-v1';
export const TABLE_RETAINED_SUFFIX = 'EEE257AEFB75';
export const TABLE_RETAINED_STAGES = TABLE_STAGES.slice(1);
export const TABLE_RETAINED_RECEIPTS = {
  metadata: 'b93681d5e5576145f4ecfa692c37b6c20487e51dced86bc0018a6ff0f0372331',
  settings: '97bb2c5266c0718dd8d689aca8cadd07136958b9673d49fced57ab7c2d68937c',
  source: 'a9b595f9d35811a62397d8d8ff4a846c8b77f531371451eae83665f43ab11a46',
  sourceBytes: 360,
} as const;
export function retainedTableFixtures(suffix: string) {
  if (suffix !== TABLE_RETAINED_SUFFIX) throw new Error('Exact retained table suffix required.');
  return tableFixtures(suffix);
}
export const retainedTableOwners = () =>
  retainedTableFixtures(TABLE_RETAINED_SUFFIX)
    .slice(0, 2)
    .map((f) => f.owner);
