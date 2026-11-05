# PR #1142 at `0bf538a3`: review of the correction checkpoint

## Decisions

| Question | Decision |
|---|---|
| Delta against `fd447841` as a development checkpoint | **Accepted**, with 5 Low findings and no High or Medium |
| One-shot lock-continuity diagnostic, candidate SHA-256 `5197952d…c4db01` | **NO-GO for these bytes** (5 Medium, 1 Low bundle) |
| Whole-PR acceptance, ordinary probe, PP qualification | **Not granted.** The PR stays draft and FEAT-93 stays open |

- **Prior findings:** all five are closed in code, with the remainders listed below.
- **Checks:** every allowed command passed, including 12,775 of 12,775 Vitest tests.
- **SAP:** I sent nothing to SAP and did not run the candidate or any probe.
- **Cause of the 423:** still unknown. The evidence here does not establish a cause.

**Severity:** Medium means a missing safety control or a wrong conclusion on a future run. Low means an edge case, a test gap or a doc gap.

**Evidence:** the new findings come from reading the code, because ad hoc scripts and mutants are barred. Where I say a test passed, it ran here against mocks or loopback, never native SAP.

## Findings in the delta

### 1. Low: the metadata comparator is wider than the native evidence
**Where:** `scripts/qualification/pr1142/native-contract-transport.ts:115-120`; `tests/unit/scripts/pr1142-native-contract.test.ts:276-283`; `docs/research/2026-11-02-native-function-protocol.md:191-194`

- **Gap:** the code tolerates both a `?version=active` and a `?version=inactive` link. The fixture only shows `?version=active`, on saved metadata, and the doc says "that one observed" link.
- **Impact:** if post-activation active metadata carried a `?version=inactive` link, `native-function-contract-run.ts:247` would treat it as equal. The active source check still holds, but metadata would no longer flag that link.
- **Fix:** remove `inactive` from `references`, and add a row where `fixture.active.xml` plus that link must differ. By reading, the existing replay row still passes. Add a row for a changed `xmlns:atom` binding too, since the doc claims it and no row tests it.

### 2. Low: the audit catch branch loses evidence for embedded valid URLs
**Where:** `src/server/audit.ts:558`; `tests/unit/server/audit.test.ts:485-488`; protocol doc `:188-189`

- **Trigger:** `/sap/bc/adt/https://example.test/path/user@example.org/view`.
- **Mechanism:** the authority is valid, so `scrubMalformedAuthorities` skips it. `new URL` then throws on the relative value, and the wider catch regex runs through the last `@`.
- **Result:** `/sap/bc/adt/https://[REDACTED]@example.org/view`. The old regex stopped at `/` and kept this value, so this is a retention regression, but a safe-side one.
- **Inconsistency:** the row at `audit.test.ts:485` only pins the absolute form, so the doc's "ordinary paths… remain visible" is too broad.
- **Decision:** keep the over-redaction, pin it with a row, and correct the doc.
- **Redaction regressions:** I found none by reading. All shapes in the rows passed, and input stays capped at 500 characters on every path into `sanitizeUrl`.
- **Remaining limit to document:** `https://writer:123/SECRET@example.test/x` and the empty-port form `https://writer:/SECRET@host` stay visible. They parse as a valid port plus path and can't be told apart from a harmless URL.

### 3. Low: runner rows don't use the captured metadata
**Where:** `tests/unit/scripts/pr1142-native-runner.test.ts:136-139`; `native-function-contract-run.ts:247`

- **Gap:** the native-shaped scenario still uses authored `moduleMeta` plus `<link etag>`, so link removal only runs at unit level. No row covers a metadata mismatch at `:247`, only a source mismatch.
- **Fix:** feed the fixture's saved and active XML through the runner, and add a metadata-mismatch row.

### 4. Low: wording
- **`native-function-contract-run.ts:287`:** records "Unconfirmed fixture" right after `activeSourceVerified`, so deliberate preservation reads like a failed confirmation. Use a distinct reason.
- **`scripts/qualification/pr1142/README.md:218`:** still says the corrections "need review before another run", which the later paragraph at `:222-226` contradicts. Edit the old sentence.
- **`src/adt/errors.ts:792`, `:799`:** "acquire a fresh lock in its owning stateful session" isn't something a tool caller can do directly, and I found no lock action in `src/handlers/schemas.ts`. Say to inspect the state, then repeat the whole operation only if that is still safe.

### 5. Low: some activated-module cleanups are still only logged
**Where:** `tests/integration/fugr-func-params.integration.test.ts:62-66`; `tests/e2e/func-params.e2e.test.ts:23`, `:83`

Both activate a module and then treat its deletion as best-effort. Assert the outcome there, or say why not.

## Prior findings

| # | Prior finding | Disposition | Evidence and remainder |
|---|---|---|---|
| 1 | Medium: runner reaches the failing DELETE | **Closed** | The gate is at `native-function-contract-run.ts:244`, `:254-257`, `:126` and `:286-287`. Rows `:231-247` and `:400-417` pass, with zero DELETEs from the runner. **My prior mechanism was partly wrong:** retained native bytes show the metadata comparison would have refused at `fd447841` (contract test `:273`). At current bytes the comparator makes that metadata equal, so the gate is now the operative protection and must stay. |
| 2 | Low: activation flags don't prove source | **Closed** | Code at `:245-253`. The true-flags-unchanged-source row at `:248-258` passes. **Remainder:** Finding 3. |
| 3 | Low: live tests don't assert FM deletion | **Closed in code, not executed** | `tests/integration/fugr-func.integration.test.ts:143-150` and `tests/e2e/func-write.e2e.test.ts:120-130` were read and typechecked only. The retry change at `tests/integration/crud-harness.ts:78`, `:103-106` passes its unit rows, including the typed exception. **Correction to my prior text:** "the repo can't say" was too broad, because the `syntax`, `create-recovery` and `processing` suites already fail on cleanup errors. **Remainder:** Finding 5. |
| 4 | Low: audit misses `/` credentials | **Closed for the reported shapes** | Rows at `audit.test.ts:443-450` and `:476-484` pass. **Remainder:** Finding 2. |
| 5 | Low: smaller gaps | **Closed** | Module-only guard at `native-contract-transport.ts:54-67`, with row `:70-80`. Deadline and gzip close rows at `tests/unit/adt/proxy-response-lifecycle.test.ts:151-220`. Both doc wording items are corrected. |

- **Test count:** my count of new tests in the diff is 13, which matches the move from 12,762 to 12,775.
- **Pre-fix failures:** the author's eight were not reproduced.
- **Fixture content:** `tests/fixtures/adt/function-metadata-a4h-activation.json` contains only owned metadata and hashes, by reading.
- **Production changes:** limited to `errors.ts` and `audit.ts`, with no write-surface change. Git, plugins, aggregate, Basic, Copilot, read-only apps and destinations are untouched by this delta.

## Findings in the diagnostic

`candidate` means `review-input/operator-actions/pr1142-native-lock-continuity.mts`.

### 6. Medium: nothing enforces one execution
**Where:** `candidate:23`, `:35-38`

Each invocation picks a new random suffix and a new root, so a second run creates, activates and may delete a second pair.

**Fix:** before reading `.env`, exclusively create a fixed claim keyed by revision and script hash. Never remove it automatically.

### 7. Medium: the revision check doesn't bind the code that runs
**Where:** `candidate:25-30`, `:136`

- **Gap:** `verifySource` checks the working directory, but imports resolve from the script's own location. A copy beside a different `src/` passes every check while running other code.
- **Dropped guard:** `native-function-contract.ts:17-19` guards this class and `pr1142-native-contract.test.ts:223-252` tests it. The candidate has neither.
- **Location undefined:** `review-input/` is untracked and not in `.gitignore`, so placing the script in the worktree fails `:28` unless it is excluded outside the tree.
- **Provenance:** `scriptHash` is recorded but never compared, and Node and lockfile hashes are missing (compare `native-function-contract.ts:65-75`).

**Fix:**
- Assert that the realpath of `new URL('../../', import.meta.url)` equals the working directory, and call `assertWorkspaceRoot`.
- Fix the location, using `.git/info/exclude`.
- Compare the script's own SHA-256 to a value supplied on the command line from the review.
- Record Node and lockfile hashes.

### 8. Medium: the whole-group DELETE is neither optional nor stoppable
**Where:** `candidate:23`, `:41`, `:140`, `:148-158`

- **Not optional:** one flag authorises creation, activation, measurement and the group DELETE.
- **Not stoppable:** `stop` is read at `:140`, and in the measurement loop only to end forward work. On a signal after the first LOCK, the next step throws, UNLOCK and close succeed, `:148` passes, and the DELETE is sent. Neither `:148` nor the guard reads `stop`.
- **Why the existing convention doesn't cover this:** the runner's stop-then-clean rule (`native-function-contract-run.ts:141`) applies to a group whose module is proven absent (`:131`), not one holding an activated module.

**Fix:** add a separate explicit cleanup flag, require `!stop` at `:148`, and check `stop` again at the end of the guard.

### 9. Medium: the results can't carry a causal conclusion as designed
**Where:** `candidate:101-118`, `:123`, `:146`; `native-contract-transport.ts:233-239`

- **Different sequence:** the failing flow was one LOCK, nine requests, then DELETE. This adds up to ten more LOCKs. Whether a repeat LOCK adds to a lock count or restores state is unverified, and either could hide a change. "Step k" really means "after steps 1 to k and all the LOCKs between".
- **Possibly vacuous:** the authored research says what DELETE compares, not what a repeat LOCK returns. If a repeat LOCK returns a value held in the session, every row reads "same" whatever happened.
- **No session evidence:** the earlier diagnostic recorded context equality and this one doesn't. `src/adt/http.ts:1295-1304` silently stores a reset `sap-contextid`, so a context loss would be labelled as a read effect.
- **Refusal evidence lost:** a repeat LOCK refused by SAP is a plausible outcome, but receipts keep only status and error name.
- **Connection unverified:** all nine steps run on the owning session. The doc says the whole-group guard read through the stateless connection (`:128`), and the module recovery scripts aren't in this snapshot, so I can't confirm the replay matches.
- **Uncontrolled differences:**
  - There is no saved-inactive comparison.
  - It is one sample, while the doc says handle identity includes the work process (`:222-224`).
  - It measures seconds after activation, while the only 423 came about four minutes later (fixture `04:52:30`, recovery directory `04:56:33`). This is a difference, not a suspected cause.

**Fix:**
- Run LOCK, the nine requests, then LOCK first. Run the control and step-wise pass only if those handles differ.
- Record a per-step context-equality boolean.
- Record status and an allow-listed exception type for refused LOCKs.

### 10. Medium: this orchestration has never run
**Where:** the whole candidate; compare `native-function-contract-run.ts:1`

- **Coverage:** only `tsc` covers it, and no test references it. Top-level code with a hard-coded path leaves no way to mock it.
- **Why it matters:** reading isn't enough for signal paths, or for whether `.ts` and `.js` specifiers load one module instance, which the context and lock WeakMaps depend on.

**Fix:** move measurement and the cleanup gate into a module that takes its dependencies, then rehearse against the mock with rows for:
- success, a changed control, repeat LOCK 403, LOCK 5xx, and a nonlocal lock
- a read failure, UNLOCK failure, and close returning `false` or `undefined`
- a signal before LOCK, mid-measurement and before DELETE
- hash drift, an extra tree child, a group DELETE 423, an untyped 404, and a suffix in the inactive list
- an assertion of zero module DELETEs across all rows

### 11. Low: gate and evidence details
- **`candidate:160`:** `result.ok` allows recovery `sessionClosed: undefined` (`src/adt/pinned-delete.ts:185-198`, `http.ts:337`). Require `=== true` before `cleanupConfirmed`.
- **`candidate:65-67`, `:76`:** capture drops the media-type and 1 MiB checks from `native-contract-inventory.ts:82-88`. Reuse them.
- **`candidate:91-94`, `:120`:** a LOCK refused locally, for example on an expired deadline, is labelled `unknownDiagnosticLock` although nothing was sent. This fails closed but gives false evidence. Clear `pendingLock` on `AdtRequestNotSentError`.
- **`native-contract-transport.ts:214` with `candidate:128`:** before the fixture is ready, the probe writes `stage: 'request', method: 'DELETE'` before the inner proxy refuses it. Searching receipts for DELETE therefore gives false positives, so pair each with its `AdtRequestNotSentError` row or refuse in an outer layer.

## Do the claimed restrictions hold?

| Claim | Verdict | Where |
|---|---|---|
| Explicit flag before credentials | Holds | `:22-23` |
| Exact clean revision and workspace | **Partly:** binds the directory, not the loaded code | `:25-30` |
| MARIAN/001 and approved HTTPS origin | Holds | `:31-33`, `:50` |
| Fresh random names, private fsynced receipts | Holds | `:34-38`, `:43-48` |
| Executes once | **Does not hold** | Finding 6 |
| Probe DELETE recursively refused | Holds on the wire; receipts mislead | `:127-134` |
| Ready only after active-source proof | Holds | `:47`; runner `:253` |
| 19 resources; owner, package, marker, tree | Holds by reading; exact tree not replayed | `:51-79` |
| LOCK control, nine steps, stop at first change | Holds | `:101-118` |
| Emits only equality and shape | Holds for the value; the observer also writes a private SHA-256 of the LOCK body | `:96`; transport `:223` |
| No source PUT or module DELETE in measurement | Holds | `:84-85`, `:112-118` |
| Finite budgets, fresh UNLOCK policy, bounded close | Holds | `:86`, `:122`, `:143-145`; `mutation-http.ts:41-46` |
| Unknown, nonlocal or recorded locks block recovery | Holds | `:97`, `:120`, `:148` |
| "Known unlock" | **Overstated:** only the latest handle is unlocked, and a 2xx doesn't prove release | `:122` |
| Optional explicit cleanup; signals stop it | **Does not hold** | Finding 8 |
| 19 hashes rechecked under group and pool locks | Holds | `:151-155`; `pinned-delete.ts:129-161` |
| Typed 404s and clean inactive list | Holds, with the Finding 11 close gap | `:160-171` |
| Probe stays failed, no qualification claim | Holds | `:176` |

I found no path to mutating a foreign object, sending a module DELETE, or writing a handle value or credential to receipts or stdout.

## Diagnostic design: GO/NO-GO

**NO-GO for these bytes.** The request bounds are good, but the once-only rule, code binding and operator stop are not in place, and nothing has executed. The direction can proceed once Findings 6 to 11 are corrected and the exact corrected bytes are re-reviewed. Changing tracked files also changes the revision constant.

**Prerequisites before any run, none needing a SAP request:**
1. **Read-only source answers:**
   - Does a repeat LOCK recompute the handle from the current enqueue, or return a held value?
   - Does it add to a lock count, or can SAP refuse it?
   - What are the timestamp's resolution and the work-process part of the identity?
   - Do LOCK and the DELETE check derive the value the same way?

   If the handle is held in the session, or a repeat LOCK is refused by design, drop this method.
2. **Replay on the retained `9E54…` receipts:**
   - The exact four-member tree at `candidate:72-74`. `native-contract-inventory.ts:51-52` tolerates 2 to 3 pre-child members, so `SAPL…` isn't guaranteed.
   - Raw-hash stability under lock.
   - The connection and order of all nine requests.

   A mismatch here would use up the single run and strand the fixture.
3. **Recovery plan:** a written, separately reviewed cleanup for preserved fixtures. The script must never be rerun to clean up.

**Limits that remain after correction:**
- The run sends no module DELETE, so it can't show what the DELETE check would do.
- It is one sample, on one system, in the activated state only.
- Stateless reads and timing differ from the historical flow.
- The inventory doesn't read other-language texts, documentation or enhancements, which a group DELETE may also remove. It is acceptable only for a random-named fixture this run created seconds earlier. The foreign-screen evidence is mock-only.
- A SIGKILL can leave a lock until the SAP session expires.
- Release after a changed handle rests on session close, with the group LOCK as a backstop.
- It qualifies nothing, and whole-group cleanup has one authored success.

**How to read each outcome, fixed in advance:**

| Result | Supports | Does not support |
|---|---|---|
| Repeat LOCK refused, nonlocal or unknown | The method is unusable; the fixture stays | Anything about reads |
| Control changed | Repeat LOCK itself changes the handle | Anything about reads |
| Handle changed after step k | The first inequality observed after that sequence | Step k alone, activation, or the 423 as its effect |
| All equal | The LOCK-visible handle was stable in this sequence | Reads are harmless, or any cause for the 423 |

## Next implementation steps

1. Answer prerequisite 1. It can end this design without any SAP request.
2. Run the receipt replay in prerequisite 2.
3. Fix Findings 6 to 11 and add the mock rehearsal.
4. Fix Findings 1 to 5. These change tracked files, so rebind the candidate to the new revision.
5. Re-review the exact bytes, then execute at most once, and only on a GO.
6. Read the result with the table above. Make no production lock change until there is evidence of a cause.
7. Continue the open scope:
   - function activation and admission, and activated-module deletion
   - DDIC, CDS and SDO; RAP and batches
   - package, API and publication; CTS
   - runtime trace and quickfix; classic FLP
   - resource policies
   - current-byte two-writer and recording-transport PP qualification

Missing implementation here is not evidence of backend non-support.

## Checks and snapshot integrity

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged**, 4,474 files, revision `0bf538a3…` |
| `npm exec -- tsc --noEmit -p review-input/operator-actions/tsconfig.json` | **Pass**, no errors |
| `npm exec -- vitest run --silent=true` | **Pass:** 474 of 474 files, 12,775 of 12,775 tests, 35.94 s |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 by my count, covering older families only |
| `npm run typecheck` | **Pass:** all three projects |
| `npm run check:sizes` | **Pass:** 952 files, all 12 schema scenarios |
| `node --import tsx docs/research/broader-pinned-pp-writes/source-parse-benchmark.mts` | **Ran once:** three samples, lint not blocked, 147 ms lint at 5,000 FORMs, RSS 201,310,208 bytes |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged**, 4,474 files; nothing was read after it |

`prior-verbatim-verdict.md`, its committed copy and the doc's cited hash all match `9c824ae0…`. `followup.diff` and `authored.diff` have the same hash, so I read that content once, in full.

## Evidence limits

- **Live coverage:** no run covers these bytes. PP remains at `77e41fdcd`, which is not current-byte evidence.
- **Author-reported, unavailable here:**
  - all native receipts and the vendor inspection
  - the nine-request comparison and the CI audit
  - the absence of both fixture pairs, and the absence of cloud changes
  - build, lint, policy and strict docs, which aren't allowed commands
- **CI target:** the three FUNC DELETE 200s are on a4h-2025, so they don't resolve a4h/001.
- **Not executed:** integration and e2e changes, and the candidate.
- **Diff completeness:** I have no `fd447841` bytes or history. The manifest proves these bytes, not that `followup.diff` is the complete delta.
- **Dependencies:** I didn't read undici or `tsx`, so their behaviour rests on executed rows or remains an open rehearsal item.

## Deviations

- **Refused read:** one `Read` of `pinned-function-owner.ts` omitted `source/` and pointed outside the snapshot. The harness refused it and returned nothing, and I repeated it with the correct path.
- **Saved output:** Vitest's output exceeded the display limit, so I searched my own saved copy, as the rules allow.
- **Parallel reads:** `Read` and `Grep` calls ran alongside the middle checks, but never alongside either verifier run. Bash commands ran one at a time in the foreground.
- **Child processes:** Vitest's refusal tests started the existing CLI, which refused before any SAP request, and its loopback servers ran as approved.
- **Otherwise none:** no edits, installs, delegation, native or operator scripts, mutants, ad hoc scripts, direct git, pipes or background shells.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so max effort rests on the launcher.
