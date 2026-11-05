import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// No sockets: direct Fetch uses MockAgent; Connectivity's dedicated Client uses its same mock pool.
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
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { pinnedPublicAuth } = await import('../../helpers/pinned-public-auth.js');
const { setCachedFeatures, resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { requestContext } = await import('../../../src/server/context.js');
const { executePrivatePinnedNativeGovernedFlp: execute } = await import(
  '../../../src/handlers/pinned-flp-native-recording.js'
);
const { executePrivatePinnedFlp, handlePinnedFlp } = await import('../../../src/handlers/pinned-flp.js');
const { createCatalog } = await import('../../../src/adt/flp.js');
const { createNativeGovernedFlpRecording, assertFlpRecordingProfile } = await import('../../../src/adt/pinned-flp.js');

const origin = 'https://sap.invalid';
const FLP = '/sap/opu/odata/UI2/PAGE_BUILDER_CUST';
const args = { action: 'flp_create_catalog', domainId: 'ZCAT', title: 'Catalog' };
const catalog = {
  id: 'X-SAP-UI2-CATALOGPAGE:ZCAT',
  domainId: 'ZCAT',
  title: 'Catalog',
  type: 'CATALOG_PAGE',
  scope: 'CUSTOMIZING',
  isReadOnly: '',
};
const missing = readFileSync(new URL('../../fixtures/flp/cust-resource-lookup-604.json', import.meta.url), 'utf8');
const previous = getGlobalDispatcher();
let agent: InstanceType<typeof MockAgent>;
let sent: { method: string; path: string; body: unknown }[];
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  proxy.pool = agent.get(origin);
  sent = [];
});
afterEach(async () => {
  resetCachedFeatures();
  setGlobalDispatcher(previous);
  await agent.close();
});

function fixture(useProxy = false) {
  const policy = {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: ['*'],
    serverAllowedTransports: ['*'],
  };
  let provider = async () => 'synthetic';
  const safety = { ...defaultSafetyConfig(), allowWrites: true, multiTargetWrite: policy };
  const config = {
    ...DEFAULT_CONFIG,
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
  const client = new AdtClient({
    baseUrl: origin,
    client: '001',
    safety,
    ...(useProxy
      ? {
          btpProxy: { protocol: 'http' as const, host: 'proxy.invalid', port: 80, getProxyToken: () => provider() },
        }
      : { bearerTokenProvider: () => provider() }),
  });
  const context = (budget: Parameters<typeof pinnedMutationContext>[1] = { deadline: Date.now() + 60_000 }) =>
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
  ) => { status?: number; body?: unknown; headers?: Record<string, string> },
) {
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE']) {
    agent
      .get(origin)
      .intercept({ path: /.*/, method })
      .reply((options) => {
        sent.push({ method, path: options.path, body: options.body });
        const result = reply(method, options.path, options.body);
        return {
          statusCode: result.status ?? 200,
          data: typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? ''),
          responseOptions: { headers: result.headers ?? {} },
        };
      })
      .persist();
  }
}
function successful(afterHead?: () => void, postStatus = 201, afterWrite?: () => void) {
  let exists = false;
  route((method) => {
    if (method === 'HEAD') {
      afterHead?.();
      return { headers: { 'x-csrf-token': 'TEST' } };
    }
    if (method === 'POST') {
      exists = true;
      afterWrite?.();
      return { status: postStatus, body: { d: catalog } };
    }
    return exists ? { body: { d: catalog } } : { status: 404, body: missing };
  });
}
const value = (result: Awaited<ReturnType<typeof execute>>) => JSON.parse(result.content[0].text as string);
const mutations = () => sent.filter((s) => ['POST', 'PUT', 'DELETE'].includes(s.method));

describe('private native-governed FLP policy', () => {
  it.each([false, true])('uses the actual shared HTTP pipeline; Connectivity=%s', async (useProxy) => {
    const f = fixture(useProxy);
    successful();
    const parent = new RequestAttemptBudget(8);
    const result = value(
      await f.run(args, ['read', 'write'], f.context({ deadline: Date.now() + 60000, attemptBudget: parent })),
    );
    expect(result).toMatchObject({
      ok: true,
      state: 'created',
      priorExistence: 'unknown',
      recording: 'native-governed-unverified',
      target: 'A4H/001',
    });
    expect(result.recordingNote).toContain('No automatic CTS compensation');
    expect(result).not.toHaveProperty('transport');
    expect(parent.used).toBe(4);
    expect(sent.map((s) => s.method)).toEqual(['GET', 'HEAD', 'POST', 'GET']);
    expect(sent.every((s) => s.path.includes('sap-client=001'))).toBe(true);
    expect(mutations()[0].path.split('?')[0]).toBe(`${FLP}/Catalogs`);
    expect(mutations()[0].body).toBe(JSON.stringify({ domainId: 'ZCAT', title: 'Catalog', type: 'CATALOG_PAGE' }));
    expect(f.client.safety.allowTransportWrites).toBe(false);
  });

  it.each(['allowedTransports', 'serverAllowedTransports'] as const)(
    'refuses invalid %s before even reading SAP',
    async (field) => {
      const invalid: unknown[] = [
        [],
        undefined,
        null,
        '*',
        ['A4H*'],
        ['A4HK900001'],
        ['*', '__ARC1_DENY_ALL__'],
        ['*', 1],
        ['*', ''],
        ['*', ' *'],
        ['*', 'A**'],
        ['*', 'A'.repeat(21)],
        ['*', ...Array(1)],
      ];
      for (const list of invalid) {
        const f = fixture();
        (f.policy as any)[field] = list;
        expect(value(await f.run())).toMatchObject({ ok: false, state: 'unchanged', recording: 'not-established' });
      }
      expect(sent).toHaveLength(0);
    },
  );

  it('permits canonical additional rules without widening either effective policy', async () => {
    const f = fixture();
    f.policy.allowedTransports = ['A4H*', '*'];
    f.policy.serverAllowedTransports = ['*', 'DEVK900001'];
    successful();
    expect(value(await f.run()).ok).toBe(true);
  });

  it.each([['read'], ['transports'], ['admin'], []].map((scopes) => ({ scopes })))(
    'requires raw write scope: $scopes',
    async ({ scopes }) => {
      expect(value(await fixture().run(args, scopes))).toMatchObject({ ok: false, state: 'unchanged' });
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
      'destination disabled',
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
      'foreign client',
      (f) => {
        f.config.targetId = 'A4H/002';
        f.policy.target = 'A4H/002';
      },
    ],
    [
      'wrong config client',
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
      'destination policy missing',
      (f) => {
        f.config.multiTargetWrite = undefined as never;
      },
    ],
    [
      'denied config',
      (f) => {
        f.config.denyActions = ['SAPManage.flp_*'];
      },
    ],
    [
      'denied client',
      (f) => {
        f.client.safety.denyActions = ['SAPManage.flp_create_catalog'];
      },
    ],
    [
      'feature disabled',
      (f) => {
        f.config.featureFlp = 'off';
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
      'uncovered release',
      (f) => {
        f.config.abapRelease = '750';
      },
    ],
  ];
  it.each(invalid)('refuses %s before I/O', async (_label, change) => {
    const f = fixture();
    const context = f.context();
    change(f);
    expect(value(await f.run(args, ['read', 'write'], context))).toMatchObject({ ok: false, state: 'unchanged' });
    expect(sent).toHaveLength(0);
  });

  it.each([{ identity: 'shared' as const }, { target: 'B4H/001' }])(
    'respects request identity/target %j',
    async (request) => {
      const f = fixture();
      const result = await requestContext.run({ requestId: 'test', ...request }, () => f.run());
      expect(value(result).state).toBe('unchanged');
      expect(sent).toHaveLength(0);
    },
  );

  it.each(['recording', 'nativeRecording', 'transport', 'package', 'target'])(
    'does not accept a %s tool-argument override',
    async (field) => {
      expect(value(await fixture().run({ ...args, [field]: '*' })).state).toBe('unchanged');
      expect(sent).toHaveLength(0);
    },
  );

  it('refuses copied contexts, excessive deadlines/budgets and forged profiles', async () => {
    const f = fixture();
    for (const context of [
      { ...f.context() },
      f.context({ deadline: Date.now() + 301000 }),
      f.context({ deadline: Date.now() + 60000, responseBudget: new DataResponseBudget(100) }),
      f.context({
        deadline: Date.now() + 60000,
        responseBudget: new DataResponseBudget(9 * 1024 * 1024, 'test', true),
      }),
    ]) {
      expect(value(await f.run(args, ['read', 'write'], context)).state).toBe('unchanged');
    }
    const context = f.context();
    const profile = createNativeGovernedFlpRecording(f.client.safety, context, f.config, () => {});
    expect(() => assertFlpRecordingProfile(f.client.safety, context, { ...profile })).toThrow('profile');
    expect(() => assertFlpRecordingProfile(f.client.safety, f.context(), profile)).toThrow('profile');
    expect(sent).toHaveLength(0);
  });
});

describe('asynchronous boundaries and truthful outcomes', () => {
  it.each([false, true])('rechecks policy after the CSRF/auth await; proxy=%s', async (useProxy) => {
    const f = fixture(useProxy);
    let headDone = false;
    successful(() => {
      headDone = true;
    });
    f.setProvider(async () => {
      await Promise.resolve();
      if (headDone) f.policy.allowedTransports = ['A4HK900001'];
      return 'synthetic';
    });
    const result = value(await f.run());
    expect(result).toMatchObject({ ok: false, state: 'create-unconfirmed', recording: 'native-governed-unverified' });
    expect(sent.map((s) => s.method)).toEqual(['GET', 'HEAD']);
    expect(mutations()).toHaveLength(0);
  });

  it.each(['policy', 'readonly', 'deny', 'target'] as const)(
    'rechecks %s changed by a preflight response',
    async (change) => {
      const f = fixture();
      route(() => {
        if (change === 'policy') f.policy.serverAllowedTransports = [];
        if (change === 'readonly') f.config.allowWrites = false;
        if (change === 'deny') f.client.safety.denyActions = ['SAPManage'];
        if (change === 'target') f.config.targetId = 'B4H/001';
        return { status: 404, body: missing };
      });
      expect(value(await f.run()).ok).toBe(false);
      expect(sent.map((s) => s.method)).toEqual(['GET']);
    },
  );

  it('retains the original deadline and cancellation', async () => {
    const f = fixture();
    const controller = new AbortController();
    let headDone = false;
    successful(() => {
      headDone = true;
    });
    f.setProvider(async () => {
      await Promise.resolve();
      if (headDone) controller.abort();
      return 'synthetic';
    });
    expect(
      value(
        await f.run(args, ['read', 'write'], f.context({ deadline: Date.now() + 60000, signal: controller.signal })),
      ).ok,
    ).toBe(false);
    expect(mutations()).toHaveLength(0);
    sent = [];
    expect(value(await f.run(args, ['read', 'write'], f.context({ deadline: Date.now() - 1 }))).state).toBe(
      'unchanged',
    );
    expect(sent).toHaveLength(0);
  });

  it.each([400, 401, 403, 404, 421, 429, 503])(
    'never replays submitted create status %i or claims unchanged/CTS rollback',
    async (status) => {
      const f = fixture();
      successful(undefined, status);
      const result = value(await f.run());
      expect(result).toMatchObject({
        ok: false,
        state: 'create-unconfirmed',
        retryable: false,
        recording: 'native-governed-unverified',
      });
      expect(mutations()).toHaveLength(1);
      expect(result.recordingNote).toContain('CTS effects');
    },
  );

  it('a post-write policy change cannot claim confirmed content or compensate', async () => {
    const f = fixture();
    successful(undefined, 201, () => {
      f.policy.allowedTransports = [];
    });
    const result = value(await f.run());
    expect(result).toMatchObject({ ok: false, state: 'create-unconfirmed', phase: 'readback' });
    expect(mutations().map((s) => s.method)).toEqual(['POST']);
  });

  it('charges inherited response and attempt limits without resetting them', async () => {
    const f = fixture();
    successful();
    const result = value(
      await f.run(
        args,
        ['read', 'write'],
        f.context({ deadline: Date.now() + 60000, attemptBudget: new RequestAttemptBudget(2) }),
      ),
    );
    expect(result.ok).toBe(false);
    expect(mutations()).toHaveLength(0);
    sent = [];
    const capped = value(
      await f.run(
        args,
        ['read', 'write'],
        f.context({ deadline: Date.now() + 60000, responseBudget: new DataResponseBudget(50, 'test', true) }),
      ),
    );
    expect(capped).toMatchObject({ ok: false, state: 'unchanged' });
    expect(mutations()).toHaveLength(0);
  });

  it('refuses known-existing or foreign/readonly content without sending DELETE', async () => {
    const f = fixture();
    route(() => ({ body: { d: { ...catalog, isReadOnly: 'X' } } }));
    expect(value(await f.run()).state).toBe('unchanged');
    expect(value(await f.run({ action: 'flp_delete_catalog', catalogId: 'ZCAT' })).state).toBe('unchanged');
    expect(mutations()).toHaveLength(0);
  });

  it('keeps accepted DELETE followed by native604 unconfirmed', async () => {
    const f = fixture();
    let deleted = false;
    route((method) => {
      if (method === 'HEAD') return { headers: { 'x-csrf-token': 'TEST' } };
      if (method === 'DELETE') {
        deleted = true;
        return { status: 204, body: '' };
      }
      return deleted ? { status: 404, body: missing } : { body: { d: catalog } };
    });
    const result = value(await f.run({ action: 'flp_delete_catalog', catalogId: 'ZCAT' }));
    expect(result).toMatchObject({ ok: false, state: 'delete-unconfirmed', recording: 'native-governed-unverified' });
    expect(mutations().map((s) => s.method)).toEqual(['DELETE']);
  });
});

describe('compatibility and public closure', () => {
  it('the ordinary FLP entry does not select native-governed recording from policy alone', async () => {
    const f = fixture();
    expect((await handlePinnedFlp(f.client, args, f.config)).isError).toBe(true);
    expect(sent).toHaveLength(0);
  });
  it('preserves the separate observation entry without asserting recording', async () => {
    const f = fixture();
    f.policy.allowedTransports = [];
    f.policy.serverAllowedTransports = [];
    successful();
    const result = value(
      await executePrivatePinnedFlp(f.client, args, f.config, f.context(), 'disposable-client-observation'),
    );
    expect(result).toMatchObject({ ok: true, recording: 'not-established' });
  });
  it('leaves ordinary single-target create payload and recording behavior unchanged', async () => {
    const f = fixture();
    f.client.safety.multiTargetWrite = undefined;
    route((method) =>
      method === 'HEAD' ? { headers: { 'x-csrf-token': 'TEST' } } : { status: 201, body: { d: catalog } },
    );
    const result = await createCatalog(f.client.http, f.client.safety, 'ZCAT', 'Catalog');
    expect(result).toMatchObject({ id: catalog.id });
    expect(result).not.toHaveProperty('recording');
    expect(sent.map((s) => s.method)).toEqual(['HEAD', 'POST']);
  });
});

describe('real selected-target projection', () => {
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
    successful();
    const ctx = pinnedMutationContext(client.safety, { deadline: Date.now() + 60000 }, { unlockFailed: false });
    // Runtime projection intentionally does not inherit a global release override.
    expect(value(await execute(client, args, config, ctx, ['read', 'write']))).toMatchObject({
      ok: false,
      state: 'unchanged',
    });
    expect(sent).toHaveLength(0);
    // Internal harness binds source coverage from independent target evidence; no tool arg sets this.
    config.abapRelease = '758';
    expect(value(await execute(client, args, config, ctx, ['read', 'write'])).ok).toBe(true);
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
    expect(mutations()).toHaveLength(1);
  });
});

it.each([false, true])('public FLP routing preserves native-governed semantics (proxy=%s)', async (proxy) => {
  const f = fixture(proxy);
  successful();
  setCachedFeatures({ abapRelease: '758', systemType: 'onprem', systemTypeSource: 'probe' }, 'A4H/001');
  const result = await handleToolCall(
    f.client,
    { ...f.config, multiTargetAuthorization: 'xsuaa-attribute' },
    'SAPManage',
    args,
    pinnedPublicAuth(),
    undefined,
    undefined,
    true,
  );
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(value(result)).toMatchObject({
    ok: true,
    state: 'created',
    priorExistence: 'unknown',
    recording: 'native-governed-unverified',
  });
  expect(mutations()).toHaveLength(1);
});
