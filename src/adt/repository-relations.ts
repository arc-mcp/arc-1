/** Experimental Relation Explorer adapter. No source reads, SQL fallback or shared results. */
import { XMLValidator } from 'fast-xml-parser';
import type { AdtClient } from './client.js';
import { AdtResponseLimitError } from './errors.js';
import type { AdtRequestOptions } from './http-deadline.js';
import { canonicalHostRelativeAdtPath } from './path-safety.js';
import {
  RELATION_NAME,
  RelationProtocolError,
  relationFunctionIdentity,
  relationObjectSpec,
  relationObjectUri,
  relationReferenceName,
} from './relation-objects.js';
import { checkOperation, OperationType } from './safety.js';
import { escapeXmlAttr, parseDiscoveryObject, parseXml } from './xml-parser.js';

export const RELATIONS_PATH = '/sap/bc/adt/objectrelations/network';
export const RELATION_XML_MAX_BYTES = 1024 * 1024;
export const RELATIONS_MIME = 'application/vnd.sap.adt.objectrelations.request.v1+xml';
export { RELATION_NAME, RelationProtocolError, relationObjectUri } from './relation-objects.js';
export type RelationDirection = 'incoming' | 'outgoing';
export interface RelationObject {
  uri: string;
  name: string;
  type: string;
  package: string;
  version: 'active';
  existence: 'metadata_validated' | 'observed_reference';
}
export interface RelationEdge {
  from: string;
  to: string;
  kind: 'uses';
  context: 'ENV' | 'WUL';
  evidence: 'sap_relation_explorer';
  direct: null;
}
export interface RelationNetwork {
  objects: RelationObject[];
  edges: RelationEdge[];
}

export function supportsRelations(map?: ReadonlyMap<string, string[]>): boolean {
  return map?.get(RELATIONS_PATH)?.includes(RELATIONS_MIME) === true;
}

/** SAP-returned URIs remain untrusted. They are evidence, never an unrestricted HTTP target. */
function safeUri(value: unknown): string {
  const uri = text(value, 512);
  // STOB entities are location identities, not DDLS aliases or fetchable roots. Keep the
  // exact fragment so two entities in a source never collapse. Only this observed shape
  // is allowed; lookup still reconstructs fixed paths for qualified object types.
  const anchor = /^(\/sap\/bc\/adt\/ddic\/ddl\/sources\/[^/?#]+\/source\/main)#name=([A-Za-z0-9_$%/]+)$/.exec(uri);
  if (anchor && !RELATION_NAME.test(decodeURIComponent(anchor[2]!)))
    throw new RelationProtocolError('invalid entity anchor.');
  const canonical = canonicalHostRelativeAdtPath(anchor ? anchor[1]! : uri, '/sap/bc/adt/', {
    allowRawEncodedSlash: true,
  });
  if (!canonical || canonical.includes('?') || canonical.includes('//') || /\s/.test(decodeURIComponent(canonical))) {
    throw new RelationProtocolError('unsafe response URI.');
  }
  return `${canonical}${anchor ? `#name=${anchor[2]}` : ''}`.replace(/%[a-f0-9]{2}/gi, (part) => part.toUpperCase());
}
function containsControl(value: string): boolean {
  return Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.length) || containsControl(value)) {
    throw new RelationProtocolError('invalid or oversized metadata field.');
  }
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RelationProtocolError('invalid XML shape.');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/** Bound parser work as well as wire bytes. Reject entities and unexpectedly deep XML. */
export function parseRelationXml(xml: string): Record<string, unknown> {
  const bytes = Buffer.byteLength(xml);
  if (bytes > RELATION_XML_MAX_BYTES) {
    throw new AdtResponseLimitError(RELATION_XML_MAX_BYTES, bytes, 'repository-relations');
  }
  if (/<!DOCTYPE|<!ENTITY|<!--|<!\[CDATA\[|<\?/i.test(xml.replace(/^\s*<\?xml\s+[^<>]*\?>/i, ''))) {
    throw new RelationProtocolError(
      'XML DTDs, entities, comments, CDATA and custom processing instructions are unsupported.',
    );
  }
  let depth = 0,
    tags = 0;
  for (const match of xml.matchAll(/<([^<>]+)>/g)) {
    const tag = match[1]!;
    if (++tags > 20000) throw new RelationProtocolError('too many XML records.');
    if (tag.startsWith('?') || tag.startsWith('!')) continue;
    if (tag.startsWith('/')) depth--;
    else if (!tag.endsWith('/')) depth++;
    if (depth > 40) throw new RelationProtocolError('XML nesting limit exceeded.');
  }
  if (XMLValidator.validate(xml) !== true) throw new RelationProtocolError('malformed XML.');
  return parseXml(xml);
}

export function normalizeRelationNetwork(
  xml: string,
  context: 'ENV' | 'WUL',
  requested: RelationObject,
): RelationNetwork {
  const root = record(parseRelationXml(xml).networkResponse);
  if (root.activeContext !== context) throw new RelationProtocolError('SAP did not honor the requested context.');
  const objects = new Map<string, RelationObject>();
  const refs = array(root.objectReference),
    relations = array(root.relation);
  if (refs.length > 2000 || relations.length > 4000) throw new RelationProtocolError('native record limit exceeded.');
  for (const value of refs) {
    const raw = record(value),
      uri = safeUri(raw['@_uri']);
    const type = text(raw['@_type'], 64);
    if (raw['@_version'] !== 'active' || raw['@_exists'] !== 'true') {
      throw new RelationProtocolError('non-active or unresolved native reference.');
    }
    const object: RelationObject = {
      uri,
      name: relationReferenceName(text(raw['@_name'], type === 'FUGR/FF' ? 160 : 120), type, uri),
      type,
      package: text(raw['@_packageName'] ?? '', 120, true),
      version: 'active',
      existence: 'observed_reference',
    };
    const prior = objects.get(uri);
    if (prior && (prior.name !== object.name || prior.type !== object.type || prior.package !== object.package)) {
      throw new RelationProtocolError('conflicting native object identity.');
    }
    objects.set(uri, object);
  }
  const rootObject = objects.get(requested.uri);
  if (
    !rootObject ||
    rootObject.name.toUpperCase() !== requested.name.toUpperCase() ||
    rootObject.type !== requested.type
  ) {
    throw new RelationProtocolError('native result does not match the requested root.');
  }
  const edges = new Map<string, RelationEdge>();
  for (const value of relations) {
    const raw = record(value);
    const a = safeUri(raw.object1),
      b = safeUri(raw.object2);
    if (
      raw['@_relationType'] !== 'parentChild' ||
      raw['@_state'] !== 'A' ||
      a !== requested.uri ||
      !objects.has(a) ||
      !objects.has(b)
    )
      throw new RelationProtocolError('unsupported native relationship shape.');
    const from = context === 'ENV' ? a : b,
      to = context === 'ENV' ? b : a;
    edges.set(JSON.stringify([from, to]), {
      from,
      to,
      kind: 'uses',
      context,
      evidence: 'sap_relation_explorer',
      direct: null,
    });
  }
  return { objects: [...objects.values()], edges: [...edges.values()] };
}

export class NativeRelationProvider {
  constructor(
    private readonly client: AdtClient,
    readonly options: AdtRequestOptions,
  ) {}

  async discover(known?: ReadonlyMap<string, string[]>): Promise<ReadonlyMap<string, string[]>> {
    let map = known;
    if (!map) {
      checkOperation(this.client.safety, OperationType.Read, 'DiscoverRepositoryRelations');
      const result = await this.client.http.get(
        '/sap/bc/adt/discovery',
        { Accept: 'application/atomsvc+xml' },
        this.options,
      );
      const parsed = parseRelationXml(result.body);
      if (!parsed.service) throw new RelationProtocolError('invalid discovery document.');
      map = parseDiscoveryObject(parsed);
    }
    if (!supportsRelations(map))
      throw new RelationProtocolError('Relation Explorer endpoint/MIME is not advertised by SAP.');
    return map;
  }

  async validateRoot(type: string, name: string): Promise<RelationObject> {
    if (name.length > 120 || !RELATION_NAME.test(name)) throw new RelationProtocolError('invalid root name.');
    let spec = relationObjectSpec(type);
    if (!spec) throw new RelationProtocolError('unsupported root type.');
    // TABL has two physical paths; FUNC requires its parent group. Resolve only these
    // identities, with the SAME deadline/attempt/byte budgets as the rest of the analysis.
    let uri: string;
    if (type === 'TABL' || type === 'FUNC') {
      checkOperation(this.client.safety, OperationType.Read, 'ResolveRepositoryRelationRoot');
      const params = new URLSearchParams({
        operation: 'quickSearch',
        query: name,
        objectType: type === 'FUNC' ? 'FUGR/FF' : 'TABL',
        maxResults: '2',
      });
      const result = await this.client.http.get(
        `/sap/bc/adt/repository/informationsystem/search?${params}`,
        {},
        this.options,
      );
      const refs = array(record(parseRelationXml(result.body).objectReferences).objectReference).map(record);
      if (refs.length !== 1 || text(refs[0]!['@_name'], 120).toUpperCase() !== name.toUpperCase()) {
        throw new RelationProtocolError('root resolution is missing or ambiguous. Use an exact object name.');
      }
      const resolved = relationObjectSpec(text(refs[0]!['@_type'], 64));
      if (!resolved || resolved[0] !== type || resolved[1] !== refs[0]!['@_type'])
        throw new RelationProtocolError('root resolution type mismatch.');
      spec = resolved;
      uri = safeUri(refs[0]!['@_uri']);
      const group = type === 'FUNC' ? relationFunctionIdentity(uri).group : undefined;
      if (uri !== relationObjectUri(spec[1], name, group))
        throw new RelationProtocolError('root resolution URI mismatch.');
    } else uri = relationObjectUri(type, name);
    checkOperation(this.client.safety, OperationType.Read, 'ValidateRepositoryRelationRoot');
    const response = await this.client.http.get(uri, { Accept: 'application/*' }, this.options);
    const parsed = parseRelationXml(response.body);
    const metadata = record(parsed[spec[3]]);
    const expectedType = spec[1];
    if (
      text(metadata['@_name'], 120).toUpperCase() !== name.toUpperCase() ||
      metadata['@_type'] !== expectedType ||
      metadata['@_version'] !== 'active'
    ) {
      throw new RelationProtocolError('root metadata does not match the requested active object.');
    }
    const pkg =
      metadata.packageRef === undefined
        ? type === 'FUNC'
          ? (record(metadata.containerRef)['@_packageName'] ?? '')
          : ''
        : record(metadata.packageRef)['@_name'];
    if (type === 'FUNC') {
      const group = relationFunctionIdentity(uri).group;
      const parent = record(metadata.containerRef);
      if (
        parent['@_type'] !== 'FUGR/F' ||
        parent['@_name'] !== group ||
        safeUri(parent['@_uri']) !== relationObjectUri('FUGR', group)
      )
        throw new RelationProtocolError('function metadata parent mismatch.');
    }
    return {
      uri,
      name: name.toUpperCase(),
      type: expectedType,
      package: text(pkg, 120, true),
      version: 'active',
      existence: 'metadata_validated',
    };
  }

  async lookup(object: RelationObject, direction: RelationDirection): Promise<RelationNetwork> {
    // Rebuild at the sink; a returned URI can never select an arbitrary ADT operation.
    const group = object.type === 'FUGR/FF' ? relationFunctionIdentity(safeUri(object.uri)).group : undefined;
    const uri = relationObjectUri(object.type, object.name, group);
    if (uri !== object.uri) throw new RelationProtocolError('expansion identity/URI mismatch.');
    const context = direction === 'outgoing' ? 'ENV' : 'WUL';
    const body = `<or:request xmlns:or="http://www.sap.com/adt/objectrelations" xmlns:adtcore="http://www.sap.com/adt/core"><or:reference adtcore:uri="${escapeXmlAttr(uri)}"/><or:preferredContext>${context}</or:preferredContext></or:request>`;
    checkOperation(this.client.safety, OperationType.Intelligence, 'RepositoryRelations');
    const response = await this.client.http.post(RELATIONS_PATH, body, RELATIONS_MIME, { Accept: '*/*' }, this.options);
    const network = normalizeRelationNetwork(response.body, context, object);
    // Serial, request-local traversal: only a fully validated expansion proves that an
    // earlier 401/session or 403/CSRF retry recovered. Headers/control requests are not proof.
    if (this.options.attemptBudget) this.options.attemptBudget.authorizationFailureObserved = false;
    return network;
  }
}
