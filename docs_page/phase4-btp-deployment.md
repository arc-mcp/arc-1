# Phase 4: BTP Cloud Foundry Deployment

Deploy ARC-1 on SAP BTP Cloud Foundry, connecting to an on-premise SAP system via Cloud Connector and Destination Service. Two deployment methods are supported: **MTA** (recommended) and **Docker**.

## When to Use

- Organization uses SAP BTP
- SAP system is on-premise, accessible via Cloud Connector
- Want a cloud-hosted MCP server without managing infrastructure
- Need per-user SAP identity via principal propagation (XSUAA + Cloud Connector)
- Combining with Phase 2 (OAuth/OIDC) for enterprise authentication

## Architecture

```
┌──────────────────┐                    ┌─────────────────────────────────────────────────┐
│  MCP Client      │     OAuth 2.0      │  SAP BTP Cloud Foundry                          │
│  (Copilot Studio │ ──────────────────►│                                                 │
│   / IDE / CLI)   │   Bearer JWT       │  ┌─────────────────────────────────────────┐    │
└──────────────────┘                    │  │  ARC-1 (Docker Container)               │    │
        │                               │  │                                         │    │
        │                               │  │  OIDC Validator ──► Entra ID JWKS       │    │
        │  ┌────────────────────┐       │  │  MCP Server (HTTP Streamable)           │    │
        └─►│  Entra ID          │       │  │  ADT Client ─── via Connectivity ──►────│──┐ │
           │  (Token Issuer)    │       │  │                    Proxy                 │  │ │
           └────────────────────┘       │  └─────────────────────────────────────────┘  │ │
                                        │                                               │ │
                                        │  ┌──────────────┐  ┌──────────────────────┐  │ │
                                        │  │ Destination   │  │ Connectivity Service │  │ │
                                        │  │ Service       │  │ (Proxy)              │◄─┘ │
                                        │  │ SAP_TRIAL     │  └──────────┬───────────┘    │
                                        │  └──────────────┘             │                 │
                                        └───────────────────────────────│─────────────────┘
                                                                        │
                                        ┌───────────────────────────────│─────────────────┐
                                        │  Cloud Connector              │                  │
                                        │  Virtual Host: a4h-abap:50000 │                  │
                                        │  ◄─────────────────────────────                  │
                                        └───────────────────────────────│─────────────────┘
                                                                        │
                                        ┌───────────────────────────────│─────────────────┐
                                        │  On-Premise SAP ABAP System   ▼                  │
                                        │  sap-host:50000  (ADT REST API)                  │
                                        └─────────────────────────────────────────────────┘
```

## Prerequisites

- SAP BTP subaccount with Cloud Foundry environment enabled
- Cloud Connector installed and connected to BTP subaccount
- Cloud Connector configured with virtual host mapping to SAP on-premise system
- `cf` CLI and `mbt` (MTA Build Tool) installed
- For Docker deployment: image pushed to a container registry (GHCR, Docker Hub, etc.)

## Deployment Method 1: MTA (Recommended)

MTA (Multi-Target Application) deployment bundles ARC-1 with its BTP service dependencies (XSUAA, Destination, Connectivity) into a single deployable archive. Services are created automatically.

### 1. Configure your landscape via `mta-overrides.mtaext`

`mta.yaml` ships with placeholder destinations (`your-basic-destination` / `your-pp-destination`) and conservative safety defaults (writes off, free SQL off, package allowlist `$TMP`). Every landscape must override at least the two destination names — deploying `mta.yaml` as-is will fail with a "destination not found" error from BTP, which is the intended fail-fast signal.

```bash
# Clone the repo
git clone https://github.com/marianfoo/arc-1.git
cd arc-1

# One-time per landscape — copy the template (it's tracked) to a real
# overrides file (gitignored), and fill in your destinations + flags.
cp mta-overrides.mtaext.example mta-overrides.mtaext
$EDITOR mta-overrides.mtaext
```

A minimal `mta-overrides.mtaext` looks like:

```yaml
_schema-version: "3.1"
ID: arc1-mcp-overrides
extends: arc1-mcp

modules:
  - name: arc1-mcp-server
    properties:
      SAP_BTP_DESTINATION: "my-sap-basic"
      SAP_BTP_PP_DESTINATION: "my-sap-pp"
      # widen safety flags only when the landscape needs it
      SAP_ALLOW_WRITES: "true"
      SAP_ALLOWED_PACKAGES: "Z*,Y*,$TMP"
```

The full set of overridable properties is documented in [`mta-overrides.mtaext.example`](https://github.com/marianfoo/arc-1/blob/main/mta-overrides.mtaext.example): destinations, all `SAP_ALLOW_*` safety flags, `SAP_DENY_ACTIONS`, `SAP_PP_STRICT`, `ARC1_PUBLIC_URL` (for reverse-proxy deployments), `ARC1_ALLOWED_ORIGINS` (CORS), `ARC1_TOOL_MODE`, cache warmup, and `ARC1_LOG_HTTP_DEBUG`. Any property left out of the override falls back to the `mta.yaml` value.

See the [BTP Destination Setup Guide](btp-destination-setup.md) for creating the destinations themselves.

### 2. Build and Deploy

```bash
# Build once, deploy with the extension applied:
npm run btp:build-deploy-ext

# Or in two steps:
npm run btp:build
cf deploy mta_archives/arc1-mcp_*.mtar -e mta-overrides.mtaext
```

The `mta.yaml` defines three BTP services that are created automatically:

| Service | Instance Name | Plan | Purpose |
|---------|--------------|------|---------|
| XSUAA | `arc1-xsuaa` | `application` | MCP client OAuth authentication |
| Destination | `arc1-destination` | `lite` | SAP system lookup |
| Connectivity | `arc1-connectivity` | `lite` | Cloud Connector proxy |

> **Multiple landscapes from one repo.** The gitignore matches any
> `mta-*.mtaext`, so you can keep `mta-ecc-dev.mtaext`,
> `mta-ecc-prod.mtaext`, etc. side by side and pick one per deploy with
> `-e mta-ecc-prod.mtaext`. None of those files are committed.

### 3. Post-Deploy Configuration

When using `SAP_BTP_DESTINATION`, the URL and credentials come from the BTP Destination — no `cf set-env` for `SAP_URL` or `SAP_CLIENT` is needed. Only set them if you're not using the Destination Service:

```bash
# Only needed if NOT using SAP_BTP_DESTINATION:
cf set-env arc1-mcp-server SAP_URL "http://a4h-abap:50000"
cf set-env arc1-mcp-server SAP_CLIENT "001"
cf restage arc1-mcp-server
```

The base `mta.yaml` already configures these properties (override any of them via `mta-overrides.mtaext`):
- `SAP_TRANSPORT: http-streamable` — HTTP transport for MCP
- `SAP_BTP_DESTINATION` / `SAP_BTP_PP_DESTINATION` — placeholders, MUST be overridden
- `SAP_PP_ENABLED: "true"` — per-user principal propagation
- `SAP_XSUAA_AUTH: "true"` — XSUAA OAuth for MCP clients
- `SAP_ALLOW_*: "false"` and `SAP_ALLOWED_PACKAGES: "$TMP"` — safe defaults; widen only as needed

---

## Deployment Method 2: Docker

### 1. Create BTP Services

```bash
# Login to Cloud Foundry
cf login -a https://api.cf.us10-001.hana.ondemand.com

# Create XSUAA service instance (for MCP client OAuth)
cf create-service xsuaa application arc1-xsuaa -c xs-security.json

# Create Destination service instance
cf create-service destination lite arc1-destination

# Create Connectivity service instance
cf create-service connectivity lite arc1-connectivity
```

### 2. Configure Cloud Connector

In the SAP Cloud Connector admin UI:

1. Add a **Subaccount** connection to your BTP subaccount
2. Under **Cloud To On-Premise** → **Access Control**:
   - Add mapping: **Virtual Host** `a4h-abap` port `50000` → **Internal Host** `sap-host` port `50000`
   - Protocol: HTTP
   - Add resource: Path prefix `/sap/bc/adt/` with all sub-paths

### 3. Configure BTP Destination

In BTP Cockpit → Connectivity → Destinations → **New Destination**:

| Property | Value |
|----------|-------|
| Name | `SAP_TRIAL` |
| Type | HTTP |
| URL | `http://a4h-abap:50000` |
| Proxy Type | OnPremise |
| Authentication | BasicAuthentication |
| User | `SAP_SERVICE_USER` |
| Password | (service account password) |

Additional Properties:

| Property | Value |
|----------|-------|
| `sap-client` | `001` |
| `sap-language` | `EN` |

### 4. Create manifest.yml

```yaml
---
applications:
  - name: arc1-mcp-server
    docker:
      image: ghcr.io/marianfoo/arc-1:latest
    instances: 1
    memory: 256M
    disk_quota: 512M
    health-check-type: http
    health-check-http-endpoint: /health
    env:
      # SAP connection (URL must match Cloud Connector virtual host mapping)
      SAP_URL: "http://a4h-abap:50000"
      SAP_CLIENT: "001"
      SAP_LANGUAGE: "EN"
      SAP_INSECURE: "true"
      # MCP transport (CF sets PORT env var automatically)
      SAP_TRANSPORT: "http-streamable"
      # BTP Destination Service — dual-destination pattern
      SAP_BTP_DESTINATION: "SAP_TRIAL"         # BasicAuth (startup)
      SAP_BTP_PP_DESTINATION: "SAP_TRIAL_PP"   # PrincipalPropagation (per-user)
      SAP_PP_ENABLED: "true"
      SAP_XSUAA_AUTH: "true"
      # Safety: read-only, no SQL
      SAP_ALLOW_WRITES: "true"
      SAP_ALLOW_FREE_SQL: "true"
    services:
      - arc1-xsuaa
      - arc1-connectivity
      - arc1-destination
```

### 5. Build and Push Docker Image

```bash
# Build for Linux (required for CF)
docker build --platform linux/amd64 \
  -t ghcr.io/your-org/arc1:latest \
  --build-arg VERSION=$(git describe --tags --always) \
  --build-arg COMMIT=$(git rev-parse --short HEAD) \
  .

# Login to container registry
echo $GHCR_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Push
docker push ghcr.io/your-org/arc1:latest
```

### 6. Deploy to Cloud Foundry

```bash
# Push the app (first time)
cf push

# The app URL will be:
# https://arc1-mcp-server.cfapps.us10-001.hana.ondemand.com
```

### 7. Set Credentials via Environment (not in manifest)

**Never put secrets in manifest.yml.** Set them via `cf set-env`:

```bash
# API key for simple auth
cf set-env arc1-mcp-server ARC1_API_KEYS "your-secure-api-key:admin"

# OR OAuth/OIDC validation (Phase 2) — recommended
cf set-env arc1-mcp-server SAP_OIDC_ISSUER "https://login.microsoftonline.com/{tenant-id}/v2.0"
cf set-env arc1-mcp-server SAP_OIDC_AUDIENCE "{client-id}"

# Restart to apply
cf restart arc1-mcp-server
```

> **Note on audience:** When using Entra ID with `requestedAccessTokenVersion: 2`, the audience is the raw Application (client) ID GUID, not the `api://` URI.

### 8. Verify Deployment

```bash
# Health check
curl https://arc1-mcp-server.cfapps.us10-001.hana.ondemand.com/health
# → {"status":"ok"}

# Check Protected Resource Metadata (OAuth discovery)
curl https://arc1-mcp-server.cfapps.us10-001.hana.ondemand.com/.well-known/oauth-protected-resource/mcp
# → {"resource":"https://arc1-mcp-server.cfapps.../mcp","scopes_supported":["read","write","data","sql","admin"],...}

# Check Authorization Server Metadata
curl https://arc1-mcp-server.cfapps.us10-001.hana.ondemand.com/.well-known/oauth-authorization-server
# → {"authorization_endpoint":"...","token_endpoint":"...","registration_endpoint":"...",...}

# Test with Bearer token
TOKEN=$(az account get-access-token --scope "api://{client-id}/access_as_user" --query accessToken -o tsv)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  https://arc1-mcp-server.cfapps.us10-001.hana.ondemand.com/mcp
```

## Security headers and CORS on BTP

**Helmet is on by default — no config needed.** Every HTTP response from a CF-deployed ARC-1 carries HSTS, CSP, X-Frame-Options, CORP, X-Content-Type-Options, Referrer-Policy, and a handful of legacy hardening headers. Cross-Origin-Opener-Policy is intentionally NOT set so popup-based OAuth flows (Microsoft Copilot Studio) keep working — see [Security Guide §11](security-guide.md#http-security-headers-helmet) for the rationale. Verify on the live deployment:

```bash
curl -sI https://<your-app>.cfapps.<region>.hana.ondemand.com/health | \
  grep -iE 'strict-transport|content-security|cross-origin|x-content-type|x-frame'
```

**CORS is off by default.** All four supported MCP clients — Claude Desktop, Cursor, VS Code Copilot, Copilot Studio — use native HTTP, not the browser fetch API, so they don't trigger CORS regardless of how you connect them. Only set `ARC1_ALLOWED_ORIGINS` if you have a browser UI calling `/mcp` directly:

```bash
cf set-env arc1-mcp-server ARC1_ALLOWED_ORIGINS "https://your-ui.example.com"
cf restage arc1-mcp-server
```

Origins are comma-separated and must match exactly (no wildcards), because CORS responses are sent with `credentials: true`. Disallowed origins emit a `cors_rejected` audit event for triage. Full reference: [Security Guide §11](security-guide.md#11-network-security).

## How BTP Connectivity Works

ARC-1 auto-detects BTP Cloud Foundry via the `VCAP_APPLICATION` environment variable:

1. **Public URL auto-detection:** ARC-1 reads `application_uris` from `VCAP_APPLICATION` to construct the externally reachable URL (used for RFC 8414/9728 OAuth metadata). Override with `ARC1_PUBLIC_URL` when ARC-1 is reached through a reverse proxy on a different hostname or under a base-path prefix — e.g. `cf set-env arc1-mcp-server ARC1_PUBLIC_URL "https://gateway.example.com/arc1"`. Without the override, OAuth metadata points at the CF route and clients bypass the proxy.

2. **Destination Service (startup):** When `SAP_BTP_DESTINATION` is set, ARC-1 calls the Destination Service REST API directly at startup to read SAP credentials (user, password, URL). This works with BasicAuth destinations without a user JWT.

3. **Destination Service (per-user):** When `SAP_PP_ENABLED=true` and a user has a valid JWT, ARC-1 uses the [SAP Cloud SDK](https://sap.github.io/cloud-sdk/docs/js/features/connectivity/destinations) `getDestination()` to resolve `SAP_BTP_PP_DESTINATION` with the user's JWT. The SDK handles service token acquisition, `X-User-Token` header injection, and per-user destination caching.

4. **Connectivity Proxy:** On-premise HTTP calls are routed through BTP's connectivity proxy (`connectivityproxy.internal.cf...`) using the `Proxy-Authorization` header with a connectivity service OAuth token.

5. **Cloud Connector Location ID:** When a destination has `CloudConnectorLocationId` set (needed when multiple Cloud Connectors connect to the same subaccount), ARC-1 sends the `SAP-Connectivity-SCC-Location_ID` header to route to the correct Cloud Connector instance. This is propagated correctly in both startup and per-user flows.

6. **Port:** CF sets the `PORT` environment variable (typically `8080`). ARC-1 defaults `ARC1_HTTP_ADDR` to `0.0.0.0:8080`.

### Dual-Destination Pattern

ARC-1 uses two BTP destinations for on-premise PP scenarios:

| Destination | Auth Type | Used For | Config Var |
|-------------|-----------|----------|------------|
| Startup destination | BasicAuthentication | Feature probing, cache warmup, API key users | `SAP_BTP_DESTINATION` |
| Per-user destination | PrincipalPropagation | Per-user requests with JWT | `SAP_BTP_PP_DESTINATION` |

**Why two destinations?** A PrincipalPropagation destination has no User/Password. At startup (no user JWT available), the SDK's `getDestination()` would fail for PP destinations. The BasicAuth destination provides a fallback for system-level operations and API key users.

The destinations may point to the same SAP system but can differ in:
- Authentication type (BasicAuth vs PP)
- Cloud Connector port (HTTP 50000 vs HTTPS 50001 for PP)
- Cloud Connector Location ID (different SCC instances)

## Updating the Deployment

```bash
# Build and push new image
docker build --platform linux/amd64 -t ghcr.io/your-org/arc1:latest .
docker push ghcr.io/your-org/arc1:latest

# Restart CF app to pull latest image
# Option A: Simple restart (picks up new image if tag is :latest)
cf push arc1-mcp-server --docker-image ghcr.io/your-org/arc1:latest -c "/usr/local/bin/arc1"

# Option B: If only env vars changed
cf restart arc1-mcp-server
```

> **Note:** When the Docker image ENTRYPOINT changes, CF may cache the old start command. Use `-c "/usr/local/bin/arc1"` to explicitly set the start command.

## Combining with OAuth (Recommended)

For production, combine BTP deployment with Phase 2 (OAuth/OIDC):

```bash
# Set OIDC validation on the CF app
cf set-env arc1-mcp-server SAP_OIDC_ISSUER "https://login.microsoftonline.com/{tenant-id}/v2.0"
cf set-env arc1-mcp-server SAP_OIDC_AUDIENCE "{client-id}"
cf restart arc1-mcp-server
```

Then configure your MCP client (Copilot Studio, VS Code) to use OAuth authentication as described in [OAuth / JWT Setup](oauth-jwt-setup.md).

## Troubleshooting

### MTA deploy fails: "Lifecycle type cannot be changed from docker to buildpack"

If migrating from a Docker-based deployment to MTA (Node.js buildpack), CF cannot change the lifecycle type of an existing app. Delete the old Docker app first:

```bash
cf delete arc1-mcp-server -f -r
# Then redeploy
npm run btp:deploy
```

### App crashes with "unable to find user arc1"

The Docker image user doesn't match what CF cached. Fix with explicit command:
```bash
cf push arc1-mcp-server --docker-image ghcr.io/your-org/arc1:latest -c "/usr/local/bin/arc1"
```

### SAP returns 401 "Logon failed"

- Check that the BTP Destination credentials are correct
- Verify Cloud Connector mapping is active and healthy
- Check that the virtual host in `SAP_URL` matches the Cloud Connector mapping

### Health check fails

- Verify the app started: `cf logs arc1-mcp-server --recent`
- Check memory (256M is sufficient for ARC-1)
- Verify health check endpoint: `cf app arc1-mcp-server` should show `health-check-http-endpoint: /health`

### "connection refused" to SAP

- Verify Cloud Connector is connected to the BTP subaccount
- Check Cloud Connector access control allows `/sap/bc/adt/*` paths
- Verify `SAP_URL` matches the virtual host configured in Cloud Connector

## Deploying Without Docker (Node.js Buildpack)

The MTA deployment (Method 1) already uses the Node.js buildpack. If you need a simpler deployment without MTA tooling, you can use `cf push` with a manifest file:

### 1. Prepare the Application

```bash
# Clone and build
git clone https://github.com/marianfoo/arc-1.git
cd arc-1
npm ci
npm run build
```

### 2. Create BTP services manually

```bash
cf create-service xsuaa application arc1-xsuaa -c xs-security.json
cf create-service destination lite arc1-destination
cf create-service connectivity lite arc1-connectivity
```

### 3. Create a CF-specific manifest

```yaml
# manifest-nodejs.yml
applications:
  - name: arc1-mcp-server
    buildpacks:
      - nodejs_buildpack
    instances: 1
    memory: 256M
    disk_quota: 512M
    health-check-type: http
    health-check-http-endpoint: /health
    command: node dist/index.js
    env:
      SAP_TRANSPORT: "http-streamable"
      SAP_SYSTEM_TYPE: "auto"
      SAP_BTP_DESTINATION: "SAP_TRIAL"
      SAP_BTP_PP_DESTINATION: "SAP_TRIAL_PP"
      SAP_PP_ENABLED: "true"
      SAP_XSUAA_AUTH: "true"
      SAP_ALLOW_WRITES: "true"
      SAP_ALLOW_FREE_SQL: "true"
    services:
      - arc1-xsuaa
      - arc1-connectivity
      - arc1-destination
```

### 4. Deploy

```bash
cf push -f manifest-nodejs.yml
```

**Notes:**
- `better-sqlite3` native module is compiled during staging — may add 30-60s to deploy
- You can modify source before pushing (custom tool descriptions, additional middleware, etc.)
- Prefer MTA deployment for production — it bundles service creation and is reproducible

### 5. Customization Examples

**Custom CA certificates** — for on-premise SAP with self-signed certs:

```bash
# Set NODE_EXTRA_CA_CERTS to a bundled cert file
cf set-env arc1-mcp-server NODE_EXTRA_CA_CERTS /home/vcap/app/certs/sap-ca.pem
```

## Deploying for BTP ABAP Environment

For connecting to a BTP ABAP Environment (instead of on-premise), see the separate manifest template `manifest-btp-abap.yml` and the [BTP ABAP Environment guide](btp-abap-environment.md).

Key differences from on-premise deployment:
- No Cloud Connector or Connectivity Service needed
- Auth is via service key + JWT Bearer Exchange (not PP)
- Set `SAP_SYSTEM_TYPE=btp` for adapted tool descriptions
- Set `SAP_BTP_SERVICE_KEY` as an env var (via `cf set-env` — never in manifest)

## SAP Documentation References

- [SAP BTP Cloud Foundry Environment](https://help.sap.com/docs/btp/sap-business-technology-platform/cloud-foundry-environment) — CF runtime overview
- [SAP Cloud Connector Installation](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/installation) — Cloud Connector setup
- [SAP Destination Service](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/calling-destination-service-rest-api) — Destination lookup API
- [SAP Cloud SDK — Destinations](https://sap.github.io/cloud-sdk/docs/js/features/connectivity/destinations) — SDK destination resolution
- [SAP Cloud SDK — On-Premise Connectivity](https://sap.github.io/cloud-sdk/docs/js/features/connectivity/on-premise) — Cloud Connector proxy headers
- [HTTP Proxy for On-Premise Connectivity](https://help.sap.com/docs/CP_CONNECTIVITY/b865ed651e414196b39f8922db2122c7/d872cfb4801c4b54896816df4b75c75d.html) — Proxy headers, Location ID
- [Configure PP via User Exchange Token](https://help.sap.com/docs/CP_CONNECTIVITY/cca91383641e40ffbe03bdc78f00f681/39f538ad62e144c58c056ebc34bb6890.html) — Option 1 vs Option 2
- [Destination Authentication Methods](https://help.sap.com/docs/btp/best-practices/destination-authentication-methods) — BTP Best Practices
- [SAP BTP Docker Deployment](https://help.sap.com/docs/btp/sap-business-technology-platform/deploy-docker-images-in-cloud-foundry-environment) — Docker on CF
