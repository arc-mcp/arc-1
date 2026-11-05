# Private pinned CTS management candidate — 2 November 2026

This implements the offline P2-F candidate from the accepted broader-write plan. It does not
qualify or advertise transport mutations on public pinned endpoints. Aggregate, shared Basic,
Copilot and read-only applications retain their mutation-free boundary. No native SAP calls,
credentials, deployment, BTP changes or network mutation were used for this implementation.

## Implemented contract

`handlePrivatePinnedCts` is an explicit internal qualification entry, not a dispatch route.
It requires the fully enabled pinned strict-PP target policy, raw `write`, the effective existing
`transports` scope (including admin implication), both write ceilings, the action deny policy and
a nonempty destination request list. Both request lists independently authorize the canonical
native parent. The existing factory-created safety/HTTP pair continues to bind both low-level
transport guards; copying a safety object cannot authorize a send. Source recording remains
separate and does not gain a transport-management scope requirement.

The runtime builder now retains `enabled && base.allowTransportWrites`; `allowedTransports=[]`
remains the read projection, never write authority. The optional `MCPTargetTransportDeveloper`
role adds read/write/transports with the existing required target attributes, without changing
existing roles or assigning collections/users. Functional scopes merge application-wide: a
transport role for A plus a write role for B can authorize management on both when their request
policies allow it. There is no third target entitlement or destination transport-write switch.
The protected-resource scope helper only adds transports after public capability admission;
that capability is absent, so current OAuth metadata still omits transports on pinned routes.

All candidate requests share the existing registered mutation context, a maximum 300-second
outer deadline, cancellation, an 8 MiB cumulative decoded body allowance (including errors and
CSRF control responses), and 1,024 HTTP attempts. No auth/CSRF/negotiation/availability replay is
permitted. The ordinary single-target APIs keep their existing options and timeout behavior.
Private reads use namespace-aware XML identity, a 1 MiB document cap, 256 tasks, at most 1,000
object entries per node, exact full CTS keys and known request/state shapes. Unknown pagination,
control children and ambiguous identities refuse. Root-level native task siblings are supported.
The retained native 7.58 organizer fixture covers its additional `all_objects` aggregate view;
authority and entry mutation use direct request/task entries, never that derived aggregate view.

- Creation requires unrestricted global requests (legacy empty or explicit `*`) and explicit
  destination `*` before POST. Package routing needs an explicit package checked against both
  package policies; explicit native TMS routing has no invented package. A native target must be
  a system, system.client or /GROUP/ value, not an ARC-1 route selector, and requires affirmative
  discovery support. Generated request ID, Workbench category, modifiable state, exact native
  description and explicit target are independently read back. Optional responsibility is left
  to SAP's mapped user.
- Release retains the existing convergence engine and additionally validates rich inactive CTS
  inventory before submission, repeated preflight, and independently typed terminal states.
  Unknown inventory attributes/children/completeness metadata at every relevant level refuse;
  recording IDs and supplied request/parent URIs must be canonical and consistent.
  Recursive release freezes the explicit children and checks membership before each step.
  Parent CTS effects are not an atomic task snapshot; newly observed children make the outcome
  incomplete and are reported rather than explicitly submitted. Observations from every organizer
  GET, including convergence and terminal/final reads, persist even if a later read omits the child
  or fails. An observed expansion blocks every later explicit mutation.
- Delete/reassign preflight every explicit recursive member before the first write, then read
  membership and state again before each step. Reassignment verifies the owner. Deletion requires
  a successful typed native absence read. After an acknowledged DELETE, the
  [exact native CTS missing-resource exception](2026-11-03-cts-typed-absence.md) also proves absence
  of its bound ID; generic 404, HTML, wrong-ID errors or a lost response do not.
- Remove-object selects one unambiguous task-owned entry and retains pgmid/type/name/position.
  It requires actual native lock metadata, refusing the known older removal contract before PUT.
  It removes a request entry, not the repository object. `removeLockedObjects` requires actual
  lock-state metadata, reports each confirmed destructive entry removal separately, then deletes
  the selected request/tasks. A mid-sequence failure stops without replay or rollback claims.
- `layers`/`targets` are private read-scope companions on the same enabled pinned connection.
  They require native named-item/count evidence; count mismatch, pagination, duplicate names,
  unknown discovery, or the 200-item boundary refuses instead of claiming a complete list.

Results distinguish confirmed steps from invoked/acknowledged submissions whose native outcome
is uncertain. They separate ARC-1 `target` from `nativeTarget`, retain phase/selected parent and
frozen IDs, and never copy raw HTTP bodies, sessions, credentials or error messages to clients.
A later failure does not erase earlier confirmations; an acknowledged request is not by itself
reported as a confirmed mutation.

## Evidence and limits

The author added adversarial input/authority/membership/state/recursive/partial-result tests,
namespace and native-fixture evidence tests, and real HTTP transport tests with mocked upstream
responses for no replay, cancellation/deadline and cumulative body limits. Builder tests exercise
actual discovered target configuration, caller scope intersection, Basic/aggregate/read-only
refusals and continued public capability refusal. Role tests preserve exact attributes and no
automatic role collections. Existing single-target tests run unchanged in the full suite.

The [independent source review and correction dispositions](2026-11-02-pinned-cts-review-followup.md)
retain three reproduced P2s and their offline fixes. A new independent correction review is pending.
This is author validation, not independent acceptance or a native review. No fresh native or PP
qualification is claimed. The source-bound author result and command logs are retained outside
the repository at `~/.local/state/arc1-review/pr1142-cts-author1/`.

Before public admission, independently review this candidate and bind a native experiment to
that reviewed revision. Qualify native request/task parent shapes, membership drift, K/W/T
operation-specific states, both create routes and returned-ID semantics, mapped authorship,
complete value-help counts, rich inactive inventory, release terminal states, deletion absence,
full-key/locked-object entry removal, owner reassignment and partial outcomes. The private
candidate deliberately refuses terminal-task disappearance alone unless a typed terminal parent
is observed; unknown request categories, flat/unassigned inactive metadata, task-less standalone
read shapes and request-owned entry removal remain unsupported until their exact native
contracts are reviewed. Recursive deletion/reassignment currently requires all explicit selected
members modifiable; mixed released children refuse before writing.

Then run successful management/recording tests as two mapped SAP developers with different
request policies, alongside denied scopes/targets, aggregate/Basic/Copilot/read-only and transport
allowlist controls. Record downstream CTS scope, independent native readback, fixture restoration
and cleanup. Test fresh grants and realistic role composition across target A/B. Only after those
checks may the public capability matrix, tool schemas, OAuth transport scope advertisement and
operator guidance be admitted together. FEAT-93 remains open for these gaps and the rest of PR 2.
