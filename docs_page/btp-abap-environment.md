# BTP ABAP Environment Setup

How to point ARC-1 at a **SAP BTP ABAP Environment** (Steampunk). The SAP-side groundwork —
provisioning, the ABAP development booster, the developer role, the service key — is a prerequisite,
not part of this page: see [SAP-Side Prerequisites](btp-abap-prerequisites.md).

There are two ways to connect, and they are not interchangeable:

| | **Deployed on BTP Cloud Foundry** (recommended) | **Local service key** (development) |
|---|---|---|
| SAP identity | Each MCP user's own SAP user (`OAuth2UserTokenExchange`) | Whoever logs in via the browser — one identity |
| Login | Headless; the Destination service exchanges the user's JWT | Browser opens on first call (OAuth Authorization Code + PKCE) |
| Transport | `http-streamable`, multi-user | `stdio` on a laptop |
| Headless / shared server | ✅ | ❌ the OAuth callback binds to loopback |
| Cloud Connector | Not needed — the ABAP Environment is Internet-facing | Not needed |
| Setup | [Recommended: BTP deployment with a per-user destination](#recommended-btp-deployment-with-a-per-user-destination) | [Local development: service key + browser login](#local-development-service-key-browser-login) |

The deployed path is how ARC-1 is meant to be consumed — a centrally managed BTP-native service that
acts in SAP as each user (see [Deployment Best Practices](deployment-best-practices.md)). Use the
service key only on a laptop.

!!! danger "Do not set `SAP_DISABLE_SAML=true` with BTP ABAP"
    The SAML/SAML2 disable opt-in (SEC-09) exists for on-premise systems and breaks BTP ABAP /
    S/4HANA Public Cloud authentication. See [enterprise-auth.md](enterprise-auth.md).

## Before you start

- The ABAP system is prepared and Eclipse ADT can log on — [SAP-Side Prerequisites](btp-abap-prerequisites.md).
- A **service key** of the ABAP instance (both paths need it: directly, or as the destination's OAuth client).
- ARC-1 installed: `npm install -g arc-1`, `npx arc-1`, or the Docker image `ghcr.io/arc-mcp/arc-1`.
- For the deployed path: ARC-1 on Cloud Foundry **in the same subaccount as the ABAP Environment** —
  see [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md) and the
  [cross-subaccount caveat](#cross-subaccount-principal-propagation-fails).

## Recommended: BTP deployment with a per-user destination

ARC-1 on Cloud Foundry validates the MCP user's XSUAA token, the Destination service exchanges it for
an ABAP-context token (`OAuth2UserTokenExchange`), and every ADT call runs as that user — so SAP's own
authorizations apply per user and no technical SAP user exists. It is a direct cloud-to-cloud call:
no Cloud Connector, no Connectivity service.

SAP documents this exchange for applications that must call another application in the user's context
([OAuth User Token Exchange Authentication](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/oauth-user-token-exchange-authentication)).

### 1. Bind the BTP services

```bash
cf create-service xsuaa application arc1-xsuaa -c xs-security.json
cf create-service destination lite arc1-destination
```

### 2. Create the per-user destination

The destination's OAuth client is the ABAP instance's **own** service key (`uaa` section). Create it
in the cockpit (**Connectivity → Destinations**) or declaratively when creating the destination
service instance (`cf create-service destination lite arc1-destination -c dest.json`):

```json
{ "init_data": { "instance": {
  "existing_destinations_policy": "update",
  "destinations": [{
    "Name": "ABAP_PP",
    "Type": "HTTP",
    "URL": "https://<guid>.abap.<region>.hana.ondemand.com",
    "ProxyType": "Internet",
    "Authentication": "OAuth2UserTokenExchange",
    "tokenServiceURL": "https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token",
    "clientId": "<service-key uaa.clientid>",
    "clientSecret": "<service-key uaa.clientsecret>"
  }]
}}}
```

`URL` is the service key's `url` — the **`.abap.`** API host, never the `.abap-web.` Fiori host.
`ProxyType: Internet` is what keeps ARC-1 off the Cloud Connector proxy. In the cockpit the same
fields appear as *Token Service URL*, *Client ID* and *Client Secret*
([property reference](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/oauth-user-token-exchange-authentication)).

!!! warning "`OAuth2UserTokenExchange` requires the same subaccount"
    It is an XSUAA→XSUAA exchange *inside one identity zone*: ARC-1 and the ABAP Environment must sit
    in the **same BTP subaccount**. Across subaccounts the Destination service fails with
    `Token header claim [kid] references unknown signing key` and every tool call returns
    `Principal propagation failed` — see [Troubleshooting](#cross-subaccount-principal-propagation-fails)
    for the two supported fixes.

### 3. Configure ARC-1

```yaml
env:
  SAP_SYSTEM_TYPE: btp          # ABAP Cloud tool surface from startup
  SAP_TRANSPORT: http-streamable
  SAP_XSUAA_AUTH: "true"        # MCP clients authenticate via XSUAA OAuth
  SAP_PP_ENABLED: "true"        # per-user principal propagation
  SAP_PP_STRICT: "true"         # recommended: reject API-key / non-JWT tool calls
  SAP_BTP_DESTINATION: ABAP_PP
services:
  - arc1-xsuaa
  - arc1-destination
```

The repository ships this as a ready manifest: [`manifest-btp-abap.yml`](https://github.com/arc-mcp/arc-1/blob/main/manifest-btp-abap.yml)
(`cf push -f manifest-btp-abap.yml`). Start read-only and widen the safety ceiling only after
acceptance — see [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md).

### 4. Grant users access

1. **BTP** — assign each MCP user a role collection with the ARC-1 scopes they need (e.g. `ARC-1
   Developer`) under **Security → Role Collections / Users**; XSUAA only issues tokens for scopes the
   user holds. See [Authorization & Roles](authorization.md).
2. **ABAP** — the same user needs the `SAP_BR_DEVELOPER` business role in the ABAP Environment
   ([prerequisites, step 3](btp-abap-prerequisites.md#3-assign-the-developer-role)).

### 5. Verify

With `ARC1_LOG_LEVEL=debug`, make one tool call and check `cf logs arc1-btp-abap --recent`:

```
BTP destination resolved  destination:ABAP_PP  ppEnabled:true
PP: using destination-exchanged Bearer token (OAuth2UserTokenExchange)
[auth_pp_created] success:true  user:<the MCP user>
```

`auth_pp_created success:false` means the exchange failed — the message carries the Destination
service's own error verbatim.

## Local development: service key + browser login

The same OAuth 2.0 Authorization Code flow Eclipse ADT uses: ARC-1 opens a browser, you log in, and
the tokens are cached in memory. Fine on a laptop with `stdio`; **not** for a deployed or shared
server, because the callback listener binds to loopback.

### Configure ARC-1

```bash
# Keep the key outside the repo
cp ~/Downloads/service-key.json ~/.config/arc-1/btp-service-key.json

SAP_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-service-key.json SAP_SYSTEM_TYPE=btp arc1
```

Alternatives: `SAP_BTP_SERVICE_KEY='{"uaa":{…},"url":"…"}'` (inline JSON, short-lived local env only)
or the CLI flags `--btp-service-key-file` / `--btp-service-key`.

### MCP client configuration

Two env vars in the client's stdio server entry — the rest of the file follows your client's normal
format ([Install in Claude](install-in-claude.md), [Local Development](local-development.md#mcp-client-configuration)):

```json
{
  "mcpServers": {
    "arc-1-btp": {
      "command": "npx",
      "args": ["-y", "arc-1"],
      "env": {
        "SAP_BTP_SERVICE_KEY_FILE": "/path/to/service-key.json",
        "SAP_SYSTEM_TYPE": "btp"
      }
    }
  }
}
```

Docker works the same way (`-e SAP_BTP_SERVICE_KEY_FILE=…` with the key mounted), but only for a local
interactive run where your browser can reach the container's callback port.

### First login

Make any tool call; a browser opens on the BTP login page (IAS, SAP ID service, Entra ID, …), and the
call completes once you authenticate. ARC-1 runs the Authorization Code flow with PKCE and a `state`
check against a callback listener bound to `localhost` (`SAP_BTP_OAUTH_CALLBACK_PORT`, auto by
default), then sends `Authorization: Bearer <token>` on every ADT call — CSRF and cookies behave as
on-premise. The ~12 h access token is refreshed silently; only an expired refresh token means another
browser login. When no browser can be launched, the authorization URL goes to stderr — usable only if
that browser can still reach the loopback callback, which rules out most remote hosts.

### Smoke test

```bash
SAP_BTP_SERVICE_KEY_FILE=/path/to/service-key.json SAP_SYSTEM_TYPE=btp arc1 search "ZCL_*" --output json
```

Browser login, then results as JSON. A `client_credentials` token cannot be used instead: ADT requires
a user context and returns 401.

## System type: `SAP_SYSTEM_TYPE=btp`

Set it. It adapts the tool definitions **at startup** instead of after the first `SAPManage probe`,
so the LLM never sees types the ABAP Environment does not have. Without it, ARC-1 auto-detects (`auto`
is the default) and the first `tools/list` may still advertise on-premise types.

## What to expect on BTP ABAP

| Tool | On the ABAP Environment |
|---|---|
| `SAPRead` | CLAS, INTF, FUNC, FUGR, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD/KTD, TABL, DOMA, DTEL, MSAG, DEVC, TABLE_CONTENTS, TABLE_QUERY, SYSTEM, COMPONENTS, BSP/BSP_DEPLOY, API_STATE, INACTIVE_OBJECTS, plus the discovery-gated server-driven types (DESD, DTSC, CSNM, EVTB, EVTO, COTA, DSFD, DTDC, UIAD). Removed: PROG, INCL, VIEW, TRAN, TTYP, SOBJ, TEXT_ELEMENTS, VARIANTS, AUTH, FEATURE_TOGGLE/FTG2, ENHO, VERSIONS, VERSION_SOURCE. |
| `SAPWrite` | CLAS, INTF, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD/KTD, TABL (+ `TABL/DT`, `TABL/DS`), DOMA, DTEL, MSAG, and the server-driven types. The `edit_unit` and `edit_text_symbols` actions are not offered (no PROG/INCL, no class text pool). ABAP Cloud language version and customer namespaces only. |
| `SAPContext` | CLAS, INTF, DDLS, TABL — `action="impact"` for CDS blast radius. |
| `SAPSearch` / `SAPNavigate` | Work; scope is released SAP objects plus custom Z/Y objects. Classic programs and includes are not searchable. |
| `SAPQuery` | Freestyle SQL needs `SAP_ALLOW_FREE_SQL=true` (table/CDS previews need `SAP_ALLOW_DATA_PREVIEW=true`). Custom tables and released CDS entities (`I_LANGUAGE`, `I_COUNTRY`, …) work; SAP standard tables (`MARA`, `TADIR`, `DD02L`, …) are blocked — the error suggests CDS views. |
| `SAPTransport` | Works, but `release` triggers a gCTS Git push, not a TMS export — the software-component model, see the tutorial [Transport a Software Component Between two Systems](https://developers.sap.com/tutorials/abap-environment-gcts..html). |
| `SAPActivate` / `SAPLint` | Unchanged (`SAPLint` runs client-side). |
| `SAPDiagnose` | ATC works and uses the system's default check variant (`ABAP_CLOUD_DEVELOPMENT_DEFAULT`) unless you pass `variant`. |
| `SAPManage` | `probe` reports `systemType: "btp"`. |

## Writing objects on BTP

Create/update is live-verified on the ABAP Environment (`CLAS create → activate → read → delete`).
When the system type is `btp`, ARC-1 emits the **cloud-correct** create body automatically: it drops
the on-premise `adtcore:masterSystem` / `adtcore:responsible` and adds
`abapLanguageVersion="cloudDevelopment"`; the owner comes from your JWT.

| Object family | Status |
|---|---|
| CLAS, INTF, DDIC (DOMA, DTEL, TABL, MSAG) | Live-verified |
| RAP stack — BDEF, SRVD, SRVB create | Live-verified; SRVB `update` too (a full metadata replace merged over the existing binding, so a description-only edit keeps the bound `serviceDefinition`) |
| Server-driven objects (DESD, DTSC, CSNM, EVTB, EVTO, COTA) | Live-verified; their minimal `blue:blueSource` body carries no owner/system attributes by construction |
| DSFD, DTDC | Registered and `btp`-capable, but live-verified only on on-premise 7.58 / 8.16; discovery-gated like every server-driven type |
| UIAD (launchpad app descriptor item) | Read in practice — SAP refuses `create` on on-premise ("LADI edits need the ABAP Cloud language version"); writing it on the ABAP Environment is unverified |

Two prerequisites:

1. **Enable writes** — `SAP_ALLOW_WRITES=true`.
2. **Target a real development package** — not `$TMP` (does not exist here) and not the structure
   package `ZLOCAL`. Create a development sub-package under `ZLOCAL`
   ([prerequisites, step 6](btp-abap-prerequisites.md#6-a-development-package-writes-only)), then
   allow it:

   ```bash
   SAP_ALLOW_WRITES=true
   SAP_ALLOWED_PACKAGES=Z*          # or the exact package, e.g. ZARC1_DEV
   ```

!!! note "Creating packages on BTP"
    `SAPManage(action="create_package")` emits the cloud-correct body when `systemType=btp`: it nests
    the package under the structure `superPackage` (e.g. `ZLOCAL`), sets software component `ZLOCAL`,
    and uses your **internal ABAP user** (e.g. `CB9980000000`) as `responsible` — the IAS email is
    rejected and `responsible` cannot be omitted. ARC-1 resolves that internal user from the
    `createdBy` of an object you created in the session; otherwise pass `responsible="<internal user>"`.
    Only a brand-new tenant's first-ever package still needs a one-time Eclipse bootstrap
    (`docs/research/2026-06-27-btp-package-create-solved.md`).

## Constraints vs On-Premise

The system is **ABAP Cloud**: restricted "ABAP for Cloud Development", only C1-released APIs, ADT only
(no SAP GUI), `Z`/`Y` namespaces, and gCTS software components instead of classic TMS — SAP's
[ABAP Cloud Development Model](https://help.sap.com/docs/abap-cloud/abap-cloud/abap-cloud-in-nutshell)
is the reference. What that changes for ARC-1:

- Types the platform has no concept of are removed from the tool schemas — see
  [What to expect](#what-to-expect-on-btp-abap).
- Data access stays behind the usual opt-ins (`SAP_ALLOW_DATA_PREVIEW`, `SAP_ALLOW_FREE_SQL`), and the
  backend blocks SAP standard tables even when you enable them.
- `SAPTransport release` is a Git push, so transport-shaped workflows behave differently.

## Configuration Reference

### Deployed BTP CF destination

| Variable / Flag | Description |
|---|---|
| `SAP_BTP_DESTINATION` | Destination with `Authentication=OAuth2UserTokenExchange`. Resolved at startup; a change needs a restart. |
| `SAP_BTP_PP_DESTINATION` | Optional separate per-user destination name; falls back to `SAP_BTP_DESTINATION`. |
| `SAP_PP_ENABLED=true` / `--pp-enabled` | Enables the per-user destination path |
| `SAP_PP_STRICT=true` / `--pp-strict` | Recommended; rejects API-key / non-JWT tool calls. Set `false` only to run PP and API keys in one instance (API-key calls then use the shared identity). |
| `SAP_XSUAA_AUTH=true` / `--xsuaa-auth` | MCP clients authenticate through XSUAA OAuth |
| `SAP_SYSTEM_TYPE=btp` / `--system-type btp` | ABAP Cloud tool definitions from startup |

### Local service-key OAuth

| Variable / Flag | Description |
|---|---|
| `SAP_BTP_SERVICE_KEY_FILE` / `--btp-service-key-file` | Path to the service key JSON |
| `SAP_BTP_SERVICE_KEY` / `--btp-service-key` | Inline service key JSON |
| `SAP_BTP_OAUTH_CALLBACK_PORT` / `--btp-oauth-callback-port` | Loopback port for the OAuth callback (default: auto) |
| `SAP_SYSTEM_TYPE` / `--system-type` | `auto` (default), `btp`, `onprem` |

Full option semantics: [Configuration Reference](configuration-reference.md#b3-btp-abap-environment-direct-oauth).

## Troubleshooting

### Cross-subaccount principal propagation fails

**Symptom:** MCP login works, but every tool call fails with `Principal propagation failed:
Destination Service auth token error … Token header claim [kid] references unknown signing key` (or
`Unable to map issuer: No identity provider found for issuer …`), and the audit log shows
`auth_pp_created success:false`.

**Cause:** ARC-1's XSUAA and the ABAP Environment are in **different BTP subaccounts**. XSUAA tokens
are subaccount-scoped, so the ABAP environment's XSUAA does not trust a signing key from another
subaccount. Reproduced end-to-end in [#434](https://github.com/arc-mcp/arc-1/issues/434); ARC-1
surfaces the Destination service's own error.

**Fix — pick one** (SAP's rule in [Routing via Destination](https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/97d7a02cd6fd4f579fd96f41ee0d0c1d.html):
same subaccount → `OAuth2UserTokenExchange`, different subaccounts → `SAMLAssertion`):

1. **Same subaccount (simplest):** deploy ARC-1 into the ABAP Environment's subaccount and keep the
   destination as-is. This is ARC-1's one-instance-per-system model.
2. **Different subaccounts:** switch the destination to `SAMLAssertion` (or
   `OAuth2SAMLBearerAssertion`) and register the source subaccount's Destination service as a trusted
   IdP in the ABAP environment's subaccount — see
   [OAuth SAML Bearer Assertion Authentication](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/oauth-saml-bearer-assertion-authentication)
   and [User Propagation via SAML 2.0 Bearer Assertion Flow](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/user-propagation-via-saml-2-0-bearer-assertion-flow).
   ARC-1 needs no change — it consumes both the assertion and the bearer token the Destination
   service returns (this is the same code path S/4HANA Public Cloud uses, verified there rather than
   on the ABAP Environment).

### 401 after a successful login

The token was issued but SAP rejected it — usually the missing `SAP_BR_DEVELOPER` business role
([prerequisites](btp-abap-prerequisites.md#3-assign-the-developer-role)). BTP role collections do not
substitute for it.

### 403 on specific ADT endpoints

Login works, one endpoint does not: the business role lacks that authorization, or a cross-system
scenario (e.g. remote ATC) needs a communication arrangement. See the
[SAP-side troubleshooting table](btp-abap-prerequisites.md#troubleshooting-sap-side).

### Browser opens but login fails / the browser never opens

Verify the service key is current (recreate it in the cockpit if unsure) and that its `uaa.url`
matches the system's region. When ARC-1 cannot launch a browser it logs the authorization URL —
copy/paste only works if that browser can reach the loopback callback, which rules out most remote
and headless hosts. Use the [deployed destination path](#recommended-btp-deployment-with-a-per-user-destination)
there.

### Connection works in `curl` but not in ARC-1

Run with `--verbose` / `SAP_VERBOSE=true` and read stderr: it shows the resolved URL, the OAuth flow
and every ADT request. Check the service-key path is readable, and that the URL is the `.abap.` API
host.

### Timeouts / `ECONNREFUSED` on a free-tier system

Free-tier instances are stopped automatically; restart from the Landscape Portal
([prerequisites](btp-abap-prerequisites.md#1-provision-the-instance)).

## References

- [SAP-Side Prerequisites](btp-abap-prerequisites.md) — provisioning, booster, developer role, service key
- [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md) · [BTP Destination Setup](btp-destination-setup.md) · [Principal Propagation](principal-propagation-setup.md)
- [S/4HANA Public Cloud](s4hana-public-cloud.md) — the sibling ABAP Cloud setup (`SAMLAssertion`)
- SAP: [OAuth User Token Exchange Authentication](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/oauth-user-token-exchange-authentication) · [Routing via Destination](https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/97d7a02cd6fd4f579fd96f41ee0d0c1d.html)
- Testing ARC-1 against a BTP ABAP system (contributors): [Authentication Test Process](auth-test-process.md#btp-abap-environment-service-key)
- Design background: [BTP ABAP Environment connectivity report](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/completed/2026-04-01-btp-abap-environment-connectivity.md)
