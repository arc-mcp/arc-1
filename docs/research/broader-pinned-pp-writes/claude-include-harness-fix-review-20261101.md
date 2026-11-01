# PR #1142 class includes at `b7fa68830`: retain, and qualify after one native check

**Retain the code. Controlled native/PP include qualification can proceed at this revision, after one direct-identity check.** All five findings were addressed well enough to run: H1 and L3 are closed, M2 is closed with one overstated claim, L4 is closed by reading only, and L5 is closed except for one gap in durability coverage.

I found one Medium and seven Low issues. None is a safety defect, and none needs a code change before the check. This isn't whole-PR or merge approval, and no live include evidence exists.

**Next step:** run the check in finding 1. If it passes, stage this revision and run. Don't hold the run for the Low findings. Any fix changes the source binding, and `deletion-regression.mjs` is part of the harness hash (`run-manifest.mjs:43-48`), so batch them after the run.

## Findings

### 1. Medium: pinned initialization reads back inside the session that created the include
This is an unresolved risk, not a confirmed defect, and I traced it by reading only.

- **Code:** the pinned path POSTs, PUTs, then GETs in one stateful session (`src/adt/class-include-write.ts:104-112`). The legacy path returns before any read (`:109`), so existing live coverage never reaches this GET.
- **Contrary evidence:** the repo's notes record a same-session GET right after the init POST returning 404, while a read outside the session returned 200 (`docs/research/issues/645-class-include-create-missing-corrnr.md:108-113`).
- **Why it's still open:**
  - That observation was made after the POST, not after POST and PUT.
  - The same note's "read-back OK" doesn't name the session (`:50,52`).
  - An earlier note says the include is GET-able, also without naming the session (`docs/plans/completed/2026-05-29-testclasses-include-init.md:7`).
- **No test models it:** mocks return stored text for any GET in any session (`tests/unit/handlers/pinned-class-includes.test.ts:88-101`, `tests/unit/adt/class-include-write.test.ts:74-84`). The live integration test runs the pinned adapter on main source only (`tests/integration/mutation-lifecycle.integration.test.ts:47-48,71-92`).
- **Effect if the 404 persists after the PUT:**
  - **Production:** real callers get `PINNED_WRITE_INCOMPLETE` in phase `source-readback`, even though the source was saved (`src/handlers/write/pinned.ts:151-153,243-252`).
  - **Run:** it stops at writer A's `testclasses` first save, the kind the notes say is absent on a fresh class (`645…md:31-33`). There's no activation or receipt, the class stays inactive in `$TMP`, and writer B's fixtures are never created. This fails safe but needs manual cleanup.

**Check:** run the pinned adapter once with the direct test identity on a fresh `$TMP` class, following `mutation-lifecycle.integration.test.ts:53-92`. Use a scratch copy, because `prepareRun` refuses a dirty tree (`run-manifest.mjs:78-79`).
1. Write `include:"testclasses"` with no hash. Expect `saved-inactive` and `initialized:true`.
2. Repeat the write with no hash. Expect `PINNED_WRITE_REFUSED`, not a second POST.
3. Activate, then GET the class metadata. Expect one `testclasses` descriptor with `changedBy` and `version="active"`.

This is native direct-identity evidence, not PP proof. If step 1 fails, fix production in a new revision by reading initialized includes back after the creating session closes.

### 2. Low: the M2 check relies on a descriptor no capture shows
- **Gap:** identity requires exactly one `testclasses` descriptor (`native-fixture-operations.mts:79-80`). The captures I checked list only `definitions`, `implementations`, `macros` and `main` (`tests/fixtures/xml/class-metadata-behaviorpool.xml:1`, and two `CL_ABAP_TYPEDESCR` probe fixtures). A search of the whole snapshot found no `testclasses` descriptor.
- **Diagnostics:** this assertion fires before anything is observed, unlike the rule at `:29`, so the report omits which types SAP returned. The fixture is preserved, so it can be re-read.
- **Fix:** observe descriptor types and count before asserting. Step 3 above answers the SAP question sooner.

### 3. Low: durable-progress checks can't detect a missing `save()`
- **Gap:** the test reads the journal only after the run ends (`deletion-regression.mjs:501-532`), and cleanup has already re-saved the same in-memory object (`deletion-qualification.mjs:484,494`). Deleting `await save()` at `include-qualification.mjs:89` would leave `includes-uncertain` green.
- **Also missing:** writer B's partial journal is never asserted, only writer A's.
- **Fix:** when the mock receives an include write, read the on-disk journal and assert `attempt` is already recorded.

### 4. Low: `isIncludeSaveResult` never returns false in any test
It's only asserted `toBe(true)` (`pinned-class-includes.test.ts:135-137,229-236`), and no scenario returns a wrong save body. Replacing it with `() => true` stays green. This matters most for `initialized`, which nothing else checks. Add one negative case per field.

### 5. Low: the L3 follow-up checks have no negative control or route test
- **Follow-up checks:** `unchanged_result`, `unchanged_source` and `still_unavailable` (`include-qualification.mjs:62,73-82`) never fail in any scenario. Tests only prove both probes ran.
- **Route:** `tests/unit/server/multi-target-writes.test.ts:77` doesn't send either L3 input. I traced that both reach the handler (`src/handlers/object-types.ts:222-239`, `src/server/multi-target-write-surface.ts:46-55`). If admission tightened, the code would become `MULTI_TARGET_OPERATION_FORBIDDEN` and the first probe would fail.
- **Fix:** add a scenario that refuses but mutates anyway, and add both route cases.

### 6. Low: the simulated include author comes from the class creator
`changedBy: entry.createdBy` (`deletion-regression.mjs:311`) makes the positive author check self-confirming, and the mock never compares the writing actor it already knows (`:129`). Wiring includes to the wrong writer's session would pass offline and fail closed live. The harness `version` check (`deletion-qualification.mjs:318`) also has no negative control, though the worker's own check does. Record the writer per include in the mock.

### 7. Low: a missing `createdBy` doesn't fail, despite the docs
`createdBy` becomes `null` and passes (`native-fixture-operations.mts:83`), yet the docs say missing metadata fails (`scripts/qualification/pr1142/README.md:140`, `docs/research/2026-11-01-broader-pinned-pp-writes-includes.md:115`). Missing `changedBy` and `version` do fail, but no test removes a single attribute. Keep it recorded-only, correct the wording, and add those two cases.

### 8. Low: the wrapper test sits close to its timeout
It took 5,707 ms against a 10,000 ms limit (`vitest.config.ts:7`) and does hundreds of fsyncs. My timing was contended, because the other validation commands ran at the same time. Give it an explicit longer timeout.

## Dispositions

| Prior finding | Disposition | Evidence |
|---|---|---|
| **H1** invented `ok` | **Closed, executed** | The predicate has no `ok` (`include-qualification.mjs:10-19`) and matches the payload at `pinned.ts:227-240`. Real `handleToolCall` results pass for all four existing kinds and for initialization on both recording profiles. The mock drops `ok` (`deletion-regression.mjs:229-238`). The patch touches no `src/`. See finding 4. |
| **M2** per-include identity | **Closed, one claim overstated** | Parses each descriptor and requires one per kind, records three fields, then asserts actor, version and hashes (`native-fixture-operations.mts:70-100`). Fields join all three receipt comparisons (`:129,145-149`, `native-fixtures.mts:91-95`). There's no class-level fallback. See findings 2 and 7. |
| **L3** blank probes | **Closed, executed offline** | Probes run before each first save (`include-qualification.mjs:54-85,118`). `includes-success` enters both the hash and the unavailable branch. The real refusal is tested (`pinned-class-includes.test.ts:188-198`). Only a typed 404 under the lock initializes (`class-include-write.ts:93-100`). See finding 5. |
| **L4** cleanup state | **Closed by reading, not executed** | See the lifecycle below. |
| **L5** failure coverage | **Mostly closed** | All cases enter their branches, per the table below. The `save()` calls remain unverified (finding 3). |

**L4 lifecycle:**
- A failed unlock sets the flag (`src/adt/crud.ts:145-147`).
- Session close records its result before the error propagates (`src/adt/http.ts:306-316`).
- The worker's `finally` then copies and persists the state (`native-fixtures.mts:129-134`). It uses the same object throughout (`:43`, `src/adt/mutation-context.ts:68`).
- "Always" means in-process only. A kill at the 180-second timeout (`native-check.mjs:41`) or a group signal (`README.md:70`) skips `finally`, which leaves no `finishedAt`.
- Deleting line 130 would pass every test.

| L5 case | Enters the branch? | Note, traced by hand |
|---|---|---|
| `includes-tool-read-error` | Yes | `definitions` exists, its read errors, and the unhashed save is refused: 0 writes, attempt `first-save` |
| `includes-denied-write` | Yes | Exactly one leak, failing on `reader.*`. Success requires 8 calls (4 routes × 2 classes) |
| `includes-abort` | Yes | Stops before the second send: 1 write. This is harness-level; production cancellation is in `class-include-write.test.ts:299-346` |
| `includes-uncertain` | Yes | 1 write, no replay |
| `includes-writer-b-failure` | Yes | Writer A completes and is cleaned; only writer B's class remains |
| `includes-wrong-include-author` | Yes | Removing `deletion-qualification.mjs:317` gives 0 failures, so the scenario fails |
| Combined wrapper | Yes | The scenario's own qualifiers are omitted (`deletion-regression.mjs:411-413`). Removing `qualification.mjs:54` fails the test. MCP, native and SAP are still simulated |
| Direct adapter guard | Yes | Context admission passes, then `pinned.ts:65-73` refuses. Removing the guard causes I/O and fails `requests` = 0. Asserting the message would stop an earlier refusal hiding it |

## What this does and doesn't prove
- **Executed here:** unit tests over mocked HTTP and 50 mock-MCP simulations.
- **Read, not executed:** real route admission for L3, the worker lifecycle, and all "would fail if removed" claims. I ran no mutants, because edits weren't allowed.
- **Native/PP proof:** none from this review.

**Limits that still apply:**
- Earlier write, delete and formatter PP evidence stays bound to `1b234d3a4` and doesn't cover includes.
- The read-only probe covers protocol responses only, at `cc34bbd6b`.
- Any later run proves only what the primary native reader can see. Other users' hidden drafts aren't qualified.
- It's local `$TMP` only. Transportable includes and the remaining mutation families aren't qualified.
- Per-include author is the last changer after whole-owner activation, not attribution of each request.
- `initialized: true` is production's own report.
- Real harness and worker composition can't run offline.

**Open questions for the run, not predicted failures:**
- Does same-session read-back work after initialization?
- Is there typed absence under `text/plain` on a never-activated class?
- Do the editable, under-lock and native reads return identical bytes?
- Does an empty PUT stay empty?
- Do preaudit references stay within the five allowed URIs?
- Does `?version=active` work on includes?
- Does whole-owner activation cover all four kinds, with complete cleanup afterwards?

The notes suggest `initializedKinds` may be only `testclasses`, while the mock uses two kinds. Either passes the coverage check.

## Tests run

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` | `unchanged`, 2,462 files, revision `b7fa6883…`, on all three runs (first, last, and one extra mid-review) |
| Focused `vitest run --silent=true …` (14 files) | **Exit 0: 14 files, 445 tests passed** |
| `npm run test:qualification:pr1142` | **Exit 0: 50 scenarios passed** (20 formatter, 30 deletion, including 13 include). All offline mocks |
| `npm run typecheck` | **Exit 0, no errors** across all three projects |

The counts reconcile. Tests rose from 437 to 445, and `includes-success` rose from 223 to 255 requests, which is 2 requests × 2 probes × 4 kinds × 2 writers.

Author-reported only, not verified here: 397 files / 10,947 tests, lint, strict docs and budgets.

## Tool and environment deviations
- **Reads outside the CWD:** I ran the validation commands in the background and concurrently, with their exact text. I then read their three output files under `/private/tmp/claude-501/…/tasks/`, which breaks the Read restriction. Those files held only those commands' output.
- **One refused read:** a `Read` missing `source/` was refused, nothing was read, and I retried inside the root.
- **One failed search:** a `Grep` on the nonexistent `src/handlers/read` failed. I searched elsewhere.
- **Otherwise none:** no git, `ls`, installs, network, SAP, CF, browser, edits or delegation. Vitest wrote `test-results/unit.json`, and the simulations used temporary directories.
- **Revision identity:** this rests on the manifest label, and I took `patch.diff` as complete. The manifest wouldn't detect added files, though its count rose from 2,460 to 2,462, matching the patch's two new files.
