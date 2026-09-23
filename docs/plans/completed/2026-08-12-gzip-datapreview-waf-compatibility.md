# Add opt-in gzip compatibility for WAF-blocked data-preview requests

> **As implemented:** the adversarial review corrected the plan to preserve the shared boolean
> resolver's existing compatibility semantics, added the missing `AdtHttpConfig` task scope, and
> expanded the wire-body inventory from the obvious CSRF retry to all seven internal resend paths.
> The implementation and final verification match that revised scope without further deviation.

## Overview

Some upstream HTTP security layers reject the legitimate SQL-shaped `text/plain` POST body used by
SAP ADT data preview before the request reaches SAP. The complete fingerprint and live evidence are
in
[docs/research/issues/no-issue-2026-08-12-datapreview-waf-gzip.md](../../research/issues/no-issue-2026-08-12-datapreview-waf-gzip.md) —
cite it rather than re-deriving the appliance-level diagnosis.

Add a default-off administrator option that gzip-encodes only non-empty POST bodies for the two exact
ADT data-preview collection endpoints. Also replace ARC-1's misleading authorization-only response
for the narrow bare-403 fingerprint with a cautious, security-aware troubleshooting hint. Do not
automatically retry a rejected request with gzip, and do not change any data/SQL safety gate.

Success criteria (plain bullets, verified in the final task):

- Default configuration emits the same plain string bodies and headers as current HEAD.
- `SAP_GZIP_DATAPREVIEW_BODY=true` and `--gzip-datapreview-body=true` reach every single- and
  multi-target ADT client configuration.
- With the option enabled, exact non-empty POSTs to `/datapreview/freestyle` and
  `/datapreview/ddic` carry a valid gzip byte body plus `Content-Encoding: gzip`; unrelated routes,
  methods, and empty bodies remain unchanged.
- Direct undici fetch, BTP proxy transport, and the existing CSRF retry preserve the exact binary
  payload and header.
- A generic/bare data-preview 403 says “possible upstream WAF/body inspection” in detailed and
  minimal error modes; SAP XML authorization errors and non-data-preview 403s keep their existing
  guidance.
- Documentation states that a scoped gateway rule exclusion is preferred and that gzip can make
  these bodies opaque to naive WAF inspection.
- Current HEAD failure is reproduced with the option off and resolves through the controlled proxy
  with the option on; SAP_BASIS 758 accepts the feature end to end.

## Context

### Current state

- `src/adt/client.ts` sends the optional DDIC filter and all freestyle SQL using
  `Content-Type: text/plain`.
- `src/adt/http.ts` types request bodies as strings from `requestInner()` through direct fetch and
  Destination Service proxy calls. It has no request `Content-Encoding` handling.
- POST requests already retry once after a 403 as part of CSRF token refresh. A separate automatic
  gzip retry would compound an ambiguous retry and conceal a security-policy rejection.
- `src/handlers/dispatch.ts` currently maps a generic 403 to SAP client/credentials/permissions.
  Minimal-error mode is the HTTP default, so the new narrow hint must be safe in both modes.
- `src/server/multi-target-runtime.ts` deliberately copies a small subset of base configuration into
  a mutation-free runtime; compatibility options do not flow there automatically.

### Target state

The administrator explicitly enables `gzipDataPreviewBody`. `AdtHttpClient.requestInner()` keeps
the logical body string for logging, creates a separate wire body only when method/path/body match,
and forwards that `Buffer` through every transport and retry. No caller API changes and no
compression occurs by default.

When a matching endpoint returns a bare generic 403, dispatch emits a possibility—not a
classification—and points the operator first to gateway logs and a narrow rule exclusion. The hint
mentions the gzip option as a security-approved compatibility fallback.

### Key files

| File | Role |
|---|---|
| `src/server/types.ts` | Public server config field and safe default |
| `src/server/config.ts` | CLI/env/default resolution |
| `src/adt/config.ts` | ADT client config contract/default |
| `src/server/server.ts` | Server-to-client config mapping |
| `src/server/multi-target-runtime.ts` | Explicit read-only runtime copy |
| `src/adt/client.ts` | Client-to-HTTP config mapping |
| `src/adt/http.ts` | Exact-path gzip and binary transport |
| `src/handlers/dispatch.ts` | Narrow bare-403 guidance |
| `tests/unit/adt/http.test.ts` | Wire behavior, retry, proxy regression coverage |
| `tests/unit/handlers/dispatch-misc.test.ts` | Detailed/minimal error behavior |
| `docs_page/configuration-reference.md` | Operator contract and warning |
| `docs_page/authorization.md` | 403 troubleshooting decision path |

### Verified evidence

2026-08-12 live probes show SAP_BASIS 758 and 816 both accept the same freestyle SQL as plain text
and as a gzip-coded representation. Current ARC-1 succeeds directly on A4H. Through a controlled
proxy that returns a bare 403 when raw body bytes contain `SELECT` or `WHERE`, current ARC-1 shows
the mail report's exact asymmetry and generic authorization hint; a raw gzip request reaches SAP and
succeeds. See the dossier for the complete matrix and release limitation.

### Design principles

1. **Explicit compatibility, not automatic evasion.** Default false; enabling the option is an
   administrator/security decision. Never infer it from a 403.
2. **Exact sink scope.** Match only POST plus exact collection path
   `/sap/bc/adt/datapreview/(freestyle|ddic)` followed by `?` or end-of-string, with a non-empty
   string body. Do not compress metadata, discovery, source, or arbitrary text requests.
3. **One representation per logical request.** Compute the binary wire body once before CSRF
   handling and reuse it through token refresh and resend. Keep logs based on the logical string.
4. **Binary end to end.** Widen only private transport body types to `string | Buffer`; never call
   `.toString()` in the BTP proxy path.
5. **Possible-WAF guidance only.** Require exact data-preview path, 403 status, and a generic/bare
   response. Preserve existing SAP XML authorization classification and all other errors.
6. **Safety model unchanged.** Compression does not enable data preview, free SQL, write access, or
   a broader package/scope. Existing gates execute before the HTTP call.

## Development approach

TDD inside each implementation task: add the target assertions first and observe the focused test
fail, then implement the smallest production change and make the focused suite green. After each
task, run the affected unit test plus typecheck where the public config type changes. Do not hand
edit generated `dist/` output or frozen MCP tool-definition fixtures.

## Validation commands

- `npx vitest run tests/unit/server/config.test.ts tests/unit/server/server.test.ts tests/unit/server/multi-target-runtime.test.ts`
- `npx vitest run tests/unit/adt/http.test.ts`
- `npx vitest run tests/unit/handlers/dispatch-misc.test.ts`
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

### Task 1: Thread a default-off administrator option through every runtime

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/config.ts`
- Modify: `src/adt/config.ts`
- Modify: `src/adt/http.ts` (`AdtHttpConfig` type only in this task)
- Modify: `src/server/server.ts`
- Modify: `src/server/multi-target-runtime.ts`
- Modify: `src/adt/client.ts`
- Modify: `tests/unit/server/config.test.ts`
- Modify: `tests/unit/server/server.test.ts`
- Modify: `tests/unit/server/multi-target-runtime.test.ts`

The option is a server-controlled network compatibility setting, not a per-user permission. It must
be false unless explicitly selected and must remain effective for immutable destinations in the
experimental read-only multi-target runtime.

- [x] Add `gzipDataPreviewBody: boolean` to `ServerConfig` and `AdtClientConfig`, with `false` in
      their defaults. Add the transport-facing field as optional to `AdtHttpConfig` so direct test
      and library construction stays source-compatible; absent still means false.
- [x] Resolve `gzipDataPreviewBody` in `resolveConfig()` from CLI key
      `gzip-datapreview-body`, env `SAP_GZIP_DATAPREVIEW_BODY`, then default, using the existing
      boolean resolver so CLI > env > `.env` > default and invalid-value behavior stay consistent.
- [x] Map the field in `buildAdtConfig()` and the `AdtClient` constructor's HTTP configuration.
- [x] Explicitly copy `baseConfig.gzipDataPreviewBody` in `buildReadOnlyRuntimeConfig()`; do not
      copy any write/data scope as a side effect.
- [x] In `tests/unit/server/config.test.ts`, pin default false, env true, CLI-over-env false, and
      source tracking using the neighboring option's test style. Keep the shared resolver's current
      compatibility semantics for non-`true`/`1` values; do not introduce one-off validation.
- [x] In `tests/unit/server/server.test.ts`, prove `buildAdtConfig()` forwards true and false.
- [x] In `tests/unit/server/multi-target-runtime.test.ts`, start with true in the base config and
      assert it survives while mutation/data-scope safety values remain forced off.
- [x] Run the three focused server test files and `npm run typecheck` — all green.

### Task 2: Gzip only exact non-empty data-preview POST bodies

**Files:**
- Modify: `src/adt/http.ts`
- Modify: `tests/unit/adt/http.test.ts`

Perform compression at the one outbound transport layer so `SAPQuery`, structured `TABLE_QUERY`,
filtered `TABLE_CONTENTS`, and any internal consumers share the same exact policy. Keep the public
`post()` API string-based; the binary type exists only below request assembly.

- [x] Add focused tests first and observe failure: default configuration sends the original string
      and no `Content-Encoding`; enabled freestyle POST sends a `Buffer`, header `gzip`, and
      `gunzipSync(body).toString('utf8')` equals the original multibyte SQL string.
- [x] Add the same enabled assertion for `/datapreview/ddic?…` with a non-empty filter body.
- [x] Add negative-scope assertions: empty/undefined DDIC body, unrelated POST, data-preview GET,
      `/freestyle/metadata`, and a look-alike prefix/suffix are not compressed.
- [x] Import `gzipSync` from `node:zlib`. Add a small predicate that removes query/fragment and
      compares the remaining path to a two-item exact set. Inside `requestInner()`, derive
      `wireBody: string | Buffer | undefined` from the original body only when
      config/method/path/body match.
- [x] Set one canonical `Content-Encoding: gzip` after extra-header/content-type assembly when the
      body was actually compressed. Remove any differently-cased caller key first so undici cannot
      receive duplicate/conflicting content-coding fields; do not emit the header for a plain body.
- [x] Keep request debug logging/redaction based on the original logical string. Do not log the
      Buffer and do not mutate the caller's headers object outside the existing per-request copy.
- [x] Widen private `doFetch()` and `doProxyRequest()` body types to accept `string | Buffer`; pass
      the binary value to undici/Destination proxy unchanged. Replace **every** `doFetch(..., body)`
      inside `requestInner()` with `wireBody` (initial call plus DB, 503, 429, 401, 403/CSRF, and
      406/415 retry paths), then close the inventory with an in-function grep.
- [x] Pin the existing 403/CSRF flow: with gzip enabled, both attempts receive gzip bytes that
      decompress to the original SQL and both carry the header. There must be no third retry and no
      auto-enable behavior when the option is false.
- [x] Pin BTP proxy mode: its request callback receives a Buffer with byte-for-byte equality to the
      direct-mode gzip body and retains `Content-Encoding: gzip`.
- [x] Run `npx vitest run tests/unit/adt/http.test.ts` and `npm run typecheck` — all green.

### Task 3: Surface cautious WAF guidance for the narrow bare-403 fingerprint

**Files:**
- Modify: `src/handlers/dispatch.ts`
- Modify: `tests/unit/handlers/dispatch-misc.test.ts`

The error is not strong enough to become a definitive domain classification. Add a pure local
predicate/formatter in dispatch and check it before the generic 403 authorization branch, including
before minimal formatting discards useful context.

- [x] Add detailed-mode and `minimalErrors: true` tests for `AdtApiError('Forbidden', 403,
      '/sap/bc/adt/datapreview/freestyle', 'Forbidden')`. Both results must say `possible`, mention
      upstream WAF/body inspection and gateway logs, prefer a scoped rule exclusion, and name
      `SAP_GZIP_DATAPREVIEW_BODY` only as an approved fallback.
- [x] Cover `/datapreview/ddic?…` with the same narrow hint because filtered `TABLE_CONTENTS` can
      carry SQL-like filter text.
- [x] Add false-positive guards: a structured SAP XML 403 on the same path retains existing
      authorization/SU53 guidance; bare 403 on a non-data-preview path stays generic authorization;
      401/404/500 and data-preview look-alike paths do not receive the WAF hint.
- [x] Implement exact-path and generic-body predicates without parsing arbitrary HTML. Accept only
      an empty/whitespace body or simple gateway text such as `Forbidden` / `403 Forbidden`; do not
      call every HTML proxy page or SAP XML fault a WAF.
- [x] Ensure the message contains no response body, SQL, host, SAP user, or other value that
      `minimalErrors` is intended to hide.
- [x] Run `npx vitest run tests/unit/handlers/dispatch-misc.test.ts` — all green.

### Task 4: Document the compatibility option and its security boundary

**Files:**
- Modify: `.env.example`
- Modify: `AGENTS.md`
- Modify: `docs_page/configuration-reference.md`
- Modify: `docs_page/authorization.md`
- Modify: `docs/research/issues/no-issue-2026-08-12-datapreview-waf-gzip.md`

Operator documentation must prevent the flag from becoming the first response to any 403. The
preferred remediation is evidence from gateway logs plus an approved rule exclusion at the exact
route/rule/variable; gzip is the fallback when that infrastructure cannot be changed.

- [x] Add a commented `SAP_GZIP_DATAPREVIEW_BODY=false` example beside connection/data-preview
      settings with a short warning that it can make the body opaque to naive WAF inspection.
- [x] Add the env/CLI/default row to `docs_page/configuration-reference.md`; describe the exact POST
      scope, no automatic retry, no safety-gate relaxation, SAP ICM compatibility, and security
      approval expectation.
- [x] Add a troubleshooting row/section to `docs_page/authorization.md` for the asymmetric
      `TABLE_CONTENTS` success plus SQL-bearing 403 fingerprint. Require gateway audit/rule evidence
      before attribution and list scoped exclusion before gzip.
- [x] Add the concise config row to `AGENTS.md` so future work preserves the default-off and exact
      data-preview scope.
- [x] Update the dossier status to “Implemented,” link this plan, and add final test/live evidence;
      retain the uncertainty about the sender's exact WAF rule.
- [x] Verify no README capability table, roadmap, security model invariant, MCP schema, or
      tool-definition fixture needs updating: this is a transport compatibility option, not a new
      tool capability or authorization scope.

### Task 5: Adversarial review and final verification

- [x] Review the complete diff for hidden auto-retry, overbroad regexes, implicit enablement,
      string conversion in proxy mode, compressed-byte logging, and any relaxation of
      `allowDataPreview` / `allowFreeSql`. Fix every finding before continuing.
- [x] Run the three focused command groups, then `npm test`, `npm run typecheck`, `npm run lint`, and
      `npm run build` — all green.
- [x] Run `git diff --check`; ensure `dist/`, credentials, gateway proxy code, generated fixtures,
      and unrelated worktree files are absent from the diff.
- [x] Controlled-proxy regression: option off reproduces bare 403 for `SAPQuery` and
      `TABLE_QUERY`; option on makes both succeed while unfiltered `TABLE_CONTENTS` remains
      unchanged. Record only sanitized status/result shapes in the dossier.
- [x] Direct live regression on A4H SAP_BASIS 758: option off and on both return the expected T000
      row for `SAPQuery`; if A4H-2025 is reachable, repeat the option-on call on 816. Treat NPL 7.50
      as N/A when the data-preview service is unbound; do not invent a gzip-support claim.
- [x] Move this plan to `docs/plans/completed/` and repair its dossier link (`../research` becomes
      `../../research`).
- [x] Recommend a focused patch PR only if all unit/full/live checks pass. Suggested title:
      `fix: add opt-in gzip for WAF-blocked data-preview requests`. Do not create, commit, push, or
      post the mail reply without separate user authorization.
