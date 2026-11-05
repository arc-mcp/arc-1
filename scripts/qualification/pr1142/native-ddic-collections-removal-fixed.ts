/** Fixed follow-up to the acknowledged omission-only MSAG save; never repeat an old stage/claim. */

import type { CollectionsRetainedReceipts } from './native-ddic-collections-retained-evidence.js';
import {
  COLLECTIONS_RETAINED_RECEIPTS,
  COLLECTIONS_RETAINED_SUFFIX,
  collectionsRetainedFixtures,
} from './native-ddic-collections-retained-fixed.js';
export const COLLECTIONS_REMOVAL = 'pr1142-native-ddic-collections-removal-v1';
export const COLLECTIONS_REMOVAL_SUFFIX = COLLECTIONS_RETAINED_SUFFIX;
export const COLLECTIONS_REMOVAL_STAGES = ['update-MSAG', 'delete-MSAG', 'delete-TTYP', 'delete-TABL/DS'] as const;
export function collectionsRemovalFixtures(suffix: string) {
  return collectionsRetainedFixtures(suffix).map((f) =>
    f.type !== 'MSAG'
      ? f
      : {
          ...f,
          // This is the compiled initial observed state, never a create permission or a fresh-state adoption.
          create: {
            ...f.create,
            messages: [f.update.messages[0], f.create.messages[1], f.create.messages[2], f.update.messages[2]],
          },
        },
  );
}
export const COLLECTIONS_REMOVAL_RECEIPTS: CollectionsRetainedReceipts = {
  ...COLLECTIONS_RETAINED_RECEIPTS,
  MSAG: {
    hash: '91ade91890b84f0430e6bfe1ae5388e4dd92547191c9562977e0b866c6d049f5',
    canonical: '638812c1e128d69ce24b3579f7225a82df5d0b923a58dcbf7c47398691ccb1bc',
  },
};
// Byte-identical private copies of the three nonsecret files from this issued audit; originals stay unchanged.
export const COLLECTIONS_REMOVAL_AUDIT_ORIGIN = 'arc1-review/pr1142-ddic-retained-execution-audit1';
export const COLLECTIONS_REMOVAL_AUDIT_COPY = 'arc1-review/pr1142-ddic-removal-history1';
export const COLLECTIONS_REMOVAL_HISTORY = {
  audit: 'a098c9a5593e7ba08030f07d3df2636cbf804542ddf81ae1378246a7ce66e7ee',
  report: '1e1f8e46e2608fdd097e6c3cae24c9fd43f5b75a0999339adbdd68db01d7cdde',
  ledger: '127108516e82f35f5b9e4b7bae74598119d2f4ecc9458ebcedb7c444e1f3eb4d',
  intent: '0fc07f3eef7ea13d62b097142935480aed70ef0c9ac964281243b4c75ca5a021',
  result: 'e85321fd98d952e9480737901f37902f747dd0a9d927651d2e5e65a14740abb1',
};
