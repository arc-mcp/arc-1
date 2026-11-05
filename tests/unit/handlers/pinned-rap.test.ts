import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bdef, bdefName, bdefOwner, config, name, nativeClient, rapWorld } from './pinned-rap-harness.js';
import { mockFetch } from './setup-undici-mock.js';

// Load HTTP-bearing modules only after the undici mock prologue.
const { handlePrivatePinnedRap } = await import('../../../src/handlers/write/pinned-rap.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { generateBehaviorImplementation } = await import('../../../src/adt/rap-generate.js');
const { setCachedFeatures, resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { requestContext } = await import('../../../src/server/context.js');
let state: ReturnType<typeof rapWorld>;
const actions = ['scaffold_rap_handlers', 'generate_behavior_implementation'];
const body = (result: Awaited<ReturnType<typeof handlePrivatePinnedRap>>) => JSON.parse(result.content[0].text);
async function call(action = actions[1], extra: Record<string, unknown> = {}, override = {}, scopes = ['write']) {
  return handlePrivatePinnedRap(
    nativeClient(),
    { ...config, ...override },
    {
      action,
      type: 'CLAS',
      name,
      bdefName,
      ...(action === actions[0] ? { autoApply: true } : { activate: false }),
      ...extra,
    },
    scopes,
  );
}
const writes = () => state.sourceCalls.filter((call) => call.method !== 'GET');
const activations = () => state.world.calls.filter((call) => call.path.startsWith('/sap/bc/adt/activation'));
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  resetCachedFeatures();
  state = rapWorld();
  setCachedFeatures({ rap: { id: 'rap', available: true, mode: 'auto' } }, config.targetId);
});
afterEach(() => {
  expect(state.world.unexpected).toEqual([]);
  resetCachedFeatures();
  vi.restoreAllMocks();
});

it.each(actions)('%s shares the real planner and preserves a colleague edit completed before LOCK', async (action) => {
  state.hook = (uri) => {
    if (uri.searchParams.get('_action') === 'LOCK') state.sources.implementations += '\n* colleague edit';
  };
  const result = await call(action);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(body(result).state).toBe('saved-inactive');
  expect(state.sources.implementations).toContain('* colleague edit');
  expect(state.sources.implementations).toMatch(/METHOD approve\./i);
  expect(writes()).toHaveLength(1);
  expect(writes()[0].path).toContain('/includes/implementations?');
  expect(state.sourceCalls.every((call) => call.locked)).toBe(true);
  expect(state.world.locked).toBeUndefined();
  expect(body(result).cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  expect(activations()).toEqual([]);
  expect(result.content[0].text).not.toContain('native-lock');
});

it.each(actions)('%s previews using GETs only and does not gate the read-only BDEF package', async (action) => {
  const result = await call(action, action === actions[0] ? { autoApply: false } : { dryRun: true });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(writes()).toEqual([]);
  expect(state.world.calls.every((call) => call.method === 'GET')).toBe(true);
  expect(body(result).dependency.name).toBe(bdefName);
});

it('generates with discovered BDEF and default activation, retaining exact active evidence', async () => {
  const result = await handlePrivatePinnedRap(nativeClient(), config, { action: actions[1], type: 'CLAS', name }, [
    'write',
  ]);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(body(result).activation.status).toBe('confirmed');
  expect(body(result).state).toBe('activated');
  expect(activations()).toHaveLength(2);
  expect(activations().every((call) => !call.locked)).toBe(true);
  expect(state.sourceCalls.some((call) => call.path.includes('version=active'))).toBe(true);
});

it.each(actions)('%s verifies a second no-op under lock without another PUT', async (action) => {
  expect((await call(action)).isError).toBeUndefined();
  state.sourceCalls.length = 0;
  state.world.calls.length = 0;
  const result = await call(action);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(writes()).toEqual([]);
  expect(state.world.calls.some((call) => call.path.includes('_action=LOCK'))).toBe(true);
});

it('initializes a typed-absent CCIMP in the same class lock and records initialization', async () => {
  delete state.sources.implementations;
  const result = await call();
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(writes().map((call) => call.method)).toEqual(['POST', 'PUT']);
  expect(writes().every((call) => call.locked)).toBe(true);
  expect(state.world.calls.filter((call) => call.path.includes('_action=LOCK'))).toHaveLength(1);
  expect(body(result).sections.find((item: any) => item.section === 'implementations')).toMatchObject({
    state: 'saved',
    initialized: true,
  });
});

it.each([403, 404, 500])('does not guess include absence from generic status %s', async (status) => {
  state.fault = (uri, method) =>
    method === 'GET' && uri.pathname.endsWith('/includes/implementations')
      ? { status, body: 'service unavailable' }
      : undefined;
  const result = await call();
  expect(result.isError).toBe(true);
  expect(writes()).toEqual([]);
  expect(body(result).cleanup.sessionClosed).toBe(true);
});

it('preserves the first section when the second save fails without activation or replay', async () => {
  state.sources.definitions =
    'CLASS lhc_item DEFINITION INHERITING FROM cl_abap_behavior_handler.\n PRIVATE SECTION.\nENDCLASS.';
  state.sources.implementations = 'CLASS lhc_item IMPLEMENTATION.\nENDCLASS.';
  let failed = 0;
  state.fault = (uri, method) => {
    if (method === 'PUT' && uri.pathname.endsWith('/includes/implementations')) {
      failed++;
      return { status: 503, body: 'unavailable' };
    }
  };
  const result = await call(actions[1], { activate: true });
  expect(result.isError).toBe(true);
  expect(failed).toBe(1);
  expect(body(result).state).toBe('incomplete');
  expect(body(result).sections.map((entry: any) => entry.state)).toEqual(['observed', 'saved', 'save-unconfirmed']);
  expect(state.sources.definitions).toContain('approve');
  expect(activations()).toEqual([]);
  expect(body(result).cleanup.sessionClosed).toBe(true);
});

it.each(['source', 'version'])('refuses BDEF %s drift after planning and before the first save', async (field) => {
  let reads = 0;
  state.hook = (uri, method) => {
    if (method === 'GET' && uri.pathname === `${bdefOwner}/source/main` && ++reads === 2) {
      if (field === 'source') state.bdefSource += '\n// changed';
      else state.bdefVersion = 'inactive';
    }
  };
  expect((await call()).isError).toBe(true);
  expect(writes()).toEqual([]);
});

it('preserves initialized-without-save when BDEF changes after include creation', async () => {
  delete state.sources.implementations;
  state.hook = (uri, method) => {
    if (method === 'POST' && uri.pathname.endsWith('/includes/implementations')) state.bdefSource += '\n// colleague';
  };
  const result = await call();
  expect(result.isError).toBe(true);
  expect(writes().map((call) => call.method)).toEqual(['POST']);
  expect(body(result).sections[2]).toMatchObject({ state: 'initialized', initialized: true });
});

it('refuses BDEF drift during preaudit and preserves saved sources without confirmation', async () => {
  state.hook = (uri) => {
    if (uri.pathname === '/sap/bc/adt/activation' && uri.searchParams.get('preauditRequested') === 'true')
      state.bdefSource += '\n// drift';
  };
  const result = await call(actions[1], { activate: true });
  expect(result.isError).toBe(true);
  expect(body(result).state).toBe('incomplete');
  expect(activations()).toHaveLength(1);
  expect(body(result).activation.status).toBe('unconfirmed');
});

it.each(['unlock', 'still-inactive'])('retains truthful %s failure', async (fault) => {
  state.world.faults.add(fault);
  const result = await call(actions[1], { activate: true });
  expect(result.isError).toBe(true);
  expect(body(result).state).toBe('incomplete');
  if (fault === 'unlock') expect(activations()).toEqual([]);
  else expect(body(result).activation.status).toBe('unconfirmed');
});

it.each([
  { expectedSourceHash: 'a'.repeat(64) },
  { expectedMetadataHash: 'a'.repeat(64) },
  { source: 'x' },
  { target: 'B4H/100' },
  { include: 'testclasses' },
  { package: '$TMP' },
  { activate: 'false' },
  { name: '/NS/ZBP_RAP' },
  { objects: [] },
  { private: true },
])('rejects raw unsupported arguments before HTTP: %j', async (extra) => {
  expect((await call(actions[1], extra)).isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});

it.each([{ scopes: [] }, { scopes: ['read'] }, { scopes: ['admin'] }])(
  'requires raw write scope: %j',
  async ({ scopes }) => {
    expect((await call(actions[1], {}, {}, scopes)).isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  },
);
it.each([
  { ppEnabled: false },
  { ppStrict: false },
  { allowWrites: false },
  { targetId: 'B4H/100' },
  { multiTargetEndpoints: false },
  { featureRap: 'off' },
])('refuses unavailable route %j', async (override) => {
  expect((await call(actions[1], {}, override)).isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
it.each(['SAPWrite.generate_behavior_implementation', 'SAPWrite.update', 'SAPActivate.activate'])(
  'honors nested denial %s before HTTP',
  async (deny) => {
    expect((await call(actions[1], { activate: true }, { denyActions: [deny] })).isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  },
);
it('keeps public dispatch and direct legacy generator closed', async () => {
  expect(
    (await handleToolCall(nativeClient(), config, 'SAPWrite', { action: actions[1], type: 'CLAS', name })).isError,
  ).toBe(true);
  await expect(generateBehaviorImplementation(nativeClient(), name)).rejects.toThrow(/registered pinned RAP/);
  expect(mockFetch).not.toHaveBeenCalled();
});

it.each([
  bdef.replace('alias Item', ''),
  bdef.replace('action approve', 'function approve'),
  bdef.replace('unique;', 'unique;\n/*'),
  bdef.repeat(11),
  'x'.repeat(256 * 1024 + 1),
])('refuses incomplete/unknown/oversized BDEF before any save', async (source) => {
  state.bdefSource = source;
  expect((await call()).isError).toBe(true);
  expect(writes()).toEqual([]);
});
it('cancels after lock and still closes its owning session', async () => {
  const abort = new AbortController();
  state.hook = (uri) => {
    if (uri.searchParams.get('_action') === 'LOCK') abort.abort();
  };
  const result = await requestContext.run({ signal: abort.signal } as any, () => call());
  expect(result.isError).toBe(true);
  expect(writes()).toEqual([]);
  expect(body(result).cleanup.sessionClosed).toBe(true);
});
