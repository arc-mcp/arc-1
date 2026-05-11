# XSUAA OAuth for MCP-Native Clients

This guide sets up BTP XSUAA authentication so MCP-native clients (Claude Desktop, Cursor, VS Code, MCP Inspector) can authenticate via OAuth when connecting to ARC-1.

## Overview

MCP-native clients use RFC 8414 OAuth discovery to find authorization endpoints at the MCP server's URL. ARC-1 proxies the OAuth flow to XSUAA using the MCP SDK's `ProxyOAuthServerProvider`.

**Auth flow:**
1. Client discovers OAuth via `/.well-known/oauth-authorization-server`
2. Client redirects user to ARC-1's `/authorize` endpoint
3. ARC-1 proxies to XSUAA's login page
4. After login, XSUAA returns authorization code
5. Client exchanges code for token via ARC-1's `/token` endpoint
6. Client sends Bearer token with MCP requests

**Coexistence:** XSUAA OAuth coexists with API key and Entra ID OIDC auth. All three methods work on the same `/mcp` endpoint via a chained token verifier.

## Prerequisites

- SAP BTP Cloud Foundry account with XSUAA entitlement
- CF CLI installed and logged in
- ARC-1 deployed on BTP CF (see [BTP Cloud Foundry deployment](phase4-btp-deployment.md))

## Step 1: Create XSUAA Service Instance

The `xs-security.json` file defines scopes, roles, and OAuth configuration:

```bash
cf create-service xsuaa application arc1-xsuaa -c xs-security.json
```

The included `xs-security.json` defines 7 scopes:

| Scope          | Description                                                    | Gates                                                                                        |
|----------------|----------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| `read`         | Read SAP objects, search, navigate, lint, diagnose             | `SAPRead`, `SAPSearch`, `SAPNavigate`, `SAPContext`, `SAPLint`, `SAPDiagnose`, SAPManage/SAPTransport/SAPGit read actions |
| `write`        | Create / update / delete / activate ABAP objects               | `SAPWrite`, `SAPActivate`, `SAPManage` package + FLP mutations                               |
| `data`         | Preview named table contents                                   | `SAPRead(type=TABLE_CONTENTS)`                                                               |
| `sql`          | Execute freestyle SQL queries                                  | `SAPQuery`                                                                                   |
| `transports`   | Create / release / delete CTS transports                       | `SAPTransport.create`/`release`/`delete`                                                     |
| `git`          | Push / pull / commit via abapGit / gCTS                        | `SAPGit.clone`/`pull`/`push`/`commit`                                                        |
| `admin`        | Implies ALL other scopes at runtime                            | Everything                                                                                   |

And 7 pre-defined role collections (assignable to users in BTP Cockpit):

| Role Collection           | Scopes                                                   | Use Case                                  |
|---------------------------|----------------------------------------------------------|-------------------------------------------|
| ARC-1 Viewer              | `read`                                                   | Read-only SAP access                      |
| ARC-1 Developer           | `read`, `write`, `transports`, `git`                     | Full developer (write + CTS + Git)        |
| ARC-1 Data Viewer         | `read`, `data`                                           | Read-only + table preview                 |
| ARC-1 Viewer + SQL        | `read`, `data`, `sql`                                    | Read-only + table preview + freestyle SQL |
| ARC-1 Developer + Data    | `read`, `write`, `data`, `transports`, `git`             | Developer + data preview                  |
| ARC-1 Developer + SQL     | `read`, `write`, `data`, `sql`, `transports`, `git`      | Developer + data + freestyle SQL          |
| ARC-1 Admin               | all 7                                                    | Administrative access                     |

**Want a restricted developer** (can write code but cannot transport or push to Git)? Define your own role template in `xs-security.json` with just `[read, write]` scopes, redeploy, and assign it — or use `SAP_DENY_ACTIONS` on the server.

Role collections are only the user-permission gate. Server flags still have to allow the capability: for example, a user in `ARC-1 Developer` still cannot create transports unless the ARC-1 instance also has `SAP_ALLOW_WRITES=true` and `SAP_ALLOW_TRANSPORT_WRITES=true`.

See [authorization.md](authorization.md) for the full three-layer authorization model.

## Step 2: Bind Service and Configure

```bash
# Bind XSUAA to your app
cf bind-service arc1-mcp-server arc1-xsuaa

# Enable XSUAA auth
cf set-env arc1-mcp-server SAP_XSUAA_AUTH true

# Restage to pick up changes
cf restage arc1-mcp-server
```

Verify XSUAA is active in the logs:

```bash
cf logs arc1-mcp-server --recent | grep XSUAA
# Should show:
# INFO: XSUAA credentials loaded {"xsappname":"arc1-mcp!t..."}
# INFO: XSUAA OAuth proxy enabled {"xsappname":"arc1-mcp!t..."}
# INFO: ARC-1 HTTP server started {"auth":"XSUAA OAuth proxy"}
```

## Step 3: Assign Role Collections

1. Open **BTP Cockpit** → **Security** → **Role Collections**
2. Find one of the shipped collections: "ARC-1 Viewer", "ARC-1 Developer", "ARC-1 Developer + Data", "ARC-1 Developer + SQL", "ARC-1 Data Viewer", "ARC-1 Viewer + SQL", or "ARC-1 Admin"
3. Click the role collection → **Edit** → **Users** tab
4. Add your BTP user (email address)
5. Save

## Step 4: Verify OAuth Discovery

```bash
curl -s https://arc1-mcp-server.cfapps.us10-001.hana.ondemand.com/.well-known/oauth-authorization-server | jq .
```

Expected response:
```json
{
  "issuer": "https://arc1-mcp-server.cfapps.us10-001.hana.ondemand.com/",
  "authorization_endpoint": "https://arc1-mcp-server.cfapps.us10-001.hana.ondemand.com/authorize",
  "token_endpoint": "https://arc1-mcp-server.cfapps.us10-001.hana.ondemand.com/token",
  "scopes_supported": ["read", "write", "data", "sql", "transports", "git", "admin"],
  "response_types_supported": ["code"],
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code", "refresh_token"]
}
```

## Step 5: Configure MCP Clients

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "arc1-sap": {
      "url": "https://arc1-mcp-server.cfapps.us10-001.hana.ondemand.com/mcp"
    }
  }
}
```

Claude Desktop will automatically discover OAuth via `/.well-known/oauth-authorization-server` and prompt for login.

### Cursor

In Cursor settings → MCP Servers, add:

```json
{
  "arc1-sap": {
    "url": "https://arc1-mcp-server.cfapps.us10-001.hana.ondemand.com/mcp"
  }
}
```

### MCP Inspector

Connect to:
```
https://arc1-mcp-server.cfapps.us10-001.hana.ondemand.com/mcp
```

The inspector will perform OAuth discovery and redirect to XSUAA login.

**Note:** MCP Inspector may use `http://127.0.0.1:6274` as its callback URL. ARC-1 automatically rewrites this to `http://localhost:6274` because XSUAA only allows `http://localhost` for redirect URIs, never `http://127.0.0.1`.

### Copilot Studio (Manual OAuth — recommended)

Copilot Studio does not re-register via DCR after server restarts, so use **Manual** OAuth mode instead of Dynamic Discovery.

1. In Copilot Studio, add an MCP server connection
2. Select **Manual** OAuth type
3. Fill in:
   - **Client ID:** XSUAA `clientid` from `cf env <app-name>` (e.g. `sb-arc1-mcp!t627062`)
   - **Client secret:** XSUAA `clientsecret` from `cf env <app-name>`
   - **Authorization URL:** `https://<app-route>/authorize`
   - **Token URL template:** `https://<app-route>/token`
   - **Refresh URL:** `https://<app-route>/token`
   - **Scopes:** `read write` (ARC-1 auto-qualifies these with the XSUAA xsappname prefix)
4. Save — Copilot Studio generates a redirect URL
5. ARC-1 automatically accepts the redirect URL (dynamic redirect URI registration for the XSUAA client)

**Why Manual mode:** Manual mode pins the connection to the permanent XSUAA service-binding `clientid`, which sidesteps DCR entirely. Dynamic Discovery (DCR) also works — `client_id`s are now stateless and survive `cf restart`/`cf push`/cell evacuation (see [Stateless DCR](#stateless-dcr) below) — but Copilot Studio adds a `/register` round-trip on first connect that some configurations don't retry cleanly. Manual mode is the more predictable path.

**Redirect URI:** Copilot Studio uses `https://global.consent.azure-apim.net/redirect/*` — this pattern is already in `xs-security.json`. ARC-1's dynamic redirect URI registration handles the MCP SDK's exact-match requirement automatically.

## Stateless DCR

ARC-1 implements RFC 7591 Dynamic Client Registration (DCR) with a **stateless** design: each issued `client_id` is an HMAC-signed token that carries its own registration payload (redirect URIs, grant types, etc.). The signing key is derived from the XSUAA `clientsecret`, so any process with the same service binding can validate any `client_id` ever issued — **no shared store or persistent state is needed**.

This means:

- DCR registrations survive `cf restart`, `cf push`, `cf restage`, cell evacuations, OOM auto-recovery, and multi-instance scale-out — none of these invalidate cached `client_id`s.
- The default lifetime is **30 days** (matches typical OAuth refresh-token lifetimes). Configurable via `--oauth-dcr-ttl-seconds` / `ARC1_OAUTH_DCR_TTL_SECONDS` (positive values clamped to `[60s, 90d]`). Set to `0` (or any non-positive value) to disable expiration entirely — recommended when MCP clients in use don't auto-re-register on `invalid_client` (Copilot CLI, Cursor) and a finite TTL would just produce periodic outages without security gain.
- Per-client revocation is intentionally not supported. Forced revocation goes through full key rotation (see below) — either rotate the DCR signing key, rebind the XSUAA service, or bump `KDF_LABEL` in `stateless-client-store.ts` (`arc1-dcr/v1` → `v2`).

### Stable DCR signing key (recommended)

By default, the DCR signing key derives from the XSUAA `clientsecret`. This is convenient (no secret to manage) but has a subtle side effect: **`cf deploy` of an MTA recreates the XSUAA service binding, which rotates the `clientsecret` and therefore invalidates every cached `client_id`**. Users see `invalid_client` after every redeploy and must re-register their MCP client.

To decouple the two and survive redeploys, set a dedicated signing secret:

```bash
SECRET=$(openssl rand -base64 48)
cf set-env arc1-mcp-server ARC1_DCR_SIGNING_SECRET "$SECRET"
cf restage arc1-mcp-server
```

ARC-1 emits a `[warn]` to stderr if `ARC1_DCR_SIGNING_SECRET` is set without `SAP_XSUAA_AUTH=true` — the secret is only consumed by the XSUAA OAuth proxy path, so this surfaces a misconfiguration where the secret would otherwise be unused.

Properties:
- `cf set-env` env vars survive `cf deploy` (CF doesn't reset them, and MTA only touches env vars declared in `mta.yaml` properties)
- Re-setting the value (`cf set-env` with a new secret + `cf restage`) is the explicit revocation knob — invalidates every `client_id` issued under the old secret
- Falls back to the XSUAA `clientsecret` when unset, preserving the legacy behavior
- Empty or whitespace-only values are treated as unset (with a `[warn]`), so a misconfigured env var won't crash startup
- A signing secret shorter than 16 bytes (128 bits) triggers a soft warning at startup; use `openssl rand -base64 48` for the recommended ≥32 bytes

ARC-1 logs the active signing source as `dcrSigningSource: 'env' | 'xsuaa'` in the startup INFO line for observability — `'env'` means the dedicated `ARC1_DCR_SIGNING_SECRET` is in use, `'xsuaa'` means the legacy `clientsecret` fallback.

### Service-binding rotation

The XSUAA `clientsecret` is the trust anchor for both upstream OAuth calls and the DCR signing key. Rotating the binding is the only way to force-revoke every outstanding DCR registration in one shot:

```bash
cf unbind-service arc1-mcp-server arc1-xsuaa
cf bind-service   arc1-mcp-server arc1-xsuaa
cf restage        arc1-mcp-server
```

After this sequence:

- Every previously-issued DCR `client_id` returns `400 invalid_client`.
- In-flight refresh tokens fail because the local DCR `client_id` lookup at `/token` no longer resolves.
- MCP clients silently re-register on next connect via `/register`.

This is the only operation that invalidates DCR state. Routine restarts (`cf restart`, `cf push` without rebind, cell moves) no longer disrupt clients.

### Browser-based DCR clients (rare)

The four MCP clients in the section above (Claude Desktop, Cursor, MCP Inspector, Copilot Studio) all run as native processes — they call `/register` and `/authorize` over native HTTP, not the browser `fetch` API, and never trigger CORS. If a browser-based MCP client (custom playground, embedded widget) calls these OAuth endpoints from a different origin, you must add that origin to `ARC1_ALLOWED_ORIGINS`. See [Security headers & CORS](security-guide.md#cors-for-browser-based-mcp-clients-opt-in) for the full configuration.

### Audit events

DCR lifecycle is captured in the audit stream alongside tool calls. Three event types fire:

- `oauth_client_registered` — `info`: a new `client_id` was minted; payload includes the issued id, client name, redirect-URI count, and id length (for tracking URL-budget regressions).
- `oauth_client_lookup_failed` — `warn` (or `info` for `expired`): a `client_id` failed to resolve; `reason` is one of `unknown_prefix` / `malformed` / `bad_signature` / `invalid_payload` / `expired`. Useful for spotting forgery / probing attempts.
- `oauth_redirect_uri_registered` — `info`: a redirect URI was added at `/authorize` time to the pre-registered XSUAA default client. Records what XSUAA's wildcard validator already accepted, so the local SDK-side change is auditable.

Events flow through the existing audit sinks (stderr / file / BTP Audit Log Service) — same pipeline used for tool-call audit.

## Updating xs-security.json

If you need to add redirect URIs or change scopes:

```bash
# Edit xs-security.json
# Then update the service:
cf update-service arc1-xsuaa -c xs-security.json

# Restage the app to pick up changes:
cf restage arc1-mcp-server
```

## Configuration Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `SAP_XSUAA_AUTH` | Enable XSUAA OAuth proxy | `false` |

XSUAA credentials are automatically loaded from `VCAP_SERVICES` when the service is bound. No manual credential configuration is needed.

## How Auth Coexistence Works

When XSUAA auth is enabled, the chained token verifier tries three methods in order:

1. **XSUAA JWT** — validated by `@sap/xssec` against XSUAA JWKS (offline, cached)
2. **Entra ID JWT** — validated by `jose` against OIDC issuer JWKS (if `SAP_OIDC_ISSUER` is set)
3. **API Key** — simple string match against `ARC1_API_KEYS` entries

The first successful validation wins. This means:
- MCP-native clients (Claude Desktop, Cursor, MCP Inspector) use XSUAA OAuth via auto-discovery
- Copilot Studio uses XSUAA OAuth via Manual mode (or Entra ID OIDC if configured separately)
- API key auth continues to work for testing and Joule Studio

## Troubleshooting

### "AADSTS50011: Redirect URI mismatch"
The redirect URI used by the MCP client isn't in `xs-security.json`. Add the URI pattern:
```json
"redirect-uris": [
  "http://localhost:*/**",
  "https://*.cfapps.us10-001.hana.ondemand.com/**"
]
```
Then run `cf update-service arc1-xsuaa -c xs-security.json`.

### "Token has no expiration time"
API key tokens now include a synthetic expiration (1 year). If you see this error, ensure you're running the latest version of ARC-1.

### "XSUAA credentials not found"
Ensure the XSUAA service is bound: `cf services` should show `arc1-xsuaa` bound to your app. If not: `cf bind-service arc1-mcp-server arc1-xsuaa && cf restage arc1-mcp-server`.

### "Insufficient scope" / "invalid_scope"
The user doesn't have the required role collection assigned. Go to BTP Cockpit → Security → Role Collections and assign the appropriate collection to the user.

**IdP matters:** If the subaccount has a custom IAS tenant (trust configuration shows `sap.custom`), role collections must be assigned with the correct IdP origin. Assigning via `sap.default` when the user logs in via `sap.custom` will result in `invalid_scope`.

### "Invalid client_id" (Copilot Studio)
DCR registrations are in-memory and lost on restart. Switch to **Manual** OAuth mode (see above) to avoid this.

### "Token validation failed: not a valid XSUAA, OIDC, or API key token" (Copilot Studio)
Copilot Studio caches the access token from the initial sign-in. XSUAA tokens expire after 1 hour and Copilot Studio does not always refresh them automatically — the connector keeps sending the expired token, which ARC-1 correctly rejects.

Fix: re-authenticate the connection. In your bot, open **Test** → **Connections** → ⋮ next to the ARC-1 connection → **Authenticate**, or delete and re-add the connection from the connector page.

### OAuth flow hangs or returns 400
Check that the XSUAA client ID matches. Run `cf env <app-name>` and look for the `clientid` in the XSUAA binding credentials.

### "Authorization Request Error" / XSUAA login fails
If using MCP Inspector with `http://127.0.0.1:6274`, XSUAA rejects the redirect URI (only `http://localhost` is allowed). ARC-1 handles this automatically by rewriting `127.0.0.1` → `localhost`.

## Architecture

```
MCP Client (Claude Desktop, Cursor, MCP Inspector)
  │
  ├── GET /.well-known/oauth-authorization-server  ──→  OAuth metadata
  ├── GET /authorize?client_id=...&redirect_uri=... ──→  Proxied to XSUAA login
  ├── POST /token (authorization_code exchange)     ──→  Proxied to XSUAA token endpoint
  │
  └── POST /mcp (Bearer token)
        │
        ├── requireBearerAuth middleware
        │     └── Chained verifier: XSUAA → OIDC → API key
        │
        └── MCP Server (per-request)
              └── ADT Client → SAP System
```
