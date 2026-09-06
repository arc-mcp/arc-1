# Principal Propagation Setup

Authenticate each MCP user's SAP requests with their own identity via BTP Destination Service and
Cloud Connector. Multi-target PP-only deployments need no shared SAP password. The current
single-target `/mcp` topology additionally uses one least-privileged Basic destination for startup
target resolution and feature discovery; authenticated tool calls remain PP-only and never fall back
to that identity.

## When to Use

- Enterprise environments requiring per-user SAP authorization
- Compliance/audit requirements (who did what in SAP)
- When different users should have different SAP permissions
- Multi-target PP-only deployments where no shared startup identity is required

## Architecture

```
MCP Client (JWT)
  │
  ▼
ARC-1 (/mcp or a multi-target route)
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

The diagram shows an authenticated tool request. For single-target `/mcp`, the separate Basic
startup destination establishes URL/client configuration before an end-user JWT exists. It is not
part of this request path and is never a fallback after PP failure.

## Prerequisites

- JWT-based MCP auth working ([OIDC setup](oauth-jwt-setup.md) or [XSUAA setup](xsuaa-setup.md))
- ARC-1 deployed on BTP Cloud Foundry
- Destination + Connectivity service instances bound to ARC-1 app
- Cloud Connector connected to your BTP subaccount
- SAP system reachable from Cloud Connector

## Fast Path: Repeat This for Each SAP System

Principal propagation has several layers, but the repeatable setup is short when they are configured
in this order:

| Step | Configure | Completion signal |
|------|-----------|-------------------|
| 1 | Choose one stable Cloud Connector virtual host/port and one stable internal SAP DNS name/HTTPS port. | The SAP server certificate contains the internal DNS name in its DNS SANs. |
| 2 | In Cloud Connector, configure the system certificate, CA certificate, identity-provider trust, and a subject pattern such as `CN=${email}`. | A sample certificate for a real user contains the expected subject and issuer. |
| 3 | Add an HTTPS mapping with strict user-certificate propagation and expose `/sap/bc/adt` with all sub-paths. | Cloud Connector's internal connection check succeeds without system-certificate fallback. |
| 4 | In SAP, trust the Cloud Connector system-certificate issuer and user-certificate CA in the active SSL Server Standard PSE. | The certificates remain present after an ICM or system restart. |
| 5 | Enable the effective client-certificate and trusted-reverse-proxy profile settings supported by that SAP kernel. | ICM starts without unknown or inactive profile parameters. |
| 6 | Maintain the user's exact propagated e-mail address in SU01. | The value exactly matches the e-mail claim, including spelling. |
| 7 | In CERTRULE, map the sample certificate's Subject/CN to E-Mail and restrict the rule to the Cloud Connector CA issuer. | CERTRULE shows both **Certificate mapped with rule ...** and **Mapped email exists**, with the intended SAP user. |
| 8 | Create the subaccount `PrincipalPropagation` destination and, for multi-target mode, add the ARC-1 properties. For single-target `/mcp`, also create its explicitly named least-privileged Basic startup destination. | The saved URL exactly matches the Cloud Connector virtual host/port and the client is explicit. |
| 9 | Restart ARC-1 so it discovers the destination, then call `SAPRead SYSTEM`. | The response identifies the human SAP user rather than a technical user. |

One Cloud Connector CA and subject pattern can serve several SAP systems. Each SAP system still needs
its own HTTPS trust, ICM/profile settings, CERTRULE mapping, and SAP users. Each SAP system/client also
needs its own BTP destination and Cloud Connector mapping.

### Known-Good Route Shape

The virtual and internal names serve different purposes and do not need to be equal:

```text
BTP destination URL:  http://s4d-pp:50101
                            │ virtual host/port
Cloud Connector:      s4d-pp:50101
                            │ HTTPS + X509_RESTRICTED
SAP internal endpoint: s4d.internal.example:50001
SAP HTTPS certificate: DNS SAN = s4d.internal.example
```

The BTP destination URL may use `http://` because it addresses the Cloud Connector virtual mapping.
The connection from Cloud Connector to SAP must use HTTPS so the propagated client certificate can
be presented and verified.

## Step 1: Create the BTP Destination

Create a subaccount destination in BTP Cockpit (**Connectivity > Destinations**) for every SAP
system/client that needs per-user access:

| Property | Value |
|----------|-------|
| Name | `ARC1_A4H_100_PP` (your choice) |
| Type | HTTP |
| URL | `http://<cloud-connector-virtual-host>:<virtual-port>` |
| Proxy Type | OnPremise |
| Authentication | PrincipalPropagation |
| `sap-client` | SAP client, for example `100` |

For [multi-target v1](multi-target-setup.md), also set `sap-sysid`, `Description`, and
`arc1.enabled=true`. One PP destination per system/client is sufficient; a Basic-auth technical-user
destination is not required.

For the current single-target on-premise `/mcp` runtime, configure both
`SAP_BTP_DESTINATION=<least-privileged-startup-destination>` and
`SAP_BTP_PP_DESTINATION=<principal-propagation-destination>`. The startup destination supplies the
URL/client and supports feature discovery before a JWT exists. With `SAP_PP_ENABLED=true` and
`SAP_PP_STRICT=true`, authenticated tool calls use only the PP destination; a PP failure never falls
back to the startup user. See [BTP Destination Reference](btp-destination-setup.md#per-user-pp-mcp).

## Step 2: Configure Cloud Connector

1. Connect Cloud Connector to the same BTP subaccount and synchronize the subaccount's identity
   provider under **Principal Propagation**. Mark the intended identity provider as trusted.
2. Under **Configuration > On-Premises**, configure two different certificates:
   - the **system certificate**, which authenticates Cloud Connector as the trusted reverse proxy;
   - the **CA certificate**, which signs the short-lived per-user certificates.
3. Add a subject-pattern rule, for example `CN=${email}`, and generate a sample certificate for a
   real user. Use a claim that is present and stable in every accepted XSUAA user token.
4. Add the system mapping whose virtual host/port exactly matches the BTP destination. The cloud-side
   URL may be HTTP, but the mapping's internal connection to SAP must be HTTPS.
5. Select strict X.509 user-certificate propagation without system-certificate fallback. On newer
   Cloud Connector versions, select **X.509 Certificate** and do not allow the system certificate
   for user logon. On older versions, select **X.509 Certificate (strict usage)**, sometimes
   represented internally as `X509_RESTRICTED`. The general mode permits fallback to the system
   certificate and is not appropriate for ARC-1 PP routes.
6. Make the SAP HTTPS certificate valid for the mapping's internal host name. Prefer a DNS name that
   appears in the certificate's DNS SANs: some Cloud Connector hostname-validation paths do not
   accept an IP SAN when the internal host is an IP literal. Do not solve a name mismatch by disabling
   backend certificate checks.

### Required Cloud Connector Resource Paths

If you use restrictive Cloud Connector resource whitelisting, expose at least these paths:

| URL Path | Access Policy | Purpose |
|----------|---------------|---------|
| `/sap/bc/adt` | Path and all sub-paths | ADT API used by ARC-1 core read/write operations |
| `/sap/opu/odata/UI2/PAGE_BUILDER_CUST` | Path and all sub-paths | FLP launchpad management via `SAPManage` FLP actions |
| `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` | Path and all sub-paths | UI5 ABAP Repository OData (BSP deploy metadata) |

Use `/sap/bc/adt` with **Path and all sub-paths** for multi-target v1. Add the optional OData paths
only when those features are enabled. Avoid exposing `/` unless another documented integration needs
it.

## Step 3: Configure SAP System

The SAP system must trust Cloud Connector's certificates and map them to SAP users.

### Certificate trust (STRUST)

In the SAP **SSL Server Standard** PSE, import the trust anchors needed for both parts of the flow:

1. the issuer of the Cloud Connector system certificate (or the system certificate itself when it is
   self-signed); and
2. the Cloud Connector CA certificate that signs the short-lived user certificate.

Save the PSE and verify the active ICM process uses it. A container image or startup job may recreate
the PSE during restart; if so, make the repair persistent and test again after a real restart.

### Certificate mapping (CERTRULE or VUSREXTID)

Configure how the certificate's subject is mapped to a SAP user:

- **CERTRULE** (transaction `/nCERTRULE`): Rule-based mapping (for example, subject CN to the user's
  e-mail address)
- **VUSREXTID** (table `VUSREXTID` via SM30): Explicit user-to-certificate subject mapping

For `CN=${email}`, every SAP user needs the exact same e-mail value in SU01. Import the sample user
certificate into CERTRULE and test the rule there before testing ARC-1.

For the common `CN=${email}` setup, the CERTRULE rule is:

| CERTRULE field | Value |
|----------------|-------|
| Certificate Entry | Subject |
| Certificate Attribute | CN |
| Logon As | E-Mail |
| Subject Filter | `CN=*` |
| Issuer Filter | The exact issuer DN of the Cloud Connector user-certificate CA |

Save the rule, select the imported sample certificate, and confirm that CERTRULE resolves it to the
intended SAP user. Do not create an issuer-free catch-all `CN=*` rule: it could allow certificates
from an unrelated trusted CA to participate in SAP-user mapping.

### ICM parameters

Verify these profile parameters (transaction `/nRZ10`):

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `icm/HTTPS/verify_client` | `1` | Accept client certificates |
| HTTPS `icm/server_port_<n>` | `..., VCLIENT=1` | Ask Cloud Connector for a client certificate |
| `login/certificate` | `1` | Enable certificate logon |
| `login/certificate_mapping` | `1` | Enable certificate-to-user mapping |
| `login/certificate_mapping_rulebased` | `1` | Enable CERTRULE mapping |
| `icm/trusted_reverse_proxy_<n>` | Exact system-certificate subject and issuer | Trust `SSL_CLIENT_CERT` only from Cloud Connector |

Validate the profile against the target kernel instead of copying every parameter blindly. The
SAP_BASIS 750 SP02 test system, for example, reports `login/certificate` and
`login/certificate_mapping` as unknown; omit those two there. It accepts and uses `VCLIENT=1`,
`icm/HTTPS/verify_client=1`, `login/certificate_mapping_rulebased=1`, and the trusted-reverse-proxy
entry. Do not leave unknown compatibility parameters in the profile.

The reverse-proxy DN must match exactly, including separators and spaces expected by the ABAP kernel.
Do not make SSL-certificate logon mandatory solely for ARC-1 or replace existing ICF logon procedures;
single-target applications may still depend on Basic authentication. No SICF change was required on
the live-verified SAP_BASIS 758 and 816 systems, and the 750 setup also preserved its existing ICF
procedures. If SAP still returns `401` after Cloud Connector has generated the user certificate,
verify that the affected ICF service permits **Logon with SSL Certificate** while preserving the
existing compatible procedures.

## Step 4: Configure ARC-1

```bash
export SAP_BTP_DESTINATION=SAP_TRIAL
export SAP_BTP_PP_DESTINATION=SAP_TRIAL_PP
export SAP_PP_ENABLED=true
# Recommended production topology: accept only JWT-backed per-user tool calls.
export SAP_PP_STRICT=true
```

For multi-target v1, destination discovery replaces both destination-name variables. Enable
`ARC1_MULTI_TARGET_ENDPOINTS=true`, set `ARC1_CACHE=none`, and mark each PP destination with
`arc1.enabled=true`. Discovered PP targets force strict per-user PP independently.
`SAP_PP_ENABLED` and `SAP_PP_STRICT` govern only an optional side-by-side single-target `/mcp`; the
safe values in the base MTA are inert when that endpoint is not configured.

### What Must Be Restarted?

| Change | Required action |
|--------|-----------------|
| Add/remove a destination or change its `arc1.*`, route, client, or description properties | Restart the ARC-1 CF application. Multi-target discovery occurs at startup. No rebuild or redeployment is required. |
| Change a Cloud Connector mapping, resource allowlist, identity-provider trust, or subject pattern | Retry after saving the Cloud Connector configuration; an ARC-1 restart is not required. |
| Change SU01 e-mail or CERTRULE/VUSREXTID mapping | Retry immediately after saving; an ARC-1 restart is not required. |
| Change STRUST certificate trust | Save the PSE and ensure the active ICM process has loaded it. An ICM reload/restart may be required. |
| Change ICM or SAP profile parameters | Activate the profile and restart the affected ICM/SAP instance as required by that parameter. |

This separation makes later systems quick to add: deploy ARC-1 once, finish each SAP/Cloud Connector
setup independently, create its destination, and restart the CF application once after the destination
set is ready.

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

Test one boundary at a time. A successful Destination Service response or ARC-1
`auth_pp_created` log proves that the per-user client was created, but not yet that SAP accepted the
certificate.

1. **Before ARC-1**, verify both infrastructure checks:
   - Cloud Connector's internal connection check succeeds without a hostname or trust error.
   - The generated sample certificate maps to the intended user in CERTRULE.

2. **Check logs** after a JWT-authenticated request:
   ```bash
   cf logs arc1-mcp-server --recent | grep -E "Principal propagation|per-user|BTP destination"
   ```

3. **Check SAP** for per-user identity:
   - Transaction `SM20` (security audit log) — verify the individual SAP user appears
   - Transaction `SM04` (user sessions) — check for per-user sessions

4. Run this short MCP smoke-test ladder for every target:
   1. `SAPRead` with `type: "SYSTEM"` — must identify the propagated human user.
   2. `SAPRead` with `type: "COMPONENTS"` — proves a normal ADT read.
   3. `SAPSearch` for a known object — proves a POST-style ADT read.
   4. Optionally test table data or SQL only when the destination explicitly enables those scopes.

Use the failure boundary to avoid changing unrelated layers:

| Observed result | Proven boundary | Next check |
|---|---|---|
| Connectivity/Cloud Connector `502` with invalid server certificate | User mapping was not reached | Fix the SAP HTTPS certificate and internal-host match |
| SAP `401` after Cloud Connector generated a user certificate | Network and token-to-certificate conversion work | Check STRUST, trusted reverse proxy, ICF logon, CERTRULE, and SU01 |
| SAP `403` after successful logon | Authentication worked | Check the propagated user's SAP authorizations |
| `SAPRead SYSTEM` returns the human identity | End-to-end PP works | Verify audit logs and the intended read/data/SQL authorization |

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
