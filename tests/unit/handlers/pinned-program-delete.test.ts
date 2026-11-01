import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { requestContext } = await import('../../../src/server/context.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const config = {
  ...DEFAULT_CONFIG,
  allowWrites: true,
  multiTargetEndpoints: true,
  targetId: 'A4H/001',
  ppEnabled: true,
  ppStrict: true,
  allowedPackages: ['$TMP'],
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: [] as string[],
    serverAllowedTransports: [] as string[],
  },
};
const name = 'ZARC1_DELETE';
const pool = '/sap/bc/adt/textelements/programs/zarc1_delete';
const absence =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Resource does not exist.</message></exc:exception>';
let owner = '',
  type = 'PROG',
  fault = '',
  deleted = false,
  poolLocked = false,
  ownerLocked = false;
let transportable = false;
let usedInclude = false;
let aborter: AbortController | undefined;
const calls: { path: string; method: string; cookie: string; ownerLocked: boolean; poolLocked: boolean }[] = [];
const unexpected: string[] = [];
afterEach(() => expect(unexpected).toEqual([]));
beforeEach(() => {
  unexpected.length = 0;
  vi.restoreAllMocks();
  vi.resetAllMocks();
  fault = '';
  transportable = usedInclude = false;
  deleted = poolLocked = ownerLocked = false;
  aborter = undefined;
  calls.length = 0;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const parsed = new URL(String(url)),
      path = parsed.pathname.toLowerCase(),
      method = init.method ?? 'GET';
    calls.push({
      path: path + parsed.search,
      method,
      cookie: new Headers(init.headers).get('cookie') ?? '',
      ownerLocked,
      poolLocked,
    });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
    if (path === '/sap/bc/adt/core/http/sessions') return mockResponse(fault.includes('close') ? 503 : 200, '');
    if (path.includes('transportchecks'))
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${transportable ? 'ZTEAM' : '$TMP'}</DEVCLASS><DLVUNIT>${transportable ? 'HOME' : 'LOCAL'}</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING>${transportable ? 'X' : ''}</RECORDING></DATA>`,
      );
    if (path.includes('/transportrequests/a4hk900099'))
      return mockResponse(
        200,
        '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900099" tm:type="K" tm:status="D"/></tm:root>',
      );
    if (path.includes('transportrequests'))
      return mockResponse(
        200,
        '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"><tm:task tm:number="A4HK900002" tm:status="D"/></tm:request></tm:root>',
      );
    if (parsed.searchParams.get('_action') === 'LOCK') {
      if (path === pool && ['pool-lock-rejected', 'pool-lock-lost'].includes(fault))
        return mockResponse(fault === 'pool-lock-rejected' ? 423 : 503, '');
      if (path === pool) poolLocked = true;
      else ownerLocked = true;
      return mockResponse(
        200,
        `<DATA><LOCK_HANDLE>${path === pool ? 'pool-lock' : 'owner-lock'}</LOCK_HANDLE><CORRNR>${transportable ? (fault === 'pool-recording' && path === pool ? 'A4HK900099' : 'A4HK900002') : ''}</CORRNR><IS_LOCAL>${transportable ? '' : fault === 'pool-lock-policy' && path === pool ? '' : 'X'}</IS_LOCAL></DATA>`,
        { 'set-cookie': 'sap-contextid=program-owner; Path=/' },
      );
    }
    if (parsed.searchParams.get('_action') === 'UNLOCK') {
      if (path === pool) poolLocked = false;
      else ownerLocked = false;
      if (
        (path === pool && fault.startsWith('pool-removed')) ||
        fault === 'both-removed' ||
        (path === owner && fault === 'owner-removed')
      )
        return mockResponse(404, absence);
      if (fault === 'pool-untyped404' && path === pool) return mockResponse(404, '<html>Not found</html>');
      return mockResponse(fault === 'pool-unlock' && path === pool ? 503 : 200, '');
    }
    if (method === 'DELETE' && path === owner) {
      if (fault === 'delete-reject') return mockResponse(403, 'Denied');
      deleted = true;
      return mockResponse(fault === 'delete-uncertain' ? 503 : 204, '');
    }
    if (path === owner) {
      if (deleted)
        return mockResponse(
          404,
          ['untyped-absence', 'pool-removed-unverified'].includes(fault) ? '<html>Not found</html>' : absence,
        );
      const root = type === 'PROG' ? 'program:abapProgram' : 'include:abapInclude';
      return mockResponse(
        200,
        `<${root} xmlns:program="http://www.sap.com/adt/programs/programs" xmlns:include="http://www.sap.com/adt/programs/includes" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}" adtcore:type="${fault === 'owner-drift' && poolLocked ? 'FUGR/I' : `PROG/${type === 'PROG' ? 'P' : 'I'}`}" program:programType="executableProgram" ${usedInclude ? 'include:contextRefCount="20"' : ''}><adtcore:packageRef adtcore:name="${transportable ? 'ZTEAM' : '$TMP'}" adtcore:type="DEVC/K"/>${usedInclude ? '<include:contextRef adtcore:type="PROG/P" adtcore:name="ZCONSUMER" adtcore:uri="/sap/bc/adt/programs/programs/zconsumer" adtcore:packageName="ZOUTSIDE"/>' : ''}</${root}>`,
      );
    }
    if (path === pool) {
      if (fault === 'cancel') aborter!.abort();
      return mockResponse(
        200,
        `<text:textElement xmlns:text="http://www.sap.com/adt/textelements" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${fault === 'pool-owner' ? 'ZFOREIGN' : name}" adtcore:type="PROG/PX" adtcore:version="${fault === 'inactive' ? 'inactive' : 'active'}"/>`,
      );
    }
    unexpected.push(`${method} ${path}`);
    return mockResponse(599, 'Unexpected test request');
  });
});
async function remove(kind = 'PROG', overrides: Partial<typeof config> = {}) {
  type = kind;
  owner = `/sap/bc/adt/programs/${kind === 'PROG' ? 'programs' : 'includes'}/zarc1_delete`;
  const effective = { ...config, ...overrides };
  const client = new AdtClient({ baseUrl: 'http://sap:8000', safety: { ...defaultSafetyConfig(), ...effective } });
  if (fault === 'service-missing')
    client.http.setDiscoveryMap(new Map([['/sap/bc/adt/programs/programs', ['application/xml']]]));
  const result = await handleToolCall(client, effective, 'SAPWrite', {
    action: 'delete',
    type,
    name,
    ...(transportable ? { transport: 'A4HK900002' } : {}),
  });
  return { result, payload: JSON.parse(result.content[0].text) };
}
it('refuses program deletion when native discovery proves the pool service absent', async () => {
  fault = 'service-missing';
  const { result, payload } = await remove();
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('unchanged');
  expect(payload.message).toContain('native ADT textelements service');
  expect(calls.filter((call) => call.method === 'DELETE' || call.path.startsWith(pool))).toHaveLength(0);
});
it('deletes a program while both native locks are held in the owning session', async () => {
  const { result, payload } = await remove();
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload.state).toBe('deleted');
  const deletion = calls.filter((call) => call.method === 'DELETE');
  expect(deletion).toHaveLength(1);
  expect(deletion[0]).toMatchObject({ ownerLocked: true, poolLocked: true });
  expect(deletion[0]!.cookie).toContain('sap-contextid=program-owner');
  const unlocks = calls.filter((call) => call.path.includes('_action=UNLOCK'));
  expect(unlocks.map((call) => call.path.split('?')[0])).toEqual([pool, owner]);
  expect(unlocks.every((call) => call.cookie.includes('sap-contextid=program-owner'))).toBe(true);
  expect(calls.filter((call) => call.path.startsWith('/sap/bc/adt/core/http/sessions'))).toHaveLength(1);
});
it('deletes only a standalone include without selecting a program pool', async () => {
  const { result, payload } = await remove('INCL');
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload.state).toBe('deleted');
  expect(calls.some((call) => call.path.startsWith('/sap/bc/adt/textelements/'))).toBe(false);
});
it.each(['inactive', 'pool-owner', 'pool-lock-policy', 'owner-drift'])(
  'refuses %s before DELETE and releases both locks',
  async (failure) => {
    fault = failure;
    const { result, payload } = await remove();
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      state: 'unchanged',
      phase: ['inactive', 'pool-owner'].includes(failure) ? 'text-pool-read' : 'text-pool-policy',
    });
    expect(payload.statusCode).toBeUndefined();
    expect(payload.message).toMatch(
      failure === 'inactive'
        ? /text pool is inactive/
        : failure === 'pool-owner'
          ? /text-pool state/
          : failure === 'owner-drift'
            ? /standalone native/
            : /recording context/,
    );
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
    expect(calls.filter((call) => call.path.includes('_action=UNLOCK'))).toHaveLength(2);
    if (failure === 'inactive') expect(payload.message).toContain('text pool is inactive');
  },
);
it.each(['pool-unlock', 'close'])('retains confirmed deletion but reports %s cleanup failure', async (failure) => {
  fault = failure;
  const { result, payload } = await remove();
  expect(result.isError).toBe(true);
  expect(payload).toMatchObject({ state: 'deleted', cleanupFailed: true, retryable: false });
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  expect(calls.filter((call) => call.path.includes('_action=UNLOCK'))).toHaveLength(2);
});
it.each(['delete-reject', 'delete-uncertain', 'untyped-absence'])(
  'does not replay or infer deletion after %s',
  async (failure) => {
    fault = failure;
    const { result, payload } = await remove();
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      state: failure === 'delete-reject' ? 'delete-rejected' : 'delete-unconfirmed',
      phase: failure === 'untyped-absence' ? 'absence-readback' : 'delete',
      statusCode: failure === 'delete-reject' ? 403 : failure === 'delete-uncertain' ? 503 : 404,
      retryable: false,
    });
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
    expect(calls.filter((call) => call.path.includes('_action=UNLOCK'))).toHaveLength(2);
  },
);
it('cleans both locks after cancellation during the pool read without deleting', async () => {
  fault = 'cancel';
  aborter = new AbortController();
  const { result, payload } = await requestContext.run({ requestId: 'program-delete', signal: aborter.signal }, () =>
    remove(),
  );
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('unchanged');
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  expect(calls.filter((call) => call.path.includes('_action=UNLOCK'))).toHaveLength(2);
  expect(calls.filter((call) => call.path.startsWith('/sap/bc/adt/core/http/sessions'))).toHaveLength(1);
});

it.each(['PROG', 'INCL'])('keeps %s deletion blocked for read-only and non-PP connections', async (kind) => {
  for (const overrides of [
    { allowWrites: false },
    { ppEnabled: false },
    { ppStrict: false },
    { multiTargetWrite: { ...config.multiTargetWrite, enabled: false } },
  ]) {
    const { result } = await remove(kind, overrides);
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  }
});

it.each(['pool-removed', 'owner-removed', 'both-removed'])(
  'accepts typed absent unlock only after verified deletion and owning close: %s',
  async (failure) => {
    fault = failure;
    const { result, payload } = await remove();
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(payload).toMatchObject({ ok: true, state: 'deleted' });
    expect(payload.cleanupFailed).toBeUndefined();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(2);
    expect(calls.filter((c) => c.path.includes('/http/sessions'))).toHaveLength(1);
  },
);
it.each(['pool-removed-close', 'pool-removed-unverified', 'pool-untyped404'])(
  'retains named cleanup failure without every required proof: %s',
  async (failure) => {
    fault = failure;
    const { result, payload } = await remove();
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      state: failure === 'pool-removed-unverified' ? 'delete-unconfirmed' : 'deleted',
      cleanupFailed: true,
      retryable: false,
      sessionClosed: failure !== 'pool-removed-close',
    });
    expect(payload.unlockFailures).toEqual([
      {
        uri: `/sap/bc/adt/textelements/programs/${name}`,
        statusCode: 404,
        ...(failure === 'pool-removed-close' ? { absentAfterDelete: true } : {}),
      },
    ]);
  },
);
it.each([
  ['pool-lock-rejected', 423],
  ['pool-lock-lost', 503],
] as const)('closes the owner session without DELETE or blind pool UNLOCK after %s', async (failure, statusCode) => {
  fault = failure;
  const { result, payload } = await remove();
  expect(result.isError).toBe(true);
  expect(payload).toMatchObject({ state: 'unchanged', phase: 'text-pool-lock', statusCode });
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  expect(calls.filter((c) => c.path.includes('_action=UNLOCK')).map((c) => c.path.split('?')[0])).toEqual([owner]);
  expect(calls.filter((c) => c.path.includes('/http/sessions'))).toHaveLength(1);
});
it('returns native include usage without treating consumers as write owners', async () => {
  usedInclude = true;
  const { result, payload } = await remove('INCL');
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload.includeUsage).toEqual({
    contextRefCount: 20,
    contexts: [{ uri: '/sap/bc/adt/programs/programs/zconsumer', name: 'ZCONSUMER', packageName: 'ZOUTSIDE' }],
  });
  expect(payload.warnings).toContain('break its consumers');
  expect(calls.some((c) => c.path.includes('/zconsumer'))).toBe(false);
});
it.each(['PROG', 'INCL'])('deletes a transportable %s with canonical parent recording', async (kind) => {
  transportable = true;
  const { result } = await remove(kind, {
    allowedPackages: ['ZTEAM'],
    multiTargetWrite: {
      ...config.multiTargetWrite,
      allowedPackages: ['ZTEAM'],
      allowedTransports: ['A4HK900001'],
      serverAllowedTransports: ['A4HK900001'],
    },
  });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  expect(calls.find((c) => c.method === 'DELETE')!.path).toContain('corrNr=A4HK900001');
});
it('refuses a pool lock recorded in another CTS request before DELETE', async () => {
  transportable = true;
  fault = 'pool-recording';
  const { result, payload } = await remove('PROG', {
    allowedPackages: ['ZTEAM'],
    multiTargetWrite: {
      ...config.multiTargetWrite,
      allowedPackages: ['ZTEAM'],
      allowedTransports: ['A4HK900001'],
      serverAllowedTransports: ['A4HK900001'],
    },
  });
  expect(result.isError).toBe(true);
  expect(payload).toMatchObject({ state: 'unchanged', phase: 'text-pool-policy' });
  expect(payload.message).toMatch(/(transport|recording|request)/i);
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  expect(calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(2);
});
