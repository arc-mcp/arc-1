# Claude Code Opus 5.5 max — formatter v5 correction review

Source: `6495db84ed2067d9ae1150e7caecc888429b9a2a`. Actual CLI review. Native source proof was outside the restricted reader boundary; its premise was not independently reviewed. The focused adapter tests passed (48); the handler test could not load because its sibling setup file was absent from the snapshot. These snapshot defects must be corrected in the follow-up. No live mutation test was performed.

The report below is preserved verbatim. Dispositions and later acceptance are separate.

---

**I found no blocking problems in the TypeScript I could read, but I can't fully approve this correction.** I never saw the native source, so the premise you asked me to validate is still unconfirmed.

The file tools are restricted to `source/`, so reads of `../patch.diff`, `../manifest.json` and `../native-source/` were refused. Your shell rule allows only the vitest command, so I didn't try another route. I reviewed the resulting code rather than the diff, checked no hashes, and took the native contract from the repo's docs. The native check still needs a run that can read those paths.

If the documented contract holds, requiring v5, preserving all attributes and sending PUT as v5 fixes the reset hazard, and I found no new adapter bug.

## Findings

**1. High, evidence gap rather than a production bug: the pending v5 run can't detect the hazard it is meant to confirm.**
- **Where:** `scripts/qualification/pr1142/native-formatter.mts:55-69` and `scripts/qualification/pr1142/formatter-qualification.mjs:266-280`.
- **Trigger:** A4H's baseline has no optional preferences (`docs/research/broader-pinned-pp-writes/formatter-v5-contract-2026-11-01.json:56`). Nothing in `scripts/qualification/pr1142/` seeds or mentions any of the five fields.
- **Why it matters:** for those fields, the reader's deep-equal, its byte comparison and the adapter's read-back all compare nothing against nothing. The old lossy v2 writer would pass the reader's checks too, so a green run only proves SAP accepts a v5 PUT.
- **Fix:**
  - Seed nondefault values for all five fields natively before `native('before')`.
  - Make `before` mode fail unless all five attributes are present.
  - Restore the pre-seed XML as a journaled step.
  - Without seeding, state this limit at `docs/research/2026-11-01-broader-pinned-pp-writes-formatter.md:60-61`.
- **Remaining limit:** native proof would still cover only the primary user, because the secondary has no native reader (`scripts/qualification/pr1142/README.md:49-51`).

**2. Low: the research doc leaves two v2 gaps.**
- **Stale claim:** `docs/research/2026-11-01-broader-pinned-pp-writes-formatter.md:98` says no additional native request was needed to establish a different endpoint contract. Lines 46-53 now contradict that, so limit it to that checkpoint or delete it.
- **Unlabelled v2 evidence:** the two-user section and its Limits (lines 136-201) never say those writes used v2, yet lines 171 and 195 cite byte-identical XML. Line 65 bounds this only for someone who read it first.
- **Fix:** add a sentence to Limits saying those v2 PUTs may themselves have reset hidden preferences for both test users, so today's empty state doesn't mean they were never set. Line 64 only implies this.

**3. Low: the public page understates both the v5 requirement and the v2 history.**
- **Reads are refused too:** `docs_page/multi-target-writes.md:142` says patches require v5, but `get_formatter_settings` also fails on any target whose preferred version isn't v5 (`src/adt/pinned-formatter.ts:146`). Keep the strict read and add reads to that sentence.
- **Evidence not labelled:** lines 148-150 cite the earlier checks right after the v5 claim, without saying they used v2 or that no live v5 write has run. Add the wording already at `docs/adr/0011-broader-pinned-pp-mutations.md:129`.

**4. Low: three test gaps.**
- **Wildcard on reads:** the handler test records only method, path and body (`tests/unit/handlers/pinned-formatter.test.ts:38-42`), and no test in the snapshot calls `getPinnedFormatterSettings` directly. Pinning `src/adt/pinned-formatter.ts:146` to exact v5 would still pass, so assert `Accept: */*` and refusal of non-v5 there.
- **Read-back version:** no test returns a non-v5 document on read-back (`src/adt/pinned-formatter.ts:235`). Assert `update-unconfirmed`.
- **Possible empty comparison:** `tests/unit/adt/pinned-formatter.test.ts:67` should assert `before` has five keys, so line 72 can't pass on `{}`.

## Native-source questions still open
Any of these could become a blocker:
1. **Does each optional field's omitted default equal its ABAP initial value?** The docs say GET omits defaults and PUT saves omitted fields as initial (`docs/research/2026-11-01-broader-pinned-pp-writes-formatter.md:49-52`). The v5 round trip is lossless only if those match. If one doesn't, PUT flips it, and read-back could only catch that after the write, with no rollback.
2. **Does `*/*` always select the newest version?** A4H returning v5 doesn't establish the rule. If a later release adds v6 but `*/*` stays on v5, the check passes and v6-only fields reset, which is the case `src/adt/pinned-formatter.ts:14-16` says this guards against.
3. **Does `SET_WB_SETTINGS` persist any field v5 doesn't expose?** The docs say all five listed fields are passed, not that those are all the fields.
4. **Does v5 always emit `indentation` and `style`?** The parser refuses a document without them (`src/adt/pinned-formatter.ts:106`). v2 showed `indentation=false` being read back, but v5 hasn't been observed with it. If v5 omitted it, the harness's first patch (`scripts/qualification/pr1142/formatter-qualification.mjs:271`) would fail read-back after a successful PUT.

The "nondefault values" claim (line 59) and the formatter POST claim (lines 69-72) in the research doc also depend on that source.

## What I confirmed from the code and docs
- **No downgrade path:** `noReplay` (`src/adt/mutation-http.ts:50-56`) disables the 406/415 fallbacks (`src/adt/http.ts:799-803`). Explicit headers also bypass the negotiated-header cache (`src/adt/http.ts:446`, `src/adt/http.ts:480-482`).
- **Legacy separation:** pinned routes can't reach the v2 writer (`src/handlers/lint.ts:32-37`). The legacy path still uses v2 (`src/adt/devtools.ts:132-133`, `src/adt/devtools.ts:160-161`), and the deferral is documented at line 66-67 of the research doc and `docs/plans/2026-10-26-broader-pinned-pp-writes.md:451`.
- **Adapter:** the version check runs before any merge or PUT (`src/adt/pinned-formatter.ts:135-139`, `src/adt/pinned-formatter.ts:196-197`). Unrelated attributes are compared before PUT and on read-back (`src/adt/pinned-formatter.ts:218-224`, `src/adt/pinned-formatter.ts:238-241`).
- **Independent reader:** it requests `*/*` and requires v5, and `parseXml` keeps all attributes as strings (`src/adt/xml-parser.ts:106-112`), so it would see a lost field if the baseline had one. No local simulation runs it (`scripts/qualification/pr1142/formatter-regression.mjs:182-188`), so its first execution will be live.
- **Docs:** lines 55-67 of the research doc correctly separate read-only evidence from the pending write, and the contract JSON matches what you reported. "29 simulations" matches the scenario lists, 15 + 14 by my count. The three linked historical evidence records aren't in the snapshot, so I couldn't cross-check them.

## Approval
- **Source:** no blocking findings in the adapter, routing or reader, based on reading the final code rather than the diff. Finding 1 must be fixed before the pending run can count as preservation evidence.
- **Still pending, not claimed:** the native-source review, a live v5 write and the PP qualification.

## What ran
- **Me:** the permitted vitest command once, which exited 1; no network or SAP access.
  - `tests/unit/adt/pinned-formatter.test.ts`: 48 of 48 passed.
  - `tests/unit/handlers/pinned-formatter.test.ts`: failed to load and ran 0 tests, because `setup-undici-mock` isn't in the snapshot. That looks like a snapshot gap rather than a repo problem, but I couldn't confirm it. I only read the handler behaviour; it wasn't executed.
- **Side effect:** vitest's JSON reporter wrote `test-results/unit.json` inside `source/` (`vitest.config.ts:12`), so a hash check of the snapshot may flag it. I left it because I have no permitted way to remove it.
- **Author evidence, not re-run by me:** 391 files / 10,852 tests, typecheck, build, lint, size/schema budgets and strict docs.
