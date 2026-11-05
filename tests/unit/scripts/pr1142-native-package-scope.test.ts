import { expect, it } from 'vitest';
import { graph } from './pr1142-native-package-harness.js';

const { checkPackageRequest, packageUnlock } = await import(
  '../../../scripts/qualification/pr1142/native-package-transport.js'
);
const { buildCreateXml } = await import('../../../src/handlers/write-helpers.js');
const create = () => buildCreateXml('CLAS', graph.clas.name, graph.child.name, graph.clas.description, undefined, 'EN');
it('keeps exactly three bounded owners and no TMP ancestry', () => {
  expect([graph.root.name, graph.child.name, graph.clas.name].every((n) => n.length <= 30)).toBe(true);
  expect(graph.root.parent).toBe('');
  expect(graph.child.parent).toBe(graph.root.name);
  expect(JSON.stringify(graph)).not.toContain('$TMP');
});
it.each([
  ['GET', 'https://foreign.invalid/sap/bc/adt/packages/x'],
  ['GET', '/sap/bc/adt/packages/%24FOREIGN'],
  ['GET', graph.root.owner + '?sap-client=000'],
  ['GET', graph.root.owner + '?version=active&version=inactive'],
  ['GET', graph.root.owner + '#evil'],
  ['GET', '/sap/bc/adt/../admin'],
  ['POST', '/sap/bc/adt/activation?method=activate&preauditRequested=false'],
  ['DELETE', graph.child.owner + '?lockHandle=x'],
  ['DELETE', graph.root.owner + '?lockHandle=x&corrNr=A4HK900001'],
  ['DELETE', graph.root.owner + '?lockHandle=x&cascade=true'],
  ['POST', graph.root.owner + '?_action=UNLOCK&lockHandle=x&scope=all'],
])('refuses off-scope %s %s', (method, path) => {
  expect(() => checkPackageRequest(graph, 'refuse-root-child', method, path)).toThrow();
});
it('permits one declared native negative DELETE with an owning handle only', () => {
  expect(() =>
    checkPackageRequest(graph, 'refuse-root-child', 'DELETE', graph.root.owner + '?lockHandle=x'),
  ).not.toThrow();
  expect(packageUnlock(graph, 'refuse-root-child', 'POST', graph.child.owner + '?_action=UNLOCK&lockHandle=x')).toBe(
    false,
  );
});
it('compares the complete generated CLAS create payload and refuses extra/native foreign slots', () => {
  expect(() => checkPackageRequest(graph, 'create-class', 'POST', '/sap/bc/adt/oo/classes', create())).not.toThrow();
  for (const xml of [
    create().replace('</class:abapClass>', '<adtcore:containerRef adtcore:name="FOREIGN"/></class:abapClass>'),
    create().replace(graph.child.name, '$TMP'),
    create().replace('masterLanguage="EN"', 'masterLanguage="DE"'),
  ])
    expect(() => checkPackageRequest(graph, 'create-class', 'POST', '/sap/bc/adt/oo/classes', xml)).toThrow();
});
it('allows only the declared class activation owner and owned include paths', () => {
  const body = (uri: string) =>
    `<c:objectReferences xmlns:c="http://www.sap.com/adt/core"><c:objectReference c:uri="${uri}" c:name="${graph.clas.name}"/></c:objectReferences>`;
  const path = '/sap/bc/adt/activation?method=activate&preauditRequested=true';
  expect(() => checkPackageRequest(graph, 'activate-class', 'POST', path, body(graph.clas.owner))).not.toThrow();
  for (const uri of [
    graph.root.owner,
    graph.clas.owner + 'suffix',
    graph.clas.owner + '/includes/foreign',
    '/sap/bc/adt/oo/classes/other',
  ])
    expect(() => checkPackageRequest(graph, 'activate-class', 'POST', path, body(uri))).toThrow();
});
