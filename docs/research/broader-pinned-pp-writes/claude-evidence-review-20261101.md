# Claude Code follow-up review — 1 November 2026

Actual Claude Code v2.1.302, `claude-opus-5-5`, effort `max`. Reviewed immutable revision
`741b31b021957dab05a0da81bf1b4a9209705062`; 2,560 manifest entries verified unchanged by
the reviewer and again by the author. The following report is verbatim, including its disclosed
refused out-of-root read. It covers the qualification evidence/bookkeeping delta, not the whole PR.

---

# PR #1142 follow-up at `741b31b02`: keep the delta and start the next family

**Keep this delta and start the next family; this is not merge approval.** I found no High or Medium findings. The F3 fix works on every crash path where a preference write could have happened. The machine record, both assertion lists and the qualification code agree; the contradictions are in the prose.

The eight findings below are all Low, and none needs a new live run. The evidence stays bound to `1b234d3a4`, and docs-only fixes don't change the harness hash.

**Tool deviation:** one `Read` used a path outside the root because I left out `source/`. It was refused and returned nothing, and I reread the file at the correct path. All Bash calls were the exact permitted commands, and I edited nothing.

## Findings

### Fix in the next commit (docs only)
1. **The roadmap implies Claude reviewed the run's results.** `docs_page/roadmap.md:219-220` says Claude "accepted that controlled run", but that review came before the run (`claude-closure-review-20261101.md:3`). Change it to "accepted running".
2. **The F4 wording is incomplete.**
   - `docs_page/multi-target-writes.md:145-146` says `toUpper`/`toLower` are refused "before a write", but reads are refused too (`src/adt/pinned-formatter.ts:106`, `:146`). Those users can't read their settings or patch away from those styles.
   - That page lists four supported styles, and `pp-write-delete-formatter-2026-11-01.json:350` names only `toUpper`/`toLower` as unqualified. The v5 run set only `keywordUpper` and `keywordLower`, so add `keywordAuto` and `none`.
3. **The public page implies ETag protection.** `multi-target-writes.md:147-149` doesn't carry the "not qualified" limit that the combined record has. All four PP writes were unconditional (`json:226-231`), and the supplied native classes contain no ETag or `If-Match` handling.
4. **The README overstates F3.** `scripts/qualification/pr1142/README.md:81-83` says a crash that leaves only `formatterAttempted` gets a `formatterRecovery`. That isn't true before the baseline save (see the crash path below). State stays safe, but the sentence should say "after the baseline is saved".
5. **Two tracking docs are now stale.** `docs/adr/0011-broader-pinned-pp-mutations.md:129`, `:133`, `:138` and `docs/research/broader-pinned-pp-writes/inventory.md:24`, `:40` still say this PP evidence is pending. They understate the evidence, but the inventory is the tracker for the next family.

### Fix before the next live run (harness)
6. **A repeated recovery loses the earlier outcome.** History reads `parent.formatter`, which is absent on the new path, so each entry holds only `at` (`qualification.mjs:27-31`), and `:39` overwrites the previous `formatterRecovery`. Failed assertions survive in the formatter journal (`formatter-qualification.mjs:427`). Push the prior `formatterRecovery` into history.
7. **A recovered formatter journal looks finished.** Restore-only stamps `finishedAt` (`formatter-qualification.mjs:428`) and adds no interruption marker, so `qualification.mjs:33` holds only for the parent journal. The only clues are the `restore.*` assertions and a low count. Use a separate recovery timestamp.
8. **The regression stops at the function.**
   - **What it does well:** it runs the real `recordFormatterRecovery` with a realistic parent, and it catches invented completion (`pr1142-harness-safety.test.ts:77-111`).
   - **What it skips:** `load` and `write` are mocks, `result` is a hand-written success, and nothing runs `qualify` in `qualification.mjs:42-47` offline.
   - **Fix:** I traced that composition by reading and it is correct. Add one simulation using a real interrupted journal.

## F1–F6 dispositions

| Finding | Assessment | What remains |
|---|---|---|
| F1 | Accepted operating limit; README `:64-71` and the record state it accurately | The code is unchanged (`live-harness.mjs:30-31`, `:465-466`). The prior review's "if another commit happens" condition has now been met, so make the fix before the next live run |
| F2 | Closed as documentation; the steps match the refusal at `native-formatter-fixture.mts:138-139` | Not triggered live. "Prepared before the run" is an operator statement, since the text entered the repo only in this delta |
| F3 | Closed for crashes after the baseline save | Findings 4, 6, 7 and 8; offline evidence only |
| F4 | Accepted limit | Finding 2 |
| F5 | Closed; the README, record and combined doc are all precise | Neither user has a native read of a style change |
| F6 | Closed; the POST source supports the narrowed wording (`CL_SEDI_ADT_RES_PRETTY_PRINTER.abap:265-267`, `:279-284`, `:350`, `:405-407`) | Helper source not supplied. PUT also normalises the stored indent mode (`CL_SEDI_PRETTY_PRINTER.abap:130-134`); the docs' "such as" covers this |

## The mid-formatter crash path

| Crash happens | What restore-only does | Preference write possible? |
|---|---|---|
| Before the formatter journal exists (`formatter-qualification.mjs:254`) | Fails on the missing file (`:228`); no `formatterRecovery` | No |
| Before the baseline save (`:307`) | Refuses at the shape check (`:237-238`) with `journalOwned` false, so `qualification.mjs:8` returns; no `formatterRecovery` | No; the first write is the seed at `:311` |
| After the baseline save | Restores and writes `formatterRecovery` | Yes |

- **Incompletion is preserved:** the parent keeps `assertions` and `fixtures`, and gains no `formatter`, `finishedAt`, `passed`, `failed` or `allAbsent`.
- **Binding holds:** two plans and four keys are compared across the parent, the formatter journal and the result before the new branch runs (`qualification.mjs:17-24`). A parent without `formatterAttempted === true` is still refused (`:25-26`).
- **No live evidence for this path:** the recorded run went forward normally, and its list has no `restore.binding`.

## Machine record comparison
- **Assertion counts:** my independent derivation from the code gives 482 and 262, matching the lists, with zero `pass: false`. The entry order also matches the code.
- **Request counts:** the 103 and 61 RPCs implied by the lists match the simulations' clean scenarios.
- **Identifiers:** the run ID, revision and fixture names agree. `packageLockSha256` matches the manifest.
- **Pre-seed hash:** `originalPreSeedXmlSha256` (`json:242`) equals the manifest hash of `review-input/native-source/v5.txt`. That XML has no optional fields, so restoration returned to that state and the historical v2 risk stands.
- **Native sequence:** the `before` and `after` hashes match, as do `during-primary` and `during-secondary`. Timestamps are in the order the code runs.
- **Delete results:** `absence-readback` matches `src/adt/pinned-delete.ts:88`. `REQ-304/306/308/310` matches two IDs per tool call (`src/server/http.ts:205`, `src/server/server.ts:808`).
- **Not comparable:**
  - **The 39 initial assertions:** no list was supplied, and the harness only emits them as log events (`live-harness.mjs:194`).
  - **`privateReceiptCount` of 189:** I can account for 187 (164 RPC plus 23 native). The record doesn't define the other two.

## Limits of the live evidence (accepted scope, no fix needed now)
- **Secondary user:** no native preference read, and its optional fields were never seeded, so nondefault preservation is proven only for the primary.
- **"Restored":** this means byte-identical v5 XML for the primary and two MCP-visible fields for the secondary. Hidden storage isn't covered.
- **Concurrency:** only unconditional writes were observed, and same-user overwrites remain possible.
- **Clean path only:** nothing live exercised `delete-rejected`, `delete-unconfirmed`, unlock failure, `update-rejected`, `update-unconfirmed`, a foreign-edit refusal or recovery.
- **Refusals:** one error code covers several gates, and the hidden delete fields were probed on one fixture only.
- **Ownership:** the DELETE actor is inferred, there is no TADIR check, and drafts are visible only to the primary reader.
- **Not qualified:**
  - transportable deletion
  - other object families
  - other SAP releases
  - the legacy v2 writer
  - future preferred formats

## What ran

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` | Ran first, again after the tests and last; each time 2,560 files `unchanged` |
| `npm exec -- vitest run tests/unit/scripts/pr1142-harness-safety.test.ts` | 9 of 9 passed |
| `npm run test:qualification:pr1142` | All 35 printed `passed:true` (18 formatter, 17 deletion) |

These are offline mocks and simulations, not SAP or CF evidence. They wrote `test-results/unit.json` and used temp directories.

## What I could not verify
- **Not run:** typecheck, lint, strict docs, budgets and the full unit suite are the author's reports. The 394 files / 10,878 tests figure comes from the live revision, so it predates the new test.
- **Operator observations, taken as supplied:** deployment and droplet identity, the 1,127 artifact files, IAM and SAP rollback, the detached session, SIGTERM and process exit. `activeOperations: 0` is a literal emitted after the drain (`live-harness.mjs:462`), not a counter.
- **Hashes not recomputed:** `harnessSha256`, `authModulesSha256`, and the artifact and receipt manifests. `qualification.mjs` has changed since the run, so this snapshot can't reproduce the recorded harness hash.
- **Raw evidence not supplied:** receipts, run logs and scenario files.
- **Verifier not re-traced:** the delta doesn't touch xsuaa-auth or xssec, so the prior review's trace stands.
- **Native source not supplied:** `GET_PRETTY_PRINTER_CASE_MODE`, `lcl_sewb_settings`, `RS_WORKBENCH_CUSTOMIZING`, `RS_WB_CUSTOMIZING_SET_VALUES` and the ADT framework. My ETag and hidden-storage conclusions stop at that boundary.
- **Unreadable inputs:** none. I read every changed file in final form or through its complete hunk.
