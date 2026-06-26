# Joule Roadmap Feature 1 — CDS Analytical Query Generation (skill)

> **Status (2026-06-03): Skill IMPLEMENTED + live-verified.** `skills/generate-cds-analytical-query/SKILL.md` is written and its tool sequence was verified end-to-end against live A4H (S/4HANA 2023, SAP_BASIS 758) via `arc1-cli`: a `define transient view entity … provider contract analytical_query as projection on <cube>` was created (`SAPWrite create`) and activated (`SAPActivate`) successfully, then read back (`SAPRead include=elements`) and deleted. **Remaining (optional/deferred):** Task 3 (pre-write lint hint), Task 2 (E2E test file), Task 4 (README/roadmap/feature-matrix/CLAUDE.md doc updates).

## Overview

SAP's Joule for Developers 2026 roadmap announces "CDS Analytical Query Generation powered by AI" — a wizard in Eclipse ADT that generates `DEFINE TRANSIENT VIEW ENTITY ... AS PROJECTION ON <cube> PROVIDER CONTRACT ANALYTICAL_QUERY` views on top of analytical models (`@Analytics.dataCategory: #CUBE`). Planned release: SAP BTP ABAP environment 2608 / S/4HANA Cloud Public 2608 / S/4HANA Cloud Private 2027.

ARC-1 already exposes every primitive this feature needs: `SAPSearch` for finding cubes, `SAPRead(type=DDLS)` for reading them, `SAPWrite(create, type=DDLS)` for writing the new analytical query, and `SAPActivate` for activation. The AFF schema in `src/aff/schemas/ddls-v1.json` validates the envelope. The capability gap is purely a **prompt + template library** so an LLM can compose a valid `ANALYTICAL_QUERY` projection.

This plan adds a new Claude skill `generate-cds-analytical-query` that drives the standard read/write/activate loop with analytical-query-specific templates and few-shot examples. Optionally it also adds an ARC-1-native pre-write hint that flags missing `@Analytics.query: true` on a transient projection view, mirroring the existing TABL `%admin` draft hint at `src/lint/pre-write-hints.ts`. The skill alone closes the parity gap; the lint hint is an opt-in quality polish.

See [`docs/research/2026-06-03-joule-2026-roadmap-feature-assessment.md §1`](../research/2026-06-03-joule-2026-roadmap-feature-assessment.md) for the full feature assessment.

## Context

### Current State

- ARC-1 ships generic DDLS read/write/activate, but no analytical-query templates
- The AFF DDLS schema `src/aff/schemas/ddls-v1.json` validates a freeform DDLS envelope
- `src/lint/pre-write-hints.ts` ships a TABL `%admin draft include` semantic hint (the pattern to mirror for analytical-query annotation hints)
- No skill in `skills/` covers analytical query generation; the existing `generate-rap-service` and `generate-rap-logic` skills cover transactional RAP only
- `mcp-sap-docs` exposes SAP Help / SAP Community / ABAP Keyword Docs, including the [Analytical Query Views](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCDS_ANALYTICAL_QUERY_APV.html) reference

### Target State

- New skill `skills/generate-cds-analytical-query/SKILL.md` orchestrates `SAPSearch` → `SAPRead` (cube) → LLM composes analytical-query DDLS → `SAPWrite(create, type=DDLS)` → `SAPActivate`
- The skill ships canonical templates: simple projection, projection with KPI measures + filter prompts, projection with dimension drilldowns
- Optionally: a new pre-write hint `inspectAnalyticalQueryDdlsSource()` in `src/lint/pre-write-hints.ts` that warns when a transient projection view (`DEFINE TRANSIENT VIEW ENTITY ... AS PROJECTION`) is missing `@Analytics.query: true` or projects on an entity without `@Analytics.dataCategory: #CUBE`
- E2E test covers create → activate → cleanup of a minimal analytical query on a cube fixture
- README, roadmap, feature matrix, CLAUDE.md updated to advertise the skill

### Key Files

| File | Role |
|------|------|
| `skills/generate-cds-analytical-query/SKILL.md` | New: the skill content |
| `skills/explain-abap-code/SKILL.md` | Reference: skill format / frontmatter / step structure |
| `skills/generate-rap-service-researched/SKILL.md` | Reference: research-first skill pattern, MCP tool usage |
| `src/lint/pre-write-hints.ts` | (Optional) Add analytical-query pre-write hint |
| `src/lint/lint.ts` | (Optional) Wire the new hint into `validateBeforeWrite()` |
| `tests/unit/lint/pre-write-hints.test.ts` | (Optional) Unit tests for the new hint |
| `tests/e2e/rap-write.e2e.test.ts` | Reference: pattern for E2E RAP-type writes (try/finally cleanup) |
| `tests/e2e/cds-analytical-query.e2e.test.ts` | New: E2E test for the analytical query skill flow |
| `tests/e2e/fixtures.ts` | Add an analytical cube fixture |
| `tests/fixtures/abap/` | New: cube CDS view fixture + expected analytical-query template |
| `README.md`, `docs/index.md`, `docs/roadmap.md`, `docs/compare/00-feature-matrix.md`, `CLAUDE.md` | Documentation updates |

### Design Principles

1. **Skill-first** — no ARC-1 code change is required for parity; only the skill is mandatory. The pre-write hint is a quality polish (opt-in task).
2. **Use the existing read/write loop** — `SAPSearch` → `SAPRead(DDLS)` → `SAPWrite(create)` → `SAPActivate`. No new tools.
3. **Templates over freestyle** — ship 3 canonical analytical-query templates as few-shot examples in the skill, not freeform prose.
4. **Source the cube first** — never let the LLM hallucinate a cube; resolve via `SAPSearch` and read the cube source so element names are grounded.
5. **mcp-sap-docs integration** — the skill must query `mcp-sap-docs` for [`@Analytics.query`](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCDS_ANALYTICAL_QUERY_APV.html) and `PROVIDER CONTRACT ANALYTICAL_QUERY` semantics before generation, the same pattern `explain-abap-code` uses.

## Development Approach

- Task 1: Skill content authoring (the deliverable)
- Task 2: E2E coverage of the skill's read/write/activate path
- Task 3: (Optional) Pre-write hint + unit tests
- Task 4: Documentation updates
- Task 5: Final verification

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:e2e` (requires running MCP server)

### Task 1: Author the `generate-cds-analytical-query` skill

**Files:**
- Create: `skills/generate-cds-analytical-query/SKILL.md`

This is the core deliverable. The skill must be self-contained and follow the format of existing skills (frontmatter `name` + `description`, then steps). Reference `skills/explain-abap-code/SKILL.md` for tone and `skills/generate-rap-service-researched/SKILL.md` for the research-first pattern.

- [ ] Create the directory `skills/generate-cds-analytical-query/`
- [ ] Write `SKILL.md` with frontmatter: `name: generate-cds-analytical-query`, `description: Generate analytical CDS projection views (PROVIDER CONTRACT ANALYTICAL_QUERY) on top of existing analytical cubes. Use when the user asks to "create an analytical query", "build a KPI projection", or "generate ANALYTICAL_QUERY DDLS".`
- [ ] Step 1 — Resolve the cube: call `SAPSearch(query="<user_input>")` to find candidate cubes; if multiple matches, present them and let the user choose; for ambiguous input, accept package + name filter
- [ ] Step 2 — Read the cube source: `SAPRead(type="DDLS", name="<cube>", include="elements")` to get the field list; verify the cube has `@Analytics.dataCategory: #CUBE`. If not, stop and explain.
- [ ] Step 3 — Look up canonical semantics: `mcp-sap-docs search` for `PROVIDER CONTRACT ANALYTICAL_QUERY` and `@Analytics.query` annotation; cite the resulting doc IDs (don't embed the full text)
- [ ] Step 4 — Compose the analytical query DDLS. Ship 3 templates in the skill:
  - **Template A (simple projection):** `DEFINE TRANSIENT VIEW ENTITY <name> PROVIDER CONTRACT ANALYTICAL_QUERY AS PROJECTION ON <cube> { <element_list> }`
  - **Template B (KPI projection with filter):** like A but with `@Consumption.filter` parameters on key dimensions
  - **Template C (drilldown projection):** like A but with `@AnalyticsDetails.query.axis: #ROWS|#COLUMNS|#FREE` per element
- [ ] Step 5 — Validate the LLM's draft against the user's intent before writing. Show the draft, confirm dimensions / measures / filter dimensions
- [ ] Step 6 — Write: `SAPWrite(action="create", type="DDLS", name="<name>", package="<pkg>", source="<draft>")`. If the user has not specified `package`, default to `$TMP` and warn.
- [ ] Step 7 — Activate: `SAPActivate(name="<name>", type="DDLS")`. On activation errors, surface them verbatim and let the user re-prompt; do NOT auto-retry.
- [ ] Step 8 — Verify: `SAPRead(type="DDLS", name="<name>", include="elements")` to confirm the projection is live.
- [ ] Include a "Smart Defaults" table at the top: object type DDLS, default package $TMP, ask before transportable package, don't run ATC by default
- [ ] Include an "Edge cases" section: cube is inactive → stop; user wants to project on a non-cube → suggest the Star Schema Generator skill instead; LLM proposes `@Analytics.dataCategory: #DIMENSION` → reject (this is a query, not a dimension)
- [ ] Cross-link to `skills/generate-analytics-star-schema/SKILL.md` (the future skill from plan 3) — *"To build the underlying cube + dimensions first, use `generate-analytics-star-schema`."*
- [ ] Final verification: `cat skills/generate-cds-analytical-query/SKILL.md | head -5` shows the frontmatter; no `## Validation Commands` is needed in the skill itself

### Task 2: E2E test for the skill's read/write/activate path

**Files:**
- Create: `tests/e2e/cds-analytical-query.e2e.test.ts`
- Modify: `tests/e2e/fixtures.ts`
- Create: `tests/fixtures/abap/zi_analyticalcube_test.ddls.asabapdoc`

E2E coverage of the skill's underlying MCP tool flow. Skill content itself isn't unit-tested (it's prompt-engineering); the tool calls it makes are.

- [ ] Add a persistent fixture cube `ZI_ANALYTICALCUBE_TEST` to `PERSISTENT_OBJECTS` in `tests/e2e/fixtures.ts` with `@Analytics.dataCategory: #CUBE` and a couple of dimension associations + measures
- [ ] Create the ABAP/DDL source for the cube in `tests/fixtures/abap/zi_analyticalcube_test.ddls.asabapdoc` — minimal: `define view entity zi_analyticalcube_test ...` with `@Analytics.dataCategory: #CUBE`, one numeric measure, one foreign-key dim
- [ ] Run `npm run test:e2e:fixtures` to sync the fixture (it should create the cube against the test SAP system; rapAvailable check skips if RAP unsupported)
- [ ] Create `tests/e2e/cds-analytical-query.e2e.test.ts` following the `tests/e2e/rap-write.e2e.test.ts` pattern (transient objects with try/finally)
- [ ] Test: `SAPWrite create DDLS analytical query on ZI_ANALYTICALCUBE_TEST` — write a minimal `PROVIDER CONTRACT ANALYTICAL_QUERY` projection (`define transient view entity zq_aq_test_<uuid> provider contract analytical_query as projection on zi_analyticalcube_test { … }`), `SAPActivate` it, `SAPRead` it back, cleanup via `SAPWrite(action="delete")`
- [ ] Test: `SAPWrite create rejected when projection target is not a cube` — try to project on a non-cube; verify activation returns the expected SAP error and the test cleans up
- [ ] Both tests use `requireOrSkip(ctx, rapAvailable, 'RAP_NOT_AVAILABLE')` for skip-on-non-RAP systems
- [ ] Tag cleanup catches with `// best-effort-cleanup`
- [ ] Run `npm run test:e2e -- cds-analytical-query` — all tests pass

### Task 3: (Optional) Add analytical-query pre-write hint

**Files:**
- Modify: `src/lint/pre-write-hints.ts`
- Modify: `src/lint/lint.ts`
- Modify: `tests/unit/lint/pre-write-hints.test.ts`
- Modify: `tests/unit/lint/lint.test.ts`

Mirror the existing TABL `%admin draft include` hint. The new hint warns when a DDLS source declares `DEFINE TRANSIENT VIEW ENTITY ... AS PROJECTION ON <X>` without `@Analytics.query: true`, OR when the target `<X>` does not look like a cube (heuristic: name doesn't match `Z?I_*` or `*CUBE*`).

- [ ] Add `inspectAnalyticalQueryDdlsSource(source: string, name: string): LintResult[]` to `src/lint/pre-write-hints.ts`. Returns warnings (severity 'warning'), not errors — never block a write. Strip ABAP-style `--` and block comments before pattern-matching. Mixed case must be tolerated.
- [ ] Patterns to detect:
  - `/DEFINE\s+TRANSIENT\s+VIEW\s+ENTITY\s+\w+\s+(?:[\s\S]*?)AS\s+PROJECTION\s+ON\s+(\w+)/i` — captures the projection target
  - Look for `PROVIDER\s+CONTRACT\s+ANALYTICAL_QUERY` (any case)
  - Look for `@Analytics\s*\.\s*query\s*:\s*true` (any case)
  - If `PROVIDER CONTRACT ANALYTICAL_QUERY` present AND `@Analytics.query: true` absent → warn
  - If `PROVIDER CONTRACT ANALYTICAL_QUERY` present AND projection target doesn't match a cube-naming heuristic → softer warn (hint, not blocker)
- [ ] Wire into `validateBeforeWrite()` in `src/lint/lint.ts`, filename-gated by `.ddls.acds` / `.ddls.asabapdoc` extension. Follow the same pattern as the TABL hint.
- [ ] Add unit tests (~5 tests): positive case (has analytical_query + missing annotation → warning), negative case (no analytical_query keyword → no warning), comments are stripped, mixed-case detection works, target heuristic fires on non-cube name
- [ ] Add a `validateBeforeWrite` integration test that exercises the full pipeline (1 test)
- [ ] Run `npm test` — all tests pass

### Task 4: Documentation updates

**Files:**
- Modify: `README.md`
- Modify: `docs/index.md`
- Modify: `docs/roadmap.md` (if it exists; otherwise skip)
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`
- Modify: `skills/README.md` (the skills index)

- [ ] In `README.md`, add a row to the skills section announcing `generate-cds-analytical-query`
- [ ] In `docs/index.md`, mirror the README addition
- [ ] In `docs/compare/00-feature-matrix.md`, find the "CDS / Analytics" section (or create one) and add a row for "Analytical Query Generation" with ✅ ARC-1 (via skill) and the SAP roadmap GA date (BTP 2608)
- [ ] In `CLAUDE.md`, add a skill-related row to "Key Files for Common Tasks" pointing to the new skill: `| Add or update analytical-query generation logic | skills/generate-cds-analytical-query/SKILL.md`
- [ ] In `CLAUDE.md`, if a "Skills" or "Skills inventory" section exists, add the new skill to it
- [ ] Update `docs/compare/00-feature-matrix.md` "Last Updated" header to today's date
- [ ] If `docs/roadmap.md` exists, mark "CDS Analytical Query Generation parity" as completed and link to this plan + the research doc
- [ ] If a skill index `skills/README.md` exists, add the new skill
- [ ] Run `npm run lint` (Markdown formatting may be linted)

### Task 5: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Run E2E: `npm run test:e2e` — analytical query test passes (or skips with `RAP_NOT_AVAILABLE` on non-RAP test systems)
- [ ] Manually invoke the skill via Claude Code: `/generate-cds-analytical-query` on a fixture cube, verify the generated DDLS activates
- [ ] Move this plan to `docs/plans/completed/`
