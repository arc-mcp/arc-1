import assert from 'node:assert/strict';
import { deleteObject, withLockedMutation } from '../../../src/adt/crud.js';
import { AdtApiError, classifySapDomainError, extractExceptionType } from '../../../src/adt/errors.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { mutationHttp } from '../../../src/adt/mutation-http.js';
import { pinnedRecording, validatePinnedLock } from '../../../src/adt/pinned-write-policy.js';
import { parseXml } from '../../../src/adt/xml-parser.js';
import { getTestClient } from '../../../tests/integration/helpers.js';
import { durable } from './durable-journal.mjs';
import { actors, digest, ownerOf, root, target, validateFixtures } from './fixture-contract.mjs';
import { configuration, validateConfiguration } from './qualification-config.mjs';
import { verifyRunManifest } from './run-manifest.mjs';
import { assertSafeDiagnosticEnvironment, privateJson } from './safe-io.mjs';

assertSafeDiagnosticEnvironment();
validateConfiguration(configuration);
await verifyRunManifest(configuration.root);

assert.equal(process.env.TEST_SAP_URL, 'https://a4h.marianzeis.de');
assert.equal(process.env.TEST_SAP_CLIENT, '001');
assert.equal(process.env.TEST_SAP_INSECURE, 'false');
const [mode, name] = process.argv.slice(2);
assert.ok(['preflight', 'identity', 'unchanged', 'absence', 'cleanup'].includes(mode));
const manifest = await privateJson(`${root}/fixture-manifest.json`);
const manifestSha256 = validateFixtures(manifest);
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
const headers = { 'Cache-Control': 'no-cache' };
const absenceEvidence = new Map<string, unknown>();
async function absent(fixture: any, active = http) {
  try {
    await active.get(ownerOf(fixture), headers, options);
    return false;
  } catch (error) {
    if (error instanceof AdtApiError && error.statusCode === 404)
      absenceEvidence.set(fixture.name, {
        statusCode: 404,
        exceptionType: extractExceptionType(error.responseBody ?? '') ?? null,
        classifiedServiceError: Boolean(classifySapDomainError(error.statusCode, error.responseBody, error.path)),
      });
    if (
      error instanceof AdtApiError &&
      error.statusCode === 404 &&
      extractExceptionType(error.responseBody ?? '') === 'ExceptionResourceNotFound' &&
      !classifySapDomainError(error.statusCode, error.responseBody, error.path)
    )
      return true;
    throw error;
  }
}
async function identity(fixture: any, active = http) {
  const owner = ownerOf(fixture);
  const metadata = parseXml((await active.get(owner, headers, options)).body)[
    fixture.type === 'CLAS' ? 'abapClass' : 'abapInterface'
  ] as Record<string, any>;
  const actor = actors.find((a) => a.label === fixture.actor)!;
  assert.equal(metadata?.['@_name'], fixture.name);
  assert.equal(metadata.packageRef?.['@_name'], '$TMP');
  assert.equal(metadata['@_createdBy'], actor.sapUser);
  assert.ok(metadata['@_createdAt']);
  assert.equal(metadata['@_version'], 'active');
  assert.equal(metadata['@_changedBy'], actor.sapUser);
  assert.equal(metadata['@_masterSystem'], 'A4H');
  const current = (await active.get(`${owner}/source/main`, headers, options)).body;
  const activated = (await active.get(`${owner}/source/main?version=active`, headers, options)).body;
  assert.ok(current.includes(manifest.marker));
  assert.ok(activated.includes(manifest.marker));
  assert.equal(digest(current), digest(activated), 'Unexpected inactive draft; preserve it');
  return {
    name: fixture.name,
    type: fixture.type,
    package: '$TMP',
    version: metadata['@_version'],
    masterSystem: metadata['@_masterSystem'],
    createdBy: metadata['@_createdBy'],
    createdAt: metadata['@_createdAt'],
    changedBy: metadata['@_changedBy'] ?? null,
    changedAt: metadata['@_changedAt'] ?? null,
    description: metadata['@_description'] ?? null,
    sourceSha256: digest(current),
    activeSourceSha256: digest(activated),
  };
}
const report: any = {
  mode,
  at: new Date().toISOString(),
  nativeUrl: manifest.nativeUrl,
  client: '001',
  nativeReader: actors[0].sapUser,
  manifestSha256,
  fixtures: [],
};
const path = `${root}/native-${mode}${name ? `-${name}` : ''}.json`;
await durable(path, { ...report, status: 'in-progress' }, true);
let failure: unknown;
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
      const preflight = await privateJson(`${root}/native-preflight.json`);
      assert.equal(preflight.manifestSha256, manifestSha256);
      assert.equal(preflight.fixtures.find((f: any) => f.name === fixture.name)?.absent, true);
      result.alreadyAbsent = await absent(fixture);
      if (!result.alreadyAbsent) {
        const receipt = await privateJson(`${root}/native-identity-${fixture.name}.json`);
        assert.equal(receipt.manifestSha256, manifestSha256);
        assert.equal(receipt.status, 'complete');
        const owned = receipt.fixtures.find((f: any) => f.name === fixture.name)?.identity;
        assert.ok(owned, 'Never clean up an object without its independent ownership receipt');
        assert.deepEqual(await identity(fixture), owned, 'Fixture changed; preserve foreign work');
        const owner = ownerOf(fixture);
        const recording = await pinnedRecording(http, client.safety, owner, '$TMP', '', undefined, options);
        result.cleanupAttempted = true;
        await durable(path, report);
        await withLockedMutation(
          client.http,
          client.safety,
          context,
          owner,
          {
            beforeLock: () => {},
            validateLock: async (session, lock) => {
              const fresh = await pinnedRecording(session, client.safety, owner, '$TMP', '', undefined, options);
              assert.equal(fresh.local, recording.local);
              assert.equal(fresh.request, recording.request);
              await validatePinnedLock(session, client.safety, lock, fresh, options);
              assert.deepEqual(
                await identity(fixture, session),
                owned,
                'Fixture changed under lock; preserve foreign work',
              );
            },
          },
          async (session, lock) => {
            await deleteObject(session, client.safety, owner, lock.lockHandle);
          },
        );
        result.cleanupState = context.cleanup;
        assert.equal(context.cleanup.unlockFailed, false, 'Cleanup unlock failed');
      }
      result.absent = await absent(fixture);
      assert.equal(result.absent, true);
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
  failure = error;
} finally {
  report.absenceEvidence = Object.fromEntries(absenceEvidence);
  report.finishedAt = new Date().toISOString();
  await durable(path, report);
}
console.log(
  JSON.stringify({
    mode,
    status: report.status,
    fixtures: report.fixtures.map((f: any) => ({ name: f.name, type: f.type, absent: f.absent })),
  }),
);
if (failure) process.exitCode = 1;
