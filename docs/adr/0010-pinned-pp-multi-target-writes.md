# ADR 0010 — Pinned Principal Propagation writes in multi-target mode

**Status:** Proposed; implementation and qualification in progress in PR #1080.
**Date:** 22 October 2026.
**Implementation contract:** [Pinned PP writes plan](../plans/2026-10-22-multi-target-pinned-writes.md).
**Evidence:** [Current-main research](../research/2026-10-22-multi-target-write-strategy.md).

## Context

ADR-0006/0007 permit only mutation-free multi-target access. ADR-0008 supplies verified target
visibility/access, but global functional scopes cannot express “write A, read B.” PR #906 proposes
pinned writes but adds duplicate global switches, lacks exact write grants and exposes the full
single-target action surface. Operators need fewer configuration concepts and an enforceable
server ceiling before multi-target development can be enabled.

## Proposed decision

Permit a narrow, explicitly qualified object-write capability on existing pinned PP routes only.
Reuse `SAP_ALLOW_WRITES` and require destination opt-in/package policy, target-filtered access,
verified explicit write scope, exact target write grant, an action/type/input allowlist and SAP
authorization. Evaluate global and destination package restrictions independently against the real
package. Require the existing source precondition for supported updates; bound lock/save/unlock
and validate all activation references. Preserve honest partial/unknown outcomes and current audit
delivery semantics.

The complete scope covers local and transportable CLAS/INTF creation/main updates, existing CLAS
main method edits, and whole-owner activation. PR #1080 must qualify all of it before readiness;
there is no separate beta release. Transport policy authorizes canonical modifiable Workbench
requests and their SAP-managed tasks. Broader mutations remain separate work. Transport recording
is distinct from transport management. See the [live evidence](../research/2026-10-22-multi-target-write-qualification.md).

Aggregate `/multi/mcp`, its compatibility alias and multi-target Basic targets remain mutation-free.
No new write URL or global multi-target write switch. Existing single-target authentication and
write semantics remain unchanged. Keep cache none, plugins/UI off, strict PP without fallback,
per-request isolation, configuration drift rejection and existing shared process budgets.

## Consequences and residual limits

- Server, destination and IAM settings stay separate: all required layers must agree. Missing
  write grants and opt-ins deny writes; Admin does not bypass exact write grants.
- Existing read-only deployments do not acquire writes on upgrade. Target-filtered writable
  deployments retain the independent-single-target prohibition; standard mixed read deployments
  remain supported, quarantining write-related destination settings per target rather than
  allowing a destination owner to stop the whole app.
- One process still shares availability and operational limits. A pinned URL is not token isolation.
- ABAP repository writes affect other clients of the same physical SAP system. Package restrictions
  constrain edited objects, not the eventual behavior of ABAP code. Activation covers an entire owner.
- Existing BTP audit delivery is asynchronous, and already admitted work may complete while writes
  are being disabled. State these limits rather than imply transactional rollback or immediate revocation.
- Old refresh sessions can retain removed grants. Fresh authorization and verified permissions are
  required after IAM changes; role removal/sign-out do not revoke every outstanding token. New physical
  backends receive new public target IDs, avoiding silent reuse of old write grants.
- Operators need a tested minimal setup, effective-policy explanations and explicit restart/rollback
  steps. Configuration clarity is a release gate, not deferred documentation work.

## Acceptance before changing the boundary

Keep this ADR proposed until the plan's policy, negative tests, live XSUAA/client/PP/SAP evidence
and independent implementation security review pass for the advertised scope. Allocate a new
security-model risk entry at implementation time; do not reuse an occupied identifier from #906.
Update ADR-0006/0007/0008 qualifications and AGENTS only when this decision is accepted. Merging
this design document alone must not be represented as enabling writes or granting deployment approval.

## Alternatives

- Separate writable ARC-1 applications remain available for stronger operational isolation.
- Duplicate multi-target global write switches and a new `/write/mcp` path add configuration
  concepts without replacing target grants or package enforcement; rejected for this design.
- Full single-target parity, aggregate writes and shared-Basic writes are outside this decision.
