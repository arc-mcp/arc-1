# BTP destination reference

Find the destination fields for your SAP connection below. Create destinations in **BTP Cockpit → subaccount → Connectivity → Destinations**.

For initial deployment use the [Cloud Foundry runbook](btp-cloud-foundry-deployment.md); for certificate trust and SAP user mapping use [Principal Propagation](principal-propagation-setup.md).

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

Multi-target v1 discovers **subaccount-level** destinations only. Service-instance destinations do not become targets; a same-name instance destination quarantines the subaccount candidate because it would shadow normal lookup.

A different CF space does not isolate subaccount destination inventory. Use separate subaccounts when that inventory requires isolation.

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
Password=<strong-generated-ASCII-password>
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
Password=<strong-generated-ASCII-password>
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

The switches are independent: preview requires the app's `SAP_ALLOW_DATA_PREVIEW=true`; SQL requires `SAP_ALLOW_FREE_SQL=true`. Each call also needs the matching XSUAA scope and SAP authorization. Destination properties cannot enable multi-target writes.

If the physical SAP SID/client is reused in the same ARC-1 registry, use a public alias:

```properties
sap-sysid=A4H
sap-client=001
arc1.target_alias=A4H-2025
```

The public target becomes `A4H-2025/001`; the real SAP identity remains `A4H/001`. Aliases are
3–32 uppercase letters/digits with internal hyphens and must start with a letter. Every public target
must be unique.

For the shared Basic exception, use the fields below **and a URL for a separate principal-type-None Connector mapping**. Enable the [app-level Basic option](btp-cloud-foundry-deployment.md#multi-target-with-a-shared-basic-exception) and keep one instance:

```properties
Authentication=BasicAuthentication
User=<dedicated-read-only-technical-user>
Password=<strong-generated-ASCII-password>
Preemptive=true
```

Any Basic target forces the whole multi-target application to exactly one non-rolling process.
Basic is never a fallback for PP. Use a separate principal-type-None Cloud Connector mapping and
internal HTTPS; verify the ADT ICF service accepts HTTP Basic for this user.

<a id="multi-target-field-contract"></a>

## Multi-target destination fields

Property names are case-sensitive.

| Property | Required format |
|---|---|
| `Name` | Required; 1–200 letters, digits, `_`, `.`, or `-`; destination identity, not public route |
| `Type` | Exactly `HTTP` |
| `URL` | Valid `http://` or `https://` virtual URL |
| `ProxyType` | Exactly `OnPremise` in v1 |
| `Authentication` | `PrincipalPropagation`, or explicitly permitted `BasicAuthentication` |
| `sap-sysid` | Required real SID: exactly 3 uppercase alphanumeric characters, starting with a letter |
| `sap-client` | Required: exactly 3 digits; never inferred from URL or name |
| `Description` | Recommended factual label, at most 160 characters after whitespace normalization; missing/invalid values warn and fall back to the target ID |
| `arc1.enabled` | Required opt-in marker: `true` |
| `arc1.target_alias` | Optional public system selector, 3–32 uppercase/digit/internal-hyphen characters |
| `arc1.allow_data_preview` | Optional boolean; target-local data opt-in |
| `arc1.allow_free_sql` | Optional boolean; target-local SQL opt-in |
| `sap-language` | Optional two-letter language; omitted/blank inherits `SAP_LANGUAGE`, other invalid values quarantine |
| `CloudConnectorLocationId` | Optional standard routing property; never exposed raw in `SAPTargets` |
| `User` / `Password` | Required only for Basic; resolved per protected request and never returned in diagnostics |
| `Preemptive` | Basic only; omit or set `true` |

Boolean values accept surrounding whitespace and are case-insensitive; use lowercase `true`/`false`. Aliases are case-sensitive and are not trimmed.

Unknown/wrong-case `arc1.*` keys, malformed booleans, and write/package/transport/Git `arc1.*` properties
quarantine the destination. Enabled candidates count toward the 256 limit even when invalid. More
than 256 enabled candidates disables the whole registry rather than serving a partial set.

Duplicate destination names, duplicate public targets, duplicate Basic physical connections, and
instance/subaccount name shadows fail closed. Review exact reason codes through the authenticated
Admin `SAPTargets` tool; there is no HTTP `/targets` endpoint.

Descriptions are shown to users/models. Keep them factual and free of prompts, instructions,
credentials, internal incident notes, or token-bearing links.

## Destination import/export

Use exports only as protected configuration records or sanitized templates. Before sharing a template, remove credentials, tokens, certificates, authentication headers, customer URLs and location IDs.

For every imported copy, review `Name`, URL, SID/client, authentication, Connector mapping, description and `arc1.*` policy. Create multi-target copies at subaccount level, restart ARC-1 and inspect Admin `SAPTargets`. The destination name never supplies a missing SAP client.

## Cloud Connector Location ID

If several Cloud Connectors attach to the subaccount, set:

```properties
CloudConnectorLocationId=LOC1
```

It must match the intended Cloud Connector. Single-target startup and PP destinations can have
different location IDs. Multi-target Admin diagnostics expose only whether this property exists,
not its raw value.

## Cloud Connector URL path reference

| URL path | Access policy | Needed for |
|---|---|---|
| `/sap/bc/adt` | Path and all sub-paths | Core ADT operations; all multi-target routes |
| `/sap/opu/odata/UI2/PAGE_BUILDER_CUST` | Path and all sub-paths | Optional single-target FLP management |
| `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` | Path and all sub-paths | Optional single-target UI5 repository operations |

Paths are case-sensitive. Add optional paths only for enabled features; do not expose `/` to bypass an error. Use verified internal HTTPS. For PP, configure [strict user-certificate propagation](principal-propagation-setup.md#step-2-configure-cloud-connector) with system-certificate fallback disabled.

## BTP ABAP Environment

Use an Internet destination with `OAuth2UserTokenExchange` for a same-subaccount ABAP Environment. No Cloud Connector is needed. Follow [BTP ABAP setup](btp-abap-environment.md), including its [cross-subaccount requirements](btp-abap-environment.md#cross-subaccount-principal-propagation-fails).

## Restart behavior

| Change | Action |
|---|---|
| Single-target destination name in app config | Update the customer `.mtaext` and deploy |
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

Use [Multi-target failure codes](multi-target-administration.md#user-access-failures-and-retries) for retry rules and [BTP troubleshooting order](btp-administration.md#troubleshooting-order) to identify the failing layer.

## Official references

- [SAP: Destination Service](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/destination-service)
- [SAP: Access Destinations Editor](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/access-destinations-editor)
- [SAP: Set Up Trust for Principal Propagation](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/set-up-trust-for-principal-propagation)
- [SAP: Configure Accessible Resources](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/configure-accessible-resources)
