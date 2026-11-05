# PR #1142 class includes at `cc34bbd6b`: retain, and qualify after one fix

**Retain this implementation, but don't start native/PP qualification at this revision.** Start once finding 1 is fixed, the focused vitest suite has a real pass, and the harness has an include plan. I found no High issues, one Medium and three Low. This is not whole-PR or merge approval.

**None of the nine focused unit test files ran in this review.** The prescribed vitest command failed while parsing its arguments, so adapter and handler conclusions come from reading the code and tests. Typecheck also exited 1, most likely because of where this snapshot sits (see Tests run).

Finding 1 comes first because its fix changes normalization used by both profiles. Live evidence binds to an exact revision, so fixing it after the run would leave that evidence on old code.

## Findings

### 1. Medium: a blank `source` now overwrites an include with no hash check
This is traced by reading; I couldn't execute it.
- **Cause:** `src/handlers/object-types.ts:299-305` restores any string `source`, including `""` and whitespace. That bypasses the stripping at `:212-214`, which exists because many callers send `""` for an omitted optional. The checkpoint intends empty replacement on both profiles (`docs/research/2026-11-01-broader-pinned-pp-writes-includes.md:28`), but it doesn't address the no-hash case.
- **Single-target effect:**
  - `{action:"update", type:"CLAS", include:"definitions", source:""}` used to be refused at `src/handlers/write/update-delete.ts:84-86`. It now reaches `:92-101`, where the hash is optional, and sends an empty PUT.
  - The active version survives until activation, but the inactive draft's content is lost.
  - This conflicts with the plan's rule to preserve single-target behaviour (`docs/plans/2026-10-26-broader-pinned-pp-writes.md:491`).
- **Pinned effect:** existing includes stay protected (`src/adt/class-include-write.ts:87`). A blank `source` with no hash on a typed-absent include still runs POST and an empty PUT (`src/handlers/write/pinned.ts:65-74`, `src/adt/class-include-write.ts:99-108`). In a transportable package, that records a new empty include on the CTS request.
- **Test and doc gaps:**
  - The only single-target test supplies a hash (`tests/unit/handlers/pinned-class-includes.test.ts:141-155`).
  - The neighbouring blank-source refusals don't cover includes (`tests/unit/handlers/source-preconditions.test.ts:396-414`).
  - The title at `tests/unit/adt/class-include-write.test.ts:348` overstates the guarantee.
  - `src/handlers/tools.ts` and `docs_page/tools.md` don't mention this behaviour, although `tools.ts:618-619` documents the equivalent for text symbols.
- **Fix:**
  - Preserve the value only when `args.source === ''` and `cleaned.expectedSourceHash` is a string. Blank without a hash and whitespace-only then return to refusal on both profiles.
  - Add zero-PUT tests for `''` and `' \r\n\t'` on single-target, and a zero-POST test for an absent include on pinned.
  - Document the hash-guarded clear in the single-target tool text.

### 2. Low: no valid include request goes through the real pinned route
`tests/unit/server/multi-target-writes.test.ts:77-102` sends a valid delete through `prepareMultiTargetCall` and Ajv. Includes only have a catalog check (`:428`) and refusals (`:104-109`, `:443`). `tests/unit/handlers/pinned-class-includes.test.ts` enters at `handleToolCall` with a hand-built config (`:13-29`). Add positive route cases for `source:""` with a hash, and for an omitted hash.

### 3. Low: recording drift under the lock has no test
The check at `src/handlers/write/pinned-lock.ts:35-37` reads correctly, but only package and hierarchy drift are tested (`tests/unit/handlers/pinned-class-includes.test.ts:194-201`, `tests/unit/handlers/pinned-writes.test.ts:261-270`). Add a case where the recording changes after preflight. Assert refusal and no include traffic rather than a specific message, because `pinnedRecording` can refuse before the comparison runs.

### 4. Low: unlock failure on the include path has no test
`src/handlers/write/pinned.ts:215-221` returns `include`, `initialized` and the cleanup failure together. The checkpoint describes this reporting (`:42`), but only the main-source path is tested (`tests/unit/handlers/pinned-writes.test.ts:455-504`). The `cleanup` returned at `tests/unit/adt/class-include-write.test.ts:51` is never read. Add failed-unlock cases after a confirmed save and after a confirmed initialization.

## What held, by reading
- **Legacy behaviour:** apart from finding 1, requests, optional hash, 404 handling, transport fallback and unlock precedence match the removed code (`src/adt/class-include-write.ts:79-108`, `src/adt/crud.ts:132-134`).
- **Main-source path:** `pinned-lock.ts` is a verbatim extraction, and the no-include branches behave as before.
- **Context and paths:** the adapter requires a registered pinned context, a complete lock policy and exact owner/include URLs (`src/adt/class-include-write.ts:23-37`, `:57-70`).
- **Absence:** initialization needs a typed 404, no service classification and no hash, under the class lock (`:93-99`).
- **CTS:** both POST and PUT use the verified parent request and never fall back to the lock's task (`:79`, `src/handlers/write/pinned.ts:138`).
- **No replay and cancellation:** the facade applies the policy to helpers that pass no options (`src/adt/mutation-http.ts:43-57`). Unlock uses the owning session with its own budget (`src/adt/crud.ts:135-147`).
- **Outcomes:** rejected, unknown and partial states stay distinct, with no automatic delete (`src/handlers/write/pinned.ts:144-151`, `:238-247`, `src/handlers/write/pinned-result.ts:16`).
- **Admission:**
  - The raw selector is checked before normalization on both entry paths (`src/server/multi-target-write-surface.ts:30-36`, `src/server/multi-target-server.ts:609-619`, `src/handlers/dispatch.ts:1001-1004`).
  - Wrong types, other case variants, non-strings, `main` and `text_symbols` are refused.
  - Create, delete and `edit_method` don't allow the field, and surgery actions have no capability.
- **Schema alignment:** the four-value enum and hash pattern agree across Zod, catalog, capability table and handler.
- **Module cycles:** `crud.ts:381` and `class-include-write.ts:2` form a real runtime cycle, but it's benign. The adapter has no top-level use of `crud`, and its three imports are hoisted functions. I found no other new path back to `crud`. The repo has no cycle checker, and I didn't observe this load at runtime.
- **Test plumbing:** the permissive lock policy at `tests/unit/adt/class-include-write.test.ts:21-51` only tests adapter sequencing. Handler tests use the real policy chain and mock only `fetch`, so nothing authorizes through a fake policy by accident.
- **Evidence boundary:** the patch adds one review file, edits no existing `claude-*.md`, and leaves the machine record unchanged. Its docs keep the earlier run bound to `1b234d3a4` and label includes as pending.

## Earlier five Low findings

| # | Disposition | Evidence | Executed here? |
|---|---|---|---|
| 1 | Closed: zero PUT, whole-state and failure name asserted | `scripts/qualification/pr1142/formatter-regression.mjs:286-288` | Yes: `interrupted-composed-recovery` passed with 5 mutations |
| 2 | Closed: no HTTP, native or mutation calls, parent and journal bytes unchanged | `formatter-regression.mjs:309-334` | Yes: `pre-baseline-composed-refusal` passed |
| 3 | Closed: finished-journal branch and original history asserted | `formatter-regression.mjs:260-263`; `tests/unit/scripts/pr1142-harness-safety.test.ts:181-188` | Timestamps yes; history no |
| 4 | Closed by reading: real worker and parent entrypoints probed with a real SIGINT and closed stdout, stopping before SAP access | `pr1142-harness-safety.test.ts:61-148`; `native-fixtures.mts:14-15`; `native-formatter.mts:12-13`; `live-harness.mjs:468-472` | No |
| 5 | Closed: wording names tested cases and accepted-but-untested styles | `docs/plans/2026-10-26-broader-pinned-pp-writes.md:5`; `docs_page/roadmap.md:226` | Not applicable |

- **Finding 3:** `interrupted === undefined` also proves the forward `finishedAt` was set (`formatter-qualification.mjs:430`), so that assertion isn't vacuous.
- **Finding 4:**
  - Removing the worker hook would fail only if SIGINT is otherwise fatal. The test has no negative control, and I couldn't read third-party listeners such as `tsx` from this root. The only one in `src/` is `src/server/shutdown.ts:47`.
  - Removing the stdout error handler would surface EPIPE, because the parent sets `exitCode` rather than calling `process.exit`.
  - The parent's signal handlers aren't probed, and the README doesn't claim they are.

## Tests run

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` | Ran first and last: 2,568 files `unchanged`, revision `cc34bbd6b…` |
| `npm exec -- vitest run --silent …` | **Exit 1, 0 tests ran.** Vitest read the first path as the flag's value: `Unexpected value "--silent=tests/unit/adt/class-include-write.test.ts"` |
| `npm run test:qualification:pr1142` | Exit 0: all 37 printed `passed:true` (20 formatter, 17 deletion). These are offline mocks |
| `npm run typecheck` | **Exit 1: 11 TS7016 errors**, all on `.mjs` imports |

- **Vitest:** I didn't change the command, as instructed. `--silent=true` is the form the error message asks for.
- **Typecheck:**
  - The `&&` chain only reaches `tsconfig.tests.json` if the `src` and scripts projects pass, and the errors match that third project. So I infer the first two passed.
  - The two new test files and every `src/` file reported no errors.
  - The likely cause is the snapshot's location under `node_modules/.cache`, where TypeScript treats imported `.mjs` as external and doesn't load it. I couldn't confirm that by running elsewhere, so this is neither a defect nor a pass.
- **Author-reported only, not verified here:** 396 files / 10,924 tests, 12 harness tests, build, lint, strict docs and budgets (`review-input/author-checks.txt:2-3`).

## Native and evidence limits
This review made no SAP, CF, PP or browser calls, and no live include evidence exists. Passing mocks and this review don't prove native behaviour. The harness also has no include plan: its only include reference is a refusal probe (`scripts/qualification/pr1142/deletion-qualification.mjs:340`). That new plan needs its own review.

These are open questions for the run, not expected failures:
- **Typed absence:** whether a missing include returns typed absence under `Accept: text/plain` (`src/adt/class-include-write.ts:85-86`). The earlier typed-absence evidence used a different read (`src/adt/pinned-delete.ts:90`).
- **Hash stability:** whether the editable read (`src/handlers/editable-source.ts:70`) and the under-lock read return the same bytes for includes, including successive hashes.
- **Transportable initialization:** whether POST and PUT work with the parent request on a transportable class (`src/adt/crud.ts:355-358`).
- **Empty replacement:** whether an empty PUT stays empty or SAP regenerates a skeleton (`src/adt/crud.ts:351`). A skeleton would report `source-save-unknown`, and "clears its contents" (`docs_page/multi-target-writes.md:139`) remains unproven until this is known.
- **Remaining run evidence:** whole-owner activation with includes (`src/handlers/write/pinned-activation.ts:21-24`), actor binding, active and editable readback, and complete fixture cleanup.

I also ran no mutants, so "a test would catch this" claims come from tracing. Without `git`, the revision identity rests on the manifest label, and I took `patch.diff` as complete.

## Tool restrictions
- **One slip:** two `Read` calls used a path one directory above the working directory (missing `source/`). The harness refused both, nothing was read, and I retried with the correct paths.
- **Otherwise none:** I ran only the permitted commands, exactly as written, and made no source or doc edits. I used no delegation, network, SAP or CF access. Simulation temp directories were removed by the harness.
