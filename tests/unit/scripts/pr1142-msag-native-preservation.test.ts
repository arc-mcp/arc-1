import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { MutationCleanupState } from '../../../src/adt/mutation-context.js';
import { ddicHarness } from './pr1142-native-ddic-harness.js';

const { collectionsFixtures } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-collections-fixtures.js'
);
const { collectionsSnapshot } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-collections-evidence.js'
);
const { ddicConfig } = await import('../../../scripts/qualification/pr1142/native-ddic-workflow.js');
const { pinnedMutationContext } = await import('../../../src/adt/mutation-context.js');
const { createPinnedDdicContext } = await import('../../../src/handlers/write/pinned-ddic-context.js');
const { executePinnedSourceWrite } = await import('../../../src/handlers/write/pinned-source-write.js');
const { nativeXmlRoot } = await import('../../../src/adt/native-xml-evidence.js');
const { preparePinnedMessageClassUpdate, assertSavedMessageClass } = await import(
  '../../../src/adt/pinned-msag-document.js'
);
const { buildMessageClassXml } = await import('../../../src/adt/ddic-xml.js');
const fixtures = collectionsFixtures('0123456789AB'),
  fixture = fixtures[2];
// Full row651 document with only the generated suffix rebound. No projection strips its native fields/links.
const captured = readFileSync(
  new URL('../../fixtures/ddic-collections/msag-native-active.xml', import.meta.url),
  'utf8',
);
const mc = 'http://www.sap.com/adt/MessageClass',
  atom = 'http://www.w3.org/2005/Atom';
const rows = (xml: string) => nativeXmlRoot(xml, 'messageClass', mc, true).children('messages', mc);
const row = (xml: string, number: string) => rows(xml).find((r) => r.attribute('msgno', mc) === number)!;
const native = (xml: string, number: string) => row(xml, number).canonicalValue({});
function harness(xml = captured) {
  const h = ddicHarness({ fixtures });
  h.world.objects.get(fixture.owner)!.metadata = xml;
  h.hooks.before = (url, init) => {
    if (init.method === 'GET' && url.pathname === fixture.owner && h.world.calls.some((c) => c.method === 'PUT')) {
      const o = h.world.objects.get(fixture.owner)!;
      o.metadata = o.metadata.replace('adtcore:version="inactive"', 'adtcore:version="active"');
    }
  };
  return h;
}
async function update(h: ReturnType<typeof harness>, args: Record<string, unknown> = fixture.update) {
  const cleanup: MutationCleanupState = { unlockFailed: false };
  const result = await executePinnedSourceWrite(
    await createPinnedDdicContext(
      h.client,
      { action: 'update', type: 'MSAG', name: fixture.name, ...args },
      ddicConfig(),
      pinnedMutationContext(h.client.safety, { deadline: Date.now() + 30_000 }, cleanup),
    ),
  );
  return { result, cleanup, payload: JSON.parse(result.content[0].text) };
}
const puts = (h: ReturnType<typeof harness>) => h.world.calls.filter((c) => c.method === 'PUT');
it('updates full native rows by number, preserves changed/unchanged metadata, removes003 and adds004 once', async () => {
  const h = harness();
  const initial = await collectionsSnapshot(h.client, fixture, false, true, () => {}, {
    deadline: Date.now() + 30_000,
    noReplay: true,
  });
  const { result, payload, cleanup } = await update(h, { ...fixture.update, expectedMetadataHash: initial.hash });
  expect(result.isError).not.toBe(true);
  expect(payload.state).toBe('saved-active');
  expect(puts(h)).toHaveLength(1);
  const body = puts(h)[0].body;
  expect(native(body, '002')).toEqual(native(captured, '002'));
  expect(row(body, '001').attribute('msgtext', mc)).toBe('Updated collection &1');
  for (const field of ['lastchangedby', 'lastmodified', 'selfexplainatory', 'documented'])
    expect(row(body, '001').attribute(field, mc)).toBe(row(captured, '001').attribute(field, mc));
  expect(
    row(body, '001')
      .children('link', atom)
      .map((l) => l.canonicalValue({})),
  ).toEqual(
    row(captured, '001')
      .children('link', atom)
      .map((l) => l.canonicalValue({})),
  );
  expect(rows(body).map((r) => r.attribute('msgno', mc))).toEqual(['001', '002', '004']);
  expect(row(body, '004').attribute('documented', mc)).toBe('false');
  expect(cleanup).toEqual({ unlockFailed: false, sessionClosed: true });
  expect(h.world.calls.some((c) => c.method === 'DELETE' || c.path.startsWith('/sap/bc/adt/activation'))).toBe(false);
});
it('preserves opaque row/root state, flags, lexical decoys and namespace aliases', async () => {
  const xml = captured
    .replace('mc:documented="false"', 'mc:documented="true"')
    .replace('mc:selfexplainatory="true"', 'mc:selfexplainatory="false"')
    .replace('mc:msgno="001"', `mc:msgno="001" ext:note='mc:msgtext="decoy"' xmlns:ext="urn:opaque"`)
    .replace(
      '</mc:messageClass>',
      '<ext:future xmlns:ext="urn:opaque" ext:value="0001"> kept </ext:future></mc:messageClass>',
    )
    .replaceAll('mc:', 'msg:')
    .replace('xmlns:mc=', 'xmlns:msg=');
  const h = harness(xml);
  const { result } = await update(h);
  expect(result.isError).not.toBe(true);
  expect(puts(h)).toHaveLength(1);
  expect(puts(h)[0].body).toContain('ext:value="0001"');
  expect(puts(h)[0].body).toContain(' kept ');
  expect(row(puts(h)[0].body, '001').attribute('documented', mc)).toBe('true');
  expect(row(puts(h)[0].body, '001').attribute('note', 'urn:opaque')).toBe('msg:msgtext="decoy"');
});
it('description-only changes preserve every native row and its links', async () => {
  const h = harness();
  const { result } = await update(h, { description: 'Changed description' });
  expect(result.isError).not.toBe(true);
  expect(rows(puts(h)[0].body).map((r) => r.canonicalValue({}))).toEqual(
    rows(captured).map((r) => r.canonicalValue({})),
  );
});
it.each([
  [
    'foreign message link',
    (x: string) => x.replace('/messageclass/zmcc0123456789ab/messages/001', '/messageclass/foreign/messages/001'),
  ],
  ['foreign longtext', (x: string) => x.replace('object_name/ZMCC0123456789AB001', 'object_name/ZFOREIGN001')],
  ['query', (x: string) => x.replace('/messages/001', '/messages/001?sap-client=002')],
  ['duplicate row', (x: string) => x.replace('mc:msgno="002"', 'mc:msgno="001"')],
  ['foreign identity', (x: string) => x.replace('mc:msgno="001"', 'x:msgno="001" xmlns:x="urn:foreign"')],
  ['foreign Atom binding', (x: string) => x.replace('http://www.w3.org/2005/Atom', 'urn:foreign')],
  [
    'row URI',
    (x: string) => x.replace('mc:msgno="001"', 'mc:msgno="001" adtcore:uri="/sap/bc/adt/messageclass/foreign"'),
  ],
  ['malformed date', (x: string) => x.replace('2026-11-03"', '2026-02-31"')],
] as const)('refuses %s before any PUT and keeps own cleanup', async (_label, rewrite) => {
  const h = harness(rewrite(captured));
  const { result, payload, cleanup } = await update(h);
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('unchanged');
  expect(puts(h)).toHaveLength(0);
  expect(cleanup.unlockFailed).toBe(false);
});
it('does not retry an acknowledged save with foreign or lost readback state', async () => {
  const h = harness();
  const previous = h.hooks.before!;
  h.hooks.before = (url, init) => {
    previous(url, init);
    if (init.method === 'GET' && url.pathname === fixture.owner && puts(h).length)
      h.world.objects.get(fixture.owner)!.metadata = h.world.objects
        .get(fixture.owner)!
        .metadata.replace('mc:msgtext="Preserved message"', 'mc:msgtext="changed outside selection"');
  };
  const { result, payload, cleanup } = await update(h);
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('metadata-save-unknown');
  expect(puts(h)).toHaveLength(1);
  expect(cleanup.sessionClosed).toBe(true);
});
it('accepts only validated new-row native link/bookkeeping additions, retaining all other fields', () => {
  const requested = buildMessageClassXml({
    name: fixture.name,
    description: fixture.description,
    package: '$TMP',
    messages: fixture.update.messages,
  });
  const prepared = preparePinnedMessageClassUpdate(captured, requested, { messages: true, description: false });
  let saved = prepared.persistedBody.replace(
    /(<mc:messages[^>]*mc:msgno="004"[^>]*)(>)/,
    '$1 mc:lastchangedby="MARIAN" mc:lastmodified="2026-11-04" adtcore:name=""$2',
  );
  saved = saved.replace(
    /(<mc:messages[^>]*mc:msgno="004"[^>]*>)(<\/mc:messages>)/,
    `$1<atom:link xmlns:atom="${atom}" href="/sap/bc/adt/messageclass/${fixture.name.toLowerCase()}/messages/004" rel="http://www.sap.com/adt/relations/messageclasses/messages"/>$2`,
  );
  expect(() => assertSavedMessageClass(prepared.persistedBody, saved, new Set(['004']))).not.toThrow();
  expect(() =>
    assertSavedMessageClass(
      prepared.persistedBody,
      saved.replace('mc:msgno="004"', 'mc:msgno="004" ext:extra="unknown" xmlns:ext="urn:opaque"'),
      new Set(['004']),
    ),
  ).toThrow('read-back differs');
  expect(() =>
    assertSavedMessageClass(prepared.persistedBody, saved.replace('/messages/004', '/messages/999'), new Set(['004'])),
  ).toThrow('link');
  expect(() =>
    assertSavedMessageClass(
      prepared.persistedBody,
      saved.replace('mc:msgno="002"', 'mc:msgno="005"'),
      new Set(['004']),
    ),
  ).toThrow();
});
it('confirms actual native additions after one save using fresh full native hashes', async () => {
  const h = harness(),
    original = h.hooks.before!;
  h.hooks.before = (url, init) => {
    original(url, init);
    if (init.method !== 'GET' || url.pathname !== fixture.owner || !puts(h).length) return;
    const saved = h.world.objects.get(fixture.owner)!;
    if (saved.metadata.includes('mc:lastmodified="2026-11-04"')) return;
    saved.metadata = saved.metadata
      .replace(
        /(<mc:messages[^>]*mc:msgno="004"[^>]*)(>)/,
        '$1 mc:lastchangedby="MARIAN" mc:lastmodified="2026-11-04" adtcore:name=""$2',
      )
      .replace(
        /(<mc:messages[^>]*mc:msgno="004"[^>]*>)(<\/mc:messages>)/,
        `$1<atom:link xmlns:atom="${atom}" href="/sap/bc/adt/messageclass/${fixture.name.toLowerCase()}/messages/004" rel="http://www.sap.com/adt/relations/messageclasses/messages"/>$2`,
      );
  };
  const { result, payload } = await update(h);
  expect(result.isError).not.toBe(true);
  expect(payload.state).toBe('saved-active');
  expect(payload.next).toContain('active message');
  const final = await collectionsSnapshot(h.client, fixture, true, true, () => {}, {
    deadline: Date.now() + 30_000,
    noReplay: true,
  });
  expect(payload.metadataHash).toBe(final.hash);
  expect(puts(h)).toHaveLength(1);
});
it('keeps a rejected native save uncertain and never retries it', async () => {
  const h = harness();
  h.world.faults.add('save-unknown');
  const { result, payload, cleanup } = await update(h);
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('metadata-save-unknown');
  expect(puts(h)).toHaveLength(1);
  expect(cleanup.sessionClosed).toBe(true);
});
it('refuses a changed full native metadata hash before PUT', async () => {
  const h = harness();
  const { result, payload } = await update(h, { ...fixture.update, expectedMetadataHash: '0'.repeat(64) });
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('unchanged');
  expect(puts(h)).toHaveLength(0);
});

const { nativeXmlCharacterRoot } = await import('../../../src/adt/native-xml-evidence.js');
const { readDdicEvidence, pinnedDdicSelection } = await import('../../../src/adt/pinned-ddic-owner.js');
const semanticRow = (xml: string, number: string) =>
  nativeXmlCharacterRoot(xml, 'messageClass', mc)
    .children('messages', mc)
    .find((r) => r.attribute('msgno', mc) === number)!;
for (const [encoded, value] of [
  ['&#65;', 'A'],
  ['&#x41;', 'A'],
  ['&#x1F600;', '😀'],
  ['&#34;', '"'],
  ['&#38;', '&'],
  ['&#60;', '<'],
  ['&amp;#65;', '&#65;'],
  ['&amp;amp;#65;', '&amp;#65;'],
] as const)
  it(`retains ${encoded} in untouched native message, opaque attribute and text`, async () => {
    const xml = captured
      .replace('Preserved message', `Preserved ${encoded} message`)
      .replace('mc:msgno="002"', `mc:msgno="002" ext:note="${encoded}" xmlns:ext="urn:opaque"`)
      .replace('</mc:messageClass>', `<ext:future xmlns:ext="urn:opaque">${encoded}</ext:future></mc:messageClass>`);
    const h = harness(xml);
    const { result } = await update(h, { description: 'Changed description' });
    expect(result.isError).not.toBe(true);
    expect(puts(h)).toHaveLength(1);
    const body = puts(h)[0].body;
    expect(body).toContain(`Preserved ${encoded} message`);
    expect(body).toContain(`ext:note="${encoded}"`);
    expect(semanticRow(body, '002').attribute('msgtext', mc)).toBe(`Preserved ${value} message`);
    expect(semanticRow(body, '002').attribute('note', 'urn:opaque')).toBe(value);
  });
it('retains literal numeric-reference text in opaque CDATA and comments', async () => {
  const xml = captured.replace(
    '</mc:messageClass>',
    '<ext:future xmlns:ext="urn:opaque"><![CDATA[&#65; &amp;]]></ext:future><!-- &#65; &amp; --></mc:messageClass>',
  );
  const h = harness(xml);
  const { result } = await update(h, { description: 'Changed description' });
  expect(result.isError).not.toBe(true);
  expect(puts(h)[0].body).toContain('<![CDATA[&#65; &amp;]]>');
  expect(puts(h)[0].body).toContain('<!-- &#65; &amp; -->');
});
it('distinguishes a selected literal reference from an existing numeric character', async () => {
  const h = harness(captured.replace('Original collection &amp;1', '&#65;'));
  const { result, payload } = await update(h, {
    messages: [
      { number: '001', shortText: '&#65;' },
      { number: '002', shortText: 'Preserved message' },
      { number: '003', shortText: 'Removed message' },
    ],
  });
  expect(result.isError).not.toBe(true);
  expect(payload.state).toBe('saved-active');
  expect(puts(h)).toHaveLength(1);
  expect(puts(h)[0].body).toContain('mc:msgtext="&amp;#65;"');
  expect(semanticRow(puts(h)[0].body, '001').attribute('msgtext', mc)).toBe('&#65;');
});
it('recognizes semantic equivalence as a no-op without normalizing stored bytes', async () => {
  const h = harness(captured.replace('Preserved message', 'Preserved &#65; message'));
  const { result, payload } = await update(h, {
    messages: [
      { number: '001', shortText: 'Original collection &1' },
      { number: '002', shortText: 'Preserved A message' },
      { number: '003', shortText: 'Removed message' },
    ],
  });
  expect(result.isError).not.toBe(true);
  expect(payload.state).toBe('unchanged');
  expect(puts(h)).toHaveLength(0);
  expect(h.world.objects.get(fixture.owner)!.metadata).toContain('&#65;');
});
it('uses semantic MSAG metadata hashes and refuses a literal-reference drift under its own lock', async () => {
  const xml = captured.replace('Preserved message', 'Preserved &#65; message');
  const h = harness(xml),
    selected = pinnedDdicSelection('MSAG', fixture.name);
  const initial = await readDdicEvidence(h.client, selected);
  h.world.objects.get(fixture.owner)!.metadata = xml.replace('&#65;', 'A');
  expect((await readDdicEvidence(h.client, selected)).hash).toBe(initial.hash);
  h.world.objects.get(fixture.owner)!.metadata = xml;
  const before = h.hooks.before!;
  h.hooks.before = (url, init) => {
    before(url, init);
    if (init.method === 'POST' && url.searchParams.get('_action') === 'LOCK')
      h.world.objects.get(fixture.owner)!.metadata = xml.replace('&#65;', '&amp;#65;');
  };
  const { result, payload, cleanup } = await update(h, {
    description: 'Changed description',
    expectedMetadataHash: initial.hash,
  });
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('unchanged');
  expect(puts(h)).toHaveLength(0);
  expect(cleanup.sessionClosed).toBe(true);
});
for (const [replacement, success] of [
  ['A', true],
  ['&amp;#65;', false],
] as const)
  it(`readback ${replacement} has truthful semantic confirmation`, async () => {
    const h = harness(captured.replace('Preserved message', 'Preserved &#65; message'));
    const before = h.hooks.before!;
    h.hooks.before = (url, init) => {
      before(url, init);
      if (init.method === 'GET' && url.pathname === fixture.owner && puts(h).length) {
        const object = h.world.objects.get(fixture.owner)!;
        object.metadata = object.metadata.replace('&#65;', replacement);
      }
    };
    const { result, payload, cleanup } = await update(h, { description: 'Changed description' });
    expect(!!result.isError).toBe(!success);
    expect(payload.state).toBe(success ? 'saved-active' : 'metadata-save-unknown');
    expect(puts(h)).toHaveLength(1);
    expect(cleanup.sessionClosed).toBe(true);
  });
for (const reference of ['&#0;', '&#xD800;', '&#x110000;', '&unknown;'])
  it(`refuses unsupported XML reference ${reference} before PUT`, async () => {
    const h = harness(captured.replace('Preserved message', reference));
    const { result, payload } = await update(h, { description: 'Changed description' });
    expect(result.isError).toBe(true);
    expect(payload.state).toBe('unchanged');
    expect(puts(h)).toHaveLength(0);
  });
it('numeric row identities do not hide duplicate ownership', async () => {
  const h = harness(captured.replace('mc:msgno="002"', 'mc:msgno="&#48;01"'));
  const { result } = await update(h, { description: 'Changed description' });
  expect(result.isError).toBe(true);
  expect(puts(h)).toHaveLength(0);
});

for (const reference of ['&#65', '&#x41', '&amp', '&unknown', '&'])
  it(`rejects incomplete raw XML reference ${reference} before submission`, async () => {
    const h = harness(captured.replace('Preserved message', reference));
    const { result, payload } = await update(h, { description: 'Changed description' });
    expect(result.isError).toBe(true);
    expect(payload.state).toBe('unchanged');
    expect(puts(h)).toHaveLength(0);
  });
for (const text of ['&#65', '&#x41', '&amp', '&unknown'])
  it(`preserves valid selected literal ${text} without decoding twice`, async () => {
    const h = harness();
    const { result, payload } = await update(h, {
      messages: [
        { number: '001', shortText: text },
        { number: '002', shortText: 'Preserved message' },
        { number: '003', shortText: 'Removed message' },
      ],
    });
    expect(result.isError).not.toBe(true);
    expect(payload.state).toBe('saved-active');
    expect(puts(h)).toHaveLength(1);
    expect(semanticRow(puts(h)[0].body, '001').attribute('msgtext', mc)).toBe(text);
  });
it('retains incomplete reference spellings as literal opaque CDATA and comments', async () => {
  const xml = captured.replace(
    '</mc:messageClass>',
    '<x:literal xmlns:x="urn:opaque"><![CDATA[&#65 &amp]]></x:literal><!-- &#65 &amp --></mc:messageClass>',
  );
  const h = harness(xml);
  const { result } = await update(h, { description: 'Changed description' });
  expect(result.isError).not.toBe(true);
  expect(puts(h)[0].body).toContain('<![CDATA[&#65 &amp]]>');
  expect(puts(h)[0].body).toContain('<!-- &#65 &amp -->');
});
it('uses the semantic namespace profile throughout save readback with existing and added native rows', async () => {
  const h = harness(
    captured.replace(
      'xmlns:mc="http://www.sap.com/adt/MessageClass"',
      'xmlns:mc="http://www.sap.com/adt/Message&#67;lass"',
    ),
  );
  const { result, payload, cleanup } = await update(h);
  expect(result.isError).not.toBe(true);
  expect(payload.state).toBe('saved-active');
  expect(puts(h)).toHaveLength(1);
  expect(semanticRow(puts(h)[0].body, '004').attribute('msgtext', mc)).toBe('Added message');
  expect(cleanup.sessionClosed).toBe(true);
});

it('uses only exact explicit delete instructions and verifies the marker-free persisted document', async () => {
  const h = harness();
  const { payload, cleanup } = await update(h);
  expect(payload.state).toBe('saved-active');
  const body = puts(h)[0].body;
  const instructions = nativeXmlRoot(body, 'messageClass', mc, true).children('deletedmessages', mc);
  expect(instructions).toHaveLength(1);
  expect(instructions[0].canonicalValue({})).toEqual([[JSON.stringify(['attribute', mc, 'msgno']), '003']]);
  expect(rows(h.world.objects.get(fixture.owner)!.metadata).map((r) => r.attribute('msgno', mc))).toEqual([
    '001',
    '002',
    '004',
  ]);
  expect(h.world.objects.get(fixture.owner)!.metadata).not.toContain('deletedmessages');
  expect(puts(h)).toHaveLength(1);
  expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
});
it('models the observed omission-only native PUT as an upsert that retains003', async () => {
  const { nativeMessageSave } = await import('./pr1142-native-msag-store.js');
  const requested = buildMessageClassXml({
    name: fixture.name,
    description: fixture.description,
    package: '$TMP',
    messages: fixture.update.messages,
  });
  const prepared = preparePinnedMessageClassUpdate(captured, requested, { messages: true, description: false });
  const omitted = nativeMessageSave(captured, prepared.persistedBody);
  expect(
    rows(omitted)
      .map((r) => r.attribute('msgno', mc))
      .sort(),
  ).toEqual(['001', '002', '003', '004']);
  expect(() => assertSavedMessageClass(prepared.persistedBody, omitted, new Set(['004']))).toThrow();
});
it('removes a validated stored000 explicitly without defaulting a missing number to000', async () => {
  const h = harness(captured.replaceAll('003', '000'));
  expect((await update(h)).payload.state).toBe('saved-active');
  expect(
    nativeXmlRoot(puts(h)[0].body, 'messageClass', mc, true).child('deletedmessages', mc)!.attribute('msgno', mc),
  ).toBe('000');
  expect(rows(h.world.objects.get(fixture.owner)!.metadata).some((r) => r.attribute('msgno', mc) === '000')).toBe(
    false,
  );
});
it('description-only emits no deletion instruction and keeps every row', async () => {
  const h = harness();
  expect((await update(h, { description: 'Description only' })).payload.state).toBe('saved-active');
  expect(puts(h)[0].body).not.toContain('deletedmessages');
  expect(rows(h.world.objects.get(fixture.owner)!.metadata)).toHaveLength(3);
});
it.each(['', '3', '003 ', '0000', '003.0'])(
  'refuses malformed stored removal identity %s with no PUT',
  async (number) => {
    const h = harness(captured.replace('mc:msgno="003"', number ? `mc:msgno="${number}"` : ''));
    const { result, cleanup } = await update(h);
    expect(result.isError).toBe(true);
    expect(puts(h)).toHaveLength(0);
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  },
);
it.each(['corrno', 'lockhandle'])(
  'refuses native operational %s by expanded name before PUT and cleans its lock',
  async (name) => {
    for (const value of ['FOREIGN', ' ', '  ', '&#32;']) {
      const xml = captured.replace('mc:msgno="002"', `mc:msgno="002" op:${name}="${value}" xmlns:op="${mc}"`);
      const h = harness(xml);
      const { result, cleanup } = await update(h, { description: 'Description only' });
      expect(result.isError).toBe(true);
      expect(puts(h)).toHaveLength(0);
      expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
    }
  },
);
it('preserves inert empty operational attributes and unrelated foreign names', async () => {
  const h = harness(
    captured.replace(
      'mc:msgno="002"',
      `mc:msgno="002" mc:corrno="" mc:lockhandle="" x:corrno="FOREIGN-OPAQUE" x:lockhandle="OPAQUE" xmlns:x="urn:opaque"`,
    ),
  );
  expect((await update(h)).payload.state).toBe('saved-active');
  expect(puts(h)[0].body).toContain('mc:corrno=""');
  expect(puts(h)[0].body).toContain('mc:lockhandle=""');
  expect(puts(h)[0].body).toContain('x:corrno="FOREIGN-OPAQUE"');
  expect(puts(h)[0].body).toContain('x:lockhandle="OPAQUE"');
});
it.each(['messages', 'description'])(
  'refuses the native long-text deletion flag pair for %s-only edits',
  async (selection) => {
    const h = harness(captured.replace('mc:documented="false"', 'mc:documented="true"'));
    const { result, cleanup } = await update(
      h,
      selection === 'description' ? { description: 'Description only' } : fixture.update,
    );
    expect(result.isError).toBe(true);
    expect(puts(h)).toHaveLength(0);
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  },
);
it('preserves a foreign true flag without treating it as a native long-text instruction', async () => {
  const h = harness(captured.replace('mc:msgno="002"', 'mc:msgno="002" x:documented="true" xmlns:x="urn:opaque"'));
  expect((await update(h)).payload.state).toBe('saved-active');
  expect(puts(h)[0].body).toContain('x:documented="true"');
});
it.each(['', 'mc:msgno="003"', 'mc:msgno="003" mc:corrno="FOREIGN"'])(
  'refuses stored transient deletion instructions %s before PUT',
  async (attrs) => {
    const h = harness(captured.replace('</mc:messageClass>', `<mc:deletedmessages ${attrs}/></mc:messageClass>`));
    const { result, cleanup } = await update(h);
    expect(result.isError).toBe(true);
    expect(puts(h)).toHaveLength(0);
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  },
);
it('never accepts caller-supplied transient instructions in the requested document', () => {
  const requested = buildMessageClassXml({
    name: fixture.name,
    description: fixture.description,
    package: '$TMP',
    messages: fixture.update.messages,
  }).replace('</mc:messageClass>', '<mc:deletedmessages mc:msgno="999"/></mc:messageClass>');
  expect(() => preparePinnedMessageClassUpdate(captured, requested, { messages: true, description: false })).toThrow(
    'deletion instructions',
  );
});
it('uses the captured four-row native state to remove only003 while retaining001/002/004 and bookkeeping', async () => {
  const xml = readFileSync(
    new URL('../../fixtures/ddic-collections/msag-native-four-rows.xml', import.meta.url),
    'utf8',
  );
  const h = harness(xml);
  const { result, payload, cleanup } = await update(h);
  expect(result.isError).not.toBe(true);
  expect(payload.state).toBe('saved-active');
  const wire = puts(h)[0].body,
    saved = h.world.objects.get(fixture.owner)!.metadata;
  expect(
    nativeXmlRoot(wire, 'messageClass', mc, true)
      .children('deletedmessages', mc)
      .map((n) => n.attribute('msgno', mc)),
  ).toEqual(['003']);
  for (const number of ['001', '002', '004']) expect(native(saved, number)).toEqual(native(xml, number));
  expect(puts(h)).toHaveLength(1);
  expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
});
it('reports unknown without replay if native readback retains the explicitly removed row', async () => {
  const h = harness(),
    previous = h.hooks.before!;
  h.hooks.before = (url, init) => {
    previous(url, init);
    if (init.method === 'GET' && url.pathname === fixture.owner && puts(h).length) {
      h.world.objects.get(fixture.owner)!.metadata = readFileSync(
        new URL('../../fixtures/ddic-collections/msag-native-four-rows.xml', import.meta.url),
        'utf8',
      );
    }
  };
  const { result, payload, cleanup } = await update(h);
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('metadata-save-unknown');
  expect(puts(h)).toHaveLength(1);
  expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
});
it('does not accept deletion instructions returned as persisted metadata after one PUT', async () => {
  const h = harness(),
    previous = h.hooks.before!;
  h.hooks.before = (url, init) => {
    previous(url, init);
    if (init.method === 'GET' && url.pathname === fixture.owner && puts(h).length) {
      const o = h.world.objects.get(fixture.owner)!;
      if (!o.metadata.includes('deletedmessages'))
        o.metadata = o.metadata.replace('</mc:messageClass>', '<mc:deletedmessages mc:msgno="003"/></mc:messageClass>');
    }
  };
  const { result, payload, cleanup } = await update(h);
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('metadata-save-unknown');
  expect(puts(h)).toHaveLength(1);
  expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
});
it('keeps marker-like literal/foreign opaque state without authorizing extra native deletion', async () => {
  const xml = captured.replace(
    '</mc:messageClass>',
    '<x:future xmlns:x="urn:opaque" x:note="mc:deletedmessages">deletedmessages</x:future></mc:messageClass>',
  );
  const h = harness(xml);
  expect((await update(h)).payload.state).toBe('saved-active');
  expect(puts(h)[0].body).toContain('x:note="mc:deletedmessages"');
  expect(nativeXmlRoot(puts(h)[0].body, 'messageClass', mc, true).children('deletedmessages', mc)).toHaveLength(1);
});
