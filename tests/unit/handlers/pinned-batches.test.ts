import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { config, createWorld, fixture, install, nativeClient, type World } from './pinned-ddic-harness.js';
import { mockFetch } from './setup-undici-mock.js';

// Keep HTTP-bearing imports after the mock prologue; no real undici implementation is captured.
const { handlePrivatePinnedBatchCreate: createBatch, handlePrivatePinnedBatchActivation: activateBatch } = await import(
  '../../../src/handlers/write/pinned-batches.js'
);
const { activateBatch: nativeBatch } = await import('../../../src/adt/devtools.js');
const { AdtHttpClient } = await import('../../../src/adt/http.js');
const { requestContext } = await import('../../../src/server/context.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
let world: World;
const names = ['ZCL_BATCH_A', 'ZCL_BATCH_B', 'ZCL_BATCH_C'];
const uri = (name: string) => `/sap/bc/adt/oo/classes/${name.toLowerCase()}`;
const source = (name: string) =>
  'CLASS ' +
  name.toLowerCase() +
  ' DEFINITION PUBLIC.\nENDCLASS.\nCLASS ' +
  name.toLowerCase() +
  ' IMPLEMENTATION.\nENDCLASS.';
const object = (name: string) => ({ type: 'CLAS', name, package: '$TMP', source: source(name) });
const metadata = (name: string, pkg = '$TMP') =>
  '<c:abapClass xmlns:c="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="' +
  name +
  '" adtcore:type="CLAS/OC" adtcore:version="inactive"><adtcore:packageRef adtcore:type="DEVC/K" adtcore:name="' +
  pkg +
  '"/></c:abapClass>';
const submitted = () =>
  world.calls.filter(
    (call) =>
      call.method === 'POST' && ['/sap/bc/adt/activation', '/sap/bc/adt/oo/classes'].includes(call.path.split('?')[0]),
  );
const activations = () => submitted().filter((call) => call.path.includes('/activation'));
function seed(created = false) {
  for (const name of names)
    world.objects.set(uri(name), {
      metadata: created ? metadata(name) : '',
      nativeType: 'CLAS/OC',
      source: created ? source(name) : '',
    });
}
const resultBody = (result: Awaited<ReturnType<typeof createBatch>>) => JSON.parse(result.content[0].text);
async function create(items: Record<string, unknown>[] = names.slice(0, 2).map(object), extra = {}) {
  return createBatch(nativeClient(), config, { action: 'batch_create', objects: items, ...extra }, ['read', 'write']);
}
async function activation(
  items: Record<string, unknown>[] = names.slice(0, 2).map((name) => ({ type: 'CLAS', name })),
) {
  return activateBatch(nativeClient(), config, { objects: items }, ['read', 'write']);
}
function intercept(fn: (url: URL, init: any, next: () => Promise<any>) => Promise<any>) {
  const base = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation((url, init = {}) => fn(new URL(String(url)), init, () => base(url, init)));
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  resetCachedFeatures();
  world = createWorld();
  install(world);
  seed();
});
afterEach(() => {
  expect(world.unexpected).toEqual([]);
  resetCachedFeatures();
  vi.restoreAllMocks();
});

it.each([false, true])(
  'creates and activates through shared real adapters, activateAtEnd=%s',
  async (activateAtEnd) => {
    const result = await create(undefined, { activateAtEnd });
    expect(result.isError, result.content[0].text).toBeUndefined();
    const body = resultBody(result);
    expect(body.ok).toBe(true);
    expect(body.objects.map((item: any) => [item.create.status, item.activation.status])).toEqual([
      ['confirmed', 'confirmed'],
      ['confirmed', 'confirmed'],
    ]);
    expect(activations()).toHaveLength(activateAtEnd ? 2 : 4);
    const firstActivation = world.calls.findIndex((call) => call.path.includes('/activation'));
    expect(world.calls.slice(0, firstActivation).filter((call) => call.method === 'PUT')).toHaveLength(
      activateAtEnd ? 2 : 1,
    );
    expect(submitted().filter((call) => call.path.split('?')[0] === '/sap/bc/adt/oo/classes')).toHaveLength(2);
    expect(world.objects.get(uri(names[0]))?.source).toBe(source(names[0]));
    expect(result.content[0].text).not.toContain('native-lock');
  },
);

it.each([
  { type: 'CLAS', name: 'lowercase', source: 'x', package: '$TMP' },
  { type: 'CLAS', name: names[1], source: '   ', package: '$TMP' },
  { type: 'CLAS', name: names[1], source: source(names[1]), package: '$TMP', target: 'OTHER/100' },
  { type: 'ENHO', name: 'ZENHO', package: '$TMP', source: '{}' },
  { type: 'SKTD', name: 'ZDOC', package: '$TMP' },
  { type: 'DRTY', name: 'ZTYPE', package: '$TMP', source: 'x' },
  { type: 'FUGR', name: 'ZGROUP', package: '$TMP' },
  { type: 'INCL', name: 'LZGROUPTOP', group: 'ZGROUP', package: '$TMP', source: '* include' },
  { type: 'TTYP', name: 'ZTTYP', package: '$TMP' },
  { type: 'ENQU', name: 'ZENQU', package: '$TMP', source: 'not JSON' },
  { type: 'SRVB', name: 'ZBIND', package: '$TMP' },
  { type: 'DOMA', name: 'ZDOM', package: '$TMP', fixedValues: [{ low: 'X', target: 'OTHER/100' }] },
  { type: 'FUNC', name: 'ZFUNC', group: 'ZGROUP', processingType: 'update' },
  { type: 'FUNC', name: 'ZFUNC', source: 'FUNCTION zfunc. ENDFUNCTION.' },
])('validates every later input before any earlier native request: $type $name', async (later) => {
  const result = await create([object(names[0]), later]);
  expect(result.isError).toBe(true);
  expect(world.calls).toEqual([]);
});

it.each(
  ['toString', 'constructor', 'hasOwnProperty'].flatMap((field) =>
    ['first-item', 'later-item', 'nested-fixed-value'].map((level) => ({ field, level })),
  ),
)('refuses JSON inherited-name field $field at $level before native requests', async ({ field, level }) => {
  const unexpectedFieldItem = { ...object(names[level === 'first-item' ? 0 : 1]), [field]: 'unrecognized' };
  world.objects.set('/sap/bc/adt/ddic/domains/ZDOMAIN', { metadata: '', nativeType: 'DOMA/DD' });
  const later =
    level === 'nested-fixed-value'
      ? {
          type: 'DOMA',
          name: 'ZDOMAIN',
          package: '$TMP',
          dataType: 'CHAR',
          length: 4,
          fixedValues: [{ low: 'A', description: 'Allowed', [field]: 'unrecognized' }],
        }
      : unexpectedFieldItem;
  // Model the real JSON boundary: these are own data fields, not custom object prototypes.
  const input = JSON.parse(
    JSON.stringify({
      action: 'batch_create',
      activateAtEnd: true,
      objects: level === 'first-item' ? [unexpectedFieldItem] : [object(names[0]), later],
    }),
  );
  const result = await createBatch(nativeClient(), config, input, ['read', 'write']);
  expect(
    result.isError,
    JSON.stringify({ field, level, calls: world.calls.length, state: resultBody(result).state }),
  ).toBe(true);
  expect(resultBody(result).message).toBe('Unsupported nested batch input field.');
  expect(world.calls).toEqual([]);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('runs shared deterministic quality/build checks for later items before earlier creates', async () => {
  const result = await createBatch(
    nativeClient(),
    { ...config, lintBeforeWrite: true },
    {
      action: 'batch_create',
      objects: [
        object(names[0]),
        { ...object(names[1]), source: 'CLASS broken DEFINITION PUBLIC. definitely invalid !!' },
      ],
    },
    ['write'],
  );
  expect(result.isError).toBe(true);
  expect(world.calls).toEqual([]);
});

it.each([
  { objects: [object(names[0]), object(names[0])] },
  { objects: [object(names[0]), { ...object(names[0]), type: 'INTF' }] },
  { objects: [] },
  { objects: Array.from({ length: 11 }, (_, i) => object(`ZCL_${i}`)) },
  { objects: [{ ...object(names[0]), source: 'x'.repeat(256 * 1024 + 1) }] },
  { objects: [object(names[0])], activateAtEnd: 'true' },
  { objects: [object(names[0])], preaudit: false },
  { objects: [object(names[0])], scopes: ['admin'] },
  { objects: [object(names[0])], target: 'OTHER/100' },
])('rejects unsupported batch envelope/bounds with zero HTTP', async (args) => {
  expect((await createBatch(nativeClient(), config, { action: 'batch_create', ...args }, ['write'])).isError).toBe(
    true,
  );
  expect(world.calls).toEqual([]);
});

it.each(['SAPWrite.batch_create', 'SAPWrite.create', 'SAPActivate.activate', 'SAPActivate.*', 'SAPWrite'])(
  'checks outer and nested action denial %s before HTTP',
  async (deny) => {
    expect(
      (
        await createBatch(
          nativeClient(),
          { ...config, denyActions: [deny] },
          { action: 'batch_create', objects: [object(names[0])] },
          ['write'],
        )
      ).isError,
    ).toBe(true);
    expect(world.calls).toEqual([]);
  },
);
it.each([{ scopes: [] }, { scopes: ['read'] }, { scopes: ['admin'] }])(
  'requires raw write scope, scopes=$scopes',
  async ({ scopes }) => {
    expect(
      (await createBatch(nativeClient(), config, { action: 'batch_create', objects: [object(names[0])] }, scopes))
        .isError,
    ).toBe(true);
    expect(world.calls).toEqual([]);
  },
);
it.each([
  { ppEnabled: false },
  { ppStrict: false },
  { allowWrites: false },
  { multiTargetEndpoints: false },
  { targetId: 'B4H/100' },
  { multiTargetWrite: { ...config.multiTargetWrite, enabled: false } },
  { multiTargetWrite: { ...config.multiTargetWrite, target: 'B4H/100' } },
])('requires matching strict-PP route and global/destination write policy %j', async (patch) => {
  expect(
    (
      await createBatch(
        nativeClient(),
        { ...config, ...patch },
        { action: 'batch_create', objects: [object(names[0])] },
        ['write'],
      )
    ).isError,
  ).toBe(true);
  expect(world.calls).toEqual([]);
});

it('authorizes all initial activation owners before the first preaudit can mutate', async () => {
  seed(true);
  world.objects.get(uri(names[1]))!.metadata = metadata(names[1], 'ZDENIED');
  const result = await activation();
  expect(result.isError).toBe(true);
  expect(activations()).toEqual([]);
  expect(resultBody(result).objects[0].activation.status).toBe('not-attempted');
});
it('reports each exact attempted owner and its allowed native include expansion', async () => {
  seed(true);
  const include = `${uri(names[0])}/includes/implementations`;
  world.preauditRefs = [{ uri: include, name: 'GENERATED_LOCAL_IMPLEMENTATION' }];
  const result = await activation();
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(resultBody(result).objects.map((item: any) => item.activation.attemptedScope)).toEqual([
    [uri(names[0]), include],
    [uri(names[1])],
  ]);
  expect(activations()).toHaveLength(2);
});
it('deduplicates exact activation owners after checking the raw input count', async () => {
  seed(true);
  const result = await activation([
    { type: 'CLAS', name: names[0] },
    { type: 'CLAS', name: names[0] },
  ]);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(resultBody(result).objects).toHaveLength(1);
  expect(activations()).toHaveLength(2);
  expect((await activation(Array.from({ length: 11 }, () => ({ type: 'CLAS', name: names[0] })))).isError).toBe(true);
  expect(activations()).toHaveLength(2);
});
it('rejects conflicting owner kinds and nested target selectors before activation reads', async () => {
  expect(
    (
      await activation([
        { type: 'CLAS', name: names[0] },
        { type: 'INTF', name: names[0] },
      ])
    ).isError,
  ).toBe(true);
  expect((await activation([{ type: 'CLAS', name: names[0], target: 'B/002' }])).isError).toBe(true);
  expect(world.calls).toEqual([]);
});

it.each(['foreign', 'duplicate', 'omitted', 'raw-limit', 'wrong-type'])(
  'refuses %s native preaudit references without confirmation',
  async (fault) => {
    seed(true);
    if (fault === 'foreign') world.preauditRefs = [{ uri: uri(names[2]), name: names[2] }];
    if (fault === 'duplicate') world.preauditRefs = [{ uri: uri(names[0]), name: names[0] }];
    if (fault === 'raw-limit')
      world.preauditRefs = Array.from({ length: 101 }, () => ({ uri: uri(names[0]), name: names[0] }));
    if (fault === 'omitted' || fault === 'wrong-type')
      intercept(async (url, _init, next) => {
        if (url.pathname === '/sap/bc/adt/activation')
          return mockResponse(
            200,
            '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:c="http://www.sap.com/adt/core"><ioc:entry><ioc:object><ioc:ref c:uri="' +
              uri(names[0]) +
              '" c:name="' +
              names[0] +
              '"' +
              (fault === 'wrong-type' ? ' c:type="INTF/OI"' : '') +
              '/></ioc:object></ioc:entry></ioc:inactiveObjects>',
          );
        return next();
      });
    const result = await activation();
    expect(result.isError).toBe(true);
    expect(mockFetch.mock.calls.filter(([url]) => String(url).includes('preauditRequested=false'))).toHaveLength(0);
    expect(mockFetch.mock.calls.filter(([url]) => String(url).includes('preauditRequested=true'))).toHaveLength(1);
    expect(resultBody(result).objects.every((entry: any) => entry.activation.status !== 'confirmed')).toBe(true);
    expect(resultBody(result).objects.map((entry: any) => entry.activation.attemptedScope)).toEqual(
      names.slice(0, 2).map((name) => [uri(name)]),
    );
  },
);

it.each([false, true])(
  'preserves first item results when a later create is ambiguous; deferred=%s',
  async (activateAtEnd) => {
    intercept(async (url, init, next) => {
      if (url.pathname === '/sap/bc/adt/oo/classes' && String(init.body).includes(names[1]))
        world.faults.add('create-unknown');
      return next();
    });
    const result = await create(undefined, { activateAtEnd });
    expect(result.isError).toBe(true);
    const rows = resultBody(result).objects;
    expect(rows[0].create.status).toBe('confirmed');
    expect(rows[0].activation.status).toBe(activateAtEnd ? 'not-attempted' : 'confirmed');
    expect(rows[1].create.result.state).toBe('creation-unknown');
    expect(activations()).toHaveLength(activateAtEnd ? 0 : 2);
    expect(submitted().filter((entry) => entry.path.split('?')[0] === '/sap/bc/adt/oo/classes')).toHaveLength(2);
  },
);
it('preserves all saved sources after failed deferred activation and never retries ED064', async () => {
  world.activationMessages =
    '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="false"/><chkl:message><chkl:text>ED064</chkl:text><chkl:type>E</chkl:type></chkl:message></chkl:messages>';
  const result = await create(undefined, { activateAtEnd: true });
  expect(result.isError).toBe(true);
  expect(
    resultBody(result).objects.every(
      (row: any) => row.create.status === 'confirmed' && row.activation.status !== 'confirmed',
    ),
  ).toBe(true);
  expect(activations()).toHaveLength(2);
});
it('stops after a confirmed save with failed own cleanup', async () => {
  world.faults.add('unlock');
  const result = await create(undefined, { activateAtEnd: true });
  expect(result.isError).toBe(true);
  const rows = resultBody(result).objects;
  expect(rows[0].create.result.state).toBe('saved-inactive');
  expect(rows[0].create.result.cleanupFailed).toBe(true);
  expect(rows[1].create.status).toBe('not-attempted');
  expect(activations()).toEqual([]);
});

it.each(['cancel', 'deadline'])('stops %s between owners without discarding confirmed saves', async (mode) => {
  const abort = new AbortController(),
    now = Date.now(),
    clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  let unlocked = false;
  intercept(async (url, _init, next) => {
    const response = await next();
    if (url.searchParams.get('_action') === 'UNLOCK' && !unlocked) {
      unlocked = true;
      if (mode === 'cancel') abort.abort();
      else clock.mockReturnValue(now + 300_001);
    }
    return response;
  });
  const result = await requestContext.run({ signal: abort.signal } as any, () =>
    create(undefined, { activateAtEnd: true }),
  );
  expect(result.isError).toBe(true);
  const rows = resultBody(result).objects;
  expect(rows[0].create.status).toBe('confirmed');
  expect(rows[1].create.status).toBe('not-attempted');
  expect(world.calls.some((call) => call.path.includes('/http/sessions'))).toBe(true);
  expect(activations()).toEqual([]);
});
it('uses one non-replayable outer deadline for create, recording and activation', async () => {
  const spy = vi.spyOn(AdtHttpClient.prototype, 'post');
  const result = await create(undefined, { activateAtEnd: true });
  expect(result.isError, result.content[0].text).toBeUndefined();
  const options = spy.mock.calls.filter(([path]) => !path.includes('_action=UNLOCK')).map((call) => call[4]);
  expect(options.length).toBeGreaterThan(6);
  expect(
    options.every(
      (value) => value?.noReplay === true && value.retryTransientErrors === false && Number.isFinite(value.deadline),
    ),
  ).toBe(true);
  expect(new Set(options.map((value) => value!.deadline)).size).toBe(1);
});
it('retains readback verification for a mixed DDIC/class batch', async () => {
  seed(true);
  const path = '/sap/bc/adt/ddic/domains/BUKRS';
  world.objects.set(path, {
    metadata: fixture('xml/domain-metadata.xml')
      .replace(/(packageRef[^>]*adtcore:name=")[^"]*/, '$1ZTEAM')
      .replace('adtcore:version="active"', 'adtcore:version="inactive"'),
    nativeType: 'DOMA/DD',
  });
  const result = await activation([
    { type: 'CLAS', name: names[0] },
    { type: 'DOMA', name: 'BUKRS' },
  ]);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(resultBody(result).objects[1].activation.result.nativeStateVerified).toBe(true);
});
it('preserves earlier activation proof when a later owner readback is unconfirmed', async () => {
  seed(true);
  const path = '/sap/bc/adt/ddic/domains/BUKRS';
  world.objects.set(path, {
    metadata: fixture('xml/domain-metadata.xml')
      .replace(/(packageRef[^>]*adtcore:name=")[^"]*/, '$1ZTEAM')
      .replace('adtcore:version="active"', 'adtcore:version="inactive"'),
    nativeType: 'DOMA/DD',
  });
  world.faults.add('still-inactive');
  const result = await activation([
    { type: 'CLAS', name: names[0] },
    { type: 'DOMA', name: 'BUKRS' },
  ]);
  expect(result.isError).toBe(true);
  const rows = resultBody(result).objects;
  expect(rows[0].activation.status).toBe('confirmed');
  expect(rows[1].activation.result.nativeActivation.success).toBe(true);
  expect(rows[1].activation.status).toBe('failed');
});
it('keeps raw multi-target native batching and public invocation refused', async () => {
  const client = nativeClient();
  await expect(
    nativeBatch(client.http, client.safety, [{ url: uri(names[0]), name: names[0] }], {
      validateReferences: async () => {},
    }),
  ).rejects.toThrow('scoped validator');
  expect(
    (await handleToolCall(client, config, 'SAPWrite', { action: 'batch_create', objects: [object(names[0])] })).isError,
  ).toBe(true);
  expect(
    (await handleToolCall(client, config, 'SAPActivate', { objects: [{ type: 'CLAS', name: names[0] }] })).isError,
  ).toBe(true);
  expect(world.calls).toEqual([]);
});

it.each(['global', 'destination'])(
  'checks every requested package against %s policy before any create',
  async (gate) => {
    const settings =
      gate === 'global'
        ? { ...config, allowedPackages: ['$TMP'] }
        : { ...config, multiTargetWrite: { ...config.multiTargetWrite, allowedPackages: ['$TMP'] } };
    const result = await createBatch(
      nativeClient(undefined, settings),
      settings,
      { action: 'batch_create', objects: [object(names[0]), { ...object(names[1]), package: 'ZTEAM' }] },
      ['write'],
    );
    expect(result.isError).toBe(true);
    expect(submitted()).toEqual([]);
  },
);
it('checks later explicit recording before any create', async () => {
  world.transported = true;
  const result = await create([
    { ...object(names[0]), package: 'ZTEAM', transport: 'A4HK900001' },
    { ...object(names[1]), package: 'ZTEAM', transport: 'A4HK999999' },
  ]);
  expect(result.isError).toBe(true);
  expect(submitted()).toEqual([]);
});
it.each([
  { allowWrites: false },
  { multiTargetWrite: { ...config.multiTargetWrite, enabled: false } },
  { multiTargetWrite: { ...config.multiTargetWrite, target: 'B4H/100' } },
  { denyActions: ['SAPActivate.activate'] },
])('also enforces the native client policy %j', async (patch) => {
  const result = await createBatch(
    nativeClient(undefined, patch),
    config,
    { action: 'batch_create', objects: [object(names[0])] },
    ['write'],
  );
  expect(result.isError).toBe(true);
  expect(world.calls).toEqual([]);
});
it.each(['APLO', 'UIAD', 'FUGR', 'ENHO', 'SKTD'])(
  'keeps unqualified batch activation type %s refused before HTTP',
  async (type) => {
    expect((await activation([{ type, name: 'ZOBJECT' }])).isError).toBe(true);
    expect(world.calls).toEqual([]);
  },
);
it('rejects platform-specific types before any native request', async () => {
  const result = await activateBatch(
    nativeClient(),
    { ...config, systemType: 'btp' },
    { objects: [{ type: 'FUNC', name: 'ZFUNCTION', group: 'ZGROUP' }] },
    ['write'],
  );
  expect(result.isError).toBe(true);
  expect(world.calls).toEqual([]);
});
it('does not call a failed single-owner batch unchanged after submission', async () => {
  seed(true);
  intercept(async (url, _init, next) =>
    url.pathname === '/sap/bc/adt/activation' ? mockResponse(503, 'SECRET-LIKE-TEST') : next(),
  );
  const result = await activation([{ type: 'CLAS', name: names[0] }]);
  expect(result.isError).toBe(true);
  const body = resultBody(result);
  expect(body.state).toBe('incomplete');
  expect(body.objects[0].activation.submissionPossible).toBe(true);
  expect(result.content[0].text).not.toContain('SECRET-LIKE-TEST');
  expect(mockFetch.mock.calls.filter(([url]) => String(url).includes('/activation?'))).toHaveLength(1);
});
it('retains the native success report for unverified owners after a verification failure', async () => {
  seed(true);
  const path = '/sap/bc/adt/ddic/domains/BUKRS';
  world.objects.set(path, {
    metadata: fixture('xml/domain-metadata.xml')
      .replace(/(packageRef[^>]*adtcore:name=")[^"]*/, '$1ZTEAM')
      .replace('adtcore:version="active"', 'adtcore:version="inactive"'),
    nativeType: 'DOMA/DD',
  });
  world.faults.add('still-inactive');
  const result = await activation([
    { type: 'DOMA', name: 'BUKRS' },
    { type: 'CLAS', name: names[0] },
  ]);
  const rows = resultBody(result).objects;
  expect(rows[0].activation.status).toBe('failed');
  expect(rows[1].activation.status).toBe('unconfirmed');
  expect(rows[1].activation.result.nativeActivation.success).toBe(true);
});
it('binds the immutable batch intent before native reads', async () => {
  const items = names.slice(0, 2).map(object);
  intercept(async (_url, _init, next) => {
    items[1].name = 'ZFOREIGN';
    items[1].source = 'injected';
    return next();
  });
  const result = await create(items, { activateAtEnd: true });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(resultBody(result).objects[1].name).toBe(names[1]);
  expect(world.objects.get(uri(names[1]))?.source).toBe(source(names[1]));
});
it('bounds total batch bytes independently of per-source limits', async () => {
  const result = await create(
    Array.from({ length: 5 }, (_, i) => ({ ...object(`ZCL_BIG_${i}`), source: 'x'.repeat(256 * 1024) })),
  );
  expect(result.isError).toBe(true);
  expect(world.calls).toEqual([]);
});
it('refuses input subtype aliases that collide on one dictionary owner', async () => {
  expect(
    (
      await create([
        { type: 'TABL', name: 'ZTAB', package: '$TMP' },
        { type: 'TABL/DS', name: 'ZTAB', package: '$TMP' },
      ])
    ).isError,
  ).toBe(true);
  expect(world.calls).toEqual([]);
});
it('prevents a native preaudit draft change from reaching confirmation', async () => {
  seed(true);
  const path = '/sap/bc/adt/ddic/domains/BUKRS';
  world.objects.set(path, {
    metadata: fixture('xml/domain-metadata.xml')
      .replace(/(packageRef[^>]*adtcore:name=")[^"]*/, '$1ZTEAM')
      .replace('adtcore:version="active"', 'adtcore:version="inactive"'),
    nativeType: 'DOMA/DD',
  });
  world.faults.add('draft-drift');
  const result = await activation([
    { type: 'CLAS', name: names[0] },
    { type: 'DOMA', name: 'BUKRS' },
  ]);
  expect(result.isError).toBe(true);
  expect(activations()).toHaveLength(1);
});
it('cancels during complete owner preflight before any activation POST', async () => {
  seed(true);
  const abort = new AbortController();
  intercept(async (url, _init, next) => {
    const response = await next();
    if (url.pathname === uri(names[1])) abort.abort();
    return response;
  });
  const result = await requestContext.run({ signal: abort.signal } as any, () => activation());
  expect(result.isError).toBe(true);
  expect(activations()).toEqual([]);
});
it('creates metadata and source owners with their real distinct adapters in one deferred batch', async () => {
  world.objects.set('/sap/bc/adt/ddic/domains/ZDOMAIN', { metadata: '', nativeType: 'DOMA/DD' });
  const result = await create(
    [object(names[0]), { type: 'DOMA', name: 'ZDOMAIN', package: '$TMP', dataType: 'CHAR', length: 4 }],
    { activateAtEnd: true },
  );
  expect(result.isError, result.content[0].text).toBeUndefined();
  const rows = resultBody(result).objects;
  expect(rows[0].create.result.sourceHash).toBeTypeOf('string');
  expect(rows[1].create.result.metadataHash).toBeTypeOf('string');
  expect(rows[1].activation.result.nativeStateVerified).toBe(true);
});
it('preserves the six-owner CDS dependency input order and activates only that complete set', async () => {
  const { pinnedDeclarativeSelection } = await import('../../../src/adt/pinned-repository-owner.js');
  const fixtures = [
    {
      type: 'DDLS',
      name: 'ZARC1_NV_A123456789ABCDEF',
      owner: '/sap/bc/adt/ddic/ddl/sources/zarc1_nv_a123456789abcdef',
      source:
        "// ARC1 declarative A123456789ABCDEF\n@EndUserText.label: 'ARC1 declarative A123456789ABCDEF'\n@AccessControl.authorizationCheck: #NOT_REQUIRED\n@Metadata.allowExtensions: true\ndefine root view entity ZARC1_NV_A123456789ABCDEF as select from sflight\n{\n  key carrid as Carrier,\n  key connid as ConnectionId,\n  key fldate as FlightDate\n}\n",
      description: 'ARC1 declarative A123456789ABCDEF',
    },
    {
      type: 'DDLS',
      name: 'ZARC1_NA_A123456789ABCDEF',
      owner: '/sap/bc/adt/ddic/ddl/sources/zarc1_na_a123456789abcdef',
      source:
        "// ARC1 declarative A123456789ABCDEF\n@EndUserText.label: 'ARC1 declarative A123456789ABCDEF'\ndefine root abstract entity ZARC1_NA_A123456789ABCDEF\n{\n  Item : abap.char(10);\n}\n",
      description: 'ARC1 declarative A123456789ABCDEF',
    },
    {
      type: 'DCLS',
      name: 'ZARC1_ND_A123456789ABCDEF',
      owner: '/sap/bc/adt/acm/dcl/sources/zarc1_nd_a123456789abcdef',
      source:
        "// ARC1 declarative A123456789ABCDEF\n@EndUserText.label: 'ARC1 declarative A123456789ABCDEF'\n@MappingRole: true\ndefine role ZARC1_ND_A123456789ABCDEF\n{\n  grant select on ZARC1_NV_A123456789ABCDEF;\n}\n",
      description: 'ARC1 declarative A123456789ABCDEF',
    },
    {
      type: 'DDLX',
      name: 'ZARC1_NX_A123456789ABCDEF',
      owner: '/sap/bc/adt/ddic/ddlx/sources/zarc1_nx_a123456789abcdef',
      source:
        "// ARC1 declarative A123456789ABCDEF\n@Metadata.layer: #CUSTOMER\nannotate view ZARC1_NV_A123456789ABCDEF with\n{\n  @UI.lineItem: [{ position: 10, label: 'Probe' }]\n  Carrier;\n}\n",
      description: 'ARC1 declarative A123456789ABCDEF',
    },
    {
      type: 'BDEF',
      name: 'ZARC1_NA_A123456789ABCDEF',
      owner: '/sap/bc/adt/bo/behaviordefinitions/zarc1_na_a123456789abcdef',
      source:
        '// ARC1 declarative A123456789ABCDEF\nabstract;\nstrict ( 2 );\nwith hierarchy;\ndefine behavior for ZARC1_NA_A123456789ABCDEF\n{\n  field ( mandatory : execute ) Item;\n}\n',
      description: 'ARC1 declarative A123456789ABCDEF',
    },
    {
      type: 'SRVD',
      name: 'ZARC1_NS_A123456789ABCDEF',
      owner: '/sap/bc/adt/ddic/srvd/sources/zarc1_ns_a123456789abcdef',
      source:
        "// ARC1 declarative A123456789ABCDEF\n@EndUserText.label: 'ARC1 declarative A123456789ABCDEF'\ndefine service ZARC1_NS_A123456789ABCDEF\n{\n  expose ZARC1_NV_A123456789ABCDEF as Flights;\n}\n",
      description: 'ARC1 declarative A123456789ABCDEF',
    },
  ] as const;
  world.objects.clear();
  for (const item of fixtures)
    world.objects.set(item.owner, {
      metadata: '',
      nativeType: pinnedDeclarativeSelection(item.type, item.name).native,
      source: '',
    });
  const result = await create(
    fixtures.map((item) => ({
      type: item.type,
      name: item.name,
      package: '$TMP',
      source: item.source,
      description: item.description,
    })),
    { activateAtEnd: true },
  );
  expect(result.isError, result.content[0].text).toBeUndefined();
  const rows = resultBody(result).objects;
  expect(rows.map((row: any) => `${row.type}:${row.name}`)).toEqual(
    fixtures.map((item) => `${item.type}:${item.name}`),
  );
  expect(
    rows.every((row: any) => row.create.status === 'confirmed' && row.activation.result.activeSourceVerified),
  ).toBe(true);
  expect(activations()).toHaveLength(2);
  for (const item of fixtures) expect(activations()[0].body).toContain(item.owner);
  expect(activations()[0].body.match(/<adtcore:objectReference /g)).toHaveLength(6);
});
