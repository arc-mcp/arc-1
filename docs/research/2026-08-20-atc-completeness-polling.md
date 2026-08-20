# ATC polling burns the whole timeout on unsatisfiable completeness evidence

> **Live-verified 2026-08-20** on **npl (NW 7.50 SP02)** and **a4h (S/4HANA 2023 / SAP_BASIS 758)**.
> Field report from a customer 758 system (T4D) via the deployed multi-target instance.
> Follow-up to [2026-08-19-atc-default-check-variant.md](2026-08-19-atc-default-check-variant.md).

## TL;DR

`runAtcCheck` polls the ATC worklist until `result.complete` is true. Some systems never satisfy that
conjunction even after their worklist has stopped changing, so the loop cannot exit early and polls
until the caller's deadline — every time, for every object. Conversely, an early
`objectSetIsComplete="true"` response is not proof that findings and processed objects have finished
populating: a live 758 capture changed from 23 findings/two objects to 73/ten afterward.

**Measured on npl (7.50):** wall time equals the configured budget exactly.

| `--timeout` | wall | exit | reason |
|---|---|---|---|
| 20 s | **22 s** | 3 | `SAP did not provide one schema-scoped ATC objects container. SAP did not report any processed ATC object.` |
| 45 s | **46 s** | 3 | identical |

The ATC work itself finishes in seconds; the rest is pure waste. At the backoff schedule in
`runAtcCheck` (250 ms doubling to a 2 s cap) a 300 s budget — what the customer instance uses —
issues roughly **150 full worklist GETs** before giving up (computed from the schedule, not measured;
successful GETs are not logged).

## 1. Root cause (code, not inference)

`src/adt/atc.ts`, the poll loop:

```
if (expectedFindingCount === null || result.complete || result.findingCount > expectedFindingCount || now() >= deadline)
  return result;
```

`complete` is built in `parseAtcRunResult` as:

| # | Criterion | Polling observation |
|---|---|---|
| 1 | `rootShapeIsValid` — exactly one `<atcworklist:worklist>` root | **no** — response shape |
| 2 | `worklistIdMatches` — body id equals the created id | **no** |
| 3 | `objectSetIsComplete === true` | not terminal — observed true before a 23/2 → 73/10 fill |
| 4 | `!truncated` | yes (count-driven) |
| 5 | `expectedFindingCount !== null` | **no** — decided by the run POST |
| 6 | `findings.length === expectedFindingCount` | **yes** — the async fill |
| 7 | `objectContainerShapeIsValid` — exactly one `<objects>` container | no public terminal contract |
| 8 | `processedObjectCount > 0` and `malformedObjectCount === 0` | **yes** — object count changed live |
| 9 | `invalidPriorityCount === 0` | can change when finding rows change |

There is no documented wire-level terminal marker among these fields. In particular, #3 cannot be used
as the stop signal, and a signature made only from #6/#8 misses same-count replacements or evidence
changes elsewhere in the XML.

Two live manifestations, different criteria, same deadlock:

- **npl / 7.50** — #7 and #8 fail: the 7.50 worklist body carries no schema-scoped `<objects>`
  container, so `processedObjectCount` is 0 forever. Measured above.
- **Customer / 758** — #6 fails permanently: the run reported `FINDING_STATS` summing to 82 while the
  worklist yields 81. `SATC_AC_RESULTH` for that run stores `0/47/34 = 81`, i.e. SAP's own persisted
  result agrees with the worklist and the *transient* run statistic is the outlier.

## 2. What a4h/758 does — and why it is a poor regression system here

The targeted 2026-08-20 probes on a4h converged on the **first** poll. The mismatch is not reproducible
there on demand:

| Probe | Result |
|---|---|
| `PROG Z_CREATE_BOOKING_SAMPLES`, variant `ZABAP_CLOUD_DEVELOPMENT` | stats `1,0,1` = 2, worklist 2 — **match** |
| `CLAS ZCL_ABAPGIT_ZLIB` / `ZCL_ABAPGIT_HASH`, variant `DEFAULT` | 0 / 0 — match |
| `CLAS ZCL_ABAPGIT_OBJECTS`, variant `DEFAULT` | stats `0,1,46` = 47, worklist 47 — **match** |
| Same class with `maximumVerdicts=10` | worklist still returns **47** — the cap is ignored on 758 (confirms the existing dev-guide note); not a mismatch source |
| Same worklist, `/atc/runs` posted **twice** | stats `1,0,1` both times, worklist 2 — re-running **replaces**, it does not accumulate |
| `CLAS /1BCDWB/WSC…` in `$TMP` | `processedObjectCount: 1`, `complete: true` — ATC did **not** skip it |

Consequence for the fix: **the regression test must be a unit simulation**, because no live system in
the fleet reproduces the stall on demand. npl reproduces one variant of it and is the integration
witness.

However, an earlier live A4H/758 run is the decisive timing evidence. Worklist
`9241B616527E1FE1A6D8E5A8AF08B8A2` initially returned 23 findings/two objects with
`objectSetIsComplete="true"`, then later 73/ten. That capture is recorded in
[the CLI/CI/API audit](2026-08-17-cli-ci-api-audit.md#13-post-review-live-wire-corrections-2026-08-18).
It rules out both the completeness attribute and a sub-second three-snapshot threshold.

A review follow-up live probe on 2026-08-20 found the one field that cannot participate in a raw-byte
comparison: A4H/758 advances the root `atcworklist:timestamp` on each GET even when all other 695 bytes
are identical. Across six reads, the raw SHA-256 changed with that timestamp while the hash after
normalizing only the ISO timestamp stayed constant. The settle observation therefore excludes that
single root attribute and preserves every other response byte.

### Public protocol research

SAP's public [ABAP Development User Guide](https://help.sap.com/doc/d3430e8838ce41d9ab8a475eacbb022e/2020%20FPS00/en-US/abap_dev_user_guide_EN.pdf)
documents ATC findings but does not define a terminal worklist-polling marker. SAP Project Piper's
[gCTS quality-check implementation](https://github.com/SAP/jenkins-library/blob/537e1a4944f8c8d5b8f419378c9ac9ef766c6e80/cmd/gctsExecuteABAPQualityChecks.go)
reads the worklist once after starting the run; it does not establish a terminal protocol, and ARC-1's
live capture proves one read can be partial. The conservative client-side inference is therefore a
time-based quiet period over the full response except the proven volatile root timestamp, bounded by
the existing absolute deadline.

### Hypotheses disproved (do not re-derive)

- **Pseudo-comment suppression.** a4h runs `PSEUDO_COMMENT_POLICY = 'SP'` (suppress), same family as
  the customer, and abapGit sources are dense with `"#EC` pragmas — yet stats and worklist agree
  exactly (47/47). Pragmas do not create the gap.
- **`maximumVerdicts` truncation.** Ignored by the backend on 758 (10 → 47 findings returned).
- **A doubled run inflating the header.** Posting `/atc/runs` twice into one worklist leaves both the
  stats and the worklist unchanged.

## 3. Item 2 — the `162 = 2 × 81` header, unresolved

`SATC_AC_RESULTH` run 61,779 on the customer system stores `0/94/68 = 162` for the same class whose
neighbouring run 61,780 stores `0/47/34 = 81`, while ARC-1 read 81 findings for both smoke runs.

Not reproducible here (§2, double-run probe) and **not attributable**: T4D is a shared customer
development system with many concurrent users and CTS release checks writing into the same table, and
the captured query did not include `SCHEDULED_BY`. Most likely a foreign run against the same class.
Parked with this evidence rather than guessed at; it does not block the fix, and the fix's convergence
rule does not depend on the stats value being right.

## 4. Item 3 — `variantSource: 'requested'` can still be untrue

`resolveCheckVariant` validates a caller-supplied variant against `/atc/variants` but is deliberately
**fail-open**: if the lookup itself throws, the run proceeds with the caller's string. In that window
SAP may still silently substitute `DEFAULT` (the behaviour the validation exists to catch), while the
result reports `variant: <caller string>, variantSource: 'requested'` — a claim ARC-1 has not verified.

The distinction is invisible today. It needs its own source value so a caller can tell a *verified*
binding from an *unverified* one.

## 5. Item 4 — the default output hides which variant ran

The legacy success payload is exactly `{ findings }`; `variant`/`variantSource` appear only under
`resultFormat: "structured"`. The entire point of the 2026-08-19 fix is knowing which check set
produced the findings, so hiding it from the default response is the wrong default. Adding the two
fields is **additive** — `.findings` consumers are unaffected — but it does change a shape that
`tests/unit/handlers/lint-diagnose.test.ts` currently freezes with an exact key-list assertion, so it
must be a deliberate, reviewed change rather than a silent one.

## 6. Affected ARC-1 files

| File | Role |
|---|---|
| `src/adt/atc.ts` | `runAtcCheck` poll loop, `parseAtcRunResult` (`complete`, `incompleteReasons`), `AtcRunResult`, `resolveCheckVariant` |
| `src/handlers/diagnose.ts` | `case 'atc'` — the legacy vs structured payload split |
| `src/cli-checks.ts` | `evaluateAtc` (exit 3 on `complete !== true`), `formatAtcText` |
| `tests/unit/adt/devtools.test.ts` | `describe('runAtcCheck')` — poll/deadline cases, `mockAtcHttp`/`worklistGet` |
| `tests/unit/handlers/lint-diagnose.test.ts` | the exact-key legacy-shape assertion |
| `tests/unit/cli/cli-checks.test.ts` | `atc()` factory |
| `tests/integration/adt.integration.test.ts` | `describe('runAtcCheck (worklist + variant flow)')` |
| `docs_page/tools.md`, `docs/dev-guide.md`, `AGENTS.md` | the ATC rows describing completeness semantics |

## 7. Design direction

Keep the completeness contract — CI must not go green on partial evidence — but stop polling on
constants:

1. **Keep parsing every response.** Continue while the worklist can still be filling; do not assume
   which XML fields SAP may update between polls.
2. **Converge on full-response quiescence.** If the worklist XML except its volatile root timestamp
   remains unchanged for ten continuous seconds, stop even if it never reached the run's statistic.
   Any other byte change resets the clock. Report the discrepancy in `incompleteReasons` as today.
3. `complete` keeps its current meaning and `evaluateAtc` keeps returning 3. Only the **time** to that
   verdict changes — seconds instead of the full budget.

**Decision (review-corrected):** `ATC_SETTLE_QUIET_MS = 10_000` over the full response after removing
only the root worklist `timestamp`. Ten seconds spans at least five intervals after the existing backoff
reaches its 2 s cap. The first implementation's three identical count snapshots were rejected because
they cover less than one second at the default schedule, fail the `1,1,1,2` delayed-growth reproducer,
and ignore same-count body changes. Raw byte equality without timestamp normalization was rejected by
the live A4H probe above. A purely structural rule was also rejected because it misses the customer's
short-count manifestation. The absolute caller deadline remains the final bound.
