/** Exact current literal receipts after the consumed parent-release attempt. No mutation. */
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { CTS_BASE } from './native-cts-fixtures.js';
import { type PackageJournal, packageHash } from './native-package-evidence.js';
export const CTS_V6_VIEWS = [
  ['A4HK906607', '2961a832f286ad0212671aea48eb13424fef5b6582df649134b74ec2bb5ff311', 8065],
  ['A4HK906608', '8003a354229987168112d2b569fdc2c6c12395839209f2e9a0e7bd844733ccaa', 4886],
] as const;
export function assertRetainedCtsV6View(id: string, status: number, body: string) {
  const view = CTS_V6_VIEWS.find((v) => v[0] === id);
  if (!view || status !== 200 || Buffer.byteLength(body) !== view[2] || packageHash(body) !== view[1])
    throw Error('Exact released A parent/task view changed.');
}
export async function retainedCtsV6Snapshot(http: AdtHttpClient, options: AdtRequestOptions, record: PackageJournal) {
  for (const [id, sha, bytes] of CTS_V6_VIEWS) {
    const r = await http.get(
      CTS_BASE + id,
      { Accept: 'application/vnd.sap.adt.transportorganizer.v1+xml', 'Cache-Control': 'no-cache' },
      options,
    );
    record({
      retainedReleasedPairView: id,
      status: r.statusCode,
      bytes: Buffer.byteLength(r.body),
      sha256: packageHash(r.body),
      body: r.body,
    });
    if (r.statusCode !== 200 || Buffer.byteLength(r.body) !== bytes || packageHash(r.body) !== sha)
      throw Error('Exact post-release native view changed.');
  }
}
