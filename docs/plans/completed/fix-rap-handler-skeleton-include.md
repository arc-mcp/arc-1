# Fix RAP Handler Skeleton Writing The Wrong Include

## Overview

`SAPWrite(action="generate_behavior_implementation")` (PR #260) and `SAPWrite(action="scaffold_rap_handlers")` write the local handler class **DEFINITION** block (`CLASS lhc_<alias> DEFINITION INHERITING FROM cl_abap_behavior_handler. ... ENDCLASS.`) to the wrong include. They put it in **CCDEF** (`/sap/bc/adt/oo/classes/<X>/includes/definitions`), but per ABAP keyword docs and SAP's own demo class, the entire DEFINITION + IMPLEMENTATION pair belongs in **CCIMP** (`/sap/bc/adt/oo/classes/<X>/includes/implementations`). SAP rejects activation with: *`Local classes of "CL_ABAP_BEHAVIOR_HANDLER" can only be derived in the "Local Definitions/Implementations" of a global BEHAVIOR class`*. The phrase in quotes is the literal name of the CCIMP include.

The bug is in `ensureRapHandlerSkeletons` in `src/adt/rap-handlers.ts`. The fix is to route both block types into `sections.implementations` and never modify `sections.definitions`. Existing unit tests at `tests/unit/adt/rap-handlers.test.ts` lines 251–329 and `tests/unit/adt/rap-generate.test.ts` codify the buggy split — they need rewriting to the canonical layout. PR #260's "live A4H smoke" used `dryRun=true, activate=false` so it never exercised activation; this plan adds an integration test that activates a freshly-scaffolded class against a live SAP system.

arc-1 is pre-1.0, so breaking changes are acceptable. Classes previously scaffolded by an earlier arc-1 version carry the wrong CCDEF/CCIMP split and will fail to activate; users delete and recreate them to pick up the canonical layout. No in-code detection or auto-migration ships — keeping the fix minimal.

## Context

### Current State

- `src/adt/rap-handlers.ts` `ensureRapHandlerSkeletons` (around lines 1003–1023 in origin/main `87833d91`) appends `definitionBlocks` (which contain `CLASS lhc_<alias> DEFINITION INHERITING FROM cl_abap_behavior_handler. ... ENDCLASS.`) to `sections.definitions` and `implementationBlocks` to `sections.implementations`.
- The `RapHandlerSkeletonResult` type exposes `createdDefinitions: string[]` and `createdImplementations: string[]` plus a `changed` map keyed by ADT include name.
- `applyRapHandlerScaffold` at `src/adt/rap-handlers.ts` calls `ensureRapHandlerSkeletons` first, then `applySignaturesAcrossSections` (which searches `main → definitions → implementations` for the lhc_X DEFINITION). Because skeletons land in CCDEF today, signatures land in CCDEF too. Implementation stubs land in CCIMP because `parseClassImplementationRanges` finds the lhc_X IMPLEMENTATION block there.
- `src/adt/rap-generate.ts` `generateBehaviorImplementation` (PR #260) writes `scaffoldPlan.sections.definitions` to `/source/definitions` and `scaffoldPlan.sections.implementations` to `/source/implementations` under one stateful lock. Optional `activate` step calls `activateBatch`. Activation rejection on the well-known stale-active coupling sets `activation.success=false` with a hint and does not throw.
- Existing unit tests at `tests/unit/adt/rap-handlers.test.ts` lines 251–329 (`describe('ensureRapHandlerSkeletons')`) assert the buggy split — e.g. `expect(result.sections.definitions).toContain('CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.')`.
- Existing unit tests at `tests/unit/adt/rap-generate.test.ts` (around lines 350–400) seed mock state with `state.structuredResponse.definitions = 'CLASS lhc_project DEFINITION INHERITING FROM cl_abap_behavior_handler.\n...'` to mirror the buggy production behavior.
- No integration test in `tests/integration/adt.integration.test.ts` exercises `generate_behavior_implementation` with `activate=true` against a live SAP system. PR #260's smoke was `dryRun=true, activate=false`.

### Target State

- `ensureRapHandlerSkeletons` writes **both** DEFINITION and IMPLEMENTATION skeleton blocks to `sections.implementations` (CCIMP) with the DEFINITION block first and the IMPLEMENTATION block second, mirroring SAP demo class `BP_DEMO_RAP_STRICT`. `sections.definitions` is never modified by this function.
- `RapHandlerSkeletonResult.createdDefinitions` and `createdImplementations` continue to track which classes had each kind of block created (kept for telemetry and downstream callers); a new `changed.implementations` is `true` whenever either array is non-empty; `changed.definitions` is always `false`.
- `applyRapHandlerScaffold` continues to delegate to `ensureRapHandlerSkeletons` first, then signature insertion, then stub insertion. Because the lhc_X DEFINITION now lives in CCIMP, the signature-insertion fallthrough (main → definitions → implementations) finds it in the third section and writes signatures + stubs there. CCDEF remains the SAP-generated placeholder.
- `generate_behavior_implementation` writes only `/source/implementations` (and possibly `/source/main` if MAIN was edited, which is not the typical case). When the existing CCDEF already contains a class derived from `cl_abap_behavior_handler` — i.e. a class previously scaffolded with the buggy version of arc-1 — the orchestrator throws `AdtSafetyError` with a message that names the recovery: delete + recreate the class via `SAPManage(action="delete", type="CLAS")` followed by `SAPWrite(action="create", type="CLAS")` and re-run.
- A new integration test creates a scratch behavior pool on the a4h S/4HANA 2023 test system (ABAP 7.58), runs `generate_behavior_implementation` with `activate=true`, asserts active CCDEF contains only the SAP placeholder comment, asserts active CCIMP contains both `CLASS lhc_<alias> DEFINITION` and `CLASS lhc_<alias> IMPLEMENTATION`, asserts the class is active (no warnings about missing handlers), and cleans up via `SAPManage(action="delete")`.
- A new test fixture (`tests/fixtures/abap/bp-demo-rap-strict-ccimp.abap`) captures the canonical layout from SAP demo class `BP_DEMO_RAP_STRICT` for use as a reference baseline in unit tests.

### Key Files

| File | Role |
|------|------|
| `src/adt/rap-handlers.ts` | Bug location: `ensureRapHandlerSkeletons` writes DEFINITION block to CCDEF instead of CCIMP. Also exports the result type whose semantics shift. |
| `src/adt/rap-generate.ts` | Composer: calls `applyRapHandlerScaffold` and writes to ADT include URLs. Needs the new "broken legacy state" detection guard. |
| `tests/unit/adt/rap-handlers.test.ts` | 5 existing tests at lines 251–329 (`describe('ensureRapHandlerSkeletons')`) assert the buggy split. Plus the `applyRapHandlerScaffold` tests around line 501. All need rewriting to the canonical layout. |
| `tests/unit/adt/rap-generate.test.ts` | Existing test mocks at lines 350+ seed `definitions` with `CLASS lhc_project DEFINITION`. Need updating, plus a new mock that asserts the orchestrator routes writes to CCIMP only. |
| `tests/integration/adt.integration.test.ts` | New integration test target: scratch class create + `generate_behavior_implementation` with `activate=true` + assert layout matches BP_DEMO_RAP_STRICT + cleanup. |
| `tests/fixtures/abap/bp-demo-rap-strict-ccimp.abap` | New: canonical-layout reference captured from SAP demo class on a4h. Imported by both unit tests and the integration assertion. |
| `CLAUDE.md` | Has a row for `generate_behavior_implementation` at line 206 that needs a "writes both DEFINITION + IMPLEMENTATION to CCIMP per SAP demo BP_DEMO_RAP_STRICT" note. Plus the row for `scaffold_rap_handlers` at line 205. |
| `docs_page/tools.md` | Tool reference for `generate_behavior_implementation` and `scaffold_rap_handlers` may have layout notes worth refreshing. |
| `docs_page/roadmap.md` | Add an entry recording this bug fix and noting that the talk-demo unblocker now works end-to-end. |
| `compare/00-feature-matrix.md` | Refresh the row for `EditSource (surgical)` / `RAP scaffold` to reflect verified end-to-end activation; bump "Last Updated". |

### Design Principles

1. **Match SAP's own canonical layout.** SAP demo class `BP_DEMO_RAP_STRICT` (package `SABAPDEMOS`) is the ground truth: CCDEF holds only the SAP-generated placeholder comment; CCIMP holds the entire handler class (DEFINITION block followed by IMPLEMENTATION block).
2. **Keep the public type contract.** `RapHandlerSkeletonResult.createdDefinitions` and `createdImplementations` continue to enumerate which classes had each block kind created, even though both blocks now land in the same include. Renaming the fields would break downstream callers and telemetry. Add a JSDoc clarification that the names refer to block KIND, not file location.
3. **Breaking change is acceptable (pre-1.0).** Classes previously scaffolded by an earlier arc-1 version carry the wrong CCDEF/CCIMP split. They will fail to activate. The user-facing path is to delete + recreate the class — no in-code detection, no auto-migration. Pre-1.0 status lets us keep the fix minimal and the code clean.
4. **Test the activation, not just the scaffold.** PR #260's smoke was `dryRun=true, activate=false` and missed this bug entirely. The new integration test must call `generate_behavior_implementation` with `activate=true` against a real SAP system and read back the active versions of CCDEF + CCIMP via `SAPRead include=... version=active` to assert layout.
5. **Eclipse ADT contract evidence.** Per `pr-review-guide.md`, ADT-related changes need cross-evidence from the active Eclipse install. The relevant bundles are `com.sap.adt.cds.behaviordefinition_3.56.0` (BDEF subtypes) and `com.sap.adt.codecomposer.cmpttyp.ui_3.56.1` (code composer templates that back Eclipse's "Generate Behavior Implementation" wizard). Reference doc: `~/DEV/arc-1-eclipse-adt/api/03-rap-wizards-object-generator-code-composer.md`. The PR description must include an "ADT Contract Check" section per the guide's template.
6. **Live SAP verification on a4h is mandatory.** Unit tests can be fooled by mocked responses (PR #260 was). The fix is verified only when a fresh class scaffolded against a4h activates without the `CL_ABAP_BEHAVIOR_HANDLER` error and the active includes match the BP_DEMO_RAP_STRICT shape.
7. **NPL 7.50 is out of scope for verification.** RAP is not available on the NPL test system at that release. Cross-release coverage for this fix is a4h only.

## Development Approach

Tasks are ordered to minimize cross-task churn: fixture first (used by all subsequent tests), then the source change with its unit-test rewrite, then the orchestrator's broken-state detection, then the live-system integration test, then docs. Each task is independently runnable in a fresh Claude Code session; tasks 2–6 each include their own `npm test` checkbox to catch regressions early.

The fix itself is small (~10 lines in `ensureRapHandlerSkeletons`). The bulk of the work is rewriting tests that codified the bug and adding the live-activation safety net.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration -- -t "generate_behavior_implementation"` (requires `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD`)

### Task 1: Capture canonical handler-class layout fixture

**Files:**
- Create: `tests/fixtures/abap/bp-demo-rap-strict-ccimp.abap`
- Create: `tests/fixtures/abap/bp-demo-rap-strict-ccdef.abap`

The SAP demo class `BP_DEMO_RAP_STRICT` (package `SABAPDEMOS`) is the authoritative reference layout: CCDEF holds only the SAP placeholder; CCIMP holds the full DEFINITION + IMPLEMENTATION pair. Capturing it as a fixture lets every later test assert against the canonical shape rather than against an inline string literal that drifts.

- [ ] Create `tests/fixtures/abap/bp-demo-rap-strict-ccdef.abap` with the exact content of `BP_DEMO_RAP_STRICT`'s `/source/definitions` (just the three-line `*"*` placeholder comment block, with `\r\n` line endings to match SAP).
- [ ] Create `tests/fixtures/abap/bp-demo-rap-strict-ccimp.abap` with the exact content of `BP_DEMO_RAP_STRICT`'s `/source/implementations`. The content has the form:
  ```
  CLASS lhc_DEMO_RAP_STRICT DEFINITION INHERITING FROM cl_abap_behavior_handler.
    PRIVATE SECTION.
      METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
        IMPORTING REQUEST requested_authorizations FOR demo_rap_strict RESULT result.
  ENDCLASS.

  CLASS lhc_DEMO_RAP_STRICT IMPLEMENTATION.
    METHOD get_global_authorizations.
    ENDMETHOD.
  ENDCLASS.
  ```
  (Pull the exact content from a4h via `SAPRead(type="CLAS", name="BP_DEMO_RAP_STRICT", include="implementations")` to match line endings.)
- [ ] Add a one-line README pointer at the top of each fixture (as a leading `*"*` comment) noting the source class and the date captured.
- [ ] Run `npm test` — should still pass (no production code touched yet).

### Task 2: Fix `ensureRapHandlerSkeletons` to route both blocks to CCIMP

**Files:**
- Modify: `src/adt/rap-handlers.ts`
- Modify: `tests/unit/adt/rap-handlers.test.ts`

This is the core fix. Both DEFINITION and IMPLEMENTATION skeleton blocks must land in `sections.implementations` (CCIMP); `sections.definitions` (CCDEF) must never be modified by this function. Order in CCIMP matters: DEFINITION block first, then IMPLEMENTATION block, mirroring SAP demo class `BP_DEMO_RAP_STRICT` and the activator's expectation.

- [ ] In `src/adt/rap-handlers.ts`, locate `ensureRapHandlerSkeletons` (around line 1003 in origin/main `87833d91`). Update its return value:
  - `sections.definitions` is returned unchanged: `definitions: sections.definitions`.
  - `sections.implementations` receives both blocks in order: first the DEFINITION block(s), then the IMPLEMENTATION block(s). Build a single `combinedBlocks` array preserving per-class pairing (`[def_lhc_a, impl_lhc_a, def_lhc_b, impl_lhc_b, ...]`), then `appendBlocksToSection(sections.implementations, combinedBlocks)`.
  - `changed.definitions` is always `false`.
  - `changed.implementations` is `createdDefinitions.length > 0 || createdImplementations.length > 0`.
- [ ] Update the JSDoc on `RapHandlerSkeletonResult` (lines ~123–129): clarify that `createdDefinitions` and `createdImplementations` enumerate the *block kinds* created (for telemetry), not file locations — both kinds always land in CCIMP. Cite ABAP doc `ABENABP_HANDLER_CLASS_GLOSRY` and SAP demo `BP_DEMO_RAP_STRICT`.
- [ ] Update the JSDoc on `ensureRapHandlerSkeletons` itself: explicit "writes only to CCIMP; CCDEF is never modified" contract sentence.
- [ ] Rewrite the `describe('ensureRapHandlerSkeletons')` block in `tests/unit/adt/rap-handlers.test.ts` (lines ~251–329):
  - "creates missing definition and implementation skeletons in empty includes" — assert `result.sections.definitions === '*"* local definitions placeholder'` (UNCHANGED), and `result.sections.implementations` contains BOTH `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.` and `CLASS lhc_travel IMPLEMENTATION.`. Order matters: definition substring index < implementation substring index.
  - "creates only the missing implementation when the handler definition already exists" — when CCIMP already has DEFINITION, only create the IMPLEMENTATION block, all in CCIMP; CCDEF stays untouched.
  - "creates only the missing definition when the handler implementation already exists" — when CCIMP already has IMPLEMENTATION, prepend the DEFINITION block in CCIMP; CCDEF stays untouched.
  - "creates one skeleton pair per BDEF alias without duplicates" — both `lhc_travel` and `lhc_segment` blocks land in CCIMP; CCDEF stays at placeholder.
  - "is idempotent when rerun on its own generated sections" — second run must produce zero new blocks.
- [ ] Add one new test: "appends to BP_DEMO_RAP_STRICT canonical layout" — read both fixture files from Task 1, run `ensureRapHandlerSkeletons` on a fresh class with empty CCDEF + empty CCIMP, then assert the resulting CCIMP contains a substring sequence matching the fixture's structure (DEFINITION block, ENDCLASS., blank line, IMPLEMENTATION block, ENDCLASS.). This is the regression test.
- [ ] Run `npm test -- tests/unit/adt/rap-handlers.test.ts` — all skeleton tests pass.
- [ ] Run `npm test` — full suite passes.

### Task 3: Update `applyRapHandlerScaffold` end-to-end test

**Files:**
- Modify: `tests/unit/adt/rap-handlers.test.ts`

`applyRapHandlerScaffold` chains skeleton + signature + stub insertion. With Task 2's fix, the lhc_X DEFINITION now lives in CCIMP, so the existing fallthrough (main → definitions → implementations) finds it in the third section and inserts signatures + stubs there too. Existing test at line ~501 needs updating to assert the new layout end-to-end.

- [ ] Find the test "creates missing handler skeletons before inserting signatures and stubs" (line ~501) and update its assertions:
  - `plan.skeletons.createdDefinitions` and `createdImplementations` still equal `['lhc_travel']` (kind tracking unchanged).
  - `plan.sections.definitions` equals the input (unchanged — should still be the placeholder string passed in).
  - `plan.sections.implementations` contains the full sequence: `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.` → `PRIVATE SECTION.` → at least one `METHODS ... FOR ACTION ...` line → `ENDCLASS.` → `CLASS lhc_travel IMPLEMENTATION.` → at least one `METHOD ... ENDMETHOD.` stub → `ENDCLASS.`.
  - `plan.changedSections` equals `['implementations']` (not `['definitions', 'implementations']`).
  - `plan.signatures.implementations.changed === true`; `plan.signatures.definitions?.changed` is either undefined or false.
- [ ] Add a new test "scaffold against fully empty includes matches BP_DEMO_RAP_STRICT shape" — start from blank CCDEF + blank CCIMP + a BDEF that requires a single `get_global_authorizations` handler, run `applyRapHandlerScaffold`, and assert `plan.sections.definitions === ''` and `plan.sections.implementations` contains the canonical block-pair structure.
- [ ] Run `npm test -- tests/unit/adt/rap-handlers.test.ts` — passes.

### Task 4: Update `rap-generate.test.ts` for new layout + add activation-success path

**Files:**
- Modify: `tests/unit/adt/rap-generate.test.ts`

The orchestrator tests at lines ~350–400 seed mock `structuredResponse.definitions` with `CLASS lhc_project DEFINITION ...` to mirror the production buggy layout. After Task 2's fix, mocks should mirror the canonical layout (CCDEF empty/placeholder, CCIMP holds both blocks). Plus add an explicit "activation succeeds" assertion that PR #260 missed.

- [ ] Find the mock seed at lines ~350–390 (`state.structuredResponse.definitions = 'CLASS lhc_project DEFINITION ...'`) and rewrite to: `state.structuredResponse.definitions = PLACEHOLDER_DEFINITIONS` (use the existing constant at line ~35); `state.structuredResponse.implementations` holds the lhc_project DEFINITION + IMPLEMENTATION pair.
- [ ] Add a test "writes scaffold to CCIMP only when scaffolding from empty includes":
  - Mock the class metadata (`category: 'behaviorPool'`, `rootEntityRef: { name: 'ZR_DM_PROJECT' }`).
  - Mock the BDEF source with one entity + one action + instance authorization.
  - Mock structured response with both `definitions` and `implementations` at SAP placeholder strings.
  - Mock `lockObject`, `updateSource`, `unlockObject`, `activateBatch` calls.
  - Run `generateBehaviorImplementation(client, 'ZBP_TEST', { activate: true })`.
  - Assert `updateSource` was called for `/source/implementations` with content containing both DEFINITION and IMPLEMENTATION blocks.
  - Assert `updateSource` was NOT called for `/source/definitions` (CCDEF stays untouched).
  - Assert `activation.success === true`.
- [ ] Add a test "rejects scaffolding when CCDEF already contains a handler class (legacy broken state)":
  - Mock structured response with `definitions = 'CLASS lhc_project DEFINITION INHERITING FROM cl_abap_behavior_handler. ... ENDCLASS.'` (legacy broken layout).
  - Mock the rest of the call chain.
  - Run `generateBehaviorImplementation(client, 'ZBP_TEST')` and assert it throws `AdtSafetyError` whose message contains the recovery instructions ("delete and recreate the class via SAPManage…SAPWrite").
- [ ] Run `npm test -- tests/unit/adt/rap-generate.test.ts` — passes.

### Task 5: ~~Detect legacy broken state in the orchestrator~~ — dropped

Originally proposed detection + guard in the orchestrator that throws on classes still carrying the legacy CCDEF layout from earlier arc-1 versions. Dropped during implementation: pre-1.0 status accepts the breaking change. Users with legacy-broken classes delete + recreate. The fix code stays minimal — `ensureRapHandlerSkeletons` writes to CCIMP only, and that's the entire mutation change.

### Task 6: Add live-activation integration test

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

PR #260 shipped without an integration test that activates the scaffolded class. This task adds one. Per `tests/helpers/skip-policy.ts`, the test must use `requireOrSkip` to fail-soft when `TEST_SAP_URL` is not set, and per `docs/testing-skip-policy.md` it must use `try/finally` for cleanup. The test exercises the full path: create scratch class → scaffold → activate → read active includes → assert layout → delete.

- [ ] Add a new `describe('generate_behavior_implementation activation', ...)` block in `tests/integration/adt.integration.test.ts`:
  - Setup: `const ctx = setupIntegrationTest();` and `const client = await getTestClient();`.
  - Use `generateUniqueName('ZBP_TEST_RAP')` for the scratch class name and `generateUniqueName('ZR_TEST_RAP')` for a temporary BDEF name.
  - Create a minimal BDEF source: `unmanaged implementation in class <className> unique;\nstrict ( 2 );\n\ndefine behavior for <bdefRoot> alias TestRoot\n  authorization master ( global )\n{\n  read;\n}` against an existing active CDS root view (use a SAP-shipped one or create a scratch one).
  - **Simpler approach:** scaffold against `BP_DEMO_RAP_STRICT`-shaped requirements via a hand-built `RapHandlerRequirement[]`, skipping the BDEF read. Pass `bdefName` as an explicit option — but `generate_behavior_implementation` requires the BDEF to exist for cross-validation, so the BDEF must be real.
  - **Recommended approach:** pre-create a tiny CDS view + BDEF as test fixtures (added to `tests/e2e/fixtures.ts` if E2E or generated inline if integration), then use those.
  - Test body:
    1. Create the empty global class via direct ADT call (`createObject` + lock+update if needed).
    2. Run `generateBehaviorImplementation(client, scratchClassName, { activate: true })`.
    3. Assert `result.activation?.success === true` and no `hint` set.
    4. Read active CCDEF: `await client.getClass(scratchClassName, 'definitions')` with `version=active`. Assert it contains only the `*"*` placeholder comment and does not contain `CLASS lhc_` or `cl_abap_behavior_handler`.
    5. Read active CCIMP: `await client.getClass(scratchClassName, 'implementations')` with `version=active`. Assert it contains both `CLASS lhc_<alias> DEFINITION INHERITING FROM cl_abap_behavior_handler.` and `CLASS lhc_<alias> IMPLEMENTATION.`.
    6. `try/finally` cleanup: delete the scratch class + BDEF + CDS view.
- [ ] Test name: `it('activates a scaffolded behavior pool with CCIMP-only handler layout')`.
- [ ] Tag the test as `// best-effort-cleanup` on cleanup catches per the test quality rules.
- [ ] Use `requireOrSkip(ctx, process.env.TEST_SAP_URL, 'TEST_SAP_URL not set')` at the top of the test.
- [ ] Run `npm run test:integration -- -t "activates a scaffolded behavior pool"` against a4h to verify it passes.
- [ ] Run `npm test` (unit suite) — must still pass.

### Task 7: Update CLAUDE.md, docs, roadmap, feature matrix

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs_page/tools.md`
- Modify: `docs_page/roadmap.md`
- Modify: `compare/00-feature-matrix.md`

The CLAUDE.md row for `generate_behavior_implementation` already references `src/adt/rap-generate.ts` but doesn't mention the CCIMP-only contract. Same for the `scaffold_rap_handlers` row. Tool reference + roadmap + feature matrix should reflect the verified end-to-end activation.

- [ ] Update CLAUDE.md row at line 205 ("Add RAP behavior handler scaffolding logic"): append "Skeleton blocks (DEFINITION + IMPLEMENTATION) are written to CCIMP only per SAP demo BP_DEMO_RAP_STRICT and ABAP doc ABENABP_HANDLER_CLASS_GLOSRY; CCDEF stays at the SAP-generated placeholder."
- [ ] Update CLAUDE.md row at line 206 (`generate_behavior_implementation`): append same clarification + a note that legacy broken classes (DEFINITION in CCDEF) are detected and rejected with a delete+recreate recovery message.
- [ ] Update `docs_page/tools.md` description for `SAPWrite action=generate_behavior_implementation` and `action=scaffold_rap_handlers` to reflect the CCIMP-only layout. Add a small "What gets written where" table.
- [ ] Update `docs_page/roadmap.md`: add an entry under the most recent section describing the bug + fix + verification on a4h. If there's a "Known Limitations" section that references RAP handler activation, mark it resolved.
- [ ] Update `compare/00-feature-matrix.md`: find the row for `EditSource (surgical)` or RAP scaffold; refresh status to reflect verified end-to-end activation. Bump the "Last Updated" date.
- [ ] Run `npm test` — should still pass (docs only, no test impact unless docs are referenced by snapshot tests).

### Task 8: Final verification + PR description

**Files:**
- (none modified — final checks + PR prep)

Per `pr-review-guide.md` definition-of-done: ARC-1 contract mapped to Eclipse evidence, endpoint/method/media/body documented, safety classification explicit, tests cover success + relevant errors, RAP impact considered, evidence added/referenced.

- [ ] Run full unit suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Run integration test against a4h: `npm run test:integration -- -t "generate_behavior_implementation activation"` — passes (requires `TEST_SAP_URL` env vars; skip soft if unavailable).
- [ ] Live verify against the user's broken `ZBP_DM_PROJECT` on a4h: run `generate_behavior_implementation` with the legacy detection. Should throw `AdtSafetyError` with the recovery instructions (no source mutation).
- [ ] Live verify against a fresh scratch class on a4h: run `generate_behavior_implementation` with `activate: true`. Should produce active class with CCDEF placeholder + CCIMP holding both blocks. (Reuse the integration test's flow.)
- [ ] Build the PR description per `pr-review-guide.md` template at lines 347–377:
  - **ARC-1 area:** `src/adt/rap-handlers.ts`, `src/adt/rap-generate.ts`
  - **Endpoint(s):** `/sap/bc/adt/oo/classes/<X>/includes/{definitions,implementations}` (PUT)
  - **Eclipse ADT evidence:** `com.sap.adt.cds.behaviordefinition_3.56.0`, `com.sap.adt.codecomposer.cmpttyp.ui_3.56.1`. Reference: `~/DEV/arc-1-eclipse-adt/api/03-rap-wizards-object-generator-code-composer.md`. ABAP doc evidence: `ABENABP_HANDLER_CLASS_GLOSRY`, `ABENABP_CL_ABAP_BEH_HANDLER`. Live SAP evidence: `BP_DEMO_RAP_STRICT` (package `SABAPDEMOS` on a4h S/4HANA 2023 ABAP 7.58).
  - **Contract notes:** Method PUT, query params `lockHandle` + `corrNr`, body `text/plain`, content-type `text/plain;charset=utf-8`, accept `text/plain`, response empty. Safety: `Update` (existing).
  - **Impact on RAP creation:** **High** — unblocks `generate_behavior_implementation` end-to-end for the talk demo and any downstream consumer.
  - **Tests added/updated:** Unit (~5 rewrites + 4 new), Integration (1 new test against a4h).
  - **Residual risk:** Legacy classes scaffolded by buggy arc-1 versions will fail with the new detection guard rather than auto-migrating; the error message names the recovery (delete + recreate). Documented as expected behavior.
- [ ] Commit with conventional-commit prefix `fix(rap): write handler skeletons to CCIMP, not CCDEF` and a body summarizing the bug + evidence + tests added.
- [ ] Move this plan to `docs/plans/completed/`.
