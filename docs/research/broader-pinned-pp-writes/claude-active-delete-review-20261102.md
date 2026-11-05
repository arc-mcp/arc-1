# PR #1142 at `5b1669eb`: development checkpoint and one active-FUNC deletion experiment

## Decisions

| Question | Decision |
|---|---|
| **Development checkpoint** | **Accepted:** 0 High, 4 Medium, 7 Low. All four Mediums concern the unexecuted experiment, not production. |
| **One native active-FUNC deletion experiment** | **Conditional GO:** one invocation of the exact candidate, only if P1 to P5 below pass and P6 and P7 are followed. A failed prerequisite means **NO-GO for these bytes**. |
| **Whole-PR acceptance, PP qualification, public function admission** | **Not granted and not assessed.** The PR stays draft and FEAT-93 stays open. |

- **Failure handling:** sound for one run. I found no path to a foreign object, no way to clear preservation wrongly, and no false pass.
- **Likely single-run risk:** the guard could refuse before DELETE is ever sent, which uses up the run without testing it. Finding 1 turns that into an offline check.
- **SAP:** I sent nothing to SAP and ran no operator command.
- **Cause of the 423:** still unknown. Nothing here establishes it.

**Severity:** Medium means a missing control, a wrong conclusion, or likely loss of the single run. Low means an edge case or a test or doc gap, with no path to a foreign object or production.

**Paths:** unless noted, scripts are under `scripts/qualification/pr1142/` and tests under `tests/unit/scripts/`.

**Evidence:** findings come from reading the code, since mutants and ad hoc scripts are barred. Passing tests ran against mocks or loopback only.

## What the candidate changes on the wire

By tracing the code, the owning session now sends LOCK, group read, module read, recording check, then DELETE (`src/adt/pinned-delete.ts:94-111`, `src/adt/pinned-function-owner.ts:73`, `:87`). Those three checks are the same requests as passive checkpoints 2 to 4, all of which showed the lock present.

Six owning-session reads are gone from the historical nine. The guard's four reads now use the base connection (`native-function-contract-run.ts:137`, `:141`, `:145`):
- default module metadata
- inactive source
- active metadata
- active source

The inactive-metadata read that preceded the first observed lock absence isn't in the guard at all. That is a clean control, but only a sequence comparison. The same nine requests also preceded a successful saved-inactive DELETE (`docs/research/2026-11-02-native-function-protocol.md:217-219`), so the read alone doesn't explain the failure.

## Medium findings

### 1. The first guard comparison was never replayed against native post-activation data
**Where:** `native-function-contract-run.ts:141-143`; `native-contract-transport.ts:114-119`; `tests/unit/scripts/pr1142-native-runner.test.ts:149-175`

- **Gap:** the guard compares the default metadata read (no `version=`) with the saved receipt. The passive run proved this comparator only for `?version=active` and `?version=inactive` (`native-lock-inventory.ts:99-108`). Its `module-default` read recorded only a SHA-256 (`native-lock-observation.ts:121`).
- **Why tests can't show it:** after activation the mock returns the same captured body for every read, so the row passes by construction.
- **Impact:** if the default body differs, every FUNC DELETE is refused before sending. The fixture is safe, but the run is consumed with no answer.
- **Fix:** P2(a), offline. The passive `prepare/` journal should hold these bodies from the final `absent` and `remaining` reads (`native-contract-transport.ts:215-222`). In later bytes, add a captured default-state fixture.

### 2. Parent baseline equality after active-FUNC deletion is unobserved
**Where:** `native-function-contract-run.ts:160-164`; `native-contract-inventory.ts:37-64`, `:130-149`; `pr1142-native-runner.test.ts:59-68`, `:192`, `:224-225`

- **Evidence:** the 15 pre-child hashes matched only after a saved-inactive FUNC deletion (`docs/research/2026-11-02-native-function-protocol.md:43`). Both activated-pair recoveries compared against a post-activation inventory instead.
- **Why tests can't show it:** the mock returns constant group bodies, so the positive row can't detect a change.
- **Impact:** FUNC DELETE can succeed while the group is preserved. That gives `activeDeletionVerified: true`, `failure: true` and `remaining: [group]`. This is bounded but easy to misread, and it needs a separately reviewed recovery.
- **Fix:** P2(b) and P2(c) predict the result. Keep the comparator. In later bytes, add an explicit parent-cleanup result field and a runner row for a changed parent in explicit mode.

### 3. The candidate procedure omits review 16's SM12 controls and reading table
**Where:** `README.md:212-247`; `native-function-contract-run.ts:196`

Only the delete-action ban mentions SM12. `sessionClosed === true` is an HTTP result and doesn't show the enqueue entry is gone. The passive run's controls lived in separate operator notes, so they don't carry over. The old TFDIR-only search would also miss group and text-pool locks.

**Fix:** P3 and P4 for this run, and put them in the README in later bytes.

### 4. The run doesn't record the variable it manipulates
**Where:** `native-function-contract-run.ts:137`; `src/adt/http.ts:306-307`, `:485-487`, `:1294-1305`

- **Gap:** the passive run journaled owning-context booleans (`native-lock-observation.ts:124-136`). The candidate journals none, for either connection.
- **"Stateless" is loose:** the base client sends no session-type header, because `sessionType` is undefined outside clones. It also stores any `Set-Cookie`, and nothing asserts that it holds no `sap-contextid`. The isolation row checks only a mocked cookie (`pr1142-native-runner.test.ts:101-109`).
- **Impact:** a repeated 423 can't exclude a contaminated base context. A pass is unaffected.
- **Decision:** proceed on these bytes with that limit fixed in the reading table, because this is an evidence gap and failure handling stays sound.
- **Fix in later bytes:** at guard start and end, journal "base context absent" and "owning context present and equal to LOCK".

## Low findings

| # | Finding | Where | Fix |
|---|---|---|---|
| 5 | **Explicit-mode failure rows are missing.** These are correct by reading, but there's no row for FUNC DELETE 423 (the likeliest failure), DELETE unconfirmed, DELETE then close `false` or `undefined`, UNLOCK failure after DELETE, a changed parent, a stop at the release point, or attempt exhaustion. | `pr1142-native-runner.test.ts:368-377`, `:575-592`; `tests/unit/handlers/setup-undici-mock.ts:24-27` | Add explicit-mode rows; run budget rows over loopback. |
| 6 | **Some tests pass on an earlier guard.** `oversized-close` stops at group creation, so it never reaches the release gate. By reading, those gate conditions are unreachable today. Changed tracked files trip `git status` before the hash checks, and the ignored shadow trips the ignored-status check before the sibling check. | `pr1142-native-runner.test.ts:368-377`; `native-function-contract-run.ts:277`, `:298-304`; `pr1142-native-binding.test.ts:55-62`, `:67-73`; `native-lock-binding.ts:87-93`, `:99-108` | Inject each state directly; give the hash checks distinct messages. |
| 7 | **A symlinked start may silently exit 0** with no claim and no SAP request. This rests on my memory of Node's path handling and wasn't run. | `native-function-contract.ts:141` | Compare against `realpathSync(process.argv[1])`. For this run, see P1 and P6. |
| 8 | **Final absence bypasses the journaling wrapper.** A failure leaves only `errorType`. The inactive-list MIME check was added after the passive recovery, so it hasn't run natively and could fail a clean run. Rows are also labelled `recoveryAbsence`. | `native-function-contract.ts:118`, `:121`; `native-contract-absence.ts:31`, `:41-48` | Pass an observed client; record status and media. |
| 9 | **A stop doesn't prevent LOCK.** Delete actions are exempt from the forward stop, so LOCK and the owning reads are still sent before the guard refuses. A stop at the release point also records text blaming the wrong cause. | `native-function-contract-run.ts:173-174`, `:138`, `:313-316`, `:348-350` | In explicit mode, skip the action when stopped; record the stop reason. |
| 10 | **Post-claim failures before the `try` leave only the manifest.** A bad `.env` is the main case. Signals aren't journaled either. | `native-function-contract.ts:64-71`, `:99-101`, `:147-155` | Journal an allow-listed reason from a wrapper around all post-claim work. |
| 11 | **Environment edges.** The accepting binding test calls `mkdirSync` on the real home state parent. `NODE_EXTRA_CA_CERTS`, `NODE_PATH` and `TSX_*` aren't refused. The README lost its "private output file" instruction, although the logs I saw redact handles. | `pr1142-native-binding.test.ts:43`; `native-lock-binding.ts:111-114`; `native-function-contract.ts:16-24`; `README.md:221-223` | Inject the state parent; extend the refusal; restore the line. |

## Requested assessments

| Area | Verdict | Basis |
|---|---|---|
| Preservation mistakenly cleared | **Not found** | Release needs a successful activation with no prompt, native `active`, matching source and metadata, and no stop (`native-function-contract-run.ts:271`, `:275-285`, `:298-304`). |
| Native-active proof or fallback bypass | **Holds** | `active` alone isn't trusted, because pre-activation reads also report it. The source must equal the saved hash. The last guard rechecks version (`:156`), and the fallback row discriminates because the comparator strips version. |
| Guard freshness, identity, race | **Holds, with limits** | Same Basic identity, separate cookie jar, and the owning session has written nothing, so committed state is what matters. A lost handle fails closed at DELETE. Stateless reads under a *FUNC* lock are natively new (only group and pool locks at `086a8f5b`, `native-lock-recovery.ts:40`). Findings 1 and 4. |
| Request and cleanup budgets | **Hold by count, untested** | FUNC uses 5 of 32 attempts and FUGR 19 of 32 on one shared allowance (`native-contract-transport.ts:102`, `:188-202`). Each request is clamped to 30 s and each action to 60 s. UNLOCK and close have separate 30 s allowances (`src/adt/crud.ts:222-228`, `src/adt/mutation-http.ts:41-46`). |
| Uncertain close | **Holds** | Anything but `true` after a delete preserves the fixture and blocks the group (`native-function-contract-run.ts:196`, `:217`). Finding 5. |
| Skipped or premature cleanup | **Holds** | The group is deleted only after typed module absence and the baseline check. FUNC failure blocks the group (`:70-73`, `:160-164`, `:356-358`). |
| Final typed absence | **Holds** | Group, module and pool each need a typed 404, plus a valid inactive list without the suffix. Finding 8. |
| Stop windows | **Bounded** | See below. |
| Direct entry and fixed source | **Holds** | Two spawn tests reach the real CLI branch, and one of them shows real `execArgv` passes. I checked the 38 script files and `src/`: no tracked sibling collision. Dependencies stay unattested, as declared. Finding 7. |
| Error handling | **Fails closed** | Console output uses allow-listed codes. A missing `result.json` can't read as success. Finding 10. |
| Tests passing for wrong reasons | **Some** | Findings 1, 2, 5 and 6. |
| Foreign object or production reach | **None found** | The wire allowlist is exact, confirmation is blocked twice, the authored diff has no `src/` hunk, and `src/` doesn't reference these scripts. |
| Main merge | **No candidate effect found** | The `src/` hunks gate 503 replay, which `noReplay` already disables, and add a variants classification scoped to that path. Probes aren't used here. The lockfile doesn't change undici, tsx, dotenv or the XML parser. |

**Stop windows:**
- **Before listeners:** no SAP request has been sent, and the claim is consumed.
- **Forward work:** the next step is refused; in-flight requests finish.
- **Activation in flight:** release is refused and the pair is preserved.
- **After selection:** LOCK may still go out, the guard refuses at `:138` or `:165`, then UNLOCK and close run.
- **DELETE in flight:** it finishes and is recorded, and can't pass (`native-function-contract.ts:128`).
- **After FUNC deletion:** the group is preserved.
- **SIGKILL or host sleep:** a lock may remain until the SAP session expires.

## Review 16 dispositions

| # | Review 16 finding | Passive workflow (historical) | Current candidate |
|---|---|---|---|
| 1 | Phase gates untested | **Superseded:** `native-lock-workflow.ts` is unchanged and its claim is consumed. | **Fixed:** injectable entry plus spawn tests. |
| 2 | Failures lack tracked recovery | **Superseded:** no such recovery was needed. | **Open by design:** the stop rule is now written (`README.md:241-247`), but no recovery exists. Bounded. |
| 3 | Manual timing unproven | **Closed by execution:** 10.7 to 16.7 s per cycle, author-reported. | **Not applicable:** no prompts. |
| 4 | No SM12 controls | **Closed:** zero-lock captures verified below. | **Reopened:** Finding 3. |
| 5 | Inventory assumptions not replayed | **Closed:** author-reported replay, and the run's inventory checks passed. | **Replaced:** Findings 1 and 2. |
| 6 | Code binding gaps | **Retained:** that entry enforces only part of this. | **Fixed:** ignored status, index flags, `.mjs`/`.mts`, `GIT_*`, `NODE_OPTIONS`, `execArgv`. Residual in Finding 11. |
| 7 | Git without timeout | **Fixed:** shared binding code. | **Fixed:** `native-lock-binding.ts:78`, `:96`, `run-manifest.mjs:18`. No hang row. |
| 8 | Unreferenced prompt timeout signal | **Retained, unchanged:** the run stopped correctly anyway. | **Not applicable:** no prompts. |
| 9 | `fetchTimeoutMs` path difference | **Retained, unchanged.** | **Not applicable:** default dispatcher. This is a remaining difference from the passive run. |
| 10 | Failure reasons not journaled | **Retained.** | **Mostly fixed:** failure messages and refusals are journaled. Remainder in Findings 8 and 10. |
| 11 | Misleading receipts | **Retained:** all five items. | **Not applicable:** no prepare wrapper; refusals write `refused-before-send`. New edge in Finding 8. |
| 12 | Missing test rows | **Partly fixed:** untyped pool 404, fixture in list and media added. Still missing: observer LOCK 4xx and 5xx, close `undefined`, abort after locks, group DELETE 423, recovery-time extra member. | **Partly fixed:** binding rows added; the budget row checks identity only (`pr1142-native-contract.test.ts:254-257`). Findings 5 and 6. |

**Review 16's P1 to P6:** the dossier reports them met. I could verify the binding, inventory acknowledgement and SM12 parts from the copied evidence. The rest is author-reported.

## GO conditions for the one experiment

**This authorises:** one invocation of `README.md:222`, with one FUNC DELETE and one empty-group DELETE if its checks pass. It doesn't authorise any retry, rename, second pair, recovery, or PP, BTP or permission change.

**Bound bytes:** any byte change voids this GO and needs a new review and a new experiment name. Committing this report later is fine if the run uses a detached worktree at this revision.

| Item | Value |
|---|---|
| Revision | `5b1669eb75f631aaceb3758b1957ed7d7924e5b4` |
| Entry SHA-256 | `e02f723a32fef4ff5bb93c46ccdb654bf125d70d3ac1450ef58b678abf589c7f` |
| Runner SHA-256 | `4d56a68b4f00779c7fe76bcc2b4ac6707be4afee2a8604f9b54ef2e54771b844` |
| Lockfile SHA-256 | `bc795f7052a3524918d269bdc1ca6fbe9ee173a019103b114777a6ca900b45e4` |

### Prerequisites and run rules

**P1. Environment**
- Use a clean detached worktree at the exact revision, started from its real path.
- Use a real `node_modules/` directory installed from this lockfile, and record the Node version.
- `.env` is validated beforehand without printing it, because a bad one consumes the claim.
- `NODE_OPTIONS`, every `GIT_*`, `NODE_EXTRA_CA_CERTS`, `NODE_PATH` and `TSX_*` are unset.
- `git ls-files -v` shows only `H`, and there are no ignored files under `src` or `scripts/qualification/pr1142`.
- The fixed claim directory doesn't exist.
- The host stays awake, and output goes to a private file.

**P2. Offline replay on retained passive receipts, with no SAP request**
- **(a)** Apply `contractFunctionMetadataHash` to the post-activation default module body. It must equal the `metadataHash` in that run's `activeSourceVerified` row. A mismatch or missing body means **NO-GO for these bytes**.
- **(b)** Compare the post-activation group default metadata and inactive source with the group's after-create receipt, using the group comparator.
- **(c)** Compare the 15 pre-child baseline resources with the post-activation inventory, normalised the same way.
- A difference in (b) or (c) doesn't block the run. Record "group preservation expected" before running.

**P3. SM12 controls**
- Use a freshly confirmed session, read-only, and never use the delete action.
- Capture zero locks for `MARIAN` in client 001 just before the run.
- After the process exits, take the suffix from `manifest.json` and capture a fresh search across all tables using the suffix as the argument.
- If the result isn't zero, attempt no mutation and wait by passive inspection only.

**P4. Written stop rule and the result table below,** kept outside the tree and written before the run.

**P5. Preflight**
- A failed first GET consumes the claim, so confirm A4H is reachable just before the run. The P3 session shows this.
- This revision's CI must have finished. Any failure other than the tracked #1057 flake means stop and analyse first.

**P6. Conduct**
- One invocation, with no other ADT activity by this user on the fixture.
- Use SIGINT to stop and expect bounded cleanup. A second SIGINT won't kill the process.
- Only `result.json` with `failure: false` and `cleanupUnconfirmed: false` counts as a pass, whatever the exit code says.

**P7. Any leftover resource**
- Preserve it and inspect it read-only.
- Any further mutation needs its own reviewed recovery bound to that fixture and source.
- A leftover `$TMP` pair can wait for that review.

### How to read each result

| Result | Supports | Doesn't support |
|---|---|---|
| Pass, then zero locks | Active FUNC DELETE succeeded once with this owning sequence | Any cause, production lock order, admission, PP |
| FUNC DELETE 423 | Moving the extra reads off the owning session wasn't enough in this sample | Reads being harmless, or isolation being proven (Finding 4) |
| `refused-before-send` with no DELETE row | The named guard condition failed | Anything about DELETE itself |
| `delete-unconfirmed` | The outcome is unknown | Treating it as deleted or as still present |
| Module typed 404 but `activeDeletionVerified: false` | DELETE probably worked, with cleanup unconfirmed | A pass, or lock release without P3 |
| `activeDeletionVerified: true`, group remaining | FUNC deletion was observed; the parent differs or its deletion failed | A lifecycle pass, or that the parent is unchanged |
| `remaining: []`, `finalAbsenceConfirmed: false` | Current reads found no owners; final evidence is incomplete | A pass; re-check read-only |
| No `verifiedActiveDeletionSelected` row | Activation proof wasn't reached, or a prompt or stop intervened | Anything about active deletion |
| No `result.json` | The process ended early and the claim is consumed | Any state; inspect first |

### Limits that remain

- It's one sample, on A4H/001, with Basic credentials and a fast sequence. Earlier CI on the distinct A4H2025 target doesn't qualify this protocol.
- Stateless FUNC reads under a FUNC lock have never run natively.
- The per-step lock view is gone by design, so no SM12 observation falls between LOCK and DELETE.
- The passive sample can't separate elapsed time or the cumulative sequence from the last read.
- Third-party installed bytes aren't attested.
- A success changes no public admission. `77e41fdcd` remains stale for current bytes.

## Checks and integrity

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged:** 4,514 files, revision `5b1669eb…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 484 of 484 files, 12,961 of 12,961 tests, 37.28 s |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 scenarios (20 + 22 + 17) |
| `npm run typecheck` | **Pass:** all three projects |
| `npm run check:sizes` | **Pass:** 962 files, all 12 schema scenarios |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged:** 4,514 files; nothing was read after it |

**Not run by me:** build, lint, policy, strict docs, and the pre-fix red state of the countermodel. That countermodel is plausible by reading but remains author-reported.

**Evidence I verified:**
- All 18 copied evidence files match their `evidence-manifest.json` entries, and that manifest matches the dossier's `77d9d99d…`.
- The inventory hash `2a831b75…` agrees across the acknowledgements, manifest and dossier.
- Binding `e9cfa459…` and revision `086a8f5b…` match review 16.
- The prior verdict's `c5ee82c8…` matches its committed copy and the dossier.
- SM12 sequence: zero locks at 09:45:19Z; `X 1 0 TFDIR` with constant lock time across eight captures to 09:47:54Z; zero at 09:48:09Z, 09:49:05Z and 09:50:27Z.
- Each capture has its own E2E and WebGUI timing, which supports a fresh round trip. The manifest shows the eight "present" screenshots are byte-identical, and the PNGs weren't supplied, so they add nothing per step.

**Diffs:**
- `authored.diff` and `main-merge.diff` were read in full.
- I reconciled `followup.diff` rather than re-reading it: 59 files is 18 + 42 minus the shared roadmap, and 4,074 lines is 1,757 + 2,321 minus those four header lines.

## Evidence limits

- **Author-reported, not verified here:**
  - the native receipts behind the results, including the journals P2 depends on
  - rehearsal timings
  - vendor inspection
  - fixture absence, and permission restoration
  - remote CI
  - P1 run conditions at `086a8f5b`
- **Captures:** they are author-provided, not an independent SAP connection or complete wire transcript.
- **Dependencies:** I didn't read Node, undici, tsx or Git. Statements about them are marked or come from executed rows.
- **Binding:** real Git acceptance ran only in the isolated test repository, because this snapshot has no original history.

## Deviations

- **Unapproved commands:** I ran `wc` three times (on the diffs, the SM12 captures and one fixture), which wasn't on the allowed list. They were read-only and changed nothing, and the verifier ran first and last alone as required.
- **Refused read:** one `Read` omitted `source/` and pointed outside the snapshot. The harness refused it and returned nothing.
- **Saved output:** Vitest output exceeded the display limit, so I searched my own saved copy, as the rules allow.
- **Test side effects:** approved suites created temporary repositories and paths, and `pr1142-native-binding.test.ts` ran `mkdirSync` on `~/.local/state/arc1-qualification`. No claim is created there, and I didn't inspect that directory. The closing verifier reported the snapshot unchanged.
- **Otherwise none:** no edits, installs, SAP, CF, browser or external network use, operator execution, mutants, direct git, delegation, pipes or background shells.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so max effort rests on the launcher.

## Next implementation steps

1. Complete P1 to P5, run the experiment at most once under P6 and P7, and read the outcome with the table above.
2. Make no production lock-order change without evidence of a cause.
3. If a resource remains, write a separately reviewed recovery bound to that fixture. The passive workflow's claim and receipts can't be reused.
4. For any later workflow bytes, fix Findings 3 to 11 and use a new experiment name.
5. When production function activation is implemented, require native `active`, matching source and matching metadata together. Keep the function profiles private until admission.
6. Continue the accepted open scope:
   - function activation and admission
   - DDIC, CDS and SDO; RAP and batches
   - package, API and publication; CTS
   - runtime trace and quickfix; classic FLP
   - resource policies
   - current-byte two-writer and recording-transport PP qualification

Missing implementation here is not evidence of backend non-support. Git and custom plugins stay excluded, and aggregate, Basic, Copilot and read-only connections stay mutation-free. Basic-native evidence doesn't qualify PP.