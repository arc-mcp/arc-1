# Authentication

<a id="authentication-overview"></a>

Choose how the MCP client signs in to ARC-1 and which identity ARC-1 uses in SAP.
These are separate decisions: a user can sign in with their corporate account while SAP still sees a shared technical user.

```text
MCP client → ARC-1 authentication → SAP authentication → SAP authorization
```

## Choosing Your Setup

<a id="common-combinations"></a><a id="local-developer"></a><a id="team-server-with-role-based-access"></a><a id="enterprise-with-per-user-control"></a><a id="enterprise-with-full-audit-trail"></a><a id="btp-cloud-foundry-production"></a><a id="btp-cloud-foundry-btp-abap-environment"></a>

### Quick Decision Guide

| You need | MCP sign-in | SAP identity | Next step |
|---|---|---|---|
| Local access to on-premise SAP | Local stdio | Your SAP user | [Quickstart](quickstart.md) |
| Local access to BTP ABAP | Local stdio | Browser OAuth user | [BTP ABAP setup](btp-abap-environment.md) |
| A shared HTTP server with API keys | API key + profile | Shared technical user | [API key setup](api-key-setup.md) |
| Corporate sign-in on a shared server | OIDC JWT | Shared user, unless per-user destination configured | [OAuth / JWT setup](oauth-jwt-setup.md) |
| BTP server with per-user on-premise access | XSUAA | Principal Propagation (PP) | [BTP: Start Here](btp-overview.md) |
| BTP server with per-user BTP ABAP access | XSUAA | `OAuth2UserTokenExchange` destination | [BTP ABAP setup](btp-abap-environment.md) |
| Several SAP targets through one read-only BTP gateway | XSUAA | Fixed per target | [Multi-system setup](multi-target-setup.md) |
| Local access through RFC/SAProuter only | Local stdio | Bridge's RFC user | [Local bridge](#3-local-adt-to-rfc-bridge-local-rfcsaprouter-workaround) |

### Recommended: One SAP Identity Model per Instance

<a id="what-to-consider"></a>

For per-user access, set `SAP_PP_ENABLED=true` and explicit `SAP_PP_STRICT=true`.
JWT requests use the human's SAP identity; non-JWT tool calls are rejected.
For API-key automation, use a separate instance with `SAP_PP_ENABLED=false` and a least-privileged technical SAP user.

With PP enabled, set `SAP_PP_STRICT=true` explicitly to reject API-key/non-JWT tool calls.
If unset or `false`, API-key calls use the configured shared SAP client and startup warns about mixed identities.
JWT PP failures always return an error; they never fall back to the shared user.

Experimental multi-target mode can mix strict PP targets and explicitly enabled shared Basic targets.
Basic requires `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH=true`, exactly one CF instance and no rolling deployment overlap. The gateway remains mutation-free; Basic never replaces failed PP.

## MCP Client Authentication (Client → ARC-1)

<a id="no-authentication-local-stdio"></a><a id="api-key"></a><a id="oidc-jwt-external-identity-provider"></a><a id="xsuaa-oauth-sap-btp"></a>

| Method | What it gives you | Setup |
|---|---|---|
| Local stdio | Access controlled by the local OS account | [Quickstart](quickstart.md) |
| API keys | Fixed scopes and safety restrictions per profile | [API keys](api-key-setup.md) |
| OIDC / JWT | User identity and scopes from your identity provider | [OIDC](oauth-jwt-setup.md) |
| XSUAA OAuth | BTP sign-in and role collections | [XSUAA](xsuaa-setup.md) |

HTTP transport requires authentication unless explicitly configured for local development.
Scopes only restrict the server's enabled capabilities; see [Authorization & Roles](authorization.md).

<a id="detailed-sap-authentication-reference"></a>

## SAP Authentication (ARC-1 → SAP)

<a id="basic-authentication"></a><a id="cookie-authentication"></a><a id="local-adt-to-rfc-bridge-rfcsaprouter-only-local-systems"></a><a id="oauth2-service-key-btp-abap-environment-local-interactive"></a><a id="principal-propagation-per-user-destination-per-user-sap-identity"></a><a id="btp-destination-service"></a>

### 1. Basic Authentication

Set credentials through your local environment or secret injection, then start ARC-1:

```bash
export SAP_URL=https://sap.example.com
export SAP_USER=YOUR_SAP_USER
export SAP_PASSWORD='REPLACE_WITH_YOUR_PASSWORD'
arc1
```

On a shared server, every API-key caller uses this same SAP account.

### 2. Cookie Authentication

Reuse an existing SAP browser session for a temporary local session. Cookies are credentials and expire according to SAP session policy.

```bash
arc1 --url https://sap.example.com --cookie-file /path/to/cookies.txt
```

### 3. Local ADT-to-RFC Bridge (Local RFC/SAProuter Workaround)

Use a local bridge when Eclipse ADT works through RFC/SAProuter but direct ADT HTTP(S) access is unavailable.

One open-source option is [`enricoandreoli/adt-rfc-bridge`](https://github.com/enricoandreoli/adt-rfc-bridge). It accepts normal ADT HTTP requests on `127.0.0.1`, forwards them via PyRFC through `SADT_REST_RFC_ENDPOINT`, and translates the response back to HTTP.

Use this only when all of these are true:

- Direct ADT HTTP(S) access to SAP is blocked or unavailable.
- RFC/SAProuter access works locally.
- Eclipse ADT already works for the same SAP user and client.
- You are running ARC-1 locally for one user.

You do not need this for normal deployments. If ARC-1 runs as a managed server, prefer BTP Destination Service + Cloud Connector, and use Principal Propagation when SAP must see the real end user.

#### Bridge Startup

Install and configure the bridge following its README. The bridge uses `RFC_*` variables for the real SAP RFC logon, for example:

```bash
export BRIDGE_PORT=8410
export RFC_ASHOST=10.0.0.1
export RFC_SYSNR=00
export RFC_CLIENT=100
export RFC_USER=YOUR_USER
export RFC_PASSWD=YOUR_PASS
export RFC_SAPROUTER=/H/router.example.com/S/3299
python adt_rfc_bridge.py
```

Then point ARC-1 at the bridge:

```bash
export SAP_URL=http://127.0.0.1:8410
export SAP_USER=YOUR_USER
export SAP_PASSWORD=YOUR_PASS
export SAP_CLIENT=100
export ARC1_MAX_CONCURRENT=1
arc1
```

**Security and behavior notes:**

- ARC-1 safety gates still apply: writes, SQL, table preview, transports, and package allowlists remain opt-in.
- SAP sees the RFC user configured in the bridge. This is not ARC-1 Principal Propagation.
- Run one bridge per SAP user/client/port.
- Keep the bridge bound to `127.0.0.1`; do not expose it as a shared service.
- `ARC1_MAX_CONCURRENT=1` is recommended because the bridge reuses a serialized RFC connection.
- The SAP user needs the RFC authorizations for `SADT_REST_RFC_ENDPOINT` plus the normal ADT resource authorizations.

---

### 4. BTP ABAP Environment (Local Service Key + Browser OAuth)

<a id="from-a-service-key-file"></a>

```bash
arc1 --btp-service-key-file /path/to/service-key.json
```

The first login opens a browser; ARC-1 refreshes tokens in memory. The callback binds to loopback.
For a deployed server, use the [per-user destination setup](btp-abap-environment.md#recommended-btp-deployment-with-a-per-user-destination).

### 5. BTP Destination Service

`SAP_BTP_DESTINATION` selects the configured BTP destination. Destination Service supplies connection details and credentials or exchanges the user's token.
See [Destination setup](btp-destination-setup.md).

### 6. Per-User Destination (BTP Destination)

Use `SAP_PP_ENABLED=true` and explicit `SAP_PP_STRICT=true` with a per-user destination.
On-premise PP additionally needs Connectivity Service, Cloud Connector and SAP certificate-to-user mapping.
BTP ABAP uses an `OAuth2UserTokenExchange` destination.

Where shared startup and per-user destinations differ, set `SAP_BTP_DESTINATION` and `SAP_BTP_PP_DESTINATION` separately.
Follow [PP setup](principal-propagation-setup.md) for on-premise SAP or [BTP ABAP setup](btp-abap-environment.md).

## Custom TLS Trust

For an internal SAP certificate authority, add its CA certificate to Node's trust store:

```bash
NODE_EXTRA_CA_CERTS=/path/to/internal-ca.crt arc1
```

`SAP_INSECURE=true` skips verification; use it only for isolated development.

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

<a id="all-auth-related-flags"></a>

Use [Configuration Reference](configuration-reference.md) for all flags, defaults and validation rules.
The startup line `auth: MCP=[...] SAP=...` shows which methods are active.

## Coexistence Matrix

API keys, OIDC and XSUAA can coexist on single-target HTTP routes. SAP authentication has these constraints:

| SAP authentication combination | Status | Reason |
|---|---|---|
| Basic only | Supported | Standard on-prem |
| Cookie only | Supported | On-prem SSO developer loop |
| Basic + Cookie | Supported | ARC-1 sends both headers — SAP picks |
| Direct service-key bearer (BTP ABAP) only | Supported | Local BTP ABAP Environment browser OAuth |
| Destination only | Supported | BTP Cloud Foundry, shared user |
| Destination + PP with explicit `SAP_PP_STRICT=true` | Recommended | Enterprise standard on BTP CF; JWT tool calls use one per-user SAP identity model |
| Destination + PP + API keys with `SAP_PP_STRICT` unset or `false` | Supported | JWT calls are per-user while API-key calls use the shared technical identity; separate instances are recommended for clearer boundaries |
| PP + Cookie | Startup error | Cookies would leak into per-user requests |
| PP + Cookie + SAP_PP_ALLOW_SHARED_COOKIES=true | Allowed with warning | Cookies stay on shared client only |
| Bearer + Cookie | Startup error | Two SAP authentication methods in conflict |
| Direct service-key bearer + PP | Startup error | `SAP_BTP_SERVICE_KEY` is local interactive OAuth and cannot be combined with `SAP_PP_ENABLED=true` |
| Destination-exchanged bearer + PP | Supported | BTP ABAP deployed path: `SAP_BTP_DESTINATION` + `SAP_PP_ENABLED=true` + destination `OAuth2UserTokenExchange` |
| Multi-target PP + Basic destinations | Read-only exception | XSUAA remains the human authorization layer; Basic targets are shared SAP identity, require the default-off ceiling, and force one CF instance |

### SAP Auth Coexistence Rules

Conflicting SAP modes in the table fail at startup. `SAP_PP_ALLOW_SHARED_COOKIES=true` is an advanced exception: cookies stay on the shared client only.
`SAP_DISABLE_SAML=true` with BTP and an unused `ARC1_DCR_SIGNING_SECRET` without XSUAA emit warnings.

### What's NOT Implemented

ARC-1 has no generic OAuth-client flags, local mTLS flags, configurable OIDC username mapping or local PP certificate generation.
Use only settings listed in [Configuration Reference](configuration-reference.md).

## Troubleshooting

<a id="oidc-token-validation-fails"></a><a id="power-platform-copilot-studio-oauth-errors"></a><a id="principal-propagation-requests-do-not-use-the-expected-sap-user"></a>

| Symptom | Check next |
|---|---|
| OIDC token rejected | Exact issuer, audience and token expiry in [OIDC setup](oauth-jwt-setup.md) |
| OAuth client cannot sign in | [XSUAA troubleshooting](xsuaa-setup.md#troubleshooting) |
| SAP sees the wrong user | [PP identity verification](principal-propagation-setup.md) |
| Sign-in succeeds but a tool is blocked | [Authorization troubleshooting](authorization.md#troubleshooting-which-layer-blocked-me) |

## Verify the connection

After setup, run the matching [authentication smoke test](auth-test-process.md).
A successful `/health` response proves process health only; verify a safe SAP read and the expected SAP identity.
