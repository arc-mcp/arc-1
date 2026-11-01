# Independent review dispositions

Date: 26 October 2026. [Original Claude report](claude-review.md).
Only research/planning documents were changed in response; no runtime behavior was fixed or tested.
The report's prospective CTS fail-open concern is about enabling new actions naively, not a claim
that the currently disabled multi-target transport management is reachable.

## Corrections applied

| Finding | Disposition in revised plans |
| --- | --- |
| F1 — pinned CTS guards read an unrestricted legacy list | Accepted. PR 2 names the actual `allowedTransports=[]` runtime trap. Require multi-target branches in both low-level guards, derived transport enablement, async verified parent/tree context for synchronous checks, separate pre-ID creation admission and negatives constructed from the real runtime factory. |
| F2 — text-pool activation conflicts with mandatory preaudit | Accepted. Choose a narrow internal exact-text-pool policy, allowing preaudit=false only for the validated pool URI, followed by explicit native state evidence. New ADR and live qualification required; named-unverified until then. Include PROG/FUGR's second pool lock on deletion. No general caller bypass. |
| F3 — JWT identity reaches more than profiler fields | Accepted. Inventory create/batch/metadata responsible, CTS owner/list, profiler and trace-list defaults. Shared context has mapped-user-unverified state; omit optional native fields, require explicit/native identity for mandatory fields. Pinpoint the existing pinned read-default fixes as deliberate PR 2 behavior changes, not PR 1 refactoring. |
| F4 — session options/postCreate do not prevent all request replays | Accepted. PR 1 defines a request-local scoped HTTP facade with required policy propagated through session views; modifying entry points refuse missing context. Preserve exact single-target option absence and existing cleanup semantics. PR 2 covers all direct/nested HTTP adapters, not only signatures already accepting options. |
| F5 — request-level grants conflict with wildcard-only recursion | Accepted design correction. Use parent-request authorization consistently for pinned management, including recursion; keep single-target behavior unchanged. Frozen trees bound explicit work/reporting, while parent authorization includes verified concurrent children. Report expansions/unknown scope rather than promise an atomic snapshot. Only new-ID creation retains unrestricted-list admission. |
| F6 — app-wide transport scopes and upgrade effects | Accepted. Explicit role-merge examples, transport truth table and upgrade text. Proposed design retains existing app-wide scope composition and exact write-target grants rather than a third target attribute or destination flag. Clarify that enforced mode cannot coexist with independent /mcp; an old global flag/role assignment can still become effective on pinned routes. |
| F7 — 100 items versus five-minute budget | Accepted. Start qualification with 10 input objects/20 activation owners and a separate 100-reference bound; derive final pinned limits from measured cost and reserve cleanup time. Reject known over-budget inputs before mutation. Latency estimates are not completion guarantees; partial outcomes remain possible. |
| F8 — ST05 omitted filter may trace all users | Accepted. Pinned enable requires a nonempty native user or explicit proposed allUsers=true, mutually exclusive. Blank/omitted input cannot inherit an empty filter. Native all-users encoding and readback require qualification; single-target defaults remain separate. |
| F9 — fate of dedicated pinned pipeline | Accepted. PR 1 retains it only as a consumer/policy-result adapter. PR 2 converges on common dispatch/protocol adapters, removes the overlapping orchestrator, and uses one required context discriminator for both SAPWrite and SAPActivate. |
| F10 — FLP no-replay claim | Corrected. Current create helper suppresses only transient retries; PR 2 adds full pinned policy to every FLP mutation including delete. |
| F11 — formatter field preservation is not current behavior | Corrected. Name current defaulting/lossiness; plan a native-document patch preserving untouched values or refusing unrecognized shapes, with PP scope/readback evidence. |
| F12 — delete/RAP freshness | Accepted. Explicitly no hash guard on deletes. Native locks/prechecks/absence evidence apply; earlier changes are not detected merely by taking a lock. RAP reads all affected bytes under the native lock, preserves drafts and validates implicit activation; no claim of a caller multi-source hash. |
| F13 — timeout/package defaults | Accepted. Pinned release input is capped at 300 seconds and remaining outer budget; single-target stays at its existing limit. Pinned package-based request creation requires an explicit allowed routing package rather than assuming $TMP. |
| F14 — companion-read exposure and proposed policy labels | Accepted. New companions appear only on the writable pinned PP profiles being expanded; reader/Basic/aggregate catalogs retain existing allowlists. Route/context is explicit in pruning. Non-repository permissions are consistently labelled proposed and require the new ADR. |

## Design alternatives and uncertain evidence

- **A1, raw transports scope:** keep existing functional-scope semantics, with mandatory raw write
  and exact target grant. Document/admin-test that choice. Adding a second raw-scope requirement
  is not necessary to correct the confirmed gaps; the owner did not request another scope model.
- **A2, finer CTS entitlement:** do not add `arc1_transport_targets` or a destination boolean in
  this proposal. State that transport scope applies across the user's write-granted targets and
  that recording/management cannot be separately opted in per destination under this design.
  This is a proposed tradeoff, not owner approval of an unmentioned permission effect.
- **A3, more PRs:** retain the owner's two-PR planning structure. PR 2 has domain work packages and
  distinct validation gates. If implementation/review size demands stacked delivery, split those
  packages without reducing the agreed capability goal or claiming incomplete parity as complete.
- **A4, CTS target:** document that explicit native TMS targets/groups remain selectable under SAP
  authorization, request IDs may overlap across clients of one repository, and there is no new
  TMS-target allowlist. No implication that ARC-1 selected another backend or performed an import.
- **U1, implicit recording:** add mandatory evidence for FLP automatic customizing recording,
  API-state request selection, package-move preview and publication. Check the SAP-selected request
  before execute, or refuse the unqualified operation/configuration. No invented DEVCLASS/CTS
  mapping for FLP. Verify whether preview itself has side effects.
- **U2/U3:** exact text-pool activation and formatter scope remain named live qualification gates.
- **U4:** explicitly document authored-test execution under the invoking SAP identity and the
  existing deny-action mitigation. Do not change ADR-0009 or disguise tests as an execution sandbox.

## Existing issues and validation limits

The current pinned read defaults, misleading display-only comments and unpublish replay policy
are recorded here as baseline issues. PR 2 must handle its pinned paths deliberately and test the
compatibility changes; they are not fixes in this planning branch. Single-target corrections, if
chosen, must be separately identified rather than smuggled into PR 1.

Live CTS qualification must use a route without downstream import effects or separately recorded
authorization for those effects. Generic fixture permission is not authorization to release into
production queues. All live gates remain future work; only static documentation checks ran here.

## Focused follow-up and final corrections

The [follow-up report](claude-followup-review.md), again Claude Code `claude-opus-5-5` with effort
`max`, concluded that both plans can guide implementation and none of the reviewed areas has a
remaining planning blocker. Its input hashes were checked unchanged when the review completed.
The four subsequent corrections are author-applied and author-checked, not independently rereviewed:

| Follow-up correction | Final disposition |
| --- | --- |
| 1 — activation orchestration | Explicitly generalize or replace `handlePinnedActivation` into the one adapter used by SAPActivate and all nested callers, with a shared validator entry point and typed policies. Public preaudit=false stays refused. Added to PR 1's handoff and PR 2's P2-D. |
| 2 — package responsible | Explicitly inventory `create_package` and require a supplied native responsible user on pinned routes. SAP checks existence; responsibility is not proof of the acting PP identity. |
| 3 — text-pool confirmation | Require active metadata and version-specific active content matching the saved readback; otherwise report activation unconfirmed. Qualify after unlocking and verify unrelated owner drafts remain inactive. |
| 4 — named qualification gates | Add six research-table rows for implicit recording, text pools, formatter preservation/scope, ST05 scope, finite budgets and partial/unknown/no-replay evidence, each with a missing-evidence outcome. |

Also adopted the review's implementation notes: separate capability prechecks from resolved CTS
resource checks, use one tree freeze point or fail closed on newly discovered explicit work, and
land runtime transport enablement with its low-level guards. Pin exact-user ST05 input to one
native username and refuse patterns; broad selection uses the explicit all-users input.

The final author check covers local links/fences, all 38 mutation names, owner scope, both PR
boundaries and the roadmap's matching status. The original author review and both Claude reports
remain preserved as historical evidence. Only documentation changed; runtime tests and live SAP
qualification were not performed. FEAT-93 remains open with status **Design reviewed**. No further
product answer is needed to finish this planning task; implementation still requires a new request.
