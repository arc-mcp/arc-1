/** Native facts for the fixed local graph; raw owned metadata/source, hash-only unrelated inventory. */
import { createHash } from 'node:crypto';
import type { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { type NativeXmlElement, nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { readPinnedPackage } from '../../../src/adt/pinned-package.js';
import { editableSourceEquals, sourceHash } from '../../../src/adt/source-precondition.js';
import { declarativeInventoryClean, declarativeOwnerAbsent } from './native-declarative-evidence.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { type PackageApiOwner, RECORDED_PACKAGE } from './native-package-api-profile.js';
import { type PackageGraph, type PackageOwner, packageOwners } from './native-package-fixtures.js';

const CORE = 'http://www.sap.com/adt/core';
const EXC = 'http://www.sap.com/abapxml/types/communicationframework';
export const packageHash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
export type PackageJournal = (value: unknown) => void;
export type OwnerReceipt = {
  metadataHash: string;
  activeMetadataHash?: string;
  sourceHash?: string;
  children?: string[];
  active: boolean;
};
const fail = () => {
  throw new Error('Owned package graph evidence is unconfirmed.');
};
function authors(root: NativeXmlElement) {
  if (root.attribute('createdBy', CORE) !== 'MARIAN') fail();
  for (const key of ['createdBy', 'changedBy']) {
    const author = root.attribute(key, CORE);
    if (author && author !== 'MARIAN') fail();
  }
}
async function read(
  http: Pick<AdtHttpClient, 'get'>,
  path: string,
  options: AdtRequestOptions,
  record: PackageJournal,
  plain = false,
) {
  const response = await http.get(
    path,
    { Accept: plain ? 'text/plain' : 'application/*', 'Cache-Control': 'no-cache' },
    options,
  );
  record({
    ownedRead: path,
    status: response.statusCode,
    bytes: Buffer.byteLength(response.body),
    sha256: packageHash(response.body),
    body: response.body,
  });
  if (response.statusCode !== 200) fail();
  if (
    plain &&
    !Object.entries(response.headers).some(
      ([k, v]) => k.toLowerCase() === 'content-type' && v.split(';')[0].trim().toLowerCase() === 'text/plain',
    )
  )
    fail();
  return response.body;
}
export async function packageSnapshot(
  client: AdtClient,
  owner: PackageApiOwner,
  graph: PackageGraph,
  options: AdtRequestOptions,
  record: PackageJournal,
  active = true,
  childPresent = false,
  placement: 'local' | 'recorded' = 'local',
): Promise<OwnerReceipt> {
  if (owner.kind !== 'class' && owner.kind !== 'interface') {
    const body = await read(client.http, owner.owner, options, record);
    const root = nativeXmlRoot(body, 'package', 'http://www.sap.com/adt/packages', true);
    authors(root);
    if (root.attribute('version', CORE) !== 'active') fail();
    // Run the actual approved reader on these exact bytes; it still applies both actual package policies.
    const reader = Object.assign(Object.create(Object.getPrototypeOf(client)), client, {
      http: { get: async () => ({ statusCode: 200, headers: {}, body }) },
      getPackageHierarchyResolver: () => client.getPackageHierarchyResolver(options),
    }) as AdtClient;
    const value = await readPinnedPackage(reader, { name: owner.name, objectUrl: owner.owner });
    if (
      value.description !== owner.description ||
      value.responsible !== 'MARIAN' ||
      value.superPackage !== owner.parent ||
      value.softwareComponent !== 'LOCAL' ||
      value.transportLayer !== '' ||
      value.packageType !== 'development' ||
      value.recordChanges !== 'false'
    )
      fail();
    const subpackages = root.child('subPackages', 'http://www.sap.com/adt/packages');
    const refs = subpackages?.children('packageRef', 'http://www.sap.com/adt/packages') ?? [];
    const children = owner.kind === 'root' && childPresent ? [graph.child.owner] : [];
    if (
      refs.length > children.length ||
      refs.some(
        (ref) =>
          ref.attribute('name', CORE) !== graph.child.name ||
          ref.attribute('type', CORE) !== 'DEVC/K' ||
          ![graph.child.owner, graph.child.owner.toLowerCase()].includes(ref.attribute('uri', CORE) ?? '') ||
          ref.attribute('description', CORE) !== graph.child.description,
      )
    )
      fail();
    const expectedChildren = nativeXmlRoot(
      `<p:subPackages xmlns:p="http://www.sap.com/adt/packages" xmlns:c="${CORE}">${refs.length ? `<p:packageRef c:name="${graph.child.name}" c:type="DEVC/K" c:uri="${refs[0].attribute('uri', CORE)}" c:description="${graph.child.description}"/>` : ''}</p:subPackages>`,
      'subPackages',
      'http://www.sap.com/adt/packages',
      true,
    );
    if (
      subpackages &&
      JSON.stringify(subpackages.canonicalValue({})) !== JSON.stringify(expectedChildren.canonicalValue({}))
    )
      fail();
    // This view is never completeness or emptiness evidence. The child's own exact parent proves the relation.
    // Positive foreign entries refuse; missing/empty views remain distinct. Declared transitions alone
    // may refresh this slot, and the native DELETE remains authoritative for eligibility.
    // All remaining metadata stays byte-value strict, including authors/timestamps and unknown fields.
    const receipt = {
      metadataHash: packageHash(
        JSON.stringify(
          root.canonicalValue({
            omitChild: (name, ns, _child, depth) =>
              depth === 1 && name === 'subPackages' && ns === 'http://www.sap.com/adt/packages',
          }),
        ),
      ),
      children: subpackages ? refs.map(() => graph.child.owner) : undefined,
      active: true,
    };
    record({
      ownedSnapshot: owner.owner,
      receipt,
      parentMeaning: owner.parent ? 'exact-native-parent' : 'explicit-parentless-create-and-readback',
      recording: owner.kind === 'root' ? 'native-governed-unverified' : 'native-local-parent',
    });
    return receipt;
  }
  return nativeClassSnapshot(
    client,
    { ...owner, kind: owner.kind === 'interface' ? 'interface' : 'class' },
    owner.kind === 'interface' ? graph.root.name : placement === 'recorded' ? RECORDED_PACKAGE : graph.child.name,
    owner.kind === 'interface' ? owner.source : graph.clas.source,
    options,
    record,
    active,
  );
}
/** Same native owner/include/source proof used by fixed package and CTS qualification. */
export async function nativeClassSnapshot(
  client: AdtClient,
  owner: { name: string; owner: string; description: string; kind?: 'class' | 'interface' },
  packageName: string,
  expectedSource: string,
  options: AdtRequestOptions,
  record: PackageJournal,
  active = true,
): Promise<OwnerReceipt> {
  const metadata = async (explicit = false) => {
    const body = await read(client.http, owner.owner + (explicit ? '?version=active' : ''), options, record);
    const root = nativeXmlRoot(
      body,
      owner.kind === 'interface' ? 'abapInterface' : 'abapClass',
      owner.kind === 'interface' ? 'http://www.sap.com/adt/oo/interfaces' : 'http://www.sap.com/adt/oo/classes',
      true,
    );
    authors(root);
    if (
      root.attribute('name', CORE) !== owner.name ||
      root.attribute('type', CORE) !== (owner.kind === 'interface' ? 'INTF/OI' : 'CLAS/OC') ||
      root.attribute('description', CORE) !== owner.description ||
      root.child('packageRef', CORE)?.attribute('name', CORE) !== packageName
    )
      fail();
    const version = root.attribute('version', CORE);
    if (!['active', 'inactive'].includes(version ?? '') || (active && version !== 'active')) fail();
    const includeTypes = new Set<string>();
    for (const include of root.children('include', 'http://www.sap.com/adt/oo/classes')) {
      const kind = include.attribute('includeType', 'http://www.sap.com/adt/oo/classes');
      if (
        !kind ||
        !['main', 'definitions', 'implementations', 'macros', 'testclasses'].includes(kind) ||
        includeTypes.has(kind) ||
        include.attribute('type', CORE) !== 'CLAS/I' ||
        (active && include.attribute('version', CORE) !== 'active')
      )
        fail();
      includeTypes.add(kind!);
      const sourceUri = include.attribute('sourceUri', 'http://www.sap.com/adt/abapsource');
      if (sourceUri !== (kind === 'main' ? 'source/main' : `includes/${kind}`)) fail();
    }
    let count = 0;
    for (const link of root.children('link', 'http://www.w3.org/2005/Atom'))
      if (link.attribute('rel', '') === 'http://www.sap.com/adt/relations/objectstates') {
        const href = link.attribute('href', '');
        if (
          ++count !== 1 ||
          ![
            `${owner.owner}?version=active`,
            `${owner.owner}?version=inactive`,
            `${owner.owner}/source/main?version=active`,
            `${owner.owner}/source/main?version=inactive`,
          ].includes(href ?? '') ||
          (active && href?.endsWith('=inactive'))
        )
          fail();
      }
    return packageHash(JSON.stringify(root.canonicalValue({})));
  };
  const metadataHash = await metadata(),
    activeMetadataHash = active ? await metadata(true) : undefined;
  const source = await read(
    client.http,
    `${owner.owner}/source/main?version=${active ? 'active' : 'inactive'}`,
    options,
    record,
    true,
  );
  if (!editableSourceEquals(source, expectedSource)) fail();
  const receipt = {
    metadataHash,
    ...(activeMetadataHash ? { activeMetadataHash } : {}),
    sourceHash: sourceHash(source),
    active,
  };
  record({ ownedSnapshot: owner.owner, receipt });
  return receipt;
}
export async function packageOwnerAbsent(
  http: Pick<AdtHttpClient, 'get'>,
  owner: { owner: string },
  record: PackageJournal,
  options: AdtRequestOptions,
) {
  const strict: Pick<AdtHttpClient, 'get'> = {
    get: async (...args) => {
      try {
        return await http.get(...args);
      } catch (error) {
        if (error instanceof AdtApiError && error.statusCode === 404) {
          const root = nativeXmlRoot(error.responseBody ?? '', 'exception', EXC, true);
          if (
            root.child('namespace', '')?.attribute('id', '') !== 'com.sap.adt' ||
            root.child('type', '')?.attribute('id', '') !== 'ExceptionResourceNotFound'
          )
            throw new Error('Native absence unconfirmed.');
        }
        throw error;
      }
    },
  };
  await declarativeOwnerAbsent(strict, owner, record, options);
}
export async function packageAbsence(
  http: Pick<AdtHttpClient, 'get'>,
  graph: PackageGraph,
  record: PackageJournal,
  options: AdtRequestOptions,
  onUnconfirmed?: (owner: string) => void,
) {
  for (const owner of packageOwners(graph)) {
    try {
      await packageOwnerAbsent(http, owner, record, options);
    } catch (error) {
      onUnconfirmed?.(owner.owner);
      throw error;
    }
  }
  // Inventory code only consumes name/owner here. No declarative mutation adapter is selected.
  await declarativeInventoryClean(
    http,
    packageOwners(graph) as unknown as readonly DeclarativeFixture[],
    record,
    options,
  );
}
function text(node: NativeXmlElement | undefined): string | undefined {
  if (!node) return undefined;
  const fields = node.canonicalValue({}) as [string, unknown][];
  const texts = fields.filter(([key]) => key === 'text');
  if (
    texts.length !== 1 ||
    typeof texts[0][1] !== 'string' ||
    fields.some(([key]) => key !== 'text' && !key.startsWith('["attribute",'))
  )
    return undefined;
  return texts[0][1];
}
/** Source-backed PAK051 expectation; actual native encoding remains an execution qualification. No generic error is accepted. */
export function nativePackageNonempty(error: unknown, owner: PackageOwner) {
  if (!(error instanceof AdtApiError) || ![400, 409, 422, 500].includes(error.statusCode)) return undefined;
  try {
    const body = error.responseBody ?? '';
    // This qualified native envelope has no numeric-reference representation. The underlying
    // parser retains references lexically, so reject them before semantic key uniqueness checks.
    if (/&#/.test(body)) return undefined;
    const root = nativeXmlRoot(body, 'exception', EXC, true);
    if (
      root.child('namespace', '')?.attribute('id', '') !== 'com.sap.adt' ||
      !root.child('type', '')?.attribute('id', '')
    )
      return undefined;
    const entries = root.child('properties', '')?.children('entry', '') ?? [],
      properties = new Map<string, string>();
    for (const entry of entries) {
      const key = entry.attribute('key', '');
      if (!key || properties.has(key)) return undefined;
      // Native deletion failures carry unrelated opaque/empty diagnostics. Their values do not
      // establish PAK051; retain key uniqueness while parsing only authoritative T100 fields.
      if (!['T100KEY-MSGID', 'T100KEY-ID', 'T100KEY-MSGNO', 'T100KEY-NO', 'T100KEY-V1'].includes(key)) {
        properties.set(key, '');
        continue;
      }
      const value = text(entry);
      if (value === undefined) return undefined;
      properties.set(key, value);
    }
    const one = (a: string, b: string) =>
      properties.has(a) && properties.has(b) ? undefined : (properties.get(a) ?? properties.get(b));
    if (
      (properties.has('T100KEY-MSGID') && properties.has('T100KEY-ID')) ||
      (properties.has('T100KEY-MSGNO') && properties.has('T100KEY-NO'))
    )
      return undefined;
    const id = one('T100KEY-MSGID', 'T100KEY-ID'),
      number = one('T100KEY-MSGNO', 'T100KEY-NO');
    let basis: string | undefined;
    if ([...properties.keys()].some((key) => key.startsWith('T100KEY-'))) {
      if (id !== 'PAK' || number !== '051' || properties.get('T100KEY-V1') !== owner.name) return undefined;
      basis = 'native-T100-PAK051';
    } else {
      const expected = `Package ${owner.name} still contains development objects or other packages.`;
      const messages = ['message', 'localizedMessage']
        .map((key) => root.child(key, ''))
        .filter((v): v is NativeXmlElement => !!v);
      if (
        !messages.length ||
        messages.some(
          (node) => node.attribute('lang', '') !== 'EN' || text(node)?.replace(/\s+/g, ' ').trim() !== expected,
        )
      )
        return undefined;
      basis = 'exact-source-documented-English-PAK051';
    }
    return {
      status: error.statusCode,
      basis,
      package: owner.name,
      messageClass: 'PAK',
      messageNumber: '051',
      bytes: Buffer.byteLength(body),
      sha256: packageHash(body),
    };
  } catch {
    return undefined;
  }
}

/** Adapter errors can contain an echoed opaque handle. Keep outcomes and a digest, never their free text. */
export function packageAdapterEvidence(value: unknown) {
  const serialized = JSON.stringify(value),
    raw = value as Record<string, unknown>;
  let result = raw;
  try {
    if (Array.isArray(raw.content))
      result = JSON.parse(
        raw.content
          .filter((v) => v.type === 'text')
          .map((v) => v.text)
          .join('\n'),
      );
  } catch {
    /* Unknown result remains digest-only. */
  }
  const safe = Object.fromEntries(
    [
      'ok',
      'state',
      'phase',
      'success',
      'retryable',
      'sourceHash',
      'statusCode',
      'creationAttempted',
      'nativeEffects',
      'contentEvidence',
    ]
      .filter((k) => Object.hasOwn(result, k))
      .map((k) => [k, result[k]]),
  );
  return {
    ...safe,
    ...(raw.isError === true ? { isError: true } : {}),
    bytes: Buffer.byteLength(serialized),
    sha256: packageHash(serialized),
  };
}
