/** Exact current-stage native scope. No generated child receives independent mutation authority. */

import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { buildCreateXml } from '../../../src/handlers/write-helpers.js';
import {
  GROUP,
  INCLUDE,
  MARKER,
  MODULE,
  owners,
  POOL,
  ProceduralFailure,
  type ProceduralStage,
  selected,
} from './native-procedural-fixed.js';

export interface ProceduralGrant {
  stage: ProceduralStage;
  source?: { path: string; body: string };
  activation?: { uri: string; name: string; pool?: boolean };
}
export function proceduralUnlock(method: string, path: string) {
  const uri = new URL(path, 'https://procedural.invalid');
  return (
    method === 'POST' &&
    [...owners, POOL].includes(uri.pathname) &&
    uri.searchParams.size === 2 &&
    uri.searchParams.get('_action') === 'UNLOCK' &&
    !!uri.searchParams.get('lockHandle')
  );
}
export function checkProceduralRequest(grant: ProceduralGrant, method: string, path: string, body?: string) {
  const fail = (): never => {
    throw new ProceduralFailure('scope');
  };
  if (!path.startsWith('/sap/bc/adt/') || /[#\\]/.test(path)) fail();
  const uri = new URL(path, 'https://procedural.invalid');
  if (uri.pathname !== path.split('?')[0]) fail();
  const keys = [...uri.searchParams.keys()];
  const query = (allowed: string[]) => keys.length === new Set(keys).size && keys.every((k) => allowed.includes(k));
  const root = selected.FUGR.objectUrl;
  if (method === 'GET' || method === 'HEAD') {
    if (
      [
        '/sap/bc/adt/discovery',
        '/sap/bc/adt/core/discovery',
        '/sap/bc/adt/activation/inactiveobjects',
        '/sap/bc/adt/packages/%24TMP',
        '/sap/bc/adt/packages/$TMP',
        `${root}/objectstructure`,
      ].includes(uri.pathname) &&
      !keys.length
    )
      return;
    const paths = [
      ...owners,
      ...owners.map((o) => `${o}/source/main`),
      POOL,
      ...['symbols', 'selections', 'headings'].map((p) => `${POOL}/source/${p}`),
      ...['top', 'uxx'].map((p) => `${root}/includes/l${GROUP.toLowerCase()}${p}/source/main`),
    ];
    if (
      paths.includes(uri.pathname) &&
      query(['version']) &&
      (!keys.length || ['active', 'inactive'].includes(uri.searchParams.get('version') ?? ''))
    )
      return;
    fail();
  }
  if (proceduralUnlock(method, path) && !body) return;
  if (grant.stage === 'preflight' || grant.stage === 'final') fail();
  if (method === 'POST' && uri.pathname === '/sap/bc/adt/cts/transportchecks' && !keys.length) {
    const data = nativeXmlRoot(body ?? '', 'abap', 'http://www.sap.com/abapxml')
      .child('values', 'http://www.sap.com/abapxml')
      ?.child('DATA', '');
    const value = JSON.stringify(data?.canonicalValue({}));
    for (const owner of [...owners, POOL])
      for (const operation of ['', 'I']) {
        const expected = nativeXmlRoot(
          `<a:abap xmlns:a="http://www.sap.com/abapxml"><a:values><DATA><DEVCLASS>$TMP</DEVCLASS><URI>${owner}</URI><OPERATION>${operation}</OPERATION></DATA></a:values></a:abap>`,
          'abap',
          'http://www.sap.com/abapxml',
        )
          .child('values', 'http://www.sap.com/abapxml')!
          .child('DATA', '')!;
        if (value === JSON.stringify(expected.canonicalValue({}))) return;
      }
    fail();
  }
  const owner = grant.stage.startsWith('module-')
    ? selected.FUNC.objectUrl
    : grant.stage.startsWith('include-')
      ? selected.INCL.objectUrl
      : root;
  const text = ['empty-symbols', 'text-headings', 'text-symbols', 'text-selections', 'clear-symbols'].includes(
    grant.stage,
  );
  if (
    method === 'POST' &&
    (uri.pathname === (text ? POOL : owner) || (grant.stage === 'group-delete' && uri.pathname === POOL)) &&
    query(['_action', 'accessMode']) &&
    keys.length === 2 &&
    uri.searchParams.get('_action') === 'LOCK' &&
    uri.searchParams.get('accessMode') === 'MODIFY' &&
    !body
  )
    return;
  if (
    method === 'PUT' &&
    grant.source &&
    uri.pathname === grant.source.path &&
    query(['lockHandle']) &&
    keys.length === 1 &&
    uri.searchParams.get('lockHandle') &&
    body === grant.source.body
  )
    return;
  if (
    method === 'DELETE' &&
    grant.stage.endsWith('-delete') &&
    uri.pathname === owner &&
    query(['lockHandle']) &&
    keys.length === 1 &&
    uri.searchParams.get('lockHandle')
  )
    return;
  if (
    method === 'POST' &&
    grant.stage.endsWith('-delete') &&
    uri.pathname === '/sap/bc/adt/deletion/check' &&
    !keys.length
  ) {
    const ns = 'http://www.sap.com/adt/deletion',
      core = 'http://www.sap.com/adt/core';
    const object = nativeXmlRoot(body ?? '', 'checkRequest', ns).children('object', ns);
    if (
      object.length === 1 &&
      object[0].attribute('uri', core) === owner &&
      (body?.match(/<del:lockHandle>[^<]{1,4096}<\/del:lockHandle>/)?.length ?? 0) === 1
    )
      return;
    fail();
  }
  if (
    method === 'POST' &&
    uri.pathname === '/sap/bc/adt/activation' &&
    grant.activation &&
    query(['method', 'preauditRequested']) &&
    keys.length === 2 &&
    uri.searchParams.get('method') === 'activate' &&
    ['true', 'false'].includes(uri.searchParams.get('preauditRequested') ?? '')
  ) {
    if (grant.activation.pool && uri.searchParams.get('preauditRequested') !== 'false') fail();
    const ns = 'http://www.sap.com/adt/core',
      refs = nativeXmlRoot(body ?? '', 'objectReferences', ns).children('objectReference', ns);
    if (
      refs.length === 1 &&
      refs[0].attribute('uri', ns) === grant.activation.uri &&
      refs[0].attribute('name', ns) === grant.activation.name
    )
      return;
    fail();
  }
  if (
    method === 'POST' &&
    grant.stage.endsWith('-create') &&
    query(['_package']) &&
    (!keys.length || uri.searchParams.get('_package') === '$TMP')
  ) {
    const group = grant.stage === 'group-create',
      module = grant.stage === 'module-create';
    const collection = group ? '/sap/bc/adt/functions/groups' : `${root}/${module ? 'fmodules' : 'includes'}`;
    if (uri.pathname !== collection) fail();
    const core = 'http://www.sap.com/adt/core',
      node = nativeXmlRoot(
        body ?? '',
        group ? 'abapFunctionGroup' : module ? 'abapFunctionModule' : 'abapFunctionGroupInclude',
        `http://www.sap.com/adt/functions/${group ? 'groups' : module ? 'fmodules' : 'fincludes'}`,
      );
    if (
      node.attribute('name', core) !== (group ? GROUP : module ? MODULE : INCLUDE) ||
      node.attribute('description', core) !== MARKER
    )
      fail();
    if (
      group
        ? node.child('packageRef', core)?.attribute('name', core) !== '$TMP'
        : node.child('containerRef', core)?.attribute('name', core) !== GROUP
    )
      fail();
    const expected = nativeXmlRoot(
      buildCreateXml(
        group ? 'FUGR' : module ? 'FUNC' : 'INCL',
        group ? GROUP : module ? MODULE : INCLUDE,
        '$TMP',
        MARKER,
        group ? {} : { group: GROUP },
        'EN',
      ),
      group ? 'abapFunctionGroup' : module ? 'abapFunctionModule' : 'abapFunctionGroupInclude',
      `http://www.sap.com/adt/functions/${group ? 'groups' : module ? 'fmodules' : 'fincludes'}`,
    );
    if (JSON.stringify(node.canonicalValue({})) !== JSON.stringify(expected.canonicalValue({}))) fail();
    return;
  }
  fail();
}
