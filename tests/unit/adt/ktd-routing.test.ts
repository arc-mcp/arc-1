import { describe, expect, it } from 'vitest';
import {
  decodeKtdText,
  formatKtdNodeIndex,
  formatKtdShortTexts,
  KTD_META_MARKER,
  rewriteKtdDocument,
  rewriteKtdText,
} from '../../../src/adt/ddic-xml.js';

const ROOT = 'ZBDEF';
const BASE = '/sap/bc/adt/bo/behaviordefinitions/zbdef/source/main';
const ACTION = `${BASE}#type=BDEF/BAC;name=ZBDEF.SetPhoto`;
const CASE_TWIN = `${BASE}#type=BDEF/BAC;name=ZBDEF.SETPHOTO`;
const b64 = (text: string) => Buffer.from(text).toString('base64');
const node = (id: string, text: string, shortText = text) =>
  `<sktd:element><sktd:id>${id}</sktd:id><sktd:text>${b64(text)}</sktd:text>` +
  `<sktd:shortText sktd:text="${b64(shortText)}" sktd:obligation="optional"/></sktd:element>`;
const envelope = (...nodes: string[]) => `<sktd:docu adtcore:name="${ROOT}">${nodes.join('')}</sktd:docu>`;

describe('KTD routing identity', () => {
  const original = envelope(node(ROOT, 'root'), node(ACTION, 'first'), node(CASE_TWIN, 'second'));

  it('writes a body and short text to the same exact element when IDs differ only by case', () => {
    expect(rewriteKtdDocument(original, `## ${CASE_TWIN}\n\nnew body`, [{ node: CASE_TWIN, text: 'new label' }])).toBe(
      envelope(node(ROOT, 'root'), node(ACTION, 'first'), node(CASE_TWIN, 'new body', 'new label')),
    );
  });

  it('round-trips distinct case-variant IDs and prints an exact address for each', () => {
    const index = formatKtdNodeIndex(original);
    expect(index).toContain(ACTION);
    expect(index).toContain(CASE_TWIN);
    expect(formatKtdShortTexts(original)).toContain(`  ${ACTION} [optional]: first`);
    expect(formatKtdShortTexts(original)).toContain(`  ${CASE_TWIN} [optional]: second`);
    expect(rewriteKtdText(original, `${decodeKtdText(original)}\n\n${KTD_META_MARKER}\n${index}`)).toBe(original);
  });

  it.each([ACTION.toUpperCase(), 'zbdef.setphoto'])(
    'refuses an ambiguous case-insensitive alias on both write surfaces: %s',
    (ref) => {
      expect(() => rewriteKtdText(original, `## ${ref}\n\nnew`)).toThrow(/ambiguous/);
      expect(() => rewriteKtdDocument(original, undefined, [{ node: ref, text: 'new' }])).toThrow(/ambiguous/);
    },
  );

  it('still accepts case-insensitive aliases when exactly one element matches', () => {
    const unique = envelope(node(ROOT, 'root'), node(ACTION, 'first'));
    const updated = rewriteKtdDocument(unique, `## ${ACTION.toUpperCase()}\n\nnew body`, [
      { node: 'zbdef.setphoto', text: 'new label' },
    ]);
    expect(updated).toBe(envelope(node(ROOT, 'root'), node(ACTION, 'new body', 'new label')));
  });

  it('keeps a route heading when the only writable empty sibling differs by case', () => {
    const onlyChild = envelope(node(ACTION, 'first'), node(CASE_TWIN, ''));
    const read = decodeKtdText(onlyChild);
    expect(read).toBe(`## ${ACTION}\n\nfirst`);
    expect(rewriteKtdText(onlyChild, `${read}\n\n## ${CASE_TWIN}\n\nsecond`)).toBe(
      envelope(node(ACTION, 'first'), node(CASE_TWIN, 'second', '')),
    );
  });

  it('refuses duplicate exact IDs instead of modifying multiple elements', () => {
    const duplicate = envelope(node(ROOT, 'root'), node(ACTION, 'first'), node(ACTION, 'second'));
    expect(() => rewriteKtdText(duplicate, `## ${ACTION}\n\nnew`)).toThrow(/duplicate.*id/i);
    expect(() => rewriteKtdDocument(duplicate, undefined, [{ node: ACTION, text: 'new' }])).toThrow(/duplicate.*id/i);
  });
});

describe('KTD bulk name updates', () => {
  it('updates a 91-node document twice by indexed names without accumulating old revisions', () => {
    const ids = [ROOT, ...Array.from({ length: 90 }, (_, i) => `${BASE}#type=BDEF/BAC;name=ZBDEF.Action${i}`)];
    let current = envelope(...ids.map((id) => node(id, 'revision 1')));
    for (const revision of [2, 3]) {
      const source = ids.map((id) => `## ${id.split(';name=').at(-1)}\n\nrevision ${revision}`).join('\n\n');
      current = rewriteKtdText(current, source);
      expect(current).toBe(envelope(...ids.map((id) => node(id, `revision ${revision}`, 'revision 1'))));
      expect(
        rewriteKtdText(current, `${decodeKtdText(current)}\n\n${KTD_META_MARKER}\n${formatKtdNodeIndex(current)}`),
      ).toBe(current);
    }
  });
});

describe('KTD unknown-route refusal', () => {
  const original = envelope(node(ROOT, 'root'), node(ACTION, 'first'));
  const unknown = [
    `${ACTION.toUpperCase()}X`,
    '/SAP/BC/ADT/missing',
    '#TYPE=BDEF/BAC;NAME=ZBDEF.Missing',
    'ZBDEF.SetPhoto.extra',
  ];

  it.each(unknown)('refuses the entire rewrite for a node-shaped typo: %s', (ref) => {
    expect(() => rewriteKtdText(original, `## ${ROOT}\n\nroot v2\n\n## ${ref}\n\nmisrouted text`)).toThrow(
      /does not exist/,
    );
  });

  it.each(unknown)('round-trips the same heading when it is stored prose: %s', (ref) => {
    const stored = envelope(node(ROOT, `Introduction\n\n## ${ref}\n\nExample`), node(ACTION, 'first'));
    const read = decodeKtdText(stored);
    expect(read).toContain(`\\## ${ref}`);
    expect(rewriteKtdText(stored, read)).toBe(stored);
  });
});
