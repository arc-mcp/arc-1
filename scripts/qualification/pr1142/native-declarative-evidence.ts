/** Independent stateless ownership and absence evidence for the selected disposable native objects. */
import { createHash } from 'node:crypto';
import {
  AdtApiError,
  AdtNetworkError,
  AdtResponseLimitError,
  classifySapDomainError,
  extractExceptionType,
} from '../../../src/adt/errors.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { pinnedDeclarativeMetadata, pinnedDeclarativeSelection } from "../../../src/adt/pinned-repository-owner.js";
import { pinnedDeclarativeStateLinkVersion } from "../../../src/adt/pinned-repository-owner.js";
import { editableSourceEquals, sourceHash } from '../../../src/adt/source-precondition.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { DeclarativeFailure, type DeclarativeReason, type DeclarativeReceipt } from './native-declarative-workflow.js';
import { nativeRequestPolicy } from './native-observed-http.js';
const core = 'http://www.sap.com/adt/core';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const retainedBodyLimit = 1024 * 1024;
/** Evidence reads need GET alone, which also lets a read-only preflight hold no mutating method. */
export type DeclarativeReader = Pick<AdtHttpClient, 'get'>;
type Journal = (value: unknown) => void;

const size = (body: string) => ({ bytes: Buffer.byteLength(body), sha256: hash(body) });
const mediaType = (headers: { [name: string]: string }) =>
  Object.entries(headers)
    .find(([name]) => name.toLowerCase() === 'content-type')?.[1]
    .split(';')[0]
    .trim()
    .toLowerCase();
/** A body over the retained bound keeps its size and hash; the marker distinguishes it from an empty read. */
const retained = (body: string) =>
  Buffer.byteLength(body) <= retainedBodyLimit ? { body } : { bodyOmitted: 'size-limit' };

/** Only typed SAP errors retain a body. Exception text never reaches the journal; AdtApiError exposes no media type. */
function failedReadRow(read: string, error: unknown, keepTypedBody: boolean) {
  if (!(error instanceof AdtApiError))
    return {
      read,
      failure:
        error instanceof AdtResponseLimitError
          ? 'response-limit'
          : error instanceof AdtNetworkError
            ? 'network'
            : 'unclassified',
    };
  const body = error.responseBody ?? '';
  const exceptionType = keepTypedBody ? extractExceptionType(body) : undefined;
  return {
    read,
    failure: 'http-error',
    status: error.statusCode,
    ...size(body),
    ...(exceptionType ? { exceptionType, ...retained(body) } : {}),
  };
}

/** Durably records the native answer before any caller check can refuse it. */
async function evidenceRead(
  http: DeclarativeReader,
  path: string,
  accept: string,
  options: AdtRequestOptions,
  record: Journal,
  keep: 'body' | 'hash-only',
) {
  let response: Awaited<ReturnType<AdtHttpClient['get']>>;
  try {
    response = await http.get(path, { Accept: accept, 'Cache-Control': 'no-cache' }, options);
  } catch (error) {
    record(failedReadRow(path, error, keep === 'body'));
    throw error;
  }
  record({
    read: path,
    status: response.statusCode,
    media: mediaType(response.headers),
    ...size(response.body),
    ...(keep === 'body' ? retained(response.body) : {}),
  });
  return response;
}

function readFailure(error: unknown, reason: DeclarativeReason) {
  return new DeclarativeFailure(reason, error instanceof AdtApiError ? { status: error.statusCode } : {});
}

export async function declarativeSnapshot(
  http: DeclarativeReader,
  fixture: DeclarativeFixture,
  expectedSource: string,
  active: boolean,
  record: Journal,
  options: AdtRequestOptions,
): Promise<DeclarativeReceipt> {
  const policy = nativeRequestPolicy(options);
  const selected = pinnedDeclarativeSelection(fixture.type, fixture.name);
  async function metadata(version?: 'active') {
    const response = await evidenceRead(
      http,
      fixture.owner + (version ? '?version=active' : ''),
      'application/*',
      nativeRequestPolicy(policy),
      record,
      'body',
    ).catch((error) => {
      throw readFailure(error, 'metadata-read-failed');
    });
    if (response.statusCode !== 200) throw new DeclarativeFailure('metadata-status', { status: response.statusCode });
    let parsed: ReturnType<typeof pinnedDeclarativeMetadata>;
    try {
      parsed = pinnedDeclarativeMetadata(response.body, selected, true);
    } catch {
      throw new DeclarativeFailure('metadata-identity');
    }
    const { root, packageName } = parsed;
    const nativeVersion = root.attribute('version', core);
    if (packageName !== '$TMP') throw new DeclarativeFailure('metadata-package');
    if (root.attribute('description', core) !== fixture.description) throw new DeclarativeFailure('metadata-marker');
    if (!['active', 'inactive'].includes(nativeVersion ?? '')) throw new DeclarativeFailure('metadata-version');
    if (active && nativeVersion !== 'active') throw new DeclarativeFailure('metadata-not-active');
    for (const field of ['createdBy', 'changedBy']) {
      const author = root.attribute(field, core);
      if (author && author !== 'MARIAN') throw new DeclarativeFailure('metadata-author');
    }
    let alternatives = 0;
    for (const link of root.children('link', 'http://www.w3.org/2005/Atom')) {
      if (link.attribute('rel', '') === 'http://www.sap.com/adt/relations/objectstates') {
        const alternative = pinnedDeclarativeStateLinkVersion(fixture.type, fixture.owner, link.attribute('href', ''));
        if (++alternatives !== 1 || alternative === undefined || (active && alternative === 'inactive'))
          throw new DeclarativeFailure('metadata-state-link');
      }
    }
    record({ metadata: fixture.owner, requestedVersion: version ?? 'default', nativeVersion });
    return hash(JSON.stringify(root.canonicalValue({})));
  }
  const metadataHash = await metadata();
  const activeMetadataHash = active ? await metadata('active') : undefined;
  const source = await evidenceRead(
    http,
    `${fixture.owner}/source/main?version=${active ? 'active' : 'inactive'}`,
    'text/plain',
    nativeRequestPolicy(policy),
    record,
    'body',
  ).catch((error) => {
    throw readFailure(error, 'source-read-failed');
  });
  if (source.statusCode !== 200) throw new DeclarativeFailure('source-status', { status: source.statusCode });
  if (mediaType(source.headers) !== 'text/plain') throw new DeclarativeFailure('source-media');
  if (!editableSourceEquals(source.body, expectedSource)) throw new DeclarativeFailure('source-content');
  const receipt = {
    metadataHash,
    ...(active ? { activeMetadataHash } : {}),
    sourceHash: sourceHash(source.body),
    activeVerified: active,
  };
  record({ snapshot: fixture.owner, receipt });
  return receipt;
}

export async function declarativeOwnerAbsent(
  http: DeclarativeReader,
  fixture: Pick<DeclarativeFixture, 'owner'>,
  record: Journal,
  options: AdtRequestOptions,
) {
  let response: Awaited<ReturnType<DeclarativeReader['get']>>;
  try {
    response = await evidenceRead(http, fixture.owner, 'application/*', nativeRequestPolicy(options), record, 'body');
  } catch (error) {
    if (
      error instanceof AdtApiError &&
      error.statusCode === 404 &&
      extractExceptionType(error.responseBody ?? '') === 'ExceptionResourceNotFound' &&
      !classifySapDomainError(error.statusCode, error.responseBody, error.path)
    ) {
      record({ absence: fixture.owner, typed404: true });
      return;
    }
    // Any other error is not evidence of absence; `failedReadRow` already kept its status and hash.
    throw readFailure(error, error instanceof AdtApiError ? 'absence-not-typed' : 'absence-read-failed');
  }
  if (response.statusCode !== 200) throw new DeclarativeFailure('absence-not-typed', { status: response.statusCode });
  throw new DeclarativeFailure('absence-owner-present');
}

/** The inventory can name other users' drafts, so it stays hash-only on every path. */
export async function declarativeInventoryClean(
  http: DeclarativeReader,
  fixtures: readonly DeclarativeFixture[],
  record: Journal,
  options: AdtRequestOptions,
) {
  const response = await evidenceRead(
    http,
    '/sap/bc/adt/activation/inactiveobjects',
    'application/vnd.sap.adt.inactivectsobjects.v1+xml',
    nativeRequestPolicy(options),
    record,
    'hash-only',
  ).catch((error) => {
    throw readFailure(error, 'inventory-read-failed');
  });
  if (response.statusCode !== 200) throw new DeclarativeFailure('inventory-status', { status: response.statusCode });
  if (!/^(application\/xml|text\/xml|[^;]+\+xml)$/.test(mediaType(response.headers) ?? ''))
    throw new DeclarativeFailure('inventory-media');
  const containsFixture = fixtures.some((fixture) => response.body.toUpperCase().includes(fixture.name.slice(-16)));
  record({ inactiveInventory: { ...size(response.body), containsFixture } });
  if (containsFixture) throw new DeclarativeFailure('inventory-contains-fixture');
  try {
    nativeXmlRoot(response.body, 'inactiveObjects', 'http://www.sap.com/abapxml/inactiveCtsObjects');
  } catch {
    throw new DeclarativeFailure('inventory-malformed');
  }
}

export async function declarativeAbsence(
  http: DeclarativeReader,
  fixtures: readonly DeclarativeFixture[],
  record: Journal,
  options: AdtRequestOptions,
  readOnlyReferences: readonly { owner: string }[] = [],
) {
  for (const fixture of fixtures) await declarativeOwnerAbsent(http, fixture, record, options);
  for (const reference of readOnlyReferences) await declarativeOwnerAbsent(http, reference, record, options);
  await declarativeInventoryClean(http, fixtures, record, options);
}

export { evidenceRead as declarativeEvidenceRead };
