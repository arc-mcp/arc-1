import { describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtNetworkError } from '../../../src/adt/errors.js';
import { FLP_SERVICE_PATH } from '../../../src/adt/flp.js';
import type { AdtHttpClient, AdtRequestOptions, AdtResponse } from '../../../src/adt/http.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { executePinnedFlpMutation, parsePinnedFlpList, parsePinnedFlpMutation } from '../../../src/adt/pinned-flp.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

const policy = {
  enabled: true,
  target: 'A4H/001',
  allowedPackages: ['$TMP'],
  allowedTransports: [],
  serverAllowedTransports: [],
};
const safety = { ...defaultSafetyConfig(), allowWrites: true, multiTargetWrite: policy };
const context = (signal?: AbortSignal) =>
  pinnedMutationContext(safety, { deadline: Date.now() + 60_000, signal }, { unlockFailed: false });

const CATALOG_KEY = 'X-SAP-UI2-CATALOGPAGE:ZARC1_CAT';
const catalogEntity = {
  id: CATALOG_KEY,
  domainId: 'ZARC1_CAT',
  title: 'Catalog',
  type: 'CATALOG_PAGE',
  scope: 'CUSTOMIZING',
  chipCount: '0002',
  isReadOnly: '',
};
const groupEntity = {
  id: 'ZARC1_GROUP',
  title: 'Group',
  catalogId: '/UI2/FLPD_CATALOG',
  layout: '',
  isCatalogPage: false,
  isReadOnly: false,
  scope: 'CUSTOMIZING',
};
const STATIC_CHIP = 'X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER';
const tileConfiguration = (fields: Record<string, string>) =>
  JSON.stringify({ tileConfiguration: JSON.stringify(fields) });
const tileInput = { id: 'ZTILE', title: 'Tile', semanticObject: 'Sales', semanticAction: 'display' };
const nativeTile = {
  pageId: CATALOG_KEY,
  instanceId: 'INST1',
  chipId: STATIC_CHIP,
  title: 'Tile',
  configuration: tileConfiguration({
    id: 'ZTILE',
    display_title_text: 'Tile',
    semantic_object: 'Sales',
    semantic_action: 'display',
  }),
};
const reference = `X-SAP-UI2-PAGE:${CATALOG_KEY}:INST1`;

const json = (body: unknown): AdtResponse => ({ statusCode: 200, headers: {}, body: JSON.stringify(body) });
const single = (entity: unknown) => json({ d: entity });
const collection = (results: unknown[]) => json({ d: { results } });
const unqualified404 = () =>
  new AdtApiError('Not found', 404, FLP_SERVICE_PATH, '{"error":{"message":{"value":"Resource not found"}}}');

type Step = AdtResponse | Error;
interface Call {
  method: string;
  path: string;
  body?: string;
  options?: AdtRequestOptions;
}

/** Per-path answer queues: the last answer repeats, so a state change is written as ['before','after']. */
function fake(routes: Record<string, Step | Step[]>, writes: { post?: Step; del?: Step } = {}) {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const read = (path: string): AdtResponse => {
    const key = Object.keys(routes).find((route) => path.includes(route));
    if (!key) throw new Error(`Unexpected read ${path}`);
    const count = counts.get(key) ?? 0;
    counts.set(key, count + 1);
    const steps = routes[key];
    const step = Array.isArray(steps) ? steps[Math.min(count, steps.length - 1)] : steps;
    if (step instanceof Error) throw step;
    return step;
  };
  const respond = (step: Step | undefined, fallback: AdtResponse): AdtResponse => {
    if (step instanceof Error) throw step;
    return step ?? fallback;
  };
  const http = {
    get: vi.fn(async (path: string, _headers?: Record<string, string>, options?: AdtRequestOptions) => {
      calls.push({ method: 'GET', path, options });
      return read(path);
    }),
    post: vi.fn(
      async (
        path: string,
        body?: string,
        _type?: string,
        _headers?: Record<string, string>,
        options?: AdtRequestOptions,
      ) => {
        calls.push({ method: 'POST', path, body, options });
        return respond(writes.post, { statusCode: 201, headers: {}, body: '{"d":{}}' });
      },
    ),
    delete: vi.fn(async (path: string, _headers?: Record<string, string>, options?: AdtRequestOptions) => {
      calls.push({ method: 'DELETE', path, options });
      return respond(writes.del, { statusCode: 204, headers: {}, body: '' });
    }),
  };
  return { http: http as unknown as AdtHttpClient, calls, sent: () => calls.filter((call) => call.method !== 'GET') };
}

const CATALOGS = "Catalogs('X-SAP-UI2-CATALOGPAGE%3AZARC1_CAT')";
const GROUP = "Pages('ZARC1_GROUP')?";
const GROUP_TILES = "Pages('ZARC1_GROUP')/PageChipInstances";
const CATALOG_TILES = "Pages('X-SAP-UI2-CATALOGPAGE%3AZARC1_CAT')/PageChipInstances";
const create = { action: 'flp_create_catalog', domainId: 'ZARC1_CAT', title: 'Catalog' };
const createTileArgs = { action: 'flp_create_tile', catalogId: 'ZARC1_CAT', tile: tileInput };
const assign = {
  action: 'flp_add_tile_to_group',
  groupId: 'ZARC1_GROUP',
  catalogId: 'ZARC1_CAT',
  tileInstanceId: 'INST1',
};
const remove = { action: 'flp_delete_catalog', catalogId: CATALOG_KEY };

describe('classic FLP input contract', () => {
  it('accepts native identifiers, including slash-bearing and prefixed catalog ids', () => {
    expect(parsePinnedFlpMutation({ action: 'flp_delete_catalog', catalogId: '/UI2/FLP_ADMIN' })).toMatchObject({
      domainId: '/UI2/FLP_ADMIN',
    });
    expect(parsePinnedFlpMutation(remove)).toMatchObject({ domainId: 'ZARC1_CAT' });
    expect(parsePinnedFlpMutation(assign)).toMatchObject({ groupId: 'ZARC1_GROUP', tileInstanceId: 'INST1' });
  });

  it.each([
    "Z')/Other('",
    'Z CAT',
    'Z%27',
    'a/b',
    '../x',
    'Z?x',
    'Z#x',
    '/UI2/FLPD_CATALOG',
    'X-SAP-UI2-ADCAT:Z',
    'X-SAP-UI2-CATALOGPAGE:X-SAP-UI2-CATALOGPAGE:Z',
    '',
    7,
  ])('refuses content id %j in every identifier field', (id) => {
    expect(() => parsePinnedFlpMutation({ action: 'flp_delete_catalog', catalogId: id })).toThrow();
    expect(() => parsePinnedFlpMutation({ action: 'flp_create_group', groupId: id, title: 'x' })).toThrow();
    expect(() => parsePinnedFlpMutation({ ...assign, groupId: id })).toThrow();
    expect(() => parsePinnedFlpList({ action: 'flp_list_tiles', catalogId: id })).toThrow();
  });

  it.each([
    { title: 'two\nlines' },
    { title: ' ' },
    { title: 'x'.repeat(256) },
    { id: 'bad id' },
    { semanticObject: "Sales'" },
    { semanticAction: 'a b' },
    { icon: 'https://evil.example/x.png' },
    { url: 'javascript:alert(1)' },
    { url: 'data:text/html,x' },
    { url: '//evil.example/x' },
    { url: 'http://evil.example/x' },
    { url: '/a b' },
    { url: '/a\\b' },
    { subtitle: 'x\u0000' },
    { unexpected: 'field' },
  ])('refuses tile content %j shared with other launchpad users', (extra) => {
    expect(() => parsePinnedFlpMutation({ ...createTileArgs, tile: { ...tileInput, ...extra } })).toThrow();
  });

  it.each(['/sap/bc/ui5/app', '#Sales-display', 'https://example.com/app'])('accepts tile target %s', (url) => {
    expect(parsePinnedFlpMutation({ ...createTileArgs, tile: { ...tileInput, url } })).toMatchObject({ tile: { url } });
  });

  it('refuses unknown actions and a non-object tile', () => {
    expect(() => parsePinnedFlpMutation({ action: 'flp_delete_group' })).toThrow('Unsupported');
    expect(() => parsePinnedFlpMutation({ ...createTileArgs, tile: 'x' })).toThrow('object');
    expect(() => parsePinnedFlpList({ action: 'flp_create_group' })).toThrow('Unsupported');
  });
});

describe('executePinnedFlpMutation', () => {
  it.each([create, { action: 'flp_create_group', groupId: 'ZARC1_GROUP', title: 'Group' }])(
    'refuses %j when its native lookup is unavailable',
    async (input) => {
      const { http, calls } = fake({});
      const result = await executePinnedFlpMutation(http, safety, context(), input);
      expect(result).toMatchObject({ ok: false, state: 'unchanged', phase: 'preflight' });
      expect(result.message).toContain('No classic FLP change was submitted');
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('GET');
    },
  );

  it.each([
    [new AdtApiError('Forbidden', 403, FLP_SERVICE_PATH), 'creation-rejected'],
    [new AdtNetworkError('reset'), 'create-unconfirmed'],
    [new AdtApiError('Busy', 500, FLP_SERVICE_PATH), 'create-unconfirmed'],
    [new AdtApiError('Too many', 429, FLP_SERVICE_PATH), 'create-unconfirmed'],
  ] as const)('reports a tile create failure %s once, without retry', async (failure, state) => {
    const { http, sent } = fake(
      { [CATALOGS]: single(catalogEntity), [CATALOG_TILES]: collection([]) },
      { post: failure as unknown as Error },
    );
    const result = await executePinnedFlpMutation(http, safety, context(), createTileArgs);
    expect(result).toMatchObject({ ok: false, state, phase: 'write', retryable: false });
    expect(sent()).toHaveLength(1);
    expect(sent()[0].options).toMatchObject({ noReplay: true, retryTransientErrors: false });
  });

  it('creates a tile only in a managed catalog and verifies stored content through the page association', async () => {
    const { http, calls } = fake(
      { [CATALOGS]: single(catalogEntity), [CATALOG_TILES]: [collection([]), collection([nativeTile])] },
      { post: single(nativeTile) },
    );
    const result = await executePinnedFlpMutation(http, safety, context(), createTileArgs);
    expect(result).toMatchObject({ ok: true, state: 'created', tile: { instanceId: 'INST1', pageId: CATALOG_KEY } });
    expect(calls.every((call) => !call.path.includes('$filter'))).toBe(true);
    expect(JSON.parse(calls.find((call) => call.method === 'POST')?.body as string)).toMatchObject({
      chipId: STATIC_CHIP,
      pageId: CATALOG_KEY,
      scope: 'CUSTOMIZING',
    });
  });

  it.each([
    ['a standard catalog type', { ...catalogEntity, type: '' }],
    ['a cross-client scope', { ...catalogEntity, scope: 'CONFIGURATION' }],
    ['a read-only catalog', { ...catalogEntity, isReadOnly: 'X' }],
    ['an omitted read-only flag', { ...catalogEntity, isReadOnly: undefined }],
    ['an unknown read-only flag', { ...catalogEntity, isReadOnly: null }],
    ['an omitted catalog scope', { ...catalogEntity, scope: undefined }],
    ['a different key', { ...catalogEntity, id: 'X-SAP-UI2-CATALOGPAGE:OTHER' }],
  ] as const)('refuses %s before any tile or delete write', async (_label, entity) => {
    const tile = fake({ [CATALOGS]: single(entity) });
    await expect(executePinnedFlpMutation(tile.http, safety, context(), createTileArgs)).resolves.toMatchObject({
      ok: false,
      state: 'unchanged',
    });
    expect(tile.sent()).toHaveLength(0);
    const deletion = fake({ [CATALOGS]: single(entity) });
    await expect(executePinnedFlpMutation(deletion.http, safety, context(), remove)).resolves.toMatchObject({
      ok: false,
      state: 'unchanged',
    });
    expect(deletion.sent()).toHaveLength(0);
  });

  it('refuses a duplicate logical tile id and a page at the native read limit', async () => {
    const duplicate = fake({ [CATALOGS]: single(catalogEntity), [CATALOG_TILES]: collection([nativeTile]) });
    await expect(executePinnedFlpMutation(duplicate.http, safety, context(), createTileArgs)).resolves.toMatchObject({
      state: 'unchanged',
      message: 'A tile with this logical id already exists in the catalog.',
    });
    expect(duplicate.sent()).toHaveLength(0);
    const full = fake({
      [CATALOGS]: single(catalogEntity),
      [CATALOG_TILES]: collection(
        Array.from({ length: 500 }, (_, index) => ({ ...nativeTile, instanceId: `OLD${index}` })),
      ),
    });
    const capped = await executePinnedFlpMutation(full.http, safety, context(), createTileArgs);
    expect(capped).toMatchObject({ state: 'unchanged' });
    expect(capped.message).toContain('read limit');
    expect(full.sent()).toHaveLength(0);
  });

  it('never reports a tile as created without its stored content', async () => {
    for (const stored of [
      [],
      [{ ...nativeTile, title: 'Other' }],
      [{ ...nativeTile, chipId: 'X-SAP-UI2-CHIP:/UI2/ACTION' }],
    ]) {
      const { http } = fake(
        { [CATALOGS]: single(catalogEntity), [CATALOG_TILES]: [collection([]), collection(stored)] },
        { post: single(nativeTile) },
      );
      await expect(executePinnedFlpMutation(http, safety, context(), createTileArgs)).resolves.toMatchObject({
        ok: false,
        state: 'create-unconfirmed',
      });
    }
    const noInstance = fake(
      { [CATALOGS]: single(catalogEntity), [CATALOG_TILES]: collection([]) },
      { post: single({ ...nativeTile, instanceId: "a'b" }) },
    );
    await expect(executePinnedFlpMutation(noInstance.http, safety, context(), createTileArgs)).resolves.toMatchObject({
      ok: false,
      state: 'create-unconfirmed',
    });
  });

  const assignment = (
    groupTiles: Step | Step[],
    post: Step = single({ pageId: 'ZARC1_GROUP', instanceId: 'G1', chipId: reference }),
  ) =>
    fake(
      {
        [CATALOGS]: single(catalogEntity),
        [GROUP]: single(groupEntity),
        [CATALOG_TILES]: collection([nativeTile]),
        [GROUP_TILES]: groupTiles,
      },
      { post },
    );

  it.each([
    ['source', 'OTHER_PAGE'],
    ['source', undefined],
    ['target', 'OTHER_PAGE'],
    ['target', undefined],
  ])('refuses %s rows owned by %j before submitting or claiming membership', async (side, pageId) => {
    const member = { pageId: 'ZARC1_GROUP', instanceId: 'G1', chipId: reference };
    const { http, sent } = fake({
      [CATALOGS]: single(catalogEntity),
      [GROUP]: single(groupEntity),
      [CATALOG_TILES]: collection([{ ...nativeTile, ...(side === 'source' ? { pageId } : {}) }]),
      [GROUP_TILES]: collection([{ ...member, ...(side === 'target' ? { pageId } : {}) }]),
    });
    const result = await executePinnedFlpMutation(http, safety, context(), assign);
    expect(result).toMatchObject({ ok: false, state: 'unchanged', phase: 'preflight' });
    expect(result.message).toContain('owned by the requested page');
    expect(result.alreadyMember).toBeUndefined();
    expect(sent()).toHaveLength(0);
  });

  it('keeps foreign-page membership readback unconfirmed after an accepted assignment', async () => {
    const { http, sent } = assignment([
      collection([]),
      collection([{ pageId: 'OTHER_PAGE', instanceId: 'G1', chipId: reference }]),
    ]);
    const result = await executePinnedFlpMutation(http, safety, context(), assign);
    expect(result).toMatchObject({ ok: false, state: 'membership-accepted-unconfirmed', phase: 'readback' });
    expect(result.manualVerification).toContain('Launchpad Designer');
    expect(result.message).toContain('owned by the requested page');
    expect(sent()).toHaveLength(1);
  });

  it('verifies membership only from the native group listing', async () => {
    const { http, calls } = assignment([
      collection([]),
      collection([{ pageId: 'ZARC1_GROUP', instanceId: 'G1', chipId: reference }]),
    ]);
    const result = await executePinnedFlpMutation(http, safety, context(), assign);
    expect(result).toMatchObject({ ok: true, state: 'membership-verified', tile: { instanceId: 'G1' } });
    expect(result.manualVerification).toBeUndefined();
    expect(JSON.parse(calls.find((call) => call.method === 'POST')?.body as string)).toEqual({
      chipId: reference,
      pageId: 'ZARC1_GROUP',
    });
  });

  it.each([
    ['an empty listing', [collection([]), collection([])]],
    ['a different chip', [collection([]), collection([{ pageId: 'ZARC1_GROUP', instanceId: 'G1', chipId: 'other' }])]],
    ['an unavailable listing', [collection([]), new AdtApiError('Dump', 500, FLP_SERVICE_PATH)]],
  ] as const)('reports HTTP acceptance as unconfirmed with a manual step for %s', async (_label, steps) => {
    const { http, sent } = assignment(steps as unknown as Step[]);
    const result = await executePinnedFlpMutation(http, safety, context(), assign);
    expect(result).toMatchObject({ ok: false, state: 'membership-accepted-unconfirmed', phase: 'readback' });
    expect(result.manualVerification).toContain('Launchpad Designer');
    expect(sent()).toHaveLength(1);
  });

  it('allows a standard catalog page as an assignment source, since only the group changes', async () => {
    const { http, sent } = fake(
      {
        [CATALOGS]: single({ ...catalogEntity, scope: 'CONFIGURATION', isReadOnly: 'X' }),
        [GROUP]: single(groupEntity),
        [CATALOG_TILES]: collection([nativeTile]),
        [GROUP_TILES]: [collection([]), collection([{ pageId: 'ZARC1_GROUP', instanceId: 'G1', chipId: reference }])],
      },
      { post: single({ pageId: 'ZARC1_GROUP', instanceId: 'G1', chipId: reference }) },
    );
    await expect(executePinnedFlpMutation(http, safety, context(), assign)).resolves.toMatchObject({
      ok: true,
      state: 'membership-verified',
    });
    expect(sent()).toHaveLength(1);
  });

  it('sends nothing when the tile is already a member', async () => {
    const { http, sent } = assignment(collection([{ pageId: 'ZARC1_GROUP', instanceId: 'G1', chipId: reference }]));
    await expect(executePinnedFlpMutation(http, safety, context(), assign)).resolves.toMatchObject({
      ok: true,
      state: 'unchanged',
      alreadyMember: true,
    });
    expect(sent()).toHaveLength(0);
  });

  it.each([
    ['a tile outside the catalog', { [CATALOG_TILES]: collection([]) }],
    [
      'a page outside the group container',
      { [GROUP]: single({ ...groupEntity, catalogId: 'X-SAP-UI2-CATALOGPAGE:Z' }) },
    ],
    ['a catalog page used as a group', { [GROUP]: single({ ...groupEntity, isCatalogPage: true }) }],
    ['a read-only group', { [GROUP]: single({ ...groupEntity, isReadOnly: true }) }],
    ['a missing read-only flag', { [GROUP]: single({ ...groupEntity, isReadOnly: undefined }) }],
    ['a missing catalog-page flag', { [GROUP]: single({ ...groupEntity, isCatalogPage: undefined }) }],
    ['an unknown catalog-page flag', { [GROUP]: single({ ...groupEntity, isCatalogPage: null }) }],
    ['a missing group scope', { [GROUP]: single({ ...groupEntity, scope: undefined }) }],
    ['a cross-client group', { [GROUP]: single({ ...groupEntity, scope: 'CONFIGURATION' }) }],
    ['a missing group', { [GROUP]: unqualified404() }],
    ['a missing catalog', { [CATALOGS]: unqualified404() }],
  ] as const)('refuses %s before assignment', async (_label, override) => {
    const { http, sent } = fake({
      [CATALOGS]: single(catalogEntity),
      [GROUP]: single(groupEntity),
      [CATALOG_TILES]: collection([nativeTile]),
      [GROUP_TILES]: collection([]),
      ...override,
    });
    await expect(executePinnedFlpMutation(http, safety, context(), assign)).resolves.toMatchObject({
      ok: false,
      state: 'unchanged',
    });
    expect(sent()).toHaveLength(0);
  });

  it.each([
    [new AdtApiError('Forbidden', 403, FLP_SERVICE_PATH), 'assignment-rejected'],
    [new AdtNetworkError('reset'), 'assignment-unconfirmed'],
  ] as const)('reports assignment failure %s without retry', async (failure, state) => {
    const { http, sent } = assignment(collection([]), failure as unknown as Error);
    await expect(executePinnedFlpMutation(http, safety, context(), assign)).resolves.toMatchObject({
      ok: false,
      state,
    });
    expect(sent()).toHaveLength(1);
  });

  // Deliberately synthetic and unqualified: no error code is treated as native absence proof.
  it.each([
    '{"error":{"message":{"value":"Service unavailable"}}}',
    '{"error":{"message":{"value":"Resource not found"}}}',
    '<error xmlns="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"><message>Service unavailable</message></error>',
    '<html><body>{"error":"service unavailable"}</body></html>',
    '{"error":',
  ])('keeps keyed 404 uncertain regardless of its error envelope %s', async (body) => {
    const error = new AdtApiError('Not found', 404, FLP_SERVICE_PATH, body);
    const before = fake({ [CATALOGS]: error });
    const refused = await executePinnedFlpMutation(before.http, safety, context(), createTileArgs);
    expect(refused).toMatchObject({ ok: false, state: 'unchanged', phase: 'preflight', statusCode: 404 });
    expect(before.sent()).toHaveLength(0);
    const after = fake({ [CATALOGS]: [single(catalogEntity), error] });
    const uncertain = await executePinnedFlpMutation(after.http, safety, context(), remove);
    expect(uncertain).toMatchObject({ ok: false, state: 'delete-unconfirmed', phase: 'readback', statusCode: 404 });
    expect(uncertain.message).toContain('outcome is not confirmed');
    expect(after.sent()).toHaveLength(1);
  });

  it.each([null, false, [], {}, { id: 'OTHER' }])(
    'does not treat an invalid keyed entity %j as absence',
    async (entity) => {
      const { http, sent } = fake({ [CATALOGS]: [single(catalogEntity), single(entity)] });
      const result = await executePinnedFlpMutation(http, safety, context(), remove);
      expect(result).toMatchObject({ ok: false, state: 'delete-unconfirmed', phase: 'readback' });
      expect(sent()).toHaveLength(1);
    },
  );

  it('deletes once by the native key but cannot prove absence from an unqualified 404', async () => {
    const { http, calls } = fake({ [CATALOGS]: [single(catalogEntity), unqualified404()] });
    const result = await executePinnedFlpMutation(http, safety, context(), {
      action: 'flp_delete_catalog',
      catalogId: 'ZARC1_CAT',
    });
    expect(result).toMatchObject({
      ok: false,
      state: 'delete-unconfirmed',
      phase: 'readback',
      statusCode: 404,
      tilesAtDelete: '0002',
    });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'DELETE', 'GET']);
    expect(calls[1].path).toBe(`${FLP_SERVICE_PATH}/${CATALOGS}`);
    expect(calls[1].options).toMatchObject({ noReplay: true, retryTransientErrors: false });
  });

  it.each([
    ['still readable', [single(catalogEntity), single(catalogEntity)]],
    [
      'an inactive service on read-back',
      [single(catalogEntity), new AdtApiError('Not found', 404, FLP_SERVICE_PATH, '<html/>')],
    ],
    ['a lost read-back', [single(catalogEntity), new AdtNetworkError('reset')]],
  ] as const)('leaves deletion unconfirmed when %s', async (_label, steps) => {
    const { http } = fake({ [CATALOGS]: steps as unknown as Step[] });
    await expect(executePinnedFlpMutation(http, safety, context(), remove)).resolves.toMatchObject({
      ok: false,
      state: 'delete-unconfirmed',
      phase: 'readback',
    });
  });

  it('refuses a missing catalog and classifies native delete refusal and uncertainty', async () => {
    const missing = fake({ [CATALOGS]: unqualified404() });
    await expect(executePinnedFlpMutation(missing.http, safety, context(), remove)).resolves.toMatchObject({
      state: 'unchanged',
    });
    expect(missing.sent()).toHaveLength(0);
    const refused = fake(
      { [CATALOGS]: single(catalogEntity) },
      { del: new AdtApiError('Forbidden', 403, FLP_SERVICE_PATH) },
    );
    await expect(executePinnedFlpMutation(refused.http, safety, context(), remove)).resolves.toMatchObject({
      state: 'delete-rejected',
    });
    const uncertain = fake({ [CATALOGS]: single(catalogEntity) }, { del: new AdtNetworkError('reset') });
    await expect(executePinnedFlpMutation(uncertain.http, safety, context(), remove)).resolves.toMatchObject({
      state: 'delete-unconfirmed',
    });
    expect(uncertain.sent()).toHaveLength(1);
  });

  it('stops before the write when cancelled during preflight', async () => {
    const controller = new AbortController();
    const http = fake({ [CATALOGS]: single(catalogEntity), [CATALOG_TILES]: collection([]) });
    const get = http.http.get;
    (http.http as unknown as { get: unknown }).get = vi.fn(async (...args: Parameters<AdtHttpClient['get']>) => {
      controller.abort();
      return get(...args);
    });
    const result = await executePinnedFlpMutation(http.http, safety, context(controller.signal), createTileArgs);
    expect(result).toMatchObject({ ok: false, state: 'unchanged' });
    expect(http.sent()).toHaveLength(0);
  });

  it('refuses invalid input, a read-only ceiling and a foreign context before SAP', async () => {
    const { http, calls } = fake({});
    await expect(
      executePinnedFlpMutation(http, safety, context(), { action: 'flp_delete_catalog', catalogId: "Z')" }),
    ).resolves.toMatchObject({ state: 'unchanged', phase: 'validation' });
    await expect(
      executePinnedFlpMutation(http, { ...safety, allowWrites: false }, context(), create),
    ).resolves.toMatchObject({ state: 'unchanged' });
    const other = { ...safety, multiTargetWrite: { ...policy, target: 'B4H/001' } };
    const foreign = pinnedMutationContext(other, { deadline: Date.now() + 1000 }, { unlockFailed: false });
    await expect(executePinnedFlpMutation(http, safety, foreign, create)).resolves.toMatchObject({
      state: 'unchanged',
    });
    expect(calls).toHaveLength(0);
  });
});
