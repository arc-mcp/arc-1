/** Native generated KTD slots, exact parent/author and raw metadata receipts; no fabricated draft. */
import { XMLParser } from 'fast-xml-parser';
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import {
  DOCUMENT_CORE,
  parsePinnedDocument,
  pinnedDocumentSelection,
  readNativeDocument,
} from '../../../src/adt/pinned-document-owner.js';
import { ddicHash } from './native-ddic-evidence.js';
import type { RapReceipt } from './native-rap-evidence.js';
import type { RapFixture } from './native-rap-fixtures.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
});
const decode = (value: unknown) => {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string') throw new Error('Native KTD text must be a base64 leaf.');
  const base64 = value.replace(/\s/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
    throw new Error('Invalid native KTD base64.');
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(base64, 'base64'));
};
export function documentNodes(f: RapFixture, xml: string) {
  const evidence = parsePinnedDocument(xml, pinnedDocumentSelection('SKTD', f.name));
  if (
    f.type !== 'SKTD' ||
    evidence.packageName !== '$TMP' ||
    evidence.refType !== 'BDEF/BDO' ||
    evidence.refName !== f.name ||
    evidence.root.attribute('createdBy', DOCUMENT_CORE) !== 'MARIAN' ||
    (evidence.root.attribute('changedBy', DOCUMENT_CORE) !== undefined &&
      evidence.root.attribute('changedBy', DOCUMENT_CORE) !== 'MARIAN')
  )
    throw new Error('Owned BDEF documentation identity/author/reference is unconfirmed.');
  const root = parser.parse(xml)['sktd:docu'];
  if (!root) throw new Error('Unqualified native KTD lexical root.');
  const raw = root['sktd:element'];
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const nodes = new Map<
    string,
    { text: string; shortText: string; obligation?: string; longTextObligation?: string; writable: boolean }
  >();
  for (const row of rows) {
    const id = row['sktd:id'];
    if (typeof id !== 'string' || !id || nodes.has(id)) throw new Error('Ambiguous native KTD node identity.');
    const obligation = row['@_sktd:longTextObligation'];
    nodes.set(id, {
      text: decode(row['sktd:text']),
      shortText: decode(row['sktd:shortText']?.['@_sktd:text']),
      obligation: row['sktd:shortText']?.['@_sktd:obligation'],
      longTextObligation: obligation,
      writable: ['optional', 'mandatory'].includes(obligation),
    });
  }
  const ids = [
    f.name,
    ...['create', 'update'].map(
      (op) =>
        `/sap/bc/adt/bo/behaviordefinitions/${f.name.toLowerCase()}/source/main#type=BDEF/BSO;name=${f.name}.${op}`,
    ),
  ];
  for (const [index, id] of ids.entries()) {
    const node = nodes.get(id);
    if (!node?.writable || (index > 0 && !['optional', 'mandatory'].includes(node.obligation ?? '')))
      throw new Error('Native managed-BDEF document lacks its required writable root/create/update slots.');
  }
  return { evidence, nodes, ids };
}
export async function rapDocumentSnapshot(
  client: AdtClient,
  f: RapFixture,
  active: boolean,
  record: (v: unknown) => void,
  options: AdtRequestOptions,
): Promise<RapReceipt> {
  const views: Awaited<ReturnType<typeof readNativeDocument>>[] = [];
  for (const version of active
    ? ([undefined, 'active', 'inactive', undefined] as const)
    : ([undefined, 'inactive', undefined] as const)) {
    const e = await readNativeDocument(client, pinnedDocumentSelection('SKTD', f.name), version, options);
    documentNodes(f, e.xml);
    record({
      document: f.owner,
      requestedVersion: version ?? 'default',
      nativeVersion: e.version,
      body: e.xml,
      sha256: ddicHash(e.xml),
      metadataHash: e.hash,
    });
    if (active ? e.version !== 'active' || e.inactiveAlternative : !['inactive', 'new'].includes(e.version))
      throw new Error('Native document actual state does not match the selected stage.');
    views.push(e);
  }
  if (views.some((v) => v.hash !== views[0].hash))
    throw new Error('Native KTD metadata changed across its version observations.');
  return {
    active,
    fingerprint: ddicHash(JSON.stringify(views.map((v) => v.hash))),
    sourceHashes: { document: ddicHash(views[0].stable) },
    sources: { document: views[0].xml },
    metadataHash: views[0].hash,
  };
}
