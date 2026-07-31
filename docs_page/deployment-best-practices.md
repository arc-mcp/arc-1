# ARC-1 Deployment Best Practices

## One Instance Per SAP System

ARC-1 follows the **one instance per SAP backend** pattern by default. This is the recommended model
for writes and for hard security/capacity isolation, and matches Eclipse ADT, SAP Business
Application Studio, and SAP GUI. A separate [experimental multi-target mode](multi-target-setup.md)
offers mutation-free access to many BTP subaccount destinations when application sprawl is the
larger operational risk.

### Why one-per-system?

| Concern | One-per-system | Multi-backend gateway |
|---------|---------------|----------------------|
| **Security** | Blast radius = one system | One breach = all systems |
| **Auth** | Clean: one auth flow per instance | N destinations + N auth flows |
| **Safety gates** | Per-system: `allowWrites`, `allowedPackages`, `denyActions` | Multi-target writes are unavailable; data/SQL can narrow per destination but the instance remains the ceiling |
| **Tool descriptions** | Tailored to system type (BTP vs on-premise) | Must be generic for all |
| **Audit trail** | Clear per-system logs | Mixed across systems |
| **Scaling** | Scale independently | Heavy-use system affects all |

### Multi-user within each instance

Each ARC-1 instance serves **multiple users** via principal propagation (on-premise) or a per-user BTP Destination token exchange (BTP ABAP). The MCP client authenticates the user, and ARC-1 maps that to a SAP user identity.

```
                    ┌─────────────────┐
                    │  MCP Client      │
                    │  (Claude, etc.)  │
                    └──┬──────────┬───┘
                       │          │
                       ▼          ▼
┌─────────────────────┐ ┌──────────────────────┐
│ arc1-ecc-dev        │ │ arc1-btp-dev         │
│ on-premise, PP      │ │ BTP ABAP, OAuth2 UTE │
│ allowWrites=true    │ │ allowWrites=true     │
│ 50 developers       │ │ 50 developers        │
└──────┬──────────────┘ └──────┬───────────────┘
       ▼                       ▼
┌──────────────┐      ┌──────────────────┐
│ SAP ECC Dev  │      │ BTP ABAP Env     │
└──────────────┘      └──────────────────┘
```

### Scaling out: what changes at more than one instance

ARC-1 is stateless in the sense that matters for load balancing — **any instance can serve any
request**, no sticky sessions, no session store (the MCP HTTP transport runs in stateless mode, and
OAuth `client_id`s are HMAC-derived rather than stored). The tracked `mta.yaml` pins `instances: 1`;
raising it is safe, but four things are **per-process**, so they divide (or break) when you do:

| Per-process state | Effect at N instances | What to do |
|---|---|---|
| `ARC1_RATE_LIMIT` (Layer 2, per-user) and `ARC1_MCP_HTTP_RATE_LIMIT` (per-IP) | Each instance counts independently → the effective limit is **N×** the configured value | Divide the configured value by N, or enforce the real ceiling at the router/API gateway |
| `ARC1_MAX_CONCURRENT` (Layer 3 SAP semaphore) | Same — total concurrent SAP requests is **N×** the value | Size `N × ARC1_MAX_CONCURRENT` against `rdisp/wp_no_dia`, not the single-instance number |
| Feature probe + source/ETag cache (`ARC1_CACHE=auto` → in-memory) | Cold per instance; a user's cache hit rate drops roughly 1/N, and each instance runs its own startup probe | Accept it, or use `ARC1_CACHE=sqlite` on a shared volume — but note that stores SAP source unencrypted at rest, so use an encrypted volume |
| ADR-0007 shared-Basic multi-target guard | **Hard requirement: exactly one instance.** The generation/lockout guard that prevents a shared technical user from being locked out is process-local | Do not scale out. This mode is single-instance by contract |

Scale **up** (memory/CPU per instance) before scaling out unless you have measured that one instance
is the bottleneck — a single ARC-1 instance is almost always waiting on SAP, not on itself.

### What to alert on

ARC-1 emits structured audit events to stderr (and optionally a file or the BTP Audit Log); it does
not alert. Wire these into your APM/log platform:

| Signal | Event / field | Why |
|---|---|---|
| Error-rate spike | `tool_call_end` with `status: "error"`, grouped by `errorClass` | A backend or authorization regression shows up here before users report it |
| Latency degradation | `tool_call_end.durationMs` p95, and `http_request.durationMs` for the SAP leg | Separates "ARC-1 is slow" from "SAP is slow" |
| Authentication failures | `auth_pp_created` with `success: false`, `pp_exchange_failed`, `sap_authentication_failed` | A broken destination/trust config fails closed and silently until someone looks |
| Authorization denials | `auth_scope_denied`, `safety_blocked`, `target_policy_denied` | A burst means a misconfigured client or a model probing beyond its scope |
| Rate-limit saturation | `mcp_rate_limited` | A runaway agent loop; also the signal that your limit is too tight |
| Attribution | `clientId` (registered OAuth client), `clientAgent` (client software), `user` on every event | Answers "which agent, acting for whom" — see [Trace context and agent attribution](#trace-context-and-agent-attribution) |

### Trace context and agent attribution

Aligned with the SAP Architecture Center guidance for
[third-party MCP access](https://architecture.learning.sap.com/docs/ref-arch/137800):

- **W3C trace context passes through.** A valid `traceparent` (and its `tracestate`) on an inbound
  MCP request is forwarded verbatim on every outbound SAP call, so one trace spans agent → ARC-1 →
  SAP. ARC-1 runs no tracer of its own, so per the [W3C spec](https://www.w3.org/TR/trace-context/)
  it behaves as a non-participating pass-through: it never rewrites `parent-id` and **never
  originates a trace** when the client sent none. Malformed values are dropped, not repaired.
  ARC-1's own `requestId` correlates its logs either way. No configuration.
- **`clientAgent` records the calling agent.** On stdio it is the MCP handshake `clientInfo`
  (`name/version`); over HTTP the transport is stateless, so it is the `User-Agent` — best-effort,
  caller-controlled, and never an authorization input. It sits next to `clientId` (the registered
  OAuth client) on every audit event and in the BTP Audit Log.
- **SAP still sees the human, not the agent.** Principal propagation exchanges the user token for a
  scoped per-user SAP credential (RFC 8693 via the Destination Service), and ABAP has no claim slot
  for an agent identity — so SAP-side logs (SM20, transport owner, `adtcore:changedBy`) attribute
  the *user*. Agent attribution lives in ARC-1's audit trail; correlate on `requestId`/`traceparent`.

### Example: enterprise with multiple SAP systems

Use one `mta.yaml` with different `.mtaext` files per landscape. The `.gitignore` matches any `mta-*.mtaext`, so per-landscape extension files (`mta-ecc-dev.mtaext`, `mta-ecc-prod.mtaext`, …) stay local — only the `mta-overrides.mtaext.example` template is tracked. Copy it once per landscape:

```bash
cp mta-overrides.mtaext.example mta-ecc-dev.mtaext   # edit: writes enabled
cp mta-overrides.mtaext.example mta-ecc-prod.mtaext  # edit: read-only

# Build once
mbt build

# Deploy to dev — writes enabled
cf deploy mta_archives/arc1-mcp_*.mtar -e mta-ecc-dev.mtaext

# Deploy to prod — read-only
cf deploy mta_archives/arc1-mcp_*.mtar -e mta-ecc-prod.mtaext
```

> **Route URL:** pin a `host:` in each `.mtaext` so the app gets the short, predictable URL its MCP clients connect to (`arc1-ecc-dev` → `https://arc1-ecc-dev.cfapps.<region>.hana.ondemand.com/mcp`). Without a pinned host the deploy service assigns a long, globally-unique auto-route that you only learn after deploy via `cf app <name>`. The host must be free across the *whole* shared `cfapps.<region>.hana.ondemand.com` domain (unique per region, not per subaccount), so use landscape-specific names. See the "Route host" block in `mta-overrides.mtaext.example`.

```
CF Apps:
┌──────────────────────────────────┐
│ arc1-ecc-dev                     │  ECC Dev, read+write, PP
│ allowWrites=true                 │
├──────────────────────────────────┤
│ arc1-ecc-prod                    │  ECC Prod, read-only, PP
│ allowWrites=false, allowFreeSQL=false │
├──────────────────────────────────┤
│ arc1-s4-dev                      │  S/4 Dev, read+write, PP
│ allowWrites=true                 │
├──────────────────────────────────┤
│ arc1-btp-dev                     │  BTP ABAP, read+write, OAuth2UserTokenExchange
│ SAP_SYSTEM_TYPE=btp              │
│ allowWrites=true                 │
└──────────────────────────────────┘
```

MCP client config for developers:

```json
{
  "mcpServers": {
    "sap-ecc-dev": {
      "url": "https://arc1-ecc-dev.cfapps.us10.hana.ondemand.com/mcp"
    },
    "sap-ecc-prod": {
      "url": "https://arc1-ecc-prod.cfapps.us10.hana.ondemand.com/mcp"
    },
    "sap-s4-dev": {
      "url": "https://arc1-s4-dev.cfapps.us10.hana.ondemand.com/mcp"
    },
    "sap-btp": {
      "url": "https://arc1-btp-dev.cfapps.us10.hana.ondemand.com/mcp"
    }
  }
}
```

The LLM sees separate tool sets from each server and picks the right one.

> **Name each direct-connect instance:** every ARC-1 advertises the server name `arc-1` in the MCP `initialize` handshake by default. Clients such as VS Code derive tool prefixes from that announced name and add numeric suffixes when several servers announce the same value. Set a unique [`ARC1_SERVER_NAME`](configuration-reference.md#server-runtime) per instance (`arc1-ecc-dev`, `arc1-ecc-prod`, …) in each `.mtaext` so the tool prefix identifies the target system. This is the direct-connect alternative to [native multi-target mode](multi-target-setup.md), which exposes pinned and aggregate routes from one ARC-1 deployment.

---

## System Type Detection

ARC-1 auto-detects whether it's connected to a BTP ABAP Environment or an on-premise system.

### How it works

On first `SAPManage probe`, ARC-1 reads `/sap/bc/adt/system/components` (already called for ABAP release detection — zero extra HTTP requests). If the `SAP_CLOUD` component is present, the system is BTP. Otherwise, on-premise.

### Manual override

For immediate correct tool definitions at startup (before the first probe), set:

```bash
# Environment variable
SAP_SYSTEM_TYPE=btp    # or: onprem, auto (default)

# CLI flag
--system-type btp
```

When `SAP_SYSTEM_TYPE=btp` is set, tool definitions are adapted at server startup:
- SAPRead removes PROG, INCL, VIEW, TRAN, TEXT_ELEMENTS, VARIANTS, SOBJ, AUTH, FEATURE_TOGGLE/FTG2, ENHO, VERSIONS, and VERSION_SOURCE from the type enum
- SAPWrite removes PROG, INCL, FUNC, and FUGR from the type enum
- SAPQuery description warns about blocked SAP standard tables
- SAPTransport description explains gCTS behavior
- SAPContext removes PROG and FUNC from the type enum

### What changes on BTP

| Tool | What changes |
|------|-------------|
| **SAPRead** | Keeps cloud-facing types: CLAS, INTF, FUNC/FUGR where released/custom, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD, TABL, DOMA, DTEL, TABLE_CONTENTS, TABLE_QUERY, DEVC, SYSTEM, COMPONENTS, MSAG, BSP/BSP_DEPLOY, API_STATE, INACTIVE_OBJECTS. Removes classic-only types and returns a helpful error if the LLM tries them anyway. |
| **SAPWrite** | Supports CLAS, INTF, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD, TABL/TABL/DT/TABL/DS, DOMA, DTEL, MSAG. Must use ABAP Cloud syntax and custom namespaces. |
| **SAPQuery** | Warns that SAP standard tables (DD02L, TADIR, etc.) are blocked. Suggests CDS views. |
| **SAPSearch** | Notes that only released and custom objects are returned. |
| **SAPTransport** | Explains gCTS: release = Git push, not TMS export. |
| **SAPContext** | Supports CLAS, INTF, and DDLS. CDS impact analysis is available for DDLS. |
| **SAPManage** | Returns `systemType` in probe results. |
| **SAPActivate** | No change. |
| **SAPNavigate** | Notes released object scope. |
| **SAPLint** | No change. |
| **SAPDiagnose** | No change. |

---

## Authentication Options

### Local development

| Target | Auth | Config |
|--------|------|--------|
| On-premise SAP | Basic Auth | `SAP_URL`, `SAP_USER`, `SAP_PASSWORD` |
| BTP ABAP Environment | Service Key + Browser OAuth | `SAP_BTP_SERVICE_KEY_FILE` |

### Deployed on BTP Cloud Foundry

| Target | Auth | Config |
|--------|------|--------|
| On-premise SAP (via Cloud Connector) | Principal Propagation | `SAP_BTP_DESTINATION`, `SAP_PP_ENABLED=true`, `SAP_PP_STRICT=true` |
| BTP ABAP Environment | Destination `OAuth2UserTokenExchange` | `SAP_BTP_DESTINATION`, `SAP_PP_ENABLED=true`, `SAP_PP_STRICT=true`, `SAP_SYSTEM_TYPE=btp` |

### Configuration examples

**Local dev connecting to on-premise:**
```json
{
  "mcpServers": {
    "sap": {
      "command": "arc1",
      "env": {
        "SAP_URL": "http://sap-dev:50000",
        "SAP_USER": "DEVELOPER",
        "SAP_PASSWORD": "..."
      }
    }
  }
}
```

**Local dev connecting to BTP ABAP:**
```json
{
  "mcpServers": {
    "sap-btp": {
      "command": "arc1",
      "env": {
        "SAP_BTP_SERVICE_KEY_FILE": "~/.config/arc-1/btp-service-key.json",
        "SAP_SYSTEM_TYPE": "btp"
      }
    }
  }
}
```

**Deployed on CF connecting to on-premise (multi-user):**
```yaml
# manifest.yml
applications:
  - name: arc1-ecc-dev
    env:
      SAP_BTP_DESTINATION: SAP_ECC_DEV
      SAP_PP_ENABLED: true
      SAP_PP_STRICT: true
      SAP_TRANSPORT: http-streamable
      SAP_XSUAA_AUTH: true
```

---

## Security Recommendations

1. **Use `SAP_ALLOW_WRITES=false` for production systems** — prevents object, transport, and Git mutations
2. **Use `SAP_ALLOW_FREE_SQL=false` for sensitive systems** — blocks arbitrary SQL queries
3. **Use `SAP_ALLOWED_PACKAGES=Z*,Y*,$TMP`** — restricts write operations to custom code packages (default is `$TMP` only — local objects)
4. **Choose the PP/API-key identity topology explicitly** — separate strict PP and least-privileged API-key instances are recommended; supported mixed instances set `SAP_PP_STRICT=false`
5. **Deploy separate instances per system** — limits blast radius
6. **Use XSUAA auth for deployed instances** — proper OAuth 2.0 with scopes (read/write/data/sql/transports/git/admin)
7. **Set `SAP_SYSTEM_TYPE`** explicitly in production — ensures correct tool definitions from startup
8. **Keep `SAP_INSECURE=false` on CA-signed landscapes** — the tracked `mta.yaml` / `manifest.yml` ship `"false"`; only set it `"true"` in isolated development when you deliberately accept all SAP certificates
9. **Set `ARC1_RATE_LIMIT` (e.g. `60`) on multi-user instances** — the per-user MCP quota is off by default, so one runaway agent loop can saturate the shared SAP request semaphore
10. **Set a stable `ARC1_DCR_SIGNING_SECRET` on XSUAA OAuth instances** — otherwise the DCR signing key derives from the XSUAA `clientsecret`, so every `cf deploy` that recreates the service binding rotates it and invalidates all cached MCP `client_id`s. Users then hit `invalid_client` after each redeploy, and some clients (Eclipse Copilot, Cursor) can't recover without manual cache surgery. Set it once with `cf set-env arc1-mcp-server ARC1_DCR_SIGNING_SECRET "$(openssl rand -base64 48)"`; see [Stable DCR signing key](xsuaa-setup.md#stable-dcr-signing-key-recommended)

!!! note "Why the package allowlist matters"
    ARC-1 feeds SAP-resident content (source, comments, errors) to the LLM, which then issues tool calls under the user's identity. `SAP_ALLOWED_PACKAGES` is the backstop that contains a prompt-injected model writing outside its scope — prefer a DEVCLASS subtree (`ZTEAM/**`) over `*` so the containment survives even a steered model.

---

## Security Hardening

For a comprehensive security hardening checklist covering TLS, header validation, token handling, and production lockdown, see the [Security Guide](security-guide.md).

If you deploy ARC-1 behind a reverse proxy (nginx, Envoy, etc.) outside of Cloud Foundry, ensure the proxy strips or sanitizes inbound `X-Forwarded-*` and `Forwarded` headers before forwarding to ARC-1. Unsanitized forwarded headers can lead to SSRF or authentication bypass if ARC-1 or downstream services trust them for request routing.

---

## Key Files Reference

| File | Purpose | Customize? |
|------|---------|-----------|
| `mta.yaml` | MTA build descriptor — services, conservative `SAP_ALLOW_*` defaults, and no active/fake destination. Tracked. Ships `SAP_INSECURE: "false"`; prefer `NODE_EXTRA_CA_CERTS` for internal CAs over disabling verification. | Rarely — use `.mtaext` for overrides |
| `mta-overrides.mtaext.example` | Tracked template documenting every overridable property. | No — copy it to `mta-overrides.mtaext` (gitignored) and edit that |
| `mta-overrides.mtaext` (or any `mta-*.mtaext`) | Per-landscape MTA extension (real destinations, safety flags). **Gitignored.** | Yes — uncomment and set values for your environment |
| `manifest.yml` | CF deployment manifest (on-premise via Cloud Connector) | Yes — change `SAP_URL`, destination name, safety flags |
| `manifest-btp-abap.yml` | CF deployment manifest (BTP ABAP via per-user destination) | Yes — set the destination name and safety flags; do not mount the ABAP service key into ARC-1 |
| `Dockerfile` | Multi-stage Alpine build, all env vars documented | Rarely — use env vars for config |
| `.env.example` | Template for local `.env` file | Yes — copy to `.env` and fill in |
| `xs-security.json` | XSUAA scopes, roles, redirect URIs | Yes — add redirect URIs for your MCP clients |
| `bin/arc1.js` | npm global CLI entry point | No |

## Deploying Without Docker

If the Docker image doesn't fit your needs (custom certs, patching, compliance), deploy as a Node.js app using CF's `nodejs_buildpack`. See [BTP CF Deployment](btp-cloud-foundry-deployment.md#deploying-without-docker-nodejs-buildpack) for the full guide.

Quick summary:
1. `git clone` + `npm ci` + `npm run build`
2. Create a `manifest-nodejs.yml` with `buildpacks: [nodejs_buildpack]` and `command: node dist/index.js`
3. `cf push -f manifest-nodejs.yml`
4. Set secrets via `cf set-env`

---

## BTP ABAP Environment Setup

See [BTP ABAP Environment guide](btp-abap-environment.md) for:
- Provisioning the BTP ABAP instance
- Running the "Prepare an Account for ABAP Development" booster
- Creating a service key for local OAuth or destination credentials
- Configuring ARC-1 locally with service-key browser OAuth
- Configuring deployed ARC-1 with `OAuth2UserTokenExchange`
- System type detection and tool adaptation

See [BTP CF Deployment](btp-cloud-foundry-deployment.md) for:
- Cloud Foundry deployment with Docker
- Destination Service and Cloud Connector setup
- Principal Propagation configuration
- Deploying without Docker (Node.js buildpack)
