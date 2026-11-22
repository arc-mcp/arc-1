import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { FULL, featuresOff } from './handler-test-config.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

const config = { ...DEFAULT_CONFIG, abapRelease: '754', systemType: 'onprem' as const };
const initial =
  "@EndUserText.label : 'Guarded structure'\n@AbapCatalog.enhancementCategory : #NOT_EXTENSIBLE\ndefine structure zguard_s {\n  matnr : matnr;\n\n}\n";
const hash = (source: string) => createHash('sha256').update(source).digest('hex');

type Call = { method: string; url: URL; locked: boolean; headers: Record<string, string> };

/** Minimal ADT backend: repository search names the TABL subtype; one source resource is lockable. */
function backend(options: { subtype?: 'TABL/DS' | 'TABL/DT'; drift?: boolean } = {}) {
  const subtype = options.subtype ?? 'TABL/DS';
  const collection = subtype === 'TABL/DS' ? 'structures' : 'tables';
  const objectPath = `/sap/bc/adt/ddic/${collection}/ZGUARD_S`;
  const state = { source: initial, locked: false, calls: [] as Call[], objectPath };
  mockFetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    state.calls.push({ method, url, locked: state.locked, headers: init?.headers ?? {} });
    const respond = (status: number, body = '') => mockResponse(status, body, { 'x-csrf-token': 'T' });
    if (method === 'HEAD') return respond(200);
    if (method === 'GET' && url.pathname.endsWith('/informationsystem/search')) {
      return respond(
        200,
        `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="${objectPath}" adtcore:type="${subtype}" adtcore:name="ZGUARD_S"/></adtcore:objectReferences>`,
      );
    }
    if (method === 'POST' && url.searchParams.get('_action') === 'LOCK') {
      // A concurrent SE11/ADT edit that lands between the editable read and the guarded write.
      if (options.drift) state.source = initial.replace('matnr : matnr;', 'matnr : matnr;\n  werks : werks_d;');
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
    if (method === 'GET' && url.pathname === `${objectPath}/source/main`) return respond(200, state.source);
    if (method === 'GET' && url.pathname.startsWith('/sap/bc/adt/ddic/')) {
      if (!url.pathname.startsWith(objectPath)) return respond(404, 'not found');
      return respond(
        200,
        '<object xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></object>',
      );
    }
    if (method === 'PUT' && url.pathname === `${objectPath}/source/main`) {
      state.source = String(init?.body);
      return respond(200);
    }
    return respond(404, `Unexpected ${method} ${url.pathname}`);
  });
  return state;
}

const lockedReads = (state: { calls: Call[] }) => state.calls.filter((c) => c.method === 'GET' && c.locked);
const puts = (state: { calls: Call[] }) => state.calls.filter((c) => c.method === 'PUT');

beforeEach(() => {
  vi.resetAllMocks();
  resetCachedFeatures();
});

it.each([
  ['TABL/DS', '/sap/bc/adt/ddic/structures/ZGUARD_S/source/main'],
  ['TABL/DT', '/sap/bc/adt/ddic/tables/ZGUARD_S/source/main'],
] as const)('reads %s as exact editable DDL source with its hash, bypassing caches', async (subtype, path) => {
  const state = backend({ subtype });
  const result = await handleToolCall(createClient(), config, 'SAPRead', {
    type: 'TABL',
    name: 'ZGUARD_S',
    format: 'editable',
  });
  expect(result.isError, result.content[0]!.text).toBeUndefined();
  expect(JSON.parse(result.content[0]!.text)).toEqual({ source: initial, sourceHash: hash(initial) });
  const sourceReads = state.calls.filter((c) => c.method === 'GET' && c.url.pathname.endsWith('/source/main'));
  expect(sourceReads.map((c) => c.url.pathname)).toEqual([path]);
  expect(sourceReads[0]!.url.searchParams.has('version')).toBe(false);
  expect(sourceReads[0]!.headers['Cache-Control']).toBe('no-cache');
});

it.each(['TABL', 'TABL/DS'])('updates %s when expectedSourceHash matches under the lock', async (type) => {
  const state = backend();
  const client = createClient();
  const read = await handleToolCall(client, config, 'SAPRead', { type: 'TABL', name: 'ZGUARD_S', format: 'editable' });
  const { sourceHash } = JSON.parse(read.content[0]!.text);
  const next = initial.replace('matnr : matnr;', 'matnr : matnr;\n  maktx : maktx;');
  const result = await handleToolCall(client, config, 'SAPWrite', {
    action: 'update',
    type,
    name: 'ZGUARD_S',
    source: next,
    expectedSourceHash: sourceHash,
  });
  expect(result.isError, result.content[0]!.text).toBeUndefined();
  expect(state.source).toBe(next);
  expect(lockedReads(state).map((c) => c.url.pathname)).toEqual([`${state.objectPath}/source/main`]);
  expect(lockedReads(state)[0]!.headers['Cache-Control']).toBe('no-cache');
  expect(puts(state)).toHaveLength(1);
  expect(state.locked).toBe(false);
});

it('refuses a TABL update with a stale hash, writes nothing and releases the lock', async () => {
  const state = backend({ drift: true });
  const result = await handleToolCall(createClient(), config, 'SAPWrite', {
    action: 'update',
    type: 'TABL',
    name: 'ZGUARD_S',
    source: initial.replace('matnr : matnr;', 'matnr : matnr;\n  maktx : maktx;'),
    expectedSourceHash: hash(initial),
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain('Source changed');
  expect(result.content[0]!.text).toContain('/ddic/structures/ZGUARD_S/source/main');
  expect(puts(state)).toHaveLength(0);
  expect(state.source).toContain('werks : werks_d;');
  expect(state.calls.some((c) => c.url.searchParams.get('_action') === 'UNLOCK')).toBe(true);
  expect(state.locked).toBe(false);
});

it('replaces one exact match in a TABL with edit_content', async () => {
  const state = backend();
  const result = await handleToolCall(createClient(), config, 'SAPWrite', {
    action: 'edit_content',
    type: 'TABL',
    name: 'ZGUARD_S',
    oldContent: 'matnr : matnr;',
    newContent: 'matnr : matnr;\n  maktx : maktx;',
    expectedSourceHash: hash(initial),
  });
  expect(result.isError, result.content[0]!.text).toBeUndefined();
  expect(result.content[0]!.text).toContain('Successfully replaced the matching text in TABL ZGUARD_S');
  expect(state.source).toBe(initial.replace('matnr : matnr;', 'matnr : matnr;\n  maktx : maktx;'));
  expect(lockedReads(state).map((c) => c.url.pathname)).toEqual([`${state.objectPath}/source/main`]);
  expect(puts(state)).toHaveLength(1);
  expect(state.locked).toBe(false);
});

it('refuses TABL edit_content after an intervening edit without writing', async () => {
  const state = backend({ drift: true });
  const result = await handleToolCall(createClient(), config, 'SAPWrite', {
    action: 'edit_content',
    type: 'TABL/DS',
    name: 'ZGUARD_S',
    oldContent: 'matnr : matnr;',
    newContent: 'matnr : matnr;\n  maktx : maktx;',
    expectedSourceHash: hash(initial),
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain('Source changed');
  expect(puts(state)).toHaveLength(0);
  expect(state.locked).toBe(false);
});

it('refuses an editable transparent-table read where /ddic/tables is absent (NW 7.50/7.51)', async () => {
  setCachedFeatures({
    ...featuresOff(),
    abapRelease: '750',
    systemType: 'onprem',
    discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]),
  });
  const state = backend({ subtype: 'TABL/DT' });
  const result = await handleToolCall(createClient(), config, 'SAPRead', {
    type: 'TABL',
    name: 'ZGUARD_S',
    format: 'editable',
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain('NW 7.50/7.51');
  expect(result.content[0]!.text).toContain('SE11');
  expect(state.calls.some((c) => c.url.pathname.endsWith('/source/main'))).toBe(false);
});

it.each([
  { type: 'DDLS', action: 'edit_content', oldContent: 'a', newContent: 'b' },
  { type: 'TABL', action: 'edit_unit', unit: 'x', source: 'FORM x. ENDFORM.' },
])('keeps the action/type limits for $action $type before SAP contact', async (args) => {
  backend();
  const result = await handleToolCall(createClient(), config, 'SAPWrite', {
    ...args,
    name: 'ZGUARD_S',
    expectedSourceHash: hash(initial),
  });
  expect(result.isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('refuses an include on a TABL editable read', async () => {
  backend();
  const result = await handleToolCall(createClient(), config, 'SAPRead', {
    type: 'TABL',
    name: 'ZGUARD_S',
    include: 'indexes',
    format: 'editable',
  });
  expect(result.isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('updates TABL/DT with the editable hash and locks, re-reads and writes /ddic/tables/', async () => {
  const state = backend({ subtype: 'TABL/DT' });
  const client = createClient();
  const read = await handleToolCall(client, config, 'SAPRead', { type: 'TABL', name: 'ZGUARD_S', format: 'editable' });
  const next = initial.replace('matnr : matnr;', 'matnr : matnr;\n  maktx : maktx;');
  const result = await handleToolCall(client, config, 'SAPWrite', {
    action: 'update',
    type: 'TABL/DT',
    name: 'ZGUARD_S',
    source: next,
    expectedSourceHash: JSON.parse(read.content[0]!.text).sourceHash,
  });
  expect(result.isError, result.content[0]!.text).toBeUndefined();
  const tableUrl = '/sap/bc/adt/ddic/tables/ZGUARD_S';
  const lock = state.calls.find((c) => c.url.searchParams.get('_action') === 'LOCK');
  expect(lock?.url.pathname).toBe(tableUrl);
  expect(lockedReads(state).map((c) => c.url.pathname)).toEqual([`${tableUrl}/source/main`]);
  expect(puts(state).map((c) => c.url.pathname)).toEqual([`${tableUrl}/source/main`]);
  expect(state.calls.some((c) => c.url.pathname.includes('/ddic/structures/'))).toBe(false);
  expect(state.source).toBe(next);
  expect(state.locked).toBe(false);
});

const quanEdit = {
  action: 'edit_content',
  type: 'TABL',
  name: 'ZGUARD_S',
  oldContent: 'matnr : matnr;',
  newContent: 'qty   : abap.quan(13,3);',
  expectedSourceHash: hash(initial),
};

it('runs the RAP preflight on the edit_content result: abap.quan without a unit is refused', async () => {
  const state = backend();
  const result = await handleToolCall(createClient(), config, 'SAPWrite', quanEdit);
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain('TABL_QUAN_REQUIRES_UNIT');
  expect(lockedReads(state)).toHaveLength(1);
  expect(puts(state)).toHaveLength(0);
  expect(state.calls.some((c) => c.url.searchParams.get('_action') === 'UNLOCK')).toBe(true);
  expect(state.locked).toBe(false);
  expect(state.source).toBe(initial);
});

it('lets preflightBeforeWrite=false bypass the edit_content preflight', async () => {
  const state = backend();
  const result = await handleToolCall(createClient(), config, 'SAPWrite', { ...quanEdit, preflightBeforeWrite: false });
  expect(result.isError, result.content[0]!.text).toBeUndefined();
  expect(state.source).toContain('qty   : abap.quan(13,3);');
  expect(puts(state)).toHaveLength(1);
  expect(state.locked).toBe(false);
});

const tablEdit = { ...quanEdit, newContent: 'matnr : matnr;\n  maktx : maktx;' };

it.each([undefined, 'onprem', 'btp'] as const)(
  'runs TABL edit_content under SAP_SYSTEM_TYPE=auto (detected: %s)',
  async (detected) => {
    if (detected) setCachedFeatures({ ...featuresOff(), systemType: detected, abapRelease: '816' });
    const state = backend();
    const result = await handleToolCall(
      createClient(),
      { ...config, systemType: 'auto' as const },
      'SAPWrite',
      tablEdit,
    );
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(state.source).toBe(initial.replace('matnr : matnr;', 'matnr : matnr;\n  maktx : maktx;'));
    expect(puts(state)).toHaveLength(1);
    expect(state.locked).toBe(false);
  },
);

it('rejects edit_content under SAP_SYSTEM_TYPE=btp without SAP contact', async () => {
  backend();
  const result = await handleToolCall(createClient(), { ...config, systemType: 'btp' as const }, 'SAPWrite', tablEdit);
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toMatch(/"action": expected one of: (?!.*edit_content)/);
  expect(mockFetch).not.toHaveBeenCalled();
});

it.each([
  { systemType: 'onprem', detected: undefined, listed: true },
  { systemType: 'auto', detected: undefined, listed: true },
  { systemType: 'auto', detected: 'btp', listed: true },
  { systemType: 'btp', detected: 'btp', listed: false },
] as const)(
  'lists edit_content (naming TABL) everywhere except SAP_SYSTEM_TYPE=btp: %j',
  async ({ systemType, detected, listed }) => {
    const { getToolDefinitions } = await import('../../../src/handlers/tools.js');
    const tools = getToolDefinitions(
      { ...config, ...FULL, systemType },
      undefined,
      detected ? { ...featuresOff(), systemType: detected } : undefined,
    );
    const action = (tools.find((t) => t.name === 'SAPWrite')!.inputSchema.properties as Record<string, any>).action;
    expect((action.enum as string[]).includes('edit_content')).toBe(listed);
    expect(String(action.description).includes('edit_content (also TABL)')).toBe(listed);
  },
);
