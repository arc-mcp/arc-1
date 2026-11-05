import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bdefName, bdefOwner, config, name, nativeClient, owner, rapWorld } from './pinned-rap-harness.js';
import { mockFetch } from './setup-undici-mock.js';

const { handlePrivatePinnedRap } = await import('../../../src/handlers/write/pinned-rap.js');
const { setCachedFeatures, resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { requestContext } = await import('../../../src/server/context.js');
const { sourceHash } = await import('../../../src/adt/source-precondition.js');
let state: ReturnType<typeof rapWorld>;
const body = (result: Awaited<ReturnType<typeof handlePrivatePinnedRap>>) => JSON.parse(result.content[0].text);
const call = (extra = {}, client = nativeClient(), selectedConfig = config) =>
  handlePrivatePinnedRap(
    client,
    selectedConfig,
    { action: 'generate_behavior_implementation', type: 'CLAS', name, bdefName, activate: false, ...extra },
    ['write'],
  );
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

it.each([
  ['name', (xml: string) => xml.replace(`adtcore:name="${name}"`, 'adtcore:name="ZOTHER"')],
  [
    'owner URI',
    (xml: string) => xml.replace('<class:abapClass ', '<class:abapClass adtcore:uri="/sap/bc/adt/oo/classes/zother" '),
  ],
  ['package URI', (xml: string) => xml.replace('/sap/bc/adt/packages/%24tmp', '/sap/bc/adt/packages/zother')],
  ['malformed package URI', (xml: string) => xml.replace('/sap/bc/adt/packages/%24tmp', '/sap/bc/adt/packages/%zz')],
  ['namespace', (xml: string) => xml.replace('http://www.sap.com/adt/oo/classes', 'urn:foreign')],
  ['category', (xml: string) => xml.replace('class:category="behaviorPool"', 'class:category="generalObjectType"')],
  ['binding', (xml: string) => xml.replaceAll(bdefName, 'ZI_OTHER')],
  ['version', (xml: string) => xml.replace('adtcore:version="inactive"', 'adtcore:version="unknown"')],
  [
    'include owner',
    (xml: string) =>
      xml.replace('abapsource:sourceUri="includes/implementations"', 'abapsource:sourceUri="../foreign"'),
  ],
] as const)('rejects native %s mismatch before LOCK', async (_kind, transform) => {
  state.metadataTransform = transform;
  const result = await call();
  expect(result.isError).toBe(true);
  expect(writes()).toEqual([]);
  expect(state.world.calls.some((call) => call.path.includes('_action=LOCK'))).toBe(false);
});
it('accepts a matching optional native owner URI and encoded package identity', async () => {
  state.metadataTransform = (xml) => xml.replace('<class:abapClass ', `<class:abapClass adtcore:uri="${owner}" `);
  const result = await call();
  expect(result.isError, result.content[0].text).toBeUndefined();
});

it.each(['server', 'destination'])('independently applies the %s package ceiling', async (side) => {
  const selected =
    side === 'server'
      ? { ...config, allowedPackages: ['ZDENIED'] }
      : { ...config, multiTargetWrite: { ...config.multiTargetWrite, allowedPackages: ['ZDENIED'] } };
  expect((await call({}, nativeClient(undefined, selected), selected)).isError).toBe(true);
  expect(writes()).toEqual([]);
});
it('refuses owner package drift under LOCK', async () => {
  state.hook = (uri) => {
    if (uri.searchParams.get('_action') === 'LOCK') state.packageName = 'ZTEAM';
  };
  const result = await call();
  expect(result.isError).toBe(true);
  expect(writes()).toEqual([]);
  expect(body(result).cleanup.sessionClosed).toBe(true);
});
it('uses the validated parent recording request for all source writes', async () => {
  state.packageName = 'ZTEAM';
  state.world.transported = true;
  const result = await call({ transport: 'A4HK900001' });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(writes().every((call) => call.path.includes('corrNr=A4HK900001'))).toBe(true);
});
it.each(['server', 'destination'])('independently applies the %s recording ceiling', async (side) => {
  state.packageName = 'ZTEAM';
  state.world.transported = true;
  const selected = {
    ...config,
    multiTargetWrite: {
      ...config.multiTargetWrite,
      ...(side === 'server' ? { serverAllowedTransports: ['A4HK999999'] } : { allowedTransports: ['A4HK999999'] }),
    },
  };
  expect((await call({ transport: 'A4HK900001' }, nativeClient(undefined, selected), selected)).isError).toBe(true);
  expect(writes()).toEqual([]);
});
it('denies include creation without treating the absent resource as an ordinary update', async () => {
  delete state.sources.implementations;
  const result = await call({}, nativeClient(), { ...config, denyActions: ['SAPWrite.create'] });
  expect(result.isError).toBe(true);
  expect(writes()).toEqual([]);
});

it('preserves edits in MAIN as well as existing CCDEF/CCIMP without extra source grants', async () => {
  state.sources.main +=
    '\nCLASS lhc_item DEFINITION INHERITING FROM cl_abap_behavior_handler.\n PRIVATE SECTION.\nENDCLASS.\nCLASS lhc_item IMPLEMENTATION.\nENDCLASS.';
  const result = await call();
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(writes()).toHaveLength(1);
  expect(writes()[0].path).toContain('/source/main?');
  expect(state.sources.main).toContain('METHOD approve.');
});
it('reports the observed readback hash after SAP newline normalization', async () => {
  state.hook = (uri, method) => {
    if (
      method === 'GET' &&
      uri.pathname.endsWith('/includes/implementations') &&
      state.sources.implementations.includes('METHOD approve.')
    )
      state.sources.implementations = state.sources.implementations.replace(/\n/g, '\r\n');
  };
  const result = await call();
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(body(result).sections[2].sourceHash).toBe(sourceHash(state.sources.implementations));
});
it('retains save uncertainty when native editable readback differs', async () => {
  state.hook = (uri, method) => {
    if (
      method === 'GET' &&
      uri.pathname.endsWith('/includes/implementations') &&
      state.sources.implementations.includes('METHOD approve.')
    )
      state.sources.implementations += '\n* unexpected native change';
  };
  const result = await call({ activate: true });
  expect(result.isError).toBe(true);
  expect(body(result).sections[2].state).toBe('save-unconfirmed');
  expect(writes()).toHaveLength(1);
  expect(activations()).toEqual([]);
});
it.each([
  'METHOD helper.\nENDCLASS.',
  'ENDMETHOD.\nENDCLASS.',
  'METHOD helper.\nENDMETHOD.\nMETHOD helper.\nENDMETHOD.\nENDCLASS.',
])('refuses incomplete or duplicate existing method blocks before saving (%s)', async (tail) => {
  state.sources.implementations = `CLASS lhc_item IMPLEMENTATION.\n${tail}`;
  const result = await call();
  expect(result.isError).toBe(true);
  expect(writes()).toEqual([]);
});
it('activation-only reruns retain the lock and default activation', async () => {
  expect((await call()).isError).toBeUndefined();
  state.sourceCalls.length = 0;
  state.world.calls.length = 0;
  const result = await call({ activate: true });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(writes()).toEqual([]);
  expect(activations()).toHaveLength(2);
  expect(body(result).activation.status).toBe('confirmed');
});
it('rejects an expanded BDEF owner without granting it mutation rights from a dependency read', async () => {
  state.world.preauditRefs.push({ uri: bdefOwner, type: 'BDEF/BDO', name: bdefName });
  const result = await call({ activate: true });
  expect(result.isError).toBe(true);
  expect(activations()).toHaveLength(1);
});
it('retains whole-class scope for its existing macros/test includes without editing them', async () => {
  state.sources.macros = '* unrelated existing draft';
  state.world.preauditRefs.push({ uri: `${owner}/includes/macros`, type: 'CLAS/I', name });
  const result = await call({ activate: true });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(body(result).activation.scope).toContain(`${owner}/includes/macros`);
  expect(writes().every((call) => !call.path.includes('/macros'))).toBe(true);
});
it('does not confirm mismatched active source after successful native activation', async () => {
  state.hook = (uri, method) => {
    if (method === 'GET' && uri.searchParams.get('version') === 'active')
      state.active.implementations = '* different active source';
  };
  const result = await call({ activate: true });
  expect(result.isError).toBe(true);
  expect(body(result).activation.status).toBe('unconfirmed');
  expect(activations()).toHaveLength(2);
});
it('catches BDEF drift during the final active readback', async () => {
  state.hook = (uri) => {
    if (uri.pathname.endsWith('/includes/implementations') && uri.searchParams.get('version') === 'active')
      state.bdefSource += '\n// drift';
  };
  const result = await call({ activate: true });
  expect(result.isError).toBe(true);
  expect(body(result).activation.status).toBe('unconfirmed');
});
it('requires confirmed session close before activating saved sources', async () => {
  state.fault = (uri) => (uri.pathname.includes('/http/sessions') ? { status: 503, body: 'unavailable' } : undefined);
  const result = await call({ activate: true });
  expect(result.isError).toBe(true);
  expect(body(result).cleanup.sessionClosed).toBe(false);
  expect(activations()).toEqual([]);
});
it('does not renew the five-minute budget for activation after saving', async () => {
  const start = Date.now();
  let now = start;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  state.hook = (uri) => {
    if (uri.searchParams.get('_action') === 'UNLOCK') now = start + 300_001;
  };
  const result = await call({ activate: true });
  expect(result.isError).toBe(true);
  expect(body(result).sections[2].state).toBe('saved');
  expect(activations()).toEqual([]);
});
it('cancels after a successful include save without submitting activation', async () => {
  const abort = new AbortController();
  state.hook = (uri, method) => {
    if (
      method === 'GET' &&
      uri.pathname.endsWith('/includes/implementations') &&
      state.sources.implementations.includes('METHOD approve.')
    )
      abort.abort();
  };
  const result = await requestContext.run({ signal: abort.signal } as any, () => call({ activate: true }));
  expect(result.isError).toBe(true);
  expect(body(result).state).toBe('incomplete');
  expect(activations()).toEqual([]);
  expect(body(result).cleanup.sessionClosed).toBe(true);
});
it('requires target-specific RAP availability before HTTP', async () => {
  resetCachedFeatures();
  setCachedFeatures({ rap: { id: 'rap', available: true, mode: 'on' } }, 'OTHER/100');
  expect((await call()).isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
it('ignores braces and handler keywords inside BDEF comments and literals', async () => {
  state.bdefSource = `// } action false\n/* { function unsupported */\n${state.bdefSource}`;
  const result = await call();
  expect(result.isError, result.content[0].text).toBeUndefined();
});
