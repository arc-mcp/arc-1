# Auth Module — Extraction Research & Decisions

> ⚠️ **`SPEC.md` is the authoritative contract** (frozen deps, API, scope). Where this research doc differs, the SPEC wins — notably: `express` resolved to **`^5.0.1`** (Express 4 is moot; the MCP SDK hard-depends on express 5), SDK floor **`>=1.18.2`**, rate-limit **out of v1**, PP **in v1** (`./btp`), and the verifier chain order **frozen as XSUAA→OIDC→api-key**. This doc is retained for rationale/history.

> **Status:** Research / pre-spec. **Date:** 2026-06-17. **Workstream:** Fork A (auth module).
> **Org:** `github.com/arc-mcp` (standalone repo). **Maintenance:** solo. **npm:** `@arc-mcp/xsuaa-auth` (scoped — published under the `arc-mcp` npm org; never `marianfoo`). **Repo:** `arc-mcp/xsuaa-auth`.
> **End goal:** a frozen SPEC. This doc gathers evidence and proposes ADRs (each with a recommendation) to confirm *before* the spec.

Grounded in three investigations (2026-06-17): (1) ARC-1 auth current-state (exact signatures + coupling), (2) calmcp + LISA auth teardown (3-way diff), (3) external best-practice research (ESM packaging, MCP SDK auth, @sap/xssec, release/publish). Versions below were verified against primary sources, not recalled.

---

## 1. Goals & constraints (ranked)

1. **PRIMARY — minimal change for ARC-1.** The package API must let ARC-1 adopt it with an import-swap + tiny glue, not a rewrite. ARC-1 keeps `startHttpServer` (its orchestrator); the package provides the building blocks it already calls.
2. **Replace calmcp + LISA custom code via PRs.** After ARC-1 adopts, ship PRs to both external repos that delete their copied auth and depend on the package — smallest possible diff each.
3. **Plug-and-play initial usage.** A near-zero-config happy path; special config only when the use case needs it.
4. **ARC-1-grade repo quality.** Superb docs, release-please, tests, issue templates, samples, CI — security-sensitive-library posture.

Tension to resolve up front: (1) "minimal ARC-1 diff" wants the **low-level building blocks** ARC-1 already calls; (3) "plug-and-play" wants a **high-level one-liner**; (2) calmcp already uses a high-level facade while LISA hand-wires building blocks. → resolved by **ADR-003 (two-layer API)**.

---

## 2. Current state — ARC-1 auth anatomy

Files in scope (`src/server/` unless noted), with exact public surface:

| Module | LOC | Public surface (abbrev.) | ARC-1 coupling |
|---|---|---|---|
| `stateless-client-store.ts` | ~590 | `class StatelessDcrClientStore(xsuaaClientId, xsuaaClientSecret, signingSecret, opts?)` impl `OAuthRegisteredClientsStore`; `matchesXsuaaRedirectPattern`, `validateRedirectUri`, `XSUAA_REDIRECT_URI_PATTERNS` | `logger` singleton; const `ID_PREFIX='arc1-'`, `KDF_LABEL='arc1-dcr/v1'` |
| `oauth-state.ts` | ~150 | `class OAuthStateCodec(signingSecret, {ttlSeconds?})` → `encode/decode`; `type DecodeResult` | **none** (pure crypto codec); const `KDF_LABEL='arc1-oauth-state/v1'` |
| `xsuaa.ts` | ~590 | `createXsuaaTokenVerifier(creds)`, `createChainedTokenVerifier(cfg, xsuaaV?, oidcV?)`, `createXsuaaOAuthProvider(creds, appUrl, opts?) → {provider, clientStore, stateCodec}`, `class XsuaaProxyOAuthProvider`, `qualifyXsuaaScopes`, `interface XsuaaCredentials`, `CreateXsuaaOAuthProviderOptions` | `expandScopes` ← `authz/policy`; `API_KEY_PROFILES` ← `config`; `logger`; hardcoded scope list `[read,write,data,sql,transports,git,admin]` |
| `auth-rate-limit.ts` | ~124 | `createAuthRateLimiter(endpoint, perMinute, opts?) → RequestHandler`, `isCopilotJsonRpc(req)` | `logger` (audit) |
| `mcp-rate-limit.ts` | ~113 | `createMcpRateLimiter(perMinute) → McpRateLimiter`, `resolveRateLimitUserKey(authInfo)`, types | **none** |
| `adt/btp.ts` | ~571 | `parseVCAPServices`, `lookupDestination(WithUserToken)`, `createConnectivityProxy`, `resolveBTPDestination`, `getAppUrl` | `logger`; reads `VCAP_*`/`SAP_BTP_*` env directly |
| `http.ts` (auth slice only) | ~300 of 972 | `createOAuthCallbackHandler(stateCodec, clientStore?)`, `createStandardVerifier(config)`, `extractOidcScopes(payload)`; the wiring in `startHttpServer` | `ServerConfig`, `expandScopes`, `API_KEY_PROFILES`, `logger`, `VERSION`, `getAppUrl` |

**Wiring sequence** (in `startHttpServer`, XSUAA branch): resolve `appUrl` (`getAppUrl()`) → `createXsuaaOAuthProvider(creds, appUrl, {dcrTtlSeconds, dcrSigningSecret, callbackUrl})` → `createXsuaaTokenVerifier` + optional `createOidcVerifier` → `createChainedTokenVerifier(config, xsuaaV, oidcV)` → `requireBearerAuth({verifier, resourceMetadataUrl})` → mount Layer-1 rate limiters on `/register|/authorize|/token|/revoke|/oauth/callback` → `/authorize` shim (`ensureRedirectUri` + Copilot JSON-RPC bypass) → `GET /oauth/callback` (the #214 proxy) → optional base-path metadata overrides → `mcpAuthRouter({provider, issuerUrl, baseUrl, resourceServerUrl, scopesSupported, resourceName})` → `/mcp` rate-limit → `app.all('/mcp', bearerAuth, mcpHandler)`.

**Coupling seams to cut (from the deep read):** ① logger singleton → inject; ② hardcoded scope names → param; ③ `expandScopes` (policy) → inject/optional; ④ `API_KEY_PROFILES` → accept `keys→scopes` directly; ⑤ `ServerConfig` → small options object; ⑥ `ID_PREFIX`/`KDF_LABEL`×2 → params; ⑦ redirect patterns → param (defaults shipped); ⑧ `resourceName` → param; ⑨ btp env reads → keep out of package; ⑩ error-page HTML → optional override.

**Auth-layer npm deps today:** `@modelcontextprotocol/sdk ^1.28`, `@sap/xssec ^4.13`, `@sap-cloud-sdk/connectivity ^4.7` (btp only), `jose ^6.2` (OIDC, lazy), `express ^5.2`, `express-rate-limit ^8.5`, `rate-limiter-flexible ^11.1`, `helmet`, `cors`, `node:crypto`.

---

## 3. Three-way reality check (arc-1 / calmcp / LISA)

The crypto core (`stateless-client-store`, `oauth-state`, `XsuaaProxyOAuthProvider`) is **verbatim-identical** across all three. All divergence is in the **wiring/entry layer** — which is exactly what the package must get right.

| Dimension | arc-1 | calmcp | LISA |
|---|---|---|---|
| **Entry shape** | building blocks, wired in `startHttpServer` | **facade** `setupHttpAuth(app, opts, logger)` | **building blocks**, hand-wired in `http.ts` (doesn't even use SDK `requireBearerAuth`) |
| **Config model** | full `ServerConfig` | **small** `HttpAuthOptions` (2 fields) | full app `Config` (~20 fields) injected |
| **Logger** | singleton `(msg, data)` + `emitAudit` | **pino**, injected `(obj, msg)` ⚠ arg-order | custom class singleton `(msg, data)` + `emitAudit` |
| **@sap/xssec** | ^4.13 | ^4.13 | ^4.2 |
| **MCP SDK** | ^1.28 | ^1.28 | **^1.12** |
| **express** | ^5.2 | **^5** | **^4.21** |
| **rate-limit** | 2 layers | 1 (in transport) | 2 (in transport) |
| **OIDC** | yes (jose) | **no** | yes (jose ^5.9) |
| **api-key** | multi, profile→scopes | **single** static key | multi `key:profile` |
| **local scope check** | full policy | one (`Viewer`) | **none** (auth-only) |
| **PP / btp** | full | **none** | full (threads user JWT itself) |
| **prefix / kdf** | `arc1-` / `arc1-dcr,oauth-state` | `calmcp-` / `calmcp-*` | `sapt-` / `lisa-*` |

**Migration verdicts:** calmcp → expose its exact `setupHttpAuth(app, opts, logger)` facade ⇒ ~3-line diff. LISA → expose the granular building blocks it already calls (`createChainedTokenVerifier`, `createXsuaaOAuthProvider`, `createOAuthCallbackHandler`, `StatelessDcrClientStore`, …) ⇒ small diff, **its blocker is logger injection** (currently imports a singleton). arc-1 → building blocks + keep `startHttpServer`.

**Hard divergences the API must absorb:** logger contract incl. **pino arg-order** (`(obj,msg)` vs `(msg,obj)`); **MCP SDK 1.12↔1.28** spread; **Express 4↔5**; small-vs-big config; scope opt-in vs none; OIDC present/absent; api-key single/list; PP out entirely.

---

## 4. Scope — in / out

**IN (the package):**
- Stateless DCR client store (RFC 7591, HMAC-signed client_ids).
- OAuth state codec (the #214 `+`-bug callback proxy).
- XSUAA OAuth proxy provider + token verifier (`@sap/xssec`).
- Chained bearer verifier (api-key → XSUAA → OIDC), each optional.
- Optional OIDC verifier (jose).
- API-key verifier (single string **or** `{key, scopes}[]`).
- OAuth callback handler + `/authorize` redirect-uri shim helper.
- Redirect-uri validation + default patterns (the shared vendored lists).
- **Optional sub-module:** the two rate-limit helpers (per-IP + per-user) — generic, all three use them (ADR-015).
- A thin `setupHttpAuth` facade (plug-and-play) over the above.

**OUT (stays per-consumer):**
- **Principal propagation / BTP destination/connectivity** (`btp.ts`). It's the SAP-*client* layer, not client→server auth; the package's job ends at producing `AuthInfo` + the raw bearer token. LISA threads the token to SAP itself; calmcp has no PP. (Reconsider as a *separate* future package, never bundled here.)
- **Scope/tool policy** (`ACTION_POLICY`, `expandScopes` as arc-1 defines it) — injectable, not owned.
- **Safety ceiling, ServerConfig, MCP tools, the SAP backend client.**
- **MCP transport ownership** (the host owns `stdio`/`http-streamable`; the package contributes middleware + a router).

---

## 5. Architecture Decision Records (proposed — confirm before spec)

> These graduate to individual `docs/adr/NNNN-*.md` once confirmed.

### ADR-001 — Repo, org, naming
**Context:** New org `arc-mcp`; solo; no `marianfoo` scope; name deferrable.
**Options:** `@arc-mcp/auth` · `@arc-mcp/xsuaa-auth` · `@arc-mcp/mcp-btp-auth`.
**Recommendation:** repo `arc-mcp/auth`; npm **`@arc-mcp/xsuaa-auth`** (most descriptive — XSUAA-centric MCP auth; leaves room for a sibling `@arc-mcp/*` later). Confirm name at scaffold.
**Consequences:** Org scope decouples from personal identity; scoped packages publish fine under OIDC trusted publishing.

### ADR-002 — Package contents / module boundary
**Context:** §4 in/out.
**Recommendation:** Ship the transport-auth layer (§4 IN). **Exclude `btp.ts`/PP** and policy/safety/config. Rate-limit helpers go in an **optional sub-export** (ADR-015), not the core.
**Consequences:** Smaller, security-focused surface; PP stays where identity-threading lives; no consumer inherits arc-1's policy engine.

### ADR-003 — Two-layer public API (the key decision)
**Context:** minimal-arc-1-diff + LISA want building blocks; calmcp + plug-and-play want a facade.
**Recommendation:** Expose **both**: (a) **building blocks** — `StatelessDcrClientStore`, `OAuthStateCodec`, `createXsuaaOAuthProvider`, `createXsuaaTokenVerifier`, `createOidcVerifier`, `createApiKeyVerifier`, `createChainedTokenVerifier`, `createOAuthCallbackHandler`, `validateRedirectUri`; (b) a thin **`setupHttpAuth(app, options, logger?)`** facade composing them (calmcp's existing signature).
**Consequences:** All three migrate with minimal diff; new users get the one-liner. Slightly larger API surface to maintain — acceptable, it's the whole point.

### ADR-004 — Build on the MCP "resource-server" model + insulate from SDK v2
**Context:** MCP SDK **v2 monorepo split is in active alpha (Apr 2026)** — auth moves out of core, **Express becomes a separate `@modelcontextprotocol/express` adapter**, import paths change. Even 1.x minors shifted auth defaults. The 2025-06-18 spec treats the MCP server as an OAuth **resource server** with XSUAA as the separate AS.
**Recommendation:** Center the design on `OAuthTokenVerifier` + `requireBearerAuth` + protected-resource metadata (spec direction, cleanest XSUAA fit). **Wrap the SDK's auth types behind our own thin interface** so the v2 relocation is a one-file change. Keep `ProxyOAuthServerProvider`/`mcpAuthRouter` for the full-flow path we already need.
**Consequences:** One internal adapter file absorbs SDK churn; consumers never see SDK path changes.

### ADR-005 — Logger: injected structural interface (no pino dep)
**Context:** calmcp=pino `(obj,msg)`, arc-1/LISA=custom singleton `(msg,data)` + `emitAudit`. LISA's migration blocker is that it imports a logger singleton.
**Recommendation:** Define a minimal **structural** interface `Logger { debug/info/warn/error(msg: string, data?: object): void; emitAudit?(e): void }`, **injected everywhere, optional, default no-op.** Standardize on `(message, data?)` (matches the source). calmcp passes a ~3-line pino adapter; arc-1/LISA inject directly.
**Consequences:** Zero logging dep in the package; plug-and-play needs no logger; calmcp eats a trivial adapter (documented).

### ADR-006 — Config: small `AuthOptions`, consumers adapt
**Context:** calmcp small options vs LISA whole-config injection.
**Recommendation:** Package owns a small `AuthOptions` (calmcp's shape, extended — see §6). **Never depend on a consumer's config type**; each writes a one-function `theirConfig → AuthOptions` adapter (LISA already effectively does).
**Consequences:** Clean boundary; consumers keep their own config philosophy.

### ADR-007 — Dependency strategy
**Context:** Best-practice rule = peer the *host frameworks* whose identity must be shared; depend on leaf validators. Express 4↔5 and SDK 1.12↔1.28 spread across consumers. `@sap/xssec` is pure CJS.
**Recommendation:**
- **peerDependencies:** `@modelcontextprotocol/sdk` (**`>=1.12 <2`**, tested at both floor & ceiling in CI), `express` (**`>=4.21 <6`** — building blocks are express-version-agnostic; only the facade/middleware touch express types, tested on 5).
- **optional peer:** `jose` (`>=5 <7`, `peerDependenciesMeta.optional`, lazy-imported) — OIDC-only, so calmcp needn't install it.
- **dependencies:** `@sap/xssec` (`^4`).
- **Not surfaced:** `zod` (skip unless we expose Zod types).
**Consequences:** No duplicate Express/SDK instances (which would break `req.auth`); LISA stays on Express 4 via building blocks; calmcp skips jose. Wide SDK range needs CI matrix.

### ADR-008 — Parameterization knobs + defaults
**Recommendation:** Options (all defaulted except secrets): `clientIdPrefix` (default `'mcp-'`), `dcrKdfLabel` (`'mcp-dcr/v1'`), `stateKdfLabel` (`'mcp-oauth-state/v1'`), `redirectUriPatterns` + `defaultRedirectUris` (ship the shared vendored lists as defaults), `resourceName` (default `'MCP Server'`), `scopesSupported` (default `[]`), `requiredScope` (default none), `dcrTtlSeconds` (30d), `stateTtlSeconds` (600s), `dcrSigningSecret` (required for stable client_ids; document falling back to xsuaa `clientsecret`).
**Consequences:** Every consumer overrides `clientIdPrefix`/`kdfLabel` per-deployment (the revocation/domain-separation knob — must be documented as such).

### ADR-009 — Scope/policy out; single-scope opt-in
**Recommendation:** Authentication only + an **optional** `requiredScope` check (calmcp's `Viewer` case). Ship `qualifyXsuaaScopes` (generic). **Inject `expandScopes`** (optional, default identity) — arc-1 passes its policy fn; others omit. API-keys are `{key, scopes: string[]}[]` — the consumer maps its own "profiles" to scopes; the package has no profile concept.
**Consequences:** No policy engine leaks into the package; arc-1's richer policy stays in arc-1.

### ADR-010 — OIDC + API-key shape
**Recommendation:** `createOidcVerifier(issuer, audience, opts?)` exported, jose optional/lazy. `createApiKeyVerifier(keys: string | {key, scopes?}[])` collapses calmcp-single + LISA-list.
**Consequences:** One verifier covers both consumers; OIDC is pay-for-what-you-use.

### ADR-011 — Ship the #214 oauth-state codec; document removal trigger
**Context:** XSUAA echoes `+` in `state` un-encoded; the callback proxy works around it. Load-bearing today.
**Recommendation:** Ship it (internal to `createXsuaaOAuthProvider` + the exported callback handler). Document the removal trigger (when XSUAA fixes the bug) in code + a roadmap note.
**Consequences:** All consumers stop re-carrying the workaround; one place to delete it later.

### ADR-012 — ESM-only packaging
**Context:** `require(esm)` is stable on Node 20.19+/22.12+, so dual builds are unjustified for a Node-22+ target. `@sap/xssec` is pure CJS.
**Recommendation:** ESM-only. `"type":"module"`, `"sideEffects":false`, `"engines":{"node":">=22"}`, an **`exports` map** (types-first, `default` last, sub-paths `./rate-limit`, `./package.json`). Build with **plain `tsc`** (`NodeNext`, `declaration`, `isolatedDeclarations`). Consume `@sap/xssec` via default-import + destructure (`esModuleInterop`); **document the CJS interop sharp edge** in the README. CI gate: `publint && attw --pack . --profile esm-only`.
**Consequences:** Modern, tree-shakeable, no dual-build complexity; one documented interop caveat.

### ADR-013 — Release & publish
**Recommendation:** **release-please** (`release-type: node`, single `"."` package, **no `extra-files`** — no source VERSION constant). **npm OIDC trusted publishing** (automatic provenance, no `NPM_TOKEN`, `id-token: write`, Node ≥22.14/npm ≥11.5.1). Start **`0.1.0`** (0.x while the API settles across 3 consumers). Treat option/knob changes as semver-relevant.
**Consequences:** Same posture as arc-1 minus the VERSION marker; conventional-commits drive versioning.

### ADR-014 — Repo quality stack
**Recommendation:** Mirror arc-1 (biome, vitest, husky/lint-staged, dependabot npm+actions, SHA-pinned third-party actions, `npm audit --audit-level=high`, dependency-review, SECURITY.md). **Add for a security-sensitive auth lib:** GitHub **Private Vulnerability Reporting**, **CodeQL** (`security-extended`), **OpenSSF Scorecard** (required check), YAML issue forms + PR template, **CODEOWNERS on `/.github/workflows/`** + auth source, an **`examples/`** dir (runnable per-scenario TS apps), and a docs site = **TypeDoc + typedoc-plugin-markdown → VitePress** (TS-native API ref + guides; VitePress over Docusaurus unless versioned docs are needed; over mkdocs because TS-native). **Port the triplicate tests** (arc-1 + calmcp + LISA all have them) into one suite.
**Consequences:** Best-in-class OSS auth-lib hygiene; tests consolidated.

### ADR-015 — Rate limiting as an optional sub-module
**Context:** All three rate-limit, but wire it in their transport, not the auth core; shapes differ (1 vs 2 layers).
**Recommendation:** Ship `createAuthRateLimiter` (per-IP) + `createMcpRateLimiter` (per-user) under **`@arc-mcp/xsuaa-auth/rate-limit`**, deps `express-rate-limit` + `rate-limiter-flexible`. Not part of the facade; host mounts them.
**Consequences:** Core stays focused; rate-limit is opt-in and independently versioned-in.

---

## 6. Proposed public API surface (illustrative — not frozen)

```ts
// @arc-mcp/xsuaa-auth
export interface Logger { debug(m,d?):void; info(m,d?):void; warn(m,d?):void; error(m,d?):void; emitAudit?(e):void }

export interface AuthOptions {
  apiKeys?: string | { key: string; scopes?: string[] }[];
  xsuaa?: { credentials: XsuaaCredentials; appUrl: string;
            clientIdPrefix?: string; dcrKdfLabel?: string; stateKdfLabel?: string;
            resourceName?: string; scopesSupported?: string[]; requiredScope?: string;
            redirectUriPatterns?: string[]; defaultRedirectUris?: string[];
            dcrTtlSeconds?: number; stateTtlSeconds?: number; dcrSigningSecret?: string };
  oidc?: { issuer: string; audience: string; clockToleranceSec?: number };
  expandScopes?: (scopes: string[]) => string[];   // injected policy hook (default: identity)
}

// Facade (plug-and-play; calmcp):
export function setupHttpAuth(app, options: AuthOptions, logger?: Logger): RequestHandler | undefined;

// Building blocks (minimal-diff; arc-1, LISA):
export class StatelessDcrClientStore { /* … */ }
export class OAuthStateCodec { /* … */ }
export function createXsuaaOAuthProvider(creds, appUrl, opts?, logger?): { provider; clientStore; stateCodec };
export function createXsuaaTokenVerifier(creds, opts?): Verifier;
export function createOidcVerifier(issuer, audience, opts?): Verifier;          // jose, lazy
export function createApiKeyVerifier(keys): Verifier;
export function createChainedTokenVerifier(opts, xsuaaV?, oidcV?): Verifier;
export function createOAuthCallbackHandler(stateCodec, clientStore?, logger?): RequestHandler;
export function validateRedirectUri(uri, patterns?): void;
export type { XsuaaCredentials, AuthInfo };

// Sub-module: @arc-mcp/xsuaa-auth/rate-limit
export function createAuthRateLimiter(endpoint, perMinute, opts?): RequestHandler;
export function createMcpRateLimiter(perMinute): McpRateLimiter;
```

**Minimal ARC-1 diff** (validates the primary goal): swap 5 imports `./server/*` → `@arc-mcp/xsuaa-auth`; pass `config.logger` into the factories; map the handful of `ServerConfig` fields → `AuthOptions`; inject `expandScopes` from `authz/policy`. `startHttpServer` keeps orchestrating. No behavior change.

---

## 7. Deliverables & phasing

1. **This research doc** → confirm ADRs.
2. **SPEC** — freeze the public API (§6), the `AuthOptions`, the Logger contract, the exports map, peer ranges. The gate before any code.
3. **Repo scaffold** (`arc-mcp/auth`) — ADR-012/013/014 stack: tsc/ESM, exports map, vitest, biome, release-please, OIDC publish CI, CodeQL, Scorecard, dependabot, SECURITY + private vuln reporting, issue forms, CODEOWNERS, `examples/`, TypeDoc→VitePress.
4. **Port code + tests** — lift the modules, parameterize the knobs, inject logger, consolidate the triplicate test suites; `publint`/`attw` green.
5. **ARC-1 integration PR** — import-swap + glue; delete the moved files; lower `check:sizes`; full gate green.
6. **calmcp PR** — delete `src/httpAuth/`, adopt `setupHttpAuth` (+ pino adapter); ~3-line call site.
7. **LISA PR** — adopt building blocks; inject logger; bump SDK to the peer range; Express-4 path verified.

---

## 8. Open decisions (need confirmation)

- **npm name:** RESOLVED → `@arc-mcp/xsuaa-auth` (scoped, under the `arc-mcp` npm org; GitHub repo `arc-mcp/xsuaa-auth`).
- **MCP SDK peer floor:** `>=1.12` (covers LISA as-is, wider risk) vs `>=1.28` (forces LISA to bump in its PR, tighter). *Recommend `>=1.12 <2` + CI matrix*, since LISA bumps anyway in its migration PR — confirm appetite for the matrix.
- **Rate-limit sub-module in v1?** Recommended yes (ADR-015); could defer if we want the smallest first release.
- **Docs site:** VitePress (recommended, lean) vs Docusaurus (if versioned docs matter early).
- **`btp.ts`/PP:** confirmed OUT of this package — future separate `@arc-mcp/*` package or left per-consumer? (Recommend: leave per-consumer for now; revisit only if a 2nd PP consumer with the same shape appears.)
- **Express peer:** `>=4.21 <6` (covers LISA) vs `^5` only (forces LISA to Express 5). *Recommend the wide range* — building blocks are version-agnostic.

## 9. Risks
- **MCP SDK v2 churn** (highest) — mitigated by ADR-004 (wrap types, pin `<2`).
- **Wide peer ranges** (SDK 1.12–1.x, Express 4–5) → real test-matrix cost; the facade is the riskiest cross-version surface, building blocks are safe.
- **`@sap/xssec` CJS interop** in an ESM-only package — mitigated by default-import+destructure + documented caveat.
- **Logger arg-order** (pino vs source) — mitigated by standardizing `(msg, data)` + a calmcp adapter.
- **Solo maintenance of a security-sensitive public package** — mitigated by Scorecard/CodeQL/private-reporting and keeping the surface small.

## 10. Key sources (verified 2026-06-17)
nodejs.org/api/packages.html · joyeecheung.github.io (require(esm) stability) · publint.dev · arethetypeswrong · github.com/modelcontextprotocol/typescript-sdk (v1.29.0 `src/server/auth/*`, v2 alpha tags 2026-04-01, issue #440) · modelcontextprotocol.io/specification/2025-06-18/basic/authorization · registry.npmjs.org (@modelcontextprotocol/sdk 1.29.0, express 5.2.1/4.22.2, @sap/xssec 4.13.0) · @sap/xssec README · docs.npmjs.com/trusted-publishers · github.com/googleapis/release-please · npmjs.com/package/express-oauth2-jwt-bearer · ossf/scorecard-action · github/codeql-action.
