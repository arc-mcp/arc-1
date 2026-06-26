# RAP On-Prem Agent Gap Closure

## Overview

This plan closes the remaining high-friction RAP authoring gaps reported from the ABAP 7.58 Travel Request build session while minimizing plan sprawl by grouping the work into one execution track. The focus is the residual items not already delivered in ARC-1: behavior-pool full-class write reliability, quick-fix automation for RAP boilerplate, and broader pre-write static validation for non-ABAP RAP artifacts.

The implementation strategy is to keep the existing architecture (intent-based tools, ADT client facade, safety-first defaults) and add targeted RAP capabilities behind existing tools where possible. We avoid adding many new top-level tools; new behavior should be exposed through current actions/parameters unless a distinct API boundary is required.

## Context

### Current State

ARC-1 already covers several RAP pain points from earlier feedback:
- Structured DDIC diagnostics are surfaced in errors (`SBD_*`, message variables, line info).
- Post-save inactive syntax check enrichment is available for DDIC objects.
- `SAPWrite` create paths include `_package` where needed for blue-framework object types.
- CDS impact analysis (`SAPContext action="impact"`) and `SAPManage action="change_package"` exist with test coverage.

Remaining gaps from the session feedback are concentrated in three areas:
- Behavior-pool class writes that include `METHODS ... FOR ...` declarations are still unreliable through full-class update flows and often force manual ADT signature generation.
- No first-class MCP path exists to invoke RAP-specific ADT quick-fixes (draft table generation, handler signature generation).
- Pre-write RAP static checks are partial; linting and validation coverage is still strongest for ABAP/DDLS and weaker for BDEF/DDLX/TABL deterministic rules.

### Target State

After this plan:
- RAP behavior handler scaffolding can be completed end-to-end via MCP without mandatory manual ADT class signature stamping.
- Deterministic RAP static-rule violations are caught before activation for TABL/BDEF/DDLX/DDLS (or at least surfaced with deterministic preflight diagnostics in the same write attempt).
- Error guidance and activation responses become more selective and actionable (collision recovery hints and per-object activation failures in batch mode).
- Skills guide users/agents into the reliable path by default and only escalate to manual ADT when genuinely unavoidable.

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | Wire new RAP preflight checks, write/activate response shaping, and behavior-pool flow integration |
| `src/handlers/tools.ts` | Update tool descriptions and schemas for RAP-specific parameters/actions |
| `src/handlers/schemas.ts` | Validate new/extended RAP action input contracts |
| `src/adt/client.ts` | Add/extend ADT client methods for quick-fix metadata/application and activation detail reads |
| `src/adt/devtools.ts` | Extend quickfix/activation helpers for RAP-centric usage |
| `src/adt/errors.ts` | Add targeted hinting for create-collision and behavior-pool save failure signatures |
| `src/adt/rap-preflight.ts` | New deterministic RAP static-rule validator module for TABL/BDEF/DDLX/DDLS |
| `tests/unit/handlers/intent.test.ts` | Handler behavior tests for new RAP paths and hints |
| `tests/unit/adt/*.test.ts` | Unit tests for preflight, quickfix wiring, and parser logic |
| `tests/integration/adt.integration.test.ts` | Live SAP validation for RAP quick-fix and behavior-pool flows |
| `skills/generate-rap-service-researched.md` | Align generation workflow with new capabilities and fallback logic |
| `skills/generate-rap-service.md` | Mirror practical constraints for fast-path generation |
| `skills/generate-rap-logic.md` | Ensure logic generation path handles RAP handler signature lifecycle |
| `skills/bootstrap-system-context.md` | Surface RAP-relevant constraints in system bootstrap output |
| `skills/analyze-chat-session.md` | Add explicit quick-win vs planned-gap classification section |
| `docs_page/tools.md` | User-facing tool docs for new RAP checks/actions |
| `docs/roadmap.md` | Track closure status for RAP agent gap items |

### Design Principles

1. Prefer deterministic preflight checks over retry-heavy activation loops when rules are local and static.
2. Keep new behavior behind existing tool families (`SAPWrite`, `SAPDiagnose`, `SAPActivate`) to preserve token efficiency.
3. Preserve backward compatibility: no breaking schema changes for existing action payloads.
4. Treat live SAP integration tests as release gates for RAP workflow changes.
5. Encode proven operational workarounds into skills only when the server cannot yet guarantee full automation.

## Development Approach

Use one consolidated implementation stream with three technical tracks executed in order: (1) deterministic RAP preflight validation, (2) behavior-pool and quick-fix automation, (3) response/hint ergonomics and documentation. Each task includes unit tests; SAP integration tests are required for completion and must run against a configured test system.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration -- --run tests/integration/adt.integration.test.ts -t "RAP"`

### Task 1: Add RAP Static Preflight Validator (TABL/BDEF/DDLX/DDLS)

**Files:**
- Create: `src/adt/rap-preflight.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `tests/unit/adt/rap-preflight.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Create a deterministic preflight validator for high-frequency RAP static-rule failures so the user gets actionable diagnostics before activation round-trips.

- [x] Implement `validateRapSource(type, source, context)` in `src/adt/rap-preflight.ts` with typed findings (`severity`, `ruleId`, `message`, `line?`, `column?`, `suggestion?`).
- [x] Cover initial deterministic rules from session feedback: TABL currency/unit semantics, forbidden TABL types for on-prem 7.5x, BDEF enum/header misuse, projection BDEF header misuse, DDLX duplicate annotation and scope misuse checks.
- [x] Add a guarded call in `handleSAPWrite` pre-write flow to include preflight findings in write-time response/hints (blocking only on clearly invalid syntax/state; warnings otherwise).
- [x] Expose a per-call escape hatch (`preflightBeforeWrite: false`) in schema/tool docs, mirroring existing lint override behavior.
- [x] Add unit tests (~20) for parser/validator rules and intent-level integration of findings.
- [x] Run `npm test` — all tests must pass.

### Task 2: Automate RAP Behavior Handler Scaffolding And Quick-Fix Flow

**Files:**
- Modify: `src/adt/devtools.ts`
- Modify: `src/adt/client.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `tests/unit/adt/devtools.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/integration/adt.integration.test.ts`

Provide an MCP-native path to generate/apply RAP handler signatures and reduce dependency on manual ADT editor quick-fixes.

- [x] Add a RAP-oriented helper action (under existing tool families) that maps BDEF declarations to required behavior-pool method signatures and returns missing signatures with exact insertion targets.
- [x] Auto-apply also creates empty implementation stubs when matching local handler implementation blocks are available, so `SAPWrite(action="edit_method")` can patch method bodies immediately after scaffolding.
- [x] Implement optional auto-apply mode that uses existing quickfix/apply_quickfix ADT plumbing where possible, and falls back to safe method-level patching when full-class update is unstable.
- [x] Ensure create/update flows detect behavior-pool signature mismatch failures and return explicit guidance referencing the new helper action.
- [x] Add unit tests (~15) for signature extraction/matching, helper responses, and fallback logic.
- [x] Add integration tests (~4) against live SAP test system for end-to-end handler-signature scaffolding on a scratch RAP object set.
- [x] Run `npm test` and targeted integration tests — all must pass.

### Task 3: Improve Error And Activation Ergonomics For RAP Authoring

**Files:**
- Modify: `src/adt/errors.ts`
- Modify: `src/adt/devtools.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/adt/errors.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Improve high-frequency friction points that still cause unnecessary retries.

- [x] Add explicit create-collision recovery hint for `Resource X does already exist` to recommend `action="update"` with full source payload.
- [x] Extend batch activation response formatting to always include per-object status and message arrays when mixed success/failure occurs.
- [x] Add targeted classification/hint for behavior-pool full-class save failures (`[?/011]`) with clear remediation path.
- [x] Add unit tests (~10) covering new hint conditions and batch activation response shape.
- [x] Run `npm test` — all tests must pass.

### Task 4: Skill And Documentation Alignment

**Files:**
- Modify: `skills/generate-rap-service-researched.md`
- Modify: `skills/generate-rap-service.md`
- Modify: `skills/generate-rap-logic.md`
- Modify: `skills/bootstrap-system-context.md`
- Modify: `skills/analyze-chat-session.md`
- Modify: `docs_page/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `CLAUDE.md`

Align skill workflows and public docs with the new RAP capabilities and operationally-proven fallback strategy.

- [x] Update RAP generation skills to call out deterministic preflight behavior, reduced activation churn, and the behavior-handler scaffolding action.
- [x] Update bootstrap skill to record RAP-relevant constraints block (including known on-prem 7.5x pitfalls and feature flags).
- [x] Update chat-analysis skill to produce a mandatory triage section: `Quick Wins In-Session` vs `Needs Planned Implementation`.
- [x] Update tool docs/roadmap/CLAUDE references for any new or changed RAP actions/parameters.
- [x] Run `npm run lint` and `npm run typecheck` — no errors.

### Task 5: Final Verification

**Files:**
- Read: `src/handlers/intent.ts`
- Read: `src/adt/rap-preflight.ts`
- Read: `src/adt/devtools.ts`
- Read: `skills/generate-rap-service-researched.md`
- Read: `docs_page/tools.md`

- [x] Run full test suite: `npm test` — all tests pass.
- [x] Run typecheck: `npm run typecheck` — no errors.
- [x] Run lint: `npm run lint` — no errors.
- [x] Run RAP-focused integration tests against SAP test system with configured credentials and capture pass/fail evidence.
- [x] Move this plan to `docs/plans/completed/` once implementation is fully complete.

### Verification Notes (2026-04-21)

- RAP integration coverage was validated during implementation with SAP credentials:
  `npm run test:integration -- --run tests/integration/adt.integration.test.ts -t "RAP handler scaffolding helpers"` → `3 passed, 76 skipped`.
- A subsequent rerun in a clean shell failed setup due missing `TEST_SAP_*`/`SAP_*` credentials, while unit/typecheck/lint remained green.
