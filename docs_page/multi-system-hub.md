# Multi-System Hub (mcp-hub)

ARC-1 is **one instance per SAP system** — that is architectural (each instance authenticates against
one system and propagates identity into it). When you run ARC-1 against several systems
(DEV / QA / PROD, or 2023 / 2025 / NetWeaver), [`arc-mcp-hub`](https://github.com/arc-mcp/mcp-hub)
puts all of them behind **one URL and one login**, with path-scoped routing so cross-system mistakes
are structurally impossible.

```
                        one login
  MCP client  ───────────────────────────►  arc-mcp-hub  (one BTP app)
  (VS Code / Claude / Cursor / Copilot)        │  /dev/mcp  ─► ARC-1 (DEV)   ─► SAP DEV
                                               │  /qa/mcp   ─► ARC-1 (QA)    ─► SAP QA
                                               │  /prod/mcp ─► ARC-1 (PROD)  ─► SAP PROD
```

You connect your MCP client to `https://<hub>/dev/mcp` (or `/qa/mcp`, …). The hub validates your login,
exchanges it for a per-user token scoped to that system's ARC-1, and transparently relays the MCP
connection. Each system's tools come through unchanged, and **SAP still sees the real you** — the hub
adds no shared service account and no LLM in the path.

!!! info "The hub is a separate, open-source app — not part of the ARC-1 npm/Docker package"
    It lives at [github.com/arc-mcp/mcp-hub](https://github.com/arc-mcp/mcp-hub) and is deployed as its
    own BTP Cloud Foundry app **in the same subaccount** as your ARC-1 instances. This page is the
    overview + setup + troubleshooting; the repo holds the canonical
    [operator setup](https://github.com/arc-mcp/mcp-hub/blob/main/docs/operator-setup.md),
    [architecture](https://github.com/arc-mcp/mcp-hub/blob/main/docs/architecture.md), and a guide to
    [fronting a non-ARC-1 MCP server](https://github.com/arc-mcp/mcp-hub/blob/main/docs/integrating-an-mcp-server.md).

## Why use it

- You run **ARC-1 against several SAP systems** and want one endpoint host + one login instead of N
  separately-configured servers in every MCP client.
- You want **per-user SAP identity** preserved end-to-end (principal propagation), per system.
- **Token efficiency** — with the optional [`/all` endpoint](#one-endpoint-for-every-system) the client
  sees a single tool set plus a `system` parameter, instead of N× the tool definitions. On a landscape
  with many systems this is a large prompt-token saving.
- You want to front **other SAP MCP servers** too, not only ARC-1 — any XSUAA-protected,
  Streamable-HTTP MCP server qualifies.

### When *not* to use it

- **One SAP system only** → point your client at that ARC-1 directly; the hub adds nothing.
- **You want a natural-language assistant that reasons across systems** → that is a different,
  LLM-in-the-middle product. This hub is **deterministic routing only**.
- **Backends in different subaccounts** → not supported in v1 (the token exchange maps the issuer within
  one subaccount only). See [Limits](#limits-v1).

## How it works

The hub is an OAuth 2.1 **resource server** in front of one shared authorization server (so: one login).
Each `/<system>/mcp` route advertises its own protected resource per [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728)
so standards-compliant clients connect cleanly. On every request the hub:

1. validates your inbound token (XSUAA, hub audience);
2. exchanges it through a **BTP destination** (`OAuth2JWTBearer`) for a *per-user* token audienced to
   that backend ARC-1 (`user_name`/`email` survive the exchange);
3. bridges the MCP Streamable-HTTP session to the backend, injecting that bearer **per request**.

The backend ARC-1 then does its own principal propagation to SAP, so **SAP enforces your real
authorizations** — a user without PROD access can connect to `/prod/mcp` and still do nothing.

```
MCP client                arc-mcp-hub                         backend ARC-1            SAP
───────────               ───────────                         ─────────────            ───
  connect /dev/mcp ──────► validate XSUAA token (one login, shared AS)
  initialize ────────────► resolve(userJwt): OAuth2JWTBearer exchange ──► (per-user backend token)
                           mcpProxy session bridge: ServerTransport ⇄ ClientTransport ─► /mcp
  tools/list ────────────► relayed verbatim ◄──────────────────────────── tool list ◄── principal
  tools/call ────────────► relayed verbatim ◄──────────────────────────── result    ◄── propagation ─► SAP (as you)
```

!!! note "Key invariants"
    - **Per-request token** — the outbound bearer is re-resolved against the session's *current* user JWT
      on every backend request, never cached per session.
    - **No token passthrough** — the hub never forwards the client's token to a backend; it always mints a
      separate, backend-audienced, per-user token (an MCP spec requirement).
    - **Connection-scoped systems** — one system per session; cross-system is structurally impossible.
    - **SAP is the final authority** — the hub does not (and must not) re-implement SAP authorizations.

## Setup

Prerequisite: the hub and **all** backend ARC-1 instances are in the **same BTP subaccount**.

### 1. Deploy the hub

```bash
git clone https://github.com/arc-mcp/mcp-hub && cd mcp-hub
npm ci && npm run build
cf push                      # manifest.yml  (or: mbt build && cf deploy *.mtar for MTA)
cf set-env arc-mcp-hub ARC_HUB_DCR_SIGNING_SECRET "$(openssl rand -base64 48)"   # stable logins across redeploys
cf restart arc-mcp-hub
```

This also creates two service instances: `arc-mcp-hub-xsuaa` (the hub's OAuth identity) and
`arc-mcp-hub-destination` (how it reaches backends).

### 2. Per backend system (repeat for dev / qa / prod)

This is the part with the most moving pieces. All three links of the **grant chain** must be in place,
or the per-user exchange fails (see [Troubleshooting](#troubleshooting)).

**a. Create a destination** (Subaccount → Connectivity → Destinations → New Destination):

| Field | Value |
|---|---|
| Name | `arc1-dev` (must match `HUB_BACKENDS[].destination`) |
| Type | `HTTP` |
| URL | `https://<arc1-dev-host>/mcp` — the backend's `/mcp` endpoint |
| Authentication | `OAuth2JWTBearer` |
| Token Service URL Type | `Dedicated` |
| Token Service URL | `https://<subaccount>.authentication.<region>.hana.ondemand.com/oauth/token` |
| Client ID / Secret | the **hub's** xsuaa `clientid` / `clientsecret` (from `cf env arc-mcp-hub` → `VCAP_SERVICES.xsuaa`) |
| `scope` (additional property) | the **instance-suffixed** backend scope, e.g. `arc1-mcp!t627062.admin` |

The `scope` is what forces the backend's xsappname into the exchanged token's audience. Find it in the
backend's `cf env` → `VCAP_SERVICES.xsuaa.xsappname`, plus the scope name (`.read` / `.admin` / …).

**b. Grant the hub the scope on the backend** (link 1). In the **backend** ARC-1's `xs-security.json`,
add `granted-apps` to that scope, then update the backend's xsuaa instance:

```jsonc
"scopes": [
  { "name": "$XSAPPNAME.admin", "description": "...",
    "granted-apps": ["$XSAPPNAME(application,arc-mcp-hub)"] }   // <- add this
]
```

```bash
cf update-service <backend-xsuaa> -c xs-security.json
```

**c. Reference the backend scope in a HUB role-template** (link 2 — easy to miss). A backend scope only
reaches a user's token if a role-template **of the app the token is issued for (the hub)** references it.
The hub's `xs-security.json` must both *accept* the foreign scope and *reference* it:

```jsonc
"foreign-scope-references": ["$XSAPPNAME(application,arc1-mcp).admin"],
"role-templates": [
  { "name": "DevAdmin",
    "scope-references": ["$XSAPPNAME.use", "$XSAPPNAME(application,arc1-mcp).admin"] }
]
```

The shipped hub descriptor already contains `DevAdmin` + the `arc-mcp-hub Dev Admin` role collection.
For each *additional* backend, add a `foreign-scope-reference` + role-template referencing *that*
backend's scope, then `cf update-service arc-mcp-hub-xsuaa -c xs-security.json`.

**d. Assign developers the HUB role collection — under the right IdP** (link 3). Assign the **hub's**
`arc-mcp-hub Dev Admin` collection (not the backend's `ARC-1 Admin` — a backend collection is invisible
to the hub-issued token), under the IdP the developer actually logs in with:

```bash
btp assign security/role-collection "arc-mcp-hub Dev Admin" --to-user dev@example.com --of-idp sap.custom
```

After assignment the developer must **log in again** — a cached token won't carry the new scope.

**e. Harden PROD** — on the PROD ARC-1 set `SAP_ALLOW_WRITES=false` **and** point it at a read-only SAP
user. Routing already prevents cross-system mistakes; this makes one harmless even if it happens.

### 3. Tell the hub about the backends

```bash
cf set-env arc-mcp-hub HUB_BACKENDS '[{"name":"dev","destination":"arc1-dev"},{"name":"prod","destination":"arc1-prod"}]'
cf restart arc-mcp-hub
```

`name` becomes the URL path (`/dev/mcp`); `destination` is the destination from step 2a. **Adding a
system later = create a destination + add one entry here. No code change.**

### 4. Connect a client

```jsonc
// VS Code .vscode/mcp.json (or Eclipse GitHub Copilot → MCP, Claude, Cursor, …)
{ "servers": { "sap-dev": { "type": "http", "url": "https://<hub>/dev/mcp" } } }
```

First use → one browser login → the system's ARC-1 tools appear. Verify the backend's audit log shows
**your** user, not a service account.

## One endpoint for every system

By default each system has its own path (`/dev/mcp`), which binds the system to *which endpoint you
connect to*. To reach **all** systems through a single connection, enable the aggregated endpoint:

```bash
cf set-env arc-mcp-hub HUB_BACKENDS '[{"name":"dev","destination":"arc1-dev","description":"S/4HANA 2023 (758)"},{"name":"s4-2025","destination":"arc1-2025","description":"ABAP Platform 2025 (816)"}]'
cf set-env arc-mcp-hub HUB_ALL_ENDPOINT true
cf restart arc-mcp-hub
```

Connect a client to `https://<hub>/all/mcp`. Every tool gains a **required `system` parameter** whose
enum lists the systems that expose it; the model names the target system on each call. The optional
`description` per backend labels each system in that enum and in the server instructions.

- **Cost ≈ one tool set.** The backends are the same server (ARC-1) against different SAP targets, so a
  shared tool set + a `system` param doesn't duplicate descriptions — `/all` costs about the same as a
  single per-system endpoint, not N×. This is the main token-efficiency win on large landscapes.
- **Sessions are principal-bound + idle-reaped** — each `/all` session is tied to the user who created
  it (a different principal is rejected) and is closed after an idle timeout with its backend connections.

!!! warning "`/all` trades away structural isolation"
    With `/all`, the model picks the system per call, so it does **not** have the per-connection safety of
    the path-scoped routes. Make a misroute *harmless*, not merely unlikely: any PROD backend must run
    `SAP_ALLOW_WRITES=false` **and** a read-only SAP user. The `system` enum and server instructions steer
    the model but are **not** controls. Prefer the per-system routes for routine single-system work; use
    `/all` for genuine cross-system tasks.

## Configuration

| Env var | Required | Description |
|---|---|---|
| `HUB_BACKENDS` | yes | JSON array of `{ name, destination, description? }`. `name` is the URL segment (lowercase/digits/hyphen, not `all`); `destination` is the BTP destination resolving to that backend; optional `description` labels the system in the `/all` `system` enum. |
| `HUB_ALL_ENDPOINT` | no | `true` mounts the optional aggregated `/all/mcp`. Default off — the per-system routes are the safe default. |
| `HUB_SESSION_TTL_MINUTES` | no | Idle timeout before a session (and its backend connections) is reaped. Default **43200 (30 days)**. Only affects *abandoned* sessions; lower it for high-concurrency multi-user deployments. |
| `ARC_HUB_PUBLIC_URL` | no | The hub's public URL for OAuth metadata. Derived from the CF route if unset; set it behind a reverse proxy/custom domain. |
| `ARC_HUB_DCR_SIGNING_SECRET` | recommended | Stable secret so cached client_ids survive `cf deploy`. `openssl rand -base64 48`. |
| `ARC_HUB_ALLOWED_ORIGINS` | no | CSV CORS allowlist for browser MCP clients (e.g. `https://claude.ai`). |

## Safety model

- **Connection-scoped systems** — a session on `/dev/mcp` can only ever see DEV's tools; there is no
  runtime system selector to get wrong (except the explicit, opt-in `/all`).
- **PROD is read-only at the backend** — `SAP_ALLOW_WRITES=false` **and** a read-only SAP user. Writes are
  refused at the strongest boundary (SAP), even on a misroute.
- **Per-user identity** — every call runs as the logged-in user via principal propagation; no shared
  service account. Sessions are principal-bound and idle-reaped.
- **No hub-local authorization gate, by design** — inbound auth verifies a valid hub-audience token (one
  login); access is gated *downstream* (the `OAuth2JWTBearer` exchange only succeeds if the user holds the
  backend's foreign scope, then SAP enforces the real authorizations). A user who authenticates but lacks
  the role collection can reach the hub yet do nothing.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **Client connects but shows 0 tools**, hub log: `backend tools/list failed … <scope> is invalid. Please use a valid scope name` (at the **hub→backend exchange**) | The **grant chain isn't fully deployed.** XSUAA won't let the hub *request* the backend scope. Finish links 1 + 2: backend `granted-apps` (step 2b) **and** the hub's `foreign-scope-references` + `DevAdmin` role-template (step 2c). This is distinct from the client-login error below — here the *destination exchange* is rejected, not the login. |
| `invalid_scope: "user is not allowed any of the requested scopes"` (hub→backend exchange) | The grant chain is in place but the **user** isn't entitled. Assign the **hub's** `arc-mcp-hub Dev Admin` collection (step 2d), not a backend collection — **and re-login**. |
| `POST /mcp → 404` / client never connects | You pointed the client at the **bare** `/mcp`. There is no bare route — use a system path (`/dev/mcp`) or the aggregated `/all/mcp`. Likewise `/qa/mcp` 404s unless `qa` is in `HUB_BACKENDS`. |
| **(MCP client login)** `invalid_scope: "<hub-app>!<inst>.admin is invalid…"` or `invalid_token: "not a valid XSUAA, OIDC, or API key token"` | The hub must advertise **only `openid`** in `scopes_supported` (`HUB_SCOPES=['openid']`); the backend scope reaches the user via the role collection at exchange time, not via the authorize request. Redeploy the hub, then **clear the client's cached OAuth/DCR registration** (incognito window, or for Eclipse Copilot see [Recovering a stuck client](xsuaa-setup.md)). |
| Tools were cached / didn't refresh after a fix | MCP clients cache the tool list and DCR registration per server URL. Open a **new** agent chat / reconnect; for Eclipse GitHub Copilot, restart Eclipse or clear `copilot-eclipse.db` (see [xsuaa-setup.md](xsuaa-setup.md)). |
| `Destination Service auth token error: Bad credentials` | The destination's `clientId`/`clientSecret` are wrong — use the hub xsuaa's **stable** creds (`cf env`, or a *persistent* service key), not an ephemeral key you then delete. |
| Backend 401 `invalid_token` | Hub xsuaa missing the `jwt-bearer` grant (in `xs-security.json` — redeploy), or the destination `scope` doesn't put the backend xsappname in the audience (step 2a). |
| `Unable to map issuer` | Hub and backend are in **different subaccounts**. v1 needs the same subaccount. |
| `No BTP destination service binding` at startup | Hub isn't bound to a destination service — check `cf services`. |

!!! tip "Reading the error message is the fastest diagnosis"
    `…is invalid. Please use a valid scope name` ⇒ the **grant chain** (granted-apps / foreign-scope) isn't
    deployed. `user is not allowed any of the requested scopes` ⇒ the chain is fine but the **user** lacks
    the hub role collection (or logged in under the wrong IdP). The two look similar but have different
    fixes. Watch the hub side with `cf logs arc-mcp-hub --recent | grep 'backend tools/list'`.

## Limits (v1)

- **Same subaccount** for hub + backends (cross-subaccount → roadmap).
- **Single instance** (in-memory session map). Scaling beyond one instance needs sticky sessions or a
  shared store.
- **No server-side LLM** — by design.

Full deferred/open items: the [mcp-hub roadmap](https://github.com/arc-mcp/mcp-hub/blob/main/docs/roadmap.md).

## See also

- [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md) — deploying a single ARC-1 instance (each hub backend is one of these).
- [Principal Propagation Setup](principal-propagation-setup.md) and [BTP Destination Setup](btp-destination-setup.md) — the per-user identity mechanism the hub relies on.
- [Deployment Best Practices](deployment-best-practices.md) — managing multi-system landscapes (`.mtaext` per landscape).
- [mcp-hub repository](https://github.com/arc-mcp/mcp-hub) — source, canonical operator setup, and the non-ARC-1 integration guide.
