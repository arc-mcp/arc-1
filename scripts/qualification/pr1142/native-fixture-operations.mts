import assert from 'node:assert/strict';
import { deleteObject, withLockedMutation } from '../../../src/adt/crud.js';
import { AdtApiError, classifySapDomainError, extractExceptionType } from '../../../src/adt/errors.js';
import { pinnedRecording, validatePinnedLock } from '../../../src/adt/pinned-write-policy.js';
import { parseXml } from '../../../src/adt/xml-parser.js';
import { digest, ownerOf } from './fixture-contract.mjs';
import { includeKinds } from './include-qualification.mjs';

const headers = { 'Cache-Control': 'no-cache' };

export async function nativeAbsent(fixture: any, http: any, options: any, observe: (value: any) => void) {
  try {
    await http.get(ownerOf(fixture), headers, options);
    return false;
  } catch (error) {
    if (error instanceof AdtApiError && error.statusCode === 404) {
      const evidence = {
        statusCode: 404,
        exceptionType: extractExceptionType(error.responseBody ?? '') ?? null,
        classifiedServiceError: Boolean(classifySapDomainError(error.statusCode, error.responseBody, error.path)),
      };
      observe(evidence);
      if (evidence.exceptionType === 'ExceptionResourceNotFound' && !evidence.classifiedServiceError) return true;
    }
    throw error;
  }
}

/** Capture actual native fields before assertions so a failed identity check remains diagnosable. */
export async function nativeIdentity({ fixture, actor, marker, http, options, observe, expectedIncludes }: any) {
  const owner = ownerOf(fixture);
  const metadata = parseXml((await http.get(owner, headers, options)).body)[
    fixture.type === 'CLAS' ? 'abapClass' : 'abapInterface'
  ] as Record<string, any> | undefined;
  const identity: any = {
    name: metadata?.['@_name'] ?? null,
    type: fixture.type,
    package: metadata?.packageRef?.['@_name'] ?? null,
    version: metadata?.['@_version'] ?? null,
    masterSystem: metadata?.['@_masterSystem'] ?? null,
    createdBy: metadata?.['@_createdBy'] ?? null,
    createdAt: metadata?.['@_createdAt'] ?? null,
    changedBy: metadata?.['@_changedBy'] ?? null,
    changedAt: metadata?.['@_changedAt'] ?? null,
    description: metadata?.['@_description'] ?? null,
    sourceSha256: null as string | null,
    activeSourceSha256: null as string | null,
  };
  await observe(structuredClone(identity));
  assert.equal(identity.name, fixture.name, 'Native object name differs');
  assert.equal(identity.package, '$TMP', 'Native package differs');
  assert.equal(identity.createdBy, actor.sapUser, 'Native creator differs');
  assert.ok(identity.createdAt, 'Native creation timestamp missing');
  assert.equal(identity.version, 'active', 'Native metadata is not active');
  assert.equal(identity.changedBy, actor.sapUser, 'Native last changer differs');
  assert.equal(identity.masterSystem, 'A4H', 'Native master system differs');
  const current = (await http.get(`${owner}/source/main`, headers, options)).body;
  const activated = (await http.get(`${owner}/source/main?version=active`, headers, options)).body;
  identity.sourceSha256 = digest(current);
  identity.activeSourceSha256 = digest(activated);
  await observe(structuredClone(identity));
  assert.ok(current.includes(marker), 'Current source marker missing');
  assert.ok(activated.includes(marker), 'Active source marker missing');
  assert.equal(identity.sourceSha256, identity.activeSourceSha256, 'Unexpected inactive draft; preserve it');
  if (expectedIncludes !== undefined) {
    assert.equal(fixture.type, 'CLAS');
    assert.equal(expectedIncludes.complete, true, 'Include qualification is incomplete');
    assert.deepEqual(Object.keys(expectedIncludes.kinds).sort(), [...includeKinds].sort());
    identity.includes = {};
    for (const include of includeKinds) {
      const expected = expectedIncludes.kinds[include];
      assert.equal(expected.complete, true);
      assert.match(expected.sourceHash, /^[a-f0-9]{64}$/);
      const path = `${owner}/includes/${include}`;
      const current = (await http.get(path, { ...headers, Accept: 'text/plain' }, options)).body;
      const active = (await http.get(`${path}?version=active`, { ...headers, Accept: 'text/plain' }, options)).body;
      const hashes = { sourceSha256: digest(current), activeSourceSha256: digest(active) };
      identity.includes[include] = hashes;
      await observe(structuredClone(identity));
      assert.equal(hashes.sourceSha256, expected.sourceHash, 'Native include differs from PP read-back');
      assert.equal(hashes.activeSourceSha256, expected.sourceHash, 'Inactive or changed include; preserve it');
    }
  }
  return identity;
}

/** The actual native-worker cleanup path, with injectable I/O for offline refusal tests. */
export async function cleanupNativeFixture({
  fixture,
  manifestSha256,
  load,
  absent,
  identity,
  http,
  client,
  context,
  options,
  attempted,
}: any) {
  const preflight = await load('native-preflight.json');
  assert.equal(preflight.manifestSha256, manifestSha256);
  assert.equal(preflight.fixtures.find((f: any) => f.name === fixture.name)?.absent, true);
  const result: any = { alreadyAbsent: await absent(fixture) };
  if (!result.alreadyAbsent) {
    const receipt = await load(`native-identity-${fixture.name}.json`);
    assert.equal(receipt.manifestSha256, manifestSha256);
    assert.equal(receipt.status, 'complete');
    const owned = receipt.fixtures.find((f: any) => f.name === fixture.name)?.identity;
    assert.ok(owned, 'Never clean up an object without its independent ownership receipt');
    assert.deepEqual(await identity(fixture), owned, 'Fixture changed; preserve foreign work');
    const owner = ownerOf(fixture);
    const recording = await pinnedRecording(http, client.safety, owner, '$TMP', '', undefined, options);
    await attempted();
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
  assert.equal(result.absent, true, 'Native absence not confirmed after cleanup');
  return result;
}
