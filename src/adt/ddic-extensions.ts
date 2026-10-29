/** Metadata-linked DDIC append identities. Never uses where-used in automatic discovery. */
import type { AdtClient } from './client.js';
import { AdtApiError, AdtResponseLimitError } from './errors.js';
import {
  type ExtensionDiscoverySession,
  type ExtensionNode,
  ExtensionProtocolError,
  type ExtensionProvider,
  extensionKey,
} from './extension-discovery.js';
import { canonicalHostRelativeAdtPath } from './path-safety.js';
import { parseRelationXml } from './repository-relations.js';

export type DdicExtensionClient = Pick<
  AdtClient,
  'http' | 'safety' | 'resolveTablObjectUrl' | 'getTabl' | 'getStructure'
>;
const REL = 'http://www.sap.com/adt/relations/enhancements';
export const DDIC_ELEMENTS_MIME = 'application/vnd.sap.adt.elementinfo+xml';
const NAME = /^(?:\/[a-z0-9_]+\/)?[a-z0-9_$]{1,30}$/i;
const UNAVAILABLE = new Set([404, 405, 406, 415, 501]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ExtensionProtocolError('Invalid DDIC XML shape.');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function xml(body: string): Record<string, unknown> {
  try {
    const parsed = parseRelationXml(body);
    if (Object.keys(parsed).filter((key) => key !== '?xml').length !== 1)
      throw new ExtensionProtocolError('Ambiguous XML roots.');
    return parsed;
  } catch (error) {
    if (error instanceof AdtResponseLimitError) throw error;
    throw new ExtensionProtocolError('Malformed DDIC XML.');
  }
}
function samePath(actual: unknown, expected: string): boolean {
  if (
    typeof actual !== 'string' ||
    !canonicalHostRelativeAdtPath(actual, '/sap/bc/adt/', { allowRawEncodedSlash: true })
  )
    return false;
  return decodeURIComponent(actual).toUpperCase() === decodeURIComponent(expected).toUpperCase();
}

/** Resolve only the observed relative/canonical paths bound to the requested DDIC owner. */
export function ddicEnhancementLink(href: unknown, base: string): string {
  if (typeof href !== 'string') throw new ExtensionProtocolError('Missing DDIC enhancement URI.');
  const path = href.startsWith('./') ? `${base.slice(0, base.lastIndexOf('/') + 1)}${href.slice(2)}` : href;
  if (![`${base}/enhancements`, `${base}/enhancement/elements`].some((expected) => samePath(path, expected)))
    throw new ExtensionProtocolError('Unsafe or mismatched DDIC enhancement URI.');
  return path;
}

export function parseDdicAppendElements(body: string, base: string, name: string): ExtensionNode[] {
  const parsed = xml(body);
  if (!Object.hasOwn(parsed, 'elementInfo')) throw new ExtensionProtocolError('Missing elementInfo root.');
  const root = parsed.elementInfo === '' ? {} : record(parsed.elementInfo);
  const children = array(root.elementInfo);
  if (
    (root['@_name'] !== undefined && String(root['@_name']).toUpperCase() !== name.toUpperCase()) ||
    (root['@_uri'] !== undefined && !samePath(root['@_uri'], base)) ||
    (root['@_type'] !== undefined &&
      !(base.includes('/tables/') ? ['TABL/DT'] : ['TABL/DT', 'TABL/DS']).includes(String(root['@_type']))) ||
    (root['@_version'] !== undefined && root['@_version'] !== 'active') ||
    (children.length > 0 && root['@_name'] === undefined)
  )
    throw new ExtensionProtocolError('Wrong DDIC element owner.');
  return children.map((value) => {
    const child = record(value),
      childName = String(child['@_name'] ?? '');
    const uri = `/sap/bc/adt/ddic/structures/${encodeURIComponent(childName.toLowerCase())}/source/main`;
    if (
      !NAME.test(childName) ||
      child['@_type'] !== 'TABL/DS' ||
      !samePath(child['@_uri'], uri) ||
      (child['@_version'] !== undefined && child['@_version'] !== 'active')
    )
      throw new ExtensionProtocolError('Invalid DDIC append identity.');
    const sw = child['@_switch'];
    if (sw !== undefined && (typeof sw !== 'string' || !NAME.test(sw)))
      throw new ExtensionProtocolError('Invalid switch metadata.');
    return {
      type: 'TABL',
      name: childName.toUpperCase(),
      version: 'provider_current',
      uri: String(child['@_uri']),
      family: 'ddic_append',
      provider: 'ddic_appends',
      applicability: 'unknown',
      ...(typeof sw === 'string' ? { switch: sw } : {}),
    };
  });
}

export async function discoverDdicAppends(
  client: Pick<DdicExtensionClient, 'http' | 'resolveTablObjectUrl'>,
  session: ExtensionDiscoverySession,
  name: string,
  depth = 0,
): Promise<{ provider: ExtensionProvider; references: ExtensionNode[] }> {
  const provider: ExtensionProvider = {
    id: 'ddic_appends',
    family: 'ddic_append',
    status: 'returned',
    coverage: 'direct_identities',
    version: 'provider_current',
    nested: 'not_expanded',
    scope: name,
    reason: `Direct appends; switch applicability unknown; separate provider observation.`,
  };
  let references: ExtensionNode[] = [];
  await session.provider(provider, async () => {
    if (session.request.root.version !== 'active') {
      provider.status = 'unsupported';
      provider.reason = 'unsupported_version';
      return;
    }
    if (!NAME.test(name)) throw new ExtensionProtocolError('Invalid DDIC name.');
    let base: string, metadata: Record<string, unknown>;
    try {
      base = await session.read('TABL', (options) => client.resolveTablObjectUrl(name, options));
      const expected = `/sap/bc/adt/ddic/${base.includes('/tables/') ? 'tables' : 'structures'}/${encodeURIComponent(name)}`;
      if (!samePath(base, expected)) throw new ExtensionProtocolError('Invalid resolved DDIC owner.');
      const response = await session.read('TABL', (options) =>
        client.http.get(`${base}?version=active`, { Accept: 'application/*' }, options),
      );
      metadata = record(xml(response.body).blueSource);
      const type = base.includes('/tables/') ? 'TABL/DT' : 'TABL/DS';
      if (
        String(metadata['@_name']).toUpperCase() !== name.toUpperCase() ||
        metadata['@_type'] !== type ||
        (metadata['@_version'] !== undefined && metadata['@_version'] !== 'active')
      )
        throw new ExtensionProtocolError('Mismatched DDIC metadata.');
      const links = array(metadata.link)
        .map(record)
        .filter((link) => link['@_rel'] === REL);
      if (!links.length) {
        provider.status = 'not_advertised';
        provider.reason = 'No enhancement relation advertised by this owner.';
        return;
      }
      if (links.length !== 1) throw new ExtensionProtocolError('Ambiguous DDIC enhancement relation.');
      const path = ddicEnhancementLink(links[0]!['@_href'], base);
      const responseElements = await session.read('TABL', (options) =>
        client.http.get(path, { Accept: DDIC_ELEMENTS_MIME }, options),
      );
      references = parseDdicAppendElements(responseElements.body, base, name);
    } catch (error) {
      if (error instanceof AdtApiError && UNAVAILABLE.has(error.statusCode) && !session.stopped) {
        provider.status = 'unsupported';
        provider.reason = `provider_unavailable_http_${error.statusCode}`;
        return;
      }
      throw error;
    }
    for (const node of references) {
      if (session.addNode(node, depth))
        session.addEdge({
          from:
            name.toUpperCase() === session.request.root.name.toUpperCase()
              ? extensionKey(session.request.root)
              : `TABL:${name.toUpperCase()}:active`,
          to: extensionKey(node),
          kind: 'append',
        });
    }
  });
  return { provider, references };
}
