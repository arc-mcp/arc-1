/** Fixed remaining work only, through the reviewed DDIC owning lifecycle and exact native receipts. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { throwIfRequestCancelled } from '../../../src/adt/http-deadline.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { AdtRequestNotSentError } from "../../../src/adt/errors.js";
import type { CollectionsFixture } from './native-ddic-collections-fixtures.js';
import {
  collectionsRetainedSnapshot,
  retainedMessageUpdate,
  verifyRetainedMessageUpdate,
} from './native-ddic-collections-retained-evidence.js';
import {
  COLLECTIONS_RETAINED_STAGES,
  COLLECTIONS_RETAINED_SUFFIX,
  collectionsRetainedFixtures,
} from './native-ddic-collections-retained-fixed.js';
import { checkCollectionsRequest, collectionsResponseCap } from './native-ddic-collections-transport.js';
import { ddicAbsence } from './native-ddic-evidence.js';
import { ddicClient, ddicRuntime } from './native-ddic-runner.js';
import { ddicBoundHttp, ddicUnlock } from './native-ddic-transport.js';
import { type DdicWorkflowInput, runFixedDdicWorkflow } from './native-ddic-workflow.js';
import { declarativeInventoryClean } from './native-declarative-evidence.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { nativeRequestPolicy, observeNativeHttp } from './native-observed-http.js';

export { ddicClient };

/** Internal compiled continuation contracts; never a tool/CLI option or an evidence-adoption switch. */
export interface CollectionsRetainedContract {
  fixtures: () => readonly CollectionsFixture[];
  suffix: string;
  stages: readonly string[];
  snapshot: typeof collectionsRetainedSnapshot;
}
const originalContract: CollectionsRetainedContract = Object.freeze({
  fixtures: () => collectionsRetainedFixtures(COLLECTIONS_RETAINED_SUFFIX),
  suffix: COLLECTIONS_RETAINED_SUFFIX,
  stages: COLLECTIONS_RETAINED_STAGES,
  snapshot: collectionsRetainedSnapshot,
});
const graph = (fixtures: readonly CollectionsFixture[], contract: CollectionsRetainedContract) => {
  if (JSON.stringify(fixtures) !== JSON.stringify(contract.fixtures()))
    throw new Error('Exact retained three-owner graph required.');
};
const copy = (base: AdtClient, http: AdtHttpClient) =>
  Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
export function checkCollectionsRetainedRequest(
  fixtures: readonly CollectionsFixture[],
  selected: CollectionsFixture | undefined,
  stage: string | undefined,
  method: string,
  path: string,
  body?: string,
  contract: CollectionsRetainedContract = originalContract,
) {
  graph(fixtures, contract);
  if (stage !== undefined && !contract.stages.includes(stage))
    throw new Error('Completed or unknown stage cannot be replayed.');
  if (
    method === 'PUT' &&
    (stage !== 'update-MSAG' || selected?.type !== 'MSAG' || path.split('?')[0] !== selected.owner)
  )
    throw new Error('Only the remaining message-class save is admitted.');
  if (!['GET', 'HEAD'].includes(method) && stage === undefined)
    throw new Error('No mutation during retained preflight.');
  checkCollectionsRequest(fixtures, selected, stage, method, path, body);
  if (method === 'POST' && path === '/sap/bc/adt/cts/transportchecks') {
    const root = nativeXmlRoot(body ?? '', 'abap', 'http://www.sap.com/abapxml');
    const expected = `<a:abap xmlns:a="http://www.sap.com/abapxml" version="1.0"><a:values><DATA><DEVCLASS>$TMP</DEVCLASS><URI>${selected!.owner}</URI><OPERATION></OPERATION></DATA></a:values></a:abap>`;
    if (
      JSON.stringify(root.canonicalValue({})) !==
      JSON.stringify(nativeXmlRoot(expected, 'abap', 'http://www.sap.com/abapxml').canonicalValue({}))
    )
      throw new Error('Only existing-owner recording checks are admitted.');
  }
}
/** The PUT's own session independently rechecks full original native state after LOCK. */
function retainedSaveGuard(
  http: AdtHttpClient,
  base: AdtClient,
  fixture: CollectionsFixture,
  record: (v: unknown) => void,
  contract: CollectionsRetainedContract,
): AdtHttpClient {
  return new Proxy(http, {
    get(target, key) {
      if (key === 'withStatefulSession')
        return (
          run: Parameters<AdtHttpClient['withStatefulSession']>[0],
          close: Parameters<AdtHttpClient['withStatefulSession']>[1],
        ) => target.withStatefulSession((s) => run(retainedSaveGuard(s, base, fixture, record, contract)), close);
      if (key === 'put')
        return async (...args: Parameters<AdtHttpClient['put']>) => {
          try {
            if (args[0].split('?')[0] !== fixture.owner) throw new Error('Unexpected retained save.');
            const policy = nativeRequestPolicy(args[4]);
            const before = await contract.snapshot(copy(base, target), fixture, false, true, record, policy);
            if (args[1] !== retainedMessageUpdate(fixture, before))
              throw new Error('Fixed message-class save payload changed.');
            throwIfRequestCancelled(policy);
            args[4] = policy;
          } catch {
            record({
              stage: 'refused-before-send',
              method: 'PUT',
              path: fixture.owner,
              reason: 'retained-native-state-or-payload',
            });
            throw new AdtRequestNotSentError(
              'PUT',
              'Retained native state or exact payload verification failed before send.',
            );
          }
          return target.put(...args);
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
export function runCollectionsRetained(
  input: DdicWorkflowInput<CollectionsFixture>,
  contract: CollectionsRetainedContract = originalContract,
) {
  graph(input.fixtures, contract);
  const message = input.fixtures.find((f) => f.type === 'MSAG')!;
  return runFixedDdicWorkflow(input, {
    retained: true,
    initialState: (f) => ({ updated: f.type !== 'MSAG', active: true }),
    metadataActive: (f) => f.type === 'MSAG',
    stages: contract.stages,
    attemptLimit: 384,
    wrapHttp: (http) => retainedSaveGuard(collectionsResponseCap(http), input.base, message, input.record, contract),
    snapshot: contract.snapshot,
    verifyUpdated: verifyRetainedMessageUpdate,
    check: (f, selected, stage, method, path, body) =>
      checkCollectionsRetainedRequest(f, selected, stage, method, path, body, contract),
    unlock: ddicUnlock,
    absence: (c, f, r, o, u) => ddicAbsence(c, f, r, o, u, () => contract.suffix),
    source: (f) => f.type === 'TABL/DS',
    postCreateCleanup: () => true,
    changedPaths: () => [],
  });
}
export const collectionsRetainedRuntime = { ...ddicRuntime, execute: runCollectionsRetained };
export async function collectionsRetainedPreflight(
  base: AdtClient,
  fixtures: readonly CollectionsFixture[],
  record: (v: unknown) => void,
  verify: () => void,
  contract: CollectionsRetainedContract = originalContract,
) {
  graph(fixtures, contract);
  const deadline = Date.now() + 60_000;
  const assert = () => {
    verify();
    if (Date.now() >= deadline) throw new Error('Retained preflight expired.');
  };
  const http = observeNativeHttp(
    ddicBoundHttp(base.http, { deadline, assert, unlock: () => false, attemptLimit: 384 }),
    (m, p, b) => {
      if (m !== 'GET') throw new Error('GET-only retained preflight.');
      checkCollectionsRetainedRequest(fixtures, undefined, undefined, m, p, b, contract);
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
  const client = copy(base, collectionsResponseCap(http)),
    options = { deadline, noReplay: true, retryTransientErrors: false };
  for (const f of fixtures) await contract.snapshot(client, f, f.type !== 'MSAG', true, record, options);
  await declarativeInventoryClean(
    http,
    fixtures.map((f) => ({ ...f, name: contract.suffix })) as unknown as DeclarativeFixture[],
    record,
    options,
  );
  assert();
}
