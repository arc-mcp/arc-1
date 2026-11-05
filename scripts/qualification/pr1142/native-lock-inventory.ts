/** Complete, explicitly inspected owned-group inventory for a separate recovery command. */
import { createHash } from 'node:crypto';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import {
  contractFunctionMetadataHash,
  contractIdentity,
  contractRequestPolicy,
  type NativeContractSelection,
} from './native-contract-transport.js';
import type { ActiveFunctionReceipt } from './native-lock-observation.js';

export interface OwnedFunctionInventory {
  group: string;
  hashes: Record<string, string>;
}
function requests(s: NativeContractSelection) {
  return [
    {
      path: `${s.groupUrl}/objectstructure`,
      accept: 'application/vnd.sap.adt.objectstructure.v2+xml',
      kind: 'structure',
    },
    ...['active', 'inactive'].flatMap((version) => [
      ...[s.groupUrl, s.moduleUrl].map((path) => ({
        path: `${path}?version=${version}`,
        accept: 'application/*',
        kind: 'metadata',
      })),
      ...[
        `${s.groupUrl}/source/main`,
        ...['TOP', 'UXX'].map(
          (part) => `${s.groupUrl}/includes/l${s.group.toLowerCase()}${part.toLowerCase()}/source/main`,
        ),
        `${s.moduleUrl}/source/main`,
      ].map((path) => ({ path: `${path}?version=${version}`, accept: 'text/plain', kind: 'source' })),
      ...['symbols', 'selections', 'headings'].map((part) => ({
        path: `/sap/bc/adt/textelements/functiongroups/${s.group}/source/${part}?version=${version}`,
        accept: `application/vnd.sap.adt.textelements.${part}.v1`,
        kind: 'text',
      })),
    ]),
  ];
}
function assertOwnedTree(body: string, s: NativeContractSelection) {
  const ns = 'http://www.sap.com/adt/abapsource',
    core = 'http://www.sap.com/adt/core';
  const root = nativeXmlRoot(body, 'objectStructureElement', ns);
  const children = root.children('objectStructureElement', ns);
  const expected = new Map([
    [`L${s.group}TOP`, 'FUGR/I'],
    [`L${s.group}UXX`, 'FUGR/I'],
    [`SAPL${s.group}`, 'FUGR/PX'],
    [s.module, 'FUGR/FF'],
  ]);
  if (
    root.attribute('name', core) !== s.group ||
    root.attribute('type', core) !== 'FUGR/F' ||
    children.length !== expected.size ||
    new Set(children.map((c) => c.attribute('name', core))).size !== expected.size ||
    children.some(
      (c) =>
        !expected.has(c.attribute('name', core) ?? '') ||
        expected.get(c.attribute('name', core)!) !== c.attribute('type', core) ||
        c.children('objectStructureElement', ns).length > 0,
    )
  )
    throw new Error('The group tree is not exactly the four expected owned/generated members.');
}

export async function captureOwnedFunctionInventory(
  http: AdtHttpClient,
  selection: NativeContractSelection,
  marker: string,
  receipt: ActiveFunctionReceipt,
  record: (value: unknown) => void,
  policy?: AdtRequestOptions,
): Promise<OwnedFunctionInventory> {
  const hashes: Record<string, string> = {};
  const budget = contractRequestPolicy(policy);
  for (const request of requests(selection)) {
    const r = await http.get(
      request.path,
      { Accept: request.accept, 'Cache-Control': 'no-cache' },
      contractRequestPolicy(budget),
    );
    const media = r.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    const xml = request.kind === 'structure' || request.kind === 'metadata';
    if (
      r.statusCode !== 200 ||
      Buffer.byteLength(r.body) > 1024 * 1024 ||
      (xml
        ? !(media === 'application/xml' || media === 'text/xml' || media?.endsWith('+xml'))
        : media !== request.accept)
    )
      throw new Error('The inspected inventory requires complete bounded responses with qualified media types.');
    if (request.kind === 'structure') assertOwnedTree(r.body, selection);
    if (request.kind === 'metadata') {
      const group = request.path.startsWith(`${selection.groupUrl}?`);
      const identity = contractIdentity(r.body, group, selection, marker);
      if (
        !group &&
        (contractFunctionMetadataHash(r.body, selection) !== receipt.metadataHash ||
          (request.path.endsWith('version=active') && identity.nativeVersion !== 'active'))
      )
        throw new Error('Function metadata no longer matches the recorded active receipt.');
    }
    if (request.path.startsWith(`${selection.moduleUrl}/source/main?`) && sourceHash(r.body) !== receipt.hash)
      throw new Error('Function source no longer matches the recorded active receipt.');
    const hash = createHash('sha256').update(r.body).digest('hex');
    record({ ownedInventory: request.path, contentType: media, hash, body: r.body });
    hashes[request.path] = hash;
  }
  return { group: selection.group, hashes };
}

export function assertOwnedInventoryMatches(
  selection: NativeContractSelection,
  expected: OwnedFunctionInventory,
  current: OwnedFunctionInventory,
) {
  const paths = requests(selection).map((r) => r.path);
  for (const inventory of [expected, current])
    if (
      inventory?.group !== selection.group ||
      !inventory.hashes ||
      Object.keys(inventory.hashes).length !== paths.length ||
      paths.some((path) => !/^[a-f0-9]{64}$/.test(inventory.hashes[path] ?? ''))
    )
      throw new Error('A complete 19-resource inventory for the selected group is required.');
  if (paths.some((path) => expected.hashes[path] !== current.hashes[path]))
    throw new Error('The group differs from the explicitly inspected inventory; recovery is refused.');
}
