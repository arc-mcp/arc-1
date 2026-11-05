/** Existing standard APIs only; no reference grants mutation or deletion authority. */

import type { AdtClient } from '../../../src/adt/client.js';
import { fetchDiscoveryDocument } from '../../../src/adt/discovery.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { DOCUMENT_CORE, ENHS_NS } from '../../../src/adt/pinned-document-owner.js';
import { ddicHash } from './native-ddic-evidence.js';
import { ENHO_BADI, ENHO_INTERFACE, ENHO_INTERFACE_URI, ENHO_SPOT, ENHO_SPOT_URI } from './native-enho-fixtures.js';

const core = DOCUMENT_CORE;
/** API declaration facts from the target-bound004 capture; no SAP implementation is copied. */
export function enhoInterfaceContract(source: string) {
  const code = source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.startsWith('*'))
    .join(' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const expected =
    'interface if_adt_discovery_provider public . interfaces if_badi_interface . methods register_workspaces importing !registry type ref to if_adt_discovery_registry . endinterface.';
  if (code !== expected) throw new Error('The observed discovery-provider interface contract changed.');
}
export async function enhoDependencies(client: AdtClient, record: (v: unknown) => void, options: AdtRequestOptions) {
  const get = async (path: string, plain = false) => {
    const r = await client.http.get(
      path,
      { Accept: plain ? 'text/plain' : 'application/*', 'Cache-Control': 'no-cache' },
      options,
    );
    if (r.statusCode !== 200) throw new Error('Dependency read unconfirmed.');
    if (
      plain &&
      !Object.entries(r.headers).some(
        ([k, v]) => k.toLowerCase() === 'content-type' && v.split(';')[0].trim() === 'text/plain',
      )
    )
      throw new Error('Dependency source media unconfirmed.');
    record({ dependency: path, body: r.body, sha256: ddicHash(r.body) });
    return r.body;
  };
  const spot = nativeXmlRoot(await get(ENHO_SPOT_URI), 'objectData', ENHS_NS, true);
  const iface = nativeXmlRoot(
    await get(ENHO_INTERFACE_URI),
    'abapInterface',
    'http://www.sap.com/adt/oo/interfaces',
    true,
  );
  for (const [root, name, type] of [
    [spot, ENHO_SPOT, 'ENHS/XSB'],
    [iface, ENHO_INTERFACE, 'INTF/OI'],
  ] as const)
    if (
      root.attribute('name', core) !== name ||
      root.attribute('type', core) !== type ||
      root.attribute('version', core) !== 'active' ||
      root.child('packageRef', core)?.attribute('name', core) !== 'SADT_REST'
    )
      throw new Error('Standard dependency identity/state/package changed.');
  const common = spot.child('contentCommon', ENHS_NS);
  if (common?.attribute('toolType', ENHS_NS) !== 'BADI_DEF' || common.attribute('internal', ENHS_NS) !== 'false')
    throw new Error('Internal/unknown spot refused.');
  const badi = spot
    .child('contentSpecific', ENHS_NS)
    ?.child('badiTechnology', ENHS_NS)
    ?.child('badiDefinitions', ENHS_NS)
    ?.children('badiDefinition', ENHS_NS)
    .filter((v) => v.attribute('name', ENHS_NS) === ENHO_BADI);
  if (badi?.length !== 1) throw new Error('Unique discovery BAdI required.');
  const entry = badi[0];
  for (const field of ['singleUse', 'useFallbackClass', 'internalUse', 'amdp', 'customLogicRegistered'])
    if (entry.attribute(field, ENHS_NS) !== 'false') throw new Error('Unqualified BAdI behavior.');
  const ref = entry.child('interface', ENHS_NS);
  if (
    ref?.attribute('name', core) !== ENHO_INTERFACE ||
    ref.attribute('type', core) !== 'INTF/OI' ||
    ref.attribute('uri', core) !== ENHO_INTERFACE_URI
  )
    throw new Error('BAdI interface changed.');
  const filters = entry.child('filters', ENHS_NS)?.children('filter', ENHS_NS);
  if (
    filters?.length !== 1 ||
    filters[0].attribute('filterName', ENHS_NS) !== 'URI' ||
    filters[0].attribute('filterType', ENHS_NS) !== 'S' ||
    filters[0].hasChild('filterCheck')
  )
    throw new Error('Plain URI filter required.');
  const source = await get(`${ENHO_INTERFACE_URI}/source/main`, true);
  enhoInterfaceContract(source);
  return ddicHash(JSON.stringify([spot.canonicalValue({}), iface.canonicalValue({}), ddicHash(source)]));
}

export async function enhoCapabilities(client: AdtClient) {
  const { map } = await fetchDiscoveryDocument(client.http);
  for (const path of ['/sap/bc/adt/oo/classes', '/sap/bc/adt/enhancements/enhoxhb', '/sap/bc/adt/enhancements/enhsxsb'])
    if (!map.has(path)) throw new Error('Fixed enhancement discovery contract unavailable.');
  client.http.setDiscoveryMap(map);
}
