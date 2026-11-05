# Private CTS review corrections — 2 November 2026

This is the author disposition of the independent source review of
`0ceb45fde67ce9ff575138804bd5ea703a43bbeb`. The
[verbatim report](broader-pinned-pp-writes/codex-cts-review1-20261102.md) is retained unchanged;
its SHA-256 is `8ae6fcfaa44486d99a8079822822074a4592b2477fd0300ce8e7ed8fdcd1c064`.
Codex performed the independent review after actual Claude
capacity was exhausted and the owner authorized fallback. The independent correction review below accepts private integration. They do not admit any public CTS capability or establish native qualification.

## Finding dispositions

| Finding | Correction and regression evidence | Remaining acceptance |
| --- | --- | --- |
| P2: incomplete/malformed inactive evidence | The private precheck accepts only the established rich inventory shape at the root, entry, object, transport and reference levels. Unknown attributes, child shapes and completeness/paging metadata refuse, including apparent zero counts. A recording name must be a canonical CTS ID; a supplied URI must identify that same ID; a supplied parent URI must identify a different canonical parent. Padding, foreign/ambiguous identity and conflicting references cannot make an inactive entry appear unrelated. Handler tests verify zero submissions for malformed/incomplete evidence, typed complete-empty and explicitly unrelated positives, and refusal of a child assignment to the selected parent. | Supported-profile native completeness/assignment qualification. |
| P2: created description not verified | Namespace-bound native `tm:desc` is retained without trimming or numeric coercion and compared exactly to the required description. Both package-routed and explicit-target creates independently GET the created organizer request. Missing, changed, padded, foreign-namespace or duplicate-bound descriptions leave one acknowledged POST incomplete, with no second POST, PUT or rollback DELETE. Positive tests cover matching ordinary, escaped and numeric-looking text. | Exact native description readback for both creation routes. |
| P2: transient child expansion forgotten | A per-call set monotonically records children outside the frozen membership from every organizer GET, including legacy convergence reads, strict terminal proof and final verification; convergence-result expansion is merged too. The private HTTP boundary refuses any later mutation after such an observation, including an observation made in the engine's own preflight. All exit paths retain the observed IDs. Later omission/read failure cannot restore overall success or erase prior confirmed effects. Tests cover transient/stable expansion, failed later reads, uncertain POST outcomes, recursive stop after the first task, and pre-POST refusal. | Native expansion/partial-result qualification. |

The ordinary single-target transport implementation is unchanged. The added observer and
pre-mutation hook exist only on the private CTS wrapper. All calls retain the registered operation
context, one response/attempt/deadline allowance and no-replay policy. Description and inactive
checks use existing bounded native XML evidence; raw documents and diagnostics stay out of results.

## Offline evidence

The first regression run against the reviewed implementation failed **30 of 92 handler tests**,
reproducing all three reported defects and related adversarial cases. The corrected focused suites
pass **143 tests in 3 files**, including the existing real HTTP no-replay/budget tests. The test fixture
now emits the native description for both successful creation routes instead of silently omitting it.
The later uncertain-release regression additionally requires the legacy engine's actual unverified
`unknown` result, rather than inferring that result from the outer private status.

Full author gate results and command logs are retained at
`~/.local/state/arc1-review/pr1142-cts-author2/result.md`. No SAP/native execution, network calls,
credentials, deployments, role changes or public action admission were performed.

## Remaining qualification

FEAT-93 remains open. The correction passed a new immutable independent review.
A native experiment still requires its own reviewed exact revision: capture complete rich inactive metadata
and assignment URI/parent semantics on each supported profile; verify exact description preservation
through both create routes; qualify task/request terminal states, typed absence and observed
concurrent-child effects without pretending the tree is atomic. Retain no-replay and partial-outcome
evidence, successful writes as two differently mapped PP developers, negative policy/scope/target
controls and complete fixture restoration. The broader native matrix, role composition and coordinated
public capability/schema/OAuth/operator admission requirements in the
[CTS candidate report](2026-11-02-pinned-cts-management-candidate.md) still apply. Synthetic adversarial
responses are unit evidence only, not assertions about observed SAP behavior.

## Independent correction acceptance

The [second review](broader-pinned-pp-writes/codex-cts-review2-20261102.md) closed all three P2s
at `91314dd72`, independently passed 327 focused tests and verified the immutable snapshot.
The candidate is integrated with the other private adapters. Native contract evidence, current-code
two-writer PP, realistic role composition and coordinated public admission remain open.
