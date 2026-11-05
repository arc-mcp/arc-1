/** Exact active seven-owner graph and implicit settings; no inactive-query inference or old mutation replay. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { pinnedDdicSelection, readDdicEvidence } from '../../../src/adt/pinned-ddic-owner.js';
import { ddicHash } from './native-ddic-evidence.js';
import { declarativeInventoryClean } from './native-declarative-evidence.js';
import { documentNodes } from './native-rap-documents-evidence.js';
import { type RapReceipt, rapSnapshot } from './native-rap-evidence.js';
import type { RapFixture } from './native-rap-fixtures.js';
import { RAP_APPROVE_TEXT, RAP_RETAINED_SUFFIX, rapRetainedFixtures } from './native-rap-retained-fixed.js';
import { RAP_RETAINED_V4_READS } from './native-rap-retained-v4-fixed.js';
export async function readActiveRetainedRapGraph(
  client: AdtClient,
  fixtures: readonly RapFixture[],
  record: (v: unknown) => void,
  options: AdtRequestOptions,
  assert: () => void,
  _unconfirmed?: (owner: string) => void,
  _legacy?: boolean | 'updated-document',
) {
  if (JSON.stringify(fixtures) !== JSON.stringify(rapRetainedFixtures(RAP_RETAINED_SUFFIX)))
    throw new Error('Exact active retained RAP graph required.');
  const check = (path: string, response: { statusCode: number; body: string }) => {
    const expected = RAP_RETAINED_V4_READS.find((v) => v.path.toLowerCase() === path.toLowerCase());
    if (
      expected &&
      (response.statusCode !== 200 ||
        Buffer.byteLength(response.body) !== expected.bytes ||
        ddicHash(response.body) !== expected.sha256)
    )
      throw new Error('Retained active native body, version or source changed.');
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
  client = Object.assign(Object.create(Object.getPrototypeOf(client)), client, { http }) as AdtClient;
  const bodies = new Map<string, string>();
  for (const expected of RAP_RETAINED_V4_READS) {
    assert();
    const response = await client.http.get(expected.path, { Accept: expected.accept }, options);
    check(expected.path, response);
    bodies.set(expected.path.toLowerCase(), response.body);
    record({ retainedRead: expected.path, sha256: expected.sha256, bytes: expected.bytes });
  }
  const generated = new Map([['implementations', bodies.get(`${fixtures[2].owner}/includes/implementations`)!]]);
  const receipts = new Map<string, RapReceipt>();
  for (const f of fixtures)
    receipts.set(
      f.owner,
      await rapSnapshot(client, f, true, record, options, generated, f.type === 'SRVB' ? false : undefined),
    );
  const binding = receipts.get(fixtures[5].owner)!;
  if (binding.bindingCreated !== true || binding.published !== false)
    throw new Error('Physically active unpublished generated binding required.');
  const activeDocument = receipts.get(fixtures[6].owner)!;
  const nodes = documentNodes(fixtures[6], activeDocument.sources!.document);
  const approve = `${fixtures[3].owner}/source/main#type=BDEF/BAC;name=${fixtures[3].name}.approve`;
  if (
    nodes.evidence.version !== 'active' ||
    nodes.evidence.inactiveAlternative ||
    nodes.nodes.size !== 6 ||
    nodes.nodes.get(nodes.ids[0])?.obligation !== 'forbidden' ||
    nodes.nodes.get(approve)?.longTextObligation !== 'mandatory' ||
    nodes.nodes.get(approve)?.obligation !== 'optional' ||
    [...nodes.nodes].some(
      ([id, n]) =>
        n.text !==
          (id === nodes.ids[0]
            ? fixtures[6].create.source
            : id === approve
              ? RAP_APPROVE_TEXT
              : id === nodes.ids[1]
                ? 'Owned create documentation.'
                : id === nodes.ids[2]
                  ? 'Owned update documentation.'
                  : '') ||
        n.shortText !==
          (id === nodes.ids[1] ? 'Create an owned RAP item' : id === nodes.ids[2] ? 'Update an owned RAP item' : '') ||
        (n.longTextObligation === 'mandatory' && id !== approve),
    )
  )
    throw new Error('Retained complete active documentation changed.');
  const settings = await readDdicEvidence(
    client,
    pinnedDdicSelection('TABL/DTT', fixtures[0].name),
    undefined,
    options,
  );
  if (settings.version !== 'active' || settings.packageName !== '$TMP')
    throw new Error('Retained active settings unconfirmed.');
  await declarativeInventoryClean(client.http, [], record, options);
  assert();
  return {
    receipts,
    generated,
    activeDocument,
    settingsHash: ddicHash(JSON.stringify(settings.root.canonicalValue({}))),
  };
}
