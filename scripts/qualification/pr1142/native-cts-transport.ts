/** Exact wire admission for one fixed CTS stage; no arbitrary transport, RPC or activation input. */
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { editableSourceEquals } from '../../../src/adt/source-precondition.js';
import { CTS_NAMESPACE_TM as TM } from '../../../src/adt/transport-contract.js';
import type { TransportObject } from '../../../src/adt/types.js';
import { escapeXmlAttr } from '../../../src/adt/xml-parser.js';
import { buildCreateXml } from '../../../src/handlers/write-helpers.js';
import {
  CTS_BASE,
  CTS_PACKAGE,
  CTS_RESERVED,
  type CtsGraph,
  type CtsOwnedRequest,
  type CtsRound,
  type CtsStep,
} from './native-cts-fixtures.js';
export interface CtsWireState {
  round: CtsRound;
  step?: CtsStep;
  requests: CtsOwnedRequest[];
  generatedParent?: string;
  remove?: TransportObject;
}
const CORE = 'http://www.sap.com/adt/core',
  ASX = 'http://www.sap.com/abapxml';
const same = (actual: string | undefined, expected: string, name: string, ns: string) =>
  JSON.stringify(nativeXmlRoot(actual ?? '', name, ns, true).canonicalValue({})) ===
  JSON.stringify(nativeXmlRoot(expected, name, ns, true).canonicalValue({}));
export const ctsEffectful = (method: string, path: string) =>
  ['PUT', 'DELETE'].includes(method) ||
  (method === 'POST' &&
    !path.includes('/transportchecks') &&
    !path.includes('preauditRequested=true') &&
    !path.includes('_action='));
export function ctsOwnUnlock(graph: CtsGraph, state: CtsWireState, method: string, path: string) {
  const own = graph.classes[state.round === 'B' ? 1 : 0],
    uri = new URL(path, 'https://a4h.marianzeis.de');
  return (
    state.round !== 'C' &&
    ['create-class', 'save-class', 'delete-class'].includes(state.step ?? '') &&
    method === 'POST' &&
    path.startsWith(`${own.owner}?`) &&
    uri.pathname === own.owner &&
    uri.searchParams.get('_action') === 'UNLOCK' &&
    !!uri.searchParams.get('lockHandle') &&
    [...uri.searchParams.keys()].sort().join(',') === '_action,lockHandle'
  );
}
export function checkCtsRequest(graph: CtsGraph, state: CtsWireState, method: string, path: string, body?: string) {
  const fail = () => {
    throw new Error('Request outside fixed CTS stage.');
  };
  if (!path.startsWith('/sap/bc/adt/') || path.includes('#') || path.includes('\\')) fail();
  const uri = new URL(path, 'https://a4h.marianzeis.de'),
    keys = [...uri.searchParams.keys()];
  if (
    uri.pathname !== path.split('?')[0] ||
    uri.origin !== 'https://a4h.marianzeis.de' ||
    new Set(keys).size !== keys.length ||
    CTS_RESERVED.some((id) => path.includes(id))
  )
    fail();
  const query = (allowed: string[]) => keys.every((k) => allowed.includes(k));
  const known = state.requests
    .flatMap((r) => [r.parent, r.task])
    .concat(state.generatedParent ? [state.generatedParent] : []);
  const own = state.requests.find((r) => r.round === state.round),
    cls = graph.classes[state.round === 'B' ? 1 : 0];
  if (method === 'HEAD' && uri.pathname === '/sap/bc/adt/core/discovery' && !keys.length) return;
  if (method === 'GET') {
    if (
      [
        '/sap/bc/adt/core/discovery',
        '/sap/bc/adt/activation/inactiveobjects',
        `/sap/bc/adt/packages/${CTS_PACKAGE}`,
        `/sap/bc/adt/packages/${CTS_PACKAGE.toLowerCase()}`,
      ].includes(uri.pathname) &&
      !keys.length
    )
      return;
    if (known.some((id) => uri.pathname === CTS_BASE + id) && !keys.length) return;
    if (
      graph.classes.some((c) =>
        [
          c.owner,
          `${c.owner}/source/main`,
          ...['definitions', 'implementations', 'macros', 'testclasses'].map((i) => `${c.owner}/includes/${i}`),
        ].includes(uri.pathname),
      ) &&
      query(['version']) &&
      (!keys.length || ['active', 'inactive'].includes(uri.searchParams.get('version') ?? ''))
    )
      return;
    fail();
  }
  if (!state.step) fail();
  if (ctsOwnUnlock(graph, state, method, path)) return;
  if (
    state.step === 'create-request' &&
    method === 'POST' &&
    uri.pathname === '/sap/bc/adt/cts/transports' &&
    !keys.length &&
    same(
      body,
      `<a:abap xmlns:a="${ASX}" version="1.0"><a:values><DATA><DEVCLASS>${CTS_PACKAGE}</DEVCLASS><REQUEST_TEXT>${graph.descriptions[state.round]}</REQUEST_TEXT><REF/><OPERATION>I</OPERATION></DATA></a:values></a:abap>`,
      'abap',
      ASX,
    )
  )
    return;
  if (!own) fail();
  if (
    ['reassign-away', 'reassign-back'].includes(state.step ?? '') &&
    state.round === 'A' &&
    method === 'PUT' &&
    uri.pathname === CTS_BASE + own!.task
  ) {
    const owner = state.step === 'reassign-away' ? 'ARC1_WG_RO' : 'MARIAN';
    if (
      keys.length === 1 &&
      uri.searchParams.get('targetuser') === owner &&
      same(
        body,
        `<t:root xmlns:t="${TM}" t:number="${own!.task}" t:targetuser="${owner}" t:useraction="changeowner"/>`,
        'root',
        TM,
      )
    )
      return;
  }
  if (
    state.step === 'remove-object' &&
    state.round === 'A' &&
    state.remove &&
    method === 'PUT' &&
    uri.pathname === CTS_BASE + own!.task &&
    !keys.length
  ) {
    const o = state.remove;
    if (
      same(
        body,
        `<t:root xmlns:t="${TM}" t:number="${own!.task}" t:useraction="removeobject"><t:request><t:abap_object t:pgmid="${escapeXmlAttr(o.pgmid)}" t:type="${escapeXmlAttr(o.type)}" t:name="${escapeXmlAttr(o.name)}" t:position="${escapeXmlAttr(o.position)}" t:obj_desc="${escapeXmlAttr(o.description)}"/></t:request></t:root>`,
        'root',
        TM,
      )
    )
      return;
  }
  const released =
    state.step === 'release-task'
      ? [own!.task]
      : state.step === 'release-parent'
        ? [own!.parent]
        : state.step === 'release-recursive'
          ? [own!.task, own!.parent]
          : [];
  if (
    method === 'POST' &&
    !keys.length &&
    !body &&
    released.some((id) => uri.pathname === `${CTS_BASE}${id}/newreleasejobs`)
  )
    return;
  if (
    state.step === 'delete-recursive' &&
    state.round === 'C' &&
    method === 'DELETE' &&
    !keys.length &&
    !body &&
    [own!.task, own!.parent].some((id) => uri.pathname === CTS_BASE + id)
  )
    return;
  if (
    state.round === 'C' ||
    !['create-class', 'save-class', 'activate-class', 'delete-class', 'remove-object'].includes(state.step ?? '')
  )
    fail();
  if (method === 'POST' && uri.pathname === '/sap/bc/adt/cts/transportchecks' && !keys.length) {
    for (const op of ['', 'I'])
      if (
        same(
          body,
          `<a:abap xmlns:a="${ASX}" version="1.0"><a:values><DATA><DEVCLASS>${CTS_PACKAGE}</DEVCLASS><URI>${cls.owner}</URI><OPERATION>${op}</OPERATION></DATA></a:values></a:abap>`,
          'abap',
          ASX,
        )
      )
        return;
  }
  if (
    method === 'POST' &&
    uri.pathname === cls.owner &&
    keys.length === 2 &&
    uri.searchParams.get('_action') === 'LOCK' &&
    uri.searchParams.get('accessMode') === 'MODIFY' &&
    query(['_action', 'accessMode']) &&
    ['create-class', 'save-class', 'delete-class'].includes(state.step ?? '')
  )
    return;
  const recording = () => uri.searchParams.get('corrNr') === own!.parent;
  if (
    state.step === 'create-class' &&
    method === 'POST' &&
    uri.pathname === '/sap/bc/adt/oo/classes' &&
    query(['corrNr', '_package']) &&
    recording() &&
    (!uri.searchParams.has('_package') || uri.searchParams.get('_package') === CTS_PACKAGE) &&
    same(
      body,
      buildCreateXml('CLAS', cls.name, CTS_PACKAGE, cls.description, undefined, 'EN'),
      'abapClass',
      'http://www.sap.com/adt/oo/classes',
    )
  )
    return;
  if (
    ['create-class', 'save-class'].includes(state.step ?? '') &&
    method === 'PUT' &&
    uri.pathname === `${cls.owner}/source/main` &&
    query(['lockHandle', 'corrNr']) &&
    keys.length === 2 &&
    uri.searchParams.get('lockHandle') &&
    recording() &&
    editableSourceEquals(body ?? '', cls.source)
  )
    return;
  if (
    state.step === 'delete-class' &&
    method === 'DELETE' &&
    uri.pathname === cls.owner &&
    query(['lockHandle', 'corrNr']) &&
    keys.length === 2 &&
    uri.searchParams.get('lockHandle') &&
    recording()
  )
    return;
  if (
    state.step === 'activate-class' &&
    method === 'POST' &&
    uri.pathname === '/sap/bc/adt/activation' &&
    keys.length === 2 &&
    query(['method', 'preauditRequested']) &&
    uri.searchParams.get('method') === 'activate' &&
    ['true', 'false'].includes(uri.searchParams.get('preauditRequested') ?? '')
  ) {
    const refs = nativeXmlRoot(body ?? '', 'objectReferences', CORE).children('objectReference', CORE),
      allowed = new Map([
        [cls.owner, 'CLAS/OC'],
        ...['definitions', 'implementations', 'macros', 'testclasses'].map((i): [string, string] => [
          `${cls.owner}/includes/${i}`,
          'CLAS/I',
        ]),
      ]);
    const paths = refs.map((r) => r.attribute('uri', CORE));
    if (
      refs.length &&
      refs.length <= 5 &&
      new Set(paths).size === paths.length &&
      refs.every((r) => {
        const p = r.attribute('uri', CORE);
        return (
          !!p &&
          allowed.has(p) &&
          [undefined, allowed.get(p)].includes(r.attribute('type', CORE)) &&
          (p !== cls.owner || r.attribute('name', CORE) === cls.name) &&
          [undefined, 'false'].includes(r.attribute('deleted', CORE))
        );
      })
    )
      return;
  }
  fail();
}
