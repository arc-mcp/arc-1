# Multi-Target Endpoints

!!! warning "Experimental v1"

    This page describes the destination-discovered contract being implemented on the multi-target
    feature branch. It is default-off and must not be treated as production-ready until the feature
    PR is merged and the release notes name it.

One ARC-1 BTP Cloud Foundry application can serve many SAP system/client targets. An administrator
marks BTP subaccount destinations with `arc1.enabled=true`, restarts the app, and ARC-1 creates both:

- a fixed URL per target, for example `/A4H/100/mcp`; and
- one aggregate URL, `/multi/mcp`, whose SAP tools require a `target` such as `A4H/100`.

This is designed for installations with tens or hundreds of SAP clients. V1 supports up to 256
enabled targets; a 100-target installation is an intended use case.

```text
                         ┌─ /A4H/100/mcp ── A4H client 100
MCP client ─ ARC-1/XSUAA ├─ /A4H/200/mcp ── A4H client 200
                         ├─ /PRD/100/mcp ── PRD client 100
                         └─ /multi/mcp ───── explicit target on every call
                                      │
                                      └─ strict per-user Principal Propagation
```

## Why two endpoint styles?

Use a pinned endpoint when one conversation should stay on one SAP system/client. The URL establishes
the target before tool dispatch, and ordinary tool schemas do not gain any selector.

Use `/multi/mcp` when an estate is too large to configure a separate MCP connection for every target
or when one conversation must compare one or two systems. The aggregate server never has a default
or remembered target: every SAP-contacting call must name it explicitly.

Both styles appear together when:

```yaml
ARC1_MULTI_TARGET_ENDPOINTS: "true"
```

Bare `/mcp` is never assigned to a discovered destination. It remains available only for a separately
configured legacy single target.

## V1 safety boundary

Multi-target v1 is mutation-free:

- source and metadata reads are available by default;
- named data preview is an explicit instance **and** destination opt-in;
- freestyle SQL is an explicit instance **and** destination opt-in;
- SAP writes, activation, transport writes, and Git writes are unavailable on multi-target routes;
- cache is `none`;
- SAPLint, ATC, ABAP Unit, plugins, optional UI, and hyperfocused mode are not supported; and
- XSUAA plus strict on-premise Principal Propagation is required.

The multi-target ceiling cannot be bypassed by `MCPAdmin`, a write scope, or a write-enabled legacy
`/mcp` configuration.

Use separate ARC-1 instances, optionally behind the [Multi-System Hub](multi-system-hub.md), when
you need writes, target-specific pre-SAP visibility, separate identity/subaccount boundaries, or hard
failure and capacity isolation. Multi-target reduces CF application sprawl but remains one shared
process.

Read-only does not eliminate wrong-target confidentiality risk: an aggregate call can read data or
run SQL on the wrong authorized target. Data and SQL therefore stay off by default. Use separate
instances for lookalike production/non-production targets when explicit selection plus labels is not
a strong enough boundary.

## Target discovery

ARC-1 reads BTP **subaccount** destinations once at process startup. A recommended read/data/SQL
target is:

```properties
Name=ARC1_A4H_100_PP
Type=HTTP
URL=http://a4h-abap.internal:50000
ProxyType=OnPremise
Authentication=PrincipalPropagation
sap-sysid=A4H
sap-client=100
Description=A4H development client 100
arc1.enabled=true
arc1.allow_data_preview=true
arc1.allow_free_sql=true
```

`sap-sysid` and `sap-client` produce the public ID `A4H/100`. The destination name stays internal.
`Description` gives the user and LLM a meaningful label; missing descriptions warn and fall back to
the public ID. Only `arc1.enabled=true` is required by ARC-1; omit either `arc1.allow_*` property when
that target should remain source-only or should not permit that capability.

Supported target policy keys are intentionally small:

```properties
arc1.allow_data_preview=true
arc1.allow_free_sql=true
```

Missing values are false. These properties can only narrow/intersect the instance ceiling: an
instance value of `true` makes a capability eligible but does not enable it on every target, while an
instance value of `false` blocks it everywhere. Unknown `arc1.*` keys fail closed, and write-related
target keys quarantine the destination.
The two switches are independent: SQL does not automatically expose named table preview. There is
no `arc1.config_version` in v1 because the strict key allowlist is the schema.

Start with [Multi-System Setup](multi-target-setup.md), then use
[Multi-Target Administration](multi-target-administration.md) for exact field validation, conflict
rules, admin diagnostics, rate sizing, and troubleshooting.

## Aggregate tool behavior

The aggregate server adds one required top-level `target` to every SAP-contacting tool. It validates
and removes the selector before the normal ARC-1 handler processes the remaining arguments.

- Up to 16 targets use exact target enums; from 17 through 256 schemas use the SID/client pattern.
- Tool availability is the union of what at least one target can serve for the caller.
- The selected target's policy and features are checked again on every call.
- There is no “current target” in session state.

When more than one target is active, the aggregate server exposes `SAPTargets`. Readers receive only
configured IDs and descriptions. Admins receive registry state plus non-active exception details by
default, and can use `query` for matching active destination policy/configuration details. Admins see
the tool even with zero/one targets or registry failure so diagnostics remain reachable. Pinned
endpoints never expose `SAPTargets`. A listed target is configured, not proof that the current user
is mapped or authorized in SAP. Admin diagnostics are deterministically paged at 50 rows; follow
`diagnosticNextOffset` with the same query and the admin-only `offset` input to reach later rows.

## Authentication and visibility

The existing global XSUAA scopes remain in use. V1 does not create a role or XSUAA attribute per
system/client. An additive `@arc-mcp/xsuaa-auth` change supplies uncached Destination lookups,
original properties, and startup list helpers; its XSUAA scopes, roles, and verifier model stay
unchanged.

- Global read opens all accepted multi-target URLs and, when multiple targets are active, the compact
  `SAPTargets` catalog.
- Data/SQL scopes are additionally required for those operations.
- Global admin expands `SAPTargets` with secret-safe configuration diagnostics.
- SAP authorizations still apply to the propagated user in the selected SAP client.

ARC-1 cannot discover a user's true target access without contacting SAP. It therefore does not
probe every system, store availability, or cache denials. A failed call can be retried immediately
after Basis changes mapping or authorization.

Pinned endpoints and `/multi/mcp` require at least XSUAA read. Target inventory is available only
through the scoped `SAPTargets` MCP tool and is never public.

## Startup and destination changes

Zero active targets is a valid deploy-first state. Configure destinations after deployment and then
run:

```bash
cf restart <arc1-app-name>
```

A normal restart is sufficient; destination-only changes do not require rebuilding or redeploying
the MTAR. ARC-1 intentionally does not refresh the immutable registry at runtime.

Duplicate SID/client claims, duplicate names, and subaccount destinations shadowed by same-name
service-instance destinations have no implicit winner. All claimants are excluded until the
administrator resolves the conflict.

If more than 256 targets are enabled, no discovered target is activated. This avoids an unstable
“first 256” result.

Registry discovery/configuration errors keep `/health` at 200 with an `error` multi component so CF
does not crash-loop the app and admin `SAPTargets` remains available on `/multi/mcp`. A valid snapshot
reports `ready`, including zero-target and individually quarantined snapshots; quarantine details
appear as `degraded` only in the admin tool response. Pinned routes return 503 after a registry-wide
error; other aggregate tools return a structured registry error until restart.

## Client examples

Pinned VS Code/GitHub Copilot connection:

```json
{
  "servers": {
    "arc-1-a4h-100": {
      "type": "http",
      "url": "https://<arc1-route>/A4H/100/mcp"
    }
  }
}
```

Aggregate connection:

```json
{
  "servers": {
    "arc-1-multi": {
      "type": "http",
      "url": "https://<arc1-route>/multi/mcp"
    }
  }
}
```

VS Code/GitHub Copilot uses the existing XSUAA OAuth/DCR flow. Each pinned URL may trigger a separate
OAuth/DCR flow, so prefer the aggregate endpoint when a user needs more than a few targets and call
`SAPTargets` there to discover IDs and descriptions.

## Not in v1

- writes or a full-write destination configuration;
- target-specific ARC ACLs;
- API keys or direct Entra/IAS OIDC tokens on multi-target routes;
- SaaS subscriber/provider or cross-subaccount discovery;
- S/4HANA Public Cloud/SAML assertion destinations;
- a second technical/design-time destination;
- cache, plugins, optional UI integration, hyperfocused mode, SAPLint, ATC, or ABAP Unit;
- a browser HTML catalog and cookie/session login;
- per-target concurrency reservations; and
- destination changes without restart.

These are deferred, not assumed impossible. Writes in particular require a separate security review
because the aggregate endpoint deliberately permits explicit target switching.
