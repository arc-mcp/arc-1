import { readFileSync } from 'node:fs';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ServerConfig } from '../../../src/server/types.js';

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
const { requestContext } = await import('../../../src/server/context.js');
const { executePrivatePinnedGeneratedBindingDelete: execute } = await import(
  '../../../src/handlers/pinned-generated-binding-delete.js'
);
const { parsePinnedBinding, pinnedBindingSelection } = await import('../../../src/adt/pinned-service-binding-owner.js');
const { deletePinnedBinding } = await import('../../../src/adt/pinned-service-binding.js');
const { pinnedMutationAllowed } = await import('../../../src/server/multi-target-write-surface.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const origin = 'https://sap.invalid';
const owner = '/sap/bc/adt/businessservices/bindings/ZBIND';
const xml = readFileSync(new URL('../../fixtures/xml/service-binding.xml', import.meta.url), 'utf8')
  .replaceAll('/DMO/UI_TRAVEL_D_D_O4', 'ZBIND')
  .replaceAll('/DMO/UI_TRAVEL_D_D', 'ZDEFINITION')
  .replaceAll('%2fdmo%2fui_travel_d_d', 'zdefinition')
  .replaceAll('/DMO/FLIGHT_DRAFT', '$TMP')
  .replaceAll('%2fdmo%2fflight_draft', '%24tmp')
  .replace('srvb:published="true"', 'srvb:published="false"');
const absent =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Missing</message></exc:exception>';
const previous = getGlobalDispatcher();
let agent: InstanceType<typeof MockAgent>;
let sent: { method: string; path: string; body: unknown; headers: unknown }[];
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
function fixture(useProxy = false, semaphore?: InstanceType<typeof Semaphore>) {
  const policy = {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['*'],
    allowedTransports: ['*'],
    serverAllowedTransports: ['*'],
  };
  const safety = { ...defaultSafetyConfig(), allowWrites: true, allowedPackages: ['*'], multiTargetWrite: policy };
  const config: ServerConfig = {
    ...DEFAULT_CONFIG,
    targetId: policy.target,
    multiTargetWrite: policy,
    multiTargetEndpoints: true,
    multiTargetAuthorization: 'xsuaa-attribute' as const,
    allowWrites: true,
    allowedPackages: ['*'],
    ppEnabled: true,
    ppStrict: true,
    systemType: 'onprem' as const,
    abapRelease: '758',
    client: '001',
  };
  const auth: AuthInfo = {
    token: 'TOKEN_SECRET',
    clientId: 'test-client',
    scopes: ['read', 'write'],
    extra: {
      arc1VerifiedRawScopes: ['write'],
      xsuaaUserAttributes: { arc1_targets: ['A4H/001'], arc1_write_targets: ['A4H/001'] },
      xsuaaUserAttributeStatus: { arc1_targets: 'valid', arc1_write_targets: 'valid' },
    },
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
  const documents = new Map([[owner, xml]]);
  const input = () => ({
    name: 'ZBIND',
    expectedMetadataHash: parsePinnedBinding(documents.get(owner)!, pinnedBindingSelection('ZBIND')).metadataHash,
  });
  const context = (budget: Parameters<typeof pinnedMutationContext>[1] = { deadline: Date.now() + 60_000 }) =>
    pinnedMutationContext(client.safety, budget, { unlockFailed: false });
  const request = { requestId: 'REQ-TEST', user: 'MAPPED_TEST', target: 'A4H/001', identity: 'per-user' as const };
  return {
    client,
    config,
    policy,
    auth,
    documents,
    input,
    context,
    request,
    provider: (fn: () => Promise<string>) => {
      provider = fn;
    },
    run: (args: Record<string, unknown> = input(), ctx = context()) =>
      requestContext.run(request, () => execute(client, args, config, ctx, auth)),
  };
}
type Fixture = ReturnType<typeof fixture>;
function route(f: Fixture, override?: (method: string, path: string) => { code?: number; body?: string } | undefined) {
  for (const method of ['HEAD', 'GET', 'POST', 'PUT', 'DELETE'])
    agent
      .get(origin)
      .intercept({ path: /.*/, method })
      .reply((options) => {
        sent.push({ method, path: options.path, body: options.body, headers: options.headers });
        const url = new URL(options.path, origin);
        const fault = override?.(method, options.path);
        if (fault) return { statusCode: fault.code ?? 200, data: fault.body ?? '' };
        if (method === 'HEAD')
          return { statusCode: 200, data: '', responseOptions: { headers: { 'x-csrf-token': 'CSRF_SECRET' } } };
        if (url.pathname === '/sap/bc/adt/core/http/sessions') return { statusCode: 200, data: '' };
        if (url.searchParams.get('_action') === 'LOCK')
          return {
            statusCode: 200,
            data: '<DATA><LOCK_HANDLE>LOCK_SECRET</LOCK_HANDLE><CORRNR/><IS_LOCAL>X</IS_LOCAL></DATA>',
            responseOptions: { headers: { 'set-cookie': 'sap-contextid=SESSION_SECRET; Path=/' } },
          };
        if (url.searchParams.get('_action') === 'UNLOCK') return { statusCode: 200, data: '' };
        if (url.pathname.includes('transportchecks'))
          return {
            statusCode: 200,
            data: '<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION/><RECORDING/><LOCKS/><RESULT>S</RESULT></DATA>',
          };
        if (method === 'GET' && url.pathname === owner)
          return f.documents.has(owner)
            ? { statusCode: 200, data: f.documents.get(owner)! }
            : { statusCode: 404, data: absent };
        if (method === 'DELETE' && url.pathname === owner) {
          f.documents.delete(owner);
          return { statusCode: 204, data: '' };
        }
        throw new Error(`Unexpected request ${method} ${url.pathname}`);
      })
      .persist();
}
const value = (result: Awaited<ReturnType<typeof execute>>) => JSON.parse(result.content[0].text as string);
const deletes = () => sent.filter((r) => r.method === 'DELETE' && new URL(r.path, origin).pathname === owner);
const unlocks = () => sent.filter((r) => r.path.includes('_action=UNLOCK'));

it.each([false, true])(
  'deletes only the whole native parent; cleanup and CTS remain explicitly unverified (proxy=%s)',
  async (useProxy) => {
    const f = fixture(useProxy);
    route(f);
    const result = value(await f.run());
    expect(result).toMatchObject({
      ok: true,
      state: 'accepted-unverified',
      parentState: 'deleted',
      submitted: 1,
      generatedCleanup: 'accepted-unverified',
      recording: 'native-governed-unverified',
      implementation: 'ZBIND',
      retryable: false,
    });
    expect(result.observations).toContain('does not verify');
    expect(deletes()).toHaveLength(1);
    expect(unlocks()).toHaveLength(1);
    expect(sent.filter((r) => r.method === 'GET' && new URL(r.path, origin).pathname === owner)).toHaveLength(3);
    expect(sent.every((r) => r.path.includes('sap-client=001'))).toBe(true);
    expect(sent.some((r) => /srvd|g4ba|SUSH|activation|publishjobs/.test(r.path))).toBe(false);
    expect(new URL(deletes()[0].path, origin).searchParams.has('version')).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/TOKEN_SECRET|CSRF_SECRET|LOCK_SECRET|SESSION_SECRET|MAPPED_TEST/);
    expect(f.client.safety.allowTransportWrites).toBe(false);
  },
);

const policySlots = ['server-package', 'destination-package', 'server-request', 'destination-request'] as const;
function replacePolicy(f: Fixture, slot: (typeof policySlots)[number], list: unknown) {
  if (slot === 'server-package') f.client.safety.allowedPackages = list as string[];
  if (slot === 'destination-package') f.policy.allowedPackages = list as string[];
  if (slot === 'server-request') f.policy.serverAllowedTransports = list as string[];
  if (slot === 'destination-request') f.policy.allowedTransports = list as string[];
}
for (const slot of policySlots)
  it.each(
    [
      [],
      ['$TMP'],
      ['DEV*'],
      undefined,
      ['*', '__ARC1_DENY_ALL__'],
      ['*', 'bad entry'],
      ['*', 3],
      ['*', ...Array(1)],
      Object.assign(Array(2), { 0: '*' }),
    ].map((list) => ({ list })),
  )(`refuses ${slot} without explicit well-formed unrestricted policy: %j`, async ({ list }) => {
    const f = fixture();
    route(f);
    replacePolicy(f, slot, list);
    expect(value(await f.run())).toMatchObject({ ok: false, parentState: 'unchanged', submitted: 0 });
    expect(sent).toHaveLength(0);
  });
it('accepts valid additional package rules without mistaking them for required generated-child package reads', async () => {
  const f = fixture();
  f.policy.allowedPackages = ['*', '$TMP', 'ZFOO/**', '/NS/Z*'];
  route(f);
  expect(value(await f.run()).parentState).toBe('deleted');
});

it.each([
  [
    'server readonly',
    (f: Fixture) => {
      f.config.allowWrites = false;
    },
  ],
  [
    'destination readonly',
    (f: Fixture) => {
      f.policy.enabled = false;
    },
  ],
  [
    'not strict',
    (f: Fixture) => {
      f.config.ppStrict = false;
    },
  ],
  [
    'wrong target',
    (f: Fixture) => {
      f.config.targetId = 'A4H/002';
    },
  ],
  [
    'shared Basic identity',
    (f: Fixture) => {
      f.request.identity = 'shared' as any;
    },
  ],
  [
    'aggregate',
    (f: Fixture) => {
      f.config.targetId = undefined;
    },
  ],
  [
    'unsupported release',
    (f: Fixture) => {
      f.config.abapRelease = '750';
    },
  ],
  [
    'cloud platform',
    (f: Fixture) => {
      f.config.systemType = 'btp' as any;
    },
  ],
  [
    'denied action',
    (f: Fixture) => {
      f.config.denyActions = ['SAPWrite.delete'];
    },
  ],
  [
    'Copilot/inferred write',
    (f: Fixture) => {
      f.auth.extra!.arc1VerifiedRawScopes = ['admin'];
    },
  ],
  [
    'missing functional scope',
    (f: Fixture) => {
      f.auth.scopes = ['read'];
    },
  ],
  [
    'wildcard write grant',
    (f: Fixture) => {
      (f.auth.extra!.xsuaaUserAttributes as any).arc1_write_targets = ['*'];
    },
  ],
  [
    'wrong exact write grant',
    (f: Fixture) => {
      (f.auth.extra!.xsuaaUserAttributes as any).arc1_write_targets = ['OTHER/001'];
    },
  ],
  [
    'unverified extraction',
    (f: Fixture) => {
      (f.auth.extra!.xsuaaUserAttributeStatus as any).arc1_write_targets = 'invalid';
    },
  ],
  [
    'missing read grant',
    (f: Fixture) => {
      delete (f.auth.extra!.xsuaaUserAttributes as any).arc1_targets;
    },
  ],
  [
    'expired authentication',
    (f: Fixture) => {
      f.auth.expiresAt = 1;
    },
  ],
  [
    'server config narrowed',
    (f: Fixture) => {
      f.config.allowedPackages = ['$TMP'];
    },
  ],
] as const)('refuses %s before any native request', async (_, change) => {
  const f = fixture();
  route(f);
  const context = f.context();
  change(f);
  expect(value(await f.run(f.input(), context))).toMatchObject({ ok: false, submitted: 0 });
  expect(sent).toHaveLength(0);
});

it.each([
  ['published', (body: string) => body.replace('srvb:published="false"', 'srvb:published="true"')],
  ['unknown publication', (body: string) => body.replace('srvb:published="false"', '')],
  ['not generated', (body: string) => body.replace('srvb:bindingCreated="true"', 'srvb:bindingCreated="false"')],
  ['inactive', (body: string) => body.replace('adtcore:version="active"', 'adtcore:version="inactive"')],
  ['unsupported protocol', (body: string) => body.replace('srvb:version="V4"', 'srvb:version="V2"')],
  [
    'foreign implementation',
    (body: string) =>
      body.replace('<srvb:implementation adtcore:name="ZBIND"', '<srvb:implementation adtcore:name="ZOTHER"'),
  ],
  [
    'opaque native drift',
    (body: string) => body.replace('srvb:serviceBinding ', 'srvb:serviceBinding opaque="changed" '),
  ],
] as const)('refuses %s before locking or under the owning lock', async (_, change) => {
  for (const underLock of [false, true]) {
    const f = fixture();
    const input = f.input();
    let locked = false;
    route(f, (_method, path) => {
      if (path.includes('_action=LOCK')) locked = true;
      if ((!underLock || locked) && new URL(path, origin).pathname === owner && _method === 'GET')
        return { body: change(xml) };
      return undefined;
    });
    const result = value(await f.run(input));
    expect(result.ok).toBe(false);
    expect(deletes()).toHaveLength(0);
    if (underLock) expect(unlocks()).toHaveLength(1);
    await agent.close();
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    proxy.pool = agent.get(origin);
    sent = [];
  }
});
it('refuses an inactive alternative even when the caller hashes that exact native document', async () => {
  const f = fixture();
  f.documents.set(
    owner,
    xml.replace(
      '</srvb:serviceBinding>',
      `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${owner}?version=inactive"/></srvb:serviceBinding>`,
    ),
  );
  route(f);
  expect(value(await f.run()).ok).toBe(false);
  expect(deletes()).toHaveLength(0);
});

it.each([400, 403, 409, 421, 429, 500, 503])(
  'does not replay submitted DELETE %s or claim absence/unchanged/clean CTS',
  async (code) => {
    const f = fixture();
    route(f, (method, path) =>
      method === 'DELETE' && new URL(path, origin).pathname === owner
        ? { code, body: 'PRIVATE_NATIVE_DETAILS' }
        : undefined,
    );
    const result = value(await f.run());
    expect(result).toMatchObject({
      ok: false,
      submitted: 1,
      retryable: false,
      generatedCleanup: 'unknown',
      recording: 'native-governed-unverified',
    });
    expect(result.parentState).not.toBe('unchanged');
    expect(result.parentState).not.toBe('deleted');
    expect(deletes()).toHaveLength(1);
    expect(unlocks()).toHaveLength(1);
  },
);
it.each(['generic404', 'still-present', 'cleanup-failure'])(
  'keeps independent parent and cleanup facts for %s',
  async (mode) => {
    const f = fixture();
    route(f, (method, path) => {
      if (mode === 'generic404' && method === 'GET' && !f.documents.has(owner)) return { code: 404, body: 'Not found' };
      if (mode === 'still-present' && method === 'DELETE') return { code: 204 };
      if (mode === 'cleanup-failure' && path.includes('_action=UNLOCK')) return { code: 500, body: 'SECRET_NATIVE' };
      return undefined;
    });
    const result = value(await f.run());
    expect(result).toMatchObject({ ok: false, submitted: 1, generatedCleanup: 'accepted-unverified' });
    expect(result.parentState).toBe(mode === 'cleanup-failure' ? 'deleted' : 'delete-unconfirmed');
    if (mode === 'cleanup-failure') expect(result.cleanupFailed).toBe(true);
    expect(deletes()).toHaveLength(1);
  },
);

it.each([false, true])(
  'rechecks policy and exact grants after authentication waits before DELETE (proxy=%s)',
  async (useProxy) => {
    for (const revoke of [
      (f: Fixture) => {
        f.policy.allowedTransports = [];
      },
      (f: Fixture) => {
        (f.auth.extra!.xsuaaUserAttributes as any).arc1_write_targets = ['OTHER/001'];
      },
    ]) {
      const f = fixture(useProxy);
      let ready = false;
      route(f, (_method, path) => {
        if (path.includes('_action=LOCK')) ready = true;
        return undefined;
      });
      f.provider(async () => {
        if (ready && sent.filter((r) => r.path.includes('transportchecks')).length === 2) revoke(f);
        return 'synthetic';
      });
      const result = value(await f.run());
      expect(result).toMatchObject({ ok: false, submitted: 0, generatedCleanup: 'not-submitted' });
      expect(deletes()).toHaveLength(0);
      expect(unlocks()).toHaveLength(1);
      await agent.close();
      agent = new MockAgent();
      agent.disableNetConnect();
      setGlobalDispatcher(agent);
      proxy.pool = agent.get(origin);
      sent = [];
    }
  },
);
it.each([false, true])(
  'rechecks effective deadline after final synchronous proof and still owns cleanup (proxy=%s)',
  async (useProxy) => {
    const f = fixture(useProxy);
    route(f);
    const now = Date.now();
    let current = now;
    vi.spyOn(Date, 'now').mockImplementation(() => current);
    class Proof extends RequestAttemptBudget {
      override consume() {
        super.consume();
        if (sent.filter((r) => r.path.includes('transportchecks')).length === 2) current = now + 61_000;
      }
    }
    const result = value(await f.run(f.input(), f.context({ deadline: now + 60_000, attemptBudget: new Proof(64) })));
    expect(result).toMatchObject({ ok: false, submitted: 0, parentState: 'delete-unconfirmed' });
    expect(deletes()).toHaveLength(0);
    expect(unlocks()).toHaveLength(1);
  },
);
it.each([false, true])(
  'rechecks synchronous proof policy changes at the final dispatch boundary (proxy=%s)',
  async (useProxy) => {
    const f = fixture(useProxy);
    route(f);
    class Proof extends RequestAttemptBudget {
      override consume() {
        super.consume();
        if (sent.filter((r) => r.path.includes('transportchecks')).length === 2) f.policy.allowedPackages = ['$TMP'];
      }
    }
    expect(
      value(await f.run(f.input(), f.context({ deadline: Date.now() + 60_000, attemptBudget: new Proof(64) }))).ok,
    ).toBe(false);
    expect(deletes()).toHaveLength(0);
    expect(unlocks()).toHaveLength(1);
  },
);

it.each([
  { name: 'ZBIND', expectedMetadataHash: 'bad' },
  { name: 'ZBIND', expectedMetadataHash: '0'.repeat(64), bypass: true },
  { name: '../ZBIND', expectedMetadataHash: '0'.repeat(64) },
  { name: 'ZBIND', expectedMetadataHash: '0'.repeat(64), version: 'inactive' },
])('refuses arbitrary input before submission %j', async (args) => {
  const f = fixture();
  route(f);
  expect(value(await f.run(args)).ok).toBe(false);
  expect(deletes()).toHaveLength(0);
});
it('bounds successful/error bodies and attempts without converting failures into absence', async () => {
  const f = fixture();
  route(f);
  const result = value(
    await f.run(
      f.input(),
      f.context({ deadline: Date.now() + 60_000, responseBudget: new DataResponseBudget(128, 'test', true) }),
    ),
  );
  expect(result).toMatchObject({ ok: false, submitted: 0 });
  expect(deletes()).toHaveLength(0);
});
it('preserves the generated guard through admitted ordinary public SRVB deletion', async () => {
  const f = fixture();
  route(f);
  const args = { action: 'delete', type: 'SRVB', name: 'ZBIND' };
  expect((await deletePinnedBinding(f.client, f.context(), { name: 'ZBIND' })).ok).toBe(false);
  expect(pinnedMutationAllowed('SAPWrite', args, f.config)).toBe(true);
  const result = await handleToolCall(f.client, f.config, 'SAPWrite', args, f.auth, undefined, undefined, true);
  expect(result.isError).toBe(true);
  expect(deletes()).toHaveLength(0);
  const before = sent.length;
  const privateArgs = { ...args, expectedMetadataHash: f.input().expectedMetadataHash };
  expect(pinnedMutationAllowed('SAPWrite', privateArgs, f.config)).toBe(false);
  const refused = await handleToolCall(f.client, f.config, 'SAPWrite', privateArgs, f.auth, undefined, undefined, true);
  expect(refused.isError).toBe(true);
  expect(JSON.stringify(refused)).toContain('MULTI_TARGET_OPERATION_FORBIDDEN');
  expect(sent).toHaveLength(before);
});

it.each([
  ['published', 'srvb:published="false"', 'srvb:published="true"'],
  ['missing generated flag', 'srvb:bindingCreated="true"', ''],
  ['inactive owner', 'adtcore:version="active"', 'adtcore:version="inactive"'],
  ['V2', 'srvb:version="V4"', 'srvb:version="V2"'],
  ['unknown category', 'srvb:category="0"', 'srvb:category="2"'],
  [
    'different implementation',
    '<srvb:implementation adtcore:name="ZBIND"',
    '<srvb:implementation adtcore:name="ZOTHER"',
  ],
] as const)('a caller-provided matching hash does not authorize unsupported native state: %s', async (_, from, to) => {
  const f = fixture();
  f.documents.set(owner, xml.replace(from, to));
  route(f);
  expect(value(await f.run())).toMatchObject({ ok: false, submitted: 0 });
  expect(deletes()).toHaveLength(0);
  expect(sent.some((r) => r.path.includes('_action=LOCK'))).toBe(false);
});
it.each([false, true])('preserves opaque native fields in fresh hash binding (proxy=%s)', async (useProxy) => {
  const f = fixture(useProxy);
  f.documents.set(
    owner,
    xml.replace('srvb:serviceBinding ', 'srvb:serviceBinding xmlns:opaque="urn:opaque" opaque:setting="native value" '),
  );
  route(f);
  expect(value(await f.run()).parentState).toBe('deleted');
  expect(deletes()).toHaveLength(1);
});
it.each(
  [false, true].flatMap((useProxy) =>
    [
      'control',
      'policy',
      'grant',
      'scope',
      'readonly',
      'destination-readonly',
      'client-readonly',
      'expired',
      'cancel',
    ].map((mode) => ({ useProxy, mode })),
  ),
)('retains final authorization through real semaphore wait: $mode proxy=$useProxy', async ({ useProxy, mode }) => {
  const now = Date.now(),
    clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const semaphore = new Semaphore(1),
    run = semaphore.run.bind(semaphore),
    f = fixture(useProxy, semaphore);
  route(f);
  let held = false;
  vi.spyOn(semaphore, 'run').mockImplementation(async (fn, signal) => {
    const result = await run(fn, signal);
    if (!held && sent.filter((r) => r.path.includes('transportchecks')).length === 2) {
      held = true;
      await semaphore.acquire();
    }
    return result;
  });
  const abort = new AbortController();
  const pending = f.run(f.input(), f.context({ deadline: now + 60_000, signal: abort.signal }));
  for (let i = 0; i < 100 && !semaphore.waiting; i++) await new Promise((resolve) => setTimeout(resolve, 1));
  expect(semaphore.waiting).toBe(1);
  expect(deletes()).toHaveLength(0);
  if (mode === 'policy') f.policy.serverAllowedTransports = [];
  if (mode === 'grant') (f.auth.extra!.xsuaaUserAttributes as any).arc1_write_targets = ['OTHER/001'];
  if (mode === 'scope') f.auth.extra!.arc1VerifiedRawScopes = [];
  if (mode === 'readonly') f.config.allowWrites = false;
  if (mode === 'destination-readonly') f.policy.enabled = false;
  if (mode === 'client-readonly') f.client.safety.allowWrites = false;
  if (mode === 'expired') clock.mockReturnValue(now + 60_001);
  if (mode === 'cancel') abort.abort();
  semaphore.release();
  expect(value(await pending).ok).toBe(mode === 'control');
  expect(deletes()).toHaveLength(mode === 'control' ? 1 : 0);
  expect(unlocks()).toHaveLength(1);
});
it('keeps actual parent recording/lock constraints despite unrestricted downstream request policy', async () => {
  const f = fixture();
  route(f, (_method, path) =>
    path.includes('_action=LOCK')
      ? { body: '<DATA><LOCK_HANDLE>LOCK_SECRET</LOCK_HANDLE><CORRNR>DEVK900001</CORRNR><IS_LOCAL>X</IS_LOCAL></DATA>' }
      : undefined,
  );
  expect(value(await f.run())).toMatchObject({ ok: false, submitted: 0 });
  expect(deletes()).toHaveLength(0);
  expect(unlocks()).toHaveLength(1);
});
it('bounds attempts before even a CSRF or lock send', async () => {
  const f = fixture();
  route(f);
  const result = value(
    await f.run(f.input(), f.context({ deadline: Date.now() + 60_000, attemptBudget: new RequestAttemptBudget(1) })),
  );
  expect(result).toMatchObject({ ok: false, submitted: 0 });
  expect(sent).toHaveLength(1);
  expect(deletes()).toHaveLength(0);
});
it('minimal error projection retains partial facts without private native diagnostics', async () => {
  const f = fixture();
  f.config.minimalErrors = true;
  route(f, (method) => (method === 'DELETE' ? { code: 400, body: 'PRIVATE_NATIVE_DETAILS' } : undefined));
  const result = value(await f.run());
  expect(result).toMatchObject({
    ok: false,
    parentState: 'delete-rejected',
    submitted: 1,
    generatedCleanup: 'unknown',
    retryable: false,
  });
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_NATIVE_DETAILS|LOCK_SECRET|SESSION_SECRET|TOKEN_SECRET/);
});
it('does not admit an expired, missing-context or overly broad response/time allowance', async () => {
  const f = fixture();
  route(f);
  expect(value(await execute(f.client, f.input(), f.config, f.context(), f.auth)).ok).toBe(false);
  expect(value(await f.run(f.input(), f.context({ deadline: Date.now() + 300_000 }))).ok).toBe(false);
  expect(
    value(
      await f.run(
        f.input(),
        f.context({
          deadline: Date.now() + 60_000,
          responseBudget: new DataResponseBudget(3 * 1024 * 1024, 'test', true),
        }),
      ),
    ).ok,
  ).toBe(false);
  expect(
    value(
      await f.run(
        f.input(),
        f.context({ deadline: Date.now() + 60_000, responseBudget: new DataResponseBudget(1024, 'test', false) }),
      ),
    ).ok,
  ).toBe(false);
  expect(sent).toHaveLength(0);
});
it('requires the standard tool runtime even with an otherwise valid private request context', async () => {
  const f = fixture();
  f.config.toolMode = 'hyperfocused';
  route(f);
  expect(value(await f.run())).toMatchObject({ ok: false, submitted: 0 });
  expect(sent).toHaveLength(0);
});
