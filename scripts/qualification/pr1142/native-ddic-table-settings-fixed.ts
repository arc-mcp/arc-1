/** Both consumed prefixes remain closed. Start only at the unattempted settings activation. */
import { TABLE_STAGES, tableFixtures } from './native-ddic-table-fixtures.js';
export const TABLE_SETTINGS_PROTOCOL = 'pr1142-native-ddic-table-settings-tail-v1';
export const TABLE_SETTINGS_SUFFIX = 'EEE257AEFB75';
export const TABLE_SETTINGS_STAGES = TABLE_STAGES.slice(5);
export const TABLE_SETTINGS_RECEIPTS = {
  tableActive: 'b794cbde5bd16db1c25d0390b652611939ef88423a1b0b7c0427fde8a3c614ab',
  tableInactive: '2e4cbd1d9e2d6d0c65a4050f56cf6b93bc9f6db6e345b607f6a34b1e039e2a96',
  settingsInactive: 'd2374f63b193e61d50d331cbe6d7922523827a16f3e7694e595ddd97f8470f57',
  settingsActive: '8f423e1edc6759fed9c8cc959691fd0d97d25a5ac99f330c6fef316f4cf9d96f',
  source: 'a9b595f9d35811a62397d8d8ff4a846c8b77f531371451eae83665f43ab11a46',
  sourceBytes: 360,
} as const;
export function settingsTailFixtures(suffix: string) {
  if (suffix !== TABLE_SETTINGS_SUFFIX) throw new Error('Exact retained table suffix required.');
  return tableFixtures(suffix);
}
export const settingsTailOwners = () =>
  settingsTailFixtures(TABLE_SETTINGS_SUFFIX)
    .slice(0, 2)
    .map((f) => f.owner);
