import { collectionsFixtures } from '../../../scripts/qualification/pr1142/native-ddic-collections-fixtures.js';
import { ddicHarness } from './pr1142-native-ddic-harness.js';

// The shared harness registers every dispatcher mock before native modules initialize.
const { runNativeDdicCollections } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-collections-driver.js'
);

export {
  COLLECTIONS_PROTOCOL,
  COLLECTIONS_STAGES,
} from '../../../scripts/qualification/pr1142/native-ddic-collections-fixtures.js';
export const fixtures = collectionsFixtures('0123456789AB');
export function collectionsHarness(options: Parameters<typeof ddicHarness>[0] = {}) {
  return ddicHarness({ ...options, fixtures, execute: runNativeDdicCollections });
}
