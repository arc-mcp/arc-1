# PR #1142 at `fd447841`: review of the correction checkpoint

**Decision: these bytes are suitable as a development checkpoint, but not for another live run.** This isn't whole-PR acceptance, PP qualification or permission for a probe. The PR stays draft and FEAT-93 stays open. I sent nothing to SAP.

- **Findings:** no High, 1 Medium, 4 Low.
- **Main problem:** the two probe corrections together remove what kept the runner away from the known-failing activated-module DELETE. Nothing replaces that protection (Finding 1).
- **Prior findings:** all five are closed in code, with remainders listed below.
- **Checks:** every allowed command passed, including 12,762 of 12,762 Vitest tests.
- **Cause of the 423:** unknown. It's one native sample, and it's unresolved, not a verified unsupported combination.

**Severity:** Medium means a missing safety control or a wrong conclusion on a future run. Low means an edge case, hardening, a test gap or a doc gap.

**Evidence labels:**
- **Read:** I read the code and nothing ran.
- **Executed:** a test ran here at this revision against mocks or loopback, never native SAP.
- **Authored:** author-supplied captures or reports that I can't reproduce.

## Findings

All five come from reading, because ad hoc scripts and mutants are barred.

### 1. Medium: the runner now reaches the known-failing DELETE with no gate
**Where:** `scripts/qualification/pr1142/native-function-contract-run.ts:233-241`, `:272`; `native-contract-transport.ts:110`; `tests/unit/scripts/pr1142-native-runner.test.ts:101-106`, `:224-235`; `scripts/qualification/pr1142/README.md:218`; `docs/research/2026-11-02-native-function-protocol.md:142`

- **How the path opened:**
  - At `1bb2eb43`, group preaudit failed the activation-evidence check and blocked cleanup. A changed ETag would also probably have stopped the delete guard.
  - Module selection now produces activation success, ETag tolerance passes the guard, and `:272` sends the DELETE.
  - The only native sample of that DELETE returned 423 (authored).
- **The new test points the wrong way:** the suite's only activated-module row has the mock DELETE return 204, then asserts `failure: false`, `remaining: []` and `cleanupUnconfirmed: false`. No row returns the observed 423.
- **The docs understate the gate:** "the next probe selects the saved module" and "need review before another run" read as if review were the only gate left.
- **Expected if run (read, not executed):**
  - The result is `delete-rejected`, `failure: true`, `remaining: [group, module]` and exit 1, with no group DELETE.
  - The state stays safe, but both fixtures remain.
  - The runner refuses whole-group deletion (`:130-131`), and the operator script is bound to `9E54…` at `1bb2eb43`, so recovery needs another new action.
- **Fix:**
  - After `result.success`, block both owners, record a specific reason and send no DELETE until a correction has evidence.
  - Change the row at `:224` to assert zero DELETEs and both owners preserved.
  - Add a row where the activated module's DELETE returns 423 `ExceptionResourceInvalidLockHandle`.
  - Update the README and doc lines to say no run until then.

### 2. Low: activation success doesn't prove the active source changed
**Where:** `native-function-contract-run.ts:240-241`; `native-contract-inventory.ts:114`, `:122`; `src/adt/native-activation-evidence.ts:32-35`

- **Gap:**
  - Success reads only `activationExecuted`; the "all three flags" claim comes from operator receipts.
  - The runner's only later active read is the delete guard, which accepts either the created hash or the saved hash.
  - So flags reporting true with an unchanged active source would pass.
- **Test gap:** the row at `:224` sets `activeSource` but never asserts it.
- **Impact:** the 423 hides this today. It becomes a false pass once deletion is corrected.
- **Fix:** after success, read `?version=active`, require the saved hash and narrow the receipt to it. Add a row with true flags and unchanged source.

### 3. Low: live tests named for FM deletion don't assert it
**Where:** `tests/integration/fugr-func.integration.test.ts:5`, `:62-69`, `:71`; `tests/e2e/func-write.e2e.test.ts:23-29`, `:119`; `tests/integration/crud-harness.ts:78`

- **Mechanism:**
  - These tests activate a module and then delete it only as best-effort cleanup.
  - A failed module delete is logged or ignored, and group cleanup can then remove the group.
  - The retry pattern `/locked|…/` also matches "is not locked (invalid lock handle…)", so a 423 is retried up to five times.
- **Impact:**
  - The repo can't say whether legacy LOCK-then-DELETE (`src/handlers/write/update-delete.ts:225-237`) works on an activated module.
  - If it fails, public `SAPWrite` has a hidden defect, and `src/adt/errors.ts:793` tells callers to retry first.
- **Fix:** record and assert the FM delete outcome, and exclude invalid-handle errors from the retry pattern. These tests already send this DELETE, so asserting the outcome adds no request.

### 4. Low: the audit scrub still misses `/` in malformed or cut-off credentials
**Where:** `src/server/audit.ts:505`, `:538`, `:578`

- **Trigger:** `https://writer:pa/ss@example.test/x`, the same URL embedded in a path, or a long value cut after the slash.
- **Mechanism:** by URL parsing rules `pa` isn't a port, so `new URL` should throw. All three patterns stop at `/`, so `pa/ss` survives. This is the same class as the fixed `?`/`#` shapes, but not a regression.
- **Fix:** in the `catch` branch, scrub through the token's last `@`. For cut-off values, treat a non-numeric `:port` as a credential. Add rows for both shapes.
- **Remaining limits I'd leave as they are:**
  - `https://user:123?abc@host/x` parses as a port and query, so it can't be told apart from a harmless query email.
  - Percent-encoded nested userinfo stays unscrubbed, and the doc's "plain" wording covers that.
  - Free text only scrubs http(s) URLs (`:553`).

### 5. Low: smaller gaps
- **Guard wider than the runner:** `native-contract-transport.ts:63-65` still allows a group preaudit, and `pr1142-native-contract.test.ts:68-75` asserts it. That request is the observed generate-without-activate mutation. Allow only the module and flip the row.
- **Borrowed close rows:** nothing covers a deadline abort during the close body, or a gzip close. By reading, both dispose of the body and report `false`.
- **Doc wording:**
  - `native-function-protocol.md:111` says "qualifies" for one authored observation.
  - `docs_page/roadmap.md:223` says "needs a lock-protocol fix", which presumes a cause that `native-function-protocol.md:121-124` says is unknown.

## Prior findings

| # | Prior finding | Disposition | Evidence and remainder |
|---|---|---|---|
| 1 | `etag` in metadata receipts | **Closed in code** | Executed: contract and runner rows pass. Only unprefixed `etag` is stripped; identity, source hash and link targets still count. **Remainder:** not replayed against retained native bytes, and it enables Finding 1. |
| 2 | Pinned close leaves the kept proxy client | **Closed on loopback** | Executed: success, 404 fallback, oversized and oversized-with-reset-cookie rows use one socket, send the PP header on every request and close all connections. Comments now match. **Remainder:** real Connectivity with `sessionClosed: true` in fresh PP, plus the Finding 5 rows. |
| 3 | Malformed `?`/`#` audit regression | **Closed** | Executed: both shapes, plain and embedded, plus the author's three cut-off shapes. **Remainder:** Finding 4. |
| 4 | Unexpected absence doesn't set `failure` | **Closed** | Executed: `failure = true` at `native-function-contract-run.ts:261`. Both scenarios assert the `unexpectedAbsence` row and no group DELETE. |
| 5 | Test and evidence gaps | **Closed, one remainder** | Executed: captured framing through the runner, the fixture hash, padding counts 0, 1 and 7, a whitespace-only line, and an oversized close at runner level. **Remainder:** the runner's metadata is authored (`moduleMeta` plus a `<link etag>`), not a native capture. |

## Correction review

- **Close ownership (read and executed):**
  - Reuse applies only to session clones after the stateless transition, so forward bounded reads keep dedicated connections. The existing row still passes.
  - Legacy closes have no budget and are unchanged.
  - Every error path disposes of the body without destroying the kept client, and the session closes it afterwards.
- **Audit cut-off:** the pattern runs on input capped at 500 characters, so its cost stays bounded.
- **Module activation:** the first POST selects the module, and `preauditRequested=false` is still refused.
- **Function surface:** `createPinnedFunctionContext` has no production caller outside its own file, so function profiles stay private.
- **Excluded surfaces:** production changes are limited to `bounded-response.ts`, `http.ts` and `audit.ts`. No Git, plugin, aggregate, Basic, Copilot, read-only or destination code changed.
- **Test count:** the 18 new tests (4 proof, 4 proxy, 4 runner, 6 audit) match the move from 12,744 to 12,762. The author's 13 pre-fix failures fit by reading, but I didn't run them.

## Native evidence

- **All authored:** the second run, module activation, the 423, the diagnostic, whole-group deletion and final absence. Private receipts were out of scope.
- **Operator scripts (read only, not run):**
  - Their guards match the doc.
  - The module preaudit writes 45 records by my count, and records 0043 and 0044 fall where the doc says.
  - The report hash `35b1de1e…` matches both manifest entries.
- **Outside the prior approval:** the module preaudit and diagnostic were new SAP actions beyond the twelfth review's one-run go. They were disclosed and narrowly bound, but my review of them comes after the fact.
- **What the 423 does and doesn't show:**
  - Run 1's module DELETE succeeded on a saved inactive draft, and the post-activation group DELETE succeeded. Both are authored, and run 1's script isn't in this snapshot, so I can't compare the sequences.
  - UNLOCK then succeeded with the same handle, but that doesn't show whether UNLOCK validates handles.
  - `sap-contextid` equality never exercises the handle.
  - Receipts exclude LOCK bodies and handles (`native-contract-transport.ts:147`, `:214`), so the `+` handle bug noted at `src/adt/errors.ts:776` can't be ruled out.

## Next investigation

In priority order. None of steps 1 to 3 needs a SAP write or a DELETE.

1. **Private receipts, no SAP:**
   - Compare run 1's successful module delete with run 2's failure: requests between LOCK and DELETE, elapsed time, LOCK size and hash, and the exact 423 body.
   - Replay the new `contractMetadataHash` over run 2's pre- and post-activation metadata. That tests the ETag fix against native bytes.
   - Compare the 15 pre-child group hashes with the post-activation inspection. That shows whether the group guard would refuse next.
2. **Existing CI evidence, no new requests:**
   - Search `mcp-audit.ndjson` in the `e2e-logs` artifact of run 41388646841 (`.github/workflows/test.yml:401-407`, 7-day retention) for FM DELETE failures. Also check integration output for "FUGR/FUNC cleanup failures".
   - These runs use legacy LOCK-then-DELETE with no reads in between.
   - First confirm the target: CI is labelled "A4H 2025", and repo docs separate a4h-2025 (816) from a4h (758).
   - If no 423 appears, suspect the pinned sequence or the release. If a 423 appears, reads aren't required and legacy is affected too.
3. **Read-only vendor inspection, kept private as before:** find where the FM DELETE path raises `ExceptionResourceInvalidLockHandle` and what state it compares. Only this can give a cause rather than a correlation.
4. **Only then, a separately reviewed design (not a permission):**
   - Record LOCK fields and handle traits (length, presence of `+`) without the value.
   - Consider `/sap/bc/adt/deletion/check` with the held handle (`src/adt/server-driven.ts:532-562`). It sends no DELETE, but the probe guard refuses it today, and it's unverified whether it validates the handle for FUNC.
   - `/sap/bc/adt/deletion/delete` (`tests/integration/crud-harness.ts:167-175`) takes no lock handle, but it's unverified for `FUGR/FF`.
   - A whole-group cleanup branch has one authored success. It only cleans fixtures and doesn't solve module deletion.

## Checks and snapshot integrity

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged**, 4,475 files, revision `fd447841…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 474 of 474 files, 12,762 of 12,762 tests, 36.48 s |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 by my count, covering older families only |
| `npm run typecheck` | **Pass:** all three projects, no errors |
| `npm run check:sizes` | **Pass:** 952 files, all 12 schema scenarios |
| `node --import tsx docs/research/broader-pinned-pp-writes/source-parse-benchmark.mts` | **Ran once:** three samples, lint not blocked, 135 ms lint at 5,000 FORMs, RSS 202,424,320 bytes |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged**, 4,475 files; nothing was read after it |

## Evidence limits

- **Live coverage:** no run covers these bytes. PP remains at `77e41fdcd`.
- **Author-reported, unavailable here:** all native receipts, the vendor inspection, build, lint, policy, strict docs, and the absence of cloud or role changes.
- **CI and #1057:** I can't see the CI run. The diff changes no where-used test.
- **Dependencies:** I didn't read undici or `@abaplint`, so connection and lexer behaviour rest on executed rows.
- **Still open:**
  - function activation and admission
  - activated-module deletion
  - DDIC, CDS and SDO
  - RAP and batches
  - packages, API and publication
  - CTS, runtime traces and quickfix, classic FLP
  - resource policies
  - current-byte two-writer and recording-transport PP qualification
- **Coverage:**
  - Read in full: `followup.diff`, the operator scripts and the changed tests.
  - Read in the relevant ranges: the changed sources and cited dependencies.
  - Not read: `review-input/authored.diff`.
  - The manifest proves these bytes, not the original history.

## Deviations

- **Refused read:** one `Read` of `bounded-response.ts` omitted `source/`, which pointed outside the snapshot. The harness refused it and returned nothing, and I repeated it with the correct path.
- **Failed search:** one `Grep` named a file that doesn't exist inside the snapshot and returned only an error.
- **Saved output:** Vitest's output exceeded the display limit, so I searched my own saved copy, as the rules allow.
- **Parallel reads:** `Read` and `Grep` calls ran alongside the four middle checks, but never alongside either verifier run. The Bash commands themselves ran one at a time in the foreground.
- **Child processes:** Vitest's refusal tests started the CLI without a SHA and refused before any SAP request. Its loopback servers ran as approved.
- **Otherwise none:** no edits, installs, delegation, native or operator scripts, mutants, ad hoc scripts, direct git, pipes or background shells.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so the launcher's max effort is unconfirmed by me.
