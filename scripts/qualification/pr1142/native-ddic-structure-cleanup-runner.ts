/** Cleanup-only compiled profile over the existing native client, production DDIC delete and owning lifecycle. */
import type { AdtClient } from '../../../src/adt/client.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { checkCollectionsRequest } from './native-ddic-collections-transport.js';
import { ddicAbsence } from './native-ddic-evidence.js';
import { ddicClient, ddicRuntime } from './native-ddic-runner.js';
import { structureCleanupSnapshot } from './native-ddic-structure-cleanup-evidence.js';
import {
  STRUCTURE_SUFFIX,
  type StructureCleanupFixture,
  structureCleanupFixtures,
  structureCleanupStages,
} from './native-ddic-structure-cleanup-fixed.js';
import { ddicBoundHttp, ddicUnlock } from './native-ddic-transport.js';
import { type DdicWorkflowInput, runFixedDdicWorkflow } from './native-ddic-workflow.js';
import { declarativeInventoryClean } from './native-declarative-evidence.js';
import { observeNativeHttp } from './native-observed-http.js';

export { ddicClient };

const requireGraph = (fixtures: readonly StructureCleanupFixture[]) => {
  if (JSON.stringify(fixtures) !== JSON.stringify(structureCleanupFixtures(STRUCTURE_SUFFIX)))
    throw new Error('Exact retained structure graph required.');
};
export function checkStructureCleanupRequest(
  fixtures: readonly StructureCleanupFixture[],
  selected: StructureCleanupFixture | undefined,
  stage: string | undefined,
  method: string,
  path: string,
  body?: string,
) {
  requireGraph(fixtures);
  if (stage !== undefined && stage !== 'delete-TABL/DS') throw new Error('Only fixed cleanup is admitted.');
  if (method === 'PUT' || (!['GET', 'HEAD'].includes(method) && stage !== 'delete-TABL/DS'))
    throw new Error('No create/update/activation is admitted.');
  checkCollectionsRequest(fixtures, selected, stage, method, path, body);
  if (method === 'POST' && path === '/sap/bc/adt/cts/transportchecks') {
    const expected = `<a:abap xmlns:a="http://www.sap.com/abapxml" version="1.0"><a:values><DATA><DEVCLASS>$TMP</DEVCLASS><URI>${fixtures[0].owner}</URI><OPERATION></OPERATION></DATA></a:values></a:abap>`;
    const canonical = (xml: string) =>
      JSON.stringify(nativeXmlRoot(xml, 'abap', 'http://www.sap.com/abapxml').canonicalValue({}));
    if (canonical(body ?? '') !== canonical(expected))
      throw new Error('Only existing-owner CTS inspection is admitted.');
  } else if (!['GET', 'HEAD'].includes(method) && body) throw new Error('Cleanup lock/delete requests have no body.');
}
export async function runStructureCleanup(input: DdicWorkflowInput<StructureCleanupFixture>) {
  requireGraph(input.fixtures);
  return runFixedDdicWorkflow(
    { ...input, freshUntil: Math.min(input.freshUntil, Date.now() + 90_000) },
    {
      retained: true,
      stages: structureCleanupStages,
      snapshot: structureCleanupSnapshot,
      check: checkStructureCleanupRequest,
      unlock: ddicUnlock,
      absence: (c, f, r, o, u) => ddicAbsence(c, f, r, o, u, () => STRUCTURE_SUFFIX),
      source: () => true,
      postCreateCleanup: () => true,
      changedPaths: () => [],
    },
  );
}
export const structureCleanupRuntime = { ...ddicRuntime, execute: runStructureCleanup };
export async function structureCleanupPreflight(
  base: AdtClient,
  fixtures: readonly StructureCleanupFixture[],
  record: (row: unknown) => void,
  verify: () => void,
) {
  requireGraph(fixtures);
  const deadline = Date.now() + 60_000,
    assert = () => {
      verify();
      if (Date.now() >= deadline) throw new Error('Cleanup preflight expired.');
    };
  const http = observeNativeHttp(
    ddicBoundHttp(base.http, { deadline, assert, unlock: () => false }),
    (m, p, b) => {
      if (m !== 'GET') throw new Error('GET-only cleanup preflight.');
      checkStructureCleanupRequest(fixtures, undefined, undefined, m, p, b);
      assert();
    },
    (v) => {
      const row = v as { path?: string; body?: unknown };
      const { body, ...safe } = row;
      record(row.path === '/sap/bc/adt/activation/inactiveobjects' ? safe : row);
    },
    async () => {
      throw new Error('GET-only cleanup preflight.');
    },
  );
  const client = Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
  const options = { deadline, noReplay: true, retryTransientErrors: false };
  await structureCleanupSnapshot(client, fixtures[0], false, false, record, options);
  // Valid syntax only: this owner is retained, so no preflight absence or clean-suffix claim is made.
  await declarativeInventoryClean(http, [], record, options);
  assert();
  record({ inventoryScope: 'valid-unfiltered', retainedOwner: fixtures[0].owner });
}
