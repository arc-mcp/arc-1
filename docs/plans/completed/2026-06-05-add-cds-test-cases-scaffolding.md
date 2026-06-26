# Add CDS Test-Case Scaffolding (`SAPDiagnose action=cds_testcases`)

## Overview

Add a new **read-only** diagnostic action `SAPDiagnose action=cds_testcases` that wraps the ABAP Platform 2025 (SAP_BASIS 8.16) ADT endpoint `GET /sap/bc/adt/aunit/dbtestdoubles/cds/testcases?ddlsourceName=<CDS>`. SAP analyzes a CDS entity and returns a list of **suggested ABAP Unit test cases** — one per testable semantic (the whole view, each calculated field, each CAST/CASE expression) — with a method name, a human description, the `semanticType`, and (when relevant) the `calculatedField` it covers. arc-1 returns this as structured JSON so the driving LLM can scaffold a `cl_cds_test_environment`-based unit test class.

This is the first ABAP-Platform-2025 capability (from `docs/research/2026-06-05-abap-platform-2025-new-adt-apis.md`, §5.1/§6 — ranked the #1 follow-up) and was chosen because it is small, self-contained, read-scoped, and **live-verified working without the Joule AI license**. The GET only returns *suggestions*; the AI generation siblings (`testdata`/`testmethod`, POST-only, Joule-licensed) are intentionally out of scope.

Key design decisions:
- **Mirror the `action=atc` pattern exactly** (`runAtcCheck`) — a read-scoped `SAPDiagnose` action that calls a `devtools.ts` function and returns `JSON.stringify`'d results. No new tool, no new config flag, no new top-level parameter (reuse `name` as the CDS entity).
- **Discovery-gate** the action on the `…/dbtestdoubles/cds/testcases` collection being advertised, so 7.5x / S/4HANA 2023 (758) degrade with a clear "needs SAP_BASIS 8.16+" message instead of a raw 404. This mirrors the existing `supportsExplicitTransportTarget` capability gate.
- **No probe-catalog entry.** `src/probe/catalog.ts` is keyed by 4-letter object `TypeCode`; `cds_testcases` is an endpoint, not an object type. Forcing a synthetic TypeCode would pollute the type union. Availability is covered by the discovery gate + the integration test instead.
- **Do not synthesize ABAP source.** Returning SAP's authoritative per-semantic suggestions (method names + what each covers) is the scaffolding; the LLM assembles the class. A short `hint` string points at the `cl_cds_test_environment=>create( i_for_entity = … )` pattern. (Generating namespaced ABAP class skeletons is error-prone — deferred.)

## Context

### Current State

- `SAPDiagnose` (`handleSAPDiagnose`, `src/handlers/intent.ts:~6205`) dispatches read-only diagnostic actions: `syntax`, `unittest`, `atc`, `object_state`, `quickfix`, `apply_quickfix`, `dumps`, `traces`, `system_messages`, `gateway_errors`.
- `action=atc` (`intent.ts:~6231`) calls `runAtcCheck(client.http, client.safety, objectUrl, variant)` in `src/adt/devtools.ts:~551` and returns `textResult(JSON.stringify(result, null, 2))`.
- There is **no** CDS-test-case capability. The endpoint `/sap/bc/adt/aunit/dbtestdoubles/cds/testcases` is new on SAP_BASIS 8.16; no arc-1 code, and no other known ADT client (`abap-adt-api`, `mcp-abap-adt*`), implements it.

### Target State

- `SAPDiagnose action=cds_testcases` with `name=<CDS entity>` returns JSON:
  ```json
  {
    "cds": "I_CURRENCY",
    "testCaseCount": 7,
    "testCases": [
      { "title": "Calculate ALTERNATIVECURRENCYKEY field", "testMethod": "calculate_altcurrkey",
        "description": "Test calculation of ALTERNATIVECURRENCYKEY field.",
        "semanticType": "CALCULATION", "calculatedField": "ALTERNATIVECURRENCYKEY" }
    ],
    "hint": "Scaffold an ABAP Unit test class: cl_cds_test_environment=>create( i_for_entity = 'I_CURRENCY' ); implement one FOR TESTING method per case, insert_test_data for the doubled sources, then assert with cl_abap_unit_assert."
  }
  ```
- On a system that does not advertise the endpoint (758, 7.5x): a clear error — "CDS test-case scaffolding requires SAP_BASIS 8.16+ (ABAP Platform 2025 / S/4HANA 2025); this system does not expose aunit/dbtestdoubles/cds/testcases."
- On a nonexistent/inactive CDS entity: the SAP `400` "CDS view X does not exist" surfaced via the normal `AdtApiError` → LLM-friendly error path.

### Verified Live Evidence (ground truth — captured 2026-06-05)

Tested against `a4h-2025.marianzeis.de:50100` (**816**) and `a4h.marianzeis.de:50000` (**758**), user MARIAN, client 001.

- **Request:** `GET /sap/bc/adt/aunit/dbtestdoubles/cds/testcases?ddlsourceName=I_CURRENCY`, header `Accept: application/vnd.sap.adt.aunit.dbtestdoubles.cds.testcases.v1+xml`.
- **816 → `200`**, `Content-Type: application/vnd.sap.adt.aunit.dbtestdoubles.cds.testcases.v1+xml; charset=utf-8`. Body (namespace-prefixed):
  ```xml
  <?xml version="1.0" encoding="utf-8"?>
  <cdstestcases:root xmlns:cdstestcases="http://www.sap.com/adt/dbtestdoubles/cds/testcases">
    <cdstestcases:cds>I_CURRENCY</cdstestcases:cds>
    <cdstestcases:testCases>
      <cdstestcases:testCase>
        <cdstestcases:title>Calculate ALTERNATIVECURRENCYKEY field</cdstestcases:title>
        <cdstestcases:testMethod>calculate_altcurrkey</cdstestcases:testMethod>
        <cdstestcases:description>Test calculation of ALTERNATIVECURRENCYKEY field.</cdstestcases:description>
        <cdstestcases:semanticType>CALCULATION</cdstestcases:semanticType>
        <cdstestcases:calculatedField>ALTERNATIVECURRENCYKEY</cdstestcases:calculatedField>
      </cdstestcases:testCase>
      <!-- … more testCase, semanticType also seen: NONE (whole view), CAST -->
    </cdstestcases:testCases>
  </cdstestcases:root>
  ```
  - `I_LANGUAGE` → 1 case, `semanticType=NONE`, `testMethod=test_cds_view`, no `calculatedField`.
  - `I_CURRENCY` → 7 cases (CALCULATION + CAST). `I_COUNTRY` → 8 cases. Real responses captured at `/tmp/cds-testcases-i_{language,currency,country}.xml` → copy into `tests/fixtures/xml/`.
- **816, bare GET (no `ddlsourceName`) → `400`**, and **nonexistent name → `400`** with:
  ```xml
  <exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
    <namespace id="com.sap.adt.testdoubles.cds"/><type id=""/>
    <message lang="EN">CDS view ZZZ_DOES_NOT_EXIST does not exist</message>
    <properties><entry key="T100KEY-ID">CDSTD_AI_MSG</entry><entry key="T100KEY-NO">002</entry>
      <entry key="T100KEY-V1">ZZZ_DOES_NOT_EXIST</entry></properties>
  </exc:exception>
  ```
- **816, `…/testcases/testdata` & `…/testcases/testmethod` GET → `405`** (POST-only, AI generation — out of scope).
- **758 → `404 "No suitable resource found"`** for every `…/cds/testcases` path. 758 discovery exposes only `dbtestdoubles/cds/{dependencies,dependencies/info,validation}` (3 collections); **816 also exposes `…/cds/testcases`, `…/testcases/testdata`, `…/testcases/testmethod`** (6 collections), and the `testcases` collection carries `<app:accept>application/vnd.sap.adt.aunit.dbtestdoubles.cds.testcases.v1+xml</app:accept>`.
- **Gate proof:** `resolveAcceptType(map, '/sap/bc/adt/aunit/dbtestdoubles/cds/testcases')` (`src/adt/discovery.ts:50`, longest-prefix *shallow* match) returns the v1+xml type on 816 and `undefined` on 758 (no `testcases` key, and `dependencies`/`validation` do not shallow-match the `testcases` path).
- **Source/feature provenance:** SAP plugin `com.sap.adt.testdoubles.cds.model_3.58.0.jar` (in `arc-1-lsp/vendor/adt-ls/…`); SAP's own MCP tool `abap_cds-test_cases` outputs exactly `{cds, testCases:[{title,testMethod,description,semanticType}]}` — arc-1 matches that contract (plus optional `calculatedField`). ADT-for-Eclipse 3.52 / AS ABAP 8.16 GA; runtime `cl_cds_test_environment` is older (7.51+) but the suggestion endpoint is new on 8.16.

### Key Files

| File | Role |
|------|------|
| `src/adt/devtools.ts` | Add `getCdsTestCases()`, `parseCdsTestCases()`, `supportsCdsTestCases()` (mirror `runAtcCheck`/`parseAtcFindings` at `:551`/`:1111`) |
| `src/adt/types.ts` | Add `CdsTestCase` + `CdsTestCasesResult` interfaces (next to `UnitTestResult` `:251`) |
| `src/handlers/intent.ts` | Add `case 'cds_testcases'` to `handleSAPDiagnose` (`:6205`, after `case 'atc'` `:6231`); gate + error mapping |
| `src/handlers/schemas.ts` | Add `'cds_testcases'` to `SAPDiagnoseSchema.action` enum (`:762`) |
| `src/handlers/tools.ts` | Add `'cds_testcases'` to the SAPDiagnose tool action enum + description (`:1113`) |
| `src/authz/policy.ts` | Add `'SAPDiagnose.cds_testcases': { scope: 'read', opType: OperationType.Read }` (`:112`) |
| `src/adt/http.ts` | (read-only) `hasDiscoveryData()` `:203`, `discoveryAcceptFor()` `:207` — used by the gate |
| `tests/fixtures/xml/cds-testcases-*.xml` | Real captured 816 responses for parser unit tests |
| `tests/unit/adt/devtools.test.ts` | Parser + gate unit tests (mirror `runAtcCheck` tests `:1584`) |
| `tests/unit/handlers/{intent,schemas,tools}.test.ts` | Handler + schema + tool-def tests |
| `tests/integration/adt.integration.test.ts` | Live 816 test (skip-policy when endpoint absent) — mirror ATC `:2204` |
| `tests/e2e/diagnostics.e2e.test.ts` | E2E via MCP `callTool` (skip when unavailable) |
| `docs/tools.md`, `CLAUDE.md`, `docs/research/abap-platform-2025-*.md`, `.claude/commands/implement-feature.md` | Documentation + skill update |

### Design Principles

1. **Mirror `action=atc` end-to-end** — same call signature shape `(http, safety, …)`, same `checkOperation(safety, OperationType.Read, …)`, same `JSON.stringify` return, same test patterns.
2. **Read-scoped only** — `OperationType.Read`, scope `read`. No writes, no AI generation endpoints.
3. **Discovery-gated, fail-soft** — known-absent → clear message; discovery-unknown → attempt and let a `404`/`400` map through the normal error path.
4. **Match SAP's own output contract** — `{cds, testCases:[{title, testMethod, description, semanticType, calculatedField?}]}` + a `hint`. No speculative ABAP-source synthesis.
5. **No new config / parameter / probe-type** — reuse `SAPDiagnose.name`; gate via discovery; availability via integration test.
6. **Parser keys on local element names** — `findDeepNodes(parsed, 'testCase')` (the existing `parseXml` strips namespace prefixes, proven by `parseAtcFindings` working on prefixed ATC XML).

## Development Approach

- TDD-ish: build the pure parser + gate first with the captured fixtures, then wire the handler, then schema/tool/policy, then live integration + E2E, then docs.
- Every code task ends by running `npm test`. Type/lint at the end of each code task.
- Integration/E2E use the skip-policy helpers — never silent `if (!x) return`.
- Copy the captured `/tmp/cds-testcases-*.xml` files into `tests/fixtures/xml/` verbatim (do not hand-edit; they are real server output).

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Types, parser, ADT client function, and discovery gate

**Files:**
- Modify: `src/adt/types.ts`
- Modify: `src/adt/devtools.ts`
- Create: `tests/fixtures/xml/cds-testcases-i_currency.xml` (copy from `/tmp/cds-testcases-i_currency.xml`)
- Create: `tests/fixtures/xml/cds-testcases-i_language.xml` (copy from `/tmp/cds-testcases-i_language.xml`)
- Modify: `tests/unit/adt/devtools.test.ts`

Foundation: the pure XML→object parser, the HTTP read function, and the capability gate. Mirror `runAtcCheck` (`devtools.ts:~551`) and `parseAtcFindings` (`:~1111`).

- [ ] In `src/adt/types.ts` (next to `UnitTestResult`, `:~251`) add:
  ```ts
  export interface CdsTestCase {
    title: string;
    testMethod: string;
    description: string;
    semanticType: string;
    calculatedField?: string;
    conditionScenario?: string;
  }
  export interface CdsTestCasesResult {
    cds: string;
    testCaseCount: number;
    testCases: CdsTestCase[];
  }
  ```
- [ ] In `src/adt/devtools.ts`:
  - Add `CdsTestCase, CdsTestCasesResult` to the `import type { … } from './types.js'` block (`:~13`).
  - Add `supportsCdsTestCases(http: AdtHttpClient): boolean | undefined` mirroring `supportsExplicitTransportTarget` (`src/adt/transport.ts:307`): `if (!http.hasDiscoveryData()) return undefined; return http.discoveryAcceptFor('/sap/bc/adt/aunit/dbtestdoubles/cds/testcases') !== undefined;`
  - Add `export async function getCdsTestCases(http, safety, ddlsourceName: string): Promise<CdsTestCasesResult>`:
    - `checkOperation(safety, OperationType.Read, 'GetCdsTestCases');`
    - `const path = `/sap/bc/adt/aunit/dbtestdoubles/cds/testcases?ddlsourceName=${encodeURIComponent(ddlsourceName)}`;`
    - `const resp = await http.get(path, { Accept: 'application/vnd.sap.adt.aunit.dbtestdoubles.cds.testcases.v1+xml' });`
    - `return parseCdsTestCases(resp.body);`
  - Add `function parseCdsTestCases(xml: string): CdsTestCasesResult` mirroring `parseAtcFindings`:
    - `const parsed = parseXml(xml);`
    - read `cds`: `const cdsNode = findDeepNodes(parsed, 'cds')[0]; const cds = String((cdsNode as Record<string, unknown>)?.['#text'] ?? cdsNode ?? '').trim();` (the `<cds>` element holds text; guard for the string-leaf case)
    - `const nodes = findDeepNodes(parsed, 'testCase');`
    - map each node, reading child text via a small local helper `text(v)` that returns `''` for nullish, `String(v)` for string leaves, and `String(v['#text'] ?? '')` for object nodes (mirror the `message` extraction in `parseUnitTestResults` `:~847`). Include `calculatedField`/`conditionScenario` only when the child node is present and non-empty.
    - `return { cds, testCaseCount: testCases.length, testCases };`
- [ ] Copy the two captured fixtures into `tests/fixtures/xml/` (verbatim server output).
- [ ] Add unit tests (~8 tests) in `tests/unit/adt/devtools.test.ts` (new `describe('getCdsTestCases')` + `describe('parseCdsTestCases')`, mirror the `runAtcCheck` block `:1584`):
  - `parseCdsTestCases` on the I_CURRENCY fixture → `cds==='I_CURRENCY'`, `testCaseCount===7`, first case `{testMethod:'calculate_altcurrkey', semanticType:'CALCULATION', calculatedField:'ALTERNATIVECURRENCYKEY'}`, and at least one `semanticType==='CAST'`.
  - `parseCdsTestCases` on the I_LANGUAGE fixture → 1 case, `semanticType==='NONE'`, `testMethod==='test_cds_view'`, `calculatedField` undefined.
  - `getCdsTestCases` issues a GET to `/sap/bc/adt/aunit/dbtestdoubles/cds/testcases?ddlsourceName=I_CURRENCY` with the v1+xml Accept (assert via the `mockHttp`/`vi.fn()` `http.get` spy) and returns the parsed result.
  - `supportsCdsTestCases`: returns `undefined` when `hasDiscoveryData()` is false; `true` when `discoveryAcceptFor` returns the type; `false` when it returns `undefined`. (Stub the `http` object's two methods.)
  - `getCdsTestCases` enforces safety: a `SafetyConfig` with reads disabled throws `AdtSafetyError` (mirror existing devtools safety tests).
- [ ] Run `npm test` — all tests must pass.

### Task 2: Wire `cds_testcases` into `handleSAPDiagnose`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Add the handler case. It validates `name`, gates on discovery, calls `getCdsTestCases`, and returns JSON with a scaffolding `hint`. Maps the SAP `400`/`404` to a clear message.

- [ ] Add `getCdsTestCases, supportsCdsTestCases` to the existing `devtools.js` import in `intent.ts` (the same import that brings in `runAtcCheck`).
- [ ] In `handleSAPDiagnose` (`:~6205`), add after `case 'atc'` (`:~6236`):
  ```ts
  case 'cds_testcases': {
    if (!name) return errorResult('"name" (the CDS entity / DDLS source name) is required for "cds_testcases".');
    if (supportsCdsTestCases(client.http) === false) {
      return errorResult(
        'CDS test-case scaffolding requires SAP_BASIS 8.16+ (ABAP Platform 2025 / S/4HANA 2025). ' +
          'This system does not expose /sap/bc/adt/aunit/dbtestdoubles/cds/testcases.',
      );
    }
    const result = await getCdsTestCases(client.http, client.safety, name);
    const payload = {
      ...result,
      hint:
        `Scaffold an ABAP Unit test class for ${result.cds}: ` +
        `cl_cds_test_environment=>create( i_for_entity = '${result.cds}' ) in class_setup; ` +
        'implement one FOR TESTING method per case (insert_test_data for the doubled sources, ' +
        'then assert with cl_abap_unit_assert). testdata/testmethod AI generation is not exposed.',
    };
    return textResult(JSON.stringify(payload, null, 2));
  }
  ```
  - Note: `cds_testcases` does NOT need `type`/`objectUrlForType` — the CDS name goes straight into the `ddlsourceName` query param. Do not build an object URL.
  - Let `getCdsTestCases` throw on SAP `400`/`404`; the existing `handleToolCall` error formatter (`formatErrorForLLM`) renders the "CDS view X does not exist" exception. Do NOT swallow it.
- [ ] Add unit tests (~5 tests) in `tests/unit/handlers/intent.test.ts` (new `describe('SAPDiagnose cds_testcases')`, mirror the `object_state` block `:~2479`, using `mockFetch`):
  - Success: mock discovery so the gate passes (the client built by `createClient()` must report the endpoint available — set up `mockFetch` so the discovery GET returns a doc containing the `testcases` collection, OR stub the gate by mocking the testcases GET and ensuring the handler still calls it; prefer driving the real path by returning the captured fixture body for the testcases URL). Assert `payload.cds`, `payload.testCaseCount`, `payload.testCases[0].testMethod`, and that `payload.hint` contains `cl_cds_test_environment`.
  - Missing `name` → `isError` truthy, message mentions `name`.
  - Gated out: when discovery advertises no `testcases` collection (758-like), the handler returns the "requires SAP_BASIS 8.16+" error WITHOUT issuing the testcases GET.
  - SAP 400 (nonexistent CDS): mock the testcases GET to return `400` + the exception body → result `isError` truthy and message contains "does not exist".
- [ ] Run `npm test` — all tests must pass.

### Task 3: Schema, tool definition, and authorization policy

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/authz/policy.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`
- Modify: `tests/unit/authz/policy.test.ts` (if present; else assert via an existing policy test file)

Expose the action to LLMs and enforce the read scope. The three-file tool-schema sync (tools.ts / schemas.ts / intent.ts) must stay consistent.

- [ ] `src/handlers/schemas.ts` (`SAPDiagnoseSchema`, `:~762`): add `'cds_testcases'` to the `action` z.enum (place after `'atc'`). No new field — `name` already exists.
- [ ] `src/handlers/tools.ts` (SAPDiagnose def, `:~1113`): add `'cds_testcases'` to the `action.enum` array AND add a bullet to the description, e.g.:
  `- "cds_testcases": Get SAP-suggested ABAP Unit test cases for a CDS entity (CDS Test Double Framework). Requires name (the CDS entity / DDLS source name). Returns per-semantic test-method suggestions (whole-view, calculated fields, CAST/CASE). Read-only; SAP_BASIS 8.16+ (ABAP Platform 2025) only.`
  Also extend the `name` property description to mention cds_testcases.
- [ ] `src/authz/policy.ts` (`:~112`, in the SAPDiagnose block): add `'SAPDiagnose.cds_testcases': { scope: 'read', opType: OperationType.Read },`.
- [ ] Add unit tests:
  - `tests/unit/handlers/schemas.test.ts` (`SAPDiagnoseSchema` block `:~1226`): `safeParse({ action: 'cds_testcases', name: 'I_CURRENCY' }).success === true`.
  - `tests/unit/handlers/tools.test.ts` (SAPDiagnose test `:~399`): assert `actionEnum` contains `'cds_testcases'`.
  - Policy: assert `ACTION_POLICY['SAPDiagnose.cds_testcases'].scope === 'read'` (add to the existing policy test, or `tests/unit/authz/policy.test.ts`).
- [ ] Run `npm test` — all tests must pass.

### Task 4: Live integration test (816), skip-safe on other releases

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

Validate the real flow against a live system. The endpoint exists only on 8.16+, so use the skip-policy when it is absent (758/7.5x integration runs must skip cleanly, not fail).

- [ ] Add a `describe('getCdsTestCases (CDS test double suggestions)')` block (mirror the ATC block `:~2204`), using `getTestClient()`:
  - Before calling, check availability via `supportsCdsTestCases(client.http)`; if `=== false`, `requireOrSkip(ctx, false, SkipReason.UNSUPPORTED_BACKEND_or_equivalent)` with a reason like "aunit/dbtestdoubles/cds/testcases not available (needs SAP_BASIS 8.16+)". (Pick the existing `SkipReason` constant that matches "feature not on this backend"; add one to `tests/helpers/skip-policy.ts` if none fits, keeping the four-file taxonomy in sync per CLAUDE.md.)
  - When available: `const r = await getCdsTestCases(client.http, unrestrictedSafetyConfig(), 'I_CURRENCY');` then assert `r.cds === 'I_CURRENCY'`, `r.testCaseCount > 0`, every case has non-empty `title`/`testMethod`/`semanticType`, and at least one `semanticType === 'CALCULATION'`.
  - Add a second case: nonexistent CDS → `expectSapFailureClass(err, [400], [/does not exist/i])`.
- [ ] Run the integration suite against 816 (operator step — credentials from `.env.infrastructure` `SAP_A4H_2025_*`): `TEST_SAP_URL=http://a4h-2025.marianzeis.de:50100 TEST_SAP_USER=MARIAN TEST_SAP_PASSWORD=… TEST_SAP_CLIENT=001 npx vitest run -c vitest.integration.config.ts -t "getCdsTestCases"` — confirm pass on 816 and clean skip on 758.
- [ ] Run `npm test` (unit) — still green.

### Task 5: E2E test via MCP

**Files:**
- Modify: `tests/e2e/diagnostics.e2e.test.ts`

Exercise the full MCP JSON-RPC stack. Skip when the server's target system doesn't expose the endpoint (use `classifyToolErrorSkip` / the e2e skip helper).

- [ ] Add a `describe('SAPDiagnose cds_testcases')` block (mirror the `dumps` block):
  - `const result = await callTool(client, 'SAPDiagnose', { action: 'cds_testcases', name: 'I_CURRENCY' });`
  - If the tool errors with the "requires SAP_BASIS 8.16+" / not-available message, skip via the e2e skip classifier (`tests/e2e/helpers.ts` `classifyToolErrorSkip`); otherwise `expectToolSuccess`, `JSON.parse`, assert `cds`, `testCaseCount > 0`, `testCases[0].testMethod` is a non-empty string, and `hint` contains `cl_cds_test_environment`.
- [ ] Run `npm test` (unit) — green. (E2E is run by the operator against a live MCP server: `npm run test:e2e`.)

### Task 6: Documentation + skill update

**Files:**
- Modify: `docs/tools.md`
- Modify: `CLAUDE.md`
- Modify: `docs/research/2026-06-05-abap-platform-2025-new-adt-apis.md`
- Modify: `docs/research/2026-06-05-abap-platform-2025-816-compatibility.md`
- Modify: `.claude/commands/implement-feature.md`
- Modify (if a row applies): `docs/roadmap.md`, `docs/compare/00-feature-matrix.md`

- [ ] `docs/tools.md` (SAPDiagnose section): document `action=cds_testcases` — purpose, `name` arg, the JSON output shape, the 8.16-only gate, read scope, and that AI `testdata`/`testmethod` generation is intentionally not exposed.
- [ ] `CLAUDE.md`: add a Key Files row — e.g. `| Add CDS test-case suggestions (SAPDiagnose action=cds_testcases) | src/adt/devtools.ts (getCdsTestCases/parseCdsTestCases/supportsCdsTestCases — GET /aunit/dbtestdoubles/cds/testcases?ddlsourceName=, discovery-gated 8.16+), src/handlers/{intent,schemas,tools}.ts, src/authz/policy.ts; reads only, no AI testdata/testmethod. Live-verified on a4h-2025 (816); 758 returns 404. |`
- [ ] `docs/research/2026-06-05-abap-platform-2025-new-adt-apis.md`: mark §5.1 / §6 priority #1 as **implemented** (link this plan / the PR).
- [ ] `docs/research/2026-06-05-abap-platform-2025-816-compatibility.md`: note the first 816 capability landed.
- [ ] `.claude/commands/implement-feature.md`: in the testing/verification guidance, mention that for CDS entities the agent can call `SAPDiagnose action=cds_testcases` to obtain SAP's suggested unit-test cases as a scaffolding starting point (8.16+).
- [ ] `docs/roadmap.md` / `docs/compare/00-feature-matrix.md`: add/refresh a row if one fits (CDS testing / ABAP-Unit support). Refresh "Last Updated" if edited.
- [ ] Run `npm run lint` and `npm run typecheck` — clean (docs-only edits shouldn't affect these, but verify nothing else regressed).

### Task 7: Final verification

- [ ] Run full unit suite: `npm test` — all pass.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] Confirm the three-file tool-schema sync: `cds_testcases` appears in `tools.ts` (enum + description), `schemas.ts` (enum), and `intent.ts` (handler case); `policy.ts` has the `read` entry.
- [ ] Integration (operator, against 816): `getCdsTestCases` test passes on a4h-2025; skips cleanly on a4h (758).
- [ ] Grep for stray references; ensure no `cds_testcases` typos across the three schema files.
- [ ] Move this plan to `docs/plans/completed/`.
