# PR #1142 at `c6d7fc37`: retain, and run a fresh PP attempt after one harness change

**Retain this checkpoint, and proceed to a fresh controlled PP attempt once finding 1 is in.** All eight prior findings and L4 are closed for what they asked, with leftovers listed below. I found no safety defect, but there is one Medium and six Low findings. This isn't merge approval: the PR stays draft and the include family isn't qualified.

Finding 1 affects what the next run can teach, not safety. At `c6d7fc37` a run would still fail closed, but a repeat of the failure would again leave no cause.

**Before the run:**
- **New revision:** include findings 1 and 2 and the wording in finding 6. These are harness, test and doc changes, so reviewing just that diff is enough. Findings 4, 5 and 7 shouldn't hold the run.
- **Failed request:** bound its duration now from the private run directory (finding 1).
- **Recovery:** settle finding 3 outside the repo.
- **Access rollback:** finish the IAM/XSUAA restoration or carry the original before-state forward. Don't baseline from the current state, which still holds those temporary entries.
- **Binding:** prepare new run and fixture manifests from a clean checkout and re-verify the artifact bytes. The patch lists no `src/` change, but that doesn't replace the byte check.
- **Stop rule:** if `HTTP_REQUEST_FAILED` recurs at the same step, recover and stop. Don't start a third attempt until the cause is identified.

## Findings
Harness files are under `scripts/qualification/pr1142/`, and operator records are under `review-input/operator-evidence/`. "Research doc" is `docs/research/2026-11-01-broader-pinned-pp-writes-includes.md`, and "attempt summary" is `docs/research/broader-pinned-pp-writes/include-qualification-attempt-20261101.json`.

### 1. Medium: another transport failure would be as unexplained as the first
- **Gap:** `safe-io.mjs:105-108` discards the error from any rejected `fetch`, and `safe-io.mjs:15-19` keeps only the code. No receipt exists either, because the observer runs only after a response (`mcp-checks.mjs:41`).
- **What it hides:** the record can't separate a 330-second timeout (`mcp-checks.mjs:39`), a connection or TLS failure, or a refused redirect (`safe-io.mjs:106`). The patch touches none of this.
- **Phase label:** the failure is labelled `existing-save`, though the read failed, because that read has no step of its own (`include-qualification.mjs:109`). `lastSave.initialized:false` and the recovered `version 2` source do confirm it was the read.
- **Fix:** keep the code, and add the error `name`, `cause.code`, elapsed milliseconds and RPC tool name, with no messages or URLs. Test a timeout and a refused redirect in `tests/unit/scripts/pr1142-harness-safety.test.ts`.
- **Check now:** compare the last `deletion-rpc-*.json` `at` (`deletion-qualification.mjs:71`) with the first `native-cleanup-*.json` `at` (`native-fixtures.mts:69`). The last SAP change was about 06:57:48Z (`partial-include-recovery-inspection.json:224`) and the run finished at 07:13:47Z. One request can use only 5.5 of those 16 minutes, and the summary doesn't break down the rest.

### 2. Low: the failure seen live has no offline scenario
- **Gap:** the mock throws on create (`deletion-regression.mjs:219`) and on a save (`:274`), and returns 500 on include reads (`:190`). Nothing rejects the read after a successful save.
- **Durability:** until read-back succeeds, the journal holds the last save's hash only in `lastWrite` (`include-qualification.mjs:98-99,115`). The mock checks only `attempt` (`deletion-regression.mjs:232-236`), and later reads follow cleanup's re-save (`deletion-qualification.mjs:484`). Deleting line 99 therefore stays green.
- **Fix:** add a scenario that rejects that read and reads the disk at that moment. Assert `attempt` is `existing-save`, `lastWrite.sourceHash` is the new digest, and `sourceHash` is still the old one. Also assert no further mutation and a preserved fixture.

### 3. Low: the recovery the next failure may need can't be reviewed
- **Gap:** a failure before the receipt leaves a class for manual recovery (`README.md:141-142`). The snapshot has no recovery script or runbook for this case, unlike the formatter's (`README.md:93-100`).
- **Evidence:** the selected records show only a metadata and source read, then absence and cleanup state (`partial-include-recovery-cleanup.json:5-15`). They hold no receipt comparison, no under-lock observation and no script hash, though the direct check has `probeSha256`. Here, the "matched under lock" claim is only your statement (attempt summary `:110`, research doc `:149-151`).
- **Fix:** hash the script and have it record both comparisons. This needs no new revision if the script stays private.

### 4. Low: the reporter test doesn't model a real failed unlock
- **Different shape:** the test's mock sets the flags and rejects (`tests/unit/scripts/pr1142-native-fixtures.test.ts:280-283`). The real lifecycle swallows the unlock error and resolves (`src/adt/crud.ts:145-147`), so the failure comes from `native-fixture-operations.mts:176`, which no test reaches.
- **Effect:** by trace, removing line 176 gives a `complete` worker report that the harness accepts, because it never reads `cleanupState` (`deletion-qualification.mjs:471-476`).
- **Worker not run:** its `operation` never rejects (`native-fixtures.mts:91-142`), and the boot test stops at the TLS refusal (`native-fixtures.mts:20`). Removing the wrapper call stays green.
- **Fix:** add a test where the mock sets `unlockFailed` and resolves, then expect `Cleanup unlock failed` and the persisted state.

### 5. Low: three checks still can't fail for the right reason
- **Refused-but-mutating:** this is injected only for blank input (`deletion-regression.mjs:239-248,256`). The `refuse()` checks at `include-qualification.mjs:137-138` never fail in any scenario, because `includes-stale-write` stops earlier at `.expected_outcome`.
- **Save predicate:** it's now well tested, but the mock's save body never varies (`deletion-regression.mjs:275-284`). Deleting the call at `include-qualification.mjs:100-108` stays green.
- **Route test:** an earlier refusal at `src/handlers/write/pinned.ts:48-51` gives the same code and state (`src/handlers/write/pinned-result.ts:16-20`). The assertion at `tests/unit/server/multi-target-writes.test.ts:106` can't tell them apart. By reading, the guard is reached; assert its message to prove it.

### 6. Low: published wording goes beyond the evidence
- **Attempt summary `:107`:** "no response was received" isn't known, since a refused redirect also rejects. Say the request rejected and no status or body was recorded.
- **Attempt summary `:71` and research doc `:137-138`:** the comment-placement cause is stated as fact. The record shows a generic 400, then a later syntax check with a warning and `hasErrors:false` (`direct-include-check-attempt1.json:11-17,49-65`).
- **Research doc `:158-159`:** "refusal side effects" covers blank probes only.
- **Research doc `:161-162`:** the test exercises the reporter function with injected state, not the worker.
- **`README.md:149`:** "each mutation attempt" means include saves only, not create, main-source saves, activation or delete.

### 7. Low: the mock's shape differs from native evidence
- **Initial includes:** the mock starts with only `definitions` and `macros`, and asserts `implementations` and `testclasses` were initialized (`deletion-regression.mjs:211,589`). Live, only `testclasses` was absent (`direct-include-check.json:73-86`).
- **Trailing newline:** the mock keeps it, but live reads drop it (`partial-include-recovery-inspection.json:296-299`). The read-back `comparable()` therefore never does any work offline.

## Dispositions
| Prior finding | Disposition | Basis |
|---|---|---|
| 1 Medium: same-session initialization | **Closed for direct identity** | Supplied native record: `initialized:true`, refused repeat, one active descriptor, active hash equals saved hash (`direct-include-check.json:19-38,50-60`). The code returns that result only after its same-session read-back matches (`src/adt/class-include-write.ts:110-123`). |
| 2 Low: descriptor and diagnostics | **Closed** | Native records show the descriptor (`partial-include-recovery-inspection.json:220-228`). Types and count are observed before the assertion (`native-fixture-operations.mts:91-99`), and the test ran. The worker's disk write was only read. |
| 3 Low: durable progress | **Closed for attempts and writer B** | The disk is read at each accepted include save (`deletion-regression.mjs:227-237`), and writer B is asserted (`:577-586`). By trace, deleting `include-qualification.mjs:89` fails `includes-success`. See finding 2. |
| 4 Low: save predicate | **Closed at the predicate** | 23 executed tests cover every field, contradictory and missing. See finding 5. |
| 5 Low: blank controls and route | **Closed for blank probes** | Three scenarios pin the exact failing check (`deletion-regression.mjs:550-561`). Both inputs reach the real handler. See finding 5. |
| 6 Low: simulated author | **Closed for includes** | The author is recorded per write (`deletion-regression.mjs:272,357`), the header swap precedes actor derivation (`:142`), and an inactive version fails (`:364`). Class-level `changedBy` still copies the creator (`:343`), outside this finding. |
| 7 Low: missing creator | **Closed** | `changedBy`, `version` and creator are tested individually (`pr1142-native-fixtures.test.ts:183-205`). Docs are corrected (`README.md:140`, research doc `:114-115`). |
| 8 Low: wrapper timeout | **Closed** | Explicit 30 seconds (`tests/unit/scripts/pr1142-combined-qualification.test.ts:16`). It took 2,864 ms here. |
| Previous L4: cleanup report | **Closed for the reporter; worker use only read** | Deleting the state copy now fails a test. The real setters are tested separately (`tests/unit/handlers/pinned-class-includes.test.ts:274-291`, `tests/unit/adt/mutation-lifecycle.test.ts:241,286`). A kill at 180 seconds still skips reporting (`native-check.mjs:41`). See finding 4. |

## What this does and doesn't prove
- **Simulated, executed here:** unit tests over mocked HTTP and 55 mock-MCP simulations. The mock's writer-to-SAP-user table stands in for real principal propagation.
- **Read, not executed:**
  - every "stays green" claim
  - the worker's use of the wrapper
  - the route guard being reached
  - real-server parity: the route test skips scope-derived safety and `authInfo` (`src/server/server.ts:895-906`)
- **Supplied native evidence, not run by me:**
  - The direct check above.
  - The PP summary: 386 passed, 2 failed.
  - Recovered sources, consistent with the summary: three kinds at version 3 and `testclasses` at version 2, all inactive, `$TMP` and changed by the primary user.
  - Typed absence for all four names.
- **Stated, but not in the selected records:**
  - the under-lock comparison
  - PP `initialized:true` for `testclasses`; `lastSave` is the later save, with `false`
  - the stopped harness and the restoration status
- **Not established:** the cause of the HTTP failure.
- **Not exercised live through PP:**
  - the `testclasses` read after an existing save, plus its stale-hash, clear and final-save steps
  - whole-owner activation and the native receipt across all four kinds
  - writer B, the formatter at this binding, denied-route include calls, normal delete, and automatic cleanup with include receipts
- **Limits that still apply:**
  - It's local `$TMP` only, with no transportable-write proof.
  - It proves only what the primary native reader can see, with no proof about other users' private drafts.
  - Per-include author is the last changer after whole-owner activation, not attribution of each request.
  - The direct check isn't PP evidence, and earlier PP evidence stays bound to `1b234d3a4` without covering includes.
- **External cleanup isn't complete:** IAM role/collection and XSUAA restoration are still pending. I contacted no external system, so the restoration status is yours as supplied.

## Tests run
| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` | `unchanged`, 2,469 files, revision `c6d7fc37…`, on the first run, the last run and one extra run after validation |
| Focused `vitest run --silent=true …` (15 files) | **Exit 0: 15 files, 474 tests passed** |
| `npm run test:qualification:pr1142` | **Exit 0: 55 simulations passed** (20 formatter, 35 deletion, including 18 include) |
| `npm run typecheck` | **Exit 0, no errors** across all three projects |

- **Counts reconcile:** tests rose from 445 to 474 (23 predicate, 2 route, 2 missing-attribute, 1 creator, 1 reporter). Simulations rose from 50 to 55, and `includes-success` stays at 255 requests. Files rose from 2,462 to 2,469 (3 from the patch, 4 operator records).
- **Author-reported only:** 398 files / 10,976 tests, lint, strict docs and budgets. By your note these predate the final mock edit, after which only the 35 deletion simulations were repeated.

## Tool and environment deviations
- **One refused read:** a `Read` that left out `source/` was refused, nothing was read, and I retried inside the root.
- **Vitest output:** the CLI saved it to `~/.claude/projects/…/tool-results/boqw1yqlx.txt`. I searched only that file, as your exception allows.
- **No mutants:** edits weren't allowed, so every "stays green" claim is traced by hand.
- **Hashes not recomputed:** no allowed command could check the hashes in the evidence records.
- **Execution:** validation ran one command at a time in the foreground, with file reads alongside. Vitest wrote `test-results/unit.json`, and simulations used temporary directories.
- **Otherwise none:** no git, `ls`, installs, network, SAP, CF, browser, edits or delegation.
- **Revision identity:** this rests on the manifest label, and I took `patch.diff` as complete.
