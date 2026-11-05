/** Additional fixed CTS/move/API routes; the existing local graph fence stays the default. */
import { buildApiReleasePutBody } from '../../../src/adt/api-release.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { buildExecuteXml, buildPreviewXml } from '../../../src/adt/refactoring.js';
import { editableSourceEquals } from '../../../src/adt/source-precondition.js';
import { escapeXmlAttr } from '../../../src/adt/xml-parser.js';
import { buildCreateXml } from '../../../src/handlers/write-helpers.js';
import type { PackageApiActions } from './native-package-api-actions.js';
import {
  apiDocumentPath,
  type PackageLifecycleStage,
  packageApiDescription,
  packageApiExtraStage,
  packageApiInterface,
  RECORDED_PACKAGE,
  RECORDED_PACKAGE_URI,
} from './native-package-api-profile.js';
import type { PackageGraph, PackageStage } from './native-package-fixtures.js';
import { checkPackageRequest, packageUnlock } from './native-package-transport.js';

export function checkPackageApiRequest(
  graph: PackageGraph,
  stage: PackageLifecycleStage | undefined,
  method: string,
  path: string,
  body?: string,
  state?: ReturnType<PackageApiActions['scope']>,
) {
  const uri = new URL(path, 'https://a4h.marianzeis.de'),
    keys = [...uri.searchParams.keys()];
  if (
    !path.startsWith('/sap/bc/adt/') ||
    uri.pathname !== path.split('?')[0] ||
    path.includes('#') ||
    path.includes('\\') ||
    new Set(keys).size !== keys.length ||
    keys.some((k) => ['sap-user', 'sap-client', 'sap-password'].includes(k.toLowerCase()))
  )
    throw new Error('Fixed package API request identity.');
  const parse = (xml: string, name: string, ns: string) =>
    JSON.stringify(nativeXmlRoot(xml, name, ns, true).canonicalValue({}));
  const abap = (xml: string) => parse(xml, 'abap', 'http://www.sap.com/abapxml');
  const intf = packageApiInterface(graph);
  if (
    method === 'GET' &&
    [intf.owner, `${intf.owner}/source/main`].includes(uri.pathname) &&
    (keys.length === 0 || (keys.length === 1 && ['active', 'inactive'].includes(uri.searchParams.get('version') ?? '')))
  )
    return;
  if (packageApiUnlock(graph, stage, method, path)) return;
  if (stage === 'batch-create' || stage === 'delete-interface') {
    const objects = stage === 'batch-create' ? [intf, graph.clas] : [intf];
    if (
      method === 'POST' &&
      objects.some((o) => o.owner === uri.pathname) &&
      keys.length === 2 &&
      uri.searchParams.get('_action') === 'LOCK' &&
      uri.searchParams.get('accessMode') === 'MODIFY'
    )
      return;
    if (method === 'POST' && uri.pathname === '/sap/bc/adt/cts/transportchecks' && !keys.length) {
      for (const owner of objects)
        for (const op of ['I', '']) {
          const expected = `<a:abap xmlns:a="http://www.sap.com/abapxml" version="1.0"><a:values><DATA><DEVCLASS>${owner.parent}</DEVCLASS><URI>${owner.owner}</URI><OPERATION>${op}</OPERATION></DATA></a:values></a:abap>`;
          if (abap(body ?? '') === abap(expected)) return;
        }
    }
    if (
      stage === 'delete-interface' &&
      method === 'DELETE' &&
      uri.pathname === intf.owner &&
      keys.length === 1 &&
      uri.searchParams.get('lockHandle')
    )
      return;
    if (stage === 'batch-create')
      for (const owner of objects) {
        if (
          method === 'POST' &&
          uri.pathname === owner.owner.slice(0, owner.owner.lastIndexOf('/')) &&
          (keys.length === 0 || (keys.length === 1 && uri.searchParams.get('_package') === owner.parent))
        ) {
          const type = owner.kind === 'interface' ? 'INTF' : 'CLAS',
            root = type === 'INTF' ? 'abapInterface' : 'abapClass',
            ns = `http://www.sap.com/adt/oo/${type === 'INTF' ? 'interfaces' : 'classes'}`;
          if (
            parse(body ?? '', root, ns) ===
            parse(buildCreateXml(type, owner.name, owner.parent, owner.description, undefined, 'EN'), root, ns)
          )
            return;
        }
        if (
          method === 'PUT' &&
          uri.pathname === `${owner.owner}/source/main` &&
          keys.length === 1 &&
          uri.searchParams.get('lockHandle') &&
          editableSourceEquals(body ?? '', owner.source)
        )
          return;
      }
    if (
      stage === 'batch-create' &&
      method === 'POST' &&
      uri.pathname === '/sap/bc/adt/activation' &&
      keys.length === 2 &&
      uri.searchParams.get('method') === 'activate' &&
      ['true', 'false'].includes(uri.searchParams.get('preauditRequested') ?? '')
    ) {
      const core = 'http://www.sap.com/adt/core',
        refs = nativeXmlRoot(body ?? '', 'objectReferences', core, true).children('objectReference', core);
      const paths = refs.map((r) => r.attribute('uri', core));
      const allowed = new Map<string, string>([
        [intf.owner, 'INTF/OI'],
        [graph.clas.owner, 'CLAS/OC'],
        ...['definitions', 'implementations', 'macros', 'testclasses'].map(
          (i) => [`${graph.clas.owner}/includes/${i}`, 'CLAS/I'] as const,
        ),
      ]);
      if (
        refs.length >= 2 &&
        refs.length <= 6 &&
        new Set(paths).size === refs.length &&
        paths.includes(intf.owner) &&
        paths.some((p) => !!p && p.startsWith(graph.clas.owner)) &&
        refs.every((r) => {
          const p = r.attribute('uri', core);
          return (
            !!p &&
            allowed.has(p) &&
            [undefined, allowed.get(p)].includes(r.attribute('type', core)) &&
            [undefined, 'false'].includes(r.attribute('deleted', core)) &&
            (p !== intf.owner || r.attribute('name', core) === intf.name) &&
            (p !== graph.clas.owner || r.attribute('name', core) === graph.clas.name)
          );
        })
      )
        return;
    }
  }
  if (
    method === 'GET' &&
    !keys.length &&
    (uri.pathname === RECORDED_PACKAGE_URI ||
      (state?.request &&
        [state.request, state.task, state.originalTask]
          .filter(Boolean)
          .some((id) => uri.pathname === `/sap/bc/adt/cts/transportrequests/${id}`)) ||
      (state?.moved && uri.pathname === apiDocumentPath(graph)))
  )
    return;
  if (
    stage === 'create-request' &&
    method === 'POST' &&
    uri.pathname === '/sap/bc/adt/cts/transports' &&
    !keys.length
  ) {
    const expected = `<a:abap xmlns:a="http://www.sap.com/abapxml" version="1.0"><a:values><DATA><DEVCLASS>${RECORDED_PACKAGE}</DEVCLASS><REQUEST_TEXT>${packageApiDescription(graph)}</REQUEST_TEXT><REF/><OPERATION>I</OPERATION></DATA></a:values></a:abap>`;
    if (abap(body ?? '') === abap(expected)) return;
  }
  if (
    state?.request &&
    stage &&
    ['move-class', 'release-api', 'revoke-api', 'delete-class'].includes(stage) &&
    method === 'POST' &&
    uri.pathname === '/sap/bc/adt/cts/transportchecks' &&
    !keys.length
  ) {
    const selections =
      stage === 'move-class'
        ? [
            [graph.clas.owner, graph.child.name, ''],
            [graph.clas.owner, RECORDED_PACKAGE, 'I'],
          ]
        : [[stage === 'delete-class' ? graph.clas.owner : state.apiResource, RECORDED_PACKAGE, '']];
    for (const [resource, pkg, operation] of selections) {
      if (!resource) continue;
      const expected = `<a:abap xmlns:a="http://www.sap.com/abapxml" version="1.0"><a:values><DATA><DEVCLASS>${pkg}</DEVCLASS><URI>${escapeXmlAttr(resource)}</URI><OPERATION>${operation}</OPERATION></DATA></a:values></a:abap>`;
      if (abap(body ?? '') === abap(expected)) return;
    }
  }
  if (stage === 'move-class' && state?.request && method === 'POST' && uri.pathname === '/sap/bc/adt/refactorings') {
    const params = {
      objectUri: graph.clas.owner,
      objectType: 'CLAS/OC',
      objectName: graph.clas.name,
      oldPackage: graph.child.name,
      newPackage: RECORDED_PACKAGE,
      transport: state.request,
      description: graph.clas.description,
    };
    if (
      keys.length === 2 &&
      uri.searchParams.get('step') === 'preview' &&
      uri.searchParams.get('rel') === 'http://www.sap.com/adt/relations/refactoring/changepackage' &&
      body === buildPreviewXml(params)
    )
      return;
    if (keys.length === 1 && uri.searchParams.get('step') === 'execute' && body === buildExecuteXml(params)) return;
  }
  if (
    (stage === 'release-api' || stage === 'revoke-api') &&
    state?.request &&
    state.apiBody &&
    method === 'PUT' &&
    uri.pathname === `${apiDocumentPath(graph)}/c1` &&
    keys.length === 1 &&
    uri.searchParams.get('request') === state.request &&
    body ===
      buildApiReleasePutBody(
        state.apiBody,
        'C1',
        stage === 'release-api' ? 'RELEASED' : 'NOT_RELEASED',
        stage === 'release-api' ? ['cloudDevelopment'] : undefined,
      )
  )
    return;
  if (
    stage === 'delete-class' &&
    state?.moved &&
    state.request &&
    method === 'DELETE' &&
    uri.pathname === graph.clas.owner &&
    keys.length === 2 &&
    uri.searchParams.get('lockHandle') &&
    uri.searchParams.get('corrNr') === state.request
  )
    return;
  // Additional stages admit only the old read fence, never its mutations. The one moved class
  // must use the recorded DELETE branch above rather than falling back to a local DELETE.
  if (stage === 'delete-class' && state?.moved && method === 'DELETE')
    throw new Error('Recorded delete request mismatch.');
  checkPackageRequest(
    graph,
    stage && !packageApiExtraStage(stage) ? (stage as PackageStage) : undefined,
    method,
    path,
    body,
  );
}

export function packageApiUnlock(
  graph: PackageGraph,
  stage: PackageLifecycleStage | undefined,
  method: string,
  path: string,
) {
  const uri = new URL(path, 'https://a4h.marianzeis.de');
  if (
    (stage === 'batch-create' || stage === 'delete-interface') &&
    method === 'POST' &&
    uri.pathname === packageApiInterface(graph).owner &&
    [...uri.searchParams.keys()].length === 2 &&
    uri.searchParams.get('_action') === 'UNLOCK' &&
    uri.searchParams.get('lockHandle')
  )
    return true;
  return packageUnlock(graph, stage, method, path);
}
