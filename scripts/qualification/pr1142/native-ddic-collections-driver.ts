/** Three fixed representative owners; public DDIC admission and PP remain separate. */
import { REQUESTED_PATHS } from "../../../src/adt/pinned-ddic-owner.js";
import { collectionsSnapshot } from './native-ddic-collections-evidence.js';
import {
  COLLECTIONS_STAGES,
  type CollectionsFixture,
  collectionsFixtures,
} from './native-ddic-collections-fixtures.js';
import { checkCollectionsRequest, collectionsResponseCap } from './native-ddic-collections-transport.js';
import { ddicAbsence } from './native-ddic-evidence.js';
import { ddicUnlock } from './native-ddic-transport.js';
import { type DdicWorkflowInput, runFixedDdicWorkflow } from './native-ddic-workflow.js';
export async function runNativeDdicCollections(input: DdicWorkflowInput<CollectionsFixture>) {
  if (
    input.fixtures.length !== 3 ||
    JSON.stringify(input.fixtures) !== JSON.stringify(collectionsFixtures(input.fixtures[0].name.slice(-12)))
  )
    throw new Error('The exact fixed collections graph is required.');
  return runFixedDdicWorkflow(input, {
    stages: COLLECTIONS_STAGES,
    attemptLimit: 384,
    wrapHttp: collectionsResponseCap,
    snapshot: collectionsSnapshot,
    absence: (c, f, r, o, u) => ddicAbsence(c, f, r, o, u, (owner) => owner.name.slice(-12)),
    check: checkCollectionsRequest,
    unlock: ddicUnlock,
    source: (f) => f.type === 'TABL/DS',
    postCreateCleanup: () => true,
    changedPaths: (f) =>
      f.type === 'TTYP' ? REQUESTED_PATHS.TTYP.rowType : f.type === 'MSAG' ? REQUESTED_PATHS.MSAG.messages : [],
  });
}
