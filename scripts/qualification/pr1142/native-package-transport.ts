/** Fixed graph request admission; no public bypass, package cascade, request override or foreign activation. */
import { buildPackageXml } from '../../../src/adt/ddic-xml.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { editableSourceEquals } from '../../../src/adt/source-precondition.js';
import { buildCreateXml } from '../../../src/handlers/write-helpers.js';
import { type PackageGraph, type PackageStage, packageOwners, stageOwner } from './native-package-fixtures.js';

const CORE = 'http://www.sap.com/adt/core';
export function packageUnlock(
  graph: PackageGraph,
  stage: PackageStage | import('./native-package-api-profile.js').PackageApiStage | undefined,
  method: string,
  path: string,
) {
  if (!stage || method !== 'POST') return false;
  const uri = new URL(path, 'https://a4h.marianzeis.de'),
    keys = [...uri.searchParams.keys()];
  return (
    path.startsWith('/sap/bc/adt/') &&
    uri.pathname === path.split('?')[0] &&
    uri.pathname === stageOwner(graph, stage).owner &&
    uri.searchParams.get('_action') === 'UNLOCK' &&
    !!uri.searchParams.get('lockHandle') &&
    keys.length === 2 &&
    new Set(keys).size === 2
  );
}
export function checkPackageRequest(
  graph: PackageGraph,
  stage: PackageStage | undefined,
  method: string,
  path: string,
  body?: string,
) {
  if (!path.startsWith('/sap/bc/adt/') || path.includes('#') || path.includes('\\'))
    throw new Error('Package request scope.');
  const uri = new URL(path, 'https://a4h.marianzeis.de'),
    keys = [...uri.searchParams.keys()];
  if (
    uri.origin !== 'https://a4h.marianzeis.de' ||
    uri.pathname !== path.split('?')[0] ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => ['sap-client', 'sap-user', 'sap-password'].includes(key.toLowerCase()))
  )
    throw new Error('Package request identity.');
  const query = (allowed: string[]) => keys.every((key) => allowed.includes(key));
  const owners = packageOwners(graph);
  if (method === 'HEAD' && uri.pathname === '/sap/bc/adt/core/discovery' && !keys.length) return;
  if (method === 'GET') {
    if (['/sap/bc/adt/core/discovery', '/sap/bc/adt/activation/inactiveobjects'].includes(uri.pathname) && !keys.length)
      return;
    if (
      owners.some((o) => uri.pathname === o.owner) &&
      query(['version']) &&
      (!keys.length || ['active', 'inactive'].includes(uri.searchParams.get('version') ?? ''))
    )
      return;
    if (
      uri.pathname === `${graph.clas.owner}/source/main` &&
      query(['version']) &&
      (!keys.length || ['active', 'inactive'].includes(uri.searchParams.get('version') ?? ''))
    )
      return;
    throw new Error('Package read scope.');
  }
  if (!stage) throw new Error('Mutation without package stage.');
  const selected = stageOwner(graph, stage);
  if (packageUnlock(graph, stage, method, path)) return;
  // Native browser POST is a read used only by the normal package DELETE positive shortcut.
  if (
    ['delete-root', 'delete-child'].includes(stage) &&
    method === 'POST' &&
    uri.pathname === '/sap/bc/adt/repository/nodestructure' &&
    keys.length === 4 &&
    query(['parent_type', 'parent_name', 'parent_tech_name', 'withShortDescriptions']) &&
    uri.searchParams.get('parent_type') === 'DEVC/K' &&
    uri.searchParams.get('parent_name') === selected.name &&
    uri.searchParams.get('parent_tech_name') === selected.name &&
    uri.searchParams.get('withShortDescriptions') === 'false'
  ) {
    const ids = [...(body ?? '').matchAll(/<TV_NODEKEY>([0-9]{6})<\/TV_NODEKEY>/g)].map((m) => m[1]);
    const expected = `<?xml version="1.0" encoding="UTF-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA>${ids.map((id) => `<TV_NODEKEY>${id}</TV_NODEKEY>`).join('')}</DATA></asx:values></asx:abap>`;
    if (
      ids.length > 0 &&
      ids.length <= 16 &&
      new Set(ids).size === ids.length &&
      (!ids.includes('000000') || ids.length === 1) &&
      body === expected
    )
      return;
  }

  if (
    method === 'POST' &&
    uri.pathname === selected.owner &&
    uri.searchParams.get('_action') === 'LOCK' &&
    uri.searchParams.get('accessMode') === 'MODIFY' &&
    keys.length === 2 &&
    query(['_action', 'accessMode'])
  )
    return;
  if (method === 'POST' && uri.pathname === '/sap/bc/adt/cts/transportchecks' && !keys.length) {
    const actual = JSON.stringify(nativeXmlRoot(body ?? '', 'abap', 'http://www.sap.com/abapxml').canonicalValue({}));
    for (const operation of ['I', '']) {
      const pkg =
        selected.kind === 'class' ? graph.child.name : stage === 'create-child' ? graph.root.name : selected.name;
      const expected = `<a:abap xmlns:a="http://www.sap.com/abapxml" version="1.0"><a:values><DATA><DEVCLASS>${pkg}</DEVCLASS><URI>${selected.owner}</URI><OPERATION>${operation}</OPERATION></DATA></a:values></a:abap>`;
      if (actual === JSON.stringify(nativeXmlRoot(expected, 'abap', 'http://www.sap.com/abapxml').canonicalValue({})))
        return;
    }
  }
  if (
    stage.startsWith('create-') &&
    selected.kind !== 'class' &&
    method === 'POST' &&
    uri.pathname === '/sap/bc/adt/packages' &&
    !keys.length
  ) {
    const expected = buildPackageXml({
      name: selected.name,
      description: selected.description,
      responsible: 'MARIAN',
      superPackage: selected.parent || undefined,
      softwareComponent: 'LOCAL',
      transportLayer: '',
      packageType: 'development',
      recordChanges: false,
      cloud: false,
    });
    const parse = (s: string) =>
      JSON.stringify(nativeXmlRoot(s, 'package', 'http://www.sap.com/adt/packages').canonicalValue({}));
    if (parse(body ?? '') === parse(expected)) return;
  }
  if (
    stage === 'create-class' &&
    method === 'POST' &&
    uri.pathname === '/sap/bc/adt/oo/classes' &&
    query(['_package']) &&
    (!keys.length || uri.searchParams.get('_package') === graph.child.name)
  ) {
    const expected = buildCreateXml('CLAS', graph.clas.name, graph.child.name, graph.clas.description, undefined, 'EN');
    const canonical = (xml: string) =>
      JSON.stringify(nativeXmlRoot(xml, 'abapClass', 'http://www.sap.com/adt/oo/classes', true).canonicalValue({}));
    if (canonical(body ?? '') === canonical(expected)) return;
  }
  if (
    stage === 'create-class' &&
    method === 'PUT' &&
    uri.pathname === `${graph.clas.owner}/source/main` &&
    query(['lockHandle']) &&
    keys.length === 1 &&
    uri.searchParams.get('lockHandle') &&
    editableSourceEquals(body ?? '', graph.clas.source)
  )
    return;
  if (
    stage === 'activate-class' &&
    method === 'POST' &&
    uri.pathname === '/sap/bc/adt/activation' &&
    keys.length === 2 &&
    query(['method', 'preauditRequested']) &&
    uri.searchParams.get('method') === 'activate' &&
    ['true', 'false'].includes(uri.searchParams.get('preauditRequested') ?? '')
  ) {
    const allowed = new Map<string, string>([
      [graph.clas.owner, 'CLAS/OC'],
      ...['definitions', 'implementations', 'macros', 'testclasses'].map(
        (i) => [`${graph.clas.owner}/includes/${i}`, 'CLAS/I'] as const,
      ),
    ]);
    const refs = nativeXmlRoot(body ?? '', 'objectReferences', CORE).children('objectReference', CORE);
    const paths = refs.map((ref) => ref.attribute('uri', CORE));
    if (
      refs.length &&
      refs.length <= 5 &&
      new Set(paths).size === paths.length &&
      refs.every((ref) => {
        const path = ref.attribute('uri', CORE);
        return (
          !!path &&
          allowed.has(path) &&
          (ref.attribute('type', CORE) === undefined || ref.attribute('type', CORE) === allowed.get(path)) &&
          (path !== graph.clas.owner || ref.attribute('name', CORE) === selected.name) &&
          [undefined, 'false'].includes(ref.attribute('deleted', CORE))
        );
      })
    )
      return;
  }
  if (
    (stage.startsWith('delete-') || stage.startsWith('refuse-')) &&
    method === 'DELETE' &&
    uri.pathname === selected.owner &&
    keys.length === 1 &&
    query(['lockHandle']) &&
    uri.searchParams.get('lockHandle')
  )
    return;
  throw new Error('Mutation outside the fixed package stage.');
}
