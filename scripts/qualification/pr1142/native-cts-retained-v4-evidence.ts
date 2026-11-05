/** Re-recorded deleted CLAS belongs to the fixed CTS pair, not a live package-bearing object. */
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { CTS_BASE, CTS_RETAINED_SUFFIX, type CtsGraph } from './native-cts-fixtures.js';
import { type PackageJournal, packageHash } from './native-package-evidence.js';
export const CTS_RETAINED_V4_REQUEST_VIEWS = [
  ['A4HK906607', '724b5fe034d5d3f2f1f785ca2321ac6df259f9559a24155ef1309c38223c85f0', 12739],
  ['A4HK906608', '83990001da065a2accf5c712192c9faf5c9020502727831e80696f936ea7ebf3', 11665],
] as const;
export async function retainedCtsV4Snapshot(
  http: AdtHttpClient,
  graph: CtsGraph,
  options: AdtRequestOptions,
  record: PackageJournal,
) {
  if (graph.suffix !== CTS_RETAINED_SUFFIX) throw new Error('Fixed retained CTS pair required.');
  for (const [id, expected, bytes] of CTS_RETAINED_V4_REQUEST_VIEWS) {
    const response = await http.get(
      CTS_BASE + id,
      { Accept: 'application/vnd.sap.adt.transportorganizer.v1+xml', 'Cache-Control': 'no-cache' },
      options,
    );
    record({
      retainedDeletedCtsView: id,
      status: response.statusCode,
      bytes: Buffer.byteLength(response.body),
      sha256: packageHash(response.body),
      body: response.body,
    });
    if (
      response.statusCode !== 200 ||
      Buffer.byteLength(response.body) !== bytes ||
      packageHash(response.body) !== expected
    )
      throw new Error('Exact retained recorded-deletion request/task receipt changed.');
  }
}
