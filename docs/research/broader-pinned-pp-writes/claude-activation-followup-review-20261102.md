# PR #1142 at `0b0649e8`: continue development, with no High or Medium findings

**Decision:** continue from this checkpoint. The PR stays draft and FEAT-93 stays open. This isn't whole-PR acceptance or a live artifact freeze.

- **Findings:** no High, no Medium, 6 Low. I found no false success, foreign-object activation, write-scope widening or public route to the function candidate.
- **Prior findings:**
  - Closed offline: M1 (activation path), L2, L3, L5, L7 and L8.
  - Mostly closed: L9.
  - Deliberately open: L4 and L6.
- **Checks:** all allowed commands passed, with 447 files and 12,277 tests. The snapshot was unchanged at the first and last verifier runs.
- **How findings were reached:** by reading code, tests and repo evidence. Ad hoc scripts were barred, so **I executed no failing case for any finding**.
- **Next steps:** Findings 1 and 2 are small and should go in the next checkpoint. Findings 4 and 5 must be fixed before function admission. L6 still blocks public admission.

## Findings

### 1. Low: "SAP may still finish this activation" can be reported when no activation is pending
**Where:** `src/adt/devtools.ts:250`, `:265-266`, `:270-272`, `:499-505`; `src/adt/pinned-text-pool-activation.ts:45-48`; `src/adt/pinned-text-pool-completion.ts:47-48`; `src/handlers/write/pinned-result.ts:92-98`.

**Cause:** `rethrowOrLockHint` tags any network, 429 or 5xx error inside the `try` as `activationOutcome: 'unknown'`. That `try` also covers `beforeSubmit` and the second `validateReferences`. `pinnedFailure` now prints the tag as fact. The legacy hint says "If activation was submitted", but the new text has no such condition.

**Triggers:**
- **Pinned `SAPActivate`:** SAP returns a preaudit prompt, then a validation read gets a 5xx, 429, network error or cancellation. The confirming POST is never sent. `tests/unit/handlers/pinned-program-activation.test.ts:211-226` reaches this path but doesn't assert these fields.
- **Pinned text:** an abort or deadline lands between the last preflight read and `beforeSubmit`. `submitted` is false, so the error is rethrown with state `text-saved-inactive`, alongside `activationOutcome: 'unknown'`.

**Impact:** the state and recovery fields can contradict each other, and the caller is told to wait for work that was never started. There is no false success. This is new here, because `pinnedFailure` previously ignored the tag.

**Fix:** tag only failures of the `http.post` calls. Add negative assertions to the cancellation row, plus a text row that cancels before submit.

### 2. Low: SAP text still reaches a "safe" message under minimal errors through package-hierarchy failures
**Where:** `src/adt/package-hierarchy.ts:225-230`; `src/adt/safety.ts:304-309`; `src/handlers/write/pinned-result.ts:69-70`; `src/adt/pinned-delete.ts:169`.

**Trigger:** a subtree rule such as `ZROOT/**`, plus a `nodestructure` failure with SAP text in its body.

**Impact:**
- `hierarchyFailure` copies `AdtApiError.message`, including SAP's text, into an `AdtSafetyError`, and pinned results return that verbatim.
- This narrows the claim that the safe message never embeds SAP text: it holds for activation evidence, not for this path.
- It goes to the same mapped user and widens no write scope.
- It predates the diff, and legacy has the same exposure (`src/handlers/dispatch.ts:388-402`).

**Fix:** keep the root and status code, and drop the SAP text. Add a sentinel row in both minimal modes. No test currently reaches either message.

### 3. Low: LOCK outcomes have classification edges (L5 follow-on)
**Where:** `src/adt/crud.ts:83-89`, `:187-197`, `:201`; `src/adt/pinned-write-policy.ts:189-190`; `src/adt/http.ts:381-385`.

| Trigger | Result | Assessment |
|---|---|---|
| LOCK returns 200 without a handle | `state: unchanged`, no UNLOCK, no `lockOutcome` | Possibly held lock isn't flagged |
| LOCK returns 200 with `modificationSupport=false` | A 423 is thrown and the handle dropped, with no UNLOCK or flag | Possibly held lock isn't flagged. Only a failed session close would reveal it |
| LOCK aborted while queued on the semaphore | Reported as "may hold a lock", though nothing was sent | False alarm, but harmless |

**Fix:** record `unknownLocks` when a 2xx LOCK leaves no usable handle or is refused after success. Treat the queued case as a wording matter unless the HTTP layer can report "not sent".

### 4. Low (private; blocks admission): metadata-only creation can't pass the result boundary
**Where:** `src/handlers/write/pinned-source-write.ts:62-63`; `src/handlers/write/creation.ts:43-44`; `src/handlers/write/function-create-membership.ts:38`; `src/handlers/write/pinned-result.ts:42-59`.

**Trigger:** wiring the factory into `handlePinnedSourceWrite`.

**Impact:**
- A successful metadata-only create sets state `created`, then fails with "The source edit did not confirm a source save."
- `state.functionGroup` is never serialized, so the parent hash and reference never reach a caller.
- Tests stop at `writeActionCreate` and inspect internal state, so they can't see either problem.

**Fix:** add an explicit `created` result and return `functionGroup`. Run the candidate rows through the real boundary.

### 5. Low (private; blocks admission): unsupported function input is silently ignored
**Where:** `src/handlers/write/pinned-function-context.ts:50-58`; `src/handlers/write/create.ts:615-623`, `:684`; `src/handlers/write/update-delete.ts:134-137`.

**Trigger:** any of these inputs:
- FUGR or INCL `create` with `parameters`, `processingType` or `updateTaskKind`
- FUNC `update` with `processingType`
- `delete` with `source`

**Impact:** the operation can succeed without applying the input. Public field lists prevent this today, but one shared row covering several types would not.

**Fix:** add a per-type, per-action allowlist in the factory or in `accepts`, with refusal rows like `tests/unit/handlers/pinned-delete.test.ts:75-99`.

### 6. Low: remaining test gaps
- **Lock tracking:** `unknownLocks` is only asserted in `tests/unit/handlers/pinned-text-pool.test.ts:645-648`. No row covers:
  - the delete surface (`src/adt/pinned-delete.ts:199-208`)
  - an additional lock (`src/adt/crud.ts:232`)
  - refusal on `unknownLocks` or `unlockFailed` (`crud.ts:169`)
- **Text preflight:** the inner gate at `src/adt/text-elements.ts:228-231` is shadowed by admission, and no row calls it directly.
- **Creation branches with no row:**
  - the uncertain POST (the `create-uncertain` branch at `tests/unit/handlers/pinned-function-create.test.ts:85` is dead)
  - a rejected POST
  - allowed-to-allowed parent drift (`src/handlers/write/creation.ts:104-105`), because `ZDENIED` at test line 106 fails earlier in `checkPackage`
  - recording drift (`creation.ts:115-116`)
  - post-create parent drift and oversized parent source (`src/handlers/write/function-create-membership.ts:20-21`, `:27-30`)
  - candidate prefix refusal (`src/handlers/write/pinned-function-context.ts:68-73`)
- **Weak fixture:** LOCK and child GETs succeed before the POST (`pinned-function-create.test.ts:89-98`, `:108`, `:126-128`), so creation order isn't enforced.
- **Over-claiming row:** `pinned-function-create.test.ts:250-257` names creation but checks only PUTs. It uses `.every`, which passes on an empty list, and doesn't assert `isError`.
- **Smaller items:**
  - a bare `rejects.toThrow()` remains at `pinned-text-pool.test.ts:318`
  - the 5-entry and 500-character bounds in `src/adt/activation-evidence-error.ts:11-19` have no row

## Prior finding dispositions

| Prior finding | Disposition | Evidence |
|---|---|---|
| M1: minimal-error bypass | **Closed for pinned text**, follow-on in Finding 2 | `ActivationEvidenceError` carries a fixed message. Minimal mode returns only `nativeActivation.success`, with sentinel rows for native errors and unconfirmed warnings. Recovery failures record labels only |
| L2: recovery replacing the failure | **Closed offline**, follow-on in Finding 1 | Traced below |
| L3: unverifiable input saved first | **Closed offline** | Admission and the shared profile both refuse before HTTP. `pinned &&` guards the shared check and the comparator is pinned-only, so legacy input is unchanged |
| L4: arbitrary include names | **Open by design** | The row and docs are correct. A ref with no `type` also passes on an exact include URI (`src/handlers/write/pinned-activation.ts:46-47`), which the row doesn't cover. I'm not proposing a stricter rule without native capture |
| L5: lost LOCK | **Closed offline**, follow-ons in Findings 3 and 6 | Both lock paths share `acquire`. Results carry SM12 guidance, later sessions refuse, and failed close stays sticky. In pinned mode `release` doesn't throw, so the initial error isn't masked. Legacy mode skips the tracking and keeps its old unlock precedence |
| L6: FUNC signature readback | **Open; blocks public admission** | The mock still echoes PUT bytes. The same strict readback (`src/handlers/write/pinned-source-lifecycle.ts:62`) also applies to private FUNC creation with parameters |
| L7: FUGR main source | **Closed offline** | Update, surgery and source-bearing create refuse before SAP. Only the factory selects FUGR |
| L8: dormant creation | **Closed offline**, follow-ons in Findings 4 to 6 | Creation is exercised, cleanup failures stop later steps, the context is asserted, reads are uncached, and the prefix logic is shared |
| L9: test gaps | **Mostly closed**; the rest are in Finding 6 | The listed rows exist. One bare `rejects.toThrow()` remains |

### M1 scope notes
- **Pinned `SAPActivate`:** it doesn't pass `minimalErrors`, so strict-evidence failures keep SAP text in `nativeActivation`. General `SAPActivate` also returns activation messages in minimal mode (`src/handlers/activate.ts:438`, `:445`), so I didn't count this.
- **Optional flag:** `minimalErrors` in `pinnedFailure` shows diagnostics when omitted, so any future caller that omits it fails open.
- **Evidence still dropped:**
  - HTTP-level activation rejections return only a status code, in both modes.
  - The 5-entry bound can drop an error that follows five warnings.
  - The status-only result matches other pinned failures, but it does narrow "detailed mode retains diagnostics".

### L2 paths traced
| Path | Result |
|---|---|
| Native success | Both reads run, then `text-saved-active` |
| Native rejection | Fixed message; native text only in detailed mode; observations kept |
| Lost response or 5xx | `text-activation-unknown`; original status kept; recovery warning shown |
| Failed observation | Activation failure wins; failed reads are listed by label |
| Observation failure after native success | The read error is returned, with `nativeActivation.success: true` |
| Already unlocked | Owner and pool are revalidated before submit; later reads are read-only under the original budget |

## Requested assessments

- **Private creation:**
  - **Ownership and package:** the fresh parent, both package ceilings and the CTS recheck all run before the POST. The group is reread after creation, and a child mismatch is caught under its lock.
  - **CTS:** a selected task resolves to its parent request, which is used on the POST and PUTs.
  - **Partial state:** `createdOwner` and the `created-*` states are preserved. Failed cleanup stops later steps.
  - **Membership:** it needs exactly one INCLUDE statement, and the parent source is never written. The repo's #904 note records automatic insertion on 7.50 and 758, with a `SAPLX…` exception that would correctly end as partial creation.
- **Legacy equivalence:** by reading, the new branches are guarded by mutation mode. `verifyCreatedSource` returns immediately in single-target mode, and the prefix helper matches the old logic.
- **Exposure:**
  - The diff touches no `src/server` file.
  - The capability table has no FUGR or FUNC row, and `group` isn't admitted.
  - `createPinnedFunctionContext` has no production caller.
  - Public create requires non-empty source, so it can't reach metadata-only verification.
- **Security:** I found no new authorization bypass. `verificationFailures` and `unknownLocks` contain only labels, statuses and selected URIs.
- **Performance:**
  - 5,000 FORMs took 63 ms to splice and 138 ms to lint at about 202 MB RSS, in line with the last run. The benchmark doesn't cover the new paths.
  - Text preflight adds linear parses, bounded at 1 MiB, and completion adds no requests.
  - By my reading, a local metadata-only INCL create takes about 14 requests, plus any CSRF fetch, CTS inspection and subtree lookups.

## Checks and snapshot integrity

Each Bash command ran alone and in sequence.

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first) | **Unchanged**, 4,350 files, revision `0b0649e8…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 447 files, 12,277 tests, 33.73 s |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59. These cover older families only |
| `npm run typecheck` | **Pass:** all three projects, no diagnostics |
| `npm run check:sizes` | **Pass:** 912 files, all 12 schema scenarios within budget |
| `node --import tsx …/source-parse-benchmark.mts` | **Ran once**, three samples, lint not blocked |
| `python3 review-input/verify-snapshot.py` (last) | **Unchanged**, 4,350 files; nothing was read after it |

The hash the follow-up doc gives for my previous report (`5e3e4df7…`) matches both the committed copy and `review-input/prior-verbatim-verdict.md` in the manifest.

## Evidence limits

- **Not verified:** the private GET-only activation framework inspection and its hashes, and any native SAP behaviour. I made no SAP, CF, browser or external network request.
- **Author-reported only:** build, lint, the 135-entry policy check, strict docs, the seven failing assertions and the restored cloud and SAP state.
- **Live coverage:** run `77e41fdcd` doesn't cover these bytes. Mutation rows use authored fixtures.
- **Native unknowns still open:**
  - pool activation's real response body and class-pool references
  - post-delete UNLOCK statuses and controlled active/inactive text selection
  - FUNC signature normalization and main-source version selection during membership checks
  - native creation and processing side effects
  - two-writer PP and recording-transport behaviour
- **Text preflight:** it checks structure only. An accepted input that SAP normalizes, such as a short key, can still end as `text-saved-unverified` after the PUT.
- **Remaining scope:** other object types, DDIC/RAP, batches, package/API/publication, CTS, runtime trace/quickfix, FLP and resource policies remain unfinished. Git and custom plugins stay excluded.
- **Snapshot:** the manifest proves these bytes, not that `followup.diff` is complete, and there's no history. I skipped diff lines 151-374, the committed copy of my prior report, whose hash matches.

## Deviations

- **Refused read:** one `Read` left out `source/`, pointed outside the working directory and returned nothing. I reread the file at the correct path.
- **Outside the working directory:** only `Grep` of my saved Vitest output, which you allowed. That `Grep` ran alongside the qualification command, but no two Bash commands overlapped.
- **Internal Git:** `verify-snapshot.py` runs `git ls-files`. I ran no direct git.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so "max" is unconfirmed by me.
- **Otherwise none:** no edits, installs, delegation, operator scripts, mutants, background shells, pipes or ad hoc scripts.
