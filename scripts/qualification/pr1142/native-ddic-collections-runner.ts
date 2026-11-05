/** Lazy runtime: same strict native credential factory and final-dispatch budget. */
import type { AdtClient } from '../../../src/adt/client.js';
import { runNativeDdicCollections } from './native-ddic-collections-driver.js';
import type { CollectionsFixture } from './native-ddic-collections-fixtures.js';
import { checkCollectionsRequest } from './native-ddic-collections-transport.js';
import { ddicAbsence } from './native-ddic-evidence.js';
import { ddicClient, ddicRuntime } from './native-ddic-runner.js';
import { ddicBoundHttp } from './native-ddic-transport.js';
import { observeNativeHttp } from './native-observed-http.js';

export { ddicClient as collectionsClient };
export const collectionsRuntime = { ...ddicRuntime, execute: runNativeDdicCollections };
export async function collectionsGetOnlyPreflight(
  base: AdtClient,
  fixtures: readonly CollectionsFixture[],
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
      checkCollectionsRequest(fixtures, undefined, undefined, m, p);
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
  await ddicAbsence(
    client,
    fixtures,
    record,
    { deadline, noReplay: true, retryTransientErrors: false },
    undefined,
    (f) => f.name.slice(-12),
  );
  assert();
}
