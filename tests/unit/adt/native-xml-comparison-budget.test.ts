import { expect, it } from 'vitest';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';

const compare = (xml: string) => nativeXmlRoot(xml, 'root', 'urn:root', true).canonicalValue({});
it('bounds namespace expansion independently of the byte limit', () => {
  const declarations = Array.from({ length: 65 }, (_, i) => `xmlns:p${i}="urn:${i}"`).join(' ');
  expect(() => compare(`<r:root xmlns:r="urn:root" ${declarations}><child/></r:root>`)).toThrow(/namespace.*budget/i);
});
it('bounds native element visits independently of nesting and bytes', () => {
  const xml = `<r:root xmlns:r="urn:root">${'<child/>'.repeat(16_384)}</r:root>`;
  expect(Buffer.byteLength(xml)).toBeLessThan(1024 * 1024);
  expect(() => compare(xml)).toThrow(/traversal.*budget/i);
});
it('preserves repeated-child order', () => {
  const xml = (values: string[]) =>
    `<r:root xmlns:r="urn:root">${values.map((v) => `<child>${v}</child>`).join('')}</r:root>`;
  expect(compare(xml(['one', 'two']))).not.toEqual(compare(xml(['two', 'one'])));
});
it.each([
  ['deep', `<r:root xmlns:r="urn:root">${'<child>'.repeat(66)}value${'</child>'.repeat(66)}</r:root>`],
  ['unbound', '<r:root xmlns:r="urn:root"><unbound:child/></r:root>'],
  [
    'duplicate attributes',
    '<r:root xmlns:r="urn:root" xmlns:a="urn:alias" xmlns:b="urn:alias" a:field="one" b:field="two"/>',
  ],
  [
    'duplicate elements',
    '<r:root xmlns:r="urn:root" xmlns:a="urn:alias" xmlns:b="urn:alias"><a:child/><b:child/></r:root>',
  ],
  [
    'inconsistent repeated binding',
    '<r:root xmlns:r="urn:root"><x:child xmlns:x="urn:one"/><x:child xmlns:x="urn:two"/></r:root>',
  ],
])('refuses %s comparison evidence', (_label, xml) => expect(() => compare(xml)).toThrow());
it('supports ordinary repeated children with inherited namespace bindings', () => {
  const xml = `<r:root xmlns:r="urn:root" xmlns:c="urn:child">${'<c:child c:field="value"/>'.repeat(1_000)}</r:root>`;
  expect(() => compare(xml)).not.toThrow();
});
