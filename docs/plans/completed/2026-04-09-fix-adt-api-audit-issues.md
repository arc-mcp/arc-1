# Fix ADT API Audit Issues

## Overview

This plan addresses all 11 confirmed issues from the ADT API audit (`docs/research/complete/2026-04-09-adt-api-audit-issues.md`). The core theme is replacing fragile regex-based XML parsers with proper `parseXml()` + `findDeepNodes()` parsing (using the existing fast-xml-parser v5 infrastructure), and enriching parser output to include all available SAP response data (line numbers, snippets, URIs, class names, alert messages).

Issue #9 (function group parser) was verified correct and requires no fix. Issue #12 (lock parser namespace) works as-is and requires no fix. That leaves 9 actionable issues.

## Context

### Current State
ARC-1 uses a mix of XML parsing approaches: some endpoints use the proper `parseXml()` + `findDeepNodes()` pattern (search results, package contents, domain metadata, etc.), while older endpoints (devtools, transport, diagnostics) use fragile regex-based parsers that assume XML attribute order and discard available data.

### Target State
All XML parsers use `parseXml()` + `findDeepNodes()` consistently. Response types include all available fields from SAP responses (line numbers, URIs, snippets, class names, alert messages, execution times). Dead code is removed.

### Key Files

| File | Role |
|------|------|
| `src/adt/devtools.ts` | Syntax check, activation, unit test, ATC parsers (Issues #1, #2, #3, #6, #11) |
| `src/adt/xml-parser.ts` | Source search parser, table contents parser (Issues #5, #8) |
| `src/adt/transport.ts` | Transport list parser (Issue #4) |
| `src/adt/diagnostics.ts` | Trace hitlist parser (Issue #7) |
| `src/adt/types.ts` | UnitTestResult, AtcFinding types need enrichment |
| `tests/unit/adt/devtools.test.ts` | Unit tests for devtools parsers |
| `tests/unit/adt/xml-parser.test.ts` | Unit tests for XML parsers |
| `tests/unit/adt/transport.test.ts` | Unit tests for transport parsers |
| `tests/unit/adt/diagnostics.test.ts` | Unit tests for diagnostics parsers |

### Design Principles

1. Use `parseXml()` + `findDeepNodes()` from `src/adt/xml-parser.ts` instead of regex — this handles any attribute order and is already the established pattern for newer parsers
2. Import `parseXml` and `findDeepNodes` into files that need them (devtools, transport, diagnostics already import from other modules)
3. Enrich return types with all available SAP data but keep existing fields backward-compatible (add optional fields, don't change required ones)
4. Every parser change requires updated unit tests with realistic SAP XML fixtures
5. The `AtcFinding` interface is defined in `src/adt/devtools.ts` (not `types.ts`) — update it there

## Development Approach

Tasks are ordered by priority (high-impact issues first). Each task is self-contained and modifies one parser + its tests. Run `npm test` after each task to verify no regressions.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Fix source search parser to extract match details (Issue #5)

**Files:**
- Modify: `src/adt/xml-parser.ts`
- Modify: `tests/unit/adt/xml-parser.test.ts`

This is the highest-impact fix. The `parseSourceSearchResults()` function at line ~268 finds objectReference elements but discards all match details (line numbers, snippets). The `textSearchResult` child elements need to be extracted.

- [x] In `src/adt/xml-parser.ts`, modify `parseSourceSearchResults()` (line ~268-284). In the first branch where `refs.length > 0`, extract `textSearchResult` child elements from each `ref` using `findDeepNodes(ref, 'textSearchResult')`. Map them to `{ line: Number(m['@_line'] ?? 0), snippet: String(m['@_snippet'] ?? m['#text'] ?? '') }` and assign to the `matches` array instead of `[]`
- [x] Add `'textSearchResult'` to the `isArray` list in the XMLParser config (line ~36) to ensure single results are still treated as arrays
- [x] Add unit tests (~4 tests) in `tests/unit/adt/xml-parser.test.ts` under `parseSourceSearchResults`:
  - Test objectReferences with textSearchResult children → matches populated with line/snippet
  - Test objectReference with single textSearchResult child → still returns array
  - Test objectReference with no textSearchResult children → matches is empty array
  - Test existing Atom feed fallback still works
- [x] Run `npm test` — all tests must pass

### Task 2: Fix unit test result parser to include class info and alerts (Issue #1)

**Files:**
- Modify: `src/adt/devtools.ts`
- Modify: `src/adt/types.ts`
- Modify: `tests/unit/adt/devtools.test.ts`

The `parseUnitTestResults()` function at line ~218 always returns empty `program` and `testClass` fields, and doesn't extract alert messages. Replace the regex parser with `parseXml()` + `findDeepNodes()`.

- [x] In `src/adt/devtools.ts`, add import: `import { parseXml, findDeepNodes } from './xml-parser.js';`
- [x] Rewrite `parseUnitTestResults()` (line ~218-239) to use `parseXml()`. Find `testClass` nodes via `findDeepNodes(parsed, 'testClass')`. For each testClass, extract `@_name` as className and extract program name from `@_uri` (split by `/`, take segment after `classes/` or `programs/`). Find `testMethod` nodes within each testClass via `findDeepNodes(tc, 'testMethod')`. For each method, check for `alert` children. Populate `program`, `testClass`, `testMethod`, `status`, `message` (from alert title), and `duration` (from `@_executionTime`)
- [x] In `src/adt/types.ts`, the `UnitTestResult` type (line ~72) already has optional `message` and `duration` fields — no type changes needed
- [x] Add `'testClass'`, `'testMethod'`, `'alert'` to the `isArray` list in `src/adt/xml-parser.ts` XMLParser config (line ~36)
- [x] Update existing unit tests in `tests/unit/adt/devtools.test.ts` (line ~198-244). Update the mock XML responses to include `<testClass>` wrappers with `name` attributes, e.g.: `<testResult><testClass name="LTCL_TEST" uri="/sap/bc/adt/oo/classes/ZCL_TEST/includes/testclasses"><testMethod name="test_success"/></testClass></testResult>`
- [x] Add new tests (~4 tests):
  - Test alert message extraction: XML with `<alert><title>Expected X got Y</title></alert>` → `message` populated
  - Test multiple test classes in one response → each result has correct testClass
  - Test `program` extracted from URI
  - Test `duration` populated from `executionTime` attribute
- [x] Run `npm test` — all tests must pass

### Task 3: Fix ATC findings parser to include URI and line number (Issue #2)

**Files:**
- Modify: `src/adt/devtools.ts`
- Modify: `tests/unit/adt/devtools.test.ts`

The `parseAtcFindings()` function at line ~241 always returns `uri: ''` and `line: 0`. Replace regex with `parseXml()` + `findDeepNodes()`.

- [x] In `src/adt/devtools.ts`, rewrite `parseAtcFindings()` (line ~241-257) to use `parseXml()` + `findDeepNodes(parsed, 'finding')`. For each finding node, extract `@_priority`, `@_checkTitle`, `@_messageTitle`, `@_uri`. Parse line number from URI fragment: if `@_uri` contains `#start=`, split on `=` and take first comma-separated number. Fallback to `@_location` attribute for URI if `@_uri` is missing
- [x] Add `'finding'` to the `isArray` list in `src/adt/xml-parser.ts` XMLParser config
- [x] Update the `AtcFinding` interface (line ~186 in devtools.ts) — no changes needed, `uri` and `line` already exist
- [x] Update existing ATC tests in `tests/unit/adt/devtools.test.ts` (line ~249-302). Update fixture XML to include `uri` and `location` attributes on `<finding>` elements: `<finding priority="1" checkTitle="Extended Check" messageTitle="Unused variable" uri="/sap/bc/adt/oo/classes/ZCL_TEST/source/main#start=42,1"/>`
- [x] Add new tests (~3 tests):
  - Test URI and line extraction from `#start=42,1` fragment
  - Test finding without URI → uri is empty, line is 0
  - Test ATC attribute order variation (priority after checkTitle) still parses correctly
- [x] Run `npm test` — all tests must pass

### Task 4: Fix ATC worklist ID extraction (Issue #6)

**Files:**
- Modify: `src/adt/devtools.ts`
- Modify: `tests/unit/adt/devtools.test.ts`

The `extractAttr(createResp.body, 'id')` at line ~175 may match the wrong `id` attribute. Should extract `worklistId` first.

- [x] In `src/adt/devtools.ts`, modify line ~175 to: `const worklistId = extractAttr(createResp.body, 'worklistId') || extractAttr(createResp.body, 'id') || '1';`
- [x] Add test (~1 test): mock ATC create response with both `id` and `worklistId` attributes: `<atc:run id="run123" worklistId="wl456"/>` → verify GET request uses `wl456`
- [x] Run `npm test` — all tests must pass

### Task 5: Fix syntax check parser to handle any attribute order (Issue #3)

**Files:**
- Modify: `src/adt/devtools.ts`
- Modify: `tests/unit/adt/devtools.test.ts`

The `parseSyntaxCheckResult()` regex at line ~197 assumes `type` before `line` before `col`. Replace with `parseXml()` + `findDeepNodes()`.

- [x] In `src/adt/devtools.ts`, rewrite `parseSyntaxCheckResult()` (line ~194-216) to use `parseXml()` + `findDeepNodes(parsed, 'msg')`. For each msg node, extract `@_type`, `@_line`, `@_col`, `@_shortText` as individual attribute accesses. Map type: `'E'` → `'error'`, `'W'` → `'warning'`, else `'info'`
- [x] Add `'msg'` to the `isArray` list in `src/adt/xml-parser.ts` XMLParser config
- [x] Add test (~1 test) for reversed attribute order: `<msg line="5" col="1" type="E" shortText="Error"/>` → still parsed correctly
- [x] Verify existing tests still pass with the new parser
- [x] Run `npm test` — all tests must pass

### Task 6: Fix activation error detection to avoid false positives (Issue #11)

**Files:**
- Modify: `src/adt/devtools.ts`
- Modify: `tests/unit/adt/devtools.test.ts`

The `activate()` and `activateBatch()` functions use `resp.body.includes('type="E"')` which can match URIs like `adtcore:type="ENHO/E"`. Replace with proper XML parsing.

- [x] In `src/adt/devtools.ts`, create a shared helper function `parseActivationResult(xml: string): { success: boolean; messages: string[] }` that uses `parseXml()` + `findDeepNodes(parsed, 'msg')`. Check for errors by testing `m['@_severity'] === 'error'` or `m['@_type'] === 'E'` or `m['@_type'] === 'A'` on `msg` nodes. Extract message texts from `@_shortText`. Handle empty body as success
- [x] Replace the inline string matching in both `activate()` (line ~54-64) and `activateBatch()` (line ~98-106) with calls to `parseActivationResult()`
- [x] Add tests (~2 tests):
  - Test that `adtcore:type="ENHO/E"` in a URI does NOT trigger false error detection
  - Test that `severity="fatal"` or `type="A"` are also detected as errors
- [x] Run `npm test` — all tests must pass

### Task 7: Fix transport list parser to handle any attribute order (Issue #4)

**Files:**
- Modify: `src/adt/transport.ts`
- Modify: `tests/unit/adt/transport.test.ts`

The `parseTransportList()` regex at line ~79 assumes exact attribute order. Replace with `parseXml()` + `findDeepNodes()`. Note: transport XML uses `tm:` namespace which is NOT stripped by the shared parser's `removeNSPrefix` — the parser config strips all namespace prefixes, so `tm:request` → `request`, `tm:number` → `number`, etc.

- [x] In `src/adt/transport.ts`, add import: `import { parseXml, findDeepNodes } from './xml-parser.js';`
- [x] Rewrite `parseTransportList()` (line ~77-95) to use `parseXml()`. Find `request` nodes (after NS strip, `tm:request` → `request`) via `findDeepNodes(parsed, 'request')`. For each request, extract `@_number` as id, `@_owner`, `@_desc` as description, `@_status`, `@_type`. Also extract child `task` elements via `findDeepNodes(req, 'task')` and map them to `TransportTask` objects with `@_number`, `@_desc`, `@_owner`, `@_status`
- [x] Add `'request'` to the `isArray` list in `src/adt/xml-parser.ts` XMLParser config (note: `'task'` is already in the list)
- [x] Update existing test fixtures in `tests/unit/adt/transport.test.ts` — the current fixtures use `tm:` namespace prefixed attributes (`tm:number`, `tm:owner`), which after NS stripping become just `number`, `owner`. The parseXml parser strips the namespace prefix from attributes too. Update test XML to match real SAP responses more closely (namespace-prefixed elements with `adtcore:`-style attributes)
- [x] Add tests (~2 tests):
  - Test transport with tasks: `<tm:request ...><tm:task tm:number="DEVK900001T" tm:owner="DEV1" tm:desc="Task 1" tm:status="D"/></tm:request>` → tasks array populated
  - Test attributes in different order → still parsed correctly
- [x] Also update `createTransport()` response parsing (line ~64): the regex `resp.body.match(/tm:number="([^"]*)"/)` should use `parseXml()` instead — extract `@_number` from the first `request` node found by `findDeepNodes(parsed, 'request')`
- [x] Run `npm test` — all tests must pass

### Task 8: Fix trace hitlist parser to use proper XML parsing (Issue #7)

**Files:**
- Modify: `src/adt/diagnostics.ts`
- Modify: `tests/unit/adt/diagnostics.test.ts`

The `parseTraceHitlist()` at line ~292 uses a primary regex with strict attribute order plus a fallback. Replace both with `parseXml()` + `findDeepNodes()`.

- [x] In `src/adt/diagnostics.ts`, add import if not already present: `import { parseXml, findDeepNodes } from './xml-parser.js';`
- [x] Rewrite `parseTraceHitlist()` (line ~292-330) to use `parseXml()` + `findDeepNodes(parsed, 'hitListEntry')`. For each entry, extract `@_callingProgram`, `@_calledProgram`, `@_hitCount`, `@_grossTime`, and `@_traceEventNetTime` (fallback to `@_netTime`)
- [x] Add `'hitListEntry'` to the `isArray` list in `src/adt/xml-parser.ts` XMLParser config
- [x] Add test (~1 test) with attributes in non-standard order → still parsed correctly
- [x] Run `npm test` — all tests must pass

### Task 9: Remove dead code in table contents parser (Issue #8)

**Files:**
- Modify: `src/adt/xml-parser.ts`
- Modify: `tests/unit/adt/xml-parser.test.ts`

The `@_dataPreview:name` fallback at line ~149 is dead code because `removeNSPrefix: true` strips the namespace prefix.

- [x] In `src/adt/xml-parser.ts`, change line ~149 from: `const name = String(metadata?.['@_name'] ?? metadata?.['@_dataPreview:name'] ?? '');` to: `const name = String(metadata?.['@_name'] ?? '');`
- [x] Verify existing `parseTableContents` tests still pass — no new tests needed since this is dead code removal
- [x] Run `npm test` — all tests must pass

### Task 10: Update documentation and audit report

**Files:**
- Modify: `docs/research/complete/2026-04-09-adt-api-audit-issues.md`
- Modify: `docs/tools.md`

Update the audit report to reflect that all issues have been fixed, and ensure documentation is accurate.

- [x] In `docs/research/complete/2026-04-09-adt-api-audit-issues.md`, add a "Resolution" section to each fixed issue noting it was resolved, with the approach taken (e.g., "Resolved: replaced regex parser with parseXml() + findDeepNodes()")
- [x] Review `docs/tools.md` for any descriptions that should reflect the enriched data now returned (e.g., SAPDiagnose section, SAPActivate, SAPWrite's run_tests action) — reviewed, docs are high-level and don't describe specific response fields, no changes needed
- [x] Run `npm test` — all tests must pass

### Task 11: Final verification

- [x] Run full test suite: `npm test` — all tests pass (1192 tests)
- [x] Run typecheck: `npm run typecheck` — no errors
- [x] Run lint: `npm run lint` — no errors
- [x] Verify that all `isArray` additions in `src/adt/xml-parser.ts` are correct and don't break other parsers
- [x] Move this plan to `docs/plans/completed/`
