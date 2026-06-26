# FEAT-16: Error Intelligence (Actionable Hints)

## Overview

Extend ARC-1's error handling to classify SAP ADT errors at the domain level and return actionable remediation hints that guide both LLMs and admins. Currently, `formatErrorForLLM()` handles basic HTTP status codes (404, 401/403, 5xx) and DDIC diagnostics, but misses SAP-domain patterns like object locks (409), enqueue errors (423), authorization object failures, activation dependency chains, and L-prefix include restrictions.

This plan adds a structured error classification system that extracts the ADT exception `type` attribute from XML responses (e.g., `ExceptionResourceNotFound`, `ExceptionResourceInvalidLockHandle`, `ExceptionResourceLockedByAnotherUser`) and maps them to SAP-domain hints with specific transaction references (SM12, SU53, SE09, SPAU). This directly improves LLM self-correction — instead of retrying blindly on a 409, the LLM gets "Object locked by user X in transport Y — use SAPTransport to check, or ask admin to release lock via SM12."

**Key design decision:** Error classification stays in the existing `formatErrorForLLM()` + `enrichWithSapDetails()` pipeline in `src/handlers/intent.ts`, with a new `classifySapDomainError()` function in `src/adt/errors.ts` that parses the XML `type` attribute. No new error classes — `AdtApiError` already captures everything needed. The classification is pure string matching on response bodies and type IDs, keeping it lightweight and testable.

## Context

### Current State

**What works (partial implementation from PR #119):**
- `extractCleanMessage()` — extracts human-readable text from XML/HTML/plain text errors
- `extractAllMessages()` — extracts secondary localized messages from multi-message XML
- `extractDdicDiagnostics()` — structured T100KEY parsing with line numbers and message variables
- `formatDdicDiagnostics()` — compact LLM-friendly DDIC diagnostic formatting
- `formatErrorForLLM()` — hints for: 404 (SAPSearch suggestion), 401/403 (credential check), transport errors (SE09), DDIC save (400/409), 5xx (SAPDiagnose suggestion)
- `getTransportHint()` — 4 transport error patterns (missing corrNr, transport not found, layer mismatch, S_TRANSPRT auth)

**What's missing (from roadmap and competitor analysis):**
- No parsing of XML `type` attribute (e.g., `ExceptionResourceLockedByAnotherUser`, `ExceptionResourceInvalidLockHandle`)
- No 409 lock conflict hints with user/transport extraction → SM12 reference
- No 423 enqueue/lock handle error hints
- No 403 authorization hints with S_DEVELOP/S_ADT_RES object awareness → SU53/PFCG reference
- No activation dependency chain detection → "activate dependencies first" hint
- No L-prefix include detection → "write to parent function module instead" hint
- No SPAU/adjustment mode detection
- No structured error type classification for audit/telemetry

**Competitor intelligence (from docs/compare folder):**
- **dassian-adt**: 8+ SAP-domain error patterns — SM12 lock entries, SPAU_ENH adjustment mode, L-prefix includes, activation dependencies, session timeout detection, URL path/object type mismatches, string template pipe issues
- **sapcli**: Typed error hierarchy — `ExceptionResourceAlreadyExists`, `ExceptionResourceNotFound`, connection error errno mapping with human-friendly messaging, HTML fallback parsing (issue #70)
- **fr0ster**: Full 409 conflict body extraction (user, transport, task number), 423 lock handle errors, HTML error page handling

**SAP error XML format (confirmed via live A4H system testing):**
```xml
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <namespace id="com.sap.adt"/>
  <type id="ExceptionResourceNotFound"/>
  <message lang="EN">I::000</message>
  <localizedMessage lang="EN">Object not found</localizedMessage>
  <properties>
    <entry key="T100KEY-ID"/>
    <entry key="T100KEY-NO">000</entry>
  </properties>
</exc:exception>
```

Key `type id` values observed in ADT responses:
- `ExceptionResourceNotFound` — 404
- `ExceptionMethodNotSupported` — 405
- `ExceptionResourceLockedByAnotherUser` — 409 (lock conflict)
- `ExceptionResourceInvalidLockHandle` — 423 (stale lock)
- `ExceptionResourceCreationFailure` — 400/409 (create failures)
- `ExceptionNotAuthorized` — 403 (authorization)

### Target State

- `classifySapDomainError()` in `src/adt/errors.ts` extracts the XML `type id` attribute and returns a structured classification with hint text and SAP transaction reference
- `formatErrorForLLM()` uses the classification to produce SAP-domain-aware hints for 409, 423, 403, 400 errors
- Lock conflict errors (409) extract the locking user and transport from the error message
- Authorization errors (403) suggest SU53 for last auth check and reference S_DEVELOP, S_ADT_RES
- Enqueue errors (423) suggest lock cleanup via SM12 or retry
- Activation failures detect dependency chains and suggest activation order
- L-prefix includes are detected with "write to parent function module" guidance
- Error classification is available to audit logging for telemetry
- E2E tests verify error hints for 404, 409, and validation errors against live SAP
- Skills are updated to reference error intelligence in troubleshooting steps

### Key Files

| File | Role |
|------|------|
| `src/adt/errors.ts` | New `classifySapDomainError()`, `extractExceptionType()`, `extractLockOwner()` functions |
| `src/handlers/intent.ts` | Extended `formatErrorForLLM()` with SAP-domain hints, use classification in audit |
| `tests/unit/adt/errors.test.ts` | Unit tests for new classification functions (~20 new tests) |
| `tests/unit/handlers/intent.test.ts` | Unit tests for new hint paths (~12 new tests) |
| `tests/e2e/smoke.e2e.test.ts` | E2E test for 404 error hint (already exists, verify still passes) |
| `docs/tools.md` | Note about error intelligence in tool descriptions |
| `docs/roadmap.md` | Mark FEAT-16 complete |
| `docs/compare/00-feature-matrix.md` | Update error intelligence row from ⚠️ to ✅ |
| `CLAUDE.md` | Update Key Files table with error classification entry |
| `.claude/commands/implement-feature.md` | Reference error intelligence for troubleshooting |

### Design Principles

1. **Classification, not interception** — Error classification is advisory. It enriches error messages with hints but never swallows errors, changes status codes, or alters retry behavior. The LLM sees the full original error plus a Hint section.

2. **Extract from what SAP gives us** — Parse the XML `type id` attribute and response body text. Don't guess based on HTTP status alone — a 409 could be a lock conflict or a save conflict; the `type id` tells us which.

3. **SAP transaction references are suggestions, not instructions** — Hints say "check SM12" not "run SM12". The LLM/user may not have GUI access. The hint provides enough context to understand the problem even without the transaction.

4. **Graceful when XML is missing** — Many error responses (401 HTML pages, 403 CSRF plain text, 500 HTML dumps) have no XML `type id`. Fall through to existing HTTP-status-based hints. Never fail on unparseable error bodies.

5. **Keep hints concise** — Each hint is 1-2 sentences. No multi-paragraph explanations. LLMs need quick signals, not documentation.

## Development Approach

- Build bottom-up: error extraction functions first, then classification, then handler integration
- Each new classification pattern gets a unit test with a realistic SAP XML fixture
- Test against live SAP A4H system for e2e validation
- Run full test suite after each task to prevent regressions

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add XML exception type extraction and SAP-domain error classification

**Files:**
- Modify: `src/adt/errors.ts`
- Modify: `tests/unit/adt/errors.test.ts`

Add functions to extract the ADT exception `type id` from XML error responses and classify errors into SAP-domain categories with actionable hints. This is the foundation all other tasks build on.

- [ ] Add `extractExceptionType(xml: string): string | undefined` function that extracts the `type id` attribute from SAP ADT exception XML. Use regex: `/<type\s+id="([^"]+)"\s*\/>|<type\s+id="([^"]+)">/`. Return undefined for non-XML or missing type.
- [ ] Add `extractLockOwner(text: string): { user?: string; transport?: string } | undefined` function that extracts the locking user and transport number from lock conflict messages. SAP lock messages typically contain patterns like "locked by user X" and "in task/transport NPLK900001". Return undefined if no lock owner found.
- [ ] Add `SapErrorClassification` interface: `{ category: string; hint: string; transaction?: string; details?: Record<string, string> }`. Categories: `'lock-conflict'`, `'enqueue-error'`, `'authorization'`, `'activation-dependency'`, `'transport-issue'`, `'object-exists'`, `'method-not-supported'`, `'unclassified'`.
- [ ] Add `classifySapDomainError(statusCode: number, responseBody?: string): SapErrorClassification | undefined` function. Classification logic based on XML type id AND response body patterns:
  - `ExceptionResourceLockedByAnotherUser` OR (409 + body contains "locked by") → `lock-conflict` category, extract user/transport, hint: "Object is locked by user {user} in transport {transport}. Check SM12 in SAP GUI for lock entries, or wait for the lock to be released."
  - `ExceptionResourceInvalidLockHandle` OR 423 → `enqueue-error` category, hint: "Lock handle is invalid or expired. The lock may have timed out. Retry the operation — ARC-1 will acquire a fresh lock. If the error persists, check SM12 for stale lock entries."
  - `ExceptionNotAuthorized` OR (403 + body contains "authorization" or "s_develop" or "s_adt_res") → `authorization` category, hint: "The SAP user lacks required authorization. Run transaction SU53 in SAP GUI to see the last failed authorization check. Common authorization objects: S_DEVELOP (development), S_ADT_RES (ADT resources), S_TRANSPRT (transports). Contact your basis administrator or check PFCG role assignments."
  - `ExceptionResourceCreationFailure` + body contains "already exists" → `object-exists` category, hint: "An object with this name already exists. Use SAPRead to check the existing object, or choose a different name."
  - Body contains "activate" + ("dependency" or "inactive" or "not active") → `activation-dependency` category, hint: "Activation failed due to inactive dependencies. Use SAPRead(type='INACTIVE_OBJECTS') to list all inactive objects, then activate dependencies first using SAPActivate."
  - Body matches L-prefix include pattern (e.g., `L<FUGR>U\d+`, `L<FUGR>F\d+`, `L<FUGR>TOP`) AND error is about write/create → no separate classification needed (already handled by BTP_HINTS for includes)
  - Body contains "adjustment" or "upgrade mode" or "spau" → hint: "SAP system is in adjustment/upgrade mode. Development changes may be blocked until the upgrade is complete. Check SPAU/SPAU_ENH in SAP GUI."
  - Return undefined for unclassifiable errors (let existing `formatErrorForLLM` handle them)
- [ ] Export `classifySapDomainError`, `extractExceptionType`, `extractLockOwner`, and `SapErrorClassification` from `src/adt/errors.ts`
- [ ] Add unit tests (~20 tests) for the new functions:
  - `extractExceptionType`: extracts type from standard SAP XML, handles namespace prefix, returns undefined for HTML/plain text/empty
  - `extractLockOwner`: extracts user and transport from "locked by user DEVELOPER in task E19K900001", handles missing parts, returns undefined for non-lock messages
  - `classifySapDomainError`: returns correct classification for each category (lock-conflict 409 XML, enqueue 423, authorization 403, object-exists, activation-dependency, adjustment mode), returns undefined for unclassifiable errors, works when responseBody is empty/undefined
- [ ] Run `npm test` — all tests must pass

### Task 2: Integrate SAP-domain classification into formatErrorForLLM

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Wire the new `classifySapDomainError()` from `src/adt/errors.ts` into the existing `formatErrorForLLM()` function in `src/handlers/intent.ts`. The classification should be checked BEFORE the existing HTTP-status-based hints, allowing domain-specific hints to take priority when available, while falling through to existing hints when classification returns undefined.

- [ ] Import `classifySapDomainError` from `../adt/errors.js` in `src/handlers/intent.ts`
- [ ] In `formatErrorForLLM()`, after the `enrichWithSapDetails()` call and before the existing `if (err.isNotFound)` check, add a classification attempt: `const classification = classifySapDomainError(err.statusCode, err.responseBody)`. If classification is defined, return `${enriched}\n\nHint: ${classification.hint}` with optional `\nSAP Transaction: ${classification.transaction}` when transaction is set.
- [ ] Keep existing hint paths as fallbacks — if classification returns undefined, the existing 404/401/403/transport/DDIC/5xx hints still apply. This ensures no regression for already-handled error patterns.
- [ ] Extend the `classifyError()` function (used in audit logging at line ~354) to include the SAP domain category when available. Add the classification category to the audit log's `errorClass` field as `AdtApiError:lock-conflict` format when a domain classification exists.
- [ ] Add unit tests (~12 tests) in the `formatErrorForLLM` test section of `tests/unit/handlers/intent.test.ts`:
  - 409 with lock conflict XML returns SM12 hint with user extraction
  - 423 with lock handle error returns enqueue hint
  - 403 with authorization XML returns SU53/PFCG hint
  - 409 with "already exists" returns object-exists hint
  - 400 with activation dependency message returns activation hint
  - Existing 404 hint still works (regression test)
  - Existing transport hint still works (regression test)
  - Existing DDIC save hint still works (regression test)
  - Existing 5xx hint still works (regression test)
  - Unclassifiable 409 falls through to existing behavior
  - Classification-enriched audit logging includes domain category
  - Network error still gets connectivity hint (no classification attempted)
- [ ] Run `npm test` — all tests must pass

### Task 3: Add E2E error hint tests

**Files:**
- Modify: `tests/e2e/smoke.e2e.test.ts`

Add E2E tests that verify error intelligence works end-to-end against the live SAP system. The existing 404 test already verifies the SAPSearch hint; add tests for additional error scenarios that can be safely triggered.

- [ ] Add test: "SAPWrite to read-only server returns safety error with clear message" — call `SAPWrite` with `action="create"` and verify the error contains "read-only" hint. This tests that safety errors produce actionable messages. Use `expectToolError(result, 'read-only')` or similar pattern matching.
- [ ] Add test: "SAPRead with invalid include returns Zod validation error" — call `SAPRead` with `type="CLAS", name="ZCL_ARC1_TEST", include="INVALID_INCLUDE"` and verify Zod produces a clear error listing valid include values.
- [ ] Add test: "SAPActivate for non-existent object returns 404 with hint" — call `SAPActivate` with `name="ZZZNOTEXIST999"`, `type="PROG"` and verify the error includes an actionable hint (object not found suggestion).
- [ ] Verify existing E2E error tests still pass: `SAPRead — 404 for non-existent program returns error with hint`, Zod validation error tests
- [ ] Run `npm run test:e2e` — all E2E tests must pass (requires running MCP server at `E2E_MCP_URL`)

### Task 4: Update documentation, roadmap, feature matrix, and skills

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `docs/tools.md`
- Modify: `CLAUDE.md`
- Modify: `.claude/commands/implement-feature.md`

Update all documentation artifacts to reflect the completed Error Intelligence feature.

- [ ] In `docs/roadmap.md`: Mark FEAT-16 as completed with current date. Update the status in the prioritized execution order table (line ~51) to `~~Completed YYYY-MM-DD~~`. Update the Phase B section (line ~173) similarly. Update the FEAT-16 detail section (line ~397) status to "Completed" with a summary of what was implemented. Update SEC-03 reference (line ~1371) to note FEAT-16 is now complete.
- [ ] In `docs/compare/00-feature-matrix.md`: Update the "Error intelligence (hints)" row (line ~211) from `⚠️ (LLM hints)` to `✅ (SAP-domain classification)` for ARC-1. Refresh the "Last Updated" date.
- [ ] In `docs/tools.md`: Add a brief "Error Intelligence" section or note under the general tool documentation explaining that ARC-1 automatically enriches SAP errors with actionable hints including SAP transaction references (SM12, SU53, SE09). This helps LLM users understand they'll get guided error messages.
- [ ] In `CLAUDE.md`: Update the "Key Files for Common Tasks" table — add a row for "Add SAP error classification" pointing to `src/adt/errors.ts` (`classifySapDomainError`), `src/handlers/intent.ts` (`formatErrorForLLM`). Update the "Improve DDIC save diagnostics" row description to also mention SAP-domain error classification.
- [ ] In `.claude/commands/implement-feature.md`: In the error handling / troubleshooting guidance section, add a note that ARC-1 provides SAP-domain error classification with transaction hints (SM12 for locks, SU53 for auth, SE09 for transports) — skills should reference these when guiding users through error resolution. If a `generate-rap-service.md` or similar RAP skill exists, note that activation dependency errors should be handled by checking `SAPRead(type='INACTIVE_OBJECTS')` before retrying activation.
- [ ] Run `npm run typecheck` and `npm run lint` — no errors

### Task 5: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Run E2E tests if available: `npm run test:e2e` — all tests pass
- [ ] Verify no unintended changes to existing error hint behavior by reviewing the test output for regression test names
- [ ] Move this plan to `docs/plans/completed/`
