import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pinnedPublicAuth } from '../../helpers/pinned-public-auth.js';
import { config, context, createWorld, fixture, install, nativeClient, type World } from './pinned-ddic-harness.js';
import { mockFetch } from './setup-undici-mock.js';

const { handlePrivatePinnedDocumentWrite: write } = await import(
  '../../../src/handlers/write/pinned-document-write.js'
);
const { handlePrivatePinnedDocumentActivation: activate } = await import(
  '../../../src/handlers/write/pinned-activation.js'
);
const { parsePinnedDocument, pinnedDocumentSelection } = await import('../../../src/adt/pinned-document-owner.js');
const { decodeKtdText } = await import('../../../src/adt/ddic-xml.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
let world: World;
const name = 'ZTEST';
const enho = pinnedDocumentSelection('ENHO', name),
  ktd = pinnedDocumentSelection('SKTD', name);
const opaque = '<x:opaque xmlns:x="urn:test" x:value="001">  keep  </x:opaque>';
const nodes = `<sktd:element sktd:canHaveDocumentation="true" sktd:longTextObligation="optional"><sktd:id>ZTEST</sktd:id><sktd:text>${Buffer.from('root one').toString('base64')}</sktd:text><sktd:shortText sktd:text="Um9vdA==" sktd:obligation="optional"/></sktd:element><sktd:element sktd:canHaveDocumentation="true" sktd:longTextObligation="optional"><sktd:id>/sap/bc/adt/ddic/ddl/sources/ztest#type=DDLS/DF;name=ZTEST.FIELD</sktd:id><sktd:text>${Buffer.from('field one').toString('base64')}</sktd:text><sktd:shortText sktd:text="RmllbGQ=" sktd:obligation="optional"/></sktd:element>`;
function ktdXml() {
  return `<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZTEST" adtcore:type="SKTD/TYP" adtcore:version="inactive" adtcore:masterLanguage="EN"><adtcore:packageRef adtcore:name="ZTEAM" adtcore:type="DEVC/K"/><sktd:refObject adtcore:name="ZTEST" adtcore:type="DDLS/DF" adtcore:uri="/sap/bc/adt/ddic/ddl/sources/ztest"/>${nodes}${opaque}</sktd:docu>`;
}
function seed(type: 'ENHO' | 'SKTD') {
  const selected = type === 'ENHO' ? enho : ktd;
  const xml =
    type === 'SKTD'
      ? ktdXml()
      : fixture('xml/enhancement-implementation.xml')
          .replaceAll('SFW_BCF_TCD', 'ZTEST')
          .replaceAll('SFWTOOLS', 'ZTEAM')
          .replace('adtcore:version="active"', 'adtcore:version="inactive"')
          .replace('</enho:badiImplementation>', `${opaque}</enho:badiImplementation>`);
  world.objects.set(selected.objectUrl, { metadata: xml, nativeType: selected.native });
  let spot = fixture('xml/enhancement-spot.xml')
    .replaceAll('ES_MY_SPOT', 'BCF_REMOTE_TCD')
    .replaceAll('BADI_MY_PLAIN', 'BCF_TCD_REMOTE_BADI');
  spot = spot.replace('<enhs:contentSpecific>', '<enhs:contentCommon enhs:internal="false"/><enhs:contentSpecific>');
  world.objects.set('/sap/bc/adt/enhancements/enhsxsb/bcf_remote_tcd', { metadata: spot, nativeType: 'ENHS/XSB' });
  return selected;
}
const parsed = (result: any) => JSON.parse(result.content[0].text);
async function run(type: 'ENHO' | 'SKTD', changes: Record<string, unknown> = {}, settings = config) {
  const selected = type === 'ENHO' ? enho : ktd;
  const body = world.objects.get(selected.objectUrl)!.metadata;
  const input = {
    action: 'update',
    type,
    name,
    expectedMetadataHash: parsePinnedDocument(body, selected).hash,
    ...(type === 'ENHO' ? { description: 'Changed' } : { source: '## ZTEST\n\nroot two' }),
    ...changes,
  };
  const client = nativeClient(undefined, settings);
  return write(client, input, settings, context(client));
}
beforeEach(() => {
  vi.restoreAllMocks();
  world = createWorld();
  install(world);
});
afterEach(() => expect(world.unexpected).toEqual([]));
it.each(['ENHO', 'SKTD'] as const)('%s saves under its own lock and preserves opaque state', async (type) => {
  const selected = seed(type);
  const result = await run(type);
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(parsed(result)).toMatchObject({ state: 'saved-inactive', nativeVersion: 'inactive', retryable: false });
  const puts = world.calls.filter((c) => c.method === 'PUT');
  expect(puts).toHaveLength(1);
  expect(puts[0]!.locked).toBe(true);
  expect(world.objects.get(selected.objectUrl)!.metadata).toContain('x:value="001"');
  expect(world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
  expect(world.calls.some((c) => c.path.includes('/source/main') || c.path.includes('/activation'))).toBe(false);
});
it('SKTD successive updates accumulate pending nodes and short texts with shared routing', async () => {
  seed('SKTD');
  expect((await run('SKTD')).isError).toBeUndefined();
  expect(
    (
      await run('SKTD', {
        source: '## ZTEST.FIELD\n\nfield two',
        shortTexts: [{ node: 'ZTEST.FIELD', text: 'New field' }],
      })
    ).isError,
  ).toBeUndefined();
  const xml = world.objects.get(ktd.objectUrl)!.metadata;
  expect(decodeKtdText(xml)).toContain('root two');
  expect(decodeKtdText(xml)).toContain('field two');
  expect(xml).toContain(Buffer.from('New field').toString('base64'));
  expect(
    world.calls
      .filter((c) => c.method === 'GET' && c.path.startsWith(ktd.objectUrl))
      .every((c) => !c.path.includes('version=')),
  ).toBe(true);
});
it('ENHO replacement entries retain unknown fields and opaque attributes on survivors', async () => {
  seed('ENHO');
  const result = await run('ENHO', {
    source: JSON.stringify({
      badiImplementations: [
        { name: 'SFW_TCD', badiDefinition: 'BCF_TCD_REMOTE_BADI', implementingClass: 'ZCL_NEW', active: false },
      ],
    }),
  });
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  const xml = world.objects.get(enho.objectUrl)!.metadata;
  expect(xml).toContain('x:value="001"');
  expect(xml).toContain('enho:runtimeBehaviorShorttext=');
  expect(xml).toContain('ZCL_NEW');
  expect(xml).not.toContain('SFW_TCD_B');
});
it.each(['ENHO', 'SKTD'] as const)('%s no-op does not PUT', async (type) => {
  seed(type);
  const changes = type === 'ENHO' ? { description: 'TCD Lookup, Assignment...' } : { source: '## ZTEST\n\nroot one' };
  expect(parsed(await run(type, changes)).state).toBe('unchanged');
  expect(world.calls.some((c) => c.method === 'PUT')).toBe(false);
});
it.each(['ENHO', 'SKTD'] as const)('%s rejects stale metadata before locking', async (type) => {
  seed(type);
  expect((await run(type, { expectedMetadataHash: '0'.repeat(64) })).isError).toBe(true);
  expect(world.calls.some((c) => c.method === 'POST' || c.method === 'PUT')).toBe(false);
});
it.each(['package-drift', 'identity-drift', 'save-unknown', 'save-rejected', 'readback', 'unlock'] as const)(
  'reports %s honestly and never replays a save',
  async (fault) => {
    seed('SKTD');
    world.faults.add(fault);
    const result = await run('SKTD');
    expect(result.isError).toBe(true);
    expect(world.calls.filter((c) => c.method === 'PUT').length).toBeLessThanOrEqual(1);
    expect(world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('native-lock');
  },
);
it('rechecks a full metadata change that appears only under the lock', async () => {
  seed('SKTD');
  const original = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
    if (world.locked)
      world.objects.get(ktd.objectUrl)!.metadata = world.objects
        .get(ktd.objectUrl)!
        .metadata.replace('x:value="001"', 'x:value="002"');
    return original(...args);
  });
  expect((await run('SKTD')).isError).toBe(true);
  expect(world.calls.some((c) => c.method === 'PUT')).toBe(false);
});
it.each(
  (['SKTD', 'ENHO'] as const).flatMap((type) =>
    (['owned', 'foreign', 'opaque', 'active'] as const).map((fault) => [type, fault] as const),
  ),
)('preserves %s save/readback guarantees with a relative %s state link', async (type, fault) => {
  const selected = seed(type);
  const close = type === 'SKTD' ? '</sktd:docu>' : '</enho:objectData>';
  const original = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
    const result = await original(...args);
    if (world.calls.at(-1)?.method === 'PUT') {
      const stored = world.objects.get(selected.objectUrl)!;
      stored.metadata = stored.metadata.replace(
        close,
        `<a:link xmlns:a="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="./${fault === 'foreign' ? 'other' : 'ztest'}?version=active"/>${close}`,
      );
      if (fault === 'opaque') stored.metadata = stored.metadata.replace('x:value="001"', 'x:value="002"');
      if (fault === 'active')
        stored.metadata = stored.metadata.replace('adtcore:version="inactive"', 'adtcore:version="active"');
    }
    return result;
  });
  const result = await run(type);
  if (fault === 'owned') {
    expect(result.isError).toBeUndefined();
    expect(parsed(result)).toMatchObject({
      state: 'saved-inactive',
      nativeVersion: 'inactive',
      metadataHash: parsePinnedDocument(world.objects.get(selected.objectUrl)!.metadata, selected).hash,
    });
  } else {
    expect(result.isError).toBe(true);
    expect(parsed(result).state).toBe('document-save-unconfirmed');
  }
  expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  expect(world.calls.filter((call) => call.path.includes('_action=UNLOCK'))).toHaveLength(1);
  expect(world.calls.some((call) => call.path.includes('version=active'))).toBe(false);
});
it.each([
  { source: '## ZTEST.UNKNOWN\n\nwrong' },
  { shortTexts: [{ node: 'ZTEST', text: 'x'.repeat(61) }] },
  {
    shortTexts: [
      { node: 'ZTEST', text: 'a' },
      { node: 'ZTEST', text: 'b' },
    ],
  },
])('SKTD refuses invalid routing/short texts without PUT: %j', async (changes) => {
  seed('SKTD');
  expect((await run('SKTD', changes)).isError).toBe(true);
  expect(world.calls.some((c) => c.method === 'PUT')).toBe(false);
});
it('SKTD dry run uses the same native transformation without acquiring a lock', async () => {
  seed('SKTD');
  expect(parsed(await run('SKTD', { dryRun: true }))).toMatchObject({ state: 'preview' });
  expect(world.calls.every((c) => c.method === 'GET')).toBe(false); // recording is a bounded read POST
  expect(world.calls.some((c) => c.path.includes('_action=LOCK') || c.method === 'PUT')).toBe(false);
});
it.each(['ENHO', 'SKTD'] as const)('%s exact deletion and activation use the common cores', async (type) => {
  const selected = seed(type);
  const client = nativeClient();
  expect((await activate(client, { type, name })).isError).toBeUndefined();
  expect(world.objects.get(selected.objectUrl)!.metadata).toContain('adtcore:version="active"');
  const result = await write(client, { type, name, action: 'delete' }, config, context(client));
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(parsed(result).state).toBe('deleted');
  expect(world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
});
it.each(['ENHO', 'SKTD'] as const)('%s refuses unverified public invocation and expanded activation', async (type) => {
  seed(type);
  const client = nativeClient();
  expect((await handleToolCall(client, config, 'SAPActivate', { type, name })).isError).toBe(true);
  expect(world.calls).toHaveLength(0);
  expect((await handleToolCall(client, config, 'SAPWrite', { type, name, action: 'delete' })).isError).toBe(true);
  expect(world.calls).toHaveLength(0);
  world.preauditRefs = [{ uri: '/sap/bc/adt/oo/classes/foreign', name: 'FOREIGN' }];
  expect((await activate(client, { type, name })).isError).toBe(true);
  expect(
    world.calls.filter((c) => c.path.includes('/activation') && !c.path.includes('preauditRequested=true')),
  ).toHaveLength(0);
});
it.each([
  { allowWrites: false },
  { ppEnabled: false },
  { ppStrict: false },
  { targetId: 'OTHER/001' },
  { multiTargetEndpoints: false },
  { denyActions: ['SAPWrite.update'] },
  { allowedPackages: ['ZDENIED'] },
])('private entry refuses policy %j', async (extra) => {
  seed('SKTD');
  expect((await run('SKTD', {}, { ...config, ...extra })).isError).toBe(true);
  expect(world.calls.some((c) => c.method === 'PUT' || c.path.includes('_action=LOCK'))).toBe(false);
});
it.each(['delete-unknown', 'delete-rejected'] as const)('does not replay %s', async (fault) => {
  seed('ENHO');
  world.faults.add(fault);
  const client = nativeClient();
  const result = await write(client, { type: 'ENHO', name, action: 'delete' }, config, context(client));
  expect(result.isError).toBe(true);
  expect(world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
});

async function create(type: 'ENHO' | 'SKTD', changes: Record<string, unknown> = {}) {
  const selected = seed(type);
  world.objects.get(selected.objectUrl)!.metadata = '';
  if (type === 'SKTD') {
    world.objects.set('/sap/bc/adt/ddic/ddl/sources/ztest', {
      nativeType: 'DDLS/DF',
      metadata:
        '<d:ddlSource xmlns:d="http://www.sap.com/adt/ddic/ddlsources" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZTEST" adtcore:type="DDLS/DF" adtcore:version="active"/>',
    });
    world.createdMetadata = (body) =>
      body
        .replace('<sktd:docu ', '<sktd:docu adtcore:version="inactive" ')
        .replace('<adtcore:packageRef ', '<adtcore:packageRef adtcore:type="DEVC/K" ')
        .replace('</sktd:docu>', `${nodes}${opaque}</sktd:docu>`);
  }
  const client = nativeClient();
  return write(
    client,
    {
      type,
      name,
      action: 'create',
      package: 'ZTEAM',
      ...(type === 'SKTD'
        ? { refObjectType: 'DDLS/DF', source: '## ZTEST\n\ncreated text' }
        : {
            source: JSON.stringify({
              enhancementSpot: 'BCF_REMOTE_TCD',
              badiImplementations: [
                { name: 'ZIMPL', badiDefinition: 'BCF_TCD_REMOTE_BADI', implementingClass: 'ZCL_TEST' },
              ],
            }),
          }),
      ...changes,
    },
    config,
    context(client),
  );
}
it.each(['ENHO', 'SKTD'] as const)('%s create verifies shell then saves exactly once', async (type) => {
  const result = await create(type);
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(parsed(result)).toMatchObject({ state: 'created', nativeVersion: 'inactive' });
  const selected = type === 'ENHO' ? enho : ktd;
  const posts = world.calls.filter(
    (call) => call.method === 'POST' && call.path.startsWith(selected.collection) && !call.path.includes('_action='),
  );
  expect(posts).toHaveLength(1);
  expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  if (type === 'ENHO') expect(posts[0]!.body).not.toContain('<enho:badiImplementation ');
});
it.each(['create-unknown', 'create-rejected'] as const)('keeps %s terminal and never retries create', async (fault) => {
  world.faults.add(fault);
  const result = await create('ENHO');
  expect(result.isError).toBe(true);
  expect(world.calls.filter((call) => call.method === 'POST' && call.path.startsWith(enho.collection))).toHaveLength(1);
  expect(world.calls.some((call) => call.method === 'PUT')).toBe(false);
});
it('retains the created shell when documentation follow-up fails', async () => {
  world.faults.add('save-unknown');
  const result = await create('SKTD');
  expect(result.isError).toBe(true);
  expect(parsed(result).state).toContain('created');
  expect(world.objects.get(ktd.objectUrl)!.metadata).toContain('<sktd:docu');
  expect(world.calls.some((call) => call.method === 'DELETE')).toBe(false);
});
it.each([
  { refObjectType: 'BDEF/BAC' },
  { refObjectType: 'CLAS/OC' },
  { refObjectName: 'OTHER' },
  { expectedMetadataHash: '0'.repeat(64) },
  { source: '' },
  { shortTexts: [{ node: 'x', text: 'x', typo: true }] },
])('refuses unsupported create inputs before native access: %j', async (changes) => {
  const result = await create('SKTD', changes);
  expect(result.isError).toBe(true);
  expect(world.calls).toHaveLength(0);
});
it.each(['technology', 'unknown-version', 'namespace', 'parent', 'opaque-loss'] as const)(
  'fails closed on %s native evidence',
  async (fault) => {
    seed(fault === 'parent' ? 'SKTD' : 'ENHO');
    const type = fault === 'parent' ? 'SKTD' : 'ENHO';
    const selected = type === 'SKTD' ? ktd : enho;
    const value = world.objects.get(selected.objectUrl)!;
    const hash = parsePinnedDocument(value.metadata, selected).hash;
    if (fault === 'technology') value.metadata = value.metadata.replace('BADI_IMPL', 'ENH_HOOK');
    if (fault === 'unknown-version') value.metadata = value.metadata.replace('version="inactive"', 'version="mystery"');
    if (fault === 'namespace') value.metadata = value.metadata.replace('http://www.sap.com/adt/core', 'urn:foreign');
    if (fault === 'parent') value.metadata = value.metadata.replace('adtcore:type="DDLS/DF"', 'adtcore:type="CLAS/OC"');
    if (fault === 'opaque-loss') value.metadata = value.metadata.replace(opaque, '');
    const client = nativeClient();
    const result = await write(
      client,
      {
        type,
        name,
        action: 'update',
        ...(type === 'SKTD' ? { source: '## ZTEST\n\nchanged' } : { description: 'changed' }),
        expectedMetadataHash: hash,
      },
      config,
      context(client),
    );
    expect(result.isError).toBe(true);
    expect(world.calls.some((call) => call.method === 'PUT')).toBe(false);
  },
);
it('KTD alias resolves only to the same native documentation owner', async () => {
  seed('SKTD');
  const result = await run('SKTD', { type: 'KTD' });
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(parsed(result).type).toBe('SKTD');
});
it('destination package policy independently refuses an otherwise globally allowed owner', async () => {
  seed('SKTD');
  const settings = { ...config, multiTargetWrite: { ...config.multiTargetWrite, allowedPackages: ['ZDENIED'] } };
  expect((await run('SKTD', {}, settings)).isError).toBe(true);
  expect(world.calls.some((call) => call.method === 'PUT')).toBe(false);
});
it('transported saves honor both request policies and preserve the parent/task recording', async () => {
  seed('SKTD');
  world.transported = true;
  expect((await run('SKTD', { transport: 'A4HK900001' })).isError).toBeUndefined();
  expect(world.calls.find((call) => call.method === 'PUT')!.path).toContain('corrNr=A4HK900001');
  const settings = { ...config, multiTargetWrite: { ...config.multiTargetWrite, allowedTransports: ['OTHER'] } };
  world.calls.length = 0;
  expect((await run('SKTD', { transport: 'A4HK900001' }, settings)).isError).toBe(true);
  expect(world.calls.some((call) => call.method === 'PUT')).toBe(false);
});
it('cancellation during lock still cleans up through the owning session', async () => {
  seed('SKTD');
  world.abort = new AbortController();
  world.faults.add('cancel');
  const client = nativeClient();
  const { pinnedMutationContext } = await import('../../../src/adt/mutation-context.js');
  const policy = pinnedMutationContext(
    client.safety,
    { deadline: Date.now() + 10000, signal: world.abort.signal },
    { unlockFailed: false },
  );
  const result = await write(
    client,
    {
      type: 'SKTD',
      name,
      action: 'update',
      source: '## ZTEST\n\nnew',
      expectedMetadataHash: parsePinnedDocument(world.objects.get(ktd.objectUrl)!.metadata, ktd).hash,
    },
    config,
    policy,
  );
  expect(result.isError).toBe(true);
  expect(world.calls.some((call) => call.method === 'PUT')).toBe(false);
  expect(world.calls.filter((call) => call.path.includes('_action=UNLOCK'))).toHaveLength(1);
});
it('carries one outer attempt allowance through every nested native request', async () => {
  seed('SKTD');
  const client = nativeClient();
  const { pinnedMutationContext } = await import('../../../src/adt/mutation-context.js');
  const { RequestAttemptBudget } = await import('../../../src/adt/request-attempt-budget.js');
  const attempts = new RequestAttemptBudget(64);
  const get = vi.spyOn(Object.getPrototypeOf(client.http) as typeof client.http, 'get'),
    post = vi.spyOn(Object.getPrototypeOf(client.http) as typeof client.http, 'post'),
    put = vi.spyOn(Object.getPrototypeOf(client.http) as typeof client.http, 'put');
  const policy = pinnedMutationContext(
    client.safety,
    { deadline: Date.now() + 10000, attemptBudget: attempts },
    { unlockFailed: false },
  );
  const result = await write(
    client,
    {
      type: 'SKTD',
      name,
      action: 'update',
      source: '## ZTEST\n\nnew',
      expectedMetadataHash: parsePinnedDocument(world.objects.get(ktd.objectUrl)!.metadata, ktd).hash,
    },
    config,
    policy,
  );
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(get.mock.calls.length).toBeGreaterThan(1);
  for (const call of get.mock.calls.filter((call) => call[0] !== '/sap/bc/adt/core/http/sessions'))
    expect(call[2]?.attemptBudget).toBe(attempts);
  const close = get.mock.calls.find((call) => call[0] === '/sap/bc/adt/core/http/sessions');
  expect(close?.[2]?.attemptBudget).toBeUndefined();
  expect(close?.[2]?.responseBudget?.limitBytes).toBe(64 * 1024);
  expect(close?.[2]?.noReplay).toBe(true);
  for (const call of post.mock.calls.filter((call) => call[0].includes('transportchecks')))
    expect(call[4]?.attemptBudget).toBe(attempts);
  expect(put.mock.calls).toHaveLength(1);
  expect(put.mock.calls[0]![4]?.attemptBudget).toBe(attempts);
});
it('enforces a cumulative outer response allowance before mutations', async () => {
  seed('SKTD');
  const client = nativeClient();
  const { pinnedMutationContext } = await import('../../../src/adt/mutation-context.js');
  const { DataResponseBudget } = await import('../../../src/adt/data-result-context.js');
  const budget = new DataResponseBudget(64, 'test-native-document', true);
  const policy = pinnedMutationContext(
    client.safety,
    { deadline: Date.now() + 10000, responseBudget: budget },
    { unlockFailed: false },
  );
  const result = await write(
    client,
    {
      type: 'SKTD',
      name,
      action: 'update',
      source: '## ZTEST\n\nnew',
      expectedMetadataHash: parsePinnedDocument(world.objects.get(ktd.objectUrl)!.metadata, ktd).hash,
    },
    config,
    policy,
  );
  expect(result.isError).toBe(true);
  expect(world.calls.some((call) => call.method === 'POST' || call.method === 'PUT')).toBe(false);
});
it.each(['true', 'missing', 'namespace', 'extra-definition'] as const)(
  'ENHO create refuses %s spot evidence before POST',
  async (fault) => {
    const original = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
      if (String(args[0]).includes('/enhsxsb/')) {
        const spot = world.objects.get('/sap/bc/adt/enhancements/enhsxsb/bcf_remote_tcd')!;
        if (fault === 'true') spot.metadata = spot.metadata.replace('internal="false"', 'internal="true"');
        if (fault === 'missing') spot.metadata = spot.metadata.replace('enhs:internal="false"', '');
        if (fault === 'namespace')
          spot.metadata = spot.metadata.replace('http://www.sap.com/adt/enhancements/enhs', 'urn:foreign');
        if (fault === 'extra-definition')
          spot.metadata = spot.metadata.replace(
            '</enhs:objectData>',
            '<x:opaque xmlns:x="urn:test"><enhs:badiDefinition enhs:name="BAD"/></x:opaque></enhs:objectData>',
          );
      }
      return original(...args);
    });
    const result = await create('ENHO');
    expect(result.isError).toBe(true);
    expect(world.calls.some((call) => call.method === 'POST' && call.path.split('?')[0] === enho.collection)).toBe(
      false,
    );
  },
);
it('ENHO unknown spot/read failure is terminal even without filter edits', async () => {
  seed('ENHO');
  world.objects.delete('/sap/bc/adt/enhancements/enhsxsb/bcf_remote_tcd');
  expect((await run('ENHO')).isError).toBe(true);
  expect(world.calls.some((call) => call.method === 'PUT')).toBe(false);
});
it.each(['ENHO', 'SKTD'] as const)('%s cannot claim activation when native state stays inactive', async (type) => {
  seed(type);
  world.faults.add('still-inactive');
  const result = await activate(nativeClient(), { type, name });
  expect(result.isError).toBe(true);
  expect(parsed(result).state).not.toBe('activated');
  expect(
    world.calls.filter((call) => call.path.includes('/activation') && !call.path.includes('preauditRequested=true')),
  ).toHaveLength(1);
});
it('rejects structural and cross-target context lookalikes before native access', async () => {
  seed('SKTD');
  const client = nativeClient();
  const grant = context(client);
  const input = { type: 'SKTD', name, action: 'delete' };
  expect((await write(client, input, config, { ...grant })).isError).toBe(true);
  const other = nativeClient(undefined, { multiTargetWrite: { ...config.multiTargetWrite } });
  expect((await write(other, input, config, grant)).isError).toBe(true);
  expect(world.calls).toHaveLength(0);
});

it('does not confirm a KTD create when an explicit reference description was ignored', async () => {
  const original = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
    const response = await original(...args);
    if (new URL(String(args[0])).pathname === ktd.collection && args[1]?.method === 'POST') {
      const saved = world.objects.get(ktd.objectUrl)!;
      saved.metadata = saved.metadata.replace('Required reference description', 'ignored');
    }
    return response;
  });
  const result = await create('SKTD', { refObjectDescription: 'Required reference description' });
  expect(result.isError).toBe(true);
  expect(parsed(result).state).toBe('created-document-unconfirmed');
  expect(
    world.calls.filter((call) => call.method === 'POST' && call.path.split('?')[0] === ktd.collection),
  ).toHaveLength(1);
  expect(world.calls.some((call) => call.method === 'PUT' || call.method === 'DELETE')).toBe(false);
});
it('a generic HTTP404 is not authoritative create absence', async () => {
  const original = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (...args: Parameters<typeof original>) =>
    new URL(String(args[0])).pathname === ktd.objectUrl && (!args[1]?.method || args[1].method === 'GET')
      ? new Response('<html>not found</html>', { status: 404, headers: { 'content-type': 'text/html' } })
      : original(...args),
  );
  const result = await create('SKTD');
  expect(result.isError).toBe(true);
  expect(world.calls.some((call) => call.method === 'POST' && call.path.split('?')[0] === ktd.collection)).toBe(false);
});
it('native inactive alternatives cannot disappear through URI case normalization', async () => {
  seed('SKTD');
  const original = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
    const response = await original(...args);
    const url = new URL(String(args[0]));
    if (url.pathname === '/sap/bc/adt/activation' && url.searchParams.get('preauditRequested') !== 'true') {
      const saved = world.objects.get(ktd.objectUrl)!;
      saved.metadata = saved.metadata.replace(
        '</sktd:docu>',
        `<a:link xmlns:a="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${ktd.objectUrl}?version=INACTIVE"/></sktd:docu>`,
      );
    }
    return response;
  });
  const result = await activate(nativeClient(), { type: 'SKTD', name });
  expect(result.isError).toBe(true);
  expect(parsed(result).state).not.toBe('activated');
});
it.each(['pre-send refusal', 'attempt exhaustion'] as const)(
  'a %s during readback cannot erase a preceding successful PUT',
  async (failure) => {
    seed('SKTD');
    const client = nativeClient();
    const prototype = Object.getPrototypeOf(client.http) as typeof client.http;
    const get = prototype.get;
    const { AdtRequestNotSentError } = await import('../../../src/adt/errors.js');
    const { AdtRequestBudgetError } = await import('../../../src/adt/request-attempt-budget.js');
    vi.spyOn(prototype, 'get').mockImplementation(function (this: typeof client.http, ...args: Parameters<typeof get>) {
      if (args[0] === ktd.objectUrl && world.calls.some((call) => call.method === 'PUT'))
        throw failure === 'pre-send refusal'
          ? new AdtRequestNotSentError('GET', 'Native readback was refused before dispatch.')
          : new AdtRequestBudgetError(64);
      return get.apply(this, args);
    });
    const result = await run('SKTD');
    expect(result.isError).toBe(true);
    expect(parsed(result).state).toBe('document-save-unconfirmed');
    expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(world.calls.filter((call) => call.path.includes('_action=UNLOCK'))).toHaveLength(1);
  },
);

it.each(['response-width', 'response-status', 'attempt-width'] as const)(
  'rejects an outer %s allowance that weakens the private ceiling',
  async (fault) => {
    seed('SKTD');
    const client = nativeClient();
    const { pinnedMutationContext } = await import('../../../src/adt/mutation-context.js');
    const { DataResponseBudget } = await import('../../../src/adt/data-result-context.js');
    const { RequestAttemptBudget } = await import('../../../src/adt/request-attempt-budget.js');
    const grant = pinnedMutationContext(
      client.safety,
      {
        deadline: Date.now() + 10000,
        responseBudget: new DataResponseBudget(
          fault === 'response-width' ? 8 * 1024 * 1024 + 1 : 8 * 1024 * 1024,
          'test',
          fault !== 'response-status',
        ),
        attemptBudget: new RequestAttemptBudget(fault === 'attempt-width' ? 65 : 64),
      },
      { unlockFailed: false },
    );
    const result = await write(client, { type: 'SKTD', name, action: 'delete' }, config, grant);
    expect(result.isError).toBe(true);
    expect(world.calls).toHaveLength(0);
  },
);

it.each(['urn:foreign', 'http://www.sap.com/wbobj/texts/sktd'])(
  'refuses KTD write slots inside an opaque extension (%s)',
  async (namespace) => {
    seed('SKTD');
    const object = world.objects.get(ktd.objectUrl)!;
    const nested = `<x:extension xmlns:x="urn:extension" xmlns:sktd="${namespace}"><sktd:element sktd:canHaveDocumentation="true"><sktd:id>ZTEST.SHADOW</sktd:id><sktd:text>${Buffer.from('opaque original').toString('base64')}</sktd:text></sktd:element></x:extension>`;
    object.metadata = object.metadata.replace('</sktd:docu>', `${nested}</sktd:docu>`);
    const before = object.metadata;
    const result = await run('SKTD', { source: '## ZTEST.SHADOW\n\nchanged' });
    expect(result.isError).toBe(true);
    expect(world.calls.filter((call) => call.method === 'PUT')).toEqual([]);
    expect(object.metadata).toBe(before);
  },
);
it.each(['text', 'shortText'])('refuses a foreign %s slot before native KTD save', async (slot) => {
  seed('SKTD');
  const object = world.objects.get(ktd.objectUrl)!;
  object.metadata = object.metadata.replace(`<sktd:${slot}`, `<sktd:${slot} xmlns:sktd="urn:foreign"`);
  const before = object.metadata;
  const result = await run(
    'SKTD',
    slot === 'text' ? {} : { source: undefined, shortTexts: [{ node: 'ZTEST', text: 'changed' }] },
  );
  expect(result.isError).toBe(true);
  expect(world.calls.filter((call) => call.method === 'PUT')).toEqual([]);
  expect(object.metadata).toBe(before);
});
it('applies the same structural qualification to KTD dry-run without locks or writes', async () => {
  seed('SKTD');
  const object = world.objects.get(ktd.objectUrl)!;
  object.metadata = object.metadata.replace('<sktd:shortText', '<sktd:shortText xmlns:sktd="urn:foreign"');
  expect(
    (await run('SKTD', { source: undefined, dryRun: true, shortTexts: [{ node: 'ZTEST', text: 'changed' }] })).isError,
  ).toBe(true);
  expect(
    world.calls.some(
      (call) =>
        call.method === 'PUT' ||
        call.method === 'DELETE' ||
        call.path.includes('_action=LOCK') ||
        call.path.includes('/activation'),
    ),
  ).toBe(false);
});
it.each(['ENHO', 'SKTD', 'KTD'])('%s activation reports exact document scope and verification phase', async (type) => {
  seed(type === 'ENHO' ? 'ENHO' : 'SKTD');
  const result = await activate(nativeClient(), { type, name });
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(parsed(result).scope).toBe('selected-document-owner-only');
  seed(type === 'ENHO' ? 'ENHO' : 'SKTD');
  world.faults.add('still-inactive');
  const failure = await activate(nativeClient(), { type, name });
  expect(failure.isError).toBe(true);
  expect(parsed(failure).phase).toBe('document-active-verification');
  expect(parsed(failure).scope).toBe('selected-document-owner-only');
  expect(parsed(failure).state).toBe('activation-not-confirmed');
});

it('refuses opaque lexical KTD markers in comments before rewriting', async () => {
  seed('SKTD');
  const object = world.objects.get(ktd.objectUrl)!;
  object.metadata = object.metadata.replace(
    '</sktd:docu>',
    '<!-- <sktd:element><sktd:id>ZTEST.SHADOW</sktd:id><sktd:text>b3BhcXVl</sktd:text></sktd:element> --></sktd:docu>',
  );
  expect((await run('SKTD')).isError).toBe(true);
  expect(world.calls.filter((call) => call.method === 'PUT')).toEqual([]);
});
it('retains a created shell when its follow-up KTD save has unqualified native slots', async () => {
  const original = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
    const response = await original(...args);
    if (args[1]?.method === 'POST' && new URL(String(args[0])).pathname === ktd.collection) {
      const object = world.objects.get(ktd.objectUrl)!;
      object.metadata = object.metadata.replace('<sktd:shortText', '<sktd:shortText xmlns:sktd="urn:foreign"');
    }
    return response;
  });
  const result = await create('SKTD', { source: undefined, shortTexts: [{ node: 'ZTEST', text: 'changed' }] });
  expect(result.isError).toBe(true);
  expect(parsed(result).state).toBe('created-document-unconfirmed');
  expect(
    world.calls.filter((call) => call.method === 'POST' && call.path.split('?')[0] === ktd.collection),
  ).toHaveLength(1);
  expect(world.calls.filter((call) => call.method === 'PUT')).toEqual([]);
  expect(parsed(result).sessionClosed).toBe(true);
});

it.each([false, true])('qualifies native root attributes during post-create save (forbidden=%s)', async (forbidden) => {
  const original = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
    const response = await original(...args);
    if (args[1]?.method === 'POST' && new URL(String(args[0])).pathname === ktd.collection) {
      const object = world.objects.get(ktd.objectUrl)!;
      const elements = nodes.match(/<sktd:element\b[\s\S]*?<\/sktd:element>/g)!;
      if (forbidden)
        elements[0] = elements[0].replace(
          'sktd:longTextObligation="optional"',
          "sktd:longTextObligation = 'forbidden'",
        );
      object.metadata = object.metadata
        .replace('adtcore:name="ZTEST"', "adtcore:name = 'ZTEST'")
        .replace(nodes, elements.reverse().join(''))
        .replace(/<sktd:text>[^<]*<\/sktd:text>/g, '<sktd:text/>');
    }
    return response;
  });
  const result = await create('SKTD', { source: 'new bare root body' });
  expect(parsed(result).state).toBe(forbidden ? 'created-document-unconfirmed' : 'created');
  expect(
    world.calls.filter((call) => call.method === 'POST' && call.path.split('?')[0] === ktd.collection),
  ).toHaveLength(1);
  expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(forbidden ? 0 : 1);
  if (!forbidden) {
    const values = world.objects.get(ktd.objectUrl)!.metadata.match(/<sktd:element\b[\s\S]*?<\/sktd:element>/g)!;
    expect(values[0]).not.toContain(Buffer.from('new bare root body').toString('base64'));
    expect(values[1]).toContain(Buffer.from('new bare root body').toString('base64'));
  }
});

it('preserves the created shell when a native short-text obligation refuses its follow-up edit', async () => {
  const original = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
    const response = await original(...args);
    if (args[1]?.method === 'POST' && new URL(String(args[0])).pathname === ktd.collection) {
      const object = world.objects.get(ktd.objectUrl)!;
      object.metadata = object.metadata.replace(
        '<sktd:shortText sktd:text="Um9vdA==" sktd:obligation="optional"/>',
        '<sktd:shortText xmlns:x="urn:foreign" x:note=\'sktd:obligation="optional"\' sktd:text="Um9vdA==" sktd:obligation="forbidden"/>',
      );
    }
    return response;
  });
  const result = await create('SKTD', { source: undefined, shortTexts: [{ node: 'ZTEST', text: 'new short text' }] });
  expect(result.isError).toBe(true);
  expect(parsed(result).state).toBe('created-document-unconfirmed');
  expect(parsed(result).sessionClosed).toBe(true);
  expect(
    world.calls.filter((call) => call.method === 'POST' && call.path.split('?')[0] === ktd.collection),
  ).toHaveLength(1);
  expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
});

it.each(['ENHO', 'SKTD', 'KTD'] as const)(
  '%s public dispatch preserves native metadata guards and opaque state',
  async (type) => {
    const selected = seed(type === 'ENHO' ? 'ENHO' : 'SKTD');
    const before = world.objects.get(selected.objectUrl)!.metadata;
    const args = {
      action: 'update',
      type,
      name,
      expectedMetadataHash: parsePinnedDocument(before, selected).hash,
      ...(type === 'ENHO' ? { description: 'Changed' } : { source: '## ZTEST\n\nroot two' }),
    };
    const settings = { ...config, multiTargetAuthorization: 'xsuaa-attribute' as const };
    const stale = await handleToolCall(
      nativeClient(),
      settings,
      'SAPWrite',
      { ...args, expectedMetadataHash: 'a'.repeat(64) },
      pinnedPublicAuth(),
      undefined,
      undefined,
      true,
    );
    expect(stale.isError).toBe(true);
    expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
    const result = await handleToolCall(
      nativeClient(),
      settings,
      'SAPWrite',
      args,
      pinnedPublicAuth(),
      undefined,
      undefined,
      true,
    );
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(parsed(result)).toMatchObject({ state: 'saved-inactive', nativeVersion: 'inactive' });
    expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(world.objects.get(selected.objectUrl)!.metadata).toContain(opaque);
  },
);
