/**
 * ADT XML response types.
 *
 * SAP ADT returns XML for most responses. These types represent
 * the parsed structures we care about. Not exhaustive — we add
 * types as we port each operation.
 */

/** Search result from /sap/bc/adt/repository/informationsystem/search */
export interface AdtSearchResult {
  objectType: string;
  objectName: string;
  description: string;
  packageName: string;
  uri: string;
}

/** Object structure node */
export interface AdtObjectNode {
  type: string;
  name: string;
  uri: string;
  children?: AdtObjectNode[];
}

/** Feature probe result */
export interface FeatureStatus {
  id: string;
  available: boolean;
  mode: string;
  message?: string;
  probedAt?: string;
}

/** SAP system type: BTP ABAP Environment or on-premise */
export type SystemType = 'btp' | 'onprem';

/** ADT discovery map: endpoint path -> accepted MIME types */
export type DiscoveryMap = Map<string, string[]>;

/** Resolved features after probing */
export interface ResolvedFeatures {
  hana: FeatureStatus;
  abapGit: FeatureStatus;
  gcts: FeatureStatus;
  rap: FeatureStatus;
  amdp: FeatureStatus;
  ui5: FeatureStatus;
  transport: FeatureStatus;
  ui5repo: FeatureStatus;
  flp: FeatureStatus;
  /** Detected SAP_BASIS release (e.g. "750", "757"). Populated during probe. */
  abapRelease?: string;
  /** Detected system type: 'btp' (SAP_CLOUD component present) or 'onprem'. */
  systemType?: SystemType;
  /** Text search (source_code) probe result — available, or reason it's unavailable */
  textSearch?: { available: boolean; reason?: string };
  /** Authorization probe results — search and transport access */
  authProbe?: AuthProbeResult;
  /** ADT discovery MIME map used by HTTP content negotiation */
  discoveryMap?: DiscoveryMap;
}

// ─── gCTS / abapGit Types ───────────────────────────────────────────

export interface GctsScope {
  scope: string;
  level: string;
}

export interface GctsUserInfo {
  user: {
    user: string;
    scope?: {
      system?: GctsScope[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

export interface GctsSystemStatus {
  id?: string;
  name?: string;
  status?: string;
  text?: string;
  [key: string]: unknown;
}

export interface GctsSystemInfo {
  result: {
    sid?: string;
    name?: string;
    sapsid?: string;
    workstate?: string;
    config?: unknown;
    status?: GctsSystemStatus[];
    client?: string;
    servername?: string;
    version?: string;
    availableVsid?: string[];
    [key: string]: unknown;
  };
}

export interface GctsConfig {
  ckey: string;
  ctype?: string;
  datatype?: string;
  defaultValue?: string;
  description?: string;
  category?: string;
  [key: string]: unknown;
}

export interface GctsRepo {
  rid: string;
  name?: string;
  url?: string;
  branch?: string;
  package?: string;
  role?: string;
  type?: string;
  vSID?: string;
  [key: string]: unknown;
}

export interface GctsBranch {
  name?: string;
  branch?: string;
  isSymbolic?: boolean;
  isPeeled?: boolean;
  type?: string;
  [key: string]: unknown;
}

export interface GctsCommit {
  commit?: string;
  author?: string;
  email?: string;
  date?: string;
  message?: string;
  [key: string]: unknown;
}

export interface GctsObject {
  type?: string;
  name?: string;
  package?: string;
  path?: string;
  [key: string]: unknown;
}

export interface GctsCloneResult {
  rid?: string;
  result?: string;
  message?: string;
  [key: string]: unknown;
}

export interface AbapGitLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
}

export interface AbapGitRepo {
  key: string;
  package: string;
  url: string;
  branchName: string;
  selectedBranch?: string;
  deserializedBy?: string;
  writeProtected?: boolean;
  createdBy?: string;
  createdAt?: string;
  dotAbapGit?: string;
  links: AbapGitLink[];
}

export interface AbapGitBranch {
  name: string;
  isHead?: boolean;
  sha1?: string;
}

export interface AbapGitUser {
  name?: string;
  email?: string;
}

export interface AbapGitExternalInfo {
  accessMode?: string;
  defaultBranch?: string;
  selectedBranch?: string;
  branches: AbapGitBranch[];
  user?: AbapGitUser;
}

export interface AbapGitObject {
  type?: string;
  name?: string;
  package?: string;
  path?: string;
  [key: string]: unknown;
}

export interface AbapGitStagingObject extends AbapGitObject {
  state?: string;
  operation?: string;
}

export interface AbapGitStaging {
  repoKey?: string;
  branchName?: string;
  objects: AbapGitStagingObject[];
}

/** Authorization probe result from startup probing */
export interface AuthProbeResult {
  searchAccess: boolean;
  searchReason?: string;
  transportAccess: boolean;
  transportReason?: string;
}

/** System info from /sap/bc/adt/core/discovery */
export interface SystemInfo {
  systemId: string;
  release: string;
  type: string;
}

/** Unit test result */
export interface UnitTestResult {
  program: string;
  testClass: string;
  testMethod: string;
  status: 'passed' | 'failed' | 'skipped';
  message?: string;
  duration?: number;
}

/** Source unit affected by a quick fix proposal/application. */
export interface FixAffectedObject {
  /** ADT source URI for this affected unit. May include #start/#end range fragments. */
  uri: string;
  /** Optional ADT object type metadata from the proposal payload. */
  type?: string;
  /** Optional ADT object name metadata from the proposal payload. */
  name?: string;
  /** Optional human-readable description from the proposal payload. */
  description?: string;
  /** Current source content for this affected unit. Needed when applying multi-object quick fixes. */
  content?: string;
}

/** Quick fix proposal from /sap/bc/adt/quickfixes/evaluation */
export interface FixProposal {
  /** Proposal endpoint URI (used for apply step) */
  uri: string;
  /** ADT object type of the proposal */
  type: string;
  /** Human-readable proposal name/title */
  name: string;
  /** Human-readable description (may contain HTML entities) */
  description: string;
  /** Opaque SAP quickfix state blob, pass through unchanged. May be an empty string or omitted by SAP. */
  userContent: string;
  /** Additional source units that ADT needs to evaluate/apply this proposal. */
  affectedObjects?: FixAffectedObject[];
}

/** Text delta returned when applying a quick fix proposal */
export interface FixDelta {
  /** Source URI affected by this replacement */
  uri: string;
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  /** Replacement text */
  content: string;
}

/** Syntax check result */
export interface SyntaxCheckResult {
  hasErrors: boolean;
  messages: SyntaxMessage[];
}

export interface SyntaxMessage {
  severity: 'error' | 'warning' | 'info';
  text: string;
  line: number;
  column: number;
  uri?: string;
}

/** Transport request */
export interface TransportRequest {
  id: string;
  description: string;
  owner: string;
  status: string;
  type: string;
  tasks: TransportTask[];
}

export interface TransportObject {
  pgmid: string;
  type: string;
  name: string;
  wbtype: string;
  description: string;
  locked: boolean;
  position: string;
}

export interface TransportTask {
  id: string;
  description: string;
  owner: string;
  status: string;
  objects: TransportObject[];
}

/** Result of looking up transports related to a given ABAP object. */
export interface ObjectTransportHistory {
  object: { type: string; name: string; uri: string };
  /** Transport currently holding a lock on this object (if any). */
  lockedTransport?: string;
  /** All transports the object is referenced from (active + queued). Empty when none. */
  relatedTransports: Array<{ id: string; description: string; owner: string; status: string }>;
  /** Transports the object could be added to (from transportchecks fallback). */
  candidateTransports: Array<{ id: string; description: string; owner: string }>;
  /** Human-readable summary used by SAPTransport response. */
  summary: string;
}

/** Source code search result */
export interface SourceSearchResult {
  objectType: string;
  objectName: string;
  uri: string;
  matches: Array<{
    line: number;
    snippet: string;
  }>;
}

/** Table structure */
export interface TableField {
  name: string;
  type: string;
  length: number;
  description: string;
  isKey: boolean;
}

// ─── Runtime Diagnostics Types ──────────────────────────────────────

/** Short dump entry from /sap/bc/adt/runtime/dumps listing */
export interface DumpEntry {
  /** Encoded dump ID (URL path segment) */
  id: string;
  /** ISO 8601 timestamp when the dump occurred */
  timestamp: string;
  /** SAP user who triggered the dump */
  user: string;
  /** Runtime error type (e.g., STRING_OFFSET_TOO_LARGE) */
  error: string;
  /** Terminated ABAP program name */
  program: string;
}

/** Chapter within a dump detail */
export interface DumpChapter {
  name: string;
  title: string;
  category: string;
  /** 1-based start line in formatted dump text */
  line: number;
  /** Chapter order from ADT metadata */
  chapterOrder: number;
  /** Category order from ADT metadata */
  categoryOrder: number;
}

/** Full dump detail from /sap/bc/adt/runtime/dump/{id} */
export interface DumpDetail {
  /** Encoded dump ID */
  id: string;
  /** Runtime error type */
  error: string;
  /** Exception class (e.g., CX_SY_RANGE_OUT_OF_BOUNDS) */
  exception: string;
  /** Terminated ABAP program */
  program: string;
  /** SAP user */
  user: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Dump chapters (table of contents) */
  chapters: DumpChapter[];
  /** Full formatted plain text dump content */
  formattedText: string;
  /** Chapter-sliced dump text keyed by stable section IDs (chapter names) */
  sections: Record<string, string>;
  /** ADT URI to the termination source location */
  terminationUri?: string;
}

/** ABAP profiler trace entry from /sap/bc/adt/runtime/traces/abaptraces */
export interface TraceEntry {
  /** Trace ID (URL path segment) */
  id: string;
  /** Trace title / description */
  title: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Trace state (e.g., completed) */
  state?: string;
  /** Object name being traced */
  objectName?: string;
  /** Total runtime in microseconds */
  runtime?: number;
}

/** Hot spot entry from trace hitlist analysis */
export interface TraceHitlistEntry {
  /** Calling program / procedure */
  callingProgram: string;
  /** Called program / procedure */
  calledProgram: string;
  /** Number of times called */
  hitCount: number;
  /** Gross execution time (microseconds) */
  grossTime: number;
  /** Net execution time (microseconds) */
  netTime: number;
}

/** Call tree entry from trace statements analysis */
export interface TraceStatement {
  /** Nesting level in the call tree */
  callLevel: number;
  /** Number of executions */
  hitCount: number;
  /** Whether this is a procedural unit (method/form/function) */
  isProceduralUnit: boolean;
  /** Gross execution time (microseconds) */
  grossTime: number;
  /** Description / program name */
  description: string;
}

/** Database access entry from trace analysis */
export interface TraceDbAccess {
  /** Table name accessed */
  tableName: string;
  /** SQL statement type (e.g., SELECT, INSERT) */
  statement: string;
  /** Access type (OpenSQL, NativeSQL) */
  type: string;
  /** Total number of accesses */
  totalCount: number;
  /** Number of buffered accesses */
  bufferedCount: number;
  /** Total access time (microseconds) */
  accessTime: number;
}

/** SM02 system message entry */
export interface SystemMessageEntry {
  id: string;
  title: string;
  text: string;
  severity: string;
  validFrom: string;
  validTo: string;
  createdBy: string;
  timestamp: string;
  detailUrl?: string;
}

/** Gateway error entry from /sap/bc/adt/gw/errorlog feed */
export interface GatewayErrorEntry {
  /** Gateway error type (for example "Frontend Error") */
  type: string;
  /** Short text from feed title */
  shortText: string;
  /** Transaction/error ID */
  transactionId: string;
  /** Timestamp */
  dateTime: string;
  /** SAP user */
  username: string;
  /** ADT detail URL for this error entry */
  detailUrl: string;
  package?: string;
  applicationComponent?: string;
  client?: string;
  requestKind?: string;
}

export interface GatewayServiceInfo {
  namespace: string;
  serviceName: string;
  serviceVersion: string;
  groupId: string;
  serviceRepository: string;
  destination: string;
}

export interface GatewayExceptionInfo {
  type: string;
  text: string;
  raiseLocation: string;
}

export interface GatewaySourceLine {
  number: number;
  content: string;
  isError: boolean;
}

export interface GatewayCallStackEntry {
  number: number;
  event: string;
  program: string;
  name: string;
  line: number;
}

/** Detailed gateway error payload */
export interface GatewayErrorDetail {
  type: string;
  shortText: string;
  transactionId: string;
  package: string;
  applicationComponent: string;
  dateTime: string;
  username: string;
  client: string;
  requestKind: string;
  serviceInfo: GatewayServiceInfo;
  errorContext: {
    errorInfo: string;
    resolution: Record<string, string>;
    exceptions: GatewayExceptionInfo[];
  };
  sourceCode: {
    lines: GatewaySourceLine[];
    errorLine: number;
  };
  callStack: GatewayCallStackEntry[];
}

// ─── Message Class Types ────────────────────────────────────────────

/** Message class metadata from /sap/bc/adt/messageclass/{name} */
export interface MessageClassInfo {
  name: string;
  description: string;
  messages: Array<{
    number: string;
    shortText: string;
  }>;
  package: string;
}

// ─── DDIC Types ─────────────────────────────────────────────────────

/** Domain metadata from /sap/bc/adt/ddic/domains/{name} */
export interface DomainInfo {
  name: string;
  description: string;
  dataType: string;
  length: string;
  decimals: string;
  outputLength: string;
  conversionExit: string;
  signExists: boolean;
  lowercase: boolean;
  valueTable: string;
  fixedValues: Array<{ low: string; high: string; description: string }>;
  package: string;
}

/** Data element metadata from /sap/bc/adt/ddic/dataelements/{name} */
export interface DataElementInfo {
  name: string;
  description: string;
  typeKind: string;
  typeName: string;
  dataType: string;
  length: string;
  decimals: string;
  shortLabel: string;
  mediumLabel: string;
  longLabel: string;
  headingLabel: string;
  searchHelp: string;
  defaultComponentName: string;
  package: string;
}

// ─── Class Metadata Types ───────────────────────────────────────────

/** Class metadata from /sap/bc/adt/oo/classes/{name} (object endpoint, no /source/main) */
export interface ClassMetadata {
  name: string;
  description: string;
  language: string;
  abapLanguageVersion?: string;
  category: string;
  fixPointArithmetic: boolean;
  package: string;
}

/** Structured class response with metadata + decomposed includes (AFF-style) */
export interface StructuredClassResponse {
  metadata: ClassMetadata;
  main: string;
  testclasses: string | null;
  definitions: string | null;
  implementations: string | null;
  macros: string | null;
}

// ─── BSP / UI5 Filestore Types ─────────────────────────────────────

/** BSP application info from /sap/bc/adt/filestore/ui5-bsp/objects listing */
export interface BspAppInfo {
  name: string;
  description: string;
}

/** File or folder node within a BSP application */
export interface BspFileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  etag?: string;
}

/** BSP deploy info from ABAP Repository OData Service */
export interface BspDeployInfo {
  name: string;
  package: string;
  description: string;
  info: string;
}

/** FLP catalog from PAGE_BUILDER_CUST OData (entity: Catalog) */
export interface FlpCatalog {
  id: string;
  domainId: string;
  title: string;
  type: string;
  scope: string;
  chipCount: string;
}

/** FLP group (page) from PAGE_BUILDER_CUST OData (entity: Page) */
export interface FlpGroup {
  id: string;
  title: string;
  catalogId: string;
  layout: string;
}

/** FLP tile/target mapping instance from PAGE_BUILDER_CUST OData (entity: PageChipInstance) */
export interface FlpTileInstance {
  instanceId: string;
  chipId: string;
  pageId: string;
  title: string;
  configuration: Record<string, unknown> | null;
}

/** FLP tile listing result — includes backend error flag for ASSERTION_FAILED */
export interface FlpTileResult {
  tiles: FlpTileInstance[];
  /** Set when backend returned ASSERTION_FAILED instead of data */
  backendError?: string;
}

/** Transaction code metadata */
export interface TransactionInfo {
  code: string;
  description: string;
  program: string;
  package: string;
}

// ─── Class Hierarchy Types ────────────────────────────────────────

/** Class hierarchy from SEOMETAREL (reltype 1=interface, 2=inheritance) */
export interface ClassHierarchy {
  className: string;
  superclass: string | null;
  interfaces: string[];
  subclasses: string[];
}

// ─── API Release State Types ──────────────────────────────────────

/** Single release contract (C0–C4) with state and successor info */
export interface ApiReleaseContract {
  contract: string;
  state: string;
  stateDescription: string;
  useInKeyUserApps: boolean;
  useInSAPCloudPlatform: boolean;
  successors: Array<{ uri: string; type: string; name: string }>;
}

/** API release state from /sap/bc/adt/apireleases/{encoded-object-uri} */
export interface ApiReleaseStateInfo {
  objectUri: string;
  objectType: string;
  objectName: string;
  contracts: ApiReleaseContract[];
  isAnyContractReleased: boolean;
  isAnyAssignmentPossible: boolean;
}

/** An object pending activation from /sap/bc/adt/activation/inactive */
export interface InactiveObject {
  name: string;
  type: string;
  uri: string;
  description?: string;
  user?: string;
  deleted?: boolean;
  transport?: string;
  parentTransport?: string;
}

// ─── Authorization & Switch Framework Types ────────────────────────

/** Authorization field metadata from /sap/bc/adt/aps/iam/auth/{name} */
export interface AuthorizationFieldInfo {
  name: string;
  description: string;
  roleName: string;
  checkTable: string;
  domainName: string;
  outputLength: string;
  conversionExit: string;
  exitFunctionModule: string;
  package: string;
  orgLevelInfo: string[];
  masterLanguage: string;
}

/** Feature toggle states from /sap/bc/adt/sfw/featuretoggles/{name}/states */
export interface FeatureToggleInfo {
  name: string;
  clientState: string;
  userState: string;
  states: Array<{
    client: string;
    state: 'on' | 'off' | 'unknown';
    description?: string;
  }>;
  userStates: Array<{
    client: string;
    user: string;
    state: 'on' | 'off' | 'unknown';
  }>;
}

/** Enhancement implementation metadata from /sap/bc/adt/enhancements/enhoxhb/{name} */
export interface EnhancementImplementationInfo {
  name: string;
  description: string;
  package: string;
  technology: string;
  switchSupported: boolean;
  badiImplementations: Array<{
    name: string;
    shortText: string;
    implementingClass: string;
    badiDefinition: string;
    enhancementSpot: string;
    active: boolean;
    default: boolean;
  }>;
}

// ─── Source Revision / Version History Types ─────────────────────

/** A single revision entry from the ADT `{sourceUrl}/versions` Atom feed. */
export interface RevisionInfo {
  id: string;
  author: string;
  timestamp: string;
  versionTitle?: string;
  transport?: string;
  uri: string;
}

/** Parsed result of a revisions feed read — object metadata plus one entry per revision. */
export interface RevisionListResult {
  object: {
    name: string;
    type: string;
  };
  revisions: RevisionInfo[];
}
