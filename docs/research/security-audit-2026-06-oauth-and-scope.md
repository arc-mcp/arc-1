# Security Audit — OAuth State Integrity & Scope Enforcement (2026-06)

**Date:** 2026-06-05
**Scope:** `src/handlers/intent.ts` (scope router), `src/server/{http,xsuaa,oauth-state,stateless-client-store}.ts` (XSUAA OAuth + DCR), `src/authz/policy.ts`, `src/adt/safety.ts`
**Status:** Findings 1 & 2 remediated in this change set. Finding 3 deferred (rationale below).

---

## Executive summary

A white-box review of authorization enforcement and OAuth state integrity found two
exploitable issues plus one fail-closed usability bug:

1. **High — Privilege escalation via parameter coercion** (`SAPRead` scope router). A caller
   holding only the `read` scope could reach the `data`-scoped `TABLE_CONTENTS` /
   `TABLE_QUERY` operations because the scope key was derived from the **raw** request
   argument, while the handler dispatched on a **normalized** (upper-cased, coerced) copy.
   The two values disagreed, so the gate looked up the wrong (lower) policy. **Fixed.**

2. **Medium/High — Authorization-code interception via unbound OAuth state** (XSUAA callback
   proxy). The signed `state` token bound the client's `redirect_uri` but not the DCR
   `client_id`, so the callback would forward an auth code to whatever `redirect_uri` rode
   inside a validly-signed state — even one substituted by an attacker on a victim's
   `client_id`. **Fixed for DCR clients; residual on the pre-registered XSUAA default client
   documented below.**

3. **Low/Informational — Fail-closed package-rule intersection.** `deriveUserSafetyFromProfile`
   cannot statically prove a profile sub-package is inside a server `ZFOO/**` subtree, so it
   denies it. This is conservative-by-design (denies, never over-grants). **Deferred** — see
   rationale.

The COOP/`helmet` configuration, the mutation gates (`checkOperation`/`checkPackage`/
`checkGit`), and the existing-object package resolution (`enforcePackageForExistingObject`)
were reviewed and found sound (bearer-token auth, no ambient cookies → disabling COOP is safe;
`apply_quickfix` is correctly read-classified as a dry-run delta fetch).

---

## Finding 1 — Privilege escalation via parameter coercion (High) — FIXED

### Root cause

`handleToolCall` derived the scope key (`actionOrType`) from the raw `args.type` with a
`typeof === 'string'` guard, *before* `normalizeTypeArgsForValidation` ran. Any value that
was not already a matching string fell through to the **tool-level base policy** (`SAPRead` →
`read`). Normalization then canonicalized the same value into a privileged type for the
handler and for Zod. Two inputs exploited the gap:

| Input (`type`)        | Raw scope key      | Policy hit        | Normalized → handler | Effect |
|-----------------------|--------------------|-------------------|----------------------|--------|
| `["TABLE_CONTENTS"]`  | `typeof "object"` → `undefined` | base `SAPRead` = `read` | `String([…])` → `TABLE_CONTENTS` | `data` op runs with `read` |
| `"table_contents"`    | `"table_contents"` (no such key) | base `SAPRead` = `read` | `.toUpperCase()` → `TABLE_CONTENTS` | `data` op runs with `read` |

`normalizeObjectType` (`String(x).trim().toUpperCase()` + slash-collapse) is what makes both
land on the data-scoped type, so the array form was the audit's headline case and the
lowercase-string form is an equivalent vector of the same class. (The same case-mismatch also
weakened `SAP_DENY_ACTIONS` matching for `SAPRead` types.)

### Fix

Derive the scope key from the **same normalized object** the handler dispatches on, computed
once and reused for Zod validation (`src/handlers/intent.ts`, `handleToolCall`):

```ts
const normalizedArgs = normalizeTypeArgsForValidation(toolName, args);
const rawScopeKey = toolName === 'SAPRead' ? normalizedArgs.type : normalizedArgs.action;
let actionOrType: string | undefined =
  rawScopeKey === undefined || rawScopeKey === null || rawScopeKey === '' ? undefined : String(rawScopeKey);
```

This closes the array, case, and slash-form variants in one place. `action`-bearing tools are
unaffected for legitimate input (a non-string `action` is rejected by Zod regardless); the
`String()` coercion only ensures the gate fails *closed* (resolves to the correct, possibly
higher-scoped policy) instead of silently dropping to the base policy.

> Note: this is the audit's *primary* recommendation (normalize-first). The initial draft used
> a narrower array-only coercion that left the lowercase-string vector open; the normalize-first
> form supersedes it.

### Tests

`tests/unit/handlers/intent.test.ts` (`scope enforcement`):
- `type: ["TABLE_CONTENTS"]` + `read` scope → `Insufficient scope: 'data'`
- `type: "table_contents"` + `read` scope → `Insufficient scope: 'data'`
- `type: ["TABLE_CONTENTS"]` + `data` scope → not a scope rejection (legit path preserved)

---

## Finding 2 — Authorization-code interception via unbound state (Medium/High) — FIXED (DCR)

### Root cause

The issue-#214 callback proxy inserts ARC-1 into the OAuth return path: XSUAA redirects to
ARC-1's `/oauth/callback` (not the client), and ARC-1 re-emits the code to the client's
`redirect_uri` recovered from an HMAC-signed `state`. The signed state carried `redirect_uri`
but **not** the `client_id`, and — crucially — in the proxy flow XSUAA validates ARC-1's
callback URL, **not** the client's `redirect_uri`. So redirect-target validation now rests
entirely on ARC-1, and ARC-1 wasn't performing it. An attacker could obtain a validly-signed
state carrying their own `redirect_uri` and have a victim's code delivered to it.

### Fix

Bind the originating `client_id` into the signed state and verify the recovered `redirect_uri`
is registered for that client at callback time:

- `src/server/oauth-state.ts` — add `cid` to the signed payload (`encode` requires it, `decode`
  returns it, `parsePayload` rejects a payload missing it).
- `src/server/xsuaa.ts` — `authorize()` passes `_client.client_id` into `encode()`.
- `src/server/http.ts` — `createOAuthCallbackHandler(stateCodec, clientStore)` looks up
  `getClient(decoded.clientId)` and rejects (terminal 400, **no redirect**) when the client is
  unknown or `decoded.clientRedirectUri ∉ client.redirect_uris`. Runs before **both** the
  success and error branches and **fails closed** on lookup error.

For **DCR clients** (`arc1-…`) the registered `redirect_uris` are baked immutably into the
HMAC-signed `client_id` and re-derived deterministically by `getClient` (no shared state), so
the check rejects redirect-substitution on any instance. This covers the documented primary
clients (Claude Desktop, Cursor, VS Code, Copilot CLI).

### Residual — pre-registered XSUAA default client — CLOSED (follow-up)

> Originally shipped as a documented residual; **closed** in the follow-up change described
> below.

The shared XSUAA default client (`StatelessDcrClientStore.xsuaaClient`, used by "Manual" OAuth
configs) accepted dynamically-added redirect URIs via `ensureRedirectUri()` at `/authorize`
time. Because that in-memory list is the same object `getClient` returns, on a single instance
an attacker-supplied `redirect_uri` was auto-registered during `/authorize` and would satisfy
the callback `includes()` check — so the original fix did not fully close the vector for the
default client.

**Fix (follow-up):** ARC-1 now enforces the redirect-uri allowlist that XSUAA used to enforce
before the issue-#214 callback proxy removed XSUAA from the client-redirect path.

- `src/server/stateless-client-store.ts` — `XSUAA_REDIRECT_URI_PATTERNS` vendors the
  `xs-security.json` `oauth2-configuration.redirect-uris` patterns (xs-security.json is **not**
  shipped at runtime — excluded by `.cfignore` / npm `files` / Dockerfile — so the patterns are
  vendored and a unit test drift-guards them). `matchesXsuaaRedirectPattern()` does anchored,
  case-insensitive glob matching (`*` = within a segment, `**` = across segments). It first
  `new URL()`-parses the candidate and **rejects any userinfo** (`user[:pass]@`) — without that,
  the port-position `*` in `http://localhost:*/**` would let `http://localhost:x@evil.com/cb`
  match as a string while parsing to host `evil.com`, re-opening code interception (caught in the
  PR review; see "Hardening" below).
- `ensureRedirectUri()` now registers a dynamic redirect_uri for the shared client **only if it
  matches the allowlist** (otherwise dropped + `oauth_redirect_uri_rejected` audit event). A
  non-matching URI then fails the SDK's exact-match at `/authorize`, before any state is minted.
- `checkRedirectUri(clientId, uri)` centralizes the callback decision: the default client is
  validated against the **static allowlist** (stateless — correct on any instance, not the
  mutable in-memory list); DCR clients against their signed `redirect_uris`. `http.ts`'s
  `/oauth/callback` calls it (replacing the inline `getClient().includes()` from PR #352).

Legitimate Manual-mode clients (e.g. Copilot Studio via
`https://global.consent.azure-apim.net/redirect/**`) are preserved because their pattern is in
the allowlist; an attacker-controlled `redirect_uri` is not, so it is refused at both
`/authorize` and the callback.

#### Hardening — URL userinfo smuggling in the matcher (PR review)

A security review of the follow-up found that matching the glob against the **raw string** was
unsafe: the value is later `new URL()`-parsed and used as the 302 target, and the port-position
`*` in `http://localhost:*/**` (regex `^http://localhost:[^slash]*/…`) let `[^/]*` swallow a URL
userinfo segment. `http://localhost:x@evil.com/cb` matched the glob as a string, yet
`new URL(...).host === 'evil.com'` — so a victim's authorization `code` would be 302'd to the
attacker. (The host-label wildcards like `*.hana.ondemand.com` are *not* affected: the literal
domain must abut the authority-terminating `/`, so `@`-smuggling can't relocate their host. Only
the localhost pattern, where the `*` is in the port slot, was bypassable.)

**Fix:** `matchesXsuaaRedirectPattern()` now `new URL()`-parses the candidate, rejects anything
that doesn't parse, and rejects any URI carrying userinfo (`username`/`password`) before the glob
match. The `@` is the only construct that can move the authority past a same-segment wildcard, and
no legitimate OAuth `redirect_uri` carries credentials — so after the guard, a glob match implies
the parsed host equals the literal host in the pattern. Empirically verified (the old matcher
returned `true` for `http://localhost:x@evil.com/cb`; the new one returns `false`) with no change
for any legitimate client URI. Regression tests cover the userinfo variants at both the matcher
and `/oauth/callback` layers.

### Tests

`tests/unit/server/oauth-callback.test.ts` (new `client-binding validation` block, exercised
with a real `StatelessDcrClientStore`):
- registered `redirect_uri` → 302 with code forwarded
- unregistered `redirect_uri` on a valid `client_id` → 400, no `Location`, code not leaked
- unknown/forged `client_id` → 400
- error branch with unregistered `redirect_uri` → 400

`tests/unit/server/oauth-state.test.ts`: `cid` round-trips; existing signature/expiry/malformed
guards still hold.

> Operational note: state tokens are short-lived (10 min TTL) and single-flow, so requiring
> `cid` does not strand cached client registrations. A login in flight across the deploy simply
> retries.

---

## Finding 3 — Fail-closed package-rule intersection (Low/Info) — DEFERRED

`deriveUserSafetyFromProfile.covers()` only treats a server `ZFOO/**` subtree as statically
covering the literal root `ZFOO`. A profile that narrows to a child cannot be proven a
descendant without the live DEVCLASS hierarchy, so it is dropped and the key fails closed
(`[DENY_ALL_LIST_ENTRY]`). This is **intentional** (documented at `src/adt/safety.ts:410–424`)
and the runtime `checkPackage` resolver is the authority for surviving entries.

Deferred because: (a) it is a fail-*closed* usability paper-cut, not an over-grant — the only
finding here that would *loosen* a gate; (b) the realistic case (a real sibling package such as
`ZFOO_SUB`, not a literal `ZFOO/BAR` slash form) is not addressed by the proposed `startsWith`
tweak anyway; (c) loosening a package gate warrants a live-hierarchy test, out of scope for this
change. Track separately if the narrowing use case is needed.

---

## Verification

- `npm run typecheck` — clean
- `npm test` — 3396 passed (incl. new scope + OAuth-binding tests)
- `npm run lint` — clean
