# PR #1142 at `086a8f5b`: review of the follow-up checkpoint and passive SM12 candidate

## Decisions

| Question | Decision |
|---|---|
| Delta against `ca871617` as a **development checkpoint** | **Accepted:** 0 High, 5 Medium, 7 Low. All five Mediums concern the unexecuted experiment workflow, not production. |
| **One native passive-SM12 experiment** using this exact workflow | **Conditional GO:** one run at `086a8f5b18c575d183f2ccb2e46ba1d6f4f755b1`, only if prerequisites P1 to P4 pass and rules P5 and P6 are followed. Any failed prerequisite makes it **NO-GO for these bytes**. |
| Six prior Low findings | **All closed.** The provenance of the Finding 6 receipts is author-reported. |
| Production function admission or destructive escape | **None found.** |
| Whole-PR acceptance, native or PP qualification | **Not granted or assessed.** The PR stays draft and FEAT-93 stays open. |

- **Checks:** every allowed command passed, including 12,826 of 12,826 Vitest tests.
- **SAP:** I sent nothing to SAP and ran no operator phase.
- **Cause of the invalid-handle 423:** still unknown. Nothing here establishes one.

**Severity:** Medium means a missing control, a wrong conclusion, or a likely loss of the single run. Low means an edge case, a test gap or a doc gap, with no path to a foreign object or to production.

**Evidence:** findings come from reading the code, because mutants and ad hoc scripts are barred. Passing tests ran against mocks or loopback, never native SAP.

## Medium findings

### 1. The phase gates and the preparation DELETE wrapper have no test
**Where:** `scripts/qualification/pr1142/native-lock-workflow.ts:27-43`, `:101-107`, `:160-180`, `:230`; `tests/unit/scripts/pr1142-native-observation-control.test.ts:23`, `:34`

- **Gap:** `main()` runs on import and has a hard-coded origin, so no test loads it. The tests only pass the entry's URL to `nativeLockBinding`. These parts have never executed:
  - the DELETE-refusal proxy and the preparation success check
  - the recovery gate and the signal wiring
  - the real stdin wiring (the channel rows use `PassThrough`)
- **Prior control:** review 14 asked to move the cleanup gate into a testable module and rehearse it. The observer and recovery moved; these gates did not.
- **What I traced:** the proxy chain refuses DELETE on both the stateless client and the stateful session. The gates read correctly.
- **Why this doesn't block the GO:** if the wrapper failed open, the runner's unchanged-receipt guard (`native-function-contract-run.ts:126-151`) would still apply, and only this run's random `$TMP` fixture is in scope. The likely cost is a wasted run, not harm.
- **Fix:** export `runPassiveLockWorkflow({ argv, readEnv, stdin, stateRoot, createClient })`, keep the entry thin, and add rows for each phase gate and for preparation failure.

### 2. Most failure outcomes have no tracked recovery
**Where:** `native-lock-workflow.ts:102-103`, `:108-117`; `native-lock-observation.ts:238-244`; `scripts/qualification/pr1142/README.md:255`, `:285`, `:298`

| Outcome | `cleanupConfirmed` | Tracked recovery? |
|---|---|---|
| Stopped before LOCK, including EOF or SIGINT | true | Yes |
| Finished, stopped or deadline, with UNLOCK, close and context all good | true | Yes |
| Context changed or missing | false | No |
| LOCK definitively refused with a 4xx, so no lock is known | false | No |
| LOCK 5xx, network failure or missing handle | false | No |
| UNLOCK failure, or close returning `false` or `undefined` | false | No |
| Process killed, or `.env` invalid after the claim | no result file | No |
| Preparation fails after creating objects, including a tree mismatch | no `ready.json` | No |
| Recovery fails with `deletion.state: 'unchanged'`, such as one transient 503 in the guard | claim consumed | No |

- **Fails closed:** I found no harm in any row. The cost is an activated `$TMP` pair left behind, and possibly a lock until the SAP session expires.
- **Doc gap:** the README bars SM12 lock deletion and rerunning, but doesn't say what happens next. It also doesn't mention that closing stdin is how to abandon after preparation (by reading, this stops before LOCK).
- **Fix in later bytes:**
  - Treat a definite typed LOCK refusal as "no lock".
  - Allow one more recovery only after a recorded `unchanged` result with a closed session.
  - Add a separately reviewed recovery for failed preparation.
- **For this run:** covered by P4.

### 3. Nothing shows the manual sequence fits the deadline
**Where:** `native-lock-observation.ts:80-84`; `native-observation-channel.ts:31`, `:46-51`; `README.md:261-267`

- **Timing:** the 240-second deadline starts before preflight, leaving about 23 seconds per checkpoint across 10 checkpoints. Each one needs:
  - a fresh search
  - a check of argument, mode, time, counters and context
  - an accessibility capture and a screenshot
  - saving the files
  - a typed JSON line

  No timing evidence exists, and an operator driving this through tool calls could easily exceed it.
- **Input traps:**
  - EOF aborts, so `echo … > fifo` per step would likely stop at the first answer once the writer closes.
  - Pasting two lines aborts, and so does any line sent while no prompt is pending.
- **Other details:** prompts carry no timestamp, so captures must be matched to the journal rows around each prompt. Lock hold can reach about 5 minutes, because UNLOCK and close each get up to 30 seconds after the deadline.
- **Impact:** a stop is recorded truthfully, but it uses up the single run with a partial transcript.
- **Fix:** P3.

### 4. The procedure has no SM12 controls around the lock, and `cleanupConfirmed` is HTTP-only
**Where:** `native-lock-observation.ts:238-244`; `README.md:240`, `:287`

- **Missing controls:** the README asks for an SM12 view before preparation, but requires no zero-lock capture just before LOCK and none after cleanup. Without them, ten `present` answers can't show that the view was updating.
- **Overclaim:** `cleanupConfirmed: true` means UNLOCK returned 2xx and the session close succeeded. It doesn't show that the enqueue entry is gone. A leftover lock could then consume the only recovery attempt.
- **No fixed reading of results:** the README doesn't say in advance what each outcome means, which invites over-reading.
- **Fix:** P4 and P5.

### 5. The inventory's native assumptions haven't been replayed
**Where:** `native-lock-inventory.ts:51-60`, `:111`; `native-contract-inventory.ts:51-52`, `:84`; `tests/unit/scripts/pr1142-native-lock-recovery.test.ts:33-41`

- **Exact tree:** the new check requires exactly four members. The older baseline tolerates a missing `SAPL…`, and all tree rows here use authored XML. Run 2 also ran a group preaudit before activation, which the current runner skips, so its tree may not match.
- **Raw hashes:** the new inventory hashes raw bytes, while the older baseline normalised metadata (`changedAt`, `etag`, `version`). So "every hash matched" in the earlier recovery may not establish raw stability across a LOCK and UNLOCK.
- **Status:** review 14 listed this replay as a prerequisite. This delta doesn't show it was done.
- **Impact:** a tree mismatch strands the pair right after activation. A raw mismatch consumes the recovery attempt.
- **Fix:** P2.

## Low findings

### 6. Code binding has gaps beyond the entry file
**Where:** `native-lock-binding.ts:74`, `:77-79`, `:91-100`; `safe-io.mjs:117-128`; `docs/research/2026-11-02-native-function-protocol.md:328`

- **Not refused:**
  - `NODE_OPTIONS` preloads
  - `GIT_*` environment overrides
  - assume-unchanged or skip-worktree bits
  - an ignored `.mts` beside a tracked `.mjs` (tsx's mapping is from memory; I didn't read tsx)
- **Overclaim:** "refuses executable shadows" is therefore slightly too broad.
- **Fix:**
  - Run `git status --porcelain --ignored=matching -- src scripts/qualification/pr1142`.
  - Reject non-`H` entries in `git ls-files -v`.
  - Strip `GIT_*` from the environment.
  - Refuse a non-empty `NODE_OPTIONS`.
  - Pin `execArgv`.

### 7. Synchronous git has no timeout while the lock is held
**Where:** `native-lock-binding.ts:74`, `:88`; `native-lock-observation.ts:96-99`

A hung `git` blocks the event loop, including the deadline, stdin and signal handlers, so UNLOCK can't run. **Fix:** pass `timeout: 10_000` so a hang becomes a throw and cleanup proceeds.

### 8. The prompt deadline relies on an otherwise unreferenced timeout signal
**Where:** `native-lock-observation.ts:83`, `:39-57`

Nothing else bounds the wait at a prompt, and nothing keeps a reference to the `AbortSignal.timeout` source. From memory, some Node versions may collect such a source signal. I couldn't read Node here, so **this risk is unverified**. **Fix:** keep a strong reference, or add a plain timer that aborts.

### 9. `fetchTimeoutMs` changes the connection path for no time benefit
**Where:** `native-lock-observation.ts:84`; `src/adt/http.ts:1419-1423`; `src/adt/http-deadline.ts:56-64`; `src/adt/crud.ts:222-228`

The 30-second clamp already bounds these requests. The option only moves LOCK and reads onto a separate Agent with parser timeouts disabled, while UNLOCK and close use the default dispatcher. The current delete path uses the default dispatcher throughout. This is unlikely to matter, since the context is cookie-based, but it's a needless difference in a replay experiment. **Fix:** remove it.

### 10. Failure reasons aren't journaled
**Where:** `native-lock-workflow.ts:183`, `:230-233`; `native-lock-observation.ts:232-236`; `native-observation-channel.ts:15-18`

- Inventory reads bypass the observer, so a failed read leaves no reason in the journal.
- The top-level catch discards the error.
- SIGINT, invalid input and EOF all record `errorType: 'Error'`.

**Fix:** record allow-listed reason codes.

### 11. Some receipts read wrong
- **`native-contract-transport.ts:211`:** a DELETE refused by the wrapper still writes `stage: 'request', method: 'DELETE'`. This item from review 14's Finding 11 is still open, so pair it with its `AdtRequestNotSentError` row when reading receipts.
- **`native-function-contract-run.ts:322`, `:343-346`:** a successful preparation records `failure: true` and `cleanupUnconfirmed: true`.
- **Failure paths in preparation:** by reading, a prompt without activation still sends LOCK and UNLOCK before the wrapper refuses the DELETE.
- **`native-lock-observation.ts:141`:** `source: 'operator-SM12'` is an operator claim, so `operator-reported` is more accurate.
- **`native-lock-observation.ts:239`:** `cleanupConfirmed` is true when no lock was attempted.

### 12. Test rows are missing
The code is correct by reading for each of these:
- **Observer:** LOCK 4xx and 5xx; close returning `undefined`.
- **Recovery:**
  - abort after locks but before DELETE
  - group DELETE 423
  - untyped 404
  - suffix found in the inactive list
  - an extra member appearing at recovery time
- **Budgets:** no attempt or response exhaustion rows. `vi.mock('undici')` also bypasses the attempt counter (`tests/unit/handlers/setup-undici-mock.ts:24-27`; `src/adt/request-attempt-budget.ts:67-74`), so no mocked row here charges it.
- **Binding:**
  - no accepting path, dirty tree, package-lock change, changed entry or JS sibling row
  - the row at `control.test.ts:19-26` uses a bare `rejects.toThrow()`; in this history-free snapshot it presumably passes only because `git rev-parse HEAD` has no commit to resolve

## Requested assessments

| Area | Verdict | Basis |
|---|---|---|
| Premature preparation success | **Not found** | `ready.json` requires a receipt written only after the native-active, source and metadata proof (`native-function-contract-run.ts:263-279`). It also requires both owners present, no pending or cleanup issues, no abort (`workflow:172-180`) and 19 validated reads. Ignoring `outcome.failure` is correct, since preservation always sets it. A prompt that also activates yields no receipt. |
| Cleanup and recovery | **Gap** | Finding 2 |
| Loaded-code binding | **Holds, with gaps** | The entry's bytes are compared to the commit, the Git root is real, HEAD and status are clean, and package lock and Node are compared across phases. Dependencies are declared unattested. Finding 6. |
| One-time claims | **Hold locally** | `mkdir` is exclusive and fsynced before credentials (`binding:46-55`, `workflow:66`, `:108`). Refused gates don't consume a claim. A different `HOME` or manual removal defeats it. |
| Stop windows | **Bounded** | See below. |
| Timer and input lifetimes | **Hold** | Queued, malformed, oversized or closed input stops the run, listeners are removed and the channel closes. Stray input during cleanup is harmless because UNLOCK and close carry no signal. Findings 7 and 8. |
| Response and attempt budgets | **Hold by my count, untested** | Observation uses 15 to 16 of 32 attempts on one shared allowance. In recovery, `composeOptions` doesn't forward budgets on option-less calls (`src/adt/mutation-http.ts:52-63`). So recovery uses 7 to 8 on the context allowance, 20 on a fresh DELETE allowance, and per-call allowances for owner reads. I can't size the discovery body charged to the 2 MiB allowance. |
| Owner and session identity | **Holds at HTTP level** | LOCK, reads, UNLOCK and close use one session object. Only booleans are recorded. A stable cookie doesn't prove the backend handle is unchanged, and the docs say so. |
| False absence | **Holds in recovery** | Recovery requires typed 404s for group, module and pool, a valid inactive-list root, and no suffix (`recovery:60-101`). SM12 `absent` is operator input, with `locked` as the positive control and no negative control (Finding 4). |
| Overclaims | **Mostly careful** | The README and doc state the limits. Findings 4, 6 and 11. |
| Manual feasibility | **Unproven** | Finding 3 |
| LOCK and DELETE limits | **Hold** | Observation has one LOCK and no delete call, and its guard refuses any DELETE. Preparation's wrapper refuses all. Recovery permits only the group (`recovery:40`). |
| Production | **None found** | The diff has no `src/` hunk, `src/` has no reference to these scripts, and npm `files` lists only `dist` and `bin`. `createPinnedFunctionContext` is defined in `src/` but not called from it. |

**Stop windows:**
- **Before signal handlers:** the process dies with the phase claimed and no SAP request sent.
- **During preparation:** in-flight requests finish, because action contexts carry no signal (`native-function-contract-run.ts:160`, `:245`). The result is no `ready.json` and a preserved fixture.
- **Before LOCK:** `check()` prevents the LOCK.
- **LOCK in flight:** the lock is treated as unknown, and recovery is blocked. This is the one narrow window where a lock could exist without a usable cookie.
- **Lock held:** UNLOCK and close each get up to 30 seconds and ignore the abort.
- **Recovery before DELETE:** signals are rechecked, so no DELETE follows (`recovery:38-45`).
- **DELETE in flight:** reported as `delete-unconfirmed`, with no retry.
- **SIGKILL or host sleep:** the lock remains until the SAP session expires.

## Prior six Low findings

| # | Prior finding | Disposition | Evidence |
|---|---|---|---|
| 1 | Binding row changed the wrong link | **Closed** | `tests/unit/scripts/pr1142-native-contract.test.ts:324` now targets the `objectstates` link's own binding, and it passes. |
| 2 | Activated-module gate depended on the code path | **Closed** | The gate at `native-function-contract-run.ts:132-145` sits at the delete point, so it covers stop, comparison failure and prompt alike. The row at `tests/unit/scripts/pr1142-native-runner.test.ts:295` asserts zero DELETEs. The author's pre-fix reproduction is plausible by reading but wasn't rerun. |
| 3 | Receipts labelled only the requested version | **Closed** | `native-function-contract-run.ts:117-118`, `:265`, `:274-279`. Runner rows assert both fields, including `null`. |
| 4 | Corrections lacked pinning assertions | **Closed**, all four bullets | Messages: `pr1142-native-runner.test.ts:288-293` and others. Hint: `tests/unit/adt/errors.test.ts:717-718`, `:741-742`; `tests/unit/handlers/dispatch-misc.test.ts:915-916`. Namespace: `pr1142-native-contract.test.ts:24-37`. Foreign and fallback rows: `pr1142-native-runner.test.ts:345`, `:324`. |
| 5 | Plan read as if the diagnostic were pending | **Closed** | `docs/plans/2026-10-26-broader-pinned-pp-writes.md:10` |
| 6 | Comparator not replayed on pre-activation reads | **Closed** | `tests/fixtures/adt/function-metadata-a4h-activation.json:14-25`; `pr1142-native-contract.test.ts:39-56`; the runner's `capturedState`. The receipts' origin is author-reported. |

**Test count:** 12,826 minus 12,781 is 45. That matches 36 new-suite cases (17 + 7 + 12, as executed) plus 9 contract and runner rows.

**Retired repeated-LOCK design:** it stays retired, and that candidate isn't in this snapshot. Review 14's controls compare as follows:
- **Now present:** one-time claim, code binding (Finding 6), separate cleanup authority, stop gates, per-step context, `sessionClosed === true`, and media and size checks.
- **Partly met:** mock rehearsal (Finding 1).
- **Still open:** the misleading DELETE row (Finding 11), the receipt replay (Finding 5), and the recovery plan (Finding 2).

## One-experiment decision: conditional GO

**This authorises:** one preparation, one observation and at most one whole-group recovery, using the commands at `README.md:246`, `:258` and `:291`. It doesn't authorise a FUNC DELETE, a repeated LOCK, any retry, or any PP, BTP or permission change.

**Bytes:** revision `086a8f5b18c575d183f2ccb2e46ba1d6f4f755b1`; workflow SHA-256 `e9cfa459a67d5f2b5381291495b89153aa561efcf69cacfe2676ac9c00d85cac`. Committing this report later is fine if the run uses a detached worktree at that revision. Any change to run code needs a new review and a new experiment name.

### Prerequisites and run rules
**P1. Environment**
- Use a clean checkout at the exact revision, with a real `node_modules/` directory (a symlink would likely fail the clean check) and `.env` validated beforehand, since a bad one consumes the claim after it's made.
- Keep `NODE_OPTIONS` and `GIT_*` unset, and the same Node for all phases.
- `git ls-files -v` must show only `H`.
- There must be no ignored files under `src` or `scripts/qualification/pr1142`.
- The fixed experiment directory must not exist.
- The host must not sleep.

**P2. Offline replay on retained receipts, with no SAP request**
- Run the retained pre-child and post-activation trees through the exact four-member rule. Use `A89B…` and `9E54…` to show whether `SAPL…` depends on the group preaudit.
- Compare the raw bytes of all 19 resources before and after the retained module LOCK and UNLOCK cycles.
- Confirm the connection and order of the nine requests.
- Any mismatch means **NO-GO for these bytes**.

**P3. Timed rehearsal on the zero-lock SM12 view**
- Run ten complete capture cycles, each within 18 seconds. If that isn't achievable, **NO-GO**, because the deadline is fixed in these bytes.
- Use an open terminal or a writer that stays open. Never close stdin between answers, and never paste ahead.

**P4. Written stop rule and result table, kept outside the tree and written before preparation**
- Any row in Finding 2 without tracked recovery means stop and leave the fixture.
- Wait for the lock to clear by passive inspection only.
- Any further action needs its own review.

**P5. SM12 controls**
- Use a freshly confirmed session.
- Capture zero locks just before `observe`.
- Capture per step, with times matched to the journal rows around each prompt.
- Capture zero locks after `observe` exits and before any recovery. If it isn't zero, don't run recovery.
- Capture again after recovery.

**P6. Conduct**
- Inspect all 19 private bodies before observation and again before recovery.
- Pair any `DELETE` request row with its `AdtRequestNotSentError` row.
- No retry or claim rename.
- No SM12 delete action.
- No other ADT activity by this user on the fixture.
- Keep receipts and captures private.

### How to read each result
| Result | Supports | Doesn't support |
|---|---|---|
| `locked` is not `present` | The selection or method can't see this lock | Anything about reads |
| All ten `present`, columns unchanged, later zero locks | No visible enqueue change in this slow sequence | Handle equality, reads being harmless, any 423 cause |
| `changed` or `absent` at step k | The first visible change after the sequence up to k | Step k alone as the cause, or the 423 mechanism |
| `sameAsLock: false` | The HTTP context changed | Anything about the enqueue |
| Deadline or input stop | A partial transcript up to that step | Any later step |
| Non-zero SM12 after cleanup | UNLOCK and close didn't release the lock | Safety of running recovery |

### Limits that remain
- It sends no DELETE, so it can't show what the DELETE check would do.
- It's one sample, on one system, in the activated state only, with no saved-inactive control.
- Timing differs: about 1 second historically, up to 4 minutes here, with a different gap after activation.
- Visible SM12 columns don't prove the full handle identity, and operator answers aren't independently verified.
- The inventory doesn't read other-language texts, documentation or enhancements, which a group DELETE may also remove. That's acceptable only for this random-named fixture.
- Whole-group cleanup doesn't qualify FUNC deletion.
- It qualifies nothing on PP. Basic-native evidence can't do so, and `77e41fdcd` isn't current-byte evidence.

## Checks and snapshot integrity

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged:** 4,483 files, revision `086a8f5b…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 477 of 477 files, 12,826 of 12,826 tests, 36.51 s |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 by my count, older families only, no function family |
| `npm run typecheck` | **Pass:** all three projects |
| `npm run check:sizes` | **Pass:** 955 files, all 12 schema scenarios |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged:** 4,483 files; nothing was read after it |

The manifest gives `4fe72885…` for both `prior-verbatim-verdict.md` and its committed copy, matching the hash at doc `:301`. `followup.diff` and `authored.diff` share hash `dcf9c69e…`, so I read that content once. I read the changed code and test hunks in the diff, and read the new modules and new test suites from their snapshot copies.

## Evidence limits

- **Live coverage:** no run covers these bytes.
- **Author-reported, not verified here:**
  - build, lint (3 infos), policy and strict docs
  - all native receipts and the vendor inspection
  - the SM12 zero-lock view and session refresh
  - fixture absence and the cloud permission restoration
  - CI at `ca871617`, including the CodeQL result
  - the pre-fix regression failures
- **Diff completeness:** I have no `ca871617` bytes or history. The manifest proves these bytes, not that the diff is the complete delta, so "no `src/` hunk" rests on the diff plus my searches.
- **Dependencies:** I didn't read Node, undici or tsx. Statements about them are marked or come from executed rows.
- **Binding:** with no commit history, the accepting path of `nativeLockBinding` couldn't run here.

## Deviations

- **Unapproved command:** early on I attempted a `python3 -c` file-size check that wasn't on the allowed list. The harness refused it and it never ran.
- **Refused read:** one `Read` of `pr1142-native-runner.test.ts` omitted `source/` and pointed outside the snapshot. The harness refused it and returned nothing.
- **Saved output:** Vitest's output exceeded the display limit, so I searched my own saved copy, as the rules allow.
- **Child processes:** the approved suite started its own child processes and created temporary paths, including under `node_modules/.cache`. The final verifier reported the snapshot unchanged.
- **Otherwise none:** no edits, installs, SAP, CF, browser or external network use, operator execution, mutants, ad hoc scripts, direct git, delegation, pipes or background shells.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so max effort rests on the launcher.

## Next implementation steps

1. Complete P1 to P4, and run the experiment at most once under P5 and P6, reading the result with the table above.
2. Make no production lock change without evidence of a cause.
3. For any later workflow version, fix Findings 1 and 2 and Findings 6 to 12, and use a new experiment name.
4. When production function activation is implemented, require native `active`, matching source and matching metadata together. Keep the function profiles private until admission.
5. Continue the accepted open scope:
   - function activation and admission, and activated-module deletion
   - DDIC, CDS and SDO; RAP and batches
   - package, API and publication; CTS
   - runtime trace and quickfix; classic FLP
   - resource policies
   - current-byte two-writer and recording-transport PP qualification

Missing implementation here is not evidence of backend non-support.
