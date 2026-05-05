# Global HTTP Rate Limiting (Per-Instance)

## Overview

Add per-instance, per-endpoint, per-IP rate limiting to ARC-1's HTTP transport. The XSUAA OAuth endpoints (`/register`, `/authorize`, `/token`, `/revoke`) currently have no abuse protection — anyone reachable on the network can spam `/register` and trigger HMAC work, or replay `/token` attempts in a credential-stuffing pattern. The protected `/mcp` endpoint is already auth-gated, but pre-auth probing still costs CPU + log volume.

This plan introduces an opt-out, in-memory rate limiter using `express-rate-limit`. The limiter is per-instance (no shared state, matches the stateless DCR design philosophy from PR #212), per-IP (using `req.ip` after `trust proxy 1`, which is already set in [src/server/http.ts:123](../../src/server/http.ts:123)), and per-endpoint (different ceilings for `/register` vs `/authorize` vs `/token`). Denials surface as `RateLimit-*` headers (RFC 9331 / draft-ietf-httpapi-ratelimit) and emit a typed audit event.

Scope is intentionally narrow: this is HTTP-layer abuse mitigation, not a replacement for SAP-level authorization or scope enforcement. A multi-instance attacker still costs (limit × instances), but for typical 1–4-instance ARC-1 deployments this is the right cost/benefit boundary — Redis-backed sharing would re-introduce exactly the cross-instance state the stateless DCR design eliminated.

## Context

### Current State

- HTTP transport in [src/server/http.ts](../../src/server/http.ts) mounts the MCP SDK auth router unconditionally for OAuth endpoints (`/.well-known/...`, `/register`, `/authorize`, `/token`, `/revoke`) when `config.xsuaaAuth=true`.
- `app.set('trust proxy', 1)` is already present at [src/server/http.ts:123](../../src/server/http.ts:123), with the comment "required for express-rate-limit and correct client IP detection behind CF's reverse proxy" — but no limiter is wired up.
- `package.json` does not depend on `express-rate-limit` yet.
- DCR registrations are now stateless and signed (PR #212), so `/register` spam costs HMAC CPU but no shared state — but it's still wasted CPU and noise in audit logs.
- `/mcp` is gated by `requireBearerAuth` middleware. Invalid bearers fail fast, but each failure still incurs JWT decode + verification work.
- Audit events flow through `logger.emitAudit()` → `LogSink[]` (file / stderr / BTP audit log).

### Target State

- Default-on rate limiting for the OAuth endpoints and `/mcp`, with sane per-endpoint defaults that do not affect normal usage.
- Configurable per-endpoint limits via env vars / CLI flags. Each limit can be set to `0` (or `disabled`) to opt out individually. A single `ARC1_RATE_LIMIT_DISABLED=true` master switch turns the whole feature off (for stdio dev, smoke tests, or unusual deployment topologies).
- Denials return `429 Too Many Requests` with `RateLimit-*` and `Retry-After` headers per RFC 9331 / RFC 7231 §6.6.4.
- Each denial emits a typed `rate_limit_denied` audit event with endpoint, IP, and configured limit. Visible alongside `oauth_client_lookup_failed` etc. in the security-event stream.
- All ratelimit state is in-memory per-instance — no new external dependencies, no service binding, no native module. Restart wipes the counters (acceptable for short windows).
- Documentation in `docs_page/security-guide.md`, `docs_page/configuration-reference.md`, and `docs_page/xsuaa-setup.md` covers the defaults, the operator knobs, and the trust-proxy assumption.

### Key Files

| File | Role |
|------|------|
| `src/server/http.ts` | Express app setup, middleware mounting, `trust proxy` config |
| `src/server/types.ts` | `ServerConfig` type — add `rateLimit*` fields |
| `src/server/config.ts` | Config parser — add `--rate-limit-*` flags + `ARC1_RATE_LIMIT_*` env vars |
| `src/server/audit.ts` | Audit event types — add `RateLimitDeniedEvent` |
| `src/server/rate-limit.ts` | NEW — middleware factory, audit emission helper, per-endpoint limiter builders |
| `tests/unit/server/rate-limit.test.ts` | NEW — middleware unit tests |
| `tests/unit/server/config.test.ts` | Config flag/env-var parsing tests |
| `tests/unit/server/http.test.ts` | Existing HTTP integration test (will need to handle 429 in a couple of new cases) |
| `package.json` | Add `express-rate-limit` dependency |
| `docs_page/configuration-reference.md` | New section / table rows |
| `docs_page/security-guide.md` | New "Rate limiting" subsection under §8 BTP-Specific Security or §9 Audit Logging |
| `docs_page/xsuaa-setup.md` | Brief mention in operational considerations |
| `CLAUDE.md` | Update Key Files for Common Tasks table; update config table |
| `docs_page/roadmap.md` | New SEC-10 entry |

### Design Principles

1. **Per-instance, in-memory only.** No Redis, no shared store. Multi-instance attackers cost (limit × instances) — acceptable for the threat model. This preserves the stateless-deployment property won by PR #212.
2. **Default on, opt out per endpoint or globally.** Most operators should never have to think about this. Power users (proxies handling rate limits upstream, stdio dev, smoke tests) can opt out cleanly.
3. **Audit everything denied.** Every 429 emits a `rate_limit_denied` event with `endpoint`, `ip`, `limit`, `windowMs`. Same pipeline as auth events.
4. **Trust-proxy aware.** Use `req.ip` after `trust proxy 1` (already set). Document that the rate limiter assumes one trusted proxy hop (CF gorouter). Operators behind multiple proxies need to adjust `trust proxy`.
5. **Sensible default ceilings.** `/register` is the tightest because it triggers HMAC work for stateless DCR. `/authorize` and `/token` are moderate. `/mcp` is the loosest because legitimate MCP traffic is bursty (tool calls fire in batches) and the bearer auth gates real abuse. All numbers should leave plenty of headroom for normal use.
6. **Compose, don't replace.** Rate limiting is in addition to existing scope checks, safety config, and SAP-level authorization. Failing rate-limit returns 429 _before_ any auth or business logic runs.

## Development Approach

Tasks are ordered: dependency + types first, then the middleware module (with tests), then mounting onto the app, then config wiring, then docs and final verification. Every code-changing task adds unit tests. Integration / E2E tests are not added here — `express-rate-limit` is well-tested upstream and a 429 response is straightforward HTTP behavior; unit tests of our middleware factory + a single mounted-app test in `http.test.ts` is sufficient. If smoke testing on BTP turns up issues, add E2E tests then.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add `express-rate-limit` dependency + ServerConfig fields

**Files:**
- Modify: `package.json`
- Modify: `src/server/types.ts`
- Modify: `tests/unit/server/config.test.ts`

This task adds the dependency and the typed config knobs. No runtime behavior changes yet — just the foundation. `express-rate-limit` v7 supports the `standardHeaders: 'draft-7'` mode that emits RFC 9331 / draft-ietf-httpapi-ratelimit-headers, which is what we want.

- [ ] Add `"express-rate-limit": "^7.4.0"` to `dependencies` in `package.json`. Run `npm install` to update `package-lock.json`. Confirm there is no native code in this dependency (it's pure JS, so no native module concerns for Docker / npm publishing).
- [ ] In `src/server/types.ts`, add the following fields to `ServerConfig` next to `oauthDcrTtlSeconds`:
  - `rateLimitDisabled: boolean` — global opt-out (default: `false`).
  - `rateLimitRegister: { max: number; windowMs: number }` — `/register` window. Default: `{ max: 10, windowMs: 60_000 }` (10/min).
  - `rateLimitAuthorize: { max: number; windowMs: number }` — `/authorize` window. Default: `{ max: 60, windowMs: 60_000 }`.
  - `rateLimitToken: { max: number; windowMs: number }` — `/token` and `/revoke` window. Default: `{ max: 60, windowMs: 60_000 }`.
  - `rateLimitMcp: { max: number; windowMs: number }` — `/mcp` window (per-IP, applies pre-auth). Default: `{ max: 600, windowMs: 60_000 }` — high enough that legitimate batch tool-call traffic stays well clear, low enough that a probing attacker hits the cap quickly.
- [ ] Add the same fields to `DEFAULT_CONFIG` with the values above.
- [ ] Add unit tests (~3 tests): default values are present in `parseArgs([])`, default `rateLimitDisabled` is `false`, default `rateLimitRegister` shape matches `{ max: 10, windowMs: 60000 }`.
- [ ] Run `npm test` — all tests must pass.
- [ ] Run `npm run typecheck` — no errors.

### Task 2: Build the rate-limit middleware module + audit event

**Files:**
- Create: `src/server/rate-limit.ts`
- Modify: `src/server/audit.ts`
- Create: `tests/unit/server/rate-limit.test.ts`

This task introduces the middleware factory and the audit event type. The factory takes a config slice (max, windowMs, an `endpoint` label) and returns an Express middleware that delegates to `express-rate-limit`'s `rateLimit()` with a custom `handler` that emits an audit event before sending the 429 response. No mounting yet.

- [ ] In `src/server/audit.ts`, add a new event interface `RateLimitDeniedEvent extends AuditEventBase` with:
  - `event: 'rate_limit_denied'`
  - `endpoint: string` — e.g. `/register`, `/authorize`, `/mcp`
  - `ip: string` — `req.ip` after trust-proxy resolution
  - `limit: number` — configured `max`
  - `windowMs: number` — configured window
  - Add `RateLimitDeniedEvent` to the `AuditEvent` discriminated union.
- [ ] Create `src/server/rate-limit.ts`. Export:
  - An interface `RateLimitOptions { max: number; windowMs: number; endpoint: string }`.
  - A function `createRateLimiter(opts: RateLimitOptions): RequestHandler` that builds an `express-rate-limit` instance with:
    - `windowMs: opts.windowMs`
    - `max: opts.max`
    - `standardHeaders: 'draft-7'` (RFC 9331 headers)
    - `legacyHeaders: false`
    - `keyGenerator: (req) => req.ip ?? 'unknown'` — explicitly rely on `trust proxy`
    - `handler: (req, res, _next, options) => emit audit event + respond 429 with the standard JSON body`. Use `logger.emitAudit({ ... timestamp: new Date().toISOString(), level: 'warn' ... })`.
  - A function `createNoopRateLimiter(): RequestHandler` that simply calls `next()` — used when `rateLimitDisabled=true` so call sites don't branch.
- [ ] Add unit tests (~8 tests) in `tests/unit/server/rate-limit.test.ts`:
  - Allows requests under the limit (call middleware N times, all reach `next()`).
  - Rejects with 429 once the limit is exceeded (call N+1 times, last one short-circuits, `next()` is not called).
  - 429 response includes `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After` headers.
  - Emits a `rate_limit_denied` audit event on the limiting request, with correct `endpoint`, `limit`, `windowMs`, and `ip`.
  - Does NOT emit on allowed requests.
  - The audit event has `level: 'warn'`.
  - Different IPs are tracked independently (two limits in parallel don't interfere).
  - `createNoopRateLimiter()` always calls `next()` — test by calling it 1000 times in a tight loop with the same IP and asserting no 429.
  - Use the capture-sink pattern from `tests/unit/server/stateless-client-store.test.ts` to record audit events.
- [ ] Run `npm test` — all tests must pass.
- [ ] Run `npm run typecheck` — no errors.

### Task 3: Mount limiters on OAuth endpoints in HTTP transport

**Files:**
- Modify: `src/server/http.ts`
- Modify: `tests/unit/server/http.test.ts` (only if the file currently asserts a status code that would change for an existing test — most likely no changes here, but check)

Mount per-endpoint limiters in front of the MCP SDK's `mcpAuthRouter` for `/register`, `/authorize`, `/token`, and `/revoke`. The limiters MUST run BEFORE the auth router so an attacker spamming forged credentials is blocked early. When `config.rateLimitDisabled=true`, mount the no-op limiter so the express layer is consistent.

- [ ] In `src/server/http.ts`, just inside the `if (config.xsuaaAuth && xsuaaCredentials)` block (around line ~163, before the auth-router mount), import `createRateLimiter` / `createNoopRateLimiter` from `./rate-limit.js`.
- [ ] Build a small helper `buildLimiter(opts, endpoint)` inside the block that returns `createNoopRateLimiter()` when `config.rateLimitDisabled === true`, else `createRateLimiter({ ...opts, endpoint })`.
- [ ] Mount the limiters as Express middleware via `app.use('/register', buildLimiter(config.rateLimitRegister, '/register'))` and similarly for `/authorize`, `/token`, `/revoke`. Place these BEFORE the existing `app.use('/authorize', ...)` Copilot Studio JSON-RPC middleware and before `app.use(mcpAuthRouter(...))`.
- [ ] Confirm the `/.well-known/...` discovery endpoints are NOT rate-limited (they're cheap, cacheable, and clients hit them on every reconnect). Document this as an explicit non-decision in a code comment.
- [ ] Add a one-line `logger.info('Rate limiting enabled', { endpoints: ['/register', '/authorize', '/token', '/revoke'], disabled: config.rateLimitDisabled })` after the mount so operators see it at startup.
- [ ] Read `tests/unit/server/http.test.ts` and confirm none of the existing tests would now hit a 429 (they'd have to register >10 times in a row or similar). If any do, mark them as best-effort `skip` if the legacy assertion is broken, or refactor them to set `rateLimitDisabled=true` in the test config — DO NOT silently broaden the limits to keep existing tests green.
- [ ] Run `npm test` — all tests must pass.

### Task 4: Add `/mcp` pre-auth rate limiter

**Files:**
- Modify: `src/server/http.ts`
- Modify: `tests/unit/server/http.test.ts`

Apply a per-IP limiter to `/mcp` BEFORE the bearer-auth middleware. Goal: block anonymous probing without affecting legitimate batch tool-call traffic. The default `{ max: 600, windowMs: 60_000 }` is conservative (10/sec sustained per IP) — we expect a burst-y but eventually-low-rate traffic profile.

- [ ] In `src/server/http.ts`, mount the `/mcp` limiter via `app.use('/mcp', buildLimiter(config.rateLimitMcp, '/mcp'))` BEFORE `app.all('/mcp', bearerAuth, mcpHandler)`. Place it next to the existing OAuth limiters so the order is obvious.
- [ ] In the non-XSUAA path of `startHttpServer` (the `else` branch around line ~257), also mount `/mcp` rate limiting so API-key / OIDC / no-auth deployments get the same protection. Build the limiter using the same `config.rateLimitMcp` config slice. (DCR-specific limiters do not apply outside XSUAA mode.)
- [ ] Add a unit test (~4 tests) in `tests/unit/server/http.test.ts` (or extend the existing test):
  - With XSUAA mode, hammering `/mcp` past the configured low limit returns 429 BEFORE bearer-auth runs (you can verify by setting an obviously broken bearer and confirming 429 not 401).
  - With no-XSUAA mode, the same applies.
  - With `rateLimitDisabled=true`, no 429 is ever returned.
  - The 429 emits a `rate_limit_denied` event with `endpoint: '/mcp'`.
- [ ] Run `npm test` — all tests must pass.

### Task 5: Wire CLI flags + env vars

**Files:**
- Modify: `src/server/config.ts`
- Modify: `tests/unit/server/config.test.ts`

Expose the limits as flags + env vars. Use a compact format `<max>/<windowSeconds>` — e.g. `--rate-limit-register=10/60` means 10 requests per 60s. Same parser for env (`ARC1_RATE_LIMIT_REGISTER=10/60`). For `rateLimitDisabled`, a single boolean.

- [ ] In `src/server/config.ts`, add a small helper near the top of the file: `parseLimit(raw: string | undefined, fallback: { max: number; windowMs: number }): { max: number; windowMs: number }`. Format: `<positive-int>/<positive-int>`. Reject negative numbers, NaN, missing slash, or zero-windowed limits — fall back to the default and emit a `logger.warn` so operators see the typo at startup. Allow `0/<n>` only as an explicit "disable this endpoint" signal (sets `max: 0`, which `express-rate-limit` treats as no-limit when our wrapper detects it; alternatively, we can map `max: 0` → no-op limiter — pick one and document it).
- [ ] After the `oauthDcrTtlSeconds` block, add parsing for:
  - `--rate-limit-disabled` / `ARC1_RATE_LIMIT_DISABLED` (boolean) → `config.rateLimitDisabled`.
  - `--rate-limit-register` / `ARC1_RATE_LIMIT_REGISTER` (string) → `config.rateLimitRegister`.
  - `--rate-limit-authorize` / `ARC1_RATE_LIMIT_AUTHORIZE` (string).
  - `--rate-limit-token` / `ARC1_RATE_LIMIT_TOKEN` (string).
  - `--rate-limit-mcp` / `ARC1_RATE_LIMIT_MCP` (string).
- [ ] Each parsed override should also populate `sources.rateLimit*` for the diagnostic log of "where does each value come from."
- [ ] Add unit tests (~10 tests):
  - Defaults match the values from Task 1.
  - `--rate-limit-register=20/30` → `{ max: 20, windowMs: 30_000 }`.
  - Env var with same format works.
  - CLI flag wins over env var.
  - Malformed string (`"abc"`, `"10"` without slash, `"-1/60"`, `"10/0"`) keeps the default and logs a warning. Use `vi.spyOn(logger, 'warn').mockImplementation(...)` to assert the warn fires.
  - `--rate-limit-disabled=true` sets `config.rateLimitDisabled=true`.
  - Each of the four endpoint configs is parsed independently.
- [ ] Run `npm test` — all tests must pass.

### Task 6: Documentation updates

**Files:**
- Modify: `docs_page/configuration-reference.md`
- Modify: `docs_page/security-guide.md`
- Modify: `docs_page/xsuaa-setup.md`
- Modify: `docs_page/roadmap.md`
- Modify: `CLAUDE.md`

User-facing documentation for the new knobs and audit event.

- [ ] In `docs_page/configuration-reference.md`, add a new section "Rate limiting" after the "Cache & concurrency" section. Tabulate `--rate-limit-disabled`, `--rate-limit-register`, `--rate-limit-authorize`, `--rate-limit-token`, `--rate-limit-mcp` with their env vars, defaults, and one-line descriptions. Note the `<max>/<windowSeconds>` format and the `trust proxy 1` assumption. Link to `security-guide.md` for the rationale.
- [ ] In `docs_page/security-guide.md`, add a new subsection "Rate limiting" under section 9 "Audit Logging" or as a new section 10. Cover: what's protected and at what default ceilings, how to tune, the trust-proxy assumption (single CF gorouter hop), what happens when limits are exceeded (429 + `RateLimit-*` headers + `rate_limit_denied` audit event), why per-instance is the right scope, and how to disable for stdio / smoke testing. Add `rate_limit_denied` to the "What Gets Logged" table.
- [ ] In `docs_page/xsuaa-setup.md`, in the existing "Stateless DCR" section (added by PR #212), add one short paragraph noting that `/register` is rate-limited by default (10/min/IP) and pointing to `security-guide.md` for tuning.
- [ ] In `docs_page/roadmap.md`, add a new SEC-10 entry below SEC-09 (the stateless DCR one). Status: Complete (date). Briefly describe what shipped: per-instance per-IP rate limiting on OAuth endpoints + `/mcp`, with `rate_limit_denied` audit events, RFC 9331 headers, and the per-endpoint config knobs.
- [ ] In `CLAUDE.md`:
  - Add the five new env vars / flags to the configuration table next to `ARC1_OAUTH_DCR_TTL_SECONDS`.
  - Add a new row to the Key Files for Common Tasks table: `Add/modify HTTP rate limit | src/server/rate-limit.ts (factory + audit emit), src/server/http.ts (mount), src/server/config.ts (flag/env parsing), src/server/types.ts (ServerConfig fields), tests/unit/server/rate-limit.test.ts`. Mention that limits use `req.ip` after `trust proxy 1` and document the per-instance scope.
  - Add `src/server/rate-limit.ts` to the Codebase Structure tree under `src/server/`.
- [ ] Run `npm run lint` — lint should not break on doc edits.

### Task 7: Final verification

- [ ] Run full test suite: `npm test` — all tests must pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Manual sanity test: `ARC1_RATE_LIMIT_REGISTER=2/10 npm run dev:http` then `for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8080/register -H "Content-Type: application/json" -d '{"redirect_uris":["https://example.com/cb"]}'; done` — first 2 return 201, rest return 429 with `Retry-After` header. (This step is informational — the unit tests cover it; just useful for the operator to see live.)
- [ ] Confirm no behavioural regression in `tests/integration/btp-abap.smoke.integration.test.ts` — the smoke test should still run cleanly without hitting any limiter, since it's stdio-mode.
- [ ] Move this plan to `docs/plans/completed/` once the PR merges.
