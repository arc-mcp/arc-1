# Claude Code recovery follow-up — 1 November 2026

Actual Claude Code v2.1.302, `claude-opus-5-5`, effort `max`. Reviewed immutable revision
`550cd028853f82883984a7e55fe2f2ab1554bde7`; 2,562 manifest entries verified unchanged by
the reviewer and again by the author. The report below is verbatim. It covers the recovery/evidence
delta, not the subsequent include adapter or whole-PR readiness.

---

# PR #1142 recovery delta at `550cd0288`: retain it and keep developing

**Retain this delta and continue development; this is not whole-PR or merge approval.** I found no High or Medium issues, and all eight earlier findings are closed. The harness behaved correctly on every path I traced. The five new findings are all Low (four test or wording gaps, one docs wording), and none needs a new live run. The live evidence stays bound to `1b234d3a4`.

Bare file names are in `scripts/qualification/pr1142/`. "Record" means `docs/research/broader-pinned-pp-writes/pp-write-delete-formatter-2026-11-01.json`, and "combined doc" means `docs/research/2026-11-01-broader-pinned-pp-writes-combined-qualification.md`.

## Findings (all Low)

1. **The new simulation's foreign-change check can't fail.**
   - **Gap:** `formatter-regression.mjs:267-270` checks only that `style` stays `keywordLower` and that the run failed. The primary's baseline and expected state share `keywordUpper`, so a restore write only ever sends `indentation` (`formatter-qualification.mjs:19-20`, enforced by the mock at `formatter-regression.mjs:158-159`). If restore-only skipped the guard at `formatter-qualification.mjs:155`, it would overwrite indentation, fail verification at `:169`, and still pass both checks.
   - **Current behaviour:** the code is correct. The scenario printed `mutations: 5` (four forward writes plus one on the second recovery), so the first recovery wrote nothing. The `foreign-change` scenario protects the guard only on the forward path (`formatter-regression.mjs:313`).
   - **Fix:** after the first recovery, assert that `values.writerA` is `{ indentation: false, style: 'keywordLower' }`, that `mutations` is still 4, and that the failure is `restore-writerA.owned_state`.

2. **The refusal before the baseline save has no test.** `README.md:84-85` and the combined doc `:95` rely on it. `restore-binding-refusal` (`formatter-regression.mjs:291-302`) stops at the binding check, so nothing reaches the shape check at `formatter-qualification.mjs:237-238`.
   - **Fix:** capture the journal at its first write and run composed restore-only against it. Assert `journalOwned: false`, `RESTORE_WRITERA_SHAPE`, no new HTTP or native calls, and unchanged parent bytes.

3. **Two recovery branches have no assertions.** Both are correct by reading, so add the assertions to these existing tests.
   - **Original outcome:** `qualification.mjs:28-34` saves the original `restored`, `restorationStatus` and `nativeSeedRestored` before `:38-40` overwrite them. The only test with a `parent.formatter` doesn't inspect history (`tests/unit/scripts/pr1142-harness-safety.test.ts:105-108`).
   - **Finished journals:** `formatter-qualification.mjs:428-431` must keep `finishedAt` and add no `interrupted`. `success-replay-restore` (`formatter-regression.mjs:245-247`) and `cleanup-read-failure` (`:322-325`) run this path but never read the journal back.

4. **The subprocess tests don't reach the real entrypoints, and the README implies they do.** The test script imports only `process-boundaries.mjs` (`tests/unit/scripts/pr1142-harness-safety.test.ts:26-37`). Removing the hook at `native-fixtures.mts:14` or `native-formatter.mts:12`, or reverting `live-harness.mjs:31`, would leave all 11 tests and 36 simulations passing. The combined doc's "same hooks" (`:99-101`) is accurate, but `README.md:67` says "subprocess tests cover those boundaries".
   - **Fix:** say they cover the hooks, and add a check that each real entrypoint installs its hook.

5. **Two status lines are looser than the record.**
   - `docs/plans/2026-10-26-broader-pinned-pp-writes.md:5` (new here) says the run qualifies "v5 formatter operations". The combined doc says "listed" cases (`:7`), and only two of the four accepted styles ran.
   - `docs_page/roadmap.md:226` (older text) lists "unsupported" styles as the limit, which omits the accepted but untested `keywordAuto` and `none`.

## What I verified

- **Parent signals and stdout:** `emit` is the only stdout writer in the parent's modules, and it now swallows stream errors (`live-harness.mjs:31`). SIGINT and SIGTERM both run the cooperative `stop`, and a repeated signal does nothing (`:446`, `:465-466`). By trace, a Ctrl-C that also kills `tee` no longer aborts cleanup.
- **Worker SIGINT:** workers share the parent's process group (`native-check.mjs:23-44`), and the hook is the first statement in both. The only SIGINT handler in `src/` is `src/server/shutdown.ts:46-47`, registered from `src/server/server.ts:1488`, and the workers never start the server.
- **Remaining SIGINT window:** a Ctrl-C can still kill a worker while imports load, about 330-380 ms in this run's timings, or kill the git children of `verifyRunManifest`. No SAP call has happened by then, so the step fails closed, and a cleanup worker hit then leaves its fixture for a retry. This stays within the README's "no Ctrl-C" rule, so "in-flight" is accurate.
- **Subprocess tests:** they use real signals and really closed pipes, and a nonzero exit fails the test. The hook is installed before `ready` prints, so there is no race. A stalled reader isn't tested, and regular-file logs remain required.
- **Previous failed recovery:** `qualification.mjs:27` keeps the whole earlier result, including `failures`, and the simulation deep-compares it (`formatter-regression.mjs:280`).
- **Recovery versus forward completion:** restore-only writes `recoveryFinishedAt`, never `finishedAt`. The parent gains no `formatter`, `finishedAt`, `passed`, `failed` or `allAbsent` (`formatter-regression.mjs:284-289`).
- **Composition and durable files:**
  - The simulation runs the real wrapper with the real `privateJson` and `durable`, using a journal captured at the `formatter-qualification.mjs:340` save.
  - The override at `qualification.mjs:48` can't come from command input, because `live-harness.mjs:320` passes fixed keys.
  - The parent is handwritten (`formatter-regression.mjs:255-264`), which is harmless because recovery uses none of the fields a real parent would add.
- **Refusal before the baseline:** by reading, this holds.
  - Nothing saves the journal between its creation (`formatter-qualification.mjs:254`) and the baseline save (`:307`), so the file's baseline is either empty or complete.
  - An empty baseline refuses at `:237-238` with `journalOwned` false, so `qualification.mjs:8` records nothing.
  - The first preference writes come later (`:311`, `:330`), so "cannot have changed preferences" holds for this harness's own writes.
- **Machine record:**
  - **Initial assertions:** 3 × 13 = 39 entries, all `pass: true`, with names and order matching `live-harness.mjs:111-135` and `mcp-checks.mjs:225-289`. Timestamps precede the deletion start (record `:65`).
  - **Receipt count:** 189 = 103 + 61 + 23 + 2. The 103 and 61 match the `private_no_store` counts and the clean simulation request counts, and the 23 is 17 deletion plus 6 formatter receipts from the code.
  - **Two extra documents:** their names match `native-formatter-fixture.mts:75` and `native-formatter.mts:91`, and neither adds a SAP call.
- **Binding:** `run-manifest.mjs:43-48` hashes every `.mjs` and `.mts` file in the directory, so the next run covers `process-boundaries.mjs`. The patch leaves the recorded run and harness fields unchanged.
- **Overclaims:** none beyond finding 5.
  - `docs_page/multi-target-writes.md:145-151` matches `src/adt/pinned-formatter.ts:19`, `:106`, `:146`, `:199` and `:229-232`.
  - The changed docs that mention secondary preference evidence keep it MCP-only, and none claims a native conditional-write guarantee.
  - "Every live preference write" (`:150`) is publicly evidenced for the four PP writes (record `:226-231`). The two fixture PUTs' values are in a private ledger, and this doesn't weaken any limit.
- **Prior reviews:** the patch adds one review file and edits no existing `claude-*.md`.

## Earlier findings

| # | Finding | Disposition |
|---|---|---|
| 1 | Roadmap implied a review of results | Closed: `docs_page/roadmap.md:219-222` |
| 2 | Incomplete F4 wording | Closed: `docs_page/multi-target-writes.md:145-148`, record `:350`, combined doc `:58` |
| 3 | Implied ETag protection | Closed: `docs_page/multi-target-writes.md:149-151` |
| 4 | README overstated F3 | Closed: `README.md:82-85` |
| 5 | Stale tracking docs | Closed: `docs/adr/0011-broader-pinned-pp-mutations.md:129-141`, `docs/research/broader-pinned-pp-writes/inventory.md:24`, `:40` |
| 6 | Repeated recovery lost the outcome | Closed: `qualification.mjs:27`; one related branch is untested (finding 3) |
| 7 | Recovered journal looked finished | Closed: `formatter-qualification.mjs:428-431`; the finished-journal branch is untested (finding 3) |
| 8 | Regression stopped at the function | Closed: `formatter-regression.mjs:248-290`; one check is weak (finding 1) |

The earlier F1 carry-over is fixed for SIGINT and closed stdout. SIGHUP and process-group SIGTERM stay excluded, as documented.

## Tests run

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` | Ran first and last: 2,562 files `unchanged`, revision `550cd0288…` |
| `npm exec -- vitest run tests/unit/scripts/pr1142-harness-safety.test.ts` | 11 of 11 passed |
| `npm run test:qualification:pr1142` | All 36 printed `passed:true` (19 formatter, 17 deletion) |

These are offline mocks and simulations, not SAP or CF evidence. They wrote `test-results/unit.json` and used temp directories.

## Limitations

- **Mutation claims:** findings 1 and 4 are traced by reading, because no edits were allowed for running mutants.
- **Checks with no result for this revision:** typecheck, lint, strict docs, budgets and the full unit suite. I wasn't permitted to run them, and `review-input/author-checks.txt:1`, `:3` still describes `741b31b02` (9 tests, 35 simulations). Lint also excludes this harness directory (`biome.json:57-67`).
- **Unavailable inputs:**
  - **No `node_modules` inside the root:** `tsx` is shown only by the subprocess test's behaviour, and a competing SIGINT listener in other third-party worker dependencies isn't ruled out.
  - **Raw logs, receipts, scenario files and the private manifest:** the 39 pass values, the 189-file list and `privateReceiptManifestSha256` remain operator-supplied. I checked their counts and shape against the code only.
- **Revision identity:** without `git`, the tree's revision rests on the manifest label. I took `patch.diff` as complete, and its hunks match the changed code and doc lines I read in final form.
- **Native behaviour:** the simulations mock native SAP access, and no actual process kill was exercised. I didn't recompute `harnessSha256`, since this harness has changed since the run.

**Tool restrictions:** no deviations. I ran only the three permitted commands and read only inside this root. I made no edits beyond the test outputs above and used no delegation.
