# Claude final review — #1008 MCP transport review

| | |
|---|---|
| Reviewed head | **`d595157f22f2504ccd24c365060d2579d4595c55`** (`docs: keep transport guidance within the shared tool budget`), on runtime commit **`98c3b0288476363da1e5938a04c2998882802b46`** |
| Since my review of `5cdfadba` | `48950d4d`, `2e0253af`, `c65862d3`, `98c3b028` (20 files, +505/−79), then `d595157f`: the `SAPTransport` description plus six regenerated snapshots, one line each |
| Base | main **`2cb7b044`** (ancestor); lockfile unchanged |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-18 |
| Method | Private `git archive` exports of both commits, plus a three-way merge with the dump-filter head built in a scratch repo. Focused tests, a fail-before check, scratch reproductions (kept at `scratchpad/trf-aside/zz-review/`) and static gates. No SAP, GitHub or shared edits. |

## Verdict

**READY TO MERGE at `d595157f`, once CI passes on that head.**

- **All four blockers are resolved**: D1 (open-request baseline), D2 (stale docs), D3 (failing
  assertions) and D4 (catalog headroom).
- **My "should fix" items and the cleanups are done.**
- **No new defects.** The trim commit changes only wording and the generated snapshots.

## Prior findings

| Finding | Status | Evidence |
|---|---|---|
| **D1** open-request baseline | **Resolved** | Active mode picks the predecessor from all retained snapshots, skipping same-request ones, independently of the active row's timestamp. The live F4 shape (`00002` 11:23:41, `00000` 11:22:09, `00001` 09:34:43), the tie and the draft cases all give `00002` and `prior-revision`. Date/number conflicts and same-request conflicts still give `baseline-ambiguous`; the released control is unchanged. |
| D1, pending draft | **Resolved** | "Inactive draft pending for this request; not compared." appears on success and on a failed source read. |
| **D2** stale `resultFormat` row | **Resolved** | Removed from `tools.md`. |
| **D3** two failing assertions | **Resolved** | Both pass. |
| **D4** catalog headroom | **Resolved** (`d595157f`) | `standard-full-git` measures 74,421 bytes / ~18,606 tokens, 50 bytes less than before. Merged with the dump-filter head `60127869` (clean three-way merge in my scratch repo), it measures **74,454 / ~18,614**, and every scenario passes. No ceiling was raised. The plan and research statements about the trim are now accurate. |
| `baseline-unavailable` meaning | **Resolved** | `tools.md` and the trimmed model text now agree: "no comparison, NOT unchanged". A speculative part without attribution has its own note. |
| Minimal mode hides local text | **Resolved** | The typed `RevisionHistoryError` passes through minimal mode. |
| Basic queue and task IDs | **Resolved** | Queue behavior, with rate-limit and deny options, is documented. A not-found ID now suggests the parent request; echoed values are length-capped. |
| Excess fields and helpers | **Resolved** | `metrics()`, `isTestTransport` and `continuationAdvertised` were removed. Your reasons for keeping two counters and the research index are accepted. FEAT-90 now uses the local format. |

**The trim keeps every meaning.** It condenses the wording:

- "source changes in a transport" → "source review";
- "NOT proof of creation" → "NOT creation";
- "comparison failed" → "no comparison", which matches `tools.md` better.

The attribution rules, all five status meanings, non-source gaps, `nextOffset` and the note that
pages are not snapshots all remain.

**Fail-before.** I copied the new `transport-diff` and `transport-review-evidence` test files onto
the `5cdfadba` source. 8 tests fail there and 65 pass:

- older and tied active timestamps;
- the unattributed active label;
- the minimal-mode parser text;
- the speculative note;
- the draft note on a failed read, in both modes;
- an undated newer same-request version.

All 8 pass at `98c3b028`.

**Live evidence.** `http-final-summary.json` agrees with the claims:

- 14 reads, 0 mutations;
- A4HK906371 keeps three +1/−1 `prior-revision` parts;
- A4HK906373 / ZCL_ARC1_DEMO_CALC compares `00002 (A4HK906291)` → `00000 (A4HK906373)` as
  `prior-revision`, 0/0, with the pending-draft note.

## Residual limitations (non-blocking)

1. **An undated active row stays conservative.** With retained history it is still marked
   `baseline-ambiguous`, although its baseline no longer depends on that date. None was observed on
   758; it could over-flag on other releases.
2. **Cosmetic.** Joined notes read "…not compared. no source change…", with a lowercase sentence
   start.
3. **Qualification scope:**
   - live checks: A4H 758 over local HTTP only;
   - no deployed CF/Cloud Connector or principal-propagation run;
   - BTP ABAP backend unverified;
   - 750 and 816 have no non-empty historical pairs.

   All of this is documented.
4. **Test runs.** You report a full unit run at `98c3b028` of 332 files, 9,299 / 9,299 passed; I did
   not rerun it. `d595157f` only changes a description string and its snapshots. CI on `d595157f` is
   the merge gate.

## Checks run (Node 22.21.1)

| Check | Result |
|---|---|
| `98c3b028`: 20 focused files (transport, evidence, bounds, parser, client, regressions, handlers, snapshots, tools, docs parity, read, policy, multi-target ×4, BTP docs contract) | **1,096 / 1,096 passed** |
| `98c3b028`: scratch reproductions (D1 shapes, conflicts, notes, minimal mode) | 13 / 13 as expected |
| Fail-before on `5cdfadba` | 8 new regressions fail there, pass here |
| `98c3b028`: typecheck, `validate:policy`, strict `mkdocs build`, Biome (9 files) | pass |
| `d595157f`: snapshot, tools, docs parity, multi-target tools, BTP docs contract, transport and review handlers | **268 / 268 passed** |
| `d595157f`: `check:sizes` | pass (690 files); on-prem full catalog 74,421 / ~18,606 |
| `d595157f` merged with dump-filter head `60127869` | clean merge; `check:sizes` pass (694 files; 74,454 / ~18,614); 7 surface files / 174 tests pass |
| Archived implementation review | byte-identical to my report |
