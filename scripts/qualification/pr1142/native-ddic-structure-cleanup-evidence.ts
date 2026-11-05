/** All requested views must explicitly remain new; version query parameters never prove native state. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { pinnedDdicSelection, readDdicEvidence } from '../../../src/adt/pinned-ddic-owner.js';
import { ddicHash } from './native-ddic-evidence.js';
import { STRUCTURE_RECEIPT, type StructureCleanupFixture } from './native-ddic-structure-cleanup-fixed.js';
export async function structureCleanupSnapshot(
  client: AdtClient,
  fixture: StructureCleanupFixture,
  updated: boolean,
  active: boolean,
  record: (row: unknown) => void,
  options: AdtRequestOptions,
) {
  if (updated || active) throw new Error('Only the exact retained new structure is admitted.');
  const canonicalHashes: string[] = [];
  let first: Awaited<ReturnType<typeof readDdicEvidence>> | undefined;
  const core = 'http://www.sap.com/adt/core';
  for (const version of [undefined, 'active', 'inactive'] as const) {
    const value = await readDdicEvidence(client, pinnedDdicSelection(fixture.type, fixture.name), version, options);
    const canonicalHash = ddicHash(JSON.stringify(value.root.canonicalValue({})));
    record({
      snapshot: fixture.owner,
      requestedVersion: version ?? 'default',
      nativeVersion: value.version,
      sha256: ddicHash(value.xml),
      canonicalHash,
      body: value.xml,
    });
    if (
      value.version !== 'new' ||
      value.packageName !== '$TMP' ||
      ['createdBy', 'changedBy', 'responsible'].some((k) => value.root.attribute(k, core) !== 'MARIAN') ||
      value.root.attribute('description', core) !== fixture.description ||
      canonicalHash !== STRUCTURE_RECEIPT.metadataCanonicalHash
    )
      throw new Error('Retained structure metadata/version/identity changed.');
    const path = `${fixture.owner}/source/main${version ? `?version=${version}` : ''}`;
    const source = await client.http.get(path, { 'Cache-Control': 'no-cache', Accept: 'text/plain' }, options);
    const hash = ddicHash(source.body),
      bytes = Buffer.byteLength(source.body);
    record({ source: path, status: source.statusCode, sha256: hash, bytes, body: source.body });
    const media = Object.entries(source.headers)
      .find(([k]) => k.toLowerCase() === 'content-type')?.[1]
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (
      source.statusCode !== 200 ||
      media !== 'text/plain' ||
      bytes !== STRUCTURE_RECEIPT.sourceBytes ||
      hash !== STRUCTURE_RECEIPT.sourceHash
    )
      throw new Error('Retained exact stored source changed.');
    canonicalHashes.push(canonicalHash);
    first ??= value;
  }
  if (!first) throw new Error('Retained structure evidence missing.');
  return {
    hash: first.hash,
    fields: first.fields,
    canonicalHashes,
    updated: false,
    active: false,
    sourceHash: STRUCTURE_RECEIPT.sourceHash,
  };
}
