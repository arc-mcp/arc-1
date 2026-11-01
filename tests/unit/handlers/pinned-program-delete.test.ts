import { beforeEach, expect, it, vi } from 'vitest';
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
    allowedTransports: [],
    serverAllowedTransports: [],
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
let aborter: AbortController | undefined;
const calls: { path: string; method: string; cookie: string; ownerLocked: boolean; poolLocked: boolean }[] = [];
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  fault = '';
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
    if (path === '/sap/bc/adt/core/http/sessions') return mockResponse(fault === 'close' ? 503 : 200, '');
    if (path.includes('transportchecks'))
      return mockResponse(
        200,
        '<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING/></DATA>',
      );
    if (parsed.searchParams.get('_action') === 'LOCK') {
      if (path === pool) poolLocked = true;
      else ownerLocked = true;
      return mockResponse(
        200,
        `<DATA><LOCK_HANDLE>${path === pool ? 'pool-lock' : 'owner-lock'}</LOCK_HANDLE><CORRNR/><IS_LOCAL>${fault === 'pool-lock-policy' && path === pool ? '' : 'X'}</IS_LOCAL></DATA>`,
        { 'set-cookie': 'sap-contextid=program-owner; Path=/' },
      );
    }
    if (parsed.searchParams.get('_action') === 'UNLOCK') {
      if (path === pool) poolLocked = false;
      else ownerLocked = false;
      return mockResponse(fault === 'pool-unlock' && path === pool ? 503 : 200, '');
    }
    if (method === 'DELETE' && path === owner) {
      if (fault === 'delete-reject') return mockResponse(403, 'Denied');
      deleted = true;
      return mockResponse(fault === 'delete-uncertain' ? 503 : 204, '');
    }
    if (path === owner) {
      if (deleted) return mockResponse(404, fault === 'untyped-absence' ? '<html>Not found</html>' : absence);
      const root = type === 'PROG' ? 'abapProgram' : 'abapInclude';
      return mockResponse(
        200,
        `<${root} name="${name}" type="${fault === 'owner-drift' && poolLocked ? 'FUGR/I' : `PROG/${type === 'PROG' ? 'P' : 'I'}`}" programType="executableProgram" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP" adtcore:type="DEVC/K"/></${root}>`,
      );
    }
    if (path === pool) {
      if (fault === 'cancel') aborter!.abort();
      return mockResponse(
        200,
        `<textElement name="${fault === 'pool-owner' ? 'ZFOREIGN' : name}" type="PROG/PX" version="${fault === 'inactive' ? 'inactive' : 'active'}"/>`,
      );
    }
    throw Error(`Unexpected ${method} ${path}`);
  });
});
async function remove(kind = 'PROG', overrides: Partial<typeof config> = {}) {
  type = kind;
  owner = `/sap/bc/adt/programs/${kind === 'PROG' ? 'programs' : 'includes'}/zarc1_delete`;
  const effective = { ...config, ...overrides };
  const client = new AdtClient({ baseUrl: 'http://sap:8000', safety: { ...defaultSafetyConfig(), ...effective } });
  const result = await handleToolCall(client, effective, 'SAPWrite', { action: 'delete', type, name });
  return { result, payload: JSON.parse(result.content[0].text) };
}
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
    expect(payload.state).toBe('unchanged');
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
    expect(payload.state).toBe(failure === 'delete-reject' ? 'delete-rejected' : 'delete-unconfirmed');
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
