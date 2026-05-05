# OAuth Security Hardening (RFC 9700 Compliance)

> **Historical record.** This plan describes the remediation that was implemented in 2026-04-08. The DCR portion (Task 6 / F-06, "redirect URI policy + 100-client cap + 24h TTL on `InMemoryClientStore`") has since been superseded by the stateless DCR design (PR #212 / SEC-09 in [docs_page/roadmap.md](../../docs_page/roadmap.md#sec-09)). The 100-client cap was removed (no shared memory state to exhaust), the TTL default raised to 30 days and made configurable, and the redirect-URI policy retained as `validateRedirectUri()` in `src/server/stateless-client-store.ts`.

## Overview

This plan implements all remediation items from the OAuth Security Review Verification Report (`reports/2026-04-08-001-oauth-security-review-verification.md`). It addresses 10 confirmed security findings (3 High, 4 Medium, 3 Low) identified against RFC 9700 best practices, plus creates a consolidated security documentation guide for operators.

The work is organized in three phases matching the report's priority tiers: Phase 0 (immediate — High severity), Phase 1 (near-term — Medium severity), Phase 2 (hardening — Low severity + documentation). Each task is self-contained and safe to execute independently.

## Context

### Current State

The BTP browser OAuth flow in `src/adt/oauth.ts` lacks CSRF protection (no `state` parameter), PKCE, and binds the callback server to all network interfaces. The OIDC configuration allows omitting `SAP_OIDC_AUDIENCE`, which bypasses JWT audience validation. The callback error response has a reflected HTML injection vulnerability. The `openBrowser()` function uses shell string interpolation with `exec()`. The XSUAA proxy provider is missing a `revokeToken()` override. Dynamic client registration has no validation or resource limits.

No consolidated security documentation exists — security guidance is spread across 8+ docs files.

### Target State

- RFC 9700-compliant OAuth flows (state, PKCE, loopback binding)
- Mandatory OIDC audience validation
- XSS-safe callback responses with CSP headers
- Shell-safe browser opener using `execFile()`
- Complete XSUAA revocation support
- DCR with redirect URI policy and registration caps
- Startup config validation for auth mode consistency
- New `docs/security-guide.md` — consolidated security best practices for operators
- Updated feature matrix, roadmap, and end-user docs
- All changes covered by unit tests

### Key Files

| File | Role |
|------|------|
| `src/adt/oauth.ts` | BTP browser OAuth flow (state, PKCE, loopback, XSS, shell injection) |
| `src/server/http.ts` | OIDC JWT validation, auth mode routing, scope extraction |
| `src/server/xsuaa.ts` | XSUAA proxy provider, DCR client store, token revocation |
| `src/server/config.ts` | Config parsing, startup validation |
| `src/server/types.ts` | ServerConfig type (oidcAudience optionality) |
| `tests/unit/adt/oauth.test.ts` | OAuth unit tests (28 existing) |
| `tests/unit/server/http.test.ts` | OIDC scope extraction tests (14 existing) |
| `tests/unit/server/xsuaa.test.ts` | XSUAA/DCR tests (30 existing) |
| `docs/security-guide.md` | NEW — consolidated security best practices |
| `docs/roadmap.md` | Roadmap update for security hardening |
| `compare/00-feature-matrix.md` | Feature matrix update |
| `docs/enterprise-auth.md` | End-user auth documentation updates |
| `docs/authorization.md` | Authorization model documentation updates |
| `docs/deployment-best-practices.md` | Deployment security updates |

### Design Principles

1. **Defense-in-depth** — Each fix stands alone. Even if one layer fails, others still protect.
2. **Fail-fast at startup** — Invalid auth config combinations must be caught before the server starts accepting requests, not at first request time.
3. **Safe defaults** — Missing OIDC audience = startup error, not silent bypass. No scope claims = read-only, not full access.
4. **Backward compatible** — Existing valid configurations continue to work. Only invalid/dangerous configurations are rejected.
5. **No feature flags for security** — Security fixes are always on. No opt-out for state/PKCE/loopback binding.

## Development Approach

Tasks are ordered: foundation fixes first (oauth.ts, http.ts), then wiring (xsuaa.ts, config.ts), then documentation. Every code-changing task includes unit tests and runs the validation commands. The final task creates the consolidated security guide and updates all cross-cutting documentation.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add state + PKCE to BTP browser OAuth flow (F-01)

**Files:**
- Modify: `src/adt/oauth.ts`
- Modify: `tests/unit/adt/oauth.test.ts`

This task fixes the highest-severity finding: the BTP browser OAuth flow has no CSRF protection and no PKCE. RFC 9700 Section 4.7.1 requires CSRF prevention via state or PKCE. Section 4.5.3 recommends PKCE against authorization code injection.

- [ ] In `src/adt/oauth.ts`, add a helper function `generatePkce()` that creates a cryptographically random `code_verifier` (43-128 chars, URL-safe) and derives `code_challenge` via SHA-256 (S256). Use `node:crypto.randomBytes()` and `node:crypto.createHash()`. Place this near line ~200 before the browser flow section.
- [ ] In `src/adt/oauth.ts`, add a helper function `generateState()` that creates a cryptographically random state string (32 bytes, base64url-encoded). Place next to `generatePkce()`.
- [ ] In `performBrowserLogin()` (line ~329), generate `state` and PKCE verifier/challenge before building the authorize URL. Store them in local variables.
- [ ] Modify the authorize URL construction (lines 344-348) to include `&state=<state>&code_challenge=<challenge>&code_challenge_method=S256`.
- [ ] In `startCallbackServer()` (line ~247), add a `state` parameter. In the callback handler (line ~266), extract `state` from query params and validate it matches the expected value. Return 400 with a safe error message on mismatch. Do NOT include the actual state values in the error response.
- [ ] In `exchangeCodeForToken()` (line ~143), add an optional `codeVerifier` parameter. When present, include `code_verifier` in the token exchange POST body.
- [ ] Update `performBrowserLogin()` to pass `state` to `startCallbackServer()` and `codeVerifier` to `exchangeCodeForToken()`.
- [ ] Add unit tests (~10 tests): state generation randomness, PKCE challenge derivation (test vector from RFC 7636 Appendix B), state mismatch rejection in callback, missing state rejection, PKCE verifier included in token exchange body, authorize URL includes state and code_challenge params, backward compatibility of exchangeCodeForToken without verifier.
- [ ] Run `npm test` — all tests must pass

### Task 2: Bind callback server to loopback + fix reflected HTML injection (F-02, F-10)

**Files:**
- Modify: `src/adt/oauth.ts`
- Modify: `tests/unit/adt/oauth.test.ts`

The callback server binds to `0.0.0.0` (all interfaces) at line 295, making it reachable from the local network. The error response at line 274 interpolates `error_description` into HTML without escaping, enabling reflected XSS.

- [ ] In `startCallbackServer()` at line 295, change `server.listen(port)` to `server.listen(port, '127.0.0.1')`. This restricts the callback to loopback only per RFC 8252 Section 8.3.
- [ ] Add an `escapeHtml()` helper function (replace `&<>"'` with HTML entities). Place it near the top of the file or as a local function in `startCallbackServer()`. Do NOT use any external dependency — this is a simple 5-character replacement.
- [ ] Apply `escapeHtml()` to `errorDescription` at line 274 before interpolating into the HTML response.
- [ ] Add `Content-Security-Policy: default-src 'none'` header to ALL callback HTML responses (success at line 287, error at line 272, missing-code at line 282). This prevents any injected scripts from executing even if escaping is bypassed.
- [ ] Add unit tests (~6 tests): callback server binds to 127.0.0.1 (check `server.address()` after listen), HTML entities in error_description are escaped (`<script>` becomes `&lt;script&gt;`), CSP header present in success response, CSP header present in error response, error callback with special characters doesn't produce raw HTML, success callback HTML is static (no injection surface).
- [ ] Run `npm test` — all tests must pass

### Task 3: Require OIDC audience when issuer is configured (F-04)

**Files:**
- Modify: `src/server/config.ts`
- Modify: `src/server/types.ts`
- Modify: `tests/unit/server/config.test.ts` (find via `tests/unit/server/`)

When `SAP_OIDC_ISSUER` is set but `SAP_OIDC_AUDIENCE` is not, the `jose` library's `jwtVerify()` silently skips audience validation (http.ts lines 314-317). This allows tokens issued for other services under the same issuer to be accepted. RFC 9700 Section 2.3 states tokens SHOULD be audience-restricted.

- [ ] In `src/server/config.ts`, after the OIDC config is parsed (around line 235), add a startup validation check: if `config.oidcIssuer` is set and `config.oidcAudience` is NOT set, throw an error with a clear message: `"SAP_OIDC_AUDIENCE is required when SAP_OIDC_ISSUER is set — audience validation prevents token confusion across services (RFC 9700 §2.3)"`.
- [ ] Also add validation: if `config.oidcAudience` is set but `config.oidcIssuer` is NOT set, throw an error: `"SAP_OIDC_ISSUER is required when SAP_OIDC_AUDIENCE is set"`.
- [ ] Add unit tests (~4 tests): config with issuer but no audience throws at parse time, config with audience but no issuer throws, config with both issuer and audience succeeds, config with neither succeeds (no OIDC at all).
- [ ] Run `npm test` — all tests must pass

### Task 4: Replace shell exec with execFile in openBrowser (F-07)

**Files:**
- Modify: `src/adt/oauth.ts`
- Modify: `tests/unit/adt/oauth.test.ts`

The `openBrowser()` function (lines 208-238) uses `exec()` which invokes a shell, making it vulnerable to command injection via URL metacharacters (`$()`, backticks). Replace with `execFile()` which bypasses the shell entirely.

- [ ] In `src/adt/oauth.ts`, change the import from `exec` to `execFile` (line 209 uses dynamic import of `node:child_process`).
- [ ] Rewrite `openBrowser()` (lines 215-237) to use `execFile()` with argument arrays instead of string interpolation:
  - macOS: `execFile('open', [url])`
  - Windows: `execFile('cmd', ['/c', 'start', '', url])`
  - Linux: `execFile('xdg-open', [url])`
- [ ] Remove the `cmd` string variable and the switch statement that builds shell command strings.
- [ ] Update the browser opening tests (lines ~367-397 in oauth.test.ts) to mock `execFile` instead of `exec`. Verify that the URL is passed as an argument array element, not interpolated into a string.
- [ ] Add a test that verifies a URL containing shell metacharacters (`$(whoami)`, backtick commands) is passed safely as an array argument without shell interpretation.
- [ ] Run `npm test` — all tests must pass

### Task 5: Override revokeToken in XsuaaProxyOAuthProvider (F-05)

**Files:**
- Modify: `src/server/xsuaa.ts`
- Modify: `tests/unit/server/xsuaa.test.ts`

The `XsuaaProxyOAuthProvider` class (line 296 of xsuaa.ts) overrides `authorize()`, `exchangeAuthorizationCode()`, and `exchangeRefreshToken()` to use XSUAA credentials, but does NOT override token revocation. The base `ProxyOAuthServerProvider` revocation uses default client credentials which may not match the XSUAA service binding credentials.

- [ ] In `src/server/xsuaa.ts`, add an `override async revokeToken()` method to `XsuaaProxyOAuthProvider` (after `exchangeRefreshToken()` at line ~468). The method should:
  - Accept the client and token/token_type_hint parameters matching the base class signature
  - POST to `${this.xsuaaTokenUrl.replace('/oauth/token', '/oauth/revoke')}` (or use the revocation URL from the constructor at line 316)
  - Use XSUAA client credentials (`this.xsuaaClientId`, `this.xsuaaClientSecret`) as Basic auth
  - Send `token` and `token_type_hint` in the POST body (application/x-www-form-urlencoded)
  - Log success/failure via the logger
- [ ] Add unit tests (~4 tests): revokeToken sends correct credentials to XSUAA revoke endpoint, revokeToken handles 200 success, revokeToken handles revocation failure gracefully (logs warning, doesn't throw), revokeToken uses the correct URL derived from token endpoint.
- [ ] Run `npm test` — all tests must pass

### Task 6: Add redirect URI policy and registration caps to InMemoryClientStore (F-06)

**Files:**
- Modify: `src/server/xsuaa.ts`
- Modify: `tests/unit/server/xsuaa.test.ts`

The `InMemoryClientStore.registerClient()` (lines 103-118 of xsuaa.ts) accepts arbitrary registration metadata via spread operator with no validation. No redirect URI scheme/host policy, no registration limits, no TTL.

- [ ] In `InMemoryClientStore.registerClient()`, add redirect URI validation before storing the client. Reject registrations where any `redirect_uri` uses a dangerous scheme. Allowed schemes: `http` (only with `localhost`/`127.0.0.1`/`[::1]` host), `https` (any host), and custom schemes matching known MCP clients (`claude:`, `cursor:`, `vscode:`, `vscode-insiders:`). Reject `javascript:`, `data:`, `file:`, and `ftp:` schemes. Throw an error with a clear message listing the rejected URI and allowed patterns.
- [ ] Add a registration cap: limit `this.clients` Map to 100 entries. If the cap is reached, reject new registrations with an error message. This prevents memory exhaustion from unbounded DCR.
- [ ] Add a 24-hour TTL: store `registeredAt` timestamp with each client. In `getClient()`, check if the client has expired (older than 24 hours) and return `undefined` if so. Optionally, add a periodic cleanup or lazy eviction on `registerClient()`.
- [ ] Add unit tests (~8 tests): registration rejects `javascript:` redirect URI, rejects `data:` scheme, accepts `https://` URI, accepts `http://localhost:PORT/callback`, accepts `claude://callback`, rejects after 100 registrations (cap), expired client returns undefined from getClient, registration with mixed valid/invalid URIs is fully rejected.
- [ ] Run `npm test` — all tests must pass

### Task 7: Add startup config validation for auth mode consistency

**Files:**
- Modify: `src/server/config.ts`
- Modify: `tests/unit/server/config.test.ts` (or `tests/unit/cli/` — find the config test file)

Multiple auth-related config gaps were identified: auth modes can coexist without validation, `ppStrict=true` without `ppEnabled=true` silently fails, and OIDC discovery failures don't fail fast. This task adds a `validateConfig()` function that runs after parsing.

- [ ] In `src/server/config.ts`, add a `validateConfig(config: ServerConfig): void` function that checks:
  - If `ppStrict` is true but `ppEnabled` is false, throw: `"SAP_PP_STRICT=true requires SAP_PP_ENABLED=true — strict mode has no effect without principal propagation enabled"`
  - If `oidcIssuer` is set without `oidcAudience` (already added in Task 3 — this is a safety net if tasks execute independently)
  - If `xsuaaAuth` is true and the transport is `stdio`, warn (log) that XSUAA auth has no effect in stdio mode
- [ ] Call `validateConfig(config)` at the end of `parseArgs()` before returning.
- [ ] Add unit tests (~5 tests): ppStrict without ppEnabled throws, ppStrict with ppEnabled succeeds, xsuaaAuth with stdio logs warning, valid config with all auth modes passes (they can coexist — XSUAA takes precedence), empty config passes validation.
- [ ] Run `npm test` — all tests must pass

### Task 8: Add JWT claim hardening and clock skew configuration (F-08)

**Files:**
- Modify: `src/server/http.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/types.ts`
- Modify: `tests/unit/server/http.test.ts`

The `jose` library validates `exp` by default (60s clock tolerance), but no explicit required claims are set and clock skew is not configurable. Add optional `SAP_OIDC_CLOCK_TOLERANCE` config for environments with clock drift.

- [ ] In `src/server/types.ts`, add `oidcClockTolerance?: number` to `ServerConfig` (seconds, default undefined = jose default 60s).
- [ ] In `src/server/config.ts`, parse `SAP_OIDC_CLOCK_TOLERANCE` / `--oidc-clock-tolerance` as a number.
- [ ] In `src/server/http.ts`, in both `createStandardVerifier()` (line ~314) and `createOidcVerifier()` (line ~356), pass `clockTolerance` to `jwtVerify()` options when `config.oidcClockTolerance` is set. Also pass `requiredClaims: ['exp']` to make expiration explicitly mandatory (defense-in-depth — jose checks it by default, but this makes it explicit and prevents future jose version changes from breaking the assumption).
- [ ] Add unit tests (~3 tests): clock tolerance is passed to jwtVerify options when configured, requiredClaims includes 'exp', default config omits clockTolerance (jose default applies).
- [ ] Run `npm test` — all tests must pass

### Task 9: Create consolidated security guide

**Files:**
- Create: `docs/security-guide.md`
- Modify: `docs/index.md`

No single security document exists for operators deploying ARC-1 to production. Security guidance is scattered across authorization.md, enterprise-auth.md, deployment-best-practices.md, and individual auth setup guides. This task creates a consolidated security reference.

- [ ] Create `docs/security-guide.md` with these sections (use the existing docs as source material — do NOT duplicate content, instead reference other docs with links and add security-specific guidance):
  - **Security Architecture Overview** — brief summary of the two-layer model (ARC-1 scopes + SAP authorization), link to `authorization.md` for details
  - **Authentication Methods & When to Use Each** — decision matrix (stdio=none, single-user HTTP=API key, multi-user=OIDC, BTP=XSUAA), link to `enterprise-auth.md`
  - **OIDC/JWT Configuration Checklist** — mandatory: issuer + audience, recommended: clock tolerance, scope claim mapping. Reference the RFC 9700 audience requirement.
  - **API Key Security** — key rotation cadence recommendation, per-key profiles, audit logging. Link to `api-key-setup.md`
  - **Safety Configuration Best Practices** — recommended production settings (`readOnly=true` for most users, `blockFreeSQL=true`, package allowlists). Include a table of profiles with their safety implications.
  - **Scope Implications** — document that `write` implies `read`, `sql` implies `data`. Operators should be aware of transitive grants when configuring IdP scopes.
  - **Reverse Proxy Requirements** — if deploying behind a reverse proxy other than CF gorouter: must sanitize `X-Forwarded-*` headers, must terminate TLS at proxy, must set `trust proxy` appropriately.
  - **BTP-Specific Security** — XSUAA role collections, principal propagation setup, Destination Service auth types, Cloud Connector trust. Link to setup guides.
  - **Audit Logging** — how to enable file/BTP Audit Log sinks, what gets logged (tool calls, user identity, elicitation events), retention recommendations.
  - **Secrets Management** — never commit `.env`, service keys, or cookies.txt. Use environment variables or mounted files in production. Key rotation for API keys.
  - **Network Security** — the callback server for BTP browser login binds to localhost only (127.0.0.1). HTTP Streamable transport should always be behind TLS in production.
  - **Incident Response** — API key compromise: rotate key, check audit logs. Service key compromise: regenerate in BTP cockpit. JWT token leak: revoke at IdP, tokens expire per `exp` claim.
- [ ] Update `docs/index.md` to add a link to the new security guide in the appropriate section (near the auth/authorization docs).
- [ ] Run `npm test` — all tests must pass (no code changes, but verify nothing is broken)

### Task 10: Update end-user documentation for security changes

**Files:**
- Modify: `docs/enterprise-auth.md`
- Modify: `docs/authorization.md`
- Modify: `docs/deployment-best-practices.md`
- Modify: `docs/oauth-jwt-setup.md`
- Modify: `docs/btp-abap-environment.md`

Update existing documentation to reflect the security hardening changes from Tasks 1-8. Each file needs targeted updates, not rewrites.

- [ ] In `docs/enterprise-auth.md`: Add a note in the OIDC/JWT section that `SAP_OIDC_AUDIENCE` is now required when `SAP_OIDC_ISSUER` is set. Update any examples that show issuer without audience.
- [ ] In `docs/authorization.md`: Add a subsection or note about scope implications (`write` → `read`, `sql` → `data`) so operators understand transitive grants. Reference the security guide for production hardening.
- [ ] In `docs/deployment-best-practices.md`: Add a "Security Hardening" section or update the existing security recommendations to reference the new security guide. Add notes about reverse proxy header sanitization for non-CF deployments.
- [ ] In `docs/oauth-jwt-setup.md`: Update the Entra ID / OIDC configuration section to show `SAP_OIDC_AUDIENCE` as mandatory. Update any troubleshooting steps related to audience validation. Add a note about `SAP_OIDC_CLOCK_TOLERANCE` for environments with clock drift.
- [ ] In `docs/btp-abap-environment.md`: Add a note that the browser login flow now uses PKCE and state parameter for CSRF protection. The callback server binds to localhost only. No user action required — these are automatic security improvements.
- [ ] Run `npm test` — all tests must pass

### Task 11: Update roadmap and feature matrix

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `compare/00-feature-matrix.md`

Update the roadmap to track the security hardening work and update the feature matrix to reflect new security capabilities.

- [ ] In `docs/roadmap.md`, add a new entry `SEC-08: OAuth Security Hardening (RFC 9700)` in the Security & Authentication section (after SEC-07 at line ~257). Use the same format as existing entries:
  - Priority: 🔴 P0
  - Effort: M (3–5 days)
  - Status: ✅ Complete (2026-04-08) — or "In progress" if plan is not yet fully executed
  - Summary: RFC 9700 compliance for BTP browser OAuth (state, PKCE, loopback binding), OIDC audience enforcement, reflected XSS fix, shell injection fix, XSUAA revocation, DCR hardening, startup config validation
  - List the findings addressed: F-01 through F-12
- [ ] In `compare/00-feature-matrix.md`, in the "4. Safety & Security" table (line ~55), verify the "MCP scope system (OAuth)" row is accurate. Add a row for "OAuth RFC 9700 hardening" showing ARC-1 as ✅ and all others as ❌ (no other project has done this level of OAuth hardening). Add a row for "PKCE support" if not already present — ARC-1 ✅ (XSUAA proxy + BTP browser flow), check others.
- [ ] Run `npm test` — all tests must pass

### Task 12: Review and update skills for security coverage

**Files:**
- Modify: `.claude/commands/implement-feature.md`
- Modify: `.claude/commands/explain-abap-code.md`

Check that existing Claude Code skills reference security considerations and are up-to-date with the new security features. No new skills are needed — security review is a one-time activity, not a recurring skill.

- [ ] Read `.claude/commands/implement-feature.md`. If it has a security considerations phase, verify it mentions: scope enforcement, safety checks, input validation (Zod), and audit logging. If any are missing, add them. If it doesn't reference checking `src/adt/safety.ts` for new operations, add that.
- [ ] Read `.claude/commands/explain-abap-code.md`. Verify it mentions the authorization model when explaining how ARC-1 connects to SAP. No changes needed if it already references the two-layer model.
- [ ] Run `npm test` — all tests must pass

### Task 13: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify `docs/security-guide.md` exists and has all 12 sections listed in Task 9
- [ ] Verify OIDC config without audience fails at startup (grep for the validation in config.ts)
- [ ] Verify `src/adt/oauth.ts` contains `state`, `code_challenge`, `code_verifier`, `127.0.0.1`, `escapeHtml`, `execFile` (search for each keyword)
- [ ] Verify `src/server/xsuaa.ts` contains `revokeToken` override and redirect URI validation in `registerClient`
- [ ] Verify `docs/roadmap.md` contains SEC-08
- [ ] Move this plan to `docs/plans/completed/`
