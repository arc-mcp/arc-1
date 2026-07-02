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

**Coexistence:** XSUAA OAuth coexists with API key and generic OIDC auth (for example Entra ID, Okta, or Keycloak). All configured methods work on the same `/mcp` endpoint via a chained token verifier.

## Prerequisites

- SAP BTP Cloud Foundry account with XSUAA entitlement
- CF CLI installed and logged in
- ARC-1 deployed on BTP CF (see [BTP Cloud Foundry deployment](btp-cloud-foundry-deployment.md))

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

And 7 pre-defined role collections (defined in `mta.yaml`, assignable to users in BTP Cockpit):

| Role Collection           | Scopes                                                   | Use Case                                  |
|---------------------------|----------------------------------------------------------|-------------------------------------------|
| ARC-1 Viewer              | `read`                                                   | Read-only SAP access                      |
| ARC-1 Developer           | `read`, `write`, `transports`, `git`                     | Full developer (write + CTS + Git)        |
| ARC-1 Data Viewer         | `read`, `data`                                           | Read-only + table preview                 |
| ARC-1 Viewer + SQL        | `read`, `data`, `sql`                                    | Read-only + table preview + freestyle SQL |
| ARC-1 Developer + Data    | `read`, `write`, `data`, `transports`, `git`             | Developer + data preview                  |
| ARC-1 Developer + SQL     | `read`, `write`, `data`, `sql`, `transports`, `git`      | Developer + data + freestyle SQL          |
| ARC-1 Admin               | all 7                                                    | Administrative access                     |

> **Multi-space deployments.** `mta.yaml` derives the route host, the XSUAA
> `xsappname`, and these role-collection names from the deploy-time `${space}`
> placeholder, so the same mtar can be deployed into several spaces of one
> subaccount side by side. The collections therefore appear in the cockpit with
> the space appended — e.g. `ARC-1 Viewer (dev)` in space `dev`. Assign users to
> the collection for *your* space (Step 3).
>
> **Migrating an existing instance** onto per-space naming changes its route host
> and `xsappname`: update the MCP client URL, re-assign users to the new
> `ARC-1 … (<space>)` collections, and set `ARC1_DCR_SIGNING_SECRET` before the
> redeploy so cached OAuth `client_id`s survive the `xsappname` change.

**Want a restricted developer** (can write code but cannot transport or push to Git)? Define your own role template in `xs-security.json` with just `[read, write]` scopes, redeploy, and assign it — or use `SAP_DENY_ACTIONS` on the server.

Role collections are only the user-permission gate. Server flags still have to allow the capability: for example, a user in `ARC-1 Developer` still cannot create transports unless the ARC-1 instance also has `SAP_ALLOW_WRITES=true` and `SAP_ALLOW_TRANSPORT_WRITES=true`.

!!! note "Assign the least-privilege collection"
    `ARC-1 Developer` bundles `transports` + `git` — assigning it lets that user create/release CTS transports and push/pull via abapGit/gCTS (when the matching server flags are on). For reviewers, assign `ARC-1 Viewer` (read only); to grant code-write *without* transports/Git, use the `[read, write]`-only template above rather than reusing Developer.

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
# INFO: XSUAA credentials loaded {"xsappname":"arc1-mcp-<space>!t..."}
# INFO: XSUAA OAuth proxy enabled {"xsappname":"arc1-mcp-<space>!t..."}
# INFO: ARC-1 HTTP server started {"auth":"XSUAA OAuth proxy"}
```

## Step 3: Assign Role Collections

1. Open **BTP Cockpit** → **Security** → **Role Collections**
2. Find the shipped collection for your space — the names carry the space suffix, e.g. "ARC-1 Viewer (<space>)", "ARC-1 Developer (<space>)", … "ARC-1 Admin (<space>)" (see the multi-space note above)
3. Click the role collection → **Edit** → **Users** tab
4. Add your BTP user (email address)
5. Save

## Step 4: Verify OAuth Discovery

```bash
curl -s https://arc1-mcp-<space>.cfapps.us10-001.hana.ondemand.com/.well-known/oauth-authorization-server | jq .
```

Expected response:
```json
{
  "issuer": "https://arc1-mcp-<space>.cfapps.us10-001.hana.ondemand.com/",
  "authorization_endpoint": "https://arc1-mcp-<space>.cfapps.us10-001.hana.ondemand.com/authorize",
  "token_endpoint": "https://arc1-mcp-<space>.cfapps.us10-001.hana.ondemand.com/token",
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
      "url": "https://arc1-mcp-<space>.cfapps.us10-001.hana.ondemand.com/mcp"
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
    "url": "https://arc1-mcp-<space>.cfapps.us10-001.hana.ondemand.com/mcp"
  }
}
```

### MCP Inspector

Connect to:
```
https://arc1-mcp-<space>.cfapps.us10-001.hana.ondemand.com/mcp
```

The inspector will perform OAuth discovery and redirect to XSUAA login.

**Note:** MCP Inspector may use `http://127.0.0.1:6274` as its callback URL. ARC-1 automatically rewrites this to `http://localhost:6274` because XSUAA only allows `http://localhost` for redirect URIs, never `http://127.0.0.1`.

### Copilot Studio (Manual OAuth — recommended)

Copilot Studio does not re-register via DCR after server restarts, so use **Manual** OAuth mode instead of Dynamic Discovery.

1. In Copilot Studio, add an MCP server connection
2. Select **Manual** OAuth type
3. Fill in:
   - **Client ID:** XSUAA `clientid` from `cf env <app-name>` (e.g. `sb-arc1-mcp-<space>!t627062`)
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
- The default lifetime is **`0` — never expire**. There is no per-client revocation at any TTL (a `client_id` is a stateless HMAC token, not a store row), so a finite TTL only produces periodic `invalid_client` re-auth outages — and some MCP clients (Eclipse Copilot, Copilot CLI) don't self-heal from it. Configurable via `--oauth-dcr-ttl-seconds` / `ARC1_OAUTH_DCR_TTL_SECONDS`; set a positive value to opt into expiry (clamped to `[60s, 90d]`). Revocation is global, via signing-key rotation (below).
- Per-client revocation is intentionally not supported. Forced revocation goes through full key rotation (see below) — rotate the DCR signing key (`ARC1_DCR_SIGNING_SECRET`) or rebind the XSUAA service. (A deeper `KDF_LABEL` bump, `arc1-dcr/v1` → `v2`, also revokes everything, but it lives in the `@arc-mcp/xsuaa-auth` package now, not this repo.)
- `/register`, `/authorize`, `/token`, `/revoke` are per-IP rate-limited by default (`ARC1_AUTH_RATE_LIMIT=20`/min/IP). Closes CodeQL alert `js/missing-rate-limiting`. Tune via the env var or disable with `=0` if an upstream proxy already provides this. See the [Rate Limiting Guide](rate-limiting.md).

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

ARC-1 logs the active signing source as `dcrSigningSource: 'override' | 'xsuaa'` in the startup INFO line for observability — `'override'` means the dedicated `ARC1_DCR_SIGNING_SECRET` is in use, `'xsuaa'` means the legacy `clientsecret` fallback.

**Why this is best practice.** A `client_id` issued via [RFC 7591 Dynamic Client Registration](https://www.rfc-editor.org/rfc/rfc7591) is only as durable as the key that signs it — in ARC-1's stateless design the signing key *is* the registration store. Tying that key to a credential that rotates on deploy (the XSUAA `clientsecret`) turns every redeploy into an unintended key rotation — the same failure mode a web framework hits when its session-signing key (Django `SECRET_KEY`, Rails `secret_key_base`) is regenerated per release: all previously-signed artifacts silently become invalid. The fix is the standard one for any signing key — externalize it from the deploy artifact and keep it stable across releases ([12-Factor Config](https://12factor.net/config)), rotating only when you intend to ([OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)).

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

### Recovering a stuck client

After a client has been connected for a while it can fail with one of two errors. They look alike but invalidate **different things, so they have different fixes**:

| Error | What's stale | Cached token still works? | Fix |
|-------|--------------|---------------------------|-----|
| `invalid_token` / "not a valid XSUAA, OIDC, or API key token" | the **access token** | no — it expired | **restart the client** — a cold start re-runs auth |
| `invalid_client` / `Invalid client_id` | the **DCR registration** | usually yes — so tool calls keep working | **clear the cached registration** — a restart alone won't, because the client keeps using its still-valid token and never re-registers |

**Prevent both:** for `invalid_client`, set a stable [`ARC1_DCR_SIGNING_SECRET`](#stable-dcr-signing-key-recommended) + `ARC1_OAUTH_DCR_TTL_SECONDS=0` so a redeploy can't rotate the signing key. For `invalid_token`, the default `refresh-token-validity` in `xs-security.json` is **30 days**, so idle sessions survive far longer.

**Client behaviour varies.** Claude Desktop and MCP Inspector usually re-register on their own and rarely surface either error. **VS Code, Cursor, and Eclipse GitHub Copilot cache the DCR registration and can stay stuck on `invalid_client`** until you clear it — steps per client below. (Eclipse additionally has no per-server "restart MCP" / re-auth action yet — [copilot-for-eclipse#237](https://github.com/microsoft/copilot-for-eclipse/issues/237).)

#### Eclipse GitHub Copilot

**For `invalid_token`** (an expired or long-idle session — you're effectively logged out): **quit and reopen Eclipse**. On the cold start it re-runs the sign-in — its *"… wants to authenticate"* dialog appears — and you're back.

**For `invalid_client`** (the server's signing key rotated, e.g. an MTA `cf deploy`): **a restart usually won't help** — Copilot keeps using its still-valid access token and never re-registers, so the stale `client_id` only resurfaces on the next forced sign-in. You have to clear its cached registration so it calls `/register` again. **Quit Eclipse**, then delete its one cache file:

```bash
# macOS / Linux — clears cached MCP logins; you re-authorize each server once
rm ~/.config/github-copilot/copilot-eclipse.db
```
```powershell
# Windows (PowerShell)
Remove-Item "$env:LOCALAPPDATA\github-copilot\copilot-eclipse.db"
```

> **Citrix / VDI / roaming profiles:** `%LOCALAPPDATA%` is often *not* the literal `C:\Users\<you>\AppData\Local` — the profile is redirected into a container, so the file is there under a different path. Resolve the variable in-session instead of guessing (Eclipse closed):
> ```powershell
> Get-ChildItem $env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA -Recurse -Filter copilot-eclipse.db -Force -ErrorAction SilentlyContinue | Select FullName
> ```

Reopen Eclipse → use the server → it registers fresh and prompts you to sign in. Deleting the file is low-impact:

- ✅ The only cost: re-authorize your MCP server(s) once (a browser sign-in each).
- ❌ It does **not** sign you out of GitHub Copilot itself — that's a separate `auth.db`.
- ❌ It does **not** touch your code, workspaces, Eclipse preferences, or your MCP server list — only cached MCP auth.

> Want to keep your *other* MCP servers signed in? With the `sqlite3` CLI, delete only this server's rows (the cache is keyed by server URL):
> ```bash
> sqlite3 ~/.config/github-copilot/copilot-eclipse.db \
>   "DELETE FROM state WHERE key LIKE 'dynamicAuthProvider:%your-app.cfapps%';"
> ```

> Sanity check: a healthy ARC-1 `client_id` looks like `arc1-eyJ2Ijox…` (~280+ chars). A short `arc1-<8 hex>` id predates the stateless store and is always rejected — clear it the same way.

#### Cursor

Cursor also caches its registration and may not re-register on `invalid_client`. Reset it by **removing the MCP server entry, restarting Cursor, then re-adding it**. With the stable signing key set (above), you only ever do this once.

#### VS Code

VS Code caches the DCR registration in its **own secret storage, keyed by the OAuth issuer URL** — so for `invalid_client` (a rotated signing key) **signing out, _Restart Server_, and removing or renaming the server in `mcp.json` do _not_ clear it** (a sign-out drops the access token but keeps the registration; the issuer URL never changes). Clear the registration itself:

1. Command Palette (`Ctrl`/`Cmd`+`Shift`+`P`) → **"Authentication: Remove Dynamic Authentication Providers"**.
2. Tick the ARC-1 entry — there may be **several** stale ones; remove them all, then **OK**.
3. **Restart Server** (the `arc-1-…` entry's actions menu) → trigger any tool → VS Code registers a fresh `client_id` and prompts you to sign in again.

See [Manage MCP servers in VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers) for the Accounts-menu auth controls; the stale-credential cleanup is tracked in [microsoft/vscode#269379](https://github.com/microsoft/vscode/issues/269379).

> **Found an easier way to recover an Eclipse, VS Code, or Cursor MCP login?** MCP-client behavior is still evolving — please [open an issue or PR](https://github.com/arc-mcp/arc-1/issues/new) so these docs can capture the simplest known fix.

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
2. **Generic OIDC JWT** — validated by `jose` against OIDC issuer JWKS (if `SAP_OIDC_ISSUER` is set)
3. **API Key** — simple string match against `ARC1_API_KEYS` entries

The first successful validation wins. This means:
- MCP-native clients (Claude Desktop, Cursor, MCP Inspector) use XSUAA OAuth via auto-discovery
- Copilot Studio uses XSUAA OAuth via Manual mode (or generic OIDC, such as Entra ID, if configured separately)
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
