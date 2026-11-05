import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

vi.mock('dotenv', () => {
  throw new Error('Recovery-driver tests must not initialize dotenv.');
});

const { checkV3RecoveryRequest: checkRecoveryRequest, runV3DeclarativeRecovery: runDeclarativeRecovery } = await import(
  '../../../scripts/qualification/pr1142/native-declarative-v3-recovery-driver.js'
);
const { recoveryConfig } = await import('../../../scripts/qualification/pr1142/native-declarative-recovery-driver.js');
const {
  v3RecoveryFixture: recoveryFixture,
  v3RecoveryFixtures,
  v3RetainedHashes,
} = await import('../../../scripts/qualification/pr1142/native-declarative-v3-recovery-fixed.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
// Native GET evidence, unlike the fault injection and transport/lock responses below.
const native = JSON.parse(
  readFileSync(new URL('../../fixtures/declarative-owners/failed-v3-ddls-20261102.json', import.meta.url), 'utf8'),
) as { metadata: string; activeMetadata: string };
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
let postDeleteOwnerReads: number;
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
  postDeleteOwnerReads = 0;
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
    if (uri.pathname.endsWith('/inactiveobjects')) {
      if (fault === 'tail-binding-inventory') bindingBroken = true;
      return mockResponse(
        200,
        `<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects">${fault === 'inventory-tail' ? recoveryFixture.name : ''}</i:inactiveObjects>`,
        { 'content-type': 'application/xml' },
      );
    }
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
    if (v3RecoveryFixtures.slice(1).some((other) => other.owner === uri.pathname) && method === 'GET') {
      if (
        !exists &&
        fault === `tail-binding-other-${v3RecoveryFixtures.findIndex((other) => other.owner === uri.pathname)}`
      )
        bindingBroken = true;
      if (
        fault === 'other-present' ||
        (fault === 'guard-other' && underGuard(stateful)) ||
        (fault === 'tail-other' && !exists)
      )
        return mockResponse(200, '<present/>');
      if (fault === 'other-untyped') return mockResponse(404, '<html>missing</html>');
      if (fault === 'other-forbidden') return mockResponse(403, absent);
      return mockResponse(404, absent);
    }
    if ([owner, `${owner}/source/main`].includes(uri.pathname) && method === 'GET') {
      if (!exists) {
        if (++postDeleteOwnerReads === 2 && fault === 'tail-binding-owner') bindingBroken = true;
        if (fault === 'absence-untyped') return mockResponse(404, '<html>Not found</html>');
        if (fault === 'absence-forbidden') return mockResponse(403, absent);
        if (fault === 'absence-unavailable') return mockResponse(503, PRIVATE_ERROR);
        if (fault === 'absence-live') return mockResponse(200, native.metadata);
        return mockResponse(404, absent);
      }
      if (uri.pathname.endsWith('/source/main')) {
        if (underGuard(stateful) && fault === 'guard-stop') stopped = true;
        if (underGuard(stateful) && fault === 'guard-binding') bindingBroken = true;
        const active = uri.searchParams.get('version') === 'active';
        const expected = active ? recoveryFixture.source : recoveryFixture.updatedSource;
        const drift =
          (active && fault === 'active-source') ||
          (!active && fault === 'inactive-source') ||
          (underGuard(stateful) && fault === (active ? 'guard-active-source' : 'guard-inactive-source'));
        return mockResponse(200, drift ? `${expected}// foreign change\n` : expected, {
          'content-type': fault === 'source-media' ? 'text/html' : 'text/plain',
        });
      }
      const active = uri.searchParams.get('version') === 'active';
      let metadata = active ? native.activeMetadata : native.metadata;
      if (!active && fault === 'default-active')
        metadata = metadata.replace('adtcore:version="inactive"', 'adtcore:version="active"');
      if (active && fault === 'active-inactive')
        metadata = metadata.replace('adtcore:version="active"', 'adtcore:version="inactive"');
      if (fault === 'foreign-author')
        metadata = metadata.replace('adtcore:changedBy="MARIAN"', 'adtcore:changedBy="OTHER"');
      if (fault === 'foreign-package') metadata = metadata.replaceAll('adtcore:name="$TMP"', 'adtcore:name="ZOTHER"');
      if (fault === 'metadata-changed' || (fault === 'guard-metadata' && underGuard(stateful)))
        metadata = metadata.replace('adtcore:masterLanguage="EN"', 'adtcore:masterLanguage="DE"');
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
it('deletes exactly the retained dual-version owner with fresh five-owner absence under its own session and final independent checks', async () => {
  await expect(run()).resolves.toMatchObject({
    failure: false,
    deleteAttempted: true,
    confirmedDeleted: true,
    cleanupConfirmed: true,
    remaining: [],
    inspectionRequired: [],
  });
  expect(deleting()).toHaveLength(1);
  expect(unlocking()).toHaveLength(1);
  expect(closing()).toHaveLength(1);
  for (const call of [...deleting(), ...unlocking()]) {
    expect(call.stateful).toBe(true);
    expect(call.uri.searchParams.get('lockHandle')).toBe(HANDLE);
    expect(call.headers.Cookie).toContain(CONTEXT);
  }
  expect(records).toContainEqual({ retainedVersions: owner, ...v3RetainedHashes, otherOwnersAbsent: 5 });
  const start = calls.findIndex((call) => call.uri.searchParams.get('_action') === 'LOCK');
  const guard = calls
    .slice(start + 1, calls.indexOf(deleting()[0]))
    .filter((call) => call.method === 'GET' && !call.stateful)
    .map((call) => {
      const uri = new URL(call.uri);
      expect(uri.searchParams.get('sap-client')).toBe('001');
      expect(uri.searchParams.get('sap-language')).toBe('EN');
      uri.searchParams.delete('sap-client');
      uri.searchParams.delete('sap-language');
      return uri.pathname + uri.search;
    });
  expect(guard).toEqual([
    owner,
    `${owner}/source/main?version=inactive`,
    `${owner}?version=active`,
    `${owner}/source/main?version=active`,
    ...v3RecoveryFixtures.slice(1).map((row) => row.owner),
  ]);
  expect(records).toContainEqual({ absence: owner, typed404: true });
  for (const other of v3RecoveryFixtures.slice(1))
    expect(records.filter((row: any) => row.absence === other.owner)).toHaveLength(3);
});
it.each([
  'default-active',
  'active-inactive',
  'metadata-changed',
  'foreign-author',
  'foreign-package',
  'active-source',
  'inactive-source',
  'source-media',
  'other-present',
  'other-untyped',
  'other-forbidden',
])('refuses %s before locking or deleting', async (value) => {
  fault = value;
  await expect(run()).resolves.toMatchObject({
    failure: true,
    mutationAttempted: false,
    deleteAttempted: false,
    confirmedDeleted: false,
    remaining: [owner],
  });
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});
it.each([
  'guard-metadata',
  'guard-active-source',
  'guard-inactive-source',
  'guard-other',
  'guard-stop',
  'guard-binding',
])('retains the owner after %s and always releases its own lock', async (value) => {
  fault = value;
  await expect(run()).resolves.toMatchObject({
    failure: true,
    deleteAttempted: false,
    confirmedDeleted: false,
    cleanupConfirmed: true,
  });
  expect(deleting()).toHaveLength(0);
  expect(unlocking()).toHaveLength(1);
  expect(closing()).toHaveLength(1);
  expect(locked).toBe(false);
});
it.each(['delete-403', 'delete-503', 'delete-network', 'delete-typed-echo'])(
  'never retries or infers absence after %s',
  async (value) => {
    fault = value;
    await expect(run()).resolves.toMatchObject({
      failure: true,
      deleteAttempted: true,
      confirmedDeleted: false,
      cleanupConfirmed: true,
    });
    expect(deleting()).toHaveLength(1);
    expect(unlocking()).toHaveLength(1);
    expect(closing()).toHaveLength(1);
  },
);
it.each(['absence-untyped', 'absence-forbidden', 'absence-unavailable', 'absence-live'])(
  'requires fresh typed owner absence despite %s',
  async (value) => {
    fault = value;
    await expect(run()).resolves.toMatchObject({ failure: true, deleteAttempted: true, confirmedDeleted: false });
    expect(deleting()).toHaveLength(1);
  },
);
it.each(['unlock-fail', 'close-fail'])('separates deletion from %s', async (value) => {
  fault = value;
  await expect(run()).resolves.toMatchObject({
    failure: true,
    confirmedDeleted: true,
    cleanupConfirmed: false,
    remaining: [],
    inspectionRequired: [owner],
  });
  expect(deleting()).toHaveLength(1);
});
it.each(['inventory-tail', 'tail-other'])('retains truthful partial outcome for %s after deletion', async (value) => {
  fault = value;
  await expect(run()).resolves.toMatchObject({
    failure: true,
    confirmedDeleted: true,
    remaining: [],
    inspectionRequired: [owner],
  });
  expect(deleting()).toHaveLength(1);
});
it.each([
  'tail-binding-owner',
  ...v3RecoveryFixtures.slice(1).map((_, index) => `tail-binding-other-${index + 1}`),
  'tail-binding-inventory',
])('retains confirmed cleanup but refuses success after immutable binding drift during %s', async (value) => {
  fault = value;
  await expect(run()).resolves.toMatchObject({
    failure: true,
    mutationAttempted: true,
    deleteAttempted: true,
    confirmedDeleted: true,
    cleanupConfirmed: true,
    reason: 'source-binding',
    remaining: [],
    inspectionRequired: [owner],
  });
  expect(bindingBroken).toBe(true);
  expect(deleting()).toHaveLength(1);
  expect(unlocking()).toHaveLength(1);
  expect(closing()).toHaveLength(1);
  expect(records).toContainEqual({ recoveryUnconfirmed: true, reason: 'source-binding' });
});
it.each([
  ['PUT', `${owner}/source/main?lockHandle=${HANDLE}`, recoveryFixture.source],
  ['POST', owner.replace(/\/[^/]+$/, ''), '<create/>'],
  ['POST', '/sap/bc/adt/activation?method=activate&preauditRequested=false', '<activate/>'],
  ['DELETE', `${owner}other?lockHandle=${HANDLE}`, undefined],
  ['DELETE', `${owner}?lockHandle=${HANDLE}&corrNr=ANY`, undefined],
  ['GET', `${owner}?version=inactive`, undefined],
  ['GET', `${owner}?sap-client=100`, undefined],
  ['GET', '/sap/bc/adt/foreign', undefined],
  ['POST', `${owner}?_action=UNLOCK&lockHandle=${HANDLE}&extra=true`, undefined],
  ['POST', `${owner}?_action=LOCK&accessMode=MODIFY`, 'foreign body'],
])('refuses requests outside fixed cleanup scope: %s %s', (method, path, body) => {
  expect(() => checkRecoveryRequest(method!, path!, body)).toThrow();
  expect(mockFetch).not.toHaveBeenCalled();
});
