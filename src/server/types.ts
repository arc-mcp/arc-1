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

/** Read-only admin UI mode */
export type UiMode = 'off' | 'local' | 'web';

/** Feature toggle: auto detects from SAP system, on/off forces */
export type FeatureToggle = 'auto' | 'on' | 'off';

/** Tool-schema nullable optional mode: auto currently resolves to portable off. */
export type NullableOptionalsMode = 'auto' | 'on' | 'off';

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
  /** Gzip non-empty ADT data-preview POST bodies for approved WAF compatibility. */
  gzipDataPreviewBody: boolean;

  // --- Cookie Authentication ---
  cookieFile?: string;
  cookieString?: string;

  // --- MCP Transport ---
  transport: TransportType;
  httpAddr: string;
  serverName: string;

  // --- Read-only Admin UI ---
  /** Read-only inspection UI: off (default), local sidecar server, or mounted web routes on the HTTP server. */
  uiMode: UiMode;
  /** Bind address for local sidecar UI mode. Ignored when uiMode='web'. */
  uiAddr: string;
  /** Open the local UI in the system browser after startup (local/dev convenience only). */
  uiOpen: boolean;

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
  /** Optional SAP_BASIS release override for local tooling such as abaplint (e.g., "758"). */
  abapRelease?: string;

  // --- Authentication (MCP client → ARC-1) ---
  /** Multiple API keys with per-key profile assignment (key:profile pairs). Single ARC1_API_KEY was removed in v0.7. */
  apiKeys?: Array<{ key: string; profile: string }>;
  oidcIssuer?: string;
  oidcAudience?: string;
  /** Clock tolerance in seconds for JWT exp/nbf validation (default: 0 — no tolerance) */
  oidcClockTolerance?: number;
  /**
   * Serve RFC 9728 protected-resource metadata in OIDC mode (default: true).
   * Set false for IdPs that reject the RFC 8707 `resource` parameter MCP clients
   * send once metadata exists — Microsoft Entra answers `AADSTS9010010`. */
  oidcDiscovery: boolean;
  /**
   * Scopes advertised as `scopes_supported`. IdP-specific (Entra:
   * `api://<client-id>/access_as_user`), so it cannot be derived; omitted when unset. */
  oidcScopes?: string[];
  xsuaaAuth: boolean;
  /** Explicit unsafe opt-in for HTTP `/mcp` without API-key, OIDC, or XSUAA auth. */
  allowHttpNoAuth: boolean;

  /**
   * Lifetime of an OAuth DCR registration (`client_id`) in seconds.
   * Default: `0` = never expire (no per-client revocation exists at any TTL,
   * so a finite TTL only causes periodic `invalid_client` re-auth outages).
   * Positive values opt into expiry, clamped to `[60s, 90d]`. Only consulted
   * when XSUAA OAuth proxy mode is active. */
  oauthDcrTtlSeconds: number;

  /**
   * Optional dedicated secret for HMAC-signing DCR `client_id`s. When set,
   * decouples the DCR signing key from the XSUAA `clientsecret`, so MTA
   * `cf deploy` (which recreates the service binding and rotates the
   * `clientsecret`) does NOT invalidate cached `client_id`s. The secret
   * survives across deploys as a CF env var (`cf set-env`) — only an
   * explicit re-set or `cf unset-env` rotates it. Recommended length:
   * ≥32 bytes of entropy (e.g. `openssl rand -base64 48`). Falls back to
   * the XSUAA `clientsecret` when omitted. Only consulted when XSUAA
   * OAuth proxy mode is active. */
  dcrSigningSecret?: string;

  /**
   * Enable Client ID Metadata Documents (CIMD, SEP-991) alongside stateless DCR.
   * Default `false`.
   *
   * The 2026-07-28 MCP revision deprecates DCR in favour of CIMD, where the `client_id`
   * IS an HTTPS URL the client hosts and this server fetches. Turning this on therefore
   * makes ARC-1 issue an outbound request to a URL chosen by an unauthenticated caller,
   * on the pre-authentication `/authorize` path. The fetch is SSRF-hardened
   * (`@arc-mcp/xsuaa-auth`), but read `docs/research/2026-08-18-cimd-client-identity.md`
   * before enabling it — on BTP this process sits beside a Cloud Connector.
   *
   * This flag also gates `client_id_metadata_document_supported` in the published OAuth
   * metadata. The two must move together: a client that sees the flag STOPS using DCR, so
   * advertising without resolving breaks every capable client. Only consulted when XSUAA
   * OAuth proxy mode is active. */
  cimdEnabled: boolean;

  /**
   * Optional host allowlist for CIMD `client_id` URLs. Empty (the default) means any
   * HTTPS host is admitted once `cimdEnabled` is on — which is CIMD's whole point, and is
   * safe because admitting a client identity grants nothing on its own: XSUAA still
   * authenticates the human, MCP scopes still apply, and so do the safety ceiling and the
   * user's own SAP authorizations.
   *
   * Set it when egress policy requires a closed set of destinations, or to reduce
   * phishing surface — CIMD proves control of a domain and nothing more, so `client_name`
   * is attacker-chosen and must never be shown as a trusted identity. Entries are exact
   * hosts (`claude.ai`) or single-label wildcards (`*.vscode.dev`). Enforced BEFORE any
   * DNS or socket, so a rejected host produces no outbound traffic at all. */
  cimdAllowedHosts: string[];

  /**
   * Fallback cache lifetime in seconds for a CIMD document whose response carries no
   * usable cache headers. Default `900`. Responses that DO carry `Cache-Control`/`Expires`
   * are honoured but clamped to `[300s, 3600s]`: the floor stops a hostile `max-age=0`
   * turning every `/authorize` into an outbound fetch, the ceiling bounds staleness after
   * a client legitimately rotates its redirect URIs. */
  cimdCacheTtlSeconds: number;

  /**
   * Forward proxy for CIMD document fetches, e.g. `http://proxy.corp:3128`. Unset means
   * connect directly.
   *
   * ARC-1 tunnels via `CONNECT <validated-ip>:<port>` rather than handing the proxy a
   * hostname, so the proxy resolves nothing and the SSRF address validation survives the
   * hop. Two consequences: a proxy that refuses `CONNECT` to a bare IP cannot be used, and
   * a TLS-intercepting proxy fails certificate validation unless its CA is trusted via
   * `NODE_EXTRA_CA_CERTS`. */
  cimdProxyUrl?: string;

  // --- BTP ABAP Environment (direct connection via service key) ---
  btpServiceKey?: string; // Inline service key JSON
  btpServiceKeyFile?: string; // Path to service key file
  btpOAuthCallbackPort: number; // Port for OAuth browser callback (0 = auto)

  // --- Experimental destination-discovered multi-target mode ---
  /** Enable startup discovery plus pinned and aggregate multi-target endpoints. Default false. */
  multiTargetEndpoints: boolean;
  /** Allow explicitly marked OnPremise BasicAuthentication targets in multi-target mode. Default false. */
  multiTargetAllowBasicAuth: boolean;
  /** Runtime-only: internal Destination Service name for a discovered target. */
  destinationName?: string;
  /** Runtime-only: public immutable system-or-alias/client ID for a discovered target. */
  targetId?: string;

  // --- Principal Propagation (per-user SAP auth) ---
  ppEnabled: boolean;
  ppStrict: boolean; // Explicit true also rejects non-JWT calls; JWT PP failures always fail closed
  /** True only when SAP_PP_STRICT / --pp-strict was explicitly provided. */
  ppStrictExplicit: boolean;
  /** Opt-in: allow shared cookie auth to coexist with PP (shared client only) */
  ppAllowSharedCookies: boolean;

  // --- SAML Behavior ---
  /** Opt-in: disable SAML redirect for ADT requests (X-SAP-SAML2 + saml2=disabled) */
  disableSaml2: boolean;

  // --- Logging ---
  logFile?: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logFormat: 'text' | 'json';
  /** Hide SAP response details from client-facing tool errors while retaining server-side correlation data. */
  minimalErrors: boolean;

  // --- Tool Mode ---
  /** Tool mode: 'standard' (12 intent tools, SAPGit feature-gated) or 'hyperfocused' (1 universal SAP tool, ~200 tokens) */
  toolMode: 'standard' | 'hyperfocused';
  /** JSON Schema compatibility for optional SAPWrite fields. */
  schemaNullableOptionals: NullableOptionalsMode;

  // --- Extensions (FEAT-61) ---
  /** Absolute paths to extension plugins to load at startup (from ARC1_PLUGINS, CSV). Each contributes
   *  `Custom_*` tools via the ToolRegistry. Empty (default) = no plugins. NOT npm package names. */
  plugins: string[];
  /** Opt-in: allow plugin tools to EXECUTE ABAP console classes (`ctx.run.classRun`, IF_OO_ADT_CLASSRUN).
   *  Default false. Running arbitrary ABAP is a mutation vector, so it ALSO requires `allowWrites=true`
   *  and the tool must declare `write` scope. A dedicated switch (not implied by `allowWrites`) so
   *  enabling built-in writes never silently grants plugins code execution. */
  allowPluginExecute: boolean;
  /** Opt-in: allow plugin tools to make low-level WRITE calls (`ctx.http.post`/`put`/`delete`) to
   *  **non-ADT** SAP paths (OData `/sap/opu/odata/…`, custom ICF `/sap/bc/http/…`). Default false.
   *  Writes to `/sap/bc/adt/…` object endpoints are ALWAYS refused (they need package-allowlist
   *  enforcement that this raw surface can't do — those wait for the v2 `ctx.write` vocabulary). Also
   *  requires `allowWrites=true` and a `write`-scoped tool. `SAP_ALLOWED_PACKAGES` does NOT constrain
   *  these calls (no ABAP package in an OData/ICF path) — the gates are this opt-in + `allowWrites` +
   *  scope + `denyActions` + SAP-side service auth (+ Cloud Connector allowlist on BTP). */
  allowPluginRawWrites: boolean;

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
  /** Cache mode: 'auto' (memory cache), 'memory', 'sqlite', 'none' */
  cacheMode: 'auto' | 'memory' | 'sqlite' | 'none';
  /** Path to SQLite cache file (default: .arc1-cache.db in working directory) */
  cacheFile: string;

  // --- Concurrency ---
  /** Maximum concurrent SAP HTTP requests, server-wide across all users (default: 10).
   *  Prevents work process exhaustion. With principal propagation, one shared semaphore
   *  enforces the cap across all per-user clients — not `maxConcurrent` per user.
   *  See docs/adr/0004-layered-rate-limiting.md (Layer 3). */
  maxConcurrent: number;

  // --- Rate limiting (Layer 1 + Layer 2) ---
  /** Per-IP cap on OAuth endpoints (`/register`, `/authorize`, `/token`, `/revoke`) in
   *  requests per minute. When the MCP override is unset, MCP traffic gets
   *  `max(value × 30, 600)/min/IP` to absorb legitimate batch traffic. Set `0` to
   *  disable only the OAuth bucket; disabling the MCP bucket requires an explicit
   *  `mcpHttpRateLimit: 0`. Default: 20.
   *  See docs_page/rate-limiting.md (Layer 1). */
  authRateLimit: number;
  /** Optional explicit per-IP cap shared by every MCP HTTP route, including
   *  pinned/aggregate multi-target routes and Copilot JSON-RPC on `/authorize`.
   *  Undefined preserves the historical `max(authRateLimit * 30, 600)` derivation;
   *  `0` explicitly disables only this MCP-edge limiter. */
  mcpHttpRateLimit?: number;
  /** Per-user cap on MCP tool calls in requests per minute. Key = authInfo.userName
   *  ?? clientId ?? '__anon__'. Stdio (no user identity) is exempt. Returns an MCP
   *  tool error with `retryAfter` (not HTTP 429). Set `>0` to enable Layer 2.
   *  **Default: `0` (disabled).** Layer 2 is the only layer that can fail
   *  user-visible work (the others return queue-waits or HTTP 429 to a
   *  consenting client), so it ships off by default and operators with
   *  multi-user deployments opt in. Layers 1 and 3 stay on by default —
   *  Layer 1 closes a CodeQL HIGH alert, Layer 3 is the per-PP-user
   *  semaphore bug fix that started this whole feature. See
   *  docs_page/rate-limiting.md and ADR-0004. */
  rateLimit: number;

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
  gzipDataPreviewBody: false,
  transport: 'stdio',
  httpAddr: '0.0.0.0:8080',
  serverName: 'arc-1',
  uiMode: 'off',
  uiAddr: '127.0.0.1:8711',
  uiOpen: false,
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
  allowHttpNoAuth: false,
  oidcDiscovery: true,
  oauthDcrTtlSeconds: 0, // 0 = never expire; positive opts into expiry (clamped 60s..90d) — see field JSDoc
  cimdEnabled: false, // CIMD is opt-in: enabling it makes ARC-1 fetch caller-chosen URLs
  cimdAllowedHosts: [], // empty = any HTTPS host, once cimdEnabled is on
  cimdCacheTtlSeconds: 900,
  btpOAuthCallbackPort: 0,
  multiTargetEndpoints: false,
  multiTargetAllowBasicAuth: false,
  ppEnabled: false,
  ppStrict: false,
  ppStrictExplicit: false,
  ppAllowSharedCookies: false,
  disableSaml2: false,
  toolMode: 'standard',
  schemaNullableOptionals: 'auto',
  plugins: [],
  allowPluginExecute: false,
  allowPluginRawWrites: false,
  lintBeforeWrite: true,
  checkBeforeWrite: false,
  cacheMode: 'auto',
  cacheFile: '.arc1-cache.db',
  maxConcurrent: 10,
  authRateLimit: 20,
  mcpHttpRateLimit: undefined,
  rateLimit: 0, // Layer 2 disabled by default — operators opt in (see ADR-0004)
  allowedOrigins: [],
  logLevel: 'info',
  logFormat: 'text',
  minimalErrors: false,
  verbose: false,
};
