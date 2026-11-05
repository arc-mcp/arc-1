/** Full fixed native receipts; a new read may confirm them, never replace the historical baseline. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { captureContractGroupBaseline } from './native-contract-inventory.js';
import { contractIdentity } from './native-contract-transport.js';
import { nativeRequestPolicy } from './native-observed-http.js';
import { type ProceduralRecord, poolReceipt } from './native-procedural-evidence.js';
import { GROUP, MARKER, MODULE, owners, ProceduralFailure } from './native-procedural-fixed.js';
import { groupCleanupReads } from './native-procedural-group-cleanup-fixed.js';
import { retainedAbsent } from './native-v5-retained-evidence.js';

export async function inspectProceduralGroupCleanup(
  client: AdtClient,
  record: ProceduralRecord,
  options: AdtRequestOptions,
) {
  const policy = nativeRequestPolicy(options),
    seen = new Set<string>();
  const expected = new Map<string, (typeof groupCleanupReads)[number]>(groupCleanupReads.map((r) => [r.path, r]));
  const http = new Proxy(client.http, {
    get(target, key) {
      if (key !== 'get') {
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (path: string, headers: Record<string, string>, supplied?: AdtRequestOptions) => {
        const bound = expected.get(path);
        if (!bound) throw new ProceduralFailure('group-cleanup-read-scope');
        const response = await target.get(
          path,
          headers,
          nativeRequestPolicy({
            ...supplied,
            ...policy,
            deadline: Math.min(policy.deadline!, supplied?.deadline ?? Infinity),
          }),
        );
        if (response.statusCode !== 200 || sourceHash(response.body) !== bound.sha256)
          throw new ProceduralFailure('group-cleanup-native-drift');
        seen.add(path);
        record({ groupCleanupReceipt: path, rawHash: bound.sha256, body: response.body });
        return response;
      };
    },
  }) as AdtHttpClient;
  const selection = { group: GROUP, module: MODULE, groupUrl: owners[0], moduleUrl: owners[1] };
  const baseline = await captureContractGroupBaseline(http, selection, MARKER, record, policy);
  for (const row of groupCleanupReads)
    if (!seen.has(row.path)) await http.get(row.path, { Accept: row.accept, 'Cache-Control': 'no-cache' }, policy);
  // Default metadata and the complete active pool must also satisfy the ordinary production readers.
  const metadata = await http.get(owners[0], { Accept: 'application/*' }, policy);
  contractIdentity(metadata.body, true, selection, MARKER);
  const boundClient = Object.assign(Object.create(Object.getPrototypeOf(client)), client, { http }) as AdtClient;
  if ((await poolReceipt(boundClient, record)).state !== 'active') throw new ProceduralFailure('pool-state');
  for (const child of owners.slice(1))
    for (const version of ['', '?version=active', '?version=inactive'])
      await retainedAbsent(client.http, child + version, record, policy);
  return { baseline };
}
