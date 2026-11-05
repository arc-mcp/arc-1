/** Owned captured organizer metadata. No native execution or authority is taken from Atom links. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  assertCtsSummaries,
  assertEmptyCtsGraph,
  inspectCtsTree,
} from '../../../scripts/qualification/pr1142/native-cts-evidence.js';
import {
  CTS_RETAINED_SUFFIX,
  ctsFixtures,
  retainedCtsRequest,
} from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { parseCtsTree } from '../../../src/adt/pinned-cts-evidence.js';

const body = readFileSync(new URL('../../fixtures/qualification/cts-retained-v3/parent.xml', import.meta.url), 'utf8');
const graph = ctsFixtures(CTS_RETAINED_SUFFIX),
  own = { ...retainedCtsRequest(), taskType: 'Development/Correction' };
const tm = 'http://www.sap.com/cts/adt/tm';
const summary = /<tm:all_objects>[\s\S]*?<\/tm:all_objects>/.exec(body)![0];
const alter = (rewrite: (value: string) => string) => body.replace(summary, rewrite(summary));
it('accepts the saved complete native summary with three inert exact member links', () => {
  const tree = inspectCtsTree(body, own.parent);
  expect(tree).toMatchObject({ ...parseCtsTree(body, own.parent), summaryRows: 1 });
  expect(tree.tasks[0].objects).toHaveLength(1);
  expect(() => assertEmptyCtsGraph(tree)).toThrow();
  expect(() => assertCtsSummaries(body, own, graph)).not.toThrow();
  const root = nativeXmlRoot(body, 'root', tm, true);
  expect(
    root
      .child('request', tm)!
      .child('all_objects', tm)!
      .child('abap_object', tm)!
      .children('link', 'http://www.w3.org/2005/Atom'),
  ).toHaveLength(3);
});
it.each([
  [
    'foreign summary namespace',
    (s: string) => s.replace('<tm:all_objects>', '<tm:all_objects xmlns:tm="urn:foreign">'),
  ],
  [
    'nested summary record',
    (s: string) => s.replace('</tm:abap_object>', '<tm:abap_object tm:name="FOREIGN"/></tm:abap_object>'),
  ],
  [
    'foreign record',
    (s: string) =>
      s
        .replace('<tm:abap_object ', '<x:abap_object xmlns:x="urn:foreign" ')
        .replace('</tm:abap_object>', '</x:abap_object>'),
  ],
  [
    'link to a foreign request',
    (s: string) => s.replace('transportrequests/A4HK906608', 'transportrequests/A4HK999999'),
  ],
  ['absolute link', (s: string) => s.replace('href="/sap', 'href="https://foreign.invalid/sap')],
  ['pagination link', (s: string) => s.replace('http://www.sap.com/cts/relations/removeobject', 'next')],
  ['bare relation', (s: string) => s.replace('http://www.sap.com/cts/relations/removeobject', 'removeobject')],
  ['unknown attribute', (s: string) => s.replace('<tm:abap_object ', '<tm:abap_object tm:hasMore="true" ')],
  ['unknown nested link shape', (s: string) => s.replace('/>', '><tm:abap_object tm:name="FOREIGN"/></atom:link>')],
  [
    'duplicate record',
    (s: string) =>
      s.replace('</tm:all_objects>', /<tm:abap_object[\s\S]*?<\/tm:abap_object>/.exec(s)![0] + '</tm:all_objects>'),
  ],
  ['meaningful summary text', (s: string) => s.replace('</tm:all_objects>', 'hidden</tm:all_objects>')],
  ['meaningful record text', (s: string) => s.replace('</tm:abap_object>', 'hidden</tm:abap_object>')],
  ['meaningful link attribute', (s: string) => s.replace('<atom:link ', '<atom:link more="true" ')],
] as const)('refuses %s', (_name, rewrite) => {
  expect(() => inspectCtsTree(alter(rewrite), own.parent)).toThrow();
});
it('never grants a foreign summary object or LIMU ownership from valid navigation', () => {
  for (const s of [
    summary.replace(own.parent, 'A4HK999999').replace(graph.classes[0].name, 'FOREIGN'),
    summary.replace('tm:pgmid="R3TR"', 'tm:pgmid="LIMU"'),
  ]) {
    expect(() => assertCtsSummaries(body.replace(summary, s), own, graph)).toThrow();
  }
});
