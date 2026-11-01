# PR #1142 class includes at `00dde0613`: retain, but fix the harness before any live run

**Retain the code, but don't start native/PP include qualification at this revision.** The harness requires an `ok` field that production's include save never returns. As written, the first real include save fails qualification and strands writer A's class. The seven simulations miss this because the mock adds the same field.

I found one High, one Medium and three Low issues. All four prior findings are closed, and I found no safety defect in the shared production include path. This isn't whole-PR or merge approval.

**Next step:** fix findings 1 and 2 in one new clean revision, then re-run these checks and start the controlled run. Live evidence binds to a revision, so both fixes belong together. Findings 3–5 aren't blockers, though finding 3 is cheap to add in the same revision.

## Findings

### 1. High: the harness rejects every real include save
This is traced by reading; no test feeds a real handler result through the harness.
- **Harness:** `scripts/qualification/pr1142/include-qualification.mjs:58` requires `body?.ok === true`.
- **Production:** the success payload at `src/handlers/write/pinned.ts:227-240` has no `ok`. Later layers don't add it (`src/handlers/dispatch.ts:1102-1103`, `src/server/server.ts:916`). `ok` belongs to delete results (`src/adt/pinned-delete.ts:126`).
- **Why the simulations pass:** the mock supplies `ok: true` (`deletion-regression.mjs:203`), so the check only validates the mock. Handler tests don't catch it because `toMatchObject` ignores the field (`pinned-class-includes.test.ts:126-131`).
- **Live effect:**
  1. The real PUT to writer A's `definitions` include succeeds.
  2. `ensure` throws, so there is no activation and no ownership receipt.
  3. Cleanup refuses, and the class stays inactive in `$TMP`.
  4. The other three fixtures are never created.

  This fails safe, but it wastes the run and needs manual cleanup.
- **Fix:**
  - Remove the `ok` check and the mock's field. Main saves already use `state` and `target` (`deletion-qualification.mjs:243`), so production's shape shouldn't change.
  - Extract the save predicate and test it against a real `handleToolCall` include result.

### 2. Medium: include authorship isn't natively bound to each writer
- **Gap:** the receipt asserts only class-level `createdBy` and `changedBy` (`native-fixture-operations.mts:52-55`). Per-include data is hashes only (`:70-82`). Authorship of the four include writes is therefore inferred from the session plus one class-level value, yet actor binding is required evidence (`docs/research/2026-11-01-broader-pinned-pp-writes-includes.md:53-55`).
- **Available data:** the metadata GET the harness already makes can return per-include `changedBy`, `createdBy` and `version` (`tests/fixtures/xml/class-metadata-behaviorpool.xml:1`). A class-level value can't stand in for them: that capture shows class `createdBy="DEVELOPER"` but include `createdBy="MARIAN"`.
- **Fix:** read `metadata.include` (`src/adt/xml-parser.ts:109` strips the prefix, so handle one or many entries). Store `changedBy` and `version` in `identity.includes[kind]`, which puts them under the existing receipt comparison. Assert the writer and `active`.
- **If SAP doesn't update these fields for includes:** record that as an explicit limit, as was done for the inferred DELETE actor.

### 3. Low: the live plan skips the blank-source refusals this revision fixed
`include-qualification.mjs:97-101` probes a non-blank missing hash, a stale hash and the valid clear. Blank without a hash and whitespace-only source are tested only in units (`pinned-class-includes.test.ts:162-191`).

Add both as refusal probes before each kind's first save, expecting `PINNED_WRITE_REFUSED` and `unchanged`. Where the include is absent, its follow-up read must still fail.

### 4. Low: a failed unlock after a refused cleanup isn't recorded
`cleanupState` is written only after the locked operation succeeds (`native-fixture-operations.mts:137-138`), and the worker's failure path omits it (`native-fixtures.mts:121-133`). A foreign-draft refusal followed by a failed unlock therefore doesn't report a possibly held lock.

The gap predates this patch, but the include guard adds more ways to reach it. Write `report.cleanupState = context.cleanup` in the worker's `finally`.

### 5. Low: some failure paths have no offline negative control
By tracing, each of these could regress with all simulations still green:

| Gap | Evidence |
|---|---|
| A tool-level `isError` read on an existing include is untested; `includes-read-loss` covers only HTTP 500 | `deletion-regression.mjs:159`, `include-qualification.mjs:30` |
| The denied-route include block can be deleted | `deletion-qualification.mjs:371-396` |
| The live delete-plan wrapper never runs offline. Removing line 54 would let a live run pass with no include assertions | `qualification.mjs:52-57`, `formatter-regression.mjs:231-233` |
| No include scenario reads the durable journal, so its `save()` calls and partial state are unverified. The live worker fails closed if the journal is stale | `deletion-regression.mjs:384`, `native-fixtures.mts:28-34,55` |
| Not simulated: cancellation during includes, an uncertain include save, or a failure only on writer B | `deletion-regression.mjs:102-106` |
| The new blank-source condition in the pinned handler has no direct test, because normalization strips blanks first. It still protects direct calls | `pinned.ts:65-68`, `object-types.ts:224` |

## Prior findings

| # | Finding | Disposition | Evidence |
|---|---|---|---|
| 1 | Medium: blank source overwrites an include | **Closed, executed** | Clearing needs exactly `""` plus a hash (`object-types.ts:300-307`, `pinned.ts:65-73`). Unhashed blank and whitespace send zero PUTs or POSTs (`pinned-class-includes.test.ts:162-191`). Clears work on both profiles (`:140-160`). Docs are updated. |
| 2 | Low: no valid route test | **Closed, executed** | Hash-guarded clear and omitted hash both pass route preparation and Ajv (`multi-target-writes.test.ts:77-105`). |
| 3 | Low: recording drift under lock | **Closed, executed** | Refusal, no include traffic and one unlock (`pinned-class-includes.test.ts:239-245`). `pinnedRecording` refuses first (`pinned-write-policy.ts:145-146`), so `pinned-lock.ts:36` itself isn't reached, as the prior review anticipated. |
| 4 | Low: unlock failure on the include path | **Closed, executed** | Save and initialization cases retain include, hash and cleanup failure, with no DELETE (`pinned-class-includes.test.ts:247-264`). |

Nonempty legacy include behaviour held. The legacy branches of `class-include-write.ts` still take the hash and transport fallback, and only normalization changed in this delta. `tests/unit/adt/crud.test.ts:937-1049` passed.

## Harness review

### Seven include scenarios
No mutants were run. "Detection" below is traced by hand, and "requests / writes" counts are printed by the run. "Writes" means all mutations, including create and delete, and "left" means fixtures still present afterwards.

| Scenario | Requests / writes / include writes / left | What fails it | Is it vacuous? |
|---|---|---|---|
| `includes-success` | 223 / 48 / 32 / 0 | Nothing should fail | **Partly: it depends on the mock's `ok` (finding 1)** |
| `includes-bad-clear` | 28 / 6 / 3 / 1 | Clear read-back | No. Without the check the run ends with 0 failures and the scenario fails |
| `includes-stale-write` | 25 / 6 / 3 / 1 | `expected_outcome` | No. Uses the real first-save hash, and `unchanged_result` also catches it |
| `includes-wrong-native` | 70 / 19 / 16 / 1 | `native_includes` | No. Without the check two classes remain and `objects.size === 1` fails. The real worker would refuse earlier |
| `includes-foreign-draft` | 219 / 44 / 32 / 1 | The mock's own hash check | It proves only the harness's reaction: no delete, and foreign text kept. The real guard is in a unit test |
| `includes-read-loss` | 18 / 3 / 0 / 1 | `initial_protocol` | No, but HTTP 500 only |
| `includes-no-initialization` | 223 / 48 / 32 / 0 | `include_initialization_exercised` | No. This is the strongest: exactly two named failures, empty kinds, and cleanup still completes |

Failure scenarios mostly assert `failed > 0` rather than which check fired (`deletion-regression.mjs:396`). The counters above are printed, not asserted.

### Native-function tests
- **Include hashes:** the tests run the real `nativeIdentity` over all 11 GETs, with expected values that don't come from the reader. Both changed-version cases keep their diagnostics (`pr1142-native-fixtures.test.ts:124-146`).
- **Under-lock guard:** this test runs the real `cleanupNativeFixture`, with the lock lifecycle mocked (`:202-216`). It stops at the hash check, not the receipt comparison, and the mocked identity ignores its session argument. That the locked session is used comes from reading `native-fixture-operations.mts:127`.

### What held, by reading
- **Sequencing:** `qualifyIncludes` runs after identity, scope and grant checks and main edits, but before activation and the first receipt (`deletion-qualification.mjs:292-299`).
- **Absence:** a failed first read sends no hash, and only production's typed 404 under the lock can initialize. An existing include is refused (`class-include-write.ts:87-100`).
- **Hash and read-back:** the chain runs from the PP save to the PP read to independent native bytes. Each kind's text names its own include, and native hashing of all four would catch cross-talk.
- **Fixture preservation:** a missing, failed or incomplete receipt preserves the fixture. Foreign hashes are refused before and under the lock.
- **Receipts:** they're created exclusively and never rewritten by later steps (`native-fixtures.mts:75-76`, `durable-journal.mjs:5-6`).
- **Coverage:** missing initialization is recorded rather than thrown, so cleanup continues.
- **Journal size:** the worker's new journal read has a 512 KiB limit. I estimate about 150 KiB, unmeasured, and exceeding it fails closed.

## Production include path
Read in full, with unit tests executed; no SAP behaviour was exercised.

| Area | Result | Evidence |
|---|---|---|
| Registered context and complete policy | Required | `class-include-write.ts:57-67`, `mutation-context.ts:72-80` |
| Exact owner and selector | Enforced | `class-include-write.ts:23-37`, `pinned-mutation-capabilities.ts:40-42` |
| Typed absence | Only under the lock with no hash | `class-include-write.ts:93-100` |
| Fresh package and CTS checks; parent request | Rechecked under lock; no fallback to the lock's task | `pinned-lock.ts:25-39`, `class-include-write.ts:79` |
| No replay, cancellation | Enforced per request | `mutation-http.ts:43-57`, `http.ts:436,539` |
| Owning-session unlock | Separate 30-second budget | `crud.ts:135-147` |
| Result uncertainty | Rejected, unknown and partial states stay distinct, with no automatic delete | `pinned.ts:149-156,241-258` |
| Admission and schema | Raw selector checked first; enum and hash pattern agree | `multi-target-write-surface.ts:30-36`, `multi-target-tools.ts:174-189` |

- **Conservative edge:** cancellation just before a PUT reports `source-save-unknown` although nothing was sent. That's safe.
- **Capability table:** the patch doesn't touch it, so no other write family is enabled.
- **Module cycle:** the prior review's `crud`/`class-include-write` cycle now loads under vitest (`class-include-write.test.ts:2`).

## Tests run

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first and last) | `unchanged`, 2,460 files, revision `00dde061…`, both times |
| Focused `vitest run --silent=true …` (13 files) | **13 files, 437 tests passed** |
| `npm run test:qualification:pr1142` | **Exit 0: 44 scenarios passed** (20 formatter, 24 deletion, including the 7 include). All offline mocks |
| `npm run typecheck` | **Exit 0, no errors** across all three projects |

Author-reported only, not verified here: 396 files / 10,939 tests, build, lint, strict docs and budgets (`review-input/author-checks.txt:1`).

## Evidence limits
This review made no SAP, CF, PP or browser calls, and **no live include evidence exists**. Passing mocks and this review don't prove native behaviour.

- **Earlier evidence:** the write, delete and formatter PP evidence stays bound to `1b234d3a4`. It doesn't cover includes or this revision.
- **Read-only probe:** `include-read-contract-20261101.json` confirms protocol responses only, on existing classes at `cc34bbd6b`. It shows no lock, write or PP identity, and it doesn't record the request `Accept` header.
- **Scope of any later run:**
  - Proof is limited to what the primary native reader can see.
  - Other users' invisible inactive drafts aren't qualified.
  - The fixtures are `$TMP` only, so transportable initialization isn't qualified.
  - `initialized: true` is production's own report; nothing natively observes the absence before the POST.
  - Real harness and worker composition can't run offline.
- **Revision identity:** there's no `git` here, so identity rests on the manifest label, and I took `patch.diff` as complete. The manifest also wouldn't detect added files.

These are open questions for the run, not expected failures:
- Does a missing include return typed absence under `Accept: text/plain`, on a class that has never been activated?
- Do the editable read, the under-lock read and the native read return identical bytes for includes?
- Does an empty PUT stay empty, or does SAP regenerate a skeleton or return 404? Either of the last two fails the run and preserves the fixture.
- Do activation preaudit references stay within the five allowed URIs (`pinned-activation.ts:20-24`)?
- Does `?version=active` behave on includes after activation? The metadata capture advertises that URL form, but the probe never read it.
- Does whole-owner activation activate all four includes for both writers, with complete cleanup afterwards?

## Tool restrictions
- **One slip:** one `Read` used a path missing `source/` (`…/src/adt/errors.ts`). The harness refused it, nothing was read, and I retried inside the root.
- **One failed search:** one `Grep` pattern was rejected for look-ahead before searching. I re-ran it with a simpler pattern.
- **Otherwise none:** I ran only the listed commands, exactly as written, with verification first and last. I made no edits and used no delegation, network, SAP, CF or browser access. Vitest and the simulations may have written their own temporary files, as permitted.
