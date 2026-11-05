/** Lazy runtime: same strict native credential factory and final-dispatch budget. */
import type { AdtClient } from '../../../src/adt/client.js';
import { ddicAbsence } from './native-ddic-evidence.js';
import { ddicClient, ddicRuntime } from './native-ddic-runner.js';
import { runNativeTableGraph, tableCapabilities } from './native-ddic-table-driver.js';
import type { TableFixture } from './native-ddic-table-fixtures.js';
import { checkTableRequest } from './native-ddic-table-transport.js';
import { ddicBoundHttp } from './native-ddic-transport.js';
import { observeNativeHttp } from './native-observed-http.js';

export { ddicClient as tableClient };
export const tableRuntime = { ...ddicRuntime, execute: runNativeTableGraph };
export async function tableGetOnlyPreflight(
  base: AdtClient,
  fixtures: readonly TableFixture[],
  record: (v: unknown) => void,
  verify: () => void,
) {
  const deadline = Date.now() + 60000;
  const assert = () => {
    verify();
    if (Date.now() >= deadline) throw new Error('DDIC preflight deadline.');
  };
  const http = observeNativeHttp(
    ddicBoundHttp(base.http, { deadline, assert, unlock: () => false }),
    (m, p) => {
      if (m !== 'GET') throw new Error('GET-only preflight.');
      checkTableRequest(fixtures, undefined, undefined, m, p);
      assert();
    },
    (v) => {
      const row = v as { path?: string; body?: unknown };
      const { body, ...safe } = row;
      record(row.path === '/sap/bc/adt/activation/inactiveobjects' ? safe : row);
    },
    async () => {
      throw new Error('GET-only preflight.');
    },
  );
  const client = Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
  await tableCapabilities(client);
  await ddicAbsence(
    client,
    fixtures,
    record,
    { deadline, noReplay: true, retryTransientErrors: false },
    undefined,
    () => fixtures[0].name.slice(-12),
  );
  assert();
}
