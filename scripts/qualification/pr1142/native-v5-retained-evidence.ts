/** Exact retained receipts and semantic native state; active-query HTTP200 alone proves nothing. */
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import {
  pinnedDeclarativeMetadata,
  pinnedDeclarativeSelection,
} from "../../../src/adt/pinned-repository-owner.js";
import {
  declarativeEvidenceRead,
  declarativeOwnerAbsent,
  declarativeSnapshot,
  type DeclarativeReader,
} from './native-declarative-evidence.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import type { DeclarativeReceipt } from './native-declarative-workflow.js';
import { nativeRequestPolicy } from './native-observed-http.js';
import {
  absentPeers,
  absentReference,
  initialHashes,
  originalService,
  retainedHash,
  retainedOwners,
  retainedService,
  RETAINED_SUFFIX,
  retainedView,
  revisedLabel,
} from './native-v5-retained-fixed.js';
const core = 'http://www.sap.com/adt/core';
type Journal = (row: unknown) => void;
export interface RetainedReceipt extends DeclarativeReceipt {
  description: string;
}
const read = (
  http: DeclarativeReader,
  path: string,
  accept: string,
  record: Journal,
  options: AdtRequestOptions,
) => declarativeEvidenceRead(http, path, accept, nativeRequestPolicy(options), record, 'body');
function identity(
  body: string,
  fixture: DeclarativeFixture,
  descriptions: readonly string[],
  active: boolean,
) {
  const parsed = pinnedDeclarativeMetadata(
    body,
    pinnedDeclarativeSelection(fixture.type, fixture.name),
    true,
  );
  const { root, packageName } = parsed,
    description = root.attribute('description', core),
    version = root.attribute('version', core);
  if (
    packageName !== '$TMP' ||
    !description ||
    !descriptions.includes(description) ||
    version !== (active ? 'active' : 'inactive') ||
    ['createdBy', 'changedBy', 'responsible'].some((key) => root.attribute(key, core) !== 'MARIAN')
  )
    throw new Error('Retained native identity/state changed.');
  return { description, version, canonical: retainedHash(JSON.stringify(root.canonicalValue({}))) };
}
/** Native description may reflect only the explicitly planned label change, never arbitrary text. */
export async function retainedSnapshot(
  http: DeclarativeReader,
  fixture: DeclarativeFixture,
  expected: string,
  active: boolean,
  record: Journal,
  options: AdtRequestOptions,
): Promise<RetainedReceipt> {
  const allowed =
    fixture.owner === retainedService.owner && expected === retainedService.updatedSource
      ? [originalService.description, revisedLabel]
      : [fixture.description];
  const metadata = await read(http, fixture.owner, 'application/*', record, options);
  if (metadata.statusCode !== 200) throw new Error('Retained metadata status changed.');
  const bound = identity(metadata.body, fixture, allowed, active);
  const receipt = await declarativeSnapshot(
    http,
    { ...fixture, description: bound.description },
    expected,
    active,
    record,
    options,
  );
  if (receipt.metadataHash !== bound.canonical) throw new Error('Retained metadata raced the snapshot.');
  return { ...receipt, description: bound.description };
}
export function sameRetainedReceipt(a: RetainedReceipt, b: RetainedReceipt) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Retained source/metadata receipt drift.');
}
export async function initialRetainedReceipt(
  http: DeclarativeReader,
  fixture: typeof retainedService | typeof retainedView,
  record: Journal,
  options: AdtRequestOptions,
) {
  const service = fixture.owner === retainedService.owner;
  const metadataHash = service ? initialHashes.serviceMetadata : initialHashes.viewMetadata;
  const expectedHash = service ? initialHashes.serviceSource : initialHashes.viewSource;
  let canonical: string | undefined;
  for (const query of ['', '?version=active', '?version=inactive']) {
    const response = await read(http, fixture.owner + query, 'application/*', record, options);
    if (response.statusCode !== 200 || retainedHash(response.body) !== metadataHash)
      throw new Error('Initial retained metadata changed.');
    const bound = identity(response.body, fixture, [originalService.description], !service);
    if (bound.version !== (service ? 'inactive' : 'active'))
      throw new Error('Initial native version changed.');
    canonical = bound.canonical;
  }
  for (const query of ['', '?version=active', '?version=inactive']) {
    const response = await read(http, `${fixture.owner}/source/main${query}`, 'text/plain', record, options);
    const media = Object.entries(response.headers)
      .find(([k]) => k.toLowerCase() === 'content-type')?.[1]
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (response.statusCode !== 200 || media !== 'text/plain' || retainedHash(response.body) !== expectedHash)
      throw new Error('Initial retained source changed.');
  }
  const receipt = await retainedSnapshot(
    http,
    fixture,
    service ? originalService.source : retainedView.updatedSource,
    !service,
    record,
    options,
  );
  if (receipt.metadataHash !== canonical || receipt.sourceHash !== expectedHash)
    throw new Error('Initial retained snapshot raced.');
  return receipt;
}
/** Namespace-bound native absence, with the shared error/status/domain checks retained. */
export async function retainedAbsent(
  http: DeclarativeReader,
  owner: string,
  record: Journal,
  options: AdtRequestOptions,
) {
  const strict: DeclarativeReader = {
    get: async (...args) => {
      try {
        return await http.get(...args);
      } catch (error) {
        if (error instanceof AdtApiError && error.statusCode === 404) {
          const root = nativeXmlRoot(
            error.responseBody ?? '',
            'exception',
            'http://www.sap.com/abapxml/types/communicationframework',
          );
          if (
            root.child('namespace', '')?.attribute('id', '') !== 'com.sap.adt' ||
            root.child('type', '')?.attribute('id', '') !== 'ExceptionResourceNotFound'
          )
            throw new Error('Native absence is unconfirmed.');
        }
        throw error;
      }
    },
  };
  await declarativeOwnerAbsent(strict, { owner }, record, options);
}
export async function retainedPeersAbsent(
  http: DeclarativeReader,
  record: Journal,
  options: AdtRequestOptions,
) {
  for (const peer of [...absentPeers, absentReference])
    await retainedAbsent(http, peer.owner, record, options);
}
export async function retainedInventory(
  http: DeclarativeReader,
  expectService: boolean,
  record: Journal,
  options: AdtRequestOptions,
) {
  const response = await declarativeEvidenceRead(
    http,
    '/sap/bc/adt/activation/inactiveobjects',
    'application/vnd.sap.adt.inactivectsobjects.v1+xml',
    nativeRequestPolicy(options),
    record,
    'hash-only',
  );
  if (response.statusCode !== 200) throw new Error('Native inventory status changed.');
  const media = Object.entries(response.headers)
    .find(([key]) => key.toLowerCase() === 'content-type')?.[1]
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!/^(application\/xml|text\/xml|[^;]+\+xml)$/.test(media ?? ''))
    throw new Error('Native inventory media changed.');
  const ns = 'http://www.sap.com/abapxml/inactiveCtsObjects';
  const root = nativeXmlRoot(response.body, 'inactiveObjects', ns);
  let owned = 0;
  for (const entry of root.children('entry', ns)) {
    const object = entry.child('object', ns);
    for (const ref of object?.children('ref', ns) ?? []) {
      const uri = ref.attribute('uri', core),
        name = ref.attribute('name', core);
      if (![uri, name].some((value) => value?.toUpperCase().includes(RETAINED_SUFFIX))) continue;
      if (
        !expectService ||
        ++owned !== 1 ||
        uri !== retainedService.owner ||
        name !== retainedService.name ||
        ref.attribute('type', core) !== 'SRVD/SRV' ||
        object?.attribute('user', ns) !== 'MARIAN' ||
        object.attribute('deleted', ns) !== 'false'
      )
        throw new Error('Unexpected retained inventory owner.');
    }
  }
  // This exact observed owned entry carries the suffix in URI/name only; unknown suffix occurrences stop.
  if (
    owned !== (expectService ? 1 : 0) ||
    (response.body.toUpperCase().match(new RegExp(RETAINED_SUFFIX, 'g'))?.length ?? 0) !== owned * 2
  )
    throw new Error('Retained inventory is unconfirmed.');
  record({ ownedInventory: expectService ? [retainedService.owner] : [], unrelatedBodiesRetained: false });
}
export async function inspectRetained(http: DeclarativeReader, record: Journal, options: AdtRequestOptions) {
  const view = await initialRetainedReceipt(http, retainedView, record, options);
  const service = await initialRetainedReceipt(http, retainedService, record, options);
  await retainedPeersAbsent(http, record, options);
  await retainedInventory(http, true, record, options);
  return { view, service };
}
export async function retainedFinalAbsence(
  http: DeclarativeReader,
  record: Journal,
  options: AdtRequestOptions,
) {
  for (const owner of retainedOwners) await retainedAbsent(http, owner, record, options);
  await retainedPeersAbsent(http, record, options);
  await retainedInventory(http, false, record, options);
}
/** Adapter free text can echo opaque handles. Retain semantic facts plus digest, not diagnostic prose. */
export function retainedOutcome(result: {
  content: { text: string }[];
  isError?: boolean;
}): Record<string, unknown> & { isError: boolean; bytes: number; sha256: string } {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(result.content[0].text);
  } catch {}
  const raw = JSON.stringify(result),
    safe: Record<string, unknown> = {};
  for (const name of [
    'state',
    'phase',
    'success',
    'sourceHash',
    'activeSourceVerified',
    'nativeStateVerified',
    'sessionClosed',
    'unlockFailed',
  ])
    if (Object.hasOwn(parsed, name)) safe[name] = parsed[name];
  return {
    ...safe,
    isError: result.isError === true,
    bytes: Buffer.byteLength(raw),
    sha256: retainedHash(raw),
  };
}
