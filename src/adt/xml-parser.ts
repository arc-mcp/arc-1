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
  AuthorizationFieldInfo,
  BspAppInfo,
  BspFileNode,
  ClassMetadata,
  DataElementInfo,
  DomainInfo,
  EnhancementImplementationInfo,
  FeatureToggleInfo,
  InactiveObject,
  MessageClassInfo,
  RevisionInfo,
  RevisionListResult,
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
 * Parse function group structure.
 *
 * <group name="ZGROUP" type="FUGR/F">
 *   <functionModule name="ZFUNC" type="FUNC/FM"/>
 * </group>
 */
export function parseFunctionGroup(xml: string): { name: string; functions: string[] } {
  const parsed = parseXml(xml);
  const group = (parsed.group ?? {}) as Record<string, unknown>;
  const fmods = Array.isArray(group.functionModule) ? group.functionModule : [];
  return {
    name: String(group['@_name'] ?? ''),
    functions: fmods.map((fm: Record<string, unknown>) => String(fm['@_name'] ?? '')),
  };
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
