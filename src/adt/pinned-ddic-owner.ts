import type { AdtClient } from './client.js';
import { AdtSafetyError } from './errors.js';
import type { AdtRequestOptions } from './http.js';
import { LOCKOBJECT_COLLECTION, LOCKOBJECT_CONTENT_TYPE } from './lock-object.js';
import { nativeXmlCharacterRoot, nativeXmlRoot, readNativeMetadata } from './native-xml-evidence.js';
import {
  type FieldMatcher,
  type MetadataFields,
  metadataFields,
  metadataFieldsHash,
  metadataSubtree,
} from './pinned-metadata-projection.js';
import { checkOperation, checkPackage, OperationType } from './safety.js';
import { SDO_REGISTRY, SDO_TYPES } from './server-driven.js';
import { parseTableIndexName, tableIndexParentUrl } from './table-index.js';
import { TABLE_SETTINGS_COLLECTION, TABLE_SETTINGS_CONTENT_TYPE, tableSettingsParentUrl } from './table-settings.js';

const core = 'http://www.sap.com/adt/core';

const blue = 'http://www.sap.com/wbobj/blue';

const canonical = (uri: string) => uri.replace(/%2f/gi, '%2F').replace(/%7e/gi, '~');

export type PinnedDdicKind = 'metadata' | 'table-source' | 'server-driven' | 'table-settings';

interface DdicProfile {
  kind: PinnedDdicKind;
  collection: string;
  root: string;
  namespace: string;
  native: string;
  /** Exact Accept of the existing reader; undefined keeps its discovery-negotiated request. */
  accept?: string;
}

// Identity shapes: tests/fixtures/xml/{domain-metadata,dataelement-metadata,tabletype-stringtab,lockobject-emekkoe}.xml,
// docs/research/abap-types/types/{msag,tabl}.md and the tests/fixtures/sdo + table-* fixtures.
const metadataProfiles = {
  DOMA: {
    kind: 'metadata',
    collection: '/sap/bc/adt/ddic/domains',
    root: 'domain',
    namespace: 'http://www.sap.com/dictionary/domain',
    native: 'DOMA/DD',
  },
  DTEL: {
    kind: 'metadata',
    collection: '/sap/bc/adt/ddic/dataelements',
    root: 'wbobj',
    namespace: 'http://www.sap.com/wbobj/dictionary/dtel',
    native: 'DTEL/DE',
  },
  TTYP: {
    kind: 'metadata',
    collection: '/sap/bc/adt/ddic/tabletypes',
    root: 'tableType',
    namespace: 'http://www.sap.com/dictionary/tabletype',
    native: 'TTYP/DA',
    accept: 'application/vnd.sap.adt.tabletype.v1+xml',
  },
  ENQU: {
    kind: 'metadata',
    collection: LOCKOBJECT_COLLECTION,
    root: 'lockobject',
    namespace: 'http://www.sap.com/adt/ddic/enqu',
    native: 'ENQU/DL',
    accept: LOCKOBJECT_CONTENT_TYPE,
  },
  MSAG: {
    kind: 'metadata',
    collection: '/sap/bc/adt/messageclass',
    root: 'messageClass',
    namespace: 'http://www.sap.com/adt/MessageClass',
    native: 'MSAG/N',
  },
} as const satisfies Record<string, DdicProfile>;

const tableProfiles = {
  'TABL/DT': {
    kind: 'table-source',
    collection: '/sap/bc/adt/ddic/tables',
    root: 'blueSource',
    namespace: blue,
    native: 'TABL/DT',
  },
  'TABL/DS': {
    kind: 'table-source',
    collection: '/sap/bc/adt/ddic/structures',
    root: 'blueSource',
    namespace: blue,
    native: 'TABL/DS',
  },
  'TABL/DTT': {
    kind: 'table-settings',
    collection: TABLE_SETTINGS_COLLECTION,
    root: 'tableSettings',
    namespace: 'http://www.sap.com/dictionary/table/settings',
    native: 'TABL/DTT',
    accept: TABLE_SETTINGS_CONTENT_TYPE,
  },
} as const satisfies Record<string, DdicProfile>;

function serverDrivenProfile(code: (typeof SDO_TYPES)[number]): DdicProfile {
  const entry = SDO_REGISTRY[code];
  return {
    kind: 'server-driven',
    collection: entry.href,
    root: entry.metadataRootLocalName,
    namespace: entry.metadataNamespace,
    native: entry.createType,
    accept: entry.metadataContentType,
  };
}

const profiles: Record<string, DdicProfile> = {
  ...metadataProfiles,
  ...tableProfiles,
  ...Object.fromEntries(SDO_TYPES.map((code) => [code, serverDrivenProfile(code)])),
};

// Deliberate refusals instead of an inherited Cartesian capability: see the progress research.
const unsupported: Record<string, string> = {
  SHLP: 'SHLP is a read-only metadata reader; ADT has no ARC-1 write contract for it.',
  VIEW: 'VIEW is read through the VIT endpoint only; ARC-1 has no write contract for classic DDIC views.',
  TRAN: 'TRAN has no ADT write endpoint on the verified releases.',
  SKTD: 'SKTD/KTD needs its own parent-reference and multi-node draft adapter.',
  SRVB: 'SRVB needs the publication-state adapter from the separate publication family.',
  ENHO: 'ENHO needs its own BAdI implementation preservation adapter.',
};

export function isPinnedDdicType(type: unknown): type is string {
  return typeof type === 'string' && Object.hasOwn(profiles, type);
}

export interface PinnedDdicSelection extends DdicProfile {
  type: string;
  name: string;
  objectUrl: string;
  /** Technical settings and secondary indexes prove their package through this native parent. */
  parent?: { name: string; url: string };
}

export function pinnedDdicSelection(type: unknown, name: unknown): PinnedDdicSelection {
  if (typeof type === 'string' && Object.hasOwn(unsupported, type)) throw new AdtSafetyError(unsupported[type]!);
  if (type === 'TABL')
    throw new AdtSafetyError('Resolve a bare TABL to its native TABL/DT or TABL/DS subtype before selecting it.');
  if (!isPinnedDdicType(type) || typeof name !== 'string' || !/^[/A-Z0-9_~]+$/.test(name))
    throw new AdtSafetyError('Select one admitted uppercase DDIC or server-driven owner.');
  const profile = profiles[type]!;
  if (type === 'TABL/DTI') {
    const { table } = parseTableIndexName(name);
    if (name !== name.toUpperCase()) throw new AdtSafetyError('Select one uppercase TABLE~INDEX name.');
    return {
      ...profile,
      type,
      name,
      objectUrl: `${profile.collection}/${encodeURIComponent(name.toLowerCase())}`,
      parent: { name: table, url: tableIndexParentUrl(name) },
    };
  }
  if (name.length > 30 || !/^(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]*$/.test(name))
    throw new AdtSafetyError('Select one uppercase native DDIC or server-driven owner, maximum 30 characters.');
  if (type === 'TABL/DTT')
    return {
      ...profile,
      type,
      name,
      objectUrl: `${profile.collection}/${encodeURIComponent(name.toLowerCase())}`,
      parent: { name, url: tableSettingsParentUrl(name) },
    };
  return { ...profile, type, name, objectUrl: `${profile.collection}/${encodeURIComponent(name)}` };
}

export interface PinnedDdicEvidence {
  xml: string;
  packageName: string;
  /** adtcore:version as reported by SAP; never inferred from the requested version. */
  version: string;
  fields: MetadataFields;
  hash: string;
  masterLanguage?: string;
  responsible?: string;
  root: ReturnType<typeof nativeXmlRoot>;
}

function assertIdentity(root: ReturnType<typeof nativeXmlRoot>, name: string, native: string): void {
  if (root.attribute('name', core) !== name || root.attribute('type', core) !== native)
    throw new AdtSafetyError('The native DDIC owner identity could not be verified.');
}

function ownPackage(root: ReturnType<typeof nativeXmlRoot>): string {
  const pkg = root.child('packageRef', core);
  const name = pkg?.attribute('name', core);
  if (pkg?.attribute('type', core) !== 'DEVC/K' || !name)
    throw new AdtSafetyError('The native DDIC owner package could not be verified.');
  return name;
}

/** A settings or index resource never authorizes itself: its package comes from the native parent table. */
async function nativeParentPackage(
  client: AdtClient,
  parent: NonNullable<PinnedDdicSelection['parent']>,
  request?: AdtRequestOptions,
) {
  const response = await readNativeMetadata(client.http, parent.url, 'ddic-parent-metadata', request, undefined);
  const root = nativeXmlRoot(response.body, 'blueSource', blue);
  assertIdentity(root, parent.name, 'TABL/DT');
  if (root.hasChild('containerRef')) throw new AdtSafetyError('The native parent table identity is ambiguous.');
  return ownPackage(root);
}

/** Fresh identity/content evidence only. Reading does not require a write-package grant. */
export async function readDdicEvidence(
  client: AdtClient,
  selected: PinnedDdicSelection,
  version?: 'active' | 'inactive',
  request?: AdtRequestOptions,
): Promise<PinnedDdicEvidence> {
  checkOperation(client.safety, OperationType.Read, 'PinnedDdicOwner');
  const response = await readNativeMetadata(
    client.http,
    selected.objectUrl + (version ? `?version=${version}` : ''),
    'ddic-owner-metadata',
    request,
    selected.accept,
  );
  const root =
    selected.type === 'MSAG'
      ? nativeXmlCharacterRoot(response.body, selected.root, selected.namespace)
      : nativeXmlRoot(response.body, selected.root, selected.namespace, true);
  assertIdentity(root, selected.name, selected.native);
  const nativeVersion = root.attribute('version', core);
  if (nativeVersion !== 'active' && nativeVersion !== 'inactive' && nativeVersion !== 'new')
    throw new AdtSafetyError('Native DDIC metadata lacks a known version.');
  let packageName: string;
  if (selected.parent) {
    const container = root.child('containerRef', core);
    if (
      container &&
      (container.attribute('name', core) !== selected.parent.name || container.attribute('type', core) !== 'TABL/DT')
    )
      throw new AdtSafetyError('The native parent table reference does not match the selected resource.');
    if (selected.type === 'TABL/DTT' && !container)
      throw new AdtSafetyError('Technical settings did not identify their native parent table.');
    packageName = await nativeParentPackage(client, selected.parent, request);
    if (selected.type === 'TABL/DTI' && ownPackage(root) !== packageName)
      throw new AdtSafetyError('The native index package differs from its parent table.');
  } else {
    if (root.hasChild('containerRef')) throw new AdtSafetyError('A DDIC owner must not be a container child.');
    packageName = ownPackage(root);
  }
  const fields = metadataFields(root, selected.namespace);
  return {
    xml: response.body,
    packageName,
    version: nativeVersion,
    fields,
    hash: metadataFieldsHash(fields),
    masterLanguage: root.attribute('masterLanguage', core),
    responsible: root.attribute('responsible', core),
    root,
  };
}

/** Mutation callers retain the write-package check; no caller flag can disable it. */
export async function readPinnedDdicEvidence(
  client: AdtClient,
  selected: PinnedDdicSelection,
  version?: 'active' | 'inactive',
): Promise<PinnedDdicEvidence> {
  const evidence = await readDdicEvidence(client, selected, version);
  await checkPackage(client.safety, evidence.packageName, client.getPackageHierarchyResolver());
  return evidence;
}

/** Shared owner chain entry: undefined means another adapter owns this URI. */
export async function readPinnedDdicOwner(client: AdtClient, owner: string): Promise<string | undefined> {
  const type = Object.keys(profiles).find((candidate) => {
    const prefix = `${profiles[candidate]!.collection}/`;
    return owner.startsWith(prefix) && !owner.slice(prefix.length).includes('/');
  });
  if (!type) return undefined;
  let name: string;
  try {
    name = decodeURIComponent(owner.slice(profiles[type]!.collection.length + 1)).toUpperCase();
  } catch {
    throw new AdtSafetyError('The DDIC owner URI is not canonical.');
  }
  const selected = pinnedDdicSelection(type, name);
  if (canonical(owner) !== canonical(selected.objectUrl))
    throw new AdtSafetyError('The DDIC owner URI is not canonical.');
  return (await readPinnedDdicEvidence(client, selected)).packageName;
}

/**
 * TABL subtype is native state, never a caller assertion: writing a transparent table through
 * /ddic/structures/ flips DD02L-TABCLASS (#285), so an unverified subtype refuses with no probe fallback.
 */
export async function resolvePinnedTableType(
  client: AdtClient,
  requested: 'TABL' | 'TABL/DT' | 'TABL/DS',
  name: string,
  tablesEndpointAvailable: boolean | undefined,
  request?: AdtRequestOptions,
): Promise<'TABL/DT' | 'TABL/DS'> {
  const results = await client.searchObject(name, 5, undefined, request);
  const matches = new Set(
    results
      .filter(
        (result) =>
          String(result.objectName ?? '')
            .replace(/\s*\(.*$/, '')
            .toUpperCase() === name && String(result.objectType ?? '').startsWith('TABL'),
      )
      .map((result) => result.objectType),
  );
  const [actual] = matches;
  if (matches.size !== 1 || (actual !== 'TABL/DT' && actual !== 'TABL/DS'))
    throw new AdtSafetyError(`The native subtype of TABL ${name} could not be verified. No request was changed.`);
  if (requested !== 'TABL' && requested !== actual)
    throw new AdtSafetyError(`TABL ${name} is natively ${actual}, not the requested ${requested}.`);
  if (actual === 'TABL/DT' && tablesEndpointAvailable === false)
    throw new AdtSafetyError(
      `Transparent table ${name} has no /sap/bc/adt/ddic/tables/ write endpoint on this release. Use SE11; writing through /ddic/structures/ would change its table class.`,
    );
  return actual;
}

const dtel = (field: string) => `/dtel:dataElement/dtel:${field}`;

const domaOutput = '/doma:content/doma:outputInformation';

/** Which stored paths each explicit input may change; every other difference refuses the rebuild. */
export const REQUESTED_PATHS: Record<string, Record<string, readonly FieldMatcher[]>> = {
  DOMA: {
    dataType: ['/doma:content/doma:typeInformation/doma:datatype'],
    length: ['/doma:content/doma:typeInformation/doma:length', `${domaOutput}/doma:length`],
    decimals: ['/doma:content/doma:typeInformation/doma:decimals'],
    outputLength: [`${domaOutput}/doma:length`],
    conversionExit: [`${domaOutput}/doma:conversionExit`],
    signExists: [`${domaOutput}/doma:signExists`],
    lowercase: [`${domaOutput}/doma:lowercase`],
    valueTable: [metadataSubtree('/doma:content/doma:valueInformation/doma:valueTableRef')],
    fixedValues: [metadataSubtree('/doma:content/doma:valueInformation/doma:fixValues')],
  },
  DTEL: {
    typeKind: [dtel('typeKind')],
    typeName: [dtel('typeName')],
    domainName: [dtel('typeName')],
    dataType: [dtel('dataType')],
    length: [dtel('dataTypeLength')],
    decimals: [dtel('dataTypeDecimals')],
    shortLabel: [dtel('shortFieldLabel'), dtel('shortFieldLength')],
    shortLength: [dtel('shortFieldLength')],
    mediumLabel: [dtel('mediumFieldLabel'), dtel('mediumFieldLength')],
    mediumLength: [dtel('mediumFieldLength')],
    longLabel: [dtel('longFieldLabel'), dtel('longFieldLength')],
    longLength: [dtel('longFieldLength')],
    headingLabel: [dtel('headingFieldLabel'), dtel('headingFieldLength')],
    headingLength: [dtel('headingFieldLength')],
    searchHelp: [dtel('searchHelp'), dtel('searchHelpParameter')],
    searchHelpParameter: [dtel('searchHelpParameter')],
    setGetParameter: [dtel('setGetParameter')],
    defaultComponentName: [dtel('defaultComponentName')],
    deactivateInputHistory: [dtel('deactivateInputHistory')],
    changeDocument: [dtel('changeDocument')],
  },
  TTYP: {
    rowType: [metadataSubtree('/ttyp:rowType')],
    rowTypeKind: [metadataSubtree('/ttyp:rowType')],
    rowTypeLength: [metadataSubtree('/ttyp:rowType')],
    rowTypeDecimals: [metadataSubtree('/ttyp:rowType')],
  },
  MSAG: { messages: [/^\/mc:messages(?:\[\d+\])?@mc:(?:msgno|msgtext)$/] },
};

export const ENQU_SOURCE_PATHS: Record<string, FieldMatcher> = {
  allowRFC: '/enqu:content/enqu:allowRFC',
  primaryTable: metadataSubtree('/enqu:content/enqu:primaryTable'),
  secondaryTables: metadataSubtree('/enqu:content/enqu:secondaryTables'),
  lockParameters: metadataSubtree('/enqu:content/enqu:lockParameters'),
};

export const PINNED_METADATA_INPUTS: Record<string, readonly string[]> = {
  DOMA: Object.keys(REQUESTED_PATHS.DOMA!),
  DTEL: Object.keys(REQUESTED_PATHS.DTEL!),
  TTYP: Object.keys(REQUESTED_PATHS.TTYP!),
  MSAG: Object.keys(REQUESTED_PATHS.MSAG!),
  ENQU: ['source'],
};
