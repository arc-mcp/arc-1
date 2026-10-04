# Operations Overview

Use this page after ARC-1 has passed its first safe read. It routes service owners to the correct
operational runbook without mixing platform deployment, target diagnostics, performance controls,
and incident response in one long page.

## Choose the operational task

| Task | Start with |
|------|------------|
| Operate an SAP BTP Cloud Foundry deployment | [BTP Administration](btp-administration.md) |
| Diagnose a multi-target destination, exclusion, identity, or route | [Multi-Target Administration](multi-target-administration.md) |
| Upgrade, roll back, or pin a version | [Updating](updating.md) |
| Investigate a failed tool call or correlate request IDs | [Log Analysis](log-analysis.md) |
| Protect SAP from runaway clients or size concurrency | [Rate Limiting](rate-limiting.md) |
| Choose or troubleshoot request-driven caching | [Caching](caching.md) |
| Verify API key, OIDC, XSUAA, roles, or Principal Propagation | [Authentication Test Process](auth-test-process.md) |
| Review production controls before exposure | [Production Security](security-guide.md) |

## Shared operating model

Regardless of deployment platform:

1. identify the exact ARC-1 version, route, target, user, and request ID;
2. confirm the instance safety ceiling and the caller's scope before investigating SAP;
3. distinguish ARC-1 authentication from SAP identity and SAP authorization;
4. make the smallest reversible configuration change;
5. retest one safe read and the intended negative boundary; and
6. reconcile emergency runtime changes into the durable deployment configuration.

ARC-1 health means only that the process is running. It does not prove Destination Service,
Principal Propagation, SAP authorization, a usable target registry, data/SQL policy, or MCP client
token freshness.

## Platform-specific ownership

### SAP BTP Cloud Foundry

Use [BTP Administration](btp-administration.md) for configuration ownership, restart/restage/redeploy
decisions, XSUAA role collections, DCR signing secrets, scaling, upgrades, rollback, and customer
handover. For initial setup or topology selection, return to
[SAP BTP: Start Here](btp-overview.md).

### Docker or another shared host

Use the [Docker guide](docker.md) for image, volume, networking, and container lifecycle details.
Then apply the same [updating](updating.md), [logging](log-analysis.md),
[rate-limiting](rate-limiting.md), [caching](caching.md), and
[security](security-guide.md) controls. Ensure TLS and Layer A authentication are provided before
exposing HTTP transport to a network.

### Local development

Local stdio and test environments are not production services. Use
[Local Development](local-development.md) for developer workflows and
[Authentication Test Process](auth-test-process.md) only when validating an HTTP authentication
path.

## Incident evidence to preserve

Collect only secret-safe evidence:

- ARC-1 version and configuration source, without credentials or tokens;
- timestamp, request/correlation ID, public target ID, action, status, and duration;
- relevant ARC-1 audit/application log records;
- Cloud Foundry instance and service-binding health where applicable;
- Cloud Connector and SAP error references owned by the respective administrators; and
- the last known-good version and rollback procedure.

Never paste unredacted `cf env`, destination exports containing credentials, bearer tokens,
Principal Propagation assertions, cookie files, or SAP passwords into an issue or support chat.
