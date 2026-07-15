# Principal Propagation Setup

Authenticate each MCP user to SAP with their own identity via BTP Destination Service and Cloud Connector. No shared SAP passwords. Full per-user audit trail.

## When to Use

- Enterprise environments requiring per-user SAP authorization
- Compliance/audit requirements (who did what in SAP)
- When different users should have different SAP permissions
- Zero shared credentials architecture

## Architecture

```
MCP Client (JWT)
  │
  ▼
ARC-1 (/mcp)
  │  validates JWT (OIDC or XSUAA)
  │  passes X-User-Token to Destination Service
  ▼
BTP Destination Service
  │  resolves per-user destination (PrincipalPropagation type)
  ▼
Connectivity Proxy
  │
  ▼
Cloud Connector
  │  propagates user identity via client certificate
  ▼
SAP ICM
  │  CERTRULE / VUSREXTID maps certificate to SAP user
  ▼
SAP user session (per-user)
```

## Prerequisites

- JWT-based MCP auth working ([OIDC setup](oauth-jwt-setup.md) or [XSUAA setup](xsuaa-setup.md))
- ARC-1 deployed on BTP Cloud Foundry
- Destination + Connectivity service instances bound to ARC-1 app
- Cloud Connector connected to your BTP subaccount
- SAP system reachable from Cloud Connector

## Step 1: Create Two BTP Destinations

Create a dual-destination setup in BTP Cockpit (Connectivity → Destinations):

### Shared destination (startup and mixed API-key calls)

| Property | Value |
|----------|-------|
| Name | `SAP_TRIAL` (your choice) |
| Type | HTTP |
| URL | `http://<sap-host>:<sap-port>` |
| Authentication | BasicAuthentication |
| User | Technical SAP user |
| Password | Technical SAP password |

### Per-user destination (principal propagation)

| Property | Value |
|----------|-------|
| Name | `SAP_TRIAL_PP` (your choice) |
| Type | HTTP |
| URL | `http://<sap-host>:<sap-port>` |
| Authentication | PrincipalPropagation |

## Step 2: Configure Cloud Connector

1. Open Cloud Connector Admin UI
2. Add the SAP system mapping (Cloud to On-Premise → Add)
3. Enable **Principal Propagation** in the access control for the mapping
4. Configure the system certificate for signing principal propagation certificates

### Required Cloud Connector Resource Paths

If you use restrictive Cloud Connector resource whitelisting, expose at least these paths:

| URL Path | Access Policy | Purpose |
|----------|---------------|---------|
| `/sap/bc/adt` | Path and all sub-paths | ADT API used by ARC-1 core read/write operations |
| `/sap/opu/odata/UI2/PAGE_BUILDER_CUST` | Path and all sub-paths | FLP launchpad management via `SAPManage` FLP actions |
| `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` | Path and all sub-paths | UI5 ABAP Repository OData (BSP deploy metadata) |

The trial setup guide uses `/` (all paths), which implicitly includes these routes. For production, explicit path allowlists are recommended for defense in depth.

## Step 3: Configure SAP System

The SAP system must trust Cloud Connector's certificates and map them to SAP users.

### Certificate trust (STRUST)

1. Import the Cloud Connector system certificate into STRUST (SSL Server Standard PSE → Certificate List)

### Certificate mapping (CERTRULE or VUSREXTID)

Configure how the certificate's subject is mapped to a SAP user:

- **CERTRULE** (transaction `/nCERTRULE`): Rule-based mapping (e.g., Subject CN → SAP User ID)
- **VUSREXTID** (table `VUSREXTID` via SM30): Explicit user-to-certificate subject mapping

### ICM parameters

Verify these profile parameters (transaction `/nRZ10`):

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `icm/HTTPS/verify_client` | `1` | Accept client certificates |
| `login/certificate_mapping_rulebased` | `1` | Enable CERTRULE mapping |

## Step 4: Configure ARC-1

```bash
export SAP_BTP_DESTINATION=SAP_TRIAL
export SAP_BTP_PP_DESTINATION=SAP_TRIAL_PP
export SAP_PP_ENABLED=true
# Recommended production topology: accept only JWT-backed per-user tool calls.
export SAP_PP_STRICT=true
```

### Behavior

- **JWT request** → ARC-1 uses the per-user destination (`SAP_BTP_PP_DESTINATION`), passing the JWT as `X-User-Token`
- **PP failure** → returns error, no fallback to a different SAP identity
- **API key / non-JWT request** → rejected because `SAP_PP_STRICT=true` is explicit

For automation that requires API keys, a separate ARC-1 instance with `SAP_PP_ENABLED=false` and a
least-privileged technical SAP identity is recommended. It is not mandatory: set
`SAP_PP_STRICT=false` for supported mixed operation, where JWT calls use PP and API-key calls use the
shared SAP identity.

## Cloud targets: S/4HANA Public Cloud & BTP ABAP (no Cloud Connector)

The Steps above describe **on-premise** propagation via the Cloud Connector (destination type
`PrincipalPropagation`). For **cloud** targets reached over the Internet, there is no Cloud Connector
— ARC-1 connects directly and the per-user identity rides in the destination's auth token. Pick the
destination `Authentication` type the target supports:

| Target | Destination `Authentication` | `ProxyType` | Per-user credential ARC-1 sends |
|--------|------------------------------|-------------|---------------------------------|
| **S/4HANA Public Cloud** (developer extensibility) | `SAMLAssertion` | `Internet` | `Authorization: SAML2.0 …` + `x-sap-security-session: create` — the **same flow BAS uses** |
| S/4HANA Public Cloud / BTP ABAP (OAuth client configured) | `OAuth2SAMLBearerAssertion` | `Internet` | `Authorization: Bearer …` |
| BTP ABAP, same subaccount | `OAuth2UserTokenExchange` | `Internet` | `Authorization: Bearer …` |

For all of these you only need the **Destination + XSUAA** service instances bound (no Connectivity
service / Cloud Connector). ARC-1 detects `ProxyType: Internet` and connects directly — the
connectivity proxy is used **only** for `OnPremise` destinations.

For the full **S/4HANA Public Cloud** walkthrough (the `SAMLAssertion` destination + S/4HC SAML trust,
identical to the BAS setup, plus ARC-1 configuration), see the dedicated guide:
**[SAP S/4HANA Public Cloud Setup](s4hana-public-cloud.md)**.

> `OAuth2SAMLBearerAssertion` is SAP's *recommended* alternative (the SDK warns about raw
> `SAMLAssertion`), but it needs an OAuth 2.0 client/communication arrangement on the S/4HC side.
> `SAMLAssertion` reuses the SAML trust BAS already established, so it's usually the lower-config path.
> Either way, keep `SAP_DISABLE_SAML` **unset/false** — never disable SAML on S/4HANA Public Cloud.

!!! warning "JWT principal propagation always fails closed"
    With `SAP_PP_ENABLED=true`, a JWT request never falls back to the shared service account after a PP error. `SAP_PP_STRICT=false` enables supported shared-client access for API-key / non-JWT requests; it does not change the identity of a failed JWT request. Separate PP-only and API-key instances are recommended, not required.

### All PP-related config

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--pp-enabled` | `SAP_PP_ENABLED` | `false` | Enable principal propagation |
| `--pp-strict` | `SAP_PP_STRICT` | `true` when PP is enabled | JWT PP errors always fail closed. Explicit `true` gives the recommended strict topology and rejects API-key / non-JWT tool calls. Explicit `false` enables supported mixed mode for non-JWT calls but never enables JWT fallback. |
| `--pp-allow-shared-cookies` | `SAP_PP_ALLOW_SHARED_COOKIES` | `false` | Escape hatch — allow cookies to coexist with PP (cookies stay on shared client only) |
| — | `SAP_BTP_DESTINATION` | — | Shared destination for startup work and API-key calls in mixed mode |
| — | `SAP_BTP_PP_DESTINATION` | — | Per-user PP destination name |

> **Auth safety (SEC-09):** ARC-1 fails fast at startup if `SAP_PP_ENABLED=true` is combined with `SAP_COOKIE_FILE` / `SAP_COOKIE_STRING` — per-user sessions must not inherit a shared cookie. Set `SAP_PP_ALLOW_SHARED_COOKIES=true` only if you accept that the cookie stays on the shared client used for API-key calls in mixed mode. Per-user auth never inherits shared Basic/cookie credentials. See [Coexistence Matrix](enterprise-auth.md#coexistence-matrix).

## Step 5: Test

1. **Check logs** after a JWT-authenticated request:
   ```bash
   cf logs arc1-mcp-server --recent | grep -E "Principal propagation|per-user|BTP destination"
   ```

2. **Check SAP** for per-user identity:
   - Transaction `SM20` (security audit log) — verify the individual SAP user appears
   - Transaction `SM04` (user sessions) — check for per-user sessions

## Troubleshooting

### JWT request unexpectedly uses a shared SAP user

Current ARC-1 releases never route a failed JWT principal-propagation request through the shared client. If a request appears under the shared SAP user, first verify that the MCP client actually authenticated with a JWT rather than an API key in supported mixed mode.

1. Verify `SAP_PP_ENABLED=true` is set
2. Verify `SAP_BTP_PP_DESTINATION` authentication type is `PrincipalPropagation` in BTP Cockpit
3. Check Cloud Connector logs for principal propagation errors
4. Verify the JWT contains a valid user identity

### SAP returns 401 for propagated user

1. **Check STRUST:** Is the Cloud Connector system cert in the certificate list?
2. **Check ICM:** Is `icm/HTTPS/verify_client = 1`?
3. **Check certificate mapping:** Does CERTRULE or VUSREXTID map the certificate subject to a valid SAP user?
4. **Check user exists:** Does the SAP user exist and is it unlocked?

### Cloud Connector issues

1. Check Cloud Connector logs (All/Payload trace)
2. Verify `icm/trusted_reverse_proxy` parameter matches Cloud Connector system certificate
3. Ensure principal propagation is enabled in Cloud Connector access control

## What's NOT supported

ARC-1 does **not** support local ephemeral X.509 certificate generation. The following flags do not exist:

- `--pp-ca-key`, `--pp-ca-cert`, `--pp-cert-ttl`
- `--client-cert`, `--client-key`
- `--oidc-username-claim`, `--oidc-user-mapping`

Principal propagation is exclusively via BTP Destination Service + Cloud Connector.

## SAP Documentation References

- [Authenticating Users Against On-Premise Systems](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/authenticating-users-against-on-premise-systems) — Principal Propagation via Cloud Connector
- [Setting Up Trust Between Identity Provider and SAP](https://help.sap.com/docs/btp/sap-business-technology-platform/principal-propagation) — BTP principal propagation overview
- [CERTRULE - Rule-Based Certificate Mapping (SAP Note 2275087)](https://me.sap.com/notes/2275087) — Rule-based certificate-to-user mapping
- [Cloud Connector - Principal Propagation](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/configuring-principal-propagation) — Cloud Connector principal propagation setup
- [Routing via Destination (BTP ABAP Environment)](https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/97d7a02cd6fd4f579fd96f41ee0d0c1d.html) — same subaccount → `OAuth2UserTokenExchange`; different subaccounts → `OAuth2SAMLBearerAssertion`

> This page covers **on-premise** principal propagation via Cloud Connector. For a **cloud-to-cloud** BTP ABAP Environment (no Cloud Connector), see [btp-abap-environment.md](btp-abap-environment.md) — including the [cross-subaccount caveat](btp-abap-environment.md#cross-subaccount-principal-propagation-fails).
