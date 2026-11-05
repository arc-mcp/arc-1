import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assertCtsOwnedTree, inspectCtsTree } from '../../../scripts/qualification/pr1142/native-cts-evidence.js';
import {
  CTS_BASE,
  CTS_RETAINED_SUFFIX,
  ctsFixtures,
  retainedCtsRequest,
} from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import {
  CTS_A_RELEASE_WITNESS,
  CtsReleaseBookkeeping,
  nativeCtsTime,
} from '../../../scripts/qualification/pr1142/native-cts-release-bookkeeping.js';

const graph = ctsFixtures(CTS_RETAINED_SUFFIX),
  own = retainedCtsRequest('retained-v5');
const body = readFileSync(new URL('../../fixtures/qualification/cts-retained-v5/parent.xml', import.meta.url), 'utf8');
function accepts(xml: string) {
  const p = new CtsReleaseBookkeeping(graph),
    tree = inspectCtsTree(xml, own.parent);
  p.observe(xml, CTS_BASE + own.parent, tree, own);
  p.assertTree(tree, own);
}
it('keeps the old qualifier refusal and admits only the compiled v5 proof', () => {
  const tree = inspectCtsTree(body, own.parent);
  expect(() => assertCtsOwnedTree(tree, own, graph)).toThrow('Unproven CTS');
  expect(() => accepts(body)).not.toThrow();
});
it('namespace aliases preserve actual finite identity', () =>
  expect(() => accepts(body.replaceAll('tm:', 'organizer:').replace('xmlns:tm=', 'xmlns:organizer='))).not.toThrow());
it.each([
  ['date', (s: string) => s.replace('20261105 014315', '20261106 014315')],
  ['time', (s: string) => s.replace('20261105 014315', '20261105 014316')],
  ['user', (s: string) => s.replace('014315 MARIAN', '014315 OTHER')],
  ['task', (s: string) => s.replace('A4HK906608 20261105', 'A4HK906606 20261105')],
  ['pgmid', (s: string) => s.replace('tm:pgmid="CORR"', 'tm:pgmid="R3TR"')],
  ['type', (s: string) => s.replace('tm:type="RELE"', 'tm:type="CLAS"')],
  ['position', (s: string) => s.replace('tm:position="000001"', 'tm:position="000002"')],
  ['missing-lock', (s: string) => s.replace('tm:lock_status=""', '')],
  ['ambiguous-lock', (s: string) => s.replace('tm:lock_status=""', 'tm:lock_status="?"')],
  ['locked', (s: string) => s.replace('tm:lock_status=""', 'tm:lock_status="X"')],
  ['unknown-attribute', (s: string) => s.replace('tm:pgmid="CORR"', 'tm:pgmid="CORR" tm:extra="yes"')],
  ['uri', (s: string) => s.replace('obj_wbtype=RELE', 'obj_wbtype=CLAS')],
  [
    'foreign-link',
    (s: string) =>
      s.replaceAll(
        'href="/sap/bc/adt/cts/transportrequests/A4HK906607"',
        'href="/sap/bc/adt/cts/transportrequests/A4HK906606"',
      ),
  ],
  [
    'duplicate-comment',
    (s: string) =>
      s.replace(
        '<tm:all_objects>',
        s.match(/<tm:abap_object[^>]*tm:pgmid="CORR"[\s\S]*?<\/tm:abap_object>/)![0] + '<tm:all_objects>',
      ),
  ],
  ['foreign-row', (s: string) => s.replace('R3TR', 'LIMU')],
  [
    'wrong-task-time',
    (s: string) =>
      s.replaceAll('tm:lastchanged_timestamp="20261105014315"', 'tm:lastchanged_timestamp="20261105014316"'),
  ],
  ['coherent-date-drift', (s: string) => s.replaceAll('20261105', '20261106')],
] as const)('refuses %s in actual complete parent', (_name, change) => expect(() => accepts(change(body))).toThrow());
it.each([
  '00001105014315',
  '20260229014315',
  '20261301014315',
  '20261100014315',
  '20261105244315',
  '20261105016015',
  '20261105014360',
  '2026110501431',
  ' 20261105014315',
  '20261105014315 ',
])('refuses malformed native date %s', (s) => expect(() => nativeCtsTime(s)).toThrow());
it.each(['20240229000000', '20261105014315'])('accepts calendar-valid native date %s', (s) =>
  expect(Number.isFinite(nativeCtsTime(s))).toBe(true),
);
it.each([
  { timestamp: '20261105014313' },
  { timestamp: '20261105014716', maxNativeSeconds: 240 },
  { reportTimestamp: '20261105014314  ' },
  { reportTimestamp: '20261105014314Z' },
  { maxNativeSeconds: 241 },
  { maxNativeSeconds: 0 },
  { task: 'A4HK906607' },
])('refuses impossible or expanded witness %j', (change) =>
  expect(() => new CtsReleaseBookkeeping(graph, [{ ...CTS_A_RELEASE_WITNESS, ...change }])).toThrow(),
);
it.each([
  ['20261105014714', false],
  ['20261105014715', true],
] as const)('frozen native second budget %s, refusal=%s', (timestamp, refused) => {
  const owner = {
    round: 'B' as const,
    parent: 'A4HK906620',
    task: 'A4HK906621',
    description: graph.descriptions.B,
    taskType: 'Development/Correction',
  };
  const proof = { ...CTS_A_RELEASE_WITNESS, parent: owner.parent, task: owner.task, timestamp };
  const action = () => new CtsReleaseBookkeeping(graph, [proof], [owner]);
  if (refused) expect(action).toThrow('chronology');
  else expect(action).not.toThrow();
});
