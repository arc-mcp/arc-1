/** Synthetic receipt values only; all real driver/client/parser/send paths remain composed. */
import { createHash } from 'node:crypto';
import { vi } from 'vitest';

const proof = vi.hoisted(() => ({
  paths: [] as { path: string; accept: string | null }[],
  reads: [] as { path: string; accept: string | null; sha256: string; bytes: number }[],
  pair: { request: 'A4HK906609', task: 'A4HK906610', targetReceipt: '', initialRequestHash: '' },
}));
vi.mock('../../../scripts/qualification/pr1142/native-package-api-retained-fixed.js', async (original) => {
  const actual =
    await original<typeof import('../../../scripts/qualification/pr1142/native-package-api-retained-fixed.js')>();
  proof.paths = actual.PACKAGE_API_RETAINED_READS.map((r) => ({ path: r.path, accept: r.accept }));
  return {
    ...actual,
    PACKAGE_API_RETAINED_READS: proof.reads,
    PACKAGE_API_RETAINED_PAIR: proof.pair,
    PACKAGE_API_RETAINED_PROFILE: {
      ...actual.PACKAGE_API_RETAINED_PROFILE,
      reads: proof.reads,
      retainedPair: proof.pair,
    },
  };
});

const { PACKAGE_API_RETAINED_GRAPH: graph } = await import(
  '../../../scripts/qualification/pr1142/native-package-api-retained-fixed.js'
);
const { packageApiHarness } = await import('./pr1142-native-package-api-harness.js');
export async function retainedHarness(
  options: {
    proxy?: boolean;
    semaphore?: import('../../../src/adt/semaphore.js').Semaphore;
    token?: () => Promise<string>;
  } = {},
) {
  const h = packageApiHarness({ ...options, retainedApi: true, graph });
  proof.reads.length = 0;
  for (const expected of proof.paths) {
    const response = await h.client.http.get(expected.path, expected.accept ? { Accept: expected.accept } : undefined);
    const hash = createHash('sha256').update(response.body).digest('hex');
    proof.reads.push({ ...expected, sha256: hash, bytes: Buffer.byteLength(response.body) });
    if (expected.path === '/sap/bc/adt/packages/ZARC1_DEMO') proof.pair.targetReceipt = hash;
    if (expected.path === '/sap/bc/adt/cts/transportrequests/A4HK906609') proof.pair.initialRequestHash = hash;
  }
  h.calls.length = 0;
  return h;
}
export { graph };
