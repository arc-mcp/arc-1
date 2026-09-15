# Operations Overview

Use these runbooks to maintain a working ARC-1 service or investigate a failure.
For a first deployment, start with [deployment options](deployment.md).

## Choose the operational task

| Task | Runbook |
|---|---|
| Operate SAP BTP Cloud Foundry | [BTP Administration](btp-administration.md) |
| Diagnose a target, identity or route | [Multi-Target Administration](multi-target-administration.md) |
| Upgrade, roll back or pin a version | [Updating](updating.md) |
| Investigate a failed tool call | [Log Analysis](log-analysis.md) |
| Size concurrency or investigate throttling | [Rate Limiting](rate-limiting.md) |
| Choose or troubleshoot a cache | [Caching](caching.md) |
| Verify authentication and permissions | [Authentication Test Process](auth-test-process.md) |
| Review access before exposing a server | [Production Security](security-guide.md) |

## Shared operating model

For an incident:

1. Capture the ARC-1 version, route, public target, user, timestamp and request ID.
2. Find the failed gate: MCP sign-in, ARC-1 policy, SAP connectivity or SAP authorization.
3. Make a reversible change in the configuration owned by that layer.
4. Retest a safe SAP read and a request that should remain denied.
5. Copy emergency runtime changes into the durable deployment configuration.

`/health` confirms that ARC-1 is running. It does not verify a SAP target, destination, user mapping or permission.

## Platform-specific ownership

<a id="sap-btp-cloud-foundry"></a><a id="docker-or-another-shared-host"></a><a id="local-development"></a>

| Platform | Configuration and lifecycle owner |
|---|---|
| BTP Cloud Foundry | [BTP Administration](btp-administration.md): descriptors, services, roles, restart/restage and rollback |
| Docker or shared host | [Docker guide](docker.md): image, secret injection, persistent volumes and TLS proxy |
| Local development | [Local Development](local-development.md): process environment and local client configuration |

## Incident evidence to preserve

Keep relevant sanitized ARC-1 logs, the last known-good version and the rollback procedure.
For BTP, record app/service health and ask the Cloud Connector or SAP owner for the matching error reference.

Share identifiers and error codes. Keep bearer tokens, passwords, cookies, PP assertions and unredacted `cf env` output out of tickets and chat.
