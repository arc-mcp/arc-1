# PR #1142 at `1b08bd51`: retain the local include evidence, with no blockers and six Low findings

**Decision:** retain this checkpoint as qualified evidence for local `$TMP` include, shared `edit_method`, CLAS/INTF deletion and formatter paths on A4H/001. It needs no rerun or code fix. The overall PR is not ready: it stays draft and FEAT-93 stays open.

- **Findings:** no High or Medium. All six Lows are documentation or receipt text, and fixing them changes no shipped bytes.
- **Prior five Lows:** three closed, one still deferred as recorded, one partly closed (Finding 6).
- **Checks:** all five commands passed, with 11,573 tests as expected. The snapshot was unchanged at the first and last verifier runs.
- **Evidence status:** the live results are author operator evidence. I ran nothing live. Hashes, scripts and the harness are consistent with the receipt, but that is not independent proof.

Short names used below:
- `includes.md`: `docs/research/2026-11-01-broader-pinned-pp-writes-includes.md`
- `method-edit.md`: `docs/research/2026-11-01-shared-pinned-method-edit.md`
- `receipt`: `docs/research/broader-pinned-pp-writes/include-qualification-20261101.json`
- `combined.md`: `docs/research/2026-11-01-broader-pinned-pp-writes-combined-qualification.md`

## Findings

### 1. Low: a public page and tracking docs still say include qualification is pending
- `docs_page/multi-target-writes.md:142` says "native/PP qualification is pending", which contradicts `docs_page/roadmap.md:209-212`.
- The same status remains in `docs/plans/2026-10-26-broader-pinned-pp-writes.md:15`, `docs/research/broader-pinned-pp-writes/inventory.md:24` and `scripts/qualification/pr1142/README.md:140`.
- Present-tense leftovers remain at `includes.md:303,320` and `method-edit.md:57,121,137`.

These under-claim, so nothing is unsafe.

**Fix:** say local `$TMP` is qualified at `77e41fd` and transportable remains open. The README is outside `harnessSha256` (`run-manifest.mjs:45`), so editing it doesn't affect that binding.

### 2. Low: the include evidence is narrower than its wording, and a public page overstates lint
- **Comment-only bodies:** every non-empty include body in the run is one ABAP comment line (`scripts/qualification/pr1142/include-qualification.mjs:5-6`). Activation never compiled a real local class, macro or test class on this route.
- **No lint or syntax check:** pinned include writes skip both (`src/handlers/write/pinned.ts:95,134-156`), and single-target behaves the same (`update-delete.ts:75-92`, before lint at `:163`).
- **Public claim:** `docs_page/multi-target-writes.md:183` says "Global lint configuration applies", without excepting includes.
- **No test pins the skip:** `tests/unit/handlers/pinned-class-includes.test.ts:22` disables lint.

The save path doesn't interpret content: it sends text and compares the read-back. By reasoning, the lock, hash, initialization, save, read-back and activation protocol evidence stands.

**Fix:** add the comment-only limit to `includes.md`, and except include updates at `multi-target-writes.md:183`.

### 3. Low: the roadmap's transportable gap is narrower than the receipt's
- `receipt:325` correctly says no transportable object was qualified, but `docs_page/roadmap.md:216` lists only "transportable deletion/includes".
- The only live transportable create, update and `edit_method` evidence is at `293cbaf2` (`docs/research/2026-10-22-multi-target-write-qualification.md:159-164`), before these paths were refactored.
- The refactored route's `corrNr` path has mock evidence only (`method-edit.md:80`).
- `method-edit.md:145` says the run "closes the pending main-method PP rerun" without saying `$TMP`.

**Fix:** say "transportable objects" in the roadmap and "for local `$TMP`" in `method-edit.md`.

### 4. Low: "full environment" over-reads the cloud check
- **Environment:** `includes.md:36` says "full environment", but the verifier compares only `environment_variables` (`review-input/evidence-only-verify-cloud-restored.py:18-21`), not bindings or system environment.
- **XSUAA:** a field missing from both sides still compares equal (`:25`).
- **Leftovers:** the supplied `evidence-only-cloud-control.py` never deletes the candidate package or droplet. The earlier run disclosed this (`combined.md:69`); the new text doesn't.

**Fix:** write "all user-provided environment variables", and state what happened to the candidate package and droplet.

### 5. Low: the receipt omits things the text relies on or the prior review asked for
- **The 39 checks (`includes.md:17`):** no receipt field carries them.
  - The earlier machine record published them per session (`pp-write-delete-formatter-2026-11-01.json:33,44,55,366`) and called them identity/route (`combined.md:4`).
  - They aren't in the 1,216, which reconciles without them.
  - The parent's own first 39 assertions are also identity, binding, preflight, initialize and catalog checks, so the number alone can't show which set is meant.
- **Deployed lint and syntax settings, and SAP release:** absent, though the prior review asked for the settings. The environment appears only as a digest, so the evidence can't say whether lint ran on the live `edit_method` saves. `multi-target-writes.md:184` names 758 SP02 only as a general statement.
- **SAP verifier scripts:** the cloud and destination receipts carry script hashes, but the SAP comparison has none (`evidence-only-pr1142-fresh-sap-restored.mts:30`). The supplied `.mts` copies can't be tied to the hashed receipts.

**Fix:** add sanitized initial-assertion counts, the settings, the release and retrospective SAP script hashes to the public record.

### 6. Low: the prior timestamp wording survives on two lines
`includes.md:308-311` is fixed, but `includes.md:196` and `method-edit.md:58` still say "restored and … verified at 13:44:21".

**Fix:** write "verified restored at".

## Prior findings

| Prior item | Disposition |
|---|---|
| 1. Missing-period limits | **Closed.** `method-edit.md:90-98` limits the claim to text and v702. Its four conditions match `config-builder.ts:112,116,150-152`, `features.ts:249-252` and `write-helpers.ts:1209,1276-1279`, and it claims no activation result. The test title at `method-splice-boundaries.test.ts:20` keeps the old phrase, which is harmless. |
| 2. Real-lint pair | **Closed and executed.** Both refusals assert `parser_error` (`pinned-shared-method.test.ts:292`), and the unstubbed success is at `:329-339`. A blanket refusal now fails the success case, and skipped lint fails the refusals. `beforeEach` restores the earlier spy (`:162-165`). |
| 3. Syntax fixture | **Closed and executed.** A processed `chkrun:checkRunReports` runs through the real parser (`:97`, asserted at `:312`). It isn't a byte-exact native reply: the repo's NW 7.50 sample wraps messages in `chkrun:checkMessages` (`tests/fixtures/xml/syntax-check-nw750.xml:1`). The parser searches at any depth (`devtools.ts:1159`), so behavior is the same. |
| 4. Transport on cleanup failure | **Still deferred, as recorded** (`method-edit.md:134-135`, `roadmap.md:220`). The code is unchanged (`pinned-class-surgery.ts:55-59`, `pinned.ts:199-204,231-236`), and the `$TMP` run doesn't reach it. |
| 5. Cloud timestamp and hash | **Partly closed.** Script hashes are now called retrospective (`includes.md:315-316`). The timestamp residue is Finding 6. |
| Run prerequisites | **Met per operator evidence**, except recording the deployed settings (Finding 5). |
| Earlier live gaps | **Closed by the receipt:** post-save read, activation with include receipts, writer B, formatter, denied-route include calls and delete. |
| Earlier cloud limits | **Closed:** running state (`evidence-only-verify-cloud-restored.py:31-35`), ledger order (`:6`) and stale SAP and fixture timestamps. **Open:** environment scope, XSUAA missing fields, candidate artifacts and baseline origin. |

## Evaluation of the new evidence

### Live evidence binding
- **Revision:** `sourceRevision`, `deployment.revision` and `artifactBuiltAtRevision` all equal `77e41fd…`. The harness refuses a dirty tree or a changed harness at runtime (`run-manifest.mjs:49-72,78-79`).
- **Fixture hashes:** the two different values are expected. One digests parsed JSON (`fixture-contract.mjs:34`) and the other the pretty-printed file bytes (`durable-journal.mjs:8`).
- **Droplet:** the script ties droplet to package and app (`evidence-only-cloud-control.py:61-65,88-89`). The link from package to the 1,219-file build is not visible to me.
- **Counts, by walking the harness code:**

| Stage | Assertions |
|---|---|
| Setup | 57 |
| Two CLAS lifecycles (369 each) | 738 |
| Two INTF lifecycles (43 each) | 86 |
| Formatter gate | 1 |
| Four denied routes (64 each) | 256 |
| Hidden delete fields | 50 |
| Deletes | 24 |
| Cleanup | 4 |
| **Total** | **1,216** |

  - Each include whose first read succeeds adds one assertion, so this total fits exactly one unavailable first read per class.
  - The same method gives the formatter's 262 and the earlier run's 482.
  - This shows the numbers fit this harness with no skipped branch. It doesn't prove the run happened.
- **Actors and hashes:** in the receipt, active and editable hashes match for all four owners and all eight includes, and include hashes match the PP save hashes. The harness asserts last changer and version (`native-fixture-operations.mts:63,66,110-111,118-119`). Creator on includes is recorded, not asserted, as `includes.md:153` says.
- **Initialization:** `testclasses` only, for each writer, and the other three kinds already existed.
- **Attribution:** `includes.md:26-27` correctly limits actor evidence to after activation.
- **Cleanup:** absence is typed (`native-fixture-operations.mts:34`), and the parent fails unless the formatter passed and restored (`deletion-qualification.mjs:348-354`).
- **Sessions:** "discarded" means cleared from process memory, not revoked (`live-harness.mjs:346,458,462`). `includes.md:32` claims no more than that.

### Restoration
- **SAP comparison:** the supplied scripts do what the docs claim.
  - The restored check compares whole rows exactly for both users and both named roles (`evidence-only-pr1142-fresh-sap-restored.mts:24-28`), and its receipt is written only after those comparisons pass.
  - The row guard is effective: 1,000 is below the 10,000 cap (`table-query.ts:111,116`).
  - The baseline demonstrably precedes this assignment: it asserts the role absent, and the candidate script reads it and asserts the role present.
  - Generated profile contents and other assigned roles aren't compared. The docs don't claim them.
- **Cloud and destination:** these are five hash matches between `receipt` and the manifest.
  - **Scripts:** cloud verifier, cloud control and destination verifier.
  - **Receipts:** cloud and destination.
  - **Absence:** IAM absence is exact (`evidence-only-verify-cloud-restored.py:27-30`). The temporary destination is a 404 with a 200 on the source as control.
- **Health host:** the `mcp-sap-docs` host differs from the app name but matches the origin the harness requires (`deletion-qualification.mjs:31`). I can't confirm route ownership because the route baseline is withheld.

### Host power
Accepted as operator evidence, and the clamshell caveat is explicit.
- The window (15:49:16–16:13:58) covers the run and all three restoration verifications, the last at 16:13:25.
- The ledger's `verifiedAt` of 16:16:14 falls after the window, but no live action is recorded then.
- "Lid was checked open" has no receipt field, and the log itself is withheld.
- The failed run stays failed and separate (`include-qualification-attempt-20261101.json:285`, unchanged by the diff).

### Public wording and FEAT-93
- The roadmap (`:216-223`) names every family you listed, plus secondary native formatter proof, and `receipt:324-330` keeps the run's own limits.
- FEAT-93 stays open (`roadmap.md:71,230`).
- `roadmap.md:214` and `includes.md:44` don't claim readiness.
- Corrections are in Findings 1 and 3.

## Checks run

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first) | **Unchanged**, 2,612 files, revision `1b08bd51…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 428 files, 11,573 tests (prior 11,572 + 1) |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 (20 formatter, 39 deletion, including 22 include) |
| `npm run typecheck` | **Pass:** all three projects, no diagnostics |
| `npm run check:sizes` | **Pass:** 868 files, 12 schema scenarios |
| `python3 review-input/verify-snapshot.py` (last) | **Unchanged**, 2,612 files; nothing was read after it |

No command printed a separate exit code, and the tool reported no failure.

**Unchanged files:** I edited nothing. Vitest wrote `test-results/unit.json`, a directory the verifier excludes. The verifier also skips symlinks, `.git`, `dist`, `site`, `node_modules/.cache` and `node_modules/.vite`.

## Executed and reasoned controls

**Executed, unmodified:**
- the real-lint refusals and success;
- warning cases with the new syntax reply;
- the whole unit suite;
- the 59 simulations, which use mock backends and don't exercise live SAP.

**Reasoned only, no mutants:**
- the assertion-count walk;
- what the evidence scripts would compare;
- the removal effects in the disposition table;
- baseline ordering;
- the save path being content-agnostic.

Hash matches came from comparing receipt values with manifest values, not from recomputing them.

## Missing evidence and limits
- **Blockers:** none.
- **Live:** I made no SAP, CF, BTP or browser request and assert no current state. Private baselines, raw receipts, the power log, `operator_io`, `destination-client.mjs` and the code that sets `fully-restored` weren't supplied.
- **Harness hash:** `harnessSha256` wasn't recomputed because no allowed command computes it. Unchanged production and harness rests on `followup.diff`, and without history I can't prove that diff is complete. `package-lock.json` does match the earlier recorded hash (`pp-write-delete-formatter-2026-11-01.json:8`).
- **Cross-run baseline:** the environment, droplet and route digests differ between 13:44 (`include-qualification-attempt-20261101.json:250,254,258`) and 16:12 (`receipt:259,263,267`). The 13:44 verifier isn't in this snapshot, so I can't tell a formula change from a state change. Each run's own comparison is unaffected, but continuity from the earlier restored state isn't shown publicly.
- **Still not proven live:**
  - lint refusal;
  - native syntax warnings and warning propagation;
  - task-to-parent CTS;
  - CSRF 503;
  - cleanup failures;
  - session closure on `update` and include steps, because `pinned.ts:198` hides a close-only failure.
- **Live oracle for `edit_method`:** saved state, changed hash and native hash equality (`deletion-qualification.mjs:289-291`), not exact splice content. Splice content is offline-only.
- **Denied routes:** the read-only destination, aggregate and compatibility probes use the primary writer's token and the read-only token (`deletion-qualification.mjs:356-361`), never writer B's.
- **Not read:** the native formatter workers and abaplint's source, so formatter byte restoration rests on the calling assertions (`formatter-qualification.mjs:410,416-421`).
- **Author-reported:** GitHub checks, build, lint and strict docs.

## Tool and environment deviations
- **Execution:** allowed commands ran one at a time in the foreground. The first verifier shared a batch with one `Glob`, and the others ran alone.
- **Failed lookup:** one `Glob` for `shared-pinned-method-edit*` found nothing because the filename has a date prefix, so I read the real path.
- **Outside the working directory:** only `Grep` of my own saved Vitest output, which your exception allows.
- **Internal Git:** the verifier uses read-only Git (`verify-snapshot.py:16`). `check:sizes` reports tracked files, so it presumably does too, though I didn't read that script.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so "max" is unconfirmed by me.
- **Otherwise none:** no ad hoc Python, direct git, edits, installs, delegation, browser, SAP/CF, external network, operator scripts, mutants or background shells.
