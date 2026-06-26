# Ralphex Plan: SAPContext Impact Sibling Extension Consistency

## Overview

This plan adds a targeted enhancement to `SAPContext(action="impact")` so it can detect and report likely **asymmetric metadata-extension coverage** across sibling CDS views. The motivating failure mode is when one sibling DDLS view has one or more `DDLX` consumers while another sibling used by runtime routing has none, causing missing UI fields in one code path.

Today ARC-1 already returns upstream dependencies and downstream RAP buckets for one DDLS object. That is necessary but not sufficient for this class of bug because the inconsistency lives **between** sibling DDLS views. The enhancement introduces a bounded sibling-check pass, emits explicit consistency hints, and keeps the base impact response backward-compatible.

Key design decision: keep the primary impact result as the source of truth and run sibling analysis as a best-effort addon that never turns a successful impact call into an error.

## Context

### Current State

`handleSAPContext()` in `src/handlers/intent.ts` (around `action === 'impact'`) currently:
- Reads one DDLS source (`client.getDdls(name)`)
- Builds upstream via `extractCdsDependencies()`
- Builds downstream via `findWhereUsed()` + `classifyCdsImpact()`
- Returns one-object impact JSON with optional warnings if where-used endpoint is unavailable

`classifyCdsImpact()` in `src/adt/cds-impact.ts` classifies downstream entries into RAP buckets (`projectionViews`, `bdefs`, `serviceDefinitions`, `serviceBindings`, `accessControls`, `metadataExtensions`, etc.), but it does not docs/compare sibling DDLS objects.

`SAPContext` schemas (`src/handlers/schemas.ts`) and tool definition (`src/handlers/tools.ts`) currently expose `includeIndirect` but no sibling-consistency controls.

Result: the output can correctly show `metadataExtensions=[]` for a target DDLS while missing the critical diagnostic insight that a sibling DDLS in the same family/package does have metadata extensions.

### Target State

`SAPContext(action="impact")` continues to return the existing upstream/downstream payload and additionally returns a sibling-consistency section when applicable:
- `consistencyHints`: human-readable findings
- `siblingExtensionAnalysis`: structured details of checked siblings and extension counts

Sibling analysis behavior:
- Bounded and deterministic (strict candidate limits)
- Heuristic-driven (same package + sibling naming stem)
- Best-effort (failures become warnings, not hard errors)

Optional request controls are added:
- `siblingCheck` (boolean, default true)
- `siblingMaxCandidates` (number, bounded)

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | `SAPContext(action="impact")` orchestration and response shape |
| `src/adt/cds-impact.ts` | Add pure sibling-heuristic helpers and finding model |
| `src/adt/client.ts` | Reuse `searchObject()` for candidate DDLS discovery (no new endpoint required) |
| `src/handlers/schemas.ts` | Add `siblingCheck` + `siblingMaxCandidates` to SAPContext schema |
| `src/handlers/tools.ts` | Expose new SAPContext parameters and output semantics |
| `tests/unit/adt/cds-impact.test.ts` | Unit tests for stem extraction/candidate filtering logic |
| `tests/unit/handlers/intent.test.ts` | End-to-end handler tests for sibling hint generation and guardrails |
| `tests/unit/handlers/schemas.test.ts` | Validation tests for new SAPContext parameters |
| `tests/unit/handlers/tools.test.ts` | Tool-schema tests for SAPContext parameter exposure |
| `docs_page/tools.md` | User-facing SAPContext impact docs and examples |
| `docs_page/mcp-usage.md` | Agent workflow guidance for sibling inconsistency diagnosis |
| `docs/research/` | New research note documenting heuristic limits and false-positive controls |

### Design Principles

1. Preserve backward compatibility: existing `impact` fields remain stable; new fields are additive.
2. Never block base impact: sibling analysis is advisory and must not fail the primary response.
3. Bound request fan-out: enforce strict sibling candidate caps to protect latency and token budget.
4. Minimize false positives: require package match and conservative name-stem matching before comparisons.
5. Explain confidence: hints should include why siblings were considered related and what was compared.

## Development Approach

Implement in layers:
1. Pure heuristic helpers + tests first.
2. Handler wiring and API shape next.
3. Schema/tool exposure and docs alignment last.

Testing focus:
- Deterministic unit tests with mocked search/where-used responses.
- Explicit regression tests for "no escalation to error" and "no unbounded fan-out" behavior.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add Sibling-Consistency Primitives

**Files:**
- Modify: `src/adt/cds-impact.ts`
- Modify: `tests/unit/adt/cds-impact.test.ts`

This task introduces pure, testable helpers for sibling matching and consistency finding generation, independent from HTTP calls.

- [ ] Add helper types in `src/adt/cds-impact.ts` for sibling-analysis inputs/outputs (candidate metadata and finding summary).
- [ ] Add `deriveSiblingStem(name: string)` helper that supports common DDLS sibling patterns (trailing numeric variants such as `...DATA3` -> stem `...DATA`).
- [ ] Add `isSiblingNameMatch(targetName, candidateName, stem)` helper with conservative rules (same stem, not exact same name).
- [ ] Add `buildSiblingExtensionFinding(...)` pure helper that emits a finding when target has `0` metadata extensions and at least one sibling has `>0`.
- [ ] Add unit tests (~8) covering: stem extraction, no false positives for unrelated names, matching with numeric suffix variants, and finding emission/non-emission logic.
- [ ] Run `npm test` — all tests must pass.

### Task 2: Wire Sibling Analysis Into SAPContext impact

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

This task integrates sibling analysis into the `impact` path while preserving the current response contract and graceful-degradation behavior.

- [ ] In `handleSAPContext()` `action === 'impact'` branch, keep existing upstream/downstream generation unchanged as the base path.
- [ ] Add bounded sibling analysis that runs only when enabled and meaningful:
- [ ] Resolve target package via `client.searchObject(name, ...)` and DDLS-exact match.
- [ ] Discover DDLS sibling candidates with `client.searchObject(stem + '*', ...)`, then filter by package and sibling-name rules.
- [ ] Limit candidates via capped `siblingMaxCandidates` (hard maximum in code).
- [ ] For each candidate, fetch downstream via `findWhereUsed()` + `classifyCdsImpact()` and compare `metadataExtensions` counts.
- [ ] Add additive response fields:
- [ ] `consistencyHints: string[]`
- [ ] `siblingExtensionAnalysis` (target/candidate counts + applied filters)
- [ ] Preserve non-fatal behavior: any sibling-analysis failure appends warning text and returns base impact response.
- [ ] Add unit tests (~10) covering: hint emitted for asymmetric siblings, no hint when target already has DDLX consumers, no hint for unrelated names, cap enforcement, and graceful fallback on search/where-used errors.
- [ ] Run `npm test` — all tests must pass.

### Task 3: Extend SAPContext Input Surface

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`

This task exposes explicit controls for sibling analysis so callers can tune cost/signal.

- [ ] Add optional `siblingCheck: boolean` to on-prem and BTP SAPContext Zod schemas.
- [ ] Add optional `siblingMaxCandidates: number` (coerced, bounded) to both SAPContext schemas.
- [ ] Update SAPContext tool schema in `src/handlers/tools.ts` with both parameters and concise descriptions.
- [ ] Document defaults and hard caps directly in parameter description text.
- [ ] Add schema tests (~4) for valid/invalid values and bound clamping behavior.
- [ ] Add tool-definition tests (~2) ensuring new parameters appear in SAPContext input schema.
- [ ] Run `npm test` — all tests must pass.

### Task 4: Documentation and Research Alignment

**Files:**
- Modify: `docs_page/tools.md`
- Modify: `docs_page/mcp-usage.md`
- Create: `docs/research/2026-04-21-sapcontext-impact-sibling-consistency.md`

This task aligns operator/LLM guidance with the new behavior and records heuristic tradeoffs.

- [ ] In `docs_page/tools.md`, update SAPContext `impact` section with sibling-consistency behavior, new params, and sample output fields (`consistencyHints`, `siblingExtensionAnalysis`).
- [ ] In `docs_page/mcp-usage.md`, add a short troubleshooting workflow for cases where one DDLS sibling has annotations and another does not.
- [ ] Create `docs/research/2026-04-21-sapcontext-impact-sibling-consistency.md` documenting: heuristic design, false-positive controls, bounded-call strategy, and known limitations.
- [ ] Confirm docs do not claim deterministic sibling detection across arbitrary naming conventions.
- [ ] Run `npm run lint` — no errors.

### Task 5: Final Verification

- [ ] Run full test suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Verify no existing `SAPContext(action="impact")` consumers break when new fields are ignored.
- [ ] Move this plan to `docs/plans/completed/` after implementation merge.
