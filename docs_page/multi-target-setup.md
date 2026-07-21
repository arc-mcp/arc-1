# Multi-System Setup (Multi-Target v1)

If ARC-1 and its BTP services are not deployed yet, begin with
[BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md), then return here for the
multi-target-specific override, destinations, endpoints, and acceptance test. Common role, secret,
restart, upgrade, scaling, and handover procedures live in
[BTP Administration](btp-administration.md).

!!! warning "Experimental, default-off, and mutation-free"

    Multi-target v1 is available only for SAP BTP Cloud Foundry deployments built from source. It
    serves on-premise SAP systems through XSUAA. Principal Propagation is recommended. A
    default-off BasicAuthentication option exists for read-only systems that must use a shared
    technical identity. Writes, activation, and transport/Git mutations are unavailable. Offline
    SAPLint, read-only transport inspection, ATC, and ABAP Unit are available; ATC and Unit execute
    SAP workloads and are not passive metadata reads.

One ARC-1 application can serve up to 256 SAP system/client targets discovered from BTP subaccount
destinations. Enabling the mode creates both endpoint styles:

<a id="why-two-endpoint-styles"></a>

| Endpoint | Use it when |
|---|---|
| `https://<arc1-route>/A4H/100/mcp` | A conversation must stay pinned to one SAP system/client. No `target` parameter is added; tools/actions are still pruned by policy and scope. |
| `https://<arc1-route>/multi/mcp` | One MCP connection must reach several targets. Every SAP call has a required `target`. |

```text
                         ┌─ /A4H/100/mcp ── A4H client 100
MCP client ─ ARC-1/XSUAA ├─ /A4H/200/mcp ── A4H client 200
                         ├─ /A4H-2025/001/mcp ─ A4H 2025 client 001 (route alias)
                         └─ /multi/mcp ───── explicit target on every call
                                      │
                                      └─ selected identity per target
                                         ├─ PrincipalPropagation → per-user SAP identity
                                         └─ BasicAuthentication → shared SAP identity
```

A pinned URL is a target-selection guard, not a per-target authorization boundary. Every user with
the global ARC-1 read scope can try every accepted pinned route if they know its ID. The propagated
SAP identity and authorization decide whether the call succeeds. With BasicAuthentication, that
identity is the same technical user for every authorized caller. Use separate ARC-1 applications
when target inventory itself must be restricted.

### Choose the SAP identity model

| Decision | Principal Propagation | BasicAuthentication |
|---|---|---|
| SAP identity | Per XSUAA user | One shared technical user per destination |
| Recommended use | Enterprise/default, especially when attribution or different SAP permissions matter | Compatibility for mutation-free systems where PP is unavailable and shared read access is acceptable |
| CF scaling/deployment | Normal stateless scaling is possible | Exactly one process; use non-rolling stop/start deployment in v1 |
| Destination secrets | No reusable SAP password | Reusable `User`/`Password`; destination administrators are credential administrators |
| SAP audit attribution | Human SAP user | Technical user; correlate the ARC-1 request/audit record to the XSUAA caller |
| Multi-target writes | Not available in v1 | Not available in v1 and not planned without a new security design |

Choose PP unless the shared-identity trade-off is explicitly acceptable. Do not use Basic when
per-user SAP authorization, human attribution inside SAP, or horizontal CF scaling is required.

<a id="before-you-start"></a>

## Quick start

This path starts with the mutation-free Viewer role. It includes source/metadata access and permitted
read-only diagnostics; data preview and freestyle SQL are separate opt-ins described later.

The sequence crosses separate responsibilities:

| Step | Typical owner |
|---|---|
| MTA override, deploy, route, restart | CF Space Developer |
| PP trust/mapping and SAP authorization | Cloud Connector and SAP Basis/security administrators |
| Subaccount destination | Destination Administrator |
| Role collection and test user | User and Role Administrator |
| MCP connection and safe-read acceptance | ARC-1 service owner/user |

### 1. Check the prerequisites

You need:

- an SAP BTP Cloud Foundry subaccount;
- entitlement and quota for the XSUAA, Destination, and Connectivity services bound by the
  repository's `mta.yaml`;
- Node.js 22.19 or later, npm, the CF CLI, the CF MultiApps plugin used by `cf deploy`, and `mbt`;
- a CF CLI session targeted at the intended org and space;
- an SAP Cloud Connector mapping for every on-premise target whose virtual host and port exactly
  match the destination and which includes the required ADT resource paths from the
  [Cloud Connector URL path reference](btp-destination-setup.md#cloud-connector-url-path-reference);
- for PrincipalPropagation targets, an internal HTTPS mapping with strict user-certificate
  propagation (often represented as `X509_RESTRICTED`) and working
  [Principal Propagation](principal-propagation-setup.md) through Cloud Connector to that SAP client;
- for BasicAuthentication targets, a dedicated least-privileged SAP technical user, permission to
  store/rotate its credentials in the subaccount destination, a separate Cloud Connector mapping
  with principal type **None** (`NONE_RESTRICTED` in the API), and an ADT ICF logon procedure that
  accepts HTTP Basic for that user;
- permission to build ARC-1 from source, deploy an MTAR, and manage subaccount destinations; and
- an identity administrator able to assign the ARC-1 role collections generated by deployment.

<a id="1-enable-the-mode-in-the-mta-override"></a>

### 2. Enable the mode in a deployment override

Copy the tracked template and uncomment only the mandatory multi-target settings:

```bash
cp mta-overrides.mtaext.example mta-overrides.mtaext
```

```yaml
modules:
  - name: arc1-mcp-server
    properties:
      ARC1_MULTI_TARGET_ENDPOINTS: "true"
      ARC1_CACHE: none
```

The base MTA already configures HTTP transport, XSUAA, UI off, and mutation ceilings off. The
application default supplies standard tool mode. `ARC1_CACHE=none` is mandatory because the normal
cache default is not valid for multi-target v1.

Keep PP-only deployments at that minimum. If at least one target must use a shared Basic identity,
add the separate ceiling below and keep the CF application at exactly one instance:

```yaml
modules:
  - name: arc1-mcp-server
    parameters:
      instances: 1
    properties:
      ARC1_MULTI_TARGET_ENDPOINTS: "true"
      ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH: "true"
      ARC1_CACHE: none
```

This flag permits Basic destinations; it does not convert PP destinations or provide fallback.

For a multi-target-only deployment, leave `SAP_BTP_DESTINATION` and `SAP_BTP_PP_DESTINATION` unset.
Configure them only for the deliberate side-by-side single-target route described in
[Optional single-target `/mcp`](multi-target-administration.md#optional-single-target-mcp).

Before opening a shared beta to multiple users, choose a positive per-user limit using
[Shared capacity and rate limits](multi-target-administration.md#shared-capacity-and-rate-limits).

<a id="2-build-and-deploy-once"></a>

### 3. Build and deploy once

```bash
npm ci
npx mbt validate -e mta-overrides.mtaext
npm run btp:build-deploy-ext
```

For a Basic-enabled v1 deployment, do not use rolling, blue/green, or parallel app-process
replacement: even a desired count of one can temporarily run two independent credential guards.
Use the [non-rolling update procedure](btp-administration.md#non-rolling-update-for-shared-basic)
that keeps at most one process active, or first unset
`ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH`, restart until Basic targets are quarantined, and only then use
the normal deployment strategy. After deployment, verify `cf app arc1-mcp-server` reports `1/1`.

The application may start with zero targets. This lets deployment finish before destination setup.
For the complete BTP service and route procedure, see
[BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md).

Confirm that the CLI is still targeting the intended org and space, then copy the app route shown by
`cf app` for the client configuration below:

```bash
cf target
cf app arc1-mcp-server
```

Use the value listed under `routes:` as `<arc1-route>`. Do not copy the CF API endpoint from
`cf target`.

For stable MCP OAuth client registrations, also set the persistent DCR signing secret described in
[XSUAA Setup](xsuaa-setup.md#stable-dcr-signing-key-recommended).

<a id="3-create-one-destination-per-sidclient"></a>

### 4. Create one minimal destination per target

In BTP Cockpit, open **Connectivity > Destinations** at **subaccount** level and create one
destination per SID/client:

```properties
Name=ARC1_A4H_100_PP
Type=HTTP
URL=http://a4h-abap.internal:50001
ProxyType=OnPremise
Authentication=PrincipalPropagation
sap-sysid=A4H
sap-client=100
Description=A4H development client 100
arc1.enabled=true
```

The destination-facing and internal Cloud Connector connections are separate. For this v1 setup,
use `http://<virtual-host>:<virtual-port>` in the BTP destination. In Cloud Connector, that exact
virtual host and port must resolve to an **internal HTTPS mapping with X.509 (`X509_RESTRICTED`)**
and the required ADT paths. The sample virtual port `50001` is only a convention; it need not equal
the SAP backend port. Setting `Authentication=PrincipalPropagation` in the destination does not
convert an HTTP/`NONE_RESTRICTED` Cloud Connector mapping into HTTPS/`X509_RESTRICTED`.

On newer Cloud Connector versions, choose X.509 user-certificate propagation and disable the
system-certificate-for-logon fallback. Older versions may label this **X.509 Certificate (strict
usage)** or represent it as `X509_RESTRICTED`.

`arc1.enabled=true` is the only required ARC-1-specific destination property for source reads.
Principal Propagation remains the recommended choice because SAP sees the human user.

If PP is unavailable and the deployment flag above is enabled, use a Basic destination instead:

```properties
Name=ARC1_NPL_001_BASIC
Type=HTTP
URL=http://npl-abap.internal:50000
ProxyType=OnPremise
Authentication=BasicAuthentication
User=ARC1_READER
Password=<strong-generated-ASCII-password>
Preemptive=true
sap-sysid=NPL
sap-client=001
Description=Read-only NPL client 001 (shared technical identity)
arc1.enabled=true
```

`Preemptive` may be omitted; when present it must be `true`. Use a communication/technical user
with only the SAP permissions required by the enabled read operations—never a dialog administrator
or `SAP_ALL`. Prefer one technical user per SAP client and security boundary. Usernames must not
contain `:` or surrounding whitespace; strong ASCII credentials are recommended. Every scoped
XSUAA caller reaches this target as that one SAP user, so correlate SAP activity with ARC-1 audit
records when human attribution is needed.

Basic still uses the OnPremise Cloud Connector tunnel and the same restricted ADT resource paths,
but it does not use the PP identity certificate or CERTRULE mapping. Point it at a separate reviewed
mapping whose principal type is **None** (`NONE_RESTRICTED` in the Cloud Connector API), not the PP
`X509_RESTRICTED` mapping. Use HTTPS for the internal Cloud Connector-to-SAP leg in production. An
HTTP internal mapping sends the reusable Basic technical-user password unencrypted on that internal
hop even though the BTP-to-Cloud-Connector tunnel is protected; ARC-1 cannot verify that internal
protocol from Destination Service.

The SAP `/sap/bc/adt` ICF logon procedure must accept HTTP Basic for the technical user. ARC-1
suppresses SAML for this path and rejects a 2xx HTML/SSO login page as authentication failure; it
cannot make an SSO-only ICF service accept Basic.

V1 accepts only one Basic destination per physical URL/client/Cloud Connector location. Aliases do
not permit the same shared Basic backend to be registered twice; every duplicate claimant is
quarantined. A shared Basic connection also cannot be simultaneously reachable through bare `/mcp`
and a multi-target route. Strict-PP `/mcp` remains compatible because it never dispatches through
the shared startup credential. V1 runs no technical-user startup probe.
Feature evidence is learned from an authorized call. PP and Basic targets may coexist, but there is
never fallback between them.

### 5. Restart to discover destinations

```bash
cf restart <arc1-app-name>
```

Non-secret destination changes require a restart, not another MTAR build or deployment. A Basic
`User`/`Password` rotation is loaded on the next request and is described under
[Restart and verification behavior](#restart-and-verification-behavior).

### 6. Assign a role and connect

Assign `ARC-1 Viewer (<space>)` to a test user. For the full configuration check in the next step,
assign `ARC-1 Admin (<space>)` to a separate trusted operator and use a separate MCP connection; do
not add Admin to the Viewer test user because XSUAA combines that user's scopes. Connect the Viewer
to either the pinned URL or `/multi/mcp`. For a quick aggregate connection, create
`.vscode/mcp.json` in the workspace:

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

Use the Admin role only for trusted configuration diagnostics. Pinned and aggregate examples, plus
guidance for choosing between them, are in
[VS Code and GitHub Copilot configuration](#vs-code-and-github-copilot-configuration).

### 7. Verify one safe read

1. Confirm `/health` contains `components.multiTarget.status: "ready"`.
2. In the separate trusted Admin connection to `/multi/mcp`, call `SAPTargets` and confirm the target
   is active with no duplicate or quarantine diagnostic. For PP-only acceptance, you may skip this
   operator check when no Admin test identity is available; the Viewer read below remains mandatory.
   Shared Basic acceptance requires the Admin check even when only one target is active.
3. Call `SAPRead` with `type: "SYSTEM"` on a pinned connection, or with both `type: "SYSTEM"` and
   `target: "A4H/100"` on the aggregate connection.
4. For PP, test an unmapped or unauthorized user and confirm ARC-1 returns a safe PP/auth error
   rather than another user's SAP session. For Basic, use the Admin connection to confirm
   `SAPTargets` labels the target `identity: "shared"`, then confirm the `SAPRead SYSTEM` result
   reports the intended technical SAP user. A Viewer does not receive `SAPTargets` when only one
   target is active.

You are done when health is ready, the expected target is active, the reader sees the expected
read-only tools, and the selected-identity `SAPRead` call succeeds.

### Roll back or disable shared Basic targets

For an emergency disable without removing PP targets, override the running CF application and
restart it:

```bash
cf set-env arc1-mcp-server ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH false
cf restart arc1-mcp-server
```

Basic destinations are then quarantined as `BASIC_AUTH_DISABLED`; PP destinations keep working.
Confirm the result with Admin `SAPTargets`. This CF override is temporary configuration drift: a
later MTA deployment can restore the value from the deployment descriptor.

For a durable disable, set `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH: "false"` in the customer's protected
`mta-overrides.mtaext`, validate that actual file with
`npx mbt validate -e mta-overrides.mtaext`, then build and deploy it with the approved
[non-rolling procedure](btp-administration.md#non-rolling-update-for-shared-basic). For a code
rollback, complete the disable and verification first, then deploy the prior revision with the same
non-rolling stop/start strategy.

<a id="exact-v1-tool-surface"></a>
<a id="v1-safety-boundary"></a>
<a id="aggregate-tool-behavior"></a>

## What multi-target v1 exposes

Both pinned and aggregate routes draw from the same set of up to eight permitted SAP-contacting
tools. Tool lists are narrowed by configured instance/target policy and XSUAA scope where the schema
permits it:

- `SAPRead`
- `SAPSearch`
- `SAPQuery`
- `SAPNavigate`
- `SAPLint` (`lint`, `lint_and_fix`, and `list_rules` only; all run offline in ARC-1)
- `SAPDiagnose`
- `SAPContext`
- `SAPTransport` (`list`, `get`, `check`, and `history` only)

On the aggregate route, `SAPTransport.target` is the required SAP system/client selector. The
single-target transport-creation field with the same name is omitted because `create` is not part of
the multi-target surface.

The aggregate route adds a required top-level `target` to each SAP-contacting call. It never stores
a default or current target. Up to 16 active targets appear as exact schema enums; from 17 through
256 the schema uses the target-ID pattern and the model can call `SAPTargets` for valid IDs and
descriptions.

The aggregate schema unions configured data/SQL policy, not live SAP feature availability. The
selected target's policy is rechecked for every call; unsupported backend features or SAP
authorization fail on the direct operation. Enum-based operations are pruned where possible, while
options such as `SAPSearch(source="db"|"both")` remain visible and are denied at runtime when SQL
policy is not enabled.

Viewer access is broader than source files. Depending on backend support, `SAPDiagnose` can expose
syntax/object-state results, CDS test-case or SQL metadata, quick-fix proposals, ST22 dumps,
profiler trace results/requests, system messages, gateway errors, and SQL-trace state/directory.
These operations do not mutate SAP, but they may reveal operational or user information. Narrow
them with `SAP_DENY_ACTIONS` and SAP authorization when the Viewer audience should not receive them.

`SAPTargets` is an authenticated, aggregate-only MCP tool—not an HTTP endpoint:

- readers see it only when more than one target is active and receive IDs, descriptions, and
  `identity` (`per-user` or `shared`);
- admins see it with zero, one, or many targets and during registry failure, with additional
  secret-projected diagnostics; and
- pinned routes never expose it.

There is no public `/targets` route. Bare `/mcp` is never assigned to the first or only discovered
destination; it exists only when a single target is configured explicitly.

`SAPDiagnose.atc` and `SAPDiagnose.unittest` are available with the existing `read` scope, but they
execute code-analysis/test workloads in SAP and may create transient worklists/results. SAP
authorization, the process-wide concurrency cap, and per-user rate limits still apply. To keep them
out of a customer deployment, set
`SAP_DENY_ACTIONS=SAPDiagnose.atc,SAPDiagnose.unittest`.

The following remain structurally unavailable on multi-target routes even if an admin token or a
side-by-side single-target `/mcp` can write: `SAPWrite`, `SAPActivate`, `SAPGit`, `SAPManage`, every
mutating `SAPTransport` action, and SAP-backed `SAPLint` formatter/settings actions. Direct calls to
unlisted actions are rejected as well as omitted from tool schemas.

<a id="target-discovery"></a>

## Destination configuration

### Required fields and validation

| Property | Requirement |
|---|---|
| `Name` | Internal BTP identifier; 1–200 letters, digits, `_`, `.`, or `-`. It does not determine the MCP route. |
| `Type` | Exactly `HTTP`. |
| `URL` | Cloud Connector virtual URL. For PP, the matching internal connection must use HTTPS/`X509_RESTRICTED`; Basic still needs a valid OnPremise mapping and allowed ADT paths. The URL is never returned to readers or models. |
| `ProxyType` | Exactly `OnPremise`. |
| `Authentication` | `PrincipalPropagation` (recommended, `identity: "per-user"`) or `BasicAuthentication` only with the instance opt-in (`identity: "shared"`). |
| `User` / `Password` | Required only for Basic. Destination secrets loaded at request time and never returned by ARC-1. |
| `Preemptive` | Basic only; optional. If present it must be `true`. |
| `sap-sysid` | Three uppercase alphanumeric characters, starting with a letter; for example `A4H`. |
| `sap-client` | Exactly three digits; ARC-1 never assumes client `100`. |
| `Description` | Strongly recommended and at most 160 characters after normalization. ARC-1 replaces control characters and line breaks with spaces and collapses whitespace. Missing, empty-after-normalization, or overlong values warn and fall back to the target ID. |
| `arc1.enabled` | Must be `true` for ARC-1 to accept the destination. |
| `arc1.target_alias` | Optional public system segment for landscapes where different systems reuse the same real SID/client. It must start with an uppercase letter and use 3–32 uppercase letters/digits with internal `-`; for example `A4H-2025`. Do not include `/001`. |

Without an alias, the public target ID is `<sap-sysid>/<sap-client>`, for example `A4H/100`.
With `arc1.target_alias=A4H-2025`, it is `A4H-2025/<sap-client>`. The alias changes only the
model-visible target ID and pinned URL: selected authentication and ADT still use the real
`sap-sysid`, `sap-client`, URL, and destination name. A destination has exactly one public target ID;
ARC-1 does not retain a second canonical route for an aliased destination.

`sap-language` and `CloudConnectorLocationId` are optional standard properties.
When `sap-language` is omitted or blank, the instance `SAP_LANGUAGE` is inherited; a valid
two-letter value overrides it, while a nonblank invalid value quarantines the destination.

Descriptions are model-visible, untrusted labels. Keep them factual and short. Do not put
instructions, credentials, secrets, token-bearing links, or sensitive operational notes in them.

Property names are case-sensitive. Supported boolean values may contain surrounding whitespace and
are case-insensitive, but lowercase `true`/`false` is recommended. A target alias is case-sensitive
and must match exactly; ARC-1 does not trim or rewrite destination alias values.

### Systems that reuse the same SID and client

Independently installed SAP systems can have the same real SID and client. For example, an S/4HANA
2023 trial and ABAP Platform 2025 trial may both be `A4H/001`. Give at least one system a distinct
public alias while keeping both SAP identities truthful. This example preserves the existing 2023
target and adds an alias only to 2025:

```properties
# 2023 destination
sap-sysid=A4H
sap-client=001
Description=S/4HANA 2023 test system (A4H client 001)
arc1.enabled=true
```

```properties
# 2025 destination
sap-sysid=A4H
sap-client=001
Description=ABAP Platform 2025 test system (A4H client 001)
arc1.enabled=true
arc1.target_alias=A4H-2025
```

These become `A4H/001` and `A4H-2025/001`. You may instead alias both systems as `A4H-2023` and
`A4H-2025` when no existing route must stay stable. An alias is a selection label, not an ACL and
not a claim that SAP has a different SID. Changing it requires an ARC-1 restart and client
reconnection; the previous pinned URL then returns the same authenticated 404 as any unknown target.

<a id="4-opt-individual-targets-into-data-or-sql"></a>

### Optional data preview and SQL profile

Data preview and freestyle SQL can expose business data. Enable them only after approval under your
SAP agreement and internal data-protection rules. First raise the instance ceilings:

```yaml
modules:
  - name: arc1-mcp-server
    properties:
      SAP_ALLOW_DATA_PREVIEW: "true"
      SAP_ALLOW_FREE_SQL: "true"
```

Apply the application ceiling first: add only the required `SAP_ALLOW_*` properties to the same
`mta-overrides.mtaext`, then rebuild and deploy it:

```bash
npm run btp:build-deploy-ext
```

This application-environment change requires deployment; a destination-only restart cannot enable
the ceiling. After the deployment succeeds, add the target properties below and restart ARC-1 so
the destination snapshot includes them.

Then opt in only the targets that need the capability:

```properties
Name=ARC1_BWQ_200_PP
Type=HTTP
URL=http://bwq-abap.internal:50001
ProxyType=OnPremise
Authentication=PrincipalPropagation
sap-sysid=BWQ
sap-client=200
Description=BW quality analytics client 200
arc1.enabled=true
arc1.allow_data_preview=true
arc1.allow_free_sql=true
```

The two target switches are independent. Missing properties mean false. Only these four `arc1.*`
keys are supported in v1:

- `arc1.enabled`
- `arc1.allow_data_preview`
- `arc1.allow_free_sql`
- `arc1.target_alias` (optional public routing identity; not a capability switch)

Unknown `arc1.*` properties fail closed. Write/package/transport/Git properties quarantine the
destination because writes are not supported. There is no `arc1.config_version` property in v1.

Every sensitive call must pass all layers:

```text
effective capability = multi-target v1 ceiling
                     ∩ ARC-1 application ceiling
                     ∩ selected destination opt-in
                     ∩ XSUAA user scope
                     ∩ selected SAP identity authorization
```

An instance ceiling of `true` only makes a capability eligible; it does not enable every target.
On `/multi/mcp`, a tool may be listed because one target permits it, but every call rechecks the
selected target and can return `TARGET_POLICY_DENIED`.

### Clone reviewed destinations carefully

BTP Cockpit can export and import destinations as JSON, YAML, or Properties. This is useful for
copying a reviewed template, but destination exports may contain connection or authentication
material. Never commit, attach, paste, or screenshot an unredacted export. When cloning, explicitly
review `Name`, `URL`, SID, client, description, authentication/Cloud Connector settings, and both
ARC-1 policy switches before import.

<a id="5-assign-the-existing-xsuaa-role-collections"></a>
<a id="authentication-and-visibility"></a>

## XSUAA roles and target visibility

Multi-target v1 uses the existing global role collections; it does not create one role per target.

| Role collection | Effect on multi-target routes |
|---|---|
| `ARC-1 Viewer (<space>)` | Permitted mutation-free reads and diagnostics; compact `SAPTargets` is listed only when more than one target is active and identifies each target as `per-user` or `shared`. |
| `ARC-1 Data Viewer (<space>)` | Viewer access plus destination/instance-enabled data-preview actions. |
| `ARC-1 Viewer + SQL (<space>)` | Viewer/data access plus destination/instance-enabled `SAPQuery`. |
| `ARC-1 Admin (<space>)` | Expanded `SAPTargets` diagnostics; mutations remain absent from multi-target routes. |

Developer role collections include read scope, but cannot unlock multi-target mutations. Role
assignment does not create an SAP user or Principal Propagation mapping. For Basic targets, it also
does not change the destination's shared technical user. `SAPTargets` lists configured targets, not
the targets the current user can actually access; ARC-1 learns that only when a SAP call is made.

### OAuth scopes on first sign-in

Pinned and aggregate routes advertise only the mutation-free `read`, `data`, `sql`, and `admin`
scopes. They do not force a read-only initial grant. General MCP clients such as VS Code and Cursor
therefore request the advertised set, and XSUAA issues only the subset permitted by the signing
user's role collections. ARC-1 then prunes tools and actions from that token:

```text
Viewer             -> read
Data Viewer        -> read, data
Viewer + SQL       -> read, data, sql
Admin              -> read, data, sql, admin
```

A valid token must still contain `read` before ARC-1 resolves a pinned route or exposes the
aggregate transport. Role changes require logout/reconnect because an existing refresh grant cannot
add scopes that were not granted originally.

!!! warning "Do not extend this flow to writes"

    Initial scope negotiation is acceptable here only because the multi-target surface is
    structurally mutation-free. Do not add `write`, `transports`, or `git` to its advertised scopes.
    A future write-capable multi-target version requires a new security review covering explicit
    consent, step-up support, token privilege, wrong-target mutations, and client compatibility.

!!! danger "Side-by-side single-target `/mcp`"

    `MCPAdmin` implies every ARC-1 scope. Multi-target routes remain mutation-free, but the same
    token may allow write, transport, or Git operations on a write-enabled single-target `/mcp`.
    Grant Admin only to trusted operators and prefer a separate ARC-1 application when a writable
    single-target endpoint must coexist.

See [Authorization & Roles](authorization.md) and
[Principal Propagation Setup](principal-propagation-setup.md) for the other authorization layers.

<a id="6-restart-after-destination-changes"></a>
<a id="7-verify-the-deployment"></a>
<a id="health"></a>
<a id="startup-and-destination-changes"></a>

## Restart and verification behavior

ARC-1 loads one immutable destination snapshot at process startup.

| Change | Required action |
|---|---|
| Create, disable, or delete a destination | `cf restart <arc1-app-name>` |
| Change SID/client, description, connection, authentication, or `arc1.*` policy | `cf restart <arc1-app-name>` |
| Rotate Basic `User`/`Password` only | No restart. The next request loads the new generation. For zero downtime, atomically switch the destination to a second reviewed technical user and revoke the old user only after safe reads succeed. A same-user password change can have a short consistency/outage window because SAP cannot normally keep both passwords valid. |
| Repair PP SAP user, CERTRULE, PP mapping, or PP SAP authorization | No restart; retry immediately. PP failures are not cached. |
| Repair a shared Basic user's canary ADT authorization | Restart ARC-1, wait 15 minutes for the temporary block to expire, or rotate to a reviewed credential before retrying. If the change affects cached feature evidence, restart or rotate; waiting alone does not refresh that cache. |
| Change an XSUAA role | Sign in again/reconnect to obtain a new token. |
| Change the ARC-1 application ceiling through MTA/CF environment | Apply the environment/deployment change and restart or restage as required. |

The complete common lifecycle—including role changes, DCR secret rotation, code upgrades, scaling,
and rollback—is in [BTP Administration](btp-administration.md#change-and-restart-matrix).

At request time ARC-1 resolves the selected destination again without the SDK cache. If its safe
configuration no longer matches the startup snapshot, the call returns `TARGET_CONFIG_CHANGED`
until restart. Basic `User` and `Password` values are deliberately excluded from this safe
fingerprint and loaded on each request, which is why credential-only rotation does not require a
restart.

`/health` remains public and HTTP 200 so Cloud Foundry does not crash-loop the app. The relevant
multi-target fields are:

```json
{
  "status": "ok",
  "components": {
    "multiTarget": { "status": "ready" }
  }
}
```

`ready` includes a valid snapshot with zero active targets or individually quarantined entries.
`error` means registry discovery or the 256-enabled-target limit made the entire registry
unavailable. During that failure, `/multi/mcp` remains reachable for admin `SAPTargets`; pinned
routes return HTTP 503 and other aggregate tools return a structured registry error.

<a id="target-catalog-tool"></a>
<a id="admin-catalog"></a>

A reader calling `SAPTargets` receives only accepted IDs, descriptions, and effective identity mode:

```json
[
  { "target": "A4H/100", "description": "A4H development client 100", "identity": "per-user" },
  { "target": "NPL/001", "description": "Read-only NPL client 001", "identity": "shared" }
]
```

For full admin output, paging, reason codes, PP-only multi-instance revision checks, Basic passive
health, and failure handling,
see [Multi-Target Administration](multi-target-administration.md).

<a id="8-connect-vs-code-or-github-copilot"></a>
<a id="client-examples"></a>

## VS Code and GitHub Copilot configuration

Both endpoint styles use the normal XSUAA OAuth/DCR flow in `.vscode/mcp.json`.

Use a pinned endpoint for one-system conversations:

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

Use the aggregate endpoint for large estates or conversations that must compare systems:

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

Prefer pinned endpoints when a conversation should never switch targets. Prefer aggregate when
configuring many pinned connections would create excessive client/OAuth registrations. Aggregate
selection carries wrong-target confidentiality risk: an authorized model can read data or run SQL
on the wrong target if every policy layer permits it. Use clear descriptions, keep data/SQL off
unless needed, and separate lookalike production/non-production systems when that risk is
unacceptable.

## Quick troubleshooting

| Symptom | Check |
|---|---|
| The app does not stay started | Check `cf logs arc1-mcp-server --recent`. Missing mandatory service bindings or invalid instance configuration fails startup; zero discovered targets by itself does not. |
| Health reports `error` | Call `SAPTargets` as admin through `/multi/mcp`; check service bindings and the 256-enabled-target limit. |
| Target is missing | Confirm subaccount scope, exact `arc1.enabled=true`, real SID/client and optional alias format, conflicts, then restart. |
| `SAPTargets` is missing | It is aggregate-only. Readers see it only with more than one active target; admins see it at zero/one/many and during registry failure. Check that the user signed in again after a role change and that `SAP_DENY_ACTIONS` does not deny `SAPTargets`. |
| A Viewer sees no SAP tools | With zero active targets this is expected; fix discovery and restart. An Admin can still use `SAPTargets` for diagnostics. |
| `BASIC_AUTH_DISABLED` | The destination is Basic but the deployment did not explicitly set `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH=true`. Enable it only after accepting the shared-identity model, redeploy, and keep one instance. |
| `BASIC_PREEMPTIVE_DISABLED` | Remove `Preemptive=false` or set it to `true`, then restart. |
| `BASIC_CREDENTIALS_MISSING` | Add non-empty `User` and `Password` to the Basic destination and retry; no restart is needed. |
| `BASIC_CREDENTIALS_INVALID` | Remove `:` or surrounding whitespace from the Basic username, review the credential, and retry without restart. |
| `DESTINATION_AUTH_SETUP_FAILED` | The request-time destination lookup or authentication setup failed. Check Destination/Connectivity services and the request ID; retry only after a transient failure or configuration repair. |
| `PP_SETUP_FAILED` | Check the user's PP mapping, destination, and Cloud Connector; repair and retry without restart. |
| `CLOUD_CONNECTOR_ACCESS_DENIED` | The Connectivity proxy could not expose or allow the target. PP: match the reviewed HTTPS/X.509 PP mapping. Basic: match the reviewed Basic OnPremise mapping; it does not require the PP identity certificate. In both cases allow the required ADT paths, then retry without restart. |
| `SAP_AUTHENTICATION_FAILED` | PP: repair mapping/login and retry. Basic: ARC-1 blocks that credential generation to avoid account lockout; rotate the destination `User`/`Password`, then retry without restart. |
| `SAP_AUTHORIZATION_DENIED` | PP: fix the propagated user's SAP role and retry. Basic canary: fix the technical user's least-privilege ADT role, then restart ARC-1 to clear the blocked generation, or rotate to a reviewed credential and retry hot. |
| `SAP_TARGET_BUSY` | The Basic target's bounded request gate is busy; retry after the active call completes. Persistent occurrences indicate that a shared Basic target is unsuitable for this load. |
| `SAP_TARGET_TEMPORARILY_UNAVAILABLE` | The Basic canary reached a transient network, timeout, rate, SAP 5xx, or unrecognized non-login 2xx response. Check SAP/intermediary health and retry; the credential generation was not blocked. |
| `TARGET_CONFIG_CHANGED` | Review the destination change and restart ARC-1. |
| Data/SQL action is absent or denied | Check the instance ceiling, target property, XSUAA role, and SAP authorization. |

<a id="not-in-v1"></a>

For all diagnostic codes, operational sizing, the complete deferred-feature list, and the
production checklist, continue with
[Multi-Target Administration](multi-target-administration.md).
