# PR-α — Cookie Hot-Reload on Stale 401

## Overview

Today, when ARC-1 is configured with `SAP_COOKIE_FILE` and the SAP session cookies expire, every subsequent ADT call fails with a 401 until the operator restarts the process. This punishes long-running deployments and forces a service interruption for what is purely a credential-refresh problem.

This PR adds a **lazy cookie-reload mechanism**: on a persistent 401 in cookie-auth mode, the client clears the in-memory cookie jar and re-reads the configured `cookieFile` (or, where applicable, `cookieString`) on the **next** outgoing request. The mechanism never polls, never restarts on its own, and never expands the auth surface — it simply lets `arc1-cli extract-cookies` (or any equivalent refresh) take effect without a process restart.

This PR is the first of three "ship-now" splits of [PR #196](https://github.com/arc-mcp/arc-1/pull/196), cherry-picked because the cookie-reload work is fully orthogonal to the NW 7.50 compatibility work in that PR. The architectural decisions and plans for the rest of PR #196 are captured under `docs/adr/0001..0003.md` and `docs/plans/2026-05-08-discovery-driven-endpoint-routing.md`.

## Context

### Current State

- [src/adt/http.ts](../../src/adt/http.ts) holds the cookie jar in `AdtHttpClient.cookieJar` plus the configured static cookies in `this.config.cookies`. The 401 retry block at lines 470–540 already resets cookies + CSRF and retries once, but if the second attempt also returns 401 the cookies remain stale until the next process restart.
- [src/adt/cookies.ts](../../src/adt/cookies.ts) exposes `resolveCookies(cookieFile, cookieString)` — a pure file-and-string parser that returns a `Record<string, name>` or `undefined`.
- [src/server/server.ts](../../src/server/server.ts) `buildAdtConfig` (line ~170) currently passes `cookies: resolveCookies(...)` to the AdtClient on construction but does **not** pass the original `cookieFile` / `cookieString` paths, so the client cannot reload them later.
- [src/server/server.ts](../../src/server/server.ts) `runStartupAuthPreflight` treats a 401 on `/sap/bc/adt/core/discovery` as a **blocking** failure and refuses to start the MCP server. Combined with cookie auth, this means an expired-cookie startup hangs the deployment.
- The cookie-aware 401 hint in [src/handlers/intent.ts](../../src/handlers/intent.ts) `formatErrorForLLM` does not exist — operators see a generic "Authorization error. Check SAP_CLIENT, SAP_USER, SAP_PASSWORD" message that is wrong for cookie auth.

### Target State

- `AdtClientConfig` and `AdtHttpConfig` carry `cookieFile?` and `cookieString?` so the runtime client can reload from the original source.
- On a persistent 401 in cookie-auth mode (i.e., either `cookieFile` or `cookieString` is configured), the client clears `this.config.cookies` and sets a `cookiesCleared` flag.
- On the **next** outgoing request, the client checks `cookiesCleared && isCookieAuthMode()` and re-runs `resolveCookies()` to repopulate cookies before sending. Refresh is lazy — never polled, never automatic mid-failed-request.
- `cookieString`-only configurations log a one-time warning explaining that no automatic refresh is possible (the string is static; use `cookieFile` for hot-reload). The logic still clears stale cookies so the next request emits a clean auth failure.
- `runStartupAuthPreflight` downgrades to **non-blocking `inconclusive`** when the connector is in cookie-auth mode and the preflight returns 401. The MCP server starts and the runtime cookie-reload path takes over on the first real ADT call.
- `formatErrorForLLM` emits a cookie-aware hint when `config.cookieFile || config.cookieString` is set: *"Hint: SAP cookies have expired. Ask the user to re-extract cookies with `arc1-cli extract-cookies`. The next SAP call after extraction will automatically reload the fresh cookies — no restart needed."*
- Every per-user PP client created via `buildAdtConfig({ perUser: true })` continues to **strip** `cookieFile` / `cookieString` (along with the existing `cookies` strip), so per-user clients never inherit shared-cookie auth.

### Key Files

| File | Role |
|------|------|
| `src/adt/config.ts` | `AdtClientConfig` — add optional `cookieFile`, `cookieString` |
| `src/adt/http.ts` | `AdtHttpConfig` — add optional `cookieFile`, `cookieString`. `AdtHttpClient` — `cookiesCleared` flag, `isCookieAuthMode`, `reloadCookiesFromSource`, lazy reload guard in `request()` and `fetchCsrfToken()`, 401-clears-cookies logic in retry path and HTML-login fallback |
| `src/adt/client.ts` | `AdtClient` constructor passes the new fields through to `AdtHttpClient` |
| `src/server/server.ts` | `buildAdtConfig` passes `cookieFile`/`cookieString` (and strips them when `perUser=true`); `buildStartupAuthFailureReason` tailors the cookie-auth message; `runStartupAuthPreflight` downgrades to non-blocking on cookie-auth 401 |
| `src/handlers/intent.ts` | `formatErrorForLLM` / `buildBaseErrorMessage` — emit cookie-aware hint on `isUnauthorized || isForbidden` when cookie auth is configured |
| `tests/unit/adt/http.test.ts` | Unit tests for the reload state machine (401 → clear → next request reloads → success) |
| `tests/unit/server/server.test.ts` | `buildAdtConfig` perUser-strip tests for new fields; preflight downgrade test |
| `tests/unit/handlers/intent.test.ts` | Cookie-auth hint formatting test |
| `CLAUDE.md` | Architecture: Request Flow note + Security & Architectural Invariants entry for cookie hot-reload + buildAdtConfig perUser strip clause |
| `docs_page/configuration-reference.md` | Document hot-reload behavior under `SAP_COOKIE_FILE` |
| `docs_page/cli-guide.md` | Cross-reference: `arc1-cli extract-cookies` is now a runtime refresh, not a restart trigger |

### Design Principles

1. **Lazy reload, no polling.** Reload happens on the next request after a persistent 401 — never on a timer, never during a failed request. This matches the project pattern of "no clock dependency" used elsewhere (cf. etag plan principle 2).
2. **Reload only when there is a source.** `cookieString` is static (no file to re-read). The implementation logs a one-time warn-level diagnostic when `cookieString` is the only source, then proceeds without reload. `cookieFile` is the only source that supports automatic refresh.
3. **Preflight stays advisory in cookie mode.** Today's preflight is blocking on 401, which deadlocks deployments where cookies are about to be re-extracted out-of-band. In cookie-auth mode, downgrade to `inconclusive` + non-blocking and let runtime cookie-reload take over on the first real call.
4. **Per-user PP clients never inherit shared-cookie state.** `buildAdtConfig({ perUser: true })` strips `cookieFile` and `cookieString` exactly the way it already strips `cookies`. This is enforced by the existing `if (!opts?.perUser)` block — the new fields go inside the same block.
5. **No new env vars / CLI flags.** The mechanism reuses the existing `SAP_COOKIE_FILE` / `SAP_COOKIE_STRING` config surface; no profile or escape hatch is added. The behavior is automatic when cookie auth is detected.
6. **Hot-reload never expands auth scope.** The reloaded cookies replace the stale cookies in `this.config.cookies`. The cookie jar from the failed session is **not** carried across the reload. This guarantees the post-reload request authenticates with exactly what `cookieFile` says, nothing more.

## Development Approach

Implement in three small passes: types and config plumbing first, then the reload state machine in `http.ts`, then the operator-facing hint in `intent.ts`. Each pass has its own test task. Documentation updates are bundled in the final task.

The hot-reload state machine has three observable transitions to test:

- **A → B**: cookie-auth client + persistent 401 → `cookies = {}`, `cookiesCleared = true`.
- **B → A**: next request fires, `cookiesCleared` is true → `reloadCookiesFromSource()` runs → `cookiesCleared = false`, `cookies` repopulated from disk.
- **B → B**: next request fires but `cookieFile` is missing/empty → `cookiesCleared = false`, warn-level diagnostic emitted, request proceeds with empty cookies (and likely fails 401 again, surfacing a clean error).

Tests use the existing `mockResponse()` helper from `tests/helpers/mock-fetch.ts` and the `vi.mock('undici', …)` pattern already used in `tests/unit/adt/http.test.ts`. The cookie-file reload step is mocked at the `resolveCookies` boundary (or by writing a tmp file), per the test's preference.

## Validation Commands

- `npm test`
- `npm test -- tests/unit/adt/http.test.ts`
- `npm test -- tests/unit/server/server.test.ts`
- `npm test -- tests/unit/handlers/intent.test.ts`
- `npm run typecheck`
- `npm run lint`

### Task 1: Plumb `cookieFile` / `cookieString` through ADT client config

**Files:**
- Modify: `src/adt/config.ts`
- Modify: `src/adt/client.ts`
- Modify: `src/adt/http.ts`

Add the two optional fields so the runtime client can later reload its own cookies. Without this plumbing, the http client cannot reach back to the original source. No behavior change yet — this task is pure type plumbing.

- [ ] Add `cookieFile?: string` and `cookieString?: string` to `AdtClientConfig` in `src/adt/config.ts` with one-line JSDoc each: *"Path to cookie file — enables hot-reload on stale auth"* and *"Inline cookie string — stored for config awareness (no hot-reload)"*.
- [ ] Mirror the two fields onto `AdtHttpConfig` in `src/adt/http.ts` (interface near the top of the file).
- [ ] Pass `config.cookieFile` and `config.cookieString` through `AdtClient` constructor in `src/adt/client.ts` to the `AdtHttpClient` config object (alongside the existing `cookies: config.cookies` line).
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm test` — all tests must pass (no logic changed; this asserts the type plumbing doesn't break existing tests).

### Task 2: Implement lazy cookie reload on persistent 401

**Files:**
- Modify: `src/adt/http.ts`

Add the state machine that clears stale cookies on persistent 401 and reloads them lazily on the next request. The reload mechanism is internal to `AdtHttpClient` and does not change any public API.

- [ ] In `AdtHttpClient`, add a private `cookiesCleared = false` flag (alongside existing `dbRetryInProgress`).
- [ ] Add a private method `isCookieAuthMode(): boolean` that returns `!!(this.config.cookieFile || this.config.cookieString)`.
- [ ] Add a private method `reloadCookiesFromSource(): void` that:
    - Sets `this.cookiesCleared = false` first (so the reload is one-shot per cleared transition).
    - When `!this.config.cookieFile && this.config.cookieString`, emits `logger.warn('SAP_COOKIE_STRING cannot be refreshed without restart. Use SAP_COOKIE_FILE for automatic reload.')` and returns.
    - Otherwise calls `resolveCookies(this.config.cookieFile, this.config.cookieString)` (importing from `./cookies.js`).
    - On success with non-empty result, assigns to `this.config.cookies` and emits `logger.info('Reloaded cookies from file', { cookieCount: Object.keys(fresh).length })`.
    - On empty result, emits `logger.warn('Cookie reload returned empty result')` and leaves `this.config.cookies` unchanged (caller will see the same auth failure cleanly).
    - On thrown error, emits `logger.warn('Failed to reload cookies from source', { error: <message> })` and leaves `this.config.cookies` unchanged.
- [ ] In `request()` (the main public method), insert a lazy-reload guard after `Authorization` header is set but before the cookie header is built: `if (this.cookiesCleared && this.isCookieAuthMode()) this.reloadCookiesFromSource();`.
- [ ] In the existing 401 retry block (around line 533), after the retried response is received: when `response.status === 401 && this.isCookieAuthMode()`, set `this.config.cookies = {}` and `this.cookiesCleared = true`, emit `logger.warn('Cookie auth: 401 persisted after retry — clearing stale cookies. Run \`arc1-cli extract-cookies\` to get fresh cookies; the next SAP call will reload them automatically.')`.
- [ ] In the HTML-login-page fallback (around line 750), when the response is HTML+text/html and the body looks like a login page: if `isCookieAuthMode()` is true, set `this.config.cookies = {}` and `this.cookiesCleared = true` before throwing the existing AdtApiError(401).
- [ ] In `fetchCsrfToken()`, mirror the lazy-reload guard at the start of the method (before building the cookie header) so a CSRF fetch on the next request also picks up reloaded cookies.
- [ ] In `fetchCsrfToken()`'s 401 branch (around line 875), when `isCookieAuthMode()` is true, also clear cookies and set `cookiesCleared = true` before throwing.
- [ ] Add unit tests (~6 tests) in `tests/unit/adt/http.test.ts` under a new `describe('cookie hot-reload', …)` block:
    - **Test 1**: 401 retry that also returns 401 in cookie-auth mode sets `cookiesCleared` and clears `config.cookies`. Verify by inspecting public state after the failure (e.g., expose a tiny test-only getter, or assert via the next-request behavior in a follow-up call).
    - **Test 2**: Next request after `cookiesCleared` re-reads cookies from a tmp file (use `os.tmpdir()` + `fs.writeFileSync` to create a real Netscape-format cookie file). Assert the request's `Cookie` header contains the new cookie value.
    - **Test 3**: When only `cookieString` is configured (no `cookieFile`), reload emits the documented warn message and proceeds without reload.
    - **Test 4**: When `resolveCookies()` returns an empty record (cookie file exists but is empty), warn message emitted and `config.cookies` left unchanged.
    - **Test 5**: When the cookie file is unreadable (e.g., path doesn't exist), warn message emitted and `config.cookies` left unchanged.
    - **Test 6**: HTML-login fallback path also clears cookies in cookie-auth mode (assert `cookiesCleared = true` after the throw).
- [ ] Run `npm test -- tests/unit/adt/http.test.ts` — all new and existing tests must pass.

### Task 3: Wire `cookieFile` / `cookieString` through `buildAdtConfig` and strip on perUser

**Files:**
- Modify: `src/server/server.ts`
- Modify: `tests/unit/server/server.test.ts`

The server-side config builder must hand the two fields to the AdtClient on shared-client paths and strip them on per-user (PP) paths so per-user clients never inherit shared cookie auth.

- [ ] In `buildAdtConfig` (around line 170), inside the existing `if (!opts?.perUser)` block, after the `cookies` assignment, add:
    - `adtConfig.cookieFile = config.cookieFile;`
    - `adtConfig.cookieString = config.cookieString;`
- [ ] Verify the per-user branch (the `else` of the same `if`) does **not** assign these fields. The default `Partial<AdtClientConfig>` shape already leaves them undefined.
- [ ] In `tests/unit/server/server.test.ts`, extend the existing `describe('buildAdtConfig', …)` block with two tests:
    - **Test A**: Shared-client config with `cookieFile: '/tmp/x.txt'` is passed through to the AdtClient config.
    - **Test B**: Per-user config (`{ perUser: true }`) with `cookieFile` and `cookieString` set on `ServerConfig` strips both fields from the resulting AdtClient config (assert `adtConfig.cookieFile === undefined` and `adtConfig.cookieString === undefined`).
- [ ] Run `npm test -- tests/unit/server/server.test.ts` — all tests must pass.

### Task 4: Downgrade startup preflight to non-blocking in cookie-auth mode

**Files:**
- Modify: `src/server/server.ts`
- Modify: `tests/unit/server/server.test.ts`

A 401 during startup in cookie-auth mode is recoverable at runtime (the next call will reload cookies). Today's behavior — block startup — defeats the purpose of hot-reload because deployment never gets to the point where cookies can be refreshed.

- [ ] Update `buildStartupAuthFailureReason(statusCode: number, config: ServerConfig)` to accept the config so it can branch on cookie-auth mode. When `statusCode === 401 && (config.cookieFile || config.cookieString)`, return: *"Authentication failed (401) during startup auth preflight. Your SAP cookies have expired. Re-extract them with `arc1-cli extract-cookies` — no restart needed, the next SAP call will reload them automatically."*
- [ ] In `runStartupAuthPreflight`, when `err.statusCode === 401 && (config.cookieFile || config.cookieString)`, log a `warn` audit event and return `{ status: 'inconclusive', blocking: false, endpoint, checkedAt, statusCode: 401, reason }` instead of the existing `{ status: 'failed', blocking: true, … }`.
- [ ] Other auth-failure paths (no cookie auth configured, or 403) keep the existing blocking behavior — do NOT downgrade those.
- [ ] Add unit tests (~3 tests) in `tests/unit/server/server.test.ts` under a `describe('runStartupAuthPreflight', …)` block:
    - **Test 1**: 401 + no cookie auth configured → `{ status: 'failed', blocking: true }` (unchanged behavior).
    - **Test 2**: 401 + `cookieFile` set → `{ status: 'inconclusive', blocking: false }`.
    - **Test 3**: 403 + `cookieFile` set → `{ status: 'failed', blocking: true }` (downgrade is 401-only).
- [ ] Run `npm test -- tests/unit/server/server.test.ts` — all tests must pass.

### Task 5: Cookie-aware error hint in `formatErrorForLLM`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

A 401/403 raised through the LLM-facing handler must explain the cookie-refresh path when cookie auth is configured. The existing message — "Check SAP_CLIENT, SAP_USER, and SAP_PASSWORD" — is misleading on cookie-auth deployments.

- [ ] In `formatErrorForLLM` and/or its delegate `buildBaseErrorMessage`, after constructing `enriched` and inside the `err.isUnauthorized || err.isForbidden` branch, branch on `config.cookieFile || config.cookieString`:
    - When cookie auth is configured: return `${enriched}\n\nHint: SAP cookies have expired. Ask the user to re-extract cookies with \`arc1-cli extract-cookies\`. The next SAP call after extraction will automatically reload the fresh cookies — no restart needed.`
    - Otherwise: return the existing message verbatim.
- [ ] Update both function signatures to accept `config: ServerConfig` (already required to read `cookieFile`/`cookieString`). Update the single call site in `handleToolCall`'s catch block.
- [ ] Add unit tests (~2 tests) in `tests/unit/handlers/intent.test.ts`:
    - **Test 1**: AdtApiError(401) with `config.cookieFile` set → returned message contains "re-extract cookies" and "no restart needed".
    - **Test 2**: AdtApiError(401) with no cookie auth configured → returned message contains the existing "Check SAP_CLIENT" guidance.
- [ ] Run `npm test -- tests/unit/handlers/intent.test.ts` — all tests must pass.

### Task 6: Document the hot-reload behavior

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs_page/configuration-reference.md`
- Modify: `docs_page/cli-guide.md`

Make the runtime invariant discoverable for future contributors and clear for operators.

- [ ] In `CLAUDE.md` "Architecture: Request Flow" diagram, change the `Cookie/session management` line to `Cookie/session management (hot-reload from file on stale 401)`.
- [ ] In `CLAUDE.md` "Security & Architectural Invariants" section, append two bullets:
    - *"**Per-user auth never inherits shared credentials.** `buildAdtConfig({ perUser: true })` strips `username`, `password`, `cookies`, `cookieFile`, and `cookieString`. Any new Layer B field must respect this flag."* (replace the existing bullet that lists only the first three.)
    - *"**Cookie auth hot-reload.** When `SAP_COOKIE_FILE` is set, expired cookies do not require a restart. On persistent 401 the HTTP client clears stale cookies and re-reads the file on the next request (`cookiesCleared` flag in `src/adt/http.ts`). Startup preflight is non-blocking in cookie-auth mode. `SAP_COOKIE_STRING` cannot hot-reload (logged warning)."*
- [ ] In `docs_page/configuration-reference.md` under the `SAP_COOKIE_FILE` entry, add: *"Cookies are reloaded automatically on the next request after a persistent 401, so you can refresh cookies (e.g. via `arc1-cli extract-cookies`) without restarting ARC-1."*
- [ ] In `docs_page/cli-guide.md` under the `extract-cookies` subcommand, add a sentence: *"When the running ARC-1 process is configured with `SAP_COOKIE_FILE` pointing to the same file, the next SAP call automatically reloads the fresh cookies — no restart needed."*
- [ ] Run `npm run lint` — no new lint errors.

### Task 7: Final verification

- [ ] Run `npm test` — all unit tests pass (target: at least 6 new tests for the reload state machine, 3 for preflight downgrade, 2 for handler hint, plus existing tests unchanged).
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] Smoke test against A4H: run `arc1-cli serve` with `SAP_COOKIE_FILE` pointing to a valid Netscape cookie file, manually invalidate the cookies (e.g., overwrite the file with an obviously-bad value), confirm a request fails 401, restore the file, confirm the next request succeeds without restarting the process.
- [ ] Move this plan to `docs/plans/completed/`.
