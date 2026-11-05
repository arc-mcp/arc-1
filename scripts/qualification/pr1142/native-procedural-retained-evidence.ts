/** Read the exact retained state independently; active stub and intended inactive source remain distinct. */
import type { AdtClient } from '../../../src/adt/client.js';
import { functionActivationMetadata } from '../../../src/adt/function-activation-metadata.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { contractIdentity } from './native-contract-transport.js';
import { childReceipt, type ProceduralRecord, poolReceipt, sameChild } from './native-procedural-evidence.js';
import { GROUP, MARKER, MODULE, owners, POOL, ProceduralFailure, selected } from './native-procedural-fixed.js';
import { originalGroupBaseline, retainedHashes } from './native-procedural-retained-fixed.js';
import { tailHashes } from './native-procedural-tail-fixed.js';

const fail = () => {
  throw new ProceduralFailure('retained-state');
};
export async function inspectRetainedProcedural(
  client: AdtClient,
  record: ProceduralRecord,
  policy: AdtRequestOptions,
  state: 'original-retained' | 'after-include-edit-add' = 'original-retained',
) {
  const tail = state === 'after-include-edit-add',
    expected = tail ? tailHashes : retainedHashes;
  const read = async (path: string, accept: string) => {
    const r = await client.http.get(path, { Accept: accept, 'Cache-Control': 'no-cache' }, policy);
    if (r.statusCode !== 200 || Buffer.byteLength(r.body) > 1024 * 1024) fail();
    const media = Object.entries(r.headers)
      .find(([k]) => k.toLowerCase() === 'content-type')?.[1]
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (accept === 'text/plain' && media !== accept) fail();
    record({ retainedRead: path, sha256: sourceHash(r.body), body: r.body });
    return r.body;
  };
  const selection = { group: GROUP, module: MODULE, groupUrl: owners[0], moduleUrl: owners[1] };
  const views = {
    ...originalGroupBaseline.hashes,
    ...(tail
      ? { [owners[0]]: expected.parentActiveMetadata, [`${owners[0]}/source/main`]: expected.parentInserted }
      : {}),
  };
  for (const [path, originalHash] of Object.entries(views)) {
    const url = new URL(path, 'https://a4h.marianzeis.de');
    const metadata = url.pathname === owners[0],
      tree = url.pathname.endsWith('/objectstructure');
    const accept = metadata
      ? 'application/*'
      : tree
        ? 'application/vnd.sap.adt.objectstructure.v2+xml'
        : path.startsWith(POOL)
          ? `application/vnd.sap.adt.textelements.${url.pathname.split('/').at(-1)}.v1`
          : 'text/plain';
    const body = await read(path, accept),
      hash = sourceHash(body);
    if (metadata) {
      const identity = contractIdentity(body, true, selection, MARKER);
      if (identity.nativeVersion !== (tail || url.searchParams.get('version') === 'active' ? 'active' : 'inactive'))
        fail();
    }
    const choices: readonly string[] = metadata
      ? [url.searchParams.get('version') === 'active' ? expected.parentActiveMetadata : expected.parentInactiveMetadata]
      : tree
        ? [expected.tree]
        : path.includes(`/includes/l${GROUP.toLowerCase()}uxx/`)
          ? [expected.uxx]
          : url.pathname === `${owners[0]}/source/main`
            ? // The earlier retained state precedes insertion; this tail starts after group generation.
              !tail && url.searchParams.get('version') === 'active'
              ? [originalHash]
              : [expected.parentInserted]
            : [originalHash];
    if (!choices.includes(hash)) fail();
  }
  const draftModule = await childReceipt(client, 'FUNC', undefined, record, policy),
    inactiveModule = await childReceipt(client, 'FUNC', 'inactive', record, policy),
    originalModule = await childReceipt(client, 'FUNC', 'active', record, policy),
    include = await childReceipt(client, 'INCL', undefined, record, policy),
    inactiveInclude = await childReceipt(client, 'INCL', 'inactive', record, policy);
  sameChild(draftModule, inactiveModule);
  sameChild(include, inactiveInclude);
  if (
    draftModule.sourceHash !== expected.functionDraft ||
    draftModule.metadataHash !== expected.functionMetadata ||
    draftModule.version !== 'inactive' ||
    draftModule.inactiveAlternative ||
    originalModule.sourceHash !== expected.functionActive ||
    originalModule.metadataHash !== expected.functionMetadata ||
    originalModule.version !== 'active' ||
    !originalModule.inactiveAlternative ||
    include.sourceHash !== expected.includeDraft ||
    include.metadataHash !== expected.includeMetadata ||
    include.version !== 'inactive' ||
    include.inactiveAlternative
  )
    fail();
  // Native generated active INCL has no description. Only this exact captured XML/stub is accepted;
  // the ordinary child marker requirement is unchanged for all source edits and deletions.
  const activeMetadata = await read(`${owners[2]}?version=active`, 'application/*'),
    active = functionActivationMetadata(activeMetadata, selected.INCL, '$TMP'),
    activeSource = await read(`${owners[2]}/source/main?version=active`, 'text/plain');
  if (
    sourceHash(activeMetadata) !== expected.includeActiveMetadata ||
    sourceHash(activeSource) !== expected.includeActive ||
    active.version !== 'active' ||
    !active.inactiveAlternative
  )
    fail();
  const pool = await poolReceipt(client, record);
  if (pool.state !== 'active') fail();
  for (const part of ['symbols', 'selections', 'headings'] as const)
    for (const version of ['active', 'inactive'] as const)
      if (
        sourceHash(pool.parts[part][version]) !==
        originalGroupBaseline.hashes[
          `${POOL}/source/${part}?version=${version}` as keyof typeof originalGroupBaseline.hashes
        ]
      )
        fail();
  return { baseline: originalGroupBaseline, originalModule, draftModule, include };
}
