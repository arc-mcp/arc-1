/**
 * XML parser for SAP ADT responses.
 *
 * SAP ADT returns XML with multiple namespace conventions:
 * - adtcore: (http://www.sap.com/adt/core) — object references, search results
 * - asx: (http://www.sap.com/abapxml) — table contents, package structure
 * - atom: (http://www.w3.org/2005/Atom) — feed entries
 *
 * We use fast-xml-parser v5 with removeNSPrefix to strip namespaces,
 * since we know the expected structure and don't need namespace dispatch.
 *
 * Key design choice: parse to plain objects, then map to our types.
 * This decouples the XML format from our internal types, making it
 * easier to handle SAP's inconsistent XML across different endpoints.
 */

import { XMLParser } from 'fast-xml-parser';
import { AdtApiError } from './errors.js';
import type {
  AdtSearchResult,
  ApiReleaseContract,
  ApiReleaseStateInfo,
  AttributeStructure,
  AuthorizationFieldInfo,
  BspAppInfo,
  BspFileNode,
  ClassMetadata,
  ClassStructure,
  DataElementInfo,
  DomainInfo,
  EnhancementImplementationInfo,
  FeatureToggleInfo,
  InactiveObject,
  LineRange,
  MessageClassInfo,
  MethodStructure,
  RevisionInfo,
  RevisionListResult,
  ServerDrivenObjectMetadata,
  SourceSearchResult,
  TransactionInfo,
} from './types.js';

/** Escape XML special characters for safe interpolation into XML attributes */
export function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Shared parser instance — configured for ADT XML conventions */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true, // Strip adtcore:, asx:, etc.
  isArray: (name) => {
    // These elements can appear 0-N times; force array even for single item
    return [
      'objectReference',
      'entry',
      'link',
      'objectStructure',
      'field',
      'functionModule',
      'COLUMN',
      'columns',
      'DATA',
      'data',
      'SEU_ADT_REPOSITORY_OBJ_NODE',
      'component',
      'objectStructureElement',
      'task',
      'objectType',
      'proposal',
      'referencedObject',
      'textSearchResult',
      'testClass',
      'testMethod',
      'alert',
      'finding',
      'msg',
      'request',
      'hitListEntry',
      'chapter',
      'traceStatement',
      'statement',
      'dbAccess',
      'access',
      'successor',
      'messages',
      'workspace',
      'collection',
      'accept',
      'orglvlinfo',
      'badiImplementation',
    ].includes(name);
  },
  parseAttributeValue: false, // Keep attributes as strings
  parseTagValue: false, // Keep tag values as strings (prevents "001" → 1)
  // SAP ADT responses use only standard XML entities (&amp; &lt; &gt; &quot;).
  // Dump listings (ST22) can contain thousands of entity references in stack traces.
  // fast-xml-parser v5 defaults to maxTotalExpansions=1000 which is too low.
  // Disable custom entity processing — standard entities are handled regardless.
  processEntities: false,
});

/** Parse raw XML string to a JS object */
export function parseXml(xml: string): Record<string, unknown> {
  return parser.parse(xml) as Record<string, unknown>;
}

/**
 * Parse ADT search results XML.
 *
 * Expected format:
 * <adtcore:objectReferences>
 *   <adtcore:objectReference uri="..." type="PROG/P" name="ZTEST" packageName="$TMP" description="..."/>
 * </adtcore:objectReferences>
 *
 * The shared parser runs with `processEntities: false` (intentional — dump XML
 * can exceed fast-xml-parser's `maxTotalExpansions` cap), so XML attribute
 * values like descriptions arrive with `&gt;` / `&amp;` / `&lt;` / `&quot;` /
 * `&apos;` un-decoded. We decode the user-visible free-text field
 * (`description`) at the boundary via `decodeXmlEntities()`. Object names,
 * types, URIs, and package names don't carry free text — leaving them
 * undecoded is intentional.
 */
export function parseSearchResults(xml: string): AdtSearchResult[] {
  const parsed = parseXml(xml);
  const refs = getNestedArray(parsed, 'objectReferences', 'objectReference');
  return refs.map((ref: Record<string, unknown>) => ({
    objectType: String(ref['@_type'] ?? ''),
    objectName: String(ref['@_name'] ?? ''),
    description: decodeXmlEntities(String(ref['@_description'] ?? '')),
    packageName: String(ref['@_packageName'] ?? ''),
    uri: String(ref['@_uri'] ?? ''),
  }));
}

/**
 * Parse ADT package contents (nodestructure response).
 *
 * Expected format:
 * <asx:abap><asx:values><DATA><TREE_CONTENT>
 *   <SEU_ADT_REPOSITORY_OBJ_NODE>
 *     <OBJECT_TYPE>PROG/P</OBJECT_TYPE>
 *     <OBJECT_NAME>ZTEST</OBJECT_NAME>
 *     <DESCRIPTION>...</DESCRIPTION>
 *   </SEU_ADT_REPOSITORY_OBJ_NODE>
 * </TREE_CONTENT></DATA></asx:values></asx:abap>
 */
export function parsePackageContents(
  xml: string,
): Array<{ type: string; name: string; description: string; uri: string }> {
  const parsed = parseXml(xml);
  // After namespace stripping, asx:abap → abap, asx:values → values
  // fast-xml-parser structure depends on XML depth — use recursive finder as fallback
  let nodes = getDeepArray(parsed, ['abap', 'values', 'DATA', 'TREE_CONTENT', 'SEU_ADT_REPOSITORY_OBJ_NODE']);
  if (nodes.length === 0) {
    nodes = findDeepNodes(parsed, 'SEU_ADT_REPOSITORY_OBJ_NODE');
  }
  return nodes.map((node: Record<string, unknown>) => ({
    type: String(node.OBJECT_TYPE ?? ''),
    name: String(node.OBJECT_NAME ?? ''),
    description: String(node.DESCRIPTION ?? ''),
    uri: String(node.OBJECT_URI ?? ''),
  }));
}

/**
 * Parse direct sub-packages from an ADT `repository/nodestructure` response
 * for `parent_type=DEVC/K`.
 *
 * SAP returns one `<SEU_ADT_REPOSITORY_OBJ_NODE>` per node under
 * `<TREE_CONTENT>`. The response also includes:
 *   - `<OBJECT_TYPE>DEVC/KI</OBJECT_TYPE>` rows for package-interface nodes,
 *     which are NOT subpackages — these must be filtered out.
 *   - Placeholder rows with `<OBJECT_NAME/>` (empty) representing the queried
 *     package itself or expandable categories — also filtered out.
 *
 * Returns uppercased, deduplicated DEVCLASS names in document order. An
 * empty body (HTTP 200 with no payload — SAP's response for an unknown
 * `parent_name`) returns `[]`. Truly malformed XML propagates as a parse
 * exception from `fast-xml-parser`, which the caller surfaces as
 * `AdtApiError`. We never silently return `[]` for a malformed envelope —
 * the resolver relies on this to fail closed.
 */
export function parseSubpackageNodestructure(xml: string): string[] {
  // Empty body = "no children" (e.g. unknown parent on SAP returns 200 with empty payload).
  if (!xml || xml.trim().length === 0) return [];
  const parsed = parseXml(xml);
  let nodes = getDeepArray(parsed, ['abap', 'values', 'DATA', 'TREE_CONTENT', 'SEU_ADT_REPOSITORY_OBJ_NODE']);
  if (nodes.length === 0) {
    nodes = findDeepNodes(parsed, 'SEU_ADT_REPOSITORY_OBJ_NODE');
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const node of nodes) {
    const type = String(node.OBJECT_TYPE ?? '');
    // DEVC/K only — drop DEVC/KI (package interfaces) and any unexpected types.
    if (type !== 'DEVC/K') continue;
    const name = String(node.OBJECT_NAME ?? '')
      .trim()
      .toUpperCase();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Parse table contents (datapreview response).
 *
 * SAP ADT returns two possible formats for data preview:
 *
 * Format 1 (older/asx): COLUMNS/COLUMN/METADATA + DATASET/DATA
 * Format 2 (newer/dataPreview namespace): columns/metadata + dataSet/data
 *
 * After namespace stripping, both converge but with different casing.
 * We try both patterns with fallback.
 */
export function parseTableContents(xml: string): { columns: string[]; rows: Record<string, string>[] } {
  const parsed = parseXml(xml);

  // Try old format first: abap > values > COLUMNS > COLUMN
  let columns = getDeepArray(parsed, ['abap', 'values', 'COLUMNS', 'COLUMN']);
  if (columns.length === 0) {
    columns = findDeepNodes(parsed, 'COLUMN');
  }

  // New format: dataPreview:columns → "columns" after NS strip
  // Each "columns" element contains "metadata" and "dataSet"
  if (columns.length === 0) {
    columns = findDeepNodes(parsed, 'columns');
  }

  const colNames: string[] = [];
  const colData: string[][] = [];

  for (const col of columns) {
    // Old format: METADATA/@_name, DATASET/DATA
    // New format: metadata/@_name, dataSet/data
    const metadata = (col.METADATA ?? col.metadata) as Record<string, unknown> | undefined;
    const name = String(metadata?.['@_name'] ?? '');
    if (!name) continue; // skip non-column entries like totalRows, name, etc.
    colNames.push(name);

    const dataset = (col.DATASET ?? col.dataSet) as Record<string, unknown> | undefined;
    const rawData = dataset?.DATA ?? dataset?.data;
    const data = Array.isArray(rawData) ? rawData.map(String) : rawData != null ? [String(rawData)] : [];
    colData.push(data as string[]);
  }

  // Pivot column-oriented to row-oriented
  const rowCount = colData.length > 0 ? colData[0]?.length : 0;
  const rows: Record<string, string>[] = [];

  for (let i = 0; i < rowCount; i++) {
    const row: Record<string, string> = {};
    for (let j = 0; j < colNames.length; j++) {
      row[colNames[j]!] = colData[j]?.[i] ?? '';
    }
    rows.push(row);
  }

  return { columns: colNames, rows };
}

/**
 * Parse installed components response.
 *
 * SAP returns an Atom feed for /sap/bc/adt/system/components:
 *   <atom:feed>
 *     <atom:entry>
 *       <atom:id>SAP_BASIS</atom:id>
 *       <atom:title>753;SAPKB75308;0008;SAP Basis Component</atom:title>
 *     </atom:entry>
 *   </atom:feed>
 *
 * The title field is semicolon-separated: release;sp_name;sp_level;description
 */
export function parseInstalledComponents(
  xml: string,
): Array<{ name: string; release: string; spName: string; spLevel: string; description: string }> {
  const parsed = parseXml(xml);

  // After removeNSPrefix: atom:feed → feed, atom:entry → entry
  const entries = getNestedArray(parsed, 'feed', 'entry');
  return entries.map((entry: Record<string, unknown>) => {
    const name = String(entry.id ?? '');
    const title = String(entry.title ?? '');
    // Title format: "release;sp_name;sp_level;description"
    const parts = title.split(';');
    return {
      name,
      release: parts[0]?.trim() ?? '',
      spName: parts[1]?.trim() ?? '',
      spLevel: parts[2]?.trim() ?? '',
      description: parts[3]?.trim() ?? title,
    };
  });
}

/**
 * Parse ABAP syntax-configurations response (/sap/bc/adt/abapsource/syntax/configurations).
 *
 *   <abapsource:syntaxConfigurations>
 *     <abapsource:syntaxConfiguration>
 *       <abapsource:language>
 *         <abapsource:version>X</abapsource:version>
 *         <abapsource:description>Standard ABAP</abapsource:description>
 *         <atom:link etag="757" .../>
 *       </abapsource:language>
 *     </abapsource:syntaxConfiguration>
 *     ...
 *   </abapsource:syntaxConfigurations>
 *
 * Feature detection uses the Standard ABAP entry (version="X") as a fallback
 * release signal when installed components do not expose SAP_BASIS.
 */
export function parseSyntaxConfigurations(xml: string): Array<{ version: string; description: string; etag: string }> {
  const parsed = parseXml(xml);
  const configs = getNestedArray(parsed, 'syntaxConfigurations', 'syntaxConfiguration');
  return configs.map((cfg: Record<string, unknown>) => {
    const language = (cfg.language ?? {}) as Record<string, unknown>;
    const linkRaw = language.link;
    // `link` is forced to array by the parser config; take the first element.
    const link = (Array.isArray(linkRaw) ? linkRaw[0] : (linkRaw ?? {})) as Record<string, unknown>;
    return {
      version: String(language.version ?? ''),
      description: String(language.description ?? ''),
      etag: String(link['@_etag'] ?? ''),
    };
  });
}

/**
 * Parse a function group's structure from the ADT **objectstructure** response
 * (`/sap/bc/adt/functions/groups/<name>/objectstructure`).
 *
 * The plain `/functions/groups/<name>` resource returns only group metadata +
 * atom links — NO function-module list — which is why the old parser (reading a
 * `<group>`/`functionModule` shape that ADT never emits) always returned empty.
 * The objectstructure response is a tree of `<objectStructureElement>` nodes, each
 * tagged with `adtcore:type`: the root is `FUGR/F` (the group), `FUGR/FF` children
 * are function modules, `FUGR/I` children are includes, `FUGR/PX` is the main
 * program. Verified live on a4h (see tests/fixtures/xml/function-group.xml).
 */
export function parseFunctionGroup(xml: string): { name: string; functions: string[]; includes: string[] } {
  const parsed = parseXml(xml);
  // parseXml wraps elements in arrays, so the root <objectStructureElement> arrives as
  // a one-element array; its children are nested under the same (array) key.
  const root = toRecordArray(parsed.objectStructureElement)[0] ?? {};
  const functions: string[] = [];
  const includes: string[] = [];
  for (const child of toRecordArray(root.objectStructureElement)) {
    const type = String(child['@_type'] ?? '');
    const childName = String(child['@_name'] ?? '');
    if (!childName) continue;
    if (type === 'FUGR/FF') functions.push(childName);
    else if (type === 'FUGR/I') includes.push(childName);
  }
  return { name: String(root['@_name'] ?? ''), functions, includes };
}

/**
 * Parse ADT system discovery XML into structured info.
 *
 * The discovery response is an Atom service document that lists available
 * ADT workspaces/collections. We extract collection titles and hrefs
 * to determine what capabilities the SAP system has.
 *
 * The authenticated username is passed in from the client config since
 * the discovery XML doesn't directly contain "you are logged in as X".
 */
export function parseSystemInfo(
  xml: string,
  username: string,
): { user: string; collections: Array<{ title: string; href: string }> } {
  const parsed = parseXml(xml);

  // Atom service document: service > workspace > collection
  const collections: Array<{ title: string; href: string }> = [];

  // After namespace stripping: app:service → service, app:workspace → workspace, app:collection → collection
  const service = (parsed.service ?? parsed.service ?? {}) as Record<string, unknown>;
  const workspaces = Array.isArray(service.workspace)
    ? service.workspace
    : service.workspace
      ? [service.workspace]
      : [];

  for (const ws of workspaces as Array<Record<string, unknown>>) {
    const cols = Array.isArray(ws.collection) ? ws.collection : ws.collection ? [ws.collection] : [];
    for (const col of cols as Array<Record<string, unknown>>) {
      const title = String(col.title ?? col['@_title'] ?? '');
      const href = String(col['@_href'] ?? '');
      if (title || href) {
        collections.push({ title, href });
      }
    }
  }

  return { user: username ?? '', collections };
}

/**
 * Parse ADT discovery service document into endpoint -> accepted MIME types.
 *
 * The service document is AtomPub:
 * service > workspace[] > collection[] > accept[]
 */
export function parseDiscoveryDocument(xml: string): Map<string, string[]> {
  if (!xml?.trim()) return new Map();

  try {
    const parsed = parseXml(xml);
    const service = (parsed.service ?? {}) as Record<string, unknown>;
    const workspaces = Array.isArray(service.workspace)
      ? service.workspace
      : service.workspace
        ? [service.workspace]
        : [];

    const discoveryMap = new Map<string, string[]>();

    for (const ws of workspaces as Array<Record<string, unknown>>) {
      const collections = Array.isArray(ws.collection) ? ws.collection : ws.collection ? [ws.collection] : [];
      for (const collection of collections as Array<Record<string, unknown>>) {
        const href = String(collection['@_href'] ?? '');
        const normalizedPath = normalizeDiscoveryPath(href);
        if (!normalizedPath) continue;

        const acceptsRaw = Array.isArray(collection.accept)
          ? collection.accept
          : collection.accept != null
            ? [collection.accept]
            : [];

        const accepts = acceptsRaw.map((value) => String(value)).filter((value) => value.length > 0);

        // Collections without <app:accept> are not useful for negotiation.
        if (accepts.length === 0) continue;

        // If href is duplicated, keep the last definition from the document.
        discoveryMap.set(normalizedPath, accepts);
      }
    }

    return discoveryMap;
  } catch {
    return new Map();
  }
}

function normalizeDiscoveryPath(href: string): string | undefined {
  if (!href) return undefined;

  let path = href.trim();
  if (!path) return undefined;

  // Absolute URL -> extract pathname.
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return undefined;
    }
  }

  // Normalize leading slash.
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  // Keep only ADT paths.
  const adtPrefix = '/sap/bc/adt/';
  if (!path.startsWith(adtPrefix)) {
    const idx = path.indexOf(adtPrefix);
    if (idx < 0) return undefined;
    path = path.slice(idx);
  }

  // Remove trailing slash for stable map keys.
  if (path.length > adtPrefix.length && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return path;
}

/**
 * Parse ADT source/text search results.
 *
 * The textSearch endpoint returns results as either XML with objectReference elements
 * containing match details, or an Atom-like feed. We handle both formats.
 */
export function parseSourceSearchResults(xml: string): SourceSearchResult[] {
  const parsed = parseXml(xml);
  const results: SourceSearchResult[] = [];

  // Try objectReferences format (similar to quickSearch)
  const refs = getNestedArray(parsed, 'objectReferences', 'objectReference');
  if (refs.length > 0) {
    for (const ref of refs) {
      const matchNodes = findDeepNodes(ref, 'textSearchResult');
      const matches = matchNodes.map((m: Record<string, unknown>) => ({
        line: Number(m['@_line'] ?? 0),
        snippet: String(m['@_snippet'] ?? m['#text'] ?? ''),
      }));
      results.push({
        objectType: String(ref['@_type'] ?? ''),
        objectName: String(ref['@_name'] ?? ''),
        uri: String(ref['@_uri'] ?? ''),
        matches,
      });
    }
    return results;
  }

  // Try Atom feed format
  const entries = getNestedArray(parsed, 'feed', 'entry');
  for (const entry of entries) {
    const uri = String(entry.id ?? entry['@_href'] ?? '');
    const title = String(entry.title ?? '');
    results.push({
      objectType: '',
      objectName: title || uri.split('/').pop() || '',
      uri,
      matches: [],
    });
  }

  // Fallback: try to find any matching nodes
  if (results.length === 0) {
    const nodes = findDeepNodes(parsed, 'match');
    for (const node of nodes) {
      results.push({
        objectType: String(node['@_type'] ?? ''),
        objectName: String(node['@_name'] ?? node['@_objectName'] ?? ''),
        uri: String(node['@_uri'] ?? ''),
        matches: [
          {
            line: Number(node['@_line'] ?? 0),
            snippet: String(node['@_snippet'] ?? node['#text'] ?? ''),
          },
        ],
      });
    }
  }

  return results;
}

/**
 * Parse domain metadata XML from /sap/bc/adt/ddic/domains/{name}.
 *
 * Domains don't have /source/main — they return structured XML with
 * type information, output characteristics, value table, and fixed values.
 *
 * Expected root: <doma:domain> with nested <doma:content>.
 */
export function parseDomainMetadata(xml: string): DomainInfo {
  const parsed = parseXml(xml);
  // After NS strip: doma:domain → domain
  const domain = (parsed.domain ?? {}) as Record<string, unknown>;
  const content = (domain.content ?? {}) as Record<string, unknown>;
  const typeInfo = (content.typeInformation ?? {}) as Record<string, unknown>;
  const outputInfo = (content.outputInformation ?? {}) as Record<string, unknown>;
  const valueInfo = (content.valueInformation ?? {}) as Record<string, unknown>;
  const pkgRef = (domain.packageRef ?? {}) as Record<string, unknown>;

  // Parse fixed values if present
  const fixedValues: Array<{ low: string; high: string; description: string }> = [];
  const fvContainer = valueInfo.fixValues ?? valueInfo.fixedValues;
  if (fvContainer && typeof fvContainer === 'object') {
    const fvNodes = findDeepNodes(fvContainer as Record<string, unknown>, 'fixValue');
    for (const fv of fvNodes) {
      fixedValues.push({
        low: String(fv.low ?? fv['@_low'] ?? ''),
        high: String(fv.high ?? fv['@_high'] ?? ''),
        description: String(fv.text ?? fv.description ?? fv['@_text'] ?? fv['@_description'] ?? ''),
      });
    }
  }

  // Parse value table reference
  const valueTableRef = (valueInfo.valueTableRef ?? {}) as Record<string, unknown>;

  return {
    name: String(domain['@_name'] ?? ''),
    description: String(domain['@_description'] ?? ''),
    dataType: String(typeInfo.datatype ?? ''),
    length: String(typeInfo.length ?? ''),
    decimals: String(typeInfo.decimals ?? ''),
    outputLength: String(outputInfo.length ?? ''),
    conversionExit: String(outputInfo.conversionExit ?? ''),
    signExists: String(outputInfo.signExists ?? '') === 'true',
    lowercase: String(outputInfo.lowercase ?? '') === 'true',
    valueTable: String(valueTableRef['@_name'] ?? ''),
    fixedValues,
    package: String(pkgRef['@_name'] ?? ''),
  };
}

/**
 * Parse data element metadata XML from /sap/bc/adt/ddic/dataelements/{name}.
 *
 * Data elements don't have /source/main — they return structured XML with
 * domain/type reference, field labels, search help, and other metadata.
 *
 * Expected root: <blue:wbobj> with nested <dtel:dataElement>.
 */
export function parseDataElementMetadata(xml: string): DataElementInfo {
  const parsed = parseXml(xml);
  // After NS strip: blue:wbobj → wbobj
  const wbobj = (parsed.wbobj ?? {}) as Record<string, unknown>;
  const pkgRef = (wbobj.packageRef ?? {}) as Record<string, unknown>;

  // Find the dataElement node — after NS strip: dtel:dataElement → dataElement
  const dtelNodes = findDeepNodes(parsed, 'dataElement');
  const dtel = dtelNodes[0] ?? {};

  return {
    name: String(wbobj['@_name'] ?? ''),
    description: String(wbobj['@_description'] ?? ''),
    typeKind: String(dtel.typeKind ?? ''),
    typeName: String(dtel.typeName ?? ''),
    dataType: String(dtel.dataType ?? ''),
    length: String(dtel.dataTypeLength ?? ''),
    decimals: String(dtel.dataTypeDecimals ?? ''),
    shortLabel: String(dtel.shortFieldLabel ?? ''),
    mediumLabel: String(dtel.mediumFieldLabel ?? ''),
    longLabel: String(dtel.longFieldLabel ?? ''),
    headingLabel: String(dtel.headingFieldLabel ?? ''),
    searchHelp: String(dtel.searchHelp ?? ''),
    defaultComponentName: String(dtel.defaultComponentName ?? ''),
    package: String(pkgRef['@_name'] ?? ''),
  };
}

/**
 * Parse authorization field metadata from /sap/bc/adt/aps/iam/auth/{name}.
 *
 * Expected root: <auth:auth> with IAM field metadata and org-level entries.
 */
export function parseAuthorizationField(xml: string): AuthorizationFieldInfo {
  const parsed = parseXml(xml);
  // After NS strip: auth:auth → auth (root). Fall back to findDeepNodes for robustness.
  const auth = (parsed.auth ?? findDeepNodes(parsed, 'auth')[0] ?? {}) as Record<string, unknown>;
  const content = (auth.content ?? {}) as Record<string, unknown>;
  const pkgRef = (auth.packageRef ?? {}) as Record<string, unknown>;
  // Real SAP responses wrap fields under <auth:content>; older shapes put them at root. Support both.
  const field = (key: string): unknown => content[key] ?? auth[key];
  const orgLevelInfo = toStringArray(content.orglvlinfo ?? auth.orglvlinfo);

  return {
    name: String(field('fieldName') ?? auth['@_name'] ?? ''),
    description: String(auth['@_description'] ?? ''),
    roleName: String(field('rollName') ?? ''),
    checkTable: String(field('checkTable') ?? ''),
    domainName: String(field('domname') ?? ''),
    outputLength: String(field('outputlen') ?? ''),
    conversionExit: String(field('convexit') ?? ''),
    exitFunctionModule: String(field('exitFB') ?? ''),
    package: String(pkgRef['@_name'] ?? ''),
    orgLevelInfo,
    masterLanguage: String(auth['@_masterLanguage'] ?? ''),
  };
}

/**
 * Parse feature toggle states JSON from /sap/bc/adt/sfw/featuretoggles/{name}/states.
 */
export function parseFeatureToggleStates(json: string, name: string): FeatureToggleInfo {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Invalid JSON';
    throw new AdtApiError(
      `ADT_JSON_PARSE: Failed to parse feature toggle states for "${name}": ${reason}`,
      500,
      `/sap/bc/adt/sfw/featuretoggles/${encodeURIComponent(name)}/states`,
      json,
    );
  }

  // SAP wraps the payload in a STATES object with upper-case keys.
  const wrap = (parsed.STATES ?? parsed) as Record<string, unknown>;
  const normalizeState = (raw: unknown): 'on' | 'off' | 'unknown' => {
    const s = String(raw ?? '').toLowerCase();
    return s === 'on' ? 'on' : s === 'off' ? 'off' : 'unknown';
  };

  const clientStatesRaw = Array.isArray(wrap.CLIENT_STATES) ? wrap.CLIENT_STATES : [];
  const states = clientStatesRaw.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const description = String(row.DESCRIPTION ?? '');
    return {
      client: String(row.CLIENT ?? ''),
      state: normalizeState(row.STATE),
      ...(description ? { description } : {}),
    };
  });

  const userStatesRaw = Array.isArray(wrap.USER_STATES) ? wrap.USER_STATES : [];
  const userStates = userStatesRaw.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      client: String(row.CLIENT ?? ''),
      user: String(row.USER ?? ''),
      state: normalizeState(row.STATE),
    };
  });

  return {
    name: String(wrap.NAME ?? name),
    clientState: String(wrap.CLIENT_STATE ?? ''),
    userState: String(wrap.USER_STATE ?? ''),
    states,
    userStates,
  };
}

/**
 * Parse enhancement implementation metadata from /sap/bc/adt/enhancements/enhoxhb/{name}.
 *
 * Expected root: <enho:objectData> with contentCommon/contentSpecific and BAdI entries.
 */
export function parseEnhancementImplementation(xml: string): EnhancementImplementationInfo {
  const parsed = parseXml(xml);
  const objectData = (parsed.objectData ?? findDeepNodes(parsed, 'objectData')[0] ?? {}) as Record<string, unknown>;
  const pkgRef = (objectData.packageRef ?? {}) as Record<string, unknown>;
  const contentCommon = (objectData.contentCommon ?? {}) as Record<string, unknown>;
  const contentSpecific = (objectData.contentSpecific ?? {}) as Record<string, unknown>;

  // Real responses wrap impls: contentSpecific > badiTechnology > badiImplementations > badiImplementation[]
  // badiTechnology may be an empty element (text value) on implementations with no BAdIs.
  const badiTech = contentSpecific.badiTechnology;
  const badiTechRec =
    badiTech && typeof badiTech === 'object' ? (badiTech as Record<string, unknown>) : ({} as Record<string, unknown>);
  const badiImplContainer = (badiTechRec.badiImplementations ?? contentSpecific.badiImplementations ?? {}) as Record<
    string,
    unknown
  >;
  const badiImplNodes = toRecordArray(badiImplContainer.badiImplementation);

  const technology = String(
    contentCommon['@_toolType'] ?? (typeof badiTech === 'string' || typeof badiTech === 'number' ? badiTech : ''),
  );

  return {
    name: String(objectData['@_name'] ?? ''),
    description: String(objectData['@_description'] ?? ''),
    package: String(pkgRef['@_name'] ?? ''),
    technology,
    switchSupported: String(contentCommon['@_switchSupported'] ?? '') === 'true',
    badiImplementations: badiImplNodes.map((node) => {
      const implementingClass = (node.implementingClass ?? {}) as Record<string, unknown>;
      const badiDefinition = (node.badiDefinition ?? {}) as Record<string, unknown>;
      const enhancementSpot = (node.enhancementSpot ?? {}) as Record<string, unknown>;
      return {
        name: String(node['@_name'] ?? ''),
        shortText: String(node['@_shortText'] ?? ''),
        implementingClass: String(implementingClass['@_name'] ?? ''),
        badiDefinition: String(badiDefinition['@_name'] ?? ''),
        enhancementSpot: String(enhancementSpot['@_name'] ?? ''),
        active: String(node['@_active'] ?? '') === 'true',
        default: String(node['@_default'] ?? '') === 'true',
      };
    }),
  };
}

/**
 * Parse transaction metadata XML from /sap/bc/adt/vit/wb/object_type/trant/object_name/{name}.
 *
 * Returns basic transaction info: code, description, package.
 * The program name is not in this endpoint — use SQL (TSTC) for full details.
 *
 * Expected root: <adtcore:mainObject>.
 */
export function parseTransactionMetadata(xml: string): TransactionInfo {
  const parsed = parseXml(xml);
  // After NS strip: adtcore:mainObject → mainObject
  const obj = (parsed.mainObject ?? {}) as Record<string, unknown>;
  const pkgRef = (obj.packageRef ?? {}) as Record<string, unknown>;

  return {
    code: String(obj['@_name'] ?? ''),
    description: String(obj['@_description'] ?? ''),
    program: '', // Not available from this endpoint — populated via SQL in handler
    package: String(pkgRef['@_name'] ?? ''),
  };
}

/**
 * Parse API release state XML from /sap/bc/adt/apireleases/{encoded-uri}.
 *
 * Returns structured release info with per-contract states (C0–C4),
 * successor information, and catalog metadata.
 *
 * Expected root: element with releasableObject, c0Release–c4Release, apiCatalogData.
 */
export function parseApiReleaseState(xml: string): ApiReleaseStateInfo {
  const parsed = parseXml(xml);
  // The root element name varies — find the first non-declaration key
  const rootKey = Object.keys(parsed).find((k) => !k.startsWith('?'));
  const root = (rootKey ? parsed[rootKey] : parsed) as Record<string, unknown>;

  // releasableObject attrs
  const relObj = (root.releasableObject ?? {}) as Record<string, unknown>;

  // Parse C0–C4 contract releases
  const contracts: ApiReleaseContract[] = [];
  for (const key of ['c0Release', 'c1Release', 'c2Release', 'c3Release', 'c4Release']) {
    const release = root[key] as Record<string, unknown> | undefined;
    if (!release) continue;
    const status = (release.status ?? {}) as Record<string, unknown>;
    const successorsContainer = release.successors as Record<string, unknown> | undefined;
    const successorArr: Array<{ uri: string; type: string; name: string }> = [];
    if (successorsContainer) {
      const succs = Array.isArray(successorsContainer.successor)
        ? (successorsContainer.successor as Array<Record<string, unknown>>)
        : successorsContainer.successor
          ? [successorsContainer.successor as Record<string, unknown>]
          : [];
      for (const s of succs) {
        successorArr.push({
          uri: String(s['@_uri'] ?? ''),
          type: String(s['@_type'] ?? ''),
          name: String(s['@_name'] ?? ''),
        });
      }
    }
    contracts.push({
      contract: String(release['@_contract'] ?? key.replace('Release', '').toUpperCase()),
      state: String(status['@_state'] ?? ''),
      stateDescription: String(status['@_stateDescription'] ?? ''),
      useInKeyUserApps: String(release['@_useInKeyUserApps'] ?? 'false') === 'true',
      useInSAPCloudPlatform: String(release['@_useInSAPCloudPlatform'] ?? 'false') === 'true',
      successors: successorArr,
    });
  }

  // apiCatalogData attrs
  const catalog = (root.apiCatalogData ?? {}) as Record<string, unknown>;

  return {
    objectUri: String(relObj['@_uri'] ?? ''),
    objectType: String(relObj['@_type'] ?? ''),
    objectName: String(relObj['@_name'] ?? ''),
    contracts,
    isAnyContractReleased: String(catalog['@_isAnyContractReleased'] ?? 'false') === 'true',
    isAnyAssignmentPossible: String(catalog['@_isAnyAssignmentPossible'] ?? 'false') === 'true',
  };
}

/**
 * Parse service binding metadata XML into a human-readable summary.
 *
 * SRVB objects don't have editable source — they're structured XML with binding configuration.
 * We extract the key fields into a JSON summary:
 * - name, description, OData version (V2/V4), binding type (UI/Web API)
 * - service definition reference, publish status, contract
 */
export function parseServiceBinding(xml: string): string {
  const parsed = parseXml(xml);
  const sb = (parsed.serviceBinding ?? {}) as Record<string, unknown>;

  // Extract binding info
  const binding = (sb.binding ?? {}) as Record<string, unknown>;
  const services = sb.services as Record<string, unknown> | undefined;
  const content = (services?.content ?? {}) as Record<string, unknown>;
  const srvDef = (content?.serviceDefinition ?? {}) as Record<string, unknown>;
  const pkg = (sb.packageRef ?? {}) as Record<string, unknown>;

  const result = {
    name: String(sb['@_name'] ?? ''),
    description: String(sb['@_description'] ?? ''),
    type: String(sb['@_type'] ?? ''),
    odataVersion: String(binding['@_version'] ?? ''),
    bindingType: String(binding['@_type'] ?? ''),
    bindingCategory:
      binding['@_category'] === '0'
        ? 'UI'
        : binding['@_category'] === '1'
          ? 'Web API'
          : String(binding['@_category'] ?? ''),
    published: sb['@_published'] === 'true',
    bindingCreated: sb['@_bindingCreated'] === 'true',
    contract: String(sb['@_contract'] ?? ''),
    releaseSupported: sb['@_releaseSupported'] === 'true',
    serviceDefinition: String(srvDef['@_name'] ?? ''),
    serviceName: String(services?.['@_name'] ?? ''),
    serviceVersion: String(content?.['@_version'] ?? ''),
    releaseState: String(content?.['@_releaseState'] ?? ''),
    package: String(pkg['@_name'] ?? ''),
    implementation: String((binding.implementation as Record<string, unknown>)?.['@_name'] ?? ''),
    language: String(sb['@_language'] ?? ''),
    changedAt: String(sb['@_changedAt'] ?? ''),
    changedBy: String(sb['@_changedBy'] ?? ''),
  };

  return JSON.stringify(result, null, 2);
}

/**
 * Parse message class metadata XML from /sap/bc/adt/messageclass/{name}.
 *
 * Message classes are metadata-only (no /source/main). The XML contains
 * the message class attributes and individual messages as mc:messages elements.
 *
 * Expected root: <mc:messageClass> (after NS strip: messageClass).
 */
export function parseMessageClass(xml: string): MessageClassInfo {
  const parsed = parseXml(xml);
  const mc = (parsed.messageClass ?? {}) as Record<string, unknown>;
  const pkgRef = (mc.packageRef ?? {}) as Record<string, unknown>;

  const msgNodes = Array.isArray(mc.messages) ? (mc.messages as Array<Record<string, unknown>>) : [];
  const messages = msgNodes.map((m) => ({
    number: String(m['@_msgno'] ?? ''),
    shortText: decodeXmlEntities(String(m['@_msgtext'] ?? '')),
  }));

  return {
    name: String(mc['@_name'] ?? ''),
    description: String(mc['@_description'] ?? ''),
    messages,
    package: String(pkgRef['@_name'] ?? ''),
  };
}

// ─── BSP / UI5 Filestore Parsers ────────────────────────────────────

/**
 * Parse BSP app list from /sap/bc/adt/filestore/ui5-bsp/objects.
 *
 * Returns an Atom feed where each entry has:
 * - <atom:title> → app name
 * - <atom:summary> → description
 */
export function parseBspAppList(xml: string): BspAppInfo[] {
  const parsed = parseXml(xml);
  const entries = getNestedArray(parsed, 'feed', 'entry');
  return entries.map((entry: Record<string, unknown>) => {
    const summary = entry.summary;
    // <atom:summary type="text">desc</atom:summary> → fast-xml-parser returns {#text, @_type} when attributes present
    const description =
      typeof summary === 'string' ? summary : String((summary as Record<string, unknown>)?.['#text'] ?? '');
    return {
      name: String(entry.title ?? ''),
      description,
    };
  });
}

/**
 * Parse BSP folder listing from /sap/bc/adt/filestore/ui5-bsp/objects/{app}/content.
 *
 * Each entry has:
 * - <atom:category term="file|folder"/> → type
 * - <atom:title> → full path like "APPNAME/Component.js"
 * - <atom:content afr:etag="..."> → etag for files
 *
 * We extract the relative path by stripping the appName prefix,
 * and the file/folder name from the last path segment.
 */
export function parseBspFolderListing(xml: string, appName: string): BspFileNode[] {
  const parsed = parseXml(xml);
  const entries = getNestedArray(parsed, 'feed', 'entry');
  return entries.map((entry: Record<string, unknown>) => {
    const title = String(entry.title ?? '');
    const category = entry.category as Record<string, unknown> | undefined;
    const term = String(category?.['@_term'] ?? 'file');
    const nodeType = term === 'folder' ? 'folder' : 'file';
    const content = entry.content as Record<string, unknown> | undefined;
    const etag = content?.['@_etag'];

    // Path relative to app root
    const path = title.startsWith(appName) ? title.substring(appName.length) : `/${title}`;
    // Name is the last segment
    const name = title.split('/').pop() || title;

    return {
      name,
      path,
      type: nodeType,
      ...(etag != null ? { etag: String(etag) } : {}),
    };
  });
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Decode standard XML entities in attribute values.
 * fast-xml-parser with processEntities:false + parseAttributeValue:false
 * keeps raw encoded strings — we decode them for human-readable output.
 *
 * `&amp;` is decoded LAST so chained entities like `&amp;lt;` resolve to the
 * literal `&lt;` rather than `<`. Closes CodeQL alert `js/double-escaping`
 * (alert #8).
 */
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Safely get a nested array from parsed XML */
function getNestedArray(obj: Record<string, unknown>, parent: string, child: string): Array<Record<string, unknown>> {
  const parentObj = obj[parent] as Record<string, unknown> | undefined;
  if (!parentObj) return [];
  const arr = parentObj[child];
  if (Array.isArray(arr)) return arr as Array<Record<string, unknown>>;
  if (arr && typeof arr === 'object') return [arr as Record<string, unknown>];
  return [];
}

/** Recursively find an array by key name, anywhere in the object tree */
export function findDeepNodes(obj: unknown, key: string): Array<Record<string, unknown>> {
  if (!obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findDeepNodes(item, key);
      if (found.length > 0) return found;
    }
    return [];
  }
  const record = obj as Record<string, unknown>;
  if (key in record) {
    const val = record[key];
    if (Array.isArray(val)) return val as Array<Record<string, unknown>>;
    if (val && typeof val === 'object') return [val as Record<string, unknown>];
  }
  for (const val of Object.values(record)) {
    const found = findDeepNodes(val, key);
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * Map ADT class category numeric codes to human-readable AFF enum strings.
 *
 * Category codes from SAP ADT `class:category` attribute:
 * "00" = general, "40" = exit class, "01" = exception, etc.
 */
const CLASS_CATEGORY_MAP: Record<string, string> = {
  '00': 'generalObjectType',
  '01': 'exceptionClass',
  '02': 'persistentClass',
  '03': 'behaviorClass',
  '04': 'businessClass',
  '05': 'factoryForPersistentClass',
  '06': 'statusClassForPersistClass',
  '11': 'rfcProxyClass',
  '12': 'communicationConnectionClass',
  '14': 'areaClassSharedObjects',
  '30': 'bspApplicationClass',
  '31': 'basisClassBspElementHdlr',
  '32': 'webDynproRuntimeObject',
  '33': 'entityEventHandler',
  '40': 'exitClass',
  '41': 'testclassAbapUnit',
};

/**
 * Parse class metadata XML from /sap/bc/adt/oo/classes/{name}.
 *
 * Classes without /source/main return structured XML with description,
 * language version, category, fixPointArithmetic, and package info.
 *
 * Expected root: <class:abapClass> (after NS strip: abapClass).
 */
export function parseClassMetadata(xml: string): ClassMetadata {
  const parsed = parseXml(xml);
  const cls = (parsed.abapClass ?? {}) as Record<string, unknown>;
  const pkgRef = (cls.packageRef ?? {}) as Record<string, unknown>;

  const rawCategory = String(cls['@_category'] ?? '');

  // <class:rootEntityRef> is present on behavior pool classes (category=behaviorPool).
  // It binds the class back to its root CDS entity (the BDEF/DDLS name); used by
  // SAPWrite(action="generate_behavior_implementation") to auto-discover the BDEF
  // without a second metadata round-trip. Absent on regular classes.
  const rootEntityRefRaw = cls.rootEntityRef as Record<string, unknown> | undefined;
  const rootEntityRefName = String(rootEntityRefRaw?.['@_name'] ?? '');
  const rootEntityRef = rootEntityRefName
    ? {
        name: rootEntityRefName,
        type: String(rootEntityRefRaw?.['@_type'] ?? ''),
        uri: String(rootEntityRefRaw?.['@_uri'] ?? ''),
      }
    : undefined;

  return {
    name: String(cls['@_name'] ?? ''),
    description: String(cls['@_description'] ?? ''),
    language: String(cls['@_language'] ?? ''),
    ...(cls['@_abapLanguageVersion'] != null ? { abapLanguageVersion: String(cls['@_abapLanguageVersion']) } : {}),
    category: CLASS_CATEGORY_MAP[rawCategory] ?? rawCategory,
    fixPointArithmetic: String(cls['@_fixPointArithmetic'] ?? 'false') === 'true',
    package: String(pkgRef['@_name'] ?? ''),
    ...(rootEntityRef ? { rootEntityRef } : {}),
  };
}

/**
 * Parse the `<blue:blueSource>` metadata of a server-driven (AFF generic) object — the
 * ABAP Platform 2025 (8.16+) contract shared by DESD, EVTB, DTSC, COTA, … (GET …/{name},
 * Accept application/vnd.sap.adt.blues.v1+xml). `removeNSPrefix` strips blue:/adtcore:, so the
 * root element <blue:blueSource> is keyed `blueSource`. Optional fields are omitted when empty.
 */
export function parseBlueSource(xml: string): ServerDrivenObjectMetadata {
  const root = (parseXml(xml).blueSource ?? {}) as Record<string, unknown>;
  const pkgRef = (root.packageRef ?? {}) as Record<string, unknown>;
  const str = (k: string): string => {
    const v = root[k];
    return v == null ? '' : String(v);
  };
  const meta: ServerDrivenObjectMetadata = { name: str('@_name'), type: str('@_type') };
  const opt = (key: keyof ServerDrivenObjectMetadata, attr: string): void => {
    const v = str(attr);
    if (v) (meta as unknown as Record<string, unknown>)[key] = v;
  };
  opt('description', '@_description');
  opt('masterLanguage', '@_masterLanguage');
  opt('abapLanguageVersion', '@_abapLanguageVersion');
  opt('responsible', '@_responsible');
  opt('version', '@_version');
  opt('changedBy', '@_changedBy');
  opt('changedAt', '@_changedAt');
  opt('createdBy', '@_createdBy');
  opt('createdAt', '@_createdAt');
  const pkg = pkgRef['@_name'] == null ? '' : String(pkgRef['@_name']);
  if (pkg) meta.package = pkg;
  return meta;
}

/** Safely traverse a deep path and return an array at the end */
function getDeepArray(obj: Record<string, unknown>, path: string[]): Array<Record<string, unknown>> {
  let current: unknown = obj;
  for (const key of path.slice(0, -1)) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return [];
    }
  }
  const lastKey = path[path.length - 1]!;
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    const arr = (current as Record<string, unknown>)[lastKey];
    if (Array.isArray(arr)) return arr as Array<Record<string, unknown>>;
    if (arr && typeof arr === 'object') return [arr as Record<string, unknown>];
  }
  return [];
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  }
  if (value && typeof value === 'object') {
    return [value as Record<string, unknown>];
  }
  return [];
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry ?? ''));
  if (value === undefined || value === null) return [];
  return [String(value)];
}

/** Parse inactive objects response from /sap/bc/adt/activation/inactiveobjects.
 *  Supports three response shapes (all live-verified):
 *   - Rich `<ioc:object>` (vendor MIME on every supported release, includes user/transport/deleted metadata):
 *       <ioc:inactiveObjects><ioc:entry>
 *         <ioc:object ioc:user="X" ioc:deleted="false">
 *           <ioc:ref adtcore:uri="..." adtcore:type="BDEF/BDO" adtcore:name="..."/>
 *         </ioc:object>
 *         <ioc:transport ...><ioc:ref adtcore:name="A4HK..."/></ioc:transport>
 *       </ioc:entry>...</ioc:inactiveObjects>
 *   - Flat with `application/xml` Accept (NW 7.50 + legacy):
 *       <feed><entry><objectReference .../></entry>...</feed>
 *   - Flat root-level (very old):
 *       <adtcore:objectReferences><adtcore:objectReference .../>...</adtcore:objectReferences>
 *  Detection: rich shape if any <entry><object> has a nested <ref>; otherwise flat.
 */
export function parseInactiveObjects(xml: string): InactiveObject[] {
  if (!xml.trim()) return [];
  const parsed = parseXml(xml);
  const entries = findDeepNodes(parsed, 'entry');

  const hasRichObjects = entries.some((entry) =>
    toRecordArray((entry as Record<string, unknown>).object).some((object) => {
      const refs = toRecordArray(object.ref);
      return refs.length > 0;
    }),
  );

  if (hasRichObjects) {
    const results: InactiveObject[] = [];
    for (const entry of entries) {
      const entryRecord = entry as Record<string, unknown>;
      for (const object of toRecordArray(entryRecord.object)) {
        const ref = toRecordArray(object.ref)[0];
        if (!ref) continue;
        const transportRef = toRecordArray(toRecordArray(entryRecord.transport)[0]?.ref)[0];
        results.push({
          name: String(ref['@_name'] ?? ''),
          type: String(ref['@_type'] ?? ''),
          uri: String(ref['@_uri'] ?? ''),
          ...(ref['@_description'] ? { description: String(ref['@_description']) } : {}),
          ...(object['@_user'] ? { user: String(object['@_user']) } : {}),
          ...(object['@_deleted'] !== undefined
            ? { deleted: String(object['@_deleted']).toLowerCase() === 'true' }
            : {}),
          ...(transportRef?.['@_name'] ? { transport: String(transportRef['@_name']) } : {}),
          ...(transportRef?.['@_parentUri'] ? { parentTransport: String(transportRef['@_parentUri']) } : {}),
        });
      }
    }
    return results;
  }

  // Flat objectReference shape (legacy + NW 7.50 with generic Accept). Each inactive object
  // is usually in its own entry, but very old responses put objectReference nodes directly
  // under the root. Use entries when present, else search the full doc.
  const flatResults: InactiveObject[] = [];
  const flatContainers = entries.length > 0 ? entries : [parsed];
  for (const container of flatContainers) {
    for (const ref of findDeepNodes(container, 'objectReference')) {
      flatResults.push({
        name: String(ref['@_name'] ?? ''),
        type: String(ref['@_type'] ?? ''),
        uri: String(ref['@_uri'] ?? ''),
        ...(ref['@_description'] ? { description: String(ref['@_description']) } : {}),
      });
    }
  }
  return flatResults;
}

/** Parse source revision history feed from /source/main/versions */
export function parseRevisionFeed(xml: string): RevisionListResult {
  const empty: RevisionListResult = {
    object: { name: '', type: '' },
    revisions: [],
  };
  if (!xml.trim()) return empty;

  try {
    const parsed = parseXml(xml);
    const feed = (parsed.feed ?? {}) as Record<string, unknown>;
    const title = String(feed.title ?? '');
    const match = title.match(/^Version List of (\S+) \(([A-Z]+)\)/);
    const object = {
      name: String(match?.[1] ?? ''),
      type: String(match?.[2] ?? ''),
    };

    const revisions: RevisionInfo[] = [];
    const entries = findDeepNodes(parsed, 'entry');
    for (const entry of entries) {
      const authorNode = toRecordArray(entry.author)[0] ?? {};
      const contentNode = toRecordArray(entry.content)[0] ?? {};
      const links = toRecordArray(entry.link);
      const transportLink = links.find(
        (link) => String(link['@_rel'] ?? '') === 'http://www.sap.com/adt/relations/transports',
      );
      const transport = String(transportLink?.['@_title'] ?? transportLink?.['@_version'] ?? '');
      const versionTitle = String(entry.title ?? '');

      revisions.push({
        id: String(entry.id ?? ''),
        author: String(authorNode.name ?? ''),
        timestamp: String(entry.updated ?? ''),
        ...(versionTitle ? { versionTitle } : {}),
        ...(transport ? { transport } : {}),
        uri: String(contentNode['@_src'] ?? ''),
      });
    }
    return { object, revisions };
  } catch {
    return empty;
  }
}

// ─── parseClassStructure (issue #303) ─────────────────────────────────────

/**
 * Parse a `#start=L,C;end=L,C` fragment from an `<atom:link>` href into a `LineRange`.
 *
 * Returns `null` if the fragment doesn't match — callers treat `null` as "this
 * element doesn't carry a range" (e.g. the `CLAS/OCX` text-elements ref has no
 * `#start=…` in its `definitionIdentifier` href, just a deep-link URL).
 */
function parseLineRange(href: string): LineRange | null {
  const m = href.match(/#start=(\d+),(\d+);end=(\d+),(\d+)/);
  if (!m) return null;
  return { sr: +m[1], sc: +m[2], er: +m[3], ec: +m[4] };
}

/**
 * Parse `/sap/bc/adt/oo/classes/{name}/objectstructure` XML into a `ClassStructure`.
 *
 * Wire shape varies across SAP releases:
 *
 * **Kernel 7.58+ (S/4HANA 2023):** every method is ONE `<objectStructureElement>`
 * with `adtcore:type="CLAS/OM"`, carrying both `definitionBlock` and
 * `implementationBlock` atom:link children.
 *
 * **Kernel 7.50 (NW 7.50 SP02 / NPL):** methods are SPLIT into two elements with
 * the same `adtcore:name` — `CLAS/OO` (carries `definitionBlock` + identifiers)
 * and `CLAS/OM` (carries `implementationBlock` + identifiers). This parser groups
 * by name and merges, so callers see one `MethodStructure` per method on either
 * release. ABSTRACT methods have a `CLAS/OO` entry only (no `implementationBlock`).
 *
 * Live evidence: fixtures `tests/fixtures/xml/objectstructure-clas-a4h-758.xml`
 * (single-element shape) and `objectstructure-clas-npl-750.xml` (split shape).
 *
 * Implementation note: this parser is regex-driven, not XMLParser-driven. The
 * `objectstructure` response is large (~40KB for `CL_ABAP_TYPEDESCR`) and the
 * existing `removeNSPrefix: true` parser config would strip the `adtcore:type`
 * attribute we need for the OO/OM merge. The element shape is regular enough
 * that scoped regexes are cheaper and more readable than reconfiguring the
 * shared parser.
 */
export function parseClassStructure(xml: string, className?: string): ClassStructure {
  if (!xml.trim()) {
    throw new AdtApiError('parseClassStructure: empty XML response', 0, '');
  }

  // Top-level class name (preferred from xml attribute; fall back to caller-provided).
  const rootMatch = xml.match(/<abapsource:objectStructureElement\b[^>]*\badtcore:name="([^"]+)"/);
  const resolvedClassName = rootMatch?.[1] ?? className ?? '';

  // The XML is a single root `<abapsource:objectStructureElement>` (the class itself,
  // type CLAS/OC) that WRAPS the per-method/attribute children of the same element
  // name. A naive non-greedy regex eats the first child's close tag as the root's
  // close tag, so we strip the outer wrapper before scanning for children.
  //
  // Inner-content extraction: find the first `>` of the root (end of root open tag)
  // and the last `</abapsource:objectStructureElement>` (the root close tag).
  const rootOpenEnd = xml.indexOf('>', xml.indexOf('<abapsource:objectStructureElement'));
  const rootCloseStart = xml.lastIndexOf('</abapsource:objectStructureElement>');
  const inner = rootOpenEnd >= 0 && rootCloseStart > rootOpenEnd ? xml.slice(rootOpenEnd + 1, rootCloseStart) : xml;

  // Class-level blocks live in the root element's OWN atom:link children, which
  // precede the first nested <objectStructureElement>. Scope the search to that
  // prefix so a method's definitionBlock can never be mistaken for the class
  // block, regardless of how SAP orders elements across releases.
  const firstChildIdx = inner.indexOf('<abapsource:objectStructureElement');
  const classScope = firstChildIdx >= 0 ? inner.slice(0, firstChildIdx) : inner;
  const classDefMatch = classScope.match(
    /rel="http:\/\/www\.sap\.com\/adt\/relations\/source\/definitionBlock"[^>]*href="([^"]+)"/,
  );
  const classImplMatch = classScope.match(
    /rel="http:\/\/www\.sap\.com\/adt\/relations\/source\/implementationBlock"[^>]*href="([^"]+)"/,
  );
  if (!classDefMatch) {
    throw new AdtApiError(
      'parseClassStructure: response missing class-level definitionBlock atom:link',
      0,
      xml.slice(0, 256),
    );
  }
  const classDef = parseLineRange(classDefMatch[1]);
  if (!classDef) {
    throw new AdtApiError(
      `parseClassStructure: class definitionBlock href has no #start fragment: ${classDefMatch[1]}`,
      0,
      '',
    );
  }
  const classImpl = classImplMatch ? (parseLineRange(classImplMatch[1]) ?? undefined) : undefined;

  // Children themselves do NOT nest objectStructureElement — they only contain
  // <atom:link/> self-closing elements. So a non-greedy match on the children
  // is safe inside `inner`.
  const elemRe =
    /<abapsource:objectStructureElement\s+([^>]*adtcore:type="CLAS\/[A-Z]+"[^>]*)>([\s\S]*?)<\/abapsource:objectStructureElement>/g;

  // 7.50 split shape: per-name accumulators.
  type PartialMethod = {
    name: string;
    visibility?: 'public' | 'protected' | 'private';
    level?: 'instance' | 'static';
    abstract: boolean;
    constructor: boolean;
    definition?: LineRange;
    implementation?: LineRange;
    definitionIdentifier?: LineRange;
    implementationIdentifier?: LineRange;
  };
  const methodsByName = new Map<string, PartialMethod>();
  const attributes: AttributeStructure[] = [];

  for (const match of inner.matchAll(elemRe)) {
    const attrs = match[1];
    const elemInner = match[2];
    const type = attrs.match(/adtcore:type="(CLAS\/[A-Z]+)"/)?.[1];
    if (!type) continue;
    const name = attrs.match(/adtcore:name="([^"]*)"/)?.[1] ?? '';
    if (!name) continue;

    const visibility = attrs.match(/visibility="([^"]+)"/)?.[1] as 'public' | 'protected' | 'private' | undefined;
    const level = attrs.match(/level="([^"]+)"/)?.[1] as 'instance' | 'static' | undefined;
    const isAbstract = /\babstract="true"/.test(attrs);
    const isConstructor = /\bconstructor="true"/.test(attrs);
    const isConstant = /\bconstant="true"/.test(attrs);
    const isReadOnly = /\breadOnly="true"/.test(attrs);

    const defBlock = elemInner.match(/rel="[^"]*\/definitionBlock"[^>]*href="([^"]+)"/)?.[1];
    const implBlock = elemInner.match(/rel="[^"]*\/implementationBlock"[^>]*href="([^"]+)"/)?.[1];
    const defIdent = elemInner.match(/rel="[^"]*\/definitionIdentifier"[^>]*href="([^"]+)"/)?.[1];
    const implIdent = elemInner.match(/rel="[^"]*\/implementationIdentifier"[^>]*href="([^"]+)"/)?.[1];

    // Methods: CLAS/OM (7.58+ unified or 7.50 impl-side), CLAS/OO (7.50 def-side).
    if (type === 'CLAS/OM' || type === 'CLAS/OO') {
      const upper = name.toUpperCase();
      let entry = methodsByName.get(upper);
      if (!entry) {
        entry = { name: upper, abstract: false, constructor: false };
        methodsByName.set(upper, entry);
      }
      // visibility/level/abstract/constructor: prefer the CLAS/OO (def-side) values
      // when both are present (the def side carries the canonical metadata). On
      // 7.58+ the single CLAS/OM element carries everything.
      if (visibility && (!entry.visibility || type === 'CLAS/OO')) entry.visibility = visibility;
      if (level && (!entry.level || type === 'CLAS/OO')) entry.level = level;
      if (isAbstract) entry.abstract = true;
      if (isConstructor) entry.constructor = true;
      if (defBlock) {
        const r = parseLineRange(defBlock);
        if (r) entry.definition = r;
      }
      if (implBlock) {
        const r = parseLineRange(implBlock);
        if (r) entry.implementation = r;
      }
      if (defIdent) {
        const r = parseLineRange(defIdent);
        if (r) entry.definitionIdentifier = r;
      }
      if (implIdent) {
        const r = parseLineRange(implIdent);
        if (r) entry.implementationIdentifier = r;
      }
      continue;
    }

    // Attributes: CLAS/OA.
    if (type === 'CLAS/OA' && defBlock) {
      const def = parseLineRange(defBlock);
      if (!def) continue;
      attributes.push({
        name: name.toUpperCase(),
        visibility: visibility ?? 'public',
        level: level ?? 'instance',
        constant: isConstant,
        readOnly: isReadOnly,
        definition: def,
      });
    }

    // Other CLAS/O* types (CLAS/OE events, CLAS/OT types, CLAS/OF friends,
    // CLAS/OK constants/literals, CLAS/OCX text-elements) are intentionally
    // dropped — class-section surgery (issue #303) only targets methods.
    // Attribute-management is a future follow-up; events/types deeper still.
  }

  // Build the final methods array: skip entries that have no definition range
  // (defensive — every real method emitted by SAP carries at least a CLAS/OO
  // with definitionBlock, but parser robustness matters when the wire format
  // drifts).
  const methods: MethodStructure[] = [];
  for (const m of methodsByName.values()) {
    if (!m.definition) continue;
    methods.push({
      name: m.name,
      visibility: m.visibility ?? 'public',
      level: m.level ?? 'instance',
      abstract: m.abstract,
      constructor: m.constructor,
      definition: m.definition,
      ...(m.implementation ? { implementation: m.implementation } : {}),
      ...(m.definitionIdentifier ? { definitionIdentifier: m.definitionIdentifier } : {}),
      ...(m.implementationIdentifier ? { implementationIdentifier: m.implementationIdentifier } : {}),
    });
  }

  return {
    className: resolvedClassName,
    classDefinitionBlock: classDef,
    ...(classImpl ? { classImplementationBlock: classImpl } : {}),
    methods,
    attributes,
  };
}
