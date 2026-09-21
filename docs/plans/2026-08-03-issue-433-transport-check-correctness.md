# Issue #433: transport-check correctness

**Status:** Implemented, validated, and final-reviewed

**Scope:** Correct the private ADT `transportchecks` response contract, expose create/modify intent,
bound the newly visible candidate list, and correct the Workbench-request documentation.

## Objective

Make `SAPTransport action=check` and every internal transport preflight interpret SAP's real CTS
response correctly. The change must detect an existing object lock, return modifiable candidate
requests, distinguish create from modify, preserve useful SAP diagnostics, and remain safe on
SAP_BASIS 750, 758, and 816.

This is the first coherent implementation slice from issue #433. Release reports and the main token
controls are already shipped. Release overrides, create idempotency, dependency readiness, and
transport-of-copies mutation are separate designs with different safety contracts and are not mixed
into this correctness PR.

## Research evidence

### Public SAP behavior

- SAP's CTS documentation says repository objects are connected to CTS through their package.
- SAP's manual object-list documentation says copied/manual entries are initially unlocked and CTS
  checks them no later than release to avoid transporting an undefined intermediate state.
- XCO CTS exposes `IGNORE_OBJECTS_CHECK` as the programmatic equivalent of explicit interactive
  confirmation for noncritical checks such as ATC. That supports a later two-phase override design,
  not a boolean added to ordinary release.
- SAP documents transport-of-copies as a distinct request kind whose object list can be copied from
  original requests. It is not evidence that `CreateCorrectionRequest` can infer request kind.

References are recorded in
[`docs/research/2026-08-03-issue-433-follow-up.md`](../research/2026-08-03-issue-433-follow-up.md).

### Private ADT contract: live release matrix

SAP does not publish the `transportchecks` ABAP-XML schema. The contract was therefore verified with
read-only calls through ARC-1's actual HTTP stack and compared with the installed official Eclipse
ADT transport model and `abap-adt-api`'s independent parser.

| System | Package/scenario | Observed result |
|---|---|---|
| NW 7.50 SP02 | `$TMP`, missing class | `DLVUNIT=LOCAL`, empty `REQUESTS`/`LOCKS`; same top-level contract |
| NW 7.50 SP02 | `ZLOCAL`, missing class | `RECORDING=X`; same `REQUESTS`/`LOCKS` contract |
| SAP_BASIS 758 SP02 | locked interface | `KORRFLAG=X`, blank `RECORDING`, parent under `LOCK_HOLDER/REQ_HEADER`, task under `TASK_HEADERS/CTS_TASK_HEADER` |
| SAP_BASIS 758 SP02 | missing class in transportable package | `RECORDING=X`; modifiable requests under `REQUESTS/CTS_REQUEST/REQ_HEADER` |
| SAP_BASIS 816 | `$TMP`, missing class | `DLVUNIT=LOCAL`; same contract plus additive `RECORD_CHANGES` |
| SAP_BASIS 816 | `ZLOCAL`, missing class | `KORRFLAG=X`, `RECORDING=X`, candidate under `REQUESTS/CTS_REQUEST/REQ_HEADER` |

Create (`OPERATION=I`) and modify (`OPERATION` empty) were both accepted and echoed. The sampled 758
objects produced the same recording/lock result for both operations, but operation is a real input to
SAP and may differ by object type or backend patch level.

### Root cause in ARC-1

`parseTransportInfo()` currently expects two structures not returned by the live systems:

- candidates at `TRANSPORTS/headers` instead of `REQUESTS/CTS_REQUEST/REQ_HEADER`;
- a lock at `LOCKS/HEADER` instead of
  `LOCKS/CTS_OBJECT_LOCK/LOCK_HOLDER/REQ_HEADER`.

Consequences:

1. `SAPTransport check` reports no candidates and can say “does not require transport recording” for
   an object already assigned to a transport.
2. `SAPTransport history` misses candidates in its fallback path.
3. `SAPWrite create`/`batch_create` and `SAPManage create_package`/`change_package` fail to auto-use a
   real existing object lock.
4. Existing tests preserve invented/simplified XML rather than the release-tested shape.

## Reviewed design

### 1. Correct and harden the low-level parser

Extend `TransportInfo` with additive fields:

- `operation`: SAP's echoed raw operation (`I` or empty);
- `result`: SAP's result code;
- `correctionFlag`: whether `KORRFLAG=X`;
- `existingRequestOnly`: whether `EXISTING_REQ_ONLY=X`;
- `messages`: parsed CTS message severity/text/class/number;
- `lockedTransportOwner`;
- `lockedTasks`: task IDs below the lock holder.

Parse candidates by iterating each `CTS_REQUEST`, then reading its own `REQ_HEADER`. Do not call
`findDeepNodes(REQUESTS, 'REQ_HEADER')` directly: that helper intentionally returns the first matching
branch and would silently drop all but the first request.

Parse every `CTS_OBJECT_LOCK`, its `LOCK_HOLDER`, parent `REQ_HEADER`, and
`TASK_HEADERS/CTS_TASK_HEADER`. Keep the old `TRANSPORTS/headers` and `LOCKS/HEADER` forms as a
compatibility fallback until evidence proves they never occur on a supported release.

Parse `MESSAGES/CTS_MESSAGE`. If a message has severity `E`, `A`, or `X`, throw a transport-check
error instead of returning `recording=false` and allowing a caller to infer that no transport is
required. Internal SAPWrite/SAPManage preflights already degrade gracefully when the check itself
fails; the explicit `check` action will surface the backend diagnostic.

### 2. Add a typed operation selector

Add optional `operation: "create" | "modify"` to both the Zod schema and JSON Schema. Default to
`create` for backward compatibility and map it only at the handler boundary:

- `create` → `I`
- `modify` → empty string

Keep the low-level input narrow (`'I' | ''`) so an arbitrary action cannot be interpolated into the
ABAP XML.

### 3. Make the result unambiguous

For the explicit `check` response:

- evaluate an existing lock before `recording`;
- `transportRequired` is true when SAP requests recording or the object is already locked;
- add `transportAssignmentRequired` to distinguish “needs a request now” from “already assigned”;
- include the selected `operation`, parsed result/messages, lock owner, and task IDs;
- use operation-specific summary language (“creation” or “modification”).

Do not use `KORRFLAG` as the sole requirement signal: the 7.50 spike returned `RECORDING=X` with an
empty correction flag. Preserve it as evidence, but base behavior on local status, recording, and
the lock.

### 4. Bound candidate output

Correct parsing turns a previously empty array into dozens of requests on a busy developer system.
For `check`, show at most 10 by default and honor the existing `maxResults` parameter. Return total,
shown, and truncation metadata. Keep the low-level complete list because write preflights already
select at most 10 for guidance.

Apply the same existing `maxResults` bound to the `history` fallback so the corrected parser cannot
make that action unexpectedly unbounded.

### 5. Correct request-kind documentation

`CreateCorrectionRequest` creates a Workbench (`K`) request. A package or transport layer influences
the route/target, not whether SAP creates K/W/T. Remove the remaining statements that claim SAP
infers K/W/T from the package. Transport-of-copies needs a separately researched action.

## Test plan

### Unit contract tests

- add sanitized XML fixtures for a candidate-list response and a locked-object response;
- parse every candidate request, parent lock, owner, and task ID;
- prove blank `RECORDING` plus a lock is not treated as “no CTS”;
- preserve the old simplified response as a compatibility fallback test;
- parse warning messages and reject `E`/`A`/`X` messages;
- prove create emits `<OPERATION>I</OPERATION>` and modify emits an empty operation;
- handler tests for create/modify mapping, locked summary, assignment-required response, and
  candidate truncation;
- schema tests accept the two operation values and reject arbitrary strings;
- run schema-key parity and tool-definition snapshot tests.

### Integration and repository validation

- add a read-only live integration test against `$TMP` for both operation forms;
- run focused ADT, handler, schema, tool, and integration tests;
- run lint, typecheck, build, file/schema budgets, and the full unit suite;
- re-run read-only live checks on 750, 758, and 816 after implementation;
- review the final diff for secret leakage, accidental CTS mutations, schema bloat, and unrelated
  changes.

## Plan review

### Accepted

- The parser correction is release-backed, additive, and fixes four existing call paths.
- The operation selector is a small public input with a stable default.
- Bounding candidate output is required to prevent the correctness fix from regressing token use.
- Raw release-specific evidence belongs in fixtures/tests; runtime code remains structural rather
  than hardcoding SAP release numbers.
- The change stays read-only on SAP. No new authorization or safety-policy action is needed.

### Rejected or deferred

- **Release overrides:** require a fresh release report, state-bound confirmation, a new server safety
  ceiling, and dedicated audit/policy actions. The live `relObjigchkatc` call rejected stale object
  checks, proving it is not a stateless boolean.
- **Ignore locks by default:** conflicts with SAP's undefined-intermediate-state warning.
- **Description-based create deduplication:** request text is not unique and races across agents.
  Explicit idempotency needs a SAP-visible marker and cross-instance semantics.
- **Self-contained guarantee:** static references do not represent the target system's deployable
  CTS closure. A future advisory readiness report must be labeled heuristic.
- **Core `TR_OBJECTS_*` helper:** Eclipse advertises REST relations for `addobjectfromrequest`, package
  addition, merge, move, and prepare-release. Capture/replay those before considering a
  customer-installed helper.
- **Parallel recursive writes:** no measured latency case or batch endpoint justifies the enqueue and
  partial-failure complexity.

## Acceptance criteria

- Live-shape fixtures return all candidates and the correct lock parent/task.
- `SAPTransport check operation=modify` sends an empty `OPERATION`; omitted operation remains create.
- A locked object produces `transportRequired=true` and `transportAssignmentRequired=false`.
- A transportable unlocked object with `RECORDING=X` produces both values true.
- Candidate output is bounded and reports truncation without hiding the total.
- Internal SAPWrite/SAPManage callers receive the corrected lock/candidate data without API changes.
- Existing legacy fixtures and release behavior remain green.
- All focused, full-unit, static, build, and size checks pass.

## Implementation and validation record

Implemented the reviewed slice without adding a CTS mutation or authorization action. The final
code parses the live candidate and lock-holder structures, rejects fatal diagnostics returned with
HTTP 200, exposes the create/modify selector, distinguishes an existing assignment from a new one,
bounds candidate output, and corrects the Workbench-only create contract in the public tool surface.

Validation completed on 2026-08-03:

- focused ADT/handler/schema/tool tests: 522 passed;
- full unit suite after snapshot review and rebase to current `main`: 4,865 passed across 168 files;
- live read-only integration test on SAP_BASIS 758: create and modify checks passed;
- read-only `$TMP` create/modify matrix: passed on SAP_BASIS 750, 758, and 816;
- read-only `ZLOCAL` matrix: `RECORDING=X` on all three; corrected parser returned 0, 57, and 5
  candidates respectively, while 750 correctly retained blank `KORRFLAG`;
- lint, typecheck, build, strict MkDocs build, file-size ratchet, and all tool-schema budgets passed;
- final diff check found no whitespace errors, credentials, new write path, safety-gate change, or
  unrelated runtime behavior.

The final review retained every deferred item above as deferred. In particular, this change does
not implement release overrides, request deduplication, readiness guarantees, transport-of-copies
creation, or parallel CTS mutation.

### Follow-up review: transport skills and status semantics

After the initial implementation, review of the first-party transport skills found that they used
the legacy `history` name as if the action returned complete request membership. The follow-up slice
therefore also:

- documents `relatedTransports` as the current lock request (at most one) and
  `candidateTransports` as assignment choices, never history evidence;
- removes unsupported `$TMP`, age, and negative-lock inferences from the transport overview;
- makes the transport-review skill distinguish raw CTS entries from `SAPRead` object types and label
  unresolved `LIMU`/`LANG` subobject coverage;
- corrects released/open snapshot selection guidance and requires explicit coverage labels;
- makes ATC opt-in or risk-triggered and keeps activation explicit because both are outside a
  passive review;
- corrects dependent first-party skill, tool-schema, API, roadmap, and feature-matrix wording;
- adds regression assertions for public tool wording and for the no-current-status response.

The future first-class transport-level diff remains separate: it needs CTS-reference URI
normalization, deduplication, structured aggregation, and bounded patch output. Adding that feature
to this correctness PR would mix a new public action with the parser fix and documentation repair.

Follow-up validation on 2026-08-03:

- focused handler/tool/schema-snapshot suite: 168 passed; six intentional tool fixtures updated;
- full unit suite: 4,867 passed across 168 files;
- read-only live 758 current-lock integration: passed (the remaining 18 tests were excluded by the
  focused name filter);
- lint, typecheck, build, strict MkDocs build, file-size ratchet, and every tool-schema budget passed;
- manual diff review confirmed no new CTS mutation, authorization change, package inference, or
  accidental inclusion of the local untracked `system-info.md` file.
