# ARC-1 Deployment Best Practices

## One Instance Per SAP System

ARC-1 follows the **one instance per SAP backend** pattern. Each ARC-1 deployment connects to exactly one SAP system. This is the same model used by Eclipse ADT, SAP Business Application Studio, and SAP GUI.

### Why one-per-system?

| Concern | One-per-system | Multi-backend gateway |
|---------|---------------|----------------------|
| **Security** | Blast radius = one system | One breach = all systems |
| **Auth** | Clean: one auth flow per instance | N destinations + N auth flows |
| **Safety gates** | Per-system: `allowWrites`, `allowedPackages`, `denyActions` | Can't vary per backend |
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
| On-premise SAP (via Cloud Connector) | Principal Propagation | `SAP_BTP_DESTINATION`, `SAP_PP_ENABLED=true` |
| BTP ABAP Environment | Destination `OAuth2UserTokenExchange` | `SAP_BTP_DESTINATION`, `SAP_PP_ENABLED=true`, `SAP_SYSTEM_TYPE=btp` |

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
4. **Use `ppStrict=true`** — ensures every request has a user identity (no fallback to service account)
5. **Deploy separate instances per system** — limits blast radius
6. **Use XSUAA auth for deployed instances** — proper OAuth 2.0 with scopes (read/write/data/sql/transports/git/admin)
7. **Set `SAP_SYSTEM_TYPE`** explicitly in production — ensures correct tool definitions from startup
8. **Set `SAP_INSECURE=false` on CA-signed landscapes** — the tracked `mta.yaml` / `manifest.yml` ship `"true"` for the on-prem HTTP Cloud Connector path; on a TLS landscape it silently disables certificate verification (no startup warning)
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
| `mta.yaml` | MTA build descriptor — services, conservative `SAP_ALLOW_*` defaults, **placeholder destinations**. Tracked. Ships `SAP_INSECURE: "true"` for the Cloud Connector HTTP path — override to `"false"` on CA-signed landscapes. | Rarely — use `.mtaext` for overrides |
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
