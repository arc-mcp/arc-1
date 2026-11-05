/** Private candidate profile: public function-family admission is still disabled. */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from '../handlers/setup-undici-mock.js';

const { deletePinnedOwner } = await import('../../../src/adt/pinned-delete.js');
const observed = JSON.parse(
  readFileSync(new URL('../../fixtures/function-owners/a4h-758.json', import.meta.url), 'utf8'),
).observations as { label: string; metadataXml: string }[];
const native = (label: string) =>
  observed
    .find((row) => row.label === label)!
    .metadataXml.replaceAll('SU_USER', 'ZFG')
    .replaceAll('su_user', 'zfg')
    .replaceAll('SUSR', '$TMP')
    .replaceAll('BAPI_USER_GETLIST', 'Z_FM')
    .replaceAll('bapi_user_getlist', 'z_fm');
const parent = '/sap/bc/adt/functions/groups/zfg';
const pool = '/sap/bc/adt/textelements/functiongroups/zfg';
const absent =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Resource does not exist.</message></exc:exception>';
const selections = {
  FUGR: { name: 'ZFG', path: parent, label: 'group' },
  FUNC: { name: 'Z_FM', path: `${parent}/fmodules/z_fm`, label: 'module' },
  INCL: { name: 'LZFGTOP', path: `${parent}/includes/lzfgtop`, label: 'include' },
};
let selected: keyof typeof selections = 'FUGR',
  fault = '',
  deleted = false;
const locks = new Set<string>();
const calls: { method: string; path: string; locks: string[]; cookie: string }[] = [],
  unexpected: string[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  selected = 'FUGR';
  fault = '';
  deleted = false;
  locks.clear();
  calls.length = unexpected.length = 0;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const uri = new URL(String(url)),
      path = uri.pathname.toLowerCase(),
      method = init.method ?? 'GET';
    calls.push({
      method,
      path: path + uri.search,
      locks: [...locks],
      cookie: new Headers(init.headers).get('Cookie') ?? '',
    });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'T' });
    if (path.includes('/http/sessions')) return mockResponse(fault === 'close' ? 503 : 200, '');
    if (uri.searchParams.get('_action') === 'LOCK') {
      locks.add(path);
      return mockResponse(200, '<DATA><LOCK_HANDLE>H</LOCK_HANDLE><IS_LOCAL>X</IS_LOCAL><CORRNR/></DATA>', {}, [
        'sap-contextid=function-owner; Path=/',
      ]);
    }
    if (uri.searchParams.get('_action') === 'UNLOCK') {
      locks.delete(path);
      return deleted && fault === 'removed-lock' ? mockResponse(404, absent) : mockResponse(200, '');
    }
    if (method === 'DELETE' && path === selections[selected].path) {
      deleted = true;
      return mockResponse(204, '');
    }
    if (method === 'GET' && deleted && path === selections[selected].path) return mockResponse(404, absent);
    if (method === 'GET' && path === parent) {
      let xml = native('group');
      if (fault === 'parent-package' && locks.size) xml = xml.replace('adtcore:name="$TMP"', 'adtcore:name="ZOTHER"');
      return mockResponse(200, xml);
    }
    if (method === 'GET' && path === selections[selected].path) {
      let xml = native(selections[selected].label);
      if (fault === 'child-container') xml = xml.replace('adtcore:name="ZFG"', 'adtcore:name="ZFOREIGN"');
      return mockResponse(200, xml);
    }
    if (method === 'GET' && path === pool) {
      let xml = native('pool');
      if (fault === 'inactive-pool') xml = xml.replace('adtcore:version="active"', 'adtcore:version="inactive"');
      if (fault === 'pool-identity') xml = xml.replace('adtcore:name="ZFG"', 'adtcore:name="ZFOREIGN"');
      return mockResponse(200, xml);
    }
    if (method === 'POST' && path === '/sap/bc/adt/cts/transportchecks')
      return mockResponse(
        200,
        '<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING/></DATA>',
      );
    unexpected.push(`${method} ${path}${uri.search}`);
    return mockResponse(599, 'Unexpected fixture request');
  });
});
afterEach(() => expect(unexpected).toEqual([]));
async function remove(type: keyof typeof selections = 'FUGR') {
  selected = type;
  const client = new AdtClient({
    baseUrl: 'https://sap.example',
    client: '001',
    username: 'writer',
    password: 'fixture',
    safety: {
      ...defaultSafetyConfig(),
      allowWrites: true,
      allowedPackages: ['$TMP'],
      multiTargetWrite: {
        enabled: true,
        target: 'A4H/001',
        allowedPackages: ['$TMP'],
        allowedTransports: [],
        serverAllowedTransports: [],
      },
    },
  });
  const context = pinnedMutationContext(client.safety, { deadline: Date.now() + 30_000 }, { unlockFailed: false });
  const result = await deletePinnedOwner(client, context, {
    type,
    name: selections[type].name,
    ...(type === 'FUGR' ? {} : { group: 'ZFG' }),
  });
  return { result, cleanup: context.cleanup };
}
it.each(['FUGR', 'FUNC', 'INCL'] as const)(
  'deletes the exact %s native resource with independently proved parent package',
  async (type) => {
    const { result, cleanup } = await remove(type);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, state: 'deleted' });
    const deletions = calls.filter((call) => call.method === 'DELETE');
    expect(deletions).toHaveLength(1);
    expect(deletions[0].path).toContain(`${selections[type].path}?lockHandle=H`);
    expect(deletions[0].locks).toEqual(type === 'FUGR' ? [parent, pool] : [selections[type].path]);
    expect(deletions[0].cookie).toContain('sap-contextid=function-owner');
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
    expect(locks.size).toBe(0);
    expect(calls.filter((call) => call.method === 'POST' && call.path.includes('/activation'))).toHaveLength(0);
  },
);
it.each(['inactive-pool', 'pool-identity', 'parent-package'])('refuses %s before deleting a group', async (failure) => {
  fault = failure;
  expect((await remove()).result).toMatchObject({ ok: false, state: 'unchanged' });
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  expect(locks.size).toBe(0);
});
it.each(['FUNC', 'INCL'] as const)('refuses a foreign %s container before locking', async (type) => {
  fault = 'child-container';
  expect((await remove(type)).result).toMatchObject({ ok: false, state: 'unchanged', phase: 'package-preflight' });
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});
it('retains resolved native removed-lock receipts after confirmed group and pool deletion', async () => {
  fault = 'removed-lock';
  const { result } = await remove();
  expect(result).toMatchObject({
    ok: true,
    state: 'deleted',
    removedLocksAfterDelete: [
      { uri: '/sap/bc/adt/textelements/functiongroups/ZFG', statusCode: 404, absentAfterDelete: true },
      { uri: parent, statusCode: 404, absentAfterDelete: true },
    ],
  });
});
