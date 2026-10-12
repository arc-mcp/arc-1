import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const collection = '/sap/bc/adt/ddic/db/indexes',
  ct = 'application/vnd.sap.adt.blues.v1+xml';
const metadata = readFileSync(new URL('../../fixtures/table-index-metadata-758.xml', import.meta.url), 'utf8');
const nodes = readFileSync(new URL('../../fixtures/table-index-nodes-758.xml', import.meta.url), 'utf8');
const source = {
  formatVersion: '1',
  header: { description: 'Test', originalLanguage: 'en' },
  uniqueIndex: false,
  bufferIndexOnly: false,
  textIndex: false,
  indexFields: [{ fieldName: 'CLIENT' }, { fieldName: 'STATUS' }],
};
let client: ReturnType<typeof createClient>, pkg: string, failPut: boolean, failLock: boolean, deleted: boolean;
let activationState: string;
let activationWarning: boolean;
beforeEach(() => {
  vi.resetAllMocks();
  client = createClient();
  client.safety.allowedPackages = ['$TMP'];
  client.http.setDiscoveryMap(new Map([[collection, [ct]]]));
  pkg = '$TMP';
  failPut = false;
  failLock = false;
  deleted = false;
  activationState = 'active';
  activationWarning = false;
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (url.includes('_action=LOCK'))
      return Promise.resolve(
        mockResponse(
          failLock ? 409 : 200,
          '<asx:values><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR>DEVK900001</CORRNR></asx:values>',
        ),
      );
    if (url.includes('_action=UNLOCK')) return Promise.resolve(mockResponse(200, ''));
    if (url.includes('/activation?'))
      return Promise.resolve(
        mockResponse(
          200,
          activationWarning
            ? '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><msg type="W" shortText="Database creation warning" uri="/sap/bc/adt/ddic/db/indexes/ztest%7e001"/></chkl:messages>'
            : '',
        ),
      );
    if (path === collection && init?.method === 'POST') return Promise.resolve(mockResponse(201, ''));
    if (init?.method === 'PUT')
      return Promise.resolve(mockResponse(failPut ? 503 : 200, failPut ? 'Uncertain save' : ''));
    if (init?.method === 'DELETE') {
      deleted = true;
      return Promise.resolve(mockResponse(200, ''));
    }
    if (path.includes('/ddic/tables/'))
      return Promise.resolve(mockResponse(200, `<table><adtcore:packageRef adtcore:name="${pkg}"/></table>`));
    if (path.includes('/nodestructure')) return Promise.resolve(mockResponse(200, nodes));
    if (path.endsWith('/source/main')) return Promise.resolve(mockResponse(200, JSON.stringify(source)));
    if (path.includes('/db/indexes/'))
      return Promise.resolve(
        mockResponse(
          deleted ? 404 : 200,
          metadata
            .replace('adtcore:name="$TMP"', `adtcore:name="${pkg}"`)
            .replace('adtcore:version="new"', `adtcore:version="${activationState}"`),
        ),
      );
    return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
  });
});
const call = (tool: string, args: Record<string, unknown>) => handleToolCall(client, DEFAULT_CONFIG, tool, args);
const write = (action = 'create', extra = {}) =>
  call('SAPWrite', { action, type: 'TABL/DTI', name: 'ZTEST~001', source: JSON.stringify(source), ...extra });
const writes = () =>
  mockFetch.mock.calls.filter(([, init]) => ['POST', 'PUT', 'DELETE'].includes(init?.method ?? 'GET'));
it('creates an index with actual parent package and container; forwards explicit and lock transports', async () => {
  const r = await write('create', { transport: 'DEVK900099' });
  expect(r.isError, JSON.stringify(r)).toBeUndefined();
  const create = writes().find(([url]) => url.includes('/indexes?corrNr='));
  expect(create?.[1]?.body).toContain('<adtcore:containerRef');
  expect(create?.[1]?.body).toContain('adtcore:name="$TMP"');
  expect(writes().find(([, init]) => init?.method === 'PUT')?.[0]).toContain('corrNr=DEVK900099');
  expect(writes().some(([url]) => url.includes('/activation'))).toBe(false);
  mockFetch.mockClear();
  expect((await write('update')).isError).toBeUndefined();
  expect(writes().find(([, init]) => init?.method === 'PUT')?.[0]).toContain('corrNr=DEVK900001');
});
it('treats caller package as an assertion, not a way to bypass the real parent', async () => {
  pkg = 'ZOTHER';
  expect((await write('create', { package: '$TMP' })).isError).toBe(true);
  expect(writes()).toEqual([]);
  expect((await write('create')).isError).toBe(true);
  expect(writes()).toEqual([]);
});
it('fails closed if the parent package is missing even with unrestricted packages', async () => {
  pkg = '';
  client.safety.allowedPackages = [];
  expect((await write()).isError).toBe(true);
  expect(writes()).toEqual([]);
});
it.each(['update', 'delete'])('gates %s against native metadata, not caller package', async (action) => {
  pkg = 'ZOTHER';
  expect((await write(action, { package: '$TMP' })).isError).toBe(true);
  expect(writes()).toEqual([]);
});
it('honors read-only, scope and denied action gates', async () => {
  client.safety.allowWrites = false;
  expect((await write()).isError).toBe(true);
  expect(writes()).toEqual([]);
  const args = { action: 'create', type: 'TABL/DTI', name: 'ZTEST~001', source: JSON.stringify(source) };
  expect(
    (
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', args, {
        token: 'test',
        clientId: 'reader',
        scopes: ['read'],
      })
    ).isError,
  ).toBe(true);
  expect(
    (await handleToolCall(client, { ...DEFAULT_CONFIG, denyActions: ['SAPWrite.create'] }, 'SAPWrite', args)).isError,
  ).toBe(true);
  expect(writes()).toEqual([]);
});
it('refuses invalid names and invalid JSON before creating', async () => {
  expect((await write('create', { name: 'ZTEST' })).isError).toBe(true);
  expect((await write('create', { source: 'not JSON' })).isError).toBe(true);
  expect(writes()).toEqual([]);
});
it('reports partial create, avoids transient PUT replay and unlocks', async () => {
  failPut = true;
  const r = await write();
  expect(r.isError).toBe(true);
  expect(r.content[0]?.text).toContain('was created');
  expect(writes().filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  expect(writes().at(-1)?.[0]).toContain('_action=UNLOCK');
});
it('does not PUT after a foreign lock refusal', async () => {
  failLock = true;
  expect((await write('update')).isError).toBe(true);
  expect(writes().some(([, init]) => init?.method === 'PUT')).toBe(false);
});
it('reads pending index metadata and JSON through matching version selectors', async () => {
  const r = await call('SAPRead', { type: 'TABL/DTI', name: 'ZTEST~001' });
  expect(r.isError, JSON.stringify(r)).toBeUndefined();
  expect(JSON.parse(r.content[0]!.text).source).toEqual(source);
  expect(
    mockFetch.mock.calls
      .filter(([url]) => url.includes('/db/indexes/'))
      .every(([url]) => new URL(url).searchParams.get('version') === 'inactive'),
  ).toBe(true);
});
it('lists the native index children without SQL permission or source-cache use', async () => {
  client.safety.allowWrites = false;
  client.safety.allowDataPreview = false;
  client.safety.allowFreeSQL = false;
  const r = await call('SAPRead', { type: 'TABL', name: 'DD03L', include: 'indexes' });
  expect(r.isError, JSON.stringify(r)).toBeUndefined();
  expect(JSON.parse(r.content[0]!.text)).toHaveLength(6);
  const req = writes()[0];
  expect(req?.[0]).toContain('parent_type=TABL%2FDT&parent_name=DD03L');
  expect(req?.[1]?.body).toBe('');
});
it.each([{ type: 'TABL', version: 'active' }, { type: 'TTYP' }])(
  'refuses an unsupported listing selector %j',
  async (extra) => {
    expect((await call('SAPRead', { name: 'ZTEST', include: 'indexes', ...extra })).isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  },
);
it('refuses missing discovery before listing or mutations', async () => {
  client.http.setDiscoveryMap(new Map([['/sap/bc/adt/oo/classes', ['application/xml']]]));
  expect((await write()).isError).toBe(true);
  expect((await call('SAPRead', { type: 'TABL', name: 'ZTEST', include: 'indexes' })).isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
it.each([false, true])('activates the native index resource (batch=%s)', async (batch) => {
  const obj = { type: 'TABL/DTI', name: 'ZTEST~001' };
  const r = await call('SAPActivate', batch ? { objects: [obj] } : obj);
  expect(r.isError, JSON.stringify(r)).toBeUndefined();
  expect(writes().find(([url]) => url.includes('/activation?'))?.[1]?.body).toContain('/ddic/db/indexes/ztest~001');
});
it('deletes under its own lock and verifies absence', async () => {
  expect((await write('delete')).isError).toBeUndefined();
  expect(deleted).toBe(true);
  expect(mockFetch.mock.calls.at(-1)?.[1]?.method).toBe('GET');
});

it('does not report success when activation leaves an inactive index', async () => {
  activationState = 'inactive';
  const r = await call('SAPActivate', { type: 'TABL/DTI', name: 'ZTEST~001' });
  expect(r.isError).toBe(true);
  expect(r.content[0]?.text).toContain('still reports inactive');
});
it.each([false, true])('treats warning-only activation as unverified (batch=%s)', async (batch) => {
  activationWarning = true;
  const obj = { type: 'TABL/DTI', name: 'ZTEST~001' };
  const r = await call('SAPActivate', batch ? { objects: [obj] } : obj);
  expect(r.isError).toBe(true);
  expect(r.content[0]?.text).toContain('database state is unverified');
});
