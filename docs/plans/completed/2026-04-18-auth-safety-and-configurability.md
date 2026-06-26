# Auth Safety & Configurability (supersedes PR #148)

## Overview

Make ARC-1 authentication safe, explicit, and easy to configure. This rewrites PR #148 from scratch — keeping the good ideas (cookie auth for on-prem SSO developer loops, `--verbose` logger init sanity) but fixing the security holes (cookie→PP leak, unguarded Basic under PP, unconditional `saml2=disabled` that breaks SAML-only systems and silently bypasses IdP/MFA where fallback exists).

ARC-1 has two independent auth layers:

- **Layer A — MCP Client → ARC-1**: none / API key(s) / OIDC JWT / XSUAA OAuth. These already coexist via `createChainedTokenVerifier` in `src/server/http.ts`.
- **Layer B — ARC-1 → SAP**: Basic / Cookie / Bearer OAuth (BTP ABAP service key) / BTP Destination Service / Principal Propagation (per-user via SAP-Connectivity-Authentication or jwt-bearer Proxy-Authorization).

The core problem is that Layer B mechanisms are NOT mutually exclusive in code today — they layer silently. When an admin sets `SAP_COOKIE_FILE` while `SAP_PP_ENABLED=true`, per-user PP requests silently carry the admin's cookies, so SAP sees the admin identity and PP audit is a lie. When PP headers are active, `applyAuthHeader` still sets Basic, putting three identity claims on the same request. Unconditionally disabling SAML (PR #148's approach) breaks S/4HANA Public Cloud and BTP ABAP (SAML is the only option) and silently bypasses IdP/MFA/audit on systems where fallback exists.

This plan fixes these holes, adds fail-fast startup validation for unsafe combinations, groups auth env vars by layer in `.env.example`, prints a one-screen auth summary at startup, and ships the browser cookie tool as a clearly-scoped dev-only utility (not an auth method).

## Context

### Current State

- `buildAdtConfig()` in [src/server/server.ts:38](src/server/server.ts:38) is reused for BOTH the shared startup client and `createPerUserClient()` (line 107). Any field added here leaks into per-user PP clients — including cookies, username, password.
- `applyAuthHeader()` in [src/adt/http.ts:830](src/adt/http.ts:830) sends `Basic ${user:pass}` whenever `username && password && !bearerTokenProvider` — even when `sapConnectivityAuth` or `ppProxyAuth` is set for PP.
- `SAP_COOKIE_FILE` / `SAP_COOKIE_STRING` are parsed in `src/server/config.ts` and `src/adt/cookies.ts` has `parseCookieFileContent()` / `parseCookieString()`, but no end-to-end wiring from config → `AdtClient.cookies` exists on `main`. (PR #148 wired them in the unsafe location.)
- `validateConfig()` in [src/server/config.ts:305](src/server/config.ts:305) only checks two things: `oidcIssuer ⇄ oidcAudience` and `ppStrict` requires `ppEnabled`. There is no guard against `cookies + PP`, `bearer + PP`, `bearer + cookies`, etc.
- Startup logs show individual events (`"XSUAA OAuth validation enabled"`, `"Principal propagation enabled"`) but never a consolidated auth summary. An admin cannot tell at a glance which Layer A methods are on and which Layer B method is active.
- `.env.example` groups vars by feature area ("Cookie Authentication", "MCP Client Authentication", "XSUAA Auth", "Principal Propagation") but not by Layer A / Layer B, and safety-critical fail-fast rules are not documented.
- No `SAP_DISABLE_SAML` or `X-SAP-SAML2` header support. No HTML-login-page detection — on SSO-only on-prem systems, SAP returns a 200 OK HTML login page that the ADT client then tries to parse as ADT XML, producing confusing errors instead of "authentication failed, your SSO session is not valid here."
- Browser cookie extractor exists as a concept in PR #148 (`src/browser-extract-cookie-auth.ts`) but is unsafe: world-readable cookie file, broken `--url`, broken Linux browser lookup, not wired into CLI discoverability, no warning against PP coexistence.

### Target State

- `buildAdtConfig(config, btpProxy?, bearerTokenProvider?, opts?)` takes `{ perUser: boolean }`. When `perUser === true`, it omits `username`, `password`, and `cookies`. The returned config represents ONLY the per-request transport shape; per-user auth is layered by `createPerUserClient` afterwards.
- `SAP_COOKIE_FILE` / `SAP_COOKIE_STRING` are wired from config into the shared `AdtClient.config.cookies` — safe because per-user PP clients never inherit them.
- `validateConfig()` rejects these combinations at startup:
  - `ppEnabled && (cookieFile || cookieString)` unless `SAP_PP_ALLOW_SHARED_COOKIES=true` (opt-in escape hatch with loud warning)
  - `bearerTokenProvider (BTP ABAP) && (cookieFile || cookieString)` — exclusive
  - `bearerTokenProvider && ppEnabled` — exclusive (BTP ABAP is single-tenant)
  - `disableSaml2 && systemType=='btp'` — warn (doesn't hard-fail because admin may have a reason)
- `applyAuthHeader()` only sets Basic if no other Layer B mechanism is active: `username && password && !bearerTokenProvider && !sapConnectivityAuth && !ppProxyAuth`.
- One-line auth summary at startup per transport: `"auth: MCP=[api-key,oidc] SAP=basic+cookie (shared)"` or `"auth: MCP=xsuaa SAP=destination+pp (per-user)"`. Printed at INFO level in both stdio and HTTP mode.
- `SAP_DISABLE_SAML=true` (default `false`) — opt-in. Prefers `X-SAP-SAML2: disabled` header (SAP Note 3456236) over URL query param. Still adds `saml2=disabled` to the URL for tolerance against older ICF stacks that ignore the header.
- `handleResponse()` in `src/adt/http.ts` detects `200 OK + Content-Type: text/html` on any `/sap/bc/adt/` path and throws `AdtApiError(401, 'ADT call returned HTML login page — authentication required. If using cookies, they may have expired. If using Basic, credentials may be invalid. If on an SSO-only system, see docs/enterprise-auth.md#sso-only-systems.')`. This is the real hardening — SAML disable is just one tool to avoid the landing page.
- `scripts/extract-sap-cookies.ts` (moved out of `src/`) is a standalone tsx script with:
  - `parseServerArgs(process.argv.slice(2))` (fixes the `--url` bug)
  - Linux browser lookup via `spawnSync('command', ['-v', <browser>])` (fixes the cwd-only `existsSync` bug)
  - `writeFileSync(cookieFile, content, { mode: 0o600 })` (fixes world-readable cookies)
  - A DEV-ONLY banner at start: "This is a developer convenience. Never use the resulting cookie file with SAP_PP_ENABLED=true — it would make every per-user request run as you."
  - Added to `package.json` as `"extract-sap-cookies": "tsx scripts/extract-sap-cookies.ts"` so developers discover it via `npx arc-1 extract-sap-cookies --help`-style usage is NOT claimed — the tool stays a dev-only script run via `npm run extract-sap-cookies` or direct tsx invocation.

### Key Files

| File | Role |
|------|------|
| `src/server/server.ts` | `buildAdtConfig()`, `createPerUserClient()` — the cookie/PP leak site |
| `src/server/config.ts` | Config parsing + `validateConfig()` — fail-fast rules live here |
| `src/server/types.ts` | `ServerConfig` type + `DEFAULT_CONFIG` — add `disableSaml2`, `ppAllowSharedCookies` |
| `src/server/logger.ts` | Logger — auth summary emitted here after initLogger |
| `src/adt/http.ts` | `applyAuthHeader()`, `buildUrl()`, `handleResponse()`, `fetchCsrfToken()` — SAML header, HTML-login detection, Basic-under-PP guard |
| `src/adt/cookies.ts` | `parseCookieFileContent()`, `parseCookieString()` — add `resolveCookies()` helper |
| `src/adt/client.ts` / `src/adt/config.ts` | `AdtClientConfig` — already has `cookies`, `sapConnectivityAuth`, `ppProxyAuth`, `bearerTokenProvider` fields |
| `src/cli.ts` | Wires `SAP_COOKIE_FILE`/`SAP_COOKIE_STRING` into the CLI subcommands' client factory |
| `scripts/extract-sap-cookies.ts` | **NEW** — dev-only browser cookie extractor |
| `package.json` | Add `extract-sap-cookies` script entry |
| `.env.example` | Regrouped into Layer A / Layer B sections with safety callouts |
| `docs/enterprise-auth.md` | Update coexistence matrix + fail-fast rules block |
| `docs/roadmap.md` | New entry: SEC-09 Auth safety & configurability |
| `docs/compare/00-feature-matrix.md` | Auth row already ✅ for cookie/PP — update "Last Updated" + footnote |
| `CLAUDE.md` | Config table: add `SAP_DISABLE_SAML`, `SAP_PP_ALLOW_SHARED_COOKIES`; add "Key Files for Common Tasks" entry for auth config changes |
| `.claude/commands/implement-feature.md` | Update to reference the new fail-fast rules when implementing auth-touching features |
| `tests/unit/server/config.test.ts` | Tests for new `validateConfig` rules |
| `tests/unit/server/server.test.ts` | Tests for `buildAdtConfig({ perUser: true })` strips cookies |
| `tests/unit/adt/http.test.ts` | Tests for Basic-suppression-under-PP, SAML header, HTML-login detection |
| `tests/unit/adt/cookies.test.ts` | Tests for `resolveCookies()` helper |

### Design Principles

1. **Layer B methods are mutually exclusive by default.** Coexistence is either fail-fast at startup (PP+cookie, bearer+PP) or requires an explicit opt-in env var with loud warning (`SAP_PP_ALLOW_SHARED_COOKIES=true` for the edge case where an admin genuinely wants the shared client to use cookies while PP is the default per-user mode).
2. **Per-user auth never inherits shared-auth credentials.** The `{ perUser: true }` flag on `buildAdtConfig` is the single point where this is enforced. Any future Layer B addition must respect the flag.
3. **SAML disable is opt-in, never implicit.** Defaults preserve IdP/MFA/audit. Systems where SAML is the only option (BTP ABAP, S/4HANA Public Cloud) stay unchanged.
4. **HTML login detection is the real hardening.** Even if SAML disable is enabled, `handleResponse()` catches the moment SAP redirects to the login page and throws a clear error rather than letting the client parse HTML as XML.
5. **Admin visibility over admin trust.** The startup auth summary exists because the admin should not have to grep logs or read code to know what's active. One line, all layers, every startup.
6. **Dev utilities stay out of the distributed CLI.** `scripts/extract-sap-cookies.ts` is run locally by developers. It is not a feature of the MCP server and is never advertised in the auth guide as a production path.

## Development Approach

- **Ordering matters for safety.** Task 1 (the cookie→PP leak fix) lands before Task 2 (wiring cookies through) — otherwise Task 2 re-introduces the leak.
- **Existing tests must pass after every task.** Run `npm test` at the end of each task. The test suite is currently 1318+ unit tests.
- **Follow existing mocking patterns.** Tests mock `undici.fetch` via `vi.mock('undici', ...)` and use `mockResponse()` from `tests/helpers/mock-fetch.ts`. Config tests clear auth env vars in `beforeEach`.
- **No behavior change for unaffected users.** Admins running vanilla basic auth, or vanilla XSUAA+PP, should see no log differences beyond the new one-line auth summary.
- **Each task is self-contained.** Ralphex runs each task in a fresh session. File paths, line numbers, and referenced patterns must be explicit in the task body.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Refactor `buildAdtConfig` + `createPerUserClient` — enforce per-user credential isolation

**Files:**
- Modify: `src/server/server.ts`
- Modify: `tests/unit/server/server.test.ts`

This is the safety-critical foundation. `buildAdtConfig()` at [src/server/server.ts:38-66](src/server/server.ts:38) is reused by both the shared startup client and `createPerUserClient()` (called at line 107). Any auth-related field added to `buildAdtConfig` leaks into every per-user PP request. Add a `{ perUser: boolean }` flag that strips Layer B credentials when building per-user config. No cookie wiring yet — this task only changes the shape.

- [ ] Change `buildAdtConfig` signature to `buildAdtConfig(config, btpProxy?, bearerTokenProvider?, opts?: { perUser?: boolean })`.
- [ ] When `opts?.perUser === true`, the returned `Partial<AdtClientConfig>` must NOT include `username`, `password`, or `cookies`. (The `cookies` field doesn't exist in the returned object yet — that's Task 2 — but the guard must be in place.)
- [ ] Update the `createPerUserClient` call site at line 107 to pass `{ perUser: true }`: `const adtConfig = buildAdtConfig(config, effectiveProxy, undefined, { perUser: true });`
- [ ] The existing `adtConfig.username = displayUsername` assignment at line 128/132 is a display-only field and stays — the per-user SAML assertion or jwt-bearer token is the real identity.
- [ ] Shared-client call sites (look for `buildAdtConfig(config, btpProxy, bearerTokenProvider)` without the flag, e.g., in `runStartupProbe` and the main server bootstrap near line 160+) stay unchanged — they default to `perUser: false`.
- [ ] Add a short code comment above the function: `// When perUser=true, strips shared credentials (username/password/cookies) so per-user PP clients never inherit admin auth.`
- [ ] Add unit tests (~4 tests) in `tests/unit/server/server.test.ts`:
  - `buildAdtConfig({url:'u',username:'U',password:'P'})` returns config with username+password.
  - `buildAdtConfig({...}, undefined, undefined, { perUser: true })` returns config with NO username, NO password.
  - When `cookies` gets plumbed in Task 2, this test will extend — leave a `TODO(Task 2)` comment next to the cookie assertion.
  - Shared path preserves `bearerTokenProvider` when passed; per-user path also preserves it if passed (bearer is not shared credentials — it is a callable the caller controls).
- [ ] Run `npm test` — all tests must pass.
- [ ] Run `npm run typecheck` — no errors.

### Task 2: Wire `SAP_COOKIE_FILE` / `SAP_COOKIE_STRING` into shared `AdtClient`

**Files:**
- Modify: `src/adt/cookies.ts` (add `resolveCookies()` helper)
- Modify: `src/server/server.ts` (use helper in shared-client path only)
- Modify: `src/cli.ts` (CLI subcommands — `createClientFromEnv` path uses same helper)
- Modify: `tests/unit/adt/cookies.test.ts`
- Modify: `tests/unit/server/server.test.ts` (extend Task 1's cookie TODO)

PR #148's original intent: let on-prem SSO users authenticate ARC-1→SAP by pasting browser cookies. Safe now that Task 1 has landed, because the cookies only live on the shared client. `src/adt/cookies.ts` already has `parseCookieFileContent` and `parseCookieString` (see [tests/unit/adt/cookies.test.ts](tests/unit/adt/cookies.test.ts:1)). Add one small helper to centralise the "file OR string OR both" logic and wire it into the shared-client build.

- [ ] In `src/adt/cookies.ts`, add: `export function resolveCookies(cookieFile: string | undefined, cookieString: string | undefined): Record<string, string> | undefined`. Returns `undefined` if both are empty; merges file + string otherwise (string overrides file on key collision).
- [ ] In `src/server/server.ts`, inside `buildAdtConfig`, when `!opts?.perUser`: set `config.cookies = resolveCookies(config.cookieFile, config.cookieString)` on the returned object. The returned partial already has a `cookies` field on `AdtClientConfig` (see `src/adt/config.ts`).
- [ ] In `src/cli.ts` around line 99-114, confirm `createClientFromEnv` already threads cookieFile/cookieString from process.env. If not, wire it through via `resolveCookies()`.
- [ ] Add unit tests in `tests/unit/adt/cookies.test.ts` (~4 tests):
  - `resolveCookies(undefined, undefined)` returns `undefined`.
  - `resolveCookies('./fixture', undefined)` returns file contents.
  - `resolveCookies(undefined, 'a=1; b=2')` returns `{a:'1',b:'2'}`.
  - `resolveCookies('./fixture', 'a=override')` — string wins on collision.
- [ ] Extend Task 1's `buildAdtConfig({perUser:true})` tests: assert `cookies` is `undefined` even when `config.cookieFile` is set. Assert shared path's returned config has `cookies` populated when `cookieFile` is set.
- [ ] Run `npm test` — all tests must pass.

### Task 3: Add `validateConfig` fail-fast rules for unsafe Layer B combinations

**Files:**
- Modify: `src/server/types.ts` (add `disableSaml2`, `ppAllowSharedCookies` to `ServerConfig` and `DEFAULT_CONFIG`)
- Modify: `src/server/config.ts` (parser + `validateConfig` at line 305)
- Modify: `tests/unit/server/config.test.ts`

`validateConfig` at [src/server/config.ts:305-323](src/server/config.ts:305) currently only checks OIDC issuer↔audience and `ppStrict→ppEnabled`. Add the missing rules that enforce Layer B isolation. Also add the two new `ServerConfig` fields that later tasks depend on.

- [ ] In `src/server/types.ts`, add to `ServerConfig` interface: `disableSaml2: boolean;` and `ppAllowSharedCookies: boolean;`. Add to `DEFAULT_CONFIG`: both `false`.
- [ ] In `src/server/config.ts` parser (near the existing `resolveBool` calls around line 170-200), parse:
  - `config.disableSaml2 = resolveBool('disable-saml', 'SAP_DISABLE_SAML', false);`
  - `config.ppAllowSharedCookies = resolveBool('pp-allow-shared-cookies', 'SAP_PP_ALLOW_SHARED_COOKIES', false);`
- [ ] In `validateConfig`, add these checks after the existing `ppStrict` check at line 318:
  - **PP + cookies** (unless opt-in): if `config.ppEnabled && (config.cookieFile || config.cookieString) && !config.ppAllowSharedCookies`, throw with message: `SAP_PP_ENABLED=true is incompatible with SAP_COOKIE_FILE / SAP_COOKIE_STRING — shared cookies would leak into per-user requests. If you genuinely need both, set SAP_PP_ALLOW_SHARED_COOKIES=true (cookies will be used only for the shared client, not for per-user PP requests).`
  - **Bearer + cookies**: if `(config.btpServiceKey || config.btpServiceKeyFile) && (config.cookieFile || config.cookieString)`, throw: `SAP_BTP_SERVICE_KEY is incompatible with SAP_COOKIE_FILE / SAP_COOKIE_STRING — pick one SAP auth method.`
  - **Bearer + PP**: if `(config.btpServiceKey || config.btpServiceKeyFile) && config.ppEnabled`, throw: `SAP_BTP_SERVICE_KEY (BTP ABAP) is incompatible with SAP_PP_ENABLED=true — BTP ABAP Environment is single-tenant OAuth and does not support principal propagation.`
  - **disableSaml on BTP**: if `config.disableSaml2 && config.systemType === 'btp'`, emit a warning via `logger.warn(...)` (not a throw): `SAP_DISABLE_SAML=true on a BTP system usually breaks login — BTP ABAP and S/4HANA Public Cloud require SAML. Continuing because you explicitly set this, but check docs/enterprise-auth.md if login starts failing.` (logger is not available at validateConfig time since initLogger runs later — emit via `console.error` to stderr with a `[warn]` prefix instead, matching the stderr-only rule in CLAUDE.md.)
- [ ] Add unit tests in `tests/unit/server/config.test.ts` (~7 tests):
  - `ppEnabled + cookieFile` throws with helpful error.
  - `ppEnabled + cookieString` throws.
  - `ppEnabled + cookieFile + ppAllowSharedCookies=true` does NOT throw.
  - `btpServiceKey + cookieFile` throws.
  - `btpServiceKey + ppEnabled` throws.
  - `disableSaml2 + systemType='btp'` does not throw but writes to stderr (spy on `process.stderr.write` or `console.error`).
  - Existing `ppStrict + !ppEnabled` still throws (regression).
- [ ] Extend the existing `beforeEach` env-clear list to include `SAP_DISABLE_SAML` and `SAP_PP_ALLOW_SHARED_COOKIES` so per-test isolation is clean.
- [ ] Run `npm test` — all tests pass.
- [ ] Run `npm run typecheck`.

### Task 4: Fix `applyAuthHeader` Basic-suppression under PP + add startup auth summary log

**Files:**
- Modify: `src/adt/http.ts` (`applyAuthHeader` at line 830)
- Modify: `src/server/server.ts` (emit auth summary after initLogger, before starting transport)
- Modify: `tests/unit/adt/http.test.ts`
- Modify: `tests/unit/server/server.test.ts`

`applyAuthHeader` at [src/adt/http.ts:830-833](src/adt/http.ts:830) only guards against `bearerTokenProvider`. When `sapConnectivityAuth` or `ppProxyAuth` is set (PP mode), Basic is still sent — so the request carries three identity claims. Expand the guard. Then add the one-line startup summary so admins can SEE the active config at a glance.

- [ ] In `src/adt/http.ts`, change `applyAuthHeader` guard from `!this.config.bearerTokenProvider` to `!this.config.bearerTokenProvider && !this.config.sapConnectivityAuth && !this.config.ppProxyAuth`. Keep the same `headers.Authorization = Basic ...` when the guard passes.
- [ ] Add the same condition to `fetchCsrfToken()` at [src/adt/http.ts:669-685](src/adt/http.ts:669) — it already calls `applyAuthHeader(headers)` so the fix propagates automatically. Verify by reading the function.
- [ ] In `src/server/server.ts`, add a new function near the top (after VERSION): `function logAuthSummary(config: ServerConfig): void { ... }`. It emits one line at INFO level: `logger.info('auth: MCP=[...] SAP=[...]')` where:
  - MCP part is a comma-separated list of enabled Layer A methods: `none` (stdio or no MCP auth), `api-key`, `api-keys`, `oidc`, `xsuaa`. Example: `[api-key,oidc]`.
  - SAP part is the active Layer B method plus modifiers: `basic`, `basic+cookie`, `cookie`, `bearer`, `destination`, `destination+pp`, `pp`. Append `(shared)` if no PP, `(per-user)` if `ppEnabled`. Example: `basic+cookie (shared)` or `destination+pp (per-user)`.
  - Also print `disable-saml=on` as a suffix if `config.disableSaml2`.
- [ ] Call `logAuthSummary(config)` once in the main server bootstrap, right after `initLogger()` and before the transport starts. Both stdio and HTTP-streamable paths must emit it.
- [ ] Add unit tests in `tests/unit/adt/http.test.ts` (~4 tests):
  - Basic auth set → `Authorization: Basic ...` present.
  - Basic creds + `bearerTokenProvider` → NO Basic header.
  - Basic creds + `sapConnectivityAuth: 'Bearer xxx'` → NO Basic header (regression: was previously present).
  - Basic creds + `ppProxyAuth: 'Bearer yyy'` → NO Basic header.
- [ ] Add unit tests in `tests/unit/server/server.test.ts` (~3 tests for `logAuthSummary`):
  - `{apiKey:'k'}` (no PP) → `MCP=[api-key] SAP=basic (shared)`.
  - `{oidcIssuer:'...', oidcAudience:'...', ppEnabled:true}` → `MCP=[oidc] SAP=pp (per-user)`.
  - `{apiKey:'k', oidcIssuer:'...', oidcAudience:'...', cookieFile:'x', ppAllowSharedCookies:true, ppEnabled:true}` → `MCP=[api-key,oidc] SAP=cookie+pp (per-user)`.
  - Spy on `logger.info` via `vi.spyOn` or capture stderr and assert one matching line.
- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.

### Task 5: Add opt-in `SAP_DISABLE_SAML` via `X-SAP-SAML2` header + HTML-login-page detection

**Files:**
- Modify: `src/adt/http.ts` (header injection in `applyHeaders`/request builder around line 210-260, `buildUrl` around line 814, `handleResponse` around line 647, `fetchCsrfToken` around line 669)
- Modify: `src/adt/config.ts` (if AdtClientConfig needs a `disableSaml` field — check file before modifying)
- Modify: `src/adt/errors.ts` (minor — may need new hint in `AdtApiError` message suggestions)
- Modify: `src/server/server.ts` (plumb `config.disableSaml2` into `AdtClientConfig.disableSaml`)
- Modify: `tests/unit/adt/http.test.ts`

`X-SAP-SAML2: disabled` (documented in SAP Note 3456236) is the safer form of the `saml2=disabled` URL parameter (KBAs 2577263/2945880/3280746). Header form is preferred — it does not leak into logs, caches, or proxy traces as a URL parameter. Also add HTML-login-page detection: the moment SAP returns `200 + Content-Type: text/html` on an ADT path, throw `AdtApiError(401, ...)` with a clear message.

- [ ] Check `src/adt/config.ts` for `AdtClientConfig`. If missing, add `disableSaml?: boolean;` field.
- [ ] In `src/server/server.ts` `buildAdtConfig`, add `disableSaml: config.disableSaml2` to the returned partial (both shared and per-user paths — the setting applies regardless of auth mode).
- [ ] In `src/adt/http.ts`, in the request header builder (around line 210-260 where `applyAuthHeader` is called), add: `if (this.config.disableSaml) { headers['X-SAP-SAML2'] = 'disabled'; }`. Add the same header in `fetchCsrfToken()`.
- [ ] Also add `saml2=disabled` query param in `buildUrl` at line 814, gated on `this.config.disableSaml`. Rationale: older ICF stacks may ignore the custom header — belt-and-braces. Do this with `url.searchParams.set('saml2', 'disabled')` only if the flag is on.
- [ ] In `src/adt/http.ts` `handleResponse` at line 647, BEFORE the `status >= 400` check, add HTML-login-page detection:
  - If `status === 200 && path.startsWith('/sap/bc/adt/')`:
    - Read `headers.get('content-type')` (or iterate headers if using Headers object).
    - If the Content-Type starts with `text/html`, throw `new AdtApiError('ADT call returned HTML login page — authentication required. If using cookies, they may have expired. If using Basic auth, credentials may be invalid or not authorized for ADT (S_ADT_RES missing). If on an SSO-only system, try SAP_DISABLE_SAML=true or see docs/enterprise-auth.md. Re-run arc-1 after fixing.', 401, path, body.slice(0, 500))`.
- [ ] Add unit tests in `tests/unit/adt/http.test.ts` (~5 tests):
  - `disableSaml=true` → every outgoing request has `X-SAP-SAML2: disabled` header. (Inspect `fetchOptions()` helper from existing tests.)
  - `disableSaml=true` → URL also has `saml2=disabled` query param.
  - `disableSaml=false` (default) → no SAML header, no query param.
  - `handleResponse` with `200 + Content-Type: text/html` on `/sap/bc/adt/...` throws `AdtApiError(401, ...)` with message containing "HTML login page".
  - `handleResponse` with `200 + Content-Type: application/xml` on the same path returns normally.
- [ ] Run `npm test`.

### Task 6: Move browser cookie extractor to `scripts/extract-sap-cookies.ts` (dev-only utility)

**Files:**
- Create: `scripts/extract-sap-cookies.ts`
- Modify: `package.json` (add `extract-sap-cookies` script entry + `tough-cookie` or keep pure if possible)
- Modify: `.gitignore` (confirm `cookies.txt` already ignored — CLAUDE.md says it is; verify)

This is the single-developer SSO-only on-prem helper (equivalent to sapcli's browser-auth). Clearly scoped as a dev utility: lives in `scripts/`, not advertised in the auth guide as a production path, refuses to run if it detects `SAP_PP_ENABLED=true` in the environment.

- [ ] Create `scripts/extract-sap-cookies.ts`. Use `tsx` compatible syntax (top-of-file imports, ESM).
- [ ] Behavior:
  - Parse args with `parseServerArgs(process.argv.slice(2))` (NOT `[]`). Required: `--url`; optional: `--browser chrome|firefox|edge` (default: chrome), `--output <path>` (default: `./cookies.txt`).
  - Print a DEV-ONLY banner at start: `"⚠️  DEV-ONLY UTILITY. The resulting cookie file MUST NOT be used with SAP_PP_ENABLED=true — it would cause every per-user request to authenticate as you. Continue? [y/N]"`. Skip the prompt if `--yes`.
  - Refuse to run if `process.env.SAP_PP_ENABLED === 'true'` — print clear error and exit 2.
  - Use CDP (Chrome DevTools Protocol) to extract cookies for the target URL's origin. Keep the extraction logic minimal; if the PR #148 approach was sound, port it. Otherwise use a simple Playwright-less approach: require the user to have the browser open, spawn a CDP client via `chrome-remote-interface` (add to `devDependencies`) OR simply read cookies from the browser's sqlite cookie store based on OS.
  - On Linux, look up browser binaries via `spawnSync('command', ['-v', <name>]).status === 0` (NOT `existsSync(<name>)` which only checks cwd).
  - Write cookies in Netscape format via `writeFileSync(outputPath, content, { mode: 0o600 })` — owner read/write only.
  - Print a "next steps" footer: `"Cookies written to <path> with mode 0600. Use with: SAP_COOKIE_FILE=<path> SAP_URL=<...> arc-1. Rotate regularly — cookies expire."`
- [ ] In `package.json` scripts, add: `"extract-sap-cookies": "tsx scripts/extract-sap-cookies.ts"`.
- [ ] If a new runtime dep is needed (e.g., `chrome-remote-interface`), add it to `devDependencies` NOT `dependencies` — this utility must not bloat the distributed npm package. Alternatively, if the approach from PR #148 used only `node:fs` + `sqlite3`, keep it that way.
- [ ] Add ONE smoke test (~1 test) in `tests/unit/scripts/extract-sap-cookies.test.ts`:
  - Import the script's `planExtraction()` or similar pure function (refactor the script so the side-effectful main is thin; business logic is testable).
  - Assert that the function refuses to return a plan when `env.SAP_PP_ENABLED === 'true'`.
  - If the script is pure-side-effect, skip this and add a TODO — don't ship broken tests.
- [ ] Run `npm test`.
- [ ] Manually verify `npm run extract-sap-cookies -- --help` prints usage without crashing. (This is a manual smoke step — mark the checkbox once run locally.)

### Task 7: Regroup `.env.example` into Layer A / Layer B sections

**Files:**
- Modify: `.env.example`

Admins should read `.env.example` top-to-bottom and immediately understand what Layer A (MCP auth) and Layer B (SAP auth) mean, which vars belong to each, and which combinations are illegal. Add prominent safety callouts inline where the fail-fast rules kick in.

- [ ] Restructure `.env.example` with these section headers:
  1. `# === SAP connection (required) ===` → `SAP_URL`, `SAP_CLIENT`, `SAP_LANGUAGE`, `SAP_INSECURE`, `SAP_SYSTEM_TYPE`.
  2. `# === Layer B: ARC-1 → SAP authentication (pick ONE) ===` → subsections for:
     - `# (B1) Basic Auth` → `SAP_USER`, `SAP_PASSWORD`.
     - `# (B2) Cookie auth (on-prem SSO developer loops — see scripts/extract-sap-cookies.ts)` → `SAP_COOKIE_FILE`, `SAP_COOKIE_STRING`. WARNING comment: `# Never combine with SAP_PP_ENABLED=true without SAP_PP_ALLOW_SHARED_COOKIES=true.`
     - `# (B3) BTP ABAP Environment (direct OAuth)` → `SAP_BTP_SERVICE_KEY`, `SAP_BTP_SERVICE_KEY_FILE`, `SAP_BTP_OAUTH_CALLBACK_PORT`.
     - `# (B4) BTP Destination Service (Cloud Foundry)` → `SAP_BTP_DESTINATION`, `SAP_BTP_PP_DESTINATION`.
     - `# (B5) Principal Propagation (per-user SAP identity)` → `SAP_PP_ENABLED`, `SAP_PP_STRICT`, `SAP_PP_ALLOW_SHARED_COOKIES`.
     - `# Extras: SAP_DISABLE_SAML (opt-in, advanced, breaks BTP ABAP / S/4 Public Cloud).`
  3. `# === Layer A: MCP Client → ARC-1 authentication (can combine) ===` → subsections:
     - `# (A1) No auth (stdio only, local dev)`.
     - `# (A2) API Key(s)` → `ARC1_API_KEY`, `ARC1_API_KEYS`.
     - `# (A3) OIDC / JWT` → `SAP_OIDC_ISSUER`, `SAP_OIDC_AUDIENCE`, `SAP_OIDC_CLOCK_TOLERANCE`.
     - `# (A4) XSUAA OAuth (BTP)` → `SAP_XSUAA_AUTH`.
  4. `# === Safety / scopes / profiles ===` → `SAP_READ_ONLY`, `SAP_BLOCK_DATA`, `SAP_BLOCK_FREE_SQL`, `SAP_ALLOWED_OPS`, `SAP_DISALLOWED_OPS`, `SAP_ALLOWED_PACKAGES`, `SAP_ENABLE_TRANSPORTS`, `ARC1_PROFILE`.
  5. `# === Transport & logging ===` → `SAP_TRANSPORT`, `ARC1_HTTP_ADDR`, `ARC1_PORT`, `ARC1_LOG_FILE`, `ARC1_LOG_LEVEL`, `ARC1_LOG_FORMAT`, `SAP_VERBOSE`.
  6. `# === Cache & concurrency ===` → `ARC1_CACHE`, `ARC1_CACHE_FILE`, `ARC1_CACHE_WARMUP`, `ARC1_CACHE_WARMUP_PACKAGES`, `ARC1_MAX_CONCURRENT`.
- [ ] At the top of Layer B, add the fail-fast matrix as a code-fence comment block:
  ```
  # Fail-fast rules (validated at startup):
  #   ppEnabled + cookieFile|cookieString         →  error (unless SAP_PP_ALLOW_SHARED_COOKIES=true)
  #   btpServiceKey + cookieFile|cookieString     →  error
  #   btpServiceKey + ppEnabled                   →  error
  #   disableSaml + systemType=btp                →  warning (continues)
  ```
- [ ] Keep the existing examples commented out (starting with `#`), but update the `SAP_URL=` example line to show `http://sapdev:50000` (no trailing slash).
- [ ] No code or test changes in this task — it is a pure doc rewrite. Run `npm test` anyway to confirm nothing regressed.

### Task 8: Update `docs/enterprise-auth.md` with coexistence matrix + fail-fast rules block

**Files:**
- Modify: `docs/enterprise-auth.md`

`docs/enterprise-auth.md` already has a Quick Decision Guide and "All Auth-Related Flags" table. Update the "SAP Auth Method Priority" section (around line 397) to reflect the fail-fast rules as hard constraints, not just a priority order. Add a coexistence matrix.

- [ ] Add a new `## Coexistence Matrix` subsection after "All Auth-Related Flags" (around line 394):

  ```markdown
  ## Coexistence Matrix (Layer A can always combine; Layer B is exclusive)

  | Layer B combination | Status | Reason |
  |---|---|---|
  | Basic only | ✅ | Standard on-prem |
  | Cookie only | ✅ | On-prem SSO developer loop |
  | Basic + Cookie | ✅ | ARC-1 sends both headers — SAP picks |
  | Bearer (BTP ABAP) only | ✅ | BTP ABAP Environment direct OAuth |
  | Destination only | ✅ | BTP Cloud Foundry, shared user |
  | Destination + PP (per-user) | ✅ | Enterprise standard on BTP CF |
  | PP + Cookie | ❌ fail-fast | Cookies would leak into per-user requests |
  | PP + Cookie + SAP_PP_ALLOW_SHARED_COOKIES=true | ⚠️ allowed with warning | Cookies stay on shared client only |
  | Bearer + Cookie | ❌ fail-fast | Two Layer B methods in conflict |
  | Bearer + PP | ❌ fail-fast | BTP ABAP is single-tenant; PP not supported |
  ```
- [ ] Add a new `## SAML Disable (Advanced)` subsection after Custom TLS Trust (around line 366):
  ```markdown
  ## SAML Disable (Advanced, Opt-in)

  Some on-prem AS ABAP systems are configured with SAML as the default ICF auth method
  even where Basic / cookie auth is also available. ARC-1 can request that SAP skip
  the SAML redirect via either a request header (preferred) or a URL query parameter:

  ```bash
  SAP_DISABLE_SAML=true
  ```

  When set, every ADT request adds `X-SAP-SAML2: disabled` (SAP Note 3456236)
  and `?saml2=disabled` (SAP KBA 2577263). **Never enable this on BTP ABAP Environment
  or S/4HANA Public Cloud** — those systems require SAML, and disabling it breaks login.
  ARC-1 emits a warning if you combine `SAP_DISABLE_SAML=true` with
  `SAP_SYSTEM_TYPE=btp`.

  ### HTML login page detection

  Independent of the SAML flag, ARC-1 detects when SAP returns a login HTML page
  (200 OK + `Content-Type: text/html`) on an ADT endpoint. Instead of trying to parse
  HTML as XML, ARC-1 throws a clear `401 — ADT call returned HTML login page` error
  with pointers to the common causes (expired cookies, wrong Basic creds, missing
  S_ADT_RES authorization, SSO-only system needing `SAP_DISABLE_SAML=true`).
  ```
- [ ] Update the "What's NOT Implemented" list (around line 405) — the claim `--client-cert / --client-key / --ca-cert` isn't in ARC-1 stays. Nothing to remove.
- [ ] Update the "All Auth-Related Flags" table (around line 370): add rows for `SAP_DISABLE_SAML`, `SAP_PP_ALLOW_SHARED_COOKIES`, and confirm `SAP_COOKIE_FILE`/`SAP_COOKIE_STRING` rows already exist (they do — lines 384-385).
- [ ] Add a new near-top sentence in the "Quick Decision Guide" referencing the startup auth summary: "After starting, check the server's first INFO log line: `auth: MCP=[...] SAP=[...]`. This is the authoritative summary of what's active."
- [ ] No code or test changes. Run `npm test` anyway — should pass.

### Task 9: Update `CLAUDE.md`, roadmap, feature matrix, and skills

**Files:**
- Modify: `CLAUDE.md` (config table + Key Files for Common Tasks + Security & Architectural Invariants)
- Modify: `docs/roadmap.md` (add SEC-09 completed entry + refresh Last Updated)
- Modify: `docs/compare/00-feature-matrix.md` (refresh Last Updated date + add footnote)
- Modify: `.claude/commands/implement-feature.md` (reference the fail-fast rules)

Keep the AI-assistant context and comparison artifacts truthful. `CLAUDE.md` is critical — autonomous agents rely on it for the config table and code patterns.

- [ ] In `CLAUDE.md` config table (around line 48 onward), add rows:
  - `| SAP_DISABLE_SAML / --disable-saml | Opt-in: disable SAML redirect via X-SAP-SAML2: disabled + ?saml2=disabled. Do NOT use on BTP ABAP or S/4 Public Cloud. (default: false) |`
  - `| SAP_PP_ALLOW_SHARED_COOKIES / --pp-allow-shared-cookies | Opt-in escape hatch allowing SAP_COOKIE_FILE/STRING to coexist with SAP_PP_ENABLED. Cookies stay on shared client only. (default: false) |`
- [ ] In `CLAUDE.md` "Key Files for Common Tasks" table, add row:
  - `| Add / modify auth combination rule | src/server/config.ts (validateConfig at ~line 305), src/server/types.ts (ServerConfig), tests/unit/server/config.test.ts, docs/enterprise-auth.md (Coexistence Matrix) |`
  - `| Add Layer B auth mechanism | src/adt/http.ts (applyAuthHeader at ~line 830, fetchCsrfToken at ~line 669), src/server/server.ts (buildAdtConfig — perUser flag), tests/unit/adt/http.test.ts |`
- [ ] In `CLAUDE.md` "Security & Architectural Invariants" section, add bullet:
  - `- **Per-user auth never inherits shared credentials.** buildAdtConfig(config, btpProxy?, bearerTokenProvider?, { perUser: true }) strips username/password/cookies. Any new Layer B field must respect this flag. Never add auth fields directly to createPerUserClient's adtConfig without going through buildAdtConfig.`
- [ ] In `docs/roadmap.md`:
  - Refresh `**Last Updated:**` to today's date (2026-04-17).
  - In the "Completed" table, add at the top: `| SEC-09 | Auth Safety & Configurability (cookie→PP leak fix, applyAuthHeader guard, fail-fast validation, auth summary log, SAML disable opt-in, HTML login detection) | 2026-04-17 | Security |`.
- [ ] In `docs/compare/00-feature-matrix.md`:
  - Refresh `_Last updated:_` line to mention "SEC-09 Auth Safety landed 2026-04-17: fixed cookie→PP leak, added X-SAP-SAML2 header, added HTML-login-page detection".
- [ ] In `.claude/commands/implement-feature.md`, add a near-top bullet under SAP auth guidance: `When touching auth (Layer A or Layer B), read docs/enterprise-auth.md#coexistence-matrix first. The validateConfig fail-fast rules in src/server/config.ts are the authoritative source — extend them if adding a new combination.`
- [ ] No code or test changes in this task. Run `npm test` anyway for regression.

### Task 10: Final verification

- [ ] Run `npm test` — all tests pass (expect ~15-20 new tests across Tasks 1-6).
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors (biome).
- [ ] Manual startup test (stdio):
  - `SAP_URL=http://x SAP_USER=u SAP_PASSWORD=p npx tsx src/cli.ts` → first log line matches `auth: MCP=[none] SAP=basic (shared)`.
- [ ] Manual startup test (fail-fast):
  - `SAP_URL=http://x SAP_USER=u SAP_PASSWORD=p SAP_COOKIE_FILE=/tmp/c SAP_PP_ENABLED=true npx tsx src/cli.ts` → exits with the PP+cookie error from Task 3.
  - Adding `SAP_PP_ALLOW_SHARED_COOKIES=true` → starts successfully.
- [ ] Manual startup test (SAML warning):
  - `SAP_URL=https://x.abap.eu10.hana.ondemand.com SAP_DISABLE_SAML=true SAP_SYSTEM_TYPE=btp SAP_USER=u SAP_PASSWORD=p npx tsx src/cli.ts` → prints BTP warning to stderr but continues.
- [ ] Grep to confirm no `saml2=disabled` URL param is added unconditionally: `grep -n "saml2" src/adt/http.ts` — every match must be gated on `this.config.disableSaml`.
- [ ] Grep to confirm `createPerUserClient` still passes `{ perUser: true }` to `buildAdtConfig`: `grep -n "buildAdtConfig" src/server/server.ts`.
- [ ] Confirm `.gitignore` still includes `cookies.txt`: `grep -n "cookies.txt" .gitignore`.
- [ ] Move this plan to `docs/plans/completed/2026-04-18-auth-safety-and-configurability.md`.
