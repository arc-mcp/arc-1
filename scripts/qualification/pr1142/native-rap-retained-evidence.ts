/** Fresh exact retained bodies plus production identity/state/source readers. No query-inferred activation. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { pinnedDdicSelection, readDdicEvidence } from '../../../src/adt/pinned-ddic-owner.js';
import { ddicHash } from './native-ddic-evidence.js';
import { declarativeInventoryClean } from './native-declarative-evidence.js';
import { packageOwnerAbsent } from './native-package-evidence.js';
import { documentNodes } from './native-rap-documents-evidence.js';
import { type RapReceipt, rapSnapshot } from './native-rap-evidence.js';
import type { RapFixture } from './native-rap-fixtures.js';
import {
  RAP_APPROVE_TEXT,
  RAP_RETAINED_INDICES,
  RAP_RETAINED_READS,
  RAP_RETAINED_SUFFIX,
  rapRetainedFixtures,
} from './native-rap-retained-fixed.js';
import { RAP_RETAINED_V2_READS } from './native-rap-retained-v2-fixed.js';
import { RAP_RETAINED_V3_READS } from './native-rap-retained-v3-fixed.js';
export async function readRetainedRapGraph(
  client: AdtClient,
  fixtures: readonly RapFixture[],
  record: (v: unknown) => void,
  options: AdtRequestOptions,
  assert: () => void,
  unconfirmed: (owner: string) => void = () => {},
  editedDocument: boolean | 'updated-document' = false,
) {
  if (JSON.stringify(fixtures) !== JSON.stringify(rapRetainedFixtures(RAP_RETAINED_SUFFIX)))
    throw new Error('Fixed retained graph required.');
  const updatedDocument = editedDocument === 'updated-document';
  const reads = updatedDocument ? RAP_RETAINED_V3_READS : editedDocument ? RAP_RETAINED_V2_READS : RAP_RETAINED_READS;
  const check = (path: string, response: { statusCode: number; body: string }) => {
    const expected = reads.find((v) => v.path.toLowerCase() === path.toLowerCase());
    if (
      expected &&
      (response.statusCode !== 200 ||
        Buffer.byteLength(response.body) !== expected.bytes ||
        ddicHash(response.body) !== expected.sha256)
    )
      throw new Error('Retained native body, version or source changed.');
  };
  const http = new Proxy(client.http, {
    get(target, key) {
      if (key === 'get')
        return async (...args: Parameters<AdtHttpClient['get']>) => {
          const response = await target.get(...args);
          check(args[0], response);
          return response;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  // Every subsequent production snapshot must still match the bound raw views; never rebase intervening drift.
  client = Object.assign(Object.create(Object.getPrototypeOf(client)), client, { http }) as AdtClient;
  const bodies = new Map<string, string>();
  for (const expected of reads) {
    assert();
    const response = await client.http.get(expected.path, { Accept: expected.accept }, options);
    if (
      response.statusCode !== 200 ||
      Buffer.byteLength(response.body) !== expected.bytes ||
      ddicHash(response.body) !== expected.sha256
    )
      throw new Error('Retained native body, version or source changed.');
    bodies.set(expected.path, response.body);
    record({ retainedRead: expected.path, sha256: expected.sha256, bytes: expected.bytes });
  }
  const generated = new Map([['implementations', bodies.get(`${fixtures[2].owner}/includes/implementations`)!]]);
  const receipts = new Map<string, RapReceipt>();
  for (const i of RAP_RETAINED_INDICES)
    receipts.set(fixtures[i].owner, await rapSnapshot(client, fixtures[i], i !== 6, record, options, generated));
  const settings = await readDdicEvidence(
    client,
    pinnedDdicSelection('TABL/DTT', fixtures[0].name),
    undefined,
    options,
  );
  if (settings.version !== 'active' || settings.packageName !== '$TMP')
    throw new Error('Retained active settings unconfirmed.');
  const doc = receipts.get(fixtures[6].owner)!;
  const nodes = documentNodes(fixtures[6], doc.sources!.document),
    approve = `${fixtures[3].owner}/source/main#type=BDEF/BAC;name=${fixtures[3].name}.approve`;
  if (
    nodes.evidence.version !== 'inactive' ||
    nodes.nodes.get(nodes.ids[0])?.obligation !== 'forbidden' ||
    nodes.nodes.get(approve)?.longTextObligation !== 'mandatory' ||
    nodes.nodes.get(approve)?.obligation !== 'optional' ||
    nodes.nodes.size !== 6 ||
    [...nodes.nodes].some(
      ([id, n]) =>
        n.text !==
          (editedDocument
            ? id === nodes.ids[0]
              ? fixtures[6].create.source
              : id === approve
                ? RAP_APPROVE_TEXT
                : id === nodes.ids[1]
                  ? 'Owned create documentation.'
                  : updatedDocument && id === nodes.ids[2]
                    ? 'Owned update documentation.'
                    : ''
            : '') ||
        n.shortText !==
          (updatedDocument && id === nodes.ids[1]
            ? 'Create an owned RAP item'
            : updatedDocument && id === nodes.ids[2]
              ? 'Update an owned RAP item'
              : '') ||
        (n.longTextObligation === 'mandatory' && id !== approve),
    )
  )
    throw new Error('Actual retained documentation slots/state changed.');
  let activeDocument: RapReceipt | undefined;
  if (editedDocument) {
    const active = documentNodes(fixtures[6], bodies.get(`${fixtures[6].owner}?version=active`)!);
    if (
      active.evidence.version !== 'active' ||
      !active.evidence.inactiveAlternative ||
      [...active.nodes].some(
        ([id, n]) =>
          n.text !== (id === active.ids[0] ? fixtures[6].create.source : id === approve ? RAP_APPROVE_TEXT : '') ||
          n.shortText !== '',
      )
    )
      throw new Error('Retained active document counterpart changed.');
    // One separately observed active counterpart, not a whole-owner active snapshot.
    activeDocument = {
      active: true,
      fingerprint: ddicHash(JSON.stringify([active.evidence.hash])),
      sourceHashes: { document: ddicHash(active.evidence.stable) },
      sources: { document: active.evidence.xml },
      metadataHash: active.evidence.hash,
    };
    record({
      retainedActiveDocument: fixtures[6].owner,
      sha256: ddicHash(active.evidence.xml),
      nativeVersion: 'active',
    });
  }
  for (const i of [4, 5]) {
    try {
      await packageOwnerAbsent(client.http, fixtures[i], record, options);
    } catch (error) {
      unconfirmed(fixtures[i].owner);
      throw error;
    }
  }
  await declarativeInventoryClean(client.http, [], record, options);
  assert();
  return {
    receipts,
    generated,
    activeDocument,
    settingsHash: ddicHash(JSON.stringify(settings.root.canonicalValue({}))),
  };
}
