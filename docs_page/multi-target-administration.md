# Multi-Target Administration

!!! warning "Experimental v1 contract"

    This page documents the destination-discovered multi-target design being implemented on the
    feature branch. Released builds do not yet provide this contract; the PR #543
    `SAP_BTP_DESTINATIONS` behavior is an unreleased prototype and will be removed rather than
    supported in parallel. Do not apply the settings below to a current production deployment.

Multi-target mode lets one ARC-1 application serve many SAP system/client combinations from BTP
subaccount destinations. It is intended for estates with tens or hundreds of clients where one CF
application per client would be operationally expensive.

V1 is deliberately limited:

- SAP BTP Cloud Foundry only;
- subaccount destinations only;
- on-premise `HTTP` destinations with strict `PrincipalPropagation`;
- XSUAA authentication;
- source/metadata reads by default, with optional data preview and SQL;
- no writes, activation, transport mutations, or Git mutations on multi-target routes;
- no cache, plugins, optional UI, hyperfocused mode, ATC, or ABAP Unit; and
- at most 256 enabled system/client targets.

An existing single-target `/mcp` endpoint may run beside multi-target mode and retains its existing
write/package policy. The mutation-free ceiling applies only to discovered pinned routes and
`/multi/mcp`. The startup constraints required to make one process safe—cache `none`, standard tool
mode, UI off, no plugins, no shared cookies/direct credentials/service key—apply to the whole ARC-1
application while multi-target mode is enabled, including a side-by-side legacy route.

## Administration model

Configuration is split deliberately:

| Owner | Configuration | Purpose |
|---|---|---|
| ARC-1 deployment owner | `mta.yaml` or CF environment | Enables the feature and sets the maximum instance-wide safety ceiling. |
| BTP destination administrator | One destination per SAP system/client | Defines target identity, connection, label, and the narrower target data/SQL policy. |
| Identity administrator | Existing XSUAA role collections | Grants global ARC-1 read, data, SQL, or admin scopes. |
| SAP/Basis administrator | PP mapping and SAP authorizations | Decides which propagated user can actually access each SAP system/client. |

The effective permission is the intersection of all four layers. A destination can never enable
data or SQL that the ARC-1 instance disabled. `MCPAdmin` cannot bypass SAP authorization or enable
multi-target writes.

There are no target-specific XSUAA roles in v1. A global read user can see every accepted target and
try it. SAP decides whether that propagated user has access. Use separate ARC-1 applications if
different user groups must not see the same target inventory.

### When separate instances are safer

Use one ARC-1 instance per target, optionally behind the [Multi-System Hub](multi-system-hub.md),
instead of this mode when you need:

- writes or activation;
- target-specific ARC-1 visibility/ACLs before SAP is contacted;
- separate XSUAA tenants, subaccounts, or identity providers;
- hard performance and failure isolation between production and non-production;
- different release/maintenance windows; or
- a security boundary stronger than a shared process plus per-request target checks.

Multi-target v1 reduces application sprawl; it does not turn one process into 256 independent
security or capacity domains.

The aggregate endpoint also accepts a deliberate residual risk: a model can select the wrong target
and read data or run SQL there if the propagated user is authorized and all policy gates permit it.
Keep data/SQL disabled by default, use distinct target descriptions, and use separate ARC-1
instances for lookalike production/non-production systems where a wrong-target read would be an
unacceptable confidentiality incident.

## 1. Prepare the ARC-1 application

Users build their MTAR from source. Keep the experimental block commented in the shared `mta.yaml`
template and enable it in the deployment-specific `mta-overrides.mtaext` copy:

```bash
cp mta-overrides.mtaext.example mta-overrides.mtaext
```

Uncomment the complete multi-target block under `modules[].properties`:

```yaml
properties:
  # Experimental destination-discovered multi-target mode
  ARC1_MULTI_TARGET_ENDPOINTS: "true"
  SAP_TRANSPORT: http-streamable
  SAP_XSUAA_AUTH: "true"
  ARC1_CACHE: none
  ARC1_TOOL_MODE: standard
  ARC1_UI: "off"

  # Instance ceiling: source reads only by default
  SAP_ALLOW_WRITES: "false"
  SAP_ALLOW_DATA_PREVIEW: "false"
  SAP_ALLOW_FREE_SQL: "false"
  SAP_ALLOW_TRANSPORT_WRITES: "false"
  SAP_ALLOW_GIT_WRITES: "false"

  # Recommended starting limits; adjust with Basis after load testing
  ARC1_MAX_CONCURRENT: "10"
  ARC1_RATE_LIMIT: "120"
  ARC1_AUTH_RATE_LIMIT: "30"
  ARC1_MCP_HTTP_RATE_LIMIT: "1000"
```

The module must bind XSUAA, Destination, and Connectivity service instances. Do not configure a
cookie, service key, direct `SAP_URL`, plugin path, web UI, or hyperfocused mode for the multi-target
routes.

`SAP_PP_ALLOW_SHARED_COOKIES` must be false and `SAP_COOKIE_FILE`/`SAP_COOKIE_STRING` must be absent;
multi-target mode does not permit the legacy shared-cookie escape hatch in the same process.

Discovered runtimes always enforce strict PP internally. Existing `SAP_PP_ENABLED` and
`SAP_PP_STRICT` variables apply only to an optional legacy `/mcp` runtime, so do not set them merely
to enable multi-target mode.

The app is allowed to start before any target exists. After deployment, configure destinations and
restart the CF app; no MTAR rebuild or redeployment is needed.

### Optional legacy `/mcp`

An explicitly configured single target can continue to use the existing `SAP_BTP_DESTINATION` and,
if needed, `SAP_BTP_PP_DESTINATION` variables at bare `/mcp`. Discovered targets do not inherit those
names or policies. If the legacy connection is also discovered as a SID/client route, ARC-1 keeps
both endpoints but logs a warning because different policies for the same backend are easy to
configure accidentally.

The legacy target retains today's write/package behavior, including the `$TMP` package default. That
does not enable writes on any discovered pinned or aggregate route.

### Enabling data preview or SQL

Data preview and SQL are off by default. First raise only the required instance ceilings:

```yaml
properties:
  SAP_ALLOW_DATA_PREVIEW: "true"
  SAP_ALLOW_FREE_SQL: "true"
```

Then enable the same capability only on the destinations that need it. SQL remains subject to the
existing SQL/data XSUAA scopes and SAP authorization.

Do not enable `SAP_ALLOW_WRITES` for the purpose of multi-target access. V1 removes mutation tools
and actions from multi-target routes even if the legacy `/mcp` target uses writes. There is no
supported full-write destination configuration or write example for multi-target v1.

## 2. Create one destination per system/client

The minimum recommended destination is:

```properties
Name=ARC1_A4H_100_PP
Type=HTTP
URL=http://a4h-abap.internal:50000
ProxyType=OnPremise
Authentication=PrincipalPropagation
sap-sysid=A4H
sap-client=100
Description=A4H development client 100
arc1.enabled=true
```

Rules:

- `arc1.enabled=true` is the only required ARC-1-specific marker.
- `sap-sysid` is the standard SAP property and must be exactly three uppercase alphanumeric
  characters, beginning with a letter. `A4H` is valid; `A-4`, `A_4`, and `a4h` are not.
- `sap-client` is required and must contain exactly three digits. ARC-1 never assumes client 100.
- The public target ID becomes `A4H/100`.
- `Description` is strongly recommended, single-line, and at most 160 characters. If it is missing
  or invalid, ARC-1 warns and uses `A4H/100` as the label.
- `sap-language` and `CloudConnectorLocationId` remain optional standard destination properties.
  A valid target `sap-language` overrides the instance `SAP_LANGUAGE`; otherwise the instance value
  is inherited.
- Property names are case-sensitive. Boolean values accept trimmed case-insensitive `true` or
  `false`; lowercase is recommended.

The BTP destination `Name` is an internal identifier. It never becomes an MCP URL and is not shown
to ordinary read users or the LLM.

### Data preview and SQL example

This target permits source reads, data preview, and SQL when the instance ceiling and user roles
also permit them:

```properties
Name=ARC1_BWQ_200_PP
Type=HTTP
URL=http://bwq-abap.internal:50000
ProxyType=OnPremise
Authentication=PrincipalPropagation
sap-sysid=BWQ
sap-client=200
Description=BW quality analytics client 200
arc1.enabled=true
arc1.allow_data_preview=true
arc1.allow_free_sql=true
```

Supported `arc1.*` keys in v1 are only:

- `arc1.enabled`;
- `arc1.allow_data_preview`; and
- `arc1.allow_free_sql`.

Unknown keys on an enabled destination fail closed. Write-related keys such as
`arc1.allow_writes`, `arc1.allowed_packages`, `arc1.allow_transport_writes`, and
`arc1.allow_git_writes` quarantine the destination because multi-target writes are not supported.
There is no `arc1.config_version` in v1; the strict key allowlist is the destination schema.

The data-preview and SQL switches are independent. Enabling SQL does not automatically expose named
table preview, although the existing SQL XSUAA role composition still includes the data scope needed
by SQL policy enforcement.

### Clone destinations safely

BTP Cockpit can export and import selected destinations as JSON, YAML, or Properties. This is useful
for cloning a reviewed template:

1. Export a known-good destination.
2. Edit `Name`, `URL`, `sap-sysid`, `sap-client`, and `Description`.
3. Review the ARC-1 data/SQL properties explicitly.
4. Import the copy.
5. Confirm the PP and Cloud Connector settings in Cockpit.
6. Restart ARC-1 and inspect the admin target status.

Treat exports as sensitive. Depending on the destination type and export behavior, they may contain
connection or authentication material. Do not commit them to the ARC-1 repository.

## 3. Restart to load changes

ARC-1 reads one immutable destination snapshot during process startup. Creating, editing, disabling,
or deleting a destination does not alter a running process.

Use a normal non-rolling restart so every CF app instance loads the same snapshot:

```bash
cf restart <arc1-app-name>
```

Then verify:

1. `/health` reports the multi-target component as ready.
2. Admin `/targets` shows the expected snapshot revision and target count.
3. Every active app instance reports the same revision. To inspect one instance through the CF
   router, send `X-CF-APP-INSTANCE: <app-guid>:<index>` with the authenticated `/targets` request.
4. A read user can connect to a pinned or aggregate endpoint.

No `mbt build`, new MTAR, or `cf deploy` is required for destination-only changes.

Discovery or registry-wide configuration errors keep `/health` at 200 with
`components.multiTarget.status="error"` so CF does not crash-loop the application and admin
`/targets` stays available. A successfully built snapshot reports `ready`, including when it has
zero active targets or individually quarantined destinations. The admin catalog alone reports
`degraded` when entries are quarantined. Affected MCP routes return 503 after a registry-wide error
until the configuration is fixed and the app is restarted.

At request time ARC-1 resolves the PP destination again for the current user and compares its safe
connection and ARC-1 policy fingerprint with the startup snapshot. The lookup bypasses the SDK cache,
and failed PP results are not cached. A mismatch returns `TARGET_CONFIG_CHANGED` until the app is
restarted. This prevents a running process from silently using partly changed config and permits an
immediate retry after PP mapping is repaired.

## 4. Configure XSUAA roles

Use the existing global ARC-1 roles and role collections. Multi-target v1 does not add one role per
system. It requires only additive Destination Service helpers in `@arc-mcp/xsuaa-auth`; the package's
XSUAA verifier, roles, scopes, and token claims do not change.

| Access | Required effect |
|---|---|
| Viewer/read | Opens `/targets`, all accepted pinned endpoints, and `/multi/mcp`; permits source/metadata reads. |
| Data Viewer/data | Adds data-preview operations where both instance and destination allow them. |
| SQL User/sql | Adds `SAPQuery` where both instance and destination allow it; use the existing role collection that composes read/data as required. |
| Admin | Adds the expanded `/targets` diagnostic view; multi-target remains mutation-free. |

The four checks remain independent:

1. ARC-1 instance ceiling;
2. selected destination policy;
3. XSUAA scope; and
4. propagated SAP user authorization.

Giving a user Viewer does not create or map the user in SAP. ARC-1 cannot know the user's true target
access without making a SAP call, so the catalog does not claim availability.

## 5. Choose an endpoint style

Both endpoint styles exist whenever `ARC1_MULTI_TARGET_ENDPOINTS=true`:

| URL | Use |
|---|---|
| `https://<arc1-route>/A4H/100/mcp` | Target-pinned connection. Tools keep their normal schemas and cannot switch targets. |
| `https://<arc1-route>/multi/mcp` | One connection for all targets. Each SAP-contacting tool call requires an explicit `target`. |
| `https://<arc1-route>/targets` | Protected JSON catalog; expands for admin. |

Bare `/mcp` is reserved for an explicitly configured legacy single target. ARC-1 never assigns it to
the first or only discovered destination.

### VS Code/GitHub Copilot: pinned target

Create `.vscode/mcp.json`:

```json
{
  "servers": {
    "arc-1-a4h-100": {
      "type": "http",
      "url": "https://<arc1-route>/A4H/100/mcp"
    }
  }
}
```

### VS Code/GitHub Copilot: aggregate target

```json
{
  "servers": {
    "arc-1-multi": {
      "type": "http",
      "url": "https://<arc1-route>/multi/mcp"
    }
  }
}
```

VS Code opens the normal XSUAA OAuth/DCR flow. The aggregate server exposes `SAPTargets` when more
than one target is active, so the LLM can list target IDs and their descriptions before choosing one.
`SAPTargets` does not report whether the current user is mapped or authorized in SAP.

## 6. Read and admin target views

`/targets` requires at least the XSUAA read scope. Nothing in the target inventory is public. Public
health and OAuth metadata remain generic and registry-independent. V1 does not add an HTML root:
ordinary browser navigation cannot attach the bearer token, and a cookie/session login would add UI
and CSRF scope.

Responses set `Cache-Control: no-store` and `Vary: Authorization`.

### Read user

The JSON view contains only accepted public targets and connection information:

```json
{
  "aggregateEndpoint": "https://arc1.example/multi/mcp",
  "targets": [
    {
      "target": "A4H/100",
      "description": "A4H development client 100",
      "pinnedEndpoint": "https://arc1.example/A4H/100/mcp",
      "aggregateEndpoint": "https://arc1.example/multi/mcp"
    }
  ],
  "clientConfig": {
    "aggregate": {
      "vscode": {
        "servers": {
          "arc-1-multi": {
            "type": "http",
            "url": "https://arc1.example/multi/mcp"
          }
        }
      },
      "githubCopilot": {
        "servers": {
          "arc-1-multi": {
            "type": "http",
            "url": "https://arc1.example/multi/mcp"
          }
        }
      }
    },
    "pinned": {
      "A4H-100": {
        "vscode": {
          "servers": {
            "arc-1-A4H-100": {
              "type": "http",
              "url": "https://arc1.example/A4H/100/mcp"
            }
          }
        },
        "githubCopilot": {
          "servers": {
            "arc-1-A4H-100": {
              "type": "http",
              "url": "https://arc1.example/A4H/100/mcp"
            }
          }
        }
      }
    }
  }
}
```

It does not expose destination names, SAP URLs, target policy, rejected entries, or SAP user state.

### Admin user

The same response adds an `admin` object. The example below shows one active destination; disabled,
ignored, and quarantined ARC-related destinations use the same flat diagnostic shape:

```json
{
  "admin": {
    "state": "ready",
    "source": "btp-subaccount",
    "loadedAt": "2026-07-17T08:30:00.000Z",
    "revision": "677439333a3daf9ce7987c158020bb5c065efe9ed87ccff5ea74b588bb193dc8",
    "counts": {
      "scanned": 1,
      "unrelated": 0,
      "arcAdjacent": 0,
      "arcRelated": 1,
      "enabled": 1,
      "active": 1,
      "disabled": 0,
      "ignored": 0,
      "quarantined": 0
    },
    "destinations": [
      {
        "destinationName": "ARC1_A4H_100_PP",
        "type": "HTTP",
        "authentication": "PrincipalPropagation",
        "proxyType": "OnPremise",
        "hasCloudConnectorLocationId": false,
        "arcConfig": { "enabled": true },
        "warnings": [],
        "target": "A4H/100",
        "description": "A4H development client 100",
        "sid": "A4H",
        "client": "100",
        "language": "EN",
        "status": "active",
        "code": "ACTIVE",
        "message": "Destination is active on pinned and aggregate multi-target routes.",
        "requestedPolicy": {
          "allowDataPreview": false,
          "allowFreeSQL": false
        },
        "effectivePolicy": {
          "allowDataPreview": false,
          "allowFreeSQL": false
        },
        "limitedByInstance": false,
        "routes": {
          "pinned": "https://arc1.example/A4H/100/mcp",
          "aggregate": "https://arc1.example/multi/mcp"
        }
      }
    ]
  }
}
```

The admin list includes every destination containing a property whose key starts with `arc1.`
case-insensitively, including disabled, invalid, and quarantined entries. Supported keys must still
use the exact lowercase spelling, so a wrong-case key is shown as an error rather than silently
disappearing. The response does not list unrelated destination names.

`arcAdjacent` counts destinations with `sap-sysid` or `sap-client` but no `arc1.*` key. Their names
remain hidden; the count tells an administrator that a likely SAP destination may simply be missing
`arc1.enabled=true`.

The response never contains:

- destination URL;
- user, password, client secret, token, or SAML assertion;
- authorization headers or destination query/header properties;
- certificates;
- the raw Cloud Connector location ID;
- the raw Destination Service object; or
- a user's last SAP/PP failure or inferred target availability.

`hasCloudConnectorLocationId` is a boolean only. The registry revision is calculated from safe
normalized config, never credentials.

## 7. Understand status and reason codes

| Code | Operator action |
|---|---|
| `ACTIVE` | No action; target is routed. |
| `ARC1_ENABLED_MISSING` | Add `arc1.enabled=true` if this ARC-related destination should be a target. |
| `ARC1_DISABLED` | Set `arc1.enabled=true` if the target should be active, then restart. |
| `ARC1_ENABLED_INVALID` | Use `true` or `false`. |
| `MISSING_NAME` / `INVALID_NAME` | Repair the destination name. |
| `MISSING_URL` / `INVALID_URL` | Add or repair the destination URL. |
| `MISSING_SYSID` / `INVALID_SYSID` | Add/fix standard `sap-sysid` using the exact three-character format. |
| `MISSING_CLIENT` / `INVALID_CLIENT` | Add/fix three-digit `sap-client`. |
| `UNSUPPORTED_TYPE` | Use an HTTP destination. |
| `UNSUPPORTED_PROXY` | V1 requires `OnPremise`. |
| `UNSUPPORTED_AUTH` | V1 requires `PrincipalPropagation`. |
| `MISSING_DESCRIPTION` | Non-fatal; add a useful description to replace the target-ID fallback. |
| `INVALID_LANGUAGE` | Remove or correct `sap-language`. |
| `UNKNOWN_ARC1_PROPERTY` | Remove or correct the unsupported ARC-1 property. |
| `INVALID_POLICY` | Set the data/SQL property to a valid boolean. |
| `UNSUPPORTED_V1_WRITE_CONFIG` | Remove write-related target properties; writes are not available in v1. |
| `DUPLICATE_TARGET` | Give each SID/client exactly one enabled destination; all claimants remain disabled until fixed. |
| `DUPLICATE_DESTINATION_NAME` | Remove the duplicate input; ARC-1 never selects a winner. |
| `SHADOWED_BY_INSTANCE` | Remove/rename the same-name service-instance destination or subaccount candidate. |
| `TARGET_LIMIT_EXCEEDED` | Reduce enabled candidates to at most 256. No discovered target is activated while over the limit. |
| `REGISTRY_DISCOVERY_ERROR` | Check Destination service binding/token/network health, then restart. |

`LIMITED_BY_INSTANCE` is not a reason code. An otherwise active destination keeps `code: "ACTIVE"`
and sets `limitedByInstance: true` when it requests data or SQL above the instance ceiling. Raise the
instance ceiling intentionally or remove the destination request; source reads remain available.

Unknown `arc1.*` keys fail closed so a typo cannot silently broaden policy. Duplicate routes and
names quarantine all claimants; destination ordering never decides which system is served.

## 8. Troubleshoot user access

ARC-1 reports the stage without exposing raw SAP responses:

| Error | Meaning |
|---|---|
| `PP_SETUP_FAILED` | Failure was proven during Destination/Connectivity lookup or token exchange before an ADT request. |
| `SAP_AUTHENTICATION_FAILED` | SAP returned login/401 behavior or an ambiguous 403 after PP. It may be mapping, backend login, or PP configuration; ARC-1 does not claim that the user definitely does not exist. |
| `SAP_AUTHORIZATION_DENIED` | SAP returned a structured authorization refusal for the propagated user. |
| `SAP_SERVICE_INACTIVE` | The target ICF/ADT service is inactive or unreachable in that form, not merely a user role issue. |
| `SAP_REQUEST_FAILED` | A post-PP network failure or SAP 5xx prevented the request without proving an authentication cause. Check Cloud Connector/SAP health and retry once. |
| `TARGET_POLICY_DENIED` | Data/SQL is not enabled by every ARC-1 policy layer. |
| `TARGET_CONFIG_CHANGED` | Destination no longer matches the startup snapshot; review it and restart. |

PP setup success is not proof of SAP login. ARC-1 audit events distinguish XSUAA auth, target
resolution, PP exchange, SAP authentication, SAP authorization, and successful execution.

Access failures are not cached. After the SAP mapping or authorization is fixed, the user can retry
in the same conversation immediately. A changed XSUAA role requires a fresh OAuth token/sign-in.

ARC-1 logs safe user/target/request correlation and outcome. Whether SAP itself logs each login
attempt depends on SAP security configuration.

## 9. Size the shared instance

All targets share one `ARC1_MAX_CONCURRENT` semaphore. V1 does not reserve capacity per target, so a
busy system can temporarily occupy the shared limit. Per-SID fairness is deferred until operational
evidence justifies the added scheduler complexity.

Starting recommendations:

| Expected active users | OAuth/IP/min | MCP HTTP/IP/min | Per user/min | Global concurrent SAP requests |
|---:|---:|---:|---:|---:|
| 1–5 | 30 | 1,000 | 120 | 10 |
| 6–20 | 60 | 3,000 | 120 | 20 |
| 21–50 | 120 | 7,500 | 180 | 40 |
| 51–100 | 240 | 20,000 | 180 | 60 |

The OAuth limit permits login/reconnect bursts from a shared corporate egress IP. Each pinned MCP URL
may cause a separate OAuth/DCR flow in the client, so prefer the aggregate endpoint once a user needs
more than a few targets. The MCP per-IP number is a coarse abuse ceiling, not permission to run that
many SAP calls. Concurrency is the real backend protection.

If `ARC1_MCP_HTTP_RATE_LIMIT` is unset, ARC-1 preserves the current derived value
`max(ARC1_AUTH_RATE_LIMIT * 30, 600)`. Set `0` only to opt out explicitly; a positive value replaces
the derived limit for every MCP route and the Copilot JSON-RPC `/authorize` path. `ARC1_RATE_LIMIT`
defaults to off; multi-target logs a warning when no per-user limit is configured. Start concurrency
around:

```text
floor(0.6 × rdisp/wp_no_dia / number_of_ARC1_CF_instances)
```

Confirm the value with Basis. Different clients of one SID usually share the same SAP dialog
work-process pool. In-memory limits apply per CF app instance and therefore multiply when the app is
scaled horizontally.

## 10. Operational checklist

- [ ] Multi-target mode is explicitly enabled and still read-only.
- [ ] XSUAA, Destination, and Connectivity bindings are healthy.
- [ ] Strict PP is enabled; no shared SAP identity fallback exists.
- [ ] Every target has valid `sap-sysid`, `sap-client`, description, and `arc1.enabled=true`.
- [ ] Data/SQL is enabled only where required, at both instance and destination layers.
- [ ] No target contains write-related or unknown `arc1.*` keys.
- [ ] Enabled target count is at most 256.
- [ ] Admin `/targets` has no duplicate, shadow, invalid, or unexpected `limitedByInstance: true` diagnostic.
- [ ] All CF instances show the same registry revision.
- [ ] Viewer, unmapped-user, SAP-unauthorized, and broken-PP cases were tested separately.
- [ ] Logs and audit sinks contain no destination secrets or raw SAP response bodies.
- [ ] Rate/concurrency limits were reviewed with Basis.
- [ ] Lookalike production/non-production targets with data or SQL were separated if a wrong-target
      read would be unacceptable.
- [ ] VS Code/GitHub Copilot connects to the intended pinned or aggregate URL.

## Deferred features

The following are intentionally not part of v1:

- multi-target writes, activation, transport writes, and Git writes;
- a full-write destination template;
- target-specific ARC-1 ACLs or XSUAA roles;
- persisted per-user target availability;
- API-key or raw Entra/IAS OIDC access to multi-target routes;
- SaaS subscriber/provider or cross-subaccount discovery;
- S/4HANA Public Cloud/SAML assertion targets;
- a second technical/design-time destination per target;
- cache modes, plugins, optional UI integration, hyperfocused mode, SAPLint, ATC, and ABAP Unit;
- a browser HTML catalog and cookie/session login;
- per-target concurrency reservations; and
- live destination refresh without restart.

Repository maintainers can find the complete architecture, security contract, test matrix, and
rollout sequence in `docs/plans/destination-discovered-multi-target-v1.md`.
