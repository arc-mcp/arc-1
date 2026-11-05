/** Lazy native factory; preparation and offline check do not load this module or credentials. */
import type { AdtClient } from '../../../src/adt/client.js';
import { ddicAbsence } from './native-ddic-evidence.js';
import { ddicClient, ddicRuntime } from './native-ddic-runner.js';
import { ddicBoundHttp } from './native-ddic-transport.js';
import { observeNativeHttp } from './native-observed-http.js';
import { runNativeRap, runNativeRapDocuments } from './native-rap-driver.js';
import { type RapFixture, rapSettings } from './native-rap-fixtures.js';
import { rapCapabilities } from './native-rap-policy.js';
import { checkRapRequest } from './native-rap-transport.js';

export { ddicClient as rapClient };
export const rapRuntime = { ...ddicRuntime, execute: runNativeRap };
export const rapDocumentRuntime = { ...ddicRuntime, execute: runNativeRapDocuments };
export async function rapGetOnlyPreflight(
  base: AdtClient,
  fixtures: readonly RapFixture[],
  record: (v: unknown) => void,
  verify: () => void,
) {
  const deadline = Date.now() + 60000;
  const assert = () => {
    verify();
    if (Date.now() >= deadline) throw new Error('RAP preflight expired.');
  };
  const http = observeNativeHttp(
    ddicBoundHttp(base.http, { deadline, assert, unlock: () => false }),
    (m, p) => {
      if (m !== 'GET') throw new Error('RAP GET-only preflight.');
      checkRapRequest(fixtures, undefined, m, p);
      assert();
    },
    (v) => {
      const { body, ...safe } = v as { body?: unknown; path?: string };
      record(safe.path === '/sap/bc/adt/activation/inactiveobjects' ? safe : v);
    },
    async () => {
      throw new Error('GET-only RAP preflight.');
    },
  );
  const client = Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
  await rapCapabilities(
    client,
    fixtures.some((f) => f.type === 'SKTD'),
  );
  await ddicAbsence(
    client,
    [...fixtures, rapSettings(fixtures)],
    record,
    { deadline, noReplay: true, retryTransientErrors: false },
    undefined,
    () => fixtures[0].name.slice(-12),
  );
  assert();
}
