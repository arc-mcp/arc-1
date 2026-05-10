# PR-A CLAS Include Writes And RAP Auto-Skeletons

## Overview

This plan implements PR-A from the SEGW-to-RAP migration run notes: make `SAPWrite(action="update", type="CLAS", include=...)` write class local includes natively, and make `SAPWrite(action="scaffold_rap_handlers", ...)` create missing `lhc_*` behavior-handler skeletons before injecting RAP method signatures and implementation stubs.

The implementation keeps the existing 12-tool model. `include` is a new parameter on `SAPWrite update` for class local sections, not a new tool. RAP skeleton creation stays inside the pure `src/adt/rap-handlers.ts` transformer, while `src/handlers/intent.ts` continues to own safety, package checks, locks, writes, and cache invalidation.

## Context

### Current State

The migration run notes in `/Users/marianzeis/DEV/arc-1-legacy-ui5-rap-conversion/RUN-NOTES.md` identify two P0 gaps. First, `SAPWrite` accepts no `include` field in its schema, so callers that pass `include="definitions"` or `include="implementations"` lose that field during Zod parsing and the handler falls back to `/source/main`, corrupting the behavior-pool main include. Second, `scaffold_rap_handlers` can insert signatures and stubs only after the local `lhc_<alias>` class shells already exist; when the definitions/implementations includes are empty ADT placeholders, the handler returns an unresolved-skeleton hint and requires a manual ADT/curl side channel.

ADT evidence from Eclipse 3.58 and the compare docs confirms the route shape: class main source is `/sap/bc/adt/oo/classes/{name}/source/main`, while local sections are `/sap/bc/adt/oo/classes/{name}/includes/{definitions|implementations|macros|testclasses}`. Existing ARC-1 CRUD code already supports lock parent object plus PUT arbitrary source URL with the lock handle; `scaffold_rap_handlers` already uses one parent class lock for multi-include saves, which matches the include-lock analysis in `compare/abap-adt-api/evaluations/issue-36-include-lock.md`.

Live-system context: A4H S/4HANA 2023 / NW 7.58 is the primary write validation target. The NPL 7.50 system is useful for read/API compatibility probes, but the infrastructure docs record a server-side lock-handle/session bug that makes write validation unreliable there.

### Target State

After this plan:
- `SAPWrite(action="update", type="CLAS", name="ZBP_...", include="definitions"|"implementations"|"macros"|"testclasses", source="...")` locks the parent class object and PUTs the selected include URL instead of `/source/main`.
- Invalid `include` usage is rejected early: include writes are only valid for `action="update"` and `type="CLAS"`.
- `scaffold_rap_handlers(autoApply=true)` creates missing `CLASS lhc_<alias> DEFINITION INHERITING FROM cl_abap_behavior_handler.` shells in CCDEF and matching `CLASS lhc_<alias> IMPLEMENTATION.` shells in CCIMP, then inserts the required `METHODS ... FOR ...` declarations and empty `METHOD ... ENDMETHOD.` stubs.
- Existing behavior remains stable for pools that already have handler classes in `main`, `definitions`, or `implementations`; no duplicate skeletons, signatures, or stubs are emitted.

### Key Files

| File | Role |
|------|------|
| `src/handlers/schemas.ts` | Zod input contract for `SAPWrite`; currently drops unknown `include` |
| `src/handlers/tools.ts` | MCP JSON schema/tool description for `SAPWrite` |
| `src/handlers/intent.ts` | `SAPWrite` routing, package checks, locks, include URL builder, scaffold handler |
| `src/adt/rap-handlers.ts` | Pure RAP BDEF parsing, handler diffing, signature/stub scaffold planning |
| `tests/unit/handlers/schemas.test.ts` | Schema validation and three-file sync guards |
| `tests/unit/handlers/tools.test.ts` | JSON schema/tool definition coverage |
| `tests/unit/handlers/intent.test.ts` | Mocked ADT routing and scaffold handler behavior |
| `tests/unit/adt/rap-handlers.test.ts` | Pure RAP scaffold transformer coverage |
| `README.md` | Top-level user-facing capability table |
| `docs_page/tools.md` | Tool reference for `SAPWrite` and RAP handler scaffolding |
| `docs_page/roadmap.md` | Roadmap/current-state completion note |
| `compare/00-feature-matrix.md` | Competitor matrix row for RAP behavior-pool scaffolding |
| `compare/adt/apis/03-oo-classes-and-interfaces.md` | ADT API evidence for class include routes |
| `CLAUDE.md` | Assistant implementation map for future agents |

### Design Principles

1. Use the existing lock/update/unlock primitives. Include updates lock the parent class object URL and PUT the selected include URL with the same lock handle.
2. Keep class include writes scoped to `SAPWrite update type=CLAS`; omit `include` for main-source writes.
3. Do not run full-source ABAP lint/syntax prechecks on isolated local include snippets. They are not complete class pools and should not be parsed as such before PUT.
4. Keep RAP auto-skeleton generation deterministic and pure in `rap-handlers.ts`; no ADT quickfix endpoint is part of PR-A.
5. Preserve existing scaffold fallthrough order and duplicate detection: main, then definitions, then implementations.
6. Preserve safety invariants: write gate, package allowlist, transport propagation, and cache invalidation all still apply.

## Development Approach

Implement in three slices: input contract and include routing first, pure RAP skeleton planning second, scaffold handler wiring third. Then update docs and validate with unit tests, typecheck, lint, and best-effort live A4H smoke testing. NPL 7.50 should be probed for route/read compatibility where possible, but write validation may be documented as skipped because of the known lock-handle behavior.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm test -- tests/unit/handlers/schemas.test.ts tests/unit/handlers/tools.test.ts tests/unit/handlers/intent.test.ts tests/unit/adt/rap-handlers.test.ts`
- `npm run build`

### Task 1: Add SAPWrite CLAS Include Update Contract And Routing

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

`SAPWrite update` must preserve the `include` argument and route CLAS include writes to `/includes/{include}` instead of `/source/main`. Follow the existing `classIncludeUrl()` helper in `src/handlers/intent.ts` and the lock/update pattern in `safeUpdateSource()`.

- [x] Add a write-side class include enum for `definitions`, `implementations`, `macros`, and `testclasses` in `src/handlers/schemas.ts`.
- [x] Add `include` to both `SAPWriteSchema` and `SAPWriteSchemaBtp`, with a `superRefine` guard that rejects `include` unless `action="update"` and `type="CLAS"`.
- [x] Add `include` to the `SAPWrite` JSON schema in `src/handlers/tools.ts` with a description that says to omit it for `source/main`.
- [x] In `handleSAPWrite`, branch early in `case 'update'` when `include` is present: enforce existing-object package checks, require the `source` field to be present, call `safeUpdateSource(client.http, client.safety, objectUrl, classIncludeUrl(name, include), source, transport, cachedFeatures?.abapRelease)`, invalidate caches, and return an include-specific success message.
- [x] Ensure include updates bypass RAP preflight, CDS guard, full-source lint, and server-side syntax precheck because local includes are not complete class sources.
- [x] Add unit tests (~8): schema accepts valid include update on on-prem and BTP; schema rejects invalid include/non-CLAS/non-update usage; tool schema exposes the include enum; intent PUTs to `/includes/definitions` and never `/source/main`; parent class lock and transport propagation are preserved; missing `source` is rejected without PUT.
- [x] Run `npm test -- tests/unit/handlers/schemas.test.ts tests/unit/handlers/tools.test.ts tests/unit/handlers/intent.test.ts` — all tests must pass.

### Task 2: Add Pure RAP Handler Skeleton Planning

**Files:**
- Modify: `src/adt/rap-handlers.ts`
- Modify: `tests/unit/adt/rap-handlers.test.ts`

The RAP transformer must create missing local handler class shells before signature/stub insertion. This belongs in `src/adt/rap-handlers.ts` so it can be tested without ADT I/O and reused by the handler safely.

- [x] Add a pure helper that inspects all current sections, finds distinct `requirement.targetHandlerClass` values, and appends missing `CLASS lhc_* DEFINITION INHERITING FROM cl_abap_behavior_handler.` shells to `definitions` and missing `CLASS lhc_* IMPLEMENTATION.` shells to `implementations`.
- [x] Track created definition and implementation class names in the returned scaffold plan so the handler response can report auto-created skeletons.
- [x] Integrate skeleton creation into `applyRapHandlerScaffold()` before `applySignaturesAcrossSections()`, using the skeleton-updated sections as the input for signature and stub planning.
- [x] Preserve existing behavior for handler classes already declared in `main`, `definitions`, or `implementations`; do not create duplicate definitions or implementations.
- [x] Add unit tests (~6): empty includes create definition and implementation skeletons; partial definition-only creates only implementation; partial implementation-only creates only definition; placeholder comments are preserved; multiple BDEF aliases create multiple shells; re-running the plan is idempotent.
- [x] Run `npm test -- tests/unit/adt/rap-handlers.test.ts` — all tests must pass.

### Task 3: Wire Auto-Skeletons Into scaffold_rap_handlers

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Once the pure scaffold plan can create skeletons, the `SAPWrite action=scaffold_rap_handlers` handler should stop returning the old unresolved-skeleton hint for empty CCDEF/CCIMP and should write the newly created sections under the existing single class lock.

- [x] Update the handler response details to include auto-created skeleton counts/names from the scaffold plan.
- [x] Remove or narrow the old no-change unresolved-skeleton hint path so it only handles genuine no-op/unresolved conditions after skeleton planning.
- [x] Keep the existing single parent class lock and multi-include PUT sequence; ensure newly created definitions and implementations includes are written even when they were missing or empty in `SAPRead structured`.
- [x] Add unit tests (~5): `autoApply=true` with no handler classes creates CCDEF/CCIMP skeletons, signatures, and stubs; no manual hint is returned; dry-run remains read-only; existing skeleton tests still pass; autoApply with package allowlist still enforces package checks before writes.
- [x] Run `npm test -- tests/unit/handlers/intent.test.ts tests/unit/adt/rap-handlers.test.ts` — all tests must pass.

### Task 4: Update Documentation And Tracker Surface

**Files:**
- Modify: `README.md`
- Modify: `docs_page/tools.md`
- Modify: `docs_page/roadmap.md`
- Modify: `compare/00-feature-matrix.md`
- Modify: `compare/adt/apis/03-oo-classes-and-interfaces.md`
- Modify: `CLAUDE.md`

Document the new user-facing capability and update the internal future-agent map. Do not edit external migration skill files in `/Users/marianzeis/DEV/arc-1-legacy-ui5-rap-conversion/` from this repo PR.

- [x] Update the `SAPWrite` capability description in `README.md` to mention CLAS include updates and RAP handler scaffold auto-skeletons.
- [x] Add `include` to the `SAPWrite` parameter table in `docs_page/tools.md` and update the `scaffold_rap_handlers` section to state that missing `lhc_*` skeletons are auto-created.
- [x] Update `docs_page/roadmap.md` current-state/completed notes for PR-A.
- [x] Update `compare/00-feature-matrix.md` row for RAP behavior-pool handler scaffolding from in-flight/partial to supported with CLAS include writes and auto-skeletons.
- [x] Update `compare/adt/apis/03-oo-classes-and-interfaces.md` to record class include PUT routing with parent class locking.
- [x] Update `CLAUDE.md` Key Files table for future CLAS include write changes.
- [x] Run `npm test -- tests/unit/handlers/tools.test.ts` — docs do not need tests, but the tool-schema doc change should remain covered.

### Task 5: Final Verification, Live Smoke, And PR

**Files:**
- Verify: full repository
- Move: `docs/plans/pr-a-clas-include-rap-skeletons.md` to `docs/plans/completed/pr-a-clas-include-rap-skeletons.md`

Perform a final code review and verification pass before opening the PR. Live SAP validation should use the infrastructure env file without printing secrets.

- [x] Run targeted unit tests: `npm test -- tests/unit/handlers/schemas.test.ts tests/unit/handlers/tools.test.ts tests/unit/handlers/intent.test.ts tests/unit/adt/rap-handlers.test.ts` — all tests pass.
- [x] Run full unit suite: `npm test` — all tests pass.
- [x] Run typecheck: `npm run typecheck` — no errors.
- [x] Run lint: `npm run lint` — no errors.
- [x] Run build: `npm run build` — no errors.
- [x] Live-smoke A4H if credentials are available: create or use a scratch `$TMP` class, update `include="definitions"` with `SAPWrite`, read back `SAPRead(type="CLAS", include="definitions")`, and verify the main include is unchanged.
- [x] Live-smoke RAP scaffold on A4H if a scratch BDEF/behavior pool is available, or document why only mocked unit validation was run. Read-only dry-run against `ZBP_DM_PROJECT`/`ZR_DM_PROJECT` succeeded; auto-apply was not run against the demo object.
- [x] Probe NPL 7.50 read/route compatibility if credentials are available; skip write validation if the known lock-handle/session bug reproduces. Primary login returned 401, alternate login read main and definitions includes; write smoke skipped for the documented 7.50 lock-handle issue.
- [x] Review `git diff` for accidental scope creep and secret leakage.
- [x] Move this plan to `docs/plans/completed/`.
- [x] Commit with a conventional message, push the `codex/pr-a-clas-include-rap-skeletons` branch, and open a GitHub PR.
