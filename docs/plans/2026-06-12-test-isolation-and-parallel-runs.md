# Test Isolation, Parallel Instances & Flakiness Plan

Status: P0–P2 + F1 shipped 2026-06-12 (H1, A1, A2, B1–B3, C1, C2, D1, E1/E2, F1, G1). Remaining /
deferred: H2 (CI retry + flake telemetry — needs the vitest-4 reporter retry format verified first),
F2 (parallel read-only e2e project — conditional on F1's CI numbers), H3 (cross-run flake-aggregation
workflow), E3 (run manifest, optional), H4/H5 (SABP unit-test follow-up; flip execution-assert to
enforce). C3/G2/G3/F3 remain explicitly rejected (§7).

Goal: multiple integration/e2e runs (several local worktrees, local + CI) can target the **same SAP
system at the same time** without affecting each other, each with proper teardown; selectively
parallelize tests for speed; retire the remaining CI flakiness.

---

## 1. What actually interferes today (evidence)

### 1.1 Same machine — two e2e runs kill each other (critical)

- `scripts/e2e-start-local.sh:8-48` — fixed port `3000`, fixed PID file `/tmp/arc1-e2e.pid`, and a
  belt-and-suspenders `lsof -tiTCP:$PORT | kill`. A second `test:e2e:start` **terminates the first
  run's MCP server mid-flight**. This is the most violent interference and entirely local.
- `E2E_LOG_DIR` defaults to a shared `/tmp/arc1-e2e-logs`; the start script truncates the log
  (`> "${LOG_FILE}"`, line 69), so concurrent runs also destroy each other's logs.
- Not affected: `test-results/*.json` and skip-NDJSON are cwd-relative (worktrees isolate them);
  e2e runs with `ARC1_CACHE=memory` (line 80), so no sqlite cache file is shared.

### 1.2 Same SAP system — shared persistent e2e fixtures (high)

- 8 fixed-name fixtures in `$TMP` (`tests/e2e/fixtures.ts:30-79`: `ZARC1_TEST_REPORT`,
  `ZARC1_E2E_DUMP`, `ZIF_ARC1_TEST`, `ZCL_ARC1_TEST`, `ZCL_ARC1_TEST_UT`, `ZTABL_ARC1_I33`,
  `ZI_ARC1_I33_ROOT`, `ZI_ARC1_I33_PROJ`).
- Sync (`tests/e2e/setup.ts`) **deletes + recreates on source drift**. Two runs on *different
  branches* with different fixture sources will ping-pong the objects and break each other's
  read-back assertions. Two runs on the *same* branch race only on first-create/recreate
  (423 / "already exists" → classified as skip, so the loser silently skips tests).
- `rap.e2e.test.ts:150-170` **mutates a shared fixture**: the `SAPActivate` tests lock+activate
  `ZARC1_TEST_REPORT`. Two concurrent runs → 423 lock conflicts. (This same code path produced the
  06-05 `SABP` package-ceiling failures — see §3.)
- `assertSyncedFixturesActive()` (end of sync) can also trip over another instance that is mid-
  recreate (its fixture is legitimately inactive for a few seconds).

### 1.3 Same SAP system — name-collision window (medium-low)

- Integration: `generateUniqueName` (`tests/integration/crud-harness.ts:21-28`) =
  `prefix_` + last 6 chars of `Date.now().toString(36)` + a **process-local counter that starts
  at 0**. Two runs launched in the same millisecond produce *identical* names (same ms, both at
  counter 0). Unlikely per call, but the failure mode is a confusing cross-run 423/"already exists".
- E2E: three different ad-hoc `uniqueName()` copies (`ddic-write.e2e.test.ts:12`,
  `class-section-surgery.e2e.test.ts:17`, `func-write.e2e.test.ts:17`) plus a raw
  `Date.now().slice(-6)` in `activation-failure.e2e.test.ts:48`. Most include `Math.random()`
  (good), but the helpers are duplicated and inconsistent; none carry a run identity.
- A per-run **local package** namespace already exists as prior art: `rap-write.e2e.test.ts:37`
  creates `$ARC1T_<unique>` packages, allowlisted via `SAP_ALLOWED_PACKAGES='$TMP,$ARC1T_*'`.

### 1.4 Same SAP system — work-process budget (medium)

- Each e2e server runs with `ARC1_MAX_CONCURRENT=10` (default). Tests are sequential, so a single
  run keeps ~1-3 requests in flight; two or three concurrent runs are typically fine, but each
  *additional* parallelism experiment (§6) multiplies this. The integration config comment
  (`vitest.integration.config.ts:13-15`) records that parallel files have already exhausted WPs
  once ("Service cannot be reached").

### 1.5 Leakage without teardown (medium)

- Integration cleanup is good in-run (`CrudRegistry` + `retryDelete` 5× exponential backoff,
  `crud-harness.ts:81-141`) but **crash/CTRL-C/timeout leaks objects** with no sweeper.
- Transport tests create CTS requests described `ARC-1 IT …`; a4h has no transport routes, so
  leftovers accumulate as local TRs.
- `$ARC1T_*` packages and `ZARC1_*`/`ZCL_ARC1_E303*`/`ZARC360*`/`ZSTR_ARC1*` objects from aborted
  runs accumulate in `$TMP`.
- E2E persistent fixtures intentionally persist; `npm run test:e2e:fixtures:clean` already exists
  for explicit removal (`tests/e2e/sync-fixtures.ts`).

### 1.6 What is already solved

- **CI vs CI**: all SAP-touching jobs (`integration`, `e2e`, `sap-slow`) share the job-level
  concurrency group `${{ github.repository }}-sap-live-a4h` with `cancel-in-progress: false` —
  verified empirically (6-run burst on 06-12 executed strictly back-to-back, queue waits up to
  32 min). The remaining unprotected combinations are **local↔local** and **local↔CI**.
- In-run isolation between test *files* of one run: unique names + per-file clients.

## 2. Goals / non-goals

Goals:
1. N concurrent runs (any mix of local/CI) against one SAP system don't fail or skip because of
   each other.
2. Every run tears down what it created, including after crashes (janitor backstop).
3. Shorter wall-clock where safe (within-run parallelism), without re-triggering WP exhaustion.
4. Retire the active CI flake; make future flakes visible instead of anecdotal.

Non-goals: sharding one logical suite across machines; isolating runs that *change fixture
sources* on diverging branches (rare; documented limitation unless §5-C3 is ever needed);
serializing third parties outside this repo.

## 3. CI failure history (last ~3 weeks, analyzed 2026-06-12)

| When | Failure | Class | Status |
|---|---|---|---|
| 06-10 (runs 27263405092, 27301375927) | `adt.integration.test.ts > getCdsTestCases > returns suggested test cases` — `Test timed out in 30000ms` | SAP-transient | **Active flake** — only one. No per-test timeout; the ATC test in the same file uses 90 000 ms |
| 06-05 ×3 | `rap.e2e.test.ts > SAPActivate` — `package 'SABP' blocked by safety configuration` | Deterministic regression from #357 (allowedPackages ceiling on activation; old system resolved fixture's real package as `SABP`) | Sidestepped by the 06-06 A4H-2025 migration, **not code-fixed** — latent for on-prem 758 |
| 06-03→06-05 ×6+ | `transport.integration.test.ts` hooks (10 s) + `runAtcCheck` (30 s) timeouts | SAP-transient (old A4H 2023 health) | Fixed: hookTimeout→60 s (#353) + system migration (#365) |
| 06-06 ×2 | e2e LOCK/UNLOCK `Service cannot be reached` | Infra during CI target migration | One-off |
| 06-05, 06-11 | Trivy release gate (docker publish) | Release infra, not tests | Tracked in `release.yml` comments |

Since 06-07: 32 of the last 40 Test runs green, 0 test failures except the two `getCdsTestCases`
timeouts. Reliability tooling exists per-run (`scripts/ci/collect-test-reliability.mjs` → step
summary + 7-day artifacts) but there is **no cross-run aggregation**, so flake detection is manual.

## 4. Design concept: run identity

Introduce one tiny seam used everywhere: a **run ID** — `TEST_RUN_ID` env var if set, else
generated once per process (3 base36 chars from `crypto.randomBytes`). Everything a run creates
embeds it (object names; log/PID paths; optionally `$ARC1T_<RUNID>_*` packages). This is the
foundation for both cross-instance safety and janitor attribution. ABAP name budget stays intact:
`prefix(≤20) + '_' + runId(3) + ts(5) + counter(1+)` ≤ 30 — current longest prefixes are 14 chars.

## 5. Suggestions, each evaluated

Effort: S < ½ day, M = 1-2 days, L > 2 days. Verdicts: ✅ recommend, 🟡 recommend with caveat,
❌ not recommended.

### A — Run-scoped naming

| # | Suggestion | Evaluation |
|---|---|---|
| A1 | **Add run-ID entropy to `generateUniqueName`** (`crud-harness.ts:21`): new `tests/helpers/run-id.ts` exporting `RUN_ID`; suffix becomes `${RUN_ID}${ts5}${counter}`. | Effort **S**, risk ~0 (names stay ≤30, the existing length throw still guards). Closes the same-millisecond collision and makes every leaked object attributable to a run. **✅ Do first.** |
| A2 | **One shared e2e `uniqueName()`** in `tests/e2e/helpers.ts` (run-ID + ms + random), delete the 3 local copies + the raw `Date.now()` in `activation-failure.e2e.test.ts:48`. | Effort **S**, risk ~0. Consistency + distributed safety; also the hook point for any future namespace scheme. **✅** |

### B — Same-machine independence (e2e server)

| # | Suggestion | Evaluation |
|---|---|---|
| B1 | **Dynamic port + per-run paths.** `e2e-start-local.sh`: when `E2E_MCP_PORT` is unset, pick a free port (`node net.listen(0)` probe); derive `LOG_DIR=/tmp/arc1-e2e-logs/<RUN_ID>` and `PID_FILE=$LOG_DIR/mcp-server.pid`. Because each `npm run` is a separate process, `test:e2e:full` must become one orchestrating script (`scripts/e2e-run-local.sh`) that picks the port once and exports `E2E_MCP_URL` for the vitest step (or the start script writes `$LOG_DIR/port` and `tests/e2e/global-setup.ts` reads it when `E2E_MCP_URL` is unset). | Effort **M** (script plumbing + global-setup fallback), risk low. Removes the single worst interference. **✅** |
| B2 | **Stop killing strangers.** Drop the `lsof` port-sweep (lines 36-48) or scope it to an explicitly stale own PID file; `e2e-stop-local.sh` kills only its own `$PID_FILE`. Keep the existing zombie warning in `global-setup.ts` (server >10 min old). | Effort **S**, risk: leftover zombies no longer auto-reaped → mitigate with an explicit `test:e2e:stop --all` flag for manual cleanup. **✅ ships with B1** (pointless before it: with fixed port 3000, killing the listener is the only way to start). |
| B3 | Per-run log dir also fixes the log-truncation clobber (1.1). | Free with B1. **✅** |

### C — Shared persistent fixtures

| # | Suggestion | Evaluation |
|---|---|---|
| C1 | **Concurrency-tolerant fixture sync.** In `tests/e2e/setup.ts`: on 423/"already exists"/"invalid lock handle" during create/recreate, **retry 2-3× with backoff, then re-check existence + source** before classifying as skip (another instance probably just created the identical object — that's success, not skip). Same tolerance window (one re-poll after ~5 s) in `assertSyncedFixturesActive()`. | Effort **S-M**, risk low (pure test-infra). Converts the loser of a sync race from "silently skips a chunk of e2e" to "proceeds normally". **✅** |
| C2 | **Stop mutating shared fixtures.** `rap.e2e.test.ts` SAPActivate tests create their own transient `ZARC1_ACT_<unique>` program (create→activate→batch-activate→delete) instead of activating `ZARC1_TEST_REPORT`. | Effort **S**, risk ~0, double win: removes the only cross-run *mutation* of a persistent fixture **and** de-fuses the latent SABP-class failure (activating a long-lived fixture whose real-package resolution can surprise, §3). Cost: +1 create/delete (~2 s). **✅** |
| C3 | **Full per-run fixture namespace** (template `{{NS}}` tokens into the `.abap` fixtures, create per run, delete in teardown). | Honest evaluation: the fixture set has **cross-object references** (`ZI_ARC1_I33_ROOT` selects from `ZTABL_ARC1_I33`; `…_PROJ` projects `…_ROOT`; tests assert on these names in read-backs), so this means consistent token substitution across fixtures *and* test assertions, plus per-run create/activate of 8 objects (~30-60 s setup) every run, plus harder on-system debugging. Effort **L**, risk medium. With C1+C2 in place the residual conflict is only "two branches with *different fixture sources* run simultaneously" — rare and self-healing on re-run. **❌ for now; revisit only if cross-branch fixture churn becomes routine.** |

### D — SAP load budget

| # | Suggestion | Evaluation |
|---|---|---|
| D1 | Make the shared-system budget explicit: `E2E_MAX_CONCURRENT` env passthrough in `e2e-start-local.sh` (default stays 10; document "use 4 when sharing the system"), and document expected per-run in-flight counts in `docs/dev-guide.md`. Optionally probe `rdisp/wp_no_dia` once and print it in the start banner. | Effort **S**, risk 0. Mostly documentation; the real protection is that suites stay sequential by default. **✅ (docs-grade)** |

### E — Teardown & janitor

| # | Suggestion | Evaluation |
|---|---|---|
| E1 | **Janitor script** (`scripts/test-janitor.ts`, npm `test:cleanup`): search (informationsystem/search or TADIR via existing client) for the canonical test prefixes — `ZARC1_*`, `ZCL_ARC1_E303*`, `ZCL_ARC1_CSURG*`, `ZARC360*`, `ZSTR_ARC1*`, `ZRES_*`, `$ARC1T_*` packages — minus the 8 persistent fixture names, and delete via the existing `retryDelete`. Prefix list lives in **one exported module** shared with the tests (playbook §3: derive, don't copy). Run manually or as an optional weekly `workflow_dispatch`/cron job inside the same `sap-live-a4h` concurrency group. Names embed the run-ID+timestamp after A1, so the janitor can also report *which* run leaked. | Effort **M**, risk: deleting an in-flight run's objects if executed concurrently → run it inside the same CI concurrency group, and locally only when idle; with A1 it can additionally skip objects whose embedded timestamp is < 2 h old (timestamp is truncated base36 — treat as heuristic, not proof). **✅** |
| E2 | Janitor sweeps leftover `ARC-1 IT` transports (release or delete empty local TRs). | Effort **S** on top of E1. **✅ nice-to-have** |
| E3 | **Run manifest**: tests append created objects to `test-results/created-objects.ndjson` so a crashed run can be cleaned precisely (`test:cleanup --manifest <file>`). | Effort **S** (CrudRegistry already centralizes registration; add a file sink). Worth it mainly as janitor input; skip if E1's prefix sweep feels sufficient. **🟡 optional** |

### F — Parallelism within one run (performance)

| # | Suggestion | Evaluation |
|---|---|---|
| F1 | **Integration: env-gated file parallelism.** `vitest.integration.config.ts`: `fileParallelism: process.env.TEST_FILE_PARALLELISM === 'true'` with `poolOptions.forks.maxForks: 2` (cap!). Within-run isolation already holds (unique names, per-file clients, per-file sequential). The constraint is purely SAP WP load — which is why it failed before, uncapped. Measure with the existing `test:runtime-report` before/after; integration job is ~4 min today, expect ~35-45% off the test phase with 2 forks. | Effort **S** config + **M** validation (3-5 CI runs watching for "Service cannot be reached"). Risk medium — kill-switch is the env var, default stays sequential. Caveats: `transport.integration.test.ts` CTS hooks and `audit-logging` are fork-isolated, fine; bump `maxForks` only after D1 documents the budget. **🟡 worthwhile experiment, opt-in, after A1/E1** |
| F2 | **E2E: parallel read-only project.** Split a second vitest project for the read-only files (`smoke`, `navigate`, `sapread-grep`, `revisions`, `server-driven-read`, `cds-context`, `cds-impact`, `diagnostics`, `concurrency-read`) with `maxForks: 2` against the one shared server (server handles concurrent sessions; `concurrency-read.e2e.test.ts` already proves 3 simultaneous calls). Mutating + timing-sensitive files stay sequential — **`cache.e2e.test.ts` must never parallelize** (asserts `cachedMs < firstMs`). | Effort **M** (project split + CI wiring), payoff moderate (e2e ≈ 4-5 min total; maybe 1-2 min saved), risk medium (the old config comment warns about queueing/cascades — mitigated by the cap and the reconnect-retry in `helpers.ts:113-164`). **🟡 do after F1 proves the pattern; skip if F1's numbers disappoint** |
| F3 | Parallelize `integration` and `e2e` CI jobs against each other. | They share the SAP system and deliberately sit in one concurrency group; `needs: integration` also sequences them. Removing that trades reliability for ~4 min. **❌** |

### G — Cross-actor coordination (local ↔ CI)

| # | Suggestion | Evaluation |
|---|---|---|
| G1 | **Advisory pre-flight**: `e2e-start-local.sh`/integration docs gain an optional `gh run list --status in_progress` check that *warns* "CI is currently running against this SAP system". | Effort **S**, advisory only (no hard block — devs may want to proceed). **✅ cheap courtesy** |
| G2 | **SAP-side run lease** (hold an ADT lock on a sentinel object for the run's duration; other instances queue). | Long-held ADT locks die with session timeouts, leases leak on crash and then block everyone, and once A1/B/C land the *need* disappears (runs genuinely don't collide). Complexity > benefit. **❌** |
| G3 | Shared self-hosted runner as the single SAP gateway for local + CI. | Over-engineering for a one-developer system. **❌** |

### H — Flakiness

| # | Suggestion | Evaluation |
|---|---|---|
| H1 | **Fix the one active flake**: per-test `timeout: 90_000` on the `getCdsTestCases` I_CURRENCY test (`adt.integration.test.ts:2262`), matching the 90 s ATC precedent in the same file. | Effort **XS** (one options object). **✅ quick win — do immediately** |
| H2 | **`retry: 1` in CI for integration + e2e configs** (`retry: process.env.CI ? 1 : 0`) **paired with flake telemetry**: extend `collect-test-reliability.mjs` to surface retried-then-passed tests as a "flaky" list in the step summary, so retries never silently mask decay. Verification step: confirm what the vitest 4 JSON reporter emits for retries (`retryCount`/`retryReasons`); if absent, parse the JUnit XML or use the blob reporter. | Effort **M**. Risk: retries without telemetry would hide real regressions — telemetry is therefore a hard prerequisite, not an add-on. **🟡 recommend in this paired form only** |
| H3 | **Cross-run flake aggregation**: a small scheduled workflow (weekly) that walks the last ~50 runs' `test-results-*` artifacts via `gh api` and produces a failure/flake leaderboard in its step summary. | Effort **M**, value: turns today's manual archaeology (this document's §3) into a 1-click report. Lightweight alternative: keep doing it ad-hoc with an agent. **🟡 nice-to-have, after H2** |
| H4 | **SABP latent regression**: C2 removes the trigger path in e2e; additionally add a unit test pinning "activation package-ceiling check uses the object's real package, with `$TMP` fixtures resolving to `$TMP` on 758-style responses" or a release-gated tolerance. | Effort **S-M** investigation. **✅ track as follow-up issue** (it will bite an on-prem 758 user, not CI) |
| H5 | Flip `assert-required-test-execution.mjs` from `--mode warn` to enforce once P0/P1 land, so a silently-skipping suite fails the build. | Effort **XS**, after skip rates stabilize. **✅ later** |

## 6. Roadmap

**P0 — quick wins (≈ ½ day, immediately shippable)**
H1 timeout fix · A1 run-ID in `generateUniqueName` · A2 shared e2e `uniqueName` · D1 docs.
Acceptance: two simultaneous `npm run test:integration` runs (two worktrees) pass with zero
cross-run "already exists"/423.

**P1 — independent concurrent e2e runs (≈ 2-3 days)**
B1+B2+B3 dynamic port / per-run paths / scoped kill · C1 sync tolerance · C2 de-mutate fixtures.
Acceptance: two simultaneous `npm run test:e2e:full` on one machine both pass; local e2e
overlapping a CI e2e run (same branch) passes without fixture-race skips.

**P2 — teardown hygiene (≈ 1-2 days)**
E1 janitor (+E2 transports, optional E3 manifest) · G1 advisory pre-flight · H4 SABP follow-up.
Acceptance: after a `kill -9`'d run, `npm run test:cleanup` leaves no `Z*ARC*`/`$ARC1T_*` leftovers
beyond the 8 persistent fixtures.

**P3 — performance & telemetry (experimental, measure-first)**
F1 integration `maxForks: 2` experiment → keep only if 3-5 consecutive CI runs stay clean ·
H2 retry+flake telemetry · then optionally F2 e2e read-only project and H3 aggregation.
Acceptance: integration job time reduced ≥25% with no new "Service cannot be reached" class
failures across a week of runs.

Dependency note: P3-F1 *increases* per-run SAP load — only start it after P0/P1 reduce the chance
that a second run is hammering the system at the same time.

## 7. Explicitly rejected

- **C3 per-run fixture namespacing** — cost (cross-referenced DDLS/TABL renames, per-run setup
  time, debuggability) outweighs the residual risk it covers once C1+C2 exist.
- **G2 SAP-side lease / G3 gateway runner** — fragile or oversized; the design goal is runs that
  *don't need* mutual exclusion.
- **F3 parallel integration↔e2e CI jobs** — deliberately serialized today; keep.

## 8. Open questions

1. `rdisp/wp_no_dia` on a4h-2025 — worth probing once (D1) to size `maxForks` and shared-run
   budgets with data instead of folklore.
2. Does the vitest 4 JSON reporter expose retry information for H2, or do we need the JUnit/blob
   reporter? (Verify before committing to the telemetry format.)
3. How often do two *branches with diverging fixture sources* actually run concurrently? If this
   becomes routine (e.g. several Claude worktree sessions all editing fixtures), revisit C3.

## Appendix: file map per suggestion

| Item | Files |
|---|---|
| A1 | `tests/integration/crud-harness.ts`, new `tests/helpers/run-id.ts` |
| A2 | `tests/e2e/helpers.ts`, `tests/e2e/{ddic-write,class-section-surgery,func-write,activation-failure}.e2e.test.ts` |
| B1-B3 | `scripts/e2e-start-local.sh`, `scripts/e2e-stop-local.sh`, new `scripts/e2e-run-local.sh` (or port-file read in `tests/e2e/global-setup.ts`), `package.json` |
| C1 | `tests/e2e/setup.ts` (`classifyFixtureError`, sync loop, `assertSyncedFixturesActive`) |
| C2 | `tests/e2e/rap.e2e.test.ts` |
| D1 | `scripts/e2e-start-local.sh`, `docs/dev-guide.md`, `.env.example` |
| E1-E3 | new `scripts/test-janitor.ts`, shared prefix module (e.g. `tests/helpers/test-prefixes.ts`), `package.json`, optional workflow |
| F1 | `vitest.integration.config.ts` |
| F2 | new `tests/e2e/vitest.e2e.readonly.config.ts` or vitest projects, `.github/workflows/test.yml` |
| H1 | `tests/integration/adt.integration.test.ts:2262` |
| H2 | `vitest.integration.config.ts`, `tests/e2e/vitest.e2e.config.ts`, `scripts/ci/collect-test-reliability.mjs` |
| H3 | new `.github/workflows/flake-report.yml` |
