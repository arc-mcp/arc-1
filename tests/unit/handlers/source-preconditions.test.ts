import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const config = { ...DEFAULT_CONFIG, abapRelease: '758' };
const initial = "REPORT zguard.\nFORM target.\n WRITE 'old'.\nENDFORM.\n";
const replacement = "FORM target.\n WRITE 'new'.\nENDFORM.";
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const base = { type: 'PROG', name: 'ZGUARD' };

function backend(
  options: {
    drift?: boolean;
    readStatus?: number;
    missingInclude?: boolean;
    sourcePath?: string;
    initialSource?: string;
    mainSource?: string;
  } = {},
) {
  const state = {
    source: options.initialSource ?? initial,
    locked: false,
    calls: [] as Array<{ method: string; url: URL; locked: boolean; headers: Record<string, string> }>,
  };
  mockFetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    state.calls.push({ method, url, locked: state.locked, headers: init?.headers ?? {} });
    const respond = (status: number, body = '') => mockResponse(status, body, { 'x-csrf-token': 'T' });
    if (method === 'HEAD') return respond(200);
    if (method === 'POST' && url.searchParams.get('_action') === 'LOCK') {
      if (options.drift) state.source = initial.replace("'old'", "'manual-change'");
      state.locked = true;
      return respond(
        200,
        '<asx:abap><asx:values><DATA><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR>DEVK900001</CORRNR></DATA></asx:values></asx:abap>',
      );
    }
    if (method === 'POST' && url.searchParams.get('_action') === 'UNLOCK') {
      state.locked = false;
      return respond(200);
    }
    if (
      method === 'GET' &&
      (options.sourcePath
        ? url.pathname.toLowerCase() === options.sourcePath.toLowerCase()
        : url.pathname.endsWith('/source/main') ||
          /^\/sap\/bc\/adt\/oo\/classes\/[^/]+\/includes\/(testclasses|definitions|implementations)$/.test(
            url.pathname,
          ))
    ) {
      return respond(
        options.missingInclude ? 404 : state.locked ? (options.readStatus ?? 200) : 200,
        url.pathname === '/sap/bc/adt/oo/classes/ZGUARD/source/main'
          ? (options.mainSource ?? state.source)
          : state.source,
      );
    }
    if (method === 'GET')
      return respond(
        200,
        '<object xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></object>',
      );
    if (method === 'PUT') {
      state.source = String(init?.body);
      return respond(200);
    }
    return respond(404, `Unexpected ${method} ${url.pathname}`);
  });
  return state;
}

beforeEach(() => {
  vi.resetAllMocks();
  resetCachedFeatures();
});

it.each(['update', 'edit_unit'])(
  'refuses %s after an intervening edit, releases the lock, and lets a fresh read recover',
  async (action) => {
    const state = backend({ drift: true });
    const client = createClient();
    const read = await handleToolCall(client, config, 'SAPRead', { ...base, format: 'editable' });
    const snapshot = JSON.parse(read.content[0]!.text);
    expect(snapshot).toEqual({ source: initial, sourceHash: hash(initial) });
    const args = {
      ...base,
      action,
      unit: action === 'edit_unit' ? 'target' : undefined,
      source: action === 'edit_unit' ? replacement : initial.replace("'old'", "'new'"),
      expectedSourceHash: snapshot.sourceHash,
    };
    const refused = await handleToolCall(client, config, 'SAPWrite', args);
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain('Source changed');
    expect(state.source).toContain('manual-change');
    expect(state.calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(state.locked).toBe(false);
    const fresh = await handleToolCall(client, config, 'SAPRead', { ...base, format: 'editable' });
    const accepted = await handleToolCall(client, config, 'SAPWrite', {
      ...args,
      expectedSourceHash: JSON.parse(fresh.content[0]!.text).sourceHash,
    });
    expect(accepted.isError, accepted.content[0]!.text).toBeUndefined();
    expect(state.source).toContain("'new'");
    expect(state.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(state.locked).toBe(false);
    const protectedReads = state.calls.filter((c) => c.method === 'GET' && c.locked);
    expect(protectedReads).toHaveLength(2);
    expect(
      protectedReads.every((c) => !c.url.searchParams.has('version') && c.headers['Cache-Control'] === 'no-cache'),
    ).toBe(true);
  },
);

it.each([
  { type: 'CLAS', action: 'edit_method', method: 'run' },
  { type: 'CLAS', action: 'edit_class_definition' },
  { type: 'CLAS', action: 'edit_method_signature', method: 'run' },
  { type: 'CLAS', action: 'add_method', method: 'METHODS added.' },
  { type: 'CLAS', action: 'delete_method', method: 'run' },
  { type: 'CLAS', action: 'change_method_visibility', method: 'run', visibility: 'private' },
  { type: 'CLAS', action: 'update', include: 'testclasses' },
  { type: 'CLAS', action: 'edit_class_definition', include: 'definitions' },
])('guards $action $include before splice, structure or write', async (args) => {
  const state = backend({ drift: true });
  const result = await handleToolCall(createClient(), config, 'SAPWrite', {
    name: 'ZGUARD',
    source: replacement,
    ...args,
    expectedSourceHash: hash(initial),
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain('Source changed');
  expect(state.calls.some((c) => c.method === 'PUT' || c.url.pathname.endsWith('objectstructure'))).toBe(false);
  expect(state.locked).toBe(false);
});

it.each([
  { type: 'PROG/P', path: '/programs/programs/ZGUARD/source/main' },
  { type: 'INCL', path: '/programs/includes/ZGUARD/source/main' },
  { type: 'INCL', group: ' ZGROUP ', path: '/functions/groups/zgroup/includes/zguard/source/main' },
  { type: 'CLAS/OC', include: 'implementations', path: '/oo/classes/zguard/includes/implementations' },
  { type: 'CLAS', path: '/oo/classes/ZGUARD/source/main' },
  { type: 'INTF', path: '/oo/interfaces/ZGUARD/source/main' },
  { type: 'FUNC', group: 'ZGROUP', path: '/functions/groups/zgroup/fmodules/zguard/source/main' },
  { type: 'DDLS', path: '/ddic/ddl/sources/ZGUARD/source/main' },
  { type: 'DCLS', path: '/acm/dcl/sources/ZGUARD/source/main' },
  { type: 'BDEF', path: '/bo/behaviordefinitions/ZGUARD/source/main' },
  { type: 'SRVD', path: '/ddic/srvd/sources/ZGUARD/source/main' },
  { type: 'DDLX', path: '/ddic/ddlx/sources/ZGUARD/source/main' },
])('hashes raw editable $type $include source without using cached versions', async ({ path, ...args }) => {
  const state = backend({ sourcePath: `/sap/bc/adt${path}` });
  const cache = new CachingLayer(new MemoryCache());
  cache.markActivated('PROG', 'ZGUARD', 'stale cache');
  const result = await handleToolCall(
    createClient(),
    config,
    'SAPRead',
    { name: 'ZGUARD', ...args, format: 'editable' },
    undefined,
    undefined,
    cache,
  );
  expect(result.isError, result.content[0]!.text).toBeUndefined();
  expect(JSON.parse(result.content[0]!.text)).toEqual({ source: initial, sourceHash: hash(initial) });
  const reads = state.calls.filter((c) => c.method === 'GET');
  expect(reads.map((c) => c.url.pathname.toLowerCase())).toEqual([`/sap/bc/adt${path}`.toLowerCase()]);
  expect(reads[0]!.url.searchParams.has('version')).toBe(false);
  expect(reads[0]!.headers['If-None-Match']).toBeUndefined();
  expect(reads[0]!.headers['Cache-Control']).toBe('no-cache');
});

it('does not initialize a missing include when a precondition was supplied', async () => {
  const state = backend({ missingInclude: true });
  const result = await handleToolCall(createClient(), config, 'SAPWrite', {
    action: 'update',
    type: 'CLAS',
    name: 'ZGUARD',
    include: 'testclasses',
    source: '* candidate\n',
    expectedSourceHash: hash(''),
  });
  expect(result.isError).toBe(true);
  expect(state.calls.filter((c) => c.method === 'GET' && c.locked)).toHaveLength(1);
  expect(state.calls.some((c) => c.url.searchParams.get('_action') === 'UNLOCK')).toBe(true);
  expect(state.calls.filter((c) => c.method === 'POST').every((c) => c.url.searchParams.has('_action'))).toBe(true);
  expect(state.calls.some((c) => c.method === 'PUT')).toBe(false);
  expect(state.locked).toBe(false);
});

it('refuses a failed protected source read without writing', async () => {
  const state = backend({ readStatus: 403 });
  const result = await handleToolCall(createClient(), config, 'SAPWrite', {
    ...base,
    action: 'update',
    source: initial,
    expectedSourceHash: hash(initial),
  });
  expect(result.isError).toBe(true);
  expect(state.calls.some((c) => c.method === 'PUT')).toBe(false);
  expect(state.locked).toBe(false);
});

it.each([
  { action: 'delete', type: 'PROG' },
  { action: 'create', type: 'PROG' },
  { action: 'update', type: 'DRTY' },
  { action: 'update', type: 'DTEL' },
  { action: 'scaffold_rap_handlers', type: 'CLAS' },
])('rejects unsupported preconditions on $action $type before SAP contact', async (args) => {
  backend();
  const result = await handleToolCall(createClient(), config, 'SAPWrite', {
    ...args,
    name: 'ZGUARD',
    expectedSourceHash: hash(initial),
  });
  expect(result.isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});

it.each([
  { version: 'active' },
  { method: 'run' },
  { grep: 'x' },
  { action: 'diff' },
  { type: 'DRTY' },
  { include: 'elements', type: 'DDLS' },
])('refuses transformed/versioned editable reads: %j', async (args) => {
  backend();
  const result = await handleToolCall(createClient(), config, 'SAPRead', { ...base, format: 'editable', ...args });
  expect(result.isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('keeps the write safety ceiling ahead of the protected read and lock', async () => {
  const state = backend();
  const client = createClient();
  const result = await handleToolCall(client.withSafety({ ...client.safety, allowWrites: false }), config, 'SAPWrite', {
    ...base,
    action: 'update',
    source: initial,
    expectedSourceHash: hash(initial),
  });
  expect(result.isError).toBe(true);
  expect(state.calls.some((c) => c.method === 'PUT' || c.method === 'POST')).toBe(false);
});

it.each(['not-a-hash'])(
  'rejects malformed supplied preconditions rather than silently dropping them: %j',
  async (expectedSourceHash) => {
    backend();
    const result = await handleToolCall(createClient(), config, 'SAPWrite', {
      ...base,
      action: 'update',
      source: initial,
      expectedSourceHash,
    });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  },
);

it.each(['', '  ', null])('treats an empty optional hash as omitted: %j', async (expectedSourceHash) => {
  const state = backend();
  const result = await handleToolCall(createClient(), config, 'SAPWrite', {
    ...base,
    action: 'update',
    source: initial,
    expectedSourceHash,
  });
  expect(result.isError, result.content[0]!.text).toBeUndefined();
  expect(state.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  expect(state.calls.filter((c) => c.method === 'GET' && c.locked)).toHaveLength(0);
});

it.each([
  { type: 'INCL', action: 'update' },
  { type: 'INCL', action: 'edit_unit' },
  { type: 'FUNC', action: 'update' },
])('round trips an editable hash for $type $action in the same group', async ({ type, action }) => {
  const initialSource = type === 'FUNC' ? "FUNCTION zguard.\n WRITE 'old'.\nENDFUNCTION." : initial;
  const sourcePath = `/sap/bc/adt/functions/groups/zgroup/${type === 'FUNC' ? 'fmodules' : 'includes'}/zguard/source/main`;
  const state = backend({ sourcePath, initialSource });
  const client = createClient();
  const object = { type, name: 'ZGUARD', group: ' ZGROUP ' };
  const read = await handleToolCall(client, config, 'SAPRead', { ...object, format: 'editable' });
  expect(read.isError, read.content[0]!.text).toBeUndefined();
  const snapshot = JSON.parse(read.content[0]!.text);
  expect(snapshot.source).toBe(initialSource);
  const result = await handleToolCall(client, config, 'SAPWrite', {
    ...object,
    action,
    unit: action === 'edit_unit' ? 'target' : undefined,
    source: action === 'edit_unit' ? replacement : initialSource.replace("'old'", "'new'"),
    expectedSourceHash: snapshot.sourceHash,
  });
  expect(result.isError, result.content[0]!.text).toBeUndefined();
  expect(state.source).toContain("'new'");
  expect(state.calls.filter((c) => c.method === 'GET' && c.locked).map((c) => c.url.pathname.toLowerCase())).toEqual([
    sourcePath,
  ]);
});

it.each([false, true])('preserves the locked FUNC body on a parameters-only update (guarded=%s)', async (guarded) => {
  const initialSource = "FUNCTION zguard\r\n \" SAP signature template\r\n.\r\n WRITE 'precious body'.\r\nENDFUNCTION.";
  const state = backend({ initialSource });
  const result = await handleToolCall(createClient(), config, 'SAPWrite', {
    type: 'FUNC',
    name: 'ZGUARD',
    group: 'ZGROUP',
    action: 'update',
    parameters: [{ kind: 'importing', name: 'IV_X', type: 'STRING' }],
    expectedSourceHash: guarded ? hash(initialSource) : undefined,
  });
  expect(result.isError, result.content[0]!.text).toBeUndefined();
  expect(state.source).toContain('IV_X TYPE STRING');
  expect(state.source).toContain("WRITE 'precious body'");
  const reads = state.calls.filter((c) => c.method === 'GET' && c.url.pathname.endsWith('/source/main'));
  expect(reads).toHaveLength(1);
  expect(reads[0]!.locked).toBe(true);
  expect(reads[0]!.url.searchParams.has('version')).toBe(false);
  expect(state.locked).toBe(false);
});

it.each([false, true])('does not erase a FUNC body when its locked read fails (guarded=%s)', async (guarded) => {
  const state = backend({ readStatus: 403 });
  const result = await handleToolCall(createClient(), config, 'SAPWrite', {
    type: 'FUNC',
    name: 'ZGUARD',
    group: 'ZGROUP',
    action: 'update',
    parameters: [{ kind: 'importing', name: 'IV_X', type: 'STRING' }],
    expectedSourceHash: guarded ? hash(initial) : undefined,
  });
  expect(result.isError).toBe(true);
  expect(state.calls.filter((c) => c.method === 'GET' && c.locked)).toHaveLength(1);
  expect(state.calls.some((c) => c.method === 'PUT')).toBe(false);
  expect(state.source).toBe(initial);
  expect(state.locked).toBe(false);
});

it('identifies the auto-routed local include and accepts a hash re-read from that include', async () => {
  const local =
    "CLASS lhc_x DEFINITION. PUBLIC SECTION. METHODS m. ENDCLASS.\nCLASS lhc_x IMPLEMENTATION. METHOD m. WRITE 'old'. ENDMETHOD. ENDCLASS.";
  const state = backend({
    initialSource: local,
    mainSource: 'CLASS zguard DEFINITION PUBLIC. ENDCLASS. CLASS zguard IMPLEMENTATION. ENDCLASS.',
  });
  const client = createClient();
  const object = { type: 'CLAS', name: 'ZGUARD', format: 'editable' };
  const main = await handleToolCall(client, config, 'SAPRead', object);
  const edit = {
    type: 'CLAS',
    name: 'ZGUARD',
    action: 'edit_method',
    method: 'lhc_x~m',
    source: "METHOD m. WRITE 'new'. ENDMETHOD.",
  };
  const refused = await handleToolCall(client, config, 'SAPWrite', {
    ...edit,
    expectedSourceHash: JSON.parse(main.content[0]!.text).sourceHash,
  });
  expect(refused.isError).toBe(true);
  expect(refused.content[0]!.text).toContain('/includes/implementations');
  expect(refused.content[0]!.text).toContain('different object/include');
  expect(state.calls.some((c) => c.method === 'PUT')).toBe(false);
  const read = await handleToolCall(client, config, 'SAPRead', { ...object, include: 'implementations' });
  const accepted = await handleToolCall(client, config, 'SAPWrite', {
    ...edit,
    expectedSourceHash: JSON.parse(read.content[0]!.text).sourceHash,
  });
  expect(accepted.isError, accepted.content[0]!.text).toBeUndefined();
  expect(state.source).toContain("'new'");
  expect(state.locked).toBe(false);
});
