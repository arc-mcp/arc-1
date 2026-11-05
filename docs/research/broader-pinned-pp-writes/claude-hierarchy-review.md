# Hierarchy early-exit review — Claude Code Opus 5.5 max

Date: 31 October 2026. Read-only CLI review of an immutable source snapshot.
The foundation review covers commit `87dcd620a`; the hierarchy review covers the separate
early-exit delta atop that commit. Findings below are preserved verbatim. Fixes and final
qualification remain tracked in the [progress record](../2026-10-31-broader-pinned-pp-writes-progress.md).

`src/adt/package-hierarchy.ts` has no correctness or safety defect, but this delta leaves two existing tests unable to catch what their titles claim, so the tests need a small fix. I reviewed this on `claude-opus-5-5` at max effort and used all 8 reads. Paths are relative to the frozen `source/` directory.

## Findings

1. **Low: the "every POST" test now checks one POST.** `tests/unit/adt/pinned-package-hierarchy.test.ts:107-109`
   - The delta lowered the expected count from 2 to 1, so the budget is only checked on the root request. No test I read checks it on a second-level fetch.
   - The source is correct today because every level uses the same frozen `policy` (`src/adt/package-hierarchy.ts:57`).
   - **Fix:** use a target two levels down and expect 2 POSTs.

2. **Low: the between-levels cancellation assertion can no longer fail.** `tests/unit/adt/pinned-package-hierarchy.test.ts:135-137`
   - `ZA` is both the target and in the root response, so early exit never requests `parent_name=ZA`, whether or not cancellation works. The `.rejects` only repeats the abort-with-positive case at lines 72-80.
   - The handler test has the same shape (`tests/unit/handlers/pinned-writes.test.ts:276-288`), though its state and phase assertions still prove the abort beats the positive result. Nothing I read now tests that a walk stops between levels.
   - **Fix:** change the target to `ZB`, which isn't in the response.

3. **Low: a pinned positive reaches one level deeper than a full walk, and neither cap boundary is tested.** `src/adt/package-hierarchy.ts:198,215`
   - On a chain from `Z0` to `Z50`, the pinned check now returns true for `Z50`. The legacy walk and the pre-delta pinned check refuse it, because the non-empty frontier at depth 50 throws.
   - Legacy limits and the pinned request count are unchanged, but the pinned acceptance boundary moved by one level. Keep the code: the path was observed natively and no extra request is sent.
   - The tests use `Z51` (line 71) and an absent target (line 69), so swapping the cap and stop checks at lines 210-215 would go unnoticed.
   - **Fix:** with the existing fixtures, assert `Z50` true, `Z51` `maxDepth`, `Z9998` true and `Z9999` `maxPackages`.

4. **Nit: the cancelled self-check is untested.** `src/adt/package-hierarchy.ts:51-52`
   - The delta correctly makes a cancelled `root === pkg` check reject instead of returning true, but `tests/unit/adt/pinned-package-hierarchy.test.ts:117` only uses a non-self target.
   - **Fix:** add a self-target case.

## Checked, no defect

- **Legacy behaviour:** `stopAt` is undefined at line 182, so line 215 can't fire. Check order, limits, error text and the cache purge on failure match the removed code. The fetcher is now called without `this`, but an unbound `getSubpackages` needs `this.http` (`src/adt/client.ts:1290-1292`), so it couldn't have worked before either.
- **Positive evidence:** walk order is unchanged, so an early true means a full walk would also have reached the target, through edges from fresh responses in this check.
- **New allows:** these only occur where a full walk would have failed after seeing the target. That means a later fetch failure (including on the target's own children), cap overflow or deadline expiry. This is the design you described, and I accept it.
- **Order dependence:** in an oversized subtree the outcome now depends on SAP's response order, and a reorder between preflight and the under-lock check fails closed. No failure is swallowed, because fetches are sequential and nothing is in flight at the return.
- **Negative decisions:** `false` is returned only after the frontier empties (line 65). Completeness is limited by `getSubpackages`, which truncates children per parent without an error (`src/adt/client.ts:1300`). A package past the truncation is denied rather than allowed, and this predates the delta.
- **Caps:** the cap check runs before the stop check (lines 210 and 215), so a target beyond the cap is refused. The pinned path keeps the same defaults of 50 and 10,000.
- **Failures and cancellation:** everything inside the `try` becomes `AdtSafetyError` (line 67). `throwIfRequestCancelled` covers both abort and deadline (`src/adt/http-deadline.ts:70-79`) and runs at lines 51, 56 and 58. Only promise-resolution ticks, with no I/O, separate line 58 from the returned decision.
- **Fresh evidence:** the pinned resolver holds no state and builds a new set per call, so the no-op `invalidate` is correct.
- **Handler coverage:** the drift tests are intact (`tests/unit/handlers/pinned-writes.test.ts:246-259`, `322-333`, `334-360`). Lines 288 and 319-320 pin the under-lock re-fetch and the skipped `$TMP` read.

## Remaining risk

The lock-held traversal from the prerequisite review is reduced, not eliminated. A deep target or a negative decision can still send up to 10,000 sequential POSTs under the lock, limited only by the shared deadline. A downward walk can't prove a negative any sooner.

## Not verified

- **Tests:** I ran none, so everything above about tests comes from reading them.
- **Manifest hashes:** I had no hashing tool, so they're unchecked. The frozen `package-hierarchy.ts` matches the diff by reading.
- **Call sites:** my caller search was too broad and spilled to a file outside the frozen directory, leaving only `src/handlers/write-helpers.ts:939-952` visible. Opening it would have been a ninth read outside your allowed path, so I didn't.
    - I therefore did not read `checkPackage`, `getPackageHierarchyResolver` or the `packageHierarchyDecision` call sites, none of which is in a file this delta changes.
    - That the memo lasts for one check rests only on its definition (lines 75-92) and the call counts asserted at `tests/unit/handlers/pinned-writes.test.ts:319-320`.
- **Other unread source:** I didn't read `parseSubpackageNodestructure`, and read the handler test only at lines 245-384.

## Verdict

**FIX, tests only.** `src/adt/package-hierarchy.ts` is accepted as written, including the deeper pinned boundary and the new allows described above. Findings 1-4 are all test edits and don't change the source.
