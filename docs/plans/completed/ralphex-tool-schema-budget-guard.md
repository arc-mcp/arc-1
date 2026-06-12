# Ralphex Tool Schema Budget Guard

## Overview

This plan addresses external feedback point 5: ARC-1's MCP tool schema payload can grow silently because `src/handlers/tools.ts` contains long tool and property descriptions. The existing `check:sizes` guard only tracked source file line counts; it did not measure the actual JSON schema payload sent to MCP clients.

The implementation adds a CI budget guard for representative tool-definition scenarios. It measures the serialized MCP schema payload and all string-valued `description` fields with a deterministic byte/4 token estimate. It also removes stale documentation claims that the standard 12-tool surface is `~5K schema tokens`; the current implementation now reports the measured budget in CI instead of advertising an inaccurate fixed number.

## Context

### Current State

`scripts/ci/check-file-sizes.mjs` enforces line budgets and is already wired into `npm run check:sizes` and `.github/workflows/test.yml`. `src/handlers/tools.ts` has a line budget, but descriptions and nested JSON schema fields can still grow inside that budget. `README.md`, `docs_page/tools.md`, and `AGENTS.md` still claimed `~5K schema tokens`, which no longer matches the measured standard-mode payload.

Measured current schema payloads on 2026-06-12 with text search and Git features enabled:

- `standard-default`: 9 tools, ~11,182 schema tokens, 145 description strings / ~8,815 description tokens.
- `standard-full-git`: 12 tools, ~18,985 schema tokens, 258 description strings / ~14,505 description tokens.
- `btp-full-git`: 12 tools, ~17,222 schema tokens, 256 description strings / ~12,848 description tokens.
- `hyperfocused-default`: 1 tool, ~222 schema tokens, 6 description strings / ~102 description tokens.

### Target State

`npm run check:sizes` fails when the MCP schema payload grows past reviewed budgets. CI prints the measured payload per scenario so reviewers can see whether a PR expands prompt surface. Public docs avoid the stale `~5K` standard-mode claim and instead state that schema size is guarded by CI, with hyperfocused mode available for tight context windows.

### Key Files

| File | Role |
|------|------|
| `scripts/ci/check-tool-schema-budget.ts` | New MCP schema payload measurement and budget guard |
| `scripts/ci/check-file-sizes.mjs` | Existing file-size ratchet invoked by `check:sizes` |
| `package.json` | Wires the new guard into `npm run check:sizes` |
| `.github/workflows/test.yml` | CI step label for the combined size/schema budget check |
| `tests/unit/scripts/check-tool-schema-budget.test.ts` | Unit coverage for budget measurement and failure reporting |
| `README.md` | Removes stale `~5K schema tokens` claim |
| `docs_page/tools.md` | Removes stale `~5K schema tokens` claim from published tool docs |
| `AGENTS.md` | Removes stale `~5K schema tokens` claim from agent guidance |

### Verified Live Evidence

2026-06-12 live read smoke after implementation, using `node ./dist/cli.js call SAPRead --json '{"type":"COMPONENTS"}' --output json` with credentials parsed from `/Users/marianzeis/DEV/arc-1/.env.infrastructure`:

- NW 7.50 NPL: HTTPS endpoint returned `SAP_BASIS=750`.
- S/4HANA 2023: HTTP endpoint returned `SAP_BASIS=758`, `S4FND=108`.
- ABAP Platform 2025: HTTP endpoint returned `SAP_BASIS=816`, `S4FND=109`.

The code change is release-invariant because it changes CI scripts and documentation only. The live smoke verifies that the built CLI still performs read-only ADT round trips on all three configured SAP releases.

### Design Principles

1. Use a deterministic byte/4 token estimate as a CI ratchet, not as billing telemetry.
2. Measure both whole serialized tool definitions and the accumulated `description` strings, because descriptions are the drift vector called out in the feedback.
3. Include worst-case standard surfaces: default read-oriented tools, full on-prem tools with Git features, full BTP tools with Git features, and hyperfocused mode.
4. Keep budgets close to the current measured values so growth requires a deliberate diff.
5. Avoid new tokenizer/runtime dependencies for a CI-only guard.

## Development Approach

Add a TypeScript CI script under `scripts/ci/` because it can import `getToolDefinitions()` directly without requiring a prebuilt `dist/`. Export small measurement helpers so unit tests can cover recursion, token estimation, offender reporting, and current ARC-1 scenario budgets. Wire the script into `check:sizes` so the existing GitHub Actions step runs it automatically.

Update docs in the same PR because the research uncovered a concrete false claim. Do not attempt a broad prompt-copy reduction in this plan; the guard makes any future expansion visible, and prompt-surface trimming can happen in separate focused work.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add MCP schema budget measurement

**Files:**
- Create: `scripts/ci/check-tool-schema-budget.ts`
- Create: `tests/unit/scripts/check-tool-schema-budget.test.ts`

Add a CI script that measures serialized tool definitions and nested `description` strings for the current standard and hyperfocused surfaces.

- [x] Add a deterministic `estimateTokens(bytes)` helper using the byte/4 heuristic.
- [x] Add recursive `collectDescriptionStats()` that counts only string-valued `description` fields.
- [x] Define scenarios for default standard mode, full on-prem/Git mode, full BTP/Git mode, and hyperfocused mode.
- [x] Set reviewed budgets just above current measured values.
- [x] Add failure reporting that identifies the scenario and metric that exceeded budget.
- [x] Add unit tests for token estimation, description recursion, current budgets, and failure reporting.
- [x] Run `npm test -- tests/unit/scripts/check-tool-schema-budget.test.ts`.

### Task 2: Wire the guard into CI and correct stale docs

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/test.yml`
- Modify: `README.md`
- Modify: `docs_page/tools.md`
- Modify: `AGENTS.md`

Run the new schema-budget guard as part of the existing size check and remove the inaccurate `~5K schema tokens` wording from docs.

- [x] Extend `npm run check:sizes` to run `tsx scripts/ci/check-tool-schema-budget.ts` after the file-size ratchet.
- [x] Rename the GitHub Actions step to "Check size and schema budgets".
- [x] Update README token-efficiency copy to mention CI-guarded schema payload and hyperfocused mode.
- [x] Update the published tool reference intro with the same wording.
- [x] Update agent guidance so future autonomous work does not repeat the stale `~5K` claim.
- [x] Run `npm run check:sizes`.

### Task 3: Final verification

- [x] Run full test suite: `npm test` - all tests pass.
- [x] Run typecheck: `npm run typecheck` - no errors.
- [x] Run lint: `npm run lint` - no errors.
- [x] Run build: `npm run build` - no errors.
- [x] Live SAP read-only smoke on 7.50 via HTTPS: `SAPRead COMPONENTS` returned `SAP_BASIS=750`.
- [x] Live SAP read-only smoke on 2023 via HTTP: `SAPRead COMPONENTS` returned `SAP_BASIS=758`.
- [x] Live SAP read-only smoke on 2025 via HTTP: `SAPRead COMPONENTS` returned `SAP_BASIS=816`.
