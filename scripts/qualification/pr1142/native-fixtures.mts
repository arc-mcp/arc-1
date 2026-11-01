import assert from 'node:assert/strict';
import { AdtApiError } from '../../../src/adt/errors.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { mutationHttp } from '../../../src/adt/mutation-http.js';
import { getTestClient } from '../../../tests/integration/helpers.js';
import { durable } from './durable-journal.mjs';
import { actors, root, target, validateFixtures } from './fixture-contract.mjs';
import {
  cleanupNativeFixture,
  nativeAbsent,
  nativeIdentity,
  withNativeCleanupReport,
} from './native-fixture-operations.mjs';
import { configuration, validateConfiguration } from './qualification-config.mjs';
import { retainNativeWorkerOnInterrupt } from './process-boundaries.mjs';
import { verifyRunManifest } from './run-manifest.mjs';
import { assertSafeDiagnosticEnvironment, privateJson } from './safe-io.mjs';

retainNativeWorkerOnInterrupt();
assertSafeDiagnosticEnvironment();
validateConfiguration(configuration);
const run = await verifyRunManifest(configuration.root);

assert.equal(process.env.TEST_SAP_URL, 'https://a4h.marianzeis.de');
assert.equal(process.env.TEST_SAP_CLIENT, '001');
assert.equal(process.env.TEST_SAP_INSECURE, 'false');
const [mode, name, attempt] = process.argv.slice(2);
if (mode === 'cleanup') assert.match(attempt, /^[a-f0-9-]{36}$/);
else assert.equal(attempt, undefined);
assert.ok(['preflight', 'identity', 'unchanged', 'absence', 'cleanup'].includes(mode));
const manifest = await privateJson(`${root}/fixture-manifest.json`);
const manifestSha256 = validateFixtures(manifest);
const qualification = mode === 'preflight' ? undefined : await privateJson(`${root}/deletion-qualification.json`);
if (qualification) {
  assert.equal(qualification.plan, 'delete-two-user-v1');
  assert.equal(qualification.target, target);
  assert.equal(qualification.manifestSha256, manifestSha256);
  for (const key of ['runId', 'sourceRevision', 'harnessSha256']) assert.equal(qualification[key], run[key]);
}
const selected = mode === 'preflight' ? manifest.fixtures : manifest.fixtures.filter((f: any) => f.name === name);
assert.equal(selected.length, mode === 'preflight' ? 4 : 1);
const original = getTestClient();
assert.equal(original.username, actors[0].sapUser);
assert.equal(original.sapClient, '001');
const policy = { target, enabled: true, allowedPackages: ['$TMP'], allowedTransports: [], serverAllowedTransports: [] };
const client = original.withSafety({ ...original.safety, allowedPackages: ['$TMP'], multiTargetWrite: policy });
const options = { deadline: Date.now() + 60_000, noReplay: true, retryTransientErrors: false };
const context = pinnedMutationContext(client.safety, options, { unlockFailed: false });
const http = mutationHttp(client.http, client.safety, context);
const absenceEvidence = new Map<string, unknown>();
const absent = (fixture: any) =>
  nativeAbsent(fixture, http, options, (evidence) => absenceEvidence.set(fixture.name, evidence));
const identity = (fixture: any, active = http) =>
  nativeIdentity({
    fixture,
    actor: actors.find((a) => a.label === fixture.actor),
    marker: manifest.marker,
    http: active,
    options,
    expectedIncludes: qualification?.fixtures.find((f: any) => f.name === fixture.name)?.includes,
    observe: async (observed: any) => {
      report.observedIdentities.push({ fixture: fixture.name, at: new Date().toISOString(), identity: observed });
      await durable(path, report);
    },
  });
const report: any = {
  mode,
  status: 'in-progress',
  at: new Date().toISOString(),
  nativeUrl: manifest.nativeUrl,
  client: '001',
  nativeReader: actors[0].sapUser,
  manifestSha256,
  runId: run.runId,
  sourceRevision: run.sourceRevision,
  harnessSha256: run.harnessSha256,
  fixtures: [],
  observedIdentities: [],
};
const path = `${root}/native-${mode}${name ? `-${name}` : ''}${attempt ? `-${attempt}` : ''}.json`;
await durable(path, report, true);
let failure: unknown;
await withNativeCleanupReport({
  context,
  report,
  persist: async () => {
    report.absenceEvidence = Object.fromEntries(absenceEvidence);
    await durable(path, report);
  },
  operation: async () => {
    try {
      for (const fixture of selected) {
        const result: any = { name: fixture.name, type: fixture.type };
        report.fixtures.push(result);
        if (mode === 'preflight' || mode === 'absence') {
          result.absent = await absent(fixture);
          assert.equal(result.absent, true);
        } else if (mode === 'identity' || mode === 'unchanged') {
          result.identity = await identity(fixture);
          if (mode === 'unchanged') {
            const receipt = await privateJson(`${root}/native-identity-${fixture.name}.json`);
            assert.equal(receipt.manifestSha256, manifestSha256);
            assert.equal(receipt.status, 'complete');
            assert.deepEqual(
              result.identity,
              receipt.fixtures.find((f: any) => f.name === fixture.name)?.identity,
              'Fixture changed; preserve foreign work',
            );
            result.unchanged = true;
          }
        } else {
          Object.assign(
            result,
            await cleanupNativeFixture({
              fixture,
              manifestSha256,
              load: (name: string) => privateJson(`${root}/${name}`),
              absent,
              identity,
              http,
              client,
              context,
              options,
              attempted: async () => {
                result.cleanupAttempted = true;
                await durable(path, report);
              },
            }),
          );
        }
        await durable(path, report);
      }
      report.status = 'complete';
    } catch (error) {
      report.status = 'failed';
      report.error =
        error instanceof AdtApiError
          ? { code: 'NATIVE_HTTP_ERROR', statusCode: error.statusCode }
          : { code: 'NATIVE_CHECK_FAILED' };
      report.error.message = error instanceof Error ? error.message.slice(0, 4096) : 'Non-Error failure';
      failure = error;
    }
  },
});
console.log(
  JSON.stringify({
    mode,
    status: report.status,
    fixtures: report.fixtures.map((f: any) => ({ name: f.name, type: f.type, absent: f.absent })),
  }),
);
if (failure) process.exitCode = 1;
