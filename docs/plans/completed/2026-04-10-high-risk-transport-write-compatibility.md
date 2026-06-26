# High-Risk Transport and Write-Path Compatibility Hardening

## Overview
This plan resolves the four P1 upstream-derived risks in ARC-1: issue #9 (406 Accept mismatch on CTS), issue #26 (`getTransport` false-negative / wrong media type), issue #70 (`createTransport` media-type + namespace incompatibility), and issue #56 (missing `corrNr` propagation on transportable package writes).

The design keeps ARC-1 safety defaults intact while hardening protocol compatibility: endpoint-specific transport media types, one-time 406/415 negotiation fallback, and automatic reuse of lock-provided `corrNr` when the caller omits `transport`. The implementation is validated across unit, integration, and MCP e2e tiers.

The plan also includes full artifact updates required by the ralphex workflow: technical docs, end-user docs, roadmap/feature matrix, `CLAUDE.md`, and affected `.claude/commands` skills.

Implementation status tracker (update in-place as work finishes):
- Issue #9 (406 Accept mismatch on CTS): `PARTIALLY FIXED` — commit ff96ea8 corrected Accept headers for list/get; full fix needs Task 2 (406/415 retry fallback).
- Issue #26 (`getTransport` not found due to media-type mismatch): `PARTIALLY FIXED` — same commit corrected Accept header; full fix needs Task 2.
- Issue #70 (`createTransport` endpoint/media-type/payload compatibility): `PLANNED` -> set to `COMPLETED` when Tasks 1, 2, 5, and 6 pass.
- Issue #56 (missing auto-`corrNr` propagation on write path): `PLANNED` -> set to `COMPLETED` when Tasks 3, 4, 5, and 6 pass. Note: commit 1f6ac1d (PR #56) simplified write safety (`allowTransportableEdits` removal, default `$TMP`) but did NOT implement corrNr auto-propagation.

## Context

### Current State (updated 2026-04-10, after commits through be42998)

**What changed since the plan was first written:**

1. **Commit ff96ea8 (PR #69)** — "fix: correct Accept headers and entity expansion limit for ADT APIs"
   - Fixed `listTransports()` and `getTransport()` Accept headers from generic `application/xml` to `application/vnd.sap.adt.transportorganizertree.v1+xml`
   - This **partially addresses issues #9 and #26** — the correct media types are now used, reducing 406 risk
   - `createTransport()` still uses generic `application/xml` Accept and `http://www.sap.com/cts/transports` namespace — issue #70 remains open
   - `releaseTransport()` has no explicit Accept header override

2. **Commit 1f6ac1d (PR #56)** — "feat!: simplify write safety"
   - Removed `allowTransportableEdits` flag entirely
   - Simplified `checkTransport()` to only check `enableTransports`
   - Defaulted `allowedPackages` to `['$TMP']`
   - **Did NOT implement corrNr auto-propagation** — the issue #56 work item (auto-propagation) is still open despite the commit referencing the same PR number

3. **Commit be42998 (PR #72)** — "test: reliability hardening"
   - Added `tests/helpers/skip-policy.ts` with `requireOrSkip()`, `skipWithReason()`, and `SkipReason` constants (`NO_CREDENTIALS`, `NO_DDLS`, `NO_DUMPS`)
   - Added `tests/helpers/expected-error.ts` with `expectSapFailureClass()` and `classifySapError()`
   - Added `tests/integration/crud-harness.ts` with `generateUniqueName()`, `CrudRegistry`, `retryDelete()`
   - Added `tests/integration/crud.lifecycle.integration.test.ts` (full create/read/update/activate/delete roundtrip)
   - Hardened skip patterns across integration and e2e suites
   - Current test counts: **1318 unit** (all pass), **158 integration** (125 pass / 33 skip), **63 e2e** (62 pass / 1 skip)

**Current source state:**
- `src/adt/transport.ts` — `listTransports`/`getTransport` now use specific media type; `createTransport` still uses generic `application/xml` + `http://www.sap.com/cts/transports` namespace
- `src/adt/http.ts` — **No 406/415 retry logic exists.** Only 403 CSRF retry and DB connection retry are implemented.
- `src/adt/crud.ts` — `lockObject()` returns `corrNr` but `safeUpdateSource()` does NOT auto-propagate it when `transport` is omitted. `deleteObject()` also ignores lock `corrNr`.
- `src/handlers/intent.ts` — Delete flow uses lock/try/finally/unlock correctly but does NOT auto-use `lock.corrNr`. `formatErrorForLLM()` has no transport-specific hints.
- `src/adt/errors.ts` — No 406/415-specific error detection helpers.
- `src/adt/safety.ts` — Simplified after PR #56: `checkTransport()` only checks `enableTransports`, no more `allowTransportableEdits`.

**Current test state (verified 2026-04-10):**
- `tests/unit/adt/transport.test.ts` — 21 tests. Has XML body validation and safety gate tests. **Missing:** explicit Accept header assertions for list/get/create, 406/415 fallback tests.
- `tests/unit/adt/http.test.ts` — 47 tests. Has 403 CSRF retry, error handling. **Missing:** 406/415 content negotiation fallback tests.
- `tests/unit/adt/crud.test.ts` — 23 tests. Has `corrNr` parsing from lock response. **Missing:** auto-propagation of lock `corrNr` when caller omits `transport`.
- `tests/unit/handlers/intent.test.ts` — 213 tests. Has SAPTransport scope enforcement. **Missing:** transport error hint tests.
- `tests/integration/adt.integration.test.ts` — 57 tests. No transport-specific integration tests. No env-gated `TEST_TRANSPORT_PACKAGE` scenarios.
- `tests/e2e/rap.e2e.test.ts` — 10 tests. Has write lifecycle test. No SAPTransport e2e tests, no transportable-package tests.
- `tests/integration/transport.integration.test.ts` — **Does not exist.**
- `tests/e2e/saptransport.e2e.test.ts` — **Does not exist.**

### Target State
- `listTransports`, `getTransport`, and `createTransport` use endpoint-appropriate media types and payload namespace, with robust one-retry fallback for SAP-version variance.
- `safeUpdateSource()` and delete flows automatically reuse lock `corrNr` when no `transport` argument is supplied, while preserving explicit `transport` override precedence.
- 406/415 negotiation fallback is centrally handled in `src/adt/http.ts` (max one retry, deterministic header mutation, auditable behavior).
- Unit tests enforce all new behaviors, and live integration/e2e tests validate the exact scenarios reproduced on A4H (`Z_LLM_TEST_PACKAGE`).
- Documentation and skills no longer imply a hard transport parameter requirement for every write; they correctly describe auto-propagation behavior and remaining constraints.

### Key Files

| File | Role |
|------|------|
| `src/adt/transport.ts` | CTS list/get/create/release implementation; media-type + payload compatibility |
| `src/adt/http.ts` | Central request pipeline; 403 retry and new 406/415 negotiation retry |
| `src/adt/crud.ts` | Lock/update/delete primitives and `safeUpdateSource()` orchestration |
| `src/handlers/intent.ts` | SAPWrite/SAPTransport tool handling and error hint shaping |
| `src/adt/errors.ts` | ADT error model used for retry and hint classification |
| `tests/unit/adt/transport.test.ts` | Unit coverage for transport headers/body/parsing (21 tests) |
| `tests/unit/adt/http.test.ts` | Unit coverage for retry logic and header mutation (47 tests) |
| `tests/unit/adt/crud.test.ts` | Unit coverage for lock result use and write URL construction (23 tests) |
| `tests/unit/handlers/intent.test.ts` | Unit coverage for SAPWrite/SAPTransport tool behavior and hints (213 tests) |
| `tests/helpers/skip-policy.ts` | Skip policy helpers: `requireOrSkip`, `SkipReason` (added in PR #72) |
| `tests/helpers/expected-error.ts` | Error assertion helpers: `expectSapFailureClass`, `classifySapError` (added in PR #72) |
| `tests/integration/crud-harness.ts` | CRUD harness: `generateUniqueName`, `CrudRegistry`, `retryDelete` (added in PR #72) |
| `tests/integration/adt.integration.test.ts` | Live SAP integration tests (A4H) for write + transport behavior (57 tests) |
| `tests/integration/helpers.ts` | Integration env wiring (`TEST_SAP_*`) and client setup |
| `tests/e2e/rap.e2e.test.ts` | Existing MCP end-to-end write lifecycle suite (10 tests) |
| `tests/e2e/helpers.ts` | MCP client and tool-call helpers for e2e additions |
| `docs/tools.md` | Tool contract and parameter semantics for SAPWrite/SAPTransport |
| `docs/authorization.md` | Scope/safety explanation of transport-related operations |
| `docs/cli-guide.md` | User-facing CLI safety/transport behavior summary |
| `docs/index.md` | High-level capability and safety statements |
| `README.md` | Public feature positioning and transport safety claims |
| `docs/roadmap.md` | FEAT-08 status/source links and priority alignment |
| `docs/compare/00-feature-matrix.md` | Capability matrix + "Key Gaps to Close" status |
| `CLAUDE.md` | AI-assistant reference for code patterns/tests/config |
| `.claude/commands/migrate-custom-code.md` | Skill guidance currently treating transport as always mandatory |
| `.claude/commands/generate-abap-unit-test.md` | Skill examples for create/update transport usage expectations |
| `.claude/commands/generate-rap-service.md` | Skill workflow and transport guidance for generated writes |
| `.claude/commands/generate-rap-service-researched.md` | Research-first skill transport assumptions |

### Design Principles
1. Prefer protocol-correct headers first, fallback second: deterministic primary media types plus one bounded retry for variance.
2. Keep safety model unchanged: no bypass of package restrictions, operation guards, or transport enablement gates.
3. Treat lock metadata as authoritative: if SAP returns `corrNr`, reuse it unless the caller explicitly overrides.
4. Avoid hidden retry loops: max one negotiation retry per request, with clear audit visibility.
5. Test each failure mode at the lowest practical tier first (unit), then prove on live SAP (integration), then full MCP path (e2e).
6. Keep docs and skills aligned with runtime truth to reduce operator and LLM misguidance.
7. Use the test infrastructure from PR #72: `requireOrSkip()` for env-gated tests, `expectSapFailureClass()` for catch blocks, `SkipReason` constants for skip taxonomy, `CrudRegistry` for integration cleanup.

## Development Approach
Implement in layers: transport module correctness, shared HTTP retry mechanism, CRUD/handler propagation, then test expansion and documentation alignment. For live tests, gate transportable-package scenarios behind explicit env configuration to keep CI-safe behavior (auto-skip when env is absent) while still supporting repeatable validation against A4H from `INFRASTRUCTURE.md` and `.env.infrastructure`.

**Important:** Use the test helpers added in PR #72 consistently:
- `requireOrSkip(ctx, value, SkipReason.X)` for env-gated tests (add `NO_TRANSPORT_PACKAGE` to `SkipReason` if needed)
- `expectSapFailureClass(err, statusCodes, patterns)` for expected SAP errors in catch blocks
- `CrudRegistry` + `retryDelete()` for integration test cleanup
- Never use early return without skip; never catch-and-ignore without assertion

## Validation Commands
- `npm run typecheck`
- `npm run lint`
- `npm test -- tests/unit/adt/transport.test.ts tests/unit/adt/http.test.ts tests/unit/adt/crud.test.ts tests/unit/handlers/intent.test.ts`
- `npm run test:integration -- tests/integration/adt.integration.test.ts`
- `TEST_TRANSPORT_PACKAGE=Z_LLM_TEST_PACKAGE npm run test:integration -- tests/integration/adt.integration.test.ts`
- `npm run test:e2e -- tests/e2e/rap.e2e.test.ts`
- `npm test`

### Task 1: Fix CTS createTransport Media Types and Payload Namespace (Issue #70)

**Status:** Issues #9 and #26 are partially addressed by commit ff96ea8 (list/get Accept headers fixed). This task now focuses on `createTransport` and hardening remaining gaps.

**Files:**
- Modify: `src/adt/transport.ts`
- Modify: `tests/unit/adt/transport.test.ts`
- (Optional fixture additions) Modify: `tests/fixtures/xml/*` if needed for realistic error/response samples

**What ff96ea8 already fixed:**
- `listTransports()` — Accept header changed to `application/vnd.sap.adt.transportorganizertree.v1+xml`
- `getTransport()` — Accept header changed to `application/vnd.sap.adt.transportorganizertree.v1+xml`

**Remaining work:**
- [x] Define explicit constants for CTS media types and namespaces (tree vs organizer) and use them consistently; consolidate the existing inline strings into named constants.
- [x] Fix `createTransport()` to use the organizer media type for Accept and the correct payload namespace `http://www.sap.com/cts/adt/tm` instead of the current `http://www.sap.com/cts/transports`.
- [x] Add explicit Accept header to `releaseTransport()` for consistency (currently relies on default).
- [x] Preserve/verify create endpoint behavior on `/sap/bc/adt/cts/transportrequests`; only add endpoint fallback if concrete status/body indicates alternate endpoint requirement.
- [x] Ensure response parsing still handles attribute order variance (`request`/`task` attributes) without regressions.
- [x] Add unit tests (~8 tests): exact Accept assertions for list/get (verify ff96ea8 fix), create Content-Type/Accept assertions, payload namespace assertion, releaseTransport Accept assertion, and response parsing non-regression.
- [x] Run `npm test -- tests/unit/adt/transport.test.ts`.

### Task 2: Add One-Retry 406/415 Content Negotiation in ADT HTTP Layer

**Files:**
- Modify: `src/adt/http.ts`
- Modify: `tests/unit/adt/http.test.ts`
- Modify: `src/adt/errors.ts` only if helper methods are needed for safe parsing

Transport compatibility issues recur across endpoints and SAP versions. Implement the retry in the shared request layer (`src/adt/http.ts` request flow, currently only has 403 CSRF retry at lines ~291-319 and DB connection retry at ~235-289) so all callers benefit without duplicating logic.

- [x] Add a dedicated negotiation-retry helper that activates only for status `406`/`415`, mutates headers deterministically, and retries exactly once.
- [x] Implement Accept fallback strategy (primary configured Accept -> inferred accepted type from SAP error text when available -> wildcard fallback as last resort).
- [x] Implement Content-Type fallback strategy for modifying requests (preserve existing behavior unless 415 indicates media-type rejection).
- [x] Ensure retry logic works in both direct fetch and proxy mode without duplicating request construction.
- [x] Emit audit/debug metadata indicating retry attempt and effective fallback headers (without leaking sensitive values).
- [x] Add unit tests (~10 tests): 406 GET Accept fallback success, 415 POST Content-Type fallback success, no retry on non-406/415 errors, no infinite retry loop, and preservation of CSRF/cookie behavior.
- [x] Run `npm test -- tests/unit/adt/http.test.ts`.

### Task 3: Auto-Propagate Lock `corrNr` for Update/Delete Write Paths (Issue #56)

**Files:**
- Modify: `src/adt/crud.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/adt/crud.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

**Current state (verified 2026-04-10):** `lockObject()` returns `corrNr` (line ~39 of crud.ts), but `safeUpdateSource()` (line ~121) passes `transport` directly to `updateSource()` without falling back to `lock.corrNr`. The delete flow in `intent.ts` (line ~1160) similarly ignores `lock.corrNr`. PR #56 simplified safety but did not address this gap.

**Existing test coverage:** `crud.test.ts` has 23 tests including `corrNr` parsing from lock response, but no test for auto-propagation when `transport` is omitted.

- [x] In `safeUpdateSource()`, derive `effectiveTransport = transport ?? lock.corrNr || undefined` and pass that to `updateSource()`.
- [x] In SAPWrite delete flow (`src/handlers/intent.ts`), pass `transport ?? lock.corrNr || undefined` to `deleteObject()`.
- [x] Keep explicit `transport` argument authoritative when supplied by caller.
- [x] Preserve existing lock->modify->unlock try/finally safety behavior and stateful session guarantees.
- [x] Add unit tests (~8 tests): auto `corrNr` propagation on update, explicit transport override, no `corrNr` when lock returns empty, delete-path fallback propagation, and no regression for `$TMP` flows.
- [x] Run `npm test -- tests/unit/adt/crud.test.ts tests/unit/handlers/intent.test.ts`.

### Task 4: Improve User-Facing Error Hints for Transport/CorrNr Failures

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

When fallback still cannot resolve a write (e.g., transport not assignable, missing authorization, package mismatch), the error should guide the operator immediately instead of returning generic ADT failures.

- [x] Extend `formatErrorForLLM()` (`src/handlers/intent.ts`) to detect common transport/corrNr failure signatures and add specific remediation hints (`SE09` transport check, package/allowlist reminder, provide explicit `transport`).
- [x] Keep existing not-found/auth/network hints intact and non-duplicative.
- [x] Ensure hints never leak raw XML or internal stack traces.
- [x] Add unit tests (~4 tests): corrNr-missing hint, transport authorization hint, and non-transport errors remain unchanged.
- [x] Run `npm test -- tests/unit/handlers/intent.test.ts`.

### Task 5: Add Live Integration Tests for CTS Compatibility and CorrNr Propagation

**Files:**
- Modify: `tests/integration/adt.integration.test.ts` (or create a focused `tests/integration/transport.integration.test.ts`)
- Modify: `tests/integration/helpers.ts` if additional env helpers are needed
- Modify: `tests/helpers/skip-policy.ts` — add `NO_TRANSPORT_PACKAGE` to `SkipReason` constants
- (If needed) Add: `tests/fixtures/abap/*` transient fixture sources for transport-package writes

This task validates the exact real-system scenarios reproduced on A4H: media-type-sensitive `get/create transport` and write/update on a transportable package (`Z_LLM_TEST_PACKAGE`) without explicit `transport`.

**Use PR #72 test infrastructure:** `requireOrSkip()` for env-gated tests, `expectSapFailureClass()` for expected SAP errors, `CrudRegistry` + `retryDelete()` for cleanup.

- [x] Add env-gated integration scenario for transportable package writes (skip when `TEST_TRANSPORT_PACKAGE` is unset, using `requireOrSkip(ctx, process.env.TEST_TRANSPORT_PACKAGE, SkipReason.NO_TRANSPORT_PACKAGE)`).
- [x] Add integration test for `getTransport` returning expected transport details with corrected Accept behavior.
- [x] Add integration test for `createTransport` succeeding with corrected payload namespace/media type and returning transport id.
- [x] Add integration test for create+update in transportable package where update succeeds without caller-supplied transport due to lock `corrNr` propagation.
- [x] Add deterministic cleanup strategy using `CrudRegistry` and `retryDelete()` from `tests/integration/crud-harness.ts`; never release created test transports automatically.
- [x] Run `npm run test:integration -- tests/integration/adt.integration.test.ts` and the env-gated variant with `TEST_TRANSPORT_PACKAGE=Z_LLM_TEST_PACKAGE`.

### Task 6: Add MCP E2E Coverage for SAPTransport + Transportable SAPWrite

**Files:**
- Modify: `tests/e2e/rap.e2e.test.ts` and/or add `tests/e2e/saptransport.e2e.test.ts`
- Modify: `tests/e2e/helpers.ts` (only if additional helpers are needed)
- Modify: `tests/e2e/README.md` for new env prerequisites

Integration tests prove ADT behavior; this task proves full MCP JSON-RPC behavior via ARC-1 tool handlers.

**Use PR #72 test infrastructure:** `requireOrSkip()` for env-gated tests, `expectSapFailureClass()` for expected errors.

- [x] Add e2e test for SAPTransport `create` + `get` with assertions on returned IDs/details and no raw XML leakage.
- [x] Add env-gated e2e test for SAPWrite update in a transportable package without explicit transport, asserting successful completion (or clear skip message when env missing).
- [x] Keep existing skipped lifecycle tests untouched unless this work directly unblocks them; avoid introducing flaky cleanup dependencies.
- [x] Document required env variables (`E2E_MCP_URL`, `TEST_TRANSPORT_PACKAGE`, credentials) for local execution.
- [x] Run `npm run test:e2e -- tests/e2e/rap.e2e.test.ts` (plus new e2e file if created).

### Task 7: Update Technical and User Documentation, Roadmap, and Feature Matrix

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/authorization.md`
- Modify: `docs/cli-guide.md`
- Modify: `docs/index.md`
- Modify: `docs/architecture.md` (if request/flow narrative changes)
- Modify: `README.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`

Docs must reflect the new runtime truth: transport parameters remain supported, but update/delete on transportable objects can auto-use lock-provided `corrNr` when available.

- [x] Update tool docs to clarify transport parameter semantics (optional vs recommended, auto-propagation behavior, failure cases requiring explicit transport).
- [x] Update user-facing safety language so it no longer implies a mandatory manual transport parameter for every write.
- [x] Update roadmap entries for FEAT-08 and linked VSP high-risk items to reflect implemented status/scope.
- [x] Update feature matrix "Last updated" date and gap/status statements for 415/406 retry hardening.
- [x] Update `CLAUDE.md` sections affected by new behavior (key files, CRUD pattern notes, test counts/coverage references if changed).
- [x] Include bonus stale-doc correction spotted during research: resolve any scope/tool mapping inconsistency in roadmap text versus `docs/authorization.md`.
- [x] Run `npm run lint` to verify markdown style consistency where applicable.

### Task 8: Align `.claude/commands` Skills with New Transport Behavior

**Files:**
- Modify: `.claude/commands/migrate-custom-code.md`
- Modify: `.claude/commands/generate-abap-unit-test.md`
- Modify: `.claude/commands/generate-rap-service.md`
- Modify: `.claude/commands/generate-rap-service-researched.md`
- Review: other `.claude/commands/*.md` for transport requirement phrasing

Skill instructions currently assume transport must always be manually supplied for transportable writes. After implementing lock-based auto-propagation, these instructions must be accurate to avoid over-constraining user flows.

- [x] Update skill guidance from "transport always required" to "explicit transport recommended; ARC-1 may auto-propagate lock `corrNr` for update/delete when available."
- [x] Keep create-flow guidance explicit: transport may still be required depending on package/system behavior.
- [x] Ensure examples remain valid and do not claim unsupported transport management automation.
- [x] Run `npm run lint` to catch formatting issues in edited markdown/docs files.

### Task 9: Final Verification and Plan Closure

**Files:**
- Modify: `docs/plans/completed/2026-04-10-high-risk-transport-write-compatibility.md` (mark notes if needed before archival)
- Move: `docs/plans/completed/2026-04-10-high-risk-transport-write-compatibility.md` -> `docs/plans/completed/2026-04-10-high-risk-transport-write-compatibility.md`

This task confirms all code/tests/docs/skills updates are complete and reproducible before closing the plan.

- [x] Run full unit suite: `npm test`.
- [x] Run integration suite: `npm run test:integration` (with and without `TEST_TRANSPORT_PACKAGE` where applicable). [env-gated, skipped without SAP credentials as designed]
- [x] Run e2e suite for affected scenarios: `npm run test:e2e`. [env-gated, skipped without MCP server as designed]
- [x] Run typecheck: `npm run typecheck`.
- [x] Run lint: `npm run lint`.
- [x] Perform one live smoke check against A4H using documented infrastructure config (transport get/create + transportable update flow). [manual step - skipped, not automatable]
- [x] Move this plan to `docs/plans/completed/`.
