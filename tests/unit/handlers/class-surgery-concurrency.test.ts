import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

const objectPath = '/sap/bc/adt/oo/classes/ZRACE';
const fixture = (file: string) =>
  readFileSync(new URL(`../../fixtures/class-surgery/${file}`, import.meta.url), 'utf8');
const initial = fixture('active.abap');
const external = fixture('draft.abap');
const config = { ...DEFAULT_CONFIG, abapRelease: '758' };
const args = {
  action: 'edit_method',
  type: 'CLAS',
  name: 'ZRACE',
  method: 'target',
  source: "METHOD target.\n DATA(value) = 'new'.\nENDMETHOD.",
};
interface Send {
  method: string;
  url: URL;
  body?: string;
  headers: Record<string, string>;
  locked: boolean;
}
function backend(
  options: {
    sourceAtLock?: string;
    readStatus?: number;
    putStatus?: number;
    unlockStatus?: number;
    lockStatus?: number;
    packageName?: string;
  } = {},
) {
  const state = { source: initial, locked: false, sends: [] as Send[] };
  mockFetch.mockImplementation(async (url, init) => {
    const path = new URL(String(url));
    const method = init?.method ?? 'GET';
    state.sends.push({ method, url: path, body: init?.body, headers: init?.headers ?? {}, locked: state.locked });
    const response = (status: number, body = '') => mockResponse(status, body, { 'x-csrf-token': 'T' });
    if (method === 'HEAD') return response(200);
    if (path.pathname === '/sap/bc/adt/activation/inactiveobjects')
      return response(200, '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects"/>');
    if (method === 'GET' && path.pathname === objectPath)
      return response(
        200,
        `<object xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${options.packageName ?? '$TMP'}"/></object>`,
      );
    if (method === 'GET' && path.pathname.endsWith('/objectstructure'))
      return response(
        200,
        fixture(state.source === initial || path.searchParams.get('version') === 'active' ? 'active.xml' : 'draft.xml'),
      );
    if (
      method === 'GET' &&
      (path.pathname.endsWith('/source/main') || path.pathname.endsWith('/includes/implementations'))
    )
      return response(
        options.readStatus ?? 200,
        path.searchParams.get('version') === 'active' ? initial : state.source,
      );
    if (method === 'POST' && path.searchParams.get('_action') === 'LOCK') {
      if (options.lockStatus) return response(options.lockStatus, 'Lock denied');
      // A competing writer completed immediately before this lock was acquired.
      state.source = options.sourceAtLock ?? external;
      state.locked = true;
      return response(
        200,
        '<asx:abap><asx:values><DATA><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR>DEVK900001</CORRNR><IS_LOCAL></IS_LOCAL></DATA></asx:values></asx:abap>',
      );
    }
    if (method === 'PUT') {
      if (!options.putStatus) state.source = String(init?.body);
      return response(options.putStatus ?? 200, options.putStatus ? 'Write failed' : '');
    }
    if (method === 'POST' && path.searchParams.get('_action') === 'UNLOCK') {
      if (!options.unlockStatus) state.locked = false;
      return response(options.unlockStatus ?? 200, options.unlockStatus ? 'Unlock failed' : '');
    }
    return response(404, `Unexpected ${method} ${path.pathname}`);
  });
  return state;
}
beforeEach(() => {
  vi.resetAllMocks();
  resetCachedFeatures();
});

it('preserves an intervening draft while reading and writing under the same lock', async () => {
  const state = backend();
  const result = await handleToolCall(createClient(), config, 'SAPWrite', args);
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(state.source).toContain("DATA(value) = 'new'");
  expect(state.source).toContain('draft-other');
  expect(state.source).not.toContain("DATA(value) = 'original'");
  expect(state.locked).toBe(false);
  const mutation = state.sends.filter((s) => s.url.pathname.startsWith(objectPath));
  expect(mutation.map((s) => s.url.searchParams.get('_action') ?? s.method)).toEqual(['LOCK', 'GET', 'PUT', 'UNLOCK']);
  expect(mutation.every((s) => s.headers['X-sap-adt-sessiontype'] === 'stateful')).toBe(true);
  const read = mutation[1]!;
  expect(read.locked).toBe(true);
  expect(read.url.searchParams.has('version')).toBe(false);
  expect(read.headers['If-None-Match']).toBeUndefined();
  expect(read.headers['Cache-Control']).toBe('no-cache');
  expect(mutation[2]!.url.searchParams.get('corrNr')).toBe('DEVK900001');
});

it('names a missing local include without claiming the class is missing, and releases the lock', async () => {
  const state = backend();
  const result = await handleToolCall(createClient(), config, 'SAPWrite', { ...args, method: 'ltc_x~test' });
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain('Include "testclasses" does not exist in ZRACE');
  expect(result.content[0]?.text).toContain('action="update"');
  expect(state.sends.some((s) => s.method === 'PUT')).toBe(false);
  expect(state.sends.some((s) => s.url.searchParams.get('_action') === 'UNLOCK')).toBe(true);
  expect(state.locked).toBe(false);
});

it('ignores cached draft absence, cached source and recent activation when selecting editable bytes', async () => {
  const state = backend();
  const client = createClient();
  const cache = new CachingLayer(new MemoryCache());
  await cache.inactiveLists.getOrFetch(client);
  cache.markActivated('CLAS', 'ZRACE', initial);
  expect(cache.inactiveLists.getCached(client.username)).toEqual([]);
  const result = await handleToolCall(client, config, 'SAPWrite', args, undefined, undefined, cache);
  expect(result.isError).toBeUndefined();
  expect(state.source).toContain('draft-other');
  expect(state.source).toContain("DATA(value) = 'new'");
  expect(cache.wasRecentlyActivated('CLAS', 'ZRACE')).toBe(false);
  expect(cache.inactiveLists.getCached(client.username)).toBeNull();
});

it('unlocks and refuses the write when the protected source read fails', async () => {
  const state = backend({ readStatus: 403 });
  const result = await handleToolCall(createClient(), config, 'SAPWrite', args);
  expect(result.isError).toBe(true);
  expect(state.sends.some((s) => s.method === 'PUT')).toBe(false);
  expect(state.locked).toBe(false);
});

it.each([
  {
    label: 'unit removed by another writer',
    sourceAtLock: external.replace('METHOD target.', 'METHOD renamed.'),
    replacement: args.source,
  },
  {
    label: 'malformed replacement',
    sourceAtLock: external,
    replacement: 'METHOD target.\n not_an_abap_statement.\nENDMETHOD.',
  },
])('unlocks without a PUT after $label', async ({ sourceAtLock, replacement }) => {
  const state = backend({ sourceAtLock });
  const result = await handleToolCall(createClient(), config, 'SAPWrite', { ...args, source: replacement });
  expect(result.isError).toBe(true);
  expect(state.sends.some((s) => s.method === 'PUT')).toBe(false);
  expect(state.source).toBe(sourceAtLock);
  expect(state.locked).toBe(false);
});

it.each(['write', 'unlock'] as const)(
  'invalidates stale caches and attempts unlock after a %s failure',
  async (phase) => {
    const state = backend(phase === 'write' ? { putStatus: 500 } : { unlockStatus: 400 });
    const client = createClient();
    const cache = new CachingLayer(new MemoryCache());
    const invalidate = vi.spyOn(cache, 'invalidate');
    const result = await handleToolCall(client, config, 'SAPWrite', args, undefined, undefined, cache);
    expect(result.isError).toBe(true);
    expect(state.sends.filter((s) => s.method === 'PUT')).toHaveLength(1);
    expect(state.sends.filter((s) => s.url.searchParams.get('_action') === 'UNLOCK')).toHaveLength(1);
    expect(invalidate).toHaveBeenCalledWith('CLAS', 'ZRACE', 'all');
    if (phase === 'write') expect(state.locked).toBe(false);
  },
);

it.each([200, 400])('preserves the SAP write outcome when cache cleanup throws (HTTP %s)', async (status) => {
  const state = backend(status === 200 ? {} : { putStatus: status });
  const cache = new CachingLayer(new MemoryCache());
  vi.spyOn(cache, 'invalidate').mockImplementation(() => {
    throw new Error('SQLITE_BUSY');
  });
  const result = await handleToolCall(createClient(), config, 'SAPWrite', args, undefined, undefined, cache);
  expect(Boolean(result.isError)).toBe(status !== 200);
  expect(result.content[0]?.text).not.toContain('SQLITE_BUSY');
  if (status !== 200) expect(result.content[0]?.text).toContain('400');
  expect(state.sends.filter((s) => s.url.searchParams.get('_action') === 'UNLOCK')).toHaveLength(1);
  expect(state.locked).toBe(false);
});

it('does not read source, PUT or unlock when the lock is refused', async () => {
  const state = backend({ lockStatus: 423 });
  const result = await handleToolCall(createClient(), config, 'SAPWrite', args);
  expect(result.isError).toBe(true);
  expect(
    state.sends.filter((s) => s.url.pathname.startsWith(objectPath)).map((s) => s.url.searchParams.get('_action')),
  ).toEqual(['LOCK']);
});

it.each(['read-only', 'package'] as const)('preserves the %s gate before acquiring a lock', async (mode) => {
  const state = backend({ packageName: 'ZFORBIDDEN' });
  const client = createClient();
  const safety =
    mode === 'read-only' ? { ...client.safety, allowWrites: false } : { ...client.safety, allowedPackages: ['$TMP'] };
  const result = await handleToolCall(client.withSafety(safety), config, 'SAPWrite', args);
  expect(result.isError).toBe(true);
  expect(state.sends.some((s) => s.method === 'POST' || s.method === 'PUT')).toBe(false);
});

it('preserves an explicitly requested transport instead of the lock default', async () => {
  const state = backend();
  const result = await handleToolCall(createClient(), config, 'SAPWrite', { ...args, transport: 'DEVK900002' });
  expect(result.isError).toBeUndefined();
  expect(state.sends.find((s) => s.method === 'PUT')?.url.searchParams.get('corrNr')).toBe('DEVK900002');
});

it('uses the lock session for the optional SAP syntax check', async () => {
  const state = backend();
  const result = await handleToolCall(createClient(), config, 'SAPWrite', { ...args, checkBeforeWrite: true });
  // This mock returns 404 for the optional check; it remains non-blocking.
  expect(result.isError).toBeUndefined();
  const check = state.sends.find((s) => s.url.pathname === '/sap/bc/adt/checkruns');
  expect(check?.locked).toBe(true);
  expect(check?.headers['X-sap-adt-sessiontype']).toBe('stateful');
  expect(state.locked).toBe(false);
});

// Live 7.58 structure/source pair: the draft adds a method and shifts the implementation ranges.
it.each([
  { action: 'edit_method_signature', method: 'target', source: 'METHODS target IMPORTING input TYPE string.' },
  { action: 'add_method', method: 'METHODS extra.' },
  { action: 'delete_method', method: 'target' },
  { action: 'edit_class_definition', source: `${external.split('ENDCLASS.')[0]}ENDCLASS.` },
  { action: 'change_method_visibility', method: 'target', visibility: 'public' },
])('uses current source and structure under the lock for $action', async (edit) => {
  const state = backend();
  const result = await handleToolCall(createClient(), config, 'SAPWrite', { type: 'CLAS', name: 'ZRACE', ...edit });
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(state.source).toContain('draft-other');
  expect(state.source).toContain('METHODS added.');
  const reads = state.sends.filter(
    (s) =>
      s.method === 'GET' && (s.url.pathname.endsWith('/objectstructure') || s.url.pathname.endsWith('/source/main')),
  );
  expect(reads).toHaveLength(2);
  expect(
    reads.every((s) => s.locked && s.headers['Cache-Control'] === 'no-cache' && !s.url.searchParams.has('version')),
  ).toBe(true);
  expect(state.locked).toBe(false);
});
it('preserves a concurrent local include draft', async () => {
  const state = backend();
  const result = await handleToolCall(createClient(), config, 'SAPWrite', { ...args, include: 'implementations' });
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(state.source).toContain('draft-other');
  expect(state.source).toContain("DATA(value) = 'new'");
  expect(state.sends.find((s) => s.method === 'PUT')?.url.pathname).toBe(`${objectPath}/includes/implementations`);
});
