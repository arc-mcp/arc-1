import type { AdtClient } from './client.js';
import { DataResponseBudget } from './data-result-context.js';
import { AdtSafetyError } from './errors.js';
import { nativeOwnerPackage, nativeXmlRoot, readNativeMetadata } from './native-xml-evidence.js';
import { assertPinnedNativeName } from './pinned-managed-resources.js';
import { assertPinnedSourceOwner } from './pinned-write-policy.js';
import { checkOperation, checkPackage, OperationType } from './safety.js';

const core = 'http://www.sap.com/adt/core';

export const NATIVE_REPOSITORY_OWNERS = {
  CLAS: { path: 'oo/classes', root: 'abapClass', namespace: 'http://www.sap.com/adt/oo/classes', native: 'CLAS/OC' },
  INTF: {
    path: 'oo/interfaces',
    root: 'abapInterface',
    namespace: 'http://www.sap.com/adt/oo/interfaces',
    native: 'INTF/OI',
  },
  PROG: {
    path: 'programs/programs',
    root: 'abapProgram',
    namespace: 'http://www.sap.com/adt/programs/programs',
    native: 'PROG/P',
  },
  INCL: {
    path: 'programs/includes',
    root: 'abapInclude',
    namespace: 'http://www.sap.com/adt/programs/includes',
    native: 'PROG/I',
  },
  FUGR: {
    path: 'functions/groups',
    root: 'abapFunctionGroup',
    namespace: 'http://www.sap.com/adt/functions/groups',
    native: 'FUGR/F',
  },
  DDLS: {
    path: 'ddic/ddl/sources',
    root: 'ddlSource',
    namespace: 'http://www.sap.com/adt/ddic/ddlsources',
    native: 'DDLS/DF',
  },
  DCLS: {
    path: 'acm/dcl/sources',
    root: 'dclSource',
    namespace: 'http://www.sap.com/adt/acm/dclsources',
    native: 'DCLS/DL',
  },
  DDLX: {
    path: 'ddic/ddlx/sources',
    root: 'ddlxSource',
    namespace: 'http://www.sap.com/adt/ddic/ddlxsources',
    native: 'DDLX/EX',
  },
  BDEF: {
    path: 'bo/behaviordefinitions',
    root: 'blueSource',
    namespace: 'http://www.sap.com/wbobj/blue',
    native: 'BDEF/BDO',
  },
  SRVD: {
    path: 'ddic/srvd/sources',
    root: 'srvdSource',
    namespace: 'http://www.sap.com/adt/ddic/srvdsources',
    native: 'SRVD/SRV',
  },
  SRVB: {
    path: 'businessservices/bindings',
    root: 'serviceBinding',
    namespace: 'http://www.sap.com/adt/ddic/ServiceBindings',
    native: 'SRVB/SVB',
  },
} as const;

export type PinnedRepositoryOwnerType = keyof typeof NATIVE_REPOSITORY_OWNERS;

export interface PinnedRepositoryOwner {
  type: PinnedRepositoryOwnerType;
  name: string;
  native: string;
  root: string;
  namespace: string;
  objectUrl: string;
}

export function pinnedRepositoryOwner(type: unknown, name: unknown): PinnedRepositoryOwner {
  if (typeof type !== 'string' || !Object.hasOwn(NATIVE_REPOSITORY_OWNERS, type))
    throw new AdtSafetyError('This repository type has no reviewed private native owner profile.');
  const owner = type as PinnedRepositoryOwnerType;
  // Procedural owners keep their standalone program/include rule; SAPL* and L* need another adapter.
  if (owner === 'PROG' || owner === 'INCL') assertPinnedSourceOwner(owner, name);
  else assertPinnedNativeName(name, `${owner} name`);
  const profile = NATIVE_REPOSITORY_OWNERS[owner];
  return {
    type: owner,
    name: name as string,
    ...profile,
    objectUrl: `/sap/bc/adt/${profile.path}/${encodeURIComponent((name as string).toLowerCase())}`,
  };
}

export function pinnedRepositoryOwnerByNativeType(native: unknown, name: unknown): PinnedRepositoryOwner {
  const type = (Object.keys(NATIVE_REPOSITORY_OWNERS) as PinnedRepositoryOwnerType[]).find(
    (key) => NATIVE_REPOSITORY_OWNERS[key].native === native,
  );
  if (!type) throw new AdtSafetyError('This ADT object type has no reviewed private native owner profile.');
  return pinnedRepositoryOwner(type, name);
}

export interface PinnedRepositoryOwnerEvidence {
  packageName: string;
  description?: string;
}

/** The real package comes from fresh metadata and is checked against both policies, never a caller hint. */
export async function readPinnedRepositoryOwner(
  client: AdtClient,
  owner: PinnedRepositoryOwner,
): Promise<PinnedRepositoryOwnerEvidence> {
  checkOperation(client.safety, OperationType.Read, 'PinnedRepositoryOwner');
  const response = await client.http.get(
    owner.objectUrl,
    {
      Accept:
        owner.type === 'SRVB' ? 'application/vnd.sap.adt.businessservices.servicebinding.v2+xml' : 'application/*',
      'Cache-Control': 'no-cache',
    },
    { responseBudget: new DataResponseBudget(1024 * 1024, 'repository-owner-metadata', true) },
  );
  const root = nativeXmlRoot(response.body, owner.root, owner.namespace);
  const packageName = nativeOwnerPackage(root, owner.name, owner.native);
  if (!packageName) throw new AdtSafetyError('The native owner identity and own package could not be verified.');
  await checkPackage(client.safety, packageName, client.getPackageHierarchyResolver());
  return { packageName, description: root.attribute('description', core) };
}

// GET evidence: tests/fixtures/declarative-owners/native-metadata.json (A4H/001, 2026-11-02).
const pinnedDeclarativeOwnerProfiles = {
  DDLS: NATIVE_REPOSITORY_OWNERS.DDLS,
  DCLS: NATIVE_REPOSITORY_OWNERS.DCLS,
  DDLX: NATIVE_REPOSITORY_OWNERS.DDLX,
  BDEF: NATIVE_REPOSITORY_OWNERS.BDEF,
  SRVD: NATIVE_REPOSITORY_OWNERS.SRVD,
} as const;

export type PinnedDeclarativeType = keyof typeof pinnedDeclarativeOwnerProfiles;

const canonical = (uri: string) => uri.replace(/%2f/gi, '%2F');

export function isPinnedDeclarativeType(type: unknown): type is PinnedDeclarativeType {
  return typeof type === 'string' && Object.hasOwn(pinnedDeclarativeOwnerProfiles, type);
}

export function pinnedDeclarativeSelection(type: unknown, name: unknown) {
  if (
    !isPinnedDeclarativeType(type) ||
    typeof name !== 'string' ||
    name.length > 30 ||
    !/^(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]*$/.test(name)
  )
    throw new AdtSafetyError('Select one uppercase native CDS/RAP source owner, maximum 30 characters.');
  return {
    type,
    name,
    ...pinnedDeclarativeOwnerProfiles[type],
    objectUrl: `/sap/bc/adt/${pinnedDeclarativeOwnerProfiles[type].path}/${encodeURIComponent(name.toLowerCase())}`,
  };
}

export async function readPinnedDeclarativeOwner(client: AdtClient, owner: string): Promise<string | undefined> {
  const type = (Object.keys(pinnedDeclarativeOwnerProfiles) as PinnedDeclarativeType[]).find((type) =>
    owner.startsWith(`/sap/bc/adt/${pinnedDeclarativeOwnerProfiles[type].path}/`),
  );
  if (!type) return undefined;
  const segment = owner.slice(`/sap/bc/adt/${pinnedDeclarativeOwnerProfiles[type].path}/`.length);
  let name: string;
  try {
    name = decodeURIComponent(segment).toUpperCase();
  } catch {
    throw new AdtSafetyError('The declarative source URI is not canonical.');
  }
  const selected = pinnedDeclarativeSelection(type, name);
  if (canonical(owner) !== canonical(selected.objectUrl))
    throw new AdtSafetyError('The declarative source URI is not canonical.');
  checkOperation(client.safety, OperationType.Read, 'PinnedDeclarativeOwner');
  const response = await readNativeMetadata(
    client.http,
    owner,
    'declarative-owner-metadata',
    undefined,
    'application/*',
  );
  const { packageName } = pinnedDeclarativeMetadata(response.body, selected);
  await checkPackage(client.safety, packageName, client.getPackageHierarchyResolver());
  return packageName;
}

/** Shared native identity parser; activation additionally retains exact metadata values. */
export function pinnedDeclarativeMetadata(
  xml: string,
  selected: ReturnType<typeof pinnedDeclarativeSelection>,
  preserveValues = false,
) {
  const root = nativeXmlRoot(xml, selected.root, selected.namespace, preserveValues);
  const packageName = nativeOwnerPackage(root, selected.name, selected.native);
  if (!packageName)
    throw new AdtSafetyError('The native declarative source identity and own package could not be verified.');
  return { root, packageName };
}

const base = '/sap/bc/adt/functions/groups/';

const slashCase = (uri: string) => uri.replace(/%2f/gi, '%2F');

export interface PinnedFunctionSelection {
  type: 'FUGR' | 'FUNC' | 'INCL';
  name: string;
  group: string;
  groupUrl: string;
  objectUrl: string;
}

export function assertPinnedFunctionIdentifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 40 || !/^(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]*$/.test(value))
    throw new AdtSafetyError('Function resources require explicit bounded uppercase names.');
}

export function pinnedFunctionSelection(type: unknown, name: unknown, group?: unknown): PinnedFunctionSelection {
  assertPinnedFunctionIdentifier(name);
  if (type !== 'FUGR' && type !== 'FUNC' && type !== 'INCL')
    throw new AdtSafetyError('Select a function group, function module, or group-owned include.');
  if (type === 'FUGR') {
    if (group !== undefined) throw new AdtSafetyError('A function group cannot select another parent group.');
    group = name;
  }
  assertPinnedFunctionIdentifier(group);
  const groupUrl = `${base}${encodeURIComponent(group.toLowerCase())}`;
  const objectUrl =
    type === 'FUGR'
      ? groupUrl
      : `${groupUrl}/${type === 'FUNC' ? 'fmodules' : 'includes'}/${encodeURIComponent(name.toLowerCase())}`;
  return { type, name, group, groupUrl, objectUrl };
}

function selectionForResource(resource: string): PinnedFunctionSelection | undefined {
  if (!resource.startsWith(base)) return undefined;
  const match = /^\/sap\/bc\/adt\/functions\/groups\/([^/?#]+)(?:\/(fmodules|includes)\/([^/?#]+))?$/.exec(resource);
  if (!match) throw new AdtSafetyError('The selected function resource URI is not canonical.');
  let group: string, name: string;
  try {
    group = decodeURIComponent(match[1]!).toUpperCase();
    name = decodeURIComponent(match[3] ?? match[1]!).toUpperCase();
  } catch {
    throw new AdtSafetyError('The selected function resource URI is not canonical.');
  }
  const selected = pinnedFunctionSelection(
    match[2] === 'fmodules' ? 'FUNC' : match[2] === 'includes' ? 'INCL' : 'FUGR',
    name,
    match[2] ? group : undefined,
  );
  if (slashCase(resource) !== selected.objectUrl)
    throw new AdtSafetyError('The selected function resource URI is not canonical.');
  return selected;
}

export interface PinnedFunctionOwnerEvidence extends PinnedFunctionSelection {
  packageName: string;
}

export async function readPinnedFunctionOwner(
  client: AdtClient,
  resource: string,
): Promise<PinnedFunctionOwnerEvidence | undefined> {
  const selected = selectionForResource(resource);
  if (!selected) return undefined;
  const headers = { Accept: 'application/*', 'Cache-Control': 'no-cache' };
  const parentResponse = await client.http.get(selected.groupUrl, headers, {
    responseBudget: new DataResponseBudget(1024 * 1024, 'function-parent-metadata', true),
  });
  const parent = nativeXmlRoot(parentResponse.body, 'abapFunctionGroup', 'http://www.sap.com/adt/functions/groups');
  const packageName = nativeOwnerPackage(parent, selected.group, 'FUGR/F');
  if (!packageName) throw new AdtSafetyError('The native function group identity and package could not be verified.');
  await checkPackage(client.safety, packageName, client.getPackageHierarchyResolver());
  if (selected.type !== 'FUGR') {
    const response = await client.http.get(selected.objectUrl, headers, {
      responseBudget: new DataResponseBudget(1024 * 1024, 'function-child-metadata', true),
    });
    const module = selected.type === 'FUNC';
    const child = nativeXmlRoot(
      response.body,
      module ? 'abapFunctionModule' : 'abapFunctionGroupInclude',
      `http://www.sap.com/adt/functions/${module ? 'fmodules' : 'fincludes'}`,
    );
    const container = child.child('containerRef', core);
    const ownPackage = child.child('packageRef', core);
    if (
      child.attribute('name', core) !== selected.name ||
      child.attribute('type', core) !== (module ? 'FUGR/FF' : 'FUGR/I') ||
      container?.attribute('name', core) !== selected.group ||
      container.attribute('type', core) !== 'FUGR/F' ||
      slashCase(container.attribute('uri', core) ?? '') !== selected.groupUrl ||
      container.attribute('packageName', core) !== packageName ||
      (ownPackage &&
        (ownPackage.attribute('name', core) !== packageName || ownPackage.attribute('type', core) !== 'DEVC/K'))
    )
      throw new AdtSafetyError('The native function child does not belong to the verified parent group and package.');
  }
  return { ...selected, packageName };
}

export interface PinnedProgramOwnerEvidence {
  packageName: string;
  includeUsage?: {
    contextRefCount?: number;
    contexts: { uri: string; name: string; packageName?: string }[];
  };
}

export async function readPinnedProgramOwner(
  client: AdtClient,
  owner: string,
): Promise<PinnedProgramOwnerEvidence | undefined> {
  const selected = /^\/sap\/bc\/adt\/programs\/(programs|includes)\/([^/]+)$/.exec(owner);
  if (!selected) return undefined;
  const name = decodeURIComponent(selected[2]!).toUpperCase();
  const program = selected[1] === 'programs';
  const namespace = `http://www.sap.com/adt/programs/${selected[1]}`;
  const response = await client.http.get(owner, { Accept: 'application/*', 'Cache-Control': 'no-cache' });
  function refuse(): never {
    throw new AdtSafetyError(
      'Pinned procedural mutations require a standalone native PROG/INCL owner with its own package. Function-group, generated or ambiguous container sources need their dedicated adapter.',
    );
  }
  const root = nativeXmlRoot(response.body, program ? 'abapProgram' : 'abapInclude', namespace);
  if (root.attribute('name', core) !== name || root.attribute('type', core) !== (program ? 'PROG/P' : 'PROG/I'))
    refuse();
  const pkg = root.child('packageRef', core);
  const packageName = pkg?.attribute('name', core);
  if (pkg?.attribute('type', core) !== 'DEVC/K' || !packageName) refuse();
  if (root.hasChild('containerRef')) refuse();
  if (
    program &&
    !['executableProgram', 'subroutinePool', 'modulePool'].includes(root.attribute('programType', namespace) ?? '')
  )
    refuse();
  const contexts = root.children('contextRef', namespace);
  const usages: NonNullable<PinnedProgramOwnerEvidence['includeUsage']>['contexts'] = [];
  for (const ref of contexts) {
    const uri = ref.attribute('uri', core);
    if (ref.attribute('type', core) !== 'PROG/P' || !uri) refuse();
    const context = /^\/sap\/bc\/adt\/programs\/programs\/([^/]+)(?:\/source\/main)?$/.exec(uri);
    if (!context) refuse();
    let contextName: string;
    try {
      contextName = decodeURIComponent(context[1]!).toUpperCase();
    } catch {
      refuse();
    }
    if (
      !/^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_]+$/.test(contextName) ||
      /^(?:\/[^/]+\/)?SAPL/.test(contextName) ||
      (ref.attribute('name', core) !== undefined && ref.attribute('name', core) !== contextName)
    )
      refuse();
    usages.push({
      uri,
      name: contextName,
      ...(ref.attribute('packageName', core) !== undefined ? { packageName: ref.attribute('packageName', core) } : {}),
    });
  }
  const rawCount = root.attribute('contextRefCount', namespace);
  const count = rawCount === undefined ? undefined : Number(rawCount);
  if (
    count !== undefined &&
    (!/^\d+$/.test(String(rawCount)) || !Number.isSafeInteger(count) || count < contexts.length)
  )
    refuse();
  // Usage information is not a complete ownership/where-used list. Do not follow or authorize these resources.
  await checkPackage(client.safety, packageName, client.getPackageHierarchyResolver());
  return {
    packageName,
    ...(!program
      ? { includeUsage: { ...(count === undefined ? {} : { contextRefCount: count }), contexts: usages } }
      : {}),
  };
}

export async function verifyPinnedProgramOwner(client: AdtClient, owner: string): Promise<string | undefined> {
  return (await readPinnedProgramOwner(client, owner))?.packageName;
}

export function pinnedDeclarativeStateLinkVersion(
  _type: PinnedDeclarativeType,
  owner: string,
  href: string | undefined,
): 'active' | 'inactive' | undefined {
  if (href === undefined) return undefined;
  const canonical = (value: string) => value.replace(/%2f/gi, '%2F');
  for (const version of ['active', 'inactive'] as const) {
    if (canonical(href) === `${canonical(owner)}/source/main?version=${version}`) return version;
    // Callers validate native type/identity first; this literal owner-metadata spelling is family-independent.
    // Only DDLS has native wire evidence so far; other families have synthetic compatibility controls.
    if (href === `./${owner.slice(owner.lastIndexOf('/') + 1)}?version=${version}`) return version;
  }
  return undefined;
}
