# PR 1: shared mutation infrastructure

Status: proposed implementation plan; no runtime changes in this planning branch.
Date: 26 October 2026. Baseline: `e538bf71197ddb47ea74aca225c340a856d331af`.
Proposed PR title: `refactor: share mutation lifecycle primitives without changing write behavior`.
Followed by [PR 2](2026-10-26-broader-pinned-pp-writes.md).
Context and owner decisions: [research record](../research/2026-10-26-multi-target-write-parity.md).

## Outcome and boundary

Both single-target and pinned PP object mutations use shared lifecycle primitives, while their
existing policy and observable behavior remain unchanged. This makes the PR 2 expansion reuse
working object adapters instead of growing a second complete write implementation.

This is a bounded extraction, not an attempt to make every SAP mutation use one algorithm.
CLAS source, DDIC metadata, FLP OData and transport release have different protocols. Share the
mechanics and explicit policy context; retain protocol-specific adapters.

PR 1 must not enable another action/type/input, alter OAuth or role templates, add configuration,
relax package/CTS checks, change defaults, introduce persistence, or add Git/plugins. Existing
aggregate, Basic and pinned-reader catalogs and direct-call denials stay unchanged. The current
CLAS/INTF writer still requires its hash and whole-owner activation contract.

## Baseline differences to preserve

| Area | Single-target baseline | Pinned PP baseline |
| --- | --- | --- |
| Source hash | Optional on supported text operations. | Required on existing CLAS/INTF main updates and CLAS method edits. |
| Recording | Legacy operation-specific preflight and explicit-or-lock `corrNr`. | Positive locality/CTS evidence; both request policies; verified parent/task relationship. |
| Source save | Existing source/metadata/include helpers and results. | Locked package/recording revalidation and exact readback with limited newline normalization. |
| Session/request retries | Existing per-operation policies, including existing create/activation protections. | No transient/auth/session-reset/CSRF/negotiation replay within the mutation session. |
| Cleanup | Existing helper behavior, including legacy error propagation. | Separate bounded cleanup budget; primary outcome retained and cleanup status attached. |
| Activation | Existing preaudit, batch and qualified ED064 recovery. | Required reference validator, positive execution evidence, one owner, no batch/recovery bypass. |
| Results | Existing text/JSON/error shapes and cache effects. | Existing target, state, phase, stored hash, partial/unknown outcomes and retryable=false semantics. |

Sources: `src/adt/crud.ts`, `src/adt/devtools.ts`, `src/handlers/write/pinned.ts`,
`src/handlers/write/pinned-activation.ts`, `src/handlers/dispatch.ts`.
Do not change an undesirable legacy behavior incidentally. Record a separate defect when found;
only a deliberate follow-up may change it.

## Proposed internal design

Names below are provisional; the required responsibilities are the contract.

### Explicit execution context

Introduce a required discriminated context at the new internal coordinator boundary:

- `single-target`: preserve current caller semantics and policies.
- `pinned-pp`: carry the already verified immutable target/write policy and strict lifecycle
  requirements. A disabled or missing pinned context cannot select single-target behavior.

Construct the context from server/client state, never tool arguments. Require it through every
new shared call site so omission is a type error. Existing exported client methods can retain
their signatures for compatibility, but wrappers must derive the context from actual safety state;
they must never manufacture a single-target context for a client carrying multi-target state.
Keep the selected SAP client and session owned by that request. No global mutable current-target
variable and no cross-user/target session store.

The context has required request-policy, recording-policy, SAP-identity-mode and activation-policy
slots. A policy may explicitly declare a legacy behavior or an operation inapplicable; an omitted
slot must not mean permission. Pinned identity starts as `mapped-user-unverified` unless native SAP
evidence proves the user. That is distinct from the authenticated human's JWT display identity.

### Shared mechanics with explicit adapters

Extract only proven common sequences:

1. Stateful session acquisition and owning lock lifecycle.
2. A required policy callback before the first mutation and, where the current path has one,
   revalidation after acquiring the lock.
3. Native source read/transform/hash/save primitives, with the existing per-mode choices.
4. Request/deadline/cancellation policy delivered to every nested mutation in the extracted paths,
   including APIs that currently do not accept request options.
5. Cleanup using the same session and the mode's existing budget/error precedence.
6. Internal progress reporting sufficient for the existing result formatters to report unchanged,
   saved, partial and unknown outcomes without inventing transactional rollback.

Leave real-package resolution in the shared package primitives, and CTS validation in the existing
pinned recording adapter. Do not hoist metadata reads out of a lock or replace verified checks
with a callback that defaults to a no-op for pinned clients.

Keep output formatting at the existing handlers during this PR. Extract `pinnedFailure` into a
small result module if needed to avoid an activation handler importing the entire write handler;
preserve its serialized behavior. Do not normalize the legacy and pinned result formats now.

### Request-policy delivery

Use a request-local scoped HTTP facade carrying the required context, rather than relying on
`withStatefulSession` options to affect requests. Today those session options govern closure,
and `postCreate` suppresses transient retries but not every auth/CSRF/negotiation replay.
The facade composes `{noReplay: true, retryTransientErrors: false, deadline, signal}` into all
requests participating in the pinned mutation lifecycle, including lock-time reads. It propagates
the same policy to the stateful session view and cannot be weakened by a nested adapter. Cleanup
uses an explicit separate bounded policy on that same owning session. Ordinary reads outside the
mutation scope retain their existing retry behavior.

At the new pinned low-level entry points, require the scoped facade/context before any modifying
request; missing context refuses. Do not infer mutation from HTTP verb alone for standalone
syntax/ATC/read-like POSTs. In PR 1, wire the existing pinned pipeline and selected single-target
CRUD consumer only. The single-target facade/profile preserves the absence of request options
where that is current behavior. PR 2 must extend this boundary to every newly admitted adapter,
including direct HTTP calls, and test actual request options at the transport layer.

Characterize `lockObject`'s option-dependent `localityKnown` property and legacy unlock error
precedence explicitly. Do not pass a new empty options object on the single-target path if that
would change the lock result. Do not hide an unlock failure that currently fails a successful save
or replaces an earlier error. These behaviors may be improved deliberately after PR 1.

### First production consumers

Use both the existing pinned CLAS/INTF write pipeline and single-target `safeUpdateSource` as
the initial consumers of the shared lock/session mechanics. Add `safeUpdateClassInclude` only
where its initialize-under-parent-lock sequence can remain identical. The new helper is not
complete if only a new unit test or only the pinned handler uses it.

Keep type-specific create XML, method splice implementations, metadata updates and readback
normalization in their current adapters. A source-surgery algorithm change is not part of this
refactor. PR 2 can move the remaining callers as their expanded policy is implemented.

PR 1 retains `handlePinnedWrite` as the existing policy/result adapter and makes it consume the
shared mechanics. PR 2 converges CLAS main, includes, surgery and other types on the common
SAPWrite dispatch plus protocol adapters, then removes the overlapping dedicated pinned write
orchestrator. Pinned policy/result helpers remain reusable; a separate full mutation stack does
not. Both SAPWrite and SAPActivate use the same context discriminator, replacing their current
different config-versus-safety routing tests. That convergence belongs to PR 2, not this refactor.
PR 2 also replaces or generalizes `handlePinnedActivation` into one activation adapter used by
SAPActivate and nested callers; its current CLAS/INTF-only validator cannot remain a second path.

### Activation seam

Reuse the existing activation implementation and validator hook. Extract common request/result
mechanics only if the call graph and emitted requests stay identical. Explicit mode requirements
must preserve low-level refusal of missing pinned validation, foreign references, batch activation
and recovery paths. Keep the scope-expanding activation design entirely in PR 2.

If activation extraction adds abstraction without removing duplication, limit PR 1 to explicit
context plumbing and result-module separation; do not rewrite the activation state machine.

## File map

| Work | Existing files | Possible new files |
| --- | --- | --- |
| Lifecycle extraction | `src/adt/crud.ts`, `src/adt/http.ts`, `src/adt/http-deadline.ts` | `src/adt/mutation-context.ts`, `src/adt/mutation-session.ts` |
| Existing pinned adapter | `src/handlers/write/pinned.ts`, `src/adt/pinned-write-policy.ts` | Small pinned-result module if needed |
| Existing source/include adapters | `src/adt/crud.ts`, relevant `src/adt/client.ts` wrappers | None required |
| Activation boundary | `src/adt/devtools.ts`, `src/handlers/write/pinned-activation.ts` | None unless extraction removes real duplication |
| Context construction | Existing safety/runtime and handler entry points actually touched | No new public schema or config |
| Regression coverage | `tests/unit/adt/crud.test.ts`, `tests/unit/handlers/pinned-writes.test.ts`, `tests/unit/handlers/source-preconditions.test.ts`, `tests/unit/adt/activation-timeout.test.ts` | Shared lifecycle tests if they prove cross-mode behavior |
| Documentation | Relevant `docs/dev-guide.md` routing and FEAT-93 | No shipped capability claims |

Do not preemptively edit all files in the table. A minimal safe seam is preferable to a general
framework with dozens of optional hooks.

## Commit sequence

1. **Characterize behavior.** Freeze existing tool-definition fixtures and representative wire
   request/order/result expectations for both modes. Cover success and failure branches that the
   extraction will touch. Record baseline build and test results.
2. **Extract mechanics.** Move shared code with required mode/context; keep legacy exports as
   thin adapters. Adopt it in one existing single-target path and the existing pinned path.
3. **Finish consumers and results.** Remove replaced duplicate mechanics, preserve include/session
   behavior, separate result helpers if useful. Do not leave an unused framework behind.
4. **Verify and document.** Re-run required checks, perform the bounded live equivalence check
   where available, record gaps and update routing documentation.

Use small behavior-preserving commits. Run the repository's full refactor gate after each coherent
extraction as required by the Engineering Playbook; do not change expected fixtures to make an
unexpected behavior difference disappear.

## Acceptance matrix

| Scenario | Required result |
| --- | --- |
| Existing single-target source update without hash | Same requests and successful result as baseline. |
| Existing single-target source/include update with correct or stale hash | Same comparison scope, lock ownership and refusal behavior. |
| Existing pinned create/update/edit_method | Same policy checks, source bytes, SAP normalization and stored-byte hash. |
| Pinned missing hash, package drift, task mismatch or request denial | Same denial phase; no later save or activation. |
| Mutation response loss, 429/5xx, CSRF/auth/session error | Existing per-mode replay behavior unchanged; pinned mutation never gains automatic replay. |
| Cancellation before/after lock and during readback | Preserve submitted/unsent phase classification and appropriate cleanup. |
| Unlock and session-close failure | Preserve mode-specific primary-error precedence and cleanup reporting. |
| Pinned activation initial refs and expanded refs | Required validation before every possible mutating activation submission. |
| Missing/disabled pinned context at a low-level entry point | Refuse; never run through the legacy path. |
| Read through a writable pinned client | Existing read retry behavior remains available; mutation policy does not disable unrelated reads. |
| Same object name on two targets/users | Request client, session, CTS evidence and audit target stay distinct. |
| Tool catalogs, annotations and strict-schema variants | Byte-identical fixtures and behavior for all existing modes. |
| Single-target cache invalidation | Same confirmed/uncertain mutation invalidation behavior. |

Focused tests include existing pinned/multi-target write, CRUD, source-precondition, activation,
class-surgery concurrency and error-format suites. Inspect the actual dependency graph before
choosing more. Final required gate:

```sh
npm test
npm run typecheck
npm run lint
npm run validate:policy
npm run build
npm run check:sizes
```

Live check: on an authorized disposable fixture, compare the current main-source lifecycle through
single-target and pinned PP connections, verifying author, saved/active bytes, CTS recording and
cleanup. Record exact build and SAP release/auth route. Existing PR #1080 evidence does not prove
the refactor. If live access is unavailable, state precisely which equivalence remains unverified.

## Merge and handoff to PR 2

PR 1 is independently reviewable and useful: actual shared production code, no broader capabilities,
no changed tool schemas, no new authorization semantics, and no undocumented output/retry changes.
Do not merge merely scaffolding that PR 2 might later use.

Rebase PR 2 onto the merged PR 1 and preserve its baseline characterization tests. PR 2 owns all
new per-type adapters, runtime permission changes, OAuth/role work and the broader ADR/security
review. Any single-target behavior improvement discovered during PR 1 must be explicitly scoped
and tested in the later change rather than hidden in this refactor.

Roadmap impact: FEAT-93 remains unfinished after PR 1; record the shared foundation and retain
the complete expansion gap. Research-only preparation does not mark PR 1 implemented.
