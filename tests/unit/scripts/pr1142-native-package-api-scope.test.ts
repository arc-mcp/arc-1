import { expect, it } from 'vitest';
import {
  apiDocumentPath,
  packageApiInterface,
} from '../../../scripts/qualification/pr1142/native-package-api-profile.js';
import { checkPackageApiRequest } from '../../../scripts/qualification/pr1142/native-package-api-transport.js';
import { buildApiReleasePutBody } from '../../../src/adt/api-release.js';
import { buildExecuteXml } from '../../../src/adt/refactoring.js';
import { apiXml, graph } from './pr1142-native-package-api-harness.js';

const state = {
  request: 'A4HK999991',
  task: 'A4HK999992',
  apiResource: '/sap/bc/adt/apireleases/apis/OWN',
  apiBody: apiXml(),
  moved: true,
};
it.each([
  ['POST', '/sap/bc/adt/cts/transportrequests/A4HK999991?action=release', ''],
  ['DELETE', '/sap/bc/adt/cts/transportrequests/A4HK999991', ''],
  ['GET', '/sap/bc/adt/cts/transportrequests/A4HK906605', ''],
  ['GET', '/sap/bc/adt/packages/OTHER', ''],
  ['GET', `${graph.clas.owner}?sap-client=002`, ''],
  ['DELETE', `${graph.clas.owner}?lockHandle=H&corrNr=A4HK906605`, ''],
  ['DELETE', '/sap/bc/adt/packages/ZARC1_DEMO?lockHandle=H', ''],
])('refuses uncompiled route %s %s', (method, path, body) => {
  expect(() => checkPackageApiRequest(graph, 'delete-class', method, path, body, state)).toThrow();
});
it('binds a move body to the exact old/new package, class and generated parent', () => {
  const params = {
    objectUri: graph.clas.owner,
    objectType: 'CLAS/OC',
    objectName: graph.clas.name,
    oldPackage: graph.child.name,
    newPackage: 'ZARC1_DEMO',
    transport: state.request,
    description: graph.clas.description,
  };
  expect(() =>
    checkPackageApiRequest(
      graph,
      'move-class',
      'POST',
      '/sap/bc/adt/refactorings?step=execute',
      buildExecuteXml(params),
      state,
    ),
  ).not.toThrow();
  for (const change of [
    { newPackage: 'OTHER' },
    { transport: 'A4HK906605' },
    { objectName: 'OTHER' },
    { oldPackage: '$TMP' },
  ])
    expect(() =>
      checkPackageApiRequest(
        graph,
        'move-class',
        'POST',
        '/sap/bc/adt/refactorings?step=execute',
        buildExecuteXml({ ...params, ...change }),
        state,
      ),
    ).toThrow();
});
it('admits only the observed C1 body and no stale-stage PUT', () => {
  const body = buildApiReleasePutBody(state.apiBody, 'C1', 'RELEASED', ['cloudDevelopment']);
  const path = `${apiDocumentPath(graph)}/c1?request=${state.request}`;
  expect(() => checkPackageApiRequest(graph, 'release-api', 'PUT', path, body, state)).not.toThrow();
  expect(() => checkPackageApiRequest(graph, 'stale-api', 'PUT', path, body, state)).toThrow();
  expect(() =>
    checkPackageApiRequest(
      graph,
      'release-api',
      'PUT',
      path,
      body.replace('ars:useInKeyUserApps="false"', 'ars:useInKeyUserApps="true"'),
      state,
    ),
  ).toThrow();
});
it('admits only the two declared batch activation owners', () => {
  const intf = packageApiInterface(graph),
    core = 'http://www.sap.com/adt/core';
  const body = (name = graph.clas.name, uri = graph.clas.owner) =>
    `<c:objectReferences xmlns:c="${core}"><c:objectReference c:uri="${intf.owner}" c:name="${intf.name}"/><c:objectReference c:uri="${uri}" c:name="${name}"/></c:objectReferences>`;
  const path = '/sap/bc/adt/activation?method=activate&preauditRequested=false';
  expect(() => checkPackageApiRequest(graph, 'batch-create', 'POST', path, body(), state)).not.toThrow();
  expect(() =>
    checkPackageApiRequest(graph, 'batch-create', 'POST', path, body('OTHER', '/sap/bc/adt/oo/classes/other'), state),
  ).toThrow();
});
