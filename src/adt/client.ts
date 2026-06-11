/**
 * ADT Client — main facade for all SAP ADT operations.
 *
 * This is the entry point for all SAP interactions. It wires together:
 * - AdtHttpClient (HTTP transport, CSRF, cookies)
 * - SafetyConfig (operation/package/transport gating)
 * - FeatureConfig (optional feature detection)
 *
 * Every public method checks safety before making any HTTP call.
 * The client is stateless between calls (no cached object state),
 * except for CSRF token and session cookies managed by AdtHttpClient.
 *
 * Architecture: The client exposes high-level operations grouped by domain.
 * Read operations are directly on the client, while CRUD, DevTools, etc.
 * are imported from their respective modules when needed by handlers.
 * This keeps the client class manageable (not a 2,400-line God class).
 */

import type { AdtClientConfig } from './config.js';
import { defaultAdtClientConfig } from './config.js';
import { AdtApiError, AdtSafetyError, isNotFoundError } from './errors.js';
import { AdtHttpClient, type AdtHttpConfig } from './http.js';
import { AdtPackageHierarchyResolver, type PackageHierarchyResolver } from './package-hierarchy.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { Semaphore } from './semaphore.js';
import type {
  AdtObjectLookupResult,
  AdtSearchResult,
  ApiReleaseStateInfo,
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
  MessageClassInfo,
  RevisionListResult,
  SourceSearchResult,
  StructuredClassResponse,
  TransactionInfo,
} from './types.js';
import {
  parseApiReleaseState,
  parseAuthorizationField,
  parseBspAppList,
  parseBspFolderListing,
  parseClassMetadata,
  parseClassStructure,
  parseDataElementMetadata,
  parseDomainMetadata,
  parseEnhancementImplementation,
  parseFeatureToggleStates,
  parseFunctionGroup,
  parseInactiveObjects,
  parseInstalledComponents,
  parseMessageClass,
  parseRevisionFeed,
  parseSearchResults,
  parseServiceBinding,
  parseSourceSearchResults,
  parseSubpackageNodestructure,
  parseSystemInfo,
  parseTableContents,
  parseTransactionMetadata,
} from './xml-parser.js';

export interface SourceReadResult {
  source: string;
  etag?: string;
  notModified: boolean;
  statusCode: number;
}

export interface SourceReadOptions {
  ifNoneMatch?: string;
  version?: 'active' | 'inactive';
  accept?: string;
}

function appendQueryParam(path: string, key: string, value: string): string {
  const [baseAndQuery, fragment] = path.split('#', 2);
  const [base, query = ''] = (baseAndQuery ?? path).split('?', 2);
  const params = new URLSearchParams(query);
  if (!params.has(key)) params.set(key, value);
  const queryString = params.toString();
  return `${base}${queryString ? `?${queryString}` : ''}${fragment ? `#${fragment}` : ''}`;
}

/**
 * Build a navigation hint URL for a TADIR row.
 *
 * Internal mirror of the handler-side `objectBasePath()` table — kept local to
 * `client.ts` to avoid circular dependencies (the handler modules import `AdtClient`).
 * Returns `''` for types that cannot be addressed via a single base URL
 * (FUNC requires a parent group; SEGW legacy types have no ADT handler);
 * callers must treat the empty string as "no direct navigation".
 *
 * Only used by `lookupObjectsViaDb()` for synthesizing the `uri` field on
 * SQL-sourced TADIR matches so the result is still consumable by SAPRead /
 * SAPNavigate where applicable. TADIR stores bare types (e.g. `DDLS`, not
 * `DDLS/DF`); no slash-form normalization is required.
 */
function tadirObjectUrl(tadirType: string, name: string): string {
  const t = tadirType.toUpperCase();
  switch (t) {
    case 'PROG':
      return `/sap/bc/adt/programs/programs/${encodeURIComponent(name)}`;
    case 'CLAS':
      return `/sap/bc/adt/oo/classes/${encodeURIComponent(name)}`;
    case 'INTF':
      return `/sap/bc/adt/oo/interfaces/${encodeURIComponent(name)}`;
    case 'INCL':
      return `/sap/bc/adt/programs/includes/${encodeURIComponent(name)}`;
    case 'FUGR':
      return `/sap/bc/adt/functions/groups/${encodeURIComponent(name)}`;
    case 'DDLS':
      return `/sap/bc/adt/ddic/ddl/sources/${encodeURIComponent(name)}`;
    case 'DCLS':
      return `/sap/bc/adt/acm/dcl/sources/${encodeURIComponent(name)}`;
    case 'BDEF':
      return `/sap/bc/adt/bo/behaviordefinitions/${encodeURIComponent(name)}`;
    case 'SRVD':
      return `/sap/bc/adt/ddic/srvd/sources/${encodeURIComponent(name)}`;
    case 'DDLX':
      return `/sap/bc/adt/ddic/ddlx/sources/${encodeURIComponent(name)}`;
    case 'SRVB':
      return `/sap/bc/adt/businessservices/bindings/${encodeURIComponent(name)}`;
    case 'TABL':
      // Default to /tables/ — for DDIC structures, callers must reach for
      // AdtClient.resolveTablObjectUrl(name) which does the 404 fallback.
      return `/sap/bc/adt/ddic/tables/${encodeURIComponent(name)}`;
    case 'DOMA':
      return `/sap/bc/adt/ddic/domains/${encodeURIComponent(name)}`;
    case 'DTEL':
      return `/sap/bc/adt/ddic/dataelements/${encodeURIComponent(name)}`;
    case 'MSAG':
      return `/sap/bc/adt/messageclass/${encodeURIComponent(name)}`;
    case 'DEVC':
      return `/sap/bc/adt/packages/${encodeURIComponent(name)}`;
    case 'TRAN':
      return `/sap/bc/adt/vit/wb/object_type/trant/object_name/${encodeURIComponent(name)}`;
    case 'VIEW':
      return `/sap/bc/adt/vit/wb/object_type/viewdv/object_name/${encodeURIComponent(name)}`;
    case 'SKTD':
      return `/sap/bc/adt/documentation/ktd/documents/${encodeURIComponent(name.toLowerCase())}`;
    default:
      // FUNC needs a parent group (not addressable by a single base URL); legacy
      // SEGW types (IWSV, IWMO, IWPR, IWBEP) have no ADT handler. Return an
      // empty URI so callers know not to navigate; the row still surfaces.
      return '';
  }
}

// ─── TABLE_QUERY SQL builder ───────────────────────────────────────────────

/** Allowed SQL comparison operators for TABLE_QUERY where conditions. */
const ALLOWED_OPS = new Set([
  '=',
  '!=',
  '<>',
  '<',
  '<=',
  '>',
  '>=',
  'LIKE',
  'NOT LIKE',
  'IN',
  'NOT IN',
  'IS NULL',
  'IS NOT NULL',
]);

// BETWEEN is intentionally excluded: the value would require parsing "low AND high"
// where AND is a reserved word, making safe escaping complex and error-prone.
// Use two separate conditions (>= low, <= high) instead.

/**
 * Build a safe IN/NOT IN list from a comma-separated string of raw values.
 * Each value is trimmed, single-quote-escaped, and wrapped in quotes.
 * Surrounding parentheses are accepted for caller convenience but stripped.
 * Subquery injection is impossible because every element becomes a string literal.
 */
function buildInList(raw: string): string {
  const trimmed = raw.trim();
  const inner = trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1) : trimmed;
  const parts = inner.split(',').map((p) => {
    const escaped = p.trim().replace(/'/g, "''");
    return `'${escaped}'`;
  });
  return `(${parts.join(', ')})`;
}

/** Upper bound on rows returned by a single TABLE_QUERY — a memory-safety rail (the whole
 *  result set is buffered in `parseTableContents`), not a SAP-side limit. Page client-side
 *  for more. Generous on purpose; adjust if a real use case needs it. */
const MAX_TABLE_QUERY_ROWS = 10_000;

/** Coerce a caller-supplied row limit into a safe positive integer in [1, MAX_TABLE_QUERY_ROWS].
 *  NaN / non-finite / non-positive / undefined fall back to the default (prevents `rowNumber=NaN`
 *  and unbounded result buffering). */
export function clampPreviewRows(requested: number | undefined, fallback = 100): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) return fallback;
  return Math.min(Math.floor(requested), MAX_TABLE_QUERY_ROWS);
}

const MAX_SEARCH_RESULTS = 1_000;

/** Coerce a caller-supplied search-result limit into a safe positive integer in
 *  [1, MAX_SEARCH_RESULTS]. NaN / non-finite / non-positive / undefined fall back to the
 *  caller's default — prevents an unbounded `maxResults` from buffering a huge result set
 *  on the shared event loop. */
export function clampSearchResults(requested: number | undefined, fallback: number): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) return fallback;
  return Math.min(Math.floor(requested), MAX_SEARCH_RESULTS);
}

/** Sanitize a SQL identifier (table / column / field): uppercase, then strip everything but
 *  word characters and the namespace slash. Throws when nothing survives — a structurally
 *  invalid identifier must fail closed rather than emit malformed SQL (e.g. `SELECT , X FROM`).
 *  Stripping spaces is also what blocks keyword injection (UNION/JOIN/OR collapse to one token). */
function sanitizeIdentifier(raw: string, kind: 'table' | 'column' | 'field'): string {
  const safe = raw.toUpperCase().replace(/[^\w/]/g, '');
  if (!safe) throw new Error(`TABLE_QUERY: ${kind} name "${raw}" is invalid (empty after sanitization)`);
  return safe;
}

/**
 * Build a safe SELECT statement from structured parameters.
 * All identifiers are uppercased, stripped to word-chars + namespace slash, and rejected if empty.
 * String values are single-quote escaped (doubled single quotes).
 * IN/NOT IN values are strictly parsed as quoted literal lists (no subqueries).
 * Raises if the table, any column, or any where-field is empty after sanitization.
 * ORDER BY is intentionally omitted: the ADT freestyle endpoint rejects it on NW 7.50/7.51.
 */
export function buildTableQuerySql(
  tableName: string,
  columns?: string[],
  where?: Array<{ field: string; op: string; value?: string }>,
): string {
  const safeTable = sanitizeIdentifier(tableName, 'table');

  const colList = columns && columns.length > 0 ? columns.map((c) => sanitizeIdentifier(c, 'column')).join(', ') : '*';

  let sql = `SELECT ${colList} FROM ${safeTable}`;

  if (where && where.length > 0) {
    const clauses = where.map(({ field, op, value }) => {
      const safeField = sanitizeIdentifier(field, 'field');
      const safeOp = op.trim().toUpperCase();
      if (!ALLOWED_OPS.has(safeOp)) throw new Error(`TABLE_QUERY: operator "${op}" is not allowed`);

      if (safeOp === 'IS NULL' || safeOp === 'IS NOT NULL') return `${safeField} ${safeOp}`;

      if (safeOp === 'IN' || safeOp === 'NOT IN') {
        // Each element is individually escaped — subquery injection impossible.
        const safeList = buildInList(String(value ?? ''));
        return `${safeField} ${safeOp} ${safeList}`;
      }

      const escaped = String(value ?? '').replace(/'/g, "''");
      return `${safeField} ${safeOp} '${escaped}'`;
    });
    sql += ` WHERE ${clauses.join(' AND ')}`;
  }

  // ORDER BY intentionally omitted: the ADT freestyle SQL endpoint rejects it on
  // NW 7.50/7.51 (parser error: '"DESC" is not allowed here'). Sort client-side if needed.

  return sql;
}

export class AdtClient {
  readonly http: AdtHttpClient;
  readonly safety: SafetyConfig;
  /** The configured SAP username (from --user / SAP_USER) */
  readonly username: string;
  /** Per-client cache of resolved TABL URLs for **reads** (transparent table at
   *  /tables/, structure at /structures/). Populated by getTabl() via the
   *  /tables/→/structures/ 404 fallback. */
  private readonly tablUrlCache = new Map<string, string>();
  /** Per-client cache of resolved TABL URLs for **writes / activates / deletes**.
   *  Populated by `resolveTablObjectUrlForWrite()` after asking SAP for the
   *  actual `adtcore:type` (TABL/DT vs TABL/DS). Separate from `tablUrlCache`
   *  so the two contracts don't contaminate each other. See issue #285. */
  private readonly tablWriteUrlCache = new Map<string, string>();
  /** Lazily-instantiated DEVCLASS hierarchy resolver — only built when a subtree
   *  allowedPackages rule is hit. Shared across `withSafety()` clones because the
   *  hierarchy is a property of the SAP system, not of the current safety scope. */
  private packageHierarchyResolverHolder: { resolver: PackageHierarchyResolver | null } = { resolver: null };

  constructor(options: Partial<AdtClientConfig> = {}) {
    const config = { ...defaultAdtClientConfig(), ...options };
    this.safety = config.safety;
    this.username = config.username;

    const httpConfig: AdtHttpConfig = {
      baseUrl: config.baseUrl,
      username: config.username,
      password: config.password,
      client: config.client,
      language: config.language,
      insecure: config.insecure,
      cookies: config.cookies,
      cookieFile: config.cookieFile,
      cookieString: config.cookieString,
      btpProxy: config.btpProxy,
      sapConnectivityAuth: config.sapConnectivityAuth,
      ppProxyAuth: config.ppProxyAuth,
      bearerTokenProvider: config.bearerTokenProvider,
      disableSaml: config.disableSaml,
      // Prefer the shared server-wide semaphore when provided so all per-user PP clients
      // share one cap. Fall back to a private semaphore for stdio/tests when only maxConcurrent
      // is set. When neither is set, no concurrency cap applies.
      semaphore: config.adtSemaphore ?? (config.maxConcurrent ? new Semaphore(config.maxConcurrent) : undefined),
    };

    this.http = new AdtHttpClient(httpConfig);
  }

  /**
   * Create a lightweight copy of this client with a different safety config.
   * Shares the same HTTP client (connection, CSRF, cookies) — only safety changes.
   * Used for per-request safety derived from JWT scopes.
   */
  withSafety(safety: SafetyConfig): AdtClient {
    const clone = Object.create(AdtClient.prototype) as AdtClient;
    // INVARIANT: Object.create() bypasses the constructor, so EVERY instance field
    // must be re-attached below by hand. Adding a field to AdtClient without adding
    // it here leaves it `undefined` on the clone — see issue #333, where a missing
    // `tablWriteUrlCache` crashed TABL writes/activates on authenticated HTTP paths.
    Object.defineProperty(clone, 'http', { value: this.http, writable: false, enumerable: true });
    Object.defineProperty(clone, 'safety', { value: safety, writable: false, enumerable: true });
    Object.defineProperty(clone, 'username', { value: this.username, writable: false, enumerable: true });
    // Share the TABL URL resolution caches (read-path + write-path) — they're purely
    // about object addressing (TABL/DT vs TABL/DS), independent of per-request safety
    // scope, so resolutions cached on the original (or a sibling clone) stay visible.
    Object.defineProperty(clone, 'tablUrlCache', { value: this.tablUrlCache, writable: false, enumerable: false });
    Object.defineProperty(clone, 'tablWriteUrlCache', {
      value: this.tablWriteUrlCache,
      writable: false,
      enumerable: false,
    });
    // Share the package-hierarchy resolver holder so cached subtrees survive
    // per-request safety derivation. Wrapping in a holder lets the clone see
    // lazy instantiations performed on the original (or another clone).
    Object.defineProperty(clone, 'packageHierarchyResolverHolder', {
      value: this.packageHierarchyResolverHolder,
      writable: false,
      enumerable: false,
    });
    return clone;
  }

  /**
   * Lazily build (and return) the DEVCLASS hierarchy resolver. The resolver
   * powers `ZFOO/**` subtree rules in `allowedPackages`; reads/writes that
   * don't trigger a subtree rule never instantiate it (zero cost).
   *
   * Shared across `withSafety()` clones — the hierarchy is per-SAP-system, not
   * per-safety-scope. Cache invalidation is exposed via `invalidatePackageHierarchy()`.
   */
  getPackageHierarchyResolver(): PackageHierarchyResolver {
    if (!this.packageHierarchyResolverHolder.resolver) {
      this.packageHierarchyResolverHolder.resolver = new AdtPackageHierarchyResolver((root) =>
        this.getSubpackages(root),
      );
    }
    return this.packageHierarchyResolverHolder.resolver;
  }

  /** Invalidate the resolver cache. Called after admin actions that change the
   *  hierarchy (create_package / change_package / delete_package). */
  invalidatePackageHierarchy(root?: string): void {
    this.packageHierarchyResolverHolder.resolver?.invalidate(root);
  }

  // ─── Source Code Read Operations ──────────────────────────────────

  private async fetchSource(path: string, opts: SourceReadOptions = {}): Promise<SourceReadResult> {
    const url = opts.version ? appendQueryParam(path, 'version', opts.version) : path;
    const headers: Record<string, string> = {};
    if (opts.accept) headers.Accept = opts.accept;
    if (opts.ifNoneMatch) headers['If-None-Match'] = opts.ifNoneMatch;
    const resp = await this.http.get(url, Object.keys(headers).length > 0 ? headers : undefined);
    return {
      source: resp.body,
      etag: resp.headers.etag ?? undefined,
      notModified: resp.statusCode === 304,
      statusCode: resp.statusCode,
    };
  }

  /** Get program source code */
  async getProgram(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetProgram');
    return this.fetchSource(`/sap/bc/adt/programs/programs/${encodeURIComponent(name)}/source/main`, opts);
  }

  /** Get class source code (main include by default) */
  async getClass(name: string, include?: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetClass');
    const encodedName = encodeURIComponent(name);

    if (!include) {
      // Default: return full combined class source
      return this.fetchSource(`/sap/bc/adt/oo/classes/${encodedName}/source/main`, opts);
    }

    const validIncludes = new Set(['main', 'definitions', 'implementations', 'macros', 'testclasses']);
    const includes = include
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const parts: string[] = [];
    for (const inc of includes) {
      if (!validIncludes.has(inc)) {
        parts.push(
          `=== ${inc} ===\n[Unknown include "${inc}". Valid: main, definitions, implementations, macros, testclasses]`,
        );
        continue;
      }

      // "main" uses /source/main; others use /includes/{type}
      const path =
        inc === 'main'
          ? `/sap/bc/adt/oo/classes/${encodedName}/source/main`
          : `/sap/bc/adt/oo/classes/${encodedName}/includes/${inc}`;

      try {
        const result = await this.fetchSource(path, opts);
        parts.push(`=== ${inc} ===\n${result.source}`);
      } catch (err) {
        if (isNotFoundError(err)) {
          parts.push(
            `=== ${inc} ===\n[Include "${inc}" is not available for this class. Try reading without the include parameter to get the full source.]`,
          );
        } else {
          throw err; // Re-throw non-404 errors
        }
      }
    }
    return { source: parts.join('\n\n'), notModified: false, statusCode: 200 };
  }

  /**
   * Get the RAW source of a single class include (no `=== inc ===` wrapper that
   * `getClass(name, include)` adds), so line numbers stay accurate for grep.
   */
  async getClassInclude(name: string, include: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetClassInclude');
    return this.fetchSource(
      `/sap/bc/adt/oo/classes/${encodeURIComponent(name)}/includes/${encodeURIComponent(include)}`,
      opts,
    );
  }

  /** Get class metadata (description, language, category, etc.) from the object endpoint */
  async getClassMetadata(name: string): Promise<ClassMetadata> {
    checkOperation(this.safety, OperationType.Read, 'GetClassMetadata');
    const resp = await this.http.get(`/sap/bc/adt/oo/classes/${encodeURIComponent(name)}`);
    return parseClassMetadata(resp.body);
  }

  /** Get structured class response with metadata + decomposed includes */
  async getClassStructured(name: string): Promise<StructuredClassResponse> {
    checkOperation(this.safety, OperationType.Read, 'GetClassStructured');
    const encodedName = encodeURIComponent(name);

    const fetchInclude = async (include: string): Promise<string | null> => {
      try {
        const resp = await this.http.get(`/sap/bc/adt/oo/classes/${encodedName}/includes/${include}`, undefined, {
          suppressNotFoundLog: true,
        });
        return resp.body;
      } catch (err) {
        if (isNotFoundError(err)) return null;
        throw err;
      }
    };

    const [metadata, mainResp, testclasses, definitions, implementations, macros] = await Promise.all([
      this.getClassMetadata(name),
      this.http.get(`/sap/bc/adt/oo/classes/${encodedName}/source/main`),
      fetchInclude('testclasses'),
      fetchInclude('definitions'),
      fetchInclude('implementations'),
      fetchInclude('macros'),
    ]);

    return {
      metadata,
      main: mainResp.body,
      testclasses,
      definitions,
      implementations,
      macros,
    };
  }

  /**
   * Get the class structure map (line ranges for DEFINITION / IMPLEMENTATION
   * blocks, per-method/attribute ranges) from `/sap/bc/adt/oo/classes/{name}/objectstructure`.
   *
   * The endpoint is read-only — the response carries `#start=L,C;end=L,C`
   * coordinates that `class-section surgery` actions (`edit_class_definition`,
   * `add_method`, `edit_method_signature`, `delete_method`) use to splice into
   * `/source/main` without re-sending the full class. Issue #303.
   *
   * Cross-release: works on both NW 7.50 SP02 (split CLAS/OO + CLAS/OM elements
   * merged by name) and S/4HANA 2023 kernel 7.58+ (single CLAS/OM per method).
   * MIME negotiation is delegated to the discovery cache in http.ts — v1+xml on
   * 7.50, v2+xml on 7.58+.
   */
  async getClassStructure(name: string, version: 'active' | 'inactive' = 'active'): Promise<ClassStructure> {
    checkOperation(this.safety, OperationType.Read, 'GetClassStructure');
    // version=inactive returns the draft's structure (verified live on a4h: a class
    // with an unactivated draft reports the draft's method set + line ranges under
    // ?version=inactive, the active set under ?version=active). Threading the same
    // version here as the /source/main read keeps the spliced line ranges aligned
    // with the bytes being edited — critical for chained surgery on a draft.
    const suffix = version === 'inactive' ? '?version=inactive' : '';
    const resp = await this.http.get(`/sap/bc/adt/oo/classes/${encodeURIComponent(name)}/objectstructure${suffix}`);
    return parseClassStructure(resp.body, name.toUpperCase());
  }

  /** Get interface source code */
  async getInterface(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetInterface');
    return this.fetchSource(`/sap/bc/adt/oo/interfaces/${encodeURIComponent(name)}/source/main`, opts);
  }

  /** Get function module source code */
  async getFunction(group: string, name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetFunction');
    return this.fetchSource(
      `/sap/bc/adt/functions/groups/${encodeURIComponent(group)}/fmodules/${encodeURIComponent(name)}/source/main`,
      opts,
    );
  }

  /** Resolve function group for a function module via quickSearch */
  async resolveFunctionGroup(fmName: string): Promise<string | null> {
    const results = await this.searchObject(fmName, 10);
    for (const r of results) {
      if (r.objectName.toUpperCase() === fmName.toUpperCase() && r.uri.includes('/groups/')) {
        const match = r.uri.match(/\/groups\/([^/]+)\//);
        if (match) return match[1]!.toUpperCase();
      }
    }
    return null;
  }

  /** Get function group structure (list of function modules + includes) */
  async getFunctionGroup(name: string): Promise<{ name: string; functions: string[]; includes: string[] }> {
    checkOperation(this.safety, OperationType.Read, 'GetFunctionGroup');
    // The function-module list lives in the objectstructure resource, NOT the plain
    // /functions/groups/<name> resource (which returns only metadata + atom links).
    const resp = await this.http.get(`/sap/bc/adt/functions/groups/${encodeURIComponent(name)}/objectstructure`, {
      Accept: 'application/vnd.sap.adt.objectstructure.v2+xml',
    });
    return parseFunctionGroup(resp.body);
  }

  /** Get function group source code */
  async getFunctionGroupSource(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetFunctionGroupSource');
    return this.fetchSource(`/sap/bc/adt/functions/groups/${encodeURIComponent(name)}/source/main`, opts);
  }

  /** Get include source code */
  async getInclude(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetInclude');
    return this.fetchSource(`/sap/bc/adt/programs/includes/${encodeURIComponent(name)}/source/main`, opts);
  }

  /**
   * Expand a function group into its full source tree: the main include plus every
   * nested INCLUDE, fetched **recursively**.
   *
   * The main FUGR source only references the TOP + UXX includes directly; the actual
   * `FUNCTION … ENDFUNCTION` bodies live in nested `LZ<group>U01/U02…` includes pulled
   * in from UXX, and PBO/PAI screen modules in `…O…/…I…` includes. A one-level expansion
   * (the old SAPRead `expand_includes` behaviour) therefore misses the real code — this
   * BFS follows the include graph to capture it.
   *
   * Bounded for safety: a `seen` set (cycle + dedup guard), a depth cap, and a total-block
   * cap so a pathological include graph can't blow up the response. Comment-only INCLUDE
   * lines (leading `*`) are skipped. Each block that fails to read carries a placeholder.
   * `truncated` is true if the block cap was hit.
   *
   * Note: dynpros (screens) and GUI status (CUA) are NOT included — ADT does not expose
   * those over REST (they are SAPGUI/SE51/SE41-only; the endpoints return 404). This
   * captures the function group's ABAP code/flow logic, not its screen flow.
   */
  async getFunctionGroupExpanded(
    name: string,
    opts?: SourceReadOptions,
  ): Promise<{ blocks: Array<{ name: string; source: string }>; truncated: boolean }> {
    checkOperation(this.safety, OperationType.Read, 'GetFunctionGroupExpanded');
    const MAX_BLOCKS = 80;
    const MAX_DEPTH = 5;
    const seen = new Set<string>();
    const blocks: Array<{ name: string; source: string }> = [];
    let truncated = false;

    const { source: mainSource } = await this.getFunctionGroupSource(name, opts);
    blocks.push({ name: `FUGR ${name} (main)`, source: mainSource });

    // Match INCLUDE statements but skip ABAP comment lines (leading `*` after optional
    // whitespace). Non-greedy name capture stops at the trailing `.`.
    const findIncludes = (src: string): string[] => {
      const re = /^[^*\n]*\bINCLUDE\s+(\S+?)\s*\./gim;
      const out: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) out.push(m[1]!);
      return out;
    };

    let frontier: Array<{ src: string; depth: number }> = [{ src: mainSource, depth: 0 }];
    while (frontier.length > 0 && !truncated) {
      const next: Array<{ src: string; depth: number }> = [];
      for (const { src, depth } of frontier) {
        if (depth >= MAX_DEPTH) continue;
        for (const incRaw of findIncludes(src)) {
          const key = incRaw.toLowerCase();
          if (seen.has(key)) continue;
          if (blocks.length >= MAX_BLOCKS) {
            truncated = true;
            break;
          }
          seen.add(key);
          try {
            const { source: incSource } = await this.getInclude(incRaw, opts);
            blocks.push({ name: incRaw, source: incSource });
            next.push({ src: incSource, depth: depth + 1 });
          } catch {
            blocks.push({ name: incRaw, source: `[Could not read include "${incRaw}"]` });
          }
        }
        if (truncated) break;
      }
      frontier = next;
    }
    return { blocks, truncated };
  }

  /** Get CDS view source code (DDLS) */
  async getDdls(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetDDLS');
    return this.fetchSource(`/sap/bc/adt/ddic/ddl/sources/${encodeURIComponent(name)}/source/main`, opts);
  }

  /** Get CDS access control source code (DCLS) */
  async getDcl(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetDCL');
    return this.fetchSource(`/sap/bc/adt/acm/dcl/sources/${encodeURIComponent(name)}/source/main`, opts);
  }

  /** Get behavior definition source code (BDEF) */
  async getBdef(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetBDEF');
    return this.fetchSource(`/sap/bc/adt/bo/behaviordefinitions/${encodeURIComponent(name)}/source/main`, opts);
  }

  /** Get service definition source code (SRVD) */
  async getSrvd(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetSRVD');
    return this.fetchSource(`/sap/bc/adt/ddic/srvd/sources/${encodeURIComponent(name)}/source/main`, opts);
  }

  /** Get Knowledge Transfer Document (SKTD) — Markdown documentation attached to an ABAP object. */
  async getKtd(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetKTD');
    // Eclipse ADT lowercases the name in the URL path; server-side matching is case-sensitive here.
    return this.fetchSource(`/sap/bc/adt/documentation/ktd/documents/${encodeURIComponent(name.toLowerCase())}`, {
      ...opts,
      accept: opts?.accept ?? 'application/vnd.sap.adt.sktdv2+xml',
    });
  }

  /** Get metadata extension source code (DDLX) */
  async getDdlx(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetDDLX');
    return this.fetchSource(`/sap/bc/adt/ddic/ddlx/sources/${encodeURIComponent(name)}/source/main`, opts);
  }

  /** Get service binding metadata (SRVB) — returns structured XML, not source text */
  async getSrvb(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetSRVB');
    const result = await this.fetchSource(`/sap/bc/adt/businessservices/bindings/${encodeURIComponent(name)}`, {
      ...opts,
      accept: opts?.accept ?? 'application/vnd.sap.adt.businessservices.servicebinding.v2+xml',
    });
    return result.notModified ? result : { ...result, source: parseServiceBinding(result.source) };
  }

  /** Get table definition source code */
  async getTable(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetTable');
    return this.fetchSource(`/sap/bc/adt/ddic/tables/${encodeURIComponent(name)}/source/main`, opts);
  }

  /**
   * Read DDIC view metadata.
   *
   * Classic DDIC views are exposed via ADT's VIT generic-object endpoint, NOT
   * `/sap/bc/adt/ddic/views/`. Live verification 2026-05-08 against a4h
   * S/4HANA 2023 + npl NW 7.50: `/ddic/views/V_USR_NAME` returns HTTP 500;
   * `/ddic/views/V_USR_NAME/source/main` returns HTTP 404. Only the VIT URL
   * `/sap/bc/adt/vit/wb/object_type/viewdv/object_name/{name}` returns 200.
   * Note: VIEW does NOT expose a `/source/main` sub-resource — the response
   * body is the metadata XML (root element `adtcore:mainObject` with view
   * attributes). Returning that XML as `source` is consistent with the
   * SourceReadResult contract; structured parsing is out of scope here.
   *
   * See research/abap-types/types/view.md and PR #222 follow-up.
   */
  async getView(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetView');
    return this.fetchSource(`/sap/bc/adt/vit/wb/object_type/viewdv/object_name/${encodeURIComponent(name)}`, opts);
  }

  /** Get structure definition source code (CDS-like format) */
  async getStructure(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetStructure');
    return this.fetchSource(`/sap/bc/adt/ddic/structures/${encodeURIComponent(name)}/source/main`, opts);
  }

  /** Read TABL source — covers both transparent tables and DDIC structures.
   *  TADIR groups them under R3TR TABL, distinguished only by DD02L-TABCLASS
   *  (TRANSP/CLUSTER/POOL → /tables/, INTTAB/APPEND → /structures/).
   *  Tries /tables/ first, falls back to /structures/ on 404. Caches the resolved
   *  URL on the client for subsequent write/activate operations. */
  async getTabl(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetTabl');
    const upper = name.toUpperCase();
    try {
      const result = await this.getTable(name, opts);
      this.tablUrlCache.set(upper, `/sap/bc/adt/ddic/tables/${encodeURIComponent(name)}`);
      return result;
    } catch (err) {
      if (err instanceof AdtApiError && err.statusCode === 404) {
        const result = await this.getStructure(name, opts);
        this.tablUrlCache.set(upper, `/sap/bc/adt/ddic/structures/${encodeURIComponent(name)}`);
        return result;
      }
      throw err;
    }
  }

  /** Resolve the canonical ADT URL for a TABL name (transparent table or structure)
   *  for the **read** path. Probes /tables/ first and falls back to /structures/ on
   *  404. The source body is identical either way, so the fallback is safe for reads.
   *  Result is cached per client.
   *
   *  Do NOT use this for writes/activates — on NW 7.50 the /tables/ endpoint is
   *  absent entirely, so transparent tables (TABL/DT) fall through to /structures/
   *  and a PUT there silently sets DD02L-TABCLASS=INTTAB (corruption). Use
   *  `resolveTablObjectUrlForWrite()` instead. See issue #285. */
  async resolveTablObjectUrl(name: string): Promise<string> {
    const upper = name.toUpperCase();
    const cached = this.tablUrlCache.get(upper);
    if (cached) return cached;
    const tableUrl = `/sap/bc/adt/ddic/tables/${encodeURIComponent(name)}`;
    const structUrl = `/sap/bc/adt/ddic/structures/${encodeURIComponent(name)}`;
    try {
      await this.http.get(tableUrl);
      this.tablUrlCache.set(upper, tableUrl);
      return tableUrl;
    } catch (err) {
      if (err instanceof AdtApiError && err.statusCode === 404) {
        await this.http.get(structUrl);
        this.tablUrlCache.set(upper, structUrl);
        return structUrl;
      }
      throw err;
    }
  }

  /** Resolve the canonical ADT URL for a TABL name on the **write/activate/delete**
   *  path. Unlike `resolveTablObjectUrl()`, this never falls back blindly to
   *  /structures/ — it asks SAP what the object actually is (via repository search)
   *  and refuses transparent-table writes on systems where /sap/bc/adt/ddic/tables/
   *  is absent (NW 7.50 ships /ddic/structures/ only; the table editor was added
   *  in NW 7.52). Returning /structures/ for a TABL/DT object would let a PUT
   *  silently flip DD02L-TABCLASS to INTTAB on the inactive draft (issue #285).
   *
   *  Resolution order:
   *    1. Search returns `TABL/DT` → require /tables/ availability, return /tables/<n>
   *       or throw AdtSafetyError with SE11 hint.
   *    2. Search returns `TABL/DS` → return /structures/<n> (always allowed).
   *    3. Search returns nothing (or a different type) → fall through to the
   *       read-path resolver. The caller is creating something new or the object
   *       was just renamed; subsequent ADT calls will surface the real error.
   *
   *  Caches separately from the read resolver so the two contracts don't
   *  contaminate each other. */
  async resolveTablObjectUrlForWrite(
    name: string,
    options: { tablesEndpointAvailable?: boolean } = {},
  ): Promise<string> {
    const upper = name.toUpperCase();
    const cached = this.tablWriteUrlCache.get(upper);
    if (cached) {
      // Defense-in-depth: a cached /tables/ URL must still respect the current
      // discovery state. The cache stores resolutions, but the availability of
      // /sap/bc/adt/ddic/tables/ is a per-system property — if it ever resolves
      // to "missing", the cached entry must not silently bypass the guard.
      if (cached.startsWith('/sap/bc/adt/ddic/tables/') && options.tablesEndpointAvailable === false) {
        throw new AdtSafetyError(
          `Transparent table writes via ADT REST are not available on this system ` +
            `(/sap/bc/adt/ddic/tables/ is not exposed — NW 7.50/7.51 ship the DDIC ` +
            `structures endpoint only; the table editor was added in NW 7.52). ` +
            `Use SE11 in SAPGUI to modify transparent table "${name}", or connect ` +
            `ARC-1 to an SAP_BASIS ≥ 7.52 system. Writing to /sap/bc/adt/ddic/structures/ ` +
            `would silently flip DD02L-TABCLASS to INTTAB and corrupt the table.`,
        );
      }
      return cached;
    }

    let actualType: string | undefined;
    try {
      const results = await this.searchObject(name, 5);
      // NPL 7.50 appends a localized suffix to adtcore:name ("T000 (Database Table)",
      // "BAPIRET2 (Structure)"), so strip parenthesized text before matching. A4H
      // and modern releases return just the bare name; both forms must work.
      const match = results.find((r) => {
        const bare = String(r.objectName ?? '')
          .replace(/\s*\(.*$/, '')
          .toUpperCase();
        return bare === upper;
      });
      actualType = match?.objectType;
    } catch {
      // Search failure should not block writes — fall through to the read-path
      // resolver. If the user lacks search authorization the write will still
      // surface its own error downstream.
    }

    const tableUrl = `/sap/bc/adt/ddic/tables/${encodeURIComponent(name)}`;
    const structUrl = `/sap/bc/adt/ddic/structures/${encodeURIComponent(name)}`;

    if (actualType === 'TABL/DT') {
      if (options.tablesEndpointAvailable === false) {
        throw new AdtSafetyError(
          `Transparent table writes via ADT REST are not available on this system ` +
            `(/sap/bc/adt/ddic/tables/ is not exposed — NW 7.50/7.51 ship the DDIC ` +
            `structures endpoint only; the table editor was added in NW 7.52). ` +
            `Use SE11 in SAPGUI to modify transparent table "${name}", or connect ` +
            `ARC-1 to an SAP_BASIS ≥ 7.52 system. Writing to /sap/bc/adt/ddic/structures/ ` +
            `would silently flip DD02L-TABCLASS to INTTAB and corrupt the table.`,
        );
      }
      this.tablWriteUrlCache.set(upper, tableUrl);
      return tableUrl;
    }
    if (actualType === 'TABL/DS') {
      this.tablWriteUrlCache.set(upper, structUrl);
      return structUrl;
    }

    // Unknown / not-yet-existing object — fall back to the read-path resolver.
    // For create paths the caller has already checked tablesEndpointAvailable
    // separately (no existing object to search for).
    return this.resolveTablObjectUrl(name);
  }

  /** Get domain metadata (type, length, value table, fixed values) */
  async getDomain(name: string): Promise<DomainInfo> {
    checkOperation(this.safety, OperationType.Read, 'GetDomain');
    const resp = await this.http.get(`/sap/bc/adt/ddic/domains/${encodeURIComponent(name)}`);
    return parseDomainMetadata(resp.body);
  }

  /** Get data element metadata (domain, labels, search help) */
  async getDataElement(name: string): Promise<DataElementInfo> {
    checkOperation(this.safety, OperationType.Read, 'GetDataElement');
    const resp = await this.http.get(`/sap/bc/adt/ddic/dataelements/${encodeURIComponent(name)}`);
    return parseDataElementMetadata(resp.body);
  }

  // ─── Authorization & Switch Framework ───────────────────────────

  /** Get authorization field metadata (role, check table, domain, org-level flags) */
  async getAuthorizationField(name: string): Promise<AuthorizationFieldInfo> {
    checkOperation(this.safety, OperationType.Read, 'GetAuthorizationField');
    const resp = await this.http.get(`/sap/bc/adt/aps/iam/auth/${encodeURIComponent(name)}`, {
      Accept: 'application/vnd.sap.adt.blues.v1+xml',
    });
    return parseAuthorizationField(resp.body);
  }

  // ─── Source Revision / Version History ──────────────────────────

  private revisionsUrlFor(type: string, name: string, opts: { include?: string; group?: string }): string {
    const normalizedType = String(type).trim().toUpperCase();
    const encodedName = encodeURIComponent(name);
    const include =
      String(opts.include ?? 'main')
        .trim()
        .toLowerCase() || 'main';

    switch (normalizedType) {
      case 'PROG':
        return `/sap/bc/adt/programs/programs/${encodedName}/source/main/versions`;
      case 'CLAS': {
        const validIncludes = new Set(['main', 'definitions', 'implementations', 'macros', 'testclasses']);
        if (!validIncludes.has(include)) {
          throw new Error(
            `Invalid include "${opts.include ?? ''}" for CLAS revisions. Valid values: main, definitions, implementations, macros, testclasses.`,
          );
        }
        return `/sap/bc/adt/oo/classes/${encodedName}/includes/${include}/versions`;
      }
      case 'INTF':
        return `/sap/bc/adt/oo/interfaces/${encodedName}/source/main/versions`;
      case 'FUNC': {
        const group = String(opts.group ?? '').trim();
        if (!group) {
          throw new Error(`Function group is required for FUNC revisions of "${name}".`);
        }
        return `/sap/bc/adt/functions/groups/${encodeURIComponent(group)}/fmodules/${encodedName}/source/main/versions`;
      }
      case 'INCL':
        return `/sap/bc/adt/programs/includes/${encodedName}/source/main/versions`;
      case 'DDLS':
        return `/sap/bc/adt/ddic/ddl/sources/${encodedName}/source/main/versions`;
      case 'DCLS':
        return `/sap/bc/adt/acm/dcl/sources/${encodedName}/source/main/versions`;
      case 'BDEF':
        return `/sap/bc/adt/bo/behaviordefinitions/${encodedName}/source/main/versions`;
      case 'SRVD':
        return `/sap/bc/adt/ddic/srvd/sources/${encodedName}/source/main/versions`;
      default:
        throw new Error(`Unsupported object type "${type}" for revisions.`);
    }
  }

  /** List available source revisions for an ABAP object. */
  async getRevisions(
    type: string,
    name: string,
    opts: { include?: string; group?: string } = {},
  ): Promise<RevisionListResult> {
    checkOperation(this.safety, OperationType.Read, 'GetRevisions');
    const url = this.revisionsUrlFor(type, name, opts);
    const resp = await this.http.get(url, { Accept: 'application/atom+xml;type=feed' });
    return parseRevisionFeed(resp.body);
  }

  /** Read source content for a specific revision URI from the revisions feed. */
  async getRevisionSource(versionUri: string): Promise<string> {
    checkOperation(this.safety, OperationType.Read, 'GetRevisionSource');
    if (!versionUri.startsWith('/sap/bc/adt/')) {
      throw new Error('versionUri must be an ADT path starting with /sap/bc/adt/');
    }
    const resp = await this.http.get(versionUri, { Accept: 'text/plain' });
    return resp.body;
  }

  /** Get feature toggle states from switch framework */
  async getFeatureToggle(name: string): Promise<FeatureToggleInfo> {
    checkOperation(this.safety, OperationType.Read, 'GetFeatureToggle');
    const resp = await this.http.get(`/sap/bc/adt/sfw/featuretoggles/${encodeURIComponent(name)}/states`, {
      Accept: 'application/vnd.sap.adt.states.v1+asjson',
    });
    return parseFeatureToggleStates(resp.body, name);
  }

  /** Get enhancement implementation metadata (technology, referenced object, BAdI implementations) */
  async getEnhancementImplementation(name: string): Promise<EnhancementImplementationInfo> {
    checkOperation(this.safety, OperationType.Read, 'GetEnhancementImplementation');
    const resp = await this.http.get(`/sap/bc/adt/enhancements/enhoxhb/${encodeURIComponent(name)}`, {
      Accept: 'application/vnd.sap.adt.enh.enhoxhb.v4+xml',
    });
    return parseEnhancementImplementation(resp.body);
  }

  /** Get transaction code metadata (description, package) */
  async getTransaction(name: string): Promise<TransactionInfo> {
    checkOperation(this.safety, OperationType.Read, 'GetTransaction');
    const resp = await this.http.get(`/sap/bc/adt/vit/wb/object_type/trant/object_name/${encodeURIComponent(name)}`);
    return parseTransactionMetadata(resp.body);
  }

  /** Get API release state for an object (clean core / ABAP Cloud compliance) */
  async getApiReleaseState(objectUri: string): Promise<ApiReleaseStateInfo> {
    checkOperation(this.safety, OperationType.Read, 'GetApiReleaseState');
    const resp = await this.http.get(`/sap/bc/adt/apireleases/${encodeURIComponent(objectUri)}`, {
      Accept: 'application/vnd.sap.adt.apirelease.v10+xml',
    });
    return parseApiReleaseState(resp.body);
  }

  /** List objects pending activation (inactive objects).
   *  Endpoint is `/sap/bc/adt/activation/inactiveobjects` on every supported SAP release
   *  (verified live on S/4HANA 2023 and NW 7.50 SP02).
   *  The vendor MIME `application/vnd.sap.adt.inactivectsobjects.v1+xml` returns the rich
   *  `<ioc:object>` shape (with user/deleted/transport/parentTransport metadata); the
   *  `application/xml;q=0.5` fallback covers any release that ignores the vendor type. */
  async getInactiveObjects(): Promise<InactiveObject[]> {
    checkOperation(this.safety, OperationType.Read, 'GetInactiveObjects');
    const resp = await this.http.get('/sap/bc/adt/activation/inactiveobjects', {
      Accept: 'application/vnd.sap.adt.inactivectsobjects.v1+xml, application/xml;q=0.5',
    });
    return parseInactiveObjects(resp.body);
  }

  // ─── Search Operations ─────────────────────────────────────────────

  /** Search for ABAP objects by name pattern */
  async searchObject(query: string, maxResults = 100): Promise<AdtSearchResult[]> {
    checkOperation(this.safety, OperationType.Search, 'SearchObject');
    const limit = clampSearchResults(maxResults, 100);
    const resp = await this.http.get(
      `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=${encodeURIComponent(query)}&maxResults=${limit}`,
    );
    return parseSearchResults(resp.body);
  }

  /**
   * Exact object-directory lookup for one or more names.
   *
   * Uses ADT repository quick search instead of freestyle SQL against TADIR. This
   * keeps the lookup available in read/search-only configurations and avoids ADT
   * SQL parser limits on long IN-lists.
   */
  async lookupObjects(
    names: string[],
    options: { maxResults?: number; objectTypes?: string[] } = {},
  ): Promise<AdtObjectLookupResult[]> {
    checkOperation(this.safety, OperationType.Search, 'LookupObjects');

    const cleanedNames = [
      ...new Set(
        names
          .map((n) => n.trim())
          .filter(Boolean)
          .map((n) => n.toUpperCase()),
      ),
    ];
    const objectTypes = [
      ...new Set(
        (options.objectTypes ?? [])
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => t.toUpperCase()),
      ),
    ];
    const limit = Math.max(1, Math.min(options.maxResults ?? 100, 1000));

    const searchOnce = async (name: string, objectType?: string): Promise<AdtSearchResult[]> => {
      const params = new URLSearchParams({
        operation: 'quickSearch',
        query: name,
        maxResults: String(limit),
      });
      if (objectType) {
        params.set('objectType', objectType);
      }
      const resp = await this.http.get(`/sap/bc/adt/repository/informationsystem/search?${params.toString()}`);
      return parseSearchResults(resp.body);
    };

    const results: AdtObjectLookupResult[] = [];
    for (const name of cleanedNames) {
      const rawMatches =
        objectTypes.length > 0
          ? (await Promise.all(objectTypes.map((objectType) => searchOnce(name, objectType)))).flat()
          : await searchOnce(name);

      const seen = new Set<string>();
      const matches = rawMatches
        .filter((r) => r.objectName.toUpperCase() === name)
        .filter((r) => {
          const key = `${r.objectType}\u0000${r.objectName}\u0000${r.packageName}\u0000${r.uri}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

      results.push({ name, found: matches.length > 0, matches });
    }

    return results;
  }

  /**
   * SQL-backed alternative to `lookupObjects` — issues a single `SELECT … FROM tadir`
   * query so the result can include TADIR rows the ADT info-system endpoint
   * deliberately filters out (orphan / "ghost" entries from aborted create/delete
   * cycles whose source row no longer resolves to a workbench resource).
   *
   * **When to use** — for `SAPSearch(searchType='tadir_lookup', source='db' | 'both')`
   * when the caller specifically needs to detect ghosts. The default
   * `source='adt'` path stays on `lookupObjects` and is the right choice for the
   * vast majority of viewer-scope workflows.
   *
   * **Scope requirement** — this path issues freestyle SQL, so callers must have
   * `sql` scope and the server must run with `SAP_ALLOW_FREE_SQL=true`. The
   * underlying `runQuery` enforces both via `checkOperation(safety, FreeSQL)`.
   *
   * The returned shape matches `lookupObjects` exactly so handler code can merge
   * the two result sets. Each match is stamped with `_origin: 'db'` for
   * split-brain reporting in `source='both'` mode.
   */
  async lookupObjectsViaDb(
    names: string[],
    options: { maxResults?: number; objectTypes?: string[] } = {},
  ): Promise<AdtObjectLookupResult[]> {
    const cleanedNames = [
      ...new Set(
        names
          .map((n) => n.trim())
          .filter(Boolean)
          .map((n) => n.toUpperCase()),
      ),
    ];

    if (cleanedNames.length === 0) {
      throw new Error('lookupObjectsViaDb: at least one non-empty name is required.');
    }

    const objectTypes = [
      ...new Set(
        (options.objectTypes ?? [])
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => t.toUpperCase()),
      ),
    ];
    const limit = Math.max(1, Math.min(options.maxResults ?? 1000, 1000));

    const quoteSqlLiteral = (v: string): string => `'${v.replace(/'/g, "''")}'`;
    const namesClause = cleanedNames.map(quoteSqlLiteral).join(', ');
    let sql = `SELECT pgmid, object, obj_name, devclass FROM tadir WHERE obj_name IN (${namesClause})`;
    if (objectTypes.length > 0) {
      const typesClause = objectTypes.map(quoteSqlLiteral).join(', ');
      sql += ` AND object IN (${typesClause})`;
    }

    const queryResult = await this.runQuery(sql, limit);

    // Group rows by OBJ_NAME so multiple matches per name collapse into one
    // lookup entry. SQL returns row-oriented data after `parseTableContents`
    // pivots — keys are the column names (uppercased by SAP).
    const byName = new Map<string, AdtSearchResult[]>();
    for (const row of queryResult.rows) {
      const objName = String(row.OBJ_NAME ?? '').toUpperCase();
      if (!objName) continue;
      const objectType = String(row.OBJECT ?? '');
      const packageName = String(row.DEVCLASS ?? '');
      const match: AdtSearchResult = {
        objectType,
        objectName: objName,
        description: '',
        packageName,
        uri: tadirObjectUrl(objectType, objName),
        _origin: 'db',
      };
      const existing = byName.get(objName);
      if (existing) existing.push(match);
      else byName.set(objName, [match]);
    }

    // Preserve the caller's input order — the cleaned, deduped, uppercased list.
    return cleanedNames.map((name) => {
      const matches = byName.get(name) ?? [];
      return { name, found: matches.length > 0, matches };
    });
  }

  /** Search within ABAP source code (full-text search) */
  async searchSource(
    pattern: string,
    maxResults = 50,
    objectType?: string,
    packageName?: string,
  ): Promise<SourceSearchResult[]> {
    checkOperation(this.safety, OperationType.Search, 'SearchSource');
    const limit = clampSearchResults(maxResults, 50);
    let url = `/sap/bc/adt/repository/informationsystem/textSearch?searchString=${encodeURIComponent(pattern)}&maxResults=${limit}`;
    if (objectType) url += `&objectType=${encodeURIComponent(objectType)}`;
    if (packageName) url += `&packageName=${encodeURIComponent(packageName)}`;
    const resp = await this.http.get(url);
    return parseSourceSearchResults(resp.body);
  }

  // ─── Package Operations ────────────────────────────────────────────

  /**
   * Get package contents (objects and subpackages).
   *
   * Uses the ADT **search** endpoint
   * (`/sap/bc/adt/repository/informationsystem/search?packageName=...`)
   * rather than the older `nodestructure` endpoint, because nodestructure
   * returns object descriptions that are misaligned with `OBJECT_NAME` on
   * real systems — a server-side data-quality issue, not a parser bug.
   * The search endpoint returns `adtcore:objectReferences` with descriptions
   * correctly attached to each object reference.
   *
   * Trade-off: object coverage differs slightly between the two endpoints.
   * Notably, legacy SEGW `IWSV` (service version) objects appear in
   * nodestructure but not in search results — search returns `IWMO` (model
   * version) objects instead. If you specifically need `IWSV` objects, use
   * `searchObject()` with a name pattern instead. For typical "list what's
   * in this package" use cases (the dominant consumer), this is acceptable.
   *
   * @param packageName — DEVC name to inspect
   * @param maxResults — soft cap on number of returned entries (default 200,
   *                     clamped to [1, 1000]). Larger packages may be silently
   *                     truncated by SAP at this limit; raise it if needed.
   * @returns array of `{ type, name, description, uri }` (URIs may be empty
   *          for objects that the workbench does not expose via ADT, e.g.
   *          some `IWMO`/`IWPR`/`SICF/TYP` entries).
   */
  async getPackageContents(
    packageName: string,
    maxResults = 200,
  ): Promise<Array<{ type: string; name: string; description: string; uri: string }>> {
    checkOperation(this.safety, OperationType.Read, 'GetPackage');
    const limit = Math.max(1, Math.min(maxResults, 1000));
    const resp = await this.http.get(
      `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=*&packageName=${encodeURIComponent(packageName)}&maxResults=${limit}`,
    );
    return parseSearchResults(resp.body).map((ref) => ({
      type: ref.objectType,
      name: ref.objectName,
      description: ref.description,
      uri: ref.uri,
    }));
  }

  /**
   * Direct sub-packages of `packageName` — names only, uppercased, deduplicated.
   *
   * Uses ADT's `POST /sap/bc/adt/repository/nodestructure` with
   * `parent_type=DEVC/K`, which is the canonical primitive for "direct
   * children of package X" — returning exactly the set of DEVCLASS rows
   * whose `TDEVC.PARENTCL = packageName`. Verified live against S/4HANA
   * 2023 to match `SELECT devclass FROM tdevc WHERE parentcl = ?` for
   * a range of roots, including namespace packages (`/AIF/MAIN`) and
   * deep subtrees (5 levels under `SABP_TOOLS`).
   *
   * NOTE: the previous implementation used
   * `informationsystem/search?packageName=X&objectType=DEVC/K`, which
   * silently ignores `packageName` and returns ~1000 unrelated packages.
   * That bug caused `allowedPackages` `X/**` rules to silently over-grant
   * writes to unrelated packages. See
   * `docs/research/package-subtree-endpoints.md` for the comparative analysis.
   *
   * Backs the `allowedPackages` subtree-rule (`ZFOO/**`) safety gate, so any
   * failure (network, 4xx/5xx, parse) is surfaced as an exception, NEVER as
   * an empty list. An empty list always means "SAP returned no children" —
   * `nodestructure` responds with HTTP 200 and an empty (or absent) body
   * for an unknown `parent_name`.
   *
   * `maxResults` is preserved for API compatibility and applied as a
   * defense-in-depth post-filter on the parsed result. `nodestructure`
   * itself does not honour a maxResults parameter on the SAP side and
   * returns the full child set in one round-trip.
   */
  async getSubpackages(packageName: string, maxResults = 1000): Promise<string[]> {
    checkOperation(this.safety, OperationType.Read, 'GetSubpackages');
    const limit = Math.max(1, Math.min(maxResults, 1000));
    const enc = encodeURIComponent(packageName);
    const url =
      `/sap/bc/adt/repository/nodestructure` +
      `?parent_type=${encodeURIComponent('DEVC/K')}&parent_name=${enc}&parent_tech_name=${enc}` +
      `&withShortDescriptions=true`;
    // ADT requires the asx:abap envelope with a TV_NODEKEY even though
    // `parent_name` carries the actual selector. Missing the body returns HTTP 406.
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">` +
      `<asx:values><DATA><TV_NODEKEY>000000</TV_NODEKEY></DATA></asx:values>` +
      `</asx:abap>`;
    const resp = await this.http.post(url, body, 'application/vnd.sap.as+xml; charset=UTF-8; dataname=null', {
      Accept: 'application/vnd.sap.as+xml',
    });
    const names = parseSubpackageNodestructure(resp.body);
    const upperSelf = packageName.toUpperCase();
    // parseSubpackageNodestructure already filters to DEVC/K, drops empty names,
    // uppercases, and dedupes. Here we additionally exclude the queried package
    // itself (defensive — `nodestructure` does not normally include it under
    // its own subtree) and apply the maxResults cap.
    const out: string[] = [];
    for (const name of names) {
      if (name === upperSelf) continue;
      out.push(name);
      if (out.length >= limit) break;
    }
    return out;
  }

  // ─── Table Data Operations ─────────────────────────────────────────

  /** Get table contents via data preview */
  async getTableContents(
    tableName: string,
    maxRows = 100,
    sqlFilter?: string,
  ): Promise<{ columns: string[]; rows: Record<string, string>[] }> {
    checkOperation(this.safety, OperationType.Query, 'GetTableContents');
    const rowLimit = clampPreviewRows(maxRows);
    const resp = await this.http.post(
      `/sap/bc/adt/datapreview/ddic?rowNumber=${rowLimit}&ddicEntityName=${encodeURIComponent(tableName)}`,
      sqlFilter,
      'text/plain',
    );
    return parseTableContents(resp.body);
  }

  /** Execute freestyle SQL query */
  async runQuery(sql: string, maxRows = 100): Promise<{ columns: string[]; rows: Record<string, string>[] }> {
    checkOperation(this.safety, OperationType.FreeSQL, 'RunQuery');
    const resp = await this.http.post(`/sap/bc/adt/datapreview/freestyle?rowNumber=${maxRows}`, sql, 'text/plain');
    return parseTableContents(resp.body);
  }

  /**
   * Query a table or CDS view with structured parameters.
   * Builds the SELECT server-side from structured params. IN/NOT IN values are strictly
   * parsed as quoted literal lists (no subqueries). Uses the freestyle endpoint so
   * multi-column WHERE and CDS views work on all SAP releases.
   * Gated by allowDataPreview (not allowFreeSQL).
   */
  async runTableQuery(
    tableName: string,
    opts: {
      columns?: string[];
      where?: Array<{ field: string; op: string; value?: string }>;
      maxRows?: number;
    } = {},
  ): Promise<{ columns: string[]; rows: Record<string, string>[] }> {
    checkOperation(this.safety, OperationType.Query, 'RunTableQuery');
    const sql = buildTableQuerySql(tableName, opts.columns, opts.where);
    const maxRows = clampPreviewRows(opts.maxRows);
    const resp = await this.http.post(`/sap/bc/adt/datapreview/freestyle?rowNumber=${maxRows}`, sql, 'text/plain');
    return parseTableContents(resp.body);
  }

  // ─── System Information ────────────────────────────────────────────

  /** Get system info as structured JSON (user, system details from discovery XML) */
  async getSystemInfo(): Promise<string> {
    checkOperation(this.safety, OperationType.Read, 'GetSystemInfo');
    const resp = await this.http.get('/sap/bc/adt/core/discovery');
    const info = parseSystemInfo(resp.body, this.username);
    return JSON.stringify(info, null, 2);
  }

  /** Get installed SAP components */
  async getInstalledComponents(): Promise<Array<{ name: string; release: string; description: string }>> {
    checkOperation(this.safety, OperationType.Read, 'GetInstalledComponents');
    try {
      const resp = await this.http.get('/sap/bc/adt/system/components', { Accept: 'application/atom+xml;type=feed' });
      return parseInstalledComponents(resp.body);
    } catch (err) {
      if (err instanceof AdtApiError && err.statusCode === 406) return [];
      throw err;
    }
  }

  /** Get message class messages (legacy endpoint — may fail for some classes) */
  async getMessages(messageClass: string): Promise<string> {
    checkOperation(this.safety, OperationType.Read, 'GetMessages');
    const resp = await this.http.get(`/sap/bc/adt/msg/messages/${encodeURIComponent(messageClass)}`);
    return resp.body;
  }

  /** Get structured message class info from /sap/bc/adt/messageclass/{name} */
  async getMessageClassInfo(name: string): Promise<MessageClassInfo> {
    checkOperation(this.safety, OperationType.Read, 'GetMessageClassInfo');
    const resp = await this.http.get(`/sap/bc/adt/messageclass/${encodeURIComponent(name)}`);
    return parseMessageClass(resp.body);
  }

  /** Get program text elements */
  async getTextElements(program: string): Promise<string> {
    checkOperation(this.safety, OperationType.Read, 'GetTextElements');
    const resp = await this.http.get(`/sap/bc/adt/programs/programs/${encodeURIComponent(program)}/textelements`);
    return resp.body;
  }

  /** Get program variants */
  async getVariants(program: string): Promise<string> {
    checkOperation(this.safety, OperationType.Read, 'GetVariants');
    const resp = await this.http.get(`/sap/bc/adt/programs/programs/${encodeURIComponent(program)}/variants`);
    return resp.body;
  }

  // ─── BSP / UI5 Filestore Read Operations ────────────────────────────

  /** List deployed BSP/UI5 applications */
  async listBspApps(query?: string, maxResults?: number): Promise<BspAppInfo[]> {
    checkOperation(this.safety, OperationType.Read, 'ListBSPApps');
    const params = new URLSearchParams();
    if (query) params.set('name', query);
    if (maxResults !== undefined) params.set('maxResults', String(maxResults));
    const qs = params.toString();
    const path = `/sap/bc/adt/filestore/ui5-bsp/objects${qs ? `?${qs}` : ''}`;
    const resp = await this.http.get(path, { Accept: 'application/atom+xml' });
    return parseBspAppList(resp.body);
  }

  /** Browse BSP app file structure (root or subfolder) */
  async getBspAppStructure(appName: string, subPath?: string): Promise<BspFileNode[]> {
    checkOperation(this.safety, OperationType.Read, 'GetBSPApp');
    const normalizedSubPath = subPath && !subPath.startsWith('/') ? `/${subPath}` : subPath || '';
    const objectPath = appName.toUpperCase() + normalizedSubPath;
    const resp = await this.http.get(
      `/sap/bc/adt/filestore/ui5-bsp/objects/${encodeURIComponent(objectPath)}/content`,
      { Accept: 'application/xml', 'Content-Type': 'application/atom+xml' },
    );
    return parseBspFolderListing(resp.body, appName.toUpperCase());
  }

  /** Read a single file from a BSP app */
  async getBspFileContent(appName: string, filePath: string): Promise<string> {
    checkOperation(this.safety, OperationType.Read, 'GetBSPFile');
    const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    const objectPath = `${appName.toUpperCase()}/${cleanPath}`;
    const resp = await this.http.get(
      `/sap/bc/adt/filestore/ui5-bsp/objects/${encodeURIComponent(objectPath)}/content`,
      { Accept: 'application/xml', 'Content-Type': 'application/octet-stream' },
    );
    return resp.body;
  }

  /**
   * Resolve the ABAP package of an existing object by fetching its metadata.
   * Returns the package name (e.g., "$TMP", "ZPACKAGE") or empty string if not found.
   * Used by SAPWrite to enforce allowedPackages on update/delete/edit_method.
   *
   * Top-level objects (CLAS, INTF, PROG, TABL, DDLS, ...) expose
   * `<adtcore:packageRef adtcore:name="…"/>` directly. Contained objects
   * (notably FUNC, which lives inside a FUGR) instead expose the package via
   * `<adtcore:containerRef … adtcore:packageName="…"/>` since their own
   * `packageRef` would just point at the parent — the `containerRef` already
   * surfaces the package as a denormalised attribute. Both shapes resolve
   * to the same package; we accept either.
   */
  async resolveObjectPackage(objectUrl: string, accept?: string): Promise<string> {
    checkOperation(this.safety, OperationType.Read, 'ResolveObjectPackage');
    // Server-driven objects (8.16+) only render their <blue:blueSource> metadata (with the
    // adtcore:packageRef) under the blues.vN+xml Accept — callers pass it so the allowedPackages
    // ceiling can resolve the real package. Other callers rely on discovery-driven negotiation.
    // Send the bare media type only: on-prem backends reject an Accept carrying parameters
    // ("; charset=utf-8" → 406 SADT_RESOURCE 037, live-verified on 758 and 816 against the SRVB
    // bindings resource), and that 406 body names no accepted type, so the generic negotiation
    // retry cannot recover. Parameters select nothing on these metadata reads.
    const bareAccept = accept?.split(';')[0]?.trim();
    const resp = await this.http.get(objectUrl, bareAccept ? { Accept: bareAccept } : undefined);
    const packageRefMatch = resp.body.match(/adtcore:packageRef[^>]*adtcore:name="([^"]*)"/);
    if (packageRefMatch?.[1]) return packageRefMatch[1];
    const containerRefMatch = resp.body.match(/adtcore:containerRef[^>]*adtcore:packageName="([^"]*)"/);
    return containerRefMatch?.[1] ?? '';
  }
}
