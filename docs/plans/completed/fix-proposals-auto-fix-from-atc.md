# FEAT-12: Fix Proposals / Auto-Fix from ATC

## Overview

Expose SAP's Quick Fix API (`/sap/bc/adt/quickfixes`) through ARC-1's `SAPDiagnose` tool, enabling LLMs to retrieve verified fix proposals for syntax check and ATC findings and apply them programmatically. This is safer than having the LLM guess corrections — SAP's fix engine knows the exact change needed.

The implementation adds two new actions to `SAPDiagnose`: `quickfix` (get proposals for a source position) and `apply_quickfix` (apply a proposal and get text deltas). The ATC finding response is also enriched with quickfix availability flags so the LLM knows which findings have machine-applicable fixes.

**Key design decision:** Fix proposals are exposed via `SAPDiagnose` (not `SAPWrite`) because getting proposals is a read operation. Applying fixes returns text deltas that the LLM uses with `SAPWrite` to update source — keeping the existing write safety system intact (package checks, transport guards, read-only mode).

## Context

### Current State

- ARC-1 runs ATC checks (`SAPDiagnose action="atc"`) and returns findings with priority, checkTitle, messageTitle, uri, and line number
- ATC findings do NOT include quickfix availability flags (`quickfixInfo`, `manual`, `automatic`, `pseudo`) even though SAP returns them
- No way to get fix proposals for a finding position
- No way to apply SAP-verified fixes — LLMs must guess corrections
- Competitors `mcp-abap-abap-adt-api` and `dassian-adt` already have fix proposals

### Target State

- `SAPDiagnose action="atc"` enriches each finding with `quickfixInfo` and `hasQuickfix` flags
- `SAPDiagnose action="quickfix"` returns fix proposals for a given source position (line + column)
- `SAPDiagnose action="apply_quickfix"` applies a selected proposal and returns text deltas
- Skills (`migrate-custom-code.md`, `explain-abap-code.md`, `generate-rap-logic.md`) are updated to leverage the new quickfix actions
- E2E tests verify the full flow: ATC check → get proposals → (optionally) apply
- Documentation updated: `docs/tools.md`, `docs/roadmap.md`, `compare/00-feature-matrix.md`, `CLAUDE.md`

### Key Files

| File | Role |
|------|------|
| `src/adt/devtools.ts` | Core implementation: `getFixProposals()`, `applyFixProposal()`, enriched ATC parsing |
| `src/adt/types.ts` | New types: `FixProposal`, `FixDelta`, enriched `AtcFinding` |
| `src/handlers/intent.ts` | Route `quickfix` and `apply_quickfix` actions in `handleSAPDiagnose()` |
| `src/handlers/tools.ts` | Update SAPDiagnose tool definition with new actions and parameters |
| `src/handlers/schemas.ts` | Update `SAPDiagnoseSchema` with new actions and fields |
| `src/adt/safety.ts` | Safety classification for new operations |
| `tests/unit/adt/devtools.test.ts` | Unit tests for `getFixProposals()`, `applyFixProposal()`, enriched ATC |
| `tests/unit/handlers/intent.test.ts` | Unit tests for new handler routes |
| `tests/e2e/diagnostics.e2e.test.ts` | E2E tests for quickfix flow |
| `docs/tools.md` | Tool reference update |
| `docs/roadmap.md` | Mark FEAT-12 complete |
| `compare/00-feature-matrix.md` | Update fix proposals row |
| `skills/migrate-custom-code.md` | Leverage quickfix for migration fixes |
| `skills/explain-abap-code.md` | Offer quickfix in code quality analysis |
| `skills/generate-rap-logic.md` | Use quickfix for post-write syntax fixes |

### Design Principles

1. **Read-only proposals, write via existing path** — `getFixProposals()` is a read operation (uses POST but doesn't modify SAP state). `applyFixProposal()` returns deltas only — actual source modification goes through `SAPWrite`, keeping all safety gates (package check, transport guard, read-only mode) in place.

2. **Enrich existing ATC response** — Don't break the existing ATC response format. Add optional fields (`quickfixInfo`, `hasQuickfix`) to each finding so existing consumers are unaffected.

3. **Match abap-adt-api API format** — The ADT quickfix API is undocumented. Follow the proven format from `abap-adt-api` library: `POST /sap/bc/adt/quickfixes/evaluation?uri=<source_uri>#start=<line>,<col>` with source as body, `Content-Type: application/*`, `Accept: application/*`.

4. **Opaque userContent** — The proposal's `userContent` field is opaque state from SAP's fix engine. Store it as-is and pass it back unchanged when applying. Never parse, modify, or expose its internals.

5. **Graceful degradation** — If the quickfix endpoint isn't available (older SAP releases, missing ICF service), return empty proposals rather than failing. Feature-gate via the existing `features.ts` probe pattern if needed.

## API Research Results

### Confirmed via live SAP A4H system testing (2026-04-14):

**Endpoint:** `POST /sap/bc/adt/quickfixes/evaluation`
- **Query params:** `uri=<source_uri>%23start%3D<line>%2C<col>` (URI-encoded `#start=line,col` fragment)
- **Body:** Raw source code as text
- **Headers:** `Content-Type: application/*`, `Accept: application/*`
- **Response:** `<qf:evaluationResults xmlns:qf="http://www.sap.com/adt/quickfixes">` with `<evaluationResult>` children

**Each evaluationResult contains:**
- `<adtcore:objectReference>` with attributes: `adtcore:uri` (proposal URI), `adtcore:type`, `adtcore:name` (human-readable), `adtcore:description` (HTML-encoded details)
- `<userContent>` — opaque XML state for apply step

**Apply endpoint:** `POST <proposal_uri>` (the `adtcore:uri` from the proposal)
- **Body:** XML `<quickfixes:proposalRequest>` with source content + `<userContent>`
- **Response:** Deltas with text ranges and replacement content

**ATC worklist enrichment:** Findings already contain `quickfixInfo` attribute and `<atcfinding:quickfixes manual="..." automatic="..." pseudo="..."/>` — currently discarded by `parseAtcFindings()`.

**Discovery:** The endpoint exists in ADT discovery as `Quickfixes` workspace with `application/vnd.sap.adt.quickfixes.evaluation+xml;version=1.0.0` accept type. Additionally, an `Autoquickfix` endpoint exists at `/sap/bc/adt/atc/autoqf/worklist` for batch ATC fixes.

### 2026-05-10 apply_quickfix hardening note

Follow-up research against Eclipse ADT 3.58 showed that the original abap-adt-api-compatible request shape is sufficient for evaluation, but generic proposal application should follow Eclipse's quickfix XML model more closely. `apply_quickfix` now posts `application/xml`, preserves empty `userContent`, can pass through `affectedObjects` source units from evaluation, accepts an exact `sourceUri` override for include-level fixes, and parses the native `<proposalResult><deltas><unit>...` response shape. The request keeps only the root `quickfixes:proposalRequest` namespaced; `input`, `content`, `affectedObjects`, `unit`, and `userContent` remain unqualified because `quickfixes.xsd` declares `elementFormDefault="unqualified"`.

The RAP `create_class_implementation` proposal remains a separate higher-level feature candidate: Eclipse's behavior-definition UI handler opens a wizard and transforms the proposal request before apply, so generic `apply_quickfix` should not claim to fully replace "Generate Behavior Implementation" yet.

## Development Approach

Tasks are ordered foundation-first: types → core functions → handler wiring → schema/tool definitions → tests → documentation → skills. Each task includes its own tests and validation step.

The feature is classified as a read operation for safety purposes (`OperationType.Read`) since proposals don't modify SAP state. The apply step returns deltas only — source writes go through the existing `SAPWrite` path.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

---

### Task 1: Add types and core quickfix functions in devtools.ts

**Files:**
- Modify: `src/adt/types.ts`
- Modify: `src/adt/devtools.ts`
- Modify: `tests/unit/adt/devtools.test.ts`

Add the FixProposal and FixDelta types and implement the core ADT client functions for the quickfix API. Also enrich the existing ATC finding parser to include quickfix availability flags.

- [ ] Add types to `src/adt/types.ts`:
  - `FixProposal` interface: `uri: string` (proposal endpoint URI), `type: string`, `name: string` (human-readable), `description: string` (HTML description), `userContent: string` (opaque state)
  - `FixDelta` interface: `uri: string`, `range: { start: { line: number; column: number }; end: { line: number; column: number } }`, `content: string` (replacement text)
  - Extend `AtcFinding` (in `src/adt/devtools.ts` at line ~281) with optional fields: `quickfixInfo?: string`, `hasQuickfix?: boolean`

- [ ] Implement `getFixProposals()` in `src/adt/devtools.ts` (after `runAtcCheck` at line ~277):
  - Signature: `async function getFixProposals(http: AdtHttpClient, safety: SafetyConfig, sourceUri: string, source: string, line: number, column: number): Promise<FixProposal[]>`
  - Add safety check: `checkOperation(safety, OperationType.Read, 'GetFixProposals')`
  - POST to `/sap/bc/adt/quickfixes/evaluation` with query param `uri=<sourceUri>#start=<line>,<column>` (URI-encode the `#start=` fragment)
  - Body: raw `source` text
  - Headers: `Content-Type: application/*`, `Accept: application/*`
  - Parse response XML: extract `<evaluationResult>` nodes, map each to `FixProposal` via `adtcore:objectReference` attributes + `<userContent>` text
  - Return empty array on 404/406 (endpoint not available on this SAP release)

- [ ] Implement `applyFixProposal()` in `src/adt/devtools.ts`:
  - Signature: `async function applyFixProposal(http: AdtHttpClient, safety: SafetyConfig, proposal: FixProposal, sourceUri: string, source: string, line: number, column: number): Promise<FixDelta[]>`
  - Add safety check: `checkOperation(safety, OperationType.Read, 'ApplyFixProposal')` — this is still read because it returns deltas, not modifying SAP state
  - Build XML body: `<quickfixes:proposalRequest xmlns:quickfixes="http://www.sap.com/adt/quickfixes" xmlns:adtcore="http://www.sap.com/adt/core"><input><content>{xmlEscaped source}</content><adtcore:objectReference adtcore:uri="{sourceUri}#start={line},{column}"/></input><userContent>{xmlEscaped proposal.userContent}</userContent></quickfixes:proposalRequest>`
  - POST to `proposal.uri` with `Content-Type: application/*`, `Accept: application/*`
  - Parse response XML: extract delta nodes with ranges and content
  - Return `FixDelta[]`

- [ ] Enrich `parseAtcFindings()` (line ~429) to extract quickfix metadata:
  - Read `@_quickfixInfo` attribute from each `<finding>` node
  - Read nested `<quickfixes>` node attributes: `@_manual`, `@_automatic`, `@_pseudo`
  - Set `hasQuickfix: true` if any of `manual`, `automatic`, or `pseudo` is `"true"`
  - Add `quickfixInfo` string field to the finding

- [ ] Export the new functions from `src/adt/devtools.ts`

- [ ] Add unit tests (~15 tests) in `tests/unit/adt/devtools.test.ts`:
  - `getFixProposals` returns parsed proposals from valid XML response
  - `getFixProposals` returns empty array for empty `<qf:evaluationResults/>` response
  - `getFixProposals` returns empty array on 404 (endpoint not available)
  - `getFixProposals` returns empty array on 406 (content type not accepted)
  - `getFixProposals` correctly URI-encodes the `#start=line,col` fragment in query param
  - `getFixProposals` calls `checkOperation` with `OperationType.Read`
  - `getFixProposals` passes source as request body
  - `applyFixProposal` returns parsed deltas from valid XML response
  - `applyFixProposal` posts to proposal.uri (not hardcoded endpoint)
  - `applyFixProposal` includes userContent in XML body
  - `applyFixProposal` XML-escapes source content and userContent
  - `parseAtcFindings` extracts `quickfixInfo` attribute
  - `parseAtcFindings` sets `hasQuickfix: true` when `automatic="true"`
  - `parseAtcFindings` sets `hasQuickfix: false` when all quickfix flags are `"false"`
  - `parseAtcFindings` backward-compatible — missing quickfix nodes default to `hasQuickfix: false`

- [ ] Run `npm test` — all tests must pass

---

### Task 2: Wire quickfix actions into SAPDiagnose handler

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/intent.test.ts` (if exists, otherwise `tests/unit/handlers/`)

Add `quickfix` and `apply_quickfix` actions to the SAPDiagnose tool, including schema validation and tool description updates.

- [ ] Update `SAPDiagnoseSchema` in `src/handlers/schemas.ts` (line ~354):
  - Add `'quickfix'` and `'apply_quickfix'` to the `action` enum: `z.enum(['syntax', 'unittest', 'atc', 'dumps', 'traces', 'quickfix', 'apply_quickfix'])`
  - Add new optional fields: `source: z.string().optional()`, `line: z.coerce.number().optional()`, `column: z.coerce.number().optional()`, `proposalUri: z.string().optional()`, `proposalUserContent: z.string().optional()`

- [ ] Update SAPDiagnose tool definition in `src/handlers/tools.ts` (line ~719):
  - Add `quickfix` and `apply_quickfix` to the action enum in the JSON schema `properties.action.enum`
  - Add `quickfix` and `apply_quickfix` descriptions to the tool description string
  - Add `source`, `line`, `column`, `proposalUri`, `proposalUserContent` properties to the JSON schema with descriptions
  - Update the tool description to explain the quickfix workflow: run ATC/syntax → get quickfix proposals → apply selected proposal

- [ ] Add handler cases in `handleSAPDiagnose()` in `src/handlers/intent.ts` (after the `'atc'` case at line ~2565):
  - `case 'quickfix'`: validate `name`, `type`, `source`, `line` are present. Build `sourceUri` via `objectUrlForType(type, name) + '/source/main'`. Call `getFixProposals(client.http, client.safety, sourceUri, source, line, column ?? 0)`. Return proposals as JSON.
  - `case 'apply_quickfix'`: validate `name`, `type`, `source`, `line`, `proposalUri`, `proposalUserContent` are present. Build proposal object from args. Call `applyFixProposal(...)`. Return deltas as JSON.

- [ ] Import `getFixProposals` and `applyFixProposal` from `../adt/devtools.js` in `intent.ts` (line ~50 area)

- [ ] Add unit tests (~8 tests) for the new handler routes:
  - `quickfix` action calls `getFixProposals` with correct arguments
  - `quickfix` action returns error when `source` is missing
  - `quickfix` action returns error when `line` is missing
  - `quickfix` action returns proposals as JSON
  - `apply_quickfix` action calls `applyFixProposal` with correct arguments
  - `apply_quickfix` action returns error when `proposalUri` is missing
  - `apply_quickfix` action returns deltas as JSON
  - Schema validation rejects unknown actions (existing test still passes)

- [ ] Run `npm test` — all tests must pass

---

### Task 3: Add E2E tests for quickfix flow

**Files:**
- Modify: `tests/e2e/diagnostics.e2e.test.ts`

Add E2E tests that exercise the quickfix API through the full MCP stack. The tests verify the quickfix evaluation endpoint returns proposals for classes (which reliably offer "Generate constructor" etc. on the A4H test system).

- [ ] Add a new `describe('SAPDiagnose quickfix')` block in `tests/e2e/diagnostics.e2e.test.ts` (after the existing `SAPDiagnose traces` block at line ~276):

  - Test: `'gets fix proposals for a class'` — Call `SAPDiagnose(action="quickfix", type="CLAS", name="ZCL_ARC1_TEST", source=<fetched source>, line=1, column=1)`. First fetch source via `SAPRead(type="CLAS", name="ZCL_ARC1_TEST")`. Verify response is JSON array. If proposals exist, verify each has `uri`, `name`, `type` fields. Log proposal count and names.

  - Test: `'returns empty proposals for position without quickfixes'` — Call `SAPDiagnose(action="quickfix", type="PROG", name="ZARC1_TEST_REPORT", source=<fetched source>, line=2, column=0)` (a comment line). Verify response is JSON array with length 0.

  - Test: `'returns error when source is missing'` — Call `SAPDiagnose(action="quickfix", type="CLAS", name="ZCL_ARC1_TEST", line=1, column=1)` without `source`. Use `expectToolError()` to verify an error is returned.

  - Test: `'ATC findings include quickfix metadata'` — Call `SAPDiagnose(action="atc", type="PROG", name="ZARC1_TEST_REPORT")`. Parse the JSON response. Verify each finding has `hasQuickfix` boolean field (may be true or false depending on the finding).

- [ ] Follow existing E2E patterns: use `connectClient()`, `callTool()`, `expectToolSuccess()`, `expectToolError()` from `tests/e2e/helpers.ts`. Use `ctx.skip()` with descriptive messages for environment-dependent skips.

- [ ] Run `npm test` — all tests must pass (unit tests; E2E tests require a running MCP server)

---

### Task 4: Update documentation

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`
- Modify: `docs/architecture.md` (if SAPDiagnose description needs update)

Update all documentation artifacts to reflect the new quickfix capability.

- [ ] Update `docs/tools.md` — SAPDiagnose section:
  - Add `quickfix` action documentation with parameters (`name`, `type`, `source`, `line`, `column`) and example usage
  - Add `apply_quickfix` action documentation with parameters (`name`, `type`, `source`, `line`, `column`, `proposalUri`, `proposalUserContent`) and example usage
  - Add a "Quickfix Workflow" subsection showing the typical flow: run ATC → check `hasQuickfix` → get proposals → apply → write
  - Update the ATC action docs to mention the new `hasQuickfix` field in findings

- [ ] Update `docs/roadmap.md`:
  - Mark FEAT-12 as completed in the overview table (line ~49): strikethrough and add completion date
  - Add completion entry to the "Completed" table (line ~97 area)
  - Update FEAT-12 detail section (line ~350): set Status to "Complete (2026-04-XX)", add Implementation section describing what was done

- [ ] Update `compare/00-feature-matrix.md`:
  - Change "Fix proposals" row (line ~156): update ARC-1 column from `❌` to `✅`
  - Update "Last Updated" date if present

- [ ] Update `CLAUDE.md`:
  - In the "Key Files for Common Tasks" table: add row for "Add fix proposal / quickfix operation" → `src/adt/devtools.ts`, `src/handlers/intent.ts`, `src/handlers/tools.ts`
  - In the config table or feature list, mention quickfix support if appropriate

- [ ] Run `npm run lint` — no errors

---

### Task 5: Update skills to leverage quickfix

**Files:**
- Modify: `skills/migrate-custom-code.md`
- Modify: `skills/explain-abap-code.md`
- Modify: `skills/generate-rap-logic.md`

Update skills that currently work with ATC findings or syntax errors to leverage the new quickfix capability. The quickfix API provides SAP-verified fixes that are safer than LLM-generated corrections.

- [ ] Update `skills/migrate-custom-code.md`:
  - In "Step 4: Generate Fix Proposals" (line ~127): add a new sub-step **4a** before the existing content: "First, check if SAP has quickfixes available for this finding. Use `SAPDiagnose(action="quickfix", type="<type>", name="<object_name>", source="<current_source>", line=<finding_line>, column=0)`. If proposals are returned, present them as **SAP-verified fixes** (higher confidence than LLM-generated fixes). Use `SAPDiagnose(action="apply_quickfix", ...)` to get the exact text deltas, then apply via `SAPWrite`."
  - Update the "Fix Options" section (line ~133) to add a 4th option: **"SAP Quick Fix"** — when available, applies the SAP-verified fix proposal instead of LLM-generated code
  - In the Notes section, add that SAP quickfixes are available for many common ATC findings (obsolete statements, missing declarations) but not all (e.g., deprecated API replacements usually require manual redesign)

- [ ] Update `skills/explain-abap-code.md`:
  - In "Step 3: Run ATC Check" (line ~89): after showing the ATC findings, add guidance to check `hasQuickfix` in the findings. If findings have `hasQuickfix: true`, mention in the "Follow-up Options" section: "Want me to apply SAP's quickfix for [finding]? (uses verified SAP fix proposals)"
  - Update "Follow-up Options" (line ~172): add option "Want me to get SAP quickfix proposals for the ATC findings?" (→ uses `SAPDiagnose action="quickfix"`)

- [ ] Update `skills/generate-rap-logic.md`:
  - In "Step 5: Write and Validate" (line ~191): after the syntax check step (line ~210), add: "If syntax errors occur, first try `SAPDiagnose(action="quickfix", type="CLAS", name="<bp_class>", source="<current_source>", line=<error_line>, column=<error_col>)` to get SAP-verified fix proposals before manually editing. SAP quickfixes can automatically resolve common issues like missing declarations or incorrect syntax."

- [ ] Run `npm run lint` — no errors (skills are markdown, but ensure no broken formatting)

---

### Task 6: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify the new `quickfix` and `apply_quickfix` actions appear in the SAPDiagnose tool schema output
- [ ] Verify ATC findings now include `hasQuickfix` boolean field
- [ ] Verify documentation is consistent across `docs/tools.md`, `docs/roadmap.md`, `compare/00-feature-matrix.md`
- [ ] Move this plan to `docs/plans/completed/`
