import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Both transport branches use a MockAgent with external connections disabled.
const proxy = vi.hoisted(() => ({ pool: undefined as any }));
vi.mock('undici', async (original) => {
  const actual = await original<typeof import('undici')>();
  return {
    ...actual,
    Client: class {
      request(options: any) {
        const url = new URL(options.path);
        return proxy.pool.request({ ...options, path: url.pathname + url.search });
      }
      async close() {}
    },
  };
});
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = await import('undici');
const { AdtClient } = await import('../../../src/adt/client.js');
const { defaultSafetyConfig } = await import('../../../src/adt/safety.js');
const { pinnedMutationContext } = await import('../../../src/adt/mutation-context.js');
const { DataResponseBudget } = await import('../../../src/adt/data-result-context.js');
const { RequestAttemptBudget } = await import('../../../src/adt/request-attempt-budget.js');
const { Semaphore } = await import('../../../src/adt/semaphore.js');
const { DEFAULT_CONFIG } = await import('../../../src/server/types.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { pinnedPublicAuth } = await import('../../helpers/pinned-public-auth.js');
const { setCachedFeatures, resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { requestContext } = await import('../../../src/server/context.js');
const { executePrivatePinnedNativeGovernedPublication: execute } = await import(
  '../../../src/handlers/pinned-publication-native-governed.js'
);
const { executePinnedPublicationBatch } = await import('../../../src/adt/pinned-publication.js');
const { handlePrivatePinnedPublication } = await import('../../../src/handlers/pinned-publication.js');
const { parsePinnedBinding, pinnedBindingSelection } = await import('../../../src/adt/pinned-service-binding-owner.js');
const { nativeGovernedPublicationRecording, assertPublicationRecording } = await import(
  '../../../src/adt/service-publication.js'
);
const { deletePinnedBinding } = await import('../../../src/adt/pinned-service-binding.js');
const origin = 'https://sap.invalid';
const previous = getGlobalDispatcher();
let agent: InstanceType<typeof MockAgent>;
let sent: { method: string; path: string; body: unknown; headers: unknown }[];
const xml = readFileSync(new URL('../../fixtures/xml/service-binding.xml', import.meta.url), 'utf8')
  .replaceAll('/DMO/UI_TRAVEL_D_D_O4', 'ZBIND')
  .replaceAll('/DMO/UI_TRAVEL_D_D', 'ZDEFINITION')
  .replaceAll('%2fdmo%2fui_travel_d_d', 'zdefinition')
  .replaceAll('/DMO/FLIGHT_DRAFT', '$TMP')
  .replaceAll('%2fdmo%2fflight_draft', '%24tmp')
  .replace('srvb:published="true"', 'srvb:published="false"');
const status = (severity = 'OK') =>
  `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>${severity}</SEVERITY><SHORT_TEXT>Done</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>`;
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  proxy.pool = agent.get(origin);
  sent = [];
});
afterEach(async () => {
  resetCachedFeatures();
  vi.restoreAllMocks();
  setGlobalDispatcher(previous);
  await agent.close();
});
function fixture(useProxy = false, semaphore?: InstanceType<typeof Semaphore>) {
  const policy = {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: ['*'],
    serverAllowedTransports: ['*'],
  };
  const safety = { ...defaultSafetyConfig(), allowWrites: true, multiTargetWrite: policy };
  const config = {
    ...DEFAULT_CONFIG,
    targetId: policy.target,
    multiTargetWrite: policy,
    multiTargetEndpoints: true,
    multiTargetAuthorization: 'xsuaa-attribute' as const,
    allowWrites: true,
    ppEnabled: true,
    ppStrict: true,
    systemType: 'onprem' as const,
    abapRelease: '758',
    client: '001',
  };
  let provider = async () => 'synthetic';
  const client = new AdtClient({
    baseUrl: origin,
    client: '001',
    safety,
    adtSemaphore: semaphore,
    ...(useProxy
      ? { btpProxy: { protocol: 'http' as const, host: 'proxy.invalid', port: 80, getProxyToken: () => provider() } }
      : { bearerTokenProvider: () => provider() }),
  });
  const documents = new Map([['ZBIND', xml]]);
  const selected = (name = 'ZBIND') => ({
    name,
    version: '0001',
    serviceType: 'odatav4',
    expectedMetadataHash: parsePinnedBinding(documents.get(name)!, pinnedBindingSelection(name)).metadataHash,
  });
  const input = (action = 'publish_srvb', names = ['ZBIND']) => ({ action, bindings: names.map(selected) });
  const context = (budget: Parameters<typeof pinnedMutationContext>[1] = { deadline: Date.now() + 300_000 }) =>
    pinnedMutationContext(client.safety, budget, { unlockFailed: false });
  return {
    client,
    config,
    policy,
    documents,
    input,
    context,
    provider: (value: () => Promise<string>) => {
      provider = value;
    },
    run: (args: Record<string, unknown> = input(), scopes = ['read', 'write'], ctx = context()) =>
      execute(client, args, config, ctx, scopes),
  };
}
type Fixture = ReturnType<typeof fixture>;
function route(f: Fixture, override?: (method: string, path: string) => { code?: number; body?: string } | undefined) {
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'])
    agent
      .get(origin)
      .intercept({ path: /.*/, method })
      .reply((options) => {
        sent.push({ method, path: options.path, body: options.body, headers: options.headers });
        const fault = override?.(method, options.path);
        if (fault) return { statusCode: fault.code ?? 200, data: fault.body ?? '' };
        if (method === 'HEAD')
          return { statusCode: 200, data: '', responseOptions: { headers: { 'x-csrf-token': 'synthetic-csrf' } } };
        const url = new URL(options.path, origin);
        if (method === 'GET') return { statusCode: 200, data: f.documents.get(url.pathname.split('/').at(-1)!) ?? '' };
        if (method !== 'POST' || !/\/(?:un)?publishjobs$/.test(url.pathname))
          throw new Error('Unexpected mocked mutation');
        const name = url.searchParams.get('servicename')!;
        f.documents.set(
          name,
          f.documents
            .get(name)!
            .replace(/srvb:published="(?:true|false)"/, `srvb:published="${!url.pathname.endsWith('/unpublishjobs')}"`),
        );
        return { statusCode: 200, data: status() };
      })
      .persist();
}
const value = (result: Awaited<ReturnType<typeof execute>>) => JSON.parse(result.content[0].text as string);
const posts = () => sent.filter((r) => r.method !== 'GET' && r.method !== 'HEAD');

it.each([false, true])('uses the shared sender and bounded native-state semantics (proxy=%s)', async (proxy) => {
  const f = fixture(proxy);
  route(f);
  const attempts = new RequestAttemptBudget(20);
  for (const action of ['publish_srvb', 'unpublish_srvb']) {
    const result = value(
      await f.run(f.input(action), ['write'], f.context({ deadline: Date.now() + 60_000, attemptBudget: attempts })),
    );
    expect(result).toMatchObject({
      ok: true,
      state: 'complete',
      recording: 'native-governed-unverified',
      submitted: 1,
      items: [
        { state: 'native-state-observed', observed: { published: action === 'publish_srvb', bindingCreated: true } },
      ],
    });
    expect(result.observations).toContain('test-catalog');
    expect(result.observations).toContain('caught-error false');
    expect(result.recordingNote).toContain('No CTS receipt');
    expect(result.scope).not.toContain('all aliases');
    expect(result).not.toHaveProperty('transport');
    expect(JSON.stringify(result)).not.toContain('synthetic');
  }
  expect(posts()).toHaveLength(2);
  expect(posts().every((r) => String(r.body).match(/<adtcore:objectReference /g)?.length === 1)).toBe(true);
  expect(sent.every((r) => r.path.includes('sap-client=001'))).toBe(true);
  expect(sent.some((r) => /CTS|cts|LOCK|sessions|publishjobs\//.test(r.path))).toBe(false);
  expect(attempts.used).toBe(sent.length);
  expect(f.client.safety.allowTransportWrites).toBe(false);
});
const profiles = (['native-governed', 'non-recording'] as const).flatMap((profile) =>
  [false, true].map((useProxy) => ({ profile, useProxy })),
);
function runProfile(f: Fixture, profile: (typeof profiles)[number]['profile'], args = f.input()) {
  if (profile === 'native-governed') return f.run(args);
  return handlePrivatePinnedPublication(f.client, f.config, args, ['read', 'write'], async () => ({
    contract: 'sap-basis-758-onprem-v4-local',
    target: 'A4H/001',
    client: '001',
    principal: 'TEST_WRITER',
    systemCloud: false,
    userCloud: false,
    clientCategory: 'T',
    observedAt: Date.now(),
  }));
}
it.each(
  profiles.flatMap((p) =>
    [false, true].flatMap((desired) =>
      (['ok', 'error', 'unknown'] as const).map((outcome) => ({ ...p, desired, outcome })),
    ),
  ),
)(
  '$profile sends one job despite matching $desired getter, outcome=$outcome (proxy=$useProxy)',
  async ({ profile, useProxy, desired, outcome }) => {
    const f = fixture(useProxy);
    f.documents.set('ZBIND', xml.replace('srvb:published="false"', `srvb:published="${desired}"`));
    // The getter can be caught-error false or branch-dependent true, independent of this synthetic runtime.
    let runtimePublished = !desired;
    route(f, (method) => {
      if (method !== 'POST') return undefined;
      if (outcome === 'unknown') return { code: 500, body: 'Uncertain native failure' };
      if (outcome === 'error') return { body: status('ERROR') };
      runtimePublished = desired;
      return undefined;
    });
    const result = value(await runProfile(f, profile, f.input(desired ? 'publish_srvb' : 'unpublish_srvb')));
    expect(result).toMatchObject({
      ok: outcome === 'ok',
      state: outcome === 'ok' ? 'complete' : 'incomplete',
      submitted: 1,
      retryable: false,
      atomic: false,
      recording: profile === 'native-governed' ? 'native-governed-unverified' : 'native-onprem-local-no-recording',
      items: [
        {
          submitted: true,
          state:
            outcome === 'ok'
              ? profile === 'native-governed'
                ? 'native-state-observed'
                : 'confirmed'
              : outcome === 'error'
                ? 'native-failed'
                : 'submitted-unconfirmed',
        },
      ],
    });
    expect(posts()).toHaveLength(1);
    expect(posts()[0].path).toContain(desired ? '/publishjobs?' : '/unpublishjobs?');
    if (outcome === 'ok') expect(runtimePublished).toBe(desired);
  },
);
it.each(profiles.flatMap((p) => [false, true].map((minimalErrors) => ({ ...p, minimalErrors }))))(
  '$profile retains partial evidence with minimalErrors=$minimalErrors (proxy=$useProxy)',
  async ({ profile, useProxy, minimalErrors }) => {
    const f = fixture(useProxy);
    f.config.minimalErrors = minimalErrors;
    for (const name of ['ZSECOND', 'ZTHIRD']) f.documents.set(name, xml.replaceAll('ZBIND', name));
    route(f, (method, path) => {
      if (method !== 'POST') return undefined;
      const name = new URL(path, origin).searchParams.get('servicename')!;
      const severity = name === 'ZBIND' ? 'OK' : 'ERROR';
      if (severity === 'OK')
        f.documents.set(name, f.documents.get(name)!.replace('srvb:published="false"', 'srvb:published="true"'));
      return {
        body: status(severity)
          .replace('Done', `PRIVATE_SHORT_${severity}`)
          .replace('<LONG_TEXT/>', `<LONG_TEXT>PRIVATE_LONG_${severity}</LONG_TEXT>`),
      };
    });
    const result = await runProfile(f, profile, f.input('publish_srvb', ['ZBIND', 'ZSECOND', 'ZTHIRD']));
    const parsed = value(result);
    expect(result.isError).toBe(true);
    expect(parsed).toMatchObject({
      ok: false,
      state: 'incomplete',
      submitted: 2,
      retryable: false,
      atomic: false,
      items: [
        {
          submitted: true,
          state: profile === 'native-governed' ? 'native-state-observed' : 'confirmed',
          nativeStatus: { severity: 'OK' },
          observed: { published: true },
        },
        { submitted: true, state: 'native-failed', nativeStatus: { severity: 'ERROR' } },
        { submitted: false, state: 'not-submitted' },
      ],
    });
    expect(parsed.items[2]).not.toHaveProperty('nativeStatus');
    for (const severity of ['OK', 'ERROR']) {
      for (const part of ['SHORT', 'LONG'])
        expect(JSON.stringify(result).includes(`PRIVATE_${part}_${severity}`)).toBe(!minimalErrors);
    }
    if (minimalErrors)
      expect(parsed.items.slice(0, 2).map((item: any) => item.nativeStatus)).toEqual([
        { severity: 'OK' },
        { severity: 'ERROR' },
      ]);
    expect(posts()).toHaveLength(2);
    expect(posts().some((r) => r.path.includes('ZTHIRD'))).toBe(false);
  },
);
const invalidPolicies: unknown[] = [
  undefined,
  null,
  [],
  '*',
  ['A4H*'],
  ['A4HK900001'],
  [' *'],
  ['* '],
  ['*', ''],
  ['*', null],
  ['*', '__ARC1_DENY_ALL__'],
  ['*', 'abc'],
  ['*', 'A**'],
  ['*', ...Array(1)],
];
it.each(['allowedTransports', 'serverAllowedTransports'] as const)(
  'refuses every malformed/restricted %s before any request',
  async (field) => {
    for (const invalid of invalidPolicies) {
      const f = fixture();
      (f.policy as any)[field] = invalid;
      expect(value(await f.run())).toMatchObject({
        ok: false,
        state: 'unchanged',
        submitted: 0,
        recording: 'not-established',
      });
    }
    expect(sent).toHaveLength(0);
  },
);
it.each([
  { allowWrites: false },
  { ppEnabled: false },
  { ppStrict: false },
  { multiTargetEndpoints: false },
  { multiTargetAuthorization: 'standard' },
  { targetId: 'B4H/001' },
  { client: '002' },
  { systemType: 'btp' },
  { abapRelease: '750' },
  { abapRelease: undefined },
  { denyActions: ['SAPActivate.publish_srvb'] },
])('refuses config boundary %j without reads', async (patch) => {
  const f = fixture();
  Object.assign(f.config, patch);
  expect(value(await f.run()).ok).toBe(false);
  expect(sent).toHaveLength(0);
});
it.each([[], ['read'], ['admin'], ['transports']])('requires raw write scope: %j', async (...scope) => {
  const f = fixture();
  expect(value(await f.run(f.input(), scope)).ok).toBe(false);
  expect(sent).toHaveLength(0);
});
it('refuses foreign/shared invocation, forged contexts/profiles and profile reuse on a different context', async () => {
  const f = fixture();
  for (const request of [{ identity: 'shared' }, { target: 'B4H/001' }])
    expect(value(await requestContext.run(request as any, () => f.run())).ok).toBe(false);
  const ctx = f.context();
  expect(value(await f.run(f.input(), ['write'], { ...ctx })).ok).toBe(false);
  const profile = nativeGovernedPublicationRecording(f.client.safety, ctx, f.config, () => {});
  expect(() => assertPublicationRecording(f.client.safety, ctx, { ...profile })).toThrow('profile');
  expect(() => assertPublicationRecording(f.client.safety, f.context(), profile)).toThrow('profile');
  expect(await executePinnedPublicationBatch(f.client, ctx, f.input(), { ...profile })).toMatchObject({
    ok: false,
    submitted: 0,
  });
  expect(sent).toHaveLength(0);
});
it.each(['server', 'destination'])('preserves independent %s package checks', async (side) => {
  const f = fixture();
  route(f);
  if (side === 'server') f.client.safety.allowedPackages = ['ZOTHER'];
  else f.policy.allowedPackages = ['ZOTHER'];
  expect(value(await f.run())).toMatchObject({ ok: false, submitted: 0 });
  expect(posts()).toHaveLength(0);
});
it('preauthorizes all owners and refuses duplicate, oversized or polluted batches', async () => {
  const f = fixture();
  route(f);
  f.documents.set('ZSECOND', xml.replaceAll('ZBIND', 'ZSECOND').replaceAll('$TMP', 'ZDENIED'));
  expect(value(await f.run(f.input('publish_srvb', ['ZBIND', 'ZSECOND'])))).toMatchObject({ ok: false, submitted: 0 });
  const calls = sent.length;
  for (const input of [
    f.input('publish_srvb', ['ZBIND', 'ZBIND']),
    { action: 'publish_srvb', bindings: Array(11).fill(f.input().bindings[0]) },
    { ...f.input(), nativeGoverned: true },
    { ...f.input(), transport: '*' },
    { action: 'publish_srvb', bindings: [{ ...f.input().bindings[0], serviceType: 'odatav2' }] },
  ]) {
    expect(value(await f.run(input))).toMatchObject({ ok: false, submitted: 0 });
  }
  expect(sent).toHaveLength(calls);
  expect(posts()).toHaveLength(0);
});
it.each(['package', 'scope', 'inactive', 'hash'])('refuses %s native drift during final revalidation', async (kind) => {
  const f = fixture();
  const input = f.input();
  let reads = 0;
  route(f, (method) => {
    if (method === 'GET' && ++reads === 3)
      f.documents.set(
        'ZBIND',
        xml.replace(
          kind === 'package'
            ? '$TMP'
            : kind === 'scope'
              ? 'ZDEFINITION'
              : kind === 'inactive'
                ? 'version="active"'
                : 'Service Binding',
          kind === 'package'
            ? 'ZDENIED'
            : kind === 'scope'
              ? 'ZOTHER'
              : kind === 'inactive'
                ? 'version="inactive"'
                : 'Changed',
        ),
      );
  });
  expect(value(await f.run(input))).toMatchObject({ ok: false, submitted: 0 });
  expect(posts()).toHaveLength(0);
});
it.each([400, 401, 403, 404, 406, 415, 421, 429, 500, 503])(
  'retains uncertain effects and never replays HTTP%i',
  async (code) => {
    const f = fixture();
    route(f, (method) =>
      method === 'POST' ? { code, body: 'synthetic-secret application/vnd.sap.as+xml' } : undefined,
    );
    const result = value(await f.run());
    expect(result).toMatchObject({
      ok: false,
      state: 'incomplete',
      submitted: 1,
      retryable: false,
      items: [{ state: 'submitted-unconfirmed', ...(code === 421 ? {} : { statusCode: code }) }],
    });
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    expect(result.recordingNote).toContain('CTS effects');
    expect(posts()).toHaveLength(1);
  },
);
it.each([
  ['', 'submitted-unconfirmed'],
  [status('ERROR'), 'native-failed'],
  [status('WARNING'), 'submitted-unconfirmed'],
  ['x'.repeat(70 * 1024), 'submitted-unconfirmed'],
])('does not acknowledge unknown/negative native status', async (body, state) => {
  const f = fixture();
  route(f, (method) => (method === 'POST' ? { body } : undefined));
  expect(value(await f.run())).toMatchObject({ ok: false, submitted: 1, items: [{ state }] });
  expect(posts()).toHaveLength(1);
});
it('leaves unbound/no-op native OK unverified when the getter does not change', async () => {
  const f = fixture();
  route(f, (method) => (method === 'POST' ? { body: status() } : undefined));
  expect(value(await f.run())).toMatchObject({
    ok: false,
    submitted: 1,
    items: [{ state: 'acknowledged-unverified' }],
  });
  expect(posts()).toHaveLength(1);
});
it('keeps earlier observed state and unattempted owners after a later native failure', async () => {
  const f = fixture();
  for (const name of ['ZSECOND', 'ZTHIRD']) f.documents.set(name, xml.replaceAll('ZBIND', name));
  route(f, (method, path) =>
    method === 'POST' && path.includes('servicename=ZSECOND') ? { body: status('ERROR') } : undefined,
  );
  expect(value(await f.run(f.input('publish_srvb', ['ZBIND', 'ZSECOND', 'ZTHIRD'])))).toMatchObject({
    ok: false,
    submitted: 2,
    items: [{ state: 'native-state-observed' }, { state: 'native-failed' }, { state: 'not-submitted' }],
  });
  expect(posts()).toHaveLength(2);
});
it.each([
  [false, 'allowedTransports'],
  [true, 'allowedTransports'],
  [false, 'serverAllowedTransports'],
  [true, 'serverAllowedTransports'],
] as const)('rechecks policy at actual post-auth send: proxy=%s policy=%s', async (useProxy, field) => {
  const f = fixture(useProxy);
  let reads = 0;
  route(f, (method) => {
    if (method === 'GET') reads++;
    return undefined;
  });
  f.provider(async () => {
    await Promise.resolve();
    if (reads === 4) f.policy[field] = ['A4HK900001'];
    return 'synthetic';
  });
  expect(value(await f.run()).ok).toBe(false);
  expect(posts()).toHaveLength(0);
});
it.each(['readonly', 'deny', 'target', 'server-package', 'destination-package', 'context'])(
  'rechecks %s after final native evidence and auth awaits',
  async (change) => {
    const f = fixture();
    let reads = 0;
    route(f, (method) => {
      if (method === 'GET') reads++;
      return undefined;
    });
    f.provider(async () => {
      if (reads === 4) {
        if (change === 'readonly') f.config.allowWrites = false;
        if (change === 'deny') f.client.safety.denyActions = ['SAPActivate'];
        if (change === 'target') f.config.targetId = 'B4H/001';
        if (change === 'server-package') f.client.safety.allowedPackages = ['ZOTHER'];
        if (change === 'destination-package') f.policy.allowedPackages = ['ZOTHER'];
        if (change === 'context') f.client.safety.multiTargetWrite = { ...f.policy };
      }
      return 'synthetic';
    });
    expect(value(await f.run()).ok).toBe(false);
    expect(posts()).toHaveLength(0);
  },
);
it.each([false, true])('does not renew the membership lease during authentication (proxy=%s)', async (useProxy) => {
  const time = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(time);
  const f = fixture(useProxy);
  let reads = 0;
  route(f, (method) => {
    if (method === 'GET') reads++;
    return undefined;
  });
  f.provider(async () => {
    if (reads === 4) clock.mockReturnValue(time + 30_001);
    return 'synthetic';
  });
  expect(value(await f.run()).ok).toBe(false);
  expect(posts()).toHaveLength(0);
});
it.each([
  [false, 'control'],
  [true, 'control'],
  [false, 'expired'],
  [true, 'expired'],
  [false, 'policy'],
  [true, 'policy'],
] as const)(
  'retains policy and membership expiry across real semaphore wait (proxy=%s, %s)',
  async (useProxy, mode) => {
    const time = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(time);
    const semaphore = new Semaphore(1),
      run = semaphore.run.bind(semaphore);
    const f = fixture(useProxy, semaphore);
    let reads = 0,
      held = false;
    route(f, (method) => {
      if (method === 'GET') reads++;
      return undefined;
    });
    vi.spyOn(semaphore, 'run').mockImplementation(async (fn, signal) => {
      const response = await run(fn, signal);
      if (reads === 4 && !held) {
        held = true;
        await semaphore.acquire();
      }
      return response;
    });
    const pending = f.run();
    for (let i = 0; i < 100 && !semaphore.waiting; i++) await new Promise((r) => setTimeout(r, 1));
    expect(semaphore.waiting).toBe(1);
    expect(posts()).toHaveLength(0);
    clock.mockReturnValue(time + (mode === 'expired' ? 30_001 : 0));
    if (mode === 'policy') f.policy.allowedTransports = [];
    semaphore.release();
    expect(value(await pending).ok).toBe(mode === 'control');
    expect(posts()).toHaveLength(mode === 'control' ? 1 : 0);
  },
);
it('starts the membership lease before the native reads, not after the response', async () => {
  const time = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(time);
  const f = fixture();
  let reads = 0;
  route(f, (method) => {
    if (method === 'GET' && ++reads === 4) clock.mockReturnValue(time + 30_001);
    return undefined;
  });
  expect(value(await f.run())).toMatchObject({ ok: false, submitted: 0 });
  expect(posts()).toHaveLength(0);
});
it('retains cancellation, outer time and cumulative send/byte allowances', async () => {
  for (const budget of [
    { deadline: Date.now() - 1 },
    { deadline: Date.now() + 600_000 },
    { deadline: Date.now() + 60_000, responseBudget: new DataResponseBudget(5 * 1024 * 1024, 'test', true) },
  ]) {
    const f = fixture();
    expect(value(await f.run(f.input(), ['write'], f.context(budget))).ok).toBe(false);
  }
  expect(sent).toHaveLength(0);
  const f = fixture();
  const abort = new AbortController();
  let reads = 0;
  route(f, (method) => {
    if (method === 'GET') reads++;
    return undefined;
  });
  f.provider(async () => {
    if (reads === 4) abort.abort();
    return 'synthetic';
  });
  expect(
    value(await f.run(f.input(), ['write'], f.context({ deadline: Date.now() + 60_000, signal: abort.signal }))).ok,
  ).toBe(false);
  expect(posts()).toHaveLength(0);
  expect(
    value(
      await f.run(
        f.input(),
        ['write'],
        f.context({ deadline: Date.now() + 60_000, attemptBudget: new RequestAttemptBudget(1) }),
      ),
    ).ok,
  ).toBe(false);
  expect(
    value(
      await f.run(
        f.input(),
        ['write'],
        f.context({ deadline: Date.now() + 60_000, responseBudget: new DataResponseBudget(100, 'test', true) }),
      ),
    ).ok,
  ).toBe(false);
  expect(posts()).toHaveLength(0);
});
it('preserves acknowledged partial effects if policies change before readback', async () => {
  const f = fixture();
  route(f, (method) => {
    if (method === 'POST') {
      f.policy.allowedTransports = [];
      return { body: status() };
    }
  });
  expect(value(await f.run())).toMatchObject({
    ok: false,
    submitted: 1,
    items: [{ state: 'acknowledged-unverified' }],
  });
  expect(posts()).toHaveLength(1);
});
it('keeps the distinct non-recording profile and generated-owner cleanup refusal', async () => {
  const f = fixture();
  route(f);
  f.policy.allowedTransports = [];
  f.policy.serverAllowedTransports = [];
  const ctx = f.context({
    deadline: Date.now() + 60_000,
    responseBudget: new DataResponseBudget(4 * 1024 * 1024, 'test', true),
  });
  const reader = async () => ({
    contract: 'sap-basis-758-onprem-v4-local' as const,
    target: 'A4H/001',
    client: '001',
    principal: 'NATIVE_USER',
    systemCloud: false,
    userCloud: false,
    clientCategory: 'T',
    observedAt: Date.now(),
  });
  expect(await executePinnedPublicationBatch(f.client, ctx, f.input(), reader)).toMatchObject({
    ok: true,
    recording: 'native-onprem-local-no-recording',
    items: [{ state: 'confirmed' }],
  });
  f.documents.set('ZBIND', xml);
  const before = posts().length;
  expect(await deletePinnedBinding(f.client, ctx, { name: 'ZBIND' })).toMatchObject({ ok: false });
  expect(posts()).toHaveLength(before);
});
it('keeps public dispatch and low-level legacy pinned submission closed', async () => {
  const f = fixture();
  const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
  const { publishServiceBinding } = await import('../../../src/adt/service-publication.js');
  expect(
    (await handleToolCall(f.client, f.config, 'SAPActivate', { action: 'publish_srvb', ...f.input().bindings[0] }))
      .isError,
  ).toBe(true);
  await expect(publishServiceBinding(f.client.http, f.client.safety, 'ZBIND', '0001', 'odatav4')).rejects.toThrow(
    'pinned mutation context',
  );
  expect(sent).toHaveLength(0);
});

it('inherits exact grants and both configured policies; aggregate/Basic/missing raw scope cannot mint context', async () => {
  const { DestinationRegistry } = await import('../../../src/server/destination-registry.js');
  const { projectMultiTargetRequest } = await import('../../../src/server/multi-target-request-projection.js');
  const { buildMultiTargetConfig } = await import('../../../src/server/multi-target-runtime.js');
  const f = fixture();
  const base = { ...f.config, multiTargetAuthorization: 'xsuaa-attribute' as const, allowedTransports: ['*'] };
  const registry = DestinationRegistry.fromDiscovery(
    {
      subaccount: [
        {
          name: 'MOCK_PP',
          type: 'HTTP',
          urlState: 'valid',
          urlFingerprint: 'mock',
          authentication: 'PrincipalPropagation',
          proxyType: 'OnPremise',
          sapSysId: 'A4H',
          sapClient: '001',
          description: 'Mock',
          hasCloudConnectorLocationId: false,
          arcProperties: {
            'arc1.enabled': 'true',
            'arc1.allow_writes': 'true',
            'arc1.allowed_packages': '$TMP',
            'arc1.allowed_transports': '*',
          },
        },
      ],
      instanceNames: [],
      scannedCount: 1,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    base,
  );
  const projection = (write = ['A4H/001'], raw = ['read', 'write']) =>
    projectMultiTargetRequest(registry, {
      token: 'mock',
      clientId: 'mock',
      scopes: ['read', 'write'],
      extra: {
        arc1VerifiedRawScopes: raw,
        xsuaaUserAttributes: { arc1_targets: ['*'], arc1_write_targets: write },
        xsuaaUserAttributeStatus: { arc1_targets: 'valid', arc1_write_targets: 'valid' },
      },
    });
  const target = registry.targets[0];
  const config = buildMultiTargetConfig(base, target, { mode: 'pinned', authorization: projection() });
  expect(config.multiTargetWrite).toMatchObject({
    enabled: true,
    allowedTransports: ['*'],
    serverAllowedTransports: ['*'],
  });
  const client = new AdtClient({ baseUrl: origin, client: '001', safety: config });
  route(f);
  const ctx = pinnedMutationContext(client.safety, { deadline: Date.now() + 60000 }, { unlockFailed: false });
  // Runtime projection intentionally does not inherit a global release override.
  expect(value(await execute(client, f.input(), config, ctx, ['read', 'write']))).toMatchObject({
    ok: false,
    state: 'unchanged',
  });
  expect(sent).toHaveLength(0);
  // Internal harness binds source coverage from independent target evidence; no tool arg sets this.
  config.abapRelease = '758';
  expect(value(await execute(client, f.input(), config, ctx, ['read', 'write'])).ok).toBe(true);
  for (const runtime of [
    buildMultiTargetConfig(base, target, { mode: 'aggregate', authorization: projection() }),
    buildMultiTargetConfig(base, target, { mode: 'pinned', authorization: projection(['B4H/001']) }),
    buildMultiTargetConfig(base, target, { mode: 'pinned', authorization: projection(['A4H/001'], ['read']) }),
    buildMultiTargetConfig(
      base,
      { ...target, authentication: 'BasicAuthentication' },
      { mode: 'pinned', authorization: projection() },
    ),
  ]) {
    expect(runtime.multiTargetWrite?.enabled).toBe(false);
    expect(() => pinnedMutationContext(runtime, { deadline: Date.now() + 60000 }, { unlockFailed: false })).toThrow(
      'policy',
    );
  }
  expect(posts()).toHaveLength(1);
});

it.each([false, true])(
  'public publication routing preserves native acknowledgement limits (proxy=%s)',
  async (proxy) => {
    const f = fixture(proxy);
    route(f);
    setCachedFeatures({ abapRelease: '758', systemType: 'onprem', systemTypeSource: 'probe' }, 'A4H/001');
    for (const action of ['publish_srvb', 'unpublish_srvb']) {
      const { serviceType, ...binding } = f.input(action).bindings[0];
      const result = await handleToolCall(
        f.client,
        f.config,
        'SAPActivate',
        { action, ...binding, service_type: serviceType },
        pinnedPublicAuth(),
        undefined,
        undefined,
        true,
      );
      expect(result.isError, result.content[0].text).toBeUndefined();
      expect(value(result)).toMatchObject({ state: 'complete', recording: 'native-governed-unverified', submitted: 1 });
    }
    expect(posts()).toHaveLength(2);
  },
);
