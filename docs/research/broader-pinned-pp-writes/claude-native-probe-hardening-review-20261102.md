# PR #1142 at `abcb541a`: the native probe can run once, under the conditions below

**Decision:** the bounded native probe can run **once**, at exactly this SHA, under the conditions in the go/no-go section. This isn't whole-PR acceptance or PP qualification, so the PR stays draft and FEAT-93 stays open. I ran nothing against SAP.

- **Findings:** no High, no Medium, 8 Low. None of them blocks the run.
- **Prior findings:** all ten are addressed. Six are fully closed, and four have Low remainders (dispositions 2, 3, 4 and 5). Disposition 7 is closed for proof ordering, but its parser fix is incomplete.
- **Checks:** Vitest **failed one test**, 12,719 of 12,720 passed, because of a missing directory in this snapshot (Finding 1). All other allowed commands passed.
- **How findings were reached:** Finding 1 comes from an executed failure. The other seven come from reading, because ad hoc scripts were barred. Expect a preserved group on the first run, and possibly no function PUT evidence.

**Severity:** Medium means a missing safety control or a wrong conclusion on the proposed run. Low means an edge case, hardening, a test gap or a doc error.

## Findings

### 1. Low (executed failure): the copied-tree test needs a directory that may not exist
**Where:** `tests/unit/scripts/pr1142-native-contract.test.ts:210`

- **Trigger:** any tree without `node_modules/.cache`. `mkdtempSync` fails with `ENOENT` before the child process starts. I can't tell whether a clean `npm ci` tree creates that directory.
- **Impact:** Vitest exits 1 here, and this CLI-level refusal did not execute. This is why I can't reproduce the author's 12,720 of 12,720.
- **What still supports the guard:**
  - `assertWorkspaceRoot` itself passes in `pr1142-harness-safety.test.ts:325-337`.
  - The TLS subprocess test passes, which proves the guard block runs before argument parsing.
  - The call at `native-function-contract.ts:19` is confirmed by reading.
- **Fix:** create the parent directory with `recursive: true` before `mkdtempSync`.

### 2. Low: the parameter regex is still quadratic on some inputs
**Where:** `src/adt/fm-signature.ts:50`, reached from `function-source-proof.ts:23` before the frame budget at `:27`, and from `spliceFmSignature` and `handlers/read.ts:636`

- **Trigger:** a parameter line such as `IV TYPE` + N spaces + `x\ry`. A lone `\r`, `\u2028` or `\u2029` survives the line split and `trim()`.
- **Mechanism:** `.` stops at that character, so `$` fails. `\s+` then gives back one space at a time, and `.+` rescans each time. That's about N²/2 steps, or roughly 2×10¹⁰ at N = 200,000 (my calculation, not run).
- **Impact:** this is the same event-loop stall the fix was meant to close. The new regression rows have no such input. The probe can't send it, because its source is fixed and its readback comes from A4H.
- **Fix:** use `\s+(\S.*)$`, which captures the same text on trimmed input and can't overlap. Add `\r` and `\u2028` rows.

### 3. Low (operator note): delete receipts carry misleading top-level state
**Where:** `native-function-contract-run.ts:172`; `src/handlers/write/owner-delete.ts:10-11`; `src/adt/pinned-delete.ts:41`

- **Trigger:** every delete action. Deletion keeps its state in a local `outcome`, so `PinnedSourceState` never changes.
- **Impact:** a DELETE that was sent, rejected or unconfirmed still journals `state: "unchanged", phase: "validation"` beside a correct nested `result`. Nothing automated reads these fields, and the final outcome is correct, but a person could draw the wrong conclusion.
- **Fix:** omit those two fields for deletes.
- **Workaround without a code change:** read `result.content[0].text` and the `stage` rows.

### 4. Low: a 3xx on LOCK isn't recorded as an unknown lock
**Where:** `src/adt/crud.ts:203-211`; `src/adt/bounded-response.ts:17-29`

- **Trigger:** a LOCK answered with a redirect, which is now refused. It's neither a network error nor a 5xx or 429.
- **Impact:** `unknownLocks` stays empty, so the final result doesn't flag a possible lock. In the probe, a later LOCK conflict would still preserve the fixture, and the session close should clear it. This is improbable.
- **Fix:** treat 3xx as unknown in `acquire`.

### 5. Low: wider audit `path` handling drops one existing scrub
**Where:** `src/server/audit.ts:452`, `:530-542`, compared with `:546-553`

- **Trigger:** a `*path` value that is relative but contains `https://user:pass@host/…`.
- **Impact:** `sanitizeUrl`'s fallback strips userinfo only at the start of the value. `sanitizeText` used to scrub embedded URLs, so such credentials would now survive into logs. I found no production route that builds this shape, because the `uri=` parameters I grepped use `encodeURIComponent`. It doesn't affect the probe.
- **Fix:** run the embedded-URL scrub in the fallback and add a row.

### 6. Low: a DELETE can still start with almost no time left
**Where:** `native-contract-transport.ts:186-187`

- **Trigger:** the guard finishes with a very small part of the 60-second outer deadline remaining.
- **Impact:** the DELETE is sent and then aborted mid-flight. It's correctly labelled `delete-unconfirmed` and not retried, so this fails safe.
- **Fix:** refuse before send below a minimum, such as 5 seconds.

### 7. Low: no byte cap on the native responses
**Where:** `native-contract-transport.ts:90-100`; `src/adt/http.ts:563`

- **Trigger:** an unexpectedly large response. The whole body is buffered before the 1 MiB and 2 MiB checks.
- **Impact:** memory is bounded only by what can arrive within the 30-second deadline. The target is your own A4H, so the risk is low.
- **Fix:** add a single-response limit to `contractRequestPolicy`.

### 8. Low: two follow-up doc statements are overstated
**Where:** `docs/research/2026-11-02-native-probe-review-followup.md:19` and `:32`

- **Parser claim:** line 19 says overlapping parser patterns were removed, but `\s+` and `.+` still overlap (Finding 2).
- **Projection claim:** line 32 says an independent test reproduces why `getFunctionGroup()` missed an added screen. The rows at `pr1142-native-inventory.test.ts:60-84` never call that projection. They only prove the new inventory refuses the screen.
- **Fix:** correct the wording when the code next changes.

## Prior finding dispositions

"Executed" below means the test ran and passed at this revision.

| # | Claim | Disposition | Evidence |
|---|---|---|---|
| 1 | Startup guards | **Closed** | Guards run before `.env` (`native-function-contract.ts:18-19`, `:32-36`). `isNativeContractOrigin` rows and the TLS subprocess test executed. The copied-tree CLI test did not (Finding 1). `dotenv` is imported only by entry points and this CLI, so no `.env` load happens during import |
| 2 | Refusal evidence and labels | **Closed, remainder Finding 3** | `AdtRequestNotSentError` is constructed only inside the pre-send `try` (`native-contract-transport.ts:168-192`). The send is outside it, so a sent request can't be relabelled. The four runner rows executed: changed active source, unexpected screen, guard GET 403, true DELETE 403. The create relabel doesn't check `createdOwner`, but `beforeLock` moves the phase first (`pinned-lock.ts:46-47`), so that case isn't reachable today |
| 3 | Lock-handle redaction | **Closed for the probe, remainder Finding 5** | Audit rows executed, and `input[0]` is untouched on the wire. Printed output, `AdtApiError.message` and failure JSON stay clean by reading |
| 4 | DELETE clamp | **Closed, remainder Finding 6** | The clamp refreshes after the guard, with the same budget and outer deadline. Both rows executed, including refusal before send on expiry |
| 5 | No replay or redirect | **Closed, remainder Finding 4** | All seven loopback cases executed and passed. "Failed on prior code" is unverified. Callers without `noReplay` still use plain `fetch` (`request-attempt-budget.ts:63`). CSRF probes each get their own `sent` flag |
| 6 | Uncertain creation | **Closed** | Pending creation stays explicit and blocks the parent (`native-function-contract-run.ts:163-171`, `:263-270`). No path retries creation. The runner row executed |
| 7 | Proof order and parser | **Proof order closed, parser incomplete (Finding 2)** | The proof runs before the POST (`create.ts:626-627`). Rows executed for no POST and no PUT. Valid signature semantics are unchanged by reading. Malformed `IV) TYPE x` and `VALUE(IV TYPE x` no longer parse, which is acceptable. The old parser's timeout is unverified |
| 8 | Activation wording | **Closed** | `pinned-result.ts:97` is conditional, `devtools.ts:511` was already conditional, and a grep found no other unconditional text |
| 9 | Boundary tests and inventory | **Closed** | The runner imports no credentials, filesystem or process controls. Handler, builder and identity rows and the 64 KiB, zero-PUT, readback and UNLOCK-failure rows executed. The inventory makes 15 reads (1 + 2 × 7). The doc wording issue is in Finding 8 |
| 10 | README | **Closed** | `scripts/qualification/pr1142/README.md:200-201`, `:216` |

## Other assessments

- **Interactions:**
  - The default attempt budget now makes CSRF probes discard their bodies (`http-deadline.ts:35`). A GET 200 without a token would fail with a network error instead of trying the legacy fallback. The repo's recorded evidence says A4H returns a token, so I don't expect this to trigger.
  - The FUGR guard makes at most 18 reads plus the DELETE, within the budget of 32.
- **Regressions:**
  - Pinned PP requests now treat every 3xx as an error. This fails closed, but it is new behaviour that your pending PP requalification must cover.
  - Finding 5 is the only other regression I found by reading. Everything else was covered by the passing suite.
- **Security, by reading:**
  - `baseUrl` is hard-coded, TLS is verified and redirects are refused on every request path.
  - Receipts exclude headers, cookies, LOCK bodies and handles, and the receipt directory and files are owner-only.
  - The diagnostic guard doesn't refuse `NODE_OPTIONS=--require`, `--import` preloads or `NODE_EXTRA_CA_CERTS`, which is why condition 3 below exists.
- **Resource bounds:**
  - Each request is capped at 30 seconds and each action at 60 seconds.
  - There are no loops beyond the two-owner cleanup and the fixed 15-read inventory, and no mutation is retried.
  - The only gap is Finding 7.
- **Exposure:** `createPinnedFunctionContext` still has no production caller, and `AdtRequestNotSentError` is never constructed in `src/`.

## Native probe: go/no-go

**Go for one run** at `abcb541a38d5217f2865fd0d69778b1c7e88fb2d`.

### Why it's sufficiently bounded
- **Scope:** mutations are limited to the two random names and the pool's LOCK/UNLOCK, with `$TMP` checked on creation and readback.
- **Activation:** confirmation is blocked twice, and only a preaudit request can leave the transport.
- **Deletion:** it requires a confirmed create plus unchanged receipts, on the owning session. Groups also need the pool lock.
- **Unknown outcomes:** they preserve fixtures and appear in the final result, which exits 1.

### Whether the stated limits allow it
Yes. The incomplete inventory is acceptable here because this run created the fixture under a 64-bit random name, and any change it can see stops deletion. It doesn't prove an empty workbench or a residue-free system. Typed absence of the owners doesn't cover inactive-list or pool residue. Missing active versions and changed UXX bytes only preserve resources.

### Conditions
1. **Exact SHA:** run the README command with this SHA from a clean real checkout, not this snapshot. The CLI compares HEAD only to its argument, so tying the run to the reviewed SHA is up to you.
2. **No changes first:** any code change, including these fixes, needs a narrow re-review before a run.
3. **Plain environment:** `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS` should be unset.
4. **Read the right fields:** use nested `result` and `stage` rows for delete outcomes (Finding 3), and treat `pendingCreation` and `cleanupIssues` as open items even when `remaining` is empty.
5. **One attempt:** don't rerun to force cleanup. Plan on removing any leftovers manually, because no script does it.

### Expected stop points
Each of these preserves fixtures. The first two leave you with no PUT or activation evidence.

| Stop point | Effect |
|---|---|
| The group readback or any of the 15 baseline reads returns 404 (`?version=active`, pool parts) | Group is preserved and no module is created |
| The module's `?version=active` read returns 404 | Both fixtures are preserved, with no PUT |
| The source proof rejects a native rewrite of the saved source | Fixtures are preserved after the PUT |
| The group guard or pool state refuses deletion | Module may be removed, group is preserved |

I recommend running without further changes. What a fresh group returns is the question this run answers, and the cost is at most a few random-named `$TMP` objects. If you'd rather get function evidence from the first run, record typed 404s as an explicit "absent" baseline state and require the same state at recheck. That keeps the guard just as strict, but it's a code change that needs its own review.

## Checks and snapshot integrity

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged**, 4,464 files, revision `abcb541a…` |
| `npm exec -- vitest run --silent=true` | **Failed, exit 1:** 473 files, 472 passed; 12,720 tests, 12,719 passed. The failure is Finding 1 |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59, covering older families only |
| `npm run typecheck` | **Pass:** all three projects |
| `npm run check:sizes` | **Pass:** 951 files, all 12 schema scenarios |
| `node --import tsx …/source-parse-benchmark.mts` | **Ran once:** three samples, lint not blocked, 139 ms at 5,000 FORMs, about 198 MB RSS |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged**, 4,464 files; nothing was read after it |

The hash for the prior report in the follow-up doc (`5b8bec79…`) matches both manifest entries.

## Evidence limits

- **Not verified:**
  - the private GET captures and the author's hashes for them
  - any native SAP behaviour, and I made no SAP, CF, browser or external network request
  - the claim that the seven loopback cases failed on prior code
  - the old parser's timeout
- **Author-reported only:** build, lint, policy, strict docs and the historical cleanup state.
- **Simulated only:** the new runner scenarios are authored simulations. The historical harness doesn't qualify the new families.
- **Live coverage:** PP artifact `77e41fdcd` doesn't cover these bytes.
- **Still open:** remaining object types, DDIC/RAP, activation and batches, packages/API/publication, CTS, trace/quickfix, FLP, resource policies, and fresh two-writer and recording-transport qualification. Git and custom plugins stay excluded.
- **Undici:** its source isn't readable here, so replay and redirect conclusions rest on the loopback tests.
- **Diff coverage:** I read the changed source files directly, and the follow-up diff's production and test hunks in part. I didn't read the diff's copy of the prior report (lines 62-290) and relied on the hash match. The manifest proves these bytes, not the original history.

## Deviations

- **Extra verifier run:** I ran the verifier a second time right after the first, alongside read calls. The first and last runs were alone. It reported unchanged.
- **Refused read:** one `Read` omitted `source/` and returned nothing. I repeated it with the correct path.
- **Reading generated reports:** the output cap hid Vitest's failure list and its final summary, so I didn't see its duration. I took the results from `test-results/unit.json` and searched `node_modules/.vite/…/results.json`. Both are inside the source directory, generated by the approved run and excluded from the verifier.
- **Child processes:** Vitest's approved credential-free startup-refusal tests ran the CLI without a SHA. No SAP request was sent.
- **Otherwise none:** no edits, installs, delegation, operator or native scripts, mutants, ad hoc scripts, direct git, pipes or background shells.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so "max" is unconfirmed by me.