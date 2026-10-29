# Broader pinned PP writes: research and decisions

Date: 26 October 2026. Baseline: `e538bf71197ddb47ea74aca225c340a856d331af`
(package version 1.9.0). This is a planning record, not evidence that broader writes exist.
No SAP requests, deployment changes or runtime edits were made for this research.

Implementation plans:

- [PR 1: shared mutation infrastructure](../plans/2026-10-26-shared-mutation-infrastructure.md)
- [PR 2: broader pinned PP writes](../plans/2026-10-26-broader-pinned-pp-writes.md)

The current supported write contract remains [ADR-0010](../adr/0010-pinned-pp-multi-target-writes.md).
The [22 October strategy](2026-10-22-multi-target-write-strategy.md) and
[older V2 inventory](../plans/multi-target-v2-roadmap.md) contain historical restrictions and
proposals; they are not evidence that missing controls are still absent today.

## Decisions from the owner

| Topic | Decision |
| --- | --- |
| Goal | Get as close as possible to the built-in single-target write capabilities on pinned PP routes. |
| Git | Excluded from this expansion, including introducing a multi-target SAPGit surface. |
| Custom extensions/plugins | Excluded; avoid their additional support and execution surface. |
| Runtime tracing | Include profiler and ST05 controls in PR 2. Explicitly confirmed after discussing their broader effect. |
| Classic FLP | Include the existing catalog/group/tile operations in PR 2. Explicitly confirmed. |
| Existing writable deployments | The owner accepts that the documented capability expansion applies to already opted-in writers. No additional upgrade-acknowledgment switch is required. |
| Read-only deployments | Must remain mutation-free: global writes alone, a read grant, admin diagnostics or a writable sibling destination must never enable a destination. |
| Work in this change | Research, detailed plans, author review, then an independent Claude Code Opus 5.5 max review. No implementation or live mutations. |

The proposed two-PR split is an engineering recommendation: first establish actual shared code
without changing behavior, then enable the broader surface. Transport policy details, role names
and the internal interfaces below are proposed designs, not additional owner decisions or shipped
configuration. Review them against implementation evidence before adopting the new ADR.

## What the current code establishes

| Evidence | Finding | Planning consequence |
| --- | --- | --- |
| `src/server/multi-target-runtime.ts`, `buildMultiTargetConfig` | Writes require pinned mode, global writes, enforced target authorization, PP, destination opt-in, read access, verified raw write scope and the exact write-target grant. | Preserve the conjunction for every new mutating tool, not only SAPWrite/SAPActivate. |
| `src/server/multi-target-write-surface.ts` | Action, type and input allowlists independently restrict the current CLAS/INTF surface. | Extend an explicit reviewed matrix; do not return the unrestricted single-target catalog. |
| `src/handlers/write.ts`, `src/handlers/activate.ts` | Pinned writes and activation enter dedicated handlers. | Removing the routing branch is not a safe refactor by itself. |
| `src/handlers/write/pinned.ts` | Under-lock package/CTS checks, mandatory main-source hash, readback, five-minute operation budget, no replay and separate bounded cleanup. | Preserve these guarantees while extracting reusable mechanics. |
| `src/adt/crud.ts`, `safeUpdateSource` and `safeUpdateClassInclude` | Single-target helpers have optional hashes, legacy request/session behavior and different cleanup/error behavior. | PR 1 must preserve both contracts through explicit profiles; it must not silently apply one to the other. |
| `src/adt/safety.ts`, `checkPackage` | Global and destination package policies already compose independently. | Reuse this implementation; do not build a second wildcard-intersection algorithm. |
| `src/adt/pinned-write-policy.ts` | Locality and recording are positively established; selected tasks resolve to canonical allowed modifiable Workbench parents. | Generalize only where the new object's native contract supports the evidence. |
| `src/adt/devtools.ts`, `activate`/`activateBatch` | Single-owner activation accepts a validator; multi-target batch activation is explicitly rejected. Initial preaudit can itself activate. | Validate all initial owners before submission and all expanded references before confirmation. A batch needs its own reviewed path. |
| `src/handlers/editable-source.ts` | Hashes cover a finite text-source set, not metadata, server-driven objects, creation or deletion. | Do not promise a universal existing hash API. Use type-specific native concurrency for other representations. |
| `src/server/http.ts`, pinned protected-resource metadata | Pinned metadata can advertise write; it does not currently advertise transports. Aggregate metadata stays mutation-free. | Transport rollout must include metadata, token/scopes and real-client acceptance. |
| `xs-security.json`, `MCPTargetDeveloper` | The template grants read/write and the two target attributes, without transports. | Define a transport role path; do not claim the existing template alone enables transport management. |
| `src/server/multi-target-destination-config.ts` | `arc1.allow_transport_writes` and `arc1.allow_git_writes` are recognized as write-related but unsupported. | Do not document either as currently supported. Proposed PR 2 uses existing global transport enablement plus destination writes and request restrictions. |
| `src/adt/safety.ts`, `checkTransport` | The legacy transport allowlist also filters transport reads; an empty list means unrestricted. | Keep the new multi-target mutation checks separate from existing read behavior. Empty destination restrictions must never become unrestricted. |
| `src/adt/transport.ts` | New request IDs are SAP-generated. Legacy recursive release refuses restrictive exact/prefix lists because children can change. | Define create admission before sending. PR 2 explicitly proposes consistent parent-request grants for pinned recursion; single-target keeps its current restriction. |
| `src/server/multi-target-server.ts` | Aggregate routing consumes `args.target`; pinned routing leaves it alone. | `SAPTransport.create.target` may retain its CTS meaning on a pinned route. It must never select the ARC-1 backend. |
| `src/adt/diagnostics.ts`, `createTraceRequest` | Tracing creates parameters and then an armed request; default trace user comes from `client.username`. | PP attribution and partial two-step creation need explicit qualification. JWT display names are not SAP usernames. |
| `src/adt/diagnostics.ts`, `setSqlTraceState` | ST05 changes SQL state on all instances represented by the returned document; other fields are preserved by targeted replacement. | State this scope accurately. Do not describe it as a package-scoped or one-instance trace. |
| `src/adt/flp.ts`, `src/handlers/manage.ts` | Classic FLP uses `PAGE_BUILDER_CUST` and catalog/group identifiers, not repository DEVCLASS. | Give FLP an explicit target-level policy domain and verify PP through the OData route. |
| `src/adt/devtools.ts`, formatter settings | SAP-backed formatter settings are a separate read/modify/write operation. | Include them in the inventory; verify their actual scope rather than assuming user isolation from PP. |
| `src/handlers/write/create.ts`, `batch-results.ts` | Batch workflows already report per-phase partial results; the single-target bound is 100 and earlier creations are not rolled back. | Preserve partial reporting; derive smaller pinned limits from measured PP cost under the shared deadline. |
| `src/adt/server-driven.ts` and tool documentation | Some saves, including APLO/UIAD, take effect immediately. | A generic promise that all writes remain inactive would be false. |

## Recommended policy model for PR 2

Use the existing target write permission as the broad permission to invoke reviewed built-in
mutations. No new global multi-target write flag, per-action consent prompt or upgrade opt-in.
Keep `SAP_DENY_ACTIONS`, native SAP authorization and the existing transport capability gate.

An operation's resource domain determines its additional constraints:

1. **Repository:** real package at both layers; native owner/lock identity; verified local/CTS
   recording; type-specific concurrency and activation rules.
2. **CTS management:** global transport enablement, functional transport scope and both request
   policies. A request-level grant covers management of the complete request and its verified
   SAP-managed tasks; it is not proof that all contents belong to writable repository packages.
   Source writes still independently require package authorization.
3. **Target settings and diagnostics:** exact target write grant, denied-action checks and native
   SAP permissions, plus the operation's documented user/instance/state boundaries. No fabricated
   package check for a resource that has no repository package.
4. **Classic FLP:** exact target write grant and native FLP authorization for catalog/group resources.
   No catalog allowlist is proposed in this parity project. Operators can disable the action group
   with existing action denials or grant narrower SAP authorizations.

The latter three domains require an explicit qualification of the repository-package wording in
the new ADR/security model. Treating them as repository objects would give a false guarantee.
This is a proposed reviewable design, not a claim that the owner already accepted every residual
effect. It follows the chosen inclusion of transports, tracing and FLP without adding an unrelated
permission-product redesign.

Repository writes are generally cross-client; settings and FLP have their own native scopes.
Do not generalize the repository's cross-client behavior to every management resource.
Package restrictions do not sandbox authored ABAP, and a pinned route does not isolate the shared
ARC-1 process. Existing asynchronous audit delivery and token/refresh revocation limits remain.

## Proposed compatibility choices

- Preserve `MCPTargetDeveloper` as read/write. Add a concrete documented role path for read/write/
  transports with both target attributes, without Git or automatic role assignment. A proposed
  `MCPTargetTransportDeveloper` template is described in PR 2; its name is not a shipped setting.
- Permit transport management only when the existing global transport switch is on, the caller
  has the transport scope, the selected target is writable and destination request policy exists.
  Do not add `arc1.allow_transport_writes` merely to repeat these gates.
- For generated request IDs, initially admit create only when both request policies are
  unrestricted (explicit destination `*`; global legacy empty or explicit `*`). Exact/prefix
  policies still support management of known allowed requests. This is a visible limitation,
  not an invitation to create first and check later.
- Preserve existing parent-request recording semantics for repository saves and use parent-request
  grants consistently for pinned CTS management, including recursion. Single-target's wildcard-only
  recursive-release rule remains unchanged. Freeze explicit work for bounded execution/reporting;
  do not imply a parent grant excludes concurrent children of that parent.
- Keep aggregate/Basic behavior, cache-none, UI-off, standard tool mode and the current discovery/
  authentication topology. Built-in classic FLP operations do not enable the ARC-1 web UI.
- Keep explicitly reviewed action/input/type coverage. A future single-target action requires a
  matrix entry and tests before becoming callable through multi-target routes.
- Document role merging: functional transports scope applies across all exact write-granted
  targets beneath their destination/global gates. The proposed transport-role template does not
  provide a separate per-target transport entitlement. No new transport-target attribute is proposed.
- Qualify a narrow internal exact-text-pool activation mode with `preaudit=false` and verified pool
  state, without exposing an arbitrary caller bypass. Ordinary activation keeps validated preaudit.
- Carry request/recording/identity/activation policy through required shared context. Optional SAP
  responsible/owner fields are omitted when mapped-user identity is unverified; enumerate all
  create, metadata, CTS and trace call sites, not just profiler defaults.

## Research and qualification gates

These do not require more product discussion before planning. They are technical evidence needed
before implementation can claim the corresponding operation works:

| Gate | Required evidence | If evidence is missing |
| --- | --- | --- |
| Shared mutation seam | Both modes demonstrably use the extracted code; baseline wire behavior and user results remain unchanged. | Narrow the extraction; do not turn PR 1 into capability expansion. |
| PP identity for native defaults | An existing supported SAP response proves the mapped user, or callers provide the native SAP field explicitly where that contract permits it. | Omit optional responsible fields; refuse ambiguous required defaults. Never use JWT email/display name as SAP identity. |
| Non-CLAS recording/locks | Correct native owner, package, lock key, request/task and metadata evidence for each adapter family. | Keep that combination unavailable with a precise reason. |
| Trace ownership and lifecycle | Actual created request identity, two-step failure state, cancellation behavior and ST05 scope on the PP route. | Do not claim own-user defaults or automatic rollback. |
| FLP PP | Cloud Connector path, OData authentication/CSRF, SAP roles, resource identifiers and readback. | Report backend/authorization unavailability without Basic fallback. |
| CTS create and recursion | Prove pre-send create admission, guard behavior from the actual runtime config, and parent/task scope including concurrent children. | Refuse unknown admission/membership; retain the generated-ID creation restriction and report recursion uncertainty. |
| Implicit recording | Native request selection for API state, package-move preview and publication; preview side effects; FLP automatic customizing recording. Prove locality/no-recording or validate the selected request before execution. | Refuse the unqualified operation/configuration. An operator declaration that recording is off is not native evidence; FLP remains a named gap if its contract cannot supply the proof. |
| Exact text-pool activation | Unlock-before-activation, active metadata plus version-specific content equality to saved readback, and unrelated owner drafts still inactive; include never-activated PROG and empty CLAS/FUGR cases. | Keep the adapter unqualified where its scope is unproven; after a qualified submission with missing outcome evidence, report saved/activation-unconfirmed. |
| Formatter scope and preservation | Mapped-user versus system scope, recognized native document shapes and preservation of untouched fields/style values. | Refuse unknown shapes; do not advertise a user-isolated settings contract without evidence. |
| ST05 exact-user/all-users semantics | Native all-users encoding, exact username grammar without wildcard bypass, all-instance readback and restoration of prior state. | Refuse unqualified scope inputs; report submitted changes as unconfirmed when native readback cannot establish state. |
| Finite operation budgets | Measured PP costs and cleanup reserve for input/activation/reference caps and large CTS trees within the shared 300-second budget. | Keep limits provisional; refuse known oversized/over-budget work and do not claim throughput before qualification. |
| Partial/unknown outcomes and no replay | Outgoing request-policy assertions and injected response loss/cancellation/failure for each admitted family; honest per-phase state and owning-session cleanup. | Do not enable an adapter that can replay an ambiguous mutation or misreport completion; live uncertainty remains explicit rather than a passing result. |
| Runtime parsing/release differences | Real PP evidence for representative 750/758/816 capabilities, with supported/unsupported/unverified distinguished. | State the tested releases and leave unqualified response shapes denied. |

No new ABAP helpers, RFC execution or generic report/class execution are part of this work.
Native syntax, ATC and ABAP Unit retain ADR-0009's separate contract.

## Review record

The [author review](multi-target-write-parity/author-review.md) preceded the requested
[Claude Code Opus 5.5 max review](multi-target-write-parity/claude-review.md). The returned model
was `claude-opus-5-5`; only Read/Grep/Glob were enabled, with no MCP servers, hooks or shell/edit
tools. The original report and reviewed-file hashes are preserved. The
[dispositions](multi-target-write-parity/review-dispositions.md) distinguish adopted corrections,
explicit design choices, pre-existing issues and future qualification gates. Review is static
design evidence, not live SAP qualification or authorization to implement/deploy.

A [focused follow-up](multi-target-write-parity/claude-followup-review.md) with the same model and
effort found both plans suitable to guide implementation, with no remaining planning blockers.
The author applied its four small corrections and recorded the final checks in the dispositions.
Those final edits were author-checked, not a third independent review. Live qualification and the
feature ADR/security review remain implementation gates.
