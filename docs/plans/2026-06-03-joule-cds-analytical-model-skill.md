# Joule Roadmap Features 3 & 4 — CDS Analytical Model Generation (skill)

> **Status (2026-06-03): Skill IMPLEMENTED + live-verified.** `skills/generate-analytics-star-schema/SKILL.md` is written and its tool sequence was verified end-to-end against live A4H (S/4HANA 2023, SAP_BASIS 758) via `arc1-cli`: a dimension view (`@Analytics.dataCategory: #DIMENSION`) + a cube (`@Analytics.dataCategory: #CUBE`, `@Aggregation.default: #SUM`, `[1..1]` foreign-key association) were created in one `SAPWrite(action=batch_create, activateAtEnd=true)` call and activated as a single batch — the cube→dimension cross-reference resolved in one pass. Built on `/dmo/flight` + `/dmo/carrier`. Cleaned up after. **Remaining (optional/deferred):** Task 3 (analytical AFF schema variant), Task 2 (E2E test file), Task 4 (doc updates).

## Overview

SAP's Joule for Developers 2026 roadmap announces "CDS Analytical Model Generation Powered by AI" in two scopes — *Basic* (S/4HANA Cloud Private 2027): cube + existing dimensions from a RAP business object. *Extended* (BTP ABAP 2608 / S/4HANA Cloud Public 2608 / Private 2027): also generates *new* dimensions and accepts DDIC tables as input.

The AI-enhanced wizard outputs (1) one cube view with `@Analytics.dataCategory: #CUBE` + measures; (2) N dimension views with `@Analytics.dataCategory: #DIMENSION`; (3) text views with `#TEXT`; (4) foreign-key associations linking the three. For RAP-BO input, field semantics (amount/currency/quantity/unit) are inferred from the BO. For DDIC input the LLM relies on data-element semantics.

ARC-1's prerequisite plumbing is already in place: `SAPWrite(batch_create, activateAtEnd: true)` (PR 270) was effectively pre-emptive infrastructure for exactly this multi-object scaffold — the activator resolves cross-references in one terminal pass. RAP BO root entity discovery exists via `parseClassMetadata` in `src/adt/xml-parser.ts` (consumed by `src/adt/rap-generate.ts:200`). DDIC table read works via `SAPRead(type=TABL)`.

This plan adds the skill `generate-analytics-star-schema` and an optional analytical-DDLS AFF schema variant. No ARC-1 source code change is required — only the skill is mandatory.

See [`docs/research/2026-06-03-joule-2026-roadmap-feature-assessment.md §3-4`](../research/2026-06-03-joule-2026-roadmap-feature-assessment.md) for the full feature assessment.

## Context

### Current State

- `SAPWrite(batch_create, activateAtEnd: true)` is shipped (PR 270) — see CLAUDE.md row "Add SAPWrite batch_create `activateAtEnd`"
- RAP BO root entity is parsed via `<class:rootEntityRef>` in class metadata, captured in `src/adt/xml-parser.ts` `parseClassMetadata()`, consumed in `src/adt/rap-generate.ts:200`
- `SAPRead(type=TABL)` exists for DDIC tables and structures (`getTabl()` in `src/adt/client.ts:450`)
- AFF DDLS schema `src/aff/schemas/ddls-v1.json` validates a freeform DDLS envelope
- No skill in `skills/` orchestrates cube + dimensions + texts as one analytical model

### Target State

- New skill `skills/generate-analytics-star-schema/SKILL.md` orchestrates:
  1. Discover input: RAP BO via class metadata, OR DDIC table via `SAPRead`
  2. Read candidate dimensions via `SAPSearch(tadir_lookup, source='adt')` filtered to the BO/table's package + parents
  3. LLM composes cube DDLS + N dimension DDLS + N text DDLS using templates the skill ships
  4. `SAPWrite(batch_create, activateAtEnd: true)` for the full set — one terminal activate
- Optional: AFF schema variant `src/aff/schemas/ddls-analytical-v1.json` enforces analytical-specific annotations (`@Analytics.dataCategory`, `@Semantics.amount.currencyCode`, `@ObjectModel.dataCategory`); registered in `src/aff/validator.ts` `TYPE_MAP` at line 10
- E2E test covers the cube + 1 dimension + 1 text batch create on a fixture DDIC table
- README, roadmap, feature matrix, CLAUDE.md updated

### Key Files

| File | Role |
|------|------|
| `skills/generate-analytics-star-schema/SKILL.md` | New: the skill content |
| `skills/generate-cds-analytical-query/SKILL.md` | Reference: sibling skill for the *query* layer on top of the cube |
| `skills/generate-rap-service-researched/SKILL.md` | Reference: research-first orchestration pattern |
| `src/aff/schemas/ddls-analytical-v1.json` | (Optional) Analytical DDLS schema variant |
| `src/aff/validator.ts` | (Optional) Register the new schema in `TYPE_MAP` (line 10) |
| `tests/unit/aff/validator.test.ts` | (Optional) Unit tests for the new schema |
| `tests/e2e/cds-analytics-model.e2e.test.ts` | New: E2E test for the skill's batch_create path |
| `tests/e2e/fixtures.ts` | Add a DDIC source-table fixture for the model generation |
| `README.md`, `docs/index.md`, `docs/roadmap.md`, `docs/compare/00-feature-matrix.md`, `CLAUDE.md` | Documentation updates |

### Design Principles

1. **Skill-first.** ARC-1 has all primitives; this is a template + few-shot authoring task. The AFF schema variant is opt-in polish.
2. **Use `batch_create + activateAtEnd: true`.** Per-object inline activation can't resolve cross-references between cube↔dimension↔text. Deferred terminal activation is the *only* mechanism that works for multi-object analytical models.
3. **Two input modes.** RAP BO (discover root entity from `<class:rootEntityRef>`) and DDIC table (`SAPRead(type=TABL)`). The skill must support both — extended-scope feature requires DDIC.
4. **Field-semantics inference is the LLM's job.** ARC-1 supplies metadata; the LLM uses data-element semantics + annotations to decide `@Semantics.amount.currencyCode` etc. Don't try to encode this in TS code.
5. **Cross-link to the analytical-query skill.** The analytical model produces a cube; the analytical query skill projects on it. These are siblings.

## Development Approach

- Task 1: Skill authoring (the deliverable)
- Task 2: E2E test
- Task 3: (Optional) AFF schema variant
- Task 4: Documentation
- Task 5: Final verification

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:e2e`

### Task 1: Author the `generate-analytics-star-schema` skill

**Files:**
- Create: `skills/generate-analytics-star-schema/SKILL.md`

The core deliverable. Self-contained skill that drives the standard read/batch_write/activate loop with analytical-model-specific templates.

- [ ] Create `skills/generate-analytics-star-schema/` directory
- [ ] Write `SKILL.md` with frontmatter: `name: generate-analytics-star-schema`, `description: Generate a CDS analytical model (cube + dimensions + text views) on top of a RAP business object or DDIC table. Use when the user asks to "create a star schema", "generate analytical cube + dimensions", or "make a RAP BO analytical".`
- [ ] Smart Defaults table at the top: input type auto-detected; default package = source object's package (or $TMP if not transportable); ATC = no; batch + terminal activation = always.
- [ ] Step 1 — Resolve input:
  - If user names a RAP BO (e.g. `ZBP_R_TRAVEL`): read class metadata via `SAPRead(type=CLAS, name=<class>)`, extract `rootEntityRef` (the bound CDS root view)
  - If user names a DDIC table (e.g. `ZTRAVEL`): `SAPRead(type=TABL, name=<table>)`, capture the field list
  - Reject ambiguity by asking
- [ ] Step 2 — Discover candidate dimensions:
  - `SAPSearch(searchType='tadir_lookup', source='adt', objectType='DDLS', namePattern='ZI_*_DIM')` (and `*_TEXT`)
  - Filter to the BO/table's package + parent packages
  - Present the candidate list; user can confirm subset or add new dimensions
- [ ] Step 3 — Look up canonical analytical-model semantics: `mcp-sap-docs search` for `@Analytics.dataCategory: #CUBE`, `@Analytics.dataCategory: #DIMENSION`, `@Analytics.dataCategory: #FACT|#AGGREGATIONLEVEL`, `@Semantics.amount.currencyCode`, `@Semantics.quantity.unitOfMeasure`. Cite doc IDs in the skill output.
- [ ] Step 4 — LLM composes the model. Skill ships templates:
  - **Cube template** — `@Analytics.dataCategory: #CUBE` + `@AccessControl.authorizationCheck: #NOT_REQUIRED` (for $TMP) + measures (numeric fields → `@Aggregation.default: #SUM`) + dimension associations + currency/unit annotations
  - **Dimension template** — `@Analytics.dataCategory: #DIMENSION` + key field + text association
  - **Text template** — `@Analytics.dataCategory: #TEXT` + language field + text field
- [ ] Step 5 — Show the LLM's plan to the user as a tree:
  ```
  Cube: ZI_TRAVEL_CUBE on ZBP_R_TRAVEL
    Measures: BookingFee, TotalPrice
    Dimensions:
      ZI_CUSTOMER_DIM (new) → ZI_CUSTOMER_TEXT
      ZI_AGENCY_DIM (existing) → ZI_AGENCY_TEXT
  ```
  Confirm before writing.
- [ ] Step 6 — Write via `SAPWrite(action='batch_create', activateAtEnd: true, objects: [cube, ...dimensions, ...texts])`. If `activateAtEnd` is not honored on this system (older release), fall back to per-object create + a single final activate over all created URIs.
- [ ] Step 7 — Verify with `SAPRead(type='DDLS', name='<cube>', include='elements')` to confirm associations and measures are live
- [ ] Step 8 — Cross-link: *"To create an analytical query (projection view) on top of this cube, invoke `generate-cds-analytical-query` with the cube name."*
- [ ] Edge cases: package allowlist blocks the target package → suggest a $TMP draft first; SAP_BASIS < 7.58 may reject some annotations → check `SAPManage(action='features')` first; cube already exists → ask user to rename or update
- [ ] Verify: `cat skills/generate-analytics-star-schema/SKILL.md | head -10` shows the frontmatter

### Task 2: E2E test for the batch_create + activateAtEnd path

**Files:**
- Create: `tests/e2e/cds-analytics-model.e2e.test.ts`
- Modify: `tests/e2e/fixtures.ts`
- Create: `tests/fixtures/abap/ztravel_source.tabl.json` + `.tabl.xml` for the source table

Exercise the underlying tool calls (the skill itself is prompt-engineering; the tool path is testable).

- [ ] Add `ZTRAVEL_SOURCE_TEST` table fixture to `PERSISTENT_OBJECTS` in `tests/e2e/fixtures.ts` (minimal: client, id, agency, currency, amount fields)
- [ ] Create the table fixture XML in `tests/fixtures/abap/` so `npm run test:e2e:fixtures` can sync it
- [ ] Create `tests/e2e/cds-analytics-model.e2e.test.ts` following the `tests/e2e/rap-write.e2e.test.ts` pattern (transient objects with try/finally cleanup)
- [ ] Test: `SAPWrite batch_create cube + dimension + text on ZTRAVEL_SOURCE_TEST with activateAtEnd: true` — verify all three are created and active; verify cross-references resolved (the dimension association in the cube points to a real dimension view); cleanup via batch delete
- [ ] Test: `batch_create without activateAtEnd fails or returns partial results when cross-references are present` — verify the contrast (this documents *why* activateAtEnd matters)
- [ ] Use `requireOrSkip(ctx, rapAvailable, 'RAP_NOT_AVAILABLE')` for skip gating
- [ ] Tag cleanup catches with `// best-effort-cleanup`
- [ ] Run `npm run test:e2e -- cds-analytics-model` — all tests pass or skip with valid reason

### Task 3: (Optional) Add analytical-DDLS AFF schema variant

**Files:**
- Create: `src/aff/schemas/ddls-analytical-v1.json`
- Modify: `src/aff/validator.ts`
- Modify: `tests/unit/aff/validator.test.ts`

Strictly opt-in polish. Worth doing if the skill produces too many round-trips on annotation errors. The schema enforces the analytical-specific annotation surface so failures are caught client-side.

- [ ] Create `src/aff/schemas/ddls-analytical-v1.json` modeled on `src/aff/schemas/ddls-v1.json`. Required annotations: `@Analytics.dataCategory` (enum: CUBE | DIMENSION | TEXT | FACT | AGGREGATIONLEVEL), plus optional `@Semantics.amount.currencyCode`, `@ObjectModel.dataCategory`
- [ ] In `src/aff/validator.ts`, add a `TABL_ANALYTICAL` or `DDLS_ANALYTICAL` row to `TYPE_MAP` at line 10. `getAffSchema()` (line 28) will resolve it via the map — no new function needed.
- [ ] Note: this is a SECOND variant for DDLS; the existing `ddls-v1.json` stays as the default. Activation order: callers opting into the analytical schema pass `type='DDLS_ANALYTICAL'`. Document the opt-in in `docs/tools.md`.
- [ ] Add unit tests (~3 tests) to `tests/unit/aff/validator.test.ts`: valid cube envelope, missing `@Analytics.dataCategory` rejected, wrong enum value rejected
- [ ] Run `npm test` — all tests pass

### Task 4: Documentation updates

**Files:**
- Modify: `README.md`, `docs/index.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`
- Modify: `docs/roadmap.md` (if exists)
- Modify: `skills/README.md` (if exists)

- [ ] Add the skill to the README/skills index with a one-liner: *"Generate CDS analytical model (cube + dimensions + texts) on top of a RAP BO or DDIC table"*
- [ ] In `docs/compare/00-feature-matrix.md`, add or update an Analytics row: ARC-1 ✅ (via skill); SAP roadmap GA window noted
- [ ] In `CLAUDE.md`, add to "Key Files for Common Tasks": `| Add or update analytical model generation logic | skills/generate-analytics-star-schema/SKILL.md (+ optional src/aff/schemas/ddls-analytical-v1.json) |`
- [ ] Update `docs/compare/00-feature-matrix.md` "Last Updated" header
- [ ] If `docs/roadmap.md` exists, mark "CDS Analytical Model Generation parity" completed and link to this plan + the research doc
- [ ] Cross-link the new skill from `skills/generate-cds-analytical-query/SKILL.md` if it exists (the sibling)
- [ ] Run `npm run lint` — Markdown formatting passes

### Task 5: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Run E2E: `npm run test:e2e -- cds-analytics-model` — passes or skips with valid reason
- [ ] Manually invoke the skill via Claude Code: `/generate-analytics-star-schema` on a RAP BO and on a DDIC table; verify both flows end-to-end
- [ ] Move this plan to `docs/plans/completed/`
