/** Only two owned routes and exact standard read dependencies; no reference becomes mutation authority. */
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { buildCreateXml } from '../../../src/handlers/write-helpers.js';
import { ddicUnlock } from './native-ddic-transport.js';
import { ENHO_INTERFACE_URI, ENHO_SPOT_URI, type EnhoFixture } from './native-enho-fixtures.js';

const core = 'http://www.sap.com/adt/core';
const canonical = (body: string, root: string, ns: string) =>
  JSON.stringify(nativeXmlRoot(body, root, ns, true).canonicalValue({}));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function checkEnhoRequest(
  fixtures: readonly EnhoFixture[],
  stage: string | undefined,
  method: string,
  path: string,
  body?: string,
  createBody?: string,
  putBody?: string,
) {
  if (!path.startsWith('/sap/bc/adt/') || /[#\\]/.test(path)) throw new Error('Fixed enhancement path required.');
  const u = new URL(path, 'https://a4h.marianzeis.de'),
    keys = [...u.searchParams.keys()];
  if (u.pathname !== path.split('?')[0] || new Set(keys).size !== keys.length)
    throw new Error('Fixed enhancement query required.');
  const only = (...allowed: string[]) => keys.every((k) => allowed.includes(k));
  const owner = fixtures.find((f) => same(f.owner, u.pathname)),
    source = same(`${fixtures[0].owner}/source/main`, u.pathname),
    selected = fixtures.find((f) => stage?.endsWith(`-${f.type}`));
  if (method === 'GET') {
    if (
      [
        '/sap/bc/adt/discovery',
        '/sap/bc/adt/activation/inactiveobjects',
        ENHO_SPOT_URI,
        ENHO_INTERFACE_URI,
        `${ENHO_INTERFACE_URI}/source/main`,
      ].includes(path)
    )
      return;
    if (same(path, '/sap/bc/adt/packages/%24tmp')) return;
    if (
      (owner || source) &&
      only('version') &&
      (!keys.length || ['active', 'inactive'].includes(u.searchParams.get('version') ?? ''))
    )
      return;
    throw new Error('GET outside fixed enhancement graph.');
  }
  if (method === 'HEAD' && owner && !keys.length) return;
  if (!selected || !stage) throw new Error('No enhancement stage.');
  if (ddicUnlock(selected, method, path)) return;
  if (method === 'POST' && path === '/sap/bc/adt/cts/transportchecks') {
    for (const uri of [selected.owner, selected.owner.replace(/[^/]+$/, selected.name)])
      for (const operation of ['', 'I']) {
        const expected = `<a:abap xmlns:a="http://www.sap.com/abapxml" version="1.0"><a:values><DATA><DEVCLASS>$TMP</DEVCLASS><URI>${uri}</URI><OPERATION>${operation}</OPERATION></DATA></a:values></a:abap>`;
        if (
          canonical(body ?? '', 'abap', 'http://www.sap.com/abapxml') ===
          canonical(expected, 'abap', 'http://www.sap.com/abapxml')
        )
          return;
      }
  }
  if (
    method === 'POST' &&
    owner === selected &&
    keys.length === 2 &&
    only('_action', 'accessMode') &&
    u.searchParams.get('_action') === 'LOCK' &&
    u.searchParams.get('accessMode') === 'MODIFY'
  )
    return;
  if (
    method === 'DELETE' &&
    stage === `delete-${selected.type}` &&
    owner === selected &&
    keys.length === 1 &&
    only('lockHandle') &&
    u.searchParams.get('lockHandle')
  )
    return;
  if (
    method === 'POST' &&
    stage === `create-${selected.type}` &&
    same(u.pathname, selected.owner.slice(0, selected.owner.lastIndexOf('/'))) &&
    only('_package') &&
    [null, '$TMP'].includes(u.searchParams.get('_package'))
  ) {
    const expected =
      selected.type === 'CLAS'
        ? buildCreateXml('CLAS', selected.name, '$TMP', selected.description, selected.create, 'EN')
        : createBody;
    if (expected !== undefined && body === expected) return;
  }
  if (method === 'PUT' && keys.length === 1 && only('lockHandle') && u.searchParams.get('lockHandle')) {
    if (stage === 'create-CLAS' && source && body === fixtures[0].create.source) return;
    if (
      ['create-ENHO', 'update-ENHO'].includes(stage) &&
      owner === selected &&
      putBody !== undefined &&
      body === putBody
    )
      return;
  }
  if (
    method === 'POST' &&
    u.pathname === '/sap/bc/adt/activation' &&
    ['activate-CLAS', 'activate-ENHO', 'reactivate-ENHO'].includes(stage) &&
    only('method', 'preauditRequested') &&
    u.searchParams.get('method') === 'activate' &&
    ['true', 'false'].includes(u.searchParams.get('preauditRequested') ?? '')
  ) {
    const root = nativeXmlRoot(body ?? '', 'objectReferences', core, true),
      refs = root.children('objectReference', core);
    if (
      refs.length === 1 &&
      refs[0].attribute('name', core) === selected.name &&
      same(refs[0].attribute('uri', core) ?? '', selected.owner) &&
      [undefined, selected.type === 'CLAS' ? 'CLAS/OC' : 'ENHO/XHB'].includes(refs[0].attribute('type', core))
    )
      return;
  }
  throw new Error('Mutation outside fixed enhancement stage/body.');
}
