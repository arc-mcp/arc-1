# ADR 0011 — Broader built-in mutations on pinned PP targets

**Status:** Proposed; implementation and qualification in progress. ADR-0010 remains the shipped contract.
**Date:** 29 October 2026.
**Contract:** [PR 2 implementation plan](../plans/2026-10-26-broader-pinned-pp-writes.md).
**Dependency:** [PR #1138](https://github.com/arc-mcp/arc-1/pull/1138), merged as `ac8385fa4`.

## Context

ADR-0010 qualifies CLAS/INTF main-source writes and whole-owner activation. The owner now requests
the existing single-target built-in development workflows on writable pinned targets, including
deletion, CTS management, tracing and classic Fiori Launchpad content. SAPGit and custom extensions
remain excluded. PR #1138 supplies the shared lock/session/request lifecycle; it does not authorize
additional operations. An action advertised by the single-target server is not automatically safe
to expose on a selected PP target.

## Proposed decision

Extend ADR-0010 only for explicitly reviewed tool/action/type/input combinations. Reuse the shared
mutation lifecycle and existing native adapters. Remove the separate CLAS/INTF write orchestrator
only after its policy, source preconditions, readback and failure outcomes survive in those adapters.
Every existing built-in mutation receives a disposition; new actions, types, aliases and nested
batch inputs require an explicit review before admission.

Admission requires the pinned route, strict PP, enforced XSUAA target authorization, global writes,
destination write opt-in, exact read access, verified raw write scope and exact write-target grant.
Functional scopes, capability switches, action denials and native SAP authorization additionally
restrict each operation. Admin diagnostics never replace these checks. Aggregate/Copilot, Basic,
standard target authorization and destinations without write opt-in remain mutation-free. Keep
cache-none, standard tools, UI/plugins off, per-call target validation and no PP fallback.

Use one capability decision for early invocation denial, schema/catalog projection and policy
diagnostics. Validate raw fields before schema stripping, including nested objects. Companions such
as CTS layers/targets, formatter reads, FLP lists and Manage diagnostics initially require the same
writable pinned connection. Their functional scopes remain reads; other readers retain their
current catalog. No Git/Custom hidden-call exception.

## Resource boundaries

| Resource | Required policy and postconditions |
| --- | --- |
| Repository objects | Independent server/destination rules against the real package; distinguish edited resource, lock owner, package owner and activation owner. Explicit create package or proven native inheritance. Resolve local/CTS recording before mutation and revalidate under the owning lock. |
| Editable text | Fresh editable bytes under lock and caller hash for existing-source replacement/surgery. An absent optional include has a verified creation path. Metadata/AFF/text pools use fresh native merge/ETag semantics; do not describe them as hash-protected. Delete has no caller hash. |
| Activation | Check initial owners before preaudit, then every expanded native reference before confirmation. One guarded adapter for single/batch/nested activation; never clear multi-target policy to enter a legacy fallback. Bounded partial results, no atomic rollback promise. |
| Text pools | A typed internal exact-text-pool exception may activate only its validated pool. No caller arbitrary URI or `preaudit=false`. Verify active metadata and active-version bytes; otherwise report saved/activation-unconfirmed. Qualify separately from whole-owner activation. |
| CTS management | Existing global transport switch and `transports` scope plus all common write gates and independent request lists. Freeze native parent/task membership once, carry an internal verified scope to every low-level write and recursive release. Exact allowed parents cover proven native children. |
| Trace/settings/FLP | Target/client-level resources; no invented DEVCLASS ownership. Require common write gates, per-action validation and native authorization. Establish native recording requirements before API-state/move/publication/FLP mutations; unknown recording shapes refuse. |

CTS creation requires unrestricted global request policy (legacy empty or `*`) and explicit
destination `*`, because the generated request ID is unknown before POST. Exact/prefix request
policies require externally created requests. CTS `target` remains the native TMS target, never
an ARC-1 route selector. Preserve complete object keys, native request/task states, inactive-object
release checks and terminal-state evidence. The pinned release deadline is capped by the remaining
five-minute call budget; single-target limits remain unchanged.

An optional `MCPTargetTransportDeveloper` role may combine read/write/transports scopes with the
same exact target attributes. **Functional scopes are application-wide:** transport role A plus
write role B can permit CTS management on both A and B when their destination policies allow it.
There is no per-target transport-specific grant in this design. Document this composition; use
destination request restrictions or separate applications where that distinction is required.
Existing roles are not silently assigned or expanded. Advertise the transport scope only for the
qualified pinned OAuth surface, not aggregate endpoints.

## Identity, lifetime and outcomes

JWT display names and `config.username` are not evidence of the mapped SAP username. Omit optional
responsible/CTS owner fields when native APIs use the logged-on principal. On-prem package creation
requires an explicit valid person-responsible because omission is not supported. Require an explicit
SAP username for trace operations without an authoritative native default. Qualify a second identity
whose IdP identifier differs from its SAP user; responsibility and acting identity are distinct.

Every policy lookup and nested native request shares cancellation and the finite mutation deadline,
including package subtree traversal. Pinned hierarchy evidence is fresh for each preflight and
under-lock check. Every modifying HTTP call disables replay and transient retry; owning unlock and
session close have independent bounded cleanup. Preserve truthful unchanged, saved, partial and
unknown outcomes, including orphaned profiler requests and accepted-but-unconfirmed FLP membership.
No network error implies rollback or permission to retry.

Pinned profiler requests bound executions and expiry. ST05 enablement requires an exact explicit
SAP user or explicit all-users selection, mutually exclusive; qualify native filter grammar and
preserve existing state fields. Restore prior trace state in tests, including other operators'
filters. Formatter patches preserve unrelated native XML/style data and reject unknown shapes.
Quickfix application returns deltas; source persistence still goes through guarded SAPWrite.

## Upgrade and acceptance

No extra global switch, destination transport boolean or upgrade acknowledgment. The owner accepts
the documented capability expansion for existing opted-in writers. Read-only apps/destinations do
not gain writes. Destination ceilings and exact target grants remain independent layers.

Acceptance requires the explicit inventory, shared-adapter regression checks, negative boundary
tests, reviewed security-model updates, Claude Code Opus 5.5 max review/fix loops and real isolated
pinned-PP evidence. Baseline ADR-0010 evidence does not qualify new operations. Separate native,
direct-Basic, controlled-wire and PP results. Name unverified combinations and gate them; never infer
backend non-support from missing evidence. Release tests require a disposable route without
downstream import effects or explicit approval of those effects. No production deployment follows
from this ADR. Keep FEAT-93 open until the expanded scope is implemented and verified.

Residual risks include shared process availability, cross-client repository changes, authored-code
effects, activation of preexisting drafts, irreversible releases/deletes, trace load and captured
data, shared FLP/settings effects, asynchronous audit delivery, retained token grants and admitted
calls completing after policy changes. These extend R23; broader acceptance remains pending the
implementation evidence and review. Separate instances remain available for stronger isolation.

## Alternatives

Automatically exposing the single-target schema would bypass resource-specific policy and future
review. Keeping a second full write engine would duplicate its lifecycle and fixes. Per-target
transport scopes would require a separate IAM contract and migration; this proposal uses existing
functional scopes plus destination request policy. Aggregate writes, Basic writes, Git and custom
plugins are outside the selected scope.
