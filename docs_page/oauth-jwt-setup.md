# OAuth / JWT Setup

Authenticate MCP clients using OAuth 2.1 with an external identity provider (Microsoft Entra ID, Cognito, Okta, Keycloak). ARC-1 validates JWT bearer tokens and extracts user identity.

## When to Use

- Enterprise environments with existing IdP
- When you need to know which user is making requests
- Audit trail requirements
- When combined with per-user SAP auth through BTP Destination principal propagation

## Architecture

```
                                 ┌─────────────────────┐
                                 │  Identity Provider   │
                                 │  (Entra ID / Cognito)│
                                 └──────┬──────────────┘
                                        │ OIDC tokens
┌──────────────────┐     JWT Bearer     │     ┌──────────────────┐     Basic Auth      ┌────────────┐
│  MCP Client      │ ──────────────────►├────►│  arc1 Server      │ ──────────────────► │  SAP ABAP  │
│  (IDE / Copilot) │   Authorization    │     │  validates JWT    │   service account  │  System    │
└──────────────────┘                    │     └──────────────────┘                     └────────────┘
                                        │
                          ┌─────────────┘
                          │ JWKS keys
                          │ (cached 1h)
```

## Identity Provider Setup

### Microsoft Entra ID (Azure AD)

1. **Create App Registration:**
   - Azure Portal → Microsoft Entra ID → App registrations → New registration
   - Name: `ARC-1 SAP MCP Server`
   - Supported account types: **Single tenant** (`Accounts in this organizational directory only`)
   - Redirect URI: leave blank (will be set after Copilot Studio connector creation)

2. **Expose an API:**
   - App registration → Expose an API → Set Application ID URI (accept default `api://{client-id}`)
   - Add a scope: `access_as_user` — Type: `Admins and users`, Display name: `Access ARC-1`

3. **Set Token Version to v2.0:**
   - App registration → Manifest → set `"requestedAccessTokenVersion": 2`
   - Or via Azure CLI:
     ```bash
     # Get the object ID of the service principal's associated app
     az ad app show --id {client-id} --query id -o tsv
     # Patch the API application to use v2.0 tokens
     az rest --method PATCH \
       --url "https://graph.microsoft.com/v1.0/applications/{object-id}" \
       --body '{"api":{"requestedAccessTokenVersion":2}}'
     ```
   - **Why:** v2.0 tokens use the raw client ID as `aud` claim, while v1.0 uses `api://...` URI. The OIDC validator needs a consistent audience value.

4. **Add Microsoft Graph User.Read permission:**
   - App registration → API permissions → Add a permission → Microsoft Graph → Delegated → `User.Read`
   - Click **Grant admin consent** for your organization
   - Or via Azure CLI:
     ```bash
     az ad app permission add --id {client-id} \
       --api 00000003-0000-0000-c000-000000000000 \
       --api-permissions e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope
     az ad app permission admin-consent --id {client-id}
     ```
   - **Why:** Power Platform requires this permission for OAuth connectors.

5. **Create a Client Secret:**
   - App registration → Certificates & secrets → New client secret
   - Copy the secret value immediately (it won't be shown again)
   - Or via Azure CLI:
     ```bash
     az ad app credential reset --id {client-id} --display-name "PowerAutomate" --years 2
     ```

6. **Note the values:**
   - **Application (client) ID** — used as both Client ID and audience
   - **Directory (tenant) ID** — e.g., `9ef3a122-4319-496a-a394-a7318c2d0a7e`
   - **Client secret** — from step 5
   - **Issuer URL:** `https://login.microsoftonline.com/{tenant-id}/v2.0`

### AWS Cognito

1. Create User Pool
2. Create App Client
3. Configure domain
4. Issuer URL: `https://cognito-idp.{region}.amazonaws.com/{pool-id}`

### Keycloak

1. Create Realm
2. Create Client (confidential)
3. Issuer URL: `https://keycloak.company.com/realms/{realm}`

## Server Setup

### Start arc1 with OIDC Validation

> **`SAP_OIDC_AUDIENCE` is mandatory.** When `--oidc-issuer` is set, `--oidc-audience` must also be provided. ARC-1 will refuse to start without an explicit audience to prevent token confusion attacks.

```bash
arc1 --url https://sap.example.com:44300 \
    --user SAP_SERVICE_USER \
    --password 'ServicePassword123' \
    --transport http-streamable \
    --http-addr 0.0.0.0:8080 \
    --oidc-issuer 'https://login.microsoftonline.com/{tenant-id}/v2.0' \
    --oidc-audience '{client-id-guid}'
```

### Environment Variables

```bash
export SAP_URL=https://sap.example.com:44300
export SAP_USER=SAP_SERVICE_USER
export SAP_PASSWORD=ServicePassword123
export SAP_TRANSPORT=http-streamable
export SAP_HTTP_ADDR=0.0.0.0:8080
export SAP_OIDC_ISSUER='https://login.microsoftonline.com/{tenant-id}/v2.0'
export SAP_OIDC_AUDIENCE='{client-id-guid}'
export SAP_OIDC_CLOCK_TOLERANCE='5'                  # seconds, optional (default: 0 — no tolerance)
```

> **Note:** `SAP_OIDC_AUDIENCE` must match the exact `aud` claim in your tokens. For Entra ID v2 access tokens, this is typically the raw client ID GUID. Validate with a real token from your tenant.

### How ARC-1 permissions are derived

OIDC answers **who the MCP caller is**. It does not, by itself, grant write access or override ARC-1 safety settings.

ARC-1 combines three things on each request:

1. The user's JWT scopes from the `scope` or `scp` claim. For ARC-1 these are `read`, `write`, `data`, `sql`, `transports`, `git`, and `admin`.
2. The server's safety configuration such as `SAP_ALLOW_WRITES`, `SAP_ALLOW_DATA_PREVIEW`, `SAP_ALLOW_FREE_SQL`, `SAP_ALLOW_TRANSPORT_WRITES`, `SAP_ALLOW_GIT_WRITES`, `SAP_ALLOWED_PACKAGES`, and `SAP_DENY_ACTIONS`.
3. The SAP user's own authorization, which still runs after ARC-1 allows the request.

These gates combine with **AND**, not OR:

- If the token has `write` but the server runs with `SAP_ALLOW_WRITES=false`, writes are still blocked.
- If the token has `sql` but the server keeps `SAP_ALLOW_FREE_SQL=false`, free SQL is still blocked.
- If the token has no `scope` or `scp` claim at all, ARC-1 falls back to read-only access and logs a warning.

For a shared development server, a common setup is:

```bash
export SAP_ALLOW_WRITES=true
export SAP_ALLOW_TRANSPORT_WRITES=true
export SAP_ALLOW_GIT_WRITES=true
export SAP_ALLOWED_PACKAGES='Z*,$TMP'
```

Those are server-side variables on the ARC-1 process. If you want a read-only shared server with SQL + named table preview, set only `SAP_ALLOW_DATA_PREVIEW=true SAP_ALLOW_FREE_SQL=true` and leave `SAP_ALLOW_WRITES=false`. Do **not** put these server-side policy decisions in `.vscode/mcp.json`; that file only tells the client which MCP URL to call.

Then let your IdP assign JWT scopes per user:

- `read` for reviewers
- `read write` for developers
- `read write transports` for users allowed to create/release CTS requests
- `read write git` for users allowed to run gCTS/abapGit mutations
- `read write data sql` only for users who should access SAP data through ARC-1

Transport and Git mutations need both `write` and the specialized `transports` / `git` scope. Granting only `transports` or only `git` is not enough because ARC-1 disables all mutations for users without `write`.

Full flag/profile reference: [configuration-reference.md](configuration-reference.md). Full scope and role model: [authorization.md](authorization.md).

## Client Configuration

### VS Code (with OAuth)

VS Code supports MCP OAuth natively. Configure in `.vscode/mcp.json`:

```json
{
  "servers": {
    "arc1": {
      "type": "http",
      "url": "https://arc1.company.com/mcp"
    }
  }
}
```

VS Code will:
1. Discover the Protected Resource Metadata at `/.well-known/oauth-protected-resource`
2. Find the Authorization Server (your IdP)
3. Open browser for OAuth login
4. Send Bearer tokens automatically

### Microsoft Copilot Studio / Power Automate

Copilot Studio uses Power Automate custom connectors to connect to MCP servers. The connector handles OAuth token acquisition automatically.

#### Step 1: Create Custom Connector

1. Go to [Power Automate](https://make.powerautomate.com/) → **Custom connectors** → **New custom connector** → **Create from blank**
2. **General tab:**
   - Connector name: `ARC-1 SAP MCP`
   - Host: `your-arc1-server.cfapps.us10-001.hana.ondemand.com` (or your server hostname)
   - Base URL: `/`

#### Step 2: Configure Security Tab

3. **Security tab** → Authentication type: **OAuth 2.0**
   - Identity Provider: **Azure Active Directory**
   - Enable **Dienstprinzipal-Unterstützung** (Service Principal support)
   - **Client ID:** `{client-id}` (from Entra ID app registration)
   - **Client secret:** `{client-secret}` (from Entra ID app registration)
   - **Authorization URL:** `https://login.microsoftonline.com`
   - **Tenant ID:** `{tenant-id}` (your actual tenant ID — **NOT** `common`)
   - **Resource URL:** `{client-id}` (the raw GUID, **NOT** `api://...`)
   - **Scope:** `api://{client-id}/access_as_user offline_access`

> **⚠️ Critical:** The **Tenant ID** must be your actual tenant GUID, not `common`. Using `common` fails for single-tenant apps.
>
> **⚠️ Critical:** The **Resource URL** must be the raw client ID GUID (e.g., `aa34a3d1-...`), not the `api://` URI. When an app requests a token for itself, Entra ID requires the GUID format.

#### Step 3: Create Definition

4. **Definition tab** → Create an action:
   - Summary: `InvokeServer`
   - Operation ID: `InvokeServer`
   - Verb: **POST**
   - URL: `https://your-arc1-server.example.com/mcp`
5. Click **Connector aktualisieren** (Update Connector)

#### Step 4: Add Redirect URI to Entra ID

6. After creating the connector, copy the **Umleitungs-URL** (Redirect URL) shown at the bottom of the Security tab
   - It looks like: `https://global.consent.azure-apim.net/redirect/crc25-5farc-2d1-20...`
7. Go to Azure Portal → App registration → **Authentication** → Add platform → **Web**
   - Add the redirect URI from step 6
   - Also add the base: `https://global.consent.azure-apim.net/redirect`

   Or via Azure CLI:
   ```bash
   az ad app update --id {client-id} \
     --web-redirect-uris \
       "https://global.consent.azure-apim.net/redirect" \
       "https://global.consent.azure-apim.net/redirect/your-connector-specific-uri"
   ```

#### Step 5: Create Connection

8. Click **Verbindung erstellen** (Create Connection)
9. A Microsoft login popup will appear — sign in with your organization account
10. Grant the requested permissions (Sign in and read user profile)

#### Troubleshooting Copilot Studio

| Error | Cause | Fix |
|-------|-------|-----|
| `AADSTS50011` (Reply address mismatch) | Redirect URI not registered | Add the connector's specific redirect URI to the app registration |
| `AADSTS90009` (Requesting token for itself) | Resource URL uses `api://` format | Change Resource URL to raw client ID GUID |
| `AADSTS90008` (Not consented, must require Graph) | Missing `User.Read` permission | Add Microsoft Graph `User.Read` and grant admin consent |
| `AADSTS65001` (Consent not granted) | App not authorized | Run `az ad app permission admin-consent --id {client-id}` |
| `Anmelden nicht möglich` (Login not possible) | Tenant ID is `common` or Resource URL empty | Set Tenant ID to actual GUID; set Resource URL to client ID |
| OAuth popup opens/closes immediately | Multiple issues possible | Check Tenant ID, Resource URL, and redirect URI registration |

### Manual Token Testing

```bash
# Get a token from your IdP (example with Azure CLI)
# First, authorize Azure CLI for your app:
az ad app update --id {client-id} --set "api.preAuthorizedApplications=[{\"appId\":\"04b07795-8ddb-461a-bbee-02f9e1bf7b46\",\"delegatedPermissionIds\":[\"your-scope-id\"]}]"

# Login with the scope
az login --scope "api://{client-id}/access_as_user"

# Get a token
TOKEN=$(az account get-access-token --scope "api://{client-id}/access_as_user" --query accessToken -o tsv)

# Test against arc1
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  https://your-arc1-server.example.com/mcp
```

## How It Works

1. MCP client sends request without token
2. ARC-1 returns `401` with `WWW-Authenticate: Bearer resource_metadata="..."`
3. Client fetches Protected Resource Metadata
4. Client discovers IdP authorization server
5. Client performs OAuth 2.1 Authorization Code + PKCE flow
6. Client sends `Authorization: Bearer <jwt>` on every request
7. ARC-1 validates JWT signature via JWKS (cached 1 hour)
8. arc1 checks issuer, audience, expiry
9. ARC-1 extracts username from configured claim
10. Request proceeds (SAP auth still via service account)

## Security Notes

- JWT signatures are cryptographically verified via JWKS
- JWKS keys are cached for 1 hour (auto-refresh)
- Tokens must have correct issuer AND audience (`SAP_OIDC_AUDIENCE` is mandatory)
- ARC-1 never sees user passwords (IdP handles login)
- SAP still uses a shared service account unless you also configure BTP Destination principal propagation / per-user destination exchange
- If your environment has clock drift between the IdP and ARC-1 server, set `SAP_OIDC_CLOCK_TOLERANCE` (in seconds) to allow a grace period on token `exp`/`nbf` checks

## References

- [MCP Specification - Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) — OAuth 2.1 auth for MCP servers, including Protected Resource Metadata
- [RFC 9728 - OAuth Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728) — Auto-discovery of authorization servers
- [Microsoft Entra ID - App Registrations](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app) — Microsoft Entra app setup
- [AWS Cognito User Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html) — AWS IdP setup
- [Keycloak - Creating a Realm](https://www.keycloak.org/docs/latest/server_admin/#configuring-realms) — Open-source IdP setup

## Next Steps

→ [Principal Propagation Setup](principal-propagation-setup.md) — Per-user SAP authentication
