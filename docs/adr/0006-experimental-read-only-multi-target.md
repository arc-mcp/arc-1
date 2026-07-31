# ADR 0006 — Experimental Read-Only Multi-Target Endpoints

**Status:** Accepted — Experimental and default-off
**Date:** 2026-07-17
**Related:** [ADR-0005](0005-single-system-per-instance.md),
[implementation plan](../plans/destination-discovered-multi-target-v1.md)
**Qualifies:** ADR-0005 for the explicit, default-off v1 mode described here
**Qualified by:** [ADR-0007](0007-shared-basic-identity-for-read-only-multi-target.md) for the
explicit shared Basic-authentication exception

## Context

Large SAP estates can contain 100 or more system/client targets. One ARC-1 CF application per client
creates substantial deployment and operations overhead. PR #543 proved that multiple Destination
Service runtimes can coexist in one process, but its destination-name routing and write-capable
policy are not an acceptable public contract.

ADR-0005 made single-system structural binding the rule because runtime target selection can direct
writes—or confidential reads—to the wrong environment. That reasoning remains valid. This ADR
accepts a narrow exception after removing mutations and making the remaining risk explicit.

## Decision

ARC-1 may expose experimental multi-target endpoints only when
`ARC1_MULTI_TARGET_ENDPOINTS=true` and all requirements in the implementation plan are met:

- BTP CF subaccount Destination discovery, XSUAA, on-premise connectivity, and one immutable startup
  snapshot; Principal Propagation is the recommended identity path, while ADR-0007 permits a
  default-off shared Basic-authentication exception;
- a case-sensitive pinned endpoint `/<PUBLIC-SYSTEM>/<CLIENT>/mcp` and an aggregate `/multi/mcp`
  endpoint; the public system segment normally equals the real SID but may use the bounded optional
  `arc1.target_alias` when independent systems reuse one SID/client;
- no discovered bare `/mcp` alias and no destination name in a route or reader-visible response;
  secret-projected Admin `SAPTargets` diagnostics may expose the internal destination name;
- global ARC-1 roles; Principal Propagation keeps SAP authorization per user and target, while a
  Basic target intentionally uses one shared SAP technical identity for every authorized ARC-1
  caller;
- source/metadata reads by default, with data and SQL requiring instance, destination, XSUAA, and SAP
  consent; and
- a structural multi-target ceiling that forbids writes, activation, transport/Git mutations,
  enqueue locks, and SAP-backed formatter/settings actions regardless of administrator role or
  single-target configuration. The reviewed mutation-free additions are offline
  `SAPLint.lint|lint_and_fix|list_rules`, read-only `SAPTransport.list|get|check|history`, and the
  explicit `SAPDiagnose` allowlist in the implementation plan. Diagnostic data actions retain the
  normal destination/instance/XSUAA/SAP data gates; adding a general diagnostic action does not add
  it to multi-target mode automatically.

ATC and ABAP Unit are controlled executions rather than passive reads: they consume SAP work
processes and may create transient worklists/results. They retain the existing `read` scope for
single-target compatibility, remain bounded by the global semaphore and rate limits, require SAP
authorization, and can be disabled instance-wide with `SAP_DENY_ACTIONS`. Their inclusion does not
weaken the structural repository-mutation ceiling.

Multi-target protected-resource metadata advertises only the mutation-free `read`, `data`, `sql`,
and `admin` scopes. The initial unauthenticated challenge does not force `scope=read`, so general MCP
clients can request that advertised set and XSUAA can reduce the grant to the authenticated user's
assigned role collections. A validated token must still contain global read before ARC-1 resolves
route membership. This eager scope negotiation is accepted for v1 because current MCP clients do not
reliably implement step-up and the structural ceiling cannot mutate SAP. It must not be extended to
write, transport, or Git scopes: any multi-target write design requires a new security review and
must reconsider initial scope selection, consent, token privilege, and step-up support.

Single-target mode remains the default and unchanged. A separately configured single-target `/mcp`
runtime may coexist and retain its current policy. PrincipalPropagation targets enforce strict PP
per discovered runtime so existing API-key/direct-OIDC behavior is not changed accidentally.
BasicAuthentication targets are accepted only under ADR-0007's explicit deployment ceiling and
never become a fallback for a failed PP target.

The aggregate endpoint requires an explicit `target` on every SAP-contacting call. It has no default,
remembered, or session target. `SAPTargets` supplies configured IDs and descriptions when multiple
targets exist; admins also receive secret-safe registry state and exception diagnostics, including
in zero/one/failure states, and can query matching active details. Admin diagnostics use bounded,
deterministic paging with explicit truncation/next-offset metadata. `SAPTargets` is aggregate-only
and never appears on pinned endpoints. Aggregate schemas use exact target enums through 16 targets
and a public-system/client pattern from 17 through 256; runtime membership remains authoritative.
Selected-target policy and SAP authorization are checked again on every call.

`sap-sysid` and `sap-client` remain required and truthful even when a route alias is used. The alias
changes only the public target ID, pinned URL, cache/audit target key, and model selection value; it
does not change Destination lookup, Principal Propagation, the SAP client, or authorization. One
destination receives exactly one public ID. Duplicate quarantine operates on that resulting public
ID, allowing two real `A4H/001` systems to coexist as, for example, `A4H/001` and
`A4H-2025/001` without inventing a false SAP SID or changing an existing route.

The aggregate MCP transport remains reachable during registry-wide discovery failure so an admin can
call `SAPTargets`; other aggregate tools fail with a structured registry error, and pinned routes are
unavailable until restart. No standalone HTTP target-catalog endpoint is exposed.

## Accepted residual risk

Removing writes eliminates the highest-impact cross-environment failure, but not target confusion.
An LLM can still select the wrong authorized target and disclose source, table data, or SQL results
from it while believing it queried another system.

V1 mitigates—but cannot eliminate—this risk through explicit per-call target selection, pinned URLs,
meaningful target descriptions, no session/default target, data/SQL off by default, runtime policy
checks, strict per-user PP where configured, explicit shared-identity labeling for Basic targets,
and audit target correlation. Administrators must use pinned routes or
separate ARC-1 instances for lookalike production/non-production systems where a wrong-target read is
an unacceptable confidentiality incident.

Global read users can see all accepted target IDs and attempt them. The catalog is configuration
inventory, not entitlement inventory. Deploy separate ARC-1 instances when target visibility itself
must be restricted before SAP is contacted.

## Consequences

- A 100-target deployment becomes operationally feasible without 100 CF applications.
- All targets share one process, semaphore, rate-limit buckets, release lifecycle, and failure
  domain. This is not equivalent to independent instances.
- One pinned URL per target can multiply client OAuth/DCR flows; the aggregate endpoint is preferred
  beyond a few user targets.
- Data/SQL require especially careful target naming and environment separation.
- Writes on any multi-target route require a new security review and ADR. They are not an incremental
  flag or destination property for v1.
- ADR-0005 continues to govern the default mode, writable access, and deployments requiring stronger
  isolation. The MCP hub remains the alternative for independently deployed ARC-1 instances.

## Rejected alternatives

- **Keep PR #543's write-capable destination-name routes:** destination names are poor public
  identities and a write-capable aggregate/shared process revives the confused-deputy risk.
- **Target-specific XSUAA roles in v1:** dynamic SID/client roles add administration and schema
  complexity without a reliable external entitlement source.
- **Probe and cache per-user target availability:** access changes over time, failures can poison
  shared state, and the cache would be incomplete after deployment.
- **Separate HTTP/browser catalog:** it duplicates the MCP discovery surface and needs another auth,
  rate-limit, and payload contract. V1 keeps one role-sensitive `SAPTargets` tool instead.
