/** Loaded only for a reviewed GET-only preflight or an already claimed execution. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { AdtClient } from '../../../src/adt/client.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { throwIfRequestCancelled } from '../../../src/adt/http-deadline.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { invalidNativeCredentialFields } from './native-declarative-entry.js';
import { observeNativeHttp } from './native-observed-http.js';
import { recordedPackageReceipt } from './native-package-api-actions.js';
import { PACKAGE_API_MOVED_READS } from './native-package-api-moved-fixed.js';
import { packageApiInterface } from './native-package-api-profile.js';
import { PACKAGE_API_RETAINED_PAIR, PACKAGE_API_RETAINED_READS } from './native-package-api-retained-fixed.js';
import { checkPackageApiRequest } from './native-package-api-transport.js';
import { packageSafety, runNativePackageContract } from './native-package-driver.js';
import { type PackageJournal, packageAbsence, packageOwnerAbsent } from './native-package-evidence.js';
import type { PackageGraph } from './native-package-fixtures.js';
import { checkPackageRequest } from './native-package-transport.js';
export interface PackageRuntime {
  readEnv: (repo: string) => Record<string, string>;
  createClient: (input: ConstructorParameters<typeof AdtClient>[0]) => AdtClient;
  execute: typeof runNativePackageContract;
}
export const packageRuntime: PackageRuntime = {
  readEnv: (repo) => parse(readFileSync(join(repo, '.env'))),
  createClient: (input) => new AdtClient(input),
  execute: runNativePackageContract,
};
export function packageClient(
  runtime: PackageRuntime,
  repo: string,
  graph: PackageGraph,
  verify: () => void,
  writes: boolean,
  retainPackageGrants = false,
  recordedApi = false,
  retainedApi = false,
) {
  verify();
  const env = runtime.readEnv(repo);
  try {
    verify();
    if (invalidNativeCredentialFields(env).length) throw new Error('Fixed native credentials required.');
    return runtime.createClient({
      baseUrl: 'https://a4h.marianzeis.de',
      client: '001',
      username: env.SAP_USER,
      password: env.SAP_PASSWORD,
      insecure: false,
      language: 'EN',
      safety: writes
        ? packageSafety(graph, recordedApi, retainedApi)
        : retainPackageGrants
          ? { ...packageSafety(graph, recordedApi, retainedApi), allowWrites: false }
          : defaultSafetyConfig(),
    });
  } finally {
    delete env.SAP_PASSWORD;
  }
}
export async function packageGetOnlyPreflight(
  client: AdtClient,
  graph: PackageGraph,
  record: PackageJournal,
  verify: () => void,
  inspect?: (client: AdtClient, options: import('../../../src/adt/http.js').AdtRequestOptions) => Promise<void>,
  recordedApi = false,
  retainedApi = false,
  movedApi = false,
) {
  const deadline = Date.now() + 60_000,
    allowance = new RequestAttemptBudget(retainedApi ? 64 : 8);
  const attemptBudget = new Proxy(allowance, {
    get(t, k) {
      if (k === 'consume')
        return () => {
          t.consume();
          verify();
          throwIfRequestCancelled({ deadline });
        };
      const v = Reflect.get(t, k);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const http = observeNativeHttp(
    client.http,
    (method, path) => {
      if (method !== 'GET') throw new Error('GET-only preflight.');
      if (
        retainedApi &&
        (movedApi ? PACKAGE_API_MOVED_READS : PACKAGE_API_RETAINED_READS).some((r) => r.path === path)
      ) {
        verify();
        return;
      }
      if (recordedApi)
        checkPackageApiRequest(
          graph,
          undefined,
          method,
          path,
          undefined,
          retainedApi
            ? { ...PACKAGE_API_RETAINED_PAIR, moved: false, apiResource: undefined, apiBody: undefined }
            : undefined,
        );
      else checkPackageRequest(graph, undefined, method, path);
      verify();
    },
    (row) => {
      const r = row as { path?: string; body?: unknown };
      const { body, ...safe } = r;
      record(r.path === '/sap/bc/adt/activation/inactiveobjects' ? safe : r);
    },
    async () => {
      throw new Error('GET-only preflight.');
    },
  );
  const options = {
    deadline,
    noReplay: true,
    retryTransientErrors: false,
    attemptBudget,
    responseBudget: new DataResponseBudget(2 * 1024 * 1024, 'package-preflight', true),
  };
  if (inspect) await inspect(Object.assign(Object.create(Object.getPrototypeOf(client)), client, { http }), options);
  else await packageAbsence(http, graph, record, options);
  if (recordedApi && !retainedApi) await packageOwnerAbsent(http, packageApiInterface(graph), record, options);
  if (recordedApi)
    await recordedPackageReceipt(
      Object.assign(Object.create(Object.getPrototypeOf(client)), client, { http }),
      options,
      record,
    );
  verify();
  throwIfRequestCancelled({ deadline });
}
