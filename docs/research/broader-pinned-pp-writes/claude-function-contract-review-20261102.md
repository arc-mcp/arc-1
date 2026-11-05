# PR #1142 at `1d2022d0`: continue development, but don't run the native probe at this revision

**Decision:** keep developing from this checkpoint. The PR stays draft and FEAT-93 stays open. This isn't whole-PR acceptance or a final PP artifact freeze.

- **Findings:** no High, 2 Medium, 8 Low. I found no false success, no route to foreign-object mutation or activation, no write-scope widening and no public route to the function candidate.
- **Native probe:** its mutation scope is bounded by reading, but **don't run this revision yet**. Fix Findings 1–3 first. Finding 1 can send a real password without TLS verification, and Finding 2 can mislabel a refused DELETE. Those fixes change HEAD, so the changed lines need a narrow re-review before `--execute-reviewed-revision`.
- **Prior findings:** 2, 3, 4 and 5 are closed offline. 1 and 6 are mostly closed, with the remainder in Findings 8 and 9.
- **Checks:** all allowed commands passed, with 470 files and 12,672 tests. The snapshot was unchanged at both verifier runs.
- **How findings were reached:** by reading code and tests. Ad hoc scripts were barred, so **I executed no failing case for any finding**. The one executed observation is logger output, described in Finding 3.

**Severity:** Medium means a missing safety control or a wrong conclusion on the proposed live run. Low means an edge case, hardening or a test gap.

## Findings

### 1. Medium: the probe skips the safety preconditions every other native helper enforces
**Where:** `scripts/qualification/pr1142/native-function-contract.ts:35-45`; compare `safe-io.mjs:117-128`, `run-manifest.mjs:15-21`, `native-fixtures.mts:20`, `native-formatter.mts:13` and `README.md:39-42`.

| Trigger | Impact |
|---|---|
| The operator's environment has `NODE_TLS_REJECT_UNAUTHORIZED=0` | The real MARIAN password can go out without certificate verification, because `insecure: false` doesn't override that variable |
| `SSLKEYLOGFILE`, `NODE_DEBUG` or `--inspect` is set | TLS session keys or debug state can be exposed |
| The checkout sits inside an ignored directory of a repo at the same HEAD | `git status --porcelain` reports clean, so unreviewed bytes pass the "exact reviewed revision" check |
| `.env` holds `SAP_URL` and a password for a different system | That password goes to the hard-coded host, because `SAP_URL` is never compared |

`README.md:39-42` says these conditions are refused, which is no longer true for this runner.

**Fix:**
- Call `assertSafeDiagnosticEnvironment()` and `assertWorkspaceRoot(repo)` before reading `.env`.
- Require `env.SAP_URL` to be the hard-coded origin.
- Add the same boot-refusal row the other workers have.

### 2. Medium: a guard refusal is recorded as a DELETE SAP rejected or may have applied, and the reason is lost
**Where:** `native-contract-transport.ts:152-156`; `src/adt/pinned-delete.ts:105-110`, `:166-181`; `native-function-contract.ts:133-146`, `:162-169`, `:205-211`, `:288`.

**Trigger:** any `beforeDelete` refusal, such as a changed hash, a foreign author, unexpected membership or a changed baseline.

**Impact:**
- **Wrong state:** `performDelete` sets `delete-unconfirmed` before calling the proxied `delete`, and the guard then throws a plain `Error`. The result says "SAP did not confirm the complete deletion" for a DELETE that was never sent.
- **Wrong rejection:** if a guard read gets a 4xx, the state becomes `delete-rejected` with that read's status.
- **Lost reason:** nothing records the guard's message, and `cleanupFailure` only says "did not complete".
- **Lost evidence:** guard reads use the raw session, so the observer doesn't see them. `contractIdentity` throws before `snapshot` records, and the membership check throws before `cleanupMembership` is recorded. A foreign-author or membership refusal therefore leaves no native evidence. This breaks the repo's own rule at `native-fixture-operations.mts:40`.
- **Same pattern elsewhere:** an allowlist refusal on create or PUT reads as `creation-unknown` or `source-save-unknown`.

This fails safe. But the probe exists to produce evidence, and a refused delete is a plausible first-run outcome. The only clue today is a missing `stage: request` row.

**Fix:**
- In `observeContractHttp`, catch `checkContractMutation` and `beforeDelete` failures and record `{stage: 'refused-before-send', method, sanitized path, reason}`.
- Rethrow them as `AdtSafetyError`.
- Record metadata and membership before asserting on them.
- Add a row that crosses `deletePinnedOwner`.

### 3. Low (fix before the run): real lock handles reach printed output
**Where:** `src/adt/http.ts:921-929`; `src/server/logger.ts:199`; `src/server/sinks/stderr.ts:33-43`; `src/adt/crud.ts:228-236`.

**Trigger:** any failed PUT, DELETE or UNLOCK. A typed UNLOCK 404 after DELETE is an expected path, so this could occur even in a successful cleanup.

**Impact:** the receipts are clean, but the default logger prints the raw path, including `lockHandle=`, to stderr. You required that printed output not expose handles. Handles are short-lived and session-bound, hence Low. The server's audit logging uses the same event, so this predates the probe.

**Executed evidence:** my saved Vitest log shows this with fake fixture handles, for example `…/source/selections?lockHandle=LOCK` (line 40) and `…?_action=UNLOCK&lockHandle=DLH1` (line 1985). That shows the logger's behaviour, not a probe run.

**Fix:** strip `lockHandle` from the audit path, and add a row.

### 4. Low: the guard uses up the DELETE's own deadline
**Where:** `native-contract-transport.ts:154-156`.

**Trigger:** the policy is computed before `beforeDelete`, and the group guard makes up to six reads against it.

**Impact:** the DELETE can start with almost no time left and abort mid-flight while SAP continues, which creates an uncertain deletion. If the time has already run out, it is refused without being sent but is still labelled unconfirmed.

**Fix:** recompute the policy after the guard returns.

### 5. Low: no-replay and the allowlist don't cover redirects on this direct path
**Where:** `native-contract-transport.ts:22-28`, `:78-87`; `src/adt/http.ts:1420-1437`; `src/adt/request-attempt-budget.ts:47-49`; `src/adt/bounded-response.ts:17-24`.

**Trigger:** a 3xx or 421 response to a LOCK, PUT or DELETE. Redirects stay on automatic unless `attemptBudget` is set, and the repo's own comment notes Fetch's internal 421 replay.

**Impact:** a second send can happen below the allowlist and receipts, recorded under the original label. The PP proxy path uses `client.request`, so the direct probe's wire behaviour differs there.

**Limit:** I couldn't read undici in this snapshot, so the follow behaviour is from the Fetch specification and I didn't verify it against the installed package.

**Fix:** have `contractRequestPolicy` supply a small `RequestAttemptBudget`. That already forces manual redirects and refuses them.

### 6. Low: `remaining: []` isn't proof after an uncertain create
**Where:** `native-function-contract.ts:209-211`, `:280`, `:291-300`.

**Trigger:** a create POST aborts at 30 seconds, SAP is still processing it, and the absence check gets a typed 404.

**Impact:** the final record says nothing remains, with no marker of the unresolved create. An uncertain FUNC create also doesn't block group deletion. I traced that race as harmless, because the group lock and the module absence check both stand in its way.

**Fix:** track `creation-unknown` paths, report them in the final record, block group cleanup, and tell the operator to recheck later.

### 7. Low (private; blocks admission): function source is proven only after the create POST, and the frame budget comes too late
**Where:** `src/handlers/write/create.ts:613-626`, `:649-656`, `:782-792`; `src/handlers/write/pinned-source-lifecycle.ts:57-61`; `src/adt/function-source-proof.ts:19-27`; `src/adt/fm-signature.ts:48`, `:366`, `:372`.

**Create ordering:**
- **Trigger:** a private FUNC create with unprovable source, such as a body-only source, a wrong name or an oversized frame. Body-only source is wrapped only when `parameters` is present.
- **Impact:** the POST creates a shell, and then the proof refuses at save. The result correctly says `created-source-not-confirmed`, so there's no false success. But it contradicts the rule at `create.ts:613` that rejection must not leave an empty object.
- **Fix:** run the proof before `createRepositoryObject`.

**Parser bound:**
- **Trigger:** source under 1 MiB containing a signature line like `IV TYPE x<very long run of spaces>y`.
- **Impact:** `parseFmSignature` runs before the 64 KiB frame check, and `(.+?)\s*$` backtracks quadratically, which could stall the event loop. This comes from reading the regex, and I didn't execute it. The FUNC proof path is private today, and the same regex is already reachable through legacy `parameters`.
- **Fix:** cap line length before parameter parsing, or use a linear pattern. The input is already trimmed, so `(.+)$` preserves behaviour for that regex.

### 8. Low: prior Finding 1 remainder, unconditional "SAP may still finish"
**Where:** `src/adt/devtools.ts:501-517`; `src/handlers/write/pinned-result.ts:93-99`; `src/adt/http.ts:378-385`.

**Trigger:** the failure happens inside `http.post` before any send:
- cancellation or a deadline while queued on the shared semaphore
- `AdtNetworkError` from the CSRF fetch
- a 5xx `AdtCsrfBootstrapError`

**Impact:** the caller gets `activationOutcome: unknown` and "SAP may still finish this activation", though nothing was sent. The legacy hint is conditional, but this text isn't.

**Fix:** use conditional wording, as the new `lockRecovery` text does.

### 9. Low: test gaps, and the guard's membership filter
- **Proof through the handler:**
  - No row covers `source-verification-preflight` (zero PUT, lock released) or a FUNC readback mismatch. A grep found neither message in `tests/`.
  - The proof is only tested as a pure function, and the 64 KiB frame limit has no row.
- **Driver:**
  - `beforeDelete`, `action` and the cleanup loop are top-level code, so they can't be imported and have no offline coverage.
  - The existing harness splits such operations out for mocked runs, and this runner should do the same.
- **Authored bodies:**
  - Allowlist rows use hand-written XML, so `buildCreateXml` never crosses `checkContractMutation`. By reading, the real bodies pass.
  - The `group=true` branch of `contractIdentity` has no row.
- **Lock cleanup:** no row covers a non-modifiable handle whose UNLOCK then fails (`crud.ts:198-202`). By reading, it's recorded correctly.
- **Membership filter:** `parseFunctionGroup` keeps only `FUGR/FF` and `FUGR/I` (`xml-parser.ts:444-450`). Dynpro, PBO/PAI and other nodes are dropped before the guard sees them, so "restricted membership" doesn't prove they're absent. The 64-bit random name makes a real collision implausible. Refusing unknown child types would close this.

### 10. Low: README wording
`README.md:200` says the probe is separate from the PP harness "below", but the harness is above that section.

## Prior finding dispositions

| Prior finding | Disposition | Evidence |
|---|---|---|
| 1. Activation unknown outcome | **Mostly closed** | Tagging is now only in `postActivation`. Negative rows cover `beforeSubmit` and validation after preaudit. Legacy wording and behaviour are preserved by reading. Remainder is Finding 8 |
| 2. Hierarchy text | **Closed offline** | `hierarchyFailure` keeps the root and status, and `HierarchyLimitError` keeps local limit text. The sentinel row runs in both minimal modes, and rows for `maxDepth` and `maxPackages` exist. Legacy messages also lose upstream detail, which is deliberate and fail-closed |
| 3. LOCK edges | **Closed offline** | A missing handle records unknown and refuses. A known non-modifiable handle stays in a `WeakMap` and is unlocked by the owning session, for both primary and additional locks through shared `acquire`. Legacy mode is guarded and the 423 is unchanged. A failed UNLOCK is recorded |
| 4. Metadata-only boundary | **Closed offline** | `executePinnedSourceWrite` requires `createdOwner`, `readVerified` and no write. It returns `created`, the hash and `functionGroup`. Rows cross the real boundary |
| 5. Ignored input | **Closed offline** | Action/type allowlists refuse before SAP, and creation `package` is validated against the native parent |
| 6. Test gaps | **Mostly closed** | I read each listed row and they assert real behaviour, including LOCK and GET failing before creation, non-vacuous POST and PUT counts, and CTS and package drift. New gaps are in Finding 9 |

L4 (arbitrary include names) is unchanged and matches what you described. L6 (FUNC readback) now has a candidate proof but stays open until a native PUT.

## Native probe assessment

**Decision: bounded in mutation scope, not ready to run at this revision.**

### What holds, by reading
| Area | Result |
|---|---|
| Allowlist | Only the two fixture URIs and the pool's LOCK/UNLOCK. `transportchecks` is the one unbound POST (`getTransportInfo` treats it as read-only), and GETs are confined to ADT paths. Normalized and `..` paths are refused |
| Real request shapes | `buildCreateXml`, lock, PUT, DELETE and activation paths all satisfy the guards, so I don't expect a false refusal in normal flow |
| Activation | One selected reference with `preauditRequested=true`. Confirmation is blocked twice, by `validateReferences` and by the transport |
| Deadlines and replay | Finite and no-replay on every intercepted request, apart from Findings 4 and 5 |
| Deletion guard | Runs in the owning session, under the lock, with no extra SAP context. It can't be reached by any path that skips the proxy, and the raw session is used only for reads |
| Uncertain outcomes | Uncertain or rejected updates, activation and cleanup all preserve fixtures, and a failed FUNC cleanup blocks the group. No path retries a mutation |
| Credentials | Never recorded, and receipts drop headers, cookies, query handles and lock bodies. Exposure risks are Findings 1 and 3 |
| Provenance | **Sufficient for cleanup safety:** typed absence, random name, confirmed create, marker, exact container and hash equality under lock. **Not sufficient as author qualification:** `changedBy=MARIAN` only shows the Basic user made the last change, which matches the doc's disclaimer |

### Expect a preserved group on the first run
None of these is unsafe, but each ends with a group left for manual removal:
- A never-activated group's text pool may be missing or inactive. The guard refuses on inactive (`text-elements.ts:485-490`), and the repo's own notes warn about inactive pools.
- The UXX include has no captured read evidence, and SAP may not restore it byte-for-byte after module deletion.
- Metadata may hold other volatile fields, or post-delete UNLOCK may return something other than a typed 404.

## Other requested assessments

- **Function source proof:**
  - **False acceptance:** I found no practical case. The prefix and body are byte-exact, the signature must be one statement, the footer allows only comments after `ENDFUNCTION.`, and string literals stay exact. The only literals that can reach the case-folded class are glued, syntactically invalid tokens (`lexer.js:331-341`), which I wouldn't expect SAP to store.
  - **False rejection:** native spacing changes, reordering, template comments, pragma case and blank lines at the body edge would all refuse safely. Only the probe can show which of these occur.
  - **Parameter-only updates:** these re-derive source under the lock and compare correctly by reading.
- **Early lint:**
  - It is pinned-only and whole-source only, with no skip and no repeat (`earlyLint ?? …`).
  - It moves refusal ahead of package reads, but reveals only the caller's own findings and sends no SAP request.
  - Rows prove zero requests and a single lint call. FUNC, include fragments and legacy paths are unchanged.
- **Upstream interaction:**
  - None of the hunks I read change the write path except lint message text, which the updated rows cover. I read the file list and the relevant hunks.
  - The file list shows no `src/server` file. The `dispatch.ts` and `diagnose.ts` changes concern reads. Feature caching is per target.
- **Exposure:** `src/server` has no FUGR reference. `createPinnedFunctionContext` has no production caller, and `executePinnedSourceWrite` sits behind existing admission. Aggregate, Basic, Copilot and read-only routes are untouched.
- **Legacy:** no regression by reading beyond the hierarchy message text in prior Finding 2.
- **Performance:** at 5,000 FORMs, splice took 63 ms and lint 135 ms at about 198 MB RSS, which doesn't exercise the proof. By reading, one save builds four `Registry` instances, each limited to the 64 KiB frame, so this is small apart from Finding 7's parser issue.

## Checks and snapshot integrity

Each Bash command ran in the foreground, and no two overlapped.

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged**, 4,456 files, revision `1d2022d0…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 470 files, 12,672 tests, 35.67 s |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59, covering older families only |
| `npm run typecheck` | **Pass:** all three projects. The scripts project compiles the runner |
| `npm run check:sizes` | **Pass:** 947 files, all 12 schema scenarios |
| `node --import tsx …/source-parse-benchmark.mts` | **Ran once**, three samples, lint not blocked |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged**, 4,456 files; nothing was read after it |

The hash the follow-up doc gives for the prior report (`cd2dd01d…`) matches the manifest entries for both `review-input/prior-verbatim-verdict.md` and the committed copy.

## Evidence limits

- **Not verified:** the private GET captures and their hashes, the comparison of an uppercase frame against the captured GET, and any native SAP behaviour. I made no SAP, CF, browser or external network request, and I didn't run the probe.
- **Author-reported only:** build, lint, the policy check, strict docs, the four reproduced failures, and the restored cloud and SAP state.
- **Live coverage:** run `77e41fdcd` doesn't cover these bytes.
- **Still unqualified natively:**
  - class, pool and function activation wire identities
  - signature normalization
  - processing and create side effects
  - guarded deletion
  - inactive-versus-fallback selection
- **Remaining scope:** other object types, DDIC/RAP, activation and batches, packages/API/publication, CTS, runtime trace/quickfix, FLP and resources, plus two-writer and recording-transport qualification. Git and custom plugins stay excluded.
- **Snapshot:** the manifest proves these bytes, not that the diffs are complete, and there's no history. I read `authored.diff` in full, but only the file list and relevant hunks of `followup.diff`.

## Deviations

- **Refused reads:** two `Read` calls left out `source/`, pointed outside the working directory and returned nothing. I reread `safe-io.mjs` at the correct path and used `Grep` on `audit.ts`.
- **Outside the working directory:** only `Read` and `Grep` of my own saved tool outputs, which you allowed.
- **Parallel calls:** read tools sometimes ran alongside one Bash command.
- **Internal Git:** `verify-snapshot.py` runs `git ls-files`, and I ran no direct git.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so "max" is unconfirmed by me.
- **Otherwise none:** no edits, installs, delegation, operator or native scripts, mutants, background shells, pipes or ad hoc scripts.