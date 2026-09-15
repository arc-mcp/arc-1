# Deployment

Run ARC-1 as a shared service for your team. Choose a host and SAP identity model below; for one developer on a laptop, use [Local development](local-development.md).

## Decision tree

| You need | Setup guide | Identity SAP sees |
|---|---|---|
| BTP Cloud Foundry with on-premise SAP | [BTP: Start here](btp-overview.md) | Each user's SAP identity with Principal Propagation |
| BTP Cloud Foundry with BTP ABAP Environment | [BTP ABAP setup](btp-abap-environment.md) | Each user's identity through `OAuth2UserTokenExchange` |
| BTP Cloud Foundry with S/4HANA Public Cloud | [Public Cloud setup](s4hana-public-cloud.md) | Each user's identity through a `SAMLAssertion` destination |
| Docker on a VM or container host | [Docker guide](docker.md) | Shared SAP account with Basic auth |

**MCP login and SAP login are separate.** An API key, OIDC, or XSUAA authenticates the caller to ARC-1. Principal Propagation passes that identity to SAP. OIDC with a Basic SAP connection still uses one shared SAP account.

## Docker on any VM

The host must reach the SAP HTTPS endpoint. Start with [the Docker quick start](docker.md#quick-start), which configures an authenticated, read-only HTTP server.

### Shared service account + API key

Store the SAP connection and ARC-1 key in a protected runtime env file:

```dotenv
SAP_URL=https://your-sap-host:44300
SAP_CLIENT=100
SAP_USER=SVC_ARC1
SAP_PASSWORD=<SAP-password>
ARC1_API_KEYS=<random-key>:viewer
```

Use a securely generated key and supply it to clients as `Authorization: Bearer <random-key>`. See [API key setup](api-key-setup.md).

### Shared service account + per-user OIDC

To identify each caller in ARC-1, configure [OIDC](oauth-jwt-setup.md):

```dotenv
SAP_OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0
SAP_OIDC_AUDIENCE=<client-id-guid>
```

ARC-1 logs identify the MCP user; SAP logs identify the shared account. Startup checks the SAP credentials and blocks tool calls on 401/403. Correct the credentials or SAP authorization, then restart ARC-1 to rerun the check.

## BTP Cloud Foundry with Principal Propagation

<a id="youll-need"></a>
<a id="shape"></a>
<a id="config"></a>

Use [Cloud Foundry deployment](btp-cloud-foundry-deployment.md). The runbook deploys XSUAA, Destination and Connectivity services, then connects through Cloud Connector to on-premise SAP:

```text
MCP user → XSUAA → ARC-1 → Destination → Cloud Connector → user's SAP account
```

Choose the single-PP profile for one `/mcp` target or the multi-PP profile for several mutation-free targets. Keep durable application settings in the customer `.mtaext`.

With `SAP_PP_ENABLED=true`, JWT propagation failures return an error; they never fall back to the shared SAP user. Set `SAP_PP_STRICT=true` explicitly to reject API-key/non-JWT tool calls. If it is unset or `false`, configured API keys use the shared SAP client and startup logs a mixed-mode warning. See [Principal propagation](principal-propagation-setup.md).

## BTP Cloud Foundry + BTP ABAP Environment

Use [BTP ABAP Environment setup](btp-abap-environment.md). In the same subaccount, a destination with `OAuth2UserTokenExchange` exchanges the MCP user's token for an ABAP token. No Cloud Connector is needed.

The destination holds the OAuth client settings from the ABAP service key. Do not mount the key into the shared ARC-1 service or use the local browser-login flow there.

## Hardening checklist

Before opening the endpoint to a team:

- Terminate public traffic with TLS and configure API key, OIDC, or XSUAA authentication.
- Keep the initial service read-only. Enable data, SQL, or mutations only when needed, with narrow package permissions.
- Set a per-user rate limit for the expected workload; `ARC1_RATE_LIMIT` defaults to off.
- Protect credentials, audit logs, and any persistent source cache.
- Pin the deployed version and record an [update and rollback procedure](updating.md).

User scopes only restrict the server's safety settings; they cannot enable a capability the server disables. See [Authorization](authorization.md#capability-requirements) and the [Security guide](security-guide.md).

## Coexistence rules

| Combination | Result |
|---|---|
| PP and shared cookies | Startup error unless `SAP_PP_ALLOW_SHARED_COOKIES=true` explicitly permits them |
| Local service-key OAuth and cookies | Startup error |
| Local service-key OAuth and PP | Startup error |
| `SAP_DISABLE_SAML=true` with BTP ABAP or Public Cloud | Breaks cloud authentication; leave it disabled |

For supported authentication combinations, see the [coexistence matrix](enterprise-auth.md#coexistence-matrix).

## Next

- [Configuration reference](configuration-reference.md): flags and defaults
- [Authorization](authorization.md): user roles and server limits
- [Deployment best practices](deployment-best-practices.md): isolation and multiple systems
