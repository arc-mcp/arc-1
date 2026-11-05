**Verdict: ACCEPT, for this refactor only.** I found no regressions or security issues. The test gaps below don't hide a defect in this delta, but close them before adding the first new row.

Paths are relative to the snapshot's `source/`.

## What I confirmed by reading
- **Invocation is equivalent:** the old branch rules reduce to exactly the four rows' field and type sets, so `pinnedMutationAllowed` gives the same result for every input (`src/server/multi-target-write-surface.ts:10`). Reordering the checks only moved `false` returns, and they have no side effects. These edge cases also match:
  - `undefined` values are still ignored, and `null` in `type` or a non-admitted field is still refused.
  - `action: null` on `SAPActivate` still defaults to `activate`.
  - `edit_method` with `type` omitted still passes this gate.
  - The local-class regex is unchanged, and `String(args.method)` runs on the same inputs, including any that make it throw.
- **Advertisement is unchanged:** `SAPWrite` keeps the same nine fields and `SAPActivate` the same three, with actions and types in the same order. Property order still comes from the source schema (`src/server/multi-target-tools.ts:128`).
- **Nothing new is reachable:** the router (`src/server/multi-target-tools.ts:106`) and the handler recheck (`src/handlers/write/pinned.ts:40`) are unchanged, as is the non-pinned path. No imports of the removed constants remain, and nothing claims mixed-tool support or new adapters.
- **Rows are immutable:** rows and their arrays are frozen, and the surface helper returns fresh copies. Lookup uses strict comparison, so an action like `__proto__` can't match a row.

## Where the tests or claims fall short
1. **Row contents aren't pinned.** `tests/unit/server/pinned-mutation-capabilities.test.ts:28` pins only `tool.action`, and lines 59-61 compare the schema with the rows it derives from. These edits would pass all four new tests:
   - adding `'DDLS'` to `create.types`, because line 73 only tries `PROG`
   - adding `method` to `create.fields`, because lines 79-82 have no create-plus-method case
   - removing `expectedSourceHash` from `update.fields` or `description` from `create.fields`, because no test makes a positive per-row field call

   My search found no same-line create-plus-method refusal in older tests, and I didn't check whether they catch the other edits. An exact pin of each row, plus one full-field positive call per row, closes this.

2. **The future-mutation sweep only tests `SAPWrite` and `SAPActivate`.** Line 32 of that test calls `pinnedMutationAllowed`, but the router only sends those two tools there. `MULTI_TARGET_TOOLS` and `ALLOWED_OPS` decide everything else, such as `SAPGit` and `SAPManage`.
   - **Effect:** the sweep passes for those tools whatever the router does, and wouldn't notice `Update` being added to `ALLOWED_OPS`.
   - **Existing coverage:** the router tests I found (`tests/unit/server/multi-target-tools.test.ts:212-234`) are a hand-picked list under `DEFAULT_CONFIG`.
   - **Fix:** run the sweep through `multiTargetInvocationDecision` with the `writer` config, which is closer to the P2-B gate in `docs/plans/2026-10-26-broader-pinned-pp-writes.md:469`.

3. **"Advertised fields derive from the rows" is only partly true.** The enums come from the rows and the inherited properties are filtered by them. However, six `SAPWrite` properties are hard-coded (`src/server/multi-target-tools.ts:143-172`), as is `required` (line 178).
   - **Today:** all of them are correct for the current rows, and line 61 of the new test fails if a row change drops one of the six from the union. Nothing checks `required`.
   - **`resource`:** nothing in the files I read uses this row field, so it's a label rather than enforcement.

## Limits of this review
- **Tests:** I ran nothing, so the test and validation results are as you reported them.
- **Hashes:** I didn't recompute the manifest hashes. The two modified files match `diff.patch`, with `src/server/multi-target-tools.ts` checked only at the changed lines.
- **Not read (10-read limit):** `assertPinnedOwner`, the activation handler, the runtime and projection code, older handler tests and the tool snapshots. This delta doesn't change any of them, but "byte-identical" rests on my reading of the code, not on the snapshots.