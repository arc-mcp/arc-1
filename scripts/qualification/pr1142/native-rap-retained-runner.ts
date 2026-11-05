/** Lazy native factory for the one compiled retained graph. */
import type { AdtClient } from '../../../src/adt/client.js';
import { ddicBoundHttp } from './native-ddic-transport.js';
import { observeNativeHttp } from './native-observed-http.js';
import {
  runNativeRapDocumentsRetained,
  runNativeRapDocumentsRetainedV2,
  runNativeRapDocumentsRetainedV3,
  runNativeRapDocumentsRetainedV4,
} from './native-rap-driver.js';
import type { RapFixture } from './native-rap-fixtures.js';
import { rapCapabilities } from './native-rap-policy.js';
import { readRetainedRapGraph } from './native-rap-retained-evidence.js';
import { readActiveRetainedRapGraph } from './native-rap-retained-v4-evidence.js';
import { rapClient, rapRuntime } from './native-rap-runner.js';
import { checkRapRequest } from './native-rap-transport.js';

export { rapClient };
export const rapRetainedRuntime = { ...rapRuntime, execute: runNativeRapDocumentsRetained };
export const rapRetainedV2Runtime = { ...rapRuntime, execute: runNativeRapDocumentsRetainedV2 };
export const rapRetainedV3Runtime = { ...rapRuntime, execute: runNativeRapDocumentsRetainedV3 };
export const rapRetainedV4Runtime = { ...rapRuntime, execute: runNativeRapDocumentsRetainedV4 };
export async function rapRetainedPreflight(
  base: AdtClient,
  fixtures: readonly RapFixture[],
  record: (v: unknown) => void,
  verify: () => void,
  editedDocument: boolean | 'updated-document' | 'active-binding' = false,
) {
  const deadline = Date.now() + 60000;
  const assert = () => {
    verify();
    if (Date.now() >= deadline) throw new Error('Retained RAP preflight expired.');
  };
  const http = observeNativeHttp(
    ddicBoundHttp(base.http, { deadline, assert, unlock: () => false }),
    (m, p, b) => {
      if (m !== 'GET') throw new Error('GET-only retained preflight.');
      checkRapRequest(fixtures, undefined, m, p, b);
      assert();
    },
    (v) => {
      const row = v as { path?: string; body?: unknown };
      const { body, ...safe } = row;
      record(row.path === '/sap/bc/adt/activation/inactiveobjects' ? safe : row);
    },
    async () => {
      throw new Error('GET-only retained preflight.');
    },
  );
  const client = Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
  await rapCapabilities(client, true);
  await (editedDocument === 'active-binding' ? readActiveRetainedRapGraph : readRetainedRapGraph)(
    client,
    fixtures,
    record,
    { deadline, noReplay: true, retryTransientErrors: false },
    assert,
    undefined,
    editedDocument === 'active-binding' ? false : editedDocument,
  );
  assert();
}
export const rapRetainedV2Preflight = (...args: Parameters<typeof rapRetainedPreflight>) =>
  rapRetainedPreflight(args[0], args[1], args[2], args[3], true);

export const rapRetainedV3Preflight = (...args: Parameters<typeof rapRetainedPreflight>) =>
  rapRetainedPreflight(args[0], args[1], args[2], args[3], 'updated-document');

export const rapRetainedV4Preflight = (...args: Parameters<typeof rapRetainedPreflight>) =>
  rapRetainedPreflight(args[0], args[1], args[2], args[3], 'active-binding');
