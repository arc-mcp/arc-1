# PR #267 hardening bundle

## Overview

A deeper audit of [PR #267](https://github.com/marianfoo/arc-1/pull/267) (`feat: stable DCR signing key + 0/negative TTL = infinite`) surfaced seven concrete issues — three bugs that affect correctness, one RFC 7591 spec-compliance gap, two configuration coexistence concerns, and one false statement in the docs. This plan rolls all of them into PR #267 directly, plus the operational documentation that was originally drafted as PR #268.

The bugs reduce to: empty / whitespace `ARC1_DCR_SIGNING_SECRET` either crashes server startup or silently produces a weak HMAC key; `dcrSigningSource` label can disagree with the secret actually in use; legacy-fallback warning promised in docs is not actually emitted by code. The spec gap: `registerClient` response omits `client_secret_expires_at`, so spec-aware MCP clients can't see "never expires" when an operator sets `ARC1_OAUTH_DCR_TTL_SECONDS=0`. The configuration concerns: orphan `ARC1_DCR_SIGNING_SECRET` (set without `SAP_XSUAA_AUTH=true`) is dead config that adds attack surface via env-var leaks; the operational `mta-overrides.mtaext.example` template has no DCR section and operators have no place to start.

Design intent: harden the existing PR #267 contract without changing defaults. Every new behavior is either a soft warning, a corrected log line, an additional response field, or a doc update — no breaking change, no API rename, no required new config. Users who already configured PR #267 correctly see one new field in their `/register` response (RFC-compliant) and no other behavior change.

## Context

### Current State

PR #267 wires `ARC1_DCR_SIGNING_SECRET` and `ARC1_OAUTH_DCR_TTL_SECONDS=0` through `src/server/config.ts:425-447` → `src/server/http.ts:258` → `src/server/xsuaa.ts:479-484` → `src/server/stateless-client-store.ts:155-171`. The constructor's only validation is `if (!signingSecret) throw` at line 161 — a JS truthy check that accepts whitespace-only strings, single characters, and any other near-useless input. The `??` operator at `xsuaa.ts:479` falls back to `credentials.clientsecret` only when `dcrSigningSecret` is `undefined`; an empty-string env var (`ARC1_DCR_SIGNING_SECRET=`) flows through as `""` and crashes startup at `stateless-client-store.ts:161`. The `dcrSigningSource` label at `xsuaa.ts:480` is derived from the raw input, not the effective key, so a whitespace-only env var produces label `'env'` with a near-useless underlying HMAC key.

`registerClient` at `stateless-client-store.ts:241-246` returns `{ ...client, client_id, client_secret, client_id_issued_at }`. RFC 7591 §3.2.1 makes `client_secret_expires_at` REQUIRED when `client_secret` is issued, with `0` meaning "will not expire" — the very semantic that `ARC1_OAUTH_DCR_TTL_SECONDS=0` introduces. The field is absent today. Verified via the MCP SDK schema (`node_modules/@modelcontextprotocol/sdk/dist/esm/shared/auth.d.ts` line 70 et seq): `client_secret_expires_at: z.ZodOptional<z.ZodNumber>` is on `OAuthClientInformationFullSchema`, so emitting it is type-safe.

`docs_page/xsuaa-setup.md:201` states "ARC-1 logs a startup warning when running on the legacy fallback." False — `src/server/xsuaa.ts:489-505` emits an INFO at line 489 unconditionally (with `dcrSigningSource` field) plus a dedicated-secret INFO at line 497, but no legacy-fallback warning. Either the doc is wrong or the code is missing the warn. The cleanest fix: correct the doc to match the existing INFO line (the `dcrSigningSource` field is already there for observability), don't add a new warning that would fire for every existing deployment intentionally running in legacy mode.

`validateConfig` at `src/server/config.ts:548-592` has fail-fast checks for OIDC issuer/audience symmetry, PP+cookie coexistence, BTP+cookie/PP coexistence, and a soft `console.error('[warn] …')` for SAML+BTP. There is no check for `dcrSigningSecret`, so setting `ARC1_DCR_SIGNING_SECRET=…` with `SAP_XSUAA_AUTH=false` silently no-ops — the secret is parsed into `config.dcrSigningSecret` and then never read (`http.ts:244` only constructs the OAuth provider when `xsuaaAuth && xsuaaCredentials`).

`mta-overrides.mtaext.example` documents 17 operational properties but has no entry for any DCR-related env var. The signing-secret-via-`cf set-env` recommendation lives only in the PR body and `docs_page/xsuaa-setup.md`.

`docs_page/enterprise-auth.md:440` ("SAP Auth Coexistence Rules") lists four startup-time validation rules. None reference DCR.

### Target State

After this plan:

1. **Robust `dcrSigningSecret` normalization** in `createXsuaaOAuthProvider`: an empty or whitespace-only value gracefully falls back to the XSUAA `clientsecret` (legacy behavior) with an explicit `logger.warn` naming the env var. Server startup never fails on a misconfigured signing secret. The `dcrSigningSource` label is derived from the EFFECTIVE secret (post-trim, post-fallback), so it accurately reflects what's actually in use.
2. **Soft warn on weak signing secret** in `StatelessDcrClientStore` constructor: when the trimmed secret is shorter than 16 bytes (128 bits — the NIST SP 800-131A floor for HMAC keys), emit a `logger.warn` recommending `openssl rand -base64 48`. Do NOT throw — Ory Hydra, Keycloak, and node-oidc-provider all accept any non-empty secret; ARC-1's default (XSUAA `clientsecret`, typically 40+ chars) is already strong.
3. **RFC 7591 §3.2.1 compliance**: `registerClient` response includes `client_secret_expires_at`. Value: `payload.iat + this.ttlSeconds` when TTL is positive, exactly `0` when TTL is disabled (matches the spec's "will not expire" semantic).
4. **`validateConfig` orphan warning** for `ARC1_DCR_SIGNING_SECRET` set without `SAP_XSUAA_AUTH=true` (the original PR #268 contribution).
5. **`mta-overrides.mtaext.example` OAuth DCR section** with commented `ARC1_OAUTH_DCR_TTL_SECONDS: "0"` example plus a `# NOTE:` block explicitly steering operators to `cf set-env` for the signing secret (the original PR #268 contribution).
6. **Doc corrections + cross-references**: `docs_page/xsuaa-setup.md` legacy-fallback statement corrected to reflect the actual INFO-level log; `docs_page/enterprise-auth.md` "SAP Auth Coexistence Rules" gains rule 5; both files cross-reference the new orphan warning.

### Key Files

| File | Role |
|------|------|
| `src/server/xsuaa.ts` | `createXsuaaOAuthProvider` at line 467: signing-secret normalization (Task 1) + startup-log fix (Task 6). |
| `src/server/stateless-client-store.ts` | Constructor at line 155 (Task 2 — weak-secret warn); `registerClient` at line 203 (Task 3 — `client_secret_expires_at`). |
| `src/server/config.ts` | `validateConfig` at line 548 (Task 4 — orphan warning). |
| `tests/unit/server/xsuaa.test.ts` | Existing `describe('createXsuaaOAuthProvider')` at line 220. New tests for `dcrSigningSecret` normalization + `dcrSigningSource` label correctness (Task 1). |
| `tests/unit/server/stateless-client-store.test.ts` | Existing weak-secret/TTL/audit tests. New tests for weak-secret warn (Task 2) and `client_secret_expires_at` (Task 3). |
| `tests/unit/server/config.test.ts` | Existing `describe('validateConfig')` at line 730 — pattern at line 834 (`vi.spyOn(console, 'error')`) is the canonical soft-warn test (Task 4). |
| `mta-overrides.mtaext.example` | Tracked operator template; new DCR section between "Networking" and "CORS" (Task 5). |
| `docs_page/xsuaa-setup.md` | "Stable DCR signing key" section — correct the legacy-fallback statement + add cross-references (Task 6). |
| `docs_page/enterprise-auth.md` | "SAP Auth Coexistence Rules" at line 440 — append rule 5 (Task 6). |
| `CLAUDE.md` | Quick Reference rows at lines 79-80 — minor wording reflecting that `≥32 bytes` is enforced as a soft warn, not a hard floor (Task 6). |
| `docs_page/configuration-reference.md` | Already documents the new env vars; no change required unless wording inconsistency emerges (Task 6 — verify). |

### Design Principles

1. **Warn, never throw, for misconfiguration.** Empty / whitespace / short signing secret all warn and continue; the constructor's existing `throw` for empty signingSecret stays as defense-in-depth at the lowest layer, but `createXsuaaOAuthProvider` (the only call site) is responsible for preventing the throw via normalization.
2. **`dcrSigningSource` label tracks the effective secret.** Computing the label from the raw input is a latent bug — fix at the same time as the normalization.
3. **Spec compliance for `client_secret_expires_at`.** RFC 7591 §3.2.1 explicitly defines `0` as "will not expire". MCP clients that look at this field can correctly skip re-registration; the field was missing only because PR #212 predated the TTL feature.
4. **No new startup noise on the legacy path.** Existing legacy-fallback deployments (signing key = XSUAA `clientsecret`) are intentionally supported. Don't introduce a warning that would fire for every existing deployment. The `dcrSigningSource` field in the existing INFO log at `xsuaa.ts:489` is already the observability hook; the doc just needs to match.
5. **16-byte threshold for "weak signing secret" warning.** NIST SP 800-131A floor is 112 bits (14 bytes) for HMAC keys; 128 bits (16 bytes) is the conservative round number. Keycloak documents 14 chars, Okta requires 32 chars for `client_secret_jwt`, Ory Hydra accepts 6 chars without a warning. 16 bytes / 128 bits sits in the middle of the production-software consensus and matches `SIG_BYTES = 16` already in the file.
6. **Soft-warn pattern consistency.** `validateConfig` warnings use `console.error('[warn] …')` (matches the existing `disableSaml2` precedent at `config.ts:587`). Constructor / wiring warnings use `logger.warn` (matches the existing `logger.debug`/`logger.info` usage elsewhere in `stateless-client-store.ts` and `xsuaa.ts`).
7. **Out of scope:** RFC 7592 registration-management endpoint, per-client revocation, rotating-key support, length-floor enforcement (hard error). These are separate larger features and don't belong in a hardening pass.

## Development Approach

Tasks 1–4 are code + tests, each addressing one concern at one layer (xsuaa.ts wiring → store constructor → store response → config validation). Tasks 5–6 are operational docs that depend on the new behavior being in place. Task 7 is final verification. Sequential dependencies are minimal — Task 3 doesn't depend on Tasks 1/2, but writing the tests in Task 3 may collide with the weak-secret warn from Task 2 in the test fixture, so run all the code tasks before the doc tasks.

All warnings use `logger.warn` from `src/server/logger.ts` (structured stderr, matches the rest of the file) except `validateConfig` which uses `console.error('[warn] …')` for consistency with the existing `disableSaml2` warning (config.ts:587) and the same `vi.spyOn(console, 'error')` test pattern.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Robust `dcrSigningSecret` normalization in `createXsuaaOAuthProvider`

**Files:**
- Modify: `src/server/xsuaa.ts`
- Modify: `tests/unit/server/xsuaa.test.ts`

PR #267 introduced `options.dcrSigningSecret` but uses `??` to fall back to `credentials.clientsecret` — `??` only falls back on `null`/`undefined`, not on empty string. The result: `ARC1_DCR_SIGNING_SECRET=""` (intentionally or accidentally empty env var) flows through as `""` and crashes startup at `stateless-client-store.ts:161` (`if (!signingSecret) throw`). Whitespace-only is even worse — it passes the truthy check and produces a near-useless HMAC key while logging `dcrSigningSource: 'env'`. Fix: trim the value, fall back to `credentials.clientsecret` if empty after trim, log a `logger.warn` naming the env var, and derive `dcrSigningSource` from the effective key (not the raw input).

- [x] In `src/server/xsuaa.ts`, locate `createXsuaaOAuthProvider` at line 467. Replace the two existing lines (`const dcrSigningSecret = options.dcrSigningSecret ?? credentials.clientsecret;` and `const dcrSigningSource: 'env' | 'xsuaa' = options.dcrSigningSecret ? 'env' : 'xsuaa';`) with a small block that:
  1. Trims `options.dcrSigningSecret` (if provided): `const trimmed = options.dcrSigningSecret?.trim();`
  2. If `options.dcrSigningSecret` was provided AND `trimmed` is empty: emit `logger.warn('ARC1_DCR_SIGNING_SECRET was set but is empty or whitespace-only — falling back to XSUAA clientsecret. Set a real secret with `openssl rand -base64 48` or unset the env var.');` and use `credentials.clientsecret` as the effective key.
  3. Otherwise, use `trimmed` (when provided) or `credentials.clientsecret` (when not) as the effective key.
  4. Derive `dcrSigningSource: 'env' | 'xsuaa'` from whether the effective key came from the env (true if `trimmed` was non-empty) or from `clientsecret` (true otherwise — including the empty-fallback case).
- [x] In `tests/unit/server/xsuaa.test.ts`, find `describe('createXsuaaOAuthProvider')` at line 220. Keep the existing `createXsuaaTokenVerifier returns a function` test (it tests a sibling function and remains useful). The block comment above it claims you "can't fully test the provider without a live XSUAA instance" — empirically false (verified in research: the function constructs successfully with stub credentials). Update or remove that block comment, and add unit tests (~5 tests):
  1. **default (no dcrSigningSecret)**: `createXsuaaOAuthProvider(stubCreds, 'https://x')` returns a `provider` and `clientStore`; spy on `logger.info` via `vi.spyOn(logger, 'info')`, assert the startup-log INFO line was called with `dcrSigningSource: 'xsuaa'`.
  2. **valid dcrSigningSecret**: `createXsuaaOAuthProvider(stubCreds, 'https://x', { dcrSigningSecret: 'a-real-32-byte-secret-string-OK!' })` — spy on `logger.info`, assert `dcrSigningSource: 'env'` AND the second INFO line ("DCR signing key uses dedicated ARC1_DCR_SIGNING_SECRET…") fired.
  3. **empty dcrSigningSecret**: `createXsuaaOAuthProvider(stubCreds, 'https://x', { dcrSigningSecret: '' })` — spy on `logger.warn` AND `logger.info`, assert the warn was called with a string containing `'ARC1_DCR_SIGNING_SECRET was set but is empty'` AND the INFO line shows `dcrSigningSource: 'xsuaa'` (effective fallback).
  4. **whitespace-only dcrSigningSecret**: `createXsuaaOAuthProvider(stubCreds, 'https://x', { dcrSigningSecret: '   ' })` — same expectations as #3.
  5. **dcrTtlSeconds: 0**: `createXsuaaOAuthProvider(stubCreds, 'https://x', { dcrTtlSeconds: 0 })` — spy on `logger.info`, assert the "DCR client_id TTL is disabled" INFO line fired.
- [x] Use stub credentials of the shape `{ clientid: 'sb-stub!t1', clientsecret: 'stub-xsuaa-secret', url: 'https://stub.authentication.eu10.hana.ondemand.com', xsappname: 'arc1', uaadomain: 'authentication.eu10.hana.ondemand.com', verificationkey: '-----BEGIN PUBLIC KEY-----\nstub\n-----END PUBLIC KEY-----' }`. Restore each `vi.spyOn` in a `finally` block.
- [x] Run `npm test -- tests/unit/server/xsuaa.test.ts` — all 27 tests must pass (22 existing + 5 new).

### Task 2: Soft warn on weak signing secret in `StatelessDcrClientStore`

**Files:**
- Modify: `src/server/stateless-client-store.ts`
- Modify: `tests/unit/server/stateless-client-store.test.ts`

The constructor at `stateless-client-store.ts:155-171` only checks `!signingSecret` (JS truthy). A 1-character secret passes. NIST SP 800-131A r2 sets 112 bits (14 bytes) as the HMAC floor; production OAuth servers vary (Keycloak 14 chars, Okta 32 chars for `client_secret_jwt`, Hydra 6 chars). 16 bytes / 128 bits is the conservative consensus and matches the existing `SIG_BYTES = 16` constant in this file. Soft-warn (not throw) — ARC-1's legacy default (XSUAA `clientsecret`) is already strong; the only realistic trigger is a test/dev secret.

- [x] In `src/server/stateless-client-store.ts`, locate the constructor at line 155. After the existing `if (!signingSecret) throw new Error(...)` check at line 161, add a soft-warn check: if `Buffer.byteLength(signingSecret, 'utf8') < 16`, call `logger.warn('StatelessDcrClientStore signing secret is shorter than 16 bytes (128 bits) — below the recommended minimum. Use `openssl rand -base64 48` for a secure value.', { bytes: Buffer.byteLength(signingSecret, 'utf8') });`. Do NOT throw. The key is still derived and the store still works; the warn surfaces the weakness for operators.
- [x] Use `Buffer.byteLength(s, 'utf8')` (not `s.length`) so multi-byte unicode is measured correctly.
- [x] In `tests/unit/server/stateless-client-store.test.ts`, add unit tests (~3 tests) in the existing `describe('StatelessDcrClientStore', …)` block (file already imports `vi` and `logger`):
  1. **warns when signingSecret is shorter than 16 bytes**: spy on `logger.warn` via `vi.spyOn(logger, 'warn')`, construct `new StatelessDcrClientStore(XSUAA_ID, XSUAA_SECRET, 'short')`, assert the warn was called with a string containing `'shorter than 16 bytes'`. Restore in `finally`.
  2. **does not warn when signingSecret is ≥ 16 bytes**: `'a'.repeat(16)` — spy on `logger.warn`, assert `logger.warn` was NOT called with the weak-secret substring.
  3. **measures byte length, not char length (multi-byte unicode)**: `'üüüü'` (4 chars × 2 bytes = 8 bytes utf-8) — assert warn fires. Then `'üüüüüüüü'` (8 chars × 2 bytes = 16 bytes) — assert no warn.
- [x] Run `npm test -- tests/unit/server/stateless-client-store.test.ts` — all tests pass (existing + new).

### Task 3: Emit `client_secret_expires_at` in `registerClient` response (RFC 7591 §3.2.1)

**Files:**
- Modify: `src/server/stateless-client-store.ts`
- Modify: `tests/unit/server/stateless-client-store.test.ts`

RFC 7591 §3.2.1 makes `client_secret_expires_at` REQUIRED when `client_secret` is issued: "Time at which the client secret will expire ... or 0 if it will not expire." MCP SDK's `OAuthClientInformationFullSchema` (verified at `node_modules/@modelcontextprotocol/sdk/dist/esm/shared/auth.d.ts` line 70) has `client_secret_expires_at: z.ZodOptional<z.ZodNumber>`. Emitting `0` when TTL is disabled tells spec-aware MCP clients exactly what `ARC1_OAUTH_DCR_TTL_SECONDS=0` means at the protocol level.

- [x] In `src/server/stateless-client-store.ts`, locate `registerClient` at line 203. In the return statement at lines 241-246, add `client_secret_expires_at` after `client_id_issued_at`:
  - If `this.ttlSeconds > 0`: `client_secret_expires_at: issuedAt + this.ttlSeconds`
  - If `this.ttlSeconds <= 0` (TTL disabled): `client_secret_expires_at: 0`
- [x] Use a single ternary: `client_secret_expires_at: this.ttlSeconds > 0 ? issuedAt + this.ttlSeconds : 0`.
- [x] In `tests/unit/server/stateless-client-store.test.ts`, add unit tests (~3 tests) in the existing `describe('StatelessDcrClientStore default TTL', …)` block (which already covers TTL behavior):
  1. **emits client_secret_expires_at = iat + ttlSeconds (positive TTL)**: `makeStore({ now: () => 1_700_000_000_000, ttlSeconds: 3600 })`, register a client, assert `registered.client_secret_expires_at === 1_700_000_000 + 3600` (note: `now` is in ms, `iat` is in seconds — `iat = Math.floor(nowMs / 1000)`).
  2. **emits client_secret_expires_at = 0 (TTL=0)**: `makeStore({ ttlSeconds: 0 })`, register a client, assert `registered.client_secret_expires_at === 0`.
  3. **emits client_secret_expires_at = 0 (negative TTL)**: `makeStore({ ttlSeconds: -1 })`, register a client, assert `registered.client_secret_expires_at === 0`.
- [x] Also verify the existing `it('round-trips a registered client through register → getClient', …)` test at the top of the describe block still passes — it doesn't currently assert on `client_secret_expires_at`, so it should be unaffected.
- [x] Run `npm test -- tests/unit/server/stateless-client-store.test.ts` — all tests pass.

### Task 4: `validateConfig` orphan warning for `ARC1_DCR_SIGNING_SECRET` without `xsuaaAuth`

**Files:**
- Modify: `src/server/config.ts`
- Modify: `tests/unit/server/config.test.ts`

The signing secret is only consumed when `config.xsuaaAuth && xsuaaCredentials` at `src/server/http.ts:244`. Without XSUAA, the secret is silently ignored — dead config that adds attack surface via env-var leaks (`printenv`, `docker inspect`, crash dumps). Surface the misconfiguration with a soft warn matching the existing `disableSaml2` pattern at `config.ts:587`.

- [x] In `src/server/config.ts`, locate `validateConfig` at line 548. After the existing `disableSaml2` check at lines 587-591, add a new check: if `config.dcrSigningSecret` is truthy AND `config.xsuaaAuth === false`, call `console.error('[warn] ARC1_DCR_SIGNING_SECRET is set but SAP_XSUAA_AUTH=false — the secret is unused. Unset it to reduce attack surface, or enable XSUAA OAuth proxy mode (SAP_XSUAA_AUTH=true).');`. Do not throw.
- [x] In `tests/unit/server/config.test.ts`, add unit tests (~3 tests) inside the existing `describe('validateConfig')` block (starts at line 730), adjacent to the `disableSaml2` warning test at line 834:
  1. **warns when dcrSigningSecret is set with xsuaaAuth=false**: `vi.spyOn(console, 'error').mockImplementation(() => undefined)`, call `validateConfig({ ...DEFAULT_CONFIG, dcrSigningSecret: 'some-stable-secret', xsuaaAuth: false })`, assert no throw AND the spy was called with `expect.stringContaining('ARC1_DCR_SIGNING_SECRET is set but SAP_XSUAA_AUTH=false')`. Restore in `finally`.
  2. **does not warn about dcrSigningSecret when xsuaaAuth=true**: same spy, call `validateConfig({ ...DEFAULT_CONFIG, dcrSigningSecret: 'some-stable-secret', xsuaaAuth: true })`, assert `expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining('ARC1_DCR_SIGNING_SECRET'))`.
  3. **does not warn when dcrSigningSecret is unset**: same spy, call `validateConfig({ ...DEFAULT_CONFIG, xsuaaAuth: false })`, assert no `ARC1_DCR_SIGNING_SECRET` substring in any `console.error` call.
- [x] Run `npm test -- tests/unit/server/config.test.ts` — all tests pass (existing + 3 new).

### Task 5: Document OAuth DCR config in `mta-overrides.mtaext.example`

**Files:**
- Modify: `mta-overrides.mtaext.example`

The template documents 17 operational properties but says nothing about DCR. Operators reading the template have no signal that `ARC1_OAUTH_DCR_TTL_SECONDS` and `ARC1_DCR_SIGNING_SECRET` exist or how to configure them. The signing secret must NOT appear as a templated property — MTA properties are rewritten on every `cf deploy`, which would rotate the signing secret each deploy and invalidate every cached `client_id`, defeating the whole purpose of having a dedicated signing secret.

- [x] Insert a new section after the existing "Networking / public URL" section (between the `ARC1_PUBLIC_URL` block and the `ARC1_ALLOWED_ORIGINS` "CORS" block). The new section header is `# ── OAuth Dynamic Client Registration (DCR) ──────────────────────`.
- [x] Under that header, add a commented `ARC1_OAUTH_DCR_TTL_SECONDS: "0"` example with this rationale comment immediately above it (each line prefixed with `# `):
  - "Lifetime of an OAuth DCR `client_id` in seconds. Default: 30 days (matches typical OAuth refresh-token lifetimes). Positive values clamped to `[60s, 90d]`."
  - "Set to `\"0\"` to disable expiration entirely — recommended when your MCP clients (Copilot CLI, Cursor) don't auto-re-register on `invalid_client` and a finite TTL would just produce periodic outages."
- [x] Immediately below the `ARC1_OAUTH_DCR_TTL_SECONDS` block, add a `# NOTE:` comment block (no actual property line — only comments) explaining that `ARC1_DCR_SIGNING_SECRET` is intentionally NOT listed here. The note must cover:
  - The recommended setup command: `cf set-env arc1-mcp-server ARC1_DCR_SIGNING_SECRET "$(openssl rand -base64 48)"` followed by `cf restage arc1-mcp-server`.
  - Why `cf set-env` (not MTA properties): env vars set via `cf set-env` survive `cf deploy`; properties under `modules[*].properties` in MTA are rewritten on every deploy, which would rotate the signing secret and invalidate every cached `client_id` — defeating the whole purpose of having one.
  - A pointer to `docs_page/xsuaa-setup.md` for the full rationale.
- [x] Verify YAML parses cleanly: `python3 -c "import yaml; yaml.safe_load(open('mta-overrides.mtaext.example'))" && echo OK`.
- [x] Run `npm test` (sanity — no test reads this file, but verify nothing else broke).

### Task 6: Doc corrections + cross-references

**Files:**
- Modify: `docs_page/xsuaa-setup.md`
- Modify: `docs_page/enterprise-auth.md`
- Modify: `CLAUDE.md`

Three doc updates: (1) correct the false legacy-fallback warning statement at `xsuaa-setup.md:201`; (2) add coexistence rule 5 in `enterprise-auth.md`; (3) clarify in `CLAUDE.md` that `≥32 bytes` is enforced as a soft warn (not a hard floor). Plus a small cross-reference in `xsuaa-setup.md` to the new orphan warning.

- [x] In `docs_page/xsuaa-setup.md`, find the "Stable DCR signing key (recommended)" section. Locate the line "ARC-1 logs a startup warning when running on the legacy fallback." (currently false — verified: code emits an INFO line with `dcrSigningSource` field, not a warning). Replace with: "ARC-1 logs the active signing source as `dcrSigningSource: 'env' | 'xsuaa'` in the startup INFO line for observability."
- [x] In `docs_page/xsuaa-setup.md`, immediately after the `cf restage arc1-mcp-server` code block, add a one-line note: `ARC-1 emits a `[warn]` to stderr if `ARC1_DCR_SIGNING_SECRET` is set without `SAP_XSUAA_AUTH=true` — the secret is only consumed by the XSUAA OAuth proxy path, so this surfaces a misconfiguration where the secret would otherwise be unused.`
- [x] In `docs_page/enterprise-auth.md`, find the numbered list under `### SAP Auth Coexistence Rules` (~line 440, currently has 4 items ending with the `SAP_DISABLE_SAML=true` rule). Append a new item 5: `5. \`ARC1_DCR_SIGNING_SECRET\` set without \`SAP_XSUAA_AUTH=true\` emits a warning (startup continues, secret is unused — only consumed by the XSUAA OAuth proxy path).`
- [x] In `CLAUDE.md`, locate the `ARC1_DCR_SIGNING_SECRET` row in the configuration table at ~line 80. Change the wording `Recommended length: ≥32 bytes of entropy (e.g. \`openssl rand -base64 48\`)` to `Recommended length: ≥32 bytes of entropy (e.g. \`openssl rand -base64 48\`); ARC-1 emits a soft warn at startup if the trimmed value is shorter than 16 bytes (128 bits — the conservative HMAC floor).` Keep the rest of the row unchanged.
- [x] Run `npm run lint` — Biome formats `.md` files via formatter; should be a no-op.

### Task 7: Final verification

**Files:**
- Review: all modified files
- Review: `git diff` against PR #267 base

This task is the standard ralphex final-verification step plus an end-to-end manual check that all four code-level behaviors fire under the right conditions.

- [x] Run full test suite: `npm test` — all tests pass. Expect ~2843 tests (PR #267 baseline 2829 + ~14 new: 5 in xsuaa.test.ts, ~6 in stateless-client-store.test.ts, 3 in config.test.ts).
- [x] Run typecheck: `npm run typecheck` — no errors.
- [x] Run lint: `npm run lint` — no errors.
- [x] Manual end-to-end check via `dist/` after `npm run build`. Verify each of the four new behaviors fires correctly with a small node script:
  - **Empty `dcrSigningSecret`**: `createXsuaaOAuthProvider(stubCreds, 'https://x', { dcrSigningSecret: '' })` → expect a `[warn]` line containing `ARC1_DCR_SIGNING_SECRET was set but is empty`. The startup INFO line shows `dcrSigningSource: 'xsuaa'`.
  - **Weak secret**: `new StatelessDcrClientStore('id', 'sec', 'short')` → expect a `[warn]` line containing `shorter than 16 bytes`.
  - **`client_secret_expires_at` in /register response**: register a client with `ttlSeconds: 0`, assert response has `client_secret_expires_at: 0`. Register another with `ttlSeconds: 3600`, assert response has `client_secret_expires_at === iat + 3600`.
  - **Orphan warning**: `validateConfig({ ...DEFAULT_CONFIG, dcrSigningSecret: 'x', xsuaaAuth: false })` → expect a `[warn]` line containing `ARC1_DCR_SIGNING_SECRET is set but SAP_XSUAA_AUTH=false`.
- [x] Verify the diff for accidental scope creep: should touch only `src/server/{xsuaa,stateless-client-store,config}.ts`, `tests/unit/server/{xsuaa,stateless-client-store,config}.test.ts`, `mta-overrides.mtaext.example`, `docs_page/{xsuaa-setup,enterprise-auth}.md`, and `CLAUDE.md`.
- [x] Move this plan to `docs/plans/completed/`.
