# AUnit alerts dropped when a run produces no `<testMethod>` — PR #647 review + the shipped fix

**Reported by:** @francocapra in https://github.com/arc-mcp/arc-1/pull/647 (cross-repo fork)
**Reviewed + extended:** 2026-07-31, live on **7.50 (npl)**, **7.58 (a4h)** and **8.16 (a4h-2025)**

@francocapra's diagnosis is correct and both response shapes they describe are real — I reproduced
each one live. Their patch is not what shipped: it reports a *skipped* test class as **failed**, a
shape that occurs on any client whose AUnit risk ceiling sits below a test class's declared level.
Chasing that down showed the parser had three more defects from the same root cause. This documents
the review and the fix built on top of their commit.

---

## The root cause

`parseUnitTestResults` did not walk the response. It searched the whole tree for `testMethod` nodes
with `findDeepNodes` and reconstructed everything else — the class from the enclosing node, the
program from *string-parsing the testClass URI*. Every defect below follows from that.

The real structure, identical on all three releases:

```
aunit:runResult
├── alerts?/alert*                       ← 7.50 exposes this slot too
└── program  (adtcore:name = THE program name)
    ├── alerts?/alert*                   ← generation failure: no testClasses at all
    └── testClasses/testClass  (adtcore:name)
        ├── alerts?/alert*               ← CLASS_SETUP dump, or risk-level refusal: no methods
        └── testMethods/testMethod  (adtcore:name, executionTime)
            └── alerts?/alert*

alert  @kind @severity
├── title
├── details/detail[@text]  → nests further; the nested text is the payload
└── stack/stackEntry
```

| # | Defect | Consequence |
|---|--------|-------------|
| 1 | only `testMethod` nodes are iterated | a class that aborted in `CLASS_SETUP` returns `[]` — silently |
| 2 | same, one level up | a program that failed to generate returns `[]` — silently |
| 3 | `program` parsed from the **testClass** URI | release-dependent garbage: `zcl_x#testclass=LTCL_Y` on 758/816 (7.50 differs again: `…/includes/testclasses#start=7,6`) |
| 4 | `@severity` ignored | a class SAP *declined to run* is indistinguishable from one that failed |
| 5 | only `<title>` read | the cause — `Expected [2] Actual [1]`, `Test failed in CLASS_SETUP or CLASS_CONSTRUCTOR` — is dropped |
| 6 | entities not decoded | `Exception Error &lt;UNCAUGHT_EXCEPTION&gt;` reaches the caller |

1 and 2 are what #647 found. 3–6 surfaced while verifying it.

---

## Live evidence

Probe class with four outcomes in one run (passing method, failing assertion, `CLASS_SETUP` dump,
`RISK LEVEL DANGEROUS`), created and deleted on each system.

### The false failure that blocked #647

```xml
<testClass adtcore:name="LTCL_RISKY" durationCategory="long" riskLevel="dangerous">
  <alerts>
    <alert kind="warning" severity="tolerable">
      <title>No execution, risk level of test class exceeds upper limit</title>
```

Same shape as a `CLASS_SETUP` abort — `testClass` + `alerts`, no `testMethod` — but `tolerable`.
PR #647 reported it as `status:"failed"`. `UnitTestResult.status` already declared `'skipped'`;
nothing ever produced it.

### Program-level alert (no `testClass` at all)

Forced by activating a class whose test include calls a helper, then deleting the helper:

```xml
<program adtcore:uri="…/zcl_arc1_genfail" adtcore:type="CLAS/OC" adtcore:name="ZCL_ARC1_GENFAIL">
  <alerts><alert kind="warning" severity="critical">
    <title>GENERATE for program [ZCL_ARC1_GENFAIL==============CP] failed</title>
    <details><detail text="Type &quot;ZCL_ARC1_AUNIT_HELPER&quot; is unknown."/></details>
```

The node carries `adtcore:name` — so #647's stated reason for leaving `program` empty ("There is no
URI at that level to parse it from") does not hold.

### 7.50 divergences that would break a naive strict walk

- empty containers are emitted as elements: `<alerts/>`, `<testMethods/>` → parse to `''`, not nodes
- `<detail>` nests deeper and carries `<link rel=""/>` children
- the testClass URI is `…/includes/testclasses#start=7,6`, not `…#testclass=LTCL_X`
- a `runResult`-level `<alerts/>` slot exists above `<program>` — which retroactively justifies
  @francocapra's `(run)` marker

### Before / after (7.58, same class)

| | `main` | PR #647 | shipped |
|---|---|---|---|
| `CLASS_SETUP` dump | *(absent)* | `failed` — `Exception Error &lt;UNCAUGHT_EXCEPTION&gt;` | `failed` — `Exception Error <UNCAUGHT_EXCEPTION> — …CX_SY_ITAB_LINE_NOT_FOUND… — Test failed in CLASS_SETUP or CLASS_CONSTRUCTOR` |
| risk-level refusal | *(absent)* | **`failed`** | **`skipped`** — `No execution, risk level of test class exceeds upper limit` |
| generation failure | `[]` | `failed`, `program:""` | `failed`, `program:"ZCL_ARC1_GENFAIL"`, cause included |
| `program` (passing run) | `zcl_abapgit_hash#testclass=LTCL_TEST` | same | `ZCL_ABAPGIT_HASH` |
| nothing testable | `[]` | `[]` | `[]` |

Identical output verified on 7.50, 7.58 and 8.16.

---

## The fix

Walk the structure instead of reconstructing it — every field then comes from the node that owns it,
and defects 1–4 stop being expressible.

- `src/adt/xml-parser.ts` — export the existing private `getNestedArray()`. Its falsy guard is what
  makes 7.50's empty `<alerts/>` a non-event.
- `src/adt/devtools.ts` — `parseUnitTestResults` walks `runResult → program → testClasses →
  testClass → testMethods → testMethod`, reading each level's own `alerts` **directly** (never via
  `findDeepNodes`, which descends and would attribute a method's alert to its program). Alerts
  without a method become rows: `(run)`/`(alert)`, `(program)`/`(alert)`,
  `<class>`/`(class-level alert)`. `alertStatus` maps `tolerable` → `skipped`. `alertMessage`
  appends the recursively-flattened `<detail text>` values and runs the result through the existing
  `decodeXmlEntities`.

@francocapra's `alertTitle()` (the `#text`-vs-string handling) and their row markers are kept.

### Deliberately not done

- **Global `processEntities`** stays `false` — it is intentional for ST22 dumps. Decoding happens at
  the boundary, as elsewhere in the codebase.
- **No new `UnitTestResult` fields** for `kind`/`severity` — status + message carry the signal.
- **No `tools.ts` guidance** about the synthetic rows. It would have cost ~68 tokens against 6 tokens
  of headroom in the `standard-full-git` schema budget, and the ratchet is explicit that raising the
  wall is a maintainer decision. The rows are self-describing now that messages carry the cause.
- **No integration test** — these shapes need a deliberately broken class on a live system. The unit
  tests run against captured real responses instead, which is where the fidelity gap actually was.

### Test fixtures

Hand-written AUnit XML hid two release traps (the `<alerts>`/`<testMethods>` wrappers and the
testClass URI shape), so the `runUnitTests` tests now run against captured responses:

| fixture | source | covers |
|---|---|---|
| `aunit-testrun-mixed-alerts.xml` | 8.16 | pass + failing assertion + tolerable skip + CLASS_SETUP dump |
| `aunit-testrun-program-alert.xml` | 7.58 | program-level alert, no `testClasses` |
| `aunit-testrun-nw750.xml` | 7.50 | empty `<alerts/>`/`<testMethods/>`, deeper detail nesting |
| `aunit-testrun-with-coverage.xml` | *(already present)* | passing run + coverage measurement link |

## Gates

`typecheck`, `lint`, `npm test` (166 files / 4831 tests), `check:sizes`, `validate:policy`, `build` —
all pass. Probe classes created on all three systems were deleted afterwards (verified).
