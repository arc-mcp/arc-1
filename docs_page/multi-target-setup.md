# Multi-System Setup (Multi-Target v1)

!!! warning "Experimental and read-only"

    Multi-target v1 is a default-off SAP BTP Cloud Foundry feature. It is suitable for evaluating
    read access across many on-premise SAP system/client targets, but it is not a writable
    multi-system gateway.

This runbook configures one ARC-1 application to expose both:

- a pinned endpoint per target, such as `https://<arc1-route>/A4H/100/mcp`; and
- one aggregate endpoint, `https://<arc1-route>/multi/mcp`, where every SAP call names a `target`.

For the complete security model, validation rules, status codes, and operations guidance, see
[Multi-Target Administration](multi-target-administration.md). For the architecture and trade-offs,
see [Multi-Target Endpoints](multi-destination.md).

## Before you start

You need:

- an SAP BTP Cloud Foundry subaccount;
- XSUAA, Destination, and Connectivity service bindings;
- SAP Cloud Connector mappings for the on-premise systems;
- working Principal Propagation from XSUAA through Cloud Connector to each SAP client; and
- permission to build ARC-1 from source and deploy an MTAR.

The repository's base `mta.yaml` creates and binds the three required services. Multi-target v1 then
enforces these limits:

- BTP **subaccount destinations** only;
- one `HTTP`/`OnPremise`/`PrincipalPropagation` destination per SID/client;
- XSUAA bearer authentication and strict per-user Principal Propagation;
- source and metadata reads by default, with data preview and SQL as separate opt-ins;
- no writes, activation, transport/Git mutations, SAPLint, ATC, or ABAP Unit;
- process-wide cache `none`, standard tool mode, UI off, and no plugins, shared cookies, service key,
  or direct `SAP_URL` credentials; and
- at most 256 destinations marked `arc1.enabled=true`.

All users with ARC-1 read scope can see every accepted target ID. Principal Propagation mapping and
SAP authorization decide which targets a user can actually read. Use separate ARC-1 applications
when target inventory itself must be restricted or when production and non-production require
separate failure boundaries.

### Exact v1 tool surface

Pinned and aggregate multi-target endpoints expose only `SAPRead`, `SAPSearch`, `SAPQuery`,
`SAPNavigate`, `SAPDiagnose`, and `SAPContext`. The aggregate endpoint additionally exposes
`SAPTargets` when more than one target is active. `SAPQuery` is visible only when all three layers
allow it: `SAP_ALLOW_FREE_SQL=true` on the instance, `arc1.allow_free_sql=true` on at least one
active destination (the selected destination for a pinned endpoint), and `sql` or `admin` in the
user's current XSUAA token. Sign in again and reconnect the MCP client after a role change.

All other whole tools are intentionally absent in v1, including the otherwise read-capable parts of
`SAPTransport`, `SAPGit`, `SAPManage`, and `SAPLint`. Data-sensitive actions inside the six supported
tools are pruned separately when data or SQL is not enabled.

## 1. Enable the mode in the MTA override

Keep the tracked `mta.yaml` unchanged. Copy the deployment-specific extension and enable its existing
multi-target block:

```bash
cp mta-overrides.mtaext.example mta-overrides.mtaext
```

The relevant section of `mta-overrides.mtaext` is:

```yaml
_schema-version: "3.1"
ID: arc1-mcp-overrides
extends: arc1-mcp

modules:
  - name: arc1-mcp-server
    properties:
      ARC1_MULTI_TARGET_ENDPOINTS: "true"
      ARC1_CACHE: none
      ARC1_TOOL_MODE: standard
      ARC1_UI: "off"

      # Recommended beta starting limits; tune with Basis after measuring load.
      ARC1_MAX_CONCURRENT: "10"
      ARC1_AUTH_RATE_LIMIT: "30"
      ARC1_MCP_HTTP_RATE_LIMIT: "1000"
      ARC1_RATE_LIMIT: "120"
```

The base MTA already supplies `SAP_TRANSPORT=http-streamable`, `SAP_XSUAA_AUTH=true`, UI off, and
conservative safety defaults. Do not set `SAP_BTP_DESTINATION` or `SAP_BTP_PP_DESTINATION` for a
multi-target-only deployment. A deliberate legacy `/mcp` target can coexist, but it must use BTP
destinations and the process-wide multi-target prerequisites still apply; see
[Side-by-side operation](multi-target-administration.md#optional-legacy-mcp).

Discovered runtimes enforce strict PP themselves. `SAP_PP_ENABLED` and `SAP_PP_STRICT` control only an
optional legacy `/mcp` runtime and are not needed to activate discovered routes.

## 2. Build and deploy once

Validate, build, and deploy the source checkout with the extension:

```bash
npm ci
npx mbt validate -e mta-overrides.mtaext
npm run btp:build-deploy-ext
```

The application is allowed to start with zero destinations. This lets you finish the deployment
before creating SAP targets. For the complete MTA and service setup, see
[BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md).

For stable OAuth client registrations, also configure the persistent DCR signing secret described in
[XSUAA Setup](xsuaa-setup.md#stable-dcr-signing-key-recommended).

## 3. Create one destination per SID/client

In BTP Cockpit, open **Connectivity > Destinations** at **subaccount** level and create one destination
like this:

```properties
Name=ARC1_A4H_100_PP
Type=HTTP
URL=https://a4h-abap.internal:50001
ProxyType=OnPremise
Authentication=PrincipalPropagation
sap-sysid=A4H
sap-client=100
Description=A4H development client 100
arc1.enabled=true
```

Use the Cloud Connector virtual URL configured for your landscape. The important rules are:

- `sap-sysid` is exactly three uppercase alphanumeric characters and begins with a letter;
- `sap-client` is exactly three digits and is never inferred;
- the public target ID is `A4H/100`, independent of the destination `Name`;
- `Description` is strongly recommended, single-line, and at most 160 characters so users and
  models can distinguish similar targets;
- `arc1.enabled=true` is the only required ARC-1-specific marker; and
- destination property names are case-sensitive.

Optional standard properties are `sap-language` and `CloudConnectorLocationId`. The only other
supported ARC-1 properties are:

```properties
arc1.allow_data_preview=true
arc1.allow_free_sql=true
```

Unknown `arc1.*` keys fail closed. Do not add write/package/transport/Git properties: multi-target v1
will quarantine the destination. Invalid but enabled candidates still count toward the 256-entry
limit.

Multi-target v1 needs only this one PP destination per SID/client. Do not create a BasicAuth startup
destination for every target: there is no technical-user startup probe. ARC-1 performs a success-only
feature probe when an authorized user first calls a target. The generic dual-destination pattern is
for the legacy single-target runtime; see [BTP Destination Setup](btp-destination-setup.md).

## 4. Opt individual targets into data or SQL

Data preview and SQL require consent at every layer. First raise the applicable instance ceiling in
the MTA override or CF environment:

```yaml
modules:
  - name: arc1-mcp-server
    properties:
      SAP_ALLOW_DATA_PREVIEW: "true"
      SAP_ALLOW_FREE_SQL: "true"
```

Then set only the needed destination property on each target:

```properties
arc1.allow_data_preview=true
arc1.allow_free_sql=true
```

The switches are independent. A destination cannot enable a capability disabled by the instance,
the user's XSUAA scopes, or SAP. Multi-target routes remain mutation-free even if a side-by-side
legacy `/mcp` endpoint permits writes.

## 5. Assign the existing XSUAA role collections

Multi-target v1 does not create one role per target. Assign the existing role collections generated
for the CF space:

| Role collection | Multi-target access |
|---|---|
| `ARC-1 Viewer (<space>)` | Target catalog plus source/metadata reads |
| `ARC-1 Data Viewer (<space>)` | Viewer access plus enabled data-preview operations |
| `ARC-1 Viewer + SQL (<space>)` | Viewer/data access plus enabled `SAPQuery` operations |
| `ARC-1 Admin (<space>)` | Expanded secret-safe `/targets` diagnostics; still no mutations |

Developer role collections also include read scope, but they do not unlock mutations on multi-target
routes. In a side-by-side deployment, grant only the scopes a user needs because the legacy `/mcp`
endpoint retains its own policy.

Role assignment does not create an SAP user or PP mapping. See
[Principal Propagation Setup](principal-propagation-setup.md) and
[Authorization & Roles](authorization.md) for the other authorization layers.

## 6. Restart after destination changes

ARC-1 discovers one immutable destination snapshot at process startup. After creating, changing,
disabling, or deleting destinations, run:

```bash
cf restart <arc1-app-name>
```

Destination-only changes do **not** require another MTAR build or `cf deploy`.

| Change | Required action |
|---|---|
| Destination connection, SID/client, description, or `arc1.*` policy | `cf restart` |
| New or deleted destination | `cf restart` |
| SAP user, CERTRULE, PP mapping, or SAP authorization repair | No restart; retry immediately |
| XSUAA role assignment | Sign in again so the client receives a new token |
| ARC-1 MTA/environment ceiling | Apply the environment/deployment change and restart as required |

A running process also resolves the selected PP destination without the SDK cache before each SAP
call. If its safe configuration no longer matches the startup snapshot, the call returns
`TARGET_CONFIG_CHANGED` until ARC-1 is restarted.

## 7. Verify the deployment

### Health

`/health` is public and remains HTTP 200 so Cloud Foundry does not crash-loop the application:

```bash
curl -s https://<arc1-route>/health
```

```json
{
  "status": "ok",
  "version": "<version>",
  "startedAt": "<timestamp>",
  "pid": 123,
  "components": {
    "multiTarget": { "status": "ready" }
  }
}
```

`ready` means the destination snapshot is usable, including a valid snapshot with zero active targets
or individually quarantined entries. `error` means discovery or the 256-target limit made the whole
registry unavailable. Configuration quality is reported separately by admin `/targets` as
`ready`, `degraded`, or `error`.

### Read catalog

`/targets` requires an XSUAA bearer token with read scope:

```bash
curl -s -H "Authorization: Bearer $XSUAA_USER_TOKEN" https://<arc1-route>/targets
```

A read user receives accepted public targets and ready-to-copy client configuration:

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
          "arc-1-multi": { "type": "http", "url": "https://arc1.example/multi/mcp" }
        }
      },
      "githubCopilot": {
        "servers": {
          "arc-1-multi": { "type": "http", "url": "https://arc1.example/multi/mcp" }
        }
      }
    },
    "pinned": {
      "A4H-100": {
        "vscode": {
          "servers": {
            "arc-1-A4H-100": { "type": "http", "url": "https://arc1.example/A4H/100/mcp" }
          }
        },
        "githubCopilot": {
          "servers": {
            "arc-1-A4H-100": { "type": "http", "url": "https://arc1.example/A4H/100/mcp" }
          }
        }
      }
    }
  }
}
```

The catalog does not claim that the current user can access every listed SAP target.

### Admin catalog

An admin receives the same public fields plus a secret-safe `admin` object. A representative active
entry looks like:

```json
{
  "admin": {
    "state": "ready",
    "source": "btp-subaccount",
    "loadedAt": "<timestamp>",
    "revision": "<sha256-hex>",
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
        "target": "A4H/100",
        "status": "active",
        "code": "ACTIVE",
        "message": "Destination is active on pinned and aggregate multi-target routes.",
        "type": "HTTP",
        "authentication": "PrincipalPropagation",
        "proxyType": "OnPremise",
        "sid": "A4H",
        "client": "100",
        "language": "EN",
        "hasCloudConnectorLocationId": false,
        "arcConfig": { "enabled": true },
        "requestedPolicy": { "allowDataPreview": false, "allowFreeSQL": false },
        "effectivePolicy": { "allowDataPreview": false, "allowFreeSQL": false },
        "limitedByInstance": false,
        "warnings": [],
        "routes": {
          "pinned": "https://arc1.example/A4H/100/mcp",
          "aggregate": "https://arc1.example/multi/mcp"
        }
      }
    ]
  }
}
```

On registry-wide failure, `admin.failure` contains a safe code and message. The response never
contains destination URLs, credentials, tokens, certificates, raw Cloud Connector location IDs, or
per-user SAP failures. See [Administrator diagnostics](multi-target-administration.md#admin-user) for
all statuses and reason codes.

## 8. Connect VS Code or GitHub Copilot

Both clients use `.vscode/mcp.json` and the normal XSUAA OAuth/DCR flow.

Use a pinned endpoint when one conversation should stay on one target:

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

Use the aggregate endpoint when one connection must reach many targets:

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

Pinned tools have their normal schemas and cannot switch targets. Aggregate SAP tools require a
`target` on every call. When more than one target is active, `SAPTargets` lists all configured target
IDs and descriptions; it does not test the current user's SAP access.

## Quick troubleshooting

| Symptom | Check |
|---|---|
| Health says `error` | Inspect admin `/targets`, service bindings, Destination Service access, and the 256-target limit |
| Target is missing | Confirm subaccount scope, exact `arc1.enabled=true`, SID/client format, then restart |
| Catalog returns 401/403 | Assign a read-bearing role collection and sign in again |
| `PP_SETUP_FAILED` | Check the user's PP mapping, destination, and Cloud Connector; repair and retry without restart |
| `SAP_AUTHENTICATION_FAILED` or `SAP_AUTHORIZATION_DENIED` | Check the propagated SAP user and client authorizations; repair and retry |
| `SAP_REQUEST_FAILED` | A network or SAP 5xx failure occurred after target selection; check SAP/Cloud Connector availability and retry |
| `TARGET_CONFIG_CHANGED` | Review the destination change and restart ARC-1 |
| Data/SQL is absent | Check the instance ceiling, destination property, XSUAA role, and SAP authorization |

The detailed operator checklist and complete error vocabulary are in
[Multi-Target Administration](multi-target-administration.md).
