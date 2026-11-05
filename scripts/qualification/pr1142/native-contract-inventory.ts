/** Native fixture baselines: retain the complete returned tree, not the lossy function/include list. */
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import {
  contractIdentity,
  contractMetadataHash,
  contractRequestPolicy,
  type NativeContractSelection,
} from './native-contract-transport.js';

export interface ContractGroupBaseline {
  readonly group: string;
  readonly hashes: Readonly<Record<string, string>>;
}

function requests(selection: NativeContractSelection): Array<{ path: string; accept: string; metadata?: boolean }> {
  const sources = [
    `${selection.groupUrl}/source/main`,
    ...['TOP', 'UXX'].map(
      (suffix) => `${selection.groupUrl}/includes/l${selection.group.toLowerCase()}${suffix.toLowerCase()}/source/main`,
    ),
  ];
  return [
    { path: `${selection.groupUrl}/objectstructure`, accept: 'application/vnd.sap.adt.objectstructure.v2+xml' },
    ...['active', 'inactive'].flatMap((version) => [
      { path: `${selection.groupUrl}?version=${version}`, accept: 'application/*', metadata: true },
      ...sources.map((path) => ({ path: `${path}?version=${version}`, accept: 'text/plain' })),
      ...['symbols', 'selections', 'headings'].map((part) => ({
        path: `/sap/bc/adt/textelements/functiongroups/${selection.group}/source/${part}?version=${version}`,
        accept: `application/vnd.sap.adt.textelements.${part}.v1`,
      })),
    ]),
  ];
}

function emptyGeneratedStructure(xml: string, selection: NativeContractSelection): void {
  const ns = 'http://www.sap.com/adt/abapsource',
    core = 'http://www.sap.com/adt/core';
  const root = nativeXmlRoot(xml, 'objectStructureElement', ns);
  const children = root.children('objectStructureElement', ns);
  const expected = new Map([
    [`L${selection.group}TOP`, 'FUGR/I'],
    [`L${selection.group}UXX`, 'FUGR/I'],
    [`SAPL${selection.group}`, 'FUGR/PX'],
  ]);
  const names = children.map((child) => child.attribute('name', core));
  if (
    root.attribute('name', core) !== selection.group ||
    root.attribute('type', core) !== 'FUGR/F' ||
    children.length < 2 ||
    children.length > 3 ||
    new Set(names).size !== names.length ||
    !names.includes(`L${selection.group}TOP`) ||
    !names.includes(`L${selection.group}UXX`) ||
    children.some(
      (child) =>
        !expected.has(child.attribute('name', core) ?? '') ||
        expected.get(child.attribute('name', core)!) !== child.attribute('type', core) ||
        child.children('objectStructureElement', ns).length > 0,
    )
  )
    throw new Error('The native group tree contains an unqualified member; automatic cleanup is refused.');
}

async function readInventory(
  http: AdtHttpClient,
  selection: NativeContractSelection,
  marker: string,
  record: (value: unknown) => void,
  policy?: AdtRequestOptions,
): Promise<ContractGroupBaseline> {
  const hashes: Record<string, string> = {};
  // One shared capture budget, including when no enclosing mutation budget exists yet.
  const budget = contractRequestPolicy(policy);
  for (const [index, request] of requests(selection).entries()) {
    const response = await http.get(
      request.path,
      { Accept: request.accept, 'Cache-Control': 'no-cache' },
      contractRequestPolicy(budget),
    );
    if (response.statusCode !== 200 || Buffer.byteLength(response.body) > 1024 * 1024)
      throw new Error('The native group baseline requires bounded complete HTTP 200 responses.');
    const hash = request.metadata ? contractMetadataHash(response.body) : sourceHash(response.body);
    record({ groupInventory: request.path, hash, body: response.body });
    if (request.metadata) contractIdentity(response.body, true, selection, marker);
    else if (index > 0 && response.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== request.accept)
      throw new Error('The native source/text baseline has an unqualified response media type.');
    if (index === 0) emptyGeneratedStructure(response.body, selection);
    hashes[request.path] = hash;
  }
  return Object.freeze({ group: selection.group, hashes: Object.freeze(hashes) });
}

export interface ContractActiveReceipt {
  readonly metadataHash: string;
  readonly sourceHashes: readonly string[];
}

/** A source update may leave active source unchanged or install the just-verified source. */
export function nextContractActiveReceipt(
  previous: ContractActiveReceipt | undefined,
  active: { hash: string; metadataHash: string },
  savedHash: string,
): ContractActiveReceipt {
  if (
    previous &&
    (previous.metadataHash !== active.metadataHash ||
      (!previous.sourceHashes.includes(active.hash) && active.hash !== savedHash))
  )
    throw new Error('Unrecognized active function state; automatic cleanup is refused.');
  return Object.freeze({
    metadataHash: previous?.metadataHash ?? active.metadataHash,
    sourceHashes: Object.freeze([...new Set([...(previous?.sourceHashes ?? [active.hash]), savedHash])]),
  });
}

export function verifyContractActiveReceipt(
  receipt: ContractActiveReceipt | undefined,
  active: { hash: string; metadataHash: string },
): void {
  if (!receipt || receipt.metadataHash !== active.metadataHash || !receipt.sourceHashes.includes(active.hash))
    throw new Error('The active function changed or has no receipt; automatic cleanup is refused.');
}

/** Capture before creating the child. Any unavailable part prevents a baseline; never substitute empty data. */
export const captureContractGroupBaseline = readInventory;

/** Called under the group's owning session and text-pool lock immediately before DELETE. */
export async function verifyContractGroupBaseline(
  http: AdtHttpClient,
  selection: NativeContractSelection,
  marker: string,
  baseline: ContractGroupBaseline | undefined,
  record: (value: unknown) => void,
  policy: AdtRequestOptions,
): Promise<void> {
  const paths = requests(selection).map((request) => request.path);
  if (
    !baseline ||
    baseline.group !== selection.group ||
    Object.keys(baseline.hashes).length !== paths.length ||
    paths.some((path) => !/^[a-f0-9]{64}$/.test(baseline.hashes[path] ?? ''))
  )
    throw new Error('The complete selected-group baseline is missing; automatic cleanup is refused.');
  const current = await readInventory(http, selection, marker, record, policy);
  if (paths.some((path) => current.hashes[path] !== baseline.hashes[path]))
    throw new Error('Native group structure, source or text changed; automatic cleanup is refused.');
}
