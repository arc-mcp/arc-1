import { createHash } from 'node:crypto';
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
vi.mock('../../../scripts/qualification/pr1142/native-flp-evidence.js', () => ({
  flpNativeEvidence: { metadataHash: createHash('sha256').update('<synthetic/>').digest('hex') },
}));
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = await import('undici');
const { AdtClient } = await import('../../../src/adt/client.js');
const { defaultSafetyConfig } = await import('../../../src/adt/safety.js');
const { runNativeFlpStage, checkFlpQualificationRequest } = await import(
  '../../../scripts/qualification/pr1142/native-flp-driver.js'
);
const { FLP_ORIGIN, FLP_SERVICE, flpFixtures, flpKey, flpOwner, flpPage, nativeFlpConfig } = await import(
  '../../../scripts/qualification/pr1142/native-flp-fixed.js'
);
const missing = readFileSync(new URL('../../fixtures/flp/cust-resource-lookup-604.json', import.meta.url), 'utf8');
const previous = getGlobalDispatcher();
let agent: InstanceType<typeof MockAgent>, sent: { method: string; path: string; body: unknown }[], rows: any[];
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  proxy.pool = agent.get(FLP_ORIGIN);
  sent = [];
  rows = [];
});
afterEach(async () => {
  vi.restoreAllMocks();
  setGlobalDispatcher(previous);
  await agent.close();
  expect(JSON.stringify(rows)).not.toContain('own-context-secret');
});
type Stage = 'page' | 'catalog';
function nativeEntity(stage: Stage, page = false) {
  const fixture = flpFixtures[stage];
  return stage === 'page' || page
    ? {
        id: flpKey(stage),
        title: fixture.title,
        catalogId: stage === 'page' ? '/UI2/FLPD_CATALOG' : '',
        layout: '',
        scope: 'CUSTOMIZING',
        isCatalogPage: stage === 'page' ? '' : 'X',
        isReadOnly: '',
        chipInstanceCount: '0000',
      }
    : {
        id: flpKey(stage),
        domainId: fixture.id,
        title: fixture.title,
        type: 'CATALOG_PAGE',
        scope: 'CUSTOMIZING',
        isReadOnly: '',
        chipCount: '0000',
      };
}
function harness(
  stage: Stage,
  useProxy = false,
  change?: (method: string, path: string, state: { exists: boolean; gets: number }, normal: any) => any,
) {
  const config = structuredClone(nativeFlpConfig());
  let provider = async () => 'synthetic';
  const state = { exists: false, gets: 0 };
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'])
    agent
      .get(FLP_ORIGIN)
      .intercept({ method, path: /.*/ })
      .reply((options) => {
        const path = options.path.split('?')[0];
        sent.push({ method, path, body: options.body });
        const json = (body: unknown) => ({
          status: 200,
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        });
        let normal: any;
        if (path === '/sap/bc/adt/core/http/sessions')
          normal = { status: 200, body: '', headers: { 'set-cookie': 'sap-contextid=0' } };
        else if (method === 'HEAD')
          normal = {
            status: 200,
            body: '',
            headers: { 'x-csrf-token': 'TEST', 'set-cookie': 'sap-contextid=own-context-secret' },
          };
        else if (path === `${FLP_SERVICE}/$metadata`)
          normal = { status: 200, body: '<synthetic/>', headers: { 'content-type': 'application/xml' } };
        else if (method === 'POST') {
          state.exists = true;
          normal = { ...json({ d: nativeEntity(stage) }), status: 201 };
        } else if (method === 'DELETE') {
          state.exists = false;
          normal = { status: 204, body: '' };
        } else if (path.endsWith('/PageChipInstances') || path.endsWith('/Bags'))
          normal = json({ d: { results: [], __count: '0' } });
        else {
          state.gets++;
          normal = state.exists
            ? json({ d: nativeEntity(stage, path === flpPage(stage)) })
            : { status: 404, body: missing };
        }
        const reply = change?.(method, path, state, normal) ?? normal;
        return {
          statusCode: reply.status,
          data: reply.body ?? '',
          responseOptions: { headers: reply.headers ?? { 'content-type': 'application/json' } },
        };
      })
      .persist();
  const base = new AdtClient({
    baseUrl: FLP_ORIGIN,
    client: '001',
    safety: { ...defaultSafetyConfig(), ...config },
    maxConcurrent: 1,
    ...(useProxy
      ? { btpProxy: { protocol: 'http', host: 'proxy.invalid', port: 80, getProxyToken: () => provider() } }
      : { bearerTokenProvider: () => provider() }),
  });
  const input = {
    base,
    stage,
    record: (row: unknown) => {
      rows.push(row);
    },
    verifySource: vi.fn(),
    shouldStop: () => false,
    deadline: Date.now() + 90_000,
  };
  return {
    input,
    run: () => runNativeFlpStage(input),
    state,
    setProvider: (next: () => Promise<string>) => {
      provider = next;
    },
  };
}
for (const stage of ['page', 'catalog'] as const)
  for (const proxy of [false, true]) {
    it(`${stage} native completion, not absence; proxy=${proxy}`, async () => {
      const result = await harness(stage, proxy).run();
      expect(result).toMatchObject({
        failure: false,
        declaredNativeParts: stage === 'catalog' ? ['Page', 'PageConfig'] : ['Page'],
        createAcknowledged: true,
        ownedReadbackVerified: true,
        deleteAcknowledged: true,
        nativeDeleteCompleted: true,
        postDeleteLookup: 'unknown',
        readAbsenceConfirmed: false,
        sessionCleanup: 'closed',
        recording: 'native-governed-unverified',
      });
      expect(sent.filter((r) => r.method === 'POST')).toHaveLength(1);
      expect(sent.filter((r) => r.method === 'DELETE')).toEqual([
        { method: 'DELETE', path: flpOwner(stage), body: proxy ? undefined : null },
      ]);
      expect(sent.some((r) => r.method === 'PUT')).toBe(false);
      expect(sent.some((r) => r.path.endsWith('/Bags'))).toBe(stage === 'catalog');
    });
    it(`${stage} final proof crossing narrower native deadline prevents DELETE; proxy=${proxy}`, async () => {
      const h = harness(stage, proxy);
      const start = Date.now();
      let offset = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => start + offset);
      h.input.verifySource.mockImplementation(() => {
        if (rows.some((r) => r.stage === 'request' && r.method === 'DELETE')) offset = 31000;
      });
      const result = await h.run();
      expect(result.failure).toBe(true);
      expect(result.deleteAcknowledged).toBe(false);
      expect(sent.filter((r) => r.method === 'DELETE')).toHaveLength(0);
      expect(result.sessionCleanup).toBe('closed');
    });
  }
it.each([400, 401, 403, 404, 409, 429, 503])(
  'submitted create %s is uncertain, never cleanup or replay',
  async (status) => {
    const h = harness('page', false, (method, _p, _s, r) => (method === 'POST' ? { ...r, status } : r));
    const result = await h.run();
    expect(result).toMatchObject({
      failure: true,
      mutationAttempted: true,
      ownedReadbackVerified: false,
      nativeDeleteCompleted: false,
    });
    expect(sent.filter((r) => r.method === 'POST')).toHaveLength(1);
    expect(sent.filter((r) => r.method === 'DELETE')).toHaveLength(0);
  },
);
it.each([200, 202])('unqualified create status %s does not establish ownership', async (status) => {
  const result = await harness('page', false, (method, _p, _s, r) => (method === 'POST' ? { ...r, status } : r)).run();
  expect(result.failure).toBe(true);
  expect(result.ownedReadbackVerified).toBe(false);
  expect(sent.some((r) => r.method === 'DELETE')).toBe(false);
});
it('known existing owner refuses before POST', async () => {
  const h = harness('page');
  h.state.exists = true;
  expect((await h.run()).failure).toBe(true);
  expect(sent.some((r) => r.method === 'POST')).toBe(false);
});
it.each([
  'generic404',
  'foreign604',
  'wrong-marker',
  'changed-under-guard',
  'nonempty',
  'pagination',
  'bad-delete',
  'remaining',
  'close-fails',
])('refuses %s honestly', async (kind) => {
  let inspected = 0;
  const h = harness('page', false, (method, path, state, r) => {
    if (kind === 'generic404' && r.status === 404) return { status: 404, body: 'Not found' };
    if (kind === 'foreign604' && r.status === 404)
      return { ...r, body: missing.replace('PAGE_BUILDER_CUST', 'FOREIGN') };
    if (kind === 'close-fails' && path.endsWith('/http/sessions')) return { status: 503 };
    if (kind === 'bad-delete' && method === 'DELETE') return { status: 200, body: '{}' };
    if (method === 'GET' && path === flpOwner('page') && state.exists) {
      inspected++;
      if (kind === 'wrong-marker' || (kind === 'changed-under-guard' && inspected >= 3))
        return { ...r, body: JSON.stringify({ d: { ...nativeEntity('page'), title: 'foreign' } }) };
    }
    if (path.endsWith('/PageChipInstances') && kind === 'nonempty')
      return { ...r, body: JSON.stringify({ d: { results: [{ id: 'foreign' }] } }) };
    if (path.endsWith('/PageChipInstances') && kind === 'pagination')
      return { ...r, body: JSON.stringify({ d: { results: [], __next: 'https://foreign.invalid' } }) };
    if (kind === 'remaining' && r.status === 404 && sent.some((row) => row.method === 'DELETE'))
      return { status: 200, body: JSON.stringify({ d: nativeEntity('page') }) };
    return r;
  });
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.readAbsenceConfirmed).toBe(false);
  expect(sent.filter((r) => r.method === 'POST').length).toBeLessThanOrEqual(1);
  expect(sent.filter((r) => r.method === 'DELETE').length).toBeLessThanOrEqual(1);
  if (['wrong-marker', 'changed-under-guard', 'nonempty', 'pagination'].includes(kind))
    expect(sent.some((r) => r.method === 'DELETE')).toBe(false);
});
it.each(['server', 'destination', 'readonly', 'disabled', 'stop', 'binding'])(
  'fails %s before modification',
  async (kind) => {
    const h = harness('page');
    const policy = h.input.base.safety.multiTargetWrite!;
    if (kind === 'server') Object.assign(policy, { serverAllowedTransports: ['DEV*'] });
    if (kind === 'destination') Object.assign(policy, { allowedTransports: [] });
    if (kind === 'readonly') h.input.base.safety.allowWrites = false;
    if (kind === 'disabled') Object.assign(policy, { enabled: false });
    if (kind === 'stop') h.input.shouldStop = () => true;
    if (kind === 'binding')
      h.input.verifySource.mockImplementation(() => {
        throw new Error('not exposed');
      });
    expect((await h.run()).failure).toBe(true);
    expect(sent.some((r) => ['POST', 'DELETE'].includes(r.method))).toBe(false);
  },
);
it('policy drift after create stops cleanup and retains ownership facts', async () => {
  const h = harness('page');
  h.input.record = (row) => {
    rows.push(row);
    if ((row as any).ownedReceipt) Object.assign(h.input.base.safety.multiTargetWrite!, { allowedTransports: [] });
  };
  const result = await h.run();
  expect(result).toMatchObject({
    failure: true,
    createAcknowledged: true,
    ownedReadbackVerified: true,
    deleteAcknowledged: false,
    sessionCleanup: 'closed',
  });
  expect(sent.some((r) => r.method === 'DELETE')).toBe(false);
});
it.each([
  ['PUT', flpOwner('page')],
  ['DELETE', flpOwner('catalog')],
  ['GET', 'https://foreign.invalid'],
  ['GET', `${flpOwner('page')}?x=1`],
  ['GET', `${flpPage('page')}/Bags?$format=json&$top=1`],
  ['POST', `${FLP_SERVICE}/PageSets`],
])('rejects foreign/unsupported %s %s', (method, path) => {
  expect(() => checkFlpQualificationRequest('page', method, path)).toThrow();
});
it.each([false, true])('fresh prerequisite expires during first POST auth wait; proxy=%s', async (proxy) => {
  const h = harness('page', proxy);
  const start = Date.now();
  h.input.deadline = start + 15_000;
  let offset = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => start + offset);
  h.setProvider(async () => {
    await Promise.resolve();
    if (rows.some((r) => r.stage === 'request' && r.method === 'POST')) offset = 16_000;
    return 'synthetic';
  });
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.createAcknowledged).toBe(false);
  expect(sent.some((r) => r.method === 'POST')).toBe(false);
  expect(sent.some((r) => r.method === 'DELETE')).toBe(false);
});
it.each(['POST', 'DELETE'])('native %s diagnostic header cannot become completion', async (verb) => {
  const result = await harness('page', false, (method, _path, _state, r) =>
    method === verb
      ? { ...r, headers: { ...r.headers, 'sap-message': '{"severity":"error","message":"private detail"}' } }
      : r,
  ).run();
  expect(result.failure).toBe(true);
  expect(result.nativeDeleteCompleted).toBe(false);
  expect(JSON.stringify(rows)).not.toContain('private detail');
  if (verb === 'POST') expect(sent.some((r) => r.method === 'DELETE')).toBe(false);
});
it('catalog DELETE respects its own denied action after creation', async () => {
  const h = harness('catalog');
  h.input.record = (row) => {
    rows.push(row);
    if ((row as any).ownedReceipt) h.input.base.safety.denyActions.push('SAPManage.flp_delete_catalog');
  };
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, ownedReadbackVerified: true, deleteAcknowledged: false });
  expect(sent.some((r) => r.method === 'DELETE')).toBe(false);
});

it.each(['nonempty', 'truncated', 'unknown'])('catalog PageConfig %s Bags retain owned parts', async (kind) => {
  const h = harness('catalog', false, (_method, path, _state, normal) => {
    if (!path.endsWith('/Bags')) return normal;
    const d =
      kind === 'nonempty'
        ? { results: [{ id: 'foreign' }] }
        : kind === 'truncated'
          ? { results: [], __next: 'https://foreign.invalid' }
          : { unknown: [] };
    return { ...normal, body: JSON.stringify({ d }) };
  });
  const result = await h.run();
  expect(result).toMatchObject({
    failure: true,
    declaredNativeParts: ['Page', 'PageConfig'],
    createAcknowledged: true,
    deleteAcknowledged: false,
  });
  expect(sent.filter((r) => r.method === 'POST')).toHaveLength(1);
  expect(sent.some((r) => r.method === 'DELETE')).toBe(false);
});
for (const stage of ['page', 'catalog'] as const) {
  it.each([403, 409, 429, 503, 202])(`${stage} submitted DELETE %s is uncertain with no replay`, async (status) => {
    const h = harness(stage, false, (method, _path, _state, normal) =>
      method === 'DELETE' ? { ...normal, status } : normal,
    );
    const result = await h.run();
    expect(result).toMatchObject({
      failure: true,
      createAcknowledged: true,
      ownedReadbackVerified: true,
      nativeDeleteCompleted: false,
      sessionCleanup: 'closed',
    });
    expect(result.remaining).toEqual([flpOwner(stage)]);
    expect(sent.filter((r) => r.method === 'DELETE')).toHaveLength(1);
    expect(h.state.exists).toBe(false); // Synthetic native side effect despite the rejected response.
  });
  it(`${stage} lost DELETE response retains uncertainty and closes only its own session`, async () => {
    const h = harness(stage, false, (method, _path, _state, normal) => {
      if (method === 'DELETE') throw new Error('synthetic lost response');
      return normal;
    });
    const result = await h.run();
    expect(result).toMatchObject({
      failure: true,
      ownedReadbackVerified: true,
      nativeDeleteCompleted: false,
      sessionCleanup: 'closed',
    });
    expect(sent.filter((r) => r.method === 'DELETE')).toHaveLength(1);
    expect(result.remaining).toEqual([flpOwner(stage)]);
    expect(h.state.exists).toBe(false);
  });
}

it.each(['metadata', 'cumulative'])('all-response allowance bounds %s bytes before deletion', async (mode) => {
  const h = harness('page', false, (method, path, state, normal) => {
    if (mode === 'metadata' && path.endsWith('/$metadata')) return { ...normal, body: 'x'.repeat(2 * 1024 * 1024 + 1) };
    if (mode === 'cumulative' && state.exists && (method === 'POST' || path === flpOwner('page')))
      return {
        ...normal,
        body: JSON.stringify({ d: { ...nativeEntity('page'), opaqueNativeField: 'x'.repeat(750 * 1024) } }),
      };
    return normal;
  });
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.createAcknowledged).toBe(mode === 'cumulative');
  expect(result.nativeDeleteCompleted).toBe(false);
  expect(sent.filter((r) => r.method === 'POST')).toHaveLength(mode === 'cumulative' ? 1 : 0);
  expect(sent.some((r) => r.method === 'DELETE')).toBe(false);
});
