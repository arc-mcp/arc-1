# Stop ATC polling on a settled worklist; make the bound variant honest and visible

## Overview

`runAtcCheck` polls the ATC worklist until `result.complete` is true. `complete` is a conjunction of
nine criteria, but only the finding count can change with time — the other eight are fixed by the
first response. Whenever one of those eight is unsatisfiable on a system, the loop cannot exit early
and burns the caller's entire budget, every time, for every object. Measured on NW 7.50: wall time
equals the configured timeout exactly (20 s → 22 s, 45 s → 46 s), and the customer's 758 instance
spends 300 s per ATC call for the same structural reason.

This plan makes the loop stop when the worklist has **settled** rather than when it has become
*complete*, without weakening the completeness verdict itself: a settled-but-incomplete run still
reports `complete: false`, still returns an `errorResult` on the legacy path, and `arc1-cli atc` still
exits `3`. Only the time to that verdict changes — seconds instead of the full budget.

It also closes two transparency gaps left open by the 2026-08-19 check-variant fix: a caller-supplied
variant whose validation lookup failed is reported as if it had been verified, and the default (legacy)
ATC payload does not say which variant produced the findings at all.

Key decisions:
- Stability, not structure, is the stop signal. A rule keyed on "which criterion failed" does not cover
  the customer's manifestation (a permanently short finding count); an unchanged-observation rule covers
  both measured cases with one mechanism.
- Stopping early can never turn a red verdict green — today's deadline path already returns
  `complete: false`. The only risk is declaring a slow async fill settled, so the rule requires several
  consecutive unchanged reads under the existing exponential backoff.
- `complete`, `incompleteReasons` and `evaluateAtc` keep their current meaning. This is a latency fix,
  not a semantics change.
- The `162 = 2 × 81` anomaly from the customer system is **out of scope** — see Context.

## Context

### Current State

- `runAtcCheck` in `src/adt/atc.ts` polls with exponential backoff (250 ms doubling to a 2 s cap) and
  exits only on `expectedFindingCount === null`, `result.complete`, `result.findingCount > expectedFindingCount`,
  or the deadline. There is no convergence check.
- `parseAtcRunResult` builds `complete` from nine ANDed criteria. Six of them (`rootShapeIsValid`,
  `worklistIdMatches`, `objectSetIsComplete`, `expectedFindingCount !== null`,
  `objectContainerShapeIsValid`, `invalidPriorityCount === 0`) are properties of the response shape and
  cannot change between polls.
- `resolveCheckVariant` validates a caller-supplied variant against `/atc/variants` but is deliberately
  fail-open; when the lookup throws it returns `{ variant: requested, variantSource: 'requested' }` —
  indistinguishable from a verified binding.
- `case 'atc'` in `src/handlers/diagnose.ts` returns `textResult(toolJson({ findings: result.findings }))`
  on the legacy success path. `variant`/`variantSource` are visible only under `resultFormat: "structured"`.
- `tests/unit/handlers/lint-diagnose.test.ts` freezes that legacy shape with an exact key-list assertion
  (`expect(Object.keys(...)).toEqual(['findings'])`) in `describe('SAPDiagnose action=atc check-variant binding')`.

### Target State

- An ATC run whose worklist has settled returns within seconds of settling, regardless of the configured
  timeout, with an `incompleteReasons` entry naming the settlement when it did not reach the run's statistic.
- A caller-supplied variant that could not be validated reports `variantSource: 'requestedUnverified'`.
- The default ATC payload carries the bound variant:
  ```json
  { "findings": [], "variant": "ZABAP_CLOUD_DEVELOPMENT", "variantSource": "systemDefault" }
  ```
- `complete`, the error/exit semantics, and the structured payload are otherwise unchanged.

### Key Files

| File | Role |
|------|------|
| `src/adt/atc.ts` | `runAtcCheck` poll loop, `resolveCheckVariant`, `AtcVariantSource`, `parseAtcRunResult` |
| `src/handlers/diagnose.ts` | `case 'atc'` — legacy vs structured payload |
| `src/cli-checks.ts` | `evaluateAtc` (must keep returning 3), `formatAtcText` |
| `tests/unit/adt/devtools.test.ts` | `describe('runAtcCheck')`; `mockAtcHttp` exposes `worklistGet` for worklist-only assertions; `defer<T>()` and injected `now`/`sleep` already exist for deterministic timing |
| `tests/unit/handlers/lint-diagnose.test.ts` | `describe('SAPDiagnose action=atc check-variant binding')` — the exact-key legacy assertion |
| `tests/unit/cli/cli-checks.test.ts` | `atc()` factory + `formatAtcText` assertion |
| `tests/integration/adt.integration.test.ts` | `describe('runAtcCheck (worklist + variant flow)')` |
| `docs_page/tools.md`, `docs/dev-guide.md`, `AGENTS.md` | ATC completeness + variant semantics |

### Verified Live Evidence

Full dossier: `docs/research/2026-08-20-atc-completeness-polling.md`.

**npl (NW 7.50 SP02), 2026-08-20** — `arc1-cli atc CLAS CL_ABAP_TYPEDESCR`, built from the current branch:

| `--timeout` | wall | exit | reported reasons |
|---|---|---|---|
| 20 s | **22 s** | 3 | `SAP did not provide one schema-scoped ATC objects container. SAP did not report any processed ATC object.` |
| 45 s | **46 s** | 3 | identical |

Wall time tracks the budget exactly — the ATC work itself finishes in seconds. The 7.50 worklist body
carries no schema-scoped `<objects>` container, so `processedObjectCount` is 0 on every poll and
criteria #7/#8 can never be satisfied.

**a4h (S/4HANA 2023 / 758), 2026-08-20** — every probe converged on the first poll; the stall is **not**
reproducible there, so the regression guard must be a unit simulation:

| Probe | Result |
|---|---|
| `PROG Z_CREATE_BOOKING_SAMPLES` @ `ZABAP_CLOUD_DEVELOPMENT` | stats `1,0,1` = 2, worklist 2 — match |
| `CLAS ZCL_ABAPGIT_OBJECTS` @ `DEFAULT` | stats `0,1,46` = 47, worklist 47 — match |
| same, `maximumVerdicts=10` | worklist still 47 — the cap is ignored on 758 |
| `/atc/runs` posted twice into one worklist | stats and worklist unchanged — runs replace, they do not accumulate |
| `CLAS /1BCDWB/WSC…` in `$TMP` | `processedObjectCount: 1`, `complete: true` — ATC did not skip it |

Disproved as mismatch causes (do not re-derive): pseudo-comment suppression (a4h runs
`PSEUDO_COMMENT_POLICY = 'SP'` and abapGit sources are pragma-dense, yet 47/47 match),
`maximumVerdicts` truncation, and run accumulation.

**Customer 758 instance (T4D), 2026-08-19/20** — `FINDING_STATS` summed to 82 while the worklist
yielded 81; `SATC_AC_RESULTH` stores `0/47/34 = 81` for that run, so SAP's own persisted result agrees
with the worklist and the transient run statistic is the outlier. Every ATC call there spends its full
300 s budget.

**Explicitly out of scope:** the `162 = 2 × 81` header on customer run 61,779. Not reproducible (the
double-run probe above disproves accumulation) and not attributable — T4D is a shared system with
concurrent users and CTS release checks writing the same table, and the captured query omitted
`SCHEDULED_BY`. It is recorded in the dossier; the convergence rule does not depend on the statistic
being correct, so it does not block this work.

### Design Principles

1. **Latency fix, not a semantics change.** `complete`, `incompleteReasons`, the legacy `errorResult`
   branch and `evaluateAtc`'s exit `3` all keep their current meaning. A run that is incomplete today
   is still incomplete, just sooner.
2. **Stopping early can never turn red into green.** The pre-existing deadline path already returns
   `complete: false`; the new path returns the same verdict earlier. There is no route from this change
   to a false pass.
3. **Stability is the only safe stop signal.** "Unchanged across N consecutive reads" means settled;
   the rule deliberately does not assume the fill is monotonic (that was never measured). Requiring
   several reads under the existing backoff keeps a briefly-paused fill from being mistaken for a
   settled one.
4. **The observation must include processed objects, not just findings.** On 7.50 both are 0 from the
   first read; on the customer system findings are 81 and processed is 1. Keying on both covers the
   measured manifestations and detects a run that is still discovering objects.
5. **Release-invariant.** Nothing here depends on an ADT endpoint or a release-gated field; it is pure
   client-side loop control over responses ARC-1 already parses.
6. **No new config.** No env var, no tool parameter. The stability threshold is a named module constant.

## Development Approach

TDD throughout; the timing tests are deterministic because `runAtcCheck` already accepts injected
`now` and `sleep` via `AtcPollOptions` — existing tests in `describe('runAtcCheck')` use
`{ timeoutMs: 250, now: () => now, sleep: async (ms) => void (now += ms) }`. Assert the **number of
worklist reads**, not wall-clock time: `mockAtcHttp` exposes `worklistGet`, a mock that serves only the
worklist GETs (the `/atc/customizing` and `/atc/variants` pre-flights are dispatched separately by URL),
so `expect(http.worklistGet).toHaveBeenCalledTimes(n)` is the right assertion.

The decisive new test is the one that fails today: a worklist that is permanently short of the run's
statistic must stop after a bounded number of reads instead of running to the injected deadline. Write
it first and watch it fail against the current loop.

Failure paths that must be covered, not just the happy path: the settled-but-incomplete case (both the
7.50 shape — zero processed objects — and the customer shape — short finding count), a fill that is
still growing (must NOT stop early), the deadline path (unchanged), and the unvalidated-variant case.

Scope boundary: this plan does not change `parseAtcRunResult`'s completeness criteria, does not touch
`resolveCheckVariant`'s fail-open policy (only how it is *reported*), and does not add caching.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Stop polling once the worklist has settled

**Files:**
- Modify: `src/adt/atc.ts` (`runAtcCheck` poll loop)
- Modify: `tests/unit/adt/devtools.test.ts` (`describe('runAtcCheck')`)

Today the loop exits only on `complete`, which ANDs six criteria that a later poll can never change
(response shape, worklist-id match, `objectSetIsComplete`, `expectedFindingCount !== null`, objects-container
shape, priority validity). On any system where one of those fails, the loop runs to the caller's deadline —
measured on NW 7.50 as wall-time == timeout at both 20 s and 45 s.

- [ ] Add a module constant near `DEFAULT_ATC_MAX_POLL_DELAY_MS` in `src/adt/atc.ts`:
      `/** Consecutive unchanged worklist reads that mean the run has settled. */`
      `const ATC_SETTLED_POLLS = 3;`
- [ ] In the poll loop, derive an observation signature from the parsed result each iteration —
      `` const signature = `${result.findingCount}/${result.processedObjectCount}` `` — and count how many
      consecutive reads produced it. Exact semantics (the tests depend on it): the counter is **1** for the
      first read of a value and increments only while the signature repeats, so
      `ATC_SETTLED_POLLS = 3` means the loop exits on the **third** identical read:

          stableReads = signature === lastSignature ? stableReads + 1 : 1;
          lastSignature = signature;
          const settled = stableReads >= ATC_SETTLED_POLLS;
- [ ] Add `settled` (signature unchanged for `ATC_SETTLED_POLLS` reads) to the existing exit condition
      alongside `result.complete`, `result.findingCount > expectedFindingCount` and the deadline
- [ ] When the loop exits on `settled` while `result.complete` is false, append one reason to
      `incompleteReasons` naming what happened, e.g.
      `ATC worklist stopped changing at N finding(s) over M object(s) without reaching the run's reported total; returning the settled result.`
      Do NOT set `complete` to true and do NOT remove any existing reason — the verdict is unchanged,
      only its timing
- [ ] Regression guard: a worklist that is still filling must NOT stop early. The counter resets on every
      change, so a growing count keeps polling exactly as today
- [ ] Regression guard: the existing deadline behaviour and the `findingCount > expectedFindingCount`
      early exit stay byte-identical
- [ ] Add unit tests (~5 tests) in `describe('runAtcCheck')`, all using injected `now`/`sleep` and asserting
      on `http.worklistGet` call counts rather than elapsed time:
      - **the failing-today case**: run stats report 2 findings, every worklist read returns 1 → returns
        after `ATC_SETTLED_POLLS` reads (not the injected deadline), `complete === false`,
        `incompleteReasons` contains both the pre-existing count reason and the new settled reason
      - **the 7.50 shape**: stats `0`, worklist has no `<objects>` container → `processedObjectCount === 0`,
        returns after `ATC_SETTLED_POLLS` reads with `complete === false`
      - **still filling**: worklist returns 1, then 2, then 3 findings against a stats total of 3 → the loop
        keeps polling and returns `complete === true`; it must not stop at the third read for the wrong reason
      - **a pause then a resume**: 1, 1, 2, 3 with stats 3 → still completes (guards a too-eager threshold)
      - **deadline still wins**: an ever-changing count with a short injected budget returns at the deadline
        exactly as today
- [ ] Run `npm test` — all tests must pass

### Task 2: Report an unvalidated variant honestly

**Files:**
- Modify: `src/adt/atc.ts` (`AtcVariantSource`, `resolveCheckVariant`)
- Modify: `src/cli-checks.ts` (`formatAtcText`)
- Modify: `tests/unit/adt/devtools.test.ts` (`describe('runAtcCheck')`)
- Modify: `tests/unit/cli/cli-checks.test.ts` (`atc()` factory is typed on `AtcRunResult` — verify the union widening compiles)

`resolveCheckVariant` validates a caller-supplied variant against `/atc/variants` but is deliberately
fail-open: when the lookup throws, the run proceeds with the caller's string. SAP may then still
silently substitute `DEFAULT` — exactly what the validation exists to catch — while the result claims
`variantSource: 'requested'`. A caller cannot tell a verified binding from an unverified one.

- [ ] Widen the union in `src/adt/atc.ts`:
      `export type AtcVariantSource = 'requested' | 'requestedUnverified' | 'systemDefault' | 'sapFallback';`
      and document `requestedUnverified` as "the caller named it, but `/atc/variants` was unreachable so
      ARC-1 could not confirm SAP will honour it"
- [ ] In `resolveCheckVariant`, the fail-open `catch` returns `variantSource: 'requestedUnverified'`
      (it currently returns `'requested'`). The successful-match path keeps `'requested'`
- [ ] In `formatAtcText` (`src/cli-checks.ts`), append ` (unverified)` to the variant in the summary line
      when `variantSource === 'requestedUnverified'`, so a CI report never implies a checked binding
- [ ] Add unit tests (~2 tests) in `describe('runAtcCheck')`: the existing fail-open test
      (`runs anyway when the variant listing itself fails`) asserts `'requestedUnverified'`; a successful
      validation still asserts `'requested'`
- [ ] Add one `formatAtcText` test in `tests/unit/cli/cli-checks.test.ts` covering the `(unverified)` suffix
- [ ] Run `npm test` — all tests must pass

### Task 3: Show the bound variant in the default ATC payload

**Files:**
- Modify: `src/handlers/diagnose.ts` (`case 'atc'`, the legacy success branch)
- Modify: `tests/unit/handlers/lint-diagnose.test.ts` (`describe('SAPDiagnose action=atc check-variant binding')`)
- Verify: `tests/e2e/`, `tests/integration/` — grep for other assertions on the legacy ATC payload before changing it

The whole point of the 2026-08-19 fix is knowing which check set produced the findings, yet the default
response still returns only `{ findings }`. The two fields are additive — `.findings` consumers are
unaffected — but an exact-key assertion currently freezes the shape, so this must be deliberate.

- [ ] Change the legacy success branch to
      `textResult(toolJson({ findings: result.findings, variant: result.variant, variantSource: result.variantSource }))`.
      Leave the `resultFormat === 'structured'` branch and the `!result.complete` error branch untouched
- [ ] Before editing tests, grep for other places that assert the legacy payload shape:
      `grep -rn "findings" tests/e2e tests/integration | grep -i atc` — update or confirm each hit
- [ ] Update the exact-key assertion in `describe('SAPDiagnose action=atc check-variant binding')` from
      `['findings']` to `['findings', 'variant', 'variantSource']`, and keep it an **exact** assertion —
      the point of that test is that the shape does not drift silently
- [ ] Add one test asserting a legacy (no `resultFormat`) call reports the resolved system default in
      `variant`, so the default path is covered and not only the structured one
- [ ] Run `npm test` — all tests must pass

### Task 4: Prove the latency fix against a live system

**Files:**
- Modify: `tests/integration/adt.integration.test.ts` (`describe('runAtcCheck (worklist + variant flow)')`)

a4h converges on the first poll, so it cannot exercise the stall — but it can prove the fix did not slow
down or destabilise the normal path, which is the regression that would matter in production.

- [ ] Add a test asserting a normal a4h run returns well inside its budget: call `runAtcCheck` with
      `{ timeoutMs: 60_000 }` against `KERNEL_CLASS_URL`, measure elapsed wall time around the call, and
      assert it is far below the budget (e.g. `< 45_000`) **and** `expectSoundResult(result)` still holds.
      Without the fix this assertion passes too — it is a guard against the fix introducing waiting, not a
      reproduction of the bug. State that in a comment so the next reader does not mistake it for one
- [ ] Do NOT add integration commands to `## Validation Commands` — `requireSapCredentials()` throws
      without `TEST_SAP_URL` and would fail every task
- [ ] Run `npm test` — the unit suite must still pass (integration is a separate lane)

### Task 5: Document the settled-worklist semantics

**Files:**
- Modify: `AGENTS.md` (the ATC-run row)
- Modify: `docs/dev-guide.md` (the `Modify ATC check run` row)
- Modify: `docs_page/tools.md` (the `atc` action bullet)
- Modify: `docs/research/2026-08-20-atc-completeness-polling.md` (mark the design question resolved)

The current docs describe the poll loop as "poll until its finding count matches that total", which is
exactly the behaviour this plan replaces.

- [ ] `docs/dev-guide.md`: replace the "poll … until its finding count matches that total" clause with the
      settled-worklist rule — polling stops when the finding/processed-object counts are unchanged across
      `ATC_SETTLED_POLLS` reads, the completeness verdict is unchanged, and the reason is recorded. Link
      `docs/research/2026-08-20-atc-completeness-polling.md` and cite the 7.50 measurement
- [ ] `AGENTS.md`: extend the ATC row with the one-line gotcha — `complete` ANDs criteria that polling
      cannot change, so the loop stops on settlement, not on completeness. Keep the row terse
- [ ] `docs_page/tools.md`: in the `atc` bullet, state that an incomplete result now returns as soon as the
      worklist settles instead of consuming `timeoutSeconds`, that the verdict itself is unchanged, and
      document `variantSource: "requestedUnverified"` plus the new default-payload fields from Tasks 2 and 3
- [ ] In the dossier, replace the open question in §7 with the decision taken (stability rule, and why the
      structural-criterion rule was rejected: it does not cover the customer's short-count manifestation)
- [ ] Do NOT add a `docs_page/release-notes.md` entry here. Per `AGENTS.md` the annotated entry is written
      while the release-please PR is open, which is what fixes the version number; note the latency change
      and the two payload changes in the PR body instead so the release PR has the material
- [ ] Run `npm test` — no test should depend on the old wording

### Task 6: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Run `npm run build` and `npm run check:sizes` — both ratchets green (run this AFTER every source and
      test edit is final; the pre-commit formatter can re-wrap long lines and change line counts)
- [ ] Confirm the frozen tool surface is untouched: `git diff tests/fixtures/tool-definitions/` is empty
      (this plan changes no tool schema text)
- [ ] **The decisive live check** — NW 7.50, creds per `INFRASTRUCTURE.md`. Before the fix this returned in
      wall-time == timeout; after it, it must return in seconds:
      `SAP_URL=https://npl.marianzeis.de SAP_USER=DEVELOPER SAP_PASSWORD=… SAP_CLIENT=001 SAP_INSECURE=true node dist/cli.js atc CLAS CL_ABAP_TYPEDESCR --timeout 240 --format json`
      Time it. Expect: exit `3`, the same two incomplete reasons as before plus the new settled reason, and
      wall time far below 240 s. Record the before/after numbers in the PR
- [ ] Live regression on a4h (S/4HANA 2023 / 758): `npm run test:integration -- -t "runAtcCheck"` — all ATC
      tests still pass, and `arc1-cli atc PROG Z_CREATE_BOOKING_SAMPLES --format json` still reports
      `variantSource: "systemDefault"` with the system default variant and a `complete: true` result
- [ ] Move this plan to `docs/plans/completed/`, then fix any relative links inside it (completed plans sit
      one directory deeper — `../research/…` paths gain a level)
