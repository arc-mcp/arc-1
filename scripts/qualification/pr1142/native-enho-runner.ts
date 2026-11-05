/** Lazy client factory and bounded GET-only native preflight. No entry phase is invoked on import. */
import type { AdtClient } from '../../../src/adt/client.js';
import { ddicAbsence } from './native-ddic-evidence.js';
import { ddicClient, ddicRuntime } from './native-ddic-runner.js';
import { ddicBoundHttp } from './native-ddic-transport.js';
import { declarativeInventoryClean } from './native-declarative-evidence.js';
import { enhoCapabilities, enhoDependencies } from './native-enho-dependencies.js';
import { runNativeEnho } from './native-enho-driver.js';
import type { EnhoFixture } from './native-enho-fixtures.js';
import { ENHO_RETAINED_MODE } from './native-enho-retained-fixed.js';
import { readRetainedEnhoStart } from './native-enho-retained-state.js';
import { checkEnhoRequest } from './native-enho-transport.js';
import { observeNativeHttp } from './native-observed-http.js';

export { ddicClient as enhoClient };
export const enhoRuntime = { ...ddicRuntime, execute: runNativeEnho };
export async function enhoGetOnlyPreflight(
  base: AdtClient,
  fixtures: readonly EnhoFixture[],
  record: (v: unknown) => void,
  verify: () => void,
  profile?: typeof ENHO_RETAINED_MODE,
) {
  const deadline = Date.now() + 60000;
  const assert = () => {
    verify();
    if (Date.now() >= deadline) throw new Error('Enhancement preflight expired.');
  };
  const http = observeNativeHttp(
    ddicBoundHttp(base.http, { deadline, assert, unlock: () => false }),
    (m, p) => {
      if (m !== 'GET') throw new Error('GET-only enhancement preflight.');
      checkEnhoRequest(fixtures, undefined, m, p);
      assert();
    },
    (v) => {
      const { body, ...safe } = v as { body?: unknown; path?: string };
      record(safe.path === '/sap/bc/adt/activation/inactiveobjects' ? safe : v);
    },
    async () => {
      throw new Error('GET-only enhancement preflight.');
    },
  );
  const client = Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
  await enhoCapabilities(client);
  const options = { deadline, noReplay: true, retryTransientErrors: false };
  record({ dependencySignature: await enhoDependencies(client, record, options) });
  if (profile === ENHO_RETAINED_MODE) {
    await readRetainedEnhoStart(client, fixtures, record, options);
    await declarativeInventoryClean(http, [], record, options);
    record({ inventoryScope: 'valid-unfiltered', retainedOwners: fixtures.map((v) => v.owner) });
  } else {
    if (profile !== undefined) throw new Error('Unknown enhancement preflight profile.');
    await ddicAbsence(client, fixtures, record, options, undefined, () => fixtures[0].name.slice(-12));
  }
  assert();
}
