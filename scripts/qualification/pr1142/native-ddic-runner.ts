/** Native modules/credential reader are loaded only by preflight or a permanently claimed execute. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { AdtClient } from '../../../src/adt/client.js';
import { ddicSafety, runNativeDdic } from './native-ddic-driver.js';
import { ddicAbsence } from './native-ddic-evidence.js';
import type { DdicFixture } from './native-ddic-fixtures.js';
import { checkDdicRequest, ddicBoundHttp } from './native-ddic-transport.js';
import { invalidNativeCredentialFields } from './native-declarative-entry.js';
import { observeNativeHttp } from './native-observed-http.js';
export interface DdicRuntime {
  readEnv: (repo: string) => Record<string, string>;
  createClient: (input: ConstructorParameters<typeof AdtClient>[0]) => AdtClient;
  execute: typeof runNativeDdic;
}
export const ddicRuntime: DdicRuntime = {
  readEnv: (repo) => parse(readFileSync(join(repo, '.env'))),
  createClient: (input) => new AdtClient(input),
  execute: runNativeDdic,
};
export function ddicClient(
  runtime: Pick<DdicRuntime, 'readEnv' | 'createClient'>,
  repo: string,
  verify: () => void,
  writes: boolean,
) {
  verify();
  const env = runtime.readEnv(repo);
  try {
    verify();
    if (invalidNativeCredentialFields(env).length) throw new Error('Fixed DDIC native identity required.');
    return runtime.createClient({
      baseUrl: 'https://a4h.marianzeis.de',
      client: '001',
      username: env.SAP_USER,
      password: env.SAP_PASSWORD,
      language: 'EN',
      insecure: false,
      safety: { ...ddicSafety(), allowWrites: writes },
    });
  } finally {
    delete env.SAP_PASSWORD;
  }
}
export async function ddicGetOnlyPreflight(
  base: AdtClient,
  fixtures: readonly DdicFixture[],
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
      checkDdicRequest(fixtures, undefined, undefined, m, p);
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
  await ddicAbsence(client, fixtures, record, { deadline, noReplay: true, retryTransientErrors: false });
  assert();
}
