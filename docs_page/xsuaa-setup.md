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

<a id="step-1-create-xsuaa-service-instance"></a>

## Step 1: Identify the XSUAA lifecycle owner

**Deployed with the repository MTA?** It already creates/binds XSUAA and enables
`SAP_XSUAA_AUTH`. Do not create a second service or bind it again. Check `cf target`, then
`cf services` and `cf app <app-name>` in the intended space. Record the bound XSUAA instance and
its application identifier; inspect credentials locally only when needed and never paste them
into chat or a ticket. Continue to [Step 3](#step-3-assign-role-collections).

**Using a manually managed app or customer-owned service?** Agree on the owner first. The create
command below is only for a new, manually managed XSUAA instance. For an existing instance, inspect
it and agree on descriptor updates instead of recreating it. MTA and manual lifecycle changes must
not compete for ownership. See [configuration ownership](btp-administration.md#configuration-ownership).

### Manual path: create only when a new instance is intended

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
| `git`          | Authorize gated abapGit mutation/egress actions; gCTS mutations remain quarantined | `SAPGit.external_info`/`clone`/`pull`/`push`/branch/unlink actions after server gates          |
| `admin`        | Implies ALL other scopes at runtime                            | Everything                                                                                   |

The MTA additionally defines 7 role collections (assignable in BTP Cockpit). The manual
`create-service` command above reads only `xs-security.json`; it does not apply the collections in
`mta.yaml`. A manual owner must create the required collections and add the current application
roles before assigning users.

| Role Collection           | Scopes                                                   | Use Case                                  |
|---------------------------|----------------------------------------------------------|-------------------------------------------|
| ARC-1 Viewer              | `read`                                                   | Read-only SAP access                      |
| ARC-1 Developer           | `read`, `write`, `transports`, `git`                     | Full developer (write + CTS + Git)        |
| ARC-1 Data Viewer         | `read`, `data`                                           | Read-only + table preview                 |
| ARC-1 Viewer + SQL        | `read`, `data`, `sql`                                    | Read-only + table preview + freestyle SQL |
| ARC-1 Developer + Data    | `read`, `write`, `data`, `transports`, `git`             | Developer + data preview                  |
| ARC-1 Developer + SQL     | `read`, `write`, `data`, `sql`, `transports`, `git`      | Developer + data + freestyle SQL          |
| ARC-1 Admin               | all 7                                                    | Administrative access                     |

> **Multi-space deployments.** `mta.yaml` derives the XSUAA
> `xsappname` and these role-collection names from the deploy-time `${space}`
> placeholder, so the same mtar can be deployed into several spaces of one
> subaccount side by side. The collections therefore appear in the cockpit with
> the space appended — e.g. `ARC-1 Viewer (dev)` in space `dev`. Assign users to
> the collection for *your* space (Step 3). The route uses CF's generated default host unless
> overridden; read the actual route from `cf app <app-name>` instead of guessing it from the space.
>
> **Migrating an existing instance:** compare its current `xsappname`, collections and route
> with the reviewed deployment. Re-assign users if the collection/application identifier changes;
> update MCP client URLs only if the actual route changes. Preserve the
> [stable DCR signing key](#stable-dcr-signing-key-recommended) across redeployments.
>
> For a manually managed service, applying the base file with
> `cf update-service arc1-xsuaa -c xs-security.json` updates the scopes and role
> templates only. It does **not** create role collections declared in
> `mta.yaml`. Agree on lifecycle ownership before adopting the MTA, then
> verify in **Security → Role Collections** that all seven collections exist and
> contain the expected roles. This matters especially for older deployments:
> seeing `MCPViewer`, `MCPDataViewer`, or `MCPSqlUser` under **Roles** does not
> mean the corresponding assignable role collections already exist.

**Want a restricted developer** (can write code but cannot transport or push to Git)? Define your own role template in `xs-security.json` with just `[read, write]` scopes, redeploy, and assign it — or use `SAP_DENY_ACTIONS` on the server.

Role collections are only the user-permission gate. Server flags still have to allow the capability: for example, a user in `ARC-1 Developer` still cannot create transports unless the ARC-1 instance also has `SAP_ALLOW_WRITES=true` and `SAP_ALLOW_TRANSPORT_WRITES=true`.

!!! note "Assign the least-privilege collection"
    `ARC-1 Developer` bundles `transports` + `git` — assigning it authorizes CTS mutations and the
    gated abapGit mutation/egress family when the matching server flags are on. It does not make gCTS
    mutations available: those remain quarantined before HTTP. Some accepted abapGit mutations return
    incomplete when no authoritative postcondition exists. For reviewers, assign `ARC-1 Viewer` (read
    only); to grant code-write *without* transports/Git, use the `[read, write]`-only template above.

See [authorization.md](authorization.md) for the full three-layer authorization model.

<a id="step-2-bind-service-and-configure"></a>

## Step 2: Manual path — bind service and configure

Skip these changes for a completed repository MTA deployment. For a manually managed app, replace
the example app/service names with the reviewed names and confirm `cf target` before changing it.

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

**Assign before you hand out the MCP URL.** The assignment creates the shadow user, so it works for users who have never logged in — use the **Users** tab above, or:

```bash
btp assign security/role-collection "ARC-1 Viewer (<space>)" \
  --subaccount <subaccount-id> --to-user <email> --of-idp <origin-key>
```

Choose the least-privilege collection for the task (normally Viewer for source-read acceptance),
not Admin simply to make login work. Use the **application** identity-provider origin; a platform
CLI/cockpit login is not proof of the user's application assignment.

Assigning before first sign-in avoids one possible stale-session case. If a user signed in before
the grant, they may need **Role assigned? Refresh access** and a new MCP sign-in. Cookie deletion
is not a required setup step. First use the [`invalid_scope` decision table](#insufficient-scope-invalid_scope)
to distinguish an invalid requested scope from missing authorization or stale client state.

## Step 4: Verify OAuth Discovery

Read the route from `cf app <app-name>`; do not derive it from the space or copy another region's
hostname. If using a custom public URL, use that reviewed URL. Replace `<arc1-route>` in the client
examples below with this same host.

```bash
ARC1_URL="https://<arc1-route>"
curl -fsS "$ARC1_URL/.well-known/oauth-authorization-server" | jq .
```

Expected response:
```json
{
  "issuer": "https://<arc1-route>/",
  "authorization_endpoint": "https://<arc1-route>/authorize",
  "token_endpoint": "https://<arc1-route>/token",
  "scopes_supported": ["read", "write", "data", "sql", "transports", "git", "admin"],
  "response_types_supported": ["code"],
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code", "refresh_token"]
}
```

The example above is the single-target `/mcp` authorization surface. Select the endpoint before
configuring a client:

| Endpoint | Protected-resource scopes ARC-1 advertises | Notes |
|---|---|---|
| `/mcp` | `read`, `write`, `data`, `sql`, `transports`, `git`, `admin` | Actual grants and application ceilings still prune tools/actions |
| `/<SYSTEM>/<CLIENT>/mcp` | `read`, `data`, `sql`, `admin` | Mutation-free pinned multi-target route |
| `/multi/mcp` | `read`, `data`, `sql`, `admin` | Mutation-free aggregate route; SAP calls require `target` |

XSUAA returns only scopes assigned to the user. Advertising the full mutation-free set does not
grant Admin, data, or SQL. It lets OAuth clients request a usable token while role collections remain
the authorization source. Multi-target routes never advertise mutation scopes and still require
`read` before revealing whether a pinned target exists.

## Step 5: Configure MCP Clients

Use `/mcp` for a single target, a pinned `/<SYSTEM>/<CLIENT>/mcp` URL for a target-bound
conversation, or `/multi/mcp` when the model must select among several targets. Do not replace one
with another merely to recover an OAuth error: endpoint selection is part of the security and tool
contract. Multi-target client examples are also available in
[Multi-System Setup](multi-target-setup.md#vs-code-and-github-copilot-configuration).

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "arc1-sap": {
      "url": "https://<arc1-route>/mcp"
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
    "url": "https://<arc1-route>/mcp"
  }
}
```

### MCP Inspector

Connect to:
```
https://<arc1-route>/mcp
```

The inspector will perform OAuth discovery and redirect to XSUAA login.

**Note:** MCP Inspector may use `http://127.0.0.1:6274` as its callback URL. ARC-1 automatically rewrites this to `http://localhost:6274` because XSUAA only allows `http://localhost` for redirect URIs, never `http://127.0.0.1`.

### Copilot Studio (Manual OAuth — recommended)

Use **Manual** OAuth mode for the most predictable Copilot Studio interoperability. Ordinary ARC-1
restarts do not lose stateless DCR registrations; Manual mode is preferred because it avoids an
extra dynamic-registration round trip that some Copilot Studio configurations do not retry cleanly.

1. In Copilot Studio, add an MCP server connection
2. Select **Manual** OAuth type
3. Fill in:
   - **Client ID:** XSUAA `clientid` from `cf env <app-name>` (e.g. `sb-arc1-mcp-<space>!t627062`)
   - **Client secret:** XSUAA `clientsecret` from `cf env <app-name>`
   - **Authorization URL:** `https://<app-route>/authorize`
   - **Token URL template:** `https://<app-route>/token`
   - **Refresh URL:** `https://<app-route>/token`
   - **Scopes:** for single-target development, request the approved scopes (for example
     `read write`); for multi-target, request `read data sql admin` and let XSUAA return only the
     scopes assigned to the signed-in user. ARC-1 auto-qualifies names with the XSUAA xsappname.
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

The XSUAA `clientsecret` is always an upstream OAuth credential. It is also the DCR signing source
only while `ARC1_DCR_SIGNING_SECRET` is unset. In that fallback configuration, rebinding XSUAA
invalidates all DCR registrations. With the recommended dedicated signing secret, rebind/rotation
does **not** revoke DCR clients; rotate `ARC1_DCR_SIGNING_SECRET` deliberately for global DCR
revocation.

To rotate the XSUAA binding:

```bash
cf unbind-service arc1-mcp-server arc1-xsuaa
cf bind-service   arc1-mcp-server arc1-xsuaa
cf restage        arc1-mcp-server
```

After this sequence, the DCR effect depends on the active signing source:

- With `dcrSigningSource: 'xsuaa'`, every previously issued DCR `client_id` becomes invalid because
  the effective signing key changed. Clients must register again; cached access/refresh behavior is
  client- and token-lifetime-dependent.
- With `dcrSigningSource: 'override'`, local DCR registrations remain valid because the dedicated
  signing key did not change. Upstream XSUAA credential rotation can still require a fresh OAuth
  login, but it is not a DCR revocation event.

DCR state is globally invalidated whenever the **effective signing key** changes: rotate
`ARC1_DCR_SIGNING_SECRET` in dedicated-key deployments, or rotate/rebind the XSUAA credentials while
using the fallback. Routine restart, push without rebind, restage, and cell movement preserve DCR
state while that key remains stable.

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

For MTA-owned services, change the reviewed source descriptor/extension and follow the normal
MTA deployment procedure so its effective application name, roles and configuration stay aligned.
Do not replace MTA's merged configuration with the bare base file as a troubleshooting shortcut.

For a **manually managed** service, its owner can add approved redirect URIs or scopes and apply
the matching descriptor:

```bash
# Edit xs-security.json
# Then update the service:
cf update-service arc1-xsuaa -c xs-security.json

# Restage the app to pick up changes:
cf restage arc1-mcp-server
```

Existing bindings and service keys inherit `oauth2-configuration` changes — no rebind needed.

## Calling ARC-1 from another BTP application

The setup above covers a **human at an MCP client** (Claude, Cursor, Eclipse) logging in through the
browser. A different case is another BTP application — an AI assistant backend, a CAP service, a
Fiori app — that already has its users logged in via XSUAA and wants to call ARC-1 **as them**,
without sending them through a second OAuth login.

That is a `jwt-bearer` token exchange: the caller trades its user's JWT for one audienced to ARC-1.
`xs-security.json` enables it:

```json
"grant-types": ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"]
```

**The exchange runs against ARC-1's own OAuth client**, so the grant belongs in ARC-1's descriptor —
not the caller's. Create a service key on ARC-1's XSUAA instance and hand its credentials to the
consumer:

```bash
cf create-service-key arc1-xsuaa consumer-key
cf service-key arc1-xsuaa consumer-key       # → clientid, clientsecret, url
```

Issue a **separate key per consumer**. With the default `binding-secret` credential type each key
carries its own secret, distinct from the running app's binding — so a consumer's key can be rotated
or revoked without disturbing ARC-1 itself, and it never exposes the app's own credentials (which,
unless you set `ARC1_DCR_SIGNING_SECRET`, also sign the DCR `client_id`s — see
[Stable DCR signing key](#stable-dcr-signing-key-recommended)).

Then either let the Destination service do it (no code — recommended):

| Destination property | Value |
|---|---|
| `Authentication` | `OAuth2JWTBearer` |
| `URL` | `https://<arc1-host>/mcp` |
| `tokenServiceURL` | `<url from the service key>/oauth/token` |
| `clientId` / `clientSecret` | from the service key |

…or POST the exchange yourself:

```http
POST <xsuaa-url>/oauth/token
Authorization: Basic <arc1-clientid>:<arc1-clientsecret>
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<the user's JWT>
```

The returned token is audienced to `arc1-mcp!t…` and carries **only the scopes that user's ARC-1
role collections grant** (Step 3) — the exchange propagates identity, it never widens authorization.
Present it as `Authorization: Bearer …` on `/mcp`.

x509 works too: create the key with `-c '{"credential-type":"x509"}'` and exchange against the
`certurl` host over mTLS. No `credential-types` declaration is needed in `xs-security.json`.

SAP's own walkthrough of this flow — same shape, with a generic "Business Logic Application" where
ARC-1 sits — is [How grant-types keep your application secure, Exercise 3](https://community.sap.com/t5/technology-blog-posts-by-sap/how-grant-types-keep-your-application-secure-exercise-3/ba-p/13525513).
Note that `grant-types` itself is absent from SAP's documented `oauth2-configuration` property table;
it is real and broker-honored, just undocumented.

!!! warning "What this does not enable"
    - **No headless technical user.** `client_credentials` stays off the allowlist deliberately —
      there is no way to mint an ARC-1 token with no human behind it.
    - **Same subaccount only.** A caller in another subaccount fails with
      `Unable to map issuer` ([#434](https://github.com/arc-mcp/arc-1/issues/434)) — the issuer is
      not trusted there.
    - **Users still need role collections.** An exchanged token for a user with no ARC-1 collection
      authenticates but authorizes nothing.

The external [`arc-mcp/mcp-hub`](https://github.com/arc-mcp/mcp-hub) project uses a *different*
wiring — the hub exchanges with its
**own** client plus a `granted-apps` grant chain — because it fronts several backends. For a single
consumer, the service-key route above is simpler and needs no grant chain.

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
Identify the issuer reporting the mismatch. `AADSTS50011` is a Microsoft Entra error: the IAM
owner must compare the redirect URI and application ID in the error with the intended Entra
registration ([Microsoft troubleshooting](https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/error-code-aadsts50011-redirect-uri-mismatch)).
Changing ARC-1's XSUAA allowlist does not repair that upstream registration.

For a mismatch reported by XSUAA instead, review the intended URI in `xs-security.json` and follow
[Updating xs-security.json](#updating-xs-securityjson) for the MTA or manual lifecycle. Do not add
another region's wildcard or apply the bare base file to an MTA-owned instance as a shortcut.

### "Token has no expiration time"
API key tokens now include a synthetic expiration (1 year). If you see this error, ensure you're running the latest version of ARC-1.

### "XSUAA credentials not found"
Confirm `cf target` and inspect `cf services` for the intended binding. For MTA-owned resources,
review the deployment operation and descriptor with its owner. Use [manual binding](#step-2-bind-service-and-configure)
only for a manually managed app; do not attach a similarly named XSUAA instance just to clear the error.

### "Insufficient scope" / "invalid_scope"
`invalid_scope` is not a diagnosis by itself. OAuth permits it for unknown or malformed scopes as
well as scopes exceeding the grant ([RFC 6749](https://www.rfc-editor.org/rfc/rfc6749#section-4.1.2.1)).
Read the exact error description, selected endpoint and intended application identity before
changing roles or clearing state. Do not share full callback URLs, tokens or binding credentials.

| Evidence | Owner and next check |
|---|---|
| Scope name reported as invalid/unknown, e.g. an application-qualified `user_attributes` | Application/deployment owner: compare the request, endpoint metadata and effective XSUAA descriptor. Fix the unsupported scope/name qualification. Do not invent an application scope or grant Admin to suppress the error. |
| User is not allowed any requested scopes | IAM owner: check the required collection is assigned to the correct application identity and contains roles for the bound application identifier. An assignment alone does not prove those roles exist. |
| Collection exists but has no roles or references an old application identifier | IAM and deployment owners: inspect current role templates and collection contents; use the owner-safe repair below. |
| Email is assigned but login uses another IdP origin | IAM owner: use the [IdP-origin check and `--of-idp` example](authorization.md#i-have-two-marianexamplecom-users-in-btp-and-only-one-shows-the-role-i-changed) to match the application login identity. Platform CLI/cockpit access does not establish application access. |
| Correct current roles/origin are verified, but the browser session predates the change | User: try the application refresh action below, then start sign-in again from the MCP client. |
| Sign-in succeeds but old permissions/tools remain | User: obtain a fresh token through the client's re-authentication flow, then refresh/reload its tool catalog. Reconnecting alone may reuse a cached token. |

A fast callback or an absent login form is **not proof** of stale permissions: SSO can also return
a current grant failure without an interactive form. Preserve a sanitized error code and request
correlation for the owner instead of drawing conclusions from timing.

#### Refresh access after a verified assignment

After an administrator assigns a role collection, the browser can still hold an older XSUAA SSO
session. The failed ARC-1 sign-in page includes **Role assigned? Refresh access**. Use it after
checking the assignment, wait for **Access refreshed**, then return to the MCP client and retry
sign-in. A new identity-provider login may be required. This cannot repair an unknown scope name.

The action calls XSUAA's documented `/logout.do` endpoint with ARC-1's bound `client_id` and a fixed, allowlisted ARC-1 return URL. Callback query parameters never select the logout host or redirect. Standard Cloud Foundry routes are covered by the `https://*.hana.ondemand.com/**` entry in `xs-security.json`; if `ARC1_PUBLIC_URL` uses a custom domain or path, add its `/oauth/logged-out` URL to `oauth2-configuration.redirect-uris` before deploying.

The action ends the XSUAA browser SSO session; it does not revoke already issued access tokens or
necessarily sign out the upstream IdP. Use the MCP client's re-authentication flow if it retains an
old token, then refresh its tool catalog. On older ARC-1 versions without the action, a fresh private
browser session is a useful comparison. Only if necessary, clear site data for the verified XSUAA
domain—not all browser cookies. Read that domain from the intended binding locally, without
copying its credentials into a support request.

Do not use a bare `<xsuaa-url>/logout` or `/logout.do` URL. XSUAA requires the application client and an allowlisted return URL for a reliable application logout.

#### Repair missing or stale collection roles with the owner

In **Security → Role Collections → the intended collection → Roles**, compare the role template
and application identifier with the currently bound XSUAA application. For example, a Viewer
collection needs `MCPViewer` from that application, not a similarly named old instance. Roles and
collections are different objects; templates existing under **Roles** is insufficient evidence.

Service replacement can leave stale references. Before repair, record the collection's roles,
user/group assignments, IdP mappings and lifecycle owner. Have that owner reconcile the current
roles through the approved MTA/IAM process and verify a fresh user grant. Do not delete/recreate
collections or XSUAA as a generic login fix: that can disrupt other users and lose assignments or
mappings. A redeploy alone is not proof that existing collections were repaired.
For the exceptional, owner-approved replacement of a verified orphaned collection, see
[Role and user administration](btp-administration.md#role-and-user-administration).

### "Invalid client_id" (Copilot Studio)
DCR registrations are stateless and survive ordinary restart, push, restage, and scale-out while the
signing key stays stable. Check the startup `dcrSigningSource`, restore the intended
`ARC1_DCR_SIGNING_SECRET`, or re-register the client after an intentional key/binding rotation.
Manual OAuth remains the more predictable Copilot Studio path because it avoids the dynamic
registration round trip, not because ARC-1 stores registrations in memory.

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
