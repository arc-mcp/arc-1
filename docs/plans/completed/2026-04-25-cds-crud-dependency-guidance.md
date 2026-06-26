# CDS CRUD Dependency Guidance

## Overview

This plan hardens CDS CRUD workflows so ARC-1 gives actionable dependency guidance when a DDLS change ripples through downstream RAP artifacts. The immediate focus is the practical operator pain: updating one field/alias in a root DDLS can break dependent projection views, BDEFs, SRVDs, and deletion order, yet default SAP errors are often too generic.

The implementation keeps ARC-1's existing architecture and composes already-available primitives (`findWhereUsed`, `classifyCdsImpact`, DDIC diagnostics enrichment) instead of introducing new ADT endpoints. The output should be deterministic guidance with concrete object order hints for re-activation and delete sequencing.

## Context

### Current State

`SAPWrite(action="delete")` now enriches dependency-style DDLS deletion errors with where-used bucket summaries, and DDLS update/activation paths include baseline dependency follow-up text. This already reduces blind retry loops, but response guidance is still generic in places (placeholder activation order) and not yet documented in the tool reference.

Live BTP verification is blocked in unattended mode because BTP ABAP flow is interactive OAuth browser login. Direct A4H basic-auth probe from this workspace currently returns 401, so deterministic local validation relies on unit tests unless SAP test credentials are supplied in env.

### Target State

After this plan:
- DDLS update guidance includes a concrete re-activation order built from where-used impact buckets.
- DDLS activation-failure guidance includes a concrete batch activation suggestion instead of a placeholder.
- DDLS delete dependency guidance includes suggested delete sequencing for downstream consumers.
- Tool docs and roadmap/matrix reflect the new CDS CRUD dependency ergonomics.
- Unit tests lock behavior for update, activation, and delete dependency messaging.

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | Build and append dependency-aware CRUD hints for DDLS update/activate/delete paths |
| `src/adt/cds-impact.ts` | Existing downstream dependency classifier used by handler guidance |
| `src/adt/codeintel.ts` | Existing where-used retrieval primitive (`findWhereUsed`) used by guidance |
| `tests/unit/handlers/intent.test.ts` | Unit coverage for CDS update/delete/activate messaging behavior |
| `docs_page/tools.md` | End-user tool reference updates for CDS CRUD dependency guidance |
| `docs_page/roadmap.md` | Roadmap status update for this incremental CDS CRUD enhancement |
| `docs/compare/00-feature-matrix.md` | Matrix update for dependency-aware CDS CRUD guidance capability |
| `docs/research/2026-04-25-cds-crud-dependency-guidance.md` | Manual 3+ CDS sample topology and validation recipe |
| `docs/plans/completed/2026-04-25-cds-crud-dependency-guidance.md` | This execution plan |

### Design Principles

1. Reuse existing ADT primitives and ARC-1 classifiers; do not add speculative endpoints.
2. Keep guidance concise but executable: suggest concrete object orders, not only generic hints.
3. Avoid behavioral regressions in existing write/activate/delete flows.
4. Prefer deterministic unit coverage for message-shaping logic.
5. Keep live SAP validation steps explicit and repeatable for systems with credentials.

## Development Approach

Implement in two small code passes: first improve hint construction in `intent.ts`, then update docs and tests in one verification pass. Keep all new behavior additive (message enrichment only) so existing tool contracts remain backward-compatible.

## Validation Commands

- `npm test -- tests/unit/handlers/intent.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration -- --run tests/integration/adt.integration.test.ts -t "where-used"`

### Task 1: Strengthen DDLS CRUD Guidance With Concrete Execution Order

**Files:**
- Modify: `src/handlers/intent.ts`

Build concrete, dependency-aware ordering hints from CDS impact buckets so update/activation/delete flows produce actionable next steps.

- [ ] Add helper logic that derives ordered activation and delete object lists from `CdsImpactDownstream` buckets.
- [ ] Update DDLS update hint builder to append a concrete `SAPActivate(objects=[...])` suggestion with resolved downstream names.
- [ ] Update DDLS activation-failure hint builder to append a concrete re-activation order (root + downstream dependents).
- [ ] Update DDLS delete dependency hint builder to append a concrete delete ordering suggestion (reverse dependency order).
- [ ] Keep all hint builders resilient when where-used is unavailable (no hard failure in write/delete/activate flows).
- [ ] Add unit tests (~6) in existing handler tests for concrete ordering text and graceful fallback behavior.
- [ ] Run `npm test -- tests/unit/handlers/intent.test.ts` — all tests must pass.

### Task 2: Document CDS CRUD Dependency Behavior

**Files:**
- Modify: `docs_page/tools.md`
- Modify: `docs_page/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `docs/research/2026-04-25-cds-crud-dependency-guidance.md`

Document user-visible behavior changes and reflect them in roadmap/matrix artifacts so this feature is discoverable and tracked.

- [ ] Update `docs_page/tools.md` SAPWrite/SAPActivate sections to describe DDLS dependency-aware update/delete/activation guidance.
- [ ] Add/refresh roadmap entry in `docs_page/roadmap.md` for CDS CRUD dependency guidance completion.
- [ ] Update `docs/compare/00-feature-matrix.md` with a row that captures dependency-aware CDS CRUD guidance capability.
- [ ] Expand research note with the 3+ CDS validation script and expected reactions for update/activate/delete.
- [ ] Run `npm run lint` (docs lint/format checks) and fix any style issues.

### Task 3: Validate Against SAP Test System Scenario (3+ CDS Views)

**Files:**
- Read: `docs/research/2026-04-25-cds-crud-dependency-guidance.md`
- Read: `tests/integration/helpers.ts`

Execute the documented sample topology against a configured SAP test system to verify practical system reaction and guidance quality.

- [ ] Configure `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD` for the test system.
- [ ] Create 3+ CDS chain (`root + two dependents`) in a scratch package and activate baseline.
- [ ] Change a root field/alias via `SAPWrite(update)` and confirm update response includes dependency guidance.
- [ ] Run `SAPActivate(type="DDLS", name="<root>")` and confirm activation guidance behavior when dependents break.
- [ ] Attempt root delete before dependents and confirm delete dependency enrichment includes blockers/order hints.
- [ ] Record observed SAP response differences (if any) and fold findings into research doc notes.

### Task 4: Final Verification

**Files:**
- Read: `src/handlers/intent.ts`
- Read: `tests/unit/handlers/intent.test.ts`
- Read: `docs_page/tools.md`
- Read: `docs_page/roadmap.md`
- Read: `docs/compare/00-feature-matrix.md`

- [ ] Run full unit target: `npm test -- tests/unit/handlers/intent.test.ts` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Verify SAP test-system execution notes are captured (or explicitly documented as blocked with concrete reason).
- [ ] Move this plan to `docs/plans/completed/` once implementation and verification are fully complete.
