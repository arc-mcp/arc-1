# XSUAA OAuth for MCP-Native Clients

Use XSUAA for browser sign-in to ARC-1 on SAP BTP Cloud Foundry.
If the repository MTA is already deployed, start at [role assignment](#step-3-assign-role-collections).
For a first deployment, follow [BTP: Start Here](btp-overview.md).

## Overview

<a id="architecture"></a>

The client discovers ARC-1's OAuth endpoints, signs in through XSUAA and sends the resulting bearer token to the MCP URL.
XSUAA roles grant ARC-1 scopes; [SAP identity is configured separately](enterprise-auth.md).

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

The base descriptor defines scopes and role templates. The MTA additionally creates the seven
[ARC-1 role collections](authorization.md#btp-xsuaa-role-templates), with the CF space suffix such as
`ARC-1 Viewer (dev)`. Manual `cf create-service` / `cf update-service` commands do not create those MTA collections.

For a manually managed service, its owner must create the needed collections with roles from the
current application identifier. For an existing deployment, compare `xsappname`, collections and route
before changing them; preserve user assignments and the [DCR signing key](#stable-dcr-signing-key-recommended).

Start with Viewer for source reads. Developer includes `write`, `transports` and `git`; each still
requires the matching server flags. For code writes without CTS/Git, define a role with `read` + `write`.

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
2. Find the shipped collection for your space — the names carry the space suffix, e.g. "ARC-1 Viewer (<space>)", "ARC-1 Developer (<space>)", … "ARC-1 Admin (<space>)".
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

Use the remote-server instructions in [Install in Claude](install-in-claude.md), with the selected
MCP URL above. The client discovers the OAuth endpoints and prompts for XSUAA sign-in.

### Cursor

Add the selected URL as a remote server using [Cursor's MCP configuration](https://cursor.com/docs/context/mcp).
Complete the OAuth sign-in, then run a safe SAP read.

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

Copilot Studio's `https://global.consent.azure-apim.net/redirect/*` pattern is in the shipped
`xs-security.json`. ARC-1 registers accepted redirect URIs for the SDK's exact-match checks.

## Stateless DCR

Dynamic Client Registration (DCR) issues signed `client_id` values that contain their registration.
They survive restarts and deployment changes **while the effective signing key remains the same**.

| Setting or event | Effect |
|---|---|
| `ARC1_DCR_SIGNING_SECRET` set | Dedicated DCR signing key |
| Secret unset | XSUAA `clientsecret` signs registrations |
| `ARC1_OAUTH_DCR_TTL_SECONDS=0` (default) | Registrations do not expire |
| Positive TTL | Expiry after the configured lifetime, clamped to 60 seconds–90 days |
| Effective signing key changes | All registrations must be created again |

There is no per-client DCR revocation. OAuth endpoints have [HTTP rate limits](rate-limiting.md).

### Stable DCR signing key (recommended)

An MTA redeploy can recreate the XSUAA binding and rotate its `clientsecret`.
Set a dedicated signing secret once so that binding rotation does not invalidate MCP registrations:

```bash
ARC1_DCR_SECRET=$(openssl rand -base64 48)
cf set-env arc1-mcp-server ARC1_DCR_SIGNING_SECRET "$ARC1_DCR_SECRET"
cf restage arc1-mcp-server
```

Keep this secret outside the MTAR and source-controlled descriptors. Preserve it in the deployment's secret management.
An undeclared `cf set-env` value normally survives MTA deployment; declaring the same property in a descriptor can override it.

Check the startup `dcrSigningSource`: `override` means the dedicated key is active; `xsuaa` means fallback.
Rotating the dedicated key intentionally revokes every DCR registration. Empty/whitespace values fall back with a warning;
keys shorter than 16 bytes also warn. A secret configured without `SAP_XSUAA_AUTH=true` is unused and warns.

### Service-binding rotation

Rotate a manually owned binding through its owner-approved procedure:

```bash
cf unbind-service arc1-mcp-server arc1-xsuaa
cf bind-service arc1-mcp-server arc1-xsuaa
cf restage arc1-mcp-server
```

For MTA-owned bindings, use the normal MTA lifecycle. With a dedicated DCR key, registrations stay valid.
With `dcrSigningSource: xsuaa`, a changed binding secret invalidates them. Either case can still require a fresh upstream OAuth login.

### Recovering a stuck client

| Error | What to refresh |
|---|---|
| `invalid_token` | Re-authenticate to replace the expired or rejected access token |
| `invalid_client` / `Invalid client_id` | Re-register the OAuth client after checking the signing source and TTL |

A restart may reuse cached credentials. Use the client's re-authentication controls first; registration cleanup may be needed for `invalid_client`.

#### Eclipse GitHub Copilot

For an expired token, quit and reopen Eclipse to trigger sign-in.
For stale registration, quit Eclipse and back up its MCP login database before removing it:

```bash
mv ~/.config/github-copilot/copilot-eclipse.db ~/.config/github-copilot/copilot-eclipse.db.backup
```

On Windows the file is under `$env:LOCALAPPDATA\github-copilot\copilot-eclipse.db`.
For Citrix/VDI, resolve `$env:LOCALAPPDATA` in the user's session; the profile may be redirected.
Reopen Eclipse and sign in to each MCP server again. This affects cached MCP logins, not code or Eclipse preferences.

#### Cursor

Cursor also caches its registration and may not re-register on `invalid_client`. Reset it by **removing the MCP server entry, restarting Cursor, then re-adding it**. A stable signing key prevents redeploys from causing this repeatedly.

#### VS Code

VS Code stores DCR registrations by OAuth issuer. Restarting the server or renaming it in `mcp.json` may leave the stale registration intact:

1. Command Palette (`Ctrl`/`Cmd`+`Shift`+`P`) → **"Authentication: Remove Dynamic Authentication Providers"**.
2. Tick the ARC-1 entry — there may be **several** stale ones; remove them all, then **OK**.
3. **Restart Server** (the `arc-1-…` entry's actions menu) → trigger any tool → VS Code registers a fresh `client_id` and prompts you to sign in again.

See [Manage MCP servers in VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers) for the Accounts-menu auth controls; the stale-credential cleanup is tracked in [microsoft/vscode#269379](https://github.com/microsoft/vscode/issues/269379).

### Browser-based DCR clients (rare)

Browser applications calling `/register` or `/authorize` across origins need an explicit
`ARC1_ALLOWED_ORIGINS` entry. Native HTTP clients do not need CORS.
See [CORS setup](security-guide.md#cors-for-browser-based-mcp-clients-opt-in).

### Audit events

Use `oauth_client_registered`, `oauth_client_lookup_failed` and `oauth_redirect_uri_registered`
to diagnose registration changes. Lookup failures include `unknown_prefix`, `malformed`, `bad_signature`,
`invalid_payload` or `expired`. See [audit fields](security-guide.md#what-gets-logged).

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

A BTP application can exchange its signed-in user's JWT for an ARC-1 token, avoiding a second browser login.
This requires a caller in the same subaccount and ARC-1 role collections for that user.

That is a `jwt-bearer` token exchange: the caller trades its user's JWT for one audienced to ARC-1.
The relevant `xs-security.json` setting is:

```json
{
  "oauth2-configuration": {
    "grant-types": ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"]
  }
}
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
Authorization: Basic <base64(clientid:clientsecret)>
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<the user's JWT>
```

The returned token is audienced to `arc1-mcp!t…` and carries **only the scopes that user's ARC-1
role collections grant** (Step 3) — the exchange propagates identity, it never widens authorization.
Present it as `Authorization: Bearer …` on `/mcp`.

x509 works too: create the key with `-c '{"credential-type":"x509"}'` and exchange against the
`certurl` host over mTLS. No `credential-types` declaration is needed in `xs-security.json`.

`client_credentials` is not enabled: this path requires a human user. Cross-subaccount exchange is unsupported
(`Unable to map issuer`). Exchanging a token does not grant additional scopes.
See [SAP's jwt-bearer walkthrough](https://community.sap.com/t5/technology-blog-posts-by-sap/how-grant-types-keep-your-application-secure-exercise-3/ba-p/13525513).

## Configuration Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `SAP_XSUAA_AUTH` | Enable XSUAA OAuth proxy | `false` |

XSUAA credentials are automatically loaded from `VCAP_SERVICES` when the service is bound. No manual credential configuration is needed.

## How Auth Coexistence Works

The single-target verifier tries configured XSUAA, OIDC and API-key methods in order.
The first valid identity wins. With PP, explicit `SAP_PP_STRICT=true` rejects non-JWT tool calls;
`false` permits API keys to use the shared SAP identity. JWT PP errors always fail closed.
See [authentication combinations](enterprise-auth.md#coexistence-matrix).

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
| Email is assigned but login uses another IdP origin | IAM owner: use the [role-assignment steps](#step-3-assign-role-collections) to match the application login identity. Platform CLI/cockpit access does not establish application access. |
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
