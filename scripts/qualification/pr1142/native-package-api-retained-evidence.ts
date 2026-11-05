/** Exact historical bytes plus current native parser evidence. Never treats requested active as native state. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { declarativeInventoryClean } from './native-declarative-evidence.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { PACKAGE_API_MOVED_READS } from './native-package-api-moved-fixed.js';
import { packageApiOwners } from './native-package-api-profile.js';
import { PACKAGE_API_RETAINED_GRAPH, PACKAGE_API_RETAINED_READS } from './native-package-api-retained-fixed.js';
import { type OwnerReceipt, type PackageJournal, packageHash, packageSnapshot } from './native-package-evidence.js';
import type { PackageGraph } from './native-package-fixtures.js';
export async function inspectRetainedPackageApi(
  client: AdtClient,
  graph: PackageGraph,
  options: AdtRequestOptions,
  record: PackageJournal,
  moved = false,
) {
  if (JSON.stringify(graph) !== JSON.stringify(PACKAGE_API_RETAINED_GRAPH))
    throw new Error('Fixed retained package graph required.');
  const reads = moved ? PACKAGE_API_MOVED_READS : PACKAGE_API_RETAINED_READS;
  const match = (path: string, response: { statusCode: number; body: string }) => {
    const expected = reads.find((r) => r.path === path);
    if (
      !expected ||
      response.statusCode !== 200 ||
      packageHash(response.body) !== expected.sha256 ||
      Buffer.byteLength(response.body) !== expected.bytes
    )
      throw new Error('Retained package/API raw evidence drift.');
  };
  for (const expected of reads) {
    const response = await client.http.get(
      expected.path,
      { ...(expected.accept ? { Accept: expected.accept } : {}), 'Cache-Control': 'no-cache' },
      options,
    );
    record({
      retainedRead: expected.path,
      status: response.statusCode,
      bytes: Buffer.byteLength(response.body),
      sha256: packageHash(response.body),
      body: response.body,
    });
    match(expected.path, response);
  }
  // Recheck each actual production-parser read too; do not rebase opaque drift after the initial seventeen observations.
  const http = new Proxy(client.http, {
    get(target, key) {
      if (key === 'get')
        return async (...args: Parameters<typeof target.get>) => {
          const response = await target.get(...args);
          match(args[0], response);
          return response;
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const observed = Object.assign(Object.create(Object.getPrototypeOf(client)), client, { http }) as AdtClient;
  const receipts: Record<string, OwnerReceipt> = {};
  for (const owner of packageApiOwners(graph))
    receipts[owner.owner] = await packageSnapshot(
      observed,
      owner,
      graph,
      options,
      record,
      true,
      true,
      moved ? 'recorded' : 'local',
    );
  await declarativeInventoryClean(
    client.http,
    packageApiOwners(graph) as unknown as readonly DeclarativeFixture[],
    record,
    options,
  );
  return receipts;
}

export const inspectMovedPackageApi = (
  client: AdtClient,
  graph: PackageGraph,
  options: AdtRequestOptions,
  record: PackageJournal,
) => inspectRetainedPackageApi(client, graph, options, record, true);
