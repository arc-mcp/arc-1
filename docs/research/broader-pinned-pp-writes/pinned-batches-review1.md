# Independent review — private pinned batches

## Verdict

**CHANGES REQUESTED before private integration: one Low / P3 input-validation finding.** No P0, P1 or P2 finding was confirmed. The single correction should be regression-tested and reviewed on the resulting immutable source. This verdict does not approve native execution, PP qualification, public capability admission or the whole PR.

Candidate: `ba0f21182871d14b1f072a6dd418e21b0b05fd59`, base `98f2f63fbd86e0ee9a4ca5d4071edcac8b4396d5`. The supplied diff includes the independent dotenv-isolation commit `2d1f474cc37866c65c98a1a0c4bf57680ea30b83` and the batch feature commit unchanged. The reviewer authored neither this batch implementation nor its tests.

## F1 — P3: Require an own property when detecting stripped batch fields

Location: `src/handlers/write/pinned-batch-input.ts:61` (`noDroppedFields`).

The guard uses `key in parsed` to decide whether Zod preserved a raw property. That also accepts inherited properties of `Object.prototype`. Consequently, otherwise valid JSON create items containing an unknown `toString`, `constructor` or `hasOwnProperty` property pass this guard after the schema has discarded those fields. The batch proceeds instead of obeying its documented complete-input refusal boundary.

Independent probes added each of those three fields with the string value `unrecognized` to a valid one-item CLAS create. All three returned `state: confirmed` and sent one create and two activation POSTs through the real shared adapters under mocked HTTP. The expected refusal assertions failed. This is an input-contract defect, **not evidence of broader target/package/scope authority**.

Use own-property membership, such as `Object.hasOwn(parsed, key)`, and add regressions for inherited-name fields at both the item and nested metadata levels. They should fail before any native request; existing valid/defaulted item handling and ordinary single-target behavior should remain unchanged. The private contract should not silently permit these names merely because JavaScript supplies matching prototype properties.

Evidence: `codex-probes.test.ts`, `codex-probes.log`. The three failing assertions report `{field, mutations: 3, state: "confirmed"}`.

## Reviewed behavior and evidence

The review covered the complete supplied implementation diff, the author report/research, governing instructions and security invariants, accepted activation/batch plan, and FEAT-93 at start and finish. In particular:

- Complete immutable input capture, raw/resolved/source/structural bounds, duplicate/conflicting owner handling, trusted scope parameters, strict pinned target/write checks and independent deny/package/recording constraints.
- Shared single-create header/body/quality preflight and family contexts; preparation of every initial activation owner before preaudit; the documented per-step binding definition check for explicitly ordered SRVD/SRVB creation.
- The extracted activation preparation/completion boundary, strict raw reference parser/count, unique partitioning, whole-set shape checks before fresh evidence checks, and shared deadline/no-replay propagation.
- Terminal ED064/ambiguous outcomes, cleanup failure, cancellation, retained saved/native reports, unconfirmed unverified owners, and the monotonic union of attempted activation scope.
- Legacy single-target defaults and ED064 behavior; public schemas, capability matrix and dispatch remain closed. Unsupported SDO creation, whole-group/include, ENHO/SKTD and immediate-active combinations remain explicit limitations.

No additional actionable defect was confirmed. The private candidate's broad mock coverage is useful orchestration evidence, not native parity or PP proof. FUNC/SRVB/native subtype, actual partial-result and transportable behavior still require the documented native qualification.

| Reviewer check | Result | Evidence |
| --- | --- | --- |
| First actual source action: snapshot verifier | 4,633 files unchanged at candidate revision | Initial tool result |
| Focused batch/helper, activation, DDIC/declarative/FUNC/program and ordinary devtools/create regressions | **12 files / 617 tests passed** | `codex-focused.log` |
| Independent probes | **2 passed; 3 failed**, all three failures reproduce F1 | `codex-probes.log` |
| Source/scripts/tests typecheck | Passed | `codex-typecheck.log` |
| Full lint | Passed; only existing informational suggestions | `codex-lint.log` |
| Policy | Passed | `codex-policy.log` |
| File/schema sizes | Passed | `codex-sizes.log` |
| Final source action: snapshot verifier | **4,633 files unchanged**, same revision | `codex-snapshot-final.log` |

The two passing independent probes verify that native execution on the first POST is reported for exactly the complete authorized input, and that a second preaudit response causes no third POST or addition of merely inspected foreign references to attempted scope. Probes and configuration are outside the snapshot. The author reported 524 files / 14,594 full unit tests plus build/docs passes; those full-suite/build/docs results were not rerun or relabeled as reviewer execution.

## Incident and boundary preservation

The inherited dotenv incident is retained: the author's first full run imported the existing integration helper through a unit test and implicitly loaded 17 workspace `.env` values. The author reports that no values were inspected/printed and no live helper client was invoked. The supplied five-line, file-local hoisted `vi.mock('dotenv', ...)` prevents that import side effect without changing production dotenv loading. This review inspected it unchanged and its three unit tests passed; parent integration of the equivalent isolated fix as `42a117f7` does not alter this snapshot's identity or erase the incident.

Reviewer focused/probe logs contain no dotenv-load, `getaddrinfo`, `ENOTFOUND` or `ECONNREFUSED` output. HTTP-bearing probe imports follow the existing undici mock prologue; no live SAP/BTP/credential/browser/native/network workflow, installation, manual Git command, source edit or delegation was performed. Two orchestration syntax errors prevented tool execution; an initial external probe import-path error ran zero tests and was corrected only outside the snapshot (`codex-probes-setup.log`). The first verifier attempt targeted a nonexistent parent-level filename without reading source; the first actual source action used the required `review-input/verify-snapshot.py` successfully. The final verifier passed before this verdict was written, with no later source action.

Public admission, current-code native/two-writer PP, final caps measured under PP latency, read companions, publication and currently unsupported batch combinations remain separate gates. This report grants no native/public/whole-PR approval.
