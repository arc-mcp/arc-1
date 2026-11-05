import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const {
  checkRecoveryRequest,
  recoveryConfig,
  recoveryFixture,
  recoveryMetadataHash,
  recoverySourceHash,
  runDeclarativeRecovery,
} = await import('../../../scripts/qualification/pr1142/native-declarative-recovery-driver.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
// Native GET evidence, unlike the fault injection and transport/lock responses below.
const native = JSON.parse(
  readFileSync(new URL('../../fixtures/declarative-owners/failed-ddls-native-20261102.json', import.meta.url), 'utf8'),
) as { metadata: string; source: string; sourceSha256: string };
const owner = recoveryFixture.owner;
const HANDLE = 'RECOVERY-FIXTURE-LOCK';
const CONTEXT = 'RECOVERY-FIXTURE-CONTEXT';
const PASSWORD = 'RECOVERY-FIXTURE-PASSWORD';
const PRIVATE_ERROR = 'RECOVERY-PRIVATE-FAILURE';
const absent =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Resource does not exist.</message></exc:exception>';
type Call = { method: string; uri: URL; stateful: boolean; headers: Record<string, string>; body: unknown };
let calls: Call[], records: unknown[], unexpected: string[], fault: string;
let exists: boolean, locked: boolean, stopped: boolean, bindingBroken: boolean;
let outcome: Awaited<ReturnType<typeof runDeclarativeRecovery>> | undefined;
const deleting = () => calls.filter(({ method }) => method === 'DELETE');
const unlocking = () => calls.filter(({ uri }) => uri.searchParams.get('_action') === 'UNLOCK');
const closing = () => calls.filter(({ uri }) => uri.pathname.includes('/http/sessions'));
const underGuard = (stateful: boolean) => locked && !stateful;
beforeEach(() => {
  vi.resetAllMocks();
  resetCachedFeatures();
  setCachedFeatures({ ...featuresOff, systemType: 'onprem', abapRelease: '758' });
  calls = [];
  records = [];
  unexpected = [];
  fault = '';
  outcome = undefined;
  exists = true;
  locked = false;
  stopped = false;
  bindingBroken = false;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const uri = new URL(String(url)),
      method = init.method ?? 'GET';
    const headers = init.headers ?? {};
    const stateful = headers['X-sap-adt-sessiontype'] === 'stateful';
    calls.push({ method, uri, stateful, headers, body: init.body });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'fixture-csrf' });
    if (uri.pathname.includes('/http/sessions')) return mockResponse(fault === 'close-fail' ? 500 : 200, '');
    if (uri.pathname.endsWith('/transportchecks')) {
      if (fault === 'recording-refused') return mockResponse(403, PRIVATE_ERROR);
      return mockResponse(
        200,
        '<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING/></DATA>',
      );
    }
    if (uri.pathname.endsWith('/inactiveobjects'))
      return mockResponse(
        200,
        `<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects">${fault === 'inventory-tail' ? recoveryFixture.name : ''}</i:inactiveObjects>`,
        { 'content-type': 'application/xml' },
      );
    if (uri.pathname === owner && uri.searchParams.get('_action') === 'LOCK') {
      locked = true;
      return mockResponse(200, `<DATA><LOCK_HANDLE>${HANDLE}</LOCK_HANDLE><CORRNR/><IS_LOCAL>X</IS_LOCAL></DATA>`, {
        'set-cookie': `sap-contextid=${CONTEXT}; Path=/`,
      });
    }
    if (uri.pathname === owner && uri.searchParams.get('_action') === 'UNLOCK') {
      if (fault === 'unlock-fail') return mockResponse(500, PRIVATE_ERROR);
      locked = false;
      return mockResponse(200, '');
    }
    if (uri.pathname === owner && method === 'DELETE') {
      if (fault === 'delete-network') throw new Error(PRIVATE_ERROR);
      if (fault === 'delete-typed-echo')
        return mockResponse(
          500,
          absent.replace('Resource does not exist.', `Request ${uri.pathname}?lockHandle=${HANDLE} failed.`),
        );
      if (fault === 'delete-503') return mockResponse(503, PRIVATE_ERROR);
      if (fault === 'delete-403') return mockResponse(403, PRIVATE_ERROR);
      exists = false;
      return fault === 'delete-success-echo' ? mockResponse(200, `Deleted using ${HANDLE}`) : mockResponse(204, '');
    }
    if ([owner, `${owner}/source/main`].includes(uri.pathname) && method === 'GET') {
      if (!exists) {
        if (fault === 'absence-untyped') return mockResponse(404, '<html>Not found</html>');
        if (fault === 'absence-forbidden') return mockResponse(403, absent);
        if (fault === 'absence-unavailable') return mockResponse(503, PRIVATE_ERROR);
        if (fault === 'absence-live') return mockResponse(200, native.metadata);
        return mockResponse(404, absent);
      }
      if (uri.pathname.endsWith('/source/main')) {
        if (underGuard(stateful) && fault === 'guard-stop') stopped = true;
        if (underGuard(stateful) && fault === 'guard-binding') bindingBroken = true;
        const drift = fault === 'source-changed' || (fault === 'guard-source' && underGuard(stateful));
        return mockResponse(200, drift ? `${native.source}// foreign change\n` : native.source, {
          'content-type': fault === 'source-media' ? 'text/html' : 'text/plain',
        });
      }
      let metadata = native.metadata;
      if (fault === 'active') metadata = metadata.replace('adtcore:version="inactive"', 'adtcore:version="active"');
      if (fault === 'foreign-author')
        metadata = metadata.replace('adtcore:changedBy="MARIAN"', 'adtcore:changedBy="OTHER"');
      if (fault === 'foreign-package') metadata = metadata.replaceAll('adtcore:name="$TMP"', 'adtcore:name="ZOTHER"');
      if (fault === 'metadata-changed' || (fault === 'guard-metadata' && underGuard(stateful)))
        metadata = metadata.replace('2026-11-02T18:55:55Z', '2026-11-02T18:55:56Z');
      return mockResponse(200, metadata, { 'content-type': 'application/vnd.sap.adt.ddlSource+xml' });
    }
    unexpected.push(`${method} ${uri.pathname}`);
    return mockResponse(599, 'unexpected request');
  });
});
afterEach(() => {
  expect(unexpected).toEqual([]);
  const persisted = JSON.stringify({ records, outcome });
  for (const secret of [HANDLE, CONTEXT, PASSWORD, PRIVATE_ERROR]) expect(persisted).not.toContain(secret);
  // All scenarios retain the cleanup-only contract, including observer bypasses such as session close.
  expect(
    calls.some(
      ({ method, uri }) =>
        method === 'PUT' || uri.pathname === '/sap/bc/adt/activation' || uri.pathname === owner.replace(/\/[^/]+$/, ''),
    ),
  ).toBe(false);
  for (const { uri } of calls) expect(uri.origin).toBe('https://a4h.marianzeis.de');
  vi.restoreAllMocks();
});
async function run() {
  const base = new AdtClient({
    baseUrl: 'https://a4h.marianzeis.de',
    client: '001',
    username: 'MARIAN',
    password: PASSWORD,
    safety: { ...defaultSafetyConfig(), ...recoveryConfig },
  });
  outcome = await runDeclarativeRecovery({
    base,
    record: (row) => records.push(row),
    verifySource: () => {
      if (bindingBroken) throw new Error(PRIVATE_ERROR);
    },
    shouldStop: () => stopped,
  });
  return outcome;
}
it('deletes only the captured inactive owner through the shared lock pipeline, then independently proves typed absence', async () => {
  expect(native.source).toBe(recoveryFixture.source);
  expect(native.sourceSha256).toBe(recoverySourceHash);
  await expect(run()).resolves.toMatchObject({
    failure: false,
    mutationAttempted: true,
    deleteAttempted: true,
    confirmedDeleted: true,
    cleanupConfirmed: true,
    remaining: [],
    inspectionRequired: [],
  });
  expect(records).toContainEqual(
    expect.objectContaining({
      snapshot: owner,
      receipt: expect.objectContaining({
        metadataHash: recoveryMetadataHash,
        sourceHash: recoverySourceHash,
        activeVerified: false,
      }),
    }),
  );
  expect(deleting()).toHaveLength(1);
  expect(unlocking()).toHaveLength(1);
  expect(closing()).toHaveLength(1);
  for (const call of [...deleting(), ...unlocking()]) {
    expect(call.stateful).toBe(true);
    expect(call.uri.searchParams.get('lockHandle')).toBe(HANDLE);
    expect(call.headers.Cookie).toContain(`sap-contextid=${CONTEXT}`);
  }
  const guardReads = calls.filter(
    (call) =>
      call.method === 'GET' &&
      !call.stateful &&
      calls.indexOf(call) > calls.findIndex((call) => call.uri.searchParams.get('_action') === 'LOCK') &&
      calls.indexOf(call) < calls.indexOf(deleting()[0]),
  );
  expect(guardReads.map((call) => call.uri.pathname)).toEqual([owner, `${owner}/source/main`]);
  const independentAbsence = calls.filter(
    (call) =>
      call.method === 'GET' && call.uri.pathname === owner && calls.indexOf(call) > calls.indexOf(unlocking()[0]),
  );
  expect(independentAbsence).toHaveLength(1);
  expect(independentAbsence[0].stateful).toBe(false);
  expect(independentAbsence[0].headers.Cookie ?? '').not.toContain(CONTEXT);
  expect(records).toContainEqual({ absence: owner, typed404: true });
});
it.each(['active', 'metadata-changed', 'foreign-author', 'foreign-package', 'source-changed', 'source-media'])(
  'refuses %s before acquiring a lock or sending a mutation',
  async (value) => {
    fault = value;
    await expect(run()).resolves.toMatchObject({
      failure: true,
      mutationAttempted: false,
      deleteAttempted: false,
      confirmedDeleted: false,
      remaining: [owner],
      inspectionRequired: [owner],
    });
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  },
);
it.each(['guard-metadata', 'guard-source', 'guard-stop', 'guard-binding'])(
  'refuses drift or cancellation appearing only in %s, but sends its own UNLOCK',
  async (value) => {
    fault = value;
    await expect(run()).resolves.toMatchObject({
      failure: true,
      mutationAttempted: true,
      deleteAttempted: false,
      confirmedDeleted: false,
      cleanupConfirmed: true,
      reason: 'delete-not-sent',
    });
    expect(deleting()).toHaveLength(0);
    expect(unlocking()).toHaveLength(1);
    expect(unlocking()[0].uri.searchParams.get('lockHandle')).toBe(HANDLE);
    expect(unlocking()[0].headers.Cookie).toContain(CONTEXT);
    expect(closing()).toHaveLength(1);
    expect(locked).toBe(false);
    expect(records).toContainEqual(expect.objectContaining({ stage: 'refused-before-send', method: 'DELETE' }));
  },
);
it('refuses unavailable native recording evidence before acquiring a lock', async () => {
  fault = 'recording-refused';
  await expect(run()).resolves.toMatchObject({
    failure: true,
    mutationAttempted: false,
    deleteAttempted: false,
    confirmedDeleted: false,
    remaining: [owner],
  });
  expect(calls.filter((call) => call.uri.pathname.endsWith('/transportchecks'))).toHaveLength(1);
  expect(calls.filter((call) => call.uri.searchParams.get('_action') === 'LOCK')).toHaveLength(0);
  expect(deleting()).toHaveLength(0);
});
it.each(['delete-403', 'delete-503', 'delete-network'])('does not retry or infer absence from %s', async (value) => {
  fault = value;
  await expect(run()).resolves.toMatchObject({
    failure: true,
    deleteAttempted: true,
    confirmedDeleted: false,
    remaining: [owner],
  });
  expect(deleting()).toHaveLength(1);
  expect(unlocking()).toHaveLength(1);
  expect(closing()).toHaveLength(1);
  expect(records).not.toContainEqual({ absence: owner, typed404: true });
});
it('omits a typed DELETE error echo from receipts without losing uncertainty or its own cleanup', async () => {
  fault = 'delete-typed-echo';
  await expect(run()).resolves.toMatchObject({
    failure: true,
    deleteAttempted: true,
    confirmedDeleted: false,
    cleanupConfirmed: true,
    reason: 'delete-unconfirmed',
    remaining: [owner],
    inspectionRequired: [owner],
  });
  expect(deleting()).toHaveLength(1);
  expect(unlocking()).toHaveLength(1);
  expect(closing()).toHaveLength(1);
  expect(locked).toBe(false);
  expect(records).toContainEqual({
    stage: 'error',
    method: 'DELETE',
    path: owner,
    name: 'AdtApiError',
    status: 500,
    bytes: expect.any(Number),
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
});
it('omits a successful DELETE response echo while retaining its nonsecret receipt and independent absence check', async () => {
  fault = 'delete-success-echo';
  await expect(run()).resolves.toMatchObject({ failure: false, confirmedDeleted: true, cleanupConfirmed: true });
  const receipt = records.find((row: any) => row.stage === 'response' && row.method === 'DELETE');
  expect(receipt).toEqual({
    stage: 'response',
    method: 'DELETE',
    path: owner,
    status: 200,
    bytes: Buffer.byteLength(`Deleted using ${HANDLE}`),
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(records).toContainEqual({ absence: owner, typed404: true });
  expect(deleting()).toHaveLength(1);
  expect(unlocking()).toHaveLength(1);
  expect(closing()).toHaveLength(1);
});
it.each(['unlock-fail', 'close-fail'])('keeps typed deletion separate from %s cleanup failure', async (value) => {
  fault = value;
  await expect(run()).resolves.toMatchObject({
    failure: true,
    deleteAttempted: true,
    confirmedDeleted: true,
    cleanupConfirmed: false,
    remaining: [],
    inspectionRequired: [owner],
    reason: 'deleted-cleanup-unconfirmed',
  });
  expect(deleting()).toHaveLength(1);
  expect(unlocking()).toHaveLength(1);
  expect(closing()).toHaveLength(1);
});
it.each(['absence-untyped', 'absence-forbidden', 'absence-unavailable', 'absence-live'])(
  'requires independent typed absence after DELETE despite %s',
  async (value) => {
    fault = value;
    await expect(run()).resolves.toMatchObject({
      failure: true,
      deleteAttempted: true,
      confirmedDeleted: false,
      cleanupConfirmed: true,
      remaining: [owner],
    });
    expect(deleting()).toHaveLength(1);
  },
);
it('keeps a dirty inactive inventory unresolved after typed owner absence', async () => {
  fault = 'inventory-tail';
  await expect(run()).resolves.toMatchObject({
    failure: true,
    confirmedDeleted: true,
    remaining: [],
    inspectionRequired: [owner],
    reason: 'inventory-contains-fixture',
  });
});
it('stops before even reading when cancellation or source binding already fails', async () => {
  stopped = true;
  await expect(run()).resolves.toMatchObject({ failure: true, mutationAttempted: false, reason: 'stopped' });
  stopped = false;
  bindingBroken = true;
  await expect(run()).resolves.toMatchObject({ failure: true, mutationAttempted: false, reason: 'source-binding' });
  expect(mockFetch).not.toHaveBeenCalled();
});
it.each([
  ['PUT', `${owner}/source/main?lockHandle=${HANDLE}`, recoveryFixture.source],
  ['POST', owner.replace(/\/[^/]+$/, ''), '<create/>'],
  ['POST', '/sap/bc/adt/activation?method=activate&preauditRequested=false', '<activate/>'],
  ['DELETE', `${owner}other?lockHandle=${HANDLE}`, undefined],
  ['DELETE', `${owner}?lockHandle=${HANDLE}&corrNr=ANY`, undefined],
  ['GET', `${owner}?version=active`, undefined],
  ['GET', `${owner}?sap-client=100`, undefined],
  ['GET', `https://a4h.marianzeis.de${owner}`, undefined],
  ['GET', '/sap/bc/adt/foreign', undefined],
  ['POST', `${owner}?_action=UNLOCK&lockHandle=${HANDLE}&extra=true`, undefined],
  ['POST', `${owner}?_action=LOCK&accessMode=MODIFY`, 'foreign body'],
])('rejects out-of-scope %s %s without any transport call', (method, path, body) => {
  expect(() => checkRecoveryRequest(method!, path!, body)).toThrow();
  expect(mockFetch).not.toHaveBeenCalled();
});
