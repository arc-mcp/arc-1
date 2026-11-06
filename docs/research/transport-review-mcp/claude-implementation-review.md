# Claude implementation review — #1008 MCP transport review

| | |
|---|---|
| Reviewed commit | **`5cdfadbab122f0b9652151c5671f7c154372ee48`** (`fix: focus transport review on bounded MCP source evidence`) |
| Base | main **`2cb7b044ae7c8e7805219deaf77b32f34228c2ea`** (ancestor). Net diff: 53 files, +2,639/−365; lockfile unchanged. |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-18 |
| Method | Private `git archive` of the exact commit. Focused tests, static gates and scratch reproductions run there; the scratch test is kept at `scratchpad/trx-aside/zz-review/transport-probes.test.ts`. No SAP, GitHub or shared edits. |

## Verdict

**Not ready to merge yet. Four items need changing first; none needs a redesign.**

1. One correctness defect in open-request baseline selection (D1).
2. One user-facing documentation mismatch (D2).
3. The two known failing tests (D3).
4. An integration ordering hazard with the dump-filter PR (D4).

**What is sound:**

- the bounded collection, cancellation and 401 handling;
- the multi-target allowlist, its contract and its tests;
- safe part errors on multi-target routes;
- released-request selection;
- REPT and whole-object scope reporting.

**Your BTP ABAP choice is acceptable** (reasons below).

## Must fix

### D1 — An open request compares against the wrong baseline when the active row is not newer than the newest snapshot (Medium, correctness)

**Where.** `selectTransportRevisionPair` (`transport-diff.ts:178-233`), active mode.

**Mechanism.** The current side is the active row `00000`. The predecessor is found by walking only
the entries sorted *after* that row by timestamp.

The August plan's live A4H feed (F4) shows the normal steady state after a release:

| Revision | Timestamp | Transport |
|---|---|---|
| `00002` | 11:23:41 | A4HK906371 |
| `00000` | 11:22:09 | (the open request that locks the object) |
| `00001` | 09:34:43 | A4HK906369 |

The active row is *older* than the newest snapshot until the object is activated again. So for any
object that is locked in an open request but not yet re-activated, this happens:

- `00002` sorts before the current row and is skipped;
- the baseline becomes `00001`;
- the result is labelled `baseline-ambiguous`;
- its hunks are A4HK906371's already-released change, shown as this open request's candidate
  evidence.

**Reproduction** (scratch test `P1 live shape`):

```ts
selectTransportRevisionPair(
  [rev('00002','2026-06-23T11:23:41Z','A4HK906371'),
   rev('00000','2026-06-23T11:22:09Z','A4HKOPEN01'),
   rev('00001','2026-06-23T09:34:43Z','A4HK906369')],
  ['A4HKOPEN01'], 'active')
// → current 00000, previous 00001, baselineStatus baseline-ambiguous
```

The same happens when the active row ties with `00002`, and when an inactive draft was saved after
the release. In the control case, where the active row is strictly newer, the result is correct
(`00002`, `prior-revision`).

**Why the live checks missed it.** Every open request in the live replay contained only new objects
(no snapshots), so this branch never ran against SAP.

**Fix (small).** When the current row is a work state (`00000`/`99999`):

- take as predecessor the **highest-numbered** snapshot that doesn't belong to the transport, from
  the whole list rather than only the part after the current row. Version numbers increase
  monotonically per object;
- drop the date-order ambiguity test for that case;
- the special case for an undated work state then becomes redundant.

Add the F4 shape as a regression test. With the fix, a locked but unchanged object correctly shows
"no source change".

**Recommended alongside.** Add a part note when an inactive draft (`99999`) attributed to the request
exists, e.g. "inactive draft pending; not compared". Today drafts are silently ignored: `skipped` is no
longer returned. Yet a reviewer of an open request needs to know that the newest edits are not in the
comparison (AGENTS.md: inactive objects block release).

### D2 — `tools.md` documents a `diff` `resultFormat` that does not exist (Medium-low, documentation)

`docs_page/tools.md` parameter table: "For `diff`: `legacy` compact JSON (default) or `structured`
full provenance."

- The handler never reads `resultFormat`.
- The model-facing schema text is still main's release-only wording.
- Multi-target omits the property.

**Fix:** remove the `diff` clause from that row.

### D3 — Two tests fail at the frozen commit (known)

At `5cdfadba`, `tests/unit/handlers/transport.test.ts` has two failures:

- **`:1192`** expects `comparison` to be `transport-correction-to-immediate-previous`; it is now
  `released transport snapshot against preceding snapshot`.
- **`:1335`** reads `first.hint`; that field was replaced by `nextOffset`.

You are already updating them. Both are assertion-only, with no production change. Merge only once
they pass.

### D4 — Combined with the dump-filter extraction, the catalog exceeds its ceiling (integration)

| Measurement | Bytes | Tokens | Change |
|---|---|---|---|
| `standard-full-git` here | 74,471 of 74,500 | ~18,618 of 18,625 | +12 bytes / +3 tokens over main |
| Dump-filter extraction (my merge review) | — | — | +33 bytes / +8 tokens |
| Together | **~74,504 bytes** | **~18,626 tokens** | over both ceilings |

Whichever PR merges second must trim or deliberately raise the ceilings.

## Should fix (low)

1. **`baseline-unavailable` is described as "The read failed"** (`tools.md:1568`). The code also
   uses it when:
   - no revision is attributed to the request (a released strict review);
   - a speculative or CTS-selected 404 occurs;
   - the diff work limit is exceeded.

   The model-facing text ("comparison failed") is closer.

   **Reproduction** (scratch `P2`): a released whole-class R3TR CLAS whose `definitions` include
   has only another request's snapshot is reported `baseline-unavailable`, "No revision satisfies
   the requested source state and attribution."

   **Fix:**
   - define the status in `tools.md` as "no comparison: read failed, no attributable revision, or
     a limit — never unchanged";
   - give speculative parts with no attributed revision their own note, e.g. "speculative part: no
     snapshot attributed to this request".
2. **Minimal-error mode hides ARC-1's own safe explanations.** Under forced minimal notes (every
   multi-target call), the parser's "invalid … this is not an empty history" becomes
   "revision history unavailable: request failed" (scratch `P3`). That text contains no SAP data.
   Keep ARC-1-local messages in minimal mode, as `describeError` already does for the budget and
   timeout messages.
3. **Shared Basic queueing.** The claim that the 20 s deadline leaves headroom below the 30 s
   acquisition timeout holds for one queued call only. Two queued `diff` pages can still time out a
   third caller.

   Add one sentence to the multi-target docs: on shared Basic targets, each page holds the target
   lane for up to about 20 s; use `SAP_DENY_ACTIONS=SAPTransport.diff` or `ARC1_RATE_LIMIT` if that
   is unacceptable.
4. **Task IDs.** A task ID returns "Transport A4HK906372 not found." (live). Say "use its parent
   request" in the not-found message or the description. Users often know their task number.

## Excess machinery (optional cleanup)

- **`ReviewBudget.metrics()`** is used only by tests. The separate `reads` counter duplicates the
  attempt budget.
- **Unused feed fields.** `isTestTransport` (never observed live) and `continuationAdvertised`
  (redundant with `historyComplete:false`) are parsed but never read by product code. They now leak
  into `SAPRead VERSIONS` output (`read.ts:771-772` returns `toolJson(revisions)`). Drop both.
- **`docs/research/adt-vscode-1.2/README.md`** (+88 lines) indexes the whole ADT 1.2 adoption
  backlog (19 workflow areas), not this change. Consider landing it separately.
- **FEAT-90's detail format** (`**P2 · M · …**`, `Gap/Evidence/Resume when`) differs from the
  neighbouring entries (`Priority / effort / status` bullet, `Remaining gap`, `Resume with`).

## Your BTP ABAP choice: acceptable

**Not adding a BTP-ABAP ban is consistent with main.**

- Single-target BTP deployments already expose `SAPTransport diff`.
- The new multi-target entry is per action, not per backend.
- `VERSIONS btp:false` records missing qualification, not a known failure.

**The failure modes are explicit, not fabricated.**

- A missing or unusable feed yields `baseline-unavailable`.
- On a backend whose release (gCTS) writes no attributed versions, every released part says
  "No revision satisfies…".
- Revision source URIs still pass `canonicalRevisionSourcePath`, so a hostile feed cannot redirect
  reads.
- SAP authorization still governs historical source.

**Keep the docs wording** in `review-workflows.md:47`, "SAP BTP ABAP as the backend remains
unverified". When a BTP ABAP probe is run, record whether released requests produce attributed
versions there.

## Verified

- **Released selection.**
  - Strict attributed snapshots, with no fallback substitution.
  - Undated or out-of-order snapshots between the pair are marked ambiguous.
  - The A4HK906371 live result (three `prior-revision` parts, +1/−1) matches the logic.
- **Scope.**
  - A REPT-only entry produces an inventory gap with no source read.
  - Whole-object `notCompared` lists metadata, text pool, and screens/GUI status for programs.
  - CTS-selected and speculative 404s have distinct notes.
  - FUGR sources and non-adapter types are inventory only.
- **Bounds** (code and tests):
  - per page: a 20 s deadline, 180 reads/attempts, 8 MiB cumulative and 1 MiB per response;
  - sequential reads;
  - per part: jsdiff limited to 100 ms / 20,000 edits, and display capped at 400 lines / 16 KiB;
  - 64 KiB total output, with hunks omitted for the first object and later objects deferred;
  - an unfinished later object is retried at `nextOffset`;
  - an out-of-range offset is refused;
  - a 401 or cancellation ends the call rather than returning partial success.
- **Multi-target.**
  - Allowlist, the omitted-property change, ADR-0006, the normative contract and the maintained
    table are consistent (`btp-docs-contract` passes).
  - Notes are minimal only for multi-target calls (`targetId` is set only by the multi-target
    runtime).
  - Pinned and aggregate PP calls: identity, signal, audit, and no `SECRET_` text in a 403 note.
  - Refusal before identity resolution for a missing target, missing scope, deny, unknown target
    and mutation.
  - Shared Basic: a 401 stops the fan-out and blocks the next call; cancellation releases a queued
    caller.
  - ADR-0008: an ungranted target is refused before SAP is contacted.
- **Evidence consistency.** `http-summary.json`: 66 reads, 0 mutations, largest reply 18,186 bytes.
  The A4HK906372 not-found result is as stated in the research note.

## Checks run (private archive of `5cdfadba`, Node 22.21.1)

| Check | Result |
|---|---|
| 18 focused files: transport diff, evidence, bounds, attempt budget, XML parser, client, regressions, review handler and limits, transport handler, tool snapshots, tools, policy, multi-target tools/basic-auth/PP/authorization, BTP docs contract, dispatch | **918 passed, 2 failed** (D3) |
| Scratch reproductions (P1 tie, draft and live F4 shape; P2; P3) | All reproduce as described |
| `npm run typecheck` | pass |
| `check:sizes` (file ratchet, 690 files; schema budget) | pass; on-prem full catalog 74,471 / ~18,618 tokens |
| `validate:policy` | pass (132 entries) |
| Strict `mkdocs build` | pass |
| Biome on 6 changed source files | pass |

## Limitations

- I didn't run the full suite; yours is running.
- No live SAP, CF or principal-propagation run. Live behavior comes from the committed summaries
  and the August plan's F4 feed shape.
