// Root-only read worker. Deliberately import native client/dependency initialization only after source/input checks.
import { randomUUID } from 'node:crypto';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { retainedProfileForRoot } from './current-retained-profiles.mjs';
import { requireEvidence, sha, validateCurrentManifest } from './current-workflow-contract.mjs';
import { readCurrentCreationProof } from './current-workflow-creation-proof.mjs';
import { durable } from './durable-journal.mjs';
import { configuration, validateConfiguration } from './qualification-config.mjs';
import { verifyRunManifest } from './run-manifest.mjs';
import { assertSafeDiagnosticEnvironment, privateJson, safeFailure } from './safe-io.mjs';

assertSafeDiagnosticEnvironment();
validateConfiguration(configuration);
const [mode, name, attempt] = process.argv.slice(2);
requireEvidence(
  process.argv.slice(2).length === 3 &&
    ['preflight', 'identity', 'absence'].includes(mode!) &&
    /^[a-f0-9-]{36}$/.test(attempt ?? ''),
  'INVALID_CURRENT_NATIVE_ARGUMENTS',
);
const { root } = configuration;
const run = await verifyRunManifest(root);
const manifest = await privateJson(`${root}/fixture-manifest.json`);
const manifestSha256 = validateCurrentManifest(manifest, configuration, run.sourceRevision);
const profile = retainedProfileForRoot(root);
const retained = !!profile;
requireEvidence(retained || run.retained === undefined, 'RETAINED_FIXED_ROOT_REQUIRED');
if (retained) {
  profile.assertContext(profile.readHistory(), run, manifest, configuration);
  requireEvidence(mode !== 'preflight', 'RETAINED_USE_EXACT_IDENTITY_AND_ABSENCE_READS');
}
requireEvidence(
  mode === 'preflight' ? name === 'all' : manifest.fixtures.some((f: { name: string }) => f.name === name),
  'INVALID_CURRENT_NATIVE_SELECTION',
);
requireEvidence(
  process.env.TEST_SAP_URL === manifest.nativeUrl &&
    process.env.TEST_SAP_CLIENT === '001' &&
    process.env.TEST_SAP_INSECURE === 'false',
  'CURRENT_NATIVE_TARGET_MISMATCH',
);
const { getTestClient } = await import('../../../tests/integration/helpers.js');
const { getTransport } = await import('../../../src/adt/transport.js');
const { AdtApiError } = await import('../../../src/adt/errors.js');
const { DataResponseBudget } = await import('../../../src/adt/data-result-context.js');
const { RequestAttemptBudget } = await import('../../../src/adt/request-attempt-budget.js');
const { observeCurrentNative } = await import('./current-workflow-native-reads.mjs');
const client = getTestClient();
requireEvidence(
  client.username === configuration.actors[0]!.sapUser && client.sapClient === '001',
  'CURRENT_NATIVE_READER_MISMATCH',
);
const deadline = Date.now() + 60_000;
const options = {
  deadline,
  noReplay: true,
  retryTransientErrors: false,
  responseBudget: new DataResponseBudget(512 * 1024, 'current-pp-native-read', true),
  attemptBudget: new RequestAttemptBudget(32),
};
const proof = async () => {
  const current = await verifyRunManifest(root);
  if (retained) profile.assertContext(profile.readHistory(), current, manifest, configuration);
  requireEvidence(
    sha(await privateJson(`${root}/fixture-manifest.json`)) === manifestSha256 && Date.now() < deadline,
    'CURRENT_NATIVE_BINDING_OR_DEADLINE',
  );
};
const http = {
  get: async (path: string, headers?: Record<string, string>) => {
    await proof();
    try {
      const response = await client.http.get(path, { ...headers, 'Cache-Control': 'no-cache' }, options);
      requireEvidence(Buffer.byteLength(response.body) <= 512 * 1024, 'CURRENT_NATIVE_RESPONSE_BOUND');
      await durable(
        `${root}/current-native-body-${randomUUID()}.json`,
        { attempt, path, status: response.statusCode, body: response.body, sha256: sha(response.body) },
        true,
      );
      await proof();
      return response;
    } catch (error) {
      const nativeError = error instanceof AdtApiError ? error : undefined;
      await durable(
        `${root}/current-native-error-${randomUUID()}.json`,
        {
          attempt,
          path,
          status: nativeError?.statusCode ?? null,
          body:
            typeof nativeError?.responseBody === 'string' ? nativeError.responseBody.slice(0, 16384) : null,
        },
        true,
      );
      throw error;
    }
  },
};
const report: Record<string, unknown> = {
  runId: run.runId,
  sourceRevision: run.sourceRevision,
  manifestSha256,
  attempt,
  mode,
  startedAt: new Date().toISOString(),
  status: 'failed',
};
try {
  const observed = await observeCurrentNative({
    manifest,
    mode,
    name,
    http,
    proveCreatedOwner: (fixture: { name: string; type: string; actor: string; package: string }) =>
      retained && (fixture.type === 'INCL' || profile.textOnly)
        ? profile.readHistory().proofs[fixture.name]
        : readCurrentCreationProof({ root, run, manifest, fixture }),
    readTransport: (id: string) =>
      getTransport(http as unknown as AdtHttpClient, { ...client.safety, allowWrites: false }, id, options),
  });
  if (
    retained &&
    mode === 'identity' &&
    manifest.fixtures.some((f: { name: string; type: string }) => f.name === name && f.type !== 'PROG')
  )
    profile.assertObservation(
      profile.readHistory(),
      manifest.fixtures.find((f: { name: string }) => f.name === name),
      observed,
      'currentJournalObservation' in profile && profile.currentJournalObservation
        ? { journal: await privateJson(`${root}/current-workflow-result.json`), run, manifest }
        : undefined,
    );
  Object.assign(report, observed);
  await proof();
  report.status = 'complete';
} catch (error) {
  report.error = safeFailure(error);
  process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
await durable(`${root}/current-native-${mode}-${name}-${attempt}.json`, report, true);
