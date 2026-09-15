# Principal Propagation Setup

Configure **on-premise SAP access as each MCP user's own SAP user** through BTP Destination Service and Cloud Connector. Complete this with the Connector, Basis and IAM owners, then verify one live request's identity.

For cloud targets, use [BTP ABAP Environment](btp-abap-environment.md) or [S/4HANA Public Cloud](s4hana-public-cloud.md). For application deployment, use the [Cloud Foundry runbook](btp-cloud-foundry-deployment.md).

## When to Use

Use PP when SAP must apply each human's permissions and record their identity. Multi-target PP needs no startup password. Single-target on-premise `/mcp` uses a separate least-privileged Basic destination for startup discovery only; failed user requests never fall back to it.

## Architecture

```text
User JWT → ARC-1 → Destination → Connectivity → Cloud Connector
                                                   ↓ user certificate
                                              SAP ICM → SAP user
```

The Connector signs a short-lived user certificate. SAP trusts its issuer and maps the certificate subject through CERTRULE or VUSREXTID.

## Prerequisites

- ARC-1 on Cloud Foundry with JWT login and Destination/Connectivity bindings.
- XSUAA for multi-target routes; [XSUAA](xsuaa-setup.md) or supported [OIDC](oauth-jwt-setup.md) for single-target login.
- Cloud Connector attached to the intended subaccount and able to reach SAP.
- An agreed SAP system/client, test-user identity and expected backend username; record them in the [worksheet](btp-setup-worksheet.md).

## Fast Path: Repeat This for Each SAP System

Follow steps 1–5 below: destination, Connector trust, SAP mapping, ARC-1 configuration and verification. A Connector CA can serve several systems, but each SAP system needs its own trust/mapping and each client needs the intended users and destination.

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

Create the [PP destination](btp-destination-setup.md#per-user-pp-mcp) with:

```properties
Name=ARC1_A4H_100_PP
Type=HTTP
URL=http://<connector-virtual-host>:<virtual-port>
ProxyType=OnPremise
Authentication=PrincipalPropagation
sap-client=100
```

For multi-target mode, also set `sap-sysid`, a factual `Description` and `arc1.enabled=true`. One destination per system/client is sufficient.

For single-target on-premise `/mcp`, also create the separate [Basic startup destination](btp-destination-setup.md#per-user-pp-mcp). It supplies startup URL/client and feature discovery before a user JWT exists; it is not a fallback identity.

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

Expose `/sap/bc/adt` with **Path and all sub-paths**. Add optional UI5/FLP OData paths only for enabled single-target features; use the [path reference](btp-destination-setup.md#cloud-connector-url-path-reference). Do not expose `/` to bypass an access error.

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

Test with the **sample end-user certificate** from the Connector serving this target. Check its subject and issuing CA; the system, CA and SAP server certificates serve different purposes. In the intended SAP client, confirm it maps to the expected backend username. This proves mapping, not the identity of a live ARC-1 request.

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

Confirm supported parameters for the target kernel. SAP_BASIS 750 SP02, for example, rejects `login/certificate` and `login/certificate_mapping`; it uses `VCLIENT=1`, `icm/HTTPS/verify_client=1`, rule-based mapping and the trusted-proxy entry.

Match the reverse-proxy subject/issuer DN exactly. Preserve existing ICF logon procedures, including Basic where required. If SAP returns 401 after certificate generation, verify that the ADT service permits **Logon with SSL Certificate**; do not make certificate logon mandatory for unrelated clients.

## Step 4: Configure ARC-1

For single-target on-premise `/mcp`, set these properties in the customer `.mtaext`:

```yaml
SAP_BTP_DESTINATION: SAP_STARTUP
SAP_BTP_PP_DESTINATION: SAP_PP
SAP_PP_ENABLED: "true"
SAP_PP_STRICT: "true"
```

Use the actual destination names and follow the [single-PP deployment profile](btp-cloud-foundry-deployment.md#single-target-read-only-pp-profile).

For multi-target PP, use [the multi-PP profile](btp-cloud-foundry-deployment.md#multi-target-pp-only-profile) and destination markers. Discovered PP targets always enforce strict per-user access; the single-target destination-name variables remain absent unless `/mcp` is configured separately.

### What Must Be Restarted?

| Change | Required action |
|--------|-----------------|
| Add/remove a destination or change its `arc1.*`, route, client, or description properties | Restart the ARC-1 CF application. Multi-target discovery occurs at startup. No rebuild or redeployment is required. |
| Change a Cloud Connector mapping, resource allowlist, identity-provider trust, or subject pattern | Retry after saving the Cloud Connector configuration; an ARC-1 restart is not required. |
| Change SU01 e-mail or CERTRULE/VUSREXTID mapping | Retry immediately after saving; an ARC-1 restart is not required. |
| Change STRUST certificate trust | Save the PSE and ensure the active ICM process has loaded it. An ICM reload/restart may be required. |
| Change ICM or SAP profile parameters | Activate the profile and restart the affected ICM/SAP instance as required by that parameter. |

### Behavior

- **JWT request** → ARC-1 uses the per-user destination (`SAP_BTP_PP_DESTINATION`), passing the JWT as `X-User-Token`
- **PP failure** → returns error, no fallback to a different SAP identity
- **API key / non-JWT request** → rejected because `SAP_PP_STRICT=true` is explicit

For automation that requires API keys, a separate ARC-1 instance with `SAP_PP_ENABLED=false` and a
least-privileged technical SAP identity is recommended. It is not mandatory: set
`SAP_PP_STRICT=false` for supported mixed operation, where JWT calls use PP and API-key calls use the
shared SAP identity.

## Cloud targets: S/4HANA Public Cloud & BTP ABAP (no Cloud Connector)

Cloud targets use Internet destinations and do not need Cloud Connector:

| Target | Authentication | Guide |
|---|---|---|
| BTP ABAP, same subaccount | `OAuth2UserTokenExchange` | [ABAP Environment](btp-abap-environment.md) |
| S/4HANA Public Cloud | `SAMLAssertion` | [Public Cloud](s4hana-public-cloud.md) |
| Supported cross-subaccount trust | `SAMLAssertion` / `OAuth2SAMLBearerAssertion` | [Cross-subaccount requirements](btp-abap-environment.md#cross-subaccount-principal-propagation-fails) |

Leave `SAP_DISABLE_SAML` unset or false for these targets.

### All PP-related config

See the [configuration reference](configuration-reference.md) for `SAP_PP_ENABLED`, `SAP_PP_STRICT` and `SAP_PP_ALLOW_SHARED_COOKIES`, and the [authentication coexistence matrix](enterprise-auth.md#coexistence-matrix).

Shared cookies are refused with PP unless the explicit single-target escape hatch is enabled. Per-user requests never inherit shared Basic credentials or cookies.

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

3. Run this short MCP smoke-test ladder for every target:
   1. `SAPRead` with `type: "SYSTEM"` — checks discovery access; its user field is not SAP login evidence.
   2. `SAPRead` with `type: "COMPONENTS"` — proves a normal ADT read.
   3. `SAPSearch` for a known object — verifies repository search access.
   4. Verify the [backend identity](#verify-the-backend-identity) for the request. Test data/SQL separately only when explicitly enabled and needed.

Use the failure boundary to avoid changing unrelated layers:

| Observed result | Proven boundary | Next check |
|---|---|---|
| Connectivity/Cloud Connector `502` with invalid server certificate | User mapping was not reached | Fix the SAP HTTPS certificate and internal-host match |
| SAP `401` after Cloud Connector generated a user certificate | Network and token-to-certificate conversion work | Check STRUST, trusted reverse proxy, ICF logon, CERTRULE, and SU01 |
| SAP `403` after successful logon | Authentication worked | Check the propagated user's SAP authorizations |
| `SAPRead SYSTEM` succeeds | ADT discovery is readable | Correlate the live request with SAP user/client evidence below |

### Verify the backend identity

`SAPRead(SYSTEM).user` is populated from configured identity or token claims. It is not a SAP
who-am-I response. CERTRULE's green result proves sample-certificate mapping, not which identity a
live ARC-1 request used.

1. Agree the expected SAP username/client with Basis and record the application test identity.
2. Run one known-object read through the selected ARC-1 endpoint/target. Record its time/time zone,
   target, outcome and request correlation ID if available; keep tokens out of the record.
3. Ask Basis to correlate that request with SAP-side evidence showing the actual username and
   client. Where the relevant events are already recorded, use
   [SM20 audit analysis](https://help.sap.com/saphelp_em92/helpdata/en/4d/41bcc4aa601c86e10000000a42189b/content.htm)
   with a narrow time/user selection and inspect the matching logon details. A same-user SAP GUI
   session or unrelated event is not enough. Audit coverage depends on the system's configured
   [event filters](https://help.sap.com/docs/ABAP_PLATFORM_NEW/025d1fb2f02c42c097f04f45df09106a/4d42b2f89b88122be10000000a42189b.html);
   no matching event is inconclusive, not proof of failed PP.
4. If the existing evidence cannot identify the request, record identity as **unverified** and ask
   Basis for an approved, scoped verification method. Do not enable broad tracing, grant SAP_ALL,
   create an ABAP helper, or widen data/SQL access as an automatic setup step.

Repeat for each client. Keep safe-read success, backend identity and negative-access results
separate in the acceptance record.

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

Check Connector status/logs, mapping host/port, trusted identity provider, required resource paths and the SAP `icm/trusted_reverse_proxy` subject/issuer. Request scoped diagnostics from the owner if ordinary logs do not explain the failure.

## What's NOT supported

ARC-1 does **not** support local ephemeral X.509 certificate generation. The following flags do not exist:

- `--pp-ca-key`, `--pp-ca-cert`, `--pp-cert-ttl`
- `--client-cert`, `--client-key`
- `--oidc-username-claim`, `--oidc-user-mapping`

On-premise principal propagation uses BTP Destination Service and Cloud Connector; cloud propagation uses destination-provided tokens/assertions.

## SAP Documentation References

- [Authenticating Users Against On-Premise Systems](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/authenticating-users-against-on-premise-systems) — Principal Propagation via Cloud Connector
- [Setting Up Trust Between Identity Provider and SAP](https://help.sap.com/docs/btp/sap-business-technology-platform/principal-propagation) — BTP principal propagation overview
- [CERTRULE - Rule-Based Certificate Mapping (SAP Note 2275087)](https://me.sap.com/notes/2275087) — Rule-based certificate-to-user mapping
- [Cloud Connector - Principal Propagation](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/configuring-principal-propagation) — Cloud Connector principal propagation setup
- [Routing via Destination (BTP ABAP Environment)](https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/97d7a02cd6fd4f579fd96f41ee0d0c1d.html) — same subaccount → `OAuth2UserTokenExchange`; different subaccounts → `OAuth2SAMLBearerAssertion`

> This page covers **on-premise** principal propagation via Cloud Connector. For a **cloud-to-cloud** BTP ABAP Environment (no Cloud Connector), see [btp-abap-environment.md](btp-abap-environment.md) — including the [cross-subaccount caveat](btp-abap-environment.md#cross-subaccount-principal-propagation-fails).
