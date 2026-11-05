/** One fixed remaining graph, never the submitted table CREATE/PUT prefix. */
import type { AdtClient } from '../../../src/adt/client.js';
import { ddicAbsence } from './native-ddic-evidence.js';
import { ddicClient, ddicRuntime } from './native-ddic-runner.js';
import { tableCapabilities, tableObservedInput, tableWorkflowProfile } from './native-ddic-table-driver.js';
import type { TableFixture } from './native-ddic-table-fixtures.js';
import { retainedTableSnapshot } from './native-ddic-table-retained-evidence.js';
import {
  retainedTableFixtures,
  retainedTableOwners,
  TABLE_RETAINED_STAGES,
  TABLE_RETAINED_SUFFIX,
} from './native-ddic-table-retained-fixed.js';
import { checkTableRequest } from './native-ddic-table-transport.js';
import { ddicBoundHttp } from './native-ddic-transport.js';
import { type DdicWorkflowInput, runFixedDdicWorkflow } from './native-ddic-workflow.js';
import { observeNativeHttp } from './native-observed-http.js';

const requireGraph = (fixtures: readonly TableFixture[]) => {
  if (JSON.stringify(fixtures) !== JSON.stringify(retainedTableFixtures(TABLE_RETAINED_SUFFIX)))
    throw new Error('Exact retained table graph required.');
};
export function checkRetainedTableRequest(
  fixtures: readonly TableFixture[],
  selected: TableFixture | undefined,
  stage: string | undefined,
  method: string,
  path: string,
  body?: string,
) {
  requireGraph(fixtures);
  if (stage !== undefined && !TABLE_RETAINED_STAGES.includes(stage as (typeof TABLE_RETAINED_STAGES)[number]))
    throw new Error('No replay of submitted table prefix.');
  if (
    (method === 'POST' && path.split('?')[0] === '/sap/bc/adt/ddic/tables') ||
    (method === 'PUT' && path.split('?')[0] === fixtures[0].owner + '/source/main')
  )
    throw new Error('No repeated table CREATE or source PUT.');
  checkTableRequest(fixtures, selected, stage, method, path, body);
}
export async function runRetainedTableGraph(input: DdicWorkflowInput<TableFixture>) {
  requireGraph(input.fixtures);
  return runFixedDdicWorkflow(tableObservedInput(input), {
    ...tableWorkflowProfile(input),
    guardOwned: (_f, stage) => (stage === 'activate-TABL/DT' ? [input.fixtures[1].owner] : []),
    retained: retainedTableOwners(),
    stages: TABLE_RETAINED_STAGES,
    snapshot: retainedTableSnapshot,
    check: checkRetainedTableRequest,
    absence: (c, f, r, o, u) => ddicAbsence(c, f, r, o, u, f.length === 4 ? () => TABLE_RETAINED_SUFFIX : undefined),
  });
}
export const retainedTableRuntime = { ...ddicRuntime, execute: runRetainedTableGraph };
export { ddicClient };
export async function retainedTablePreflight(
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
      checkRetainedTableRequest(fixtures, undefined, undefined, m, p, b);
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
  for (const f of fixtures.slice(0, 2)) await retainedTableSnapshot(client, f, false, false, record, options);
  await ddicAbsence(client, fixtures.slice(2), record, options);
  assert();
  record({
    inventoryScope: 'valid-unfiltered',
    retainedOwners: retainedTableOwners(),
    absentOwners: fixtures.slice(2).map((f) => f.owner),
  });
}
