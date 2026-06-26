# SAPDiagnose Dump Diagnosis Hardening and Diagnostics Gap Closure

## Overview

Improve ARC-1 diagnostics quality in two dimensions: (1) make short-dump diagnosis outputs more robust, language-safe, and token-efficient, and (2) close high-value diagnostics gaps identified in competitor research (`system_messages`/SM02 and `gateway_errors` feed support).

Today, `SAPDiagnose(action="dumps")` works but still returns oversized payloads by default (`formattedText` blob), relies on language-dependent parsing in the dump list parser, and gives generic 404 hints for diagnostics IDs. Competitor analysis in `docs/compare/` and `docs/research/2026-04-09-sapdumpmcp-analysis.md` shows concrete patterns ARC-1 can adopt without abandoning intent-based design.

This plan keeps ARC-1’s architecture intact: no new top-level MCP tools. Enhancements stay within `SAPDiagnose` actions, preserve safety controls, and expand unit/integration/e2e coverage so autonomous implementation can proceed safely in isolated ralphex sessions.

## Context

### Current State

- Dump listing/detail endpoints are implemented in `src/adt/diagnostics.ts` (`listDumps()` at ~39, `parseDumpList()` at ~174, `parseDumpDetail()` at ~217).
- `parseDumpList()` currently depends on English category labels (`"ABAP runtime error"`, `"Terminated ABAP program"`) and self-link regex extraction only, which is fragile on localized systems and non-standard feeds.
- `ListDumpsOptions.maxResults` is documented as “default 50” (`src/adt/diagnostics.ts:29`, `src/handlers/tools.ts:859`), but `listDumps()` only sends `$top` when explicitly provided (`src/adt/diagnostics.ts:47-49`), so effective default is backend-dependent.
- Dump detail chapter metadata currently keeps only `{name,title,category}` (`src/adt/types.ts:361-366`) and discards `line/chapterOrder` values already present in fixture XML (`tests/fixtures/xml/dump-detail.xml:1`).
- `SAPDiagnose` dumps action returns full detail JSON including raw `formattedText` (`src/handlers/intent.ts:3019-3031`), which is high token cost for common troubleshooting.
- Diagnostics-specific 404 UX is weak: `formatErrorForLLM()` not-found hint is name/type-centric (`src/handlers/intent.ts:283-287`) and can be misleading when `SAPDiagnose` is called with `id`.
- Audit `tool_call_end` persists `resultPreview` (first 500 chars) for all tool results (`src/handlers/intent.ts:598-617`), including dump content excerpts.
- Compare/research inputs indicate missing diagnostic feeds:
  - `system_messages` (SM02) and `gateway_errors` (IWFND) are tracked as ARC-1 gaps in `docs/compare/00-feature-matrix.md:185-187` and `docs/compare/05-fr0ster-mcp-abap-adt.md:217`.
  - datetime+user fuzzy dump lookup was removed by fr0ster due timezone bugs (`docs/compare/fr0ster/evaluations/c2b8006-dump-simplify-updateintf-fix.md:15-20`), reinforcing ARC-1’s ID-first strategy.
- Documentation surface is split: active user docs are in `docs_page/` (not `docs/`), and several pages still reference “11 tools” (`docs_page/index.md:17,152,187`, `docs_page/configuration-reference.md:88`, `docs_page/architecture.md:29,169`).

### Target State

- Dump list/detail parsing is language-safe and structurally robust (localized category handling, ID fallback strategy, explicit default limit behavior).
- Dump detail supports section-aware diagnosis output (chapter-line splitting + focused defaults) so typical troubleshooting avoids full blob transfer.
- `SAPDiagnose` adds docs/compare-driven diagnostics actions for `system_messages` and `gateway_errors` (with clear on-prem/BTP behavior).
- Diagnostics errors provide action-aware hints (dump/trace IDs), not generic object-name guidance.
- Audit output remains useful but avoids leaking verbose/sensitive dump content previews.
- Unit, integration, and e2e tests cover new behavior and keep skip-policy compliance.
- Docs, roadmap, comparison matrix, and assistant command docs are aligned with implemented behavior and 12-tool reality.

### Key Files

| File | Role |
|------|------|
| `src/adt/diagnostics.ts` | Runtime diagnostics API calls + dump/trace/feed parsers |
| `src/adt/types.ts` | Typed contracts for dump detail, chapters, traces, new feed payloads |
| `src/handlers/intent.ts` | `SAPDiagnose` routing, error formatting, audit result preview generation |
| `src/handlers/schemas.ts` | `SAPDiagnoseSchema` input contract updates |
| `src/handlers/tools.ts` | Tool description + JSON schema updates for new diagnostics capabilities |
| `src/server/audit.ts` | Audit event shape/comment updates for sanitized previews |
| `tests/unit/adt/diagnostics.test.ts` | Parser and diagnostics API unit coverage |
| `tests/unit/handlers/intent.test.ts` | SAPDiagnose routing/error hint/audit-behavior unit coverage |
| `tests/unit/handlers/schemas.test.ts` | Zod schema validation coverage for new params/actions |
| `tests/unit/handlers/tools.test.ts` | Tool definition/schema/description coverage |
| `tests/integration/adt.integration.test.ts` | Live SAP diagnostics behavior checks |
| `tests/e2e/diagnostics.e2e.test.ts` | End-to-end MCP diagnostics flows |
| `tests/fixtures/xml/dumps-list.xml` | Dump list fixture covering Atom id/link/category variants |
| `tests/fixtures/xml/dump-detail.xml` | Dump detail fixture with chapter line metadata |
| `docs_page/tools.md` | User-facing SAPDiagnose reference |
| `docs_page/mcp-usage.md` | Workflow examples for dump diagnosis and diagnostics actions |
| `docs_page/roadmap.md` | Feature status and diagnostics roadmap alignment |
| `docs/compare/00-feature-matrix.md` | Cross-project capability matrix |
| `docs_page/index.md`, `docs_page/configuration-reference.md`, `docs_page/architecture.md` | Tool-count and architecture consistency fixes |
| `CLAUDE.md` | Assistant implementation map and tool-count consistency |
| `.claude/commands/implement-feature.md`, `.claude/commands/update-competitor-tracker.md` | Skill/command instructions reflecting new diagnostics and 12-tool baseline |

### Design Principles

1. Keep intent-based MCP design: extend `SAPDiagnose` actions, do not add parallel duplicate tools.
2. Prefer deterministic identifiers: maintain dump ID-based retrieval; do not reintroduce datetime+user fuzzy lookup.
3. Default to token-efficient diagnosis output while allowing explicit opt-in for full raw text.
4. Preserve safety invariants (`OperationType.Read` only for new diagnostics feeds, no hidden writes).
5. Ensure localization tolerance in XML parsing (avoid hard dependency on English label text).
6. Improve UX through precise hints and bounded audit previews, without suppressing root SAP error details.
7. Treat docs and assistant instructions as first-class artifacts for autonomous-agent correctness.

## Development Approach

Implement in layers: parser/type foundation first, handler/schema/tool wiring second, docs/compare-driven feed expansion third, then diagnostics UX/audit hardening, then integration/e2e and documentation alignment. Every code-changing task includes tests in the same task to keep isolated ralphex sessions self-validating.
`INFRASTRUCTURE.md` is not present in this repository; integration/e2e verification should follow existing local credential conventions from `CLAUDE.md` and `docs/testing-skip-policy.md`.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration`
- `npm run test:e2e`

### Task 1: Harden dump list/detail parsing foundations

**Files:**
- Modify: `src/adt/diagnostics.ts`
- Modify: `src/adt/types.ts`
- Modify: `tests/unit/adt/diagnostics.test.ts`
- Modify: `tests/fixtures/xml/dumps-list.xml`
- Modify: `tests/fixtures/xml/dump-detail.xml`

Strengthen the parser layer first so all later handler changes rely on stable data contracts. Focus on `listDumps()` (~39-60), `parseDumpList()` (~174-207), and `parseDumpDetail()` (~217-254).

- [ ] Update `listDumps()` to enforce explicit default limit semantics (send `$top=50` when `maxResults` is omitted) and clamp out-of-range values to a safe bound.
- [ ] Refactor `parseDumpList()` to extract dump IDs with fallback order: self-link path, `atom:id` tail segment, then entry ID regex fallback; reject empty IDs.
- [ ] Remove language-coupled dependence on exact English category labels by adding resilient category extraction (label/term heuristics with fallback ordering).
- [ ] Extend `DumpChapter` in `src/adt/types.ts` to include chapter positioning metadata (`line`, `chapterOrder`, `categoryOrder`) and update parser mapping accordingly.
- [ ] Add unit tests (~10) covering localized/missing-label feeds, `atom:id`-only ID extraction, default `$top=50` behavior, and chapter metadata parsing.
- [ ] Ensure existing dump and trace parser tests still pass without regressions.
- [ ] Run `npm test` — all tests must pass.

### Task 2: Add section-aware dump diagnosis output

**Files:**
- Modify: `src/adt/diagnostics.ts`
- Modify: `src/adt/types.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/adt/diagnostics.test.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Implement token-efficient dump diagnosis by splitting formatted dump text into chapter sections using chapter line metadata from `parseDumpDetail()` and exposing section filters in `SAPDiagnose`.

- [ ] In `src/adt/diagnostics.ts`, add section-splitting helpers that sort chapters by `line`, slice `formattedText`, and produce a `sections` map keyed by stable section IDs/names.
- [ ] Include continuation-line normalization for source/code stack sections so wrapped lines are reconstructed before returning section text.
- [ ] Extend `DumpDetail` type in `src/adt/types.ts` with `sections` while preserving backward compatibility for existing fields.
- [ ] Add optional `sections` and `includeFullText` parameters to `SAPDiagnoseSchema` (`src/handlers/schemas.ts`) for `action="dumps"` detail calls.
- [ ] Update `SAPDiagnose` tool docs/schema (`src/handlers/tools.ts`) to describe default section-focused behavior and opt-in full-text mode.
- [ ] In `handleSAPDiagnose()` (`src/handlers/intent.ts` around dumps case ~3019), return focused section output by default for `id` requests and include full blob only when explicitly requested.
- [ ] Add unit tests (~14) covering section splitting, default section selection, explicit section filtering, and backward-compat mode with `includeFullText=true`.
- [ ] Run `npm test` — all tests must pass.

### Task 3: Add docs/compare-driven diagnostics actions (`system_messages`, `gateway_errors`)

**Files:**
- Modify: `src/adt/diagnostics.ts`
- Modify: `src/adt/types.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/adt/diagnostics.test.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Close diagnostics gaps identified in `docs/compare/00-feature-matrix.md` by adding SM02 and gateway error feed support under `SAPDiagnose` while preserving intent-based architecture.

- [ ] Implement `listSystemMessages()` parser/client flow in `src/adt/diagnostics.ts` (read-only feed call + typed parse) with support for `user`, `maxResults`, and optional time filters if endpoint supports them.
- [ ] Implement `listGatewayErrors()` and `getGatewayErrorDetail()` flows in `src/adt/diagnostics.ts` with list/detail mode and robust parsing of key context fields.
- [ ] Add new diagnostics types in `src/adt/types.ts` for system message entries and gateway error list/detail payloads.
- [ ] Extend `SAPDiagnoseSchema` action enum with `system_messages` and `gateway_errors`; add any required parameters (`id`/detail URL, filters) in `src/handlers/schemas.ts`.
- [ ] Wire new actions in `handleSAPDiagnose()` (`src/handlers/intent.ts`) and add explicit guardrail messaging for unsupported environments (for example, gateway feed on BTP).
- [ ] Update SAPDiagnose tool description/schema (`src/handlers/tools.ts`) with clear examples and on-prem caveats.
- [ ] Add unit tests (~16) covering parser outputs, route dispatch, unsupported-system behavior, and schema/tool-definition updates.
- [ ] Run `npm test` — all tests must pass.

### Task 4: Improve diagnostics error hints and audit preview safety

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/server/audit.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/unit/server/audit.test.ts`
- Modify: `tests/unit/server/audit-integration.test.ts`

Make diagnostics failures actionable and keep audit previews useful without leaking oversized runtime dump payloads.

- [ ] Update `formatErrorForLLM()` in `src/handlers/intent.ts` (~270-320) with SAPDiagnose-aware not-found hints for `dumps`/`traces` IDs (instead of generic name/type guidance).
- [ ] Add context-sensitive remediation in diagnostics error text (for example: “re-list dumps and re-use a fresh ID”) while preserving existing SAP-domain classification flow.
- [ ] Introduce a `resultPreview` sanitizer for diagnostics-heavy responses (especially dump detail) before emitting `tool_call_end` events (~598-617 in `intent.ts`).
- [ ] Update audit event comments/types in `src/server/audit.ts` to reflect sanitized preview semantics.
- [ ] Add unit tests (~8) validating diagnostics-specific 404 hints and sanitized preview behavior for dump outputs.
- [ ] Extend audit integration tests to ensure previews stay bounded and do not include raw full dump blobs.
- [ ] Run `npm test` — all tests must pass.

### Task 5: Add integration and E2E coverage for new diagnostics behavior

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`
- Modify: `tests/e2e/diagnostics.e2e.test.ts`
- Modify: `docs/testing-skip-policy.md` (if new skip reasons are introduced)

Validate the new diagnostics behavior against live SAP environments with explicit skip-policy-compliant assertions.

- [ ] Add integration tests for dump section-aware detail behavior (and default bounded output) under the existing runtime diagnostics block in `tests/integration/adt.integration.test.ts` (~893+).
- [ ] Add integration tests for `system_messages` and `gateway_errors` actions with explicit `requireOrSkip()`/`ctx.skip()` handling for unsupported systems.
- [ ] Add e2e tests in `tests/e2e/diagnostics.e2e.test.ts` for section-filtered dump reads and new diagnostics actions, using existing helper patterns (`callTool`, `expectToolSuccess`, `expectToolError`).
- [ ] Ensure all new tests follow `docs/testing-skip-policy.md` conventions (no silent pass-through, no empty catch without assertion).
- [ ] Run `npm run test:integration` — tests pass or skip with explicit valid reasons.
- [ ] Run `npm run test:e2e` — tests pass or skip with explicit valid reasons.

### Task 6: Update docs, roadmap, matrix, and assistant command guidance

**Files:**
- Modify: `docs_page/tools.md`
- Modify: `docs_page/mcp-usage.md`
- Modify: `docs_page/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `docs_page/index.md`
- Modify: `docs_page/configuration-reference.md`
- Modify: `docs_page/architecture.md`
- Modify: `CLAUDE.md`
- Modify: `.claude/commands/implement-feature.md`
- Modify: `.claude/commands/update-competitor-tracker.md`

Bring user docs and assistant workflows in sync with implemented diagnostics behavior and resolve stale “11 tools” references in active docs.

- [ ] Update `docs_page/tools.md` SAPDiagnose section to document section-aware dump output and new `system_messages`/`gateway_errors` actions with constraints/examples.
- [ ] Update `docs_page/mcp-usage.md` runtime error workflow to use section-focused dump diagnosis and follow-up diagnostics feeds.
- [ ] Update `docs_page/roadmap.md` status/notes for diagnostics enhancements implemented by this work.
- [ ] Update `docs/compare/00-feature-matrix.md` diagnostics rows impacted by this implementation (and refresh matrix date).
- [ ] Fix active documentation tool-count drift from 11 to 12 where applicable (`docs_page/index.md`, `docs_page/configuration-reference.md`, `docs_page/architecture.md`, `CLAUDE.md` if needed).
- [ ] Update `.claude/commands/implement-feature.md` and `.claude/commands/update-competitor-tracker.md` to reflect current tool count and diagnostics guidance.
- [ ] Run `npm run lint` — no errors.

### Task 7: Final verification

- [ ] Run full unit suite: `npm test` — all tests pass.
- [ ] Run integration suite: `npm run test:integration` — pass/expected skips only.
- [ ] Run e2e suite: `npm run test:e2e` — pass/expected skips only.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Manually verify `SAPDiagnose(action="dumps", id=...)` default output is section-focused and `includeFullText=true` preserves full-content path.
- [ ] Verify `SAPDiagnose(action="system_messages")` and `SAPDiagnose(action="gateway_errors")` behavior on supported vs unsupported systems.
- [ ] Move this plan to `docs/plans/completed/`.
