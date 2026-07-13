# SAP S/4HANA Public Cloud Setup

ARC-1 connects to **SAP S/4HANA Cloud Public Edition (developer extensibility / ABAP Cloud)** through ADT, using **principal propagation only**.

> **Principal propagation is the only supported way to reach ADT on S/4HANA Public Cloud.**
> There is no technical-user / Basic-auth path and no local service-key browser flow (unlike the
> [BTP ABAP Environment](btp-abap-environment.md)). ARC-1 must run on **BTP Cloud Foundry** and act
> as **each MCP user's own S/4HANA Cloud identity** via a `SAMLAssertion` BTP destination — the
> **same destination type and setup SAP Business Application Studio (BAS) uses**.

If you already connect BAS to your S/4HANA Cloud system for ABAP development, you can **reuse that
exact destination** — just point ARC-1 at it. The destination setup follows the SAP tutorial
[Connect SAP Business Application Studio and SAP S/4HANA Cloud System](https://developers.sap.com/tutorials/abap-custom-ui-bas-connect-s4hc.html).

> **Do not set `SAP_DISABLE_SAML=true`.** The SAML disable opt-in is for on-prem systems and breaks
> S/4HANA Public Cloud authentication. See [enterprise-auth.md](enterprise-auth.md).

## How it works

```
MCP Client (user JWT — XSUAA / OIDC)
  │
  ▼
ARC-1 on BTP Cloud Foundry (/mcp)
  │  validates the user JWT, passes it to the Destination service as X-User-Token
  ▼
BTP Destination service (SAMLAssertion destination)
  │  mints a per-user SAML assertion (NameID = user email)
  ▼
ARC-1 sends:  Authorization: SAML2.0 <assertion>
              x-sap-security-session: create        (direct, Internet — no Cloud Connector)
  ▼
S/4HANA Cloud (Communication System = trusted SAML Bearer Assertion Provider)
  │  validates the assertion, maps the email to a business user
  ▼
ADT request runs as that individual S/4HANA Cloud user (their own authorizations apply)
```

Each MCP user therefore acts in S/4HANA Cloud as themselves — no shared SAP credentials, full
per-user audit trail. SAP returns a security session cookie on the first call (`x-sap-security-session: create`),
which ARC-1's cookie jar reuses for the rest of the session.

## Prerequisites

- ARC-1 deployed on **BTP Cloud Foundry** (`http-streamable` transport) — see [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md)
- JWT-based MCP-client auth working ([XSUAA](xsuaa-setup.md) or [OIDC](oauth-jwt-setup.md))
- **XSUAA** + **Destination** service instances bound to ARC-1 (no Connectivity service / Cloud Connector — the system is Internet-facing)
- An S/4HANA Cloud user (business user) for each MCP user, whose **email matches** the JWT, holding a business role with **ABAP developer (developer extensibility)** authorization — the same access needed to develop via BAS/ADT
- Administrator access to the S/4HANA Cloud system (Communication Management) and the BTP subaccount

## Step 1: Establish SAML trust on S/4HANA Cloud

This is identical to the BAS connection setup — follow the SAP tutorial
[Connect SAP Business Application Studio and SAP S/4HANA Cloud System](https://developers.sap.com/tutorials/abap-custom-ui-bas-connect-s4hc.html).
Summary:

1. **BTP subaccount → Connectivity → Destination Trust**: choose **Generate Trust** (if no trust
   certificate exists yet), then **Export** the subaccount's signing certificate (PEM).
2. **S/4HANA Cloud → Communication Systems** app: create a system (e.g. `BAS_<subaccount-subdomain>`):
   - **General → Technical Data**: enable **Inbound Only**.
   - **General → Identity Provider / OAuth 2.0 / SAML**: set **SAML Bearer Assertion Provider** to **ON**, upload the exported BTP certificate, and set the **SAML Bearer Issuer** to the certificate's Subject CN.

No communication *arrangement* and no communication *user* are needed for the developer connection —
the SAML assertion carries the real user identity (email), which S/4HANA Cloud maps to a business user.

## Step 2: Create the `SAMLAssertion` destination

In the BTP subaccount (**Connectivity → Destinations**) create the destination — or **reuse your
existing BAS destination** (the one named like `<SYSTEM_ID>_SAML_ASSERTION`). These are the values from
the SAP tutorial:

| Property | Value |
|---|---|
| **Name** | `<SYSTEM_ID>_SAML_ASSERTION` (your choice — this is what `SAP_BTP_PP_DESTINATION` points at) |
| **Type** | `HTTP` |
| **URL** | your S/4HANA Cloud system URL, e.g. `https://my<NNNNN>-api.s4hana.cloud.sap` |
| **Proxy Type** | `Internet` |
| **Authentication** | `SAMLAssertion` |
| **Audience** | the S/4HANA Cloud OAuth 2.0 SAML2 audience (the system's SAML2 local provider name) |
| **AuthnContextClassRef** | `urn:oasis:names:tc:SAML:2.0:ac:classes:PreviousSession` |
| **Client Key** | leave empty (tick "set empty") |
| **Name ID Format** | `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress` |

Additional Properties (BAS-oriented; harmless for ARC-1, keep them if you reuse the BAS destination):

| Property | Value |
|---|---|
| `HTML5.DynamicDestination` | `true` |
| `HTML5.Timeout` | `60000` |
| `WebIDEEnabled` | `true` |
| `WebIDEUsage` | `odata_abap,dev_abap` |

Also enable **Use default JDK truststore** so the public S/4HANA Cloud TLS certificate is trusted.

> ARC-1 only consumes the `SAMLAssertion` auth flow from this destination — it forwards the assertion
> verbatim as `Authorization` plus `x-sap-security-session: create`. The `WebIDE*` / `HTML5.*`
> properties are BAS hints and are ignored by ARC-1.

## Step 3: Bind BTP services

ARC-1 needs **XSUAA** (MCP-client login) and **Destination** only — no Connectivity service, because
there is no Cloud Connector for a cloud-to-cloud call:

```bash
cf create-service xsuaa application arc1-xsuaa -c xs-security.json
cf create-service destination lite arc1-destination
```

## Step 4: Configure ARC-1

```yaml
env:
  SAP_SYSTEM_TYPE: btp                       # ABAP Cloud tool surface from startup
  SAP_TRANSPORT: http-streamable
  SAP_XSUAA_AUTH: "true"                     # MCP clients authenticate via XSUAA OAuth
  SAP_PP_ENABLED: "true"                     # per-user principal propagation
  SAP_PP_STRICT: "true"                      # recommended: keep this instance JWT-only
  SAP_BTP_PP_DESTINATION: <SYSTEM_ID>_SAML_ASSERTION
services:
  - arc1-xsuaa
  - arc1-destination
```

Per request, ARC-1 validates the MCP user's JWT, has the Destination service mint a per-user SAML
assertion, and sends it to S/4HANA Cloud. SAP sees the actual end user, so SAP-side authorizations
apply per user. ARC-1 detects `ProxyType: Internet` and connects **directly** — the Cloud Connector
proxy is used only for on-premise destinations.

## Step 5: Grant users access

1. **BTP** — assign each MCP user a role collection granting the ARC-1 scopes they need (e.g. `ARC-1 Developer`); XSUAA only issues a token for scopes the user actually holds.
2. **S/4HANA Cloud** — the matching business user (same email as the JWT) must hold a business role with **developer extensibility / ABAP development** authorization. Without it, ADT calls fail with a logon/authorization error even though the SAML assertion is accepted.

## What to expect (ABAP Cloud)

S/4HANA Public Cloud developer extensibility is **ABAP Cloud** — the same restricted surface as the
[BTP ABAP Environment](btp-abap-environment.md#constraints-vs-on-premise): released APIs (C1) only,
ADT-only (no SAP GUI), `Z`/customer namespaces, gCTS-style transports, and SAP standard tables blocked
in `SAPQuery` (use released CDS views). Setting `SAP_SYSTEM_TYPE=btp` exposes the ABAP Cloud tool
definitions from startup; see [BTP ABAP Environment → What to Expect](btp-abap-environment.md#what-to-expect-on-btp-abap).

## Verification

With `ARC1_LOG_LEVEL=debug`, make any tool call (e.g. "search for ZCL_* classes") and check the
ARC-1 logs:

- `Destination Service PP response` — lists the SAML auth-token entry returned by the destination
- `BTP destination resolved (per-user) … hasSamlAssertion:true`
- `auth_pp_created … success:true`
- the `SAPRead` returns data, and S/4HANA Cloud `SM20`/session shows the **individual** user

## Troubleshooting

### `auth_pp_created success:false … no SAML assertion returned`
The destination did not return a SAML assertion. Check the destination `Authentication` is exactly
`SAMLAssertion`, that the BTP destination-trust certificate is uploaded to the S/4HANA Cloud
Communication System, and that the **SAML Bearer Assertion Provider** is **ON**.

### Assertion accepted but ADT returns 401 / "not successfully logged on"
The SAML NameID (user email) didn't map to an authorized S/4HANA Cloud user. Confirm a business user
exists with the **same email** as the JWT, and that it holds a **developer (developer extensibility)**
business role.

### Requests fail / time out only when the Connectivity service is bound
Internet destinations must connect directly. ARC-1 already routes `ProxyType: Internet` destinations
direct (the connectivity proxy is used only for `OnPremise`); make sure the destination's **Proxy Type**
is `Internet`.

### See the raw SAP rejection text
If the `errorBody`/`errorMessage` audit opt-in is enabled, set `ARC1_LOG_HTTP_DEBUG=true` to surface
the SAP rejection message instead of `[REDACTED]`. See [Log Analysis](log-analysis.md).

## References

- SAP tutorial — [Connect SAP Business Application Studio and SAP S/4HANA Cloud System](https://developers.sap.com/tutorials/abap-custom-ui-bas-connect-s4hc.html) (the destination + trust setup ARC-1 reuses)
- [Principal Propagation Setup](principal-propagation-setup.md) — ARC-1's per-user auth in depth (incl. the on-premise Cloud Connector variant)
- [BTP Destination Setup](btp-destination-setup.md) · [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md)
- [BTP ABAP Environment](btp-abap-environment.md) — the closely related Steampunk setup (`OAuth2UserTokenExchange`)
