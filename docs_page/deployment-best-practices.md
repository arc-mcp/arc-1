# Deployment design

<a id="arc-1-deployment-best-practices"></a>

Choose the instance boundaries, SAP identity and capacity before deploying ARC-1.
For commands, use the [deployment guide](deployment.md) or [BTP runbook](btp-cloud-foundry-deployment.md).

## One Instance Per SAP System

Use a separate ARC-1 deployment per SAP backend when you need writes or independent policy and capacity.
Several users can share it through PP or per-user BTP ABAP token exchange.

### Why one-per-system?

| Requirement | Deployment choice |
|---|---|
| Write access | Single target with a restricted package ceiling |
| Independent dev/production controls | Separate instances, routes and SAP credentials/trust |
| Mutation-free access to several BTP targets | [Experimental multi-target mode](multi-target-setup.md) |
| Horizontal scaling with multi-target | PP-only targets; shared Basic requires exactly one instance |

### Multi-user within each instance

For human access, use per-user SAP identities. Prefer separate strict PP and API-key automation instances.
With PP enabled, set `SAP_PP_STRICT=true` explicitly to reject API-key/non-JWT tool calls.
If unset or `false`, API-key calls use the configured shared SAP client and startup warns about mixed identities.
JWT PP failures always return an error; they never fall back to the shared user.

### Scaling out: what changes at more than one instance

HTTP MCP requests and DCR registration validation do not require sticky sessions when all instances share the intended signing key.
Capacity controls and caches still belong to each process:

| State | Effect with N processes | Action |
|---|---|---|
| HTTP and per-user rate limits | Aggregate allowance can reach N × each limit | Enforce a fleet limit at the gateway or size each process accordingly |
| SAP concurrency | Aggregate in-flight requests can reach N × `ARC1_MAX_CONCURRENT` | Budget against every process reaching the SAP backend |
| Feature/source caches | Each process starts cold | Include repeated probes and reads in load measurements |
| Shared Basic multi-target guard | Cannot coordinate across processes | Keep exactly one instance and no deployment overlap |

Measure SAP latency, queueing and process memory before scaling. See [Rate Limiting](rate-limiting.md) and
[BTP RAM sizing](btp-administration.md#data-preview-ram-sizing).
SQLite persists source on disk; it is not a shared authorization or rate-limit store.

### What to alert on

| Signal | Audit evidence |
|---|---|
| Tool failures | `tool_call_end`, `status=error`, grouped by `errorClass` |
| Latency | Tool and SAP `http_request.durationMs` percentiles |
| Authentication failures | `pp_exchange_failed`, `sap_authentication_failed`, failed `auth_pp_created` |
| Policy denials | `auth_scope_denied`, `safety_blocked`, `target_policy_denied` |
| Saturation | `mcp_rate_limited`, upstream HTTP `429`/`503`, `data_response_limited` |

ARC-1 emits events; your log platform sends alerts. Use [Log Analysis](log-analysis.md) to correlate them.

### Trace context and agent attribution

A valid inbound `traceparent`/`tracestate` passes through to SAP unchanged. ARC-1 does not originate traces;
its own `requestId` still correlates audit events. Malformed trace values are dropped.

`clientAgent` records MCP handshake `name/version` in stdio and the caller's `User-Agent` over stateless HTTP.
It is caller-controlled attribution, not authorization. Under PP, SAP records the human user; correlate agent activity in ARC-1 logs.

### Example: enterprise with multiple SAP systems

Keep one reviewed landscape `.mtaext` per deployment, based on `mta-overrides.mtaext.example`.
Deploy each into its intended CF space with the [BTP runbook](btp-cloud-foundry-deployment.md).
Record the actual route from `cf app <app-name>` and use that URL in clients.

Give direct-connect instances distinct `ARC1_SERVER_NAME` values, such as `arc1-dev` and `arc1-prod`.
For clients that hide the handshake name, also set `ARC1_SYSTEM_LABEL`, such as `ERP production (read-only)`.
Multi-target mode uses its public target IDs and ignores the single-target label.

## System Type Detection

<a id="how-it-works"></a>

ARC-1 detects BTP ABAP from the `SAP_CLOUD` component during the system probe.
Set `SAP_SYSTEM_TYPE=btp` or `onprem` when the type must be known before the first probe; `auto` is the default.

### Manual override

```text
SAP_SYSTEM_TYPE=btp
```

### What changes on BTP

Tool definitions exclude classic-only operations and guide callers toward released/custom cloud objects.
Backend discovery still determines which actions are available. Use [Tool Reference](tools.md) for the maintained type/action lists.

## Authentication Options

<a id="local-development"></a><a id="deployed-on-btp-cloud-foundry"></a><a id="configuration-examples"></a>

| Where ARC-1 runs / target | SAP authentication | Guide |
|---|---|---|
| Local / on-premise | Your SAP user through Basic auth | [Quickstart](quickstart.md) |
| Local / BTP ABAP | Service-key browser OAuth | [BTP ABAP](btp-abap-environment.md) |
| BTP CF / on-premise | Destination + Cloud Connector PP | [BTP: Start Here](btp-overview.md) |
| BTP CF / BTP ABAP | `OAuth2UserTokenExchange` destination | [BTP ABAP](btp-abap-environment.md) |

## Security Recommendations

Keep unneeded mutation/data flags off, use a narrow package allowlist and verify SAP-side identity.
Use trusted TLS, explicit HTTP authentication and a stable DCR signing secret for XSUAA deployments.
Review [Production Security](security-guide.md) before exposing the service.

## Security Hardening

A reverse proxy must sanitize forwarded headers and preserve the intended OAuth/MCP routes.
See [proxy requirements](security-guide.md#7-reverse-proxy-requirements).

## Key Files Reference

| File | Role |
|---|---|
| `mta.yaml` | Tracked MTA services and target-free defaults |
| `mta-overrides.mtaext.example` | Template to copy for a landscape extension |
| `mta-*.mtaext` | Local, gitignored landscape settings |
| `manifest.yml` / `manifest-btp-abap.yml` | Direct CF templates; inspect before use. The BTP ABAP template enables writes, free SQL and transport writes and uses `:latest`. Prefer the read-only MTA setup. |
| `Dockerfile` | Maintained container build |
| `.env.example` | Local configuration template |
| `xs-security.json` | XSUAA scopes, roles and redirect policy; update through its lifecycle owner |

## Deploying Without Docker

Follow the [Node.js buildpack path](btp-cloud-foundry-deployment.md#deploying-without-docker-nodejs-buildpack).

## BTP ABAP Environment Setup

Start with [BTP ABAP prerequisites](btp-abap-prerequisites.md), then choose the local or deployed
path in [BTP ABAP setup](btp-abap-environment.md).
