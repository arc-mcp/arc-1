/**
 * Server configuration types for ARC-1.
 *
 * Configuration priority (highest to lowest):
 * 1. CLI flags (--url, --user, etc.)
 * 2. Environment variables (SAP_URL, SAP_USER, etc.)
 * 3. .env file
 * 4. Defaults (all `allow*` flags false — restrictive by default)
 */

/** MCP transport type */
export type TransportType = 'stdio' | 'http-streamable';

/** Feature toggle: auto detects from SAP system, on/off forces */
export type FeatureToggle = 'auto' | 'on' | 'off';

/** Per-field config source (used by resolveConfig + startup log + `config show`). */
export type ConfigSource = 'default' | { env: string } | { flag: string } | { file: string };

/** Server configuration — all fields needed to start ARC-1 */
export interface ServerConfig {
  // --- SAP Connection ---
  url: string;
  username: string;
  password: string;
  client: string;
  language: string;
  insecure: boolean;

  // --- Cookie Authentication ---
  cookieFile?: string;
  cookieString?: string;

  // --- MCP Transport ---
  transport: TransportType;
  httpAddr: string;

  // --- Safety (positive opt-ins; defaults restrictive) ---
  allowWrites: boolean;
  allowDataPreview: boolean;
  allowFreeSQL: boolean;
  allowTransportWrites: boolean;
  allowGitWrites: boolean;
  allowedPackages: string[];
  allowedTransports: string[];
  /** Resolved deny-action patterns from SAP_DENY_ACTIONS (parsed + validated at startup). */
  denyActions: string[];

  // --- Feature Detection ---
  featureAbapGit: FeatureToggle;
  featureGcts: FeatureToggle;
  featureRap: FeatureToggle;
  featureAmdp: FeatureToggle;
  featureUi5: FeatureToggle;
  featureTransport: FeatureToggle;
  featureHana: FeatureToggle;
  featureUi5Repo: FeatureToggle;
  featureFlp: FeatureToggle;

  // --- System Type Detection ---
  /** System type: 'auto' (detect from components), 'btp', or 'onprem' */
  systemType: 'auto' | 'btp' | 'onprem';

  // --- Authentication (MCP client → ARC-1) ---
  /** Multiple API keys with per-key profile assignment (key:profile pairs). Single ARC1_API_KEY was removed in v0.7. */
  apiKeys?: Array<{ key: string; profile: string }>;
  oidcIssuer?: string;
  oidcAudience?: string;
  /** Clock tolerance in seconds for JWT exp/nbf validation (default: 0 — no tolerance) */
  oidcClockTolerance?: number;
  xsuaaAuth: boolean;

  /**
   * Lifetime of an OAuth DCR registration (`client_id`) in seconds. Default:
   * 30 days. Lower values bound the blast radius if the signing key leaks;
   * higher values reduce re-auth churn. Hard-capped at 90 days — longer-lived
   * credentials should use the pre-registered XSUAA client instead of DCR.
   * Only consulted when XSUAA OAuth proxy mode is active. */
  oauthDcrTtlSeconds: number;

  // --- BTP ABAP Environment (direct connection via service key) ---
  btpServiceKey?: string; // Inline service key JSON
  btpServiceKeyFile?: string; // Path to service key file
  btpOAuthCallbackPort: number; // Port for OAuth browser callback (0 = auto)

  // --- Principal Propagation (per-user SAP auth) ---
  ppEnabled: boolean;
  ppStrict: boolean; // If true, PP failure = error (no fallback to shared client)
  /** Opt-in: allow shared cookie auth to coexist with PP (shared client only) */
  ppAllowSharedCookies: boolean;

  // --- SAML Behavior ---
  /** Opt-in: disable SAML redirect for ADT requests (X-SAP-SAML2 + saml2=disabled) */
  disableSaml2: boolean;

  // --- Logging ---
  logFile?: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logFormat: 'text' | 'json';

  // --- Tool Mode ---
  /** Tool mode: 'standard' (12 intent tools, SAPGit feature-gated) or 'hyperfocused' (1 universal SAP tool, ~200 tokens) */
  toolMode: 'standard' | 'hyperfocused';

  // --- Lint ---
  /** Path to custom abaplint.jsonc config file for lint rules */
  abaplintConfig?: string;
  /** Enable pre-write lint validation (default: true) */
  lintBeforeWrite: boolean;
  /** Enable pre-write server-side syntax check via ADT checkruns with inline content
   *  (default: false, opt-in). When true, SAPWrite sends the proposed source to SAP's
   *  compiler BEFORE writing and appends any error/warning messages to the write's
   *  success response. The write is NOT blocked — errors are informational, deferred to
   *  the eventual activation for real resolution. This keeps multi-file edits with
   *  cross-object dependencies from hitting false-positive blocks on intermediate
   *  writes (a referenced type/class/include is not yet updated). Useful for
   *  single-file edits where you want early visibility into compile errors without
   *  having to call SAPDiagnose separately. */
  checkBeforeWrite: boolean;

  // --- Cache ---
  /** Cache mode: 'auto' (memory for stdio, sqlite for http-streamable), 'memory', 'sqlite', 'none' */
  cacheMode: 'auto' | 'memory' | 'sqlite' | 'none';
  /** Path to SQLite cache file (default: .arc1-cache.db in working directory) */
  cacheFile: string;
  /** Enable cache warmup on startup (queries TADIR + fetches all custom objects) */
  cacheWarmup: boolean;
  /** Package filter for warmup (supports wildcards, e.g. "Z*,Y*,/COMPANY/*") */
  cacheWarmupPackages: string;

  // --- Concurrency ---
  /** Maximum concurrent SAP HTTP requests (default: 10). Prevents work process exhaustion. */
  maxConcurrent: number;

  // --- Browser-based MCP clients (CORS) ---
  /** Exact-match CORS allowlist. Empty array (the default) disables CORS entirely so that
   *  browser-originated cross-origin requests are blocked. Native MCP clients
   *  (Claude Desktop / Cursor / VS Code Copilot / Copilot Studio) do not need this — they
   *  use native HTTP, not the browser fetch API, and never trigger CORS. */
  allowedOrigins: string[];

  // --- Misc ---
  verbose: boolean;
}

/** Default configuration values — restrictive by default. */
export const DEFAULT_CONFIG: ServerConfig = {
  url: '',
  username: '',
  password: '',
  client: '100',
  language: 'EN',
  insecure: false,
  transport: 'stdio',
  httpAddr: '0.0.0.0:8080',
  allowWrites: false,
  allowDataPreview: false,
  allowFreeSQL: false,
  allowTransportWrites: false,
  allowGitWrites: false,
  allowedPackages: ['$TMP'],
  allowedTransports: [],
  denyActions: [],
  featureAbapGit: 'auto',
  featureGcts: 'auto',
  featureRap: 'auto',
  featureAmdp: 'auto',
  featureUi5: 'auto',
  featureTransport: 'auto',
  featureHana: 'auto',
  featureUi5Repo: 'auto',
  featureFlp: 'auto',
  systemType: 'auto',
  xsuaaAuth: false,
  oauthDcrTtlSeconds: 30 * 24 * 60 * 60, // 30 days
  btpOAuthCallbackPort: 0,
  ppEnabled: false,
  ppStrict: false,
  ppAllowSharedCookies: false,
  disableSaml2: false,
  toolMode: 'standard',
  lintBeforeWrite: true,
  checkBeforeWrite: false,
  cacheMode: 'auto',
  cacheFile: '.arc1-cache.db',
  cacheWarmup: false,
  cacheWarmupPackages: '',
  maxConcurrent: 10,
  allowedOrigins: [],
  logLevel: 'info',
  logFormat: 'text',
  verbose: false,
};
