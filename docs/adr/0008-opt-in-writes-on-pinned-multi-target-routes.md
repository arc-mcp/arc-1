# ADR 0008 — Opt-In Writes on Pinned Multi-Target Routes

**Status:** Accepted — Experimental and default-off
**Date:** 2026-10-03
**Related:** [ADR-0005](0005-single-system-per-instance.md),
[ADR-0006](0006-experimental-read-only-multi-target.md),
[ADR-0007](0007-shared-basic-identity-for-read-only-multi-target.md),
[design](../plans/2026-10-03-multi-target-pinned-writes-design.md),
[implementation plan](../plans/2026-10-03-multi-target-pinned-writes.md)
**Amends:** ADR-0006 for pinned Principal Propagation routes only
**Leaves unchanged:** ADR-0007 — shared Basic targets stay mutation-free

## Context

ADR-0006 made multi-target mode mutation-free by construction. The deciding argument was the
confused-deputy risk found in PR #543: on a route that selects the SAP system per call, a wrong or
hallucinated target ID turns a write into a write to the wrong system. ADR-0007 kept that contract
for shared Basic targets. Today any write-related `arc1.*` destination property quarantines the
destination (`UNSUPPORTED_V1_WRITE_CONFIG`).

Teams that run many systems behind one ARC-1 deployment still want to develop on selected systems
(typically DEV) without one CF application per system/client. A pinned route
(`/<SYSTEM-OR-ALIAS>/<CLIENT>/mcp`) fixes the target in the URL, so the model cannot choose the system
per call, and Principal Propagation (PP) sends every call to SAP as the caller's own SAP user. Those
two properties remove the reasons ADR-0006 rejected writes, provided the opt-in is explicit and
centrally bounded.

## Decision

Effective write permission for one tool call is the conjunction of all of these:

1. the instance ceiling `ARC1_MULTI_TARGET_ALLOW_WRITES=true` (default false);
2. the destination opt-in `arc1.allow_writes=true` on that system;
3. a PrincipalPropagation identity for that target;
4. a pinned route `/<SYSTEM-OR-ALIAS>/<CLIENT>/mcp`;
5. the matching XSUAA scope (`write`, `transports`, `git`, or `admin`);
6. SAP's own authorization for the propagated user (`S_DEVELOP`, `S_TRANSPRT`, ...).

If any term is missing the call stays read-only or is refused. `SAP_DENY_ACTIONS` keeps applying to
every target.

### Instance keys (all default false)

| Key | Meaning |
|---|---|
| `ARC1_MULTI_TARGET_ALLOW_WRITES` | Master ceiling. Without it every target stays mutation-free. |
| `ARC1_MULTI_TARGET_ALLOW_TRANSPORT_WRITES` | Ceiling for transport mutations; needs the master. |
| `ARC1_MULTI_TARGET_ALLOW_GIT_WRITES` | Ceiling for abapGit/gCTS mutations; needs the master. |

These are dedicated keys so the optional single-target `/mcp` settings (`SAP_ALLOW_WRITES`, ...)
never leak into multi-target. Startup fails if a sub-ceiling is set without the master and warns if
the master is set without `ARC1_MULTI_TARGET_ENDPOINTS`.

### Destination keys

| Property | Rule |
|---|---|
| `arc1.allow_writes` | `true`/`false`; enables SAPWrite, SAPActivate, SAPManage. |
| `arc1.allowed_packages` | **Required** when `allow_writes=true`; no implicit `$TMP`. Same syntax as `SAP_ALLOWED_PACKAGES` (`$TMP`, `Z*`, `ZFOO/**`, `*`). `allow_writes=false` plus `allowed_packages` is a valid read-only configuration. |
| `arc1.allow_transport_writes` | Needs `allow_writes=true`. |
| `arc1.allow_git_writes` | Needs `allow_writes=true`. |

`arc1.allowed_transports` is out of scope for this ADR.

### Discovery outcomes

- A key that requests writes (`true`, an invalid value, or `arc1.allowed_packages`) on a non-PP
  destination quarantines it with `WRITE_REQUIRES_PRINCIPAL_PROPAGATION`. A Basic destination whose
  write keys are all explicit valid `false` remains an enabled read target.
- An invalid boolean, a missing or invalid `arc1.allowed_packages`, or a sub-flag without
  `allow_writes` quarantines the destination with `INVALID_WRITE_POLICY`.
- A valid request while the instance ceiling is off leaves the target enabled read-only with a
  diagnostic that the requested policy was narrowed (`requestedPolicy` vs `effectivePolicy`, the same
  pattern as data preview). Destination admins can narrow but never exceed the instance ceiling, and
  an instance admin alone cannot make a system writable.
- Write properties enter the target fingerprint. Changing them after startup triggers the existing
  `TARGET_CONFIG_CHANGED` drift refusal; a restart reloads them.

### Runtime boundary

- The safety ceiling and the per-call configuration take a required `route` parameter
  (`'pinned' | 'aggregate'`). `'aggregate'` always returns the mutation-free ceiling, even for a
  target that is writable on its pinned route. `'pinned'` maps the effective policy.
- The aggregate `/multi/mcp` route and every BasicAuthentication target keep the v1 read-only tool
  surface and `readOnlyHint`. A writable pinned PP target uses single-target tool pruning
  (`ACTION_POLICY` plus the safety ceiling), so every write action still passes `checkOperation`,
  package enforcement on the object's real package, and deny actions.
- Pinned server instructions get a writable variant naming SID/client and the allowed packages.
- Lock, modify, unlock stays inside one synchronous tool call on the per-request PP client; no lock
  crosses an MCP round-trip.
- Pinned OAuth protected-resource metadata advertises `write`, `transports` and `git` only when the
  matching instance ceiling is on. It stays destination-independent, so it is the same for every
  pinned route of the instance.

## Explicit deviation from the v2 roadmap

[`multi-target-v2-roadmap.md`](../plans/multi-target-v2-roadmap.md) lists V2-02B (per-target grants)
and V2-05 (OAuth client spike) among the prerequisites of a pinned write beta (V2-08). This ADR does
not implement them, by user decision of 2026-10-03:

- XSUAA scopes remain instance-wide, not per target. A user with `write` can write on every
  writable pinned target; the per-target bound is the destination opt-in plus SAP authorization of
  the propagated user.
- `admin` keeps implying `write`, `transports` and `git` (single-target parity). The roadmap
  recommended raw functional scopes for multi-target mutation; this ADR does not follow that, so any
  admin token can write on a writable pinned route.

Operators who need per-target grants or raw-scope-only mutation must keep those systems out of
`arc1.allow_writes` until those items exist.

## Rejected alternatives

- **Destination-only opt-in.** Anyone who can edit subaccount destinations could make ARC-1 writable,
  breaking the centralized-ceiling principle.
- **Writes on shared Basic targets.** No per-person SAP authorization or attribution, and shared
  lock/transport ownership.
- **Writes on the aggregate route.** A wrong or hallucinated target ID becomes a write to the wrong
  system, the confused-deputy risk ADR-0006 rejected PR #543 for.

## Consequences

- Single-target defaults and every default-off multi-target deployment are unchanged.
- A writable pinned target needs two independent administrators' decisions (instance owner and
  destination owner) plus per-user SAP authorization.
- Fingerprints change for every target after upgrade (new canonical policy fields); startup
  recomputes them, so this is harmless.
- Copilot Studio's `/authorize` alias routes to the aggregate, so Copilot Studio cannot use writable
  pinned routes.
- Per-request PP clients with stateful lock sessions raise the relevance of roadmap OPS-06 (816
  session failures); live verification is required.
- A writable pinned route uses single-target pruning, so it exposes more than package-bound object
  writes, the same as single-target:
  - write-scoped actions that are **not package-bound** and act system-wide: `SAPManage` FLP and
    UI5-repository actions, `SAPDiagnose.set_sql_trace_state` (switches ST05 on/off across all
    application server instances), `SAPDiagnose.trace_start` / `SAPDiagnose.trace_cancel`, and
    `SAPLint.set_formatter_settings`;
  - reads outside the reviewed v1 allowlist: SAP-backed `SAPLint.format` /
    `SAPLint.get_formatter_settings`, `SAPTransport.layers` / `SAPTransport.targets` topology, and
    the package-scoped `SAPDiagnose.atc_ci` / `SAPDiagnose.unittest_ci` (SAP workload).

  Operators who do not want these on writable pinned targets deny them instance-wide with
  `SAP_DENY_ACTIONS`, for example
  `SAP_DENY_ACTIONS=SAPDiagnose.set_sql_trace_state,SAPDiagnose.trace_start,SAPDiagnose.trace_cancel,SAPLint.set_formatter_settings`.
- Residual risk R22 in [security-model.md](../security-model.md) records a pinned connector set up
  against the wrong system.
- Plugins, caching and hyperfocused mode stay unsupported in multi-target mode.

## Not changed

ADR-0007's Basic exception, the one-instance ceiling, the aggregate route's mutation-free contract,
and the v1 plan's contract for the aggregate route remain as written.
