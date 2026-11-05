import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
const { DEFAULT_CONFIG } = await import('../../../src/server/types.js');
const { requestContext } = await import('../../../src/server/context.js');
const { executePrivatePinnedLocalRootCreate: execute } = await import(
  '../../../src/handlers/pinned-local-root-create.js'
);
const { createPinnedPackage } = await import('../../../src/adt/pinned-package.js');
const { createPinnedLocalRootProfile, assertPinnedLocalRootProfile } = await import(
  '../../../src/adt/pinned-package-root-profile.js'
);
const { pinnedMutationAllowed } = await import('../../../src/server/multi-target-write-surface.js');
const { buildPackageXml } = await import('../../../src/adt/ddic-xml.js');
const origin = 'https://sap.invalid',
  owner = '/sap/bc/adt/packages/%24NEW';
const args = { name: '$NEW', description: 'Owned root', responsible: 'MARIAN' };
const absent =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Missing</message></exc:exception>';
const native = () => buildPackageXml({ ...args, cloud: false });
// Native empty-parent shape; all owner fields are synthetic and unrelated inventory was removed.
const nativeReadback = readFileSync(
  new URL('../../fixtures/xml/package-local-root-native.xml', import.meta.url),
  'utf8',
);
const previous = getGlobalDispatcher();
let agent: InstanceType<typeof MockAgent>, sent: { method: string; path: string; body: unknown }[];
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  proxy.pool = agent.get(origin);
  sent = [];
});
afterEach(async () => {
  vi.restoreAllMocks();
  setGlobalDispatcher(previous);
  await agent.close();
});
function fixture(useProxy = false) {
  const policy = {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$NEW'],
    allowedTransports: ['*'],
    serverAllowedTransports: ['*'],
  };
  const safety = { ...defaultSafetyConfig(), allowWrites: true, allowedPackages: ['$NEW'], multiTargetWrite: policy };
  const config = {
    ...DEFAULT_CONFIG,
    allowedPackages: ['$NEW'],
    targetId: policy.target,
    multiTargetWrite: policy,
    multiTargetEndpoints: true,
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
    maxConcurrent: 1,
    ...(useProxy
      ? { btpProxy: { protocol: 'http' as const, host: 'proxy.invalid', port: 80, getProxyToken: () => provider() } }
      : { bearerTokenProvider: () => provider() }),
  });
  const context = (budget: Parameters<typeof pinnedMutationContext>[1] = { deadline: Date.now() + 60000 }) =>
    pinnedMutationContext(client.safety, budget, { unlockFailed: false });
  return {
    client,
    config,
    policy,
    context,
    setProvider: (value: () => Promise<string>) => {
      provider = value;
    },
    run: (input: Record<string, unknown> = args, scopes = ['read', 'write'], ctx = context()) =>
      execute(client, input, config, ctx, scopes),
  };
}
type Fixture = ReturnType<typeof fixture>;
function route(
  reply: (
    method: string,
    path: string,
    body: unknown,
  ) => { status?: number; body?: string; headers?: Record<string, string> },
) {
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'])
    agent
      .get(origin)
      .intercept({ path: /.*/, method })
      .reply((options) => {
        sent.push({ method, path: options.path, body: options.body });
        const r = reply(method, options.path, options.body);
        return {
          statusCode: r.status ?? 200,
          data: r.body ?? '',
          responseOptions: { headers: r.headers ?? { 'content-type': 'application/xml' } },
        };
      })
      .persist();
}
function success(
  options: {
    afterHead?: () => void;
    afterPost?: () => void;
    status?: number;
    readback?: () => string;
    initial?: { status: number; body: string };
  } = {},
) {
  let exists = false;
  route((method, path) => {
    if (method === 'HEAD') {
      options.afterHead?.();
      return { headers: { 'x-csrf-token': 'TEST' } };
    }
    if (method === 'POST') {
      expect(path.split('?')[0]).toBe('/sap/bc/adt/packages');
      exists = true;
      options.afterPost?.();
      return { status: options.status ?? 201 };
    }
    expect(path.split('?')[0]).toBe(owner);
    return exists ? { body: options.readback?.() ?? native() } : (options.initial ?? { status: 404, body: absent });
  });
}
const value = (result: Awaited<ReturnType<typeof execute>>) => JSON.parse(result.content[0].text as string);
const posts = () => sent.filter(({ method }) => method === 'POST');
it.each([false, true])(
  'creates a verified parentless root without invented ancestry/CTS preflight; proxy=%s',
  async (useProxy) => {
    const f = fixture(useProxy),
      parent = new RequestAttemptBudget(8);
    success();
    const result = value(
      await f.run(args, ['read', 'write'], f.context({ deadline: Date.now() + 60000, attemptBudget: parent })),
    );
    expect(result).toMatchObject({
      ok: true,
      state: 'created',
      recording: 'native-governed-unverified',
      target: 'A4H/001',
    });
    expect(result.recordingNote).toContain('CTS/directory effects');
    expect(result).not.toHaveProperty('transport');
    expect(sent.map(({ method }) => method)).toEqual(['GET', 'HEAD', 'POST', 'GET']);
    expect(parent.used).toBe(4);
    expect(posts()[0].body).toBe(native());
    expect(posts()[0].path).not.toContain('corrNr');
    expect(String(posts()[0].body)).toContain('<pak:superPackage adtcore:name=""/>');
    expect(String(posts()[0].body)).not.toContain('$TMP');
    expect(f.client.safety.allowTransportWrites).toBe(false);
  },
);
it.each([false, true])('verifies the captured empty native parent after actual CREATE; proxy=%s', async (useProxy) => {
  success({ readback: () => nativeReadback });
  const result = value(await fixture(useProxy).run());
  expect(result).toMatchObject({ ok: true, state: 'created', recording: 'native-governed-unverified' });
  expect(result.recordingNote).toContain('CTS/directory effects');
  expect(sent.map(({ method }) => method)).toEqual(['GET', 'HEAD', 'POST', 'GET']);
  expect(posts()[0].body).toBe(native());
});
it.each([
  ['expanded empty', '<pak:superPackage></pak:superPackage>'],
  ['alternate prefix', '<p:superPackage xmlns:p="http://www.sap.com/adt/packages"/>'],
  ['default namespace', '<superPackage xmlns="http://www.sap.com/adt/packages"/>'],
  ['explicit empty name', '<pak:superPackage adtcore:name=""/>'],
])('accepts equivalent explicit empty parent: %s', async (_label, parent) => {
  success({ readback: () => nativeReadback.replace('<pak:superPackage/>', parent) });
  expect(value(await fixture().run())).toMatchObject({ ok: true, state: 'created' });
  expect(posts()).toHaveLength(1);
});
it.each([
  ['missing', ''],
  ['foreign element', '<pak:superPackage xmlns:pak="urn:foreign"/>'],
  ['unbound element', '<other:superPackage/>'],
  ['duplicate', '<pak:superPackage/><pak:superPackage/>'],
  ['mixed namespace duplicate', '<pak:superPackage/><x:superPackage xmlns:x="urn:foreign"/>'],
  ['foreign name', '<pak:superPackage xmlns:x="urn:foreign" x:name=""/>'],
  ['unqualified name', '<pak:superPackage name=""/>'],
  ['nonempty attribute', '<pak:superPackage adtcore:uri="/sap/bc/adt/packages/%24OTHER"/>'],
  ['unknown attribute', '<pak:superPackage unexpected="true"/>'],
  ['nested reference', '<pak:superPackage><adtcore:packageRef adtcore:name="$OTHER"/></pak:superPackage>'],
  ['text', '<pak:superPackage>$OTHER</pak:superPackage>'],
  ['named parent', '<pak:superPackage adtcore:name="$OTHER"/>'],
  ['whitespace name', '<pak:superPackage adtcore:name=" "/>'],
  ['malformed XML', '<pak:superPackage>'],
])('does not verify root creation from %s parent evidence', async (_label, parent) => {
  success({ readback: () => nativeReadback.replace('<pak:superPackage/>', parent) });
  expect(value(await fixture().run())).toMatchObject({
    ok: false,
    state: 'created-unverified',
    phase: 'readback',
    retryable: false,
    recording: 'native-governed-unverified',
  });
  expect(posts()).toHaveLength(1);
  expect(sent.map(({ method }) => method)).toEqual(['GET', 'HEAD', 'POST', 'GET']);
});
it.each(['allowedTransports', 'serverAllowedTransports'] as const)(
  'requires explicit unrestricted valid %s',
  async (field) => {
    for (const list of [
      [],
      undefined,
      null,
      '*',
      ['A4H*'],
      ['*', '__ARC1_DENY_ALL__'],
      ['*', ''],
      ['*', ' *'],
      ['*', 1],
      ['*', ...Array(1)],
      ['*', 'A**'],
      ['*', 'A'.repeat(21)],
    ]) {
      const f = fixture();
      (f.policy as any)[field] = list;
      expect(value(await f.run())).toMatchObject({ ok: false, state: 'unchanged' });
    }
    expect(sent).toHaveLength(0);
  },
);
it.each(['server', 'destination', 'config'] as const)(
  'refuses false $TMP/** future ancestry in %s policy without lookup',
  async (side) => {
    const f = fixture();
    if (side === 'server') f.client.safety.allowedPackages = ['$TMP/**'];
    if (side === 'destination') f.policy.allowedPackages = ['$TMP/**'];
    if (side === 'config') f.config.allowedPackages = ['$TMP/**'];
    expect(value(await f.run()).ok).toBe(false);
    expect(sent).toHaveLength(0);
  },
);
it.each(['$NEW', '$N*', '$NEW/**', '*'])(
  'applies a real name grant %s to the root without hierarchy lookup',
  async (rule) => {
    const f = fixture();
    f.client.safety.allowedPackages = [rule];
    f.config.allowedPackages = [rule];
    f.policy.allowedPackages = [rule];
    success();
    expect(value(await f.run()).ok).toBe(true);
    expect(sent).toHaveLength(4);
  },
);
it.each([
  { name: '$TMP' },
  { name: 'ZNEW' },
  { superPackage: '$TMP' },
  { superPackage: '$REAL' },
  { responsible: 'idp@example.test' },
  { softwareComponent: 'HOME' },
  { recordChanges: true },
  { packageType: 'main' },
  { transportLayer: 'ZDEV' },
  { transport: 'A4HK900001' },
  { transport: '' },
  { nativeRecording: true },
  { target: 'B4H/001' },
  { action: 'delete_package' },
  { description: 'bad\ntext' },
])('rejects unsupported or conflicting root input %j before I/O', async (patch) => {
  expect(value(await fixture().run({ ...args, ...patch }))).toMatchObject({ ok: false, state: 'unchanged' });
  expect(sent).toHaveLength(0);
});
it.each([[], ['read'], ['admin'], ['transports']].map((scopes) => ({ scopes })))(
  'requires raw write/read admission: $scopes',
  async ({ scopes }) => {
    expect(value(await fixture().run(args, scopes)).ok).toBe(false);
    expect(sent).toHaveLength(0);
  },
);
const invalid: [string, (f: Fixture) => void][] = [
  [
    'global readonly',
    (f) => {
      f.config.allowWrites = false;
    },
  ],
  [
    'client readonly',
    (f) => {
      f.client.safety.allowWrites = false;
    },
  ],
  [
    'destination off',
    (f) => {
      f.policy.enabled = false;
    },
  ],
  [
    'Basic',
    (f) => {
      f.config.ppEnabled = false;
    },
  ],
  [
    'nonstrict',
    (f) => {
      f.config.ppStrict = false;
    },
  ],
  [
    'single target',
    (f) => {
      f.config.multiTargetEndpoints = false;
    },
  ],
  [
    'foreign target',
    (f) => {
      f.policy.target = 'B4H/001';
      f.config.targetId = 'B4H/001';
    },
  ],
  [
    'client mismatch',
    (f) => {
      f.config.client = '002';
    },
  ],
  [
    'copied policy',
    (f) => {
      f.config.multiTargetWrite = { ...f.policy };
    },
  ],
  [
    'deny config',
    (f) => {
      f.config.denyActions = ['SAPManage.create_package'];
    },
  ],
  [
    'deny safety',
    (f) => {
      f.client.safety.denyActions = ['SAPManage'];
    },
  ],
  [
    'unknown platform',
    (f) => {
      f.config.systemType = 'auto' as never;
    },
  ],
  [
    'cloud',
    (f) => {
      f.config.systemType = 'btp' as never;
    },
  ],
  [
    'release',
    (f) => {
      f.config.abapRelease = '757';
    },
  ],
];
it.each(invalid)('refuses %s before I/O', async (_name, change) => {
  const f = fixture(),
    ctx = f.context();
  change(f);
  expect(value(await f.run(args, ['read', 'write'], ctx)).ok).toBe(false);
  expect(sent).toHaveLength(0);
});
it.each([{ identity: 'shared' as const }, { target: 'B4H/001' }])('binds the actual invocation %j', async (context) => {
  expect(value(await requestContext.run({ requestId: 'test', ...context }, () => fixture().run())).ok).toBe(false);
  expect(sent).toHaveLength(0);
});
it('does not admit an unregistered/copied context or a profile for another client/name', async () => {
  const f = fixture();
  expect(value(await f.run(args, ['read', 'write'], { ...f.context() })).ok).toBe(false);
  const ctx = f.context(),
    profile = createPinnedLocalRootProfile(f.client, ctx, '$NEW', f.config, () => {});
  expect(() => assertPinnedLocalRootProfile(f.client, ctx, '$NEW', { ...profile })).toThrow('profile');
  expect(() => assertPinnedLocalRootProfile(fixture().client, ctx, '$NEW', profile)).toThrow('profile');
  expect(() => assertPinnedLocalRootProfile(f.client, ctx, '$OTHER', profile)).toThrow('profile');
  expect(await createPinnedPackage(f.client, ctx, args, { cloud: false, abapRelease: '758' })).toMatchObject({
    ok: false,
    state: 'unchanged',
  });
  expect(sent).toHaveLength(0);
});
it.each([
  ['parent present', (s: string) => s.replace('superPackage adtcore:name=""', 'superPackage adtcore:name="$OTHER"')],
  ['parent missing', (s: string) => s.replace('<pak:superPackage adtcore:name=""/>', '')],
  ['recording absent', (s: string) => s.replace(' pak:recordChanges="false"', '')],
  ['recording true', (s: string) => s.replace('pak:recordChanges="false"', 'pak:recordChanges="true"')],
  ['component missing', (s: string) => s.replace('<pak:softwareComponent pak:name="LOCAL"/>', '')],
  ['component changed', (s: string) => s.replace('pak:name="LOCAL"', 'pak:name="HOME"')],
  ['layer missing', (s: string) => s.replace('<pak:transportLayer pak:name=""/>', '')],
  ['layer changed', (s: string) => s.replace('transportLayer pak:name=""', 'transportLayer pak:name="ZDEV"')],
  ['kind missing', (s: string) => s.replace(' pak:packageType="development"', '')],
  ['kind changed', (s: string) => s.replace('packageType="development"', 'packageType="structure"')],
  ['owner changed', (s: string) => s.replaceAll('$NEW', '$OTHER')],
  ['responsible changed', (s: string) => s.replace('responsible="MARIAN"', 'responsible="OTHER"')],
  ['description changed', (s: string) => s.replace('description="Owned root"', 'description="Other"')],
] as const)('keeps possible creation unverified with %s, without compensation', async (_name, change) => {
  success({ readback: () => change(native()) });
  const result = value(await fixture().run());
  expect(result).toMatchObject({
    ok: false,
    state: 'created-unverified',
    phase: 'readback',
    recording: 'native-governed-unverified',
    retryable: false,
  });
  expect(posts()).toHaveLength(1);
  expect(sent.some(({ method }) => method === 'DELETE' || method === 'PUT')).toBe(false);
});
it.each([
  { status: 200, body: 'existing' },
  { status: 404, body: '<html>missing</html>' },
  { status: 403, body: absent },
  { status: 503, body: 'unavailable' },
])('requires typed native target absence: %j', async (initial) => {
  success({ initial });
  expect(value(await fixture().run())).toMatchObject({ ok: false, state: 'unchanged' });
  expect(posts()).toHaveLength(0);
});
it.each([400, 401, 403, 404, 409, 415, 421, 429, 503])(
  'retains possible bookkeeping effects for submitted status %i without retry',
  async (status) => {
    success({ status });
    expect(value(await fixture().run())).toMatchObject({
      ok: false,
      state: 'creation-unconfirmed',
      retryable: false,
      recording: 'native-governed-unverified',
    });
    expect(posts()).toHaveLength(1);
  },
);
it.each([false, true])('revalidates after actual CSRF/auth waits, proxy=%s', async (useProxy) => {
  const f = fixture(useProxy);
  let head = false;
  success({
    afterHead: () => {
      head = true;
    },
  });
  f.setProvider(async () => {
    await Promise.resolve();
    if (head) f.policy.allowedTransports = ['A4H*'];
    return 'synthetic';
  });
  expect(value(await f.run()).ok).toBe(false);
  expect(sent.map((s) => s.method)).toEqual(['GET', 'HEAD']);
});
it.each([false, true])('revalidates after the real semaphore queue, proxy=%s', async (useProxy) => {
  const f = fixture(useProxy),
    semaphore = f.client.http.semaphore!,
    run = semaphore.run.bind(semaphore);
  let calls = 0;
  success();
  vi.spyOn(semaphore, 'run').mockImplementation(async (fn, signal) => {
    const number = ++calls;
    try {
      return await run(fn, signal);
    } finally {
      if (number === 1) await semaphore.acquire();
    }
  });
  const pending = f.run();
  for (let i = 0; i < 200 && semaphore.waiting === 0; i++) await new Promise((resolve) => setTimeout(resolve, 1));
  expect(semaphore.waiting).toBe(1);
  f.policy.serverAllowedTransports = [];
  semaphore.release();
  expect(value(await pending).ok).toBe(false);
  expect(posts()).toHaveLength(0);
  expect(semaphore.waiting).toBe(0);
});
it.each([false, true])('retains the original deadline through authentication; proxy=%s', async (useProxy) => {
  const f = fixture(useProxy);
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  success({
    afterHead: () => {
      now += 61_000;
    },
  });
  expect(value(await f.run()).ok).toBe(false);
  expect(posts()).toHaveLength(0);
});
it('keeps native HTTP200 error plus missing readback unconfirmed and single-shot', async () => {
  route((method) =>
    method === 'HEAD'
      ? { headers: { 'x-csrf-token': 'TEST' } }
      : method === 'POST'
        ? { body: absent }
        : { status: 404, body: absent },
  );
  const result = value(await fixture().run());
  expect(result).toMatchObject({
    ok: false,
    state: 'created-unverified',
    retryable: false,
    recording: 'native-governed-unverified',
  });
  expect(posts()).toHaveLength(1);
});
it.each(['packages', 'coverage', 'deny', 'identity', 'target'] as const)(
  'revalidates %s changed at an await boundary',
  async (change) => {
    const f = fixture(),
      request = { requestId: 'one', user: 'first', target: 'A4H/001', identity: 'per-user' as const };
    success({
      afterHead: () => {
        if (change === 'packages') f.policy.allowedPackages = ['$TMP/**'];
        if (change === 'coverage') f.config.abapRelease = '757';
        if (change === 'deny') f.config.denyActions = ['SAPManage'];
        if (change === 'identity') request.user = 'other';
        if (change === 'target') f.config.targetId = 'B4H/001';
      },
    });
    expect(value(await requestContext.run(request, () => f.run())).ok).toBe(false);
    expect(posts()).toHaveLength(0);
  },
);
it('preserves cancellation and parent attempt/response budgets', async () => {
  const f = fixture(),
    abort = new AbortController();
  let head = false;
  success({
    afterHead: () => {
      head = true;
    },
  });
  f.setProvider(async () => {
    if (head) abort.abort();
    return 'synthetic';
  });
  expect(
    value(await f.run(args, ['read', 'write'], f.context({ deadline: Date.now() + 60000, signal: abort.signal }))).ok,
  ).toBe(false);
  expect(posts()).toHaveLength(0);
  sent = [];
  expect(
    value(
      await f.run(
        args,
        ['read', 'write'],
        f.context({ deadline: Date.now() + 60000, attemptBudget: new RequestAttemptBudget(1) }),
      ),
    ).ok,
  ).toBe(false);
  expect(posts()).toHaveLength(0);
  sent = [];
  expect(
    value(
      await f.run(
        args,
        ['read', 'write'],
        f.context({ deadline: Date.now() + 60000, responseBudget: new DataResponseBudget(10, 'parent', true) }),
      ),
    ).ok,
  ).toBe(false);
  expect(posts()).toHaveLength(0);
});
it('refuses oversized budgets and stale deadlines before native I/O', async () => {
  const f = fixture();
  for (const budget of [
    { deadline: Date.now() - 1 },
    { deadline: Date.now() + 61000 },
    { deadline: Date.now() + 60000, responseBudget: new DataResponseBudget(100) },
    { deadline: Date.now() + 60000, responseBudget: new DataResponseBudget(5 * 1024 * 1024, 'large', true) },
  ])
    expect(value(await f.run(args, ['read', 'write'], f.context(budget))).ok).toBe(false);
  expect(sent).toHaveLength(0);
});
it('does not let a passed POST conceal later policy drift or authorize cleanup', async () => {
  const f = fixture();
  success({
    afterPost: () => {
      f.policy.allowedTransports = [];
    },
  });
  const result = value(await f.run());
  expect(result).toMatchObject({ ok: false, state: 'created-unverified', recording: 'native-governed-unverified' });
  expect(posts()).toHaveLength(1);
  expect(sent.some((s) => s.method === 'DELETE')).toBe(false);
});
it('exposes the exact public contract while preserving legacy builder defaults', () => {
  const f = fixture();
  expect(pinnedMutationAllowed('SAPManage', { ...args, action: 'create_package' }, f.config)).toBe(true);
  expect(native()).toContain('<pak:superPackage adtcore:name=""/>');
  expect(buildPackageXml({ ...args, superPackage: '$TMP' })).toContain('<pak:superPackage adtcore:name="$TMP"/>');
});
