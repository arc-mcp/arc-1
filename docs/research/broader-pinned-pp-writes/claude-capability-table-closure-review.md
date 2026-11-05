**ACCEPT, for this refactor only.** All three notes are closed and the additions introduce no defect. I need to correct one claim in my earlier note 2, and one small test gap remains; neither blocks this refactor.

Paths are relative to the snapshot's `source/`.

## Previous notes
1. **Row contents: closed.** `tests/unit/server/pinned-mutation-capabilities.test.ts:28` pins everything in each row except `accepts`. Line 60 makes a full-field router call for each action and type. All the edits I listed now fail: adding `DDLS`, adding `method` to create, and removing `expectedSourceHash` or `description`.
2. **Sweep: closed, with the correction below.** Line 121 of that test now calls `multiTargetInvocationDecision` with `writer`, so tools like `SAPGit` and `SAPManage` hit the real router.
3. **Advertisement claim: closed.** Lines 153-156 pin `required` and `additionalProperties`, and the helper comment (`src/server/pinned-mutation-capabilities.ts:58`) now matches the code. Nothing in the production files I read uses `resource`. The test title at line 144 still says "derives ... fields" although six properties are hard-coded, but that's cosmetic because line 152 fails if they drift.

## Correction to note 2
I implied the router sweep would catch `Update` being added to `ALLOWED_OPS`, but it probably won't. Mutating `ACTION_POLICY` entries are refused before that check, at `src/server/multi-target-tools.ts:106-108` or by the action rules at line 112. Only two kinds of mutating entry reach line 114:
- one on `SAPRead`, `SAPSearch`, `SAPNavigate` or `SAPContext`
- one on an action those rules allow

I expect there are none, but I didn't read `ACTION_POLICY`. If so, widening the set alone changes no router result today, and the sweep fails as soon as a mutating `tool.action` entry is actually admitted. That is the property that matters, so no change is needed here. Catching the widening itself would take a direct assertion, and `ALLOWED_OPS` isn't exported.

## Remaining test gap
`accepts` is outside the pinned contract, and line 178 of the test only tries `lhc_local~save`. Dropping `lcl_`, `ltc_` or the `i` flag from the regex at `src/server/pinned-mutation-capabilities.ts:37` would still pass this file. Older tests may cover this, but I didn't read them. Adding `lcl_`, `ltc_` and uppercase cases beside line 178 closes it. The regex isn't part of this delta, so this doesn't block.

## Limits
- **Tests and hashes:** I ran nothing and didn't verify hashes, so test results are as you reported them.
- **"Comments only":** I didn't diff against the earlier version, so this rests on your statement, though the four rows and field unions match my earlier review.
- **Sweep coverage:** I used all five reads without reaching `ACTION_POLICY` or `isOperationAllowed`. So I can't confirm:
  - which entries the sweep covers
  - whether mutating bare-tool entries exist (line 119 skips them)
  - whether `C U D A W X` and the `writer` gates are complete
- **Owner boundary:** the `resource` comment says the pinned handler enforces this, which is unverified because neither review read `assertPinnedOwner`.