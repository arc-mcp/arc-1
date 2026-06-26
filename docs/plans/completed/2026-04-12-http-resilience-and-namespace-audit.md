# HTTP Resilience & Namespace Encoding Audit (FEAT-08, FEAT-14, FEAT-15)

## Overview

This plan addresses three P0/P1 roadmap items that harden ARC-1's HTTP resilience and URL safety:

1. **FEAT-08 (Content-Type 415/406 Auto-Retry)** — Already fully implemented in `src/adt/http.ts:325-398` with 13 unit tests. The roadmap and feature matrix need updating to reflect completion.

2. **FEAT-14 (401 Session Timeout Auto-Retry)** — Not yet implemented. SAP sessions expire after 15-30 minutes of idle time. When ARC-1 runs as a centralized gateway, idle gaps between user requests cause 401 responses that bubble up as errors mid-conversation. The fix: on 401, reset session state (cookies + CSRF token), re-authenticate, and retry the original request once. This follows the same pattern as the existing 403 CSRF retry and DB connection retry.

3. **FEAT-15 (Namespace URL Encoding Audit)** — Code audit confirms `encodeURIComponent()` is consistently applied across all 35+ call sites in `client.ts`, `crud.ts`, `codeintel.ts`, `devtools.ts`, and `transport.ts`. Existing unit tests (`client.test.ts:370-389`, `crud.test.ts:104-114`, `devtools.test.ts:277-285`, `intent.test.ts:607-629`) verify namespaced objects encode correctly. However, `devtools.ts` interpolates object URLs/names into XML attributes without `escapeXmlAttr()` — inconsistent with `codeintel.ts` which does escape. This is a defense-in-depth fix (object URLs from `objectUrlForType()` are pre-encoded, but raw names in `activateBatch()` and `publishBody()` are not escaped).

## Context

### Current State

**401 handling (FEAT-14):**
- `src/adt/http.ts` handles 403 (CSRF retry, lines 294-322), 406/415 (content negotiation retry, lines 325-398), and DB connection errors (session reset + retry, lines 238-292).
- 401 is NOT retried — it throws `AdtApiError` immediately via `handleResponse()` at line 442-444 (`if (status >= 400) { throw new AdtApiError(body.slice(0, 500), status, path, body); }`).
- `src/adt/errors.ts` has `isSessionExpired` (for HTTP 400 + session timeout body) and `isUnauthorized` (for 401) properties on `AdtApiError`, but neither triggers retry.
- For Basic Auth (on-premise): credentials are stored in `AdtHttpConfig` and sent on every request via `applyAuthHeader()` (line 584-588). A 401 after successful initial auth indicates session cookie staleness — clearing cookies and retrying with same credentials re-establishes the session.
- For Bearer tokens (BTP ABAP): `bearerTokenProvider()` is called per-request (line 188-191) and handles token caching/refresh internally (`src/adt/oauth.ts`). A 401 means the cached token expired — calling the provider again triggers refresh.
- Guard pattern exists: `dbRetryInProgress` flag (line 98) prevents infinite DB retry loops. Same pattern needed for 401.
- **Live SAP test system verification (A4H, SAP_BASIS 758):** Sending a request with an invalid/expired session cookie (no auth header) returns HTTP 401 with headers: `www-authenticate: Basic realm="SAP NetWeaver Application Server [A4H/001]"`, `set-cookie: sap-usercontext=sap-client=001; path=/`. The response body is HTML (9321 bytes). This confirms the retry pattern: on 401, clear stale session cookies, re-apply Basic Auth (or refresh Bearer token), and retry.

**Namespace encoding (FEAT-15):**
- URL path encoding: 35+ `encodeURIComponent()` calls across `client.ts`, `crud.ts`, `codeintel.ts`, `devtools.ts`, `transport.ts`. All consistent.
- XML attribute encoding: `codeintel.ts` uses `escapeXmlAttr()` (lines 14-19, 143, 189, 194). `transport.ts` uses `escapeXml()` (lines 68, 118-119). `devtools.ts` does NOT escape — lines 25, 45, 73, 130, 193, 226 interpolate URLs/names directly into XML.
- Risk: Object names from `objectUrlForType()` are pre-encoded (safe), but `activateBatch()` receives `o.name` (raw) and `publishBody()` receives `name` (raw) — if a name contains `"`, `<`, or `&`, the XML breaks.

### Target State

- 401 responses trigger one automatic retry after session reset (cookies + CSRF cleared, credentials re-sent).
- `devtools.ts` uses `escapeXmlAttr()` for all XML attribute interpolation, consistent with `codeintel.ts`.
- FEAT-08 marked completed in roadmap and feature matrix.
- FEAT-14 and FEAT-15 marked completed in roadmap and feature matrix.
- All existing tests continue to pass; new tests cover 401 retry and XML escaping.

### Key Files

| File | Role |
|------|------|
| `src/adt/http.ts` | Core HTTP transport — add 401 retry logic (main change) |
| `src/adt/errors.ts` | Error types — already has `isUnauthorized` property |
| `src/adt/devtools.ts` | Syntax check, activate, publish, ATC — add XML attribute escaping |
| `src/adt/codeintel.ts` | Reference for `escapeXmlAttr()` pattern (already correct) |
| `tests/unit/adt/http.test.ts` | HTTP client tests — add 401 retry tests |
| `tests/unit/adt/devtools.test.ts` | DevTools tests — add XML escaping tests |
| `docs/roadmap.md` | Update FEAT-08, FEAT-14, FEAT-15 status |
| `docs/compare/00-feature-matrix.md` | Update P0/P1 gap lists |

### Design Principles

1. **One retry, always guarded** — 401 retry uses the same `flag + try/finally` pattern as DB connection retry. Never infinite loops.
2. **Session reset before retry** — Clear cookies + CSRF token so SAP's ICM assigns a fresh work process. This is the proven pattern from DB connection retry.
3. **No retry inside stateful sessions** — When `sessionType === 'stateful'`, a 401 means the stateful session is gone. Retrying would create a new session but lose the lock. Still retry (the meaningful error like "lock not held" is more useful than "401 Unauthorized"), but log a warning.
4. **Bearer token refresh on 401** — Call `bearerTokenProvider()` again before retry. The provider handles token lifecycle internally.
5. **Defense-in-depth XML escaping** — Even though current object URLs are pre-encoded, escape all XML attribute interpolation to prevent future regressions.
6. **Minimal scope** — FEAT-08 is already done, FEAT-15 is a small hardening fix. FEAT-14 is the main implementation work.

## Development Approach

The implementation follows the existing retry patterns in `src/adt/http.ts`. The 401 retry block should be structurally identical to the DB connection retry (lines 238-292) — same guard flag pattern, same `resetSession()` + cookie rebuild + `doFetch()` retry sequence, same audit logging. Tests use the established `vi.mock('undici')` + `mockResponse()` pattern from `tests/helpers/mock-fetch.ts`. Changes are isolated to the HTTP transport layer (FEAT-14) and XML body construction (FEAT-15).

**Live SAP verification:** The A4H test system (SAP_BASIS 758) confirms that: (1) a request with an expired/invalid session cookie and no Basic Auth header returns HTTP 401 with `www-authenticate: Basic realm="SAP NetWeaver Application Server [A4H/001]"`; (2) re-sending the same request with valid Basic Auth credentials succeeds (HTTP 200) and establishes a new session via `Set-Cookie: SAP_SESSIONID_A4H_001=...`.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add 401 session timeout auto-retry to HTTP client

**Files:**
- Modify: `src/adt/http.ts`

Add automatic retry on 401 responses in the `request()` method of `AdtHttpClient`. This follows the same pattern as the existing 403 CSRF retry (lines 294-322) and DB connection retry (lines 238-292).

- [ ] Add a `private authRetryInProgress = false` guard field to `AdtHttpClient` (line ~98, next to `dbRetryInProgress`)
- [ ] In the `request()` method, after the 406/415 content negotiation block (after line 398) and before the CSRF token store (line 401), add a 401 retry block. The block must handle both Basic Auth (on-premise) and Bearer token (BTP) auth modes. Reference: the `request()` method builds auth at lines 186-191 (`applyAuthHeader()` for Basic, `bearerTokenProvider()` for Bearer). The retry block:
  - Check: `response.status === 401 && !this.authRetryInProgress`
  - Set `authRetryInProgress = true` in try, reset in finally
  - Log an audit warning: `"401 session expired — resetting session and retrying"` (use `logger.emitAudit()` matching the DB retry pattern at lines 241-250)
  - Call `this.resetSession()` (line 546-549) to clear cookies + CSRF token
  - Re-apply auth: call `this.applyAuthHeader(headers)` (line 584-588, re-applies Basic Auth from stored `config.username`/`config.password`). If `this.config.bearerTokenProvider` exists, call it to get a fresh token: `const token = await this.config.bearerTokenProvider(); headers.Authorization = 'Bearer ' + token;`
  - Re-fetch CSRF token for modifying requests: `if (isModifyingMethod(method)) { await this.fetchCsrfToken(); headers['X-CSRF-Token'] = this.csrfToken; }`
  - Rebuild cookie header from fresh jar (same pattern as DB retry, lines 262-270): iterate `this.cookieJar`, join as `k=v`, set `headers.Cookie` or `delete headers.Cookie` if empty
  - Execute retry: `const retryResp = await this.doFetch(url, method, headers, body)`
  - Store cookies from retry via `this.storeCookies(retryResp)`, then `const retryBody = await retryResp.text()`, then `this.handleResponse(retryResp.status, retryResp.headers, retryBody, path)`
  - Log audit info on success: `"401 session retry succeeded"`
  - Return the retry result
- [ ] Ensure the 401 retry block is placed BEFORE the existing 403 CSRF retry block (line 294), since a 401 supersedes CSRF issues. Move the ordering so that in the `request()` method the checks flow: DB connection error → 401 session retry → 403 CSRF retry → 406/415 negotiation retry → normal response handling
- [ ] Run `npm test` — all existing tests must pass (the new code path is not exercised yet)

### Task 2: Add unit tests for 401 session timeout auto-retry

**Files:**
- Modify: `tests/unit/adt/http.test.ts`

Add tests for the 401 retry logic in `AdtHttpClient`. Follow the existing test patterns in the same file (see "406/415 content negotiation retry" describe block at line 584 for structure).

- [ ] Add a new `describe('401 session timeout auto-retry', ...)` block after the existing "406/415 content negotiation retry" block (after line ~750)
- [ ] Add test: `retries GET on 401 after session reset` — mock first fetch → 401 (with response headers `www-authenticate: Basic realm="SAP..."`, `set-cookie: sap-usercontext=sap-client=001`), second fetch → 200 success. For a GET, no CSRF re-fetch is needed (only modifying methods need CSRF). Assert 2 fetch calls (original + retry), assert retry succeeds with status 200. Note: the 401 response from SAP includes `set-cookie` headers — the retry must send fresh cookies from `resetSession()`, not the stale ones.
- [ ] Add test: `retries POST on 401 with fresh CSRF token` — mock CSRF fetch (HEAD to `/sap/bc/adt/core/discovery`) → 200 with `x-csrf-token: TOKEN1`, POST → 401, then on retry: CSRF re-fetch → 200 with `x-csrf-token: TOKEN2`, retry POST → 200. Assert CSRF token is refreshed, assert retry POST sends `X-CSRF-Token: TOKEN2` header.
- [ ] Add test: `does not retry on 401 when already retrying (guard)` — mock first fetch → 401, retry also → 401. Assert only 2 fetches (original + one retry), assert throws `AdtApiError` with `statusCode: 401`. The `authRetryInProgress` guard prevents infinite recursion.
- [ ] Add test: `does not retry non-401 errors` — mock fetch → 500. Assert only 1 fetch, assert throws `AdtApiError`
- [ ] Add test: `clears cookies on 401 retry` — mock CSRF fetch → 200 with `Set-Cookie: SAP_SESSIONID_A4H_001=SESSION1`, GET → 401 with `Set-Cookie: sap-usercontext=sap-client=001`, retry GET → 200. Assert retry request Cookie header does NOT contain `SAP_SESSIONID_A4H_001=SESSION1` (the old session cookie was cleared by `resetSession()`).
- [ ] Add test: `refreshes bearer token on 401 retry` — create client with `bearerTokenProvider` mock: `vi.fn().mockResolvedValueOnce('token1').mockResolvedValueOnce('token2')`. Mock GET → 401, retry → 200. Assert retry has `Authorization: Bearer token2`. This covers the BTP ABAP scenario where OAuth tokens expire.
- [ ] Add test: `401 retry guard is per-request not per-instance` — two sequential requests that both get 401 on first try. Assert both retry successfully (guard resets between requests via `finally { this.authRetryInProgress = false }`).
- [ ] Run `npm test` — all tests pass (~8 new tests)

### Task 3: Add XML attribute escaping to devtools.ts

**Files:**
- Modify: `src/adt/devtools.ts`

`devtools.ts` interpolates object URLs and names into XML attribute values without escaping, unlike `codeintel.ts` which uses `escapeXmlAttr()`. Add consistent escaping for defense-in-depth.

- [ ] Add an `escapeXmlAttr()` function to `devtools.ts` (or import a shared one). Use the same implementation as `codeintel.ts:14-19`: replace `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&apos;`
- [ ] In `syntaxCheck()` (line 25): the template literal `adtcore:uri="${objectUrl}"` — change to `adtcore:uri="${escapeXmlAttr(objectUrl)}"`. The objectUrl comes from `objectUrlForType()` and is pre-encoded via `encodeURIComponent`, but escaping is defense-in-depth.
- [ ] In `activate()` (line 45): change `adtcore:uri="${objectUrl}"` to `adtcore:uri="${escapeXmlAttr(objectUrl)}"`
- [ ] In `activateBatch()` (line 73): this is the **highest-risk** site — `o.name` is a raw object name (not URL-encoded), and `o.url` is a raw URL. The `.map()` call: `adtcore:uri="${o.url}" adtcore:name="${o.name}"` — change to `adtcore:uri="${escapeXmlAttr(o.url)}" adtcore:name="${escapeXmlAttr(o.name)}"`. A name like `ZCL_"TEST"` would break the XML attribute quoting without escaping.
- [ ] In `publishBody()` (line 130): `adtcore:name="${name}"` — change to `adtcore:name="${escapeXmlAttr(name)}"`. The `name` parameter is a raw service binding name passed directly from the handler.
- [ ] In `runUnitTests()` (line 193): change `adtcore:uri="${objectUrl}"` to `adtcore:uri="${escapeXmlAttr(objectUrl)}"`
- [ ] In `runAtcCheck()` (line 226): change `adtcore:uri="${objectUrl}"` to `adtcore:uri="${escapeXmlAttr(objectUrl)}"`
- [ ] Run `npm test` — all existing tests must pass (escaping is transparent for normal inputs)

### Task 4: Add unit tests for XML attribute escaping in devtools

**Files:**
- Modify: `tests/unit/adt/devtools.test.ts`

Add tests verifying that `escapeXmlAttr()` is applied in devtools XML body construction. The test file uses `vi.mock('undici')` + `mockResponse()` pattern.

- [ ] Add test: `syntaxCheck escapes special chars in object URL` — call `syntaxCheck()` with an objectUrl containing `&` (e.g., `/sap/bc/adt/oo/classes/CL_TEST&FOO`). Assert the fetch body contains `&amp;` not raw `&`
- [ ] Add test: `activate escapes special chars in object URL` — same pattern for `activate()`
- [ ] Add test: `activateBatch escapes special chars in name and URL` — call `activateBatch()` with an object whose name contains `"` (e.g., `ZCL_"TEST"`). Assert the fetch body contains `&quot;` not raw `"`
- [ ] Add test: `publishServiceBinding escapes name in XML body` — call `publishServiceBinding()` with a name containing `<` (e.g., `ZSRV<TEST`). Assert the fetch body contains `&lt;` not raw `<`
- [ ] Run `npm test` — all tests pass (~4 new tests)

### Task 5: Extract shared `escapeXmlAttr` utility to avoid duplication

**Files:**
- Modify: `src/adt/codeintel.ts`
- Modify: `src/adt/devtools.ts`
- Modify: `src/adt/transport.ts`

After Task 3 adds a local `escapeXmlAttr()` to `devtools.ts`, three files have their own copy of XML escaping logic (`codeintel.ts:14-19`, `transport.ts:118-120`, `devtools.ts`). Extract to a shared location.

- [ ] Add an `escapeXmlAttr()` export to `src/adt/xml-parser.ts` (which already exists and is the shared XML utility). The function: `export function escapeXmlAttr(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }`
- [ ] Update `src/adt/codeintel.ts`: remove the local `escapeXmlAttr` function (lines 14-19), add `import { escapeXmlAttr } from './xml-parser.js'`
- [ ] Update `src/adt/devtools.ts`: remove the local `escapeXmlAttr` function (added in Task 3), add `import { escapeXmlAttr } from './xml-parser.js'`
- [ ] Update `src/adt/transport.ts`: rename local `escapeXml` (line 118) usage to use the shared `escapeXmlAttr` import. The `escapeXml` function in transport.ts lacks `'` → `&apos;` replacement — the shared version is more complete. Remove the local `escapeXml` function and import `escapeXmlAttr` from `./xml-parser.js`
- [ ] Add a unit test in `tests/unit/adt/xml-parser.test.ts`: test `escapeXmlAttr` handles `&`, `<`, `>`, `"`, `'` and passes through normal strings unchanged
- [ ] Run `npm test` — all tests pass

### Task 6: Update documentation, roadmap, and feature matrix

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`

Update project artifacts to reflect FEAT-08 (already done), FEAT-14, and FEAT-15 completion.

- [ ] In `docs/roadmap.md` overview table (lines 43-48): strike through FEAT-08, FEAT-14, FEAT-15 rows and add "Completed" date, following the FEAT-02 pattern on line 43
- [ ] In `docs/roadmap.md` Phase A section (lines 138-142): strike through the three items and add completion notes
- [ ] In `docs/roadmap.md` FEAT-08 detail section (line 246-267): update Status from "Not started" to "Completed" and add implementation note explaining it was already implemented in the transport write compatibility work
- [ ] In `docs/roadmap.md` FEAT-14 detail section (line 271-286): update Status to "Completed" and add implementation note
- [ ] In `docs/roadmap.md` FEAT-15 detail section (line 289-304): update Status to "Completed" and add implementation note about the audit confirming `encodeURIComponent` consistency + XML attribute escaping hardening
- [ ] In `docs/compare/00-feature-matrix.md` P0 section (line ~281-284): strike through "401 session timeout auto-retry" and mark as implemented
- [ ] In `docs/compare/00-feature-matrix.md` P1 section (line ~289): remove "namespace encoding audit" from the gap list (or strike through)
- [ ] Move FEAT-08, FEAT-14, FEAT-15 entries to the "Completed" overview table in `docs/roadmap.md` (lines 92-130), with appropriate dates
- [ ] Run `npm run lint` — no lint errors in modified docs

### Task 7: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify 401 retry is exercised by checking test output for the new describe block
- [ ] Verify XML escaping tests pass by checking test output for the new devtools tests
- [ ] Move this plan to `docs/plans/completed/`
