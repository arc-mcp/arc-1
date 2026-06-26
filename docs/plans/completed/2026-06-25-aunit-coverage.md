# ABAP Unit Test Coverage (statement / branch / procedure) for SAPDiagnose (FEAT-41)

## Overview

ARC-1 runs ABAP Unit tests with `<coverage active="false"/>` hardcoded (`devtools.ts:554`), so it
returns only pass/fail. This plan adds opt-in coverage: when the caller asks, run with coverage on,
fetch the coverage measurement, and return the object's **statement / branch / procedure** coverage
percentages alongside the test results. Competitor parity: sapcli `942d70b` (prints all three);
dassian/VSP also surface coverage.

Verified live on a4h 758, the flow is three steps:
1. `POST /sap/bc/adt/abapunit/testruns` with `<external><coverage active="true"/></external>` →
   the result XML embeds `<coverage adtcore:uri="/sap/bc/adt/runtime/traces/coverage/measurements/{ID}"/>`.
2. `POST .../runtime/traces/coverage/measurements/{ID}` with a `<cov:query>` object-set body
   (`Content-Type: application/xml`) → a `cov:node` tree.
3. The first `cov:node` under `ADT_ROOT_NODE` (the program node, e.g. `ZCL_…==========CP`) carries the
   object-level aggregate: a `<cov:coverages>` of three `<cov:coverage type="statement|branch|procedure"
   total executed>` entries.

Ponytail scope: return the **object-level aggregate** (the program node's three percentages).
Best-effort: if the coverage step fails (older release, no measurement), return the tests as today plus
a note, never error.

**Follow-up shipped (2026-06-25):** per-method drill-down (`methodsBelowFull` — methods below 100%
statement coverage, worst-first). It is FREE: the per-method (`CLAS/OM`) nodes are already nested in
the single measurement response — NO `rel="next"` recursion / extra round-trip (the plan's original
assumption was wrong). Live-verified on 758 + 816 + 7.50 (2026-06-25): 758 `ZCL_ABAPGIT_HASH` → 7
methods worst-first; 816 + 7.50 → the partially-covered method surfaced. 7.50 tags methods
`CLAS/OM/<visibility>` (e.g. CLAS/OM/public) vs `CLAS/OM` on 758/816 — matched by prefix.

Success criteria (plain bullets):
- `SAPDiagnose action=unittest coverage=true` returns the tests AND
  `{ statement: {executed,total,percent}, branch:…, procedure:… }`.
- `coverage` omitted/false → byte-identical to today (the run stays `active="false"`).
- If the coverage measurement can't be fetched, tests still return (graceful), with a note.

## Context

### Current State

- `src/adt/devtools.ts` `runUnitTests(http, safety, objectUrl): Promise<UnitTestResult[]>` (`:544`)
  POSTs the run config with `<coverage active="false"/>` (`:554`) and returns
  `parseUnitTestResults(resp.body)` (`:938`).
- `src/adt/types.ts` `UnitTestResult { program; testClass; testMethod; status; message?; duration? }`
  (`:251`).
- `src/handlers/diagnose.ts` `unittest` case (~`:56`) calls `runUnitTests(client.http, client.safety,
  objectUrl)` and renders the result.
- `OperationType.Test` already gates `runUnitTests` (read-equivalent; ATC/unit-run is a POST-that-reads).

### Target State

- `runUnitTests(http, safety, objectUrl, opts?: { coverage?: boolean })` returns
  `{ tests: UnitTestResult[]; coverage?: CoverageSummary }`. When `opts.coverage`, it runs with
  `active="true"`, extracts the measurement URI, POSTs the cov query, and parses the aggregate.
- `CoverageSummary { statement?: CoverageMetric; branch?: CoverageMetric; procedure?: CoverageMetric }`,
  `CoverageMetric { executed: number; total: number; percent: number }` in `types.ts`.
- `SAPDiagnose` `unittest` gains an optional `coverage` boolean (three-file sync).

### Verified Live Evidence

- **2026-06-24, a4h 758 — full flow captured** (fixtures committed, do NOT hand-edit):
  - `tests/fixtures/xml/aunit-testrun-with-coverage.xml` — the testruns result for `ZCL_ABAPGIT_HASH`
    with `coverage active="true"`, containing
    `<coverage adtcore:uri="/sap/bc/adt/runtime/traces/coverage/measurements/8EDEE…"/>`.
  - `tests/fixtures/xml/aunit-coverage-measurement.xml` — the `POST measurements/{ID}` response: a
    `cov:node` tree (ns `http://www.sap.com/adt/cov`). `ADT_ROOT_NODE` → `ZCL_ABAPGIT_HASH==========CP`
    (program) → `<cov:coverages>` with `type="branch" total="14" executed="5"`,
    `type="procedure" total="8" executed="3"`, `type="statement" total="49" executed="30"`; then nested
    class/method nodes (`ADLER32`, …) each with their own coverages.
  - The measurement endpoint is **POST-only** (`GET` → `405 Resource controller does not support method
    GET`); the query body is `<cov:query xmlns:cov="http://www.sap.com/adt/cov"><adtcore:objectSets …>
    <objectSet kind="inclusive"><adtcore:objectReferences><adtcore:objectReference adtcore:uri="<obj>"/>
    </adtcore:objectReferences></objectSet></adtcore:objectSets></cov:query>`, `Content-Type: application/xml`.
  - Expected parsed aggregate for the fixture: statement 30/49 = **61.22%**, branch 5/14 = **35.71%**,
    procedure 3/8 = **37.50%**.
- **Release note (LIVE-VERIFIED 2026-06-25 on 7.50 + 758 + 816):** the coverage measurement endpoint
  works on **all three** releases — the original "modern releases only / 7.50 lacks it" guess was
  WRONG. Ran `SAPDiagnose unittest coverage=true` against a controlled tested class (`ZCL_ARC1_COV`
  with one branched method + a local test) on NPL 7.50, a4h 758, and a4h-2025 816; every system
  returned identical `{statement 3/4, branch 2/3, procedure 1/1}`. The try/catch graceful-degrade
  (tests return without coverage) is therefore purely defensive — no release is known to lack it. The
  758-targeted integration test uses `ZCL_ABAPGIT_HASH` (abapGit classes carry unit tests on 758 but
  are absent on 816/7.50, so it `requireOrSkip`s there — not because coverage is unavailable).

### Design Principles

1. **Opt-in, non-breaking.** Default (no `coverage`) keeps `active="false"` and the current return
   shape semantics; only when requested does the extra round-trip happen.
2. **Best-effort coverage.** The measurement POST is wrapped — any failure (405/404/parse) returns the
   tests plus a "coverage unavailable on this system" note, never an error.
3. **Object-level aggregate + per-method below-full** (the follow-up). The per-method nodes ride the
   same response — no extra round-trip; only methods below 100% statement coverage are surfaced (capped, worst-first).
4. **Parser tested against the REAL captured fixture**, never a hand-written one.
5. **Three-file schema sync** for the new `coverage` param: `tools.ts` + `schemas.ts`
   (`looseOptionalBoolean`, never `z.coerce.boolean`) + the `diagnose.ts` handler.
6. Release-aware: coverage live-verified on 7.50 + 758 + 816 (2026-06-25); the graceful-degrade path
   stays as defense for any unknown system that lacks the endpoint.

## Development Approach

TDD the pure parser first against `aunit-coverage-measurement.xml` (assert the three percentages) and
the measurement-URI extractor against `aunit-testrun-with-coverage.xml`. Then wire the run option +
handler + schema. The coverage round-trip is mocked at the undici layer in unit tests (two POSTs:
testruns → measurement) using the two committed fixtures; the live path is covered by the integration
test. Failure path: the measurement POST 405/404 → tests return, coverage undefined (graceful) — test it.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Types + pure coverage parser

**Files:**
- Modify: `src/adt/types.ts` (`CoverageMetric`, `CoverageSummary`, `UnitTestRunResult`)
- Modify: `src/adt/devtools.ts` (`parseCoverageMeasurement`, `extractCoverageMeasurementUri`)
- Modify: `tests/unit/adt/devtools.test.ts`

- [ ] Add `CoverageMetric { executed: number; total: number; percent: number }`,
      `CoverageSummary { statement?: CoverageMetric; branch?: CoverageMetric; procedure?: CoverageMetric }`,
      and `UnitTestRunResult { tests: UnitTestResult[]; coverage?: CoverageSummary }` to `types.ts`.
- [ ] `extractCoverageMeasurementUri(testrunsXml): string | null` — find
      `<coverage adtcore:uri="…/measurements/{ID}"/>` (use the existing `parseXml`/`findDeepNodes`
      helpers). Returns null if absent.
- [ ] `parseCoverageMeasurement(xml): CoverageSummary` — locate the program node (the first `cov:node`
      child of `ADT_ROOT_NODE`); read its `coverages/coverage` entries; map `type` → metric with
      `percent = total ? round(executed/total*100, 2) : 0`. Tolerate missing types.
- [ ] Unit tests (~6) using the committed fixtures: `extractCoverageMeasurementUri` returns the real ID
      path and null for a coverage-less testruns XML; `parseCoverageMeasurement` returns
      statement 61.22 / branch 35.71 / procedure 37.5 from `aunit-coverage-measurement.xml`; a tree with
      no program node → `{}`.
- [ ] Run `npm test`.

### Task 2: Wire coverage into runUnitTests

**Files:**
- Modify: `src/adt/devtools.ts` (`runUnitTests` ~`:544`)
- Modify: `tests/unit/adt/devtools.test.ts`

- [ ] Change `runUnitTests` to `runUnitTests(http, safety, objectUrl, opts: { coverage?: boolean } = {})
      : Promise<UnitTestRunResult>`. Build the body with `<coverage active="${opts.coverage ? 'true' :
      'false'}"/>`. After the run, `const tests = parseUnitTestResults(resp.body);` if `opts.coverage`,
      `const uri = extractCoverageMeasurementUri(resp.body);` and in a `try`: POST `uri` with the
      `<cov:query>` object-set body (`Content-Type: application/xml`, Accept `application/xml`) →
      `coverage = parseCoverageMeasurement(measResp.body)`; `catch` → leave coverage undefined. Return
      `{ tests, coverage }`.
- [ ] Update the existing `runUnitTests` unit test(s) for the new `{ tests, coverage }` return shape.
- [ ] Add a unit test (mockFetch, two sequential POSTs from the two fixtures): coverage=true →
      `result.coverage.statement.percent ≈ 61.22`; AND a test where the measurement POST returns 405 →
      `result.tests` present, `result.coverage` undefined (graceful failure path).
- [ ] Run `npm test`.

### Task 3: SAPDiagnose `coverage` param (three-file sync) + handler

**Files:**
- Modify: `src/handlers/diagnose.ts` (`unittest` case ~`:56`)
- Modify: `src/handlers/schemas.ts` (SAPDiagnose schema — add `coverage` via `looseOptionalBoolean`)
- Modify: `src/handlers/tools.ts` (SAPDiagnose input schema — add `coverage` boolean + description)
- Modify: `tests/unit/handlers/tool-definitions-snapshot.test.ts` fixtures (regen)
- Modify: `tests/unit/handlers/diagnose.test.ts` (verify exists; else the relevant handler test)

- [ ] `diagnose.ts` `unittest` case: read `coverage` from args (it will already be schema-validated as
      boolean), call `runUnitTests(client.http, client.safety, objectUrl, { coverage })`, and render the
      returned `{ tests, coverage }` — include a `coverage` block when present, plus a one-line
      "coverage unavailable on this system" note when `coverage` was requested but came back undefined.
- [ ] Add `coverage` to `schemas.ts` (SAPDiagnose) with `looseOptionalBoolean` (NEVER `z.coerce.boolean`
      — it maps `"false"`→true, issue #360) and to `tools.ts` with a short description ("Include
      statement/branch/procedure coverage (unittest action; extra round-trip; 758/816 only)").
- [ ] Regenerate the tool-def snapshot (`npx vitest run -u tests/unit/handlers/tool-definitions-snapshot.test.ts`)
      and review the diff is only the new `coverage` property on SAPDiagnose.
- [ ] Handler test (mockFetch): `unittest` with `coverage:true` surfaces the coverage block; a
      polluted-payload test (`coverage:"false"` string must NOT enable it — `looseOptionalBoolean`).
- [ ] Run `npm test`.

### Task 4: Live integration + docs

**Files:**
- Modify: the existing SAPDiagnose/devtools integration suite (verify the real file — likely
  `tests/integration/adt.integration.test.ts`)
- Modify: `docs_page/tools.md` (SAPDiagnose unittest — coverage option), `AGENTS.md` row if one fits

- [ ] Integration (guarded by `TEST_SAP_URL`): run `SAPDiagnose unittest coverage=true` against a class
      that has unit tests on the target system (758: an abapGit class such as `ZCL_ABAPGIT_HASH`;
      `requireOrSkip` if no such class / coverage endpoint). Assert tests present AND a coverage block
      with statement/branch/procedure when the endpoint is available. Per release: coverage live-verified
      on 7.50 + 758 + 816 (2026-06-25). Note abapGit classes are absent on a4h-2025/816 — pick a
      system-appropriate class with tests or skip.
- [ ] Docs note.
- [ ] Run `npm test`.

### Task 5: Final verification

- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — green.
- [x] Live smoke on 758: `SAPDiagnose unittest coverage=true name=ZCL_ABAPGIT_HASH type=CLAS` shows the
      three percentages (~stmt 61% / branch 36% / proc 38%). 7.50 + 816 confirmed (2026-06-25) with a
      controlled tested class (`ZCL_ARC1_COV`): all three returned `{stmt 3/4, branch 2/3, proc 1/1}`.
- [ ] Move this plan to `docs/plans/completed/`.
