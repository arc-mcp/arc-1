# PR 2 implementation checkpoint — 31 October 2026

PR [#1142](https://github.com/arc-mcp/arc-1/pull/1142) continues the full PR 2 plan. This checkpoint
adds guarded infrastructure; it does not enable additional tools, actions or object types. The
capability matrix, broader operation adapters and live PP qualification remain outstanding.

## Resumed prerequisite/design review

The actual Claude Code `claude-opus-5-5`, effort `max`, completed the previously interrupted review
against immutable revision `03593894c769d6f042a0770f89950c99120fc0aa`. Its
[review](broader-pinned-pp-writes/claude-prerequisite-review2.md) accepts that prerequisite with no
security/blocking finding; this is not acceptance of the complete PR.

| Finding | Disposition |
| --- | --- |
| Cancellation is reported as refusal | Explicitly retain the existing pre-submit refusal envelope. Phase/state and `retryable=false` distinguish the outcome; post-submit uncertainty remains separate. This does not claim rollback. |
| Entire subtree traversal under lock | Fresh pinned checks now exit once a native path proves membership; negative checks retain bounded traversal. Accepted by the hierarchy review with cap/cancellation boundary tests. Phase-local batch sharing remains pending. No cross-check or cross-request cache is introduced. |
| Activation drift after preaudit untested | Added a subtree change after SAP's prompt; no confirmation POST is sent. Hierarchy requests retain the same deadline and signal. |
| Deadline test checked options only | Added a hanging activation POST that actually aborts at the remaining outer deadline. |
| ADR downstream boundaries | Explicitly document TMS/import routes, native DDIC/dependent effects, reader-executed authored tests, native trace subject/read/client scope, service publication and existing drafts. Native client/filter scope remains an admission prerequisite. |
| Missing destination CTS list / create wildcard consequences | ADR now states empty destination denies management and `*` broadens recording plus request management, subject to native authority. |
| Capability-keyed catalog / resolved aliases | Still required before admission; existing reader projection stays unchanged. |
| Inventory only tracked mutation classifications and top-level fields | Added full action lists and all object-valued input contracts in both on-premise/BTP schemas, including quickfix, KTD, batch/activation and FLP fields, plus hyperfocused-alias denial. Custom refinements and supported branch combinations still need behavioral tests. |
| Unbounded recording-helper entry points | All pinned recording/lock lookups require bounded non-replayable options or a registered facade policy; missing/weakened policy refuses before I/O. |

The ADR remains proposed. Documentation names native downstream effects within the owner's selected
single-target-parity scope; it does not assert a transitive package/target sandbox or live qualification.

## Shared native client adapter

`mutationClient` clones the existing own-enumerable client state onto its scoped HTTP facade. It
preserves normal reads and legacy identity/cache behavior on the original client. Existing pinned
source and activation adapters now use it; under-lock package metadata uses the owning SAP session.
Package hierarchy lookups can recover only the facade's registered context, with fresh evidence for
each policy decision. Optional responsibility is omitted for unverified PP mappings; metadata merge
and native-author qualification remain necessary before those broader adapters are admitted.

## CTS verified scope and review loop

`preparePinnedTransport` obtains native parent/task membership with the original deadline and no
replay. It checks both request policies, creates an internal safety/HTTP pair, and binds action plus
selected resource. Caller copies cannot transfer the scope. Create requires global unrestricted
requests and destination `*`; source recording remains independent. Type/state admission is deliberately
the later operation adapter's responsibility.

The first [CTS review](broader-pinned-pp-writes/claude-cts-scope-review.md) found one high, one medium
and four low findings. All are addressed in this follow-up implementation:

| Finding | Fix/evidence |
| --- | --- |
| Known child mutated before later unknown child was rejected | Recursive delete, locked-object cleanup and reassign prevalidate the whole second-read task set. Known-plus-unknown regressions assert zero PUT/DELETE submissions. |
| Task selection could widen to parent/siblings | Submission is restricted to the selected task (or parent-only ordinary release); recursive parent workflows retain verified children. Delete cleanup has a separate internal operation name. |
| Contradictory sibling parent ignored | Conflicting root-level evidence for a nested member now refuses. |
| Release polling outlived context cancellation/deadline | Convergence inherits the scope's signal and epoch deadline, including sleep/stop decisions; local release-admission failures carry `notSubmitted` evidence. |
| Parser coverage mismatch | Committed native A4H fixture and live parent/task inspection pass. Standalone task evidence requires a second parent read. Recursive workflows refuse missing/duplicate/unknown second-read members, including parser omissions, rather than silently skipping them. |
| Safety/transport runtime cycles | Pure allowlist and MIME/state modules break the new cycle; legacy transport exports remain available. |

The [foundation follow-up](broader-pinned-pp-writes/claude-foundation-review.md) found no high or
medium defects and eight low findings. These are fixed: the same raw CTS document is validated
before operation parsing (including sibling tasks); task-selected removal cannot widen scope;
release admission and owning-session behavior have regression tests; the native test reads a
selected task; nested input discovery covers both platform variants; inventory and ADR wording
are corrected. The separate [hierarchy review](broader-pinned-pp-writes/claude-hierarchy-review.md)
accepted early-positive-exit source code; its four requested boundary tests were added.

The actual Claude Opus 5.5 max [closing review](broader-pinned-pp-writes/claude-foundation-closure-review.md)
**accepts this prerequisite delta**, with no high/medium defects or observed regression. Its two
nonblocking test follow-ups were also added: second-read omission/conflict/duplicate cases and
strict HTTP-session identity assertions. This closes the foundation loop only; it is not full PR 2
or PP acceptance. Review manifests identify exact source snapshots; subsequent capability-table
changes require their own review.

## Verification and remaining work

The direct-auth A4H client-001 source lifecycle passed: source save, stale-hash refusal, reacquired
lock, pinned activation, delete and independent GET 404. A new CTS lifecycle also created a disposable
`$TMP` request, froze its native children, deleted it through the prepared scope and verified GET 404.
The committed native test also prepares a selected-task scope and verifies its canonical parent.
Its latest disposable request, A4HK906594, was deleted and independently confirmed absent (404). No transport was
released. These tests exercise native adapters with direct credentials, **not XSUAA/PP routes**.

Typecheck, lint, action policy, build and file/schema budgets pass. The full unit run initially had
one subprocess-startup timeout in the unchanged shutdown test. The isolated rerun passed all 12
tests; the subsequent full run passed **385 files / 10,642 tests**. The strict documentation build
also passed. The subsequent foundation-fix suite passed **385 files / 10,653 tests**, and focused
follow-up assertions passed. Final combined gates are recorded separately. No application
environment or role assignment was changed by these code checks.

CI on `87dcd620a` stopped at a newly indexed dependency advisory, before unit execution. The lockfile
now selects `follow-redirects` 1.16.2, the [patched release](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p);
only its version, resolved URL and integrity changed. The security audit passes without an exception.

Continue the reviewed P2-B through P2-H adapters and matrix, include native identity/state/recording
proof, then complete isolated PP qualification and operator documentation. Aggregate, Basic and
read-only destinations retain their existing surfaces. Git and plugins remain excluded. FEAT-93
stays open and this draft remains unready for merge or deployment.
