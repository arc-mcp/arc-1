# Auth Module — SPEC (API-freeze candidate, v0)

> **Status:** Draft spec — the API-freeze gate before any code. **Date:** 2026-06-17. **Companion:** [`RESEARCH.md`](./RESEARCH.md) (rationale + ADRs).
> **Decisions locked this round:** rate-limit **OUT** of v1 · principal propagation **IN** v1 (`./btp` sub-module) · SDK floor **`>=1.18.2`** · `express ^5.0.1` (Express 4 is moot — SDK hard-forces 5).

This spec freezes: scope, entrypoints, dependency ranges, the logger contract, every public signature, the auth↔PP coupling contract, and the minimal-diff adoption path for each of the three consumers (arc-1, calmcp, LISA). Rationale and the version evidence live in `RESEARCH.md`; this document is the contract.

---

## 1. Package identity

| | |
|---|---|
| Org / repo | `github.com/arc-mcp/xsuaa-auth` (working) |
| npm | `@arc-mcp/xsuaa-auth` (working name — final at scaffold; never `marianfoo` scope) |
| Module system | **ESM-only**, `"type": "module"`, `engines.node >= 22` |
| Maintenance | solo |
| Release | release-please (`node`, single package, no `extra-files`) + npm OIDC trusted publishing (automatic provenance) |
| First version | `0.1.0` (0.x while the API settles across the 3 consumers) |

---

## 2. Scope

**IN (v1):**
- **Core auth (`.`)** — MCP client→server authentication: XSUAA OAuth proxy provider, stateless RFC 7591 DCR client store, the `#214` OAuth-state callback codec, chained bearer verifier (**XSUAA → OIDC → api-key**, each optional; order frozen to match arc-1 — correctness-immaterial since token types are disjoint), and a thin `setupHttpAuth` facade.
- **Principal propagation (`./btp`)** — BTP destination lookup, per-user PP token exchange, and the Cloud Connector connectivity-proxy descriptor.

**OUT (v1) — deliberately deferred or consumer-owned:**
- **Rate limiting** — deferred post-v1 (consumers keep their own; see §14).
- **Scope/tool policy** (`ACTION_POLICY`, arc-1's `expandScopes` semantics) — injected as an optional hook, never owned.
- **Safety ceiling, `ServerConfig`, the MCP tools, the SAP HTTP client** — consumer-owned.
- **`getAppUrl` / OAuth-metadata URL resolution** — stays in each consumer's transport (it's not a PP concern; LISA already inlines its own).
- **The Copilot Studio `/authorize` JSON-RPC bypass and reverse-proxy base-path metadata overrides** — arc-1 specials, kept in arc-1 via the building blocks.

---

## 3. Entrypoints (`exports` map)

```jsonc
"exports": {
  ".":            { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./btp":        { "types": "./dist/btp.d.ts",   "default": "./dist/btp.js" },
  "./package.json": "./package.json"
}
```
- `.` — core auth. Deps it needs: `@modelcontextprotocol/sdk` (peer), `express` (peer), `@sap/xssec`, `jose` (optional/lazy).
- `./btp` — PP. Deps it needs: `@sap-cloud-sdk/connectivity`. (Originally also `undici`; dropped in v0.1 — the code uses Node's global `fetch`, and the `proxyFetch` forward-proxy helper that would have needed `undici.ProxyAgent` is deferred, §14.)
- **No `./rate-limit` in v1.** `./testing` (mock verifiers/clients) is a v1.1 stretch (§14).

---

## 4. Dependencies (FROZEN ranges)

```jsonc
"peerDependencies": {
  "@modelcontextprotocol/sdk": ">=1.18.2 <2",
  "express": "^5.0.1",
  "jose": ">=5 <7"
},
"peerDependenciesMeta": {
  "jose": { "optional": true }   // OIDC-only, lazy-imported; non-OIDC consumers (calmcp) skip it
},
"dependencies": {
  "@sap/xssec": "^4",
  "@sap-cloud-sdk/connectivity": "^4.7.0"
}
```
> **Drift note (v0.1):** `undici ^8` was dropped from `dependencies`. The original plan kept it for a `proxyFetch` forward-proxy helper, but that helper is deferred (§14) and every call site uses Node's global `fetch`, so the dependency was dead weight. Re-add it if/when `proxyFetch` lands.
- **`@modelcontextprotocol/sdk` peer `>=1.18.2 <2`** — `1.18.2` is the first version exposing `mcpAuthRouter({ resourceServerUrl })` (PR #858); all other primitives exist since 1.12, no breaking override changes 1.12→1.29. `<2` because a v2 monorepo split (auth relocates, Express becomes a separate adapter) is alpha — opt in only after it's GA + tested.
- **`express` peer `^5.0.1`** — the SDK hard-depends on `express ^5.0.1` (since 1.6.0) / `^5.2.1` (since 1.26). Express 4 cannot coexist with the SDK's router. Don't tighten to `^5.2.1` (needlessly excludes SDK < 1.26 resolvers; the facade only uses stable 5.0 `RequestHandler`/`Router` types).
- **`@sap/xssec` dependency `^4`** — leaf token validator; not a shared instance. **Pure CommonJS** (no ESM entry) → consume via `import xssec from '@sap/xssec'; const { createSecurityContext, XsuaaService } = xssec;` with `esModuleInterop`; documented as a known interop edge (§12).
- **`@sap-cloud-sdk/connectivity ^4.7.0` dependency** — used only by `./btp`. All three consumers already pin this exact major, so no friction; a core-only consumer (calmcp) installs it unused (acceptable; calmcp has it already). (`undici` was originally listed here too but is dropped in v0.1 — see the drift note above.) `jose` is an **optional peer** (range `>=5 <7`, covers arc-1's 6.x and LISA's 5.x), lazy-imported so non-OIDC consumers (calmcp) need not install it.

**CI peer test-matrix:** `1.18.2 + 5.0.1` (floor), `1.25.3 + 5.0.1` (last pre-1.26), `1.28 + 5.2.1` (arc-1/calmcp prod), `1.29 + 5.2.1` (latest). Node **22 + 24** (the package's `engines.node >= 22` floor — matches arc-1). A `tsc --noEmit` typecheck pinned at the `1.18.2 + 5.0.1` floor (excess-property errors surface only there).

---

## 5. Logger contract

```ts
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  emitAudit?(event: Record<string, unknown>): void;
}
```
- **Injected, optional, default no-op.** Argument order is `(message, data)` — matches arc-1 + LISA (the source). `emitAudit` is optional (arc-1/LISA have it; the package calls it only when present).
- **calmcp uses pino**, whose order is `(obj, msg)`. calmcp passes a ~3-line adapter: `{ debug:(m,d)=>pino.debug(d??{},m), ... }`. Documented in the migration guide.

---

## 6. Core auth API (`.`) — FROZEN

```ts
// ─── Re-exported SDK types (behind the insulation layer, §8) ───
export type { AuthInfo, OAuthClientInformationFull } from './internal/sdk.js';
export type Verifier = (token: string) => Promise<AuthInfo>;

// ─── XSUAA binding ───
export interface XsuaaCredentials {
  url: string; clientid: string; clientsecret: string;
  xsappname: string; uaadomain: string; verificationkey?: string;
}

// ─── API keys ───
export interface ApiKeyEntry { key: string; scopes?: string[]; clientId?: string }

// ─── Scope hook (injected policy; default identity) ───
export type ExpandScopes = (scopes: string[]) => string[];

// ─── Config-loading helpers (Layer-0 plug-and-play) ───
export function loadXsuaaCredentials(env?: NodeJS.ProcessEnv): XsuaaCredentials;   // reads + validates the bound XSUAA service (VCAP_SERVICES / service binding)
export function resolveAppUrl(env?: NodeJS.ProcessEnv, options?: { publicUrlEnvVar?: string; port?: number }): string;   // VCAP_APPLICATION route, overridable by a configurable public-URL env var (e.g. ARC1_PUBLIC_URL)

// ─── Stateless DCR client store ───
export interface StatelessDcrClientStoreOptions {
  clientIdPrefix?: string;            // default 'mcp-'
  kdfLabel?: string;                  // default 'mcp-dcr/v1'  (domain-separation / revocation knob)
  ttlSeconds?: number;                // default 30d; 0 disables expiry
  redirectUriPatterns?: readonly string[]; // default XSUAA_DEFAULT_REDIRECT_URI_PATTERNS
  defaultRedirectUris?: readonly string[];  // default XSUAA_DEFAULT_REDIRECT_URIS
  now?: () => number;
  logger?: Logger;
}
export class StatelessDcrClientStore /* implements OAuthRegisteredClientsStore */ {
  constructor(xsuaaClientId: string, xsuaaClientSecret: string, signingSecret: string, options?: StatelessDcrClientStoreOptions);
  getClient(clientId: string): Promise<OAuthClientInformationFull | undefined>;
  registerClient(client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>): Promise<OAuthClientInformationFull>;
  ensureRedirectUri(clientId: string, uri: string): void;
  checkRedirectUri(clientId: string, uri: string): Promise<'ok' | 'unknown_client' | 'unregistered'>;
}
export const XSUAA_DEFAULT_REDIRECT_URI_PATTERNS: readonly string[];
export const XSUAA_DEFAULT_REDIRECT_URIS: readonly string[];
export function validateRedirectUri(uri: string, patterns?: readonly string[]): void;
export function matchesRedirectPattern(uri: string, patterns?: readonly string[]): boolean;

// ─── OAuth-state codec (the #214 `+`-bug callback proxy) ───
export interface OAuthStateCodecOptions { kdfLabel?: string /* 'mcp-oauth-state/v1' */; ttlSeconds?: number /* 600 */ }
export class OAuthStateCodec {
  constructor(signingSecret: string, options?: OAuthStateCodecOptions);
  encode(input: { clientState?: string; clientRedirectUri: string; clientId: string; now?: number }): string;
  decode(token: string, now?: number): DecodeResult;
}
export type DecodeResult =
  | { kind: 'ok'; clientState?: string; clientRedirectUri: string; clientId: string }
  | { kind: 'error'; reason: 'malformed' | 'bad_signature' | 'invalid_payload' | 'expired' };

// ─── XSUAA OAuth provider ───
export interface CreateXsuaaOAuthProviderOptions {
  clientIdPrefix?: string; dcrKdfLabel?: string; stateKdfLabel?: string;
  dcrTtlSeconds?: number; stateTtlSeconds?: number; dcrSigningSecret?: string;
  redirectUriPatterns?: readonly string[]; defaultRedirectUris?: readonly string[];
  callbackUrl?: string; logger?: Logger;
}
export function createXsuaaOAuthProvider(
  credentials: XsuaaCredentials, appUrl: string, options?: CreateXsuaaOAuthProviderOptions,
): { provider: XsuaaProxyOAuthProvider; clientStore: StatelessDcrClientStore; stateCodec: OAuthStateCodec };
export class XsuaaProxyOAuthProvider { /* extends the SDK ProxyOAuthServerProvider via the §8 insulation layer */ }

// ─── Verifiers ───
// `acceptedScopes` (default DEFAULT_ACCEPTED_SCOPES = the arc-1 set
// ['read','write','data','sql','transports','git','admin']) is the set of scope
// names kept from the token; a consumer with different names (e.g. calmcp's
// 'Viewer') overrides it so its scopes aren't silently dropped. `expandScopes` is
// applied EXACTLY once by each sub-verifier (the chain does NOT re-apply it).
export function createXsuaaTokenVerifier(
  credentials: XsuaaCredentials, options?: { expandScopes?: ExpandScopes; acceptedScopes?: string[]; logger?: Logger },
): Verifier;
export function createOidcVerifier(   // lazy-imports jose
  issuer: string, audience: string,
  options?: { clockToleranceSec?: number; scopeClaim?: string; algorithms?: string[]; acceptedScopes?: string[]; fallbackScopes?: string[]; expandScopes?: ExpandScopes; logger?: Logger },
): Verifier;   // algorithms default ['RS256','ES256','PS256'] — pins allowed JWT algs (closes alg:none / algorithm-confusion). fallbackScopes default [] — fail closed when a verified token carries no accepted scope; set ['read'] for legacy read-only fallback
export function createApiKeyVerifier(keys: string | ApiKeyEntry[], options?: { expandScopes?: ExpandScopes; logger?: Logger }): Verifier;
export function createChainedTokenVerifier(   // does NOT re-apply expandScopes — the sub-verifiers own it (applied once)
  config: { apiKeys?: string | ApiKeyEntry[] },
  xsuaaVerifier?: Verifier, oidcVerifier?: Verifier,
  options?: { expandScopes?: ExpandScopes; logger?: Logger },
): Verifier;
export function qualifyXsuaaScopes(scopes: string[], xsappname: string): string[];

// ─── OAuth callback handler (the #214 proxy second half) ───
export function createOAuthCallbackHandler(
  stateCodec: OAuthStateCodec, clientStore?: StatelessDcrClientStore, options?: { logger?: Logger },
): import('express').RequestHandler;

// ─── Facade (plug-and-play; covers the standard XSUAA+DCR+callback+bearer flow) ───
export interface AuthOptions {
  apiKeys?: string | ApiKeyEntry[];
  xsuaa?: {
    credentials: XsuaaCredentials; appUrl: string;
    clientIdPrefix?: string; dcrKdfLabel?: string; stateKdfLabel?: string;
    resourceName?: string; scopesSupported?: string[]; requiredScopes?: string[];
    redirectUriPatterns?: readonly string[]; defaultRedirectUris?: readonly string[];
    dcrTtlSeconds?: number; stateTtlSeconds?: number; dcrSigningSecret?: string;
    callbackUrl?: string;   // this server's own /oauth/callback sent to XSUAA (#214); default `${appUrl}/oauth/callback`
  };
  oidc?: { issuer: string; audience: string; clockToleranceSec?: number; algorithms?: string[]; scopeClaim?: string; fallbackScopes?: string[] };   // fallbackScopes default [] (fail closed); ['read'] = legacy read-only fallback
  allowedOrigins?: string[];   // CORS allowlist for browser MCP clients (e.g. https://claude.ai); facade applies exact-match CORS + credentials. Unset = no CORS.
  required?: boolean;          // default false → returns undefined (open) with a loud warn; true → throws if no auth method configured
  expandScopes?: ExpandScopes;
}
export function setupHttpAuth(
  app: import('express').Express, options: AuthOptions, logger?: Logger,
): import('express').RequestHandler | undefined;   // bearer middleware for /mcp; undefined when no method configured
```

Notes:
- **`requiredScopes`** is enforced by the facade via the SDK's `requireBearerAuth({ requiredScopes })`; building-block users enforce scopes themselves. (calmcp sets `requiredScopes: ['Viewer']`; LISA/arc-1 leave it unset.) The facade derives `issuerUrl`/`baseUrl`/`resourceServerUrl` from `xsuaa.appUrl` and mounts the standard `/authorize` `ensureRedirectUri` (pattern-gated) + `/oauth/callback` + `mcpAuthRouter`.
- **`expandScopes`** is the injected policy seam (default identity), applied **exactly once** — by each sub-verifier (XSUAA/OIDC/api-key) to the scopes it extracts before returning `AuthInfo`. `createChainedTokenVerifier` does **NOT** re-apply it (re-application would double a non-idempotent expander); it only builds its internal api-key verifier with the same hook so the api-key path expands once too. arc-1 passes its `authz/policy` fn so AuthInfo carries expanded scopes exactly as today; calmcp/LISA omit it. The facade threads it into every verifier uniformly; building-block users pass it per verifier.
- **`acceptedScopes`** (verifier option; default `DEFAULT_ACCEPTED_SCOPES` = the arc-1 set) is the scope-name allowlist applied to the token's claims. The facade threads `xsuaa.scopesSupported` (when set) into both the XSUAA and OIDC verifiers as `acceptedScopes`, so a consumer that advertises non-arc-1 scopes (calmcp: `scopesSupported:['Viewer']`) keeps them instead of having them filtered out.
- **`fallbackScopes`** (OIDC verifier option; default `[]`) is the **fail-closed** scope set returned when a *verified* OIDC token carries no accepted scope — either it has no `scope`/`scp` claims at all, or its claims survive verification but none match `acceptedScopes`. The default `[]` grants **no** privileges, so an IdP that is misconfigured to drop scope claims cannot silently hand out access. A consumer that wants the historical read-only fallback opts in explicitly with `fallbackScopes: ['read']` (arc-1 does this to preserve its prior default). `fallbackScopes` is **not** run through `expandScopes` — it is an already-final grant chosen by the consumer, not a token-derived scope set. The facade exposes it as `oidc.fallbackScopes`.
- **api-key profiles** are not a package concept: arc-1 maps its `API_KEY_PROFILES` → `ApiKeyEntry[]` (`{key, scopes}`) before passing.
- The facade does **not** include arc-1's Copilot `/authorize` bypass or reverse-proxy base-path overrides — those stay in arc-1's `startHttpServer` using the building blocks.
- When `options.xsuaa` is omitted (api-key/OIDC only), the facade builds the chained verifier and returns bearer middleware **without** mounting the OAuth router/callback — mirroring arc-1's non-XSUAA path (`createStandardVerifier`).
- **Verifier chain order is frozen as `XSUAA → OIDC → api-key`** (matches arc-1). Correctness-immaterial (token types are disjoint — an api-key never validates as a JWT; an XSUAA JWT never validates against the OIDC issuer), but pinned for determinism + test stability. calmcp's PR adapts from its current api-key-first order (called out in its PR description).
- **CORS + COOP (browser / popup OAuth):** when `allowedOrigins` is set the facade applies a built-in exact-match CORS handler (`credentials:true` + MCP headers; no `cors` dep). The facade sets **no restrictive `Cross-Origin-Opener-Policy`** — popup OAuth (Copilot Studio, claude.ai) breaks under `COOP: same-origin`. Broad hardening (helmet CSP/HSTS) stays consumer-owned; a consumer adding helmet must disable COOP. arc-1 keeps its own `applySecurityMiddleware` via the building-block path.
- **Redirect-URI validation is fail-closed (normative):** `validateRedirectUri` throws on malformed/disallowed input; `matchesRedirectPattern` returns `false` on parse failure. The DCR store's `redirectUriPatterns` MUST stay in sync with the XSUAA service's `xs-security.json` `oauth2-configuration.redirect-uris`.
- **`emitAudit` is always null-guarded** (`logger.emitAudit?.(…)`); the package never assumes it exists.
- **Layer-0 plug-and-play:** `loadXsuaaCredentials()` + `resolveAppUrl()` let a consumer write `setupHttpAuth(app, { xsuaa: { credentials: loadXsuaaCredentials(), appUrl: resolveAppUrl() }, apiKeys }, logger)` with no hand-parsed binding.

---

## 7. Principal-propagation API (`./btp`) — FROZEN

Lifted near-verbatim from arc-1 `src/adt/btp.ts` (LISA's copy is byte-identical). The **only** refactor is the logger seam (optional trailing `logger?` param; default no-op).

```ts
export interface BTPConfig {
  xsuaaUrl: string; xsuaaClientId: string; xsuaaSecret: string;
  destinationUrl: string; destinationClientId: string; destinationSecret: string; destinationTokenUrl: string;
  connectivityProxyHost: string; connectivityProxyPort: string; connectivityClientId: string;
  connectivitySecret: string; connectivityTokenUrl: string;
}
export interface Destination {
  Name: string; URL: string; Authentication: string; ProxyType: string; User: string; Password: string;
  'sap-client'?: string; CloudConnectorLocationId?: string;
}
export interface BTPProxyConfig { host: string; port: number; protocol: string; getProxyToken: () => Promise<string>; locationId?: string }
export interface PerUserAuthTokens { sapConnectivityAuth?: string; bearerToken?: string; ppProxyAuth?: string }

export function parseVCAPServices(env?: NodeJS.ProcessEnv): BTPConfig | null;   // env defaults to process.env
export function lookupDestination(btpConfig: BTPConfig, name: string, logger?: Logger): Promise<Destination>;
export function lookupDestinationWithUserToken(            // ← the PP primitive
  btpConfig: BTPConfig, name: string, userJwt: string, logger?: Logger,
): Promise<{ destination: Destination; authTokens: PerUserAuthTokens }>;
export function createConnectivityProxy(btpConfig: BTPConfig, locationId?: string, logger?: Logger): BTPProxyConfig | null;
export function resolveBTPDestination(name: string, logger?: Logger): Promise<{
  url: string; username: string; password: string; client: string; proxy: BTPProxyConfig | null;
}>;
```

- **`@sap-cloud-sdk/connectivity`** does the destination-service call + `X-User-Token` + per-user cache; the jwt-bearer "Option 2" fallback is a raw global-`fetch` call that validates the JWT then re-sends the **original** user JWT as `SAP-Connectivity-Authentication`. (Behavior preserved exactly from arc-1.)
- **Not in v1, optional/future:** a shared `proxyFetch(proxy, target, logger?)` forward-proxy helper. arc-1 + LISA reimplement it identically inside their HTTP clients, but ripping it out of arc-1's `AdtHttpClient` (CSRF/cookies/stateful sessions) is a non-trivial edit that conflicts with the minimal-diff goal. Ship the `BTPProxyConfig` descriptor only; consumers keep their own proxy-request code. Revisit once arc-1's HTTP client is otherwise touched.
- **The package returns credentials + a proxy descriptor; it never applies them.** What to do when no PP token is produced (arc-1 throws; LISA falls back to BasicAuth) is **consumer policy** — `lookupDestinationWithUserToken` returns a possibly-empty `PerUserAuthTokens` and the consumer decides.
- **`lookupDestinationWithUserToken` is JWT-only (anti-footgun):** it validates `userJwt` is a 3-segment JWT and throws a typed error otherwise — PP needs a per-user user token, not an API key. (arc-1 guards this at its call site today; the package now guards it for every consumer.)
- **`parseVCAPServices` is a helper, not policy:** destination/connectivity *names* and env semantics stay consumer-owned (passed as params). `ttlSeconds <= 0` normalizes to "no expiry" consistently in both the DCR store and `OAuthStateCodec`.

---

## 8. SDK-insulation requirement (v2-proofing)

All `@modelcontextprotocol/sdk/server/auth/*` imports are confined to **one internal module** (`src/internal/sdk.ts`) that re-exports the symbols and types the package uses (`ProxyOAuthServerProvider`, `mcpAuthRouter`, `requireBearerAuth`, `OAuthRegisteredClientsStore`, `AuthInfo`, `OAuthClientInformationFull`) behind package-owned names. The SDK v2 monorepo split (auth → `@modelcontextprotocol/server`, Express → `@modelcontextprotocol/express`, path changes) then becomes a **one-file migration**. No other source file imports the SDK directly.

---

## 9. Coupling contract

- **auth → PP:** the sole handoff is the **raw, already-verified bearer JWT (string)**. The verifier produces `AuthInfo` (with `.token`); the consumer passes `authInfo.token` to `lookupDestinationWithUserToken(btpConfig, name, token)`. PP touches no scopes/clientId/AuthInfo shape. The package does **not** wire this — the consumer does (arc-1: `extra.authInfo.token` → `createPerUserClient`; LISA: `token` → `I18nClient`).
- **PP → SAP request:** the package returns `{ destination, authTokens, proxy }`; the consumer's SAP HTTP client applies them (`Authorization`/`SAP-Connectivity-Authentication`/proxy). That client stays consumer-owned.
- **`dcrSigningSecret`** stabilizes DCR client_ids across restarts; defaults to the XSUAA `clientsecret` when omitted (documented; rotating it or bumping `kdfLabel` is the revocation knob).

---

## 10. What stays in each consumer

The SAP HTTP client (arc-1 `AdtHttpClient`, LISA `I18nClient`, calmcp `CalmHttpClient`); `applyPerUserAuthTokens` / header assembly; the proxy-request code (until `proxyFetch` lands); `getAppUrl`; the scope/tool policy (`expandScopes` source, `ACTION_POLICY`); the safety ceiling + `ServerConfig`; arc-1's Copilot `/authorize` bypass and base-path metadata; the MCP transport itself (`startHttpServer`).

---

## 11. Minimal-diff adoption

**arc-1 (primary goal — import-swap + glue, no logic change):**
- `.`: in `http.ts`, swap 5 imports `./server/*` → `@arc-mcp/xsuaa-auth`; map the ~10 `ServerConfig` fields → `AuthOptions`; pass `config.logger`; pass `authz/policy.expandScopes` as the `expandScopes` hook; build `ApiKeyEntry[]` from `API_KEY_PROFILES`. `startHttpServer` (incl. Copilot bypass + base-path) stays.
- `./btp`: delete `src/adt/btp.ts`; repoint ~5 call sites + the `BTPConfig`/`BTPProxyConfig`/`PerUserAuthTokens` type imports to `@arc-mcp/xsuaa-auth/btp`; pass `logger` to the btp calls. `AdtHttpClient`/`applyPerUserAuthTokens`/`createPerUserClient` unchanged.
- Net: import repoints + logger injection + config mapping. Delete ~1,160 LOC (auth modules + btp). Lower `check:sizes`.

**calmcp (near-zero diff):** delete `src/httpAuth/`; `setupHttpAuth(app, authOptions, pinoAdapter(logger))` at the existing call site; set `clientIdPrefix:'calmcp-'`, `requiredScopes:['Viewer']`, `scopesSupported:['Viewer']`, `resourceName`. No PP (doesn't import `./btp`). Its PR also notes the chain-order change (api-key-first → frozen XSUAA→OIDC→api-key; outcome-identical).

**LISA (small diff):** adopt building blocks it already calls (`createChainedTokenVerifier`, `createXsuaaOAuthProvider`, `createOidcVerifier`, `createOAuthCallbackHandler`, `StatelessDcrClientStore`); inject its logger; **bump SDK `^1.12` → `>=1.18.2`** and **align `express → ^5`** (it declares `^4.21` but already resolves 5 transitively via the SDK); delete its `src/server/*` auth + `src/sap/btp.ts`, import `./btp`; set `clientIdPrefix:'sapt-'`.

**Live-deployment coverage (verified via CF — `arc1-mcp-joule2` + `arc1-mcp-test`, org Marian_Zeis_joule2/space dev):** every auth-relevant deployed param maps to a v1 config knob —

| Deployed param | v1 config |
|---|---|
| `SAP_XSUAA_AUTH=true` | `AuthOptions.xsuaa` present |
| `ARC1_API_KEYS` | `AuthOptions.apiKeys` |
| `ARC1_ALLOWED_ORIGINS` (`https://claude.ai`) | `AuthOptions.allowedOrigins` |
| `ARC1_PUBLIC_URL` (API-Management reverse proxy) | `xsuaa.appUrl` / `resolveAppUrl({ publicUrlEnvVar:'ARC1_PUBLIC_URL' })` |
| `SAP_BTP_DESTINATION=SAP_TRIAL` (technical) | `./btp` `resolveBTPDestination(name)` |
| `ARC1_OAUTH_DCR_TTL_SECONDS` (unset→30d; `0` for Copilot CLI/Cursor) | `xsuaa.dcrTtlSeconds` |
| `ARC1_DCR_SIGNING_SECRET` | `xsuaa.dcrSigningSecret` |
| XSUAA scopes + redirect-uris (`xs-security.json`, incl. `…azure-apim.net/redirect/**` for MS Copilot) | `scopesSupported` + `redirectUriPatterns` (shipped defaults already include the azure-apim pattern) |

Out of module scope (stays consumer env): `SAP_ALLOW_*` / `SAP_ALLOWED_PACKAGES` (safety ceiling), `SAP_INSECURE` / `SAP_SYSTEM_TYPE` / `SAP_TRANSPORT` / `SAP_LANGUAGE` (SAP connection). **Note:** the live apps do **not** set `SAP_PP_ENABLED` — they use a shared technical destination, so the current MS Copilot path is XSUAA-OAuth/API-key client auth → technical SAP identity. PP ships in v1 for per-user deployments but is not exercised by the current Copilot test.

---

## 12. Packaging, build, publish

- ESM-only; `exports` map (types-first, `default` last); `sideEffects:false`; `engines.node>=22`.
- Build: plain `tsc` (`NodeNext`, `declaration:true`). **`isolatedDeclarations` is deferred** (not enabled in `tsconfig.json` as of v0.1): turning it on surfaces a small number of `TS9010`/`TS9017` "needs an explicit type annotation" errors (e.g. the `RESERVED_OAUTH_SCOPES` `Set` literal). The build is correct without it, and the perf/parallelism payoff `isolatedDeclarations` buys only matters at much larger scale, so it's a deliberate post-v1 cleanup (annotate the flagged exports, then flip the flag) rather than a blocker. New code SHOULD still be written isolatedDeclarations-clean (explicit annotations on exported `const`s) to keep the eventual flip a no-op.
- `@sap/xssec` is **pure CJS** → default-import + destructure, `esModuleInterop`; README calls out this interop edge.
- Publish gate: `publint && attw --pack . --profile esm-only` green; `npm test`; `tsc --noEmit` at the peer floor.
- release-please (`node`, no `extra-files`) → `release_created`-gated npm publish via OIDC (Node ≥22.14 / npm ≥11.5.1, `id-token: write`, automatic provenance, no `NPM_TOKEN`).

---

## 13. Versioning & quality gates

- Start `0.1.0`; option/knob changes are semver-relevant.
- Repo quality (mirror arc-1 + auth-lib hardening): biome, vitest (consolidate the triplicate test suites), husky/lint-staged, dependabot (npm+actions), SHA-pinned third-party actions, `npm audit --audit-level=high`, dependency-review, SECURITY.md + **GitHub Private Vulnerability Reporting**, **CodeQL** (`security-extended`), **OpenSSF Scorecard** (required check), YAML issue forms + PR template, CODEOWNERS on `/.github/workflows/` + auth source, `examples/` (runnable per-scenario TS apps), docs = TypeDoc + typedoc-plugin-markdown → VitePress.

---

## 14. Deferred / open

- **Rate limiting** — post-v1. (arc-1's `auth-rate-limit` + `mcp-rate-limit` are generic; revisit as a `./rate-limit` sub-module once core ships and a consumer asks. Until then all three keep their own.)
- **`proxyFetch` shared forward-proxy helper** — once arc-1's `AdtHttpClient` is otherwise touched (§7).
- **`./testing` mocks** — mock `Verifier`/`Destination` for consumers' tests; v1.1 stretch.
- **npm final name** (`@arc-mcp/xsuaa-auth` recommended), **docs-site choice** (VitePress recommended).
- **SDK v2 path** — adopt only after v2 GA + tested; the §8 insulation makes it a one-file change.
- **IAS / SAP Cloud Identity Services** (`@sap/xssec` `IdentityService`) — the package is XSUAA-specific by name; SAP is steering new apps toward IAS, so a sibling `IdentityService` verifier is a roadmap candidate, not v1.

---

## 15. Non-goals

A generic "any OAuth provider" framework (this is XSUAA-centric); embedding arc-1 as a library (that's FEAT-29g, separate); owning the MCP transport; owning scope/tool policy or the SAP HTTP client; per-client DCR revocation (only TTL / signing-key rotation).
