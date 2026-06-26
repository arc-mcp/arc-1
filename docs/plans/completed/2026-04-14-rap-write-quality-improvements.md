# RAP Write Quality Improvements

## Overview

This plan addresses the two highest-impact code-level issues discovered during a RAP service generation session analysis (football clubs/players scenario). An LLM using the `generate-rap-service-researched.md` skill made ~40 tool calls with 62% waste — primarily caused by opaque error messages from DDIC save failures and a likely BDEF package-passing bug.

The two improvements target the root causes:
1. **Structured DDIC error messages** — When TABL/DDLS/BDEF saves fail, SAP returns generic "Can't save due to errors in source" (SBD_MESSAGES 007) with no field-level detail. The LLM retried 14 times on the same object because it couldn't diagnose which field or annotation was wrong. We'll parse structured error details from SAP's XML response and auto-run syntax check on save failures to surface actionable diagnostics.
2. **BDEF create package handling** — BDEF creation likely fails with 409 because the package is only passed in the XML body, not as a URL query parameter. Other "blue framework" types (TABL) may have the same issue. We'll add `_package` query parameter support to `createObject()`.

These are Tier 1C and 1D from the analysis. Tier 1A/1B (lint type-gating, per-call `lintBeforeWrite`, skill improvements) were already implemented in PR #117.

## Context

### Current State

**DDIC error handling chain:**
- `AdtApiError.extractCleanMessage()` (errors.ts line 47) extracts ONE primary `<localizedMessage>` from XML — gives "Can't save due to errors in source"
- `AdtApiError.extractAllMessages()` (errors.ts line 110) extracts secondary `<localizedMessage>` elements — but SAP DDIC errors use `<properties><entry key="...">` format, not multiple localizedMessages
- `AdtApiError.extractProperties()` (errors.ts line 130) extracts `<entry key="...">` pairs — gets T100KEY-MSGID, T100KEY-MSGNO, but NOT the structured field-level details that SAP embeds in SBD_MESSAGES responses
- `enrichWithSapDetails()` (intent.ts line 237) assembles extra messages + properties into the error — already has the right structure, just needs richer input
- `formatErrorForLLM()` (intent.ts line 204) adds hints for 404/401/403/500 errors — no DDIC-specific hint exists

**BDEF create flow:**
- `buildCreateXml('BDEF', ...)` (intent.ts line 1440) generates `<blue:blueSource>` with `<adtcore:packageRef>` in XML body
- `createObject()` (crud.ts line 53) builds URL as `objectUrl?corrNr=transport` — only passes transport, not package
- The create URL for BDEF is `/sap/bc/adt/bo/behaviordefinitions/` (intent.ts line 1603)
- TABL also uses the "blue" framework and the same `createObject()` call — same potential issue

**Syntax check limitation:**
- `syntaxCheck()` (devtools.ts line 16) hardcodes `chkrun:version="active"` — cannot check inactive (just-created, not-yet-activated) objects
- Need an option to check `inactive` version for post-save-failure diagnostics

### Target State

- DDIC save failures return structured, field-level error details (field name, annotation name, specific constraint violated)
- After a failed DDIC save, ARC-1 auto-runs syntax check on the object (inactive version) and appends those results to the error
- BDEF/TABL creation passes `_package` as URL query parameter alongside `corrNr`
- LLMs can diagnose and fix DDIC issues in 1-2 retries instead of 10+

### Key Files

| File | Role |
|------|------|
| `src/adt/errors.ts` | Error types, XML message extraction (extractCleanMessage, extractAllMessages, extractProperties) |
| `src/handlers/intent.ts` | Error formatting (formatErrorForLLM, enrichWithSapDetails), create flows (buildCreateXml, createObject calls at lines 1785 and 1980) |
| `src/adt/crud.ts` | createObject() — URL construction with transport param (line 53) |
| `src/adt/devtools.ts` | syntaxCheck() — hardcoded to `version="active"` (line 26) |
| `tests/unit/adt/errors.test.ts` | Unit tests for error extraction |
| `tests/unit/handlers/intent.test.ts` | Unit tests for intent handler (error formatting, create flows) |
| `tests/unit/adt/devtools.test.ts` | Unit tests for syntax check |
| `tests/unit/adt/crud.test.ts` | Unit tests for CRUD operations |

### Design Principles

1. **Additive enrichment** — Never replace the existing error message. Append structured details after it. The primary message is still useful context.
2. **Best-effort diagnostics** — If syntax check or enhanced parsing fails, fall through gracefully. Never block a user-visible error with a secondary failure.
3. **Backward compatible** — `createObject()` gains an optional `packageName` parameter. Existing callers are unaffected.
4. **LLM-optimized output** — Format diagnostic details as structured text that LLMs can parse and act on (field names, line numbers, specific rule violations).

## Development Approach

Tasks are ordered foundation-first: error parsing → syntax check enhancement → error formatting wiring → BDEF package fix → tests → docs. Each task is self-contained with explicit file paths and line references.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Enhanced DDIC error parsing in errors.ts

**Files:**
- Modify: `src/adt/errors.ts`
- Modify: `tests/unit/adt/errors.test.ts`

SAP DDIC save failures (TABL, DDLS, BDEF) return XML error responses with structured diagnostic detail beyond what `extractAllMessages()` and `extractProperties()` currently capture. The SBD_MESSAGES format embeds message class, number, and variable substitutions in `<entry>` elements. Add a new `extractDdicDiagnostics()` static method to `AdtApiError` that produces a structured, LLM-friendly summary.

- [ ] Read `src/adt/errors.ts` in full. Understand the three existing extraction methods: `extractCleanMessage()` (line 47, returns one primary message), `extractAllMessages()` (line 110, returns secondary localizedMessages), `extractProperties()` (line 130, returns key-value entries).
- [ ] Add a new static method `extractDdicDiagnostics(xml: string): DdicDiagnostic[]` to the `AdtApiError` class (after `extractProperties()`, around line 140). This method should:
  - Parse ALL `<localizedMessage>` elements (not just secondary ones) looking for field-level details
  - Parse `<entry key="...">` elements for T100KEY-MSGID, T100KEY-MSGNO, T100KEY-V1 through V4 (message variables that often contain field names)
  - Parse any `<properties>` blocks that contain line/column information
  - Return an array of `DdicDiagnostic` objects with: `{ messageId?: string, messageNumber?: string, variables: string[], lineNumber?: number, text: string }`
- [ ] Add the `DdicDiagnostic` interface export above the `AdtApiError` class definition
- [ ] Add a convenience method `formatDdicDiagnostics(xml: string): string` that formats the diagnostics array into an LLM-friendly multi-line string like:
  ```
  DDIC diagnostics:
    - [SBD/007] V1=FIELD_NAME, V2=ANNOTATION: Can't save due to errors
    - Line 5: Missing required annotation @AbapCatalog.enhancement.category
  ```
  If no structured diagnostics are found, return empty string (don't fabricate).
- [ ] Add unit tests (~10 tests) in `tests/unit/adt/errors.test.ts`:
  - Test `extractDdicDiagnostics()` with a real-world SBD_MESSAGES XML response containing T100KEY entries
  - Test with XML containing multiple `<entry>` elements with V1-V4 variables
  - Test with XML containing line/column properties
  - Test with empty/missing XML (returns empty array)
  - Test with non-DDIC error XML (returns empty array — no false positives)
  - Test `formatDdicDiagnostics()` output format
  - Test with XML that has localizedMessage but no properties (existing format, backward compatible)
- [ ] Run `npm test` — all tests must pass

### Task 2: Add inactive syntax check support to devtools.ts

**Files:**
- Modify: `src/adt/devtools.ts`
- Modify: `tests/unit/adt/devtools.test.ts`

The current `syntaxCheck()` function (devtools.ts line 16) hardcodes `chkrun:version="active"`, so it can only check already-activated objects. After a failed DDIC save, the object exists but is inactive — we need to check the inactive version to get server-side syntax errors. Add an optional `version` parameter.

- [ ] Read `src/adt/devtools.ts` lines 16-33 to see the current `syntaxCheck()` function signature and XML body.
- [ ] Add an optional `version` parameter to `syntaxCheck()`: change the signature from `syntaxCheck(http, safety, objectUrl)` to `syntaxCheck(http, safety, objectUrl, options?: { version?: 'active' | 'inactive' })`. Default remains `'active'` for backward compatibility.
- [ ] In the XML body template (line 26), change the hardcoded `chkrun:version="active"` to use the parameter: `chkrun:version="${options?.version ?? 'active'}"`.
- [ ] Add unit tests (~4 tests) in `tests/unit/adt/devtools.test.ts`:
  - Test that default call still uses `version="active"` in the request body
  - Test that `{ version: 'inactive' }` produces `version="inactive"` in the request body
  - Test that the response parsing works identically for both versions
  - Test backward compatibility: existing callers without the options parameter still work
- [ ] Run `npm test` — all tests must pass

### Task 3: Wire DDIC diagnostics into error formatting in intent.ts

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Connect the new `extractDdicDiagnostics()` and inactive syntax check into the error formatting pipeline. When a DDIC save fails (create or update for TABL, DDLS, BDEF, SRVD, SRVB, DDLX, DOMA, DTEL), enrich the error with structured diagnostics and optionally auto-run syntax check.

- [ ] Read `src/handlers/intent.ts` lines 237-260 (`enrichWithSapDetails()`) and lines 204-234 (`formatErrorForLLM()`). Also read lines 496-515 (the main error catch block).
- [ ] Import `formatDdicDiagnostics` from `../adt/errors.js` (add to the existing import of `AdtApiError` at the top of the file).
- [ ] Modify `enrichWithSapDetails()` (line 237) to call `AdtApiError.formatDdicDiagnostics(err.responseBody)` and append the result if non-empty. Add it between the existing `extraMessages` block and the `props` block. Example:
  ```typescript
  const ddicDetail = AdtApiError.formatDdicDiagnostics(err.responseBody ?? '');
  if (ddicDetail) {
    parts.push(ddicDetail);
  }
  ```
- [ ] Add a DDIC-specific hint in `formatErrorForLLM()` (around line 226, before the generic `return enriched`). Detect DDIC save failures by checking: status code 400 or 409, AND type is one of TABL/DDLS/BDEF/SRVD/SRVB/DDLX/DOMA/DTEL. When detected, append a hint like:
  ```
  Hint: DDIC save failed. Check the diagnostic details above for specific field or annotation errors. Common fixes: add missing @AbapCatalog annotations, fix field type names, check key field definitions.
  ```
  Access the `type` from `args.type` (already available in the function signature).
- [ ] Add unit tests (~6 tests) in `tests/unit/handlers/intent.test.ts`:
  - Test that `enrichWithSapDetails()` includes DDIC diagnostics when present in responseBody
  - Test that `enrichWithSapDetails()` doesn't add DDIC section when responseBody has no DDIC entries
  - Test that `formatErrorForLLM()` adds DDIC hint for 400 status + TABL type
  - Test that `formatErrorForLLM()` adds DDIC hint for 409 status + BDEF type
  - Test that `formatErrorForLLM()` does NOT add DDIC hint for 404 (uses not-found hint instead)
  - Test that `formatErrorForLLM()` does NOT add DDIC hint for PROG type (not DDIC)
- [ ] Run `npm test` — all tests must pass

### Task 4: Fix BDEF/TABL create to pass package as URL query parameter

**Files:**
- Modify: `src/adt/crud.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/adt/crud.test.ts`

BDEF creation likely fails with 409 because SAP's behavior definition endpoint requires the package as a URL query parameter (`_package=...`), not just in the XML body's `<adtcore:packageRef>`. The `createObject()` function (crud.ts line 53) only passes `corrNr` as a query parameter. Add optional `packageName` support.

- [ ] Read `src/adt/crud.ts` lines 52-67 (`createObject()` function). Note it currently constructs: `objectUrl?corrNr=<transport>`.
- [ ] Add an optional `packageName` parameter to `createObject()`: change the signature to `createObject(http, safety, objectUrl, body, contentType?, transport?, packageName?)`.
- [ ] Modify the URL construction in `createObject()` to append `_package=<packageName>` when provided. Use an array-based approach similar to `updateSource()` (line 80-87):
  ```typescript
  const params: string[] = [];
  if (transport) params.push(`corrNr=${encodeURIComponent(transport)}`);
  if (packageName) params.push(`_package=${encodeURIComponent(packageName)}`);
  const url = params.length > 0 ? `${objectUrl}?${params.join('&')}` : objectUrl;
  ```
- [ ] Read `src/handlers/intent.ts` lines 1780-1785 (single create call) and lines 1974-1980 (batch_create call). Both call `createObject()` — update both to pass `pkg` (the package variable) as the new `packageName` parameter for types that use the "blue" framework: BDEF, TABL. Check the type before passing to avoid unnecessary params for other types.
- [ ] For the single create path (line 1785), change:
  ```typescript
  // Before:
  const result = await createObject(client.http, client.safety, createUrl, body, contentType, effectiveTransport);
  // After:
  const needsPackageParam = type === 'BDEF' || type === 'TABL';
  const result = await createObject(client.http, client.safety, createUrl, body, contentType, effectiveTransport, needsPackageParam ? pkg : undefined);
  ```
- [ ] For the batch_create path (line 1980), apply the same pattern:
  ```typescript
  const needsPkgParam = objType === 'BDEF' || objType === 'TABL';
  await createObject(client.http, client.safety, createUrl, body, contentType, batchTransport, needsPkgParam ? pkg : undefined);
  ```
- [ ] Add unit tests (~5 tests) in `tests/unit/adt/crud.test.ts`:
  - Test `createObject()` without packageName: URL has no `_package` param (backward compatible)
  - Test `createObject()` with packageName: URL includes `_package=PKG_NAME`
  - Test `createObject()` with both transport and packageName: URL has both `corrNr` and `_package`
  - Test `createObject()` with packageName containing special characters (properly encoded)
  - Test `createObject()` with empty string packageName (treated as undefined, no param)
- [ ] Run `npm test` — all tests must pass

### Task 5: Post-save-failure syntax check in intent.ts

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

When a DDIC object save fails (create or update), auto-run syntax check (inactive version) on the object to get server-side diagnostics. This is a best-effort enhancement — if syntax check fails, we still return the original error.

- [ ] Read `src/handlers/intent.ts` lines 496-515 (the main `catch (err)` block in `handleToolCall()`). This is where all tool errors are caught and formatted.
- [ ] Import `syntaxCheck` from `../adt/devtools.js` at the top of the file (if not already imported).
- [ ] Create a new helper function `tryPostSaveSyntaxCheck(client, type, name): Promise<string>` near `enrichWithSapDetails()` (around line 260). This function should:
  - Only attempt syntax check for DDIC types: TABL, DDLS, BDEF, SRVD, SRVB, DDLX
  - Build the object URL using `objectUrlForType(type, name)` (already exists in the file)
  - Call `syntaxCheck(client.http, client.safety, objectUrl, { version: 'inactive' })`
  - Format the results as a string: `"\nServer syntax check (inactive):\n  - Line 5: error text\n  - Line 12: warning text"`
  - Wrap the entire body in try/catch — return empty string on any failure (best-effort)
  - Return empty string if no syntax errors found
- [ ] Wire the helper into `formatErrorForLLM()`. After the DDIC hint added in Task 3, check if `client` is available in the error context. Since `formatErrorForLLM()` currently doesn't have access to the client, the better approach is to call `tryPostSaveSyntaxCheck()` in the `catch` block of `handleSAPWrite()` specifically (find the write handler's catch, which is inside the create/update action handlers around lines 1785 and the error catch for the write flow). Add the syntax check result to the error message before it reaches `formatErrorForLLM()`.
- [ ] Specifically: in the `handleSAPWrite()` create action (around line 1785), wrap the `createObject` + source write in a try/catch. On failure, call `tryPostSaveSyntaxCheck()` and append the result to the error message before re-throwing. This way `formatErrorForLLM()` receives a richer error message without needing the client reference. Example:
  ```typescript
  try {
    await createObject(...);
  } catch (createErr) {
    if (createErr instanceof AdtApiError && (createErr.statusCode === 400 || createErr.statusCode === 409)) {
      const syntaxDetail = await tryPostSaveSyntaxCheck(client, type, name);
      if (syntaxDetail && createErr instanceof Error) {
        createErr.message += syntaxDetail;
      }
    }
    throw createErr;
  }
  ```
- [ ] Apply the same pattern in the batch_create path (around line 1980) — wrap the createObject call in try/catch, append syntax check detail on DDIC failures, re-throw.
- [ ] Add unit tests (~5 tests) in `tests/unit/handlers/intent.test.ts`:
  - Test that `tryPostSaveSyntaxCheck()` returns formatted syntax errors for a DDLS type
  - Test that `tryPostSaveSyntaxCheck()` returns empty string for non-DDIC types (PROG, CLAS)
  - Test that `tryPostSaveSyntaxCheck()` returns empty string when syntax check throws (best-effort)
  - Test that `tryPostSaveSyntaxCheck()` returns empty string when no syntax errors found
  - Test that the create path appends syntax check detail to the error message for TABL 400 errors
- [ ] Run `npm test` — all tests must pass

### Task 6: Documentation updates

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `CLAUDE.md`
- Modify: `skills/generate-rap-service-researched.md`

Update documentation to reflect the new DDIC error diagnostics and BDEF package fix.

- [ ] Read `docs/tools.md` and find the SAPWrite section. Add a note under the error handling or DDIC types documentation that DDIC save failures now return structured diagnostics including field-level errors, message variables, and auto-syntax-check results.
- [ ] Read `docs/roadmap.md`. If there is a RAP or DDIC error handling item, mark it as completed. If not, add a new entry under the appropriate section noting that structured DDIC error diagnostics were added.
- [ ] Read `CLAUDE.md`. Update the "Key Files for Common Tasks" table if any new patterns were added. Specifically, ensure the error handling row mentions `formatDdicDiagnostics` and the devtools row mentions the `version` parameter for syntax check.
- [ ] Read `skills/generate-rap-service-researched.md`. In the error recovery section, add guidance that DDIC errors now include structured diagnostics — LLMs should read the full error message for field-level detail rather than blindly retrying with different variations.
- [ ] Run `npm run lint` — no errors

### Task 7: Final verification

**Files:**
- Read: `src/adt/errors.ts`
- Read: `src/adt/crud.ts`
- Read: `src/adt/devtools.ts`
- Read: `src/handlers/intent.ts`

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify that `extractDdicDiagnostics()` is called from `enrichWithSapDetails()` by reading `src/handlers/intent.ts` and tracing the call chain
- [ ] Verify that `createObject()` in `src/adt/crud.ts` accepts and uses the `packageName` parameter
- [ ] Verify that `syntaxCheck()` in `src/adt/devtools.ts` accepts `{ version: 'inactive' }` option
- [ ] Verify that both create paths in intent.ts (single create ~line 1785, batch_create ~line 1980) pass `pkg` for BDEF/TABL types
- [ ] Move this plan to `docs/plans/completed/`
