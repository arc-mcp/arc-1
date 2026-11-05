import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assertRapDocumentParentTransition } from '../../../scripts/qualification/pr1142/native-rap-document-parent.js';
import { rapDocumentFixtures } from '../../../scripts/qualification/pr1142/native-rap-documents-fixtures.js';
import type { RapReceipt } from '../../../scripts/qualification/pr1142/native-rap-evidence.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { rapHarness } from './pr1142-native-rap-harness.js';

const f = rapDocumentFixtures('8E66923BDEF5'),
  parent = f[3],
  doc = f[6];
const load = (name: string) => readFileSync(new URL(`../../fixtures/xml/${name}`, import.meta.url), 'utf8');
const beforeXml = load('bdef-before-owned-document-native.xml');
const afterXml = load('bdef-after-owned-document-native.xml');
const documentXml = load('sktd-managed-bdef-native-created.xml');
const receipt = (xml: string): RapReceipt => ({
  active: true,
  fingerprint: 'native-fixture',
  sourceHashes: { main: 'unchanged-source' },
  metadataViews: [0, 1].map(() =>
    JSON.stringify(nativeXmlRoot(xml, 'blueSource', 'http://www.sap.com/wbobj/blue', true).canonicalValue({})),
  ),
});
it('accepts only the captured same-owner link addition and its bounded inverse', () => {
  expect(() =>
    assertRapDocumentParentTransition(parent, doc, receipt(beforeXml), receipt(afterXml), true),
  ).not.toThrow();
  expect(() =>
    assertRapDocumentParentTransition(parent, doc, receipt(afterXml), receipt(beforeXml), false),
  ).not.toThrow();
});
it.each([
  'owner',
  'source',
  'version',
  'author',
  'package',
  'unknown-field',
  'extra-link-attribute',
  'foreign-link',
  'missing',
  'duplicate',
  'active-view',
])('rejects %s drift beside the expected link', (fault) => {
  let xml = afterXml;
  if (fault === 'owner') xml = xml.replace(`adtcore:name="${parent.name}"`, 'adtcore:name="FOREIGN"');
  if (fault === 'version') xml = xml.replace('adtcore:version="active"', 'adtcore:version="inactive"');
  if (fault === 'author') xml = xml.replace('adtcore:changedBy="MARIAN"', 'adtcore:changedBy="FOREIGN"');
  if (fault === 'package') xml = xml.replace('adtcore:name="$TMP"', 'adtcore:name="FOREIGN"');
  if (fault === 'unknown-field')
    xml = xml.replace('</blue:blueSource>', '<opaque xmlns="urn:native">changed</opaque></blue:blueSource>');
  if (fault === 'extra-link-attribute')
    xml = xml.replace('title="DITA Documentation"', 'title="DITA Documentation" foreign="1"');
  if (fault === 'foreign-link') xml = xml.replace(doc.owner, doc.owner + 'other');
  if (fault === 'missing') xml = beforeXml;
  if (fault === 'duplicate') {
    const link = afterXml.match(
      /<atom:link[^>]*rel="http:\/\/www.sap.com\/adt\/relations\/dita\/documentation"[^>]*\/>/,
    )![0];
    xml = xml.replace('</blue:blueSource>', link + '</blue:blueSource>');
  }
  const after = receipt(xml);
  if (fault === 'source') after.sourceHashes.main = 'changed';
  if (fault === 'active-view') after.metadataViews![1] = receipt(beforeXml).metadataViews![0];
  expect(() => assertRapDocumentParentTransition(parent, doc, receipt(beforeXml), after, true)).toThrow();
});
it('preserves an unchanged opaque field and refuses removing another native link', () => {
  const opaque = '<opaque xmlns="urn:native" value="001"> keep </opaque>';
  const add = (xml: string) => xml.replace('</blue:blueSource>', opaque + '</blue:blueSource>');
  expect(() =>
    assertRapDocumentParentTransition(parent, doc, receipt(add(beforeXml)), receipt(add(afterXml)), true),
  ).not.toThrow();
  const lost = afterXml.replace(/<atom:link[^>]*rel="http:\/\/www.sap.com\/adt\/relations\/versions"[^>]*\/>/, '');
  expect(lost).not.toBe(afterXml);
  expect(() => assertRapDocumentParentTransition(parent, doc, receipt(beforeXml), receipt(lost), true)).toThrow();
});
it.each([false, true])('replays the captured document through the real driver (proxy=%s)', async (proxy) => {
  const h = rapHarness({ documents: true, proxy });
  h.useFixtures(f);
  h.hooks.record = (row) => {
    if (row.creationAcknowledged === doc.owner) h.world.objects.get(doc.owner)!.metadata = documentXml;
  };
  const result = await h.run(f);
  expect(result).toMatchObject({ failure: false, finalAbsenceConfirmed: true, remaining: [] });
  expect(h.world.calls.filter((v) => v.method === 'PUT' && v.path.startsWith(doc.owner))).toHaveLength(3);
  expect(h.records.filter((v) => v.ownedDocumentParentTransition)).toEqual([
    expect.objectContaining({ relationPresent: true, document: doc.owner }),
    expect.objectContaining({ relationPresent: false, document: doc.owner }),
  ]);
});
it.each(['create', 'delete'])('refuses unrelated parent metadata drift at document %s', async (phase) => {
  const h = rapHarness({ documents: true });
  h.useFixtures(f);
  h.hooks.record = (row) => {
    if (
      (phase === 'create' && row.creationAcknowledged === doc.owner) ||
      (phase === 'delete' && row.adapter === 'delete-document')
    ) {
      const p = h.world.objects.get(parent.owner)!;
      p.metadata = p.metadata.replace(/(<[^!?][^>]*>)/, '$1<opaque xmlns="urn:native">changed</opaque>');
    }
  };
  const result = await h.run(f);
  expect(result.failure).toBe(true);
  if (phase === 'create')
    expect(h.world.calls.some((v) => v.method === 'PUT' && v.path.startsWith(doc.owner))).toBe(false);
  else expect(result.confirmedDeleted).toContain(doc.owner);
  expect(h.world.calls.some((v) => v.method === 'DELETE' && v.path.startsWith(parent.owner))).toBe(false);
});
