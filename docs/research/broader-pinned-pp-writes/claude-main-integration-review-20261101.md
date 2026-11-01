# PR #1142 at `92dc1a71`: retain, and run a fresh PP attempt after access cleanup

**Retain this revision.** A fresh controlled include PP run is justified once the IAM/XSUAA rollback is finished and a new artifact is deployed. This isn't merge approval: the PR stays draft and the include family isn't qualified.

- **Findings:** no safety defect and nothing High or Medium, but seven Low findings. Fix findings 1 and 2 before the run, because they decide whether a repeat failure can be diagnosed.
- **Prior findings:** all seven are closed for what they asked, with the limits listed below.
- **Integration:** I found no regression on the pinned paths, and pending capabilities stay denied. Merged `main` does change one pinned behaviour (finding 3).
- **Not verified:** `npm run check:sizes` couldn't run here, so file and schema budgets are author-reported only.
- **Wrong input:** `merge-resolution.diff` isn't the merge resolution.

## Before the run
1. **Access:** finish the IAM/XSUAA rollback, or carry the original before-state forward, and baseline from that. Close finding 4 in the same record, then apply temporary access under a new rollback ledger.
2. **Harness:** fix findings 1 and 2. Reviewing just that diff is enough.
3. **Artifact:** the earlier reuse of the `00dde0613` artifact (attempt summary `:168-173`) no longer applies, because this merge changes shipped `src/` files. Build from the final revision, verify the bytes and record the droplet.
4. **Binding:** create new run and fixture manifests from a clean checkout. `run-manifest.mjs:53-61` refuses a changed harness or source.
5. **Host:** prevent sleep during the run and save the power log for that window. This removes a variable without assuming a cause.
6. **Stop rule:** if the same step fails again, recover and stop. Finding 5 must be handled before any recovery; a preserved fixture can wait.

## Findings
Harness files are under `scripts/qualification/pr1142/`, and operator records are under `review-input/operator-evidence/`.

### 1. Low: diagnostics are proven only for a rejected `fetch`
- **Response reads:** no test or simulation reaches `safe-io.mjs:217`; a search for its code and for stream-failure setups finds nothing. The live transport is SSE (`pp-testclasses-initialization-rpc.json:20-22`), so a mid-stream failure lands there. Classification of a timeout on that path is unproven.
- **Timing values:** tests only assert `>= 0` (`tests/unit/scripts/pr1142-harness-safety.test.ts:54-55`). By trace, constant zeros stay green, yet timing is what the failed run lacked.
- **Masking:** if the receipt write fails at `mcp-checks.mjs:49`, that error replaces the transport error, leaving `UNEXPECTED_FAILURE`. This still fails closed.
- **Fix:**
  - Add a loopback test that sends SSE headers and part of a body, then once stalls and once destroys the socket.
  - In the timeout case, assert elapsed is close to `timeoutMs` and that `startedAt` parses.
  - Don't let a failed receipt write replace the original error.

### 2. Low: an unlisted cause code looks like no cause
- **Gap:** `safe-io.mjs:17-33,58` leaves out `ENETUNREACH`, `EHOSTUNREACH`, `ENETDOWN`, `EADDRNOTAVAIL`, `ECONNABORTED`, `EPROTO`, `UND_ERR_CLOSED`, `UND_ERR_DESTROYED`, `HPE_*` and `ERR_SSL_*`.
- **Effect:** these record `causeCode:null` and `unclassified`, the same blind spot prior finding 1 targeted. The allowlist itself is right and nothing leaks.
- **Fix:** add these codes, and record a fixed `OTHER` when a code exists but isn't listed.

### 3. Low: merged `main` removes the pinned CSRF 503 retry
- **Change:** `src/adt/http.ts:1100` now honours `retryTransientErrors:false`, which every pinned request sets (`src/adt/mutation-context.ts:64`, `src/adt/crud.ts:127`). At `b7fa68830`, a CSRF `HEAD` 503 retried once.
- **Effect:** one 503 now ends the write at `http.ts:1156`. Before the lock it reports `unchanged`, accurately; on create it reports `creation-unknown`, conservatively (`pinned.ts:120`).
- **Coverage:** the branch is tested only through discovery (`tests/unit/adt/ddic-extension-transport.test.ts:340`); the pinned path is read only.
- **Decision:** keep it, because it fails closed. A one-off 503 can now stop a live run, and it's a different failure from `HTTP_REQUEST_FAILED`.

### 4. Low: the SAP access record doesn't say whose definition it shows
- **Matches:** role, validity and profile match the earlier before-state (`formatter-pp-2026-11-01.json:313-318`).
- **Gap:** `definition` (`sap-access-restored.json:15-112`) grants `S_DEVELOP` 01/02/03/06/07 but names no role or user. The only role listed is `Z_ARC1_WG_RO`, described as display-only (`formatter-pp-2026-11-01.json:307`).
- **Likely reading:** it matches the temporary role's described grants (`docs/research/2026-11-01-broader-pinned-pp-writes-pp-qualification.md:28-32`), so it's probably `Z_ARC1_PR2_TEST`. The record doesn't establish that.
- **Fix:** label each row, and record `Z_ARC1_WG_RO`'s own definition against its before-state.

### 5. Low: tighten the recovery template when rebinding it
By reading, the write order is right: both comparisons persist before DELETE (`partial-include-recovery-instrumented.mts:67-74,79`). It wasn't executed. When rebinding:
- **Hash the inspection too:** only cleanup records a hash (`:65`). The archived script's mtime (11:09:06, code audit `:5`) is after the inspection (11:08:13), so the retrospective hash can't bind that step.
- **Add run binding:** it has no manifest-hash, `runId` or HEAD check, and it uses plain `readFile` (`:19-20`). Compare `native-fixtures.mts:22,34-39` and `native-fixture-operations.mts:139`.
- **Cover writer B:** `:27,30,44,52` hard-code writer A and `MARIAN`, and writer B is the untested part of the next run.

### 6. Low: only one simulation runs under `npm test`
Vitest runs only `includes-success` (`tests/unit/scripts/pr1142-combined-qualification.test.ts:9`), and no workflow calls `test:qualification:pr1142` (`package.json:109`). The new controls therefore never run in CI. Run the script on the bound revision, and add a CI step when convenient.

### 7. Low: the writes doc contradicts itself
`docs_page/multi-target-writes.md:180` says include editing is refused even on direct calls. `:136-142` and `src/server/pinned-mutation-capabilities.ts:39-42` admit include updates. The PR edited that line to remove "deletes" but left this phrase in.

## Prior findings
| c6d finding | Disposition | Basis |
|---|---|---|
| 1 Medium: transport failure | **Closed for fetch rejection; response read only read** | Real loopback timeout and refused redirect ran, as did injected redaction and observer wiring. By reading, only allowlisted or computed fields are copied. The read-back label is at `include-qualification.mjs:109`. See findings 1 and 2. |
| 2 Low: no offline scenario | **Closed** | `includes-post-save-read-rejection` ran and asserts both hashes on disk, the receipt before cleanup, no later mutation and a preserved fixture (`deletion-regression.mjs:197-213,431-446,602-615`). It rejects at `definitions`, not the live `testclasses`. The journal path is the same, but it isn't an exact replay. |
| 3 Low: recovery not reviewable | **Closed as a published limit, not runtime proof** | The README has the runbook (`:168-173`), and limits are published (attempt summary `:155-156`, research doc `:153-155`). Both script hashes match the manifest, which the snapshot check re-hashes. That can't prove the archived bytes are what ran. |
| 4 Low: reporter test shape | **Closed for the function; worker wiring only read** | `tests/unit/scripts/pr1142-native-fixtures.test.ts:300-322` ran. The wrapper call at `native-fixtures.mts:83` is still never executed. |
| 5 Low: three checks | **Closed** | The two refusal scenarios and the wrong-save-field scenario pin their exact failing checks. The route test message (`tests/unit/server/multi-target-writes.test.ts:109`) matches `pinned.ts:71` and differs from `pinned-operation.ts:33`. |
| 6 Low: wording | **Closed** | All five edits are in. The old phrases survive only in the quoted review and one negated statement. |
| 7 Low: mock shape | **Closed** | Three initial includes (`deletion-regression.mjs:235-239`), stored without the trailing newline (`:18,304`), and only `testclasses` initialized (`:659`). |

- **Original eight findings and L4:** these keep their c6d dispositions, and that review's "by trace" claims remain unexecuted.
- **Historical timing:** the arithmetic is right (954,253, 3,539 and 894 ms). Apart from the journal's `finishedAt`, those timestamps are supplied, because their source receipts aren't in the snapshot.
- **PP initialization:** the `testclasses` `initialized:true` response is now in the evidence, and its hash matches `lastReadBackHash` (attempt summary `:103`).

## Integration with `main`
- **HTTP bootstrap:** `AdtCsrfBootstrapError` extends `AdtApiError` (`src/adt/errors.ts:1068`), so pinned status classification is unchanged. Only discovery code treats it specially. The body-accounting branch needs a `countAllResponses` budget, which only discovery creates.
- **Scoped package options:**
  - `includeGroupHint` is stripped before the SAP request (`src/handlers/write-helpers.ts:942-954`).
  - The pinned resolver copies only deadline and signal (`src/adt/package-hierarchy.ts:40-45`).
  - Callers that add the hint can't reach pinned safety (`src/handlers/write.ts:65`, `src/handlers/activate.ts:115`).
  - Pinned callers still pass `requestPolicy` (`pinned.ts:105`, `pinned-activation.ts:54,61`).
- **Dispatch and read schema:**
  - Harness reads trigger no discovery requests (`src/handlers/extension-read.ts:17-28`), and `extensions` with `editable` is rejected (`src/handlers/extension-input.ts:42`).
  - The new `creationOutcome:'confirmed'` can't be mistaken for `unknown`, because every check uses strict equality.
- **Pending capabilities:**
  - The capability table still admits only CLAS/INTF create, update, `edit_method`, activate and delete, plus formatter settings (`src/server/pinned-mutation-capabilities.ts:25-78`).
  - SHLP has no generic operations (`src/handlers/object-types.ts:442`) and isn't an admitted write type.
  - SHLP and the new read fields do appear on multi-target read surfaces. They are per-user reads, and a search of those adapters finds no data-preview or SQL path.
  - The include row stays admitted because the run needs it, so draft status is what keeps it from shipping.
- **Merged regression coverage:** the per-user session test (`tests/unit/server/http-pp-transport.test.ts:336-338`) and the pinned splice test (`tests/unit/handlers/pinned-writes.test.ts:179`) both ran.
- **Merge resolution:** `merge-resolution.diff:1-7` is `git show 92dc1a711`, the same hunks as `diagnostics-followup.diff`, with no AGENTS hunk.
  - **Confirmed:** both rows survive (`AGENTS.md:210-211`, `pr-against-main.diff:9-11`), and the PR-side `src/` hunks I read show no reverted upstream code.
  - **Still author-reported:** that this was the only conflict.

## Reading the next failure
I couldn't establish here whether `performance.now()` keeps counting through macOS sleep, so equal clocks don't rule out suspension. Better signals:
- `elapsedMs` well above `timeoutMs`
- a long gap between the previous receipt's `at` and `startedAt`

## What this does and doesn't prove
- **Executed here:** unit tests over mocked HTTP and real loopback, and 59 mock-MCP simulations. None of it is live proof.
- **Read, not executed:** the response-read path, the worker's wrapper call, the pinned CSRF change, and every "stays green" claim.
- **Supplied, not run by me:** the timing, the recovery, the stopped harness and the restored permissions.
- **Not established:** the cause of the HTTP failure, or that the recovery comparisons ran. Archived code enforces them, but no runtime observation exists.
- **Not exercised live through PP:** the `testclasses` read after an existing save and everything after it, whole-owner activation with include receipts, writer B, this binding's formatter run, denied-route include calls, and normal delete.
- **External cleanup isn't complete:** IAM and XSUAA rollback is pending, so don't baseline from the current state.

## Tests run
| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` | `unchanged`, 2,600 files, revision `92dc1a71…`, first and last |
| `npm exec -- vitest run --silent=true` | **Exit 0: 422 files, 11,478 tests passed** |
| `npm run test:qualification:pr1142` | **Exit 0: 59 passed** (20 formatter, 39 deletion, including 22 include) |
| `npm run typecheck` | **Exit 0**, all three projects |
| `npm run check:sizes` | **Exit 1, not a budget result:** `git ls-files` needs a repository, and the schema half never started |

- **Counts reconcile:** tests rose from 11,474 to 11,478 (2 loopback, 1 observer, 1 unlock). Simulations rose from 55 to 59, and `includes-success` stays at 255 requests. All of this matches `author-checks.txt`.
- **Budgets:** I hand-counted only the three this merge raised: `tools.ts` 1,784/1,785, `schemas.ts` 1,593/1,593, `http.ts` 1,566/1,566. Everything else, plus lint and strict docs, is author-reported.

## Tool and environment deviations
- **One refused read:** a `Read` that left out `source/` was refused, and I retried inside the root.
- **Files read outside the working directory:**
  - The Vitest output the CLI saved (`tool-results/bxk7wx2m7.txt`), which your exception allows; I only searched it.
  - A saved copy of my own long `Grep` result (the file list of `integration-from-pr.diff`). Your exception doesn't cover this one, and it held only that list.
- **`check:sizes`:** I attempted no workaround, because only the listed commands were allowed.
- **No mutants:** edits weren't allowed, so every "stays green" claim is by trace.
- **Execution:** validation ran one command at a time in the foreground. File reads ran alongside the unit, simulation and size commands. Vitest wrote `test-results/unit.json`, and simulations used temporary directories.
- **Otherwise none:** no git, `ls`, installs, external network, SAP, CF, browser, edits or delegation, and no recovery script was run.
- **Revision identity:** this rests on the manifest label, because the snapshot has no git history.
