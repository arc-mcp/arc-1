# Joule Roadmap Feature 2 — Clean-Core ATC Batch Quickfix

> **Status (2026-06-03): APPROACH SUPERSEDED — do not implement as written.** Live investigation on A4H revealed (1) ARC-1's `runAtcCheck` never bound a check variant, so ATC returned zero findings on every system — fixed in **PR #336** (the real, verifiable prerequisite this plan assumed already worked); (2) the native `/sap/bc/adt/atc/autoqf/worklist` endpoint is **not** the simple request/response this plan assumed — it's a `step=`-parameterized multi-stage protocol (4 content types, no template links, no reference implementation); and (3) the A4H trial produces **zero quickfix-bearing findings** and zero quickfix proposals, so the auto-apply half is **unverifiable** there. See **`docs/research/2026-06-03-atc-quickfix-surface-a4h.md`** (PR #337) for the full live surface map. A faithful build needs a system with the Clean-Core remediation/cloudification content (BTP ABAP / S/4HANA Cloud / readiness-configured on-prem). Kept for historical context; the design below (wrap `autoqf/worklist`) is inaccurate.

## Overview

SAP's Joule for Developers 2026 roadmap announces "Semi-Automated Fixes of Clean Core related ATC Findings" — Joule chat reads an ATC finding (typically a Clean-Core rule), proposes a code transformation, and applies it via the ADT quickfix machinery. Planned release: S/4HANA Cloud Private 2027 *only*.

ARC-1 already implements per-finding quickfix end-to-end (`SAPDiagnose action='quickfix' / 'apply_quickfix'` wrapping `/sap/bc/adt/quickfixes/evaluation`, verified live on a4h 2026-04-14, see `docs/plans/completed/2026-04-14-fix-proposals-auto-fix-from-atc.md`). The remaining gap is the **batch auto-quickfix worklist** endpoint `/sap/bc/adt/atc/autoqf/worklist` (backed by ABAP class `CL_SATC_ADT_RES_AUTOQUICKFIX`). It enumerates findings tagged `<atcfinding:quickfixes automatic="true"/>` and applies them in one server-side pass — exactly what the Joule "fix every Clean-Core finding on this package" workflow needs.

`adt-ls` cannot help here: its `atc/runCheck` returns findings (`AtcRunFinding`) but exposes **no quickfix data** — report-only. So this remains ARC-1 territory, regardless of how SAP's official MCP server evolves. This plan adds the batch-quickfix wrapper, then polishes the existing `sap-clean-core-atc` and `migrate-custom-code` skills to use it when finding counts exceed a threshold.

See [`docs/research/2026-06-03-joule-2026-roadmap-feature-assessment.md §2`](../research/2026-06-03-joule-2026-roadmap-feature-assessment.md) for the full feature assessment.

## Context

### Current State

- `runAtcCheck()` exists at `src/adt/devtools.ts:551` — wraps `/sap/bc/adt/atc/runs` and returns `AtcFinding[]`
- `getFixProposals()` exists at `src/adt/devtools.ts:593` — POSTs `/sap/bc/adt/quickfixes/evaluation`, returns proposal evaluations with `<userContent>` blocks
- `applyFixProposal()` exists at `src/adt/devtools.ts:621` — POSTs the proposal URI with `<quickfixes:proposalRequest>` body, returns ranged delta replacements
- `SAPDiagnose action='quickfix'` and `action='apply_quickfix'` are dispatched in `handleSAPDiagnose` at `src/handlers/intent.ts:5564` and `:5586`
- `SAPDiagnoseSchema` at `src/handlers/schemas.ts:672` is the Zod schema source of truth
- ATC findings already carry `<atcfinding:quickfixes manual="..." automatic="..." pseudo="..."/>` markers identifying which are machine-applicable
- No wrapper for `/sap/bc/adt/atc/autoqf/worklist` — the batch endpoint isn't reachable from ARC-1 today
- Skills `skills/sap-clean-core-atc/SKILL.md` and `skills/migrate-custom-code/SKILL.md` use one-by-one apply

### Target State

- New `runAutoQuickfixWorklist(http, safety, opts)` in `src/adt/devtools.ts` wrapping `/sap/bc/adt/atc/autoqf/worklist`
- New `SAPDiagnose action='batch_quickfix'` in `handleSAPDiagnose` — args `{ atcRunId, packageScope?, maxFindings? }`
- Three-file schema sync: Zod (`schemas.ts`), JSON Schema (`tools.ts`), handler (`intent.ts`)
- `ACTION_POLICY` updated in `src/authz/policy.ts` — required scope `'write'`
- XML parser for the `<autoqf:worklistResult>` response in `src/adt/xml-parser.ts`
- Skills updated: when `automatic="true"` finding count > 5 (threshold), call `batch_quickfix`; otherwise fall back to one-by-one `apply_quickfix`
- Documentation updated: tools.md, CLAUDE.md "Key Files" + ACTION_POLICY references, README, feature matrix
- Unit tests (mock-fetch) + an opt-in integration test gated on a Clean-Core ATC variant being published on the test system

### Key Files

| File | Role |
|------|------|
| `src/adt/devtools.ts` | Add `runAutoQuickfixWorklist()` near `getFixProposals()` (line 593) |
| `src/adt/types.ts` | Add `AutoQuickfixWorklistResult` + `AutoQuickfixSkip` types |
| `src/adt/xml-parser.ts` | Add `parseAutoQuickfixWorklist()` for the `<autoqf:worklistResult>` response |
| `src/handlers/intent.ts` | Add `case 'batch_quickfix'` in `handleSAPDiagnose` (after the existing `apply_quickfix` case ~line 5586) |
| `src/handlers/schemas.ts` | Add `'batch_quickfix'` to `SAPDiagnoseSchema` action union (line 672) |
| `src/handlers/tools.ts` | Add `batch_quickfix` to SAPDiagnose JSON Schema action enum + per-action property descriptors |
| `src/authz/policy.ts` | Add `'SAPDiagnose.batch_quickfix': 'write'` |
| `tests/unit/adt/devtools.test.ts` | Mock-fetch tests for `runAutoQuickfixWorklist()` |
| `tests/unit/adt/xml-parser.test.ts` | Unit tests for `parseAutoQuickfixWorklist()` |
| `tests/unit/handlers/intent.test.ts` | Tests for the new SAPDiagnose action |
| `tests/integration/adt.integration.test.ts` | Optional integration test (gated) |
| `tests/fixtures/xml/autoqf-worklist-result.xml` | New XML fixture |
| `skills/sap-clean-core-atc/SKILL.md` | Update to use batch_quickfix when count > threshold |
| `skills/migrate-custom-code/SKILL.md` | Same update |
| `docs/tools.md`, `CLAUDE.md`, `README.md`, `docs/compare/00-feature-matrix.md` | Documentation updates |

### Design Principles

1. **Mirror the existing quickfix pair.** `runAutoQuickfixWorklist()` follows `getFixProposals()` / `applyFixProposal()` exactly: same safety guard (`checkOperation(safety, OperationType.Update, 'BatchQuickfix')`), same XML parsing pattern, same error formatting.
2. **Three-file schema sync is mandatory.** Per CLAUDE.md invariant: every new property in `tools.ts`, `schemas.ts`, and `intent.ts`.
3. **Authz policy must be updated atomically with the handler.** Without `ACTION_POLICY` entry, the runtime check + tool-list pruning go out of sync.
4. **XML root element TBD against a4h.** Capture from a real call; the placeholder name in this plan is `<autoqf:worklistResult>` but verify on first integration run.
5. **Idempotent + reportable.** The handler returns `{ applied, skipped, remaining }` so the LLM can decide whether to re-run.
6. **No silent skipping in tests.** Use `requireOrSkip(ctx, ..., 'NO_CLEAN_CORE_VARIANT')` for integration test guards; never empty `if (!x) return;`.

## Development Approach

- Task 1: Core wrapper + types
- Task 2: XML parser + fixture
- Task 3: Handler dispatch + schema sync + authz policy
- Task 4: Unit tests
- Task 5: Integration test (gated)
- Task 6: Skill updates
- Task 7: Documentation
- Task 8: Final verification

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration` (requires TEST_SAP_URL)

### Task 1: Add `runAutoQuickfixWorklist()` to devtools

**Files:**
- Modify: `src/adt/devtools.ts`
- Modify: `src/adt/types.ts`

Add the core wrapper for `/sap/bc/adt/atc/autoqf/worklist` near the existing `getFixProposals()` at line 593.

- [ ] In `src/adt/types.ts`, add:
  - `interface AutoQuickfixSkip { findingId: string; reason: string }`
  - `interface AutoQuickfixWorklistResult { applied: number; skipped: AutoQuickfixSkip[]; remaining: number; transports: string[] }`
- [ ] In `src/adt/devtools.ts`, add `runAutoQuickfixWorklist(http, safety, opts: { atcRunId: string; packageScope?: string; maxFindings?: number }): Promise<AutoQuickfixWorklistResult>` near line 593. Pattern:
  - Call `checkOperation(safety, OperationType.Update, 'BatchQuickfix')` first
  - POST to `/sap/bc/adt/atc/autoqf/worklist` with body `<autoqf:worklistRequest xmlns:autoqf="http://www.sap.com/adt/atc/autoqf"><autoqf:atcRunId>{atcRunId}</autoqf:atcRunId><autoqf:scope>{packageScope or '*'}</autoqf:scope><autoqf:maxFindings>{maxFindings or 100}</autoqf:maxFindings></autoqf:worklistRequest>`
  - Content-Type `application/vnd.sap.adt.atc.autoqf+xml; charset=UTF-8`
  - Accept `application/vnd.sap.adt.atc.autoqf+xml; charset=UTF-8`
  - Pass response body to `parseAutoQuickfixWorklist()` (added in Task 2)
  - Return the parsed result
- [ ] If a 404 comes back, throw a typed error explaining the endpoint isn't available on this SAP system (NW 7.50 / older releases). Match existing patterns in `src/adt/errors.ts`.
- [ ] Run `npm run typecheck` — no errors
- [ ] Run `npm test` — all tests pass (no new tests yet, but existing ones must still pass)

### Task 2: XML parser + fixture

**Files:**
- Modify: `src/adt/xml-parser.ts`
- Create: `tests/fixtures/xml/autoqf-worklist-result.xml`
- Modify: `tests/unit/adt/xml-parser.test.ts`

Parse the `<autoqf:worklistResult>` response. The exact root element name + attribute shape must be verified against a4h on the first integration run; this task ships a best-guess shape that can be adjusted.

- [ ] In `src/adt/xml-parser.ts`, add `parseAutoQuickfixWorklist(xml: string): AutoQuickfixWorklistResult`. Use the `fast-xml-parser` v5 pattern existing parsers use.
- [ ] Expected XML shape (best-guess; verify on first live call):
  ```xml
  <autoqf:worklistResult xmlns:autoqf="http://www.sap.com/adt/atc/autoqf">
    <autoqf:summary applied="12" skipped="3" remaining="0"/>
    <autoqf:skipped>
      <autoqf:skip findingId="..." reason="manual_only"/>
    </autoqf:skipped>
    <autoqf:transports>
      <autoqf:transport>NPLK900042</autoqf:transport>
    </autoqf:transports>
  </autoqf:worklistResult>
  ```
- [ ] Create `tests/fixtures/xml/autoqf-worklist-result.xml` matching the above (placeholder — real captured response replaces this on first integration run; tag with `// TODO: replace with live capture from a4h`)
- [ ] Add unit tests (~4 tests) to `tests/unit/adt/xml-parser.test.ts`:
  - Parses a happy-path response with applied + skipped + transports
  - Parses an empty-skipped response (just applied count)
  - Returns `skipped: []` and `transports: []` for minimal responses
  - Throws a parse error on malformed XML (or returns a defaulted result — match the existing parser's error policy)
- [ ] Run `npm test -- xml-parser` — all tests pass

### Task 3: Handler dispatch + schema sync + authz policy

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/authz/policy.ts`

Wire the new action through the three-file sync + the authz policy. Required by CLAUDE.md "Tool schema three-file sync" invariant.

- [ ] In `src/handlers/intent.ts`, add `case 'batch_quickfix'` in `handleSAPDiagnose` after the existing `case 'apply_quickfix'` (line ~5586). Body:
  - Validate args via the Zod schema
  - Call `runAutoQuickfixWorklist(http, safety, { atcRunId, packageScope, maxFindings })`
  - Format the result as `JSON.stringify(result, null, 2)` and return `textResult(...)`
  - Wrap in the standard try/catch and error formatter `formatErrorForLLM`
- [ ] In `src/handlers/schemas.ts`, extend `SAPDiagnoseSchema` (line 672) action union to include `'batch_quickfix'` plus its argument schema:
  ```ts
  z.object({
    action: z.literal('batch_quickfix'),
    atcRunId: z.string().min(1),
    packageScope: z.string().optional(),
    maxFindings: z.coerce.number().int().positive().max(1000).optional(),
  })
  ```
- [ ] In `src/handlers/tools.ts`, add `'batch_quickfix'` to the SAPDiagnose action enum (find the JSON Schema for SAPDiagnose) + add the per-action property descriptors with clear descriptions:
  - `atcRunId`: "The ATC run UUID returned by SAPDiagnose action=atc (required)"
  - `packageScope`: "Restrict to a single package (default: all in the run scope). Supports wildcards: 'Z*'"
  - `maxFindings`: "Cap the number of findings processed in one call (default: 100, max: 1000)"
- [ ] In `src/authz/policy.ts`, add `'SAPDiagnose.batch_quickfix': 'write'` to `ACTION_POLICY`
- [ ] Run `npm run typecheck` — no errors
- [ ] Run `npm test` — all tests must pass (handler test added in Task 4)

### Task 4: Unit tests for the new action

**Files:**
- Modify: `tests/unit/adt/devtools.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Mock-fetch tests covering happy + error paths, plus a handler-level test verifying the dispatch + JSON response format.

- [ ] In `tests/unit/adt/devtools.test.ts`, add a `describe('runAutoQuickfixWorklist')` block with:
  - Happy path: returns `{ applied: 12, skipped: [...], remaining: 0, transports: [...] }`
  - Empty worklist: returns `{ applied: 0, skipped: [], remaining: 0, transports: [] }`
  - 4xx response: throws typed `AdtApiError` with the SAP message
  - 404 (endpoint not available): throws typed error with the "not available on this release" hint
  - Safety blocked: throws `AdtSafetyError` when `allowWrites=false`
- [ ] In `tests/unit/handlers/intent.test.ts`, add a `describe('SAPDiagnose batch_quickfix')` block:
  - Happy path: calls the underlying wrapper and returns a JSON-formatted result
  - Validation: missing `atcRunId` → returns Zod validation error
  - Scope: `allowWrites=false` → returns the safety-error message verbatim
- [ ] Mock pattern: `vi.mock('undici', ...)` with `mockResponse(200, fixtureXml, { 'x-csrf-token': 'T' })` from `tests/helpers/mock-fetch.ts`
- [ ] Run `npm test` — all tests pass

### Task 5: Integration test (gated)

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

Add a live integration test against the a4h system. Skip when a Clean-Core ATC variant is not configured.

- [ ] Use `getTestClient()` from `tests/integration/helpers.ts`
- [ ] First, run `runAtcCheck()` with `variant: 'SAP_CP_CCM_TRANSITION_S4_2025_CLOUD'` (or whichever Clean-Core variant is configured)
- [ ] If no findings come back, skip via `requireOrSkip(ctx, hasAutomaticFindings, 'NO_CLEAN_CORE_AUTOMATIC_FINDINGS')`
- [ ] If findings exist, call `runAutoQuickfixWorklist({ atcRunId, maxFindings: 1 })` (limit to one to keep the test light)
- [ ] Assert: `result.applied >= 0`, `result.remaining >= 0`, response shape matches `AutoQuickfixWorklistResult`
- [ ] Cleanup: any applied changes should be in `$TMP` only; if a transport was created, log it but don't release/delete (that's `SAPTransport` territory)
- [ ] Capture the raw response into a new fixture: `tests/fixtures/xml/autoqf-worklist-result-a4h.xml` for future replays
- [ ] Tag the test with `// best-effort-cleanup` where applicable
- [ ] Run `TEST_SAP_URL=... npm run test:integration -- batch_quickfix` — test passes or skips with a valid reason

### Task 6: Update Clean-Core skills to use batch_quickfix

**Files:**
- Modify: `skills/sap-clean-core-atc/SKILL.md`
- Modify: `skills/migrate-custom-code/SKILL.md`

Both existing skills currently iterate one-by-one. Update them to switch to `batch_quickfix` when the finding count exceeds a threshold (default: 5 automatic findings in scope).

- [ ] In `skills/sap-clean-core-atc/SKILL.md`, add a new step after the ATC-run step:
  - Count findings tagged `automatic="true"` in the package scope
  - If count > 5 (configurable threshold), call `SAPDiagnose action='batch_quickfix' atcRunId=<id> packageScope=<pkg>` — one call, fast
  - If count ≤ 5, fall back to the existing per-finding `quickfix` + `apply_quickfix` loop (better LLM visibility for small counts)
  - After the call, re-run ATC to verify `remaining: 0`
- [ ] Same update for `skills/migrate-custom-code/SKILL.md` — it has a slightly different audience (migration-time bulk apply), so the threshold may be 10 there
- [ ] Add a "Failure modes" note: if `batch_quickfix` returns a non-empty `skipped[]`, the skill should iterate the skipped IDs and explain why each was skipped (typical: requires manual review)
- [ ] Update the skill's frontmatter `description` to advertise the new capability ("...batch-applies machine-fixable findings via SAPDiagnose action='batch_quickfix'")
- [ ] Run a manual smoke: invoke each skill via Claude Code against a test system to verify the new flow

### Task 7: Documentation

**Files:**
- Modify: `docs/tools.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `docs/roadmap.md` (if it exists)

- [ ] In `docs/tools.md`, document the new `SAPDiagnose action='batch_quickfix'` under the SAPDiagnose section: action, args, return shape, scope requirement, error modes
- [ ] In `CLAUDE.md`, add a row to "Key Files for Common Tasks":
  - `| Add SAPDiagnose batch_quickfix wrapper (ATC auto-quickfix worklist) | src/adt/devtools.ts (`runAutoQuickfixWorklist`), src/adt/xml-parser.ts (`parseAutoQuickfixWorklist`), src/handlers/intent.ts (case 'batch_quickfix'), src/handlers/schemas.ts, src/handlers/tools.ts, src/authz/policy.ts, tests/unit/adt/devtools.test.ts |`
- [ ] In `README.md`, mention the new action in the SAPDiagnose feature blurb (one line)
- [ ] In `docs/compare/00-feature-matrix.md`, add or update a row in the ATC section indicating ARC-1 supports batch quickfix; reference the SAP S/4HANA Cloud Private 2027 GA window
- [ ] Update the "Last Updated" header in the feature matrix
- [ ] If `docs/roadmap.md` exists, mark the batch quickfix item as completed and cross-link to this plan
- [ ] Run `npm run lint` — Markdown formatting passes

### Task 8: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Run integration: `npm run test:integration` — passes or skips with valid reason
- [ ] Verify three-file sync: grep `batch_quickfix` in `src/handlers/{intent,schemas,tools}.ts` and `src/authz/policy.ts` — each must appear
- [ ] Verify tool-list pruning works: a viewer-scope user must NOT see `batch_quickfix` in the tool list (manual test via the MCP inspector or an API-key with `viewer` profile)
- [ ] Manually invoke `SAPDiagnose action='batch_quickfix'` against a test ATC run to confirm end-to-end flow
- [ ] Move this plan to `docs/plans/completed/`
