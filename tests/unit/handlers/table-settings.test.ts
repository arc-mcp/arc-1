import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { normalizeObjectType, normalizeWriteObjectType } = await import('../../../src/handlers/object-types.js');
const fixture = readFileSync(new URL('../../fixtures/table-settings-758.xml', import.meta.url), 'utf8');
const collection = '/sap/bc/adt/ddic/db/settings';
const ct = 'application/vnd.sap.adt.table.settings.v2+xml';
const mutations = () =>
  mockFetch.mock.calls.filter(([, init]) => ['POST', 'PUT', 'DELETE'].includes(init?.method ?? 'GET'));
let xml: string;
let parentPackage: string;
let activationState: string;
let fail: string;
let failPut: boolean;
let failActivationReadback: boolean;
let client: ReturnType<typeof createClient>;

beforeEach(() => {
  vi.resetAllMocks();
  xml = fixture;
  parentPackage = '$TMP';
  activationState = 'active';
  fail = '';
  failPut = false;
  failActivationReadback = false;
  client = createClient();
  client.safety.allowedPackages = ['$TMP'];
  client.http.setDiscoveryMap(new Map([[collection, [ct]]]));
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (fail && url.includes(fail)) return Promise.resolve(mockResponse(500, 'Test failure'));
    if (failPut && init?.method === 'PUT') return Promise.resolve(mockResponse(503, 'Uncertain save'));
    if (url.includes('/activation?')) {
      xml = xml.replace('version="inactive"', `version="${activationState}"`);
      if (failActivationReadback) fail = '/db/settings/';
    }
    const body = url.includes('_action=LOCK')
      ? '<asx:values><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR>DEVK900001</CORRNR></asx:values>'
      : url.includes('_action=UNLOCK') || init?.method === 'PUT' || url.includes('/activation?')
        ? ''
        : path.includes('/ddic/tables/')
          ? `<table><adtcore:packageRef adtcore:name="${parentPackage}"/></table>`
          : path.includes('/db/settings/')
            ? xml
            : '';
    return Promise.resolve(mockResponse(200, body, { 'x-csrf-token': 'T' }));
  });
});
const call = (tool: string, args: Record<string, unknown>, config = DEFAULT_CONFIG) =>
  handleToolCall(client, config, tool, args);
const write = (extra = {}) =>
  call('SAPWrite', { action: 'update', type: 'TABL/DTT', name: 'ZTEST', source: '{"dataClass":"APPL1"}', ...extra });

describe('TABL/DTT public routing and safety', () => {
  it.each([true, false])(
    'saves loggingEnabled=%s through the existing locked update, without activation',
    async (loggingEnabled) => {
      xml = fixture
        .replace('<ts:loggingEnabled>false', `<ts:loggingEnabled>${!loggingEnabled}`)
        .replace('<ts:sizeCategory>0', '<ts:sizeCategory>2');
      const r = await write({ source: JSON.stringify({ loggingEnabled }), transport: 'DEVK900099' });
      expect(r.isError, JSON.stringify(r)).toBeUndefined();
      const put = mutations().find(([, init]) => init?.method === 'PUT');
      expect(put?.[0]).toContain('corrNr=DEVK900099');
      expect(put?.[1]?.body).toBe(
        xml.replace(`>${!loggingEnabled}</ts:loggingEnabled>`, `>${loggingEnabled}</ts:loggingEnabled>`),
      );
      expect(mockFetch.mock.calls.some(([url]) => url.includes('/activation'))).toBe(false);
      expect(mutations().at(-1)?.[0]).toContain('_action=UNLOCK');
    },
  );
  it.each([
    '',
    '<ts:loggingEnabled>false</ts:loggingEnabled><ts:loggingEnabled>true</ts:loggingEnabled>',
    '<ts:loggingEnabled ts:isEditable="false">false</ts:loggingEnabled>',
  ])('unlocks and refuses a logging update before PUT for unavailable or uneditable metadata %s', async (field) => {
    xml = fixture.replace('<ts:loggingEnabled>false</ts:loggingEnabled>', field);
    const r = await write({ source: '{"loggingEnabled":true}' });
    expect(r.isError).toBe(true);
    expect(mutations().map(([url]) => url.includes('_action=UNLOCK'))).toEqual([false, true]);
  });
  it('preserves native identity in both read and write normalization', () => {
    expect(normalizeObjectType('tabl/dtt')).toBe('TABL/DTT');
    expect(normalizeWriteObjectType('TABL/DTT')).toBe('TABL/DTT');
  });
  it.each(['onprem', 'btp'] as const)(
    'reads settings on %s without a fabricated source/main request',
    async (systemType) => {
      const r = await call('SAPRead', { type: 'TABL/DTT', name: 'ZTEST' }, { ...DEFAULT_CONFIG, systemType });
      expect(r.isError, JSON.stringify(r)).toBeUndefined();
      expect(JSON.parse(r.content[0]!.text)).toMatchObject({ version: 'inactive', source: { dataClass: 'APPL0' } });
      expect(mockFetch.mock.calls.some(([url]) => url.includes('/source/main'))).toBe(false);
    },
  );
  it('refuses SAP substituting a different explicit version', async () => {
    const r = await call('SAPRead', { type: 'TABL/DTT', name: 'ZTEST', version: 'active' });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('Cannot confirm active');
  });
  it.each([undefined, 'DEVK900099'])(
    'locks settings, merges the working draft and forwards corrNr %s',
    async (transport) => {
      xml = fixture.replace('<ts:sizeCategory>0', '<ts:sizeCategory>2');
      const r = await write({ transport });
      expect(r.isError, JSON.stringify(r)).toBeUndefined();
      expect(r.content[0]?.text).toContain('Existing inactive settings were preserved');
      const calls = mockFetch.mock.calls;
      const lock = calls.findIndex(([url]) => url.includes('_action=LOCK'));
      const workingRead = calls.findIndex(
        ([url, init], index) => index > lock && (init?.method ?? 'GET') === 'GET' && url.includes('/db/settings/'),
      );
      const put = calls.findIndex(([, init]) => init?.method === 'PUT');
      expect(workingRead).toBeGreaterThan(lock);
      expect(put).toBeGreaterThan(workingRead);
      expect(calls[put]![0]).toContain(`corrNr=${transport ?? 'DEVK900001'}`);
      expect(calls[put]![1]?.body).toContain('<ts:sizeCategory>2');
      expect(calls[put]![1]?.body).toContain('<ts:dataClassCategory>APPL1');
      expect(calls[put]![1]?.headers).toMatchObject({ Accept: ct, 'Content-Type': ct });
      expect(calls.some(([url]) => /version=active|\/activation/.test(url))).toBe(false);
      expect(mutations().at(-1)?.[0]).toContain('_action=UNLOCK');
    },
  );
  it('encodes namespace names for the parent package check and the settings lock', async () => {
    xml = fixture.replaceAll('ZTEST', '/ABC/TABLE').replaceAll('ztest', '%2Fabc%2Ftable');
    const r = await write({ name: '/ABC/TABLE' });
    expect(r.isError, JSON.stringify(r)).toBeUndefined();
    expect(mockFetch.mock.calls.some(([url]) => url.includes('/ddic/tables/%2Fabc%2Ftable'))).toBe(true);
    expect(mutations()[0]?.[0]).toContain('/db/settings/%2Fabc%2Ftable');
  });
  it("preserves another user's inactive fields even when SAP hides them from an unversioned GET", async () => {
    xml = fixture.replace('<ts:dataClassCategory>APPL0', '<ts:dataClassCategory>APPL1');
    const native = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET' && url.includes('/db/settings/') && !url.includes('version='))
        return Promise.resolve(mockResponse(200, fixture.replace('version="inactive"', 'version="active"')));
      return native(url, init);
    });
    expect((await write({ source: '{"sizeCategory":3}' })).isError).toBeUndefined();
    const body = mutations().find(([, init]) => init?.method === 'PUT')?.[1]?.body;
    expect(body).toContain('<ts:dataClassCategory>APPL1');
    expect(body).toContain('<ts:sizeCategory>3');
    const read = await call('SAPRead', { type: 'TABL/DTT', name: 'ZTEST' });
    expect(JSON.parse(read.content[0]!.text)).toMatchObject({ version: 'inactive', source: { dataClass: 'APPL1' } });
  });
  it.each(['create', 'delete', 'edit_method'])('refuses %s before HTTP', async (action) => {
    expect((await write({ action })).isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('checks the actual parent package instead of caller-supplied package', async () => {
    parentPackage = 'ZOTHER';
    expect((await write({ package: '$TMP' })).isError).toBe(true);
    expect(mutations()).toEqual([]);
  });
  it('refuses technical settings inside batch_create before HTTP', async () => {
    const r = await call('SAPWrite', { action: 'batch_create', objects: [{ type: 'TABL/DTT', name: 'ZTEST' }] });
    expect(r.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('fails closed when the parent has no package', async () => {
    parentPackage = '';
    expect((await write()).isError).toBe(true);
    expect(mutations()).toEqual([]);
  });
  it('honors the server write ceiling', async () => {
    client.safety.allowWrites = false;
    expect((await write()).isError).toBe(true);
    expect(mutations()).toEqual([]);
  });
  it('honors action denial before HTTP', async () => {
    const r = await call(
      'SAPWrite',
      { action: 'update', type: 'TABL/DTT', name: 'ZTEST', source: '{"sizeCategory":1}' },
      { ...DEFAULT_CONFIG, denyActions: ['SAPWrite.update'] },
    );
    expect(r.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('requires write scope', async () => {
    const r = await handleToolCall(
      client,
      DEFAULT_CONFIG,
      'SAPWrite',
      { action: 'update', type: 'TABL/DTT', name: 'ZTEST', source: '{"sizeCategory":1}' },
      { token: 'test', clientId: 'reader', scopes: ['read'] },
    );
    expect(r.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('refuses unavailable discovery without a lock', async () => {
    client.http.setDiscoveryMap(new Map([['/sap/bc/adt/oo/classes', ['application/xml']]]));
    const r = await write();
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('unavailable');
    expect(mutations()).toEqual([]);
  });
  it('unlocks when a locked working document is invalid', async () => {
    xml = '';
    expect((await write()).isError).toBe(true);
    expect(mutations().map(([url]) => url.includes('_action=UNLOCK'))).toEqual([false, true]);
  });
  it('reports known save state if unlock fails', async () => {
    fail = '_action=UNLOCK';
    const r = await write();
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('Technical settings were saved');
  });
  it('does not retry an uncertain PUT and still unlocks', async () => {
    failPut = true;
    const r = await write();
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('save was requested but not confirmed');
    expect(mutations().filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    expect(mutations().at(-1)?.[0]).toContain('_action=UNLOCK');
  });
  it('does not PUT or unlock when locking failed', async () => {
    fail = '_action=LOCK';
    expect((await write()).isError).toBe(true);
    expect(mutations().every(([url]) => url.includes('_action=LOCK'))).toBe(true);
  });
  it.each([false, true])('activates settings only, using the parent package gate (batch=%s)', async (batch) => {
    const object = { type: 'TABL/DTT', name: 'ZTEST' };
    const r = await call('SAPActivate', batch ? { objects: [object] } : object);
    expect(r.isError, JSON.stringify(r)).toBeUndefined();
    const request = mutations().find(([url]) => url.includes('/activation?'));
    expect(request?.[1]?.body).toContain('/ddic/db/settings/ztest');
    expect(request?.[1]?.body).not.toContain('/ddic/tables/');
    expect(mockFetch.mock.calls.some(([url]) => url.includes('/ddic/tables/'))).toBe(true);
  });
  it.each([false, true])('refuses new settings activation with a parent hint (batch=%s)', async (batch) => {
    xml = fixture.replace('version="inactive"', 'version="new"');
    const object = { type: 'TABL/DTT', name: 'ZTEST' };
    const r = await call('SAPActivate', batch ? { objects: [object] } : object);
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('first activation');
    expect(mutations()).toEqual([]);
  });
  it.each([false, true])('does not claim activation while settings remain inactive (batch=%s)', async (batch) => {
    activationState = 'inactive';
    const object = { type: 'TABL/DTT', name: 'ZTEST' };
    const r = await call('SAPActivate', batch ? { objects: [object] } : object);
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('still report inactive');
  });
  it.each([false, true])('fails closed on a forbidden parent package for activation (batch=%s)', async (batch) => {
    parentPackage = 'ZOTHER';
    const object = { type: 'TABL/DTT', name: 'ZTEST' };
    expect((await call('SAPActivate', batch ? { objects: [object] } : object)).isError).toBe(true);
    expect(mutations()).toEqual([]);
  });
  it('reports an unverified activation when the final read fails', async () => {
    failActivationReadback = true;
    const r = await call('SAPActivate', { type: 'TABL/DTT', name: 'ZTEST' });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('state could not be verified');
  });
});
