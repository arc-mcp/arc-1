import { beforeEach, expect, it, type Mock, vi } from 'vitest';
import type { PublicationConfiguration, PublicationConfigurationReader } from '../../../src/adt/pinned-publication.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient } from '../handlers/setup-undici-mock.js';
import { bindingName, bindingXml, managedHarness } from './pinned-managed-harness.js';

const { executePinnedPublicationBatch } = await import('../../../src/adt/pinned-publication.js');
const { parsePinnedBinding, pinnedBindingSelection } = await import('../../../src/adt/pinned-service-binding-owner.js');
const { pinnedMutationContext } = await import('../../../src/adt/mutation-context.js');
const { DataResponseBudget } = await import('../../../src/adt/data-result-context.js');
const { publishServiceBinding, unpublishServiceBinding } = await import('../../../src/adt/service-publication.js');
const { publicationProfile } = await import('../../../src/adt/service-publication.js');
const { mutationClient } = await import('../../../src/adt/mutation-client.js');
const { handlePrivatePinnedPublication } = await import('../../../src/handlers/pinned-publication.js');
const { publicationClientResult } = await import('../../../src/handlers/pinned-publication-result.js');
const { DEFAULT_CONFIG } = await import('../../../src/server/types.js');
const { pinnedMutationAllowed } = await import('../../../src/server/multi-target-write-surface.js');

const status = (severity = 'OK') =>
  `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>${severity}</SEVERITY><SHORT_TEXT>Done</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>`;
let documents: Map<string, string>;
let fault: ((method: string, path: string) => ReturnType<typeof mockResponse> | undefined) | undefined;
let hook: ((method: string, path: string) => void) | undefined;
let harness: ReturnType<typeof managedHarness>;
let client: InstanceType<typeof AdtClient>;
let reader: Mock<PublicationConfigurationReader>;
const input = (name = bindingName, extra = {}) => ({
  name,
  version: '0001',
  serviceType: 'odatav4',
  expectedMetadataHash: parsePinnedBinding(documents.get(name)!, pinnedBindingSelection(name)).metadataHash,
  ...extra,
});
const context = (signal?: AbortSignal, limit = 4 * 1024 * 1024) =>
  pinnedMutationContext(
    client.safety,
    { deadline: Date.now() + 30_000, signal, responseBudget: new DataResponseBudget(limit, 'publication-test', true) },
    { unlockFailed: false },
  );
const call = (action = 'publish_srvb', bindings = [input()], read = reader) =>
  executePinnedPublicationBatch(client, context(), { action, bindings }, read);
const posts = () => harness.calls.filter((r) => r.method === 'POST');
const config = () => ({
  ...DEFAULT_CONFIG,
  multiTargetEndpoints: true,
  multiTargetAuthorization: 'xsuaa-attribute' as const,
  targetId: 'A4H/001',
  ppEnabled: true,
  ppStrict: true,
  allowWrites: true,
  multiTargetWrite: client.safety.multiTargetWrite,
});
beforeEach(() => {
  vi.restoreAllMocks();
  documents = new Map([
    [bindingName, bindingXml('active').replace('srvb:bindingCreated="false"', 'srvb:bindingCreated="true"')],
  ]);
  fault = undefined;
  hook = undefined;
  harness = managedHarness((request) => {
    hook?.(request.method, request.path);
    const failed = fault?.(request.method, request.path);
    if (failed) return failed;
    if (request.method === 'GET' && request.path.startsWith('/sap/bc/adt/businessservices/bindings/')) {
      const name = decodeURIComponent(request.path.split('/').at(-1)!.split('?')[0]!);
      return mockResponse(200, documents.get(name)!);
    }
    if (request.method === 'POST' && /\/(?:un)?publishjobs\?/.test(request.path)) {
      const name = new URL(request.path, 'https://example.test').searchParams.get('servicename')!;
      const published = !request.path.includes('/unpublishjobs');
      documents.set(
        name,
        documents.get(name)!.replace(/srvb:published="(?:true|false)"/, `srvb:published="${published}"`),
      );
      return mockResponse(200, status());
    }
  });
  client = new AdtClient({ client: '001', http: harness.client.http, safety: harness.client.safety });
  reader = vi.fn(async () => ({
    contract: 'sap-basis-758-onprem-v4-local' as const,
    target: 'A4H/001',
    client: '001',
    principal: 'MARIAN',
    systemCloud: false,
    userCloud: false,
    clientCategory: 'T',
    observedAt: Date.now(),
  }));
});

it('sends one exact V4 job with one reference, no replay/CTS/lock; preserves generated binding on unpublish', async () => {
  for (const action of ['publish_srvb', 'unpublish_srvb']) {
    const result = await call(action);
    expect(result, JSON.stringify(result)).toMatchObject({
      ok: true,
      submitted: 1,
      items: [{ state: 'confirmed', observed: { published: action === 'publish_srvb', bindingCreated: true } }],
    });
  }
  expect(posts()).toHaveLength(2);
  expect(posts().every((p) => p.body.match(/<adtcore:objectReference /g)?.length === 1)).toBe(true);
  expect(new Headers(posts()[0].headers).get('content-type')).toContain(
    'dataname=com.sap.adt.businessservices.odatav4.publishjob',
  );
  expect(new Headers(posts()[0].headers).get('accept')).toBe('application/vnd.sap.as+xml');
  expect(harness.calls.every((r) => !/transport|LOCK|sessions/.test(r.path))).toBe(true);
});
it('submits unpublication even when the non-recording profile getter already reports false', async () => {
  expect(await call('unpublish_srvb')).toMatchObject({
    ok: true,
    submitted: 1,
    items: [{ state: 'confirmed', observed: { published: false } }],
  });
  expect(posts()).toHaveLength(1);
  expect(posts()[0].path).toContain('/unpublishjobs?');
});
it('projects native diagnostics only for the client, leaving the complete frozen raw result unchanged', async () => {
  fault = (method) =>
    method === 'POST'
      ? mockResponse(
          200,
          status('ERROR')
            .replace('Done', 'PRIVATE_SHORT')
            .replace('<LONG_TEXT/>', '<LONG_TEXT>PRIVATE_LONG</LONG_TEXT>'),
        )
      : undefined;
  const raw = await call();
  const before = structuredClone(raw);
  for (const item of raw.items) {
    Object.freeze(item.nativeStatus);
    Object.freeze(item);
  }
  Object.freeze(raw.items);
  Object.freeze(raw);
  const projected = publicationClientResult(raw, true);
  expect(projected).toMatchObject({
    ok: false,
    state: 'incomplete',
    submitted: 1,
    items: [{ state: 'native-failed' }],
  });
  expect(projected.items[0].nativeStatus).toEqual({ severity: 'ERROR' });
  expect(JSON.stringify(projected)).not.toContain('PRIVATE_');
  expect(raw).toEqual(before);
  expect(raw.items[0].nativeStatus).toEqual({
    severity: 'ERROR',
    shortText: 'PRIVATE_SHORT',
    longText: 'PRIVATE_LONG',
  });
  expect(publicationClientResult(raw, false)).toBe(raw);
  expect(posts()).toHaveLength(1);
});
it.each([
  {},
  { systemCloud: true },
  { userCloud: true },
  { clientCategory: 'C' },
  { clientCategory: '' },
  { target: 'OTHER/001' },
  { client: '002' },
  { principal: '' },
  { observedAt: 0 },
  { contract: 'cloud' },
])('refuses invalid current-principal configuration %j', async (patch) => {
  const base = await reader(client, context());
  reader.mockResolvedValue((Object.keys(patch).length ? { ...base, ...patch } : undefined) as PublicationConfiguration);
  expect(await call()).toMatchObject({ ok: false, submitted: 0 });
  expect(posts()).toEqual([]);
});
it('requires a trusted reader; caller fields cannot create its authority', async () => {
  expect(
    await executePinnedPublicationBatch(client, context(), { action: 'publish_srvb', bindings: [input()] }),
  ).toMatchObject({ ok: false, submitted: 0 });
  expect(
    await executePinnedPublicationBatch(
      client,
      context(),
      { action: 'publish_srvb', bindings: [input()], qualified: true },
      reader,
    ),
  ).toMatchObject({ ok: false });
  expect(harness.calls).toEqual([]);
});
it.each([406, 415, 500])('never replays HTTP %s even when it names the legacy fallback MIME', async (code) => {
  fault = (method) => (method === 'POST' ? mockResponse(code, 'application/vnd.sap.as+xml') : undefined);
  expect(await call()).toMatchObject({
    ok: false,
    submitted: 1,
    items: [{ state: 'submitted-unconfirmed', statusCode: code }],
  });
  expect(posts()).toHaveLength(1);
});
it.each([
  ['', 'submitted-unconfirmed'],
  [status('UNKNOWN'), 'submitted-unconfirmed'],
  [status('ERROR'), 'native-failed'],
  [status().replace('http://www.sap.com/abapxml', 'urn:spoof'), 'submitted-unconfirmed'],
  ['x'.repeat(70 * 1024), 'submitted-unconfirmed'],
])('does not acknowledge malformed/negative native status', async (body, state) => {
  fault = (method) => (method === 'POST' ? mockResponse(200, body) : undefined);
  expect(await call()).toMatchObject({ ok: false, submitted: 1, items: [{ state }] });
  expect(posts()).toHaveLength(1);
});
it.each(['missing-state', 'changed-scope', 'get-error', 'false-after-publish'])(
  'retains acknowledgement when readback is %s',
  async (mode) => {
    let sent = false;
    hook = (method) => {
      if (method === 'POST') sent = true;
    };
    fault = (method) => {
      if (!sent || method !== 'GET') return;
      if (mode === 'get-error') return mockResponse(500, 'unavailable');
      return mockResponse(
        200,
        documents
          .get(bindingName)!
          .replace(
            mode === 'missing-state'
              ? /srvb:published="true"/
              : mode === 'changed-scope'
                ? /ZDEFINITION/g
                : /srvb:published="true"/,
            mode === 'missing-state' ? '' : mode === 'changed-scope' ? 'ZOTHER' : 'srvb:published="false"',
          ),
      );
    };
    expect(await call()).toMatchObject({ ok: false, submitted: 1, items: [{ state: 'acknowledged-unverified' }] });
    expect(posts()).toHaveLength(1);
  },
);
it('does not turn native ERROR into unpublish success from a false fallback flag', async () => {
  documents.set(bindingName, bindingXml('active', true));
  fault = (method) => (method === 'POST' ? mockResponse(200, status('ERROR')) : undefined);
  expect(await call('unpublish_srvb')).toMatchObject({ ok: false, submitted: 1, items: [{ state: 'native-failed' }] });
  expect(harness.calls.filter((r) => r.method === 'GET')).toHaveLength(4);
});
it.each(['hash', 'package', 'inactive', 'membership'])('refuses preflight %s drift before any POST', async (mode) => {
  const selected = input();
  documents.set(
    bindingName,
    documents
      .get(bindingName)!
      .replace(
        mode === 'hash'
          ? /description="Service Binding/
          : mode === 'package'
            ? /\$TMP/g
            : mode === 'inactive'
              ? /version="active"/
              : /srvb:version="0001"/,
        mode === 'hash'
          ? 'description="Changed Binding'
          : mode === 'package'
            ? 'ZDENIED'
            : mode === 'inactive'
              ? 'version="inactive"'
              : 'srvb:version="0000"',
      ),
  );
  expect(await call('publish_srvb', [selected])).toMatchObject({ ok: false, submitted: 0 });
  expect(posts()).toEqual([]);
});
it('preauthorizes the whole batch and deduplicates bindings across versions', async () => {
  expect(await call('publish_srvb', [input(), input(bindingName, { version: '0002' })])).toMatchObject({
    ok: false,
    submitted: 0,
  });
  expect(harness.calls).toEqual([]);
  documents.set('ZSECOND', bindingXml('active').replaceAll(bindingName, 'ZSECOND').replaceAll('$TMP', 'ZDENIED'));
  expect(await call('publish_srvb', [input(), input('ZSECOND')])).toMatchObject({ ok: false, submitted: 0 });
  expect(posts()).toEqual([]);
});
it('preserves the first confirmed outcome when a later owner drifts', async () => {
  documents.set('ZSECOND', bindingXml('active').replaceAll(bindingName, 'ZSECOND'));
  const selected = [input(), input('ZSECOND')];
  hook = (method) => {
    if (method === 'POST') documents.set('ZSECOND', documents.get('ZSECOND')!.replace('Service Binding', 'Changed'));
  };
  expect(await call('publish_srvb', selected)).toMatchObject({
    ok: false,
    submitted: 1,
    items: [{ state: 'confirmed' }, { state: 'not-submitted' }],
  });
  expect(posts()).toHaveLength(1);
});
it('checks cancellation after asynchronous final qualification and bounds cumulative metadata', async () => {
  const abort = new AbortController();
  const base = await reader(client, context());
  let count = 0;
  reader.mockImplementation(async () => {
    if (++count === 2) abort.abort();
    return { ...base, observedAt: Date.now() };
  });
  expect(
    await executePinnedPublicationBatch(
      client,
      context(abort.signal),
      { action: 'publish_srvb', bindings: [input()] },
      reader,
    ),
  ).toMatchObject({ ok: false, submitted: 0 });
  expect(posts()).toEqual([]);
  reader.mockResolvedValue({ ...base, observedAt: Date.now() });
  expect(
    await executePinnedPublicationBatch(
      client,
      context(undefined, 150),
      { action: 'publish_srvb', bindings: [input()] },
      reader,
    ),
  ).toMatchObject({ ok: false, submitted: 0 });
});
it('keeps both low-level legacy entrypoints closed on a pinned client', async () => {
  for (const send of [publishServiceBinding, unpublishServiceBinding])
    await expect(send(client.http, client.safety, bindingName, '0001', 'odatav4')).rejects.toThrow(
      'pinned mutation context',
    );
  expect(posts()).toEqual([]);
});
it('rejects forged, mismatched and reused shared sender grants', async () => {
  const ctx = context(),
    scoped = mutationClient(client, ctx);
  const send = (profile: any, name = bindingName) =>
    publishServiceBinding(scoped.http, scoped.safety, name, '0001', 'odatav4', profile);
  await expect(send({ mode: 'pinned-pp' })).rejects.toThrow('authority');
  const profile = publicationProfile({
    http: scoped.http,
    safety: scoped.safety,
    context: ctx,
    job: 'publishjob',
    name: bindingName,
    version: '0001',
    beforeSubmit: async () => Date.now() + 30_000,
    onSubmit: () => {},
  });
  await expect(send(profile, 'ZOTHER')).rejects.toThrow('authority');
  await send(profile);
  await expect(send(profile)).rejects.toThrow('authority');
  expect(posts()).toHaveLength(1);
});
it('keeps public admission closed while private scopes, target and policy remain enforced', async () => {
  expect(pinnedMutationAllowed('SAPActivate', { action: 'publish_srvb', ...input() }, config())).toBe(false);
  for (const override of [
    { allowWrites: false },
    { ppStrict: false },
    { ppEnabled: false },
    { targetId: 'OTHER/001' },
    { multiTargetEndpoints: false },
    { multiTargetAuthorization: 'standard' as const },
    { denyActions: ['SAPActivate.publish_srvb'] },
  ]) {
    const result = await handlePrivatePinnedPublication(
      client,
      { ...config(), ...override },
      { action: 'publish_srvb', bindings: [input()] },
      ['write'],
      reader,
    );
    expect(result.isError).toBe(true);
  }
  expect(
    (
      await handlePrivatePinnedPublication(
        client,
        config(),
        { action: 'publish_srvb', bindings: [input()] },
        ['read'],
        reader,
      )
    ).isError,
  ).toBe(true);
  expect(harness.calls).toEqual([]);
  expect(
    (
      await handlePrivatePinnedPublication(
        client,
        config(),
        { action: 'publish_srvb', bindings: [input()] },
        ['write'],
        reader,
      )
    ).isError,
  ).toBeUndefined();
});

it('covers the entire active membership, including multiple services sharing the selector version', async () => {
  const first = /<srvb:services[\s\S]*?<\/srvb:services>/.exec(documents.get(bindingName)!)![0];
  documents.set(
    bindingName,
    documents
      .get(bindingName)!
      .replace(
        '</srvb:serviceBinding>',
        `${first.replaceAll('ZDEFINITION', 'ZSECOND').replaceAll('zdefinition', 'zsecond')}${first.replace('srvb:version="0001"', 'srvb:version="0002"')}</srvb:serviceBinding>`,
      ),
  );
  const result = await call();
  expect(result).toMatchObject({
    ok: true,
    submitted: 1,
    items: [
      {
        resource: {
          nativeServiceNames: ['ZDEFINITION', 'ZSECOND'],
          services: [
            { name: 'ZDEFINITION', version: '0001' },
            { name: 'ZSECOND', version: '0001' },
            { name: 'ZDEFINITION', version: '0002' },
          ],
        },
      },
    ],
  });
  expect(posts()).toHaveLength(1);
});
it('allows a transportable package without transport-management scope or publication CTS request', async () => {
  documents.set(bindingName, documents.get(bindingName)!.replaceAll('$TMP', 'ZTEAM'));
  client = client.withSafety({
    ...client.safety,
    allowTransportWrites: false,
    multiTargetWrite: { ...client.safety.multiTargetWrite!, allowedTransports: [], serverAllowedTransports: [] },
  });
  expect(await call()).toMatchObject({ ok: true, recording: 'native-onprem-local-no-recording' });
  expect(harness.calls.some((r) => r.path.includes('/cts/'))).toBe(false);
});
it('does not continue after a later native failure and reports every selected item', async () => {
  for (const name of ['ZSECOND', 'ZTHIRD']) documents.set(name, bindingXml('active').replaceAll(bindingName, name));
  fault = (method, path) =>
    method === 'POST' && path.includes('servicename=ZSECOND') ? mockResponse(200, status('ERROR')) : undefined;
  expect(await call('publish_srvb', [input(), input('ZSECOND'), input('ZTHIRD')])).toMatchObject({
    ok: false,
    submitted: 2,
    items: [{ state: 'confirmed' }, { state: 'native-failed' }, { state: 'not-submitted' }],
  });
  expect(posts()).toHaveLength(2);
});
it('rechecks native principal drift and deadline after asynchronous validation', async () => {
  const base = await reader(client, context());
  let n = 0;
  reader.mockImplementation(async () => ({ ...base, principal: ++n === 1 ? 'MARIAN' : 'OTHER' }));
  expect(await call()).toMatchObject({ ok: false, submitted: 0 });
  expect(posts()).toEqual([]);
});
it('raw public dispatch refuses publication before credentials, qualification or SAP requests', async () => {
  const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
  const result = await handleToolCall(client, config(), 'SAPActivate', {
    action: 'publish_srvb',
    name: bindingName,
    version: '0001',
    serviceType: 'odatav4',
  });
  expect(result.isError).toBe(true);
  expect(harness.calls).toEqual([]);
  expect(reader).not.toHaveBeenCalled();
});

it('consumes shared authority before an asynchronous concurrent submission can reuse it', async () => {
  const ctx = context(),
    scoped = mutationClient(client, ctx);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const profile = publicationProfile({
    http: scoped.http,
    safety: scoped.safety,
    context: ctx,
    job: 'publishjob',
    name: bindingName,
    version: '0001',
    beforeSubmit: async () => {
      await pending;
      return Date.now() + 30_000;
    },
    onSubmit: () => {},
  });
  const send = () => publishServiceBinding(scoped.http, scoped.safety, bindingName, '0001', 'odatav4', profile);
  const first = send();
  await expect(send()).rejects.toThrow('authority');
  expect(posts()).toEqual([]);
  release();
  await first;
  expect(posts()).toHaveLength(1);
});
it('preserves a lost native response as submitted uncertainty without replay', async () => {
  fault = (method) => {
    if (method === 'POST') throw new Error('connection lost after submit');
    return undefined;
  };
  expect(await call()).toMatchObject({ ok: false, submitted: 1, items: [{ state: 'submitted-unconfirmed' }] });
  expect(posts()).toHaveLength(1);
});
it('does not renew configuration freshness during the last metadata awaits', async () => {
  const time = Date.now();
  let reads = 0;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(time);
  const ctx = pinnedMutationContext(
    client.safety,
    { deadline: time + 300_000, responseBudget: new DataResponseBudget(4 * 1024 * 1024, 'test', true) },
    { unlockFailed: false },
  );
  hook = (method) => {
    if (method === 'GET' && ++reads === 4) clock.mockReturnValue(time + 31_000);
  };
  const result = await executePinnedPublicationBatch(
    client,
    ctx,
    { action: 'publish_srvb', bindings: [input()] },
    reader,
  );
  expect(result).toMatchObject({
    ok: false,
    submitted: 0,
    items: [{ state: 'not-submitted', message: 'Native configuration evidence expired during binding revalidation.' }],
  });
  expect(posts()).toEqual([]);
});

it('preserves the editable full hash while excluding only root publication bookkeeping from the scope hash', () => {
  const selected = pinnedBindingSelection(bindingName);
  const original = documents.get(bindingName)!;
  const before = parsePinnedBinding(original, selected);
  const published = parsePinnedBinding(original.replace('srvb:published="false"', 'srvb:published="true"'), selected);
  expect(published.metadataHash).not.toBe(before.metadataHash);
  expect(published.publicationHash).toBe(before.publicationHash);
  const changed = parsePinnedBinding(original.replace('Service Binding', 'Other Binding'), selected);
  expect(changed.metadataHash).not.toBe(before.metadataHash);
  expect(changed.publicationHash).not.toBe(before.publicationHash);
});

it('finishes CSRF preparation before the last binding precondition check', async () => {
  const selected = input();
  const originalFetch = client.http.fetchCsrfToken.bind(client.http);
  vi.spyOn(client.http, 'fetchCsrfToken').mockImplementationOnce(async (options) => {
    const token = await originalFetch(options);
    documents.set(bindingName, documents.get(bindingName)!.replace('Service Binding', 'Concurrent Binding'));
    return token;
  });
  expect(await call('publish_srvb', [selected])).toMatchObject({
    ok: false,
    submitted: 0,
    items: [{ state: 'not-submitted' }],
  });
  expect(posts()).toEqual([]);
});

it.each([0, 2_000, 11_000, 31_000])(
  'enforces configuration expiry through the real HTTP semaphore wait (%i ms)',
  async (delay) => {
    const { Semaphore } = await import('../../../src/adt/semaphore.js');
    const { AdtHttpClient } = await import('../../../src/adt/http.js');
    const semaphore = new Semaphore(1),
      realRun = semaphore.run.bind(semaphore);
    let runs = 0;
    const time = Date.now(),
      clock = vi.spyOn(Date, 'now').mockReturnValue(time);
    client = new AdtClient({
      client: '001',
      http: new AdtHttpClient({ baseUrl: 'https://sap.example.test', client: '001', semaphore }),
      safety: client.safety,
    });
    vi.spyOn(semaphore, 'run').mockImplementation(async (fn, signal) => {
      const response = await realRun(fn, signal);
      if (++runs === 4) await semaphore.acquire();
      return response;
    });
    if (delay === 2_000) {
      const sample = await reader(client, context());
      reader.mockResolvedValue({ ...sample, observedAt: time - 29_000 });
    }
    const ctx = pinnedMutationContext(
      client.safety,
      {
        deadline: time + (delay === 11_000 ? 10_000 : 300_000),
        responseBudget: new DataResponseBudget(4 * 1024 * 1024, 'test', true),
      },
      { unlockFailed: false },
    );
    const pending = executePinnedPublicationBatch(client, ctx, { action: 'publish_srvb', bindings: [input()] }, reader);
    for (let i = 0; i < 100 && semaphore.waiting === 0; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(semaphore.waiting).toBe(1);
    expect(posts()).toHaveLength(0);
    clock.mockReturnValue(time + delay);
    semaphore.release();
    const result = await pending;
    expect(posts()).toHaveLength(delay ? 0 : 1);
    expect(result.ok).toBe(!delay);
    expect(semaphore.waiting).toBe(0);
  },
);
it.each([0, 2_000, 11_000, 31_000])(
  'enforces configuration expiry through real HTTP authentication preparation (%i ms)',
  async (delay) => {
    const { AdtHttpClient } = await import('../../../src/adt/http.js');
    const time = Date.now(),
      clock = vi.spyOn(Date, 'now').mockReturnValue(time);
    let ready!: () => void,
      release!: () => void,
      reads = 0,
      delayAuth = false;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    client = new AdtClient({
      client: '001',
      safety: client.safety,
      http: new AdtHttpClient({
        baseUrl: 'https://sap.example.test',
        client: '001',
        bearerTokenProvider: async () => {
          if (delayAuth) {
            ready();
            await held;
          }
          return 'fixture-token';
        },
      }),
    });
    hook = (method) => {
      if (method === 'GET' && ++reads === 4) delayAuth = true;
    };
    if (delay === 2_000) {
      const sample = await reader(client, context());
      reader.mockResolvedValue({ ...sample, observedAt: time - 29_000 });
    }
    const ctx = pinnedMutationContext(
      client.safety,
      {
        deadline: time + (delay === 11_000 ? 10_000 : 300_000),
        responseBudget: new DataResponseBudget(4 * 1024 * 1024, 'test', true),
      },
      { unlockFailed: false },
    );
    const pending = executePinnedPublicationBatch(client, ctx, { action: 'publish_srvb', bindings: [input()] }, reader);
    await started;
    expect(posts()).toHaveLength(0);
    clock.mockReturnValue(time + delay);
    release();
    const result = await pending;
    expect(posts()).toHaveLength(delay ? 0 : 1);
    expect(result.ok).toBe(!delay);
  },
);
