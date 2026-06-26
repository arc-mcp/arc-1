# Add `SAPWrite generate_behavior_implementation` Action (PR-C)

## Overview

Add a new `SAPWrite(type="CLAS", action="generate_behavior_implementation")` action that produces a complete RAP behavior pool implementation in a single call — mirroring the user-flow of Eclipse ADT's "Generate Behavior Implementation" Cmd+1 quickfix without depending on the broken `/sap/bc/adt/quickfixes/proposals/.../create_class_implementation` server endpoint.

The action is a high-level orchestrator that composes three lower-level capabilities ARC-1 already has after PRs #253, #254, #255, #256, #257:

1. **Auto-discovery** — read class metadata, extract `rootEntityRef`, confirm the class is a behavior pool, locate the BDEF.
2. **Scaffolding** — reuse `applyRapHandlerScaffold` to auto-create `lhc_<alias>` skeletons, inject method signatures and empty stubs for every action / determination / validation / authorization the BDEF declares.
3. **Activation** — optionally trigger `SAPActivate` on the class with a guided diagnostic when activation fails because of the well-known "stale active CCDEF/CCIMP placeholder + new inactive content" coupling we observed during the SEGW→RAP demo runs.

Net effect for the migration skill: **Step 4 (mandatory ADT pause for pasting `lhc_*` skeletons) and the ADT-side Cmd+1 hand-off both disappear.** The skill becomes fully autonomous via ARC-1 except for the V4 routing-group registration (the only remaining manual step).

This PR does **not** fix the upstream `apply_quickfix` 500 — that endpoint still fails on a4h with "Dereferencing of the NULL reference" even with the corrected include URI. That is filed separately as a follow-up. PR-C reaches the same outcome via local generation, which is more reliable and more testable.

## Context

### Current State

- `scaffold_rap_handlers` (PR #257, `intent.ts:2967`) parses a BDEF and injects missing handler signatures + empty stubs into an existing class. **It already auto-creates `lhc_<alias>` skeletons** when missing.
- Caller must supply both `name` (class) **and** `bdefName` explicitly — there is no auto-discovery from class → BDEF.
- Caller must run `SAPActivate` separately afterwards.
- The existing `SAPDiagnose(action="apply_quickfix")` returns HTTP 500 from SAP regardless of payload shape (verified live on a4h after PR #253). It cannot be relied on for create_class_implementation today.
- The current `SAPDiagnose` handler also rejects empty-string `proposalUserContent` (`intent.ts:4139`, `if (!proposalUserContent)`) even though the schema marks it `optional()` and SAP's evaluation response returns `userContent: ""`. **Out of scope for PR-C** — file as separate fix.

### Target State

A single call produces a working behavior pool from an empty (or partially populated) one:

```bash
arc1-cli call SAPWrite --json '{
  "action": "generate_behavior_implementation",
  "type": "CLAS",
  "name": "ZBP_DM_PROJECT"
}'
```

Default behavior:

1. Read class metadata, confirm `category=behaviorPool`, extract BDEF reference from `<class:rootEntityRef adtcore:type="STOB/DO" adtcore:name="ZR_DM_PROJECT"/>`.
2. Cross-check: read class MAIN source → confirm `FOR BEHAVIOR OF zr_dm_project`. Read BDEF → confirm `managed implementation in class zbp_dm_project`. Mismatch → fail with a precise diagnostic.
3. Run `applyRapHandlerScaffold(autoApply=true)` for every entity in the BDEF, writing CCDEF + CCIMP under one stateful lock (the existing PR #257 path).
4. Run `SAPActivate` on the class (default `activate=true`).
5. Return a structured JSON report with: discovered BDEF, sections written, signatures inserted, stubs inserted, activation outcome (success / hint).

Caller can override discovery with explicit `bdefName`, skip activation with `activate=false`, restrict to one entity with `targetAlias` (the same parameter `scaffold_rap_handlers` already uses), and use `dryRun=true` to preview without writing.

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | Class metadata reader (`getClassMetadata` at line 168) — needs to also expose `rootEntityRef` |
| `src/adt/xml-parser.ts` | `parseClassMetadata` (line 982) — currently strips `rootEntityRef`; extend to return it |
| `src/adt/types.ts` | `ClassMetadata` type — add `rootEntityRef?: { name; type; uri }` |
| `src/adt/rap-handlers.ts` | `extractRapHandlerRequirements` (line 337), `findMissingRapHandlerRequirements` (line 721), `applyRapHandlerScaffold` (line 1010) — already supports all 5 RAP handler kinds, no changes needed |
| `src/adt/rap-generate.ts` | **NEW** — orchestrator that combines discovery + cross-validation + scaffold + activate |
| `src/handlers/intent.ts` | `handleSAPWrite` switch (line 2644+); `scaffold_rap_handlers` case at 2967 (the pattern to mirror); error message at 3430 (action enum) |
| `src/handlers/schemas.ts` | SAPWrite action enum at lines 329 and 377 (top-level + batch_create item); add `generate_behavior_implementation`; reuse the existing `bdefName` and `targetAlias` fields from scaffold; add new `activate?: boolean` and `dryRun?: boolean` |
| `src/handlers/tools.ts` | Action enum at line 519; descriptions at 158/172/521; reuse the existing `bdefName` (line 539), `targetAlias` (line 549), `autoApply` (line 544) descriptions and append the new action where relevant |
| `src/authz/policy.ts` | `ACTION_POLICY` map (line 48+) — add `'SAPWrite.generate_behavior_implementation': { scope: 'write', opType: OperationType.Update, featureGate: 'rap' }` mirroring the existing scaffold entry at line 59 |
| `src/cli.ts` | Sub-command shortcuts if any |
| `tests/unit/adt/rap-handlers.test.ts` | Existing scaffold tests — add cross-discovery tests in a new file |
| `tests/unit/adt/rap-generate.test.ts` | **NEW** — unit tests for the orchestrator (discovery + cross-validation + happy path + error paths) |
| `tests/unit/handlers/intent.test.ts` | Add a small set of routing tests for the new action |
| `tests/unit/handlers/schemas.test.ts` | Schema acceptance tests for the new action enum value + new params |
| `tests/unit/handlers/tools.test.ts` | Tool description regression tests |
| `tests/fixtures/xml/class-metadata-with-root-entity-ref.xml` | **NEW** — class metadata fixture with `rootEntityRef` for parser tests |
| `CLAUDE.md` | Key Files for Common Tasks table — add row for "Add high-level RAP orchestration action" |
| `docs/tools.md` | SAPWrite action table — add `generate_behavior_implementation` entry |
| `docs/roadmap.md` | Mark PR-C complete; add follow-up roadmap row for `apply_quickfix` 500 fix |
| `docs/compare/00-feature-matrix.md` | Add row "Generate Behavior Implementation (RAP one-shot)" — ARC-1 ✅, others ❌ |
| `/Users/marianzeis/DEV/arc-1-legacy-ui5-rap-conversion/skills/migrate-segw-to-rap.md` | Replace Step 4b ADT-paste pause; collapse Step 4 + Step 7 into a single `generate_behavior_implementation` call |
| `/Users/marianzeis/DEV/arc-1-legacy-ui5-rap-conversion/RUN-NOTES.md` | Add Run-4 entry referencing the new action |

### Design Principles

1. **Local generation, not server quickfix.** PR-C does not call `/sap/bc/adt/quickfixes/proposals/.../create_class_implementation` because that endpoint returns HTTP 500 on a4h regardless of payload shape (verified live during research). Local generation via `applyRapHandlerScaffold` is deterministic, testable, and already proven by PR #257.
2. **Auto-discover, but allow override.** Default is "give me a class name, figure out the rest". Power users can pass `bdefName` if discovery fails or for non-standard layouts.
3. **Cross-validate before mutating.** If `class.rootEntityRef` and `bdef.managed implementation in class …` disagree, fail with a precise message. Do not silently scaffold against a wrong BDEF.
4. **Activation is opt-out, not opt-in.** Default `activate=true`. The user-facing UX should be "I get a working class," not "I get source files I have to activate myself."
5. **Activation failure is a guided diagnostic, not a hard error.** When the well-known "stale active placeholder + new inactive handlers" coupling triggers a `Local classes of CL_ABAP_BEHAVIOR_HANDLER…` activation rejection, return the scaffold result with `activation: { success: false, hint: "<concrete next steps>" }` instead of throwing. The CCDEF/CCIMP source is still useful even if activation fails.
6. **Reuse, don't rewrite.** Composes existing helpers (`getClassMetadata`, `extractRapHandlerRequirements`, `applyRapHandlerScaffold`, `activateBatch`). New code is the orchestrator + cross-validation + diagnostics.
7. **No new ADT endpoints.** Everything uses paths already gated by `checkOperation`.
8. **Same safety category as `scaffold_rap_handlers`.** `OperationType.Update` (or whatever scaffold uses); inherits package allowlist + `allowWrites=true`.

## Development Approach

Build foundation (XML parser + types) before wiring (orchestrator). Build orchestrator with full unit-test mocking before wiring it to the intent handler. Wire intent + schemas + tools together (tightly coupled). Run live smoke against a4h `ZBP_DM_PROJECT` only after unit tests are green.

Tests follow the existing patterns in `tests/unit/adt/rap-handlers.test.ts` (which has comprehensive scaffold coverage). Mock the ADT HTTP layer with `vi.mock('undici', ...)` + `mockResponse()` from `tests/helpers/mock-fetch.ts`. Use realistic BDEF fixtures from `tests/fixtures/abap/` if any exist, else inline minimal BDEF strings.

Live smoke against `ZBP_DM_PROJECT` (which currently has a known activation blocker) is expected to exercise the activation-hint path. That is the desired test, not a failure.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

### Task 1: Extend `parseClassMetadata` to surface `rootEntityRef`

**Files:**
- Modify: `src/adt/types.ts`
- Modify: `src/adt/xml-parser.ts`
- Modify: `tests/unit/adt/xml-parser.test.ts`
- Create: `tests/fixtures/xml/class-metadata-with-root-entity-ref.xml`

The class metadata XML at `/sap/bc/adt/oo/classes/{name}` (Accept: `application/vnd.sap.adt.oo.classes.v4+xml`) returns a `<class:rootEntityRef adtcore:type="STOB/DO" adtcore:name="ZR_DM_PROJECT" adtcore:uri="..."/>` child element when the class is a RAP behavior pool. The current `parseClassMetadata` (xml-parser.ts:982) discards it. PR-C needs it as the primary BDEF discovery anchor.

- [ ] Add a `RootEntityRef` interface to `src/adt/types.ts`: `{ name: string; type: string; uri: string }` and add an optional `rootEntityRef?: RootEntityRef` field to the `ClassMetadata` interface.
- [ ] In `src/adt/xml-parser.ts`, extend `parseClassMetadata` (around line 982) to read `cls.rootEntityRef` (post-namespace-strip) and populate the new field when present. Use `getDeepArray`/`findDeepNodes` patterns already in the file. When absent, leave the field unset (don't emit empty objects).
- [ ] Create fixture `tests/fixtures/xml/class-metadata-with-root-entity-ref.xml` based on the live response captured during research (file:`docs/compare/eclipse-adt/api/01-rap-object-types-and-uris.md` if present, otherwise from `/Users/marianzeis/DEV/arc-1` live capture by hitting `/sap/bc/adt/oo/classes/zbp_dm_project` on a4h with Accept `application/vnd.sap.adt.oo.classes.v4+xml`). Trim to the relevant elements but keep both the namespace declarations and the `<class:rootEntityRef>` child intact.
- [ ] Add unit tests (~3 tests) in `tests/unit/adt/xml-parser.test.ts`:
  - `rootEntityRef` is parsed from XML when present
  - `rootEntityRef` is absent when the XML has no such element (regular class)
  - All existing `parseClassMetadata` fields still parse correctly with the new fixture (regression)
- [ ] Run `npm test -- tests/unit/adt/xml-parser.test.ts` — all pass
- [ ] Run `npm run typecheck` — no errors

### Task 2: Add the `generateBehaviorImplementation` orchestrator helper

**Files:**
- Create: `src/adt/rap-generate.ts`
- Create: `tests/unit/adt/rap-generate.test.ts`

Self-contained orchestrator that does the cross-validation, scaffold planning, and result assembly. Keeps `intent.ts` thin. Pure functions where possible — only the ADT calls happen via `AdtClient`.

The function takes an `AdtClient`, a class name, and options `{ bdefName?, entityAlias?, dryRun?, activate? }`. It returns a typed result `RapGenerateResult` covering: discovered BDEF, validation diagnostics, scaffold plan and changed sections, activation outcome.

- [ ] Create `src/adt/rap-generate.ts` exporting:
  - `RapGenerateOptions` type with `bdefName?: string`, `targetAlias?: string` (matches scaffold naming exactly), `dryRun?: boolean`, `activate?: boolean` (defaults: `dryRun=false`, `activate=true`).
  - `RapGenerateResult` type with `discovery: { className, bdefName, source: 'rootEntityRef' | 'explicit' }`, `validation: { mainHasForBehaviorOf: boolean, bdefBindsClass: boolean, mismatchReason?: string }`, `scaffoldChanged: boolean`, `inserted: { signatures: number, stubs: number, autoCreatedSkeletons: number }`, `activation?: { success: boolean, hint?: string, errors?: string[] }`, `dryRun: boolean`.
  - `async function generateBehaviorImplementation(client: AdtClient, className: string, options?: RapGenerateOptions): Promise<RapGenerateResult>`.
- [ ] Discovery flow:
  - Call `client.getClassMetadata(className)` → confirm `category === 'behaviorPool'`. If not, throw `AdtSafetyError` with message: `"<className> is not a behavior pool (class:category=<actual>); cannot generate handler implementation"`.
  - If `options.bdefName` given, use it (`source: 'explicit'`). Else read `metadata.rootEntityRef.name`. If neither present, throw with hint to pass `bdefName` explicitly.
- [ ] Cross-validation flow:
  - Read all class sections via `client.getClassStructured(className)` → `{ main, definitions, implementations, macros, testclasses }`. Apply `/for\s+behavior\s+of\s+(\w+)/i` to MAIN to extract the BDEF name from source.
  - Read BDEF source via `client.getBdef(bdefName)`. Use `/managed\s+implementation\s+in\s+class\s+(\w+)\s+unique/i` to extract the bound class.
  - Populate `validation.mainHasForBehaviorOf` and `validation.bdefBindsClass`. If both succeed and cross-reference correctly, OK. If either fails or names don't match, collect a `mismatchReason` string.
  - If `mismatchReason` is set and `dryRun=false`, throw `AdtSafetyError` to refuse mutation. In dry-run mode, return the report so caller can inspect and decide.
- [ ] Scaffold flow:
  - Call existing `extractRapHandlerRequirements(bdefSource)` → list of required methods. Apply `targetAlias` filter if provided (matches scaffold's existing case-insensitive filter at intent.ts:3022).
  - Build `RapHandlerSourceSections { main, definitions, implementations }` from the structured class read above.
  - Call `applyRapHandlerScaffold(sections, requirements)` — the same function `scaffold_rap_handlers` calls (rap-handlers.ts:1010). It returns `RapHandlerScaffoldPlan` with auto-created `lhc_<alias>` skeletons + injected signatures + injected stubs across the changed sections.
  - In `dryRun` mode, return the plan but skip writes. Otherwise mirror the exact write pattern used in `intent.ts` immediately after the scaffold case (search for "single class lock" comment around line 3120) — one `withStatefulSession` covering lock → multi-include PUT → unlock for every changed section.
- [ ] Activation flow (only when `activate=true && dryRun=false && scaffoldChanged`):
  - Call existing `activateBatch(...)` for `[{ type: 'CLAS', name: className }]`.
  - On success → `activation: { success: true }`.
  - On failure with the well-known `Local classes of CL_ABAP_BEHAVIOR_HANDLER` error, return `activation: { success: false, errors: [...], hint: "Active CCDEF/CCIMP for this class are still SAP-placeholder comments while the inactive copies have new behavior handlers. RAP rejects the inactive→active transition. Either activate via Eclipse 'Generate Behavior Implementation' wizard, or delete the class via SAPManage(action='delete', type='CLAS') and rerun generate_behavior_implementation against a freshly created class. See docs/plans/completed/2026-05-10-add-generate-behavior-implementation.md." }`. Do not throw — return the partial result.
  - Other activation errors → propagate (rethrow).
- [ ] Add unit tests (~12 tests) in `tests/unit/adt/rap-generate.test.ts`:
  - happy path with `rootEntityRef` discovery, default activate=true
  - explicit `bdefName` override
  - rejects when class is not a behavior pool (`category !== 'behaviorPool'`)
  - rejects when no `rootEntityRef` and no explicit `bdefName`
  - cross-validation: MAIN missing `FOR BEHAVIOR OF` → diagnostic
  - cross-validation: BDEF doesn't bind this class → diagnostic
  - dryRun returns plan without write
  - `targetAlias` filter restricts scaffold to one entity
  - scaffold-only path when `activate=false`
  - activation success path
  - activation `Local classes of CL_ABAP_BEHAVIOR_HANDLER` failure → returns hint, no throw
  - activation generic failure → rethrows
- [ ] Run `npm test -- tests/unit/adt/rap-generate.test.ts` — all pass
- [ ] Run `npm run typecheck` — no errors

### Task 3: Wire the new action into `handleSAPWrite`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/authz/policy.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`
- Modify: `tests/unit/authz/policy.test.ts`

Plumb the new orchestrator as a SAPWrite action, mirroring the `scaffold_rap_handlers` registration.

- [ ] In `src/handlers/schemas.ts`, add `'generate_behavior_implementation'` to BOTH action enums (top-level around line 329 and batch_create item around line 377). Add new optional fields: `activate: z.boolean().optional()`, `dryRun: z.boolean().optional()`. Verify `bdefName` and `targetAlias` are already on the schema (they are, from scaffold).
- [ ] In `src/handlers/tools.ts`, add `'generate_behavior_implementation'` to the `enum` at line 519. Append a description sentence to the action enum description (line 521) and the `bdefName` (line 539), `autoApply` (line 544), and `targetAlias` (line 549) descriptions to mention the new action where relevant. Update the per-action description constants at lines 158/172. Add new property descriptions for `activate` and `dryRun`.
- [ ] In `src/authz/policy.ts`, add `'SAPWrite.generate_behavior_implementation': { scope: 'write', opType: OperationType.Update, featureGate: 'rap' }` to `ACTION_POLICY`, mirroring the scaffold entry at line 59.
- [ ] In `src/handlers/intent.ts`:
  - Add an import for `generateBehaviorImplementation` from `../adt/rap-generate.js`.
  - In `handleSAPWrite` after the `scaffold_rap_handlers` case (around line 3187), add a new `case 'generate_behavior_implementation':` block. Reuse the same `checkPackage` / `enforcePackageForExistingObject` / `checkRapAvailable` pattern from the scaffold case. Read parameters: `name` (required), `bdefName` (optional), `targetAlias` (optional), `activate` (default true), `dryRun` (default false). Call `generateBehaviorImplementation(client, name, { bdefName, targetAlias, activate, dryRun })`. Return `textResult(JSON.stringify(result, null, 2))`.
  - Update the unknown-action error message at line 3430 to include `generate_behavior_implementation`.
- [ ] Add unit tests (~7 tests):
  - `tests/unit/handlers/schemas.test.ts`: schema accepts `action="generate_behavior_implementation"` with required + optional fields; rejects unknown action; rejects when `dryRun` or `activate` is non-boolean.
  - `tests/unit/handlers/tools.test.ts`: action enum contains the new value; descriptions reference it.
  - `tests/unit/handlers/intent.test.ts`: routing test that mocks the orchestrator and confirms parameters flow through correctly; package-allowlist enforcement (mirror the existing scaffold test pattern); unknown-action error message updated.
  - `tests/unit/authz/policy.test.ts`: scope `write` permits the action, `read` does not, RAP feature-gate is enforced (mirror the scaffold tests).
- [ ] Run `npm test` — all pass
- [ ] Run `npm run typecheck` — no errors
- [ ] Run `npm run lint` — no errors

### Task 4: Live smoke test against A4H

**Files:**
- Modify: `tests/integration/adt.integration.test.ts` (append integration test)
- Modify: `docs/plans/completed/2026-05-10-add-generate-behavior-implementation.md` (record live result inline as evidence in this file)

Run the new action against the A4H test system to verify end-to-end. Per `INFRASTRUCTURE.md`, A4H is `http://a4h.marianzeis.de:50000`, user `MARIAN`, client `001`. ZBP_DM_PROJECT is an existing behavior pool with a known activation blocker that exercises the activation-hint path.

- [ ] Write a sequential live integration test that:
  - Calls `generateBehaviorImplementation` against `ZBP_DM_PROJECT` with `dryRun=true, activate=false`. Expect: discovery returns `bdefName=ZR_DM_PROJECT`, scaffold plan reports 0 missing (already populated from prior runs), no writes attempted, no activation attempted.
  - Calls again with `dryRun=false, activate=true`. Expect: discovery + cross-validation OK, scaffold reports `scaffoldChanged=false` (already populated), activation either succeeds OR returns `activation: { success: false, hint: <string> }` matching the documented `Local classes of CL_ABAP_BEHAVIOR_HANDLER` recovery message. Both outcomes are valid assertions for this fixture.
  - Use `requireOrSkip(ctx, process.env.TEST_SAP_URL, SkipReason.MissingCredentials)` from `tests/helpers/skip-policy.ts`. Never `if (!url) return;`.
- [ ] Run `npm run test:integration -- -t generate_behavior_implementation` — passes against A4H.
- [ ] Append a "Live verification (A4H, <date>)" subsection to this plan file recording the JSON result (with class name / BDEF / outcome) so reviewers see real evidence.

### Task 5: CLAUDE.md, internal docs, and feature matrix

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `README.md` (if a feature highlights section exists)

Bring all primary docs into sync with the new capability. The autonomous executor must not skip this — `CLAUDE.md` drives every future agent-led PR's research phase and stale entries cause real downstream confusion (we hit this during the PR-A/B/E/F wave).

- [ ] In `CLAUDE.md` "Key Files for Common Tasks" table, add a new row near the existing `scaffold_rap_handlers` row: `| Add high-level RAP behavior implementation orchestration (generate_behavior_implementation) | src/adt/rap-generate.ts, src/handlers/intent.ts (case 'generate_behavior_implementation'), src/handlers/tools.ts, src/handlers/schemas.ts, src/authz/policy.ts, tests/unit/adt/rap-generate.test.ts |`.
- [ ] In `CLAUDE.md` codebase structure tree (the `src/` tree), add `rap-generate.ts` under `src/adt/` with a one-line description: `# RAP behavior pool one-shot orchestrator (discover BDEF + scaffold + activate)`.
- [ ] In `docs/tools.md`, add a `generate_behavior_implementation` row to the SAPWrite action table with a one-sentence description, parameter list (`name`, optional `bdefName`/`entityAlias`/`activate`/`dryRun`), and a small JSON example.
- [ ] In `docs/roadmap.md`, mark the existing PR-C / "high-level Generate Behavior Implementation" entry as `✅ Completed in <PR number>`. Add a new follow-up entry: `apply_quickfix HTTP 500 on create_class_implementation — needs upstream debug or alternate body format; see docs/plans/completed/2026-05-10-add-generate-behavior-implementation.md "Out of scope" section`.
- [ ] In `docs/compare/00-feature-matrix.md`, refresh the "_Last updated_" line and add a new row in the most relevant section. The current matrix has 9 competitor columns: `vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli`. Add: `| Generate Behavior Implementation (RAP one-shot) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |` — VERIFY actual column count by reading the header row before inserting.
- [ ] In `README.md`, if the feature-highlights section explicitly lists RAP capabilities, add a single bullet referencing the new action. If no such section exists, skip.
- [ ] Run `npm test` — docs-changes-only commit, but rerun to confirm nothing else regressed
- [ ] Run `npm run lint` — Biome checks markdown formatting too

### Task 6: Update the migration skill in arc-1-legacy-ui5-rap-conversion

**Files:**
- Modify: `/Users/marianzeis/DEV/arc-1-legacy-ui5-rap-conversion/skills/migrate-segw-to-rap.md`
- Modify: `/Users/marianzeis/DEV/arc-1-legacy-ui5-rap-conversion/RUN-NOTES.md`

The skill is the consumer that drove this whole PR. It currently documents an ADT-side hand-off that this PR eliminates. Failing to update the skill leaves the demo using stale instructions.

- [ ] In `skills/migrate-segw-to-rap.md`, **delete the entire Step 4b "MANDATORY ADT pause" section** — locate it by searching for `Step 4b — MANDATORY ADT pause`, then delete from that header through the matching `--- end of Step 4b ---` boundary or the start of the next Step 4c / Step 5 section. Don't trust hardcoded line numbers; the file may have shifted since the plan was written. Step 4 should collapse to: write empty global class via SAPWrite (4a), call new action (4b), verify (4c). The new 4b is one SAPWrite call:

```
> Print to the user, then continue:
"Now generating the behavior implementation. This produces lhc_<alias> CCDEF + CCIMP
 for every action / authorization / validation / determination declared in the BDEF,
 then activates the class. About 10–15 seconds."

SAPWrite(
  action="generate_behavior_implementation",
  type="CLAS",
  name="ZBP_DM_PROJECT"
)
```

- [ ] Update Step 7 (around line 924) — `scaffold_rap_handlers` is still the lower-level API but the recommended path is now `generate_behavior_implementation` for net-new behavior pools. Add a one-line note: "Prefer `generate_behavior_implementation` for one-shot RAP setup; use `scaffold_rap_handlers` for surgical re-runs against an existing populated class."
- [ ] Update line 535 (Phase 5 design plan template) — drop "with empty lhc_<alias> skeletons pre-created" and replace with "(generate_behavior_implementation will create + populate)".
- [ ] Update the error-handling table at the bottom (around line 1212): drop the obsolete "ARC-1 capability gap" row about `SAPWrite include=` writes (PR #257 fixed it). Keep the V4 routing-group manual step entry — that's still pending.
- [ ] Update line 40 lint-preset workaround entry: `SAP_LINT_BEFORE_WRITE=false` → `SAP_ABAP_RELEASE=758` (PR #255 added the override). Re-enable lint.
- [ ] In `RUN-NOTES.md`, append a new `## Run 4 — <date>` section header with placeholder bullets for: skill bugs found, ARC-1 PR candidates, what worked. The actual run results will be filled when the user re-runs the demo end-to-end against the merged code.
- [ ] No tests for skill/notes changes; just confirm files are valid markdown by visually scanning the diff and running `npm run lint`.

### Task 7: Final verification

**Files:**
- Modify: `docs/plans/completed/2026-05-10-add-generate-behavior-implementation.md` (move to completed)

End-to-end gate. Every previous task ran isolated; this task verifies the whole thing hangs together.

- [ ] Run full unit suite: `npm test` — all 1300+ tests pass, including new ones.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Run build: `npm run build` — `dist/` is produced.
- [ ] Run integration smoke tagged at the new action: `npm run test:integration -- -t generate_behavior_implementation` — passes against A4H.
- [ ] Restart the locally-installed `arc1-cli` from the freshly built `dist/` and run the live smoke from the CLI: `cd /Users/marianzeis/DEV/arc-1 && node dist/cli.js call SAPWrite --json '{"action":"generate_behavior_implementation","type":"CLAS","name":"ZBP_DM_PROJECT","dryRun":true}'`. Expect a JSON report with discovered BDEF and scaffold plan; record output in this file.
- [ ] Move this plan to `docs/plans/completed/2026-05-10-add-generate-behavior-implementation.md`.
- [ ] Confirm CLAUDE.md, docs/tools.md, docs/roadmap.md, docs/compare/00-feature-matrix.md were all updated (Task 5 should have done it).
- [ ] Confirm migration skill was updated (Task 6).
- [ ] Run `git status` — only intended files changed.
- [ ] Run `git diff --stat` — sanity check the LOC numbers (~600–900 net additions across new orchestrator + tests + docs).
