/** Reuse the fixed retained engine; only the compiled initial state/stage ledger differs. */
import type { CollectionsFixture } from './native-ddic-collections-fixtures.js';
import {
  COLLECTIONS_REMOVAL_RECEIPTS,
  COLLECTIONS_REMOVAL_STAGES,
  COLLECTIONS_REMOVAL_SUFFIX,
  collectionsRemovalFixtures,
} from './native-ddic-collections-removal-fixed.js';
import { collectionsRetainedSnapshot } from './native-ddic-collections-retained-evidence.js';
import {
  type CollectionsRetainedContract,
  checkCollectionsRetainedRequest,
  collectionsRetainedPreflight,
  runCollectionsRetained,
} from './native-ddic-collections-retained-runner.js';
import { ddicRuntime } from './native-ddic-runner.js';
import type { DdicWorkflowInput } from './native-ddic-workflow.js';

export { ddicClient } from './native-ddic-runner.js';

const contract: CollectionsRetainedContract = Object.freeze({
  fixtures: () => collectionsRemovalFixtures(COLLECTIONS_REMOVAL_SUFFIX),
  suffix: COLLECTIONS_REMOVAL_SUFFIX,
  stages: COLLECTIONS_REMOVAL_STAGES,
  snapshot: (...[client, fixture, updated, active, record, options]: Parameters<typeof collectionsRetainedSnapshot>) =>
    collectionsRetainedSnapshot(client, fixture, updated, active, record, options, COLLECTIONS_REMOVAL_RECEIPTS),
});
export const runCollectionsRemoval = (input: DdicWorkflowInput<CollectionsFixture>) =>
  runCollectionsRetained(input, contract);
export const collectionsRemovalRuntime = { ...ddicRuntime, execute: runCollectionsRemoval };
export const collectionsRemovalPreflight = (
  base: Parameters<typeof collectionsRetainedPreflight>[0],
  fixtures: readonly CollectionsFixture[],
  record: (v: unknown) => void,
  verify: () => void,
) => collectionsRetainedPreflight(base, fixtures, record, verify, contract);
export const checkCollectionsRemovalRequest = (
  fixtures: readonly CollectionsFixture[],
  selected: CollectionsFixture | undefined,
  stage: string | undefined,
  method: string,
  path: string,
  body?: string,
) => checkCollectionsRetainedRequest(fixtures, selected, stage, method, path, body, contract);
