/** Private native document identities. These readers never broaden the public capability matrix. */
import { createHash } from 'node:crypto';
import type { AdtClient } from './client.js';
import { ENHO_XHB_COLLECTION, ENHO_XHB_CONTENT_TYPE } from './enhancement-impl.js';
import { AdtSafetyError } from './errors.js';
import type { AdtRequestOptions } from './http.js';
import { type NativeXmlElement, nativeXmlRoot, readNativeMetadata } from './native-xml-evidence.js';
import { ktdDerivedReferenceValue } from './pinned-ktd-document.js';
import { assertPinnedNativeName } from './pinned-managed-resources.js';
import { checkOperation, checkPackage, OperationType } from './safety.js';

export const DOCUMENT_CORE = 'http://www.sap.com/adt/core';
export const ENHO_NS = 'http://www.sap.com/adt/enhancements/enho';
export const SKTD_NS = 'http://www.sap.com/wbobj/texts/sktd';
export const ENHS_NS = 'http://www.sap.com/adt/enhancements/enhs';
const enhcore = 'http://www.sap.com/abapsource/enhancementscore';
const atom = 'http://www.w3.org/2005/Atom';
const profiles = {
  ENHO: {
    collection: ENHO_XHB_COLLECTION,
    root: 'objectData',
    namespace: ENHO_NS,
    native: 'ENHO/XHB',
    contentType: ENHO_XHB_CONTENT_TYPE,
  },
  SKTD: {
    collection: '/sap/bc/adt/documentation/ktd/documents',
    root: 'docu',
    namespace: SKTD_NS,
    native: 'SKTD/TYP',
    contentType: 'application/vnd.sap.adt.sktdv2+xml',
  },
} as const;
export type PinnedDocumentType = keyof typeof profiles;
export const isPinnedDocumentType = (type: unknown): type is PinnedDocumentType => type === 'ENHO' || type === 'SKTD';
export const canonicalDocumentUri = (uri: string) => uri.replace(/%2f/gi, '%2F').toLowerCase();
export function pinnedDocumentSelection(type: unknown, name: unknown) {
  if (type === 'KTD') type = 'SKTD';
  if (!isPinnedDocumentType(type)) throw new AdtSafetyError('Select an ENHO BADI_IMPL or SKTD document.');
  assertPinnedNativeName(name, 'Native document');
  const profile = profiles[type];
  return { ...profile, type, name, objectUrl: `${profile.collection}/${encodeURIComponent(name.toLowerCase())}` };
}
export type PinnedDocumentSelection = ReturnType<typeof pinnedDocumentSelection>;
const parents = {
  'DDLS/DF': { path: 'ddic/ddl/sources', root: 'ddlSource', namespace: 'http://www.sap.com/adt/ddic/ddlsources' },
  'BDEF/BDO': { path: 'bo/behaviordefinitions', root: 'blueSource', namespace: 'http://www.sap.com/wbobj/blue' },
  'SRVD/SRV': { path: 'ddic/srvd/sources', root: 'srvdSource', namespace: 'http://www.sap.com/adt/ddic/srvdsources' },
  'SRVB/SVB': {
    path: 'businessservices/bindings',
    root: 'serviceBinding',
    namespace: 'http://www.sap.com/adt/ddic/ServiceBindings',
  },
  'DEVC/K': { path: 'packages', root: 'package', namespace: 'http://www.sap.com/adt/packages' },
  'SMBC/TYP': { path: 'bct/smbctyp', root: 'blueSource', namespace: 'http://www.sap.com/wbobj/blue' },
} as const;
export function documentParent(type: unknown, name: string) {
  if (typeof type !== 'string' || !Object.hasOwn(parents, type))
    throw new AdtSafetyError(
      'This private KTD profile needs a verified top-level DDLS, BDEF, SRVD, SRVB, DEVC or SMBC parent; subobject contracts remain unsupported.',
    );
  assertPinnedNativeName(name, 'Document parent');
  return {
    ...parents[type as keyof typeof parents],
    type,
    name,
    objectUrl: `/sap/bc/adt/${parents[type as keyof typeof parents].path}/${encodeURIComponent(name.toLowerCase())}`,
  };
}
function reference(node: NativeXmlElement | undefined, name: string, type: string, uri: string) {
  if (
    !node ||
    node.attribute('name', DOCUMENT_CORE) !== name ||
    node.attribute('type', DOCUMENT_CORE) !== type ||
    canonicalDocumentUri(node.attribute('uri', DOCUMENT_CORE) ?? '') !== canonicalDocumentUri(uri)
  )
    throw new AdtSafetyError('The native document reference is missing, ambiguous or does not match its exact owner.');
}
/** Native BADI_IMPL usages include read dependencies as well as the unique owning spot. */
function enhancementSpot(common: NativeXmlElement): string {
  const paths = { 'ENHS/XSB': 'enhancements/enhsxsb', 'CLAS/OC': 'oo/classes', 'INTF/OI': 'oo/interfaces' };
  let spot: string | undefined;
  for (const usage of common.child('usages', ENHO_NS)?.children('referencedObject', enhcore) ?? []) {
    const object = usage.child('objectReference', enhcore);
    const name = object?.attribute('name', DOCUMENT_CORE);
    const type = object?.attribute('type', DOCUMENT_CORE);
    assertPinnedNativeName(name, 'Enhancement usage');
    if (!type || !Object.hasOwn(paths, type)) throw new AdtSafetyError('Unsupported native enhancement usage type.');
    const uri = `/sap/bc/adt/${paths[type as keyof typeof paths]}/${encodeURIComponent(name.toLowerCase())}`;
    reference(object, name, type, uri);
    reference(usage.child('mainObjectReference', enhcore), name, type, uri);
    if (type === 'ENHS/XSB') {
      if (spot !== undefined) throw new AdtSafetyError('Ambiguous native enhancement spot usages.');
      spot = name;
    }
  }
  if (spot === undefined) throw new AdtSafetyError('Missing native enhancement spot usage.');
  return spot;
}
export function documentStableValue(xml: string, selected: PinnedDocumentSelection): string {
  const root = nativeXmlRoot(xml, selected.root, selected.namespace, true);
  const value = root.canonicalValue({
    omitAttribute: (name, namespace, depth) =>
      depth === 0 && namespace === DOCUMENT_CORE && ['version', 'changedAt', 'changedBy'].includes(name),
    omitChild: (name, namespace, child, depth) =>
      depth === 1 &&
      namespace === atom &&
      name === 'link' &&
      child.attribute('rel', '') === 'http://www.sap.com/adt/relations/objectstates',
  });
  // Native KTD Base64 wrapping and qualified derived reference labels are not persisted text edits.
  function normalize(value: unknown, base64 = false): unknown {
    if (!Array.isArray(value)) return value;
    return value.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') return normalize(pair, base64);
      const [key, field] = pair;
      if (key === 'text') return [key, base64 && typeof field === 'string' ? field.replace(/\s/g, '') : field];
      const [kind, ns, name] = JSON.parse(key) as string[];
      if (kind === 'element')
        return [key, (field as unknown[]).map((child) => normalize(child, ns === SKTD_NS && name === 'text'))];
      return pair;
    });
  }
  return JSON.stringify(selected.type === 'SKTD' ? normalize(ktdDerivedReferenceValue(value, selected.name)) : value);
}
export function parsePinnedDocument(xml: string, selected: PinnedDocumentSelection) {
  const root = nativeXmlRoot(xml, selected.root, selected.namespace, true);
  if (
    root.attribute('name', DOCUMENT_CORE) !== selected.name ||
    root.attribute('type', DOCUMENT_CORE) !== selected.native ||
    root.hasChild('containerRef')
  )
    throw new AdtSafetyError('The native document owner is not the selected exact type and name.');
  const version = root.attribute('version', DOCUMENT_CORE);
  if (version !== 'active' && version !== 'inactive' && version !== 'new')
    throw new AdtSafetyError('Unknown native document version.');
  const pkg = root.child('packageRef', DOCUMENT_CORE);
  const packageName = pkg?.attribute('name', DOCUMENT_CORE);
  if (!packageName?.trim() || packageName !== packageName.trim() || pkg?.attribute('type', DOCUMENT_CORE) !== 'DEVC/K')
    throw new AdtSafetyError('The native document package is unverified.');
  const alternatives = root
    .children('link', atom)
    .filter((link) => link.attribute('rel', '') === 'http://www.sap.com/adt/relations/objectstates');
  if (
    alternatives.length > 1 ||
    alternatives.some(
      (link) =>
        !['active', 'inactive'].some(
          (v) =>
            canonicalDocumentUri(link.attribute('href', '') ?? '') ===
              canonicalDocumentUri(`${selected.objectUrl}?version=${v}`) ||
            // Native SKTD/ENHO metadata names the exact sibling state by its encoded owner leaf.
            // Match the literal spelling only; never resolve, decode or follow the response link.
            ((selected.type === 'SKTD' || selected.type === 'ENHO') &&
              link.attribute('href', '') ===
                `./${selected.objectUrl.slice(selected.objectUrl.lastIndexOf('/') + 1)}?version=${v}`),
        ),
    )
  )
    throw new AdtSafetyError('Unverified native document state alternative.');
  let refType: string | undefined;
  let refName: string | undefined;
  if (selected.type === 'ENHO') {
    const common = root.child('contentCommon', ENHO_NS);
    if (common?.attribute('toolType', ENHO_NS) !== 'BADI_IMPL')
      throw new AdtSafetyError('Only verified ENHO BADI_IMPL technology has a native document profile.');
    refName = enhancementSpot(common);
    refType = 'ENHS/XSB';
    const uri = `/sap/bc/adt/enhancements/enhsxsb/${encodeURIComponent(refName.toLowerCase())}`;
    const technology = root.child('contentSpecific', ENHO_NS)?.child('badiTechnology', ENHO_NS);
    if (!technology) throw new AdtSafetyError('Missing native BAdI technology.');
    // ST_ENH_ADT_ENHO_BADI omits this exact list when its native table is empty.
    const list = technology.child('badiImplementations', ENHO_NS);
    const names = new Set<string>();
    for (const entry of list?.children('badiImplementation', ENHO_NS) ?? []) {
      const name = entry.attribute('name', ENHO_NS);
      assertPinnedNativeName(name, 'BAdI implementation');
      if (names.has(name)) throw new AdtSafetyError('Duplicate native BAdI implementation.');
      names.add(name);
      for (const flag of ['active', 'default']) {
        const value = entry.attribute(flag, ENHO_NS);
        if (value !== 'true' && value !== 'false') throw new AdtSafetyError('Unknown native BAdI flag.');
      }
      entry.attribute('shortText', ENHO_NS);
      for (const child of ['badiDefinition', 'implementingClass']) {
        const target = entry.child(child, ENHO_NS);
        const targetName = target?.attribute('name', DOCUMENT_CORE);
        assertPinnedNativeName(targetName, child);
        const targetType = target?.attribute('type', DOCUMENT_CORE);
        if (targetType !== undefined && targetType !== (child === 'badiDefinition' ? 'ENHS/XB' : 'CLAS/OC'))
          throw new AdtSafetyError('Unexpected native BAdI reference type.');
        const uri = target?.attribute('uri', DOCUMENT_CORE);
        if (uri !== undefined) {
          const expected =
            child === 'implementingClass'
              ? [`/sap/bc/adt/oo/classes/${encodeURIComponent(targetName.toLowerCase())}`]
              : [
                  `/sap/bc/adt/vit/wb/object_type/enhsxb/object_name/${encodeURIComponent(refName)}`,
                  `${`/sap/bc/adt/enhancements/enhsxsb/${encodeURIComponent(refName.toLowerCase())}`}#type=enhs%2fxb;name=${encodeURIComponent(targetName)}`,
                ];
          if (!expected.some((value) => canonicalDocumentUri(value) === canonicalDocumentUri(uri)))
            throw new AdtSafetyError('Unexpected native BAdI reference URI.');
        }
      }
      const spot = entry.child('enhancementSpot', ENHO_NS);
      if (spot) reference(spot, refName, refType, uri);
    }
  } else {
    const ref = root.child('refObject', SKTD_NS);
    refType = ref?.attribute('type', DOCUMENT_CORE);
    const parent = documentParent(refType, selected.name);
    reference(ref, selected.name, parent.type, parent.objectUrl);
    refName = selected.name;
  }
  const full = JSON.stringify(root.canonicalValue({}));
  return {
    xml,
    root,
    packageName,
    version,
    refType,
    refName,
    hash: createHash('sha256').update(full).digest('hex'),
    stable: documentStableValue(xml, selected),
    inactiveAlternative: canonicalDocumentUri(alternatives[0]?.attribute('href', '') ?? '').endsWith(
      '?version=inactive',
    ),
  };
}
/** Ordinary native read: no mutation package grants. Unversioned reads retain developer-view drafts. */
export async function readNativeDocument(
  client: AdtClient,
  selected: PinnedDocumentSelection,
  version?: 'active' | 'inactive',
  request?: AdtRequestOptions,
) {
  checkOperation(client.safety, OperationType.Read, 'NativeDocumentEvidence');
  const response = await readNativeMetadata(
    client.http,
    selected.objectUrl + (version ? `?version=${version}` : ''),
    'native-document',
    request,
    selected.contentType,
  );
  return parsePinnedDocument(response.body, selected);
}
/** The write profile retains its independent package ceiling around the same read/hash semantics. */
export async function readPinnedDocument(
  client: AdtClient,
  selected: PinnedDocumentSelection,
  version?: 'active' | 'inactive',
) {
  const evidence = await readNativeDocument(client, selected, version);
  await checkPackage(client.safety, evidence.packageName, client.getPackageHierarchyResolver());
  return evidence;
}
export async function readDocumentParent(client: AdtClient, type: string, name: string) {
  checkOperation(client.safety, OperationType.Read, 'PinnedDocumentParent');
  const parent = documentParent(type, name);
  const response = await readNativeMetadata(
    client.http,
    parent.objectUrl,
    'document-parent',
    undefined,
    'application/*',
  );
  const root = nativeXmlRoot(response.body, parent.root, parent.namespace, true);
  if (
    root.attribute('name', DOCUMENT_CORE) !== name ||
    root.attribute('type', DOCUMENT_CORE) !== type ||
    !['active', 'inactive', 'new'].includes(root.attribute('version', DOCUMENT_CORE) ?? '') ||
    root.hasChild('containerRef')
  )
    throw new AdtSafetyError('The KTD parent identity could not be verified.');
  return parent;
}
