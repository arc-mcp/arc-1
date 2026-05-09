# OAuth Security Review — Independent Verification Report

**Date:** 2026-04-08
**Scope:** Verification of the 2026-04-07 OAuth Security Review (RFC 9700 Recheck) against actual source code and primary RFC reference
**Method:** Line-by-line source code verification + RFC 9700 section number validation + additional security analysis
**Reviewer:** Claude (independent re-review)
**Primary reference:** [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)

---

## 1. Executive Summary

The original review is **substantially accurate** — 7 of 9 findings are confirmed true in both claim and severity. Two findings (F-03, F-08) contain **factual inaccuracies** in line numbers and claim details, though the underlying concerns remain partially valid. This verification also identifies **3 additional findings** not covered in the original report.

### Corrected Risk Posture

- **Critical findings:** 0 (unchanged)
- **High findings:** 3 (was 4 — F-03 downgraded after code verification)
- **Medium findings:** 4 (was 3 — added F-10)
- **Low findings:** 3 (was 2 — added F-11, F-12)

### Verification Methodology

1. Read every referenced source file in full
2. Verified each claimed line number and code snippet
3. Fetched RFC 9700 to confirm section numbers and requirement language
4. Checked for mitigating controls the original review may have missed
5. Identified additional findings through independent review

---

## 2. RFC 9700 Section Number Verification

The original review references specific RFC 9700 sections. Verification against the fetched RFC text:

| Cited Section | Exists? | Content Match? | Notes |
|---|---|---|---|
| 2.1.2 (Implicit grant) | Yes | Yes | SHOULD NOT use implicit; SHOULD use code flow |
| 2.2.1 (Sender-constrained tokens) | Yes | Yes | SHOULD use mTLS or DPoP |
| 2.2.2 (Refresh token protection) | Yes | Yes | Public client refresh tokens MUST be sender-constrained or rotated |
| 2.3 (Access token privilege restriction) | Yes | Yes | SHOULD be audience-restricted, minimum privilege |
| 2.4 (ROPC) | Yes | Yes | MUST NOT be used |
| 2.5 (Client authentication) | Yes | Yes | Asymmetric methods RECOMMENDED |
| 4.1.3 (Redirect URI validation) | Yes | Yes | MUST use exact string matching (except loopback port) |
| 4.5.3 (Code injection) | Yes | Yes | PKCE recommended countermeasure |
| 4.7.1 (CSRF protection) | Yes | Yes | MUST prevent CSRF; PKCE or state parameter |
| 4.8.2 (PKCE downgrade) | Yes | Yes | Authorization servers MUST mitigate PKCE downgrade |
| 4.10.1/4.10.2 (Token replay/audience) | Yes | Yes | Audience restriction + sender-constraining |
| 4.13 (Reverse proxies) | Yes | Yes | Additional precautions for TLS-terminating proxies |
| 4.14.2 (Refresh token lifecycle) | Yes | Yes | Sender-constraining or rotation required |
| 4.15.1 (DCR) | Yes | Partially | Section 4.15 is "Client Impersonating Resource Owner"; DCR guidance is there but framed differently |

**Verdict:** All RFC section references are valid. Section 4.15.1 is a slight stretch — the DCR guidance in RFC 9700 is about client impersonation, not DCR policy per se. The security concern is still valid but better cited as general OAuth BCP + RFC 7591 (Dynamic Client Registration Protocol).

---

## 3. Finding-by-Finding Verification

### F-01: Outbound browser OAuth flow missing `state` and PKCE

**Original claim:** `src/adt/oauth.ts:344-348` builds authorize URL without state/PKCE. Lines 266-292 have no state verification on callback.

**Verification: CONFIRMED TRUE**

- **Line 344-348** (verified): Authorize URL construction includes only `response_type=code`, `client_id`, `redirect_uri`. No `state`, no `code_challenge`, no `code_challenge_method`.
- **Lines 266-292** (verified): Callback handler extracts `code` and `error` from query params. No `state` parameter is extracted or validated.
- **Token exchange at line 366** (verified): `exchangeCodeForToken()` is called with `code` and `redirectUri` only — no `code_verifier`.

**RFC 9700 mapping confirmed:** Section 4.7.1 states clients "MUST prevent Cross-Site Request Forgery (CSRF)" via PKCE, nonce, or state. Section 4.5.3 recommends PKCE against code injection.

**Severity: HIGH** — Confirmed. Authorization code injection and login CSRF are both possible.

**Mitigating factors found:** The callback server has a 120s timeout (line 249/298-301) and closes after receiving one code (line 292). This limits the attack window but does not eliminate it.

---

### F-02: OAuth callback listener binds broadly (not loopback-only)

**Original claim:** `src/adt/oauth.ts:295` uses `server.listen(port)` without host restriction.

**Verification: CONFIRMED TRUE — WORSE THAN CLAIMED**

- **Line 295** (verified): `server.listen(port)` with no host argument.
- Node.js `http.Server.listen(port)` without a host binds to `0.0.0.0` (all interfaces), **not** just localhost.
- **Line 342** (verified): Redirect URI uses `http://localhost:${actualPort}/callback` — but the server accepts connections from any interface.

**This means:** The callback server is reachable from the local network, not just localhost. A network-adjacent attacker can send a crafted request to the callback port. Combined with F-01 (no state validation), this is exploitable.

**RFC 9700 mapping confirmed:** Section 4.1.3 (redirect URI matching) and RFC 8252 Section 8.3 (loopback interface redirection for native apps).

**Severity: HIGH** — Confirmed, arguably understated in original review.

**Fix:** `server.listen(port, '127.0.0.1')` or `server.listen(port, 'localhost')`.

---

### F-03: OIDC authorization grants full tool privileges regardless of token scopes

**Original claim:** `src/server/http.ts:274` sets OIDC-authenticated scopes to `['read','write','admin']` unconditionally. Standard mode bypasses scope gating.

**Verification: CLAIM IS INACCURATE — Downgraded**

The original review's claim is **factually wrong**:

- **Line 274** is a logging statement (`auth: authMode`), not scope assignment.
- The actual OIDC scope extraction happens via `extractOidcScopes(payload)` at **lines 321 and 363**.
- `extractOidcScopes()` (lines 386-419) properly:
  - Parses `scope` (OIDC standard) and `scp` (Azure AD) claims from the JWT
  - Filters against `KNOWN_SCOPES = ['read', 'write', 'data', 'sql', 'admin']` (line 377/410)
  - Falls back to `['read']` (read-only) when no scope claims are present (line 406)
  - Applies `expandImpliedScopes()` which adds `read` if `write` is present, `data` if `sql` is present

- `createStandardVerifier()` (lines 285-339) **does** return full `AuthInfo` with scopes, which **is** propagated to tool handlers. The claim that "standard mode bypasses scope gating" is incorrect — `requireBearerAuth` populates `extra.authInfo` on the request context.

**What IS true:** If an OIDC token has no `scope`/`scp` claims at all, the default is `['read']` — this is a **safe** default, not a dangerous one.

**Residual concern:** The `admin` scope is accepted if present in the JWT, but there's no special protection for admin-level operations beyond what scopes already provide. This is a design choice, not a vulnerability.

**Severity: LOW** (downgraded from High) — The code actually implements proper scope extraction with safe defaults.

---

### F-04: OIDC audience is optional, enabling token confusion across APIs

**Original claim:** `src/server/config.ts:97` allows missing `oidcAudience`. Lines 264-267 and 374-377 pass optional audience to jwtVerify.

**Verification: CONFIRMED TRUE — Line numbers corrected**

- **config.ts line 235** (not 97): `config.oidcAudience = getFlag('oidc-audience') ?? process.env.SAP_OIDC_AUDIENCE;`
- **types.ts line 64**: `oidcAudience?: string;` — typed as optional
- **http.ts lines 314-317** (not 264-267): `joseModule.jwtVerify(token, jwksClient, { issuer: config.oidcIssuer, audience: config.oidcAudience })` — passes `undefined` when not configured
- **http.ts lines 356-359** (not 374-377): Same pattern in `createOidcVerifier`

When `audience` is `undefined`, the `jose` library's `jwtVerify` **skips audience validation entirely**. This means any JWT from a valid issuer is accepted, regardless of intended audience.

**RFC 9700 mapping confirmed:** Section 2.3 states tokens "SHOULD be audience-restricted."

**Severity: HIGH** — Confirmed. A token issued for service X under the same OIDC issuer could be used against ARC-1. The fix should require `SAP_OIDC_AUDIENCE` when `SAP_OIDC_ISSUER` is set, failing fast at startup.

---

### F-05: XSUAA revocation endpoint likely inconsistent with overridden client identity

**Original claim:** Revocation URL enabled at line 280, but `XsuaaProxyOAuthProvider` does not override revocation.

**Verification: CONFIRMED TRUE — Line number corrected**

- **Line 316** (not 280): `revocationUrl: \`${credentials.url}/oauth/revoke\`` is set in the constructor.
- **Class methods verified** (lines 296-469): Only three overrides exist:
  - `authorize()` at line 344
  - `exchangeAuthorizationCode()` at line 392
  - `exchangeRefreshToken()` at line 442
  - **No `revokeToken()` override** — confirmed missing

The base `ProxyOAuthServerProvider` would attempt revocation using its default client credentials logic, which may not match the XSUAA service binding credentials used in the overridden exchange methods.

**Severity: MEDIUM** — Confirmed. Revocation may silently fail or target the wrong client context.

---

### F-06: Dynamic client registration is too permissive

**Original claim:** In-memory client store at lines 101-116 accepts arbitrary metadata without validation.

**Verification: CONFIRMED TRUE — with mitigating factor**

- **Lines 103-118** (verified): `registerClient()` uses spread operator `...client` to accept all properties from the registration request. No validation of:
  - `redirect_uris` (any scheme/host accepted)
  - `grant_types` or `response_types`
  - `token_endpoint_auth_method`
- **Line 115**: Stored in `Map` with no TTL, no eviction, no cap
- **No rate limiting** on registration endpoint

**Mitigating factor found:** Lines 72-74 comment that the MCP SDK validates `redirect_uri` against the client's declared list before calling `authorize()`. This is a defense-in-depth layer at the SDK level, but the `InMemoryClientStore` itself has zero validation.

**Additional concern:** Client secrets are stored as plaintext UUIDs (line 107). Memory exhaustion via unbounded registration is possible.

**Severity: MEDIUM** — Confirmed. SDK-level validation mitigates the worst redirect URI attacks, but defense-in-depth and resource exhaustion concerns remain.

---

### F-07: Shell command injection surface in browser opener

**Original claim:** Lines 217-225 build shell command strings with interpolated URL and use `exec()`.

**Verification: CONFIRMED TRUE**

- **Lines 215-227** (verified): URL is interpolated into double-quoted strings: `open "${url}"`, `xdg-open "${url}"`, `start "" "${url}"`
- **Line 230**: `exec(cmd, ...)` invokes a shell to execute the command

**Attack surface:** Within double quotes, the following are still interpreted by the shell:
- `$()` — command substitution
- Backticks — command substitution
- `${}` — variable expansion

If `serviceKey.uaa.url` contains shell metacharacters (e.g., from a compromised/malicious service key), arbitrary command execution is possible.

**Mitigating factor:** The URL originates from a BTP service key file, which is a trusted configuration input. Exploitation requires a compromised service key, which already implies a broader compromise. However, defense-in-depth dictates using `execFile()` with argument arrays.

**RFC 9700 mapping:** Not directly applicable (this is a general secure coding concern, not OAuth-specific). The original review correctly noted this as "defense in depth."

**Severity: MEDIUM** — Confirmed. Low likelihood but high impact if triggered.

---

### F-08: JWT claim hardening gap

**Original claim:** `validateJwt()` and `createOidcVerifier()` use jwtVerify with issuer/audience only, no required-claim policy.

**Verification: PARTIALLY ACCURATE — Function names corrected**

- There is **no function named `validateJwt()`**. The correct functions are `createStandardVerifier()` (line 285) and `createOidcVerifier()` (line 347).
- Both call `joseModule.jwtVerify()` with only `{ issuer, audience }` options — confirmed.
- **However:** The `jose` library's `jwtVerify()` validates `exp` (expiration) by default. This is not a gap.
- `iat`, `nbf`, `jti` are indeed not explicitly validated, but:
  - `iat` and `nbf` are optional per JWT spec
  - `jti` (JWT ID) for replay prevention requires an external store — not practical for a stateless MCP server
  - No configurable clock skew tolerance (jose uses 60s default)

**RFC 9700 mapping:** Section 2.3/4.10 — defense-in-depth for token validation. The `exp` claim is the critical one, and it IS validated by default.

**Severity: LOW** (downgraded from Medium) — The critical `exp` claim is validated. Missing `iat`/`nbf`/`jti` enforcement is a minor hardening gap, not a practical vulnerability.

---

### F-09: Reverse proxy trust without header sanitization

**Original claim:** Line 94 sets `app.set('trust proxy', 1)`.

**Verification: CONFIRMED TRUE — Line number corrected**

- **Line 122** (not 94): `app.set('trust proxy', 1);`
- Comment on lines 120-121 explains: "Trust first proxy (CF gorouter) — required for express-rate-limit and correct client IP detection behind CF's reverse proxy."
- No middleware sanitizes `X-Forwarded-*` headers before they reach application logic.

**Mitigating factor:** Setting `trust proxy` to `1` (numeric) tells Express to trust only the first proxy hop. This is appropriate for Cloud Foundry deployment where gorouter is the single trusted proxy. Direct-to-app deployments without a proxy would be vulnerable to header spoofing.

**RFC 9700 mapping confirmed:** Section 4.13 covers TLS-terminating reverse proxies.

**Severity: LOW** — Confirmed. Operational concern for non-CF deployments; appropriate for the primary BTP CF deployment target.

---

## 4. Additional Findings (Not in Original Review)

### F-10 (NEW): Reflected HTML injection in OAuth callback error response

**Severity:** Medium
**Confidence:** High

**Evidence:**
- `src/adt/oauth.ts:271-275`: The `error_description` from the OAuth callback is interpolated directly into an HTML response without escaping:
  ```typescript
  const errorDescription = url.searchParams.get('error_description') ?? error;
  res.end(`<html><body><h1>Authentication Failed</h1><p>${errorDescription}</p>...`);
  ```

**Risk:** An attacker who can control the `error_description` query parameter (e.g., via a crafted redirect) can inject arbitrary HTML/JavaScript into the callback response. This is a reflected XSS vector. Since the callback server has no state validation (F-01), an attacker can craft a malicious URL with `error=x&error_description=<script>...</script>` and direct the user's browser to it.

**Recommended fix:**
1. HTML-escape the `errorDescription` before interpolation (e.g., replace `<>&"'` with entities).
2. Set `Content-Security-Policy: default-src 'none'` header on callback responses.

---

### F-11 (NEW): No HTTPS enforcement on callback URI

**Severity:** Low
**Confidence:** High

**Evidence:**
- `src/adt/oauth.ts:342`: Callback URI is always `http://localhost:${actualPort}/callback` — plain HTTP.

**Risk:** The authorization code is transmitted over unencrypted HTTP. While localhost traffic is typically not interceptable, RFC 8252 Section 8.3 notes that loopback redirects use HTTP, so this is technically compliant for native apps. However, on systems with local network proxies or monitoring software, the code could be intercepted.

**Mitigating factor:** This is expected behavior per RFC 8252 for native app loopback redirects. The risk is low in practice.

---

### F-12 (NEW): `expandImpliedScopes` may grant unintended access

**Severity:** Low
**Confidence:** Medium

**Evidence:**
- `src/adt/safety.ts:253-258`: `expandImpliedScopes()` adds `read` when `write` is present, and `data` when `sql` is present.
- This is called in `extractOidcScopes()` (http.ts:418) and `deriveUserSafety()` (safety.ts:274).

**Risk:** If an OIDC provider issues a token with only `sql` scope, ARC-1 automatically grants `data` as well. This is documented behavior and the implication chain is sensible (`sql` is a superset of `data` read), but operators should be aware that granting `sql` in the IdP implicitly enables table preview (`data`).

**Mitigating factor:** The implication chain is explicitly documented in code comments and follows a logical privilege hierarchy. This is a design note, not a vulnerability.

---

## 5. Corrected Compliance Snapshot

| Area | RFC 9700 Section | Status | Corrected Notes |
|---|---|---|---|
| Authorization code over implicit | 2.1.2 | **Compliant** | Confirmed — no implicit flow |
| ROPC grant usage | 2.4 | **Compliant** | Confirmed — ROPC not implemented |
| Redirect URI exact matching | 4.1.3 | **Partially compliant** | Inbound: MCP SDK handles. Outbound: callback binds 0.0.0.0 (F-02) |
| CSRF protection (state/PKCE) | 4.7.1 | **Non-compliant (outbound)** | Confirmed — no state, no PKCE in BTP browser flow (F-01) |
| PKCE downgrade resilience | 4.8.2 | **Partially compliant** | Inbound: SDK enforces. Outbound: missing entirely (F-01) |
| Token replay prevention | 2.2.1, 4.10.1 | **Partial** | Bearer tokens only; no DPoP/mTLS. Acceptable for current threat model |
| Access token privilege restriction | 2.3 | **Mostly compliant** | CORRECTED: OIDC mode extracts scopes from JWT, defaults to read-only (F-03 downgraded) |
| Audience restriction | 2.3 | **Non-compliant when misconfigured** | Audience is optional in config; when omitted, validation is skipped (F-04) |
| Client authentication | 2.5 | **Partial** | Symmetric secrets only; no asymmetric client auth |
| Refresh token protection | 2.2.2, 4.14.2 | **Delegated** | XSUAA handles; revocation override missing (F-05) |
| Reverse proxy headers | 4.13 | **Acceptable for BTP CF** | Trust proxy = 1 is correct for CF; document requirements for other deployments |

---

## 6. Corrected Prioritized Remediation Plan

### Phase 0 — Immediate (pre-release blockers)

| # | Action | Findings | Effort |
|---|---|---|---|
| 1 | Add `state` + PKCE to `src/adt/oauth.ts` browser flow | F-01 | Medium |
| 2 | Bind callback server to `127.0.0.1` | F-02 | Trivial |
| 3 | HTML-escape `errorDescription` in callback response | F-10 | Trivial |
| 4 | Require `SAP_OIDC_AUDIENCE` when `SAP_OIDC_ISSUER` is set; fail at startup | F-04 | Small |

### Phase 1 — Near-term (next release)

| # | Action | Findings | Effort |
|---|---|---|---|
| 5 | Replace `exec()` with `execFile()` in `openBrowser()` | F-07 | Small |
| 6 | Override `revokeToken()` in `XsuaaProxyOAuthProvider` | F-05 | Medium |
| 7 | Add redirect URI policy + registration caps to `InMemoryClientStore` | F-06 | Medium |

### Phase 2 — Hardening (backlog)

| # | Action | Findings | Effort |
|---|---|---|---|
| 8 | Add `Content-Security-Policy` headers to callback responses | F-10 | Trivial |
| 9 | Add configurable clock skew + optional required claims for JWT | F-08 | Small |
| 10 | Document reverse proxy requirements for non-CF deployments | F-09 | Small |

---

## 7. Test Additions Required

| Test | Validates | Priority |
|---|---|---|
| `state` mismatch rejection in callback handler | F-01 | P0 |
| PKCE `code_verifier` mismatch on token exchange | F-01 | P0 |
| Callback server refuses non-loopback connections | F-02 | P0 |
| HTML injection in `error_description` is escaped | F-10 | P0 |
| Startup fails when `oidcIssuer` is set without `oidcAudience` | F-04 | P0 |
| OIDC token with only `read` scope cannot call SAPWrite | F-03 (existing behavior, verify) | P1 |
| OIDC token with no scope claims gets read-only access | F-03 (existing behavior, verify) | P1 |
| XSUAA revocation uses correct credentials | F-05 | P1 |
| DCR rejects `javascript:` redirect URIs | F-06 | P1 |
| `openBrowser()` with shell metacharacters in URL is safe | F-07 | P1 |

---

## 8. Summary of Discrepancies with Original Review

| Finding | Original Claim | Verification Result | Impact on Severity |
|---|---|---|---|
| F-01 | Missing state + PKCE | **Confirmed** | Unchanged (High) |
| F-02 | Callback binds broadly | **Confirmed, worse** | Unchanged (High) |
| F-03 | Full scopes unconditionally | **Incorrect** — scopes are properly extracted from JWT; safe read-only default | **High → Low** |
| F-04 | Optional audience | **Confirmed**, line numbers wrong | Unchanged (High) |
| F-05 | Missing revocation override | **Confirmed**, line number wrong | Unchanged (Medium) |
| F-06 | Permissive DCR | **Confirmed** with SDK mitigation noted | Unchanged (Medium) |
| F-07 | Shell injection | **Confirmed** | Unchanged (Medium) |
| F-08 | JWT claim hardening | **Partially accurate** — exp IS validated by jose default; function names wrong | **Medium → Low** |
| F-09 | Proxy trust | **Confirmed**, line number wrong | Unchanged (Low) |
| F-10 | (NEW) Reflected HTML injection | n/a | **Medium** |
| F-11 | (NEW) HTTP callback URI | n/a | **Low** |
| F-12 | (NEW) Implied scope expansion | n/a | **Low** |

---

## 9. Positive Controls Confirmed

The original review's positive controls section is accurate. Additionally:

1. **Safe scope defaults** — OIDC tokens without scope claims get read-only access (line 406), not full access as the original review implied.
2. **Scope hierarchy enforcement** — `deriveUserSafety()` (safety.ts:268-298) ensures JWT scopes can only restrict below server config, never expand. This is a well-designed defense-in-depth pattern.
3. **Token expiry propagation** — `expiresAt: payload.exp` is extracted and passed through to the MCP SDK's `requireBearerAuth`, enabling session expiry at the transport level.
4. **Stateful session isolation** — Lock/modify/unlock sequences use `withStatefulSession()` preventing cross-request state leakage.

---

## 10. References

- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)
- [RFC 8252 — OAuth 2.0 for Native Apps](https://www.rfc-editor.org/info/rfc8252) (Section 8.3: Loopback Interface Redirection)
- [RFC 7591 — OAuth 2.0 Dynamic Client Registration Protocol](https://www.rfc-editor.org/info/rfc7591)
- [RFC 9449 — OAuth 2.0 DPoP](https://www.rfc-editor.org/info/rfc9449)
- [jose library documentation](https://github.com/panva/jose) (jwtVerify default behavior: exp validated, audience optional)
- [OWASP — Reflected XSS](https://owasp.org/www-community/attacks/xss/) (F-10 reference)
