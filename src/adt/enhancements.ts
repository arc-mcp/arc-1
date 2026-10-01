/** ENHO read routing: XHB BAdIs, XHH source plug-ins, and the legacy/generic XH route. */
import type { AdtClient } from './client.js';
import { AdtApiError, AdtError } from './errors.js';
import { checkOperation, OperationType } from './safety.js';
import type { EnhancementImplementationInfo } from './types.js';
import { getNestedArray, parseEnhancementImplementation, parseXml } from './xml-parser.js';

const ROUTES = {
  'ENHO/XHB': ['enhoxhb', 'application/vnd.sap.adt.enh.enhoxhb.v4+xml'],
  'ENHO/XHH': ['enhoxhh', 'application/vnd.sap.adt.enh.enhoxhh.v3+xml'],
  'ENHO/XH': ['enhoxh', 'application/vnd.sap.adt.enh.enho.v1+xml'],
} as const;
type Subtype = keyof typeof ROUTES;

/** Preserve the existing BAdI payload; source plug-ins additionally expose their hook locations. */
export function parseEnhancementMetadata(xml: string): EnhancementImplementationInfo {
  const parsed = parseXml(xml);
  if (parsed.objectData && typeof parsed.objectData === 'object') return parseEnhancementImplementation(xml);
  const root = parsed.enhancement as Record<string, unknown> | undefined;
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new AdtError('Invalid ENHO metadata: expected objectData or enhancement.');
  }
  const pkg = (root.packageRef ?? {}) as Record<string, unknown>;
  const common = (root.contentCommon ?? {}) as Record<string, unknown>;
  const specific = (root.contentSpecific ?? {}) as Record<string, unknown>;
  const hook = (specific.hookTechnology ?? {}) as Record<string, unknown>;
  const enhanced = (hook.enhancedObject ?? {}) as Record<string, unknown>;
  return {
    name: String(root['@_name'] ?? ''),
    description: String(root['@_description'] ?? ''),
    package: String(pkg['@_name'] ?? ''),
    technology: String(common['@_toolType'] ?? ''),
    switchSupported: String(common['@_switchSupported'] ?? '') === 'true',
    badiImplementations: [],
    enhancedObject: {
      name: String(enhanced['@_name'] ?? ''),
      type: String(enhanced['@_type'] ?? ''),
      uri: String(enhanced['@_uri'] ?? ''),
    },
    hookImplementations: getNestedArray(specific, 'hookTechnology', 'hookImplementation').map((item) => ({
      id: String(item['@_id'] ?? ''),
      spotName: String(item['@_spotname'] ?? ''),
      programName: String(item['@_programname'] ?? ''),
      method: String(item['@_method'] ?? ''),
      overwrite: ['true', 'X'].includes(String(item['@_overwrite'] ?? '')),
      fullName: String(item['@_full_name'] ?? ''),
      description: String(item['@_full_description'] ?? ''),
      uri: String(
        getNestedArray({ item }, 'item', 'link').find((link) => link['@_rel'] === 'enclosure')?.['@_href'] ?? '',
      ),
    })),
  };
}

export async function readEnhancementImplementation(
  client: Pick<AdtClient, 'http' | 'safety' | 'searchObject'>,
  name: string,
): Promise<EnhancementImplementationInfo> {
  checkOperation(client.safety, OperationType.Read, 'GetEnhancementImplementation');
  const attempted: string[] = [];
  const pathFor = (subtype: Subtype) => `/sap/bc/adt/enhancements/${ROUTES[subtype][0]}/${encodeURIComponent(name)}`;
  const read = async (subtype: Subtype) => {
    const [collection, accept] = ROUTES[subtype];
    attempted.push(collection);
    // Construct only known endpoints. Repository/source links are data, never request URLs.
    const path = pathFor(subtype);
    const result = parseEnhancementMetadata((await client.http.get(path, { Accept: accept })).body);
    if (subtype === 'ENHO/XHH')
      result.source = (await client.http.get(`${path}/source/main`, { Accept: 'text/plain' })).body;
    return result;
  };
  try {
    try {
      return await read('ENHO/XHB');
    } catch (initial) {
      // These statuses include SAP's wrong-subtype transformation errors. Do not reroute auth or network failures.
      if (!(initial instanceof AdtApiError) || ![400, 404, 500].includes(initial.statusCode)) throw initial;
      const matches = await client.searchObject(name, 100, 'ENHO');
      const subtypes = new Set(
        matches
          .filter(
            (m) =>
              m.objectName.toUpperCase() === name.toUpperCase() ||
              // 7.50 decorates names with a display label; its exact relative object URI still identifies the object.
              (Object.hasOwn(ROUTES, m.objectType) &&
                m.uri.toUpperCase() === pathFor(m.objectType as Subtype).toUpperCase()),
          )
          .map((m) => m.objectType),
      );
      const subtype = subtypes.size === 1 ? [...subtypes][0] : undefined;
      if (!subtype || subtype === 'ENHO/XHB' || !Object.hasOwn(ROUTES, subtype)) throw initial;
      return await read(subtype as Subtype);
    }
  } catch (error) {
    if (error instanceof AdtApiError && [400, 404, 500].includes(error.statusCode)) {
      error.extraHint = `ENHO read attempted ${attempted.join(', ')}. If this enhancement cannot be exposed by ADT, inspect it in SAP GUI (SE80/SE19) or Eclipse's SAP GUI integration.`;
    }
    throw error;
  }
}
