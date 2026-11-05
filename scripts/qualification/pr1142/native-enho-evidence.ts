/** Exact owned native metadata/source receipts. Query names never substitute for actual state. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import {
  DOCUMENT_CORE as core,
  ENHO_NS,
  parsePinnedDocument,
  pinnedDocumentSelection,
  readNativeDocument,
} from '../../../src/adt/pinned-document-owner.js';
import { editableSourceEquals, sourceHash } from '../../../src/adt/source-precondition.js';
import { ddicHash } from './native-ddic-evidence.js';
import { ENHO_BADI, ENHO_INTERFACE, ENHO_SPOT, type EnhoFixture } from './native-enho-fixtures.js';

const OO = 'http://www.sap.com/adt/oo/classes',
  atom = 'http://www.w3.org/2005/Atom',
  enhcore = 'http://www.sap.com/abapsource/enhancementscore';
export interface EnhoReceipt {
  active: boolean;
  updated: boolean;
  fingerprint: string;
  hash: string;
  xml?: string;
  stable?: string;
  sourceHash?: string;
}
function author(root: ReturnType<typeof nativeXmlRoot>) {
  if (
    root.attribute('createdBy', core) !== 'MARIAN' ||
    (root.attribute('changedBy', core) !== undefined && root.attribute('changedBy', core) !== 'MARIAN')
  )
    throw new Error('Owned native author unconfirmed.');
}
export function enhoDocument(f: EnhoFixture, cls: EnhoFixture, xml: string, updated: boolean, empty = false) {
  const e = parsePinnedDocument(xml, pinnedDocumentSelection('ENHO', f.name));
  author(e.root);
  if (
    e.packageName !== '$TMP' ||
    e.refName !== ENHO_SPOT ||
    e.root.attribute('description', core) !== (updated ? f.update.description : f.description)
  )
    throw new Error('Owned ENHO reference/marker/package changed.');
  const entries =
    e.root
      .child('contentSpecific', ENHO_NS)!
      .child('badiTechnology', ENHO_NS)!
      .child('badiImplementations', ENHO_NS)
      ?.children('badiImplementation', ENHO_NS) ?? [];
  if (entries.length !== (empty ? 0 : 1)) throw new Error('Exact owned implementation count required.');
  if (!empty) {
    const entry = entries[0],
      suffix = f.name.slice(-12);
    if (
      entry.attribute('name', ENHO_NS) !== `ZARC1_BI_${suffix}` ||
      entry.attribute('shortText', ENHO_NS) !== `${updated ? 'Updated' : 'Owned'} disabled ${suffix}` ||
      entry.attribute('active', ENHO_NS) !== 'false' ||
      entry.attribute('default', ENHO_NS) !== 'false' ||
      entry.attribute('example', ENHO_NS) !== 'false' ||
      entry.child('badiDefinition', ENHO_NS)?.attribute('name', core) !== ENHO_BADI ||
      entry.child('implementingClass', ENHO_NS)?.attribute('name', core) !== cls.name
    )
      throw new Error('Disabled owned BAdI content changed.');
    const tree = entry.child('filterTree', ENHO_NS);
    if (!tree) throw new Error('Owned unique URI filter missing.');
    const filter = [] as ReturnType<typeof nativeXmlRoot>[];
    const walk = (n: ReturnType<typeof nativeXmlRoot>) => {
      if (n.attribute('filterName', ENHO_NS) !== undefined) filter.push(n);
      for (const c of n.children('filterToken', ENHO_NS)) walk(c);
    };
    walk(tree);
    if (
      filter.length !== 1 ||
      filter[0].attribute('filterName', ENHO_NS) !== 'URI' ||
      filter[0].attribute('comparator', ENHO_NS) !== '=' ||
      filter[0].attribute('value', ENHO_NS) !== `/arc1/qualification/${suffix.toLowerCase()}`
    )
      throw new Error('Unexpected native URI filter.');
  }
  // References do not become owners; an added foreign dependency never broadens this graph.
  for (const usage of e.root
    .child('contentCommon', ENHO_NS)!
    .child('usages', ENHO_NS)!
    .children('referencedObject', enhcore)) {
    const r = usage.child('objectReference', enhcore)!;
    const name = r.attribute('name', core),
      type = r.attribute('type', core);
    if (
      !(
        (type === 'ENHS/XSB' && name === ENHO_SPOT) ||
        (type === 'CLAS/OC' && name === cls.name) ||
        (type === 'INTF/OI' && name === ENHO_INTERFACE)
      )
    )
      throw new Error('Unowned enhancement usage.');
  }
  return e;
}
export async function enhoSnapshot(
  client: AdtClient,
  fixtures: readonly EnhoFixture[],
  f: EnhoFixture,
  updated: boolean,
  active: boolean,
  record: (v: unknown) => void,
  options: AdtRequestOptions,
): Promise<EnhoReceipt> {
  if (f.type === 'ENHO') {
    const views = [] as ReturnType<typeof parsePinnedDocument>[];
    for (const version of active
      ? ([undefined, 'active', 'inactive', undefined] as const)
      : ([undefined, 'inactive', undefined] as const)) {
      const e = await readNativeDocument(client, pinnedDocumentSelection('ENHO', f.name), version, options);
      enhoDocument(f, fixtures[0], e.xml, updated);
      if (active ? e.version !== 'active' || e.inactiveAlternative : !['inactive', 'new'].includes(e.version))
        throw new Error('Native ENHO actual state unconfirmed.');
      views.push(e);
      record({
        ownedDocument: f.owner,
        requestedVersion: version ?? 'default',
        nativeVersion: e.version,
        sha256: ddicHash(e.xml),
        body: e.xml,
      });
    }
    if (views.some((v) => v.hash !== views[0].hash)) throw new Error('ENHO changed during its observed views.');
    return {
      active,
      updated,
      hash: views[0].hash,
      fingerprint: ddicHash(JSON.stringify(views.map((v) => v.hash))),
      xml: views[0].xml,
      stable: views[0].stable,
    };
  }
  const get = async (path: string, plain = false) => {
    const r = await client.http.get(
      path,
      { Accept: plain ? 'text/plain' : 'application/*', 'Cache-Control': 'no-cache' },
      options,
    );
    if (r.statusCode !== 200) throw new Error('Owned class read unconfirmed.');
    if (
      plain &&
      !Object.entries(r.headers).some(
        ([k, v]) => k.toLowerCase() === 'content-type' && v.split(';')[0].trim() === 'text/plain',
      )
    )
      throw new Error('Owned source media unconfirmed.');
    record({ ownedRead: path, sha256: ddicHash(r.body), body: r.body });
    return r.body;
  };
  const meta = (xml: string) => {
    const r = nativeXmlRoot(xml, 'abapClass', OO, true);
    author(r);
    if (
      r.attribute('name', core) !== f.name ||
      r.attribute('type', core) !== 'CLAS/OC' ||
      r.attribute('description', core) !== f.description ||
      r.child('packageRef', core)?.attribute('name', core) !== '$TMP' ||
      r.attribute('version', core) !== (active ? 'active' : 'inactive')
    )
      throw new Error('Owned class metadata changed.');
    const seen = new Set<string>();
    for (const include of r.children('include', OO)) {
      const part = include.attribute('includeType', OO);
      if (
        !part ||
        seen.has(part) ||
        !['main', 'definitions', 'implementations', 'macros', 'testclasses'].includes(part) ||
        include.attribute('type', core) !== 'CLAS/I' ||
        include.attribute('sourceUri', 'http://www.sap.com/adt/abapsource') !==
          (part === 'main' ? 'source/main' : `includes/${part}`) ||
        (active && include.attribute('version', core) !== 'active')
      )
        throw new Error('Owned class include metadata unconfirmed.');
      seen.add(part);
    }
    const links = r
      .children('link', atom)
      .filter((n) => n.attribute('rel', '') === 'http://www.sap.com/adt/relations/objectstates');
    if (
      links.length > 1 ||
      links.some(
        (n) =>
          !['active', 'inactive'].some((v) =>
            [`${f.owner}?version=${v}`, `${f.owner}/source/main?version=${v}`].includes(n.attribute('href', '') ?? ''),
          ) ||
          (active && n.attribute('href', '')?.endsWith('=inactive')),
      )
    )
      throw new Error('Owned class state alternative unconfirmed.');
    return ddicHash(JSON.stringify(r.canonicalValue({})));
  };
  const before = meta(await get(f.owner)),
    explicit = active ? meta(await get(`${f.owner}?version=active`)) : undefined;
  const source = await get(`${f.owner}/source/main?version=${active ? 'active' : 'inactive'}`, true);
  if (!editableSourceEquals(source, f.create.source)) throw new Error('Owned empty stub source changed.');
  if (active && sourceHash(await get(`${f.owner}/source/main`, true)) !== sourceHash(source))
    throw new Error('Editable/active stub differs.');
  if (meta(await get(f.owner)) !== before || (active && meta(await get(`${f.owner}?version=active`)) !== explicit))
    throw new Error('Class changed during source observation.');
  return {
    active,
    updated,
    hash: before,
    sourceHash: sourceHash(source),
    fingerprint: ddicHash(JSON.stringify([before, explicit, sourceHash(source)])),
  };
}
