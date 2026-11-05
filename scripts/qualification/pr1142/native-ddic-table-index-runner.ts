/** One fixed index reactivation and reverse cleanup; no submitted prefix may repeat. */
import type { AdtClient } from '../../../src/adt/client.js';
import { ddicAbsence } from './native-ddic-evidence.js';
import { declarativeInventoryClean } from './native-declarative-evidence.js';
import { ddicClient, ddicRuntime } from './native-ddic-runner.js';
import { tableCapabilities, tableObservedInput, tableWorkflowProfile } from './native-ddic-table-driver.js';
import type { TableFixture } from './native-ddic-table-fixtures.js';
import { indexTailEvidence } from './native-ddic-table-index-evidence.js';
import {
  indexTailFixtures,
  indexTailOwners,
  TABLE_INDEX_STAGES,
  TABLE_INDEX_SUFFIX,
} from './native-ddic-table-index-fixed.js';
import { checkTableRequest } from './native-ddic-table-transport.js';
import { ddicBoundHttp } from './native-ddic-transport.js';
import { type DdicWorkflowInput, runFixedDdicWorkflow } from './native-ddic-workflow.js';
import { observeNativeHttp } from './native-observed-http.js';

const requireGraph = (fixtures: readonly TableFixture[]) => {
  if (JSON.stringify(fixtures) !== JSON.stringify(indexTailFixtures(TABLE_INDEX_SUFFIX)))
    throw new Error('Exact retained table graph required.');
};
export function checkIndexTailRequest(
  fixtures: readonly TableFixture[],
  selected: TableFixture | undefined,
  stage: string | undefined,
  method: string,
  path: string,
  body?: string,
) {
  requireGraph(fixtures);
  if (stage !== undefined && !TABLE_INDEX_STAGES.includes(stage as (typeof TABLE_INDEX_STAGES)[number]))
    throw new Error('No replay of completed table/settings stages.');
  if (
    method === 'PUT' ||
    (method === 'POST' &&
      ['/sap/bc/adt/ddic/tables', '/sap/bc/adt/ddic/lockobjects/sources', '/sap/bc/adt/ddic/db/indexes'].includes(
        path.split('?')[0],
      ))
  )
    throw new Error('No CREATE or PUT in the fixed index tail.');
  checkTableRequest(fixtures, selected, stage, method, path, body);
}
export async function runIndexTailGraph(input: DdicWorkflowInput<TableFixture>) {
  requireGraph(input.fixtures);
  return runFixedDdicWorkflow(tableObservedInput(input), {
    ...tableWorkflowProfile(input),
    ...indexTailEvidence(),
    guardOwned: (_f, stage) => (stage === 'delete-TABL/DT' ? [input.fixtures[1].owner] : []),
    retained: indexTailOwners(),
    stages: TABLE_INDEX_STAGES,
    check: checkIndexTailRequest,
    absence: (c, f, r, o, u) => ddicAbsence(c, f, r, o, u, f.length === 4 ? () => TABLE_INDEX_SUFFIX : undefined),
  });
}
export const indexTailRuntime = { ...ddicRuntime, execute: runIndexTailGraph };
export { ddicClient };
export async function indexTailPreflight(
  base: AdtClient,
  fixtures: readonly TableFixture[],
  record: (v: unknown) => void,
  verify: () => void,
) {
  requireGraph(fixtures);
  const deadline = Date.now() + 60000,
    assert = () => {
      verify();
      if (Date.now() >= deadline) throw new Error('Retained table preflight expired.');
    };
  const http = observeNativeHttp(
    ddicBoundHttp(base.http, { deadline, assert, unlock: () => false }),
    (m, p, b) => {
      if (m !== 'GET') throw new Error('GET-only retained table preflight.');
      checkIndexTailRequest(fixtures, undefined, undefined, m, p, b);
      assert();
    },
    (v) => {
      const row = v as { path?: string; body?: unknown };
      const { body, ...safe } = row;
      record(row.path === '/sap/bc/adt/activation/inactiveobjects' ? safe : row);
    },
    async () => {
      throw new Error('GET-only retained table preflight.');
    },
  );
  const client = Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient,
    options = { deadline, noReplay: true, retryTransientErrors: false };
  await tableCapabilities(client);
  const evidence = indexTailEvidence();
  for (const f of fixtures) await evidence.snapshot(client, f, false, false, record, options);
  // Retained inactive owners are expected; validate a fresh bounded inventory without claiming suffix absence.
  await declarativeInventoryClean(client.http, [], record, options);
  assert();
  record({
    inventoryScope: 'valid-unfiltered',
    retainedOwners: indexTailOwners(),
    absentOwners: [],
  });
}
