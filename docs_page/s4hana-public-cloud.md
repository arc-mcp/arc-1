# SAP S/4HANA Cloud Public Edition setup

<a id="sap-s4hana-public-cloud-setup"></a>

Connect ARC-1 to S/4HANA Cloud Public Edition **developer extensibility** with each user's own SAP identity. ARC-1 runs on BTP Cloud Foundry and uses a `SAMLAssertion` destination. Basic auth and local service-key login are unsupported for this target.

If SAP Business Application Studio already connects to this system, reuse its SAML destination. Otherwise follow the trust and destination steps below. Leave `SAP_DISABLE_SAML` unset or false.

## How it works

```text
MCP user → XSUAA → ARC-1 → Destination user assertion → S/4HANA Cloud user
```

Destination Service supplies a per-user SAML assertion. ARC-1 sends it directly over HTTPS with `x-sap-security-session: create`, then reuses SAP's session cookie. No Cloud Connector is required.

## Prerequisites

- A BTP subaccount with Cloud Foundry, XSUAA and Destination quota, plus the [deployment runbook prerequisites](btp-cloud-foundry-deployment.md#3-prepare-the-landscape).
- A business user for each MCP user, with matching email and developer-extensibility authorization.
- BTP Destination and S/4HANA Communication Management administrators for trust setup.

## Step 1: Establish SAML trust on S/4HANA Cloud

This is identical to the BAS connection setup — follow the SAP tutorial
[Connect SAP Business Application Studio and SAP S/4HANA Cloud System](https://developers.sap.com/tutorials/abap-custom-ui-bas-connect-s4hc.html).
Summary:

1. **BTP subaccount → Connectivity → Destination Trust**: choose **Generate Trust** (if no trust
   certificate exists yet), then **Export** the subaccount's signing certificate (PEM).
2. **S/4HANA Cloud → Communication Systems** app: create a system (e.g. `BAS_<subaccount-subdomain>`):
   - **General → Technical Data**: enable **Inbound Only**.
   - **General → Identity Provider / OAuth 2.0 / SAML**: set **SAML Bearer Assertion Provider** to **ON**, upload the exported BTP certificate, and set the **SAML Bearer Issuer** to the certificate's Subject CN.

These trust steps do not create a communication arrangement or communication user. The assertion carries the human user's email. The SAP tutorial demonstrates the BAS connection; ARC-1 additionally needs the developer-extensibility ADT access listed above.

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

Enable **Use default JDK truststore** for public TLS certificates. If reusing a BAS destination, keep its `HTML5.*` and `WebIDE*` properties; ARC-1 ignores those BAS hints.

<a id="step-3-bind-btp-services"></a>

## Step 3: Prepare the ARC-1 checkout

Complete [deployment steps 1–3](btp-cloud-foundry-deployment.md#1-choose-the-topology-before-configuring-anything), then clone the source and run `npm ci` as shown at the start of step 4. Return here to create the cloud extension below; do not select an on-premise profile. The MTA will bind XSUAA and Destination during deployment. The Internet connection does not need Connectivity or Cloud Connector; the base MTA's Connectivity binding is harmless.

## Step 4: Configure ARC-1

For a new deployment, create `mta-overrides.mtaext` below. For an existing deployment, merge the properties into its protected extension:

```yaml
_schema-version: "3.1"
ID: arc1-mcp-overrides
extends: arc1-mcp

modules:
  - name: arc1-mcp-server
    properties:
      SAP_SYSTEM_TYPE: btp
      SAP_TRANSPORT: http-streamable
      SAP_XSUAA_AUTH: "true"
      SAP_PP_ENABLED: "true"
      SAP_PP_STRICT: "true"
      SAP_BTP_DESTINATION: <SYSTEM_ID>_SAML_ASSERTION
      SAP_BTP_PP_DESTINATION: <SYSTEM_ID>_SAML_ASSERTION
      SAP_ALLOW_WRITES: "false"
      SAP_ALLOW_DATA_PREVIEW: "false"
      SAP_ALLOW_FREE_SQL: "false"
      SAP_ALLOW_TRANSPORT_WRITES: "false"
      SAP_ALLOW_GIT_WRITES: "false"
```

`SAP_BTP_DESTINATION` initializes ARC-1's BTP runtime at startup; setting only `SAP_BTP_PP_DESTINATION` is insufficient. Both names above intentionally refer to the same cloud destination.

Continue at [deployment step 5](btp-cloud-foundry-deployment.md#5-validate-build-and-inspect-the-mtar) for validation, archive inspection and deployment, then complete the DCR and role checks. `ProxyType=Internet` routes directly to SAP even if the app has a Connectivity binding.

## Step 5: Grant users access

1. **BTP** — assign each MCP user a role collection granting the ARC-1 scopes they need (start with `ARC-1 Viewer (<space>)`); XSUAA only issues a token for scopes the user actually holds.
2. **S/4HANA Cloud** — the matching business user (same email as the JWT) must hold a business role with **developer extensibility / ABAP development** authorization. Without it, ADT calls fail with a logon/authorization error even though the SAML assertion is accepted.

## What to expect (ABAP Cloud)

Developer extensibility uses ABAP Cloud language rules, released APIs and ADT access. SAP standard tables remain unavailable to `SAPQuery`; use released CDS entities. `SAP_SYSTEM_TYPE=btp` selects the cloud tool catalog from startup. See [ABAP Cloud behavior](btp-abap-environment.md#what-to-expect-on-btp-abap).

## Verification

1. Sign in as the Viewer test user and call `SAPRead` with `type: "COMPONENTS"`, then search for a known object.
2. In the app logs, check `auth_pp_created` with `success:true`; `SAP_VERBOSE=true` enables debug logs that can also show `hasSamlAssertion:true`.
3. Have the SAP administrator verify the actual business user for that request using the system's supported audit logs.

Record safe-read access and backend identity separately. An exchange-success log or `SYSTEM.user` does not establish which user SAP accepted.

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
