# PR #1142 at `1bb2eb43`: go for one new native probe

**Decision: go for one new run** of the bounded native function probe, at exactly `1bb2eb43b2627890c1789c27b3f09a8a0f2b8fe7`, with a fresh random `ZARC1_NG_`/`ZARC1_NF_` pair. This isn't whole-PR acceptance or PP qualification, so the PR stays draft and FEAT-93 stays open. I sent nothing to SAP.

- **Findings:** no High, no Medium, 5 Low. None blocks the run. Don't fix them first, because any byte change needs another review.
- **Padding change:** bounded. It ignores only leading empty body lines and isn't broad whitespace folding.
- **Prior findings:** all four are closed. Three have Low remainders (Findings 2, 3 and 4 below).
- **Checks:** every allowed command passed, including 12,744 of 12,744 Vitest tests.
- **Most likely surprise:** the run may stop right after the comparison passes, because of an unstripped `etag` (Finding 1). That stop is safe, but it leaves fixtures to recover. A private-receipt check before the run shows whether the post-save stop will happen.
- **My earlier misses:**
  - Finding 1 was already present at `5704f92b`, and I didn't flag it.
  - Finding 2 comes from the fix I recommended last time, and I didn't warn about the proxy path.

**Severity:** Medium means a missing safety control or a wrong conclusion on the proposed run. Low means an edge case, hardening, a test gap, a doc gap, or a change that doesn't touch this run.

**Evidence labels:**
- **Read:** I read the code and nothing ran.
- **Authored capture:** author-supplied native bytes, exercised locally.
- **Executed:** a test ran here at this revision against mocks or loopback, never native SAP.

## Findings

All five come from reading. I executed no reproductions, because ad hoc scripts and mutants are barred.

### 1. Low: metadata receipts hash a timestamp-bearing `etag`
**Where:** `scripts/qualification/pr1142/native-contract-transport.ts:107-112`; used at `native-contract-inventory.ts:106-111`, `:122` and `native-function-contract-run.ts:125`

- **Evidence:**
  - The committed A4H capture `tests/fixtures/extensions/source/func-metadata-a4h.xml:1` has `changedAt="2004-05-18T17:38:50Z"` and `etag="200405181738500011"`, so the etag embeds the same timestamp.
  - `contractMetadataHash` strips only `adtcore:version` and `adtcore:changedAt`, yet its comment says version and timestamp changes are tolerated.
  - No test metadata contains an etag (`pr1142-native-contract.test.ts:98-104`, `pr1142-native-runner.test.ts:44`).
- **Trigger A:** the module's `?version=active` etag changes across the PUT. This comparison has never run natively, because the first run stopped before it. The run then stops at `native-contract-inventory.ts:111`, before preaudit.
- **Trigger B:** the first preaudit executes activation, so the timestamp moves and the delete guard at `native-function-contract-run.ts:125` refuses.
- **Impact:** it fails closed, with no extra mutation and no false pass. Both fixtures stay for recovery, and Trigger A also loses the preaudit evidence. I can't tell whether either trigger happens, because the capture is a different, long-active module.
- **Fix:** don't widen the guard before this run. Use the private-receipt check in the conditions below. If native evidence calls for it, handle `etag` explicitly later, correct the comment and add a native-shaped test.

### 2. Low: pinned session close leaves the kept proxy client on Connectivity routes
**Where:** `src/adt/mutation-http.ts:38`, `src/adt/http.ts:1500-1502`

- **Trigger:** any pinned mutation through `btpProxy`. Production forward requests carry no `responseBudget` (`src/handlers/pinned-operation.ts:34-38`), so they share the kept client. The close now always has a budget, so it gets a `new Client`.
- **Conflict:** this contradicts `src/adt/http.ts:4`, `:185` and the #807 note in `docs_page/release-notes.md:256`, which says one client is kept "including the closing request".
- **Test gap:** the socket tests use legacy sessions only (`proxy-response-lifecycle.test.ts:148-188`). A search found no test file combining `btpProxy` with the pinned-mutation entry points.
- **Impact:**
  - **This probe:** none, since it's direct Basic with no proxy (`native-function-contract.ts:93-100`).
  - **PP:** this is an unqualified wire change. If the close fails on the new connection, a saved write reports failure (`pinned-source-write.ts:70-73`). The kept client still stays open during the close, and budgeted reads already use separate connections, so I expect it to work, but that isn't proof.
- **Fix:** before PP qualification, pin the chosen behaviour with a pinned-proxy loopback test, correct the comments, and require `sessionClosed: true` in the fresh PP run.

### 3. Low: the audit scrub regressed for malformed URLs with `?` or `#` in the password
**Where:** `src/server/audit.ts:504-507`, `:538`

- **Trigger:** `https://user:pa?ss@host/x` or `https://user:pa#ss@host/x`, including when embedded in a relative path.
- **Mechanism:**
  - The new pre-parse regex stops at `?` or `#`, so it doesn't match.
  - By my reading of URL parsing rules, `new URL` then throws because `pa` isn't a port. I didn't execute that.
  - The old `catch` scrub, whose character class allowed `?` and `#`, is gone, so the whole string survives.
- **Impact:** a narrow logging leak that the previous code prevented. The wire path is unchanged, and the probe's paths carry no userinfo. The malformed test at `audit.test.ts:152` doesn't cover this shape.
- **Fix:** restore a textual scrub in the `catch` branch, such as `/([a-z][a-z\d+.-]*:\/\/)[^/\s]+@/gi`, and add both shapes as test rows. Over-redacting a malformed URL is acceptable. The email guard is unaffected, because that URL parses.

### 4. Low: an unexpected absence doesn't set `failure`, and its row is untested
**Where:** `scripts/qualification/pr1142/native-function-contract-run.ts:259-268`

- **Trigger:** both owners return typed 404 at cleanup with no earlier failure, or this run deletes the module and the group then returns typed 404 before its own DELETE.
- **Impact:** the result shows `failure: false`, `remaining: []`, and a non-empty `inspectionRequired` with `cleanupUnconfirmed: true`. The exit code is still 1 (`native-function-contract.ts:111`), so careful reading reaches the right conclusion.
- **Test gap:** the doc says the run records `unexpectedAbsence`, but only the runner and the doc contain that string. Removing the `record` call wouldn't fail a test.
- **Fix:** set `failure = true` in that branch and assert the row.

### 5. Low: remaining test and evidence gaps
- **Native-shaped source in the runner:** the mock stores the request body unchanged (`pr1142-native-runner.test.ts:122`), so `native-function-contract-run.ts:188-225` has never run against padded, CRLF or lowercased source. By reading it compares GET to GET, so I don't expect a defect.
- **Fixture hash:** no test checks `readbackSha256` (`function-source-a4h-readback.json:8`), and I couldn't compute it here.
- **Missing rows:** a whitespace-only leading line, padding counts other than three, and an oversized close at runner level.
- **Fix:** add these rows with the next code change.

## Prior findings

| # | Prior finding | Disposition | Evidence |
|---|---|---|---|
| 1 | Module vanishes without an uncertain write | **Closed, remainder Finding 4** | Executed: both rows assert zero DELETEs and `inspectionRequired: [module, group]` |
| 2 | Post-create active 404 has no runner test | **Closed** | Executed: both paths retained, zero DELETEs |
| 3 | Session close bypasses the response cap | **Closed for direct routes, remainder Finding 2** | Executed against mocked fetch with the real streaming cap: a 65,537-byte close gives `sessionClosed: false`, keeps the saved result and sends one close |
| 4 | Embedded URL scrub leaves part of a password | **Closed for the reported shapes, remainder Finding 3** | Executed: three shapes and the email guard |

**Close interactions, by reading unless noted:**
- **Budget path in the probe:** the observer forwards `cleanup` unchanged (`native-contract-transport.ts:156-164`), so the budget reaches the raw close.
- **CSRF:** the close sends GET, then HEAD, and neither fetches a token.
- **Fallback:** a 404 falls back to HEAD under the same 64 KiB and deadline.
- **Closed cookie:** cookies are stored at the headers boundary (`http.ts:1383`). An over-limit body with `sap-contextid=0` therefore still reports closed, which is correct, but it has no test.
- **Redirects:** these are refused and report `false`.
- **Failure reporting:** `sessionClosed: false` reaches `cleanupIssues` and blocks the parent (`native-function-contract-run.ts:160-167`).
- **Weak policies:** these are refused before a session exists (executed).
- **Independent-close test:** it can only detect a shared budget, not a missing cap. The oversized row covers the cap.

**Audit, by reading:** nested URLs with percent-encoded userinfo still aren't scrubbed. The doc says "plain" nested URLs, so its wording is accurate.

## New padding assessment

The change is `.replace(/^\n+/, '')` on the body after CRLF normalization (`src/adt/function-source-proof.ts:20`, `:56`). Both the requested and stored sources pass through it.

| Shape | Result | Evidence |
|---|---|---|
| Captured PUT response, three empty lines, final CRLF | Accepted | Executed on an authored capture |
| Captured GET, no final CRLF | Accepted | Executed on an authored capture |
| Internal empty line removed | Refused | Executed |
| First body line's indentation changed | Refused | Executed |
| Missing boundary, foreign name, code outside the function, false `ENDFUNCTION`, oversize | Refused before PUT | Executed |
| Any other number of leading empty lines, including zero | Treated as equal | Read; tests only use three |
| Whitespace-only leading line, trailing empty lines, lone CR or U+2028 padding | Refused | Read |
| Leading newline inside a literal or template | Can't occur, because the signature must validate as ending in its only `.` token first (`:30-41`) | Read |

**Resource bounds:** the regex is anchored and linear on input already capped at 1 MiB, and it adds no parser work. The test file took 253 ms.

**Limit:** the one native sample shows three lines, and the variable-count explanation is author-reported. The fresh run uses the same signature, so it probably won't test another count.

## Native probe: go/no-go

**Go for one run at `1bb2eb43b2627890c1789c27b3f09a8a0f2b8fe7`.** Mutations stay limited by `checkContractMutation` to the two random names, the pool's LOCK/UNLOCK and one preaudit POST. Confirmation is blocked twice. This go rests on reading and simulations, with one authored capture and no native run of these bytes.

### Conditions
1. **Exact SHA:** from the clean real checkout, not this snapshot, run:
   `node --import tsx scripts/qualification/pr1142/native-function-contract.ts --execute-reviewed-revision 1bb2eb43b2627890c1789c27b3f09a8a0f2b8fe7`
2. **Plain environment:** `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS` must be unset.
3. **No byte changes:** any change needs a narrow re-review.
4. **Check private receipts first; this makes no SAP call:**
   - Compare the first run's post-create active metadata with the recovery's post-save active metadata. If `etag` differs, this run will stop at Trigger A, which doesn't withdraw the go.
   - Check that the recovery's `?version=inactive` source hash equals `600d083d…`. If it differs, expect the hash stop in the table below.
5. **Read the whole result:** `failure`, `remaining`, `pendingCreation`, `cleanupIssues`, `inspectionRequired` and `cleanupUnconfirmed`. Treat exit 1 as open even when `failure` is false, and search the receipts for `unexpectedAbsence`.
6. **One attempt:** don't reuse or retry the old run for cleanup, and don't rerun to force cleanup. Preserve changed or unconfirmed resources, and plan a separately bound recovery. Crash and storage failure have no recovery guarantee.

### Expected outcomes
The comparison has passed once the FUNC update journal row shows `state: saved-inactive` (`native-function-contract-run.ts:177-182`). Later stops don't undo that observation.

| Point | Effect | Fixtures |
|---|---|---|
| Comparison refuses another native shape | `source-save-unknown`, no DELETE | Both preserved |
| `?version=inactive` hash differs from the adapter's GET (`:193`) | Stops before preaudit | Both preserved |
| Active metadata or etag changed (Finding 1, Trigger A) | Stops before preaudit | Both preserved |
| Preaudit returns an expansion | References recorded, no confirmation, cleanup runs | Deleted if guards pass |
| Preaudit executes activation (Trigger B) | Result recorded, delete guard probably refuses | Probably both preserved, and recovery differs from last time |
| Preaudit errors, has an unknown shape or lacks execution evidence (`:243-246`) | Both blocked | Both preserved |
| Close reports false, for example over 64 KiB | `cleanupIssues` set | Preserved; A4H's close size is unmeasured because the observer can't see it |

A clean result covers this protocol path at these bytes only. It doesn't qualify whole activation, public function admission or PP.

## Documentation audit

- **Matches what I ran:** 474 files, 12,744 tests, 59 simulations, three TypeScript projects, 952 files and 12 schema scenarios.
- **New test count:** the 14 new tests in the diff equal the author's 9 plus 5, and take the total from 12,730 to 12,744.
- **Report hash:** `9165eef3…` matches the manifest for both `review-input/prior-verbatim-verdict.md` and the docs copy.
- **Failure and recovery records:** the failed run stays recorded as failed, recovery is recorded separately, and qualification gaps are retained. The stale line at `2026-11-02-native-probe-review-followup.md:11` sits under a new historical banner.
- **Consistent by reading, not executed:** the nine pre-fix failures. The five extra tests aren't all claimed to pass pre-fix, and the weak-policy rows couldn't have.
- **Gaps:** the doc row on close omits the proxy effect (Finding 2), and `unexpectedAbsence` is untested (Finding 4).
- **Vendor code:** `CL_FB_FUNC_SOURCE_CONVERTER` appears only as a name in the protocol doc. That fits "not copied" but doesn't prove it.

## Checks and snapshot integrity

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged**, 4,469 files, revision `1bb2eb43…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 474 of 474 files, 12,744 of 12,744 tests, 35.73 s |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 by my count, covering older families only |
| `npm run typecheck` | **Pass:** all three projects, no errors |
| `npm run check:sizes` | **Pass:** 952 files, all 12 schema scenarios |
| `node --import tsx docs/research/broader-pinned-pp-writes/source-parse-benchmark.mts` | **Ran once:** three samples, lint not blocked, 142 ms lint at 5,000 FORMs, about 202 MB RSS |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged**, 4,469 files; nothing was read after it |

## Evidence limits

- **Author-reported, unavailable here:**
  - everything about the first native run, its receipts and the recovery
  - the converter inspection and its hash
  - the captured fixture's origin
  - build, lint, policy and strict docs
  - the absence of cloud, destination or role changes
- **Simulated only:** new rows use mocked fetch or authored responses. Historical harness scenarios don't cover the new families.
- **Live coverage:** no run covers these bytes, and PP artifact `77e41fdcd` doesn't either.
- **Dependencies:** I couldn't read undici's source, and I didn't read `@abaplint`, so lexer behaviour rests on executed rows.
- **Still open:**
  - function activation and admission
  - DDIC, CDS and SDO
  - RAP and batches
  - packages, API and publication
  - CTS, trace/quickfix and classic FLP
  - resource policies
  - fresh two-writer and recording-transport PP qualification
- **Excluded or mutation-free:** Git and custom plugins stay excluded. Aggregate, Basic, Copilot, read-only apps and destinations must stay mutation-free.
- **Coverage:** I read all of `followup.diff`, the changed source and tests, and the dependencies cited here. I didn't read `review-input/authored.diff`, and I read `audit.ts` and `create.ts` only in the relevant ranges. The manifest proves these bytes, not the original history.

## Deviations

- **Refused read:** one `Read` of `audit.ts` omitted `source/` from the path. The harness refused it and returned nothing, and I repeated it with the correct path.
- **Saved output:** Vitest's output exceeded the display limit, so I searched my own saved copy, as the rules allow.
- **Child processes:** Vitest's startup-refusal tests ran the CLI without a SHA and without credentials, and its loopback servers ran as approved. No SAP request was sent.
- **Otherwise none:** no edits, installs, delegation, native or operator scripts, mutants, ad hoc scripts, direct git, pipes or background shells.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so the launcher's max effort is unconfirmed by me.
