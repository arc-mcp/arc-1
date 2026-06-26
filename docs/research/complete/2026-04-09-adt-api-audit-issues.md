# ADT API Audit: Issues and Unexpected Behavior

**Date:** 2026-04-09
**Scope:** All SAP ADT REST API endpoints used in ARC-1 v0.6.0
**Method:** Source code analysis, XML parser verification against real SAP responses, reference implementation comparison (abap-adt-api, abapGit)

---

## Summary

Deep analysis revealed **11 confirmed issues** (1 originally flagged issue was verified correct after cross-referencing 3 independent implementations) ranging from fragile XML parsers to incomplete response handling. **All 9 actionable issues have been resolved** by replacing regex-based parsers with proper `parseXml()` + `findDeepNodes()` parsing, enriching response types with all available SAP data, and removing dead code. Issues #9 and #12 required no fix.

**Severity scale:**
- **Critical:** Will fail on customer systems, blocks functionality
- **High:** Returns incomplete/wrong data, may confuse LLM clients
- **Medium:** Works but fragile, may break with SAP system variations
- **Low:** Minor edge cases, cosmetic issues

---

## Issue 1: Unit Test Result Parser Returns Incomplete Data (High)

**File:** `src/adt/devtools.ts:218-239`
**API:** `POST /sap/bc/adt/abapunit/testruns`

### Problem
The `parseUnitTestResults()` function always returns empty strings for `program` and `testClass` fields:

```typescript
results.push({
  program: '',      // Always empty
  testClass: '',    // Always empty
  testMethod: methodName,
  status: hasAlert ? 'failed' : 'passed',
});
```

The actual SAP response contains rich information:
```xml
<testClass adtcore:uri="/sap/bc/adt/oo/classes/ZCL_TEST/includes/testclasses"
           adtcore:type="CLAS/OC" adtcore:name="LTCL_TEST" uriType="semantic">
  <testMethod adtcore:name="TEST_SOMETHING" executionTime="123" uriType="semantic">
    <alert kind="failedAssertion" severity="critical">
      <title>Assertion failed: expected 1 but got 2</title>
      <details>...</details>
      <stack><stackEntry .../>...</stack>
    </alert>
  </testMethod>
</testClass>
```

### Impact
- LLM receives test results without knowing which class/program the test belongs to
- Alert details (assertion messages, stack traces) are lost
- For classes with multiple test classes, it's impossible to tell which test class failed
- Execution time per method is not captured

### Fix Suggestion
Replace the regex-based parser with proper XML parsing using fast-xml-parser (already imported in the project):

```typescript
function parseUnitTestResults(xml: string): UnitTestResult[] {
  const parsed = parseXml(xml);
  const results: UnitTestResult[] = [];
  const testClasses = findDeepNodes(parsed, 'testClass');
  
  for (const tc of testClasses) {
    const className = String(tc['@_name'] ?? '');
    const program = String(tc['@_uri'] ?? '').split('/')[6] ?? ''; // extract from URI
    const methods = findDeepNodes(tc, 'testMethod');
    
    for (const method of methods) {
      const alerts = findDeepNodes(method, 'alert');
      results.push({
        program,
        testClass: className,
        testMethod: String(method['@_name'] ?? ''),
        status: alerts.length > 0 ? 'failed' : 'passed',
        message: alerts.length > 0 ? String(findDeepNodes(alerts[0], 'title')[0]?.['#text'] ?? '') : '',
      });
    }
  }
  return results;
}
```

### Test Impact
- Update `devtools.test.ts` mock responses to include `<testClass>` wrapper
- Add test for alert message extraction
- Add test for multiple test classes in one response

### Resolution
Resolved: replaced regex parser with `parseXml()` + `findDeepNodes()`. Now extracts `testClass` name from `@_name`, program from `@_uri`, alert messages from `<title>` children, and `executionTime` from `@_executionTime`. Added `testClass`, `testMethod`, `alert` to isArray config.

---

## Issue 2: ATC Findings Parser Missing URI and Line Number (High)

**File:** `src/adt/devtools.ts:241-257`
**API:** `GET /sap/bc/adt/atc/worklists/{id}`

### Problem
The `parseAtcFindings()` always returns `uri: ''` and `line: 0`:

```typescript
findings.push({
  priority: Number.parseInt(match[1]!, 10),
  checkTitle: match[2]!,
  messageTitle: match[3]!,
  uri: '',    // Never populated
  line: 0,    // Never populated
});
```

The actual ATC worklist response contains location information:
```xml
<finding priority="1" checkTitle="Performance" messageTitle="SELECT in loop"
         uri="/sap/bc/adt/oo/classes/ZCL_TEST/source/main#start=42,1"
         location="/sap/bc/adt/oo/classes/ZCL_TEST/source/main">
</finding>
```

### Impact
- LLM cannot navigate to the exact location of ATC findings
- Line numbers are critical for LLM to suggest fixes
- Without URI, it's impossible to know which include of a class has the issue

### Fix Suggestion
Extend the regex to capture `uri` attribute and parse line from the fragment:

```typescript
const findingRegex = /<finding[^>]*priority="(\d)"[^>]*checkTitle="([^"]*)"[^>]*messageTitle="([^"]*)"[^>]*(?:uri="([^"]*)")?[^>]*/g;
// ... then extract line from URI fragment: #start=42,1
```

Or better: use `parseXml()` + `findDeepNodes()` like other parsers.

### Resolution
Resolved: replaced regex parser with `parseXml()` + `findDeepNodes(parsed, 'finding')`. URI and line number are now extracted from `@_uri` (with `#start=` fragment parsing for line number). Added `finding` to isArray config.

---

## Issue 3: Syntax Check Parser Assumes Attribute Order (Medium)

**File:** `src/adt/devtools.ts:194-216`
**API:** `POST /sap/bc/adt/checkruns`

### Problem
The regex assumes attributes appear in order `type`, `line`, `col`:
```typescript
const msgRegex = /<msg[^>]*type="([^"]*)"[^>]*line="(\d+)"[^>]*col="(\d+)"[^>]*>/g;
```

If SAP returns attributes in a different order (which is valid XML), the regex won't match. For example:
```xml
<msg line="5" col="1" type="E" shortText="Syntax error"/>
```

### Impact
- On some SAP systems or versions, syntax errors may not be detected
- The code still works on all tested systems, but it's fragile

### Fix Suggestion
Use `parseXml()` instead of regex, or extract each attribute independently:

```typescript
const msgs = findDeepNodes(parseXml(xml), 'msg');
for (const msg of msgs) {
  messages.push({
    severity: msg['@_type'] === 'E' ? 'error' : msg['@_type'] === 'W' ? 'warning' : 'info',
    text: String(msg['@_shortText'] ?? ''),
    line: Number(msg['@_line'] ?? 0),
    column: Number(msg['@_col'] ?? 0),
  });
}
```

### Resolution
Resolved: replaced regex parser with `parseXml()` + `findDeepNodes(parsed, 'msg')`. Attributes are now extracted individually, so order doesn't matter. Added `msg` to isArray config.

---

## Issue 4: Transport List Parser Assumes Attribute Order (Medium)

**File:** `src/adt/transport.ts:77-95`
**API:** `GET /sap/bc/adt/cts/transportrequests`

### Problem
The regex assumes exact attribute order: `tm:number`, `tm:owner`, `tm:desc`, `tm:status`, `tm:type`:
```typescript
const trRegex = /<tm:request[^>]*tm:number="([^"]*)"[^>]*tm:owner="([^"]*)"[^>]*tm:desc="([^"]*)"[^>]*tm:status="([^"]*)"[^>]*tm:type="([^"]*)"/g;
```

### Impact
- If SAP returns attributes in different order, transports won't be parsed
- No task extraction (tasks are sub-elements of requests in the real response)
- Missing: target system, date, transport layer

### Fix Suggestion
Parse with `parseXml()` or use individual attribute extraction. Also extract tasks:

```typescript
const parsed = parseXml(xml);
const requests = findDeepNodes(parsed, 'request');
for (const req of requests) {
  const tasks = findDeepNodes(req, 'task');
  transports.push({
    id: String(req['@_number'] ?? ''),
    owner: String(req['@_owner'] ?? ''),
    description: String(req['@_desc'] ?? ''),
    status: String(req['@_status'] ?? ''),
    type: String(req['@_type'] ?? ''),
    tasks: tasks.map(t => ({ ... })),
  });
}
```

### Resolution
Resolved: replaced regex parser with `parseXml()` + `findDeepNodes(parsed, 'request')`. Attributes are extracted individually (order-independent). Task extraction added via `findDeepNodes(req, 'task')`. Also replaced `createTransport()` response parsing regex with XML parsing. Added `request` to isArray config.

---

## Issue 5: Source Search Response Parser Incomplete (High)

**File:** `src/adt/xml-parser.ts:268-318`
**API:** `GET /sap/bc/adt/repository/informationsystem/textSearch`

### Problem
The actual ADT textSearch response has a structure like:
```xml
<adtcore:objectReferences>
  <adtcore:objectReference uri="/sap/bc/adt/oo/classes/ZCL_TEST/source/main" 
                           type="CLAS/OC" name="ZCL_TEST" packageName="ZTEST">
    <adtcore:textSearchResult line="42" snippet="  DATA: lv_pattern TYPE string."/>
    <adtcore:textSearchResult line="55" snippet="  pattern = 'test'."/>
  </adtcore:objectReference>
</adtcore:objectReferences>
```

The parser's first branch (refs from objectReferences) correctly finds the objects but **discards all match details** (line numbers, snippets):
```typescript
for (const ref of refs) {
  results.push({
    objectType: String(ref['@_type'] ?? ''),
    objectName: String(ref['@_name'] ?? ''),
    uri: String(ref['@_uri'] ?? ''),
    matches: [],  // Always empty!
  });
}
```

### Impact
- LLM gets a list of objects that contain the search term but no line numbers or context
- For a class with 1000 lines, the LLM has to read the entire source to find the match
- This significantly reduces the value of source code search

### Fix Suggestion
Extract `textSearchResult` child elements from each objectReference:

```typescript
for (const ref of refs) {
  const matchNodes = findDeepNodes(ref, 'textSearchResult');
  results.push({
    objectType: String(ref['@_type'] ?? ''),
    objectName: String(ref['@_name'] ?? ''),
    uri: String(ref['@_uri'] ?? ''),
    matches: matchNodes.map(m => ({
      line: Number(m['@_line'] ?? 0),
      snippet: String(m['@_snippet'] ?? m['#text'] ?? ''),
    })),
  });
}
```

### Resolution
Resolved: extracted `textSearchResult` child elements from each `objectReference` using `findDeepNodes(ref, 'textSearchResult')`. Match details (line number, snippet) are now populated. Added `textSearchResult` to isArray config.

---

## Issue 6: ATC Worklist ID Extraction May Match Wrong Attribute (Medium)

**File:** `src/adt/devtools.ts:175`
**API:** `POST /sap/bc/adt/atc/runs?worklistId=1`

### Problem
```typescript
const worklistId = extractAttr(createResp.body, 'id') || '1';
```

The `extractAttr()` function uses a simple regex `id="([^"]*)"` which matches the **first** `id` attribute in the XML, regardless of which element it belongs to. The actual ATC run response looks like:
```xml
<atc:run id="run123" worklistId="wl456">
  <atc:object id="obj789"/>
</atc:run>
```

The function should extract `worklistId`, not `id`. It falls back to `'1'` which happens to work because the create URL already includes `?worklistId=1`.

### Impact
- Currently works by coincidence (fallback to '1')
- If SAP returns a different worklist ID, the wrong worklist would be fetched
- On systems with multiple concurrent ATC runs, this could return stale results

### Fix Suggestion
Extract the correct attribute:
```typescript
const worklistId = extractAttr(createResp.body, 'worklistId') || extractAttr(createResp.body, 'id') || '1';
```

### Resolution
Resolved: changed `extractAttr` call to prefer `worklistId` attribute over `id`, with fallback chain: `worklistId` → `id` → `'1'`.

---

## Issue 7: Trace Hitlist Parser Fragile Attribute Order (Medium)

**File:** `src/adt/diagnostics.ts:292-330`
**API:** `GET /sap/bc/adt/runtime/traces/abaptraces/{id}/hitlist`

### Problem
The primary regex requires attributes in exact order: `callingProgram`, `calledProgram`, `hitCount`, `grossTime`, then `traceEventNetTime|netTime`:
```typescript
const entryRegex = /<hitListEntry[^>]*callingProgram="([^"]*)"[^>]*calledProgram="([^"]*)"[^>]*hitCount="(\d+)"[^>]*grossTime="(\d+)"[^>]*(?:traceEventNetTime|netTime)="(\d+)"/g;
```

There is a fallback that uses individual attribute extraction, which is more robust.

### Impact
- If the primary regex fails due to attribute order, the fallback works
- However, the fallback uses a different element name pattern (`hitListEntry|entry`) which may match unrelated elements
- The fallback doesn't extract `netTime` properly if the attribute name varies

### Fix Suggestion
Use `parseXml()` + `findDeepNodes()` for consistent parsing.

### Resolution
Resolved: replaced dual regex (primary + fallback) with `parseXml()` + `findDeepNodes(parsed, 'hitListEntry')`. Attributes extracted individually, so order doesn't matter. Added `hitListEntry` to isArray config.

---

## Issue 8: Dead Code in Table Contents Parser (Low)

**File:** `src/adt/xml-parser.ts:149`

### Problem
After namespace stripping with `removeNSPrefix: true`, the attribute `dataPreview:name` becomes just `name`, so it's accessed as `@_name`. The fallback check:
```typescript
const name = String(metadata?.['@_name'] ?? metadata?.['@_dataPreview:name'] ?? '');
```

The `@_dataPreview:name` branch is dead code — it can never be reached because:
1. With `removeNSPrefix: true`, `dataPreview:name` → `name` → `@_name`
2. If `@_name` is undefined, `@_dataPreview:name` would also be undefined

### Impact
- No functional impact (dead code)
- Could confuse future maintainers

### Fix Suggestion
Remove the dead branch:
```typescript
const name = String(metadata?.['@_name'] ?? '');
```

### Resolution
Resolved: removed the dead `@_dataPreview:name` fallback branch. The `removeNSPrefix: true` config strips namespace prefixes, so `dataPreview:name` always becomes `name` (accessed as `@_name`).

---

## Issue 9: ~~Function Group Metadata Parser May Not Match Real Response~~ — VERIFIED CORRECT

**File:** `src/adt/xml-parser.ts:211-219`
**API:** `GET /sap/bc/adt/functions/groups/{name}`

### Verification Result
**This issue was initially flagged but is actually NOT a problem.** Deep research across three independent SAP ADT client implementations confirms the parser is correct:

1. **sapcli** (Python) registers the element as `'group'` under namespace `http://www.sap.com/adt/functions/groups`
2. **vibing-steampunk** (Go, ARC-1's predecessor) parses with `xml:"group"` and `xml:"functionModule"`
3. **abap-adt-api** (TypeScript) uses namespace prefix `group:` confirming the raw XML is `<group:group>`

The actual SAP XML response is:
```xml
<group:group xmlns:group="http://www.sap.com/adt/functions/groups"
             xmlns:adtcore="http://www.sap.com/adt/core"
             adtcore:name="ZUTILS" adtcore:type="FUGR/F">
  <group:functionModule adtcore:name="Z_GET_DATE" adtcore:type="FUNC/FM"/>
</group:group>
```

After `removeNSPrefix: true`, this becomes `<group>` with `<functionModule>` children — exactly what the current parser and fixture expect. **No fix needed.**

---

## Issue 10: createTransport XML Body May Not Match All SAP Versions (Medium)

**File:** `src/adt/transport.ts:53-66`
**API:** `POST /sap/bc/adt/cts/transportrequests`

### Problem
The create transport XML uses:
```xml
<tm:root xmlns:tm="http://www.sap.com/cts/transports">
  <tm:request tm:desc="..." tm:type="K" tm:target="..."/>
</tm:root>
```

Reference implementations (abap-adt-api) use a different format:
```xml
<asx:abap xmlns:asx="http://www.sap.com/abapxml">
  <asx:values>
    <DATA>
      <OPERATION>I</OPERATION>
      <DEVCLASS>ZPACKAGE</DEVCLASS>
      <REQUEST_TEXT>Description</REQUEST_TEXT>
    </DATA>
  </asx:values>
</asx:abap>
```

### Impact
- The `tm:` namespace format may work on some SAP versions but not others
- The `tm:target` attribute may not correctly set the target system/package
- Integration testing on a live system is needed to confirm

### Fix Suggestion
Test on actual SAP system. If it fails, switch to the asx:abap format used by abap-adt-api. Consider also that newer SAP systems may support both formats.

---

## Issue 11: Activation Response May Incorrectly Detect Success (Medium)

**File:** `src/adt/devtools.ts:55-56`
**API:** `POST /sap/bc/adt/activation`

### Problem
Success detection uses string matching:
```typescript
const hasErrors = resp.body.includes('severity="error"') || resp.body.includes('type="E"');
```

The actual activation response can return:
1. HTTP 200 with `<chkl:messages>` containing a `checkExecuted` / `activationExecuted` result
2. HTTP 200 with an empty body (success, no messages)
3. HTTP 200 with warning messages only (success)
4. HTTP 200 with error messages (failure)

The string matching approach may:
- False-positive: match `type="E"` in a URI attribute like `adtcore:type="ENHO/E"`
- Miss errors: if SAP uses `severity="fatal"` or `type="A"` (abort) instead

### Impact
- Activation could report success when it actually failed (if error format differs)
- `type="E"` could match in unexpected contexts

### Fix Suggestion
Use proper XML parsing and check status attributes on the root element:
```typescript
const parsed = parseXml(resp.body);
const msgs = findDeepNodes(parsed, 'msg');
const hasErrors = msgs.some(m => 
  m['@_severity'] === 'error' || m['@_type'] === 'E'
);
```

### Resolution
Resolved: replaced inline `resp.body.includes('type="E"')` string matching in both `activate()` and `activateBatch()` with a shared `parseActivationResult()` helper that uses `parseXml()` + `findDeepNodes(parsed, 'msg')`. Checks `@_severity === 'error'`, `@_type === 'E'`, and `@_type === 'A'` on proper msg nodes, eliminating false positives from URI attributes like `adtcore:type="ENHO/E"`.

---

## Issue 12: Lock Response Parser Doesn't Handle Namespace Prefixes (Low)

**File:** `src/adt/crud.ts:131-135`

### Problem
```typescript
function extractXmlValue(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  return match?.[1] ?? '';
}
```

This looks for `<LOCK_HANDLE>` without namespace prefix. The actual SAP response wraps values in `asx:` namespace:
```xml
<asx:abap xmlns:asx="http://www.sap.com/abapxml">
  <asx:values>
    <DATA>
      <LOCK_HANDLE>abc123</LOCK_HANDLE>
      <CORRNR>A4HK900100</CORRNR>
      <IS_LOCAL>X</IS_LOCAL>
    </DATA>
  </asx:values>
</asx:abap>
```

### Impact
- Currently works because `LOCK_HANDLE`, `CORRNR`, `IS_LOCAL` are inner elements without namespace prefix
- Would break if SAP changes to use namespace prefixes on data elements

### Fix Suggestion
No immediate fix needed — the current approach works with known SAP responses. Consider using `parseXml()` for consistency, but the regex is correct for the asx:abap format where inner DATA elements don't have namespace prefixes.

---

## Prioritized Fix Recommendations

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| 1 | #5 Source search missing match details | Small | High — LLM effectiveness |
| 2 | #1 Unit test parser incomplete | Medium | High — debugging workflow |
| 3 | #2 ATC findings missing location | Small | High — code quality workflow |
| ~~4~~ | ~~#9 Function group parser~~ | — | **Verified correct** — no fix needed |
| 5 | #6 ATC worklist ID extraction | Small | Medium — correctness |
| 6 | #3 Syntax check attribute order | Small | Medium — robustness |
| 7 | #4 Transport list attribute order | Small | Medium — robustness |
| 8 | #11 Activation false positive | Medium | Medium — safety |
| 9 | #10 Transport create XML format | Medium | Medium — compatibility |
| 10 | #7 Trace hitlist attribute order | Small | Low — fallback exists |
| 11 | #8 Dead code in table parser | Trivial | Low — cosmetic |
| 12 | #12 Lock parser namespace | None | Low — works as-is |
