# ADR 0008 — Opt-In XSUAA Target Authorization

**Status:** Accepted design; implementation and live acceptance tracked in PR #677
**Date:** 2026-09-15
**Related:** [specification](../plans/xsuaa-target-authorization.md),
[ADR-0006](0006-experimental-read-only-multi-target.md),
[ADR-0007](0007-shared-basic-identity-for-read-only-multi-target.md)

## Context

Global `read` scope currently permits discovery and routing to every accepted multi-target
destination, with SAP authorization still enforced downstream. Some organizations additionally
require their configured system/client inventory and ARC-1 routing to follow IAM assignments.
Existing single-target and multi-target installations must not lose access on upgrade.

## Decision

Keep existing behavior when `ARC1_MULTI_TARGET_AUTHORIZATION` is omitted or `legacy`. Enable the
additional boundary only with `ARC1_MULTI_TARGET_AUTHORIZATION=xsuaa-attribute`. Unknown or empty
values are configuration errors; enabled enforcement never falls back to legacy on a missing
claim, malformed claim, backend failure or role combination.

Use XSUAA's native instance authorization model: one required string attribute `arc1_targets`,
supplied by static role values or an optional dedicated IAS attribute. Exact grants use the
existing canonical public system/client ID. The complete literal `*` is an explicit all-target
grant, including future targets; partial wildcards and Unrestricted are not supported. A separate
all-target template has that default. The ordinary target template has no default. Existing
functional roles and collections are not broadened; the new all-target collection is unassigned.

Only verified, supported XSUAA **user** principals enter enforced routes. The auth library exposes
allowlisted attributes and extraction status from SAP's validated security context, not a decoded
unverified JWT. Functional scopes remain global: their union is intersected with the target grant,
destination policy, instance ceiling, and SAP authorization. `admin` permits operator inventory,
not execution on an ungranted target.

The immutable caller projection must exist before constructing the MCP server, instructions or
tool schemas. The same projection applies to aggregate, pinned and Copilot compatibility routes.
Check a normalized requested target's grant before registry membership or outbound requests.
Unknown and ungranted targets receive indistinguishable execution errors. Responses containing
caller-specific information are private and non-storable, including streaming responses.

Enforced deployments are multi-only: reject independent single-target connection settings before
startup destination lookup, authentication or feature probes. Use a separate application and
XSUAA identity when an independent single-target endpoint is also needed.

In enforced mode only, qualify ADR-0006's paged catalog with a complete, unpaged catalog bounded to
256 total ARC-related destination candidates and 512 KiB for the complete serialized tool result.
Over-limit discovery yields an unavailable registry, never a partial routable snapshot. Readers
see granted active targets only. Admins see complete safe diagnostics and grant decisions without
raw entitlement arrays. Also qualify ADR-0007's eight-row passive Basic exception summary: the
bounded enforced catalog returns all matching exceptions and unfiltered aggregate counts.

All other ADR-0006/0007 constraints remain: mutation-free tools, per-target ceilings, strict PP,
default-off Basic with one-instance/lockout safeguards, and no PP-to-Basic fallback. This feature
does not authorize future multi-target writes, SaaS/cross-subaccount discovery, or another identity
provider protocol.

## Consequences

- Upgrades do not implicitly activate authorization. Prepare roles unassigned, enable and verify
  enforcement in an isolated pilot, then assign restricted users and verify fresh application tokens.
  Target roles also grant global `read`; pre-assignment on a legacy endpoint can broaden access.
  Actually unsetting it at runtime or selecting
  `legacy` is an IAM/security downgrade requiring the operator's change process; an environment
  administrator remains trusted. On CF, use explicit `ARC1_MULTI_TARGET_AUTHORIZATION: legacy`
  in the owning `.mtaext` for an approved rollback and verify the actual CF environment and logged
  mode. Deleting only the descriptor line may retain the already-deployed environment value.
  Downgrade also requires reviewing every reader (including target-role recipients) and outstanding
  tokens/refresh sessions; keep the route closed until all remaining readers are approved for legacy access.
- Static cohort roles need no IAS changes. Optional IAS mappings feed the same runtime contract;
  they are not a second authorization engine. Publish them as verified only after their live gates.
- There is no grant database, per-login SAP fan-out, new OAuth scope or target-specific permission
  cache. Revocation follows the verified token lifetime and tested refresh/sign-out behavior.
- Public alias changes require grant changes. Repointing a destination under the same ID retains
  its grants and requires appropriate operator review.
- The parser ceiling is not a promise that a 256-value enterprise token fits every gateway/client.
  Live token/header sizing and cross-application isolation are acceptance requirements.
- No customer-ready claim or auth-library release is justified by unit tests alone. The
  [implementation validation record](../research/2026-09-15-pr677-target-authorization-implementation.md)
  distinguishes local tests, live evidence and outstanding gates.

## Alternatives not selected

- Mandatory enforcement on upgrade: breaks existing role assignments and mixed deployments.
- Runtime fallback for missing grants: silently defeats the requested confidentiality boundary.
- Default `*` on the ordinary exact/IAS template: accidental broad access during setup.
- Per-user SAP access discovery/HANA cache: another entitlement store, freshness policy and login
  workload without an authoritative IAM assignment.
- AMS/provider framework or target/capability pairs: materially more setup and scope than the
  accepted first release; may be reconsidered independently for future capabilities.
