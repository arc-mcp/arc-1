/** Fixed local table/settings/lock/index graph over the shared production DDIC lifecycle. */

import type { AdtClient } from '../../../src/adt/client.js';
import { fetchDiscoveryDocument, resolveAcceptType } from '../../../src/adt/discovery.js';
import { ENQU_SOURCE_PATHS } from "../../../src/adt/pinned-ddic-owner.js";
import { assertOnlyRequestedChanges, differingFields } from '../../../src/adt/pinned-metadata-projection.js';
import { collectionsResponseCap } from './native-ddic-collections-transport.js';
import { ddicAbsence, ddicHash } from './native-ddic-evidence.js';
import { tableSnapshot } from './native-ddic-table-evidence.js';
import { TABLE_STAGES, type TableFixture, tableFixtures } from './native-ddic-table-fixtures.js';
import { checkTableRequest } from './native-ddic-table-transport.js';
import { ddicUnlock } from './native-ddic-transport.js';
import { type DdicWorkflowInput, type DdicWorkflowProfile, runFixedDdicWorkflow } from './native-ddic-workflow.js';
export async function tableCapabilities(client: AdtClient) {
  const { map } = await fetchDiscoveryDocument(client.http);
  for (const [path, marker] of [
    ['/sap/bc/adt/ddic/db/settings', 'table.settings'],
    ['/sap/bc/adt/ddic/db/indexes', 'blues'],
    ['/sap/bc/adt/ddic/lockobjects/sources', 'lockobjects'],
    ['/sap/bc/adt/deletion/check', 'application/vnd.sap.adt.deletion.check.request.v1+xml'],
  ])
    if (!(resolveAcceptType(map, path) ?? '').includes(marker))
      throw new Error('Table graph native capability unqualified.');
  client.http.setDiscoveryMap(map);
}
export async function runNativeTableGraph(input: DdicWorkflowInput<TableFixture>) {
  if (
    input.fixtures.length !== 4 ||
    JSON.stringify(input.fixtures) !== JSON.stringify(tableFixtures(input.fixtures[0].name.slice(-12)))
  )
    throw new Error('The exact closed table graph is required.');
  return runFixedDdicWorkflow(tableObservedInput(input), tableWorkflowProfile(input));
}
/** Shared compiled table profiles preserve the same secret-safe observer and lifecycle. */
export function tableObservedInput(input: DdicWorkflowInput<TableFixture>): DdicWorkflowInput<TableFixture> {
  return {
    ...input,
    record: (row) => {
      const v = row as { path?: string; body?: string };
      if (v.path === '/sap/bc/adt/deletion/check' && typeof v.body === 'string') {
        const { body, ...safe } = v;
        input.record({ ...safe, bytes: Buffer.byteLength(body), sha256: ddicHash(body) });
      } else input.record(row);
    },
  };
}
export function tableWorkflowProfile(input: DdicWorkflowInput<TableFixture>): DdicWorkflowProfile<TableFixture> {
  return {
    prepare: tableCapabilities,
    stages: TABLE_STAGES,
    attemptLimit: 640,
    wrapHttp: collectionsResponseCap,
    implicitParent: (f) => (f.type === 'TABL/DTT' ? input.fixtures[0].owner : undefined),
    guardDependencies: true,
    snapshot: tableSnapshot,
    absence: (c, f, r, o, u) => ddicAbsence(c, f, r, o, u, () => input.fixtures[0].name.slice(-12)),
    check: checkTableRequest,
    unlock: ddicUnlock,
    source: (f) => f.type === 'TABL/DT' || f.type === 'TABL/DTI',
    postCreateCleanup: (f) => f.type !== 'ENQU',
    changedPaths: () => [ENQU_SOURCE_PATHS.primaryTable],
    verifyUpdated: (f, before, after) => {
      if (f.type !== 'TABL/DTT')
        assertOnlyRequestedChanges(before.fields, after.fields, [ENQU_SOURCE_PATHS.primaryTable]);
      else {
        const field = '/' + JSON.stringify(['http://www.sap.com/dictionary/table/settings', 'sizeCategory']);
        if (differingFields(before.fields, after.fields).some((p) => p !== field))
          throw new Error('Settings update changed an unrequested native field.');
      }
    },
  };
}
