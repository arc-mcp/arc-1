# BTP Destination Reference

Use this page to choose and configure the BTP destination consumed by ARC-1. It is a property
reference, not a second Principal Propagation procedure. For Cloud Connector certificates, SAP
trust, CERTRULE, SU01, ICM/SICF, and end-to-end testing, follow
[Principal Propagation Setup](principal-propagation-setup.md).

For the ordered application deployment, start with
[BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md). For experimental many-system
routing, follow [Multi-System Setup](multi-target-setup.md).

## Authentication modes

| Destination/auth mode | SAP identity | Proxy | Recommended use |
|---|---|---|---|
| `BasicAuthentication` | Shared technical SAP user | Usually `OnPremise` | Single-target startup/shared operation; default-off multi-target exception |
| `PrincipalPropagation` | Human XSUAA user mapped to SAP | `OnPremise` | Recommended on-premise per-user path |
| `OAuth2UserTokenExchange` | Human user exchanged into BTP ABAP | `Internet` | Same-subaccount BTP ABAP Environment |
| `OAuth2SAMLBearerAssertion` | Human user exchanged through configured trust | `Internet` | Supported cloud/cross-subaccount topology |
| `SAMLAssertion` | Human user through the destination's SAML assertion | `Internet` | S/4HANA Public Cloud setup described in its guide |

Multi-target v1 accepts only `OnPremise` `PrincipalPropagation`, or explicitly permitted
`BasicAuthentication`, and always requires XSUAA. It does not accept API keys, direct OIDC, cloud
targets, or cross-subaccount/SaaS discovery.

## Destination level and visibility

BTP has global-account, subaccount, and service-instance destination scopes. ARC-1 multi-target v1
discovers **subaccount-level** candidates only. It reads instance-level destination names solely to
detect shadowing: if an instance destination has the same name as a subaccount candidate, ARC-1
quarantines the candidate rather than rely on normal lookup precedence.

Create multi-target destinations in **BTP Cockpit → the intended subaccount → Connectivity →
Destinations**. A destination created only for one service instance does not become a target.

Subaccount visibility also means that another suitable application in the same subaccount may be
able to resolve the destination. A second CF space is not a hard destination-inventory boundary.
Use separate subaccounts where that inventory requires strong isolation.

## Single-target destinations

### Shared Basic `/mcp`

Create an HTTP destination:

```properties
Name=A4H_100_BASIC
Type=HTTP
URL=http://a4h-basic:50000
ProxyType=OnPremise
Authentication=BasicAuthentication
User=<least-privileged-sap-user>
Password=<managed-secret>
sap-client=100
```

Point the application at it with `SAP_BTP_DESTINATION=A4H_100_BASIC`. ARC-1 resolves this destination
at startup for the single target. Use internal HTTPS between Cloud Connector and SAP even if the
destination uses the virtual `http://` URL.

This is a shared SAP identity. XSUAA can still identify the MCP caller to ARC-1, but SAP audit sees
the technical user. Use a dedicated least-privileged user; never use an administrator's account or
`SAP_ALL` merely for convenience.

### Per-user PP `/mcp`

The current single-target on-premise topology uses two explicit destinations:

```properties
# Startup target/feature discovery
Name=A4H_100_STARTUP
Type=HTTP
URL=http://a4h-basic:50000
ProxyType=OnPremise
Authentication=BasicAuthentication
User=<least-privileged-startup-user>
Password=<managed-secret>
sap-client=100
```

```properties
# Authenticated MCP requests
Name=A4H_100_PP
Type=HTTP
URL=http://a4h-pp:50100
ProxyType=OnPremise
Authentication=PrincipalPropagation
sap-client=100
```

Configure:

```yaml
SAP_BTP_DESTINATION: "A4H_100_STARTUP"
SAP_BTP_PP_DESTINATION: "A4H_100_PP"
SAP_PP_ENABLED: "true"
SAP_PP_STRICT: "true"
```

The Basic destination initializes the single target before an end-user JWT exists. It is not a PP
fallback. Strict mode rejects non-JWT tool callers and a failed JWT PP request never changes to the
shared identity. The two destinations may use different Cloud Connector virtual mappings/location
IDs, but they must represent the intended same SAP system/client.

Complete the certificate chain and mapping using
[Principal Propagation Setup](principal-propagation-setup.md).

## Multi-target destination

Create one subaccount destination per SAP system/client. PP is the recommended template:

```properties
Name=ARC1_A4H_100_PP
Type=HTTP
URL=http://a4h-pp:50100
ProxyType=OnPremise
Authentication=PrincipalPropagation
sap-sysid=A4H
sap-client=100
Description=A4H development client 100
arc1.enabled=true
```

Optional target-local policy:

```properties
arc1.allow_data_preview=true
arc1.allow_free_sql=true
```

Those properties only narrow/opt into capabilities beneath the application ceiling. Data preview
requires `SAP_ALLOW_DATA_PREVIEW=true`; SQL requires both `SAP_ALLOW_DATA_PREVIEW=true` and
`SAP_ALLOW_FREE_SQL=true`, plus matching XSUAA user scopes and SAP authorization. No destination
property can enable writes in multi-target v1.

If the physical SAP SID/client is reused in the same ARC-1 registry, use a public alias:

```properties
sap-sysid=A4H
sap-client=001
arc1.target_alias=A4H-2025
```

The public target becomes `A4H-2025/001`; the real SAP identity remains `A4H/001`. Aliases are
3–32 uppercase letters/digits with internal hyphens and must start with a letter. Every public target
must be unique.

For the shared Basic exception, change only the authentication/credential fields and enable the
application-level ceiling described in [Multi-System Setup](multi-target-setup.md):

```properties
Authentication=BasicAuthentication
User=<dedicated-read-only-technical-user>
Password=<managed-secret>
Preemptive=true
```

Any Basic target forces the whole multi-target application to exactly one non-rolling process.
Basic is never a fallback for PP. Use a separate principal-type-None Cloud Connector mapping and
internal HTTPS; verify the ADT ICF service accepts HTTP Basic for this user.

## Multi-target field contract

Property names are case-sensitive.

| Property | Contract |
|---|---|
| `Name` | Required; 1–200 letters, digits, `_`, `.`, or `-`; destination identity, not public route |
| `Type` | Exactly `HTTP` |
| `URL` | Valid `http://` or `https://` virtual URL |
| `ProxyType` | Exactly `OnPremise` in v1 |
| `Authentication` | `PrincipalPropagation`, or explicitly permitted `BasicAuthentication` |
| `sap-sysid` | Required real SID: exactly 3 uppercase alphanumeric characters, starting with a letter |
| `sap-client` | Required: exactly 3 digits; never inferred from URL or name |
| `Description` | Strongly recommended factual one-line label; missing value warns and falls back |
| `arc1.enabled` | Required ARC-1 opt-in marker: exact boolean `true` |
| `arc1.target_alias` | Optional public system selector, 3–32 uppercase/digit/internal-hyphen characters |
| `arc1.allow_data_preview` | Optional exact boolean; target-local data opt-in |
| `arc1.allow_free_sql` | Optional exact boolean; target-local SQL opt-in |
| `sap-language` | Optional two-letter language |
| `CloudConnectorLocationId` | Optional standard routing property; never exposed raw in `SAPTargets` |
| `User` / `Password` | Required only for Basic; resolved per protected request and never returned in diagnostics |
| `Preemptive` | Basic only; omit or set `true` |

Unknown/wrong-case `arc1.*` keys, malformed booleans, and any write/package/transport/Git property
quarantine the destination. Enabled candidates count toward the 256 limit even when invalid. More
than 256 enabled candidates disables the whole registry rather than serving a partial set.

Duplicate destination names, duplicate public targets, duplicate Basic physical connections, and
instance/subaccount name shadows fail closed. Review exact reason codes through the authenticated
Admin `SAPTargets` tool; there is no HTTP `/targets` endpoint.

Descriptions are shown to users/models. Keep them factual and free of prompts, instructions,
credentials, internal incident notes, or token-bearing links.

## Destination import/export

BTP Cockpit can export selected destinations as JSON, YAML, or properties and import them again.
This is useful for copying a reviewed field shape, but exported material can contain URLs,
location IDs, users, passwords, certificates, or OAuth configuration.

Before sharing or committing a template:

1. remove `User`, `Password`, tokens, client secrets, certificates, and authentication headers;
2. replace customer URLs, location IDs, and topology labels;
3. review `sap-sysid`, `sap-client`, description, and every `arc1.*` key;
4. create/import it at subaccount level; and
5. restart ARC-1 and inspect Admin `SAPTargets` before giving users the route.

Do not mass-clone a destination and rely on its name to select a client. `sap-client` is mandatory
and every imported copy must be reviewed independently.

## Cloud Connector Location ID

If several Cloud Connectors attach to the subaccount, set:

```properties
CloudConnectorLocationId=LOC1
```

It must match the intended Cloud Connector. Single-target startup and PP destinations can have
different location IDs. Multi-target Admin diagnostics expose only whether this property exists,
not its raw value.

## Cloud Connector URL Path Reference

Use restrictive resource mappings:

| URL path | Policy | Needed for |
|---|---|---|
| `/sap/bc/adt` | Path and all sub-paths | ARC-1 core ADT operations and all multi-target v1 routes |
| `/sap/opu/odata/UI2/PAGE_BUILDER_CUST` | Path and all sub-paths | Optional single-target FLP management |
| `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` | Path and all sub-paths | Optional single-target UI5 repository operations |

Do not expose `/` just to make troubleshooting easier. Add optional paths only when the associated
single-target feature is enabled and approved. Cloud Connector path matching is case-sensitive.
The internal Cloud Connector-to-SAP connection should use HTTPS with normal hostname/certificate
verification.

For PP, select strict user-certificate propagation with no system-certificate fallback. In newer
Cloud Connector versions this is an X.509 mapping with the separate system-certificate-for-logon
choice disabled; older versions may label it “X.509 Certificate (strict usage)” or represent it as
`X509_RESTRICTED`.

## BTP ABAP Environment

For a same-subaccount BTP ABAP Environment, use the generated
`OAuth2UserTokenExchange` destination described in
[BTP ABAP Environment](btp-abap-environment.md). It uses `ProxyType=Internet`; no Connectivity
service or Cloud Connector is required for that target.

`OAuth2UserTokenExchange` is an identity-zone exchange and generally requires ARC-1 and the ABAP
Environment in the same subaccount. Cross-subaccount designs need a different trust/authentication
flow; do not “fix” them by copying a same-subaccount destination unchanged.

## Restart behavior

| Change | Action |
|---|---|
| Single-target destination name in app config | Update reviewed `.mtaext` and deploy |
| Single-target destination content, including Basic credentials | Restart every app instance; it is resolved at startup |
| Multi-target destination add/remove or non-secret field | `cf restart arc1-mcp-server` |
| Multi-target Basic `User`/`Password` only | No restart; next protected request |
| PP certificate mapping or SAP authorization | Retry; no ARC restart |

Multi-target registry behavior is an ARC-1 startup-snapshot decision, not a Destination Service
requirement. See [BTP Administration](btp-administration.md#change-and-restart-matrix) for the full
change matrix.

## Troubleshooting

| Symptom | Likely boundary |
|---|---|
| Destination absent from multi registry | Wrong level, missing/wrong-case marker, invalid fields, duplicate/shadow, or over 256 |
| `TARGET_CONFIG_CHANGED` | A non-secret field differs from startup; review and restart |
| PP setup succeeds but SAP returns `401` | STRUST/trusted proxy/ICF/CERTRULE/SU01, not destination discovery |
| SAP returns `403` after login | Propagated/technical user's SAP authorization |
| Basic destination returns SSO HTML | ADT ICF does not accept Basic; ARC-1 rejects the login page |
| Basic password changed but call remains blocked | Verify both fields were saved; a rejected generation is bounded, while a changed valid generation proceeds immediately |
| Connectivity exposure error | Virtual host/location/resource path mismatch |

Use a request ID and diagnose from route → XSUAA → registry → Destination/Connectivity → Cloud
Connector → SAP authentication → SAP authorization → ARC-1 policy. Do not widen all Cloud Connector
paths or grant SAP/ARC-1 Admin to bypass a lower-layer error.

## Official references

- [SAP: Destination Service](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/destination-service)
- [SAP: Access Destinations Editor](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/access-destinations-editor)
- [SAP: Set Up Trust for Principal Propagation](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/set-up-trust-for-principal-propagation)
- [SAP: Configure Accessible Resources](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/configure-accessible-resources)
