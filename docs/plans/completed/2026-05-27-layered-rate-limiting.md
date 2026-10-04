# Layered Rate Limiting

## Overview

Add three layers of rate limiting to ARC-1, each addressing a distinct threat, with the smallest possible env-var surface and documentation that an operator can read in 10 minutes. The driver: ARC-1's only backend brake today is a `Semaphore` constructed **per `AdtClient`** at [src/adt/client.ts:183](../../../src/adt/client.ts:183), so with principal propagation enabled, 100 users gives 100 × 10 = 1000 concurrent SAP requests against a dialog-work-process pool that is usually sized for far less. An LLM-driven developer fires tool calls every 1–3 s with batch-call bursts; aggregate request rate from 100 ARC-1 users can be 10–50× that of 100 Eclipse users.

Three layers ship in this plan:

1. **Layer 1 — HTTP edge.** Per-IP cap on `/register`, `/authorize`, `/token`, `/revoke`, `/mcp`. Protects the OAuth surface from brute-force / probing. Closes CodeQL alert `js/missing-rate-limiting` (currently dismissed in Security UI with rationale *"tracked in SEC-05"*). One env var: `ARC1_AUTH_RATE_LIMIT` (default `20` per minute per IP; per-endpoint internals are constants so operators have one knob, not five).
2. **Layer 2 — Per-user MCP quota.** Token bucket keyed on `authInfo.userName ?? authInfo.clientId`. Stops a single developer from monopolizing slots. Returns an MCP **tool error** with `retryAfter`, not HTTP 429, so the LLM client backs off correctly. One env var: `ARC1_RATE_LIMIT` (default `60` per minute per user).
3. **Layer 3 — SAP-bound shared semaphore.** Promote the existing `Semaphore` from per-client to one server-wide instance, and honor `Retry-After` on `429`/`503`. **Zero new env vars** — `ARC1_MAX_CONCURRENT` (existing, default `10`) keeps the same name; only its scope tightens.

Pre-1.0 explicit decisions baked in to keep the scope tight: per-instance only (no Redis), no cost-weighting per tool (deferred), no separate "monitor mode" (defaults are conservative — set the env var to `0` to disable), single retry on `429`/`503` (no exponential backoff loops). The documentation effort is the second half of the value — a single canonical operator guide ([docs_page/rate-limiting.md](../../../docs_page/rate-limiting.md)) plus reference updates across `CLAUDE.md`, `docs_page/security-guide.md`, `docs_page/configuration-reference.md`, the roadmap (SEC-05), and the feature matrix.

## Context

### Current State

- **Layer 3 (broken):** [src/adt/client.ts:183](../../../src/adt/client.ts:183) constructs `new Semaphore(config.maxConcurrent)` inside `AdtClient`. [src/server/server.ts](../../../src/server/server.ts) `createPerUserClient` (~line 222) creates a fresh `AdtClient` per MCP request when `ppEnabled=true`. Result: `ARC1_MAX_CONCURRENT=10` means "10 per user," not "10 total."
- **Layer 3 retry:** [src/adt/http.ts:446](../../../src/adt/http.ts:446) handles `503` with a fixed `1000 + Math.random() * 1000` ms jitter, ignoring `Retry-After`. `429` is **not** specifically handled — falls through to the general error path and surfaces as `AdtApiError` to the LLM.
- **Layer 1 (absent):** [src/server/http.ts:213](../../../src/server/http.ts:213) already calls `app.set('trust proxy', 1)` with the comment *"required for express-rate-limit and correct client IP detection behind CF's reverse proxy"* — but no limiter is wired up. OAuth endpoints (`/register`, `/authorize`, `/token`, `/revoke`) mount at [src/server/http.ts:394](../../../src/server/http.ts:394) via `mcpAuthRouter(...)`. The `/mcp` endpoint mounts at [src/server/http.ts:406](../../../src/server/http.ts:406) with `bearerAuth`. CodeQL alert #12 (`js/missing-rate-limiting`) on `/authorize` is dismissed with rationale *"tracked in SEC-05"*.
- **Layer 2 (absent):** No per-user quota anywhere. `handleToolCall` ([src/handlers/intent.ts](../../../src/handlers/intent.ts)) receives `authInfo` from [src/server/server.ts:640](../../../src/server/server.ts:640) but does not rate-limit based on it.
- **Audit pipeline** already supports new event types via `AuditEvent` union in [src/server/audit.ts](../../../src/server/audit.ts). The `cors_rejected` event (in [src/server/http.ts:146](../../../src/server/http.ts:146)) is the precedent for security-event audit emission.
- **Existing roadmap entry:** [SEC-05](../../../docs_page/roadmap.md#sec-05) describes this work with four env vars (`ARC1_RATE_LIMIT`, `ARC1_RATE_LIMIT_BURST`, `ARC1_AUTH_RATE_LIMIT`, `ARC1_AUTH_RATE_LIMIT_BURST`). This plan supersedes that proposal by cutting the burst variables — `express-rate-limit` and `rate-limiter-flexible` both handle burst tolerance internally.
- **Dependencies:** `express-rate-limit` is currently a transitive dep of `helmet`; this plan adds it as a direct dep. `rate-limiter-flexible` is a new direct dep.

### Target State

- One `Semaphore` constructed at server startup, shared across all `AdtClient` instances. `ARC1_MAX_CONCURRENT` is a true server-wide ceiling regardless of stdio vs HTTP, shared vs principal-propagation auth.
- `Retry-After` parsed and honored on both `429` and `503` (single retry, clamped to 60 s).
- `express-rate-limit` mounted on `/register` `/authorize` `/token` `/revoke` `/mcp` with per-endpoint **constants** in code and one operator-facing knob (`ARC1_AUTH_RATE_LIMIT`, default 20 req/min/IP, `0` to disable). Returns HTTP `429` with `Retry-After` and RFC 9331 `RateLimit-*` headers, emits `auth_rate_limited` audit event.
- `rate-limiter-flexible` token bucket per user, applied at the top of `handleToolCall`. Returns MCP tool error with structured `{error:'rate_limited', retryAfter, message}` payload, emits `mcp_rate_limited` audit event. One knob: `ARC1_RATE_LIMIT` (default 60 req/min/user, `0` to disable).
- One canonical operator guide [docs_page/rate-limiting.md](../../../docs_page/rate-limiting.md) covering threat model, sizing math against `rdisp/wp_no_dia`, audit events, troubleshooting decision tree, opt-out per layer. Linked from `index.md`, `security-guide.md`, `configuration-reference.md`. SEC-05 in roadmap marked completed. Feature matrix gains a "Rate limiting" row.
- ADR-0004 [docs/adr/0004-layered-rate-limiting.md](../../adr/0004-layered-rate-limiting.md) records the architecture rationale (per-instance, in-memory, three layers, simplified knobs).

### Key Files

| File | Role |
|------|------|
| `src/adt/semaphore.ts` | Existing Semaphore class — no change |
| `src/adt/types.ts` | Add `adtSemaphore?: Semaphore` to `AdtClientConfig` |
| `src/adt/client.ts` | Prefer `config.adtSemaphore` over constructing one |
| `src/adt/http.ts` | Add `parseRetryAfter`; honor it on 429/503 |
| `src/server/server.ts` | Construct ONE Semaphore at startup; thread into `buildAdtConfig` and `createPerUserClient` |
| `src/server/types.ts`, `src/server/config.ts` | Add 2 new fields (`rateLimit`, `authRateLimit`) |
| `src/server/audit.ts` | Add `AuthRateLimitedEvent` + `McpRateLimitedEvent` to `AuditEvent` union |
| `src/server/auth-rate-limit.ts` | NEW — Layer 1 `express-rate-limit` factory, audit emission |
| `src/server/mcp-rate-limit.ts` | NEW — Layer 2 `rate-limiter-flexible` wrapper, `consume(userKey)` returning a typed decision |
| `src/server/http.ts` | Mount Layer 1 limiters before OAuth endpoints + `/mcp` |
| `src/handlers/intent.ts` | Call Layer 2 limiter at top of `handleToolCall`; convert denial to MCP tool error |
| `docs_page/rate-limiting.md` | NEW — operator guide (the single source of truth for end users) |
| `docs/adr/0004-layered-rate-limiting.md` | NEW — short architectural rationale |
| `docs_page/configuration-reference.md` | New "Rate limiting" subsection in §5 *Server runtime* |
| `docs_page/security-guide.md` | New "Layered rate limiting" subsection; audit-event table additions |
| `docs_page/architecture.md` | One paragraph + ASCII layer diagram in the *Request Flow* section |
| `docs_page/index.md` | One bullet in the feature highlights |
| `docs_page/cli-guide.md` | Mention the 2 new flags |
| `docs_page/xsuaa-setup.md` | One-line note that `/register` is rate-limited by default |
| `docs_page/roadmap.md` | Mark SEC-05 completed |
| `docs/compare/00-feature-matrix.md` | New "Rate limiting" row + refresh "Last Updated" |
| `CLAUDE.md` | Config table rows for the 2 new vars; clarify scope of existing `ARC1_MAX_CONCURRENT`; Key Files row; codebase structure additions |
| `README.md` | One bullet in feature highlights |
| `package.json` | Add `express-rate-limit` and `rate-limiter-flexible` as direct deps |
| `tests/unit/adt/shared-semaphore.test.ts` | NEW — verifies one semaphore is shared across clients |
| `tests/unit/adt/retry-after.test.ts` | NEW — verifies `parseRetryAfter` + 429/503 retry |
| `tests/unit/server/auth-rate-limit.test.ts` | NEW — Layer 1 middleware tests |
| `tests/unit/server/mcp-rate-limit.test.ts` | NEW — Layer 2 limiter tests |
| `tests/unit/handlers/intent.test.ts` | Extend — verify `handleToolCall` returns MCP tool error on Layer 2 denial |
| `tests/unit/server/http.test.ts` | Extend — verify 429 fires before `bearerAuth` on `/mcp` |
| `tests/unit/server/config.test.ts` | Extend — parse new env vars + flag precedence |

### Design Principles

1. **Three layers, three threats.** OAuth abuse (Layer 1), noisy neighbors (Layer 2), backend overload (Layer 3). Different mechanisms, different defaults, different audit events — never conflate them.
2. **Minimum env-var surface.** Two new operator-facing knobs total: `ARC1_AUTH_RATE_LIMIT` and `ARC1_RATE_LIMIT`. Per-endpoint OAuth ceilings are constants in code; if the constants are wrong, fix them in the constant, not in env. Setting either var to `0` disables that layer cleanly.
3. **Per-instance, in-memory.** No Redis. Multi-instance attackers cost `limit × instances` — acceptable trade-off and matches the stateless-DCR philosophy (PR #212).
4. **Honor SAP signals.** `Retry-After` is the protocol-level back-off; respect it. Clamp parsed value to 60 s so a misbehaving gateway can't stall us indefinitely.
5. **Safe defaults.** `ARC1_AUTH_RATE_LIMIT=20`/min/IP — far above any legitimate OAuth flow rate. `ARC1_RATE_LIMIT=60`/min/user — one tool call/sec sustained, enough for ordinary agent workflows. `ARC1_MAX_CONCURRENT=10` — unchanged default, only scope tightens.
6. **Correct error format per layer.** Layer 1 → HTTP 429 + `RateLimit-*` headers (clients are HTTP clients). Layer 2 → MCP tool error with `retryAfter` (LLM client uses this to back off via the agent loop, not via HTTP). Layer 3 → no rejection, just queue wait.
7. **Documentation is a deliverable, not an afterthought.** One canonical guide. Every other doc links to it; none duplicates the rationale.

## Development Approach

Tasks ship in dependency order:

- Layer 3 first (Tasks 1–2): the headline bug fix. Smallest code surface, biggest impact, zero new dependencies.
- Layer 1 second (Task 3): adds the `express-rate-limit` dep and closes a CodeQL high alert.
- Layer 2 third (Task 4): adds `rate-limiter-flexible` dep and the handler integration.
- Documentation last (Task 5): the single canonical guide is written against the *as-shipped* behaviour of Tasks 1–4.

Each task is self-contained for ralphex execution in isolated sessions. Every code-changing task includes unit tests. No integration / E2E tests are needed because all three layers are deterministic in-memory behavior — `npm test` is the right tier. The smoke validation in Task 6 covers end-to-end behavior with curl against a running server.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Promote SAP-bound Semaphore to shared server-wide instance

**Files:**
- Modify: `src/adt/types.ts`
- Modify: `src/adt/client.ts`
- Modify: `src/server/server.ts`
- Create: `tests/unit/adt/shared-semaphore.test.ts`

Today `new Semaphore(config.maxConcurrent)` is constructed inside `AdtClient` ([src/adt/client.ts:183](../../../src/adt/client.ts:183)), so principal-propagation deployments get one semaphore per user — with N active users, the effective concurrency is `N × maxConcurrent`. This task constructs one semaphore at server startup, threads it through `buildAdtConfig`, and uses it in every `AdtClient` (shared and per-user). Result: `ARC1_MAX_CONCURRENT` is a true server-wide ceiling.

- [ ] In `src/adt/types.ts`, add an optional field `adtSemaphore?: Semaphore` to the `AdtClientConfig` interface, alongside the existing `maxConcurrent?: number`. Import `Semaphore` from `./semaphore.js`.
- [ ] In `src/adt/client.ts` at line ~183, replace the existing `semaphore: config.maxConcurrent ? new Semaphore(config.maxConcurrent) : undefined` with `semaphore: config.adtSemaphore ?? (config.maxConcurrent ? new Semaphore(config.maxConcurrent) : undefined)`. This preserves stdio / test behavior when no shared instance is provided, and uses the shared instance everywhere else.
- [ ] In `src/server/server.ts` at the top of `createAndStartServer` (after `logAuthSummary(config)` at ~line 698), construct `const adtSemaphore = new Semaphore(config.maxConcurrent);` and log it once: `logger.info('SAP semaphore', { maxConcurrent: config.maxConcurrent, scope: 'server-wide' });`. Import `Semaphore` from `../adt/semaphore.js`.
- [ ] Pass `adtSemaphore` to `buildAdtConfig` — change the signature from `buildAdtConfig(config, btpProxy?, bearerTokenProvider?, opts?)` to `buildAdtConfig(config, btpProxy?, bearerTokenProvider?, opts?, adtSemaphore?)` (additional positional, keep `opts.perUser` as is). Inside `buildAdtConfig` (~line 170), set `adtConfig.adtSemaphore = adtSemaphore;` after the existing `maxConcurrent` assignment.
- [ ] Update `createPerUserClient` (~line 222) to accept the shared `adtSemaphore` and pass it through to its own `buildAdtConfig(...)` call. Wire the call site in `createAndStartServer` to pass the shared semaphore into both the startup-time shared client construction AND `createPerUserClient`.
- [ ] In `CLAUDE.md`, find the `ARC1_MAX_CONCURRENT` row in the configuration table and update the description from *"Max concurrent SAP HTTP requests (default: `10`). Prevents work process exhaustion"* to *"Max concurrent SAP HTTP requests, **server-wide across all users** (default: `10`). Prevents work process exhaustion. With principal propagation, one shared semaphore enforces the cap across all per-user clients — not 10 per user."*
- [ ] Add unit tests (~5 tests) in `tests/unit/adt/shared-semaphore.test.ts`:
  - Two `AdtClient` instances configured with the same `adtSemaphore` share its FIFO queue (mock 11 concurrent requests, observe the 11th waits).
  - Without `adtSemaphore` but with `maxConcurrent`, each client gets its own semaphore (legacy behavior).
  - Shared semaphore with `maxConcurrent=1` serializes calls across clients (start two requests, observe one finishes before the other starts via Promise resolution order).
  - When the shared semaphore is provided, the per-client `maxConcurrent` is ignored.
  - `withSafety` clone preserves the shared http (and therefore the shared semaphore) — extend an existing test pattern if available.
- [ ] Use the mock-fetch helper pattern from `tests/helpers/mock-fetch.ts` and `vi.mock('undici', ...)`. Reference existing tests in `tests/unit/adt/http.test.ts` for the request-mocking pattern.
- [ ] Run `npm test` — all tests must pass.

### Task 2: Honor `Retry-After` header on 429 and 503

**Files:**
- Modify: `src/adt/http.ts`
- Create: `tests/unit/adt/retry-after.test.ts`

Currently the `503` branch at [src/adt/http.ts:446](../../../src/adt/http.ts:446) uses fixed 1–2 s jitter and ignores the `Retry-After` header. `429` (Too Many Requests) is not specifically handled and falls through to the general error path. SAP Web Dispatcher and BTP API Management both return `Retry-After`; respecting it is correct protocol behavior. This task adds a pure helper, refactors the `503` branch to use it, and adds a parallel `429` branch with the same single-retry semantics.

- [ ] In `src/adt/http.ts`, add an exported pure function near other helpers (top of the file or near `isModifyingMethod`):
  ```ts
  export function parseRetryAfter(header: string | null | undefined, fallbackMs: number): { delayMs: number; source: 'header' | 'fallback' } {
    // Returns { delayMs, source: 'header' | 'fallback' }.
    // Accepts seconds form ("5") or HTTP-date form ("Wed, 12 May 2026 14:30:00 GMT").
    // Clamps to [0, 60_000] ms. Falls back to fallbackMs on missing/invalid input.
  }
  ```
  The seconds form parses with `Number.parseInt(header, 10)` and rejects NaN. The HTTP-date form parses with `new Date(header)` and rejects `Invalid Date`. Negative or zero deltas clamp to 0. Values exceeding 60_000 clamp to 60_000.
- [ ] In the existing `503` branch at ~line 446, replace the fixed jitter computation with `const { delayMs: jitterMs, source } = parseRetryAfter(response.headers.get('retry-after'), 1000 + Math.random() * 1000);`. Update both audit log lines in the branch to include `source` in the `errorBody` text (`'503 Service Unavailable — retrying in <ms>ms (<source>)'`).
- [ ] Immediately AFTER the `503` branch, add a parallel `429` branch with the same structure:
  ```ts
  if (response.status === 429 && !retried429) {
    retried429 = true;
    const { delayMs: jitterMs, source } = parseRetryAfter(response.headers.get('retry-after'), 1000 + Math.random() * 1000);
    logger.emitAudit({
      timestamp: new Date().toISOString(),
      level: 'warn',
      event: 'http_request',
      method,
      path,
      statusCode: 429,
      durationMs: Date.now() - httpStart,
      errorBody: `429 Too Many Requests — retrying in ${Math.round(jitterMs)}ms (${source})`,
    });
    await new Promise((resolve) => setTimeout(resolve, jitterMs));
    const retryResp = await this.doFetch(url, method, headers, body);
    const retryBody = await retryResp.text();
    this.storeCookies(retryResp);
    return this.handleResponse(retryResp.status, retryResp.headers, retryBody, path);
  }
  ```
  Add a per-request `retried429 = false` boolean alongside the existing `dbRetried` / `authRetried` guards near the top of `requestInner`.
- [ ] Add unit tests (~8 tests) in `tests/unit/adt/retry-after.test.ts`:
  - `parseRetryAfter('5', 9999)` → `{ delayMs: 5000, source: 'header' }`.
  - `parseRetryAfter('Wed, 12 May 2026 14:30:00 GMT', 9999)` parses to ms-until-then, source `'header'`.
  - `parseRetryAfter(null, 1500)` → `{ delayMs: 1500, source: 'fallback' }`.
  - `parseRetryAfter('not-a-number', 1500)` → `{ delayMs: 1500, source: 'fallback' }`.
  - `parseRetryAfter('99999', 1500)` clamps to `{ delayMs: 60_000, source: 'header' }`.
  - `parseRetryAfter('-5', 1500)` clamps to `{ delayMs: 0, source: 'header' }`.
  - Past-date HTTP-date → clamps to 0.
  - Empty string falls back.
- [ ] Add a request-level test in `tests/unit/adt/http.test.ts` (extend the existing file): a `429` response with `Retry-After: 2` causes the client to wait ~2000 ms (use `vi.useFakeTimers()`) and retry once, returning the second response. A second consecutive `429` does NOT retry again (guard works). Similar mirror test for `503` with `Retry-After: 1`.
- [ ] Verify the existing `503` test in `http.test.ts` still passes — if it asserted a specific jitter range, the assertion may need adjustment to account for the new helper.
- [ ] Run `npm test` — all tests must pass.

### Task 3: Layer 1 — HTTP-edge per-IP rate limit on OAuth + /mcp

**Files:**
- Modify: `package.json`
- Modify: `src/server/types.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/audit.ts`
- Create: `src/server/auth-rate-limit.ts`
- Modify: `src/server/http.ts`
- Modify: `tests/unit/server/config.test.ts`
- Create: `tests/unit/server/auth-rate-limit.test.ts`
- Modify: `tests/unit/server/http.test.ts`

Mounts `express-rate-limit` per-IP limiters on `/register`, `/authorize`, `/token`, `/revoke`, and `/mcp` BEFORE any auth middleware. Closes CodeQL high alert `js/missing-rate-limiting` on `/authorize`. One operator-facing env var (`ARC1_AUTH_RATE_LIMIT`, default 20/min/IP, `0` disables). Per-endpoint ceilings are constants in `auth-rate-limit.ts` so the operator surface stays small — if a constant ever turns out wrong, it's a code change. Returns HTTP 429 with `RateLimit-*` headers (RFC 9331 / `standardHeaders: 'draft-7'`) and `Retry-After`.

- [ ] In `package.json`, add `"express-rate-limit": "^7.4.0"` to `dependencies`. Run `npm install` to update `package-lock.json`. Confirm no native build steps (it's pure JS).
- [ ] In `src/server/types.ts`, add to `ServerConfig`: `authRateLimit: number;` (req per minute per IP for OAuth endpoints + /mcp; `0` disables). Default to `20` in `DEFAULT_CONFIG`.
- [ ] In `src/server/config.ts`, parse `--auth-rate-limit` / `ARC1_AUTH_RATE_LIMIT`. Validation: positive int or 0; non-integer or negative → log warning and fall back to default 20. Add `sources.authRateLimit` for the diagnostic log.
- [ ] In `src/server/audit.ts`, add `AuthRateLimitedEvent` to the `AuditEvent` union:
  ```ts
  export interface AuthRateLimitedEvent extends AuditEventBase {
    event: 'auth_rate_limited';
    endpoint: string; // '/register' | '/authorize' | '/token' | '/revoke' | '/mcp'
    ip: string;
    limitPerMinute: number;
  }
  ```
- [ ] Create `src/server/auth-rate-limit.ts` exporting two functions and nothing else:
  - `createAuthRateLimiter(endpoint: string, perMinute: number): RequestHandler` — builds an `express-rate-limit` instance with: `windowMs: 60_000`, `max: perMinute`, `standardHeaders: 'draft-7'` (RFC 9331 `RateLimit-*` headers), `legacyHeaders: false`, `keyGenerator: (req) => req.ip ?? 'unknown'`, `handler` that emits an `auth_rate_limited` audit event (`endpoint`, `ip`, `limitPerMinute`) then returns the standard 429 JSON body with `Retry-After`.
  - `createNoopRateLimiter(): RequestHandler` — always calls `next()`. Used when the operator disables Layer 1 via `ARC1_AUTH_RATE_LIMIT=0`.
  Keep the module deliberately thin — no per-endpoint constants live here; the per-endpoint value is chosen at the mount site in `http.ts`.
- [ ] In `src/server/http.ts`, after `app.set('trust proxy', 1)` (~line 213), import `createAuthRateLimiter` and `createNoopRateLimiter` from `./auth-rate-limit.js`. Define one helper at the top of `startHttpServer`:
  ```ts
  // OAuth endpoints share the operator-facing baseline. /mcp gets 30x (clamped to a floor of 600/min)
  // so legitimate batched tool-call traffic isn't choked while still gating pre-auth probing.
  function buildLimiter(endpoint: string): RequestHandler {
    if (config.authRateLimit === 0) return createNoopRateLimiter();
    const perMinute = endpoint === '/mcp'
      ? Math.max(config.authRateLimit * 30, 600)
      : config.authRateLimit;
    return createAuthRateLimiter(endpoint, perMinute);
  }
  ```
- [ ] Mount inside the `if (config.xsuaaAuth && xsuaaCredentials)` block, AFTER `app.set('trust proxy', 1)` and BEFORE the `mcpAuthRouter` call (~line 394):
  ```ts
  app.use('/register', buildLimiter('/register'));
  app.use('/authorize', buildLimiter('/authorize'));
  app.use('/token', buildLimiter('/token'));
  app.use('/revoke', buildLimiter('/revoke'));
  ```
- [ ] Mount `/mcp` limiter BEFORE `app.all('/mcp', bearerAuth, mcpHandler)` (~line 406):
  ```ts
  app.use('/mcp', buildLimiter('/mcp'));
  ```
- [ ] Also mount `/mcp` limiter in the non-XSUAA path (~line 424) so API-key / OIDC / no-auth deployments get the same protection. OAuth endpoints don't exist in non-XSUAA mode, so only `/mcp` needs mounting there.
- [ ] Add a one-line startup log: `logger.info('Auth rate limiting', { perMinute: config.authRateLimit, endpoints: ['/register', '/authorize', '/token', '/revoke', '/mcp'], disabled: config.authRateLimit === 0 });`
- [ ] Confirm the existing `app.use('/authorize', ...)` Copilot Studio JSON-RPC middleware at ~line 280 stays AFTER the rate limiter — the limiter must run first.
- [ ] Confirm `/.well-known/...` discovery endpoints are NOT rate-limited (cheap, cacheable, hit on every reconnect). Add a code comment near the OAuth mount block: *"Discovery endpoints (/.well-known/*) are intentionally NOT rate-limited — they're cheap, cacheable, and clients hit them on every reconnect."*
- [ ] Add unit tests (~10 tests) in `tests/unit/server/auth-rate-limit.test.ts`:
  - `createAuthRateLimiter` allows N requests under the limit, denies the N+1th with 429.
  - 429 response includes `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After` headers.
  - 429 triggers an `auth_rate_limited` audit event with correct `endpoint`, `ip`, `limitPerMinute`.
  - Audit event is `level: 'warn'`.
  - Different IPs tracked independently.
  - `createNoopRateLimiter()` always calls `next()` (1000 calls, all pass).
  - Use the capture-sink pattern from `tests/unit/server/stateless-client-store.test.ts` to record audit events.
- [ ] Add config tests (~3 tests) in `tests/unit/server/config.test.ts`:
  - Default `authRateLimit` = 20.
  - `--auth-rate-limit=50` → 50.
  - `ARC1_AUTH_RATE_LIMIT=0` → 0 (disable).
  - Invalid input ("abc", "-5") → logs warning, uses default 20.
- [ ] Add http integration test (~3 tests) in `tests/unit/server/http.test.ts`:
  - Hammering `/mcp` past the configured limit returns 429 BEFORE bearer-auth runs (use an obviously-bad bearer; assert 429 not 401).
  - With `authRateLimit: 0`, no 429 ever returned.
  - 429 emits an `auth_rate_limited` audit event with `endpoint: '/mcp'`.
- [ ] Run `npm test` — all tests must pass.

### Task 4: Layer 2 — Per-user MCP tool-call quota

**Files:**
- Modify: `package.json`
- Modify: `src/server/types.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/audit.ts`
- Create: `src/server/mcp-rate-limit.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/server/config.test.ts`
- Create: `tests/unit/server/mcp-rate-limit.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Per-user token-bucket quota applied at the top of `handleToolCall`. Stops a single developer's LLM from monopolizing the shared semaphore. Returns an MCP **tool error** with structured payload `{error:'rate_limited', retryAfter, message}` (NOT HTTP 429) so the LLM client surfaces it as a tool failure and the agent loop backs off correctly. One operator-facing env var `ARC1_RATE_LIMIT` (default `60` per minute per user, `0` disables).

- [ ] In `package.json`, add `"rate-limiter-flexible": "^5.0.0"` to `dependencies`. Run `npm install`. Confirm no native deps (pure JS, in-memory backend only).
- [ ] In `src/server/types.ts`, add to `ServerConfig`: `rateLimit: number;` (req per minute per user for MCP tool calls; `0` disables). Default to `60` in `DEFAULT_CONFIG`.
- [ ] In `src/server/config.ts`, parse `--rate-limit` / `ARC1_RATE_LIMIT`. Validation: positive int or 0; invalid → log warning, default 60. Add `sources.rateLimit`.
- [ ] In `src/server/audit.ts`, add `McpRateLimitedEvent` to the `AuditEvent` union:
  ```ts
  export interface McpRateLimitedEvent extends AuditEventBase {
    event: 'mcp_rate_limited';
    user: string;          // userName ?? clientId ?? '__anon__'
    tool: string;
    limitPerMinute: number;
    retryAfterMs: number;
  }
  ```
- [ ] Create `src/server/mcp-rate-limit.ts`:
  - Import `RateLimiterMemory` from `rate-limiter-flexible`.
  - Export type `RateLimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number; limitPerMinute: number }`.
  - Export `createMcpRateLimiter(perMinute: number): { consume(userKey: string, tool: string): Promise<RateLimitDecision> }` — returns an object that consumes one point per call. When `perMinute === 0`, return a stub whose `consume` always resolves `{ allowed: true }` (no allocation). When `perMinute > 0`, construct `new RateLimiterMemory({ points: perMinute, duration: 60 })`. The `consume` method calls `.consume(userKey)`; on success returns `{ allowed: true }`; on rejection (`RateLimiterRes` thrown), returns `{ allowed: false, retryAfterMs: rejRes.msBeforeNext, limitPerMinute: perMinute }`. Catch the rejection in a try/catch — `rate-limiter-flexible` throws `RateLimiterRes` on overflow.
  - Document in a header comment: per-minute token bucket, in-memory only, per-instance, key resolution at call site.
- [ ] In `src/handlers/intent.ts`:
  - Construct a module-level (file-scoped) limiter instance in the existing module — accept it through `handleToolCall`'s closure, OR add a `mcpRateLimiter` parameter to `handleToolCall`. **Choose the parameter approach** to match the existing pattern where `handleToolCall` receives `client`, `config`, `cachingLayer` etc. as parameters. Add `mcpRateLimiter: McpRateLimiter` (typed) to the parameter list AFTER `isPerUserClient`.
  - In `handleToolCall`, AT THE TOP (before any other work — even before scope check), if `authInfo` is present, compute `userKey = authInfo.userName ?? authInfo.clientId ?? '__anon__'`. Call `await mcpRateLimiter.consume(userKey, toolName)`. If `allowed === false`, emit `mcp_rate_limited` audit event with `user`, `tool`, `limitPerMinute`, `retryAfterMs`, then return an MCP tool error using the existing `textResult` helper with `isError: true`:
    ```ts
    return {
      content: [{ type: 'text', text: JSON.stringify({
        error: 'rate_limited',
        retryAfter: Math.ceil(retryAfterMs / 1000),
        message: `Rate limit exceeded (${limitPerMinute}/min). Retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`,
      }) }],
      isError: true,
    };
    ```
  - When `authInfo` is undefined (stdio mode), skip the consume entirely — no user identity to key on. Document this with a code comment.
- [ ] In `src/server/server.ts`, construct the limiter at startup: `const mcpRateLimiter = createMcpRateLimiter(config.rateLimit);` and pass it through to `handleToolCall` at ~line 640. Add a startup log: `logger.info('MCP rate limiting', { perMinute: config.rateLimit, disabled: config.rateLimit === 0 });`
- [ ] Add unit tests (~8 tests) in `tests/unit/server/mcp-rate-limit.test.ts`:
  - With `perMinute=5`, 5 consume calls succeed; 6th returns `{ allowed: false, retryAfterMs, limitPerMinute: 5 }`.
  - `retryAfterMs` > 0 and < 60_000 on denial.
  - Two distinct user keys tracked independently (5 each, both succeed).
  - With `perMinute=0`, 1000 consume calls all succeed (disabled path).
  - The bucket refills over time — mock the limiter's internal clock if feasible; otherwise just assert behavior before refill.
- [ ] Extend `tests/unit/handlers/intent.test.ts` (~5 tests):
  - When `mcpRateLimiter.consume` returns `{ allowed: false }`, `handleToolCall` returns an MCP tool error with `isError: true` and the structured payload.
  - Audit event `mcp_rate_limited` is emitted on denial.
  - When `authInfo` is undefined, the limiter is NOT consulted (stdio path skip).
  - Allowed calls pass through to tool dispatch.
  - The error payload `retryAfter` is in seconds (rounded up), not milliseconds.
- [ ] Add config tests (~3 tests) in `tests/unit/server/config.test.ts`:
  - Default `rateLimit` = 60.
  - `--rate-limit=120` → 120.
  - `ARC1_RATE_LIMIT=0` → 0 (disable).
- [ ] Run `npm test` — all tests must pass.

### Task 5: Documentation — operator guide, ADR, and reference updates

**Files:**
- Create: `docs_page/rate-limiting.md`
- Create: `docs/adr/0004-layered-rate-limiting.md`
- Modify: `docs_page/configuration-reference.md`
- Modify: `docs_page/security-guide.md`
- Modify: `docs_page/architecture.md`
- Modify: `docs_page/index.md`
- Modify: `docs_page/cli-guide.md`
- Modify: `docs_page/xsuaa-setup.md`
- Modify: `docs_page/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`

This is the deliverable that turns the code into a usable feature. Each variable gets a plain-English explanation, the threat model is laid out per layer, and there's a sizing math example so operators don't have to guess. One canonical guide; every other doc links to it without duplicating the rationale.

- [ ] Create `docs_page/rate-limiting.md` with the following sections (use the structure verbatim):

  1. **Why ARC-1 rate-limits** (one paragraph). 100 developers on Eclipse type at human speeds; 100 developers steering ARC-1 from an LLM fire batch tool calls every 1–3 s; aggregate rate from ARC-1 can be 10–50× higher. Same SAP dialog-work-process pool absorbs both. Rate limiting prevents one developer's runaway agent from starving the rest, prevents the OAuth surface from being brute-forced, and prevents ARC-1 from overloading SAP.

  2. **The three layers** — ASCII diagram and one-paragraph explanation each:
     ```
     ┌─────────────────────────────────────────────────────────────┐
     │ Layer 1 — HTTP edge                                         │
     │   Per-IP cap on /register /authorize /token /revoke /mcp    │
     │   Protects: OAuth brute-force, anonymous /mcp probing       │
     │   Response: HTTP 429 + Retry-After + RateLimit-* headers    │
     │   Audit event: auth_rate_limited                            │
     │   Env var: ARC1_AUTH_RATE_LIMIT (default 20/min/IP)         │
     └─────────────────────────────────────────────────────────────┘
                                  │
     ┌─────────────────────────────────────────────────────────────┐
     │ Layer 2 — Per-user MCP quota                                │
     │   Token bucket per authenticated user (userName/clientId)   │
     │   Protects: one developer monopolizing the shared semaphore │
     │   Response: MCP tool error with retryAfter (NOT HTTP 429)   │
     │   Audit event: mcp_rate_limited                             │
     │   Env var: ARC1_RATE_LIMIT (default 60/min/user)            │
     └─────────────────────────────────────────────────────────────┘
                                  │
     ┌─────────────────────────────────────────────────────────────┐
     │ Layer 3 — SAP-bound shared semaphore                        │
     │   Server-wide cap on concurrent SAP HTTP requests           │
     │   Honors Retry-After on 429/503 from SAP/gateway            │
     │   Protects: SAP work-process / ICM thread exhaustion        │
     │   Response: queue wait (no rejection)                       │
     │   Audit event: http_request with status 429/503             │
     │   Env var: ARC1_MAX_CONCURRENT (default 10, server-wide)    │
     └─────────────────────────────────────────────────────────────┘
                                  │
                       SAP work processes
     ```

  3. **Configuration — two new variables and one with clarified scope.** A table with three rows:

     | Env var | Default | What it caps | What happens on cap | Set to 0 to |
     |---------|---------|--------------|---------------------|--------------|
     | `ARC1_AUTH_RATE_LIMIT` | `20` | OAuth requests per IP per minute on `/register`, `/authorize`, `/token`, `/revoke`. `/mcp` gets `max(value × 30, 600)/min/IP` to absorb legitimate batch traffic. | HTTP 429 with `Retry-After` and `RateLimit-*` headers; `auth_rate_limited` audit event | disable Layer 1 |
     | `ARC1_RATE_LIMIT` | `60` | MCP tool calls per authenticated user per minute. Key derivation: `userName` (preferred), then `clientId`, then `__anon__`. | MCP tool error `{error:'rate_limited', retryAfter, message}`; `mcp_rate_limited` audit event | disable Layer 2 |
     | `ARC1_MAX_CONCURRENT` | `10` | **Server-wide** concurrent SAP HTTP requests across all users (was previously per-client — see ADR-0004). | Excess requests wait in FIFO queue (no rejection). 429/503 from SAP/gateway trigger one retry honoring `Retry-After` (clamped to 60 s). | reduce to 1 for absolute serialization; **no off switch** — the cap protects your SAP system from yourself |

  4. **Recommended settings by team size.** Three copy-pasteable env blocks:
     - **Small team (≤5 developers, dev sandbox)**: defaults. No action.
     - **Medium team (5–20 developers, shared sandbox)**: `ARC1_MAX_CONCURRENT=15`, `ARC1_RATE_LIMIT=90`. Layer 1 default is fine.
     - **Large team (20–100 developers, multiple ARC-1 instances behind a load balancer)**: see the sizing math below; set `ARC1_MAX_CONCURRENT` per instance, leave the others at default.

  5. **Sizing math against `rdisp/wp_no_dia`.** The hard ceiling on the SAP side is the dialog-work-process count, configurable via the SAP profile parameter `rdisp/wp_no_dia` (visible in transaction `RZ11`). Reserve ~60% of dialog WPs for ARC-1 fleet total (the rest stays available for Eclipse, SAPGUI, batch users). With `N` ARC-1 instances behind a load balancer, set `ARC1_MAX_CONCURRENT = floor(0.6 × wp_no_dia / N)`. Worked example: `wp_no_dia=40`, two instances → `ARC1_MAX_CONCURRENT=12` per instance. For BTP ABAP environment / Steampunk, the platform enforces its own quotas — start at `ARC1_MAX_CONCURRENT=20` and lower if `http_request` audit events show frequent 429s with `source: 'header'` (gateway is actively throttling).

  6. **Audit events.** A table:

     | Event | Layer | Meaning | What to do |
     |-------|-------|---------|------------|
     | `auth_rate_limited` | 1 | OAuth or `/mcp` endpoint hit the per-IP cap. Usually OAuth probing; legitimate spikes happen during deploy storms. | If frequent from one IP → probe attack. If from many IPs → increase `ARC1_AUTH_RATE_LIMIT`. |
     | `mcp_rate_limited` | 2 | A single user hit the per-user quota. Their LLM was in a tight retry loop or genuinely doing heavy work. | Check user behavior. If legitimate heavy work → increase `ARC1_RATE_LIMIT`. If runaway loop → the limit is working as designed. |
     | `http_request` status `429` | 3 | SAP or BTP gateway throttled us; we retried once after honoring `Retry-After`. | If frequent → lower `ARC1_MAX_CONCURRENT`. You're running too hot. |
     | `http_request` status `503` | 3 | SAP overloaded (ICM / work-process exhaustion); we retried. | Same as 429 — lower the concurrency cap. Cross-check with SAP transaction `SM50`. |

  7. **Troubleshooting decision tree.**
     - *Client sees HTTP 429 from ARC-1* → Layer 1. Check `auth_rate_limited` audit events. If from one IP, suspect abuse. If from legitimate clients during a deploy storm, raise `ARC1_AUTH_RATE_LIMIT`.
     - *Client sees MCP tool error with `"error":"rate_limited"`* → Layer 2. Check `mcp_rate_limited` audit events. Raise `ARC1_RATE_LIMIT` if the user is doing legitimate heavy work.
     - *SAP-side `SM50` shows work-process exhaustion* → Layer 3 is too loose. Lower `ARC1_MAX_CONCURRENT`.
     - *SAP-side `SM21` shows ICM thread exhaustion* → ARC-1 isn't the only consumer. Tune at the SAP profile (`icm/max_threads`) or lower `ARC1_MAX_CONCURRENT` further to be a better citizen.
     - *Repeated `http_request` 429 audit events with `source: header`* → a gateway is actively throttling. You're running too hot.

  8. **Disabling each layer.**
     - Layer 1: `ARC1_AUTH_RATE_LIMIT=0`. Use only when an upstream reverse proxy already rate-limits the OAuth surface.
     - Layer 2: `ARC1_RATE_LIMIT=0`. Use only for single-user deployments or when you trust the upstream client.
     - Layer 3: no on/off switch. Lower the value to throttle harder; raise it to allow more concurrency. The cap exists to protect SAP from ARC-1, not the other way around.

  9. **Multi-instance considerations.** All three layers use **per-instance in-memory state** — no Redis, no shared store. With `N` instances behind a load balancer: Layers 1+2 effective ceilings become `N × limit`; Layer 3 must be sized as `floor(target / N)` per instance. The reasoning is recorded in [ADR-0004](../../adr/0004-layered-rate-limiting.md) — per-instance preserves the stateless deployment property won by PR #212.

  10. **Operational checklist** for deploying ARC-1 for >5 developers (bullet list):
      - Find `rdisp/wp_no_dia` via transaction `RZ11` and divide as in the sizing math above.
      - Set `ARC1_MAX_CONCURRENT` explicitly in your deployment env (do not rely on the default).
      - Watch `auth_rate_limited`, `mcp_rate_limited`, and `http_request` (status 429/503) for a few days; tune up if you see false positives, tune down if you see SAP overload.
      - Keep the defaults for `ARC1_AUTH_RATE_LIMIT` and `ARC1_RATE_LIMIT` until telemetry shows otherwise.

- [ ] Create `docs/adr/0004-layered-rate-limiting.md` following the format of `docs/adr/0001-discovery-driven-endpoint-routing.md`. Sections: Status (Accepted, date), Context (per-client semaphore bug; no HTTP-edge protection; no per-user fairness; CodeQL alert SEC-05; multi-tenant deployments need all three), Decision (three layers, per-instance in-memory, two operator-facing env vars, per-endpoint OAuth constants in code not env, no monitor mode in v1, single retry on 429/503 honoring Retry-After, cost weighting deferred to v2), Consequences (operators must size Layer 3 against `rdisp/wp_no_dia`; multi-instance gives `N × limit` for Layers 1+2; Layer 2 keyed on `userName ?? clientId` — anon traffic shares one bucket; CodeQL alert #12 closes), Alternatives considered and rejected (Redis-backed sharing — reintroduces shared state PR #212 removed; cost-weighted per-tool quota — deferred; monitor mode — pre-1.0 defaults are conservative enough; five per-endpoint OAuth knobs — too many for the value provided).

- [ ] In `docs_page/configuration-reference.md`, find section §5 *Server runtime* (look for the existing concurrency entry around `ARC1_MAX_CONCURRENT`). Add a "Rate limiting" subsection at the end of §5 with two table rows for the new vars and a clarification row for `ARC1_MAX_CONCURRENT`:

  | Flag | Env var | Default | Effect |
  |---|---|---|---|
  | `--auth-rate-limit` | `ARC1_AUTH_RATE_LIMIT` | `20` | OAuth-surface per-IP cap, requests per minute on `/register`, `/authorize`, `/token`, `/revoke`. `/mcp` gets a higher cap to absorb legitimate MCP batch traffic (`max(value × 30, 600)/min/IP`). On hit, HTTP 429 + `Retry-After` + RFC 9331 `RateLimit-*` headers + `auth_rate_limited` audit event. `0` disables Layer 1. See [Rate Limiting Guide](rate-limiting.md) for sizing. |
  | `--rate-limit` | `ARC1_RATE_LIMIT` | `60` | Per-user MCP tool-call cap, requests per minute. Key = `authInfo.userName ?? clientId ?? __anon__`. On hit, returns MCP tool error `{error:'rate_limited',retryAfter,message}` + `mcp_rate_limited` audit event. Stdio mode (no user identity) is exempt. `0` disables Layer 2. See [Rate Limiting Guide](rate-limiting.md). |

  And update the existing `ARC1_MAX_CONCURRENT` row description to say *"**Server-wide** across all users (regardless of stdio vs HTTP, shared vs principal propagation). Default `10`. Excess waits in FIFO queue; `429`/`503` from SAP/gateway triggers one retry honoring `Retry-After`. See [Rate Limiting Guide](rate-limiting.md)."*. If the row currently lives in a "Cache & concurrency" subsection, leave it there but add the cross-reference.

- [ ] In `docs_page/security-guide.md`, add a new subsection "Layered rate limiting" near the existing "Audit Logging" section. Include the ASCII layer diagram from the guide, three-sentence summary of each layer's purpose, and a single link to [rate-limiting.md](rate-limiting.md). Add `auth_rate_limited` and `mcp_rate_limited` to the audit-event listing.

- [ ] In `docs_page/architecture.md`, locate the *Request Flow* section. Add one paragraph: *"Three rate-limiting layers gate the request flow — Layer 1 (per-IP HTTP edge) runs before any auth middleware; Layer 2 (per-user MCP quota) runs at the top of `handleToolCall` and converts denials to MCP tool errors; Layer 3 (shared SAP-bound semaphore) caps concurrent SAP HTTP requests server-wide and honors `Retry-After` on 429/503 from SAP or BTP gateways. See [Rate Limiting Guide](rate-limiting.md)."* Reuse the ASCII diagram if it doesn't bloat the section.

- [ ] In `docs_page/index.md`, find the feature highlights / capability list. Add a single bullet: *"**Layered rate limiting** — per-IP OAuth-edge limits, per-user MCP quota, server-wide SAP-bound semaphore with `Retry-After` honoring. [Read the guide](rate-limiting.md)."*

- [ ] In `docs_page/cli-guide.md`, in the section that enumerates flags, add a brief mention of `--auth-rate-limit` and `--rate-limit` with one-line descriptions and a pointer to the guide.

- [ ] In `docs_page/xsuaa-setup.md`, in the existing "Stateless DCR" section (if present) or near the OAuth endpoint discussion, add one paragraph: *"`/register`, `/authorize`, `/token`, `/revoke` are per-IP rate-limited by default (`ARC1_AUTH_RATE_LIMIT=20`/min/IP). Closes CodeQL alert `js/missing-rate-limiting`. Tune via the env var or disable with `=0` if an upstream proxy already provides this. See [Rate Limiting Guide](rate-limiting.md)."*

- [ ] In `docs_page/roadmap.md`, find SEC-05 (search for `<a id="sec-05">`). Change Status from `Not started` to `Completed — <YYYY-MM-DD>` (use the merge date placeholder). Update the Configuration block to reflect the simplified two-variable set (drop the `_BURST` rows). Add a one-paragraph "What shipped" subsection: *"Layered rate limiting with simplified env-var surface (`ARC1_AUTH_RATE_LIMIT`, `ARC1_RATE_LIMIT`) — per-endpoint OAuth ceilings are hardcoded constants. Closes CodeQL alert #12 on `/authorize`. See [Rate Limiting Guide](../../../docs_page/rate-limiting.md) and [ADR-0004](../../adr/0004-layered-rate-limiting.md)."*

- [ ] In `docs/compare/00-feature-matrix.md`, refresh the `_Last updated_` line at the top with today's date and a one-paragraph entry summarizing the rate-limiting work. Find a relevant section (likely "Safety & Security" near the bottom of the existing table) and add a row "Rate limiting (layered)" with `✅` for ARC-1 and `❌` for competitors unless prior research showed otherwise.

- [ ] In `CLAUDE.md`:
  - Update the `ARC1_MAX_CONCURRENT` row in the configuration table — change description to *"Max concurrent SAP HTTP requests, **server-wide across all users** (default: `10`). Prevents work process exhaustion."*
  - Add two new rows for `ARC1_AUTH_RATE_LIMIT` (default `20`) and `ARC1_RATE_LIMIT` (default `60`) with one-line descriptions pointing at the guide.
  - Add a row to the "Key Files for Common Tasks" table: `Add/modify rate limiting | Layer 1: src/server/auth-rate-limit.ts + http.ts mount. Layer 2: src/server/mcp-rate-limit.ts + intent.ts (top of handleToolCall). Layer 3: src/adt/semaphore.ts (shared instance constructed in src/server/server.ts, threaded via buildAdtConfig) + src/adt/http.ts parseRetryAfter. Audit events: auth_rate_limited, mcp_rate_limited in src/server/audit.ts. Config: src/server/{types,config}.ts. Docs: docs_page/rate-limiting.md + ADR-0004.`
  - In the Codebase Structure tree under `src/server/`, add `auth-rate-limit.ts` and `mcp-rate-limit.ts`.

- [ ] In `README.md`, find the feature highlights section near the top. Add one bullet: *"**Layered rate limiting** — protects the OAuth surface, prevents noisy neighbors, caps SAP backend load. [Guide](docs_page/rate-limiting.md)."*

- [ ] Read the operator guide cold once more, as if you've never used ARC-1. Each env var must be findable in <30 seconds and explained in plain English. The sizing math example must be copy-pasteable. The troubleshooting tree must lead the operator from symptom to action without backtracking.

- [ ] Run `npm run lint` — Markdown edits must not break lint.

### Task 6: Final verification

**Files:**
- Move: `docs/plans/completed/2026-05-27-layered-rate-limiting.md` → `docs/plans/completed/`

- [ ] Run full test suite: `npm test` — all tests must pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Manual smoke (Layer 3 — shared semaphore): start ARC-1 in stdio mode against a dev SAP system. Open two MCP clients pointed at the same instance. From each client, fire 15 parallel `SAPRead` calls. Observe via SAP transaction `SM50` that the active-WP count from ARC-1 never exceeds `ARC1_MAX_CONCURRENT` (default 10) even though 30 requests are inflight from the two clients.
- [ ] Manual smoke (Layer 2 — per-user MCP quota): start ARC-1 in HTTP mode with `ARC1_RATE_LIMIT=5`. Fire 10 sequential tool calls via curl with the same bearer. Calls 1–5 succeed, calls 6–10 return MCP tool errors with `"error":"rate_limited"` and `retryAfter` ≈ 60. Verify 5 `mcp_rate_limited` audit events fire.
- [ ] Manual smoke (Layer 1 — OAuth edge): start ARC-1 with `ARC1_AUTH_RATE_LIMIT=2`. Run `for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8080/register -H "Content-Type: application/json" -d '{"redirect_uris":["https://example.com/cb"]}'; done`. Calls 1–2 return 201, calls 3–5 return 429 with `Retry-After` header. Verify 3 `auth_rate_limited` audit events fire.
- [ ] Manual smoke (Layer 3 — Retry-After): use a mock SAP endpoint (or temporarily wedge the dev SAP into 429) that returns `Retry-After: 2`. Trigger one ADT request. Observe the request waits ~2 s and retries successfully. Verify the `http_request` audit event includes `source: header` in the `errorBody`.
- [ ] Verify CodeQL alert #12 (`js/missing-rate-limiting` on `/authorize`) closes on the next scan after merge. (Step is informational — actual alert state is checked in GitHub Security UI after deploy.)
- [ ] Read [docs_page/rate-limiting.md](../../../docs_page/rate-limiting.md) end-to-end one final time. Verify the env-var table, sizing example, audit-event table, and troubleshooting tree are all internally consistent with the shipped code. Fix any drift.
- [ ] Move `docs/plans/completed/2026-05-27-layered-rate-limiting.md` to `docs/plans/completed/` with the merge date prefixed (e.g. `2026-05-XX-001-layered-rate-limiting.md` per the existing naming convention in `docs/plans/completed/`).
