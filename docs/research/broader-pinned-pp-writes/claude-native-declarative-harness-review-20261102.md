# PR #1142 at `13f5518a`: review 22 closures and the one-run native harness

## Verdicts

**(a) Development checkpoint: accepted, with 0 High, 2 Medium and 6 Low new findings.** All five review 22 items are closed. The delta changes no `src` file, and all approved checks pass.

**(b) One-run native qualification: not ready, so don't run these bytes.** I found no safety defect. The mutation scope is tight, preservation is conservative, and I found no path to a false pass. The problem is that a claim-consuming run could end with no recorded reason for its most likely stops, and no operator procedure exists for this run. Fix Findings 1 and 2, then have the new bytes reviewed.

**Public surface:** function and declarative routes stay closed. The delta has no dispatch, schema, `src/server`, Git or plugin change, so Aggregate, Basic, Copilot and read-only gain no mutation route. A positive harness result would not be public admission or PR readiness. The remaining accepted families, current two-writer PP and recording transports stay incomplete.

## Medium findings

### 1. Independent receipts keep no evidence when they refuse
- **Where:**
  - `scripts/qualification/pr1142/native-declarative-evidence.ts:24-38`, `:44-47`, `:55-60`
  - `native-declarative-driver.ts:31`, `:44`, `:64`
  - `native-declarative-workflow.ts:65`, `:81`, `:92`
  - `native-declarative-contract.ts:111`
- **Gap:** these reads use the unobserved `base.http`, so they create no request or response rows. Bodies are recorded only after every check passes, and failures keep only `error.name`.
- **Regression:** the function harness read through its observer and recorded the body before checking it. It also kept exception bodies and failure messages (`native-function-contract-run.ts:85`, `:91-103`, `:327`, `:358`).
- **Scenario 1:** the first DDLX, BDEF or SRVD draft returns a relative state link. These types use `./<name>/source/main` for their source links (`review-input/declarative-read-contract/BDEF.json:18`), while `:34` requires one exact absolute string. The journal then shows only `stage: unconfirmed, errorType: Error`.
- **Scenario 2:** a preflight 404 of another type leaves only `errorType: AdtApiError`, with no status or body.
- **Consequence:** the claim is consumed without the native answer the run exists to produce. A later read-only inspection could recover the shape only if the state still exists. The four negative rows also can't assert which check fired.
- **Remedy:**
  - Record status, media type, size, hash and body before the checks, or read through an observer that allows only GET.
  - Keep the typed 404 body.
  - Replace `errorType` with fixed reason codes, and assert them in the tests.
  - Keep the inventory hash-only.

### 2. This run has no operator procedure
- **Where:** `docs/research/2026-11-02-native-declarative-qualification.md:32-34`, `:55-57`; `native-declarative-contract.ts:43`, `:55-62`. `scripts/qualification/pr1142/README.md` has no section for this harness (compare `:214-249`).
- **Scenario:** the claim is created before `.env` is read and before the first GET. A bad `.env`, an unreachable A4H or a typed-absence variant consumes it with no SAP change. Typed absence on these five types is explicitly unqualified (`docs/research/2026-11-02-pinned-declarative-sources.md:116`).
- **Missing:** the exact command, environment rules, a pre-run lock control, a stop rule, a result-reading table and a rule for leftover objects.
- **Consequence:** an avoidable consumed claim, misread results, and no written route for a preserved fixture.
- **Remedy:** add a README section modelled on `claude-active-delete-review-20261102.md:139-190`. The conditions below list what it must contain.

## Low findings

| # | Finding and location | Scenario and consequence | Remedy |
|---|---|---|---|
| 3 | **The under-lock guard and later receipts have no refusal rows.** `native-declarative-driver.ts:39-45`; `tests/unit/handlers/pinned-declarative-qualification.test.ts:176-193`, `:225-237` | By reasoning (no mutant run), an empty guard stays green. Also untested: active-read fallback (`evidence.ts:25`), pre-update and pre-delete drift, a live child under the base lock, `policy()` deadlines (`:27`), the fixture marker labels and the real binding map for this entry. The code is correct by reading, but a later edit could silently remove a control. | Add a row for each, using changes that appear only after the pre-lock check. Add a binding row for this entry. |
| 4 | **A stop isn't rechecked after the guard reads.** `native-declarative-driver.ts:41-44` | A signal during the guard reads still lets DELETE go out, which contradicts `native-declarative-qualification.md:19` and `README.md:246-247`. The function run rechecked (`native-function-contract-run.ts:165-166`). The result still reports stopped and failed. | Recheck `shouldStop()` after the guard reads and add a row. |
| 5 | **A source-binding failure also refuses the run's own UNLOCK.** `native-declarative-driver.ts:35-38` | A Git timeout or a touched checkout while locked throws before the UNLOCK exemption, so only session close releases the lock. It fails closed, but the lock depends on one path. The function validator had no such check. | Skip `verifySource()` for the validated UNLOCK and add a row. |
| 6 | **Final results overstate uncertainty.** `native-declarative-contract.ts:114-120`; `native-declarative-workflow.ts:64`, `:99-103`; `native-declarative-driver.ts:62` | A preflight refusal reports `cleanupUnconfirmed: true` with nothing created. A create refused before POST counts as `pendingCreation` and preserves its base. `remaining` can list an owner that was deleted but whose unlock failed. An inner absence confirmation is overwritten. This is never a false pass, but it invites misreading and unnecessary recovery. | Add `mutationAttempted` and keep the inner result. Use the adapter's `state` for a create that was never sent, and stay conservative on unknowns. |
| 7 | **Review 17 items carried into the copied entry.** `native-declarative-contract.ts:131`, `:55-62`; `native-function-contract.ts:16-24`; `safe-io.mjs:117-128` | A symlinked start may exit 0 silently (Review 17's reasoning, not run). A bad `.env` leaves no journal reason. `NODE_EXTRA_CA_CERTS`, `NODE_PATH` and `TSX_*` aren't refused. `native-function-protocol.md:501-502` requires future workflows to address applicable findings. | Compare against `realpathSync`, journal an allow-listed post-claim reason, and extend the refusal. |
| 8 | **Doc typo.** `docs/research/2026-11-02-pinned-declarative-sources.md:91` | It reads "passes At `246b98b05`". The meaning survives. | Reword it. |

## Review 22 closures

| Item | Status | Basis |
|---|---|---|
| Inactive metadata with active alternative | **Closed** | Five rows at `pinned-declarative-activation.test.ts:437-443` assert `activated`, `previousNativeVersion: inactive` and two POSTs. Removing the `?version=active` branch would now fail them. No native state link has been observed on these types. |
| Recorded public CLAS/PROG and unlocked-group child | **Closed** | `pinned-activation-recording.test.ts:62-80` uses the public handler: stable runs make two POSTs, and a move between allowed requests stops after one with the shared message. `pinned-function-group-activation.test.ts:384-392` reaches the same comparison, not the allow-list. |
| Exact dependency map | **Closed** | `native-declarative-fixtures.test.ts:79-90` pins six owners and four edges in exact order. |
| Both source variants and honest syntax coverage | **Closed** | Twelve rows cover both variants. Only DDLS reaches a parser, BDEF and DDLX get pattern rules, and DCLS and SRVD get string assertions. Both docs now say so. |
| Historical count attribution | **Closed, with Finding 8** | The count is labelled. Attribution to `246b98b05` fits the docs, but I couldn't prove it without Git. The labels on the 85-case and fifteen-check counts are correct. |

**Negative receipt rows:** all four reach a successful adapter create and then refuse (`pinned-declarative-qualification.test.ts:225-237`). The mock changes bytes only after the `create` record, and each row asserts `!result.isError`, a pending create, no activation, no DELETE and no held lock. `source-drift` also has a backstop at `native-declarative-driver.ts:70`, so it doesn't isolate `editableSourceEquals`. No row pins the exact check that fired.

## Harness assessment

| Area | Result |
|---|---|
| Source and claim binding | **Sound.** The order is runtime, binding, claim, manifest, journal, credentials. Only a real clean checkout at the given commit passes, and shadow files and index flags are refused. |
| Signal, deadline, budget | **Sound by reading, untested.** Forward work stops at 8 minutes and cleanup at 12, with 60-second phases and 30-second requests. The 2 MiB limit applies per request or per snapshot, not per run. Cleanup and final absence can add bounded time. See Finding 4. |
| Observation secrecy | **Sound by reading.** Lock handles are removed from labels, LOCK and UNLOCK bodies are excluded, and headers are never captured. Failure results don't include the raw error message that contains the path. No test asserts this for the declarative journal; the shared observer has its own. |
| URI, query and body scope | **Sound.** Requests are limited to the exact owner, collection, query keys, source text, CTS packet and single activation reference. Facade-wrapped traffic and session traffic stay observed. |
| Ownership, active and source receipts | **Sound, with Finding 1.** The active source is independently shown to move from the initial text to the updated text, so an `already-active` label can't fake that transition. |
| Under-lock deletion guard | **Correct by reading**, with Findings 3 and 4. It stays on the base connection, as the function run did. |
| Dependency preservation | **Correct.** An uncertain owner keeps its base, and siblings can still be cleaned. Only fully active-verified owners reach deletion. |
| No replay or retry | **Confirmed by reading.** The workflow doesn't retry, HTTP replay is off, and the only create fallback is for a DTEL media type. |
| Final results | **No false-pass path found.** See Finding 6. |
| Function observer extraction | **No regression found.** The logic moved unchanged, the old exports remain, and there's no import cycle. Its existing tests pass. |
| Cached features | **Not a blocker.** The mock sets features and the real run doesn't, but no fixture trips the 7.5x rules that a missing release activates. |

## Conditions for a later GO

1. Fix Finding 1. Fix Findings 3-5 in the same change, then get a source-bound review of the new bytes.
2. Add the README section with:
   - the exact command: `node --import tsx scripts/qualification/pr1142/native-declarative-contract.ts --execute-reviewed-declarative <sha>`
   - a clean checkout at that commit, no `NODE_OPTIONS` or `GIT_*`, a validated `.env`, an absent claim, and the host kept awake
   - the stop rule, a result-reading table and the pass definition: `failure: false` and `cleanupUnconfirmed: false` in `result.json`
3. Before the run, take a fresh SM12 baseline for MARIAN/001. Add a separately approved GET-only check of typed absence on fresh random names for all five types.
4. After the process exits, run a fresh SM12 search across all tables using the suffix from the manifest.
5. Allow one invocation with no other activity on the fixtures. Preserve any leftover and inspect it read-only; further mutation needs its own reviewed recovery. Never use SM12's delete action.

## Checks

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first) | **Unchanged:** `13f5518a…`, 4,556 files |
| `npm exec -- vitest run --silent=true` | **Pass:** 500 of 500 files, 13,398 of 13,398 tests |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 scenarios, none exercising this harness |
| `npm run typecheck` | **Pass:** all three projects |
| `npm run check:sizes` | **Pass:** 984 files, 12 schema scenarios |
| `python3 review-input/verify-snapshot.py` (last) | **Unchanged:** `13f5518a…`, 4,556 files; nothing read after it |

The counts add up: 13,332 plus 66 new tests equals 13,398, and the author's 13,394 plus four equals the same. The prior report's hash `3968d37f…` matches the manifest.

## Evidence limits

- **Nothing here touched SAP:** I didn't run the harness or any probe, and I didn't open `probe.mts`.
- **Native evidence on these five types is GET-only:**
  - owner paths, roots and native types
  - `text/plain` source reads and explicit version attributes
  - an active read returning `inactive` on the sampled DDLS and SRVD
- **Native evidence from other types only:** absolute state links (FUNC and class fixtures), typed 404s and the inactive list (FUNC family), and a base-connection guard under a lock (one FUNC run).
- **Mock-only on these types:** create, lock, save, activate, delete, draft link shape, typed 404, preaudit URIs, `activationExecuted`, and UNLOCK after DELETE.
- **Grammar:** the abstract BDEF and keyless root entity rest on the `latest` docs, which I couldn't open. Compilation on release 758 remains unproven by design.
- **Stops the first run could hit, all failing closed:** typed absence at preflight, a fixture compile error, a draft link shape, whole-metadata comparison on a base after child activity, and UNLOCK after DELETE. Earlier mid-run stops leave preserved objects, and Finding 1 means little is recorded about why.
- **Reasoned, not run:** every "stays green" claim. Run time also wasn't measured, including the five Git subprocesses per observed request.
- **Author-reported only:** build, lint, policy, strict docs, CI status and absence of native fixtures.

## Execution deviations

- **Extra snapshot check:** I ran the verifier a second time early, in the same batch as a `manifest.json` read. The first and last checks ran as instructed, and the extra one also reported `unchanged`.
- **Refused reads:** two `Read` calls omitted `/source` (`create.ts` and the declarative sources doc), and one `manifest.json` read was over the size limit. All three returned no content. I then read the correct paths and read the manifest only in part.
- **Saved Vitest output:** at 2.3 MB it went to `~/.claude/projects/…/tool-results/b0f1gfwl5.txt`, and I only searched it. One search matched an unrelated log line.
- **Historical material:** I read the function run, its review and its README only to check whether their findings still apply. I read the read-contract receipts and one metadata receipt without running anything.
- **Dependencies:** the approved checks load `node_modules` at runtime. My own reads and searches stayed out of it.
- **Otherwise none:** no edits, report files, delegation, mutants, installs, git, or SAP, browser or other network activity.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so max effort rests on the launcher.
