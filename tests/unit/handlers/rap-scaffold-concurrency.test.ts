import { beforeEach, expect, it, vi } from 'vitest';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const actions = ['scaffold_rap_handlers', 'generate_behavior_implementation'];
const name = 'ZBP_LOCK_TEST';
const objectUrl = `/sap/bc/adt/oo/classes/${name}`;
const main = `CLASS zbp_lock_test DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zi_lock_test.
ENDCLASS.
CLASS zbp_lock_test IMPLEMENTATION.
ENDCLASS.`;
const bdef = `managed implementation in class ZBP_LOCK_TEST unique;
define behavior for ZI_LOCK_TEST alias Item
persistent table zlock_test
lock master
{
  action approve result [1] $self;
}`;
const manual = '* colleague edit completed immediately before LOCK';
const metadata = `<class:abapClass xmlns:class="http://www.sap.com/adt/classlib" xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="${name}" class:category="behaviorPool">
  <adtcore:packageRef adtcore:name="$TMP"/>
  <class:rootEntityRef adtcore:name="ZI_LOCK_TEST"/>
</class:abapClass>`;

type Options = {
  drift?: boolean;
  lockStatus?: number;
  readStatus?: number;
  failPut?: boolean;
  failSecondPut?: boolean;
  unlockStatus?: number;
};
function backend(options: Options = {}) {
  const state = {
    locked: false,
    includes: { definitions: '* declarations', implementations: '* implementations' } as Record<string, string>,
    calls: [] as Array<{ method: string; url: URL; locked: boolean; headers: Record<string, string> }>,
  };
  if (options.failSecondPut) {
    state.includes.definitions =
      'CLASS lhc_item DEFINITION INHERITING FROM cl_abap_behavior_handler.\n PRIVATE SECTION.\nENDCLASS.';
    state.includes.implementations = 'CLASS lhc_item IMPLEMENTATION.\nENDCLASS.';
  }
  mockFetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    state.calls.push({ method, url, locked: state.locked, headers: init?.headers ?? {} });
    const respond = (status: number, body = '') => mockResponse(status, body, { 'x-csrf-token': 'T' });
    if (method === 'HEAD') return respond(200);
    if (method === 'POST' && url.searchParams.get('_action') === 'LOCK') {
      if (options.lockStatus) return respond(options.lockStatus, 'locked by colleague');
      if (options.drift) state.includes.implementations += `\n${manual}`;
      state.locked = true;
      return respond(
        200,
        '<asx:abap><asx:values><DATA><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR>DEVK900001</CORRNR></DATA></asx:values></asx:abap>',
      );
    }
    if (method === 'POST' && url.searchParams.get('_action') === 'UNLOCK') {
      if (options.unlockStatus) return respond(options.unlockStatus, 'unlock refused');
      state.locked = false;
      return respond(200);
    }
    if (method === 'GET' && url.pathname === objectUrl) return respond(200, metadata);
    if (method === 'GET' && url.pathname.includes('/behaviordefinitions/')) return respond(200, bdef);
    if (method === 'GET' && url.pathname === `${objectUrl}/source/main`) return respond(200, main);
    if (url.pathname.includes('/includes/')) {
      const include = url.pathname.split('/').at(-1)!;
      if (method === 'GET') {
        if (options.readStatus && state.locked && include === 'implementations')
          return respond(options.readStatus, 'read refused');
        return include in state.includes ? respond(200, state.includes[include]!) : respond(404);
      }
      if (method === 'PUT') {
        if (options.failPut || (options.failSecondPut && include === 'implementations'))
          return respond(400, 'write refused');
        state.includes[include] = String(init?.body);
        return respond(200);
      }
    }
    return respond(404, `Unexpected ${method} ${url.pathname}`);
  });
  return state;
}

beforeEach(() => {
  vi.resetAllMocks();
  resetCachedFeatures();
});

function call(action: string, cache?: CachingLayer, preview = false) {
  return handleToolCall(
    createClient(),
    DEFAULT_CONFIG,
    'SAPWrite',
    {
      action,
      type: 'CLAS',
      name,
      bdefName: 'ZI_LOCK_TEST',
      autoApply: !preview,
      dryRun: preview,
      activate: false,
      lintBeforeWrite: false,
    },
    undefined,
    undefined,
    cache,
  );
}

it.each(actions)('%s preserves an edit completed before LOCK and reads source under that lock', async (action) => {
  const state = backend({ drift: true });
  const result = await call(action);
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(state.includes.implementations).toContain(manual);
  expect(state.includes.implementations).toMatch(/METHOD approve\./i);
  const reads = state.calls.filter(
    (c) =>
      c.method === 'GET' && /\/(source\/main|includes\/)/.test(c.url.pathname) && c.url.pathname.includes('/classes/'),
  );
  expect(reads.length).toBeGreaterThanOrEqual(3);
  expect(
    reads.every((c) => c.locked && !c.url.searchParams.has('version') && c.headers['Cache-Control'] === 'no-cache'),
  ).toBe(true);
  expect(state.locked).toBe(false);
});

it.each(actions)('%s keeps previews read-only', async (action) => {
  const state = backend();
  const result = await call(action, undefined, true);
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(state.calls.every((c) => c.method === 'GET' || c.method === 'HEAD')).toBe(true);
});

it.each(actions)('%s accepts 404 for optional includes on a new behavior pool', async (action) => {
  const state = backend();
  state.includes = {};
  const result = await call(action);
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(state.includes.implementations).toMatch(/METHOD approve\./i);
  expect(state.locked).toBe(false);
});

it.each(actions)('%s stops without writing when a locked include read fails', async (action) => {
  const state = backend({ readStatus: 403 });
  const result = await call(action);
  expect(result.isError).toBe(true);
  expect(state.calls.some((c) => c.method === 'PUT')).toBe(false);
  expect(state.locked).toBe(false);
});

it.each(actions)('%s does not read replacement source or write after a failed lock', async (action) => {
  const state = backend({ lockStatus: 423 });
  expect((await call(action)).isError).toBe(true);
  expect(state.calls.some((c) => c.url.pathname.startsWith(`${objectUrl}/source/`) || c.method === 'PUT')).toBe(false);
});

it.each(actions)('%s invalidates cached source when a write fails', async (action) => {
  const state = backend({ failPut: true });
  const cache = new CachingLayer(new MemoryCache());
  const invalidate = vi.spyOn(cache, 'invalidate');
  expect((await call(action, cache)).isError).toBe(true);
  expect(state.calls.some((c) => c.method === 'PUT')).toBe(true);
  expect(invalidate).toHaveBeenCalledWith('CLAS', name, 'all');
  expect(state.locked).toBe(false);
});

it.each(actions)('%s surfaces failed unlock after writing and invalidates cached source', async (action) => {
  const state = backend({ unlockStatus: 400 });
  const cache = new CachingLayer(new MemoryCache());
  const invalidate = vi.spyOn(cache, 'invalidate');
  expect((await call(action, cache)).isError).toBe(true);
  expect(state.calls.some((c) => c.method === 'PUT')).toBe(true);
  expect(invalidate).toHaveBeenCalledWith('CLAS', name, 'all');
});

it.each(actions)('%s invalidates after the first include saves and the second fails', async (action) => {
  const state = backend({ failSecondPut: true });
  const cache = new CachingLayer(new MemoryCache());
  const invalidate = vi.spyOn(cache, 'invalidate');
  expect((await call(action, cache)).isError).toBe(true);
  expect(state.calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
  expect(state.includes.definitions).toContain('approve');
  expect(state.includes.implementations).not.toContain('approve');
  expect(invalidate).toHaveBeenCalledWith('CLAS', name, 'all');
  expect(state.locked).toBe(false);
});

it.each(actions)('%s verifies an unchanged second run under lock without another PUT', async (action) => {
  const state = backend();
  expect((await call(action)).isError).toBeUndefined();
  state.calls.length = 0;
  expect((await call(action)).isError).toBeUndefined();
  expect(state.calls.some((c) => c.url.searchParams.get('_action') === 'LOCK')).toBe(true);
  expect(state.calls.some((c) => c.method === 'PUT')).toBe(false);
  expect(state.locked).toBe(false);
});
