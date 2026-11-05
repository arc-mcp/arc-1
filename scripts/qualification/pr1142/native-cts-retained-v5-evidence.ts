/** Exact current literal receipts after the consumed task-release attempt. No mutation. */
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { CTS_BASE } from './native-cts-fixtures.js';
import { type PackageJournal, packageHash } from './native-package-evidence.js';
export const CTS_V5_VIEWS = [
  ['A4HK906607', '67329f647e4327e3c45f37505acd737fe6040de365f1fb9a7ef20232aabf6933', 11419],
  ['A4HK906608', 'ef4429efdbb5e696487aa57af58eb06b1510fcbfe090c254c2ead601084af1e1', 8261],
] as const;
export async function retainedCtsV5Snapshot(http: AdtHttpClient, options: AdtRequestOptions, record: PackageJournal) {
  for (const [id, sha, bytes] of CTS_V5_VIEWS) {
    const r = await http.get(
      CTS_BASE + id,
      { Accept: 'application/vnd.sap.adt.transportorganizer.v1+xml', 'Cache-Control': 'no-cache' },
      options,
    );
    record({
      retainedReleasedTaskView: id,
      status: r.statusCode,
      bytes: Buffer.byteLength(r.body),
      sha256: packageHash(r.body),
      body: r.body,
    });
    if (r.statusCode !== 200 || Buffer.byteLength(r.body) !== bytes || packageHash(r.body) !== sha)
      throw Error('Exact post-release native view changed.');
  }
}
