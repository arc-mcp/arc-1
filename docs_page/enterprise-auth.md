# Authentication Overview

ARC-1 has two independent authentication concerns that work together:

1. **MCP Client → ARC-1**: How does the AI client (Claude, Cursor, Copilot Studio) prove its identity to ARC-1?
2. **ARC-1 → SAP**: How does ARC-1 authenticate to the SAP system?

These are separate layers. You choose one method for each, and they combine freely. This guide helps you understand the options, pick the right combination, and find the detailed setup instructions.

For **what users can do** after authenticating (scopes, roles, safety controls), see [Authorization & Roles](authorization.md).

```
┌─────────────┐      MCP Client Auth       ┌─────────┐      SAP Auth        ┌─────────────┐
│  AI Client  │ ──────────────────────────► │  ARC-1  │ ──────────────────► │ SAP System  │
│  (Claude,   │  API Key, OIDC/JWT,        │  Server │  Basic Auth,        │ (ABAP, BTP) │
│   Cursor)   │  or XSUAA OAuth            │         │  Service Key,       │             │
└─────────────┘                            └─────────┘  Destination, or PP └─────────────┘
```

---

## Choosing Your Setup

### Quick Decision Guide

After starting, check the server's first INFO log line: `auth: MCP=[...] SAP=[...]`. This is the authoritative summary of what's active.

| Your situation | MCP Client → ARC-1 | ARC-1 → SAP | Setup Guide |
|----------------|-------------------|-------------|-------------|
| **Local dev** (single user, `npx`) | None needed | Basic Auth | [Quickstart](quickstart.md) |
| **Shared server** (team, quick start) | API Key | Basic Auth | [API Key Setup](api-key-setup.md) |
| **Team server** (role-based access) | API Keys (multi) | Basic Auth | [API Key Setup](api-key-setup.md) |
| **Enterprise** (per-user identity) | OIDC / JWT | Basic Auth (shared user) | [OAuth / JWT Setup](oauth-jwt-setup.md) |
| **Enterprise + SAP audit trail** | OIDC / JWT | Principal Propagation | [OAuth / JWT](oauth-jwt-setup.md) + [PP Setup](principal-propagation-setup.md) |
| **BTP Cloud Foundry** | XSUAA OAuth | Destination Service | [XSUAA Setup](xsuaa-setup.md) + [Destination Setup](btp-destination-setup.md) |
| **BTP ABAP Environment** (direct) | None (local) or XSUAA | OAuth (service key) | [BTP ABAP Setup](btp-abap-environment.md) |

### What to Consider

**How many users?**

- **Single user** (local dev): No MCP client auth needed. Use Basic Auth to SAP.
- **Small team** (shared server): API Key is the simplest. For role differentiation, use [multiple API keys](api-key-setup.md#multi-key-setup-role-based-access) with per-key profiles.
- **Enterprise** (many users, compliance): Use OIDC or XSUAA. Per-user tokens enable per-user [scopes and roles](authorization.md).

**Do you need per-user SAP identity?**

- **No** (most setups): ARC-1 connects to SAP with a single shared user. Simpler to set up, but all operations appear as one SAP user in logs.
- **Yes** (audit, compliance): Use [Principal Propagation](principal-propagation-setup.md). Each MCP user maps to their SAP user. Full audit trail, per-user SAP authorization. Requires BTP + Cloud Connector setup.

**Where does ARC-1 run?**

- **Locally** (npx, npm): MCP client connects via stdio. No network auth needed.
- **Remote server / Docker**: MCP client connects via HTTP. Needs MCP Client Auth (API Key or OIDC).
- **SAP BTP Cloud Foundry**: XSUAA handles both MCP client auth and SAP connectivity.

---

## MCP Client Authentication (Client → ARC-1)

These methods control who can talk to ARC-1 when it runs as an HTTP server. Not needed for local stdio connections.

### No Authentication (Local / stdio)

When using ARC-1 locally via `npx` or `npm`, the MCP client connects through stdio (standard input/output). No network auth is needed — security relies on the user's OS-level access.

**Upsides:** Zero setup. Works immediately.
**Downsides:** No per-user identity. No authorization scopes - only the [server ceiling](authorization.md#where-to-set-things) applies.
**When to use:** Local development, personal use.

### API Key

A shared secret token. Simple to set up, no external IdP needed. Supports **multiple keys with per-key profiles** for role-based access control.

**Upsides:** Simplest server auth. Works with any MCP client. No IdP needed. Per-key profiles enable role-based access without an external auth provider.
**Downsides:** Keys identify roles, not individual users. No per-user SAP audit trail. Key rotation requires updating clients.
**When to use:** Small-to-medium teams, POCs, internal servers behind a VPN. Multi-key mode works well for team servers with 2–3 access levels.
**Prerequisites:** Generate random keys, configure server and clients.

**Setup:** [API Key Setup](api-key-setup.md)

### OIDC / JWT (External Identity Provider)

Per-user authentication via any [OpenID Connect](https://openid.net/specs/openid-connect-core-1_0.html) provider (Microsoft Entra ID, Google, Okta, Keycloak, Auth0, etc.). Users authenticate with their corporate identity. Tokens carry per-user [scopes](authorization.md#user-scopes) for fine-grained authorization.

**Upsides:** Per-user identity. Per-user scopes. Works with existing corporate IdPs. Standard protocol.
**Downsides:** Requires an OIDC provider. Token rotation is automatic (refresh tokens) but initial setup is more complex.
**When to use:** Enterprise deployments with existing identity infrastructure.
**Prerequisites:** An OIDC provider with app registration. Configure scopes in IdP to match ARC-1's scope model.

**Setup:** [OAuth / JWT Setup](oauth-jwt-setup.md)

### XSUAA OAuth (SAP BTP)

SAP's own OAuth service for BTP applications. Similar to OIDC but uses SAP's [Authorization and Trust Management Service](https://help.sap.com/docs/btp/sap-business-technology-platform/what-is-sap-authorization-and-trust-management-service). Scopes and roles are managed in the BTP Cockpit.

**Upsides:** Native BTP integration. Scopes and roles managed in BTP Cockpit. Supports [role collections](authorization.md#btp-xsuaa-role-templates) for easy user management. MCP clients auto-discover the OAuth configuration.
**Downsides:** Only available on BTP. More complex setup than API Key.
**When to use:** BTP Cloud Foundry deployments.
**Prerequisites:** BTP subaccount with XSUAA service instance.

**Setup:** [XSUAA Setup](xsuaa-setup.md)

---

## SAP Authentication (ARC-1 → SAP)

These methods control how ARC-1 proves its identity to the SAP system.

### Basic Authentication

Username and password sent with every HTTP request to SAP. The simplest SAP auth method.

**Upsides:** Zero SAP-side setup. Works with any SAP system.
**Downsides:** Credentials stored in config. Single SAP user for all MCP users. No per-user audit trail.
**When to use:** Local dev, shared servers where SAP identity doesn't matter.
**Prerequisites:** A SAP user with appropriate authorization (see [Authorization & Roles](authorization.md#the-model-in-one-picture)).

```bash
arc1 --url http://sap:50000 --user DEVELOPER --password secret
```

### Cookie Authentication

Reuse session cookies from a browser session. Useful for one-off sessions.

**Upsides:** No stored credentials. Reuses existing browser session.
**Downsides:** Cookies expire (typically 30 minutes). Manual process.
**When to use:** Quick one-off sessions using an existing SAP GUI/Fiori session.

```bash
arc1 --url http://sap:50000 --cookie-file cookies.txt
```

### OAuth2 / Service Key (BTP ABAP Environment)

For SAP BTP ABAP Environment systems, ARC-1 uses a service key for OAuth2 authentication. Handles token lifecycle (refresh, retry) automatically. Requires an interactive browser login on first use.

**Upsides:** Secure OAuth flow. Automatic token refresh. Works with BTP ABAP systems.
**Downsides:** Requires service key from BTP Cockpit. Interactive login on first use.
**When to use:** Connecting to BTP ABAP Environment (Steampunk) systems.
**Prerequisites:** BTP ABAP instance with service key. See [BTP ABAP Setup](btp-abap-environment.md).

```bash
arc1 --btp-service-key-file /path/to/service-key.json
```

### Principal Propagation (Per-User SAP Identity)

The most complete authentication model. Each MCP user's identity flows through to SAP via BTP Destination Service and Cloud Connector, so every request runs as the real SAP user — not a shared technical account.

**Upsides:** Full per-user audit trail. SAP-level authorization per user. Zero stored SAP credentials. No shared accounts.
**Downsides:** Most complex setup (BTP + Cloud Connector + CERTRULE). Requires OIDC or XSUAA on the client side.
**When to use:** Enterprise deployments requiring audit compliance, per-user SAP authorization, or regulatory requirements.
**Prerequisites:** BTP Cloud Foundry, Destination + Connectivity services, Cloud Connector, SAP certificate mapping.

**Setup:** [Principal Propagation Setup](principal-propagation-setup.md)

```
MCP Client ──OIDC/XSUAA──► ARC-1 ──X-User-Token──► BTP Destination ──► Cloud Connector ──► SAP
```

### BTP Destination Service

For BTP deployments connecting to on-premise SAP systems via Cloud Connector. The Destination Service handles connection details, credentials, and optionally Principal Propagation.

**Upsides:** Centralized connection management. Cloud Connector integration. Supports PP.
**Downsides:** BTP-only. Requires Destination and Connectivity service instances.
**When to use:** BTP Cloud Foundry apps connecting to on-premise SAP via Cloud Connector.
**Prerequisites:** BTP Destination Service instance, Cloud Connector configured.

**Setup:** [BTP Destination Setup](btp-destination-setup.md)

---

## Common Combinations

### Local Developer

```
stdio (no MCP auth) → Basic Auth to SAP
```

Simplest setup. Single user. Leave defaults for read-only access, or set `SAP_ALLOW_WRITES=true` (plus `SAP_ALLOWED_PACKAGES="$TMP,Z*"`) to enable developer writes.

### Team Server with Role-Based Access

```
API Keys with profiles (MCP auth) → Basic Auth to SAP
```

Quick to set up. Different keys for different roles (e.g., viewer key for reviewers, developer key for developers). All users share one SAP user. Each key enforces its profile's scopes and safety restrictions.

### Enterprise with Per-User Control

```
OIDC (MCP auth) → Basic Auth (shared SAP user)
```

Per-user scopes control what each person can do in ARC-1, but all requests use the same SAP user. Good when SAP identity per user isn't required.

### Enterprise with Full Audit Trail

```
OIDC or XSUAA (MCP auth) → Principal Propagation (per-user SAP identity)
```

Gold standard. Per-user scopes in ARC-1 + per-user SAP authorization + full audit trail. Requires BTP + Cloud Connector setup.

### BTP Cloud Foundry (Production)

```
XSUAA (MCP auth) → BTP Destination Service → Cloud Connector → On-premise SAP
```

Full BTP stack. Role collections in BTP Cockpit. PP optional but recommended for audit compliance.

---

## Setup Guides

| Guide | What it covers |
|-------|---------------|
| [API Key Setup](api-key-setup.md) | Shared token auth for MCP clients |
| [OAuth / JWT Setup](oauth-jwt-setup.md) | Per-user OIDC auth (EntraID, Okta, Keycloak) |
| [XSUAA Setup](xsuaa-setup.md) | SAP BTP OAuth with role collections |
| [Principal Propagation Setup](principal-propagation-setup.md) | Per-user SAP identity via Cloud Connector |
| [BTP Destination Setup](btp-destination-setup.md) | BTP connectivity to on-premise SAP |
| [BTP ABAP Environment](btp-abap-environment.md) | Direct connection to BTP ABAP (Steampunk) |
| [Auth Test Process](auth-test-process.md) | Verification checklists for each auth method |
| [Authorization & Roles](authorization.md) | Scopes, roles, safety config |

---

## Detailed SAP Authentication Reference

The sections below provide configuration details for each SAP authentication method. For most users, the setup guides above are sufficient — use this reference for advanced configuration or troubleshooting.

---

## 1. Basic Authentication

The simplest method. Username and password are sent with every HTTP request.

```bash
# CLI flags
arc1 --url https://sap-host:443 --user DEVELOPER --password 'ABAPtr2023#00'

# Environment variables
export SAP_URL=https://sap-host:443
export SAP_USER=DEVELOPER
export SAP_PASSWORD='ABAPtr2023#00'
arc1

# .env file (auto-loaded)
SAP_URL=https://sap-host:443
SAP_USER=DEVELOPER
SAP_PASSWORD=ABAPtr2023#00
```

**When to use:** Local development, sandbox systems, CI/CD pipelines with secrets.
**Security:** Password is in plaintext in config/env. Not suitable for production
multi-user deployments.

---

## 2. Cookie Authentication

Reuse session cookies from a browser session (MYSAPSSO2, SAP_SESSIONID).

```bash
# From a cookie file (Netscape format or key=value)
arc1 --url https://sap-host:443 --cookie-file cookies.txt

# From a cookie string
arc1 --url https://sap-host:443 --cookie-string "MYSAPSSO2=abc123; SAP_SESSIONID_A4H_001=xyz"
```

**When to use:** One-off sessions where you have browser cookies.
**Security:** Session cookies expire (typically 30 min). Not scalable.

---

## 3. BTP ABAP Environment (Service Key + Browser OAuth)

For SAP BTP ABAP Environment systems. ARC-1 uses a service key for OAuth2 Authorization Code flow with interactive browser login.

### From a Service Key File

```bash
arc1 --btp-service-key-file /path/to/service-key.json
```

Or inline:

```bash
arc1 --btp-service-key '{"uaa":{"url":"...","clientid":"...","clientsecret":"..."},"url":"https://..."}'
```

The service key JSON is downloaded from SAP BTP Cockpit and looks like:

```json
{
  "url": "https://my-system.abap.eu10.hana.ondemand.com",
  "systemid": "DEV",
  "uaa": {
    "url": "https://my-tenant.authentication.eu10.hana.ondemand.com",
    "clientid": "sb-clone-abc123",
    "clientsecret": "secret-value"
  }
}
```

**Token lifecycle:** ARC-1 opens a browser for initial OAuth login, then caches and refreshes tokens automatically.

**References:**
- [SAP BTP: Create Service Keys](https://help.sap.com/docs/btp/sap-business-technology-platform/creating-service-keys)
- [BTP ABAP Environment Setup](btp-abap-environment.md)

---

## 4. BTP Destination Service

For BTP Cloud Foundry deployments connecting to on-premise SAP systems via Cloud Connector.

```bash
export SAP_BTP_DESTINATION=SAP_TRIAL
```

The Destination Service handles connection details, credentials, and optionally Principal Propagation. See [BTP Destination Setup](btp-destination-setup.md).

---

## 5. Principal Propagation (BTP Destination + Cloud Connector)

Per-user SAP identity for JWT-authenticated users via BTP Destination Service.

```bash
export SAP_BTP_DESTINATION=SAP_TRIAL
export SAP_BTP_PP_DESTINATION=SAP_TRIAL_PP
export SAP_PP_ENABLED=true
```

**How it works:** ARC-1 passes the user's JWT as `X-User-Token` to BTP Destination Service, which resolves the per-user destination. Cloud Connector propagates the user identity via client certificate. SAP maps the certificate to a SAP user via CERTRULE / VUSREXTID.

**Fallback behavior:**
- `SAP_PP_STRICT=false` (default): falls back to shared destination on PP failure
- `SAP_PP_STRICT=true`: returns error on PP failure, no fallback

See [Principal Propagation Setup](principal-propagation-setup.md) for complete setup.

---

## Custom TLS Trust

When the SAP system uses a TLS server certificate signed by an internal CA
(not a public CA like Let's Encrypt), use `--insecure` or mount the CA certificate
into the Node.js trust store via `NODE_EXTRA_CA_CERTS`.

```bash
# Skip TLS verification (development only)
arc1 --url https://sap-host:443 --user DEV --password pass --insecure

# Mount custom CA (production)
NODE_EXTRA_CA_CERTS=/path/to/internal-ca.crt arc1 --url https://sap-host:443 ...
```

---

## SAML Disable (Advanced, Opt-in)

Some on-prem AS ABAP systems are configured with SAML as the default ICF auth method
even where Basic / cookie auth is also available. ARC-1 can request that SAP skip
the SAML redirect via either a request header (preferred) or a URL query parameter:

```bash
SAP_DISABLE_SAML=true
```

When set, every ADT request adds `X-SAP-SAML2: disabled` (SAP Note 3456236)
and `?saml2=disabled` (SAP KBA 2577263). **Never enable this on BTP ABAP Environment
or S/4HANA Public Cloud** — those systems require SAML, and disabling it breaks login.
ARC-1 emits a warning if you combine `SAP_DISABLE_SAML=true` with
`SAP_SYSTEM_TYPE=btp`.

### HTML login page detection

Independent of the SAML flag, ARC-1 detects when SAP returns a login HTML page
(200 OK + `Content-Type: text/html`) on an ADT endpoint. Instead of trying to parse
HTML as XML, ARC-1 throws a clear `401 — ADT call returned HTML login page` error
with pointers to the common causes (expired cookies, wrong Basic creds, missing
S_ADT_RES authorization, SSO-only system needing `SAP_DISABLE_SAML=true`).

---

## Configuration Reference

### All Auth-Related Flags

| Flag | Env Var | Description |
|------|---------|-------------|
| **MCP Client Auth** | | |
| `--api-keys` | `ARC1_API_KEYS` | Multiple API keys with profiles (`key:profile,...`) |
| `--oidc-issuer` | `SAP_OIDC_ISSUER` | OIDC issuer URL |
| `--oidc-audience` | `SAP_OIDC_AUDIENCE` | Expected token audience (**required** when `--oidc-issuer` is set) |
| `--xsuaa-auth` | `SAP_XSUAA_AUTH` | Enable XSUAA OAuth proxy (`true`/`false`) |
| **SAP Auth** | | |
| `--user` | `SAP_USER` | SAP username (basic auth) |
| `--password` | `SAP_PASSWORD` | SAP password (basic auth) |
| `--cookie-file` | `SAP_COOKIE_FILE` | Path to cookie file |
| `--cookie-string` | `SAP_COOKIE_STRING` | Cookie string |
| `--btp-service-key` | `SAP_BTP_SERVICE_KEY` | Inline BTP service key JSON |
| `--btp-service-key-file` | `SAP_BTP_SERVICE_KEY_FILE` | Path to BTP service key file |
| `--btp-oauth-callback-port` | `SAP_BTP_OAUTH_CALLBACK_PORT` | OAuth callback port (0=auto) |
| — | `SAP_BTP_DESTINATION` | BTP Destination name (shared) |
| — | `SAP_BTP_PP_DESTINATION` | BTP PP Destination name (per-user) |
| `--pp-enabled` | `SAP_PP_ENABLED` | Enable principal propagation |
| `--pp-strict` | `SAP_PP_STRICT` | Fail on PP errors (no fallback) |
| `--pp-allow-shared-cookies` | `SAP_PP_ALLOW_SHARED_COOKIES` | Allow PP + cookie auth only for shared client (advanced escape hatch) |
| `--disable-saml` | `SAP_DISABLE_SAML` | Disable SAML redirect via `X-SAP-SAML2` + `saml2=disabled` (advanced) |
| `--insecure` | `SAP_INSECURE` | Skip TLS verification |

## Coexistence Matrix

**Layer A** (MCP client → ARC-1) methods always combine. **Layer B** (ARC-1 → SAP) methods are largely exclusive — the matrix below shows valid combinations.

| Layer B combination | Status | Reason |
|---|---|---|
| Basic only | ✅ | Standard on-prem |
| Cookie only | ✅ | On-prem SSO developer loop |
| Basic + Cookie | ✅ | ARC-1 sends both headers — SAP picks |
| Bearer (BTP ABAP) only | ✅ | BTP ABAP Environment direct OAuth |
| Destination only | ✅ | BTP Cloud Foundry, shared user |
| Destination + PP (per-user) | ✅ | Enterprise standard on BTP CF |
| PP + Cookie | ❌ fail-fast | Cookies would leak into per-user requests |
| PP + Cookie + SAP_PP_ALLOW_SHARED_COOKIES=true | ⚠️ allowed with warning | Cookies stay on shared client only |
| Bearer + Cookie | ❌ fail-fast | Two Layer B methods in conflict |
| Bearer + PP | ❌ fail-fast | BTP ABAP is single-tenant; PP not supported |

### SAP Auth Coexistence Rules

ARC-1 enforces these Layer B constraints at startup:

1. `SAP_PP_ENABLED=true` with `SAP_COOKIE_FILE` / `SAP_COOKIE_STRING` fails fast unless `SAP_PP_ALLOW_SHARED_COOKIES=true`.
2. `SAP_BTP_SERVICE_KEY` with `SAP_COOKIE_FILE` / `SAP_COOKIE_STRING` fails fast.
3. `SAP_BTP_SERVICE_KEY` with `SAP_PP_ENABLED=true` fails fast.
4. `SAP_DISABLE_SAML=true` with `SAP_SYSTEM_TYPE=btp` emits a warning (startup continues).
5. `ARC1_DCR_SIGNING_SECRET` set without `SAP_XSUAA_AUTH=true` emits a warning (startup continues, secret is unused — only consumed by the XSUAA OAuth proxy path).

MCP client auth (API Key, OIDC, XSUAA) is independent and can be combined with any SAP auth method.

### What's NOT Implemented

These flags from older documentation do **not** exist in the current ARC-1 codebase:

- `--client-cert` / `--client-key` / `--ca-cert` (local mTLS)
- `--service-key` / `--oauth-url` / `--oauth-client-id` / `--oauth-client-secret` (generic OAuth)
- `--oidc-username-claim` / `--oidc-user-mapping` (username mapping)
- `--pp-ca-key` / `--pp-ca-cert` / `--pp-cert-ttl` (local ephemeral cert generation)

!!! warning "Audience is required"
    When `--oidc-issuer` is set, `--oidc-audience` must also be set. ARC-1 will refuse to start without an explicit audience to prevent token confusion attacks.

---

## Troubleshooting

### OIDC token validation fails

**"key ID not found in JWKS"**
- The token was signed with a key that rotated. JWKS cache refreshes every hour.
- Verify the `--oidc-issuer` URL is correct (must match the `iss` claim)

**"JWT audience mismatch"** or **"OIDC audience is required"**
- `SAP_OIDC_AUDIENCE` is mandatory when `SAP_OIDC_ISSUER` is set — ARC-1 will not start without it
- For Entra ID v2.0 tokens (`requestedAccessTokenVersion: 2`), the `aud` claim is the raw client ID GUID
- For Entra ID v1.0 tokens (default), the `aud` claim is `api://{client-id}`
- Set `SAP_OIDC_AUDIENCE` to match what your tokens actually contain
- Check with: `az account get-access-token --scope "api://{client-id}/access_as_user" --query accessToken -o tsv | jwt decode -` (or paste into jwt.ms)

**"JWT issuer mismatch"**
- EntraID v2.0 issuer format: `https://login.microsoftonline.com/{tenant-id}/v2.0`
- EntraID v1.0 issuer format: `https://sts.windows.net/{tenant-id}/`
- Set `requestedAccessTokenVersion: 2` in the app manifest to get v2.0 tokens

### Power Platform / Copilot Studio OAuth errors

**"AADSTS50011" (Reply address mismatch)**
- Each Power Automate connector generates a unique redirect URI
- Copy the exact URI from the connector's Security tab → Umleitungs-URL
- Add it to the Entra ID app registration under Authentication → Web → Redirect URIs

**"AADSTS90009" (Requesting token for itself, use GUID)**
- When an app requests a token for itself (client ID = resource), the Resource URL must be the raw GUID
- Change Resource URL from `api://...` to just the client ID GUID

**"AADSTS90008" (Must require Microsoft Graph access)**
- Add `User.Read` delegated permission from Microsoft Graph
- Grant admin consent: `az ad app permission admin-consent --id {client-id}`

**"Anmelden nicht möglich" / Login popup opens and closes**
- Verify Tenant ID in the connector is the actual tenant GUID, not `common`
- Verify Resource URL is set (not empty)
- Verify the redirect URI is registered in the app registration

### Principal propagation always falls back to shared user

- Verify `SAP_PP_ENABLED=true` is set
- Verify `SAP_BTP_PP_DESTINATION` authentication type is `PrincipalPropagation` in BTP Cockpit
- Verify Cloud Connector + backend certificate mapping configuration
- Check Cloud Connector logs for PP errors
