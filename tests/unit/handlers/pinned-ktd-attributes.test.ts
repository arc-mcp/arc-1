import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { config, context, createWorld, install, nativeClient, type World } from './pinned-ddic-harness.js';
import { mockFetch } from './setup-undici-mock.js';

const { handlePrivatePinnedDocumentWrite: write } = await import(
  '../../../src/handlers/write/pinned-document-write.js'
);
const { parsePinnedDocument, pinnedDocumentSelection } = await import('../../../src/adt/pinned-document-owner.js');
const selected = pinnedDocumentSelection('SKTD', 'ZTEST');
const fieldId = '/sap/bc/adt/ddic/ddl/sources/ztest#type=DDLS/DF;name=ZTEST.FIELD';
const opaque = '<x:opaque xmlns:x="urn:test" x:value="001"> keep </x:opaque>';
const b64 = (value: string) => Buffer.from(value).toString('base64');
let world: World;
const parsed = (result: Awaited<ReturnType<typeof write>>) => JSON.parse(result.content[0].text as string);
const node = (id: string, attrs = '', body = '') =>
  `<sktd:element ${attrs}><sktd:id>${id}</sktd:id><sktd:text>${b64(body)}</sktd:text><sktd:shortText sktd:text="Um9vdA==" sktd:obligation="optional"/></sktd:element>`;
function seed(
  owner = 'adtcore:name="ZTEST"',
  attrs = 'sktd:longTextObligation="optional"',
  rootBody = '',
  fieldBody = '',
) {
  // Field deliberately precedes root; native bindings include equivalent aliases.
  const metadata = `<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:k="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" xmlns:c="http://www.sap.com/adt/core" ${owner} adtcore:type="SKTD/TYP" adtcore:version="inactive"><adtcore:packageRef adtcore:name="ZTEAM" adtcore:type="DEVC/K"/><sktd:refObject adtcore:name="ZTEST" adtcore:type="DDLS/DF" adtcore:uri="/sap/bc/adt/ddic/ddl/sources/ztest"/>${node(fieldId, '', fieldBody)}${node('ZTEST', attrs, rootBody)}${opaque}</sktd:docu>`;
  world.objects.set(selected.objectUrl, { metadata, nativeType: selected.native });
  return metadata;
}
const current = () => world.objects.get(selected.objectUrl)!;
function segment(xml: string, id: string) {
  return [...xml.matchAll(/<sktd:element\b[\s\S]*?<\/sktd:element>/g)].find(([value]) =>
    value.includes(`<sktd:id>${id}</sktd:id>`),
  )![0];
}
async function run(source: string | undefined = 'new body', extra: Record<string, unknown> = {}) {
  const client = nativeClient(undefined, config);
  return write(
    client,
    {
      action: 'update',
      type: 'SKTD',
      name: 'ZTEST',
      source,
      expectedMetadataHash: parsePinnedDocument(current().metadata, selected).hash,
      ...extra,
    },
    config,
    context(client),
  );
}
beforeEach(() => {
  vi.restoreAllMocks();
  world = createWorld();
  install(world);
});
afterEach(() => expect(world.unexpected).toEqual([]));

const ownerSpellings = ['adtcore:name="ZTEST"', "adtcore:name='ZTEST'", 'adtcore:name = "ZTEST"', 'c:name="ZTEST"'];
it.each(ownerSpellings)('routes an empty multi-node root by native identity: %s', async (owner) => {
  const before = seed(owner);
  const result = await run();
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(parsed(result).state).toBe('saved-inactive');
  expect(segment(current().metadata, 'ZTEST')).toContain(b64('new body'));
  expect(segment(current().metadata, fieldId)).toBe(segment(before, fieldId));
  expect(current().metadata).toContain(owner);
  expect(current().metadata).toContain(opaque);
  expect(world.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
});
it.each(ownerSpellings)('retains ambiguous-root-title refusal: %s', async (owner) => {
  seed(owner);
  const result = await run('## ZTEST\n\nnew body');
  expect(result.isError).toBe(true);
  expect(world.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
});
it.each(ownerSpellings)('retains the single documented field fallback: %s', async (owner) => {
  const before = seed(owner, undefined, '', 'field before');
  expect((await run()).isError).toBeUndefined();
  expect(segment(current().metadata, fieldId)).toContain(b64('new body'));
  expect(segment(current().metadata, 'ZTEST')).toBe(segment(before, 'ZTEST'));
});

const spellings = (name: string, value: string) => [
  `sktd:${name}="${value}"`,
  `sktd:${name}='${value}'`,
  `sktd:${name} = "${value}"`,
  `k:${name}="${value}"`,
];
it.each(spellings('longTextObligation', 'forbidden').concat('k:longTextObligation="for&#98;idden"'))(
  'refuses native forbidden bodies: %s',
  async (attribute) => {
    const before = seed(undefined, `${attribute} sktd:canHaveDocumentation="true"`, 'before');
    const result = await run();
    expect(result.isError).toBe(true);
    expect(current().metadata).toBe(before);
    expect(world.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
  },
);
it.each(['optional', 'mandatory'].flatMap((value) => spellings('longTextObligation', value)))(
  'honors obligation precedence over canHaveDocumentation=false: %s',
  async (attribute) => {
    seed(undefined, `${attribute} k:canHaveDocumentation='false'`, 'before');
    expect((await run()).isError).toBeUndefined();
    expect(segment(current().metadata, 'ZTEST')).toContain(b64('new body'));
    expect(current().metadata).toContain(attribute);
  },
);
it.each(spellings('canHaveDocumentation', 'false'))('refuses a native false fallback: %s', async (attribute) => {
  seed(undefined, attribute, 'before');
  expect((await run()).isError).toBe(true);
  expect(world.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
});
it.each(['', ...spellings('canHaveDocumentation', 'true')])(
  'retains missing-obligation compatibility: %s',
  async (attribute) => {
    seed(undefined, attribute);
    expect((await run()).isError).toBeUndefined();
    expect(segment(current().metadata, 'ZTEST')).toContain(b64('new body'));
  },
);
it.each(['', 'unknown', 'false'])('refuses present unrecognized obligation %s', async (value) => {
  seed(undefined, `k:longTextObligation="${value}" sktd:canHaveDocumentation="true"`, 'before');
  expect((await run()).isError).toBe(true);
  expect(world.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
});
it('preserves unchanged forbidden content while another node is edited', async () => {
  const before = seed('c:name="ZTEST"', "k:longTextObligation='forbidden'", 'before', 'field before');
  expect((await run('## ZTEST\n\nbefore\n\n## ZTEST.FIELD\n\nnew field')).isError).toBeUndefined();
  expect(segment(current().metadata, 'ZTEST')).toBe(segment(before, 'ZTEST'));
  expect(segment(current().metadata, fieldId)).toContain(b64('new field'));
});
it('allows native short-text edits independently of long-text eligibility', async () => {
  const before = seed('c:name="ZTEST"', "k:longTextObligation='forbidden'", 'before');
  expect(
    (await run(undefined, { source: undefined, shortTexts: [{ node: 'ZTEST', text: 'New root' }] })).isError,
  ).toBeUndefined();
  expect(segment(current().metadata, 'ZTEST')).toContain(b64('before'));
  expect(segment(current().metadata, 'ZTEST')).toContain(b64('New root'));
  expect(segment(current().metadata, fieldId)).toBe(segment(before, fieldId));
});
it('refuses forbidden short text without relaxing its separate contract', async () => {
  seed('c:name="ZTEST"');
  current().metadata = current().metadata.replaceAll('sktd:obligation="optional"', "sktd:obligation='forbidden'");
  expect((await run(undefined, { source: undefined, shortTexts: [{ node: 'ZTEST', text: 'New root' }] })).isError).toBe(
    true,
  );
  expect(world.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
});
it('uses the fresh equivalent root spelling under the owning lock', async () => {
  seed();
  const hash = parsePinnedDocument(current().metadata, selected).hash;
  const original = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
    if (world.locked) current().metadata = current().metadata.replace('adtcore:name="ZTEST"', "c:name = 'ZTEST'");
    return original(...args);
  });
  expect((await run()).isError).toBeUndefined();
  expect(segment(current().metadata, 'ZTEST')).toContain(b64('new body'));
  expect(segment(current().metadata, fieldId)).not.toContain(b64('new body'));
  expect(parsePinnedDocument(current().metadata.replace(b64('new body'), ''), selected).hash).toBe(hash);
  expect(world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
});
it('refuses native eligibility drift under the lock and cleans up once', async () => {
  seed();
  const original = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
    if (world.locked)
      current().metadata = current().metadata.replace(
        'sktd:longTextObligation="optional"',
        "k:longTextObligation='forbidden'",
      );
    return original(...args);
  });
  expect((await run()).isError).toBe(true);
  expect(world.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  expect(world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
});
it('refuses a forbidden preview before a lock or save', async () => {
  seed(undefined, "k:longTextObligation='forbidden'");
  expect((await run('new body', { dryRun: true })).isError).toBe(true);
  expect(world.calls.filter((c) => c.method === 'PUT' || c.path.includes('_action=LOCK'))).toHaveLength(0);
});

it('keeps unsupported encoded owner identity fail closed', async () => {
  seed();
  const hash = parsePinnedDocument(current().metadata, selected).hash;
  current().metadata = current().metadata.replace('adtcore:name="ZTEST"', 'c:name="ZTE&#83;T"');
  const client = nativeClient();
  const result = await write(
    client,
    { action: 'update', type: 'SKTD', name: 'ZTEST', source: 'new body', expectedMetadataHash: hash },
    config,
    context(client),
  );
  expect(result.isError).toBe(true);
  expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
});
it('preserves foreign attributes without treating them as native writability flags', async () => {
  const attrs = 'xmlns:f="urn:foreign" f:longTextObligation="forbidden"';
  seed(undefined, attrs);
  expect((await run()).isError).toBeUndefined();
  expect(current().metadata).toContain(attrs);
  expect(segment(current().metadata, 'ZTEST')).toContain(b64('new body'));
});

function shortTextFixture(obligation: string, note: string, value = 'sktd:text="Um9vdA=="') {
  seed();
  current().metadata = current().metadata.replaceAll(
    '<sktd:shortText sktd:text="Um9vdA==" sktd:obligation="optional"/>',
    `<sktd:shortText xmlns:x="urn:foreign" x:note='${note}' ${value} ${obligation}/>`,
  );
  return current().metadata;
}
const editShortText = () => run(undefined, { source: undefined, shortTexts: [{ node: 'ZTEST', text: 'New root' }] });
it.each(spellings('obligation', 'forbidden').concat('k:obligation="for&#98;idden"'))(
  'refuses actual forbidden short text despite an opaque optional decoy: %s',
  async (obligation) => {
    const before = shortTextFixture(obligation, 'sktd:obligation="optional"');
    expect((await editShortText()).isError).toBe(true);
    expect(current().metadata).toBe(before);
    expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
    expect(world.calls.filter((call) => call.path.includes('_action=UNLOCK'))).toHaveLength(1);
  },
);
it.each(['optional', 'mandatory'].flatMap((value) => spellings('obligation', value)))(
  'edits a native writable short text while preserving its opaque forbidden decoy: %s',
  async (obligation) => {
    const before = shortTextFixture(obligation, 'sktd:obligation="forbidden"');
    expect((await editShortText()).isError).toBeUndefined();
    expect(segment(current().metadata, fieldId)).toBe(segment(before, fieldId));
    expect(segment(current().metadata, 'ZTEST')).toBe(
      segment(before, 'ZTEST').replace('sktd:text="Um9vdA=="', `sktd:text="${b64('New root')}"`),
    );
    expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  },
);
it.each(['', 'unknown'])(
  'refuses native empty/unknown short-text obligation with a writable decoy: %s',
  async (value) => {
    shortTextFixture(`k:obligation="${value}"`, 'sktd:obligation="optional"');
    expect((await editShortText()).isError).toBe(true);
    expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  },
);
it('refuses a missing native short-text obligation even with an optional decoy', async () => {
  shortTextFixture('', 'sktd:obligation="optional"');
  expect((await editShortText()).isError).toBe(true);
  expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
});
it.each(['sktd:text="Um9vdA=="', "sktd:text='Um9vdA=='", 'sktd:text = "Um9vdA=="'])(
  'replaces only the real short-text value and preserves attribute bytes: %s',
  async (value) => {
    const note = '> sktd:text="Um9vdA==" sktd:obligation="forbidden"';
    const before = shortTextFixture('k:obligation="optional"', note, value);
    expect((await editShortText()).isError).toBeUndefined();
    expect(segment(current().metadata, 'ZTEST')).toBe(
      segment(before, 'ZTEST').replace(
        ` ${value} k:obligation=`,
        ` ${value.replace('Um9vdA==', b64('New root'))} k:obligation=`,
      ),
    );
    expect(current().metadata).toContain(`x:note='${note}'`);
    expect(segment(current().metadata, fieldId)).toBe(segment(before, fieldId));
    expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  },
);
it.each(['', 'k:text="Um9vdA=="'])(
  'does not treat a decoy as a missing or unsupported native value: %s',
  async (value) => {
    const before = shortTextFixture('sktd:obligation="optional"', 'sktd:text="Um9vdA=="', value);
    expect((await editShortText()).isError).toBe(true);
    expect(current().metadata).toBe(before);
    expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  },
);
it('refuses forbidden short text during a preview without acquiring a lock', async () => {
  shortTextFixture('k:obligation="forbidden"', 'sktd:obligation="optional"');
  expect(
    (await run(undefined, { source: undefined, shortTexts: [{ node: 'ZTEST', text: 'New root' }], dryRun: true }))
      .isError,
  ).toBe(true);
  expect(world.calls.filter((call) => call.method === 'PUT' || call.path.includes('_action=LOCK'))).toHaveLength(0);
});

it('preserves a native-namespace lookalike sibling while editing only the exact shortText slot', async () => {
  shortTextFixture('sktd:obligation="optional"', 'ordinary opaque text');
  const sibling = '<sktd:shortText-extra sktd:text="opaque" sktd:obligation="forbidden"/>';
  current().metadata = current().metadata.replaceAll('<sktd:shortText xmlns:x=', `${sibling}<sktd:shortText xmlns:x=`);
  const before = current().metadata;
  expect((await editShortText()).isError).toBeUndefined();
  expect(segment(current().metadata, 'ZTEST')).toBe(
    segment(before, 'ZTEST').replace('sktd:text="Um9vdA=="', `sktd:text="${b64('New root')}"`),
  );
  expect(segment(current().metadata, fieldId)).toBe(segment(before, fieldId));
  expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
});
