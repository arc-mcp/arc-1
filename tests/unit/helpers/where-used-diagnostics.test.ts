import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { recordWhereUsed } from '../../helpers/where-used-diagnostics.js';

const root = 'ZAR1018_ROOT_TEST';
const consumer = 'ZAR1018_USE_TEST';
const rootUri = `/sap/bc/adt/oo/classes/${root.toLowerCase()}`;
const base = '/sap/bc/adt/repository/informationsystem/usageReferences';
const path = `${base}?uri=${encodeURIComponent(rootUri)}`;
const scopePath = `${base}/scope?uri=${encodeURIComponent(rootUri)}`;
const request = '<usageReferenceRequest/>';
const scopeRequest = '<usageScopeRequest/>';
const refs = (name: string) =>
  `<u:usageReferenceResult xmlns:u="http://www.sap.com/adt/ris/usageReferences" numberOfResults="1"><u:referencedObject uri="/sap/bc/adt/oo/classes/${name.toLowerCase()}" isResult="true"><u:adtObject name="${name}" type="CLAS/OC"><packageRef name="$TMP"/></u:adtObject></u:referencedObject></u:usageReferenceResult>`;
const response = (body: string) => ({
  body,
  statusCode: 200,
  headers: { 'set-cookie': 'SECRET_COOKIE' },
  notModified: false,
});
let directory: string;
let artifactPath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arc1-where-used-evidence-'));
  artifactPath = join(directory, 'evidence.json');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(directory, { recursive: true, force: true });
});

function setup(xml = refs(root), output = artifactPath) {
  const post = vi.fn<AdtHttpClient['post']>().mockResolvedValue(response(xml));
  const http: Pick<AdtHttpClient, 'post'> = { post };
  const recorder = recordWhereUsed(http, { root, consumer, activatedAt: Date.now() - 100, artifactPath: output });
  return { http, post, recorder };
}
const readArtifact = () => JSON.parse(readFileSync(artifactPath, 'utf8'));

it('captures the original ordinary/scoped mismatch without changing requests or the failing assertion', async () => {
  const { http, post, recorder } = setup();
  post
    .mockResolvedValueOnce(response(refs(consumer)))
    .mockResolvedValueOnce(response('<usageScopeResult/>'))
    .mockResolvedValueOnce(response(refs(root)));
  const ordinary = await http.post(path, request);
  recorder.recordResult('ordinary', { references: [{ name: consumer, type: 'CLAS/OC', packageName: '$TMP' }] });
  recorder.phase = 'scoped';
  await http.post(scopePath, scopeRequest);
  const scoped = await http.post(path, request);
  recorder.recordResult('scoped', { references: [{ name: root }] });
  recorder.restore();
  let failure: unknown;
  try {
    expect(scoped.body).toContain(consumer);
  } catch (error) {
    failure = error;
    recorder.writeFailure();
  }
  expect(failure).toBeInstanceOf(Error);
  expect(ordinary.body).toContain(consumer);
  expect(post.mock.calls).toEqual([
    [path, request],
    [scopePath, scopeRequest],
    [path, request],
  ]);
  expect(http.post).toBe(post);
  const artifact = readArtifact();
  expect(artifact.exchanges.map((entry: any) => entry.phase)).toEqual(['ordinary', 'scoped', 'scoped']);
  expect(artifact.exchanges.map((entry: any) => entry.response.rawStringEvidence.consumerPresent)).toEqual([
    true,
    false,
    false,
  ]);
  expect(artifact.handlerRows).toEqual({
    ordinary: [{ name: consumer, type: 'CLAS/OC', packageName: '$TMP' }],
    scoped: [{ name: root }],
  });
});

it('preserves response identity, receiver, options and UTC/activation-relative times', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T20:00:00Z'));
  const { http, post, recorder } = setup();
  const reply = response(refs(consumer));
  post.mockImplementation(async function (this: unknown) {
    expect(this).toBe(http);
    vi.setSystemTime(Date.now() + 20);
    return reply;
  });
  const headers = { authorization: 'SECRET_AUTH' };
  const options = { deadline: Date.now() + 2000 };
  expect(await http.post(path, request, 'application/xml', headers, options)).toBe(reply);
  expect(post).toHaveBeenCalledExactlyOnceWith(path, request, 'application/xml', headers, options);
  recorder.restore();
  recorder.writeFailure();
  expect(readArtifact().exchanges[0]).toMatchObject({
    startedUtc: '2026-10-21T20:00:00.000Z',
    finishedUtc: '2026-10-21T20:00:00.020Z',
    startedMsAfterActivation: 100,
    finishedMsAfterActivation: 120,
  });
  expect(readFileSync(artifactPath, 'utf8')).not.toMatch(/SECRET_AUTH|SECRET_COOKIE|authorization|set-cookie/);
});

it('retains nested/prefixed/repeated XML nodes and distinguishes raw string evidence from handler rows', async () => {
  const xml = `<u:usageReferenceResult xmlns:u="http://www.sap.com/adt/ris/usageReferences"><u:referencedObject uri="/parent"><u:adtObject name="${root}"/><u:referencedObject parentUri="/parent" uri="/method" canHaveChildren="true" usageInformation="gradeComponent,includeProductive"><u:adtObject name="CALCULATE"/></u:referencedObject></u:referencedObject><u:referencedObject><u:adtObject name="${consumer}"/></u:referencedObject></u:usageReferenceResult>`;
  const { http, recorder } = setup(xml);
  await http.post(path, request);
  recorder.recordResult('ordinary', { references: [] });
  recorder.restore();
  recorder.writeFailure();
  const entry = readArtifact().exchanges[0];
  expect(entry.response.rawStringEvidence).toEqual({
    rootPresent: true,
    consumerPresent: true,
    referencedObjectOpeningTags: 3,
  });
  expect(readArtifact().handlerRows.ordinary).toEqual([]);
  const nodes = entry.response.sanitizedTree[0]['u:usageReferenceResult'];
  expect(nodes).toHaveLength(2);
  expect(nodes[0]['u:referencedObject'][1]['u:referencedObject'][0]['u:adtObject']).toEqual([]);
  expect(nodes[0][':@']['@_uri']).toBe(nodes[0]['u:referencedObject'][1][':@']['@_parentUri']);
  expect(nodes[0]['u:referencedObject'][1][':@']['@_usageInformation']).toBe('gradeComponent,includeProductive');
});

it('defaults unknown values to artifact-local HMAC markers, including opaque/encoded values', async () => {
  const xml = `<u:usageScopeResult xmlns:u="http://www.sap.com/adt/ris/usageReferences" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:responsible="SECRET_USER" user="SECRET_USER" client="SECRET_CLIENT" sid="SECRET_SID" resultDescription="SECRET_SYSTEM"><u:payload>SECRET_PAYLOAD</u:payload><u:objectIdentifier>SECRET_TOKEN</u:objectIdentifier><u:grade definitions="false" indirectReferences="true"/><u:programs><program name="SECRET_PROGRAM" isSelected="true"/></u:programs><u:objectTypes><type name="CLAS/OC" isSelected="true"/></u:objectTypes><unknown uri="https://SECRET_HOST/private">SECRET_&#85;SER</unknown></u:usageScopeResult>`;
  const { http, recorder } = setup(xml);
  await http.post(scopePath, scopeRequest);
  await http.post(path, xml.replaceAll('usageScopeResult', 'usageReferenceRequest'));
  recorder.recordResult('scoped', {
    references: [
      { name: consumer, description: 'SECRET_DESCRIPTION', uri: 'https://SECRET_HOST/private' },
      { name: 'SECRET_FOREIGN' },
    ],
  });
  recorder.restore();
  recorder.writeFailure();
  const serialized = readFileSync(artifactPath, 'utf8');
  expect(serialized).not.toContain('SECRET_');
  expect(serialized).not.toMatch(/\bkey\b|valueLength/);
  const artifact = readArtifact();
  const scope = artifact.exchanges[0].response.sanitizedTree[0]['u:usageScopeResult'];
  const echoed = artifact.exchanges[1].request.sanitizedTree[0]['u:usageReferenceRequest'];
  expect(scope[0]['u:payload'].redacted).toMatch(/^\[redacted:[a-f0-9]{64}\]$/);
  expect(scope[0]['u:payload'].valueBytes).toBe(Buffer.byteLength('SECRET_PAYLOAD'));
  expect(scope[0]['u:payload']).toEqual(echoed[0]['u:payload']);
  expect(scope[1]['u:objectIdentifier'].valueBytes).toBe(Buffer.byteLength('SECRET_TOKEN'));
  expect(scope[1]['u:objectIdentifier']).toEqual(echoed[1]['u:objectIdentifier']);
  expect(artifact.exchanges[0].response.sanitizedTree[0][':@']['@_user']).toMatch(/^\[redacted:[a-f0-9]{64}\]$/);
  expect(artifact.exchanges[0].response.sanitizedTree[0][':@']['@_adtcore:responsible']).toBe(
    artifact.exchanges[0].response.sanitizedTree[0][':@']['@_user'],
  );
  expect(scope[2][':@']).toEqual({ '@_definitions': 'false', '@_indirectReferences': 'true' });
  expect(scope[3]['u:programs'][0][':@']['@_isSelected']).toBe('true');
  expect(scope[4]['u:objectTypes'][0][':@']['@_name']).toBe('CLAS/OC');
  const second = setup(xml);
  await second.http.post(scopePath, scopeRequest);
  second.recorder.restore();
  second.recorder.writeFailure();
  expect(readArtifact().exchanges[0].response.hmac).not.toBe(artifact.exchanges[0].response.hmac);
});

it('records only the first three matching owned POSTs and leaves later traffic unchanged', async () => {
  const { http, post, recorder } = setup();
  for (const other of [
    '/sap/bc/adt/discovery',
    `${base}/other?uri=${encodeURIComponent(rootUri)}`,
    `${base}?uri=%2Fforeign`,
    `https://SECRET_HOST${path}`,
  ])
    await http.post(other, request);
  for (let index = 0; index < 4; index++) await http.post(`${path}&sap-client=SECRET_CLIENT`, request);
  recorder.restore();
  recorder.writeFailure();
  expect(post).toHaveBeenCalledTimes(8);
  expect(readArtifact().exchanges).toHaveLength(3);
  expect(readArtifact().exchanges.map((entry: any) => entry.path)).toEqual([base, base, base]);
  expect(readFileSync(artifactPath, 'utf8')).not.toContain('SECRET_');
});

it.each([
  ['malformed-xml', '<usageReferenceResult>'],
  ['unknown-xml', '<html>SECRET_PAGE</html>'],
  ['body-limit', `<usageReferenceResult>${'ü'.repeat(33000)}</usageReferenceResult>`],
  ['sanitized-limit', `<usageReferenceResult>${'<n>x</n>'.repeat(2000)}</usageReferenceResult>`],
])('omits unsafe or oversized body evidence (%s)', async (reason, xml) => {
  const { http, recorder } = setup(xml);
  await http.post(path, request);
  recorder.restore();
  recorder.writeFailure();
  const body = readArtifact().exchanges[0].response;
  expect(body.omitted).toBe(reason);
  expect(body.bytes).toBe(Buffer.byteLength(xml, 'utf8'));
  expect(body).not.toHaveProperty('raw');
  expect(body).not.toHaveProperty('sanitizedTree');
});

it('preserves the original rejection and does not serialize its message, body or stack', async () => {
  const { http, post, recorder } = setup();
  const failure = Object.assign(new Error('SECRET_ERROR'), { responseBody: 'SECRET_BODY' });
  post.mockRejectedValueOnce(failure);
  await expect(http.post(path, request)).rejects.toBe(failure);
  recorder.restore();
  recorder.writeFailure();
  expect(readArtifact().exchanges[0].rejected).toBe(true);
  expect(readFileSync(artifactPath, 'utf8')).not.toContain('SECRET_');
});

it('still returns the same response if recording that response throws', async () => {
  const { http, post, recorder } = setup();
  const reply = response('');
  Object.defineProperty(reply, 'body', {
    get() {
      throw new Error('SECRET_CAPTURE_FAILURE');
    },
  });
  post.mockResolvedValueOnce(reply);
  expect(await http.post(path, request)).toBe(reply);
  recorder.restore();
  recorder.writeFailure();
  expect(readArtifact().exchanges[0]).not.toHaveProperty('response');
  expect(readFileSync(artifactPath, 'utf8')).not.toContain('SECRET_');
});

it('does not replace a test failure when writing evidence fails', () => {
  const blocker = join(directory, 'blocker');
  writeFileSync(blocker, 'file');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { recorder } = setup(undefined, join(blocker, 'evidence.json'));
  recorder.restore();
  const originalFailure = new Error('original assertion');
  let caught: unknown;
  try {
    try {
      throw originalFailure;
    } finally {
      recorder.writeFailure();
    }
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(originalFailure);
  expect(warning).toHaveBeenLastCalledWith('Where-used diagnostic artifact could not be written.');
});

it('removes stale artifacts and creates none on a passing path', async () => {
  writeFileSync(artifactPath, 'stale');
  const { http, recorder, post } = setup();
  await http.post(path, request);
  recorder.restore();
  expect(existsSync(artifactPath)).toBe(false);
  expect(post).toHaveBeenCalledExactlyOnceWith(path, request);
});
