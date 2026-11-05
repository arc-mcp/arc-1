# PR #1142 at `e2b08f3d`: review 23 closures and native readiness

## Verdicts

**(a) Development checkpoint: accepted, with 0 High, 0 Medium and 4 Low new findings.** All eight review 23 findings are closed, and all approved checks pass. No `src`, schema, dispatch, Git or plugin file changed.

**(b) One-run native workflow: ready for exactly one invocation at `e2b08f3d984f8cd84a30038f74820932db36cf1a`.** This holds only if the GET-only preflight passes and the SM12 controls below are met. I found no path to a false pass, an unsafe mutation or a leaked secret. None of the four Low findings needs a byte change before the run, and fixing any of them now would void this acceptance. Native compilation stays unproven by design.

**GET-only preflight: ready to run now, separately, at the same commit.** It can repeat because it uses fresh names and consumes no claim.

**Public surface:** every public function and declarative mutation stays closed. A pass would not justify enabling any private route, and it isn't public admission. The full PR scope and current two-writer and recording-transport qualification remain incomplete, so this is no whole-PR merge readiness claim.

## Findings

All four are Low. Fix them in the next byte change, not before this run.

### 1. `absence-owner-present` can name the wrong cause
- **Where:** `scripts/qualification/pr1142/native-declarative-evidence.ts:168-182`
- **Scenario:** a non-throwing, non-200 answer on an absence read, such as a 204 or a manually handled 3xx, is labelled `absence-owner-present`. `metadata-status` and `source-status` already make this distinction elsewhere.
- **Consequence:** it fails closed and the journal row keeps the status, but the reason claims presence that nothing showed.
- **Remedy:** refuse any status other than 200 with `absence-not-typed` and that status, and add a row for it.

### 2. The README result table has gaps
- **Where:** `scripts/qualification/pr1142/README.md:282`, `:285`
- **Scenario:**
  - `delete-not-sent` has no row, though `pinned-declarative-qualification.test.ts` shows it after guard refusals.
  - The `stopped` row says `cleanupNotAttempted` lists skipped owners, but bases skipped by closure aren't listed (`README.md:285`; the `stop-guard` test in the diff at `followup.diff:2711-2712`).
- **Consequence:** an operator could read an unlisted base as cleaned. README section 5 already says to trust `remaining` and `inspectionRequired`, so the risk is misreading only.
- **Remedy:** add the row and correct the wording.

### 3. A preflight configuration refusal drops the field names
- **Where:** `scripts/qualification/pr1142/native-declarative-preflight.ts:74`, `:91-93`; `README.md:216-218`
- **Scenario:** a bad `.env` gives only `configuration-env-invalid`, whereas the one-run entry also records `invalidFields`. A new checkout may also have no `.env`, and the README doesn't say how one should get there.
- **Consequence:** a little extra diagnosis, with no SAP request and no claim consumed. The preflight still catches the fault safely before the run.
- **Remedy:** record `invalidFields` and `mutationAttempted: false`, and state where `.env` comes from.

### 4. The post-run SM12 check searches by suffix only
- **Where:** `README.md:265-266`
- **Scenario:** native lock arguments for these five types have never been observed. A truncated or differently keyed argument would not match the suffix search.
- **Consequence:** a remaining lock could be missed.
- **Remedy:** add a user-wide capture. Condition 5 below does this without changing any bytes.

## Review 23 closures

| # | Item | Status | Basis |
|---|---|---|---|
| 1 | Rejected-read evidence and reason codes | **Closed** | Reads are recorded before any check (`native-declarative-evidence.ts:54-77`). Retained bodies stop at 1 MiB, and larger ones keep size and hash. Untyped errors keep only a hash, and the inventory is hash-only on every path. The rows assert exact reasons, and the four negative receipts still reach a confirmed create. The one reason-code gap is Finding 1. |
| 2 | Operator procedure | **Closed, with Findings 2-4** | The README has the exact commands, runtime rules, SM12 controls, stop rule, pass definition, result table and leftover rule. |
| 3 | Under-lock, later-receipt, deadline, binding and label regressions | **Closed** | Faults appear only after the prior check, on the independent connection. The rows reach the DELETE guard (`refusals('DELETE', …)`), the pre-LOCK read and the post-activate read. The binding rows use the real entry map. |
| 4 | Stop after guard reads | **Closed** | `native-declarative-driver.ts:85`. The stop is raised during an independent read under the lock, so the row reaches this recheck. No DELETE goes out and UNLOCK still does. |
| 5 | Own UNLOCK on binding failure | **Closed** | `driver.ts:71-75` validates first, then exempts only the exact owner, method and two-key query. Twelve negative shapes pass, and session close stays outside the validator. `binding-delete` stops at the validator (`:74`), so the guard's own check (`:78`) has no separate row. That leaves no exposure, because the validator runs first on the same request. |
| 6 | Mutation, absence and cleanup results | **Closed** | `createNeverSent` needs both no observed POST and adapter state `unchanged`, and the observer refuses any other create path. A 503 or 409 stays pending, and `delete-rejected` stays uncertain. `confirmedDeleted` needs the adapter's `deleted` plus a fresh typed 404. A pass still requires six completed owners and both absence checks. |
| 7 | Inherited runtime, entry and post-claim issues | **Closed for these entries** | Realpath-aware start, CA, `NODE_PATH` and `TSX_*` refusals before any claim, and a journaled post-claim configuration result. Unchanged historical bytes are in the assessment table. |
| 8 | Typo | **Closed** | `docs/research/2026-11-02-pinned-declarative-sources.md:91` |

## Harness assessment

| Area | Result |
|---|---|
| **Preflight is GET-only** | **Sound.** Only a path-checked, bound `get` survives past client construction (`native-declarative-preflight.ts:84`). A real `AdtClient` over a mocked wire makes exactly 7 GETs and nothing else. `noReplay` turns off auth, CSRF, negotiation and transient retries, and redirects stay manual. |
| **Preflight state** | **Sound.** It has its own directory and a fresh suffix for each sample, and it never touches the one-run claim. A failed binding check sends no request. |
| **Observation secrecy** | **Sound.** Every qualification scenario sweeps the journal for handle, context ID, password and binding text. Credential rows store field names only. I found no observed inventory read in the private write path. |
| **Unknowns preserved** | **Sound.** No error is treated as absence, and only a typed 404 with no domain classification counts. An unavailable independent read keeps the owner in `remaining`. |
| **Shared runtime** | **No regression.** `native-lock-binding.ts` gained only an injectable state parent and a map entry, and its defaults are unchanged. `native-observed-http.ts` isn't in the delta. |
| **Historical bytes** | **Unchanged.** The manifest shows `native-function-contract-run.ts` at `4d56a68b…`, `native-lock-workflow.ts` at `e9cfa459…` and the lockfile at `bc795f70…`, matching the earlier reviewed values. |

## Conditions for the one run

1. **Checkout:** use a clean detached checkout at the exact commit, with no later commits and no local edits. Meet README lines 209-219, including a real `node_modules` from this lockfile and a private output file.
2. **Preflight:** run it and continue only on `failure: false`, every owner `typed-absent`, and inventory `valid-without-suffix`. Any other row means stop and inspect. Any code change needs a new review.
3. **Before the run:** in a freshly confirmed read-only SM12 session, capture zero locks for `MARIAN` in client `001`. Confirm the claim directory doesn't exist.
4. **The run:** one invocation of the exact README command, with no other activity on the fixtures. Stop only with one SIGINT or SIGTERM, then wait.
5. **After exit:** capture a fresh all-tables suffix search **and** a fresh `MARIAN`/`001` user-wide search. Never use SM12's delete action.
6. **Pass:** `failure: false` and `cleanupUnconfirmed: false` in `result.json`, plus zero locks in both searches.
7. **Anything else:** preserve receipts and inspect read-only. Any further mutation needs its own reviewed recovery. Never reuse or remove the claim.

**Bytes this applies to:**

| File | SHA-256 |
|---|---|
| `native-declarative-contract.ts` | `52b99141…7512` |
| `native-declarative-preflight.ts` | `6bba7dec…d24e` |
| `native-declarative-driver.ts` | `2c43cd71…f349` |
| `native-declarative-evidence.ts` | `b1e8c6ba…b17b` |
| `README.md` | `0de95d03…c9cd` |

## Checks

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first) | **Unchanged:** `e2b08f3d…`, 4,562 files |
| `npm exec -- vitest run --silent=true` | **Pass:** 502 of 502 files, 13,518 of 13,518 tests |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 scenarios, none exercising this harness |
| `npm run typecheck` | **Pass:** all three projects |
| `npm run check:sizes` | **Pass:** 986 files, 12 schema scenarios |
| `python3 review-input/verify-snapshot.py` (last) | **Unchanged:** `e2b08f3d…`, 4,562 files; nothing read after it |

The manifest confirms the prior report's hash `e8ad9e7a…`, for both the committed copy and the review input.

## Limits

- **Nothing here touched SAP:** I didn't run the harness, the preflight or any probe, and I didn't open `probe.mts`.
- **Native evidence on these five types is still GET-only.** Create, lock, save, activate, delete, the draft state link, typed 404, preaudit and UNLOCK after DELETE are mock-only on these types.
- **First-run stops:** typed-absence variants, a fixture compile error, the draft state-link shape, base metadata after child activity, and UNLOCK after DELETE could each stop the run. They fail closed and leave a recorded reason, but apart from typed-absence variants, which the preflight screens first, they would consume the claim. A stop answers the native question only as far as that point.
- **Reasoned, not run:**
  - The CLI start through a symlink (tested through its helper only).
  - Run time, including the Git checks on each request.
  - The guard-removal checks are author-reported, and I ran no mutants.
- **Not fully reviewed:** `ARC1_LOG_HTTP_DEBUG` isn't refused by the runtime check. Audit events pass through `redactAuditEvent`, but I didn't read that function or test debug mode, so keep this variable unset.
- **Author-reported only:** build, lint, policy and strict docs. I saw no CI status for this commit, so check it before the run.
- **Dependencies:** third-party installed bytes aren't attested.

## Deviations

- **Check batching:** my first `vitest` run shared a batch with a `Glob` of `review-input`, which broke the rule that each check runs alone. The Glob only listed filenames, and the later checks each ran alone. Snapshot verification stayed unchanged.
- **Refused reads:**
  - A `manifest.json` read was over the size limit and returned nothing, so I only searched it.
  - A `Read` that omitted `source/` pointed outside the snapshot and was refused with no content.
- **Saved output:** Vitest output (2.4 MB) went to `~/.claude/projects/…/tool-results/bafrrd02a.txt`. I only searched it, and one search matched an unrelated log line.
- **Historical and input files:** I read the earlier function-run review, its procedure section and the historical entry only to check for regressions. I also read `verify-snapshot.py` without changing it.
- **Dependencies:** approved checks load `node_modules` at runtime, but my own reads stayed out of it.
- **Otherwise none:** no edits, report files, delegation, mutants, installs, git, or SAP, browser or other network activity.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so HIGH rests on the launcher.
