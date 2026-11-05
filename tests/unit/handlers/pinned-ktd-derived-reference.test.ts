import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { config, context, createWorld, fixture, install, nativeClient, type World } from './pinned-ddic-harness.js';
import { mockFetch } from './setup-undici-mock.js';

const { documentStableValue, parsePinnedDocument, pinnedDocumentSelection } = await import(
  '../../../src/adt/pinned-document-owner.js'
);
const { handlePrivatePinnedDocumentWrite: write } = await import(
  '../../../src/handlers/write/pinned-document-write.js'
);
const selected = pinnedDocumentSelection('SKTD', 'ZTEST');
let world: World;
const base = fixture('xml/sktd-managed-bdef-native-created.xml')
  .replaceAll('ZRRP_8E66923BDEF5', 'ZTEST')
  .replaceAll('zrrp_8e66923bdef5', 'ztest');
const stable = (xml: string) => documentStableValue(xml, selected);
function label(xml: string, name: string, description: string | undefined) {
  return xml.replace(new RegExp(`<adtcore:objectReference[^>]*adtcore:name="${name}"[^>]*/>`), (ref) => {
    const bare = ref.replace(/ adtcore:description="[^"]*"/, '');
    return description === undefined ? bare : bare.replace('/>', ` adtcore:description="${description}"/>`);
  });
}
function body(xml: string, name: string, content: string) {
  return xml.replace(
    new RegExp(`(<sktd:id>[^<]*[.]${name}</sktd:id>)<sktd:text[^>]*>(?:[^<]*</sktd:text>)?`),
    `$1<sktd:text>${Buffer.from(content).toString('base64')}</sktd:text>`,
  );
}
function shortText(xml: string, name: string, content: string) {
  return xml.replace(
    new RegExp(`(<sktd:id>[^<]*[.]${name}</sktd:id>[\\s\\S]*?<sktd:shortText sktd:text=")[^"]*`),
    `$1${Buffer.from(content).toString('base64')}`,
  );
}
beforeEach(() => {
  vi.restoreAllMocks();
  world = createWorld();
  install(world);
});
afterEach(() => expect(world.unexpected).toEqual([]));
it.each(['create', 'update', 'delete', 'approve'])(
  'projects only the derived %s label while full hashes retain it',
  (name) => {
    const after = label(base, name, 'Derived native label');
    expect(stable(after)).toBe(stable(base));
    expect(parsePinnedDocument(after, selected).hash).not.toBe(parsePinnedDocument(base, selected).hash);
  },
);
it('uses expanded native names without changing lexical wire content', () => {
  const aliases = (xml: string) =>
    xml
      .replaceAll('adtcore:', 'c:')
      .replaceAll('xmlns:adtcore=', 'xmlns:c=')
      .replaceAll('sktd:', 's:')
      .replaceAll('xmlns:sktd=', 'xmlns:s=');
  expect(stable(aliases(label(base, 'create', 'Derived')))).toBe(stable(base));
});
it.each([
  [
    'root description',
    (x: string) => x.replace('adtcore:description="Documentation for ZTEST"', 'adtcore:description="Different"'),
  ],
  [
    'parent reference label',
    (x: string) => x.replace(/(<sktd:refObject[^>]*adtcore:description=")[^"]*/, '$1Different'),
  ],
  ['root node reference label', (x: string) => label(x, 'ZTEST', 'Different')],
  ['long text', (x: string) => body(x, 'create', 'Unexpected body')],
  ['short text', (x: string) => shortText(x, 'create', 'Unexpected short text')],
  [
    'opaque reference attribute',
    (x: string) => x.replace('adtcore:name="create"', 'adtcore:name="create" x:value="changed" xmlns:x="urn:opaque"'),
  ],
  [
    'foreign description',
    (x: string) =>
      x.replace('adtcore:name="create"', 'adtcore:name="create" x:description="changed" xmlns:x="urn:opaque"'),
  ],
  [
    'nested native description',
    (x: string) =>
      x.replace(
        '</sktd:docu>',
        '<x:opaque xmlns:x="urn:opaque"><adtcore:objectReference adtcore:description="changed"/></x:opaque></sktd:docu>',
      ),
  ],
] as const)('retains %s in the stable comparison', (_name, change) => {
  expect(stable(change(label(base, 'create', 'Derived')))).not.toBe(stable(base));
});
it.each([
  [
    'foreign URI',
    (x: string) =>
      x.replace(
        /(<adtcore:objectReference adtcore:uri=")[^"]*(" adtcore:type="BDEF\/BSO" adtcore:name="create")/,
        '$1/sap/bc/adt/bo/behaviordefinitions/other$2',
      ),
  ],
  [
    'unknown type',
    (x: string) =>
      x.replace('adtcore:type="BDEF/BSO" adtcore:name="create"', 'adtcore:type="BDEF/OTHER" adtcore:name="create"'),
  ],
  ['mismatched name', (x: string) => x.replace('adtcore:name="create"', 'adtcore:name="foreign"')],
  ['mismatched ID', (x: string) => x.replace(';name=ZTEST.create</sktd:id>', ';name=OTHER.create</sktd:id>')],
  ['mismatched parent', (x: string) => x.replaceAll(';name=ZTEST</sktd:parent>', ';name=OTHER</sktd:parent>')],
  [
    'foreign root reference',
    (x: string) => x.replace(/(<sktd:refObject adtcore:uri=")[^"]*/, '$1/sap/bc/adt/bo/behaviordefinitions/other'),
  ],
  ['duplicate node ID', (x: string) => x.replace(';name=ZTEST.update</sktd:id>', ';name=ZTEST.create</sktd:id>')],
  [
    'nested native slot',
    (x: string) =>
      x.replace(
        /<sktd:element[^>]*><sktd:id>[^<]*[.]create<\/sktd:id>[\s\S]*?<\/sktd:element>/,
        '<x:opaque xmlns:x="urn:opaque">$&</x:opaque>',
      ),
  ],
] as const)('does not project labels from %s', (_name, change) => {
  const before = change(base),
    after = change(label(base, 'create', 'Derived'));
  expect(stable(after)).not.toBe(stable(before));
});
async function run(xml: string, changes: Record<string, unknown>, expected = parsePinnedDocument(xml, selected).hash) {
  world.objects.set(selected.objectUrl, { metadata: xml, nativeType: 'SKTD/TYP' });
  const client = nativeClient();
  return write(
    client,
    { action: 'update', type: 'SKTD', name: selected.name, expectedMetadataHash: expected, ...changes },
    config,
    context(client),
  );
}
it.each(['set', 'change', 'clear'] as const)(
  'confirms native label %s after one owning PUT and preserves submitted labels',
  async (mode) => {
    const before = mode === 'set' ? base : label(shortText(base, 'create', 'Previous'), 'create', 'Previous');
    const text = mode === 'clear' ? '' : 'Current';
    const original = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
      const response = await original(...args);
      if (world.calls.at(-1)?.method === 'PUT') {
        const stored = world.objects.get(selected.objectUrl)!;
        stored.metadata = label(stored.metadata, 'create', text || undefined);
      }
      return response;
    });
    const result = await run(before, { shortTexts: [{ node: 'ZTEST.create', text }] });
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({ state: 'saved-inactive', nativeVersion: 'inactive' });
    const puts = world.calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]!.locked).toBe(true);
    if (mode !== 'set') expect(puts[0]!.body).toContain('adtcore:description="Previous"');
    expect(world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
  },
);
it('retains derived labels in stale and under-lock metadata preconditions', async () => {
  const changed = label(base, 'create', 'Concurrent getter label');
  expect((await run(changed, { source: 'root edit' }, parsePinnedDocument(base, selected).hash)).isError).toBe(true);
  expect(world.calls.some((c) => c.method === 'POST' || c.method === 'PUT')).toBe(false);
  world = createWorld();
  install(world);
  const original = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
    if (world.locked) world.objects.get(selected.objectUrl)!.metadata = changed;
    return original(...args);
  });
  expect((await run(base, { source: 'root edit' })).isError).toBe(true);
  expect(world.calls.some((c) => c.method === 'PUT')).toBe(false);
  expect(world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
});
it.each(['opaque', 'text', 'reference', 'active'] as const)(
  'keeps %s native readback drift unconfirmed without retry',
  async (fault) => {
    const original = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
      const response = await original(...args);
      if (world.calls.at(-1)?.method === 'PUT') {
        const stored = world.objects.get(selected.objectUrl)!;
        stored.metadata = label(stored.metadata, 'create', 'Current');
        if (fault === 'opaque')
          stored.metadata = stored.metadata.replace(
            'adtcore:name="create"',
            'adtcore:name="create" x:opaque="unexpected" xmlns:x="urn:test"',
          );
        if (fault === 'text') stored.metadata = shortText(stored.metadata, 'create', 'Wrong');
        if (fault === 'reference')
          stored.metadata = stored.metadata.replace('adtcore:name="create"', 'adtcore:name="foreign"');
        if (fault === 'active')
          stored.metadata = stored.metadata.replace('adtcore:version="inactive"', 'adtcore:version="active"');
      }
      return response;
    });
    const result = await run(base, { shortTexts: [{ node: 'ZTEST.create', text: 'Current' }] });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).state).toBe('document-save-unconfirmed');
    expect(world.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
  },
);
