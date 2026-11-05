/** Only the current disposable source owner may be mutated; GET/HEAD remain native ADT reads. */
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { pinnedDeclarativeSelection } from "../../../src/adt/pinned-repository-owner.js";
import { editableSourceEquals } from '../../../src/adt/source-precondition.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';

/** The exact own UNLOCK shape: selected owner, one handle and no other query field. */
export function isDeclarativeOwnerUnlock(fixture: DeclarativeFixture | undefined, method: string, path: string) {
  if (!fixture || method !== 'POST') return false;
  const uri = new URL(path, 'https://a4h.marianzeis.de');
  const keys = [...uri.searchParams.keys()];
  return (
    uri.origin === 'https://a4h.marianzeis.de' &&
    uri.pathname === fixture.owner &&
    uri.pathname === path.split('?')[0] &&
    uri.searchParams.get('_action') === 'UNLOCK' &&
    !!uri.searchParams.get('lockHandle') &&
    keys.length === 2 &&
    new Set(keys).size === 2
  );
}

export function checkDeclarativeRequest(fixture: DeclarativeFixture | undefined, method: string, path: string, body?: string) {
  if (!path.startsWith('/sap/bc/adt/') || path.includes('#') || path.includes('\\')) throw new Error('Only relative native ADT paths are permitted.');
  const uri = new URL(path, 'https://a4h.marianzeis.de');
  if (uri.origin !== 'https://a4h.marianzeis.de' || !uri.pathname.startsWith('/sap/bc/adt/') || uri.pathname !== path.split('?')[0])
    throw new Error('Native path normalization changed the requested scope.');
  if ([...uri.searchParams.keys()].some(key => ['sap-client', 'sap-user', 'sap-password'].includes(key.toLowerCase()))) throw new Error('The native identity and client must not be overridden.');
  if (method === 'GET' || method === 'HEAD') return;
  if (!fixture) throw new Error('No disposable fixture is selected for mutation.');
  const selected = pinnedDeclarativeSelection(fixture.type, fixture.name);
  if (selected.objectUrl !== fixture.owner || fixture.packageName !== '$TMP') throw new Error('The fixed disposable owner is inconsistent.');
  const core = 'http://www.sap.com/adt/core';
  const keys = [...uri.searchParams.keys()];
  const query = (allowed: string[]) => keys.every(key => allowed.includes(key)) && new Set(keys).size === keys.length;
  if (method === 'POST' && uri.pathname === '/sap/bc/adt/cts/transportchecks' && !keys.length) {
    const root = nativeXmlRoot(body ?? '', 'abap', 'http://www.sap.com/abapxml');
    const actual = JSON.stringify(root.canonicalValue({}));
    for (const operation of ['I', '']) {
      const expected = `<a:abap xmlns:a="http://www.sap.com/abapxml" version="1.0"><a:values><DATA><DEVCLASS>$TMP</DEVCLASS><URI>${fixture.owner}</URI><OPERATION>${operation}</OPERATION></DATA></a:values></a:abap>`;
      if (actual === JSON.stringify(nativeXmlRoot(expected, 'abap', 'http://www.sap.com/abapxml').canonicalValue({}))) return;
    }
  }
  if (method === 'POST' && uri.pathname === fixture.owner && uri.searchParams.get('_action') === 'LOCK' &&
      uri.searchParams.get('accessMode') === 'MODIFY' && query(['_action', 'accessMode'])) return;
  if (isDeclarativeOwnerUnlock(fixture, method, path)) return;
  if (method === 'DELETE' && uri.pathname === fixture.owner && uri.searchParams.get('lockHandle') && query(['lockHandle'])) return;
  if (method === 'PUT' && uri.pathname === `${fixture.owner}/source/main` && uri.searchParams.get('lockHandle') && query(['lockHandle']) &&
      typeof body === 'string' && [fixture.source, fixture.updatedSource].some(source => editableSourceEquals(source, body))) return;
  if (method === 'POST' && uri.pathname === fixture.owner.replace(/\/[^/]+$/, '') && query(['_package']) &&
      (uri.searchParams.get('_package') === null || uri.searchParams.get('_package') === '$TMP')) {
    const root = nativeXmlRoot(body ?? '', selected.root, selected.namespace);
    if (root.attribute('name', core) === fixture.name && root.attribute('type', core) === selected.native &&
        root.attribute('description', core) === fixture.description && root.child('packageRef', core)?.attribute('name', core) === '$TMP' &&
        !root.hasChild('containerRef') && !root.hasChild('adtTemplate')) return;
  }
  if (method === 'POST' && uri.pathname === '/sap/bc/adt/activation' && query(['method', 'preauditRequested']) &&
      uri.searchParams.get('method') === 'activate' && ['true', 'false'].includes(uri.searchParams.get('preauditRequested') ?? '')) {
    const refs = nativeXmlRoot(body ?? '', 'objectReferences', core).children('objectReference', core);
    if (refs.length === 1 && refs[0].attribute('uri', core) === fixture.owner && refs[0].attribute('name', core) === fixture.name &&
        (refs[0].attribute('type', core) === undefined || refs[0].attribute('type', core) === selected.native)) return;
  }
  throw new Error('Mutation outside the selected disposable declarative owner or source.');
}
