import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type PinnedMutationContext,
  pinnedMutationContext,
  singleTargetMutationContext,
} from '../../../src/adt/mutation-context.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from '../handlers/setup-undici-mock.js';

const { deletePinnedOwner } = await import('../../../src/adt/pinned-delete.js');
const { AdtHttpClient } = await import('../../../src/adt/http.js');
const policy = {
  target: 'A4H/001',
  enabled: true,
  allowedPackages: ['$TMP', 'ZTEAM'],
  allowedTransports: ['A4HK900001'],
  serverAllowedTransports: ['A4HK900001'],
};
const input = { type: 'CLAS', name: 'ZCL_TEST' };
const owner = '/sap/bc/adt/oo/classes/zcl_test';
let pkg: string;
let local: string;
let exists: boolean;
let deleteStatus: number;
let readbackStatus: number;
let unlockStatus: number;
let retainOwner: boolean;
let recordingCalls: number;
let afterDelete: (() => void) | undefined;
const requests: Array<{ method: string; path: string; headers: Headers }> = [];

function client() {
  return new AdtClient({
    baseUrl: 'https://sap.example.test',
    safety: {
      ...defaultSafetyConfig(),
      allowWrites: true,
      allowedPackages: ['$TMP', 'ZTEAM'],
      multiTargetWrite: policy,
    },
  });
}
function context(c: InstanceType<typeof AdtClient>, signal?: AbortSignal) {
  return pinnedMutationContext(c.safety, { deadline: Date.now() + 30_000, signal }, { unlockFailed: false });
}
function deletes() {
  return requests.filter((r) => r.method === 'DELETE');
}
function locks() {
  return requests.filter((r) => r.path.includes('_action=LOCK'));
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  pkg = '$TMP';
  local = 'X';
  exists = true;
  deleteStatus = 204;
  readbackStatus = 404;
  unlockStatus = 200;
  retainOwner = false;
  recordingCalls = 0;
  afterDelete = undefined;
  requests.length = 0;
  mockFetch.mockImplementation(async (url: unknown, options: any = {}) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname + parsed.search;
    const method = options.method ?? 'GET';
    const headers = new Headers(options.headers);
    requests.push({ path, method, headers });
    if (path.includes('transportchecks')) {
      recordingCalls++;
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${pkg}</DEVCLASS><DLVUNIT>${pkg === '$TMP' ? 'LOCAL' : 'HOME'}</DLVUNIT><OPERATION></OPERATION><RECORDING>${pkg === '$TMP' ? '' : 'X'}</RECORDING><LOCKS/><RESULT>S</RESULT></DATA>`,
      );
    }
    if (path.includes('transportrequests'))
      return mockResponse(
        200,
        '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"><tm:task tm:number="A4HK900002" tm:status="D"/></tm:request></tm:root>',
      );
    if (path.includes('_action=LOCK'))
      return mockResponse(
        200,
        `<DATA><LOCK_HANDLE>owner-lock</LOCK_HANDLE><CORRNR>${pkg === '$TMP' ? '' : 'A4HK900001'}</CORRNR>${local === 'missing' ? '' : `<IS_LOCAL>${local}</IS_LOCAL>`}</DATA>`,
      );
    if (path.includes('_action=UNLOCK')) return mockResponse(unlockStatus, '');
    if (method === 'DELETE') {
      if (deleteStatus === 204 && !retainOwner) exists = false;
      afterDelete?.();
      return mockResponse(deleteStatus, deleteStatus === 204 ? '' : 'native failure');
    }
    if (method === 'GET' && (parsed.pathname === owner || parsed.pathname.startsWith('/sap/bc/adt/oo/interfaces/'))) {
      if (!exists) return mockResponse(readbackStatus, 'not found');
      return mockResponse(
        200,
        `<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${pkg}"/></class:abapClass>`,
      );
    }
    return mockResponse(200, '', { 'x-csrf-token': 'test-token' });
  });
});

describe('bounded pinned owner deletion', () => {
  it.each([
    ['CLAS', 'ZCL_TEST'],
    ['INTF', 'ZIF_TEST'],
  ])('requires a native 404 after deleting %s', async (type, name) => {
    const c = client();
    const result = await deletePinnedOwner(c, context(c), { type, name });
    expect(result).toMatchObject({ ok: true, state: 'deleted', phase: 'absence-readback', retryable: false });
    expect(deletes()).toHaveLength(1);
    expect(recordingCalls).toBe(2);
    const deletionIndex = requests.findIndex((r) => r.method === 'DELETE');
    expect(
      requests
        .slice(deletionIndex + 1)
        .some((r) => r.method === 'GET' && r.headers.get('cache-control') === 'no-cache'),
    ).toBe(true);
    expect(requests.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
  });
  it('does not claim deletion when a successful DELETE leaves the owner present', async () => {
    retainOwner = true;
    const c = client();
    expect(await deletePinnedOwner(c, context(c), input)).toMatchObject({ ok: false, state: 'delete-unconfirmed' });
    expect(deletes()).toHaveLength(1);
  });
  it.each([401, 403, 500])('does not mistake readback HTTP %s for absence', async (status) => {
    readbackStatus = status;
    const c = client();
    expect(await deletePinnedOwner(c, context(c), input)).toMatchObject({
      ok: false,
      state: 'delete-unconfirmed',
      statusCode: status,
    });
  });
  it.each([403, 404, 409, 423, 429, 503])('does not replay DELETE HTTP %s', async (status) => {
    deleteStatus = status;
    const c = client();
    expect(await deletePinnedOwner(c, context(c), input)).toMatchObject({
      ok: false,
      state: [429, 503].includes(status) ? 'delete-unconfirmed' : 'delete-rejected',
      statusCode: status,
    });
    expect(deletes()).toHaveLength(1);
  });
  it('reports deletion and failed cleanup separately', async () => {
    unlockStatus = 503;
    const c = client();
    expect(await deletePinnedOwner(c, context(c), input)).toMatchObject({
      ok: false,
      state: 'deleted',
      phase: 'unlock',
      cleanupFailed: true,
    });
    expect(requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
  });
  it('keeps the cancellation budget off the owning-session cleanup', async () => {
    const controller = new AbortController();
    afterDelete = () => controller.abort();
    const c = client();
    expect(await deletePinnedOwner(c, context(c, controller.signal), input)).toMatchObject({
      ok: false,
      state: 'delete-unconfirmed',
    });
    expect(requests.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
  });
  it('propagates non-replay and a finite deadline to the native DELETE', async () => {
    const spy = vi.spyOn(AdtHttpClient.prototype, 'delete');
    const c = client();
    const ctx = context(c);
    expect((await deletePinnedOwner(c, ctx, input)).ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      expect.objectContaining({ deadline: ctx.requestPolicy.deadline, noReplay: true, retryTransientErrors: false }),
    );
  });
  it('requires an allowed package before acquiring a lock', async () => {
    pkg = 'SABAPDEMOS';
    const c = client();
    expect(await deletePinnedOwner(c, context(c), input)).toMatchObject({
      state: 'unchanged',
      phase: 'package-preflight',
    });
    expect(locks()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
  });
  it('rechecks the package under the lock', async () => {
    vi.spyOn(AdtClient.prototype, 'resolveObjectPackage').mockResolvedValueOnce('$TMP').mockResolvedValueOnce('ZTEAM');
    const c = client();
    expect(await deletePinnedOwner(c, context(c), input)).toMatchObject({ state: 'unchanged', phase: 'locked-policy' });
    expect(deletes()).toHaveLength(0);
    expect(requests.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
  });
  it.each(['missing', ''])('refuses ambiguous/conflicting lock locality %s', async (value) => {
    local = value;
    const c = client();
    expect(await deletePinnedOwner(c, context(c), input)).toMatchObject({ state: 'unchanged', phase: 'locked-policy' });
    expect(deletes()).toHaveLength(0);
  });
  it('uses an explicitly allowed CTS request and rechecks it under the lock', async () => {
    pkg = 'ZTEAM';
    local = '';
    const c = client();
    expect((await deletePinnedOwner(c, context(c), { ...input, transport: 'A4HK900001' })).ok).toBe(true);
    expect(deletes()[0].path).toContain('corrNr=A4HK900001');
    expect(recordingCalls).toBe(2);
  });
  it.each(['A4HK900009', ''])('rejects an unauthorized/empty CTS request %s before locking', async (transport) => {
    pkg = 'ZTEAM';
    local = '';
    const c = client();
    expect((await deletePinnedOwner(c, context(c), { ...input, transport })).ok).toBe(false);
    expect(locks()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
  });
  it.each(['PROG', 'FUGR', 'ENHO', 'DDLS'])(
    'keeps unqualified %s native prechecks out of this candidate',
    async (type) => {
      const c = client();
      expect(await deletePinnedOwner(c, context(c), { ...input, type })).toMatchObject({
        state: 'unchanged',
        phase: 'validation',
      });
      expect(requests).toHaveLength(0);
    },
  );
  it('refuses a forged context before any SAP request', async () => {
    const c = client();
    const forged = { ...context(c) };
    expect((await deletePinnedOwner(c, forged, input)).ok).toBe(false);
    expect(requests).toHaveLength(0);
  });
  it('refuses the registered legacy profile before any SAP request', async () => {
    const c = new AdtClient({
      baseUrl: 'https://sap.example.test',
      safety: { ...defaultSafetyConfig(), allowWrites: true },
    });
    expect((await deletePinnedOwner(c, singleTargetMutationContext(c.safety) as PinnedMutationContext, input)).ok).toBe(
      false,
    );
    expect(requests).toHaveLength(0);
  });
  it('refuses global read-only, despite an enabled destination policy', async () => {
    const c = client().withSafety({ ...client().safety, allowWrites: false });
    expect((await deletePinnedOwner(c, context(c), input)).ok).toBe(false);
    expect(requests).toHaveLength(0);
  });
  it('refuses an already-cancelled request before native reads or locks', async () => {
    const c = client();
    const controller = new AbortController();
    controller.abort();
    expect((await deletePinnedOwner(c, context(c, controller.signal), input)).ok).toBe(false);
    expect(requests).toHaveLength(0);
  });
});
