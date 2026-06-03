# BTP Destination Setup Guide

How to configure SAP BTP Destinations for ARC-1, covering both **Basic Authentication** (shared service account) and **Principal Propagation** (per-user SAP identity).

---

## Authentication Modes Overview

ARC-1 supports three ways to authenticate to SAP:

| Mode | Who acts in SAP | Config | Use Case |
|------|----------------|--------|----------|
| **Hardcoded credentials** | Single user (SAP_USER/SAP_PASSWORD) | Env vars only, no BTP | Local dev, direct connection |
| **BTP Destination (Basic)** | Single service account | BTP Destination Service | Cloud deployment, shared user |
| **BTP Destination (PP)** | Each MCP user as their own SAP user | BTP Destination + Cloud Connector PP | Enterprise, per-user audit trail |

All three modes can coexist with any MCP client authentication (API key, OIDC, XSUAA).

---

## Mode 1: Hardcoded Credentials (No BTP)

The simplest mode. SAP credentials are set directly via environment variables or CLI flags:

```bash
# Via env vars
SAP_URL=http://sap-host:50000 SAP_USER=DEVELOPER SAP_PASSWORD=secret npx arc-1

# Via CLI flags
npx arc-1 --url http://sap-host:50000 --user DEVELOPER --password secret
```

This works for:
- Local development with `stdio` transport
- Direct network access to SAP (no Cloud Connector needed)
- Testing and demos

**Important:** With `SAP_PP_STRICT=false` (default) hardcoded credentials or the destination's service account act as a fallback when PP fails. Set `SAP_PP_STRICT=true` to disable fallback and surface PP failures as errors. Per-user sessions never inherit shared Basic/cookie credentials — cookies combined with `SAP_PP_ENABLED=true` fail fast at startup unless the `SAP_PP_ALLOW_SHARED_COOKIES=true` escape hatch is set (SEC-09). See [Coexistence Matrix](enterprise-auth.md#coexistence-matrix).

---

## Mode 2: BTP Destination with Basic Authentication

A BTP Destination stores SAP connection details (URL, user, password) centrally. ARC-1 reads them at startup via the Destination Service API.

### Step 1: Create the BTP Destination

In the BTP Cockpit, go to **Connectivity > Destinations** and create:

| Property | Value |
|----------|-------|
| **Name** | `SAP_TRIAL` (or any name) |
| **Type** | HTTP |
| **URL** | `http://a4h-abap:50000` (Cloud Connector virtual host) |
| **Proxy Type** | OnPremise |
| **Authentication** | BasicAuthentication |
| **User** | `DEVELOPER` (SAP technical user) |
| **Password** | `<password>` |

Add additional properties:

| Property | Value |
|----------|-------|
| `sap-client` | `001` |
| `HTML5.DynamicDestination` | `true` |

### Step 2: Configure ARC-1

Set the environment variable pointing to the destination name:

```bash
# In manifest.yml or via cf set-env
SAP_BTP_DESTINATION=SAP_TRIAL
```

ARC-1 resolves the destination at startup and uses the credentials for all requests. The `SAP_URL`, `SAP_USER`, and `SAP_PASSWORD` env vars are overridden by the destination values.

### Step 3: Bind Services

ARC-1 needs the Destination Service and Connectivity Service bindings:

```bash
cf create-service destination lite arc1-destination
cf create-service connectivity lite arc1-connectivity
cf bind-service arc1-mcp-server arc1-destination
cf bind-service arc1-mcp-server arc1-connectivity
```

Or in `manifest.yml`:

```yaml
services:
  - arc1-destination    # or your existing destination service instance
  - arc1-connectivity   # or your existing connectivity service instance
```

---

## Mode 3: BTP Destination with Principal Propagation

Each authenticated MCP user gets their **own SAP identity**. SAP enforces `S_DEVELOP` authorization per user and the audit log shows who did what.

### How it works

```
MCP Client → XSUAA OAuth → ARC-1 → Destination Service (X-User-Token: <jwt>)
                                         ↓
                                   SAML assertion with user identity
                                         ↓
                              ADT Client → SAP-Connectivity-Authentication header
                                         ↓
                              Connectivity Proxy → Cloud Connector
                                         ↓
                              X.509 cert (CN=SAP_USERNAME) → CERTRULE → SAP user
```

### Step 1: Create a Dual-Destination Setup

The recommended approach uses **two destinations** — one for the shared service account and one for per-user PP:

**Destination 1: `SAP_TRIAL` (BasicAuth — shared client)**

| Property | Value |
|----------|-------|
| **Name** | `SAP_TRIAL` |
| **Type** | HTTP |
| **URL** | `http://a4h-abap:50000` (CC virtual host, HTTP) |
| **Proxy Type** | OnPremise |
| **Authentication** | BasicAuthentication |
| **User** | `DEVELOPER` |
| **Password** | `<password>` |
| `sap-client` | `001` |

This destination is resolved at startup and used as the fallback for API key auth and when PP fails.

**Destination 2: `SAP_TRIAL_PP` (PrincipalPropagation — per-user)**

| Property | Value |
|----------|-------|
| **Name** | `SAP_TRIAL_PP` |
| **Type** | HTTP |
| **URL** | `http://a4h-abap:50001` (CC virtual host, HTTPS port) |
| **Proxy Type** | OnPremise |
| **Authentication** | PrincipalPropagation |
| **User** | *(leave empty)* |
| **Password** | *(leave empty)* |
| `sap-client` | `001` |

This destination is used per-request when an authenticated user's JWT is available.

> **Why two destinations?** A PrincipalPropagation destination has no User/Password. At startup, there is no user JWT — the SAP Cloud SDK's `getDestination()` would fail for PP destinations. The BasicAuth destination provides a fallback for system-level operations (feature probing, cache warmup) and API key users.

> **Why port 50001 for PP?** The Cloud Connector needs an HTTPS system mapping with `X509_GENERAL` auth mode for PP. Port 50001 is the SAP HTTPS port. The HTTP mapping (50000) uses `NONE_RESTRICTED` auth which doesn't support PP.

#### Cloud Connector Location ID

If you have **multiple Cloud Connectors connected to the same BTP subaccount** (each with a different Location ID), add the `CloudConnectorLocationId` property to your destinations:

| Property | Value |
|----------|-------|
| `CloudConnectorLocationId` | `LOC1` (must match the Location ID configured in the Cloud Connector) |

ARC-1 propagates this as the `SAP-Connectivity-SCC-Location_ID` header to route requests to the correct Cloud Connector instance. If you only have one Cloud Connector, leave this empty.

**Important:** Each destination in a dual-destination setup can have a different Location ID. ARC-1 correctly uses the PP destination's Location ID for per-user requests and the startup destination's Location ID for system requests.

### Step 2: Configure Cloud Connector

These steps were validated on SAP Cloud Connector 2.x:

#### 2a. Generate System Certificate

Cloud Connector Admin UI → **Configuration → On-Premises** tab:

1. Under **System Certificate**, click **"Create and use a self-signed certificate"** icon
2. Fill in: `CN=a4h-cloudconnector, OU=ARC1, O=MZ, C=DE` (or your org details)
3. Click Create

Or via CC REST API:
```bash
curl -sk -u Administrator:<password> -X POST \
  -H "Content-Type: application/json" \
  -d '{"type":"selfsigned","subjectDN":"CN=a4h-cloudconnector, OU=ARC1, O=MZ, C=DE","keySize":2048}' \
  https://localhost:8443/api/v1/configuration/connector/onPremise/systemCertificate
```

#### 2b. Generate CA Certificate

Cloud Connector Admin UI → **Configuration → On-Premises** tab:

1. Scroll to **CA Certificate** section
2. Click **"Create and use a self-signed certificate"** icon
3. Fill in: `CN=SCC-CA-a4h, OU=ARC1, O=MZ, C=DE`
4. Key size: 4096 bits (recommended)
5. Click Create

This CA will sign the short-lived X.509 certificates for each propagated user.

#### 2c. Export the CA Certificate

1. In the CA Certificate section, click the **Download** icon
2. Save as `ca_cert.der` — you'll import this into SAP's STRUST

#### 2d. Add HTTPS System Mapping

Cloud Connector Admin UI → **Cloud to On-Premise → Access Control**:

1. Add a new system mapping:
   - **Virtual Host**: `a4h-abap`
   - **Virtual Port**: `50001`
   - **Internal Host**: `localhost`
   - **Internal Port**: `50001`
   - **Protocol**: `HTTPS`
   - **Back-end Type**: ABAP System
   - **Authentication Mode**: `X509_GENERAL`
2. Add resources (see [URL path reference](#cloud-connector-url-path-reference) below for the full list). For a quick start, add `/` with **Path and all sub-paths**. For production, use fine-grained paths.

Or via CC REST API:
```bash
curl -sk -u Administrator:<password> -X POST \
  -H "Content-Type: application/json" \
  -d '{"virtualHost":"a4h-abap","virtualPort":50001,"localHost":"localhost","localPort":50001,"protocol":"HTTPS","backendType":"abapSys","authenticationMode":"X509_GENERAL","sid":"A4H","hostInHeader":"INTERNAL"}' \
  "https://localhost:8443/api/v1/configuration/subaccounts/<region>/<subaccount>/systemMappings"
```

#### 2e. Configure Subject Pattern

Cloud Connector Admin UI → **Configuration → On-Premises** → scroll to **Principal Propagation → Subject Pattern Rules**:

- Add rule: `CN=${name}` (maps the user's login name to the cert CN)

#### 2f. Backend Trust Store

Set **"Determining Trust Through Allowlist"** to **OFF** (trusts all backend certs). This is acceptable when your SAP system uses self-signed certificates.

### Step 3: Configure SAP Backend

#### 3a. Import CC CA Certificate into STRUST

The Cloud Connector's CA certificate must be imported into SAP's SSL Server PSE so SAP trusts the short-lived PP certificates.

**Via CLI** (recommended — no SAP GUI needed):
```bash
# Convert DER to PEM
openssl x509 -inform DER -in ca_cert.der -out ca_cert.pem

# Import into SAPSSLS.pse
sapgenpse maintain_pk -p /usr/sap/<SID>/<INSTANCE>/sec/SAPSSLS.pse -a ca_cert.pem
```

Example for SID=A4H, instance=D00:
```bash
su - a4hadm -c "sapgenpse maintain_pk -p /usr/sap/A4H/D00/sec/SAPSSLS.pse -a /tmp/ca_cert.pem"
```

Verify with:
```bash
su - a4hadm -c "sapgenpse maintain_pk -p /usr/sap/A4H/D00/sec/SAPSSLS.pse -l"
```

**Via SAP GUI** (alternative):
1. Transaction **STRUST**
2. Expand **SSL Server Standard** → double-click your instance
3. Click **Import** (📥), browse to `ca_cert.der`
4. Click **Add to Certificate List**
5. Click **Save**

#### 3b. Verify ICM Profile Parameters

These must be set in the SAP instance profile (`DEFAULT.PFL` or instance profile):

```ini
icm/HTTPS/verify_client = 1          # Request client certificates
login/certificate_mapping_rulebased = 1   # Enable rule-based cert mapping
login/certificate = 1                    # Enable certificate login
login/certificate_mapping = 1            # Enable cert-to-user mapping
```

Check current values:
```bash
grep -E "certificate|icm/HTTPS" /sapmnt/<SID>/profile/DEFAULT.PFL
```

#### 3c. Create Certificate-to-User Mapping (CERTRULE)

Transaction **SM30**, view **VUSREXTID**:

1. Click **New Entries**
2. **External ID type**: leave empty (default DN)
3. **External ID**: `CN=DEVELOPER` (must match the Subject Pattern — `CN=${name}` generates `CN=<username>`)
4. **Seq. No.**: `000`
5. **User**: `DEVELOPER`
6. **Activated**: checked ✅
7. Save

> **Important:** The External ID must match **exactly** what the Cloud Connector generates. With Subject Pattern `CN=${name}`, the cert subject is just `CN=<username>` — NOT `CN=<username>, OU=ARC1, O=MZ, C=DE`. The OU/O/C are in the **issuer** (CA cert), not the **subject**.

> **Known issue:** Transaction `CERTRULE` may dump with `STRING_OFFSET_TOO_LARGE` (CX_SY_RANGE_OUT_OF_BOUNDS in SAPLSUSR_CERTRULE). Use `SM30` with view `VUSREXTID` as a workaround.

Repeat for each SAP user that will be used via PP. Create one entry per user.

#### 3d. Restart ICM

After all changes, restart ICM to pick up the updated certificates:

```bash
# Via sapcontrol (soft restart, no full SAP restart needed)
su - <sid>adm -c "sapcontrol -nr <instance_nr> -function RestartService"
```

Or via SAP GUI: Transaction **SMICM** → Administration → ICM → Soft Restart.

### Step 4: Enable PP in ARC-1

```bash
# Set the dual-destination config
cf set-env arc1-mcp-server SAP_BTP_DESTINATION SAP_TRIAL        # BasicAuth (shared)
cf set-env arc1-mcp-server SAP_BTP_PP_DESTINATION SAP_TRIAL_PP  # PP (per-user)
cf set-env arc1-mcp-server SAP_PP_ENABLED true
cf set-env arc1-mcp-server SAP_XSUAA_AUTH true
cf restage arc1-mcp-server
```

Or in `manifest.yml`:

```yaml
env:
  SAP_BTP_DESTINATION: "SAP_TRIAL"
  SAP_BTP_PP_DESTINATION: "SAP_TRIAL_PP"
  SAP_PP_ENABLED: "true"
  SAP_XSUAA_AUTH: "true"
```

### Step 5: Graceful Fallback

When `SAP_PP_ENABLED=true`:
- If the user has a valid JWT (XSUAA/OIDC, 3 dot-separated parts) → per-user ADT client via `SAP_BTP_PP_DESTINATION`
- If PP fails (destination error, missing user mapping, etc.) → falls back to shared service account via `SAP_BTP_DESTINATION`
- If no JWT available (API key auth, stdio) → uses shared service account
- API key tokens are detected as non-JWT and skip PP entirely (no wasted API calls)

This means you can enable PP without breaking existing API key users.

### How ARC-1 Resolves PP Destinations

ARC-1 uses the [SAP Cloud SDK](https://sap.github.io/cloud-sdk/docs/js/features/connectivity/destinations) `getDestination()` for per-user destination resolution. The SDK handles:

1. **Service token acquisition** — obtains a client_credentials token for the Destination Service
2. **X-User-Token header** — passes the user's JWT to the Destination Service
3. **Per-user caching** — caches resolved destinations keyed by destination name + user JWT
4. **Auth token extraction** — returns `authTokens` array with PP tokens or Bearer tokens

The startup path (`SAP_BTP_DESTINATION`) uses direct REST API calls instead of the SDK, because no user JWT is available at startup.

### Principal Propagation: Option 1 vs Option 2

SAP documents two ways to propagate user identity through the Cloud Connector ([reference](https://help.sap.com/docs/CP_CONNECTIVITY/cca91383641e40ffbe03bdc78f00f681/39f538ad62e144c58c056ebc34bb6890.html)):

| | Option 1 (Recommended) | Option 2 (Backward compat) |
|---|---|---|
| **Headers** | 1 header: `Proxy-Authorization: Bearer <exchanged-token>` | 2 headers: `SAP-Connectivity-Authentication: Bearer <user-JWT>` + `Proxy-Authorization: Bearer <client-credentials-token>` |
| **Token in Proxy-Authorization** | jwt-bearer exchanged token (contains user identity) | Client credentials token (no user identity) |
| **SAP-Connectivity-Authentication** | Not used | Original user JWT |
| **How CC extracts user** | From the exchanged token in Proxy-Authorization | From the original JWT in SAP-Connectivity-Authentication |

**ARC-1's behavior:**

1. First, ARC-1 tries to get auth tokens from the SDK response (the Destination Service returns a `SAP-Connectivity-Authentication` header value for PP destinations).
2. If the Destination Service returns **no auth tokens** (a known issue — the service sometimes omits them), ARC-1 falls back to a **jwt-bearer token exchange** with the Connectivity Service XSUAA, then uses **Option 2**: the original user JWT is sent as `SAP-Connectivity-Authentication`.

This fallback is documented in the code at `src/adt/btp.ts` with detailed comments explaining why Option 2 was chosen over Option 1 (the Cloud Connector couldn't extract the principal from the exchanged token in testing).

---

## Using Principal Propagation from MCP Clients

### Prerequisites

- ARC-1 deployed on BTP CF with `SAP_XSUAA_AUTH=true` and `SAP_PP_ENABLED=true`
- XSUAA service instance with `xs-security.json` (see [XSUAA Setup](xsuaa-setup.md))
- BTP Destination set to `PrincipalPropagation`
- Cloud Connector and SAP configured for PP (Steps 2-3 above)

### Claude Desktop / Claude Code

Add to your Claude Desktop `claude_desktop_config.json` or Claude Code settings:

```json
{
  "mcpServers": {
    "arc1-sap": {
      "url": "https://arc1-mcp-<space>.cfapps.us10-001.hana.ondemand.com/mcp",
      "transport": "streamable-http"
    }
  }
}
```

Claude will auto-discover OAuth via `/.well-known/oauth-authorization-server` and prompt you to log in via XSUAA. After authentication, every SAP call runs as your user.

### Cursor

In Cursor settings, add MCP server:

```json
{
  "mcpServers": {
    "arc1-sap": {
      "url": "https://arc1-mcp-<space>.cfapps.us10-001.hana.ondemand.com/mcp"
    }
  }
}
```

Cursor supports MCP OAuth discovery natively. It will redirect you to the XSUAA login page.

### VS Code (with MCP extension)

If using an MCP extension that supports HTTP Streamable transport:

```json
{
  "mcp.servers": {
    "arc1-sap": {
      "url": "https://arc1-mcp-<space>.cfapps.us10-001.hana.ondemand.com/mcp"
    }
  }
}
```

### Copilot Studio (Power Platform)

Copilot Studio uses a custom connector with Entra ID OAuth (not XSUAA). For PP with Copilot Studio:

1. Use the Entra ID OIDC authentication (see [OAuth / JWT Setup](oauth-jwt-setup.md))
2. Ensure the Entra ID token's `preferred_username` or `email` claim maps to a SAP user
3. ARC-1 will pass the Entra ID JWT to the Destination Service as `X-User-Token`
4. The Destination Service generates the SAML assertion from the Entra ID token

**Note:** For this to work, the BTP trust configuration must trust the Entra ID tenant. In BTP Cockpit → Security → Trust Configuration, add Entra ID as a trusted IdP.

### MCP Inspector (Testing)

```bash
# Start MCP Inspector pointing to your server
npx @modelcontextprotocol/inspector https://arc1-mcp-<space>.cfapps.us10-001.hana.ondemand.com/mcp
```

Inspector supports OAuth discovery. It will open a browser for XSUAA login.

---

## Verifying Principal Propagation

### Check ARC-1 logs

```bash
cf logs arc1-mcp-server --recent | grep -E "per-user|Principal|PP"
```

You should see:
```
INFO: Principal propagation enabled {"destination":"SAP_TRIAL","hasBtpConfig":true}
INFO: BTP destination resolved (per-user) {"name":"SAP_TRIAL","auth":"PrincipalPropagation","hasConnectivityAuth":true}
DEBUG: Per-user ADT client created {"user":"john.doe@company.com"}
```

### Check SAP audit log (SM20)

In SAP, run transaction **SM20** (Security Audit Log):
- Filter by the time of your MCP request
- You should see the **individual SAP user** (e.g., `JDOE`) — not the technical service account
- The action should match what the MCP tool did (e.g., read program source)

### Check SAP user determination (SM30 / VUSREXTID)

If PP isn't mapping to the correct SAP user:
1. Check the CERTRULE table via SM30, view `VUSREXTID`
2. Verify the certificate subject (CN) matches what the Cloud Connector sends
3. Use transaction `SU01` to verify the target SAP user exists

---

## Cloud Connector URL Path Reference

ARC-1 uses two URL path prefixes. Add both as resources with **Path and all sub-paths** in the Cloud Connector:

| Resource | Sub-Paths | Purpose |
|----------|-----------|---------|
| `/sap/bc/adt/` | Yes | All ADT operations (source code, search, write, activate, tests, diagnostics, transports) |
| `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/` | Yes | UI5 ABAP Repository OData Service — query deployed BSP/UI5 app metadata |

> **Note:** `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/` is the only path outside `/sap/bc/adt/`. It uses the same OData V2 service as SAP Business Application Studio and `@sap-ux/deploy-tooling`.

> If you use a dual-destination setup (HTTP + HTTPS for PP), both system mappings need the same resource paths.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Destination Service (per-user) returned no destination` | SDK couldn't resolve destination | Check destination name, VCAP_SERVICES binding, and user JWT validity |
| `auth token error: User token validation failed` | BTP doesn't trust the IdP that issued the JWT | Add IdP to BTP Trust Configuration |
| `SAP returns 403 on ADT call` | SAP user exists but lacks `S_DEVELOP` authorization | Grant via `PFCG` role assignment |
| `CERTRULE mapping not found` | Cloud Connector sends cert but SAP can't map CN to user | Check `SM30` view `VUSREXTID` |
| PP falls back to shared client | Destination auth type is still `BasicAuthentication` | Change to `PrincipalPropagation` in BTP Cockpit |
| `SAP_PP_ENABLED is true but btpConfig is null` | `VCAP_SERVICES` not available | Ensure Destination + Connectivity services are bound |
| PP requests hit wrong SAP system | `CloudConnectorLocationId` mismatch between startup and PP destination | Set correct `CloudConnectorLocationId` on each destination in BTP Cockpit |
| `jwt-bearer exchange: failed` with 401 | Connectivity Service doesn't trust the user's JWT issuer | Ensure IdP trust is configured in BTP subaccount |
| `Destination Service returned no authTokens` (warn) | Known Destination Service behavior for PP destinations | ARC-1 handles this automatically via jwt-bearer fallback — no action needed |

---

## Configuration Reference

| Env Var / Flag | Description | Default |
|----------------|-------------|---------|
| `SAP_BTP_DESTINATION` | BTP Destination name (BasicAuth, startup) | *(none)* |
| `SAP_BTP_PP_DESTINATION` | BTP Destination name (PP, per-user) | Falls back to `SAP_BTP_DESTINATION` |
| `SAP_PP_ENABLED` / `--pp-enabled` | Enable principal propagation | `false` |
| `SAP_XSUAA_AUTH` / `--xsuaa-auth` | Enable XSUAA OAuth proxy | `false` |
| `SAP_URL` / `--url` | Direct SAP URL (overridden by destination) | *(none)* |
| `SAP_USER` / `--user` | Direct SAP user (overridden by destination/PP) | *(none)* |
| `SAP_PASSWORD` / `--password` | Direct SAP password (overridden by destination/PP) | *(none)* |

**Priority:** PP per-user > BTP Destination > env vars.

## SAP Documentation References

- [Authenticating Users against On-Premise Systems](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/authenticating-users-against-on-premise-systems) — PP overview
- [Configure PP via User Exchange Token](https://help.sap.com/docs/CP_CONNECTIVITY/cca91383641e40ffbe03bdc78f00f681/39f538ad62e144c58c056ebc34bb6890.html) — Option 1 vs Option 2
- [HTTP Proxy for On-Premise Connectivity](https://help.sap.com/docs/CP_CONNECTIVITY/b865ed651e414196b39f8922db2122c7/d872cfb4801c4b54896816df4b75c75d.html) — Proxy headers, Location ID
- [SAP Cloud SDK — Destinations](https://sap.github.io/cloud-sdk/docs/js/features/connectivity/destinations) — SDK destination resolution
- [SAP Cloud SDK — On-Premise Connectivity](https://sap.github.io/cloud-sdk/docs/js/features/connectivity/on-premise) — Cloud Connector proxy
- [Destination Authentication Methods](https://help.sap.com/docs/btp/best-practices/destination-authentication-methods) — BTP Best Practices
