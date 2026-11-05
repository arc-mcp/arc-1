/** Exact owned partial-create receipts. Query versions are kept distinct; no baseline adoption. */
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { CTS_BASE, CTS_RETAINED_SUFFIX, type CtsGraph } from './native-cts-fixtures.js';
import { declarativeEvidenceRead } from './native-declarative-evidence.js';
import { type PackageJournal, packageHash } from './native-package-evidence.js';
export const CTS_RETAINED_SOURCE_HASH = 'd4cb91a02195b61d1ddfd506eabd9d74f74d6c1022695d9fb88c7e45b51e11b7';
export const CTS_RETAINED_V3_VIEWS = [
  ['', 'c17a2a5cbbd69bcd10dd925b6407160b2852b4d543bce68db4d8064a0d0d836e', 8654],
  ['/source/main', CTS_RETAINED_SOURCE_HASH, 214],
  ['?version=inactive', 'c17a2a5cbbd69bcd10dd925b6407160b2852b4d543bce68db4d8064a0d0d836e', 8654],
  ['/source/main?version=inactive', CTS_RETAINED_SOURCE_HASH, 214],
  ['?version=active', '29604eb08a3373a4fc8d0d41f9071d50541b15d02942a01241dcb654a531eb50', 8652],
  ['/source/main?version=active', '175334db333917c4269e9cf3e077364fec64b498d34d08b08b44de99735f7d30', 208],
  ['/includes/definitions', '3829118a7e789db9dfd979950526c2eab48c160ccac4a24db1d7697b5cbdb5cc', 165],
  ['/includes/implementations', '5a2c09b897eb875d76615c4f0613f1a53afd4cab673c877fa105bf880f24f2a7', 143],
  ['/includes/macros', '3a608b0510edb3290a6d9fd5c4cd015fa51f105693f78c74e9142d6e4905e8e8', 106],
] as const;
export const CTS_RETAINED_V3_REQUEST_VIEWS = [
  ['A4HK906607', '085e894cfcf6b721b0bce3000fd9c2d8632e6b3e3133cb0a4c1473762174937c', 12823],
  ['A4HK906608', '9527148b2cb264e34961176ee79be3e7948368a4b3d8a323fc0259b1cf2c652d', 11707],
] as const;
export async function retainedCtsV3Snapshot(
  http: AdtHttpClient,
  graph: CtsGraph,
  options: AdtRequestOptions,
  record: PackageJournal,
) {
  if (graph.suffix !== CTS_RETAINED_SUFFIX) throw new Error('Fixed retained CTS class required.');
  for (const [path, expected, bytes] of [
    ...CTS_RETAINED_V3_VIEWS.map(([suffix, hash, size]) => [graph.classes[0].owner + suffix, hash, size] as const),
    ...CTS_RETAINED_V3_REQUEST_VIEWS.map(([id, hash, size]) => [CTS_BASE + id, hash, size] as const),
  ]) {
    const response = await http.get(
      path,
      {
        Accept: path.includes('/source/') || path.includes('/includes/') ? 'text/plain' : 'application/*',
        'Cache-Control': 'no-cache',
      },
      options,
    );
    record({
      retainedCtsView: path,
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
      throw new Error('Exact retained CTS owner/version/source/include or request receipt changed.');
  }
}
export async function retainedCtsV3Includes(
  http: AdtHttpClient,
  graph: CtsGraph,
  options: AdtRequestOptions,
  record: PackageJournal,
) {
  for (const [path, expected, bytes] of CTS_RETAINED_V3_VIEWS.slice(6)) {
    const response = await http.get(
      graph.classes[0].owner + path,
      { Accept: 'text/plain', 'Cache-Control': 'no-cache' },
      options,
    );
    record({
      retainedCtsInclude: path,
      status: response.statusCode,
      sha256: packageHash(response.body),
      body: response.body,
    });
    if (
      response.statusCode !== 200 ||
      Buffer.byteLength(response.body) !== bytes ||
      packageHash(response.body) !== expected
    )
      throw new Error('Retained class includes changed.');
  }
}
/** Eight observed entries: exact own transport group, class, three includes and three source sections.
 * Section/transport references are read-only evidence, never extra mutation or LIMU ownership. */
const inventoryEntries = [
  '06f47279007445d66ad8fc67020bbd916a74887f0dd1feab99e4bca1f8a10459',
  '12c4c99709bd1440107b99f6ff3a4dbe0b072c294b9e11354d56406cdfedb90c',
  '39806725a33edde9a45c0732bc2df0a2a0c26b2286b07f5702ffc8361c45afa5',
  '5d83586271ec695e1be2bf28f49657067c6fada92695014634027d68766c8f40',
  'a73e8ca052e610dae063329558f5a2d7b2173a82dcb5876d1642a6716bbaaff5',
  'b40e869765326b0aff5bf8fb8c51cd19e3728ad77511ee40594ca86a62c70237',
  'b7a3d105c240f20fe985c32f33abe960336fdab2d31b4a1711452528c7ed9625',
  'c575159f245836532bad7f025ce69583a4347df6a22b1d8bf9a5fdeb9a0b074d',
];
export async function retainedCtsV3Inventory(
  http: AdtHttpClient,
  graph: CtsGraph,
  options: AdtRequestOptions,
  record: PackageJournal,
) {
  const response = await declarativeEvidenceRead(
    http,
    '/sap/bc/adt/activation/inactiveobjects',
    'application/vnd.sap.adt.inactivectsobjects.v1+xml',
    options,
    record,
    'hash-only',
  );
  if (response.statusCode !== 200 || graph.suffix !== CTS_RETAINED_SUFFIX)
    throw new Error('Retained CTS inventory unavailable.');
  const ns = 'http://www.sap.com/abapxml/inactiveCtsObjects';
  const root = nativeXmlRoot(response.body, 'inactiveObjects', ns, true),
    owned: string[] = [];
  for (const entry of root.children('entry', ns)) {
    const canonical = JSON.stringify(entry.canonicalValue({}));
    if ([graph.suffix, 'A4HK906607', 'A4HK906608'].some((value) => canonical.toUpperCase().includes(value)))
      owned.push(packageHash(canonical));
  }
  if (
    JSON.stringify(owned.sort()) !== JSON.stringify(inventoryEntries) ||
    (response.body.toUpperCase().match(new RegExp(graph.suffix, 'g'))?.length ?? 0) !== 30
  )
    throw new Error('Exact retained CTS inventory changed.');
  record({
    retainedCtsInventoryEntries: 8,
    retainedClass: graph.classes[0].owner,
    unrelatedBodiesRetained: false,
    referenceOwnership: false,
  });
}
