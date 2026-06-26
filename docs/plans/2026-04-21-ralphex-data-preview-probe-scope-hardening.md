# Ralphex Plan: Data Preview, SQL Console Variability, and SAPManage Scope Repair

## Overview

This plan addresses four user-facing reliability problems as one coherent change set: `TABLE_CONTENTS` filter errors are hard to understand, connectivity failures waste batch calls, `SAPQuery` behavior is under-documented and over-promised, and `SAPManage` diagnostic actions are hidden in read-only/scoped workflows.

The key decision is to fix contracts, runtime hints, scope mechanics, and documentation together. In ARC-1, these concerns are coupled in real usage: users typically move from `SAPRead`/`SAPQuery` diagnostics to `SAPManage probe` and then to write actions. If one layer is inconsistent, the whole workflow degrades.

This plan also includes high-impact drift fixes discovered during research (tool docs and E2E comments no longer matching runtime behavior), because those drifts directly reduce trust and increase false troubleshooting loops.

## Context

### Current State

`TABLE_CONTENTS` (`src/adt/client.ts`) forwards `sqlFilter` as raw body (`text/plain`) to `/sap/bc/adt/datapreview/ddic` without local shape checks. Users can send full SQL or `WHERE ...` and then get parser errors that look unrelated to filter syntax.

`AdtNetworkError` handling in `src/handlers/intent.ts` only says "connectivity issue." It does not guide users/agents to preflight with `SAPRead(type="SYSTEM")` before launching parallel batches.

`SAPQuery` currently has one JOIN-specific fallback branch, but misses the broader parser-failure pattern seen on ADT SQL console/backends: `"INTO" is invalid here (due to grammar)`, `"Only one SELECT statement is allowed"`, and generic "Invalid query string" cases.

`SAPManage` read actions (`features`, `probe`, `cache_stats`) are hidden in read-only mode due to a tool registration gate in `src/handlers/tools.ts`, and hidden for read-scoped users because `TOOL_SCOPES.SAPManage = 'write'` in `src/handlers/intent.ts`.

Important drift and inconsistency currently present:
- `tests/e2e/smoke.e2e.test.ts` and `tests/e2e/helpers.ts` still describe SAPQuery as if it used `/datapreview/ddic` instead of `/datapreview/freestyle`.
- `docs_page/tools.md` states SAPManage probe does "8 parallel HEAD requests," but `probeFeatures()` now runs feature probes plus system detection, textSearch probe, auth probe, and discovery fetch.
- `docs_page/tools.md` omits `flp_delete_catalog` in the SAPManage parameter/action list.
- `docs_page/tools.md` says `probe/features/cache_stats` work regardless of `--read-only`, but runtime currently hides SAPManage entirely in read-only mode.

Deep SAPQuery evidence baseline for this plan:
- ABAP SQL supports JOIN and subqueries in general language semantics (ABAP keyword docs and release notes).
- ADT SQL console/freestyle parser can still reject valid-looking constructs on some stacks with grammar errors; SAP KBA preview 3690844 explicitly shows ADT-only failures (`"INTO" is invalid here`, `"Only SELECT statement is allowed"`) while SQL works elsewhere.
- SAP official SQL-console material and tutorials show JOIN usage in ADT and also stress strict-syntax behavior and tool-specific constraints.

### Target State

`TABLE_CONTENTS` becomes contract-driven:
- `sqlFilter` must be a condition expression, not a full statement.
- validation and parser hints tell users exactly how to rewrite.
- safety-blocked data preview errors explain relevant knobs (`blockData`, profiles, scopes).

Connectivity failures become operationally actionable:
- runtime hints instruct probe-first behavior (`SAPRead(type="SYSTEM")`) before batch retries.
- docs codify this as a default workflow.

`SAPQuery` messaging reflects reality:
- ARC-1 clearly distinguishes ABAP SQL language capability from ADT parser variability by backend/version.
- parser-failure signatures (JOIN and non-JOIN) map to deterministic rewrite guidance.
- a capability matrix is documented with explicit "supported in language" vs "may fail in ADT endpoint" labels.

`SAPManage` read actions become available where they should be:
- visible in read-only mode,
- callable by read-scoped users,
- write actions remain protected by action-level scope checks and existing safety gates.

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | Core error formatting, SAPQuery classification, tool/action scope checks |
| `src/handlers/schemas.ts` | `SAPRead` validation hooks (`sqlFilter` contract) |
| `src/handlers/tools.ts` | Tool registration, action enum exposure, user-facing descriptions |
| `src/server/server.ts` | `ListTools` filtering by scope (auth-aware visibility behavior) |
| `src/adt/client.ts` | Endpoint truth: `TABLE_CONTENTS` (`/ddic`) vs `SAPQuery` (`/freestyle`) |
| `src/adt/features.ts` | Actual probe execution semantics used by SAPManage docs |
| `src/adt/safety.ts` | Safety ceiling (`blockData`, `blockFreeSQL`, readOnly write blocking) |
| `tests/unit/handlers/intent.test.ts` | Runtime error/scope regression tests |
| `tests/unit/handlers/tools.test.ts` | Tool visibility and schema/action-enum assertions |
| `tests/unit/handlers/schemas.test.ts` | Validation-level assertions for `SAPRead`/`SAPManage` |
| `tests/e2e/smoke.e2e.test.ts` | Endpoint/reference drift corrections for SAPQuery |
| `tests/e2e/helpers.ts` | Skip taxonomy text for backend capability gaps |
| `docs_page/tools.md` | Primary tool contract docs |
| `docs_page/mcp-usage.md` | Agent workflow and SQL limitation guidance |
| `docs_page/authorization.md` | Scope model docs (tool/action access semantics) |
| `docs_page/xsuaa-setup.md` | Scope-to-tool mapping examples that must stay aligned |
| `docs/research/2026-04-21-sapquery-freestyle-capability-matrix.md` | New research artifact for SQL capability vs parser variability |

### Design Principles

1. Contract first: reject malformed inputs early with concrete rewrite guidance.
2. Capability honesty: document ABAP SQL language support separately from ADT endpoint parser behavior.
3. Action-level authorization for mixed tools (`SAPManage`), not coarse tool-level assumptions.
4. Safety remains the hard ceiling; scope changes cannot bypass safety config.
5. Tool docs and runtime behavior are one product surface and must be kept in lockstep.

## Development Approach

Order of implementation:
1. `TABLE_CONTENTS` validation + error taxonomy,
2. connectivity preflight hinting,
3. SAPQuery deep classification + capability matrix docs,
4. SAPManage action-level scope/visibility repair,
5. drift cleanups (docs + E2E wording) and final consistency sweep.

Testing approach:
- unit-first for deterministic behavior (`intent`, `tools`, `schemas`),
- E2E text/skip taxonomy alignment updates,
- optional integration verification for SAPQuery parser signatures when credentials are available.

## Validation Commands

- `npm ci`
- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Harden TABLE_CONTENTS sqlFilter Contract and Error Guidance

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `docs_page/tools.md`

This task removes ambiguity between a table-filter expression and a full SQL statement.

- [ ] In `validateSapReadInput()` (`src/handlers/schemas.ts`), add `TABLE_CONTENTS` `sqlFilter` checks: reject leading `SELECT`, leading `WHERE`, and statement separators (`;`) with explicit remediation text.
- [ ] In `formatErrorForLLM()` (`src/handlers/intent.ts`), add `TABLE_CONTENTS`-specific parser hints for 400 signatures (`Invalid query string`, `Only SELECT statement is allowed`, `due to grammar`) and include valid examples like `MANDT = '100'` and `MATNR LIKE 'Z%'`.
- [ ] Add `AdtSafetyError` enrichment in `formatErrorForLLM()` for `TABLE_CONTENTS` calls, mapping the block to `blockData`/profile/scope implications.
- [ ] Update `SAPRead` `sqlFilter` description in `src/handlers/tools.ts` to "condition expression only (no WHERE, no SELECT)."
- [ ] Add unit tests (~10) across `schemas.test.ts` and `intent.test.ts` for accepted/rejected filter forms and improved error hints.
- [ ] Update `docs_page/tools.md` examples and parameter docs to remove "SQL WHERE clause filter" ambiguity.
- [ ] Run `npm test` — all tests must pass.

### Task 2: Add Probe-First Connectivity Guidance Before Batch Calls

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `docs_page/mcp-usage.md`

This task reduces wasted retries when SAP is down/unreachable.

- [ ] Update the `AdtNetworkError` hint text in `formatErrorForLLM()` to include a concrete preflight: `SAPRead(type="SYSTEM")` once before batch/parallel retries.
- [ ] Add branch logic to keep messages concise when the failed call already is `SAPRead(type="SYSTEM")`.
- [ ] Add unit tests (~4) verifying hint text for generic tool failures and `SYSTEM`-probe failures.
- [ ] Add a short "connectivity preflight pattern" section in `docs_page/mcp-usage.md`.
- [ ] Run `npm test` — all tests must pass.

### Task 3: Build SAPQuery Capability Matrix and Parser-Aware Error Classifier

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`
- Modify: `tests/e2e/smoke.e2e.test.ts`
- Modify: `tests/e2e/helpers.ts`
- Modify: `docs_page/tools.md`
- Modify: `docs_page/mcp-usage.md`
- Create: `docs/research/2026-04-21-sapquery-freestyle-capability-matrix.md`

This is the deep SAPQuery task: codify what ABAP SQL supports vs what ADT freestyle parser may reject by backend/version.

- [ ] Add a classifier helper in `src/handlers/intent.ts` for SAPQuery 400 parser signatures (including `"INTO" is invalid`, `"Only one SELECT statement is allowed"`, and generic grammar failures).
- [ ] Extend SAPQuery error handling so parser-signature guidance is emitted even when the SQL text has no `JOIN`; keep JOIN-specific addendum when query includes `JOIN`.
- [ ] Add deterministic rewrite hints: remove ABAP target clauses (`INTO`, `APPENDING`, `PACKAGE SIZE`), ensure single SELECT statement, split multi-table logic into staged single-table queries when parser rejects.
- [ ] Add unit tests (~10) for JOIN and non-JOIN parser signatures, plus "do not regress" tests for existing 404 table suggestion behavior.
- [ ] Tighten `SAPQUERY_DESC_ONPREM` wording in `src/handlers/tools.ts` to separate ABAP SQL language capability from ADT parser variability.
- [ ] Create `docs/research/2026-04-21-sapquery-freestyle-capability-matrix.md` with a table: `Construct`, `ABAP SQL language support`, `Observed ADT/freestyle behavior`, `Recommended fallback`, `Source`.
- [ ] Update `docs_page/tools.md` and `docs_page/mcp-usage.md` to reference the matrix and provide concise operator guidance.
- [ ] Fix E2E endpoint wording/skip reasons (`/datapreview/freestyle` instead of `/datapreview/ddic`) in `tests/e2e/smoke.e2e.test.ts` and `tests/e2e/helpers.ts`.
- [ ] Run `npm test` — all tests must pass.

### Task 4: Repair SAPManage Visibility and Authorization Model for Read Actions

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/server/server.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`
- Modify: `docs_page/tools.md`
- Modify: `docs_page/authorization.md`
- Modify: `docs_page/xsuaa-setup.md`

This task resolves the root cause for hidden `SAPManage probe` in read-only/scoped contexts.

- [ ] Introduce `SAPMANAGE_ACTION_SCOPES` in `src/handlers/intent.ts` (`features`, `probe`, `cache_stats` => `read`; mutating package/FLP actions => `write`).
- [ ] Change `TOOL_SCOPES.SAPManage` to `read` and enforce write requirements per action in the SAPManage call path.
- [ ] Remove `if (!config.readOnly)` registration gate in `src/handlers/tools.ts`; always register SAPManage.
- [ ] In `src/handlers/tools.ts`, expose read-only-safe action enum when `config.readOnly=true` and include full enum when writable.
- [ ] In `src/server/server.ts` list-tools path, ensure auth-scoped users do not see write-only SAPManage actions they cannot execute (auth-aware action pruning for SAPManage schema).
- [ ] Keep all write actions safety-protected via existing `checkOperation()` calls; validate with regression tests.
- [ ] Add/update unit tests (~12) for read-only visibility, read-scope probe access, and write-action denial for read-only/read-scoped contexts.
- [ ] Update docs in `tools.md`, `authorization.md`, and `xsuaa-setup.md` to reflect action-level semantics.
- [ ] Run `npm test` — all tests must pass.

### Task 5: Eliminate Hint and Documentation Drift that Blocks Diagnostics

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `docs_page/tools.md`
- Modify: `docs_page/mcp-usage.md`

This task removes stale or contradictory guidance that causes dead-end troubleshooting.

- [ ] Audit all user-facing hints referencing `SAPManage(action="probe")` and ensure guidance is valid in read-only/scoped scenarios after Task 4.
- [ ] Replace stale SAPManage probe wording ("8 parallel HEAD requests") with behavior that matches `probeFeatures()` implementation.
- [ ] Ensure SAPManage action lists in docs include `flp_delete_catalog` and remain synchronized with schema enums.
- [ ] Verify no docs still claim incorrect SAPQuery endpoint (`/datapreview/ddic`) for free SQL execution.
- [ ] Run `npm test` — all tests must pass.

### Task 6: Final Verification and Handoff

**Files:**
- Modify: `docs/plans/2026-04-21-ralphex-data-preview-probe-scope-hardening.md`

Complete quality gates and produce an implementation-ready handoff.

- [ ] Run full suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Confirm end-to-end consistency for all four primary issues (`TABLE_CONTENTS`, probe-first connectivity, SAPQuery variability messaging, SAPManage read-action visibility).
- [ ] Add a short PR handoff note summarizing backend-version caveats and where the capability matrix should be kept current.
- [ ] Move this plan to `docs/plans/completed/` after implementation merge.
