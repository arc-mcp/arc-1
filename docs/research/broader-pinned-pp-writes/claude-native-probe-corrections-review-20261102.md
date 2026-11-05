# PR #1142 at `5704f92b`: the native probe can run once, under the conditions below

**Decision: go for one run** of the bounded native function probe, at exactly `5704f92b88793752fa2a48ff5a0b3ed6bcea83e6`. This isn't whole-PR acceptance or PP qualification, so the PR stays draft and FEAT-93 stays open. I sent nothing to SAP.

- **Findings:** no High, no Medium, 4 Low. None of them blocks the run, and I recommend not fixing them first, because any code change needs another review.
- **Corrections:** all nine hold. Corrections 5 and 7 and the additional author bug have Low remainders.
- **Checks:** every allowed command passed, including 12,730 of 12,730 Vitest tests. This confirms the author's counts for tests, harness simulations, TypeScript, sizes and schemas.
- **My earlier miss:** my tenth review allowed a run while the parent-delete bug was present. The author found it, not me. This go also rests on reading and simulations, with no native evidence.

**Severity:** Medium means a missing safety control or a wrong conclusion on the proposed run. Low means an edge case, hardening, a test gap or a doc gap.

## Findings

All four come from reading. I didn't execute reproductions because ad hoc scripts and mutants were barred.

### 1. Low: a module that vanishes without an uncertain write doesn't protect its parent
**Where:** `scripts/qualification/pr1142/native-function-contract-run.ts:259`, `:224`

- **Trigger:** a module with a confirmed receipt returns a typed 404 that this run's DELETE didn't cause. For example, it disappears before update preflight, or the read at `:224` after a confirmed save returns 404. That read sits outside the new `catch` at `:187-209`, so the claim that failed post-write snapshots are preserved holds only inside `action()`.
- **Mechanism:** nothing was attempted (`writeAttempted` is false), or the save was already confirmed, so `preserve` never runs. `absent` then continues, and the group proceeds to its guard.
- **Impact:** if the guard passes, the group is deleted and the result shows `failure: true`, `inspectionRequired: []` and `cleanupUnconfirmed: false`. Only this run's random-named group can be lost, and it must be byte-identical to its baseline with the module gone from the tree. The cost is lost evidence and an unflagged oddity, which is why it's Low.
- **Fix:** at `:259`, if `receipts.has(path)`, call `preserve(path)` before `continue`. Add a runner row.

### 2. Low: the most likely function stop point has no runner test
**Where:** `native-function-contract-run.ts:187-209`; `tests/unit/scripts/pr1142-native-runner.test.ts`

- **Trigger:** a post-create `snapshot` failure, such as the module's `?version=active` read returning 404. The runner's faults are limited to `unknown-create`, `delete-rejected`, `guard-read-denied`, `active-drift`, `foreign-screen` and `unknown-save-*`.
- **Impact:** by reading, this path preserves both fixtures and sends no DELETE. No committed test exercises it, though this is a realistic first-run outcome.
- **Fix:** add a row that asserts zero DELETEs and `inspectionRequired: [module, group]`.

### 3. Low: session close bypasses the response cap and the journal
**Where:** `src/adt/http.ts:317-325`, `:336-357`

- **Trigger:** `closeStatefulSession` calls `this.get` on the raw client, so its options carry no `responseBudget` and the observing proxy never sees it. A large body on `GET /sap/bc/adt/core/http/sessions` is buffered whole by `response.text()`.
- **Impact:** memory is bounded only by the 30-second deadline. This is the one control response outside the claimed cap, and only `sessionClosed` is recorded. It's a small endpoint on your own A4H.
- **Fix:** add an optional response budget to the `cleanup` argument and pass it from the pinned path.

### 4. Low: the embedded-URL scrub can leave part of a password
**Where:** `src/server/audit.ts:533`, `:503-529`

- **Trigger 1:** a relative path containing `https://u:p@ss@host/x`. `[^/@\s]+@` stops at the first `@`, so `ss@host` survives. The older `sanitizeText` route parsed this shape with `new URL` and removed all of it.
- **Trigger 2:** an absolute URL with another URL embedded in its path or query. The `try` branch never scrubs it. This predates the correction.
- **Impact:** a narrow logging leak for these shapes only. The probe's paths carry no userinfo, so the probe is unaffected.
- **Fix:** for candidates found in the fallback, match up to the last `@` before the next `/`.

## The additional author bug: fixed for the reported path

The bug is real, and the fix is correct for that path.

- **Pre-fix behaviour, by reading the diff:** a PUT 503 blocked only the module, and the module's typed 404 skipped its cleanup. The group then passed its guard and was deleted, leaving empty lists and `cleanupUnconfirmed: false`.
- **Post-fix behaviour, executed:** both runner rows pass with real shared handlers and zero DELETEs. `inspectionRequired` stays `[module, group]` even when `remaining` is empty.
- **Not verified:** the author's pre-fix run sending one group DELETE. The diff supports it.

| Failure path | Parent outcome | Evidence |
|---|---|---|
| Module creation unknown | Blocked, `pendingCreation` set | Executed |
| PUT 503 | Blocked | Executed |
| PUT redirect, response-limit or network failure | Blocked (`writeAttempted`) | Reading |
| Failed snapshot inside `action()` | Blocked | Reading (Finding 2) |
| Unknown LOCK, failed UNLOCK or failed session close | Blocked, plus `cleanupIssues` | Reading |
| Module DELETE rejected or refused before send | Blocked | Executed |
| Module DELETE unconfirmed or absence not proven | Blocked | Reading |
| Activation failure, unknown result or non-success result | Both blocked | Reading |
| Proof mismatch or failed read at `:224`, module still exists | Goes through the receipt-checked delete guard | Reading |
| Module vanishes with no uncertain write | **Not blocked** | Reading (Finding 1) |

**Final reporting:** it's conservative, because any blocked path sets `cleanupUnconfirmed` and exits 1. It's understandable with one gap: `inspectionRequired` lists paths but not reasons, so the reasons are in the private receipts.

## Dispositions of the eight prior findings

"Executed" means the test ran and passed at this revision.

| # | Correction | Disposition | Evidence |
|---|---|---|---|
| 1 | Copied-tree test | **Closed** | Executed: `node_modules/pr1142-root-check-*` is created, the CLI refuses with `REAL_GIT_WORKSPACE_ROOT_REQUIRED`, and the directory is removed. The final verifier found no residue |
| 2 | Parser overlap | **Closed** | CR, U+2028 and U+2029 rows executed, and the test file took 149 ms. By reading, `\s+` and `\S` can't overlap, and captures on trimmed valid input don't change. The author's stall wasn't run; my pre-fix estimate is about 2×10¹⁰ steps |
| 3 | Delete journal | **Closed** | Executed: four rows assert no top-level `phase` or `state`, and the nested result is still present |
| 4 | Unknown LOCK | **Closed** | Both lifecycle rows executed: no mutation, no UNLOCK, and the right `unknownLocks`. Legacy gating at `crud.ts:205` is by reading. The mocked test's "no redirect follow" assertion can't fail on its own, but real-wire refusal is executed at `request-attempt-budget.test.ts:42` and `:214` |
| 5 | Audit credentials | **Closed, remainder Finding 4** | Regression executed. There's no recursion, since `sanitizeUrl` never calls `sanitizeText`. The unanchored regex is quadratic, but inputs are capped at 500 characters, and only audit output changes, not the wire path |
| 6 | Near-expired DELETE | **Closed** | Executed at 20,000, 55,000, 55,001 and 61,000 ms. The outer deadline and attempt allowance are retained, and a refusal is labelled `refused-before-send` |
| 7 | Response cap | **Closed, remainder Finding 3** | Loopback 200 and 500 rows executed: one send, no response row, no body in the journal. Tighter-budget retention, weak-policy refusal and the shared object all executed. The loopback body is 160 bytes, so early cancellation of a large body is by reading only |
| 8 | Doc wording | **Closed** | Both statements now match the code. The report hash `43b6f5f0…` matches the manifest for both copies, and the verifier checked the bytes |

## Other assessments

**Budget interactions, by reading unless noted:**
- **CSRF:** probes now read their bodies under the budget instead of discarding them. This also closes my earlier concern about a GET 200 without a token, because the legacy fallback can proceed again. A HEAD 400 means discovery is downloaded and counted. Repo docs put full discovery at about 300 KB, and I didn't measure A4H.
- **Over-limit responses:**
  - LOCK: recorded as unknown.
  - PUT: stays unknown and blocks the parent.
  - DELETE: stays `delete-unconfirmed`.
  - UNLOCK: recorded as a failure.
  - Guard read: the DELETE is refused before send.
- **`noReplay`:** it disables retries before any budget logic, so none of the above causes a resend.
- **Normal path:** no probe path supplies a weaker budget, and the runner's success row confirms this in execution.

**Security, by reading:** the new code adds no headers, cookies, LOCK bodies or handles to receipts. Redirect `Location` headers aren't recorded.

**Regression note:** LOCK 3xx and response-limit results now add `cleanupUnconfirmed` to pinned results. This is additive and needs the pending PP requalification.

## Native probe: go/no-go

**Go for one run at `5704f92b88793752fa2a48ff5a0b3ed6bcea83e6`.**

The stated limits don't block it:
- **Scope:** mutations are limited to the two random names and the pool's LOCK/UNLOCK, with `$TMP` checked on creation and readback.
- **Activation:** confirmation is blocked twice. A first preaudit may itself execute, and its result then goes through the same guards.
- **Incomplete inventory:** it's acceptable because the fixtures are random-named and any visible change stops deletion. It doesn't prove an empty workbench or a residue-free system.

### Conditions
1. **Exact SHA:** run the README command with this SHA from the clean real checkout, not this snapshot. The CLI compares HEAD only to its argument, so tying the run to this SHA is up to you.
2. **Plain environment:** `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS` must be unset, because the guard doesn't refuse preloads or extra CAs.
3. **No changes first:** any byte change needs a narrow re-review.
4. **Read the result correctly:** `inspectionRequired`, `pendingCreation` and `cleanupIssues` are open items even when `remaining` is empty. Also read the receipts whenever `failure` is true, even if every list is empty (Finding 1).
5. **One attempt:** don't rerun to force cleanup, and plan to remove any leftovers manually. Crash or storage failure has no recovery guarantee.

### Expected stop points
Each of these preserves fixtures. The first two leave you with no PUT evidence.

| Stop point | Effect |
|---|---|
| Group readback or any of the 15 baseline reads fails, such as a 404 on an active version or pool part | Group preserved, no module created |
| Module `?version=active` read returns 404 | Both preserved, no PUT |
| Source proof rejects a native rewrite of the saved source | Both preserved after the PUT |
| Group guard or pool state refuses deletion | Module may be removed, group preserved |

## Checks and snapshot integrity

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged**, 4,466 files, revision `5704f92b…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 474 of 474 files, 12,730 of 12,730 tests, 36.15 s |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59, covering older families only |
| `npm run typecheck` | **Pass:** all three projects |
| `npm run check:sizes` | **Pass:** 952 files, all 12 schema scenarios |
| `node --import tsx …/source-parse-benchmark.mts` | **Ran once:** three samples, lint not blocked, 140 ms lint at 5,000 FORMs, about 200 MB RSS |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged**, 4,466 files; nothing was read after it |

## Evidence limits

- **Not verified:**
  - any native SAP behaviour or real A4H response shapes and sizes
  - the private GET captures and the author's standalone reproductions
  - the pre-fix failures the author reported for the seven loopback cases, the parser stall and the group DELETE
- **Author-reported only:** build, lint, policy, strict docs and the completed CF/BTP/SAP cleanup.
- **Simulated only:** new rows are authored simulations or loopback. Historical harness scenarios don't cover the new families.
- **Live coverage:** PP artifact `77e41fdcd` doesn't cover these bytes.
- **Still open:**
  - remaining object types and DDIC/RAP
  - activation and batches
  - packages, API and publication
  - CTS, trace/quickfix and FLP
  - resource policies
  - fresh two-writer and recording-transport qualification
- **Excluded or mutation-free:** Git and custom plugins stay excluded. Aggregate, Basic, Copilot, read-only apps and destinations must stay mutation-free.
- **Dependencies:** undici's source isn't readable here, so replay and redirect conclusions rest on loopback tests. The CLI records the lock hash but doesn't attest installed dependency bytes.
- **Coverage:** I read all of `followup.diff` and the changed source and tests, but not `review-input/authored.diff`. The manifest proves these bytes, not the original history.

## Deviations

- **Refused reads:** two `Read` calls omitted `source/` from the path (`README.md`, `create-request.ts`). The harness refused both and returned nothing, and I repeated them with the correct path.
- **Saved output:** Vitest's output exceeded the display limit, so I searched my own saved copy of it, as the rules allow.
- **Child processes:** Vitest's credential-free startup-refusal tests ran the CLI without a SHA, and its loopback servers ran as approved. No SAP request was sent.
- **Otherwise none:** no edits, installs, delegation, native or operator scripts, mutants, ad hoc scripts, direct git, pipes or background shells.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so "max" is unconfirmed by me.
