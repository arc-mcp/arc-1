# CDS Write Robustness & Error Handling Improvements

## Overview

A real-world session creating a RAP football service on a 7.58 on-prem system exposed multiple issues in ARC-1's write path, error handling, and pre-write validation. The LLM wasted ~30 tool calls retrying failures that could have been prevented with proactive validation or better error messages. This plan addresses 8 improvements across three areas: (1) fix broken BDEF creation, (2) add CDS pre-write validation, (3) improve error handling and response quality.

## Context

### Current State

- **BDEF create is broken**: Uses wrong XML namespace (`bdef:behaviorDefinition` instead of `blue:blueSource`). Zero BDEF objects can be created via MCP — they must be created in ADT.
- **CDS `define table entity` fails silently on 7.58**: No version guard. The write proceeds to SAP and fails with a generic "DDL source could not be saved" — no indication that the syntax isn't supported on this system release.
- **CDS reserved keywords cause silent failures**: Field names like `position` fail during DDL save with no hint about the cause.
- **Error messages lose information**: `extractCleanMessage` only extracts the first `<localizedMessage>` from SAP's XML response, discarding additional messages with line/column detail.
- **INACTIVE_OBJECTS returns unguarded 404**: Documented feature, but no try/catch on systems where the endpoint is unavailable.
- **Empty DDLS source returns silent empty response**: No warning when a DDLS exists but has no source code.
- **503 errors have no retry or hint**: After heavy write/delete cycles, the server returned 503 with no retry attempt and a generic error message.
- **Transport hint false positive**: Fixed in PR #100. `getTransportHint()` now uses clean SAP error message instead of URL-containing `err.message`.

### Target State

- BDEF creation works (correct `blue:blueSource` XML and content type)
- CDS writes are validated before hitting SAP: table entity syntax rejected on old releases, reserved keyword warnings issued
- Error messages include all SAP diagnostic detail (line numbers, multiple messages)
- Graceful 404 handling for INACTIVE_OBJECTS
- Empty DDLS source returns an explicit warning
- 503 errors include a retry hint and could optionally retry once with delay
- `formatErrorForLLM` provides 5xx-specific guidance

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | Tool router: `buildCreateXml`, `formatErrorForLLM`, `getTransportHint`, `runPreWriteLint`, `handleSAPWrite`, `handleSAPRead` |
| `src/adt/errors.ts` | `AdtApiError`, `extractCleanMessage` — error construction and message extraction |
| `src/adt/http.ts` | HTTP transport: retry logic, `handleResponse` |
| `src/adt/devtools.ts` | `syntaxCheck` function |
| `src/adt/client.ts` | `getInactiveObjects`, `getDdls` |
| `src/adt/features.ts` | Feature probing, `ResolvedFeatures`, `abapRelease` |
| `src/lint/lint.ts` | `validateBeforeWrite`, pre-write lint config |
| `src/context/cds-deps.ts` | `extractCdsElements` |
| `tests/unit/handlers/intent.test.ts` | Tool handler unit tests |
| `tests/unit/adt/errors.test.ts` | Error class tests |

### Design Principles

1. **Fail fast with actionable messages** — detect and report issues before hitting SAP, not after 8 retries
2. **Never discard diagnostic information** — extract all messages from SAP XML responses, not just the first one
3. **Graceful degradation** — new checks should be best-effort; if `cachedFeatures` isn't available (no probe yet), proceed without blocking
4. **No silent empty responses** — always tell the LLM when something is unexpectedly empty

## Development Approach

Tasks are ordered by impact × effort. Each task is self-contained and can be merged independently. Tests mirror the source structure under `tests/unit/`. Run `npm test`, `npm run typecheck`, `npm run lint` after each task.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Fix BDEF create XML format

**Files:**
- Modify: `src/handlers/intent.ts` (lines 1202-1213 — `buildCreateXml` BDEF case, and lines ~1497 — content type)
- Modify: `tests/unit/handlers/intent.test.ts` (BDEF create test expectations)

The BDEF create body uses the wrong XML namespace. SAP expects `blue:blueSource` (namespace `http://www.sap.com/wbobj/blue`) with content-type `application/vnd.sap.adt.blues.v1+xml`. ARC-1 sends `bdef:behaviorDefinition` (namespace `http://www.sap.com/adt/bo/behaviordefinitions`) with `application/*`. This is confirmed by vibing-steampunk-origin (Go) and fr0ster (TypeScript) reference implementations.

- [ ] In `buildCreateXml()`, change the BDEF case (line 1202-1213) to:
  ```xml
  <blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue"
                   xmlns:adtcore="http://www.sap.com/adt/core"
                   adtcore:description="..." adtcore:name="..."
                   adtcore:type="BDEF/BDO"
                   adtcore:masterLanguage="EN"
                   adtcore:masterSystem="H00"
                   adtcore:responsible="DEVELOPER">
    <adtcore:packageRef adtcore:name="..."/>
  </blue:blueSource>
  ```
- [ ] In the content-type logic (around line 1497), add BDEF to the vendor-specific content type handling: `case 'BDEF': return 'application/vnd.sap.adt.blues.v1+xml'` — or modify `ddicContentTypeForType` / `isDdicMetadataType` to include BDEF, or add a separate condition. The simplest approach is to add a `bdefContentType` constant and check for it alongside `isDdicMetadataType`.
- [ ] Update existing BDEF create unit tests to expect the new XML format and content type
- [ ] Add unit test: BDEF create sends correct `blue:blueSource` XML body
- [ ] Add unit test: BDEF create uses `application/vnd.sap.adt.blues.v1+xml` content type
- [ ] Run `npm test` — all tests must pass

### Task 2: Extract all diagnostic messages from SAP error XML

**Files:**
- Modify: `src/adt/errors.ts` (`extractCleanMessage` method + new `extractAllMessages` method)
- Modify: `src/handlers/intent.ts` (`formatErrorForLLM` to include additional messages)
- Modify: `tests/unit/adt/errors.test.ts`

Currently `extractCleanMessage` (errors.ts line 47-74) only extracts the first `<localizedMessage>` from SAP's XML error response. DDL save errors often contain multiple messages with line/column information in `<properties>` entries. The full `responseBody` is preserved on `AdtApiError` but never surfaced to the LLM.

- [ ] Add a static method `AdtApiError.extractAllMessages(xml: string): string[]` that extracts all `<localizedMessage>` content from the XML response
- [ ] Add a static method `AdtApiError.extractProperties(xml: string): Record<string, string>` that extracts `<properties><entry key="K">V</entry></properties>` key-value pairs (line numbers, message IDs, etc.)
- [ ] In `formatErrorForLLM`, when the error is from a write operation (check if `_tool` is `SAPWrite` or `SAPActivate`), append additional messages from `err.responseBody` if available. Format as: `\n\nAdditional detail:\n- message2\n- message3\nProperties: T100KEY-NO=039, LINE=15`
- [ ] Add unit tests (~6 tests): single message, multiple messages, properties extraction, empty XML, HTML fallback, no extra messages case
- [ ] Run `npm test` — all tests must pass

### Task 3: Add CDS `define table entity` version guard

**Files:**
- Modify: `src/handlers/intent.ts` (in `handleSAPWrite` create/update DDLS path, after source is available)
- Modify: `tests/unit/handlers/intent.test.ts`

`define table entity` is only available from ABAP Cloud (BTP) or on-prem S/4HANA 2022+ (SAP_BASIS 757+). On 7.58, the write proceeds to SAP and fails with a generic error. The `cachedFeatures?.abapRelease` value is available at write time.

- [ ] After the source is available in the create/update DDLS flow, add a check:
  ```typescript
  if (type === 'DDLS' && source && /\bdefine\s+table\s+entity\b/i.test(source)) {
    const release = cachedFeatures?.abapRelease;
    const isBtp = cachedFeatures?.systemType === 'btp';
    if (!isBtp && release) {
      const releaseNum = parseInt(release.replace(/\D/g, ''), 10);
      if (releaseNum > 0 && releaseNum < 757) {
        return errorResult(
          `"define table entity" syntax requires ABAP Cloud (BTP) or S/4HANA on-premise with SAP_BASIS >= 757. ` +
          `This system reports SAP_BASIS ${release}. ` +
          `Use DDIC transparent tables (SE11 or SAPWrite type="TABL") + CDS view entities ("define [root] view entity") instead.`
        );
      }
    }
  }
  ```
- [ ] Place this check early — before AFF validation and before the `createObject` call
- [ ] The check is best-effort: if `cachedFeatures` is undefined (no probe run yet), skip the check and let SAP handle it
- [ ] Add unit tests (~4 tests): table entity on 7.58 returns error, table entity on BTP proceeds, table entity on 757+ proceeds, no cachedFeatures proceeds (no blocking)
- [ ] Run `npm test` — all tests must pass

### Task 4: Guard INACTIVE_OBJECTS 404 and warn on empty DDLS

**Files:**
- Modify: `src/handlers/intent.ts` (INACTIVE_OBJECTS handler ~line 798, DDLS read handler ~line 615)
- Modify: `tests/unit/handlers/intent.test.ts`

Two separate small fixes in the read path.

- [ ] Wrap the INACTIVE_OBJECTS handler (line 798-800) in a try/catch that catches `isNotFoundError` and returns a user-friendly message: `"Inactive objects listing is not available on this SAP system (the /sap/bc/adt/activation/inactive endpoint returned 404). Use SAPDiagnose(action='syntax') to check specific objects instead."`
- [ ] In the DDLS read handler (line 615-621), after fetching `ddlSource`, check if `ddlSource.trim() === ''`. If so, return: `"DDLS {name} exists in the object directory but has no source code stored. The DDL source may need to be written via SAPWrite(action='create'|'update', type='DDLS', name='{name}', source='...')."` For `include=elements` on empty source, return the same warning instead of a silent empty header.
- [ ] Add unit tests (~4 tests): INACTIVE_OBJECTS 404 returns friendly message, INACTIVE_OBJECTS success works, DDLS empty source warning, DDLS empty source with include=elements warning
- [ ] Run `npm test` — all tests must pass

### Task 5: Add 5xx error hints and 503 retry guidance

**Files:**
- Modify: `src/handlers/intent.ts` (`formatErrorForLLM`)
- Optionally modify: `src/adt/http.ts` (503 retry with short delay)
- Modify: `tests/unit/handlers/intent.test.ts`

Currently 500/502/503 errors get no specific hint. After heavy write/delete cycles, 503 appeared with no guidance.

- [ ] In `formatErrorForLLM`, add a check for 5xx status codes (check `err.statusCode >= 500`):
  ```typescript
  if (err.statusCode >= 500) {
    return `${message}\n\nHint: SAP application server error (${err.statusCode}). This is often transient — wait 10-30 seconds and retry. If the error persists, check SAPDiagnose(action="dumps") for short dumps, or verify the SAP system is responding via SAPRead(type="SYSTEM").`;
  }
  ```
  Place this check AFTER the transport hint check but BEFORE the default return.
- [ ] (Optional, lower priority) In `src/adt/http.ts` `handleResponse`, add a 503-specific single retry with a 2-second delay, similar to the DB connection retry pattern. Guard with a boolean `serverRetried` flag to prevent infinite loops. This is optional because the LLM can retry manually.
- [ ] Add unit tests (~3 tests): 500 error includes server hint, 503 error includes server hint, 502 error includes server hint
- [ ] Run `npm test` — all tests must pass

### Task 6: CDS reserved keyword pre-write warning

**Files:**
- Modify: `src/handlers/intent.ts` (add `warnCdsReservedKeywords` function, call from DDLS write path)
- Modify: `tests/unit/handlers/intent.test.ts`

CDS has context-sensitive reserved words that cause silent save failures. The field `position` caused ~8 retry cycles. A best-effort warning can catch common cases.

- [ ] Add a `warnCdsReservedKeywords(source: string): string | undefined` function that:
  1. Extracts field-name-like identifiers from `define ... { ... }` blocks using a regex (tokens after `:` on lines within braces)
  2. Checks them against a curated list of common CDS reserved/function keywords: `position`, `value`, `type`, `key`, `data`, `timestamp`, `language`, `text`, `source`, `target`, `name`, `description`, `concat`, `replace`, `substring`, `length`, `left`, `right`, `round`, `abs`, `floor`, `ceiling`, `division`, `mod`, `case`, `when`, `then`, `else`, `end`, `cast`, `coalesce`, `uuid`
  3. Returns a warning string listing the suspicious field names, or undefined if none found
- [ ] Call this function in the DDLS create/update path. If it returns a warning, do NOT block the write — append it as an advisory: `"\n\nWarning: field name(s) 'position' may be CDS reserved keywords. If the DDL save fails, rename them (e.g., 'playing_position')."`
- [ ] This is advisory only (non-blocking) because context matters — `position` may be valid in some positions
- [ ] Add unit tests (~5 tests): detects `position`, detects multiple keywords, ignores normal fields, works with nested structures, returns undefined for clean source
- [ ] Run `npm test` — all tests must pass

### Task 7: Documentation updates

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/mcp-usage.md`
- Modify: `CLAUDE.md` (if new patterns added)

Update documentation to reflect the improvements from Tasks 1-6.

- [ ] `docs/tools.md` SAPWrite section: document BDEF create support, CDS table entity version guard, reserved keyword warnings
- [ ] `docs/tools.md` SAPRead section: document INACTIVE_OBJECTS fallback behavior, empty DDLS source warning
- [ ] `docs/tools.md` SAPDiagnose section: add note about syntax check checking active (on-system) source, not proposed source
- [ ] `docs/mcp-usage.md`: add workflow for RAP stack creation (DDIC tables → CDS view entities → BDEF → SRVD → SRVB) with version considerations
- [ ] `docs/mcp-usage.md` error handling: add 5xx error guidance, CDS reserved keyword note
- [ ] `CLAUDE.md` Key Files table: add row for "Add CDS pre-write validation" → `src/handlers/intent.ts, src/lint/lint.ts`
- [ ] Run `npm test` — all tests must pass (doc-only changes, but verify nothing was broken)

### Task 8: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no new errors (pre-existing scratch file lint issues are acceptable)
- [ ] Verify BDEF create XML matches reference implementations (vibing-steampunk, fr0ster)
- [ ] When SAP system is available: run integration test creating a BDEF in $TMP with the new XML format
- [ ] Move this plan to `docs/plans/completed/`
