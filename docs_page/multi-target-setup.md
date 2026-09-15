# Multi-target setup

<a id="multi-system-setup-multi-target-v1"></a>

Connect one ARC-1 service to several on-premise SAP systems or clients. This experimental mode is **default-off and mutation-free**, supports up to 256 targets, and requires BTP Cloud Foundry with XSUAA.

For a new application, follow [Cloud Foundry deployment](btp-cloud-foundry-deployment.md) with the **multi-PP profile**. Use this page to add targets and connect clients. For an existing service's failures or updates, use [Multi-target administration](multi-target-administration.md).

<a id="why-two-endpoint-styles"></a>

| Endpoint | Use |
|---|---|
| `https://<arc1-route>/A4H/100/mcp` | Keep a conversation on one target |
| `https://<arc1-route>/multi/mcp` | Reach several targets; supply `target` on every SAP call |

A pinned URL prevents accidental target switching within that connection. It does not restrict access: every global read user can try every accepted target. SAP applies the selected identity's permissions. Use separate deployments when target visibility or access needs a separate boundary.

### Choose the SAP identity model

| | Principal Propagation, recommended | BasicAuthentication, optional |
|---|---|---|
| SAP identity | Each human's SAP user | One technical user per destination |
| SAP audit attribution | Human user | Technical user; correlate with ARC-1 audit |
| CF instances | May scale after load testing | Exactly one; non-rolling deployments |
| Use when | Per-user permissions and attribution matter | Shared read access is explicitly acceptable |

Basic requires `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH=true`. It never replaces failed PP authentication. See [Basic operating requirements](multi-target-administration.md#basic-shared-identity-controls).

<a id="before-you-start"></a>

## Quick start

### 1. Check the prerequisites

- An ARC-1 app with XSUAA, Destination and Connectivity bindings.
- A Cloud Connector mapping for each SAP target with [required ADT paths](btp-destination-setup.md#cloud-connector-url-path-reference) and verified internal HTTPS.
- For PP, working [certificate trust and user mapping](principal-propagation-setup.md).
- Destination and identity administrators who can create subaccount destinations and assign a test user.

<a id="1-enable-the-mode-in-the-mta-override"></a>

### 2. Enable the mode in a deployment override

For a new deployment, select the tracked multi-PP profile in [runbook step 4](btp-cloud-foundry-deployment.md#4-create-the-landscape-extension). For an existing app, merge the required values into its protected `.mtaext` without overwriting other settings:

```yaml
modules:
  - name: arc1-mcp-server
    properties:
      ARC1_MULTI_TARGET_ENDPOINTS: "true"
      ARC1_CACHE: none
```

The mode also requires HTTP transport, XSUAA, standard tools, UI/plugins off and no shared cookies or direct SAP credentials. See the [startup requirements](multi-target-administration.md#startup-contract).

For a multi-only app, keep `SAP_BTP_DESTINATION` and `SAP_BTP_PP_DESTINATION` absent. An intentional [single-target `/mcp` alongside it](multi-target-administration.md#optional-single-target-mcp) has separate policy.

<a id="2-build-and-deploy-once"></a>

### 3. Build and deploy once

Follow [runbook steps 5–8](btp-cloud-foundry-deployment.md#5-validate-build-and-inspect-the-mtar) to validate the override, inspect the artifact, deploy and verify roles. An app with zero targets can start successfully.

Copy the application route from `cf app arc1-mcp-server`; the CF API URL from `cf target` is not the MCP route. Basic-enabled deployments must use the [non-rolling procedure](btp-administration.md#non-rolling-update-for-shared-basic).

<a id="3-create-one-destination-per-sidclient"></a>

### 4. Create one minimal destination per target

In **BTP Cockpit → subaccount → Connectivity → Destinations**, create:

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

The URL is the Cloud Connector's **virtual** host and port. Its matching internal connection must use verified HTTPS and strict X.509 user-certificate propagation with system-certificate fallback disabled. Setting the destination authentication does not change the Connector mapping.

For Basic, use the [Basic template and dedicated principal-type-None mapping](btp-destination-setup.md#multi-target-destination). Configure the app-level Basic option and one-instance limit before enabling that target.

### 5. Restart to discover destinations

```bash
cf restart arc1-mcp-server
```

Restart every instance after target additions or non-secret changes. Credential-only rotation on a discovered Basic target takes effect on the next protected request.

### 6. Assign a role and connect

Assign `ARC-1 Viewer (<space>)` to a test user, then configure a [pinned or aggregate connection](#vs-code-and-github-copilot-configuration). Use a separate trusted Admin identity for registry diagnostics; adding Admin to the Viewer test user combines their scopes and invalidates the Viewer test.

### 7. Verify one safe read

1. Check `/health` reports `components.multiTarget.status: "ready"`.
2. On `/multi/mcp`, use an Admin connection to call `SAPTargets` and inspect the expected active target and any exclusions. Basic setup requires this check; PP setup may proceed without an Admin test identity if the Viewer read succeeds.
3. As Viewer, call `SAPRead` with `type: "COMPONENTS"`, then `SAPSearch` for a known object. On the aggregate connection, pass `target: "A4H/100"` on both calls.
4. Verify the backend SAP user through [SAP user verification](principal-propagation-setup.md#verify-the-backend-identity). `SYSTEM.user` alone is not proof. For PP, record the intended human; for Basic, the intended technical user and `identity: "shared"` catalog label.
5. For PP, use an approved unmapped or unauthorized test identity to confirm failure without shared-user fallback.

Record health, safe-read access and backend identity separately in the [worksheet](btp-setup-worksheet.md). A ready registry can have zero targets; a successful read does not establish client-data isolation.

### Roll back or disable shared Basic targets

Emergency disable:

```bash
cf set-env arc1-mcp-server ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH false
cf restart arc1-mcp-server
```

Confirm `BASIC_AUTH_DISABLED` in Admin `SAPTargets`; PP targets remain available. Make the disable durable with `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH: "false"` in the protected `.mtaext`, then validate and deploy through the [non-rolling procedure](btp-administration.md#non-rolling-update-for-shared-basic). Otherwise the next MTA deploy can restore Basic access. Use the same non-rolling strategy for code rollback.

<a id="exact-v1-tool-surface"></a>
<a id="v1-safety-boundary"></a>
<a id="aggregate-tool-behavior"></a>
<a id="allowed-tools"></a>

## What multi-target v1 exposes

This is the maximum action set. User scopes, application/target policy, SAP release support, SAP authorization and deny rules can restrict it.

<!-- multi-target-action-contract:start — checked against the runtime schema -->
| Tool | Permitted actions / purpose |
|---|---|
| `SAPRead` | Source/metadata reads; data operations require additional gates |
| `SAPSearch` | Repository search; database-backed variants require SQL gates |
| `SAPQuery` | SQL queries, only with the required data/SQL policy and scopes |
| `SAPNavigate` | Code navigation |
| `SAPLint` | `lint`, `lint_and_fix`, `list_rules` (offline in ARC-1; does not save fixes to SAP) |
| `SAPDiagnose` | `syntax`, `unittest`, `atc`, `atc_variants`, `cds_testcases`, `dumps`, `traces`, `trace_requests`, `system_messages`, `gateway_errors`, `object_state`, `quickfix`, `odata_perf`, `cds_sql`, `sql_trace_state`, `sql_trace_directory`, `authorization_trace` |
| `SAPContext` | Dependency context |
| `SAPTransport` | `list`, `get`, `check`, `history` |
<!-- multi-target-action-contract:end -->

`SAPDiagnose.atc` and `SAPDiagnose.unittest` use `read` scope but execute SAP workloads and can create temporary worklists/results. Disable them with `SAP_DENY_ACTIONS=SAPDiagnose.atc,SAPDiagnose.unittest` when they are not needed. ATC accepts up to 20 objects under one target, identity and deadline; entries cannot select another target.

Viewer diagnostics can expose operational or user information, including dumps and traces. Review the enabled actions for your audience.

Unavailable even to Admin: `SAPWrite`, `SAPActivate`, `SAPGit`, `SAPManage`, mutating transport actions and SAP-backed formatter/settings actions. Calls are rejected as well as hidden from schemas.

On `/multi/mcp`:

- Every SAP-contacting call requires `target`; there is no remembered or default target.
- Up to 16 targets appear as exact schema values. From 17–256, the schema uses the public target pattern; `SAPTargets` supplies valid IDs.
- Tool visibility reflects the union of configured target policy. Each call rechecks its selected target, so a listed action can still return `TARGET_POLICY_DENIED`.
- `SAPTransport.target` means SAP system/client. Transport creation is unavailable.
- `SAPTargets` is aggregate-only: readers see it with more than one active target; admins see it with zero, one, many or a failed registry. Pinned routes never expose it, and there is no HTTP `/targets` endpoint.

<a id="target-discovery"></a>

## Destination configuration

### Required fields and validation

Use the [destination fields](btp-destination-setup.md#multi-target-field-contract) for required fields, language, descriptions and validation. Only four `arc1.*` properties are supported: `arc1.enabled`, `arc1.target_alias`, `arc1.allow_data_preview`, and `arc1.allow_free_sql`.

Real `sap-sysid` and three-digit `sap-client` are mandatory. Descriptions must be factual labels; do not include instructions or secrets. Unknown or write-related `arc1.*` properties quarantine the destination.

### Systems that reuse the same SID and client

Give at least one independent system a public alias while preserving its real SAP identity:

| | Existing system | Second system |
|---|---|---|
| `sap-sysid` | `A4H` | `A4H` |
| `sap-client` | `001` | `001` |
| `arc1.target_alias` | Omitted | `A4H-2025` |
| Public target | `A4H/001` | `A4H-2025/001` |

An alias changes the public target and pinned route only. Each destination has exactly one route. After changing an alias, restart ARC-1 and reconnect clients using the new URL; the old URL becomes unknown. An alias cannot duplicate the same physical Basic connection.

<a id="4-opt-individual-targets-into-data-or-sql"></a>

### Optional data preview and SQL profile

Enable only the capabilities needed by your workload, first in the protected app override:

```yaml
modules:
  - name: arc1-mcp-server
    properties:
      SAP_ALLOW_DATA_PREVIEW: "true"
      SAP_ALLOW_FREE_SQL: "true"
```

Validate, rebuild and deploy that override. Then opt in each intended destination and restart:

```properties
arc1.allow_data_preview=true
arc1.allow_free_sql=true
```

Both target switches default to false. Preview needs the app data ceiling and target preview opt-in; SQL needs the app free-SQL ceiling and target SQL opt-in. XSUAA scopes and SAP authorization must also allow the call. An enabled app ceiling does not enable all targets. See [RAM sizing](btp-administration.md#data-preview-ram-sizing) before increasing result limits.

<a id="clone-reviewed-destinations-carefully"></a>

### Copy destinations carefully

Review name, URL, SID/client, identity, Connector mapping, description and data policy for every copy. Destination exports can contain credentials. Use [sanitized templates](btp-destination-setup.md#destination-importexport) for sharing.

<a id="5-assign-the-existing-xsuaa-role-collections"></a>
<a id="authentication-and-visibility"></a>

## XSUAA roles and target visibility

| Collection | Multi-target access |
|---|---|
| `ARC-1 Viewer (<space>)` | Permitted reads and diagnostics |
| `ARC-1 Data Viewer (<space>)` | Viewer plus enabled data preview |
| `ARC-1 Viewer + SQL (<space>)` | Viewer/data plus enabled SQL |
| `ARC-1 Admin (<space>)` | Expanded registry diagnostics; still no mutations |

Roles are global, not per target. They do not create SAP users or PP mappings. The catalog is configured inventory, not a list of targets the caller can access in SAP.

### OAuth scopes on first sign-in

Multi-target routes advertise `read`, `data`, `sql`, and `admin`; XSUAA grants only assigned scopes. A token must have `read` before route lookup. After role changes, sign out and reconnect for a new grant; refreshing an old token cannot add previously ungranted scopes.

Treat Admin as an operator role. Beside a writable single-target `/mcp`, its token may permit mutations there. See [side-by-side access](multi-target-administration.md#optional-single-target-mcp).

<a id="6-restart-after-destination-changes"></a>
<a id="7-verify-the-deployment"></a>
<a id="health"></a>
<a id="startup-and-destination-changes"></a>

## Restart and verification behavior

| Change | Action |
|---|---|
| Add/remove target or change non-secret fields | Restart every app instance |
| Rotate discovered Basic `User`/`Password` only | Next protected request; use the [rotation procedure](multi-target-administration.md#basic-shared-identity-controls) |
| Repair PP mapping or SAP roles | Retry; no ARC-1 restart |
| Repair a blocked Basic user's authorization | Follow [Basic retry rules](multi-target-administration.md#user-access-failures-and-retries) |
| Change XSUAA roles | Sign out and reconnect |
| Change app configuration or version | [BTP change matrix](btp-administration.md#change-and-restart-matrix) |

A changed non-secret destination returns `TARGET_CONFIG_CHANGED` until restart. `/health` stays HTTP 200 even if discovery fails; inspect the component status and [registry diagnostics](multi-target-administration.md#health-states).

<a id="target-catalog-tool"></a>
<a id="admin-catalog"></a>

Use Admin `SAPTargets` for registry revision, exclusions and passive Basic health. It never probes SAP. See [catalog fields and paging](multi-target-administration.md#saptargets-operator-surface).

<a id="8-connect-vs-code-or-github-copilot"></a>
<a id="client-examples"></a>

## VS Code and GitHub Copilot configuration

For one target, create `.vscode/mcp.json`:

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

For several targets, use the same structure with the URL `https://<arc1-route>/multi/mcp`. Both use XSUAA OAuth. On an aggregate connection, a model can select the wrong allowed target and disclose its source, table data or SQL results while treating them as another system's data. Choose pinned connections to reduce that risk; use separate deployments for lookalike systems when a wrong-target read is unacceptable.

## Quick troubleshooting

| Symptom | Next check |
|---|---|
| App exits | `cf logs arc1-mcp-server --recent`; [startup requirements](multi-target-administration.md#startup-contract) |
| Health component is `error` | Admin `SAPTargets`; discovery and enabled-target count |
| Target missing | Subaccount scope, `arc1.enabled`, required fields, conflicts, then restart |
| `SAPTargets` missing | Aggregate URL, number of active targets, user role and deny rules |
| Viewer sees no SAP tools | Expected with zero active targets. Repair discovery/configuration and restart; an Admin can still call `SAPTargets` on `/multi/mcp`. |
| Data/SQL missing or denied | App ceiling, target opt-in, XSUAA scope and SAP authorization |
| PP or Basic authentication fails | [Failure codes and retry rules](multi-target-administration.md#user-access-failures-and-retries) |

<a id="not-in-v1"></a>

For all registry codes and unsupported features, use [Multi-target administration](multi-target-administration.md).
