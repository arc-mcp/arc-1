# Add Function-Module + Function-Group Create/Update/Delete (issue #250)

## Overview

Issue [#250](https://github.com/marianfoo/arc-1/issues/250) reports that `SAPWrite(action='create', type='FUNC', …)` errors out because `objectBasePath('FUNC')` deliberately throws (since PR [#223](https://github.com/marianfoo/arc-1/pull/223)). Live verification on A4H (S/4HANA 2023) confirms ADT supports a full FM lifecycle via `/sap/bc/adt/functions/groups/{group}/fmodules/{name}` — ARC-1 simply hasn't wired the write path. `FUGR` write is also missing (not in `SAPWRITE_TYPES_ONPREM`), and FUGR is the prerequisite parent for an FM.

This plan adds **FUGR + FUNC create + source-update + delete** as a bundled MVP. Signature/parameter management (the well-known parameter-loss bug class — see [`compare/fr0ster/evaluations/issue-77-fm-update-parameter-loss.md`](../../compare/fr0ster/evaluations/issue-77-fm-update-parameter-loss.md)) is explicitly **out of scope** — callers can add parameters via SAPGUI/Eclipse afterwards. The MVP exposes a clear caveat in the tool description so LLMs warn the user.

Order is TDD-first: integration + E2E tests written against the verified live recipe go in **before** the URL builder / XML body / handler wiring, so each implementation task runs the failing tests and turns them green.

## Context

### Current State

- `SAPRead` for `FUNC` works via a dedicated branch in [src/handlers/intent.ts:1447](../../src/handlers/intent.ts) using `client.getFunction(group, name)`.
- `SAPWrite` for `FUNC`:
  - Schema accepts `'FUNC'` ([src/handlers/schemas.ts:237](../../src/handlers/schemas.ts)).
  - Handler routes through `objectUrlForType(type, name)` → `objectBasePath('FUNC')` → **throws** at [src/handlers/intent.ts:2809-2828](../../src/handlers/intent.ts) by design (PR #223 codex follow-up).
  - `buildCreateXml` has no `case 'FUNC'`; falls through to a generic `<adtcore:objectReferences>` body that ADT would reject.
- `SAPWrite` for `FUGR`: not in `SAPWRITE_TYPES_ONPREM` — schema rejects it.

### Target State

- `SAPWrite(action='create', type='FUGR', name=…, package=…, description=…)` creates a function group.
- `SAPWrite(action='create', type='FUNC', name=…, group=…, description=…)` creates an empty-shell function module under the named group.
- `SAPWrite(action='update', type='FUNC', name=…, group=…, source=…)` updates the FM source body. Caller-supplied `*"…IMPORTING…"*` parameter-comment-blocks are silently stripped (SAP rejects them with `FUNC_ADT028`) and a warning is appended.
- `SAPWrite(action='delete', type='FUNC'|'FUGR', name=…, group?=…)` deletes via the standard lock→delete→unlock pattern.
- `objectBasePath('FUNC')` continues to throw — generic URL builders (SAPActivate / SAPDiagnose / SAPTransport) must still fail loudly. The new write path bypasses it deliberately, exactly like the existing read path does.
- Tool description warns LLMs that FM signature/parameter management is not supported via ARC-1 yet (use SAPGUI/Eclipse).

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | `handleSAPWrite` switch, `buildCreateXml`, `objectUrlForType`, `createContentTypeForType`, `vendorContentTypeForType`. New FUNC/FUGR branches and content-type mappings live here. |
| `src/handlers/schemas.ts` | `SAPWRITE_TYPES_ONPREM` enum (add `FUGR`). `group` already exists — extend description. |
| `src/handlers/tools.ts` | Tool description for SAPWrite — list FUGR + FUNC, document `group` requirement and parameter-management caveat. |
| `src/adt/client.ts` | Optional helper if we wrap the FUNC URL builder; currently `getFunction(group, name)` already lives here (read). |
| `tests/unit/handlers/intent.test.ts` | Unit tests with mocked `undici` for FUGR + FUNC create/update/delete URL/body shapes. |
| `tests/unit/handlers/schemas.test.ts` | Schema enum + read/write symmetry tests. |
| `tests/unit/handlers/tools.test.ts` | Tool description sanity asserts. |
| `tests/unit/handlers/slash-type-map.test.ts` | Existing guard — keep `objectBasePath('FUNC')` throw assertion intact. |
| `tests/integration/fugr-func.integration.test.ts` (new) | Full FUGR+FUNC lifecycle against live SAP. |
| `tests/e2e/func-write.e2e.test.ts` (new) | Same lifecycle through the MCP JSON-RPC stack. |
| `docs_page/tools.md` | SAPWrite documentation — add FUNC/FUGR rows + caveat. |
| `compare/00-feature-matrix.md` | Mark FUNC/FUGR write capability for ARC-1 column. |
| `docs/roadmap.md` | Mark FEAT entry completed (or add new one if absent). |
| `CLAUDE.md` | Key Files for Common Tasks — add row for FUNC/FUGR write. |

### Design Principles

1. **MVP scope = empty-shell FM** — create FUGR, create FM (no parameters), write source body, activate, delete. Anything that requires the FM parameter metadata document (signature management) is deferred. ARC-1 calls SAPGUI's job done after activation.
2. **TDD first** — integration + E2E tests for the exact verified recipe land in Task 1 + Task 2, before any production code, so subsequent implementation tasks have a definitive red→green signal.
3. **Reuse the existing TABL pattern** — TABL is already special-cased at the top of `handleSAPWrite` (around line 2983) because its URL needs a runtime probe. FUNC reuses that pattern: extract `group`, build the FM URL, and let the rest of the create / update / delete branches run unchanged. No new abstractions.
4. **Loud failure mode preserved** — `objectBasePath('FUNC')` keeps throwing. Generic URL builders (SAPActivate, SAPDiagnose, SAPTransport) are NOT changed; they must still fail loudly so the contract from PR #223 holds. The new write code does not call `objectBasePath('FUNC')`.
5. **No FUGR auto-creation from FUNC create** — fail with a clear error if the parent FUGR is missing. Implicit FUGR creation hides intent and complicates rollback. Caller can issue the FUGR create explicitly.
6. **Strip `*"…*"` parameter comment blocks before PUT** — verified live: SAP returns `HTTP 400 ExceptionResourceScanDuringSaveFailure / FUNC_ADT028 "Parameter comment blocks are not allowed"`. LLMs frequently emit these out of muscle memory. Strip silently and append a one-line warning to the success response.
7. **NPL 7.50 compatibility — best effort, integration tests skip on lock-handle 423**. Per [INFRASTRUCTURE.md](../../INFRASTRUCTURE.md) the NPL stack has a documented `423 invalid lock handle` issue on PUT after lock for ABAP source types; FM source PUT is in the same family. The integration test must `requireOrSkip` on `SkipReason.BACKEND_UNSUPPORTED` when this fires, exactly like `tests/integration/crud.lifecycle.integration.test.ts:44` does today.
8. **No new env vars or config flags** — feature gates are the existing `allowWrites=true` + `allowedPackages` check (FM is checked via the parent FUGR's package).
9. **Caveat is permanent (until signature management lands)** — every code path returns a one-line note `"FM parameters not managed by ARC-1 — use SAPGUI/Eclipse to add IMPORTING/EXPORTING."` so LLMs do not promise the user something ARC-1 can't deliver.

## Development Approach

- TDD ordering: write integration + E2E tests first against the verified live recipe (Tasks 1–2), then implement until they pass (Tasks 3–6).
- The integration test runs against A4H (`TEST_SAP_URL`); on NPL 7.50 it auto-skips when the documented lock-handle 423 fires (same pattern as existing CRUD lifecycle tests).
- E2E test must call `SAPWrite` via the MCP client only — no direct ADT client.
- All new code runs through Biome on commit (lint-staged). Don't manually format — pre-commit hook auto-fixes.
- Run unit tests after every code-changing task; integration + E2E only after Task 6 + 7.

## Validation Commands

- `npm test` — unit suite; must pass after every code-touching task
- `npm run typecheck` — must be clean
- `npm run lint` — must be clean
- `npm run test:integration -- fugr-func.integration` — runs only the new integration file (after Task 7)
- `npm run test:e2e -- func-write` — runs only the new E2E (after Task 8; needs running MCP server, see [docs/setup-guide.md](../setup-guide.md))

### Task 1: Add integration test for full FUGR + FUNC CRUD lifecycle (TDD red)

**Files:**
- Create: `tests/integration/fugr-func.integration.test.ts`

This task creates the failing integration test first. It exercises the verified live recipe end-to-end against `TEST_SAP_URL`. Subsequent tasks turn it green.

The test must use `getTestClient()` from `tests/integration/helpers.ts`, `requireSapCredentials()` (hard-fail when env vars missing), and `generateUniqueName('ZARC1FG')` / `generateUniqueName('ZARC1FM')` from `tests/integration/crud-harness.ts` for collision-safe names. Cleanup via `try/finally` with `// best-effort-cleanup` comment.

The verified recipe (from live A4H smoke test):

| Step | Endpoint | Method | Body / Notes |
|------|----------|--------|--------------|
| Create FUGR | `/sap/bc/adt/functions/groups` | `POST` | `<group:abapFunctionGroup … adtcore:type="FUGR/F"><adtcore:packageRef adtcore:name="$TMP"/></group:abapFunctionGroup>`, `Content-Type: application/vnd.sap.adt.functions.groups.v3+xml` |
| Create FM | `/sap/bc/adt/functions/groups/{group_lc}/fmodules` | `POST` | `<fmodule:abapFunctionModule … adtcore:type="FUGR/FF"><adtcore:containerRef adtcore:name="{GROUP}" adtcore:type="FUGR/F" adtcore:uri="/sap/bc/adt/functions/groups/{group_lc}"/></fmodule:abapFunctionModule>`, `Content-Type: application/vnd.sap.adt.functions.fmodules+xml`. **Returns 201 + Location.** |
| Read inactive source | `/sap/bc/adt/functions/groups/{group_lc}/fmodules/{name_lc}/source/main?version=inactive` | `GET` | Returns `FUNCTION … ENDFUNCTION` stub with `*"…parameter…template…"*` comment. |
| Lock FM | `…/fmodules/{name_lc}?_action=LOCK&accessMode=MODIFY` | `POST` | Returns `LOCK_HANDLE`. Stateful session required. |
| PUT source | `…/fmodules/{name_lc}/source/main?lockHandle={lock}` | `PUT` | Body must NOT contain `*"…*"` comment blocks (live confirmation: returns 400 `FUNC_ADT028` if it does). |
| Unlock | `…/fmodules/{name_lc}?_action=UNLOCK&lockHandle={lock}` | `POST` | Must precede activate (live confirmation: activate-while-locked → 400 `ExceptionResourceNoAccess`). |
| Activate | `/sap/bc/adt/activation?method=activate&preauditRequested=true` | `POST` | `activationExecuted="true"` in response body. |
| Delete FM | `…/fmodules/{name_lc}?lockHandle={lock}` | `DELETE` | After lock. |
| Delete FUGR | `/sap/bc/adt/functions/groups/{group_lc}?lockHandle={lock}` | `DELETE` | After lock. |

- [ ] Add file `tests/integration/fugr-func.integration.test.ts` with one `describe('FUGR + FUNC lifecycle')`.
- [ ] In `beforeAll`, call `requireSapCredentials()` and `getTestClient()`.
- [ ] Test 1 — `creates a function group, creates an FM, writes source, activates, deletes`. Use unique names. In `try`, exercise the full recipe via `client.http` + `createObject` / `lockObject` / `safeUpdateSource` / `unlockObject` / `activate` / `deleteObject` — these helpers exist in `src/adt/crud.ts` and `src/adt/devtools.ts`. In `finally`, call the cleanup helper from `crud-harness.ts` for both FM and FUGR.
- [ ] Test 2 — `rejects FM source containing parameter comment blocks` — pre-strip is done by the handler (later tasks); at the raw `safeUpdateSource` layer the test asserts the SAP-side 400 `FUNC_ADT028` is correctly classified by `expectSapFailureClass`.
- [ ] Test 3 — `rejects FM creation when parent FUGR does not exist` — POST to `…/groups/ZNONEXISTENT/fmodules` returns HTTP 500 + `ExceptionResourceCreationFailure: "Function group ZNONEXISTENT does not exist"`. Assert classification via `expectSapFailureClass(err, [500], [/Function group .* does not exist/i])`.
- [ ] Use `ddicSkipReason()` mirror (or import the helper from `tests/integration/crud.lifecycle.integration.test.ts`) so NPL 7.50 lock-handle-423 PUT failures are skipped, not failed.
- [ ] Run `npm test` — must pass (no source code changed yet, only new test file).
- [ ] Run `npm run test:integration -- fugr-func.integration` against `TEST_SAP_URL=...a4h…` — **MUST FAIL** at the create step because the URL builder for FUNC throws today. This proves the test is wired correctly. Document the expected failure in a final comment.

### Task 2: Add E2E test for SAPWrite FUNC/FUGR through MCP stack (TDD red)

**Files:**
- Create: `tests/e2e/func-write.e2e.test.ts`

This task creates the failing E2E test that runs over MCP JSON-RPC. It complements Task 1 by exercising the full handler→tool→MCP path so the user-facing surface is covered, not just the ADT primitives.

Use the existing E2E helpers (`connectClient`, `callTool`, `expectToolSuccess`, `expectToolError`) and the `uniqueName`/`bestEffortDelete` patterns from `tests/e2e/rap-write.e2e.test.ts`.

- [ ] Add file `tests/e2e/func-write.e2e.test.ts` with `describe('E2E FUNC + FUGR write lifecycle')`.
- [ ] Test 1 — `creates FUGR via SAPWrite, creates FM, writes source, activates, deletes both`. Sequence: `SAPWrite(action='create', type='FUGR', name=fg, package='$TMP', description=…)` → `SAPWrite(action='create', type='FUNC', name=fm, group=fg, description=…)` → `SAPWrite(action='update', type='FUNC', name=fm, group=fg, source=…)` → `SAPActivate(uri=fm-uri)` → `SAPWrite(action='delete', type='FUNC', name=fm, group=fg)` → `SAPWrite(action='delete', type='FUGR', name=fg)`. Assert `expectToolSuccess` at every step.
- [ ] Test 2 — `SAPWrite(action='create', type='FUNC', name=…)` without `group` returns a clear error explaining `group` is required.
- [ ] Test 3 — `SAPWrite(action='create', type='FUNC', name=…, group='ZBAD_NONEXISTENT_GROUP')` returns a clear error mentioning the missing group.
- [ ] Test 4 — `SAPWrite(action='update', type='FUNC', name=…, group=…, source=<contains *"…IMPORTING…"*>)` succeeds AND the response text includes a warning about stripped parameter comment blocks.
- [ ] All transient FUGRs/FMs cleaned up in `try/finally` with `bestEffortDelete`.
- [ ] Run `npm test` — must pass.
- [ ] Skip running E2E now (handler not yet implemented). The task is complete when the file exists, lints, and typechecks.

### Task 3: Wire FUGR + FUNC into URL/content-type/XML helpers

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

This task adds the URL builder, the create-XML body cases, and the content-type mapping. It does NOT yet wire `handleSAPWrite` — that comes in Task 4. After this task, `buildCreateXml('FUGR', …)` and `buildCreateXml('FUNC', …, { group })` produce verified-correct payloads, and unit tests cover the XML/URL shapes.

For FUGR: payload root is `<group:abapFunctionGroup … adtcore:type="FUGR/F">` with `<adtcore:packageRef adtcore:name="${pkg}"/>`. Content-type: `application/vnd.sap.adt.functions.groups.v3+xml`. URL: `/sap/bc/adt/functions/groups/{name_encoded}` (object), `/sap/bc/adt/functions/groups` (collection for create POST).

For FUNC: payload root is `<fmodule:abapFunctionModule … adtcore:type="FUGR/FF">` with `<adtcore:containerRef adtcore:name="${group}" adtcore:type="FUGR/F" adtcore:uri="/sap/bc/adt/functions/groups/${group_lc}"/>` — **no packageRef** (FM inherits package from parent FUGR). Content-type: `application/vnd.sap.adt.functions.fmodules+xml`. URL: `/sap/bc/adt/functions/groups/{group_lc}/fmodules/{name_lc}` (object); collection for create is `/sap/bc/adt/functions/groups/{group_lc}/fmodules`. Note the lowercase URL convention — verified live (`adtcore:uri` and URL path are lowercase, `adtcore:name` keeps original case).

- [ ] Add `case 'FUGR'` to `buildCreateXml` (~line 2575). Body uses the FUGR/F envelope above. Verified payload comes from live A4H smoke test.
- [ ] Add `case 'FUNC'` to `buildCreateXml` (~line 2575). Read `properties.group`; throw `Error('FUNC create requires "group" property — pass it via SAPWrite args.')` if missing. Body uses the FUGR/FF envelope with `containerRef`. No packageRef.
- [ ] Add `'FUGR'` and `'FUNC'` to `vendorContentTypeForType` (or a focused helper) returning `application/vnd.sap.adt.functions.groups.v3+xml` and `application/vnd.sap.adt.functions.fmodules+xml` respectively.
- [ ] In `createContentTypeForType` (line 2063), map both types to their vendor types (no `application/*` fallback for these two — the SAP server returns 415 otherwise).
- [ ] Do NOT change `objectBasePath` — `case 'FUNC'` keeps throwing. The URL construction for FUNC happens in `handleSAPWrite` directly (next task) and bypasses `objectBasePath`. Confirm `tests/unit/handlers/slash-type-map.test.ts` still passes unchanged.
- [ ] Add unit tests (~6 tests) in `tests/unit/handlers/intent.test.ts` under a new `describe('buildCreateXml — FUGR/FUNC')`:
  - asserts FUGR body contains `adtcore:type="FUGR/F"` and `<adtcore:packageRef adtcore:name="$TMP"/>`
  - asserts FUNC body contains `adtcore:type="FUGR/FF"` and `<adtcore:containerRef … adtcore:type="FUGR/F" adtcore:uri="/sap/bc/adt/functions/groups/{group_lc}"/>`
  - asserts FUNC body has NO `<adtcore:packageRef>`
  - asserts `buildCreateXml('FUNC', name, pkg, desc, {})` (without group) throws
  - asserts `createContentTypeForType('FUGR')` returns `application/vnd.sap.adt.functions.groups.v3+xml`
  - asserts `createContentTypeForType('FUNC')` returns `application/vnd.sap.adt.functions.fmodules+xml`
- [ ] Run `npm test` — all unit tests must pass.
- [ ] Run `npm run typecheck` and `npm run lint` — must be clean.

### Task 4: Wire FUGR + FUNC into `handleSAPWrite` (`create` / `update` / `delete`)

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

This task plumbs the URL builder for FUGR + FUNC through `handleSAPWrite`. The pattern mirrors how TABL is special-cased at the top of `handleSAPWrite` (~line 2981) — pre-resolve `objectUrl` and `srcUrl` before the action switch.

After this task, `SAPWrite(action='create'|'update'|'delete', type='FUGR'|'FUNC', …)` reaches the verified live endpoints. Strip `*"…*"` comment-block lines from FM source PUT bodies and append a warning when stripped.

- [ ] Add a `FUNC` branch in the URL-resolution block at the top of `handleSAPWrite` (around line 2983, sibling to the existing TABL branch). Logic:
  - Read `args.group` as string. If missing AND action is `create`, return `errorResult('"group" is required to create a FUNC. Create the parent FUGR first or pass group explicitly.')`.
  - If missing AND action is `update`/`delete`, try `cachingLayer?.resolveFuncGroup(client, name) ?? client.resolveFunctionGroup(name)`. If still null, return `errorResult('Cannot resolve function group for FM "{name}". Provide group explicitly.')`.
  - Set `objectUrl = /sap/bc/adt/functions/groups/{group_lc}/fmodules/{name_encoded}`.
  - Set `srcUrl = ${objectUrl}/source/main`.
  - Mutate `args` to inject the resolved `group` (so `buildCreateXml` finds it via `properties.group`).
- [ ] FUGR does NOT need a special branch — `objectBasePath('FUGR')` already returns `/sap/bc/adt/functions/groups/` (verified at line 2831), so the existing fallback `objectUrlForType('FUGR', name)` produces the correct URL `/sap/bc/adt/functions/groups/{name}`. Just confirm by tracing in code; do NOT add a redundant branch.
- [ ] Confirm the `case 'create'` block's `createUrl = objectUrl.replace(/\/[^/]+$/, '')` derivation produces `/sap/bc/adt/functions/groups` (FUGR — `objectUrl` was `/sap/bc/adt/functions/groups/{name}`, strip trailing segment) and `/sap/bc/adt/functions/groups/{group_lc}/fmodules` (FUNC — `objectUrl` was `/sap/bc/adt/functions/groups/{group_lc}/fmodules/{name_lc}`, strip trailing segment) — both correct, no extra logic needed.
- [ ] In the `case 'update'` ABAP-source path, when `type === 'FUNC'`, call a new pure helper `stripFmParamCommentBlock(source)` BEFORE the lint / preflight steps. Capture `wasStripped: boolean`. If stripped, add a warning string `'Stripped *"…IMPORTING…*" parameter comment blocks (SAP rejects them on PUT — manage parameters via SAPGUI/Eclipse).'` to the existing `mergePreWriteWarnings` chain.
  - The helper lives next to `buildCreateXml`. It removes any line whose first non-whitespace tokens are `*"`. Standalone unit-tested in Task 6.
- [ ] In `createObject` invocation in `case 'create'` for FUGR, the existing `createObject` signature already passes `corrNr` for transports — works unchanged. For FUNC, the FM URL has the group in its path, so `corrNr` is also passed unchanged.
- [ ] In `case 'delete'` for FUNC and FUGR, the existing lock→delete→unlock pattern works as-is — both `objectUrl` values point at lockable resources.
- [ ] Add unit tests (~10 tests) in `tests/unit/handlers/intent.test.ts` under `describe('SAPWrite — FUGR/FUNC')`:
  - mocked-fetch FUGR create: asserts the request is `POST /sap/bc/adt/functions/groups`, body contains `adtcore:type="FUGR/F"`
  - mocked-fetch FUNC create with explicit group: asserts URL = `/sap/bc/adt/functions/groups/{group_lc}/fmodules`, body has `containerRef`
  - mocked-fetch FUNC create without group: returns errorResult with friendly message; no HTTP call made
  - mocked-fetch FUNC update: asserts URL = `/sap/bc/adt/functions/groups/{group_lc}/fmodules/{name_lc}/source/main`
  - mocked-fetch FUNC update auto-resolves group via search when omitted (use existing `searchObject` mock pattern)
  - mocked-fetch FUNC update strips param comment block — assert PUT body sent to SAP has no `*"…*"` lines AND response text includes the warning
  - mocked-fetch FUGR delete: asserts DELETE to `/sap/bc/adt/functions/groups/{name_encoded}`
  - mocked-fetch FUNC delete: asserts DELETE to `/sap/bc/adt/functions/groups/{group_lc}/fmodules/{name_lc}`
  - asserts the `objectBasePath('FUNC')` throw is unchanged (regression — read from `tests/unit/handlers/slash-type-map.test.ts`).
  - asserts allowedPackages still gates FUGR create (`SAP_ALLOWED_PACKAGES=ZARC1*` → creating FUGR in `$TMP` fails).
- [ ] Run `npm test` — all unit tests must pass.
- [ ] Run `npm run typecheck` and `npm run lint` — must be clean.

### Task 5: Update SAPWrite schema and tool description (`SAPWRITE_TYPES_ONPREM`, descriptions)

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`

Schema work and LLM-facing description text. `FUGR` is added to `SAPWRITE_TYPES_ONPREM`. The `group` parameter description in `SAPWriteSchema` (already a field on the schema) is extended to mention FUNC. Tool description gains a new line for FUNC/FUGR with the parameter-management caveat.

- [ ] Add `'FUGR'` to `SAPWRITE_TYPES_ONPREM` in `src/handlers/schemas.ts`. Keep BTP variant unchanged (FUGR write on BTP is out of scope — BTP doesn't deploy on-prem-style FUGR objects; the read path already excludes it).
- [ ] Update the `group` field description in `SAPWriteSchema` (and `batchObjectSchemaOnprem` if it accepts FUNC) to mention "Required for FUNC create. Auto-resolved via search for FUNC update/delete if omitted."
- [ ] In `src/handlers/tools.ts`, update the SAPWrite description string (~line 154) to list FUGR alongside FUNC and add the caveat: `For FUNC: "group" is required for create; FM parameter signatures (IMPORTING/EXPORTING) are NOT managed by ARC-1 — add them via SAPGUI/Eclipse after activation. For FUGR: a function-group container; create it before its function modules.`
- [ ] In `src/handlers/tools.ts` SAPWrite `properties.type.description` (around line 549), add `FUGR` to the supported list.
- [ ] Add unit test in `tests/unit/handlers/schemas.test.ts` asserting `SAPWriteSchema.safeParse({ action: 'create', type: 'FUGR', name: 'ZX' }).success === true`.
- [ ] Add unit test asserting `SAPWriteSchema.safeParse({ action: 'create', type: 'FUNC', name: 'Z_FM' }).success === true` (group is optional in schema; runtime check enforces it for create).
- [ ] Update `tests/unit/handlers/tools.test.ts` description-content assertion (the test at line ~541 that asserts `typeEnum NOT contain 'FUNC'` for SAPWrite-BTP must stay; nothing to change there for BTP). Add an on-prem-side assertion that the SAPWrite type enum DOES contain `FUGR` and `FUNC`.
- [ ] Run `npm test` — all unit tests must pass.
- [ ] Run `npm run typecheck` and `npm run lint` — must be clean.

### Task 6: Add `stripFmParamCommentBlock` helper and standalone tests

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Sanitization helper called by `handleSAPWrite` Task 4. Standalone so it can be tested without the full handler harness.

- [ ] Add exported function `stripFmParamCommentBlock(source: string): { source: string; wasStripped: boolean }` near `buildCreateXml`.
  - Strips lines whose first non-whitespace tokens are `*"`. SAP-emitted FM stubs use this exact prefix (verified live: `*"----`, `*"  IMPORTING`, etc.).
  - Does NOT strip ABAP comment lines starting with single `*` followed by anything else, nor inline `"` comments — only the SAPGUI param block prefix.
  - Returns `{ source: stripped, wasStripped: linesRemoved > 0 }`.
- [ ] Add unit tests (~6 tests):
  - Empty source → unchanged, `wasStripped: false`
  - Source with no comment block → unchanged, `wasStripped: false`
  - Source with full SAPGUI block (`*"----`, `*"*"Local Interface:`, `*"  IMPORTING`, …) → all `*"…` lines removed, `wasStripped: true`
  - Source with single `*` comment line (e.g. `* this is a real comment`) → unchanged
  - Source with inline `"` comment (e.g. `WRITE 'foo'. " comment`) → unchanged
  - Source with leading whitespace before `*"` (`  *"  IMPORTING ...`) → still stripped
- [ ] Run `npm test` — all unit tests must pass.

### Task 7: Run integration tests against live SAP, fix any failures

**Files:**
- Maybe-modify: `src/handlers/intent.ts` and helpers if integration test surfaces a gap
- Modify: `tests/integration/fugr-func.integration.test.ts` (refine assertions if shape differs)

This task is the integration-test green pass. The test from Task 1 already exists; now it must succeed against `TEST_SAP_URL` (A4H). Loop: run, observe, fix, re-run.

- [ ] Run `npm run test:integration -- fugr-func.integration` against A4H. Expected outcome: **green** after Tasks 3–6.
- [ ] If the test fails, debug: capture the actual SAP response, compare against the live recipe in Task 1, adjust the implementation. Common failure modes to expect:
  - Missing `Accept: application/vnd.sap.adt.functions.fmodules+xml` header on FM create — `createObject` may need the Accept header passthrough; verify by reading `src/adt/crud.ts`.
  - Lock-handle 423 on NPL — already handled by `ddicSkipReason`; verify the helper covers FM source PUT too.
  - Mixed-case URL handling — FUGR URL is lowercased, FM URL has lowercased group AND name segments. If the test breaks on case-sensitive lookups, consult the live recipe in Task 1.
- [ ] After green, run the full integration suite: `npm run test:integration` — must remain green (no regressions in TABL, DDLS, BDEF, etc.).
- [ ] Run `npm test` — must pass.
- [ ] Run `npm run typecheck` and `npm run lint` — must be clean.

### Task 8: Run E2E tests against running MCP server, fix any failures

**Files:**
- Maybe-modify: `src/handlers/intent.ts` if E2E surfaces a handler-level gap
- Modify: `tests/e2e/func-write.e2e.test.ts` (refine assertions if response shape differs)

This task is the E2E green pass. Requires an MCP server running at `E2E_MCP_URL` per `tests/e2e/vitest.e2e.config.ts`.

- [ ] Start the MCP server locally per `docs/setup-guide.md` (typically `npm run dev:http` with `SAP_*` env vars).
- [ ] Run `npm run test:e2e -- func-write`. Expected: **green**.
- [ ] Common failure modes:
  - Tool description mismatch between `tools.ts` and `schemas.ts` causing the MCP client to reject params (`group` not in schema) — Task 5 should have prevented this.
  - Error wording differs from what test asserts — refine the regex in the test, not the handler's user-friendly message (the message is the public API).
- [ ] After green, run the full E2E suite: `npm run test:e2e` — must remain green.
- [ ] Run `npm test` and `npm run typecheck` — must be clean.

### Task 9: Documentation and artifact updates

**Files:**
- Modify: `docs_page/tools.md`
- Modify: `compare/00-feature-matrix.md`
- Modify: `docs/roadmap.md`
- Modify: `CLAUDE.md`
- Modify: `README.md` (if it advertises SAPWrite type list)

Land all the doc updates the implementation triggers. The competitor evaluation file [`compare/fr0ster/evaluations/issue-77-fm-update-parameter-loss.md`](../../compare/fr0ster/evaluations/issue-77-fm-update-parameter-loss.md) gets an addendum noting ARC-1 closed the latent gap with explicit "no parameter management" caveat.

- [ ] `docs_page/tools.md` — under SAPWrite types, add rows for `FUGR` (function group) and update the `FUNC` row to note `group` requirement and the parameter-management caveat. Add an example near the existing FUNC examples.
- [ ] `compare/00-feature-matrix.md` — flip the ARC-1 cell on the existing `Function modules (FUNC)` and `Function groups (FUGR)` rows to ✅ for write. Refresh "Last Updated" line. Update the introduction-paragraph note about the latent FUNC-update gap to reflect that it has been closed for create + source-update; signature management still pending.
- [ ] `docs/roadmap.md` — find the FUNC-related entry (or add a new completed entry) noting issue #250 resolved.
- [ ] `CLAUDE.md` — Key Files for Common Tasks: add a row for "Add FUGR/FUNC create/update/delete" pointing at the URL-resolution block in `handleSAPWrite`, `buildCreateXml`, content-type helpers, and `stripFmParamCommentBlock`. Briefly note the parameter-management out-of-scope caveat.
- [ ] `README.md` — if a SAPWrite type list is advertised in the feature highlights, update it to include FUGR (and confirm FUNC is already there).
- [ ] `compare/fr0ster/evaluations/issue-77-fm-update-parameter-loss.md` — append a one-paragraph addendum: "Closed in ARC-1 PR #<num> (#250 follow-up): create + source-update + delete supported with `group` parameter; parameter signature management still upstream-blocked, surfaced as a one-line warning in tool responses."
- [ ] Run `npm test` — must remain green.

### Task 10: Final verification

- [ ] Run full test suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Run the new integration suite: `npm run test:integration -- fugr-func.integration` against A4H — green.
- [ ] Run the new E2E suite: `npm run test:e2e -- func-write` — green.
- [ ] Run the full integration suite: `npm run test:integration` — no regressions.
- [ ] Run the full E2E suite: `npm run test:e2e` — no regressions.
- [ ] Manual smoke from MCP client: `SAPWrite(action='create', type='FUGR', name='ZARC1_MAN_TEST', package='$TMP', description='manual test')` → `SAPWrite(action='create', type='FUNC', name='Z_MAN_FM', group='ZARC1_MAN_TEST', description='manual')` → SAPRead it → SAPWrite update with a `*"…"*` block in source → confirm the warning in the response. Cleanup with two SAPWrite delete calls. Document the manual smoke in the PR description.
- [ ] Move this plan to `docs/plans/completed/`.
