# Native declarative harness: review 23 follow-up

Claude Code `claude-opus-5-5` reviewed `13f5518a` and accepted it as a development checkpoint, with
**0 High / 2 Medium / 6 Low** findings and all five review 22 items closed. It also said **not to run
the harness**. The [verbatim report](broader-pinned-pp-writes/claude-native-declarative-harness-review-20261102.md)
is preserved unchanged (SHA-256 `e8ad9e7a0c00e806c04b91eb3d53e262caa569059a201c90a8ceefdf62557430`). Review23 used max effort;
this follow-up was authored with Claude Code `claude-opus-5-5` at high effort, as newly requested.

**The harness still has not run, and no SAP request was made for this batch.** It needs a source-bound
independent review before the read-only preflight or the one-run entry may execute.

## Dispositions

| # | Finding | Disposition | Regression evidence (offline) |
| --- | --- | --- | --- |
| 1 | Refusing reads kept no evidence | **Fixed.** Independent reads journal status, media type, size, hash and permitted body before any check. Failures use the closed `DeclarativeReason` vocabulary. Owner, source and typed error bodies are kept up to 1 MiB; untyped errors keep a hash, and the inventory stays hash-only on every path. | `native-declarative-evidence.test.ts` asserts each exact reason, including the review's relative state link and typed/untyped 404. The four negative receipt rows still reach a confirmed adapter create, then name their exact check. |
| 2 | No operator procedure | **Fixed.** New [README section](../../scripts/qualification/pr1142/README.md#native-declarative-qualification): exact commands, conditions, credential check without printing, SM12 controls, GET-only prerequisite, stop rule, result table, conservative leftovers and no retry. | Documentation; not executed. |
| 3 | Missing refusal rows | **Fixed.** Rows cover under-lock metadata and source drift, first and later active-version fallback, pre-activate, pre-update and pre-delete drift, a live child seen only under the base lock, forward, cleanup and 60-second phase deadlines, fixture labels, and this entry's real binding-map path. | `pinned-declarative-qualification.test.ts`, `native-declarative-fixtures.test.ts`, `pr1142-native-binding.test.ts`. Drift appears only after the prior check. |
| 4 | Stop not rechecked after guard reads | **Fixed.** The guard rechecks after its reads and DELETE is refused with `stopped`. | A stop raised during a guard read sends no DELETE, and UNLOCK and close still run. |
| 5 | Source-binding failure refused own UNLOCK | **Fixed.** Request validation runs first; only an exact selected-owner UNLOCK then skips the binding and stop checks. | Binding-failure rows for update and delete; twelve negative shapes for `isDeclarativeOwnerUnlock`. |
| 6 | Results overstated uncertainty | **Fixed**, see below. | Workflow, driver and entry rows for each field. |
| 7 | Inherited review 17 entry issues | **Fixed for this entry only.** A realpath-aware start, a journaled post-claim configuration failure with no-mutation `result.json`, and refusal of `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA`, `NODE_PATH` and `TSX_*`. Signals are journaled too. | `pr1142-native-declarative-entry.test.ts`. Claim-before-credentials order is unchanged. The historical entries keep their behavior. |
| 8 | Historical-count typo | **Fixed** in [the declarative sources record](2026-11-02-pinned-declarative-sources.md). | Documentation. |

No recommendation was rejected. Two were adapted:

- **Finding 1, read through an observer:** the shared observer retains every non-action response body,
  which would have stored the inventory. A dedicated evidence read keeps it hash-only.
- **Finding 3, deadline rows:** these use a controlled clock through real adapters, rather than an
  isolated `policy()` unit, so they also show the reserved cleanup budget and UNLOCK's separate allowance.

Beyond the eight findings, review 17's Finding 11 is also closed for tests: `nativeLockBinding` takes an
injectable state parent, so binding tests no longer create the operator's real state directory. Production
callers use the unchanged default.

## Result semantics

A pass is still `failure: false` and `cleanupUnconfirmed: false`, and every new field can only explain
a failure. The [field table](2026-11-02-native-declarative-qualification.md#results) defines them.

- **`mutationAttempted`** is observer evidence recorded just before sending. The CTS check is excluded
  because it is a read-like POST. Without an attempted mutation, `cleanupUnconfirmed` is false; `failure`
  stays true.
- **`createNeverSent`** needs two independent signals: no observed create POST, and adapter state
  `unchanged`. Anything else stays in `pendingCreation`, including a definitive 4xx rejection. Only a
  never-sent create releases its base for cleanup.
- **`confirmedDeleted`** needs adapter `deleted` and a fresh independent typed 404. If its lock or session
  then stays unconfirmed, the owner leaves `remaining` but stays in `cleanupIssues` and
  `inspectionRequired`, its bases stay preserved, and `cleanupUnconfirmed` stays true. If the independent
  read is unavailable, the owner stays in `remaining`.
- **`finalAbsenceConfirmed`** keeps the workflow's result. **`independentAbsence`** separately reports the
  entry's second check as `confirmed`, `unconfirmed` or `not-run`. A pass requires `confirmed`.

## GET-only preflight

`native-declarative-preflight.ts` is new because review 23's condition 3 needs a repeatable read, and
an untracked probe would have no source binding. It is bound to its commit and uses fresh random names,
then reports every owner plus the inventory even after an earlier refusal. It holds only a path-checked
`get`, with `allowWrites: false`, and has its own state directory. A mocked-wire test asserts seven GET
requests and no other method. It has not been executed, and no real `.env` was read.

Evidence reads now accept a `get`-only reader, which is what makes that restriction structural.

## Evidence limits

- **Everything above is offline.** The mutation lifecycle uses real adapters over mocked HTTP; binding uses
  an isolated local Git repository. Nothing here is native evidence or PP evidence, and no mock shape was
  promoted to one.
- **Guard removal check:** removing the post-guard stop check, and moving the binding check ahead of the
  UNLOCK exemption, each made its rows fail; both were restored. No wider mutation testing was done.
- **Error rows have no media type**, because `AdtApiError` carries no response headers. Changing shared
  production errors for this harness was not justified.
- **The realpath start is tested through its helper with real temporary symlinks.** The CLI itself was
  deliberately not spawned, so Node's symlinked main-module resolution remains reasoned rather than run.
- **Stops the first run could still hit**, all failing closed: typed-absence variants, a fixture compile
  error, draft state-link shape, whole-metadata comparison on a base after child activity, and UNLOCK after
  DELETE. A stop now leaves a recorded reason, not an answer to the underlying native question.

## Author checks

These ran on the uncommitted working tree, not a reviewed commit:

| Check | Result |
| --- | --- |
| Unit suite | **Pass:** 502 files, 13,518 tests (review 23 counted 500 and 13,398) |
| TypeScript, all three projects | **Pass** |
| Build | **Pass** |
| Lint | **Pass:** the three existing informational findings only |
| Action policy | **Pass:** 135 entries, 14 tool schemas |
| Historical offline harness | **Pass:** 59 of 59 scenarios, none exercising this harness |
| File size and schema budgets | **Pass:** 984 tracked files during author checks; repeated after staging: 986 source/test files and all 12 schema scenarios pass |
| Strict documentation build | **Pass** |

## Status

No public route, schema, dispatch, Git or plugin behavior changed, and `src/` is untouched. Aggregate, Basic,
Copilot and read-only routes gain no mutation. PR 2 is **not ready**: function and CDS public admission,
the remaining DDIC, SDO, RAP, batch, package, API, publication, CTS, trace, quick-fix and FLP families,
current-code two-writer PP and recording transports all remain open.
