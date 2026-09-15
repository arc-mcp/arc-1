# BTP Cloud Foundry deployment

Deploy a read-only ARC-1 service with XSUAA login and per-user SAP access. This runbook uses `mta.yaml` to deploy the app, service bindings and role collections together.

Use documentation and examples from the revision you will deploy. For changes to an existing service, start with [BTP administration](btp-administration.md).

SAP's **Multi-Target Application (MTA)** describes the app and service resources deployed from an `.mtar` archive. ARC-1 **multi-target** means serving several SAP systems/clients; both single- and multi-target deployments use MTA packaging. **Principal Propagation (PP)** lets SAP authorize each human user.

## 1. Choose the topology before configuring anything

| SAP landscape | Profile / next step |
|---|---|
| One on-premise system/client | Single-PP profile in step 4; endpoint `/mcp` |
| Several on-premise systems/clients | Multi-PP profile in step 4; pinned routes and `/multi/mcp` |
| BTP ABAP Environment | Use [BTP ABAP setup](btp-abap-environment.md) for destination/authentication settings |
| S/4HANA Public Cloud | Use [Public Cloud setup](s4hana-public-cloud.md) for destination/authentication settings |

Multi-target routes remain mutation-free. Shared Basic is a separately enabled exception that requires one non-rolling CF process.

Use separate apps for different write limits, capacity or administrative boundaries; use separate subaccounts when destination inventory must be isolated. Before combining a writable `/mcp` with multi-target routes, review the [side-by-side risks](multi-target-administration.md#optional-single-target-mcp).

<a id="2-assign-owners"></a>

## 2. Assign deployment tasks

Several administrators must configure their part of the connection. Agree who will do each task before the change
window. The [optional worksheet](btp-setup-worksheet.md) can help record them.

| Task | Administrator |
|---|---|
| Entitlements and subaccount/space | BTP subaccount administrator |
| MTA build, deploy, route, and bindings | CF Space Developer |
| Destination fields and credentials | Destination Administrator |
| XSUAA role collections and users/groups | User and Role Administrator |
| Cloud Connector mapping and resources | Cloud Connector administrator |
| STRUST, CERTRULE, ICM/SICF, SU01, SAP roles | SAP Basis/security |
| MCP client login and first read | ARC-1 administrator and test user |

Destinations and trust belong to the subaccount; the app and service instances belong to the CF space. Multi-target discovery sees subaccount destinations, so another space does not isolate that inventory.

## 3. Prepare the landscape

### Prerequisites

- Cloud Foundry is enabled in the intended BTP subaccount.
- The subaccount has quota for XSUAA (`application`), Destination (`lite`), and Connectivity (`lite`).
- Node.js 22.19 or later, npm, CF CLI, CF MultiApps plugin, and the Cloud MTA Build Tool (MBT) are available.
- The operator is logged in and targeted at the intended org and space.
- For on-premise SAP, Cloud Connector is connected to this exact subaccount.
- For on-premise PP, the SAP and Cloud Connector administrators can complete the
  [Principal Propagation runbook](principal-propagation-setup.md).
- A User and Role Administrator can inspect and assign the generated collections.

SAP Business Application Studio can supply the CLI toolchain when an administrator cannot build on
a local workstation. Use a controlled Dev Space, clone the selected revision, and follow the same
commands below.

### Preflight

Run these read-only checks in the operator shell:

```bash
node --version
npm --version
cf version
cf plugins | grep -E 'multiapps|MultiApps'
mbt --version
cf target
cf services
```

Stop if `cf target` names the wrong API endpoint, org, or space. Record the selected values in the
deployment ticket. Confirm entitlements in BTP Cockpit rather than discovering missing quota halfway
through the deploy.

**Existing services:** the MTA creates managed instances named `arc1-destination` and `arc1-connectivity`. Differently named instances are not reused automatically. This can consume extra quota; instance-level destinations on an existing service will not move to a new service.

An extension can select an existing name:

```yaml
resources:
  - name: arc1-destination
    parameters:
      service-name: my-shared-destination
```

The instance remains **MTA-managed**: deployment creates it if absent, and `cf undeploy --delete-services` can delete it. Use this only when ARC-1 owns its lifecycle. For a service owned elsewhere, an `org.cloudfoundry.existing-service` change in `mta.yaml` is required; an extension cannot change a resource's `type`.

## 4. Create the landscape extension

`mta.yaml` owns versioned safe defaults and BTP resource topology. A customer-owned extension owns
durable landscape-specific settings. Destinations own target-local connection and identity data.

```bash
git clone https://github.com/arc-mcp/arc-1.git
cd arc-1
git checkout <tag-or-commit>
npm ci
```

For BTP ABAP or S/4HANA Public Cloud, use the complete extension in the selected cloud guide from step 1. For on-premise SAP, choose **one** profile below from this checkout. If `mta-overrides.mtaext` already exists, compare
and adapt it instead of copying another template over it. The `cp -n` commands preserve an existing
file; a skipped copy does not mean the selected profile was applied.

The real `mta-overrides.mtaext` is gitignored. Store the customer copy in the customer's protected
configuration process. Never add secrets to it and never edit generated `mtad.yaml`.

### Single-target read-only PP profile

For an on-premise `/mcp`, the current runtime uses a Basic destination to resolve the startup target
and a PP destination for every JWT-backed user request:

```bash
cp -n examples/btp/single-pp/profile.mtaext mta-overrides.mtaext
```

Prepare private copies of `examples/btp/single-pp/startup.destination.json` and
`request.destination.json` under the ignored `.arc1/btp/` directory. Replace the fictional values
and update the two destination names in the extension together. The example README explains the
startup/request pairing. Its least-privileged startup user is not a PP fallback.

### Multi-target PP-only profile

```bash
cp -n examples/btp/multi-pp/profile.mtaext mta-overrides.mtaext
```

Prepare private copies of the two `examples/btp/multi-pp/*.destination.json` files under
`.arc1/btp/`. Replace the fictional QAS targets with your system/client values; add one file per
additional target if needed. These are subaccount-level PP destinations; no startup destination is
needed. Keep `SAP_BTP_DESTINATION` and `SAP_BTP_PP_DESTINATION` absent, including in existing app env.

### Prepare the selected PP profile

Both examples keep strict PP on, all mutation/data/SQL flags off, UI/plugins off and cache none.
They also deny ATC/Unit workloads during initial setup; that is a profile choice, not a general
multi-target limitation. Do not combine the profiles or add UI overlays.

Replace names, virtual URLs, real SID/client and descriptions in your private destination files.
Keep clients such as `001` quoted. Add `CloudConnectorLocationId` only if the Cloud Connector administrator
supplies one. JSON files show the destination fields to create in the cockpit; they do not provision
anything or guarantee a particular import format. Keep startup credentials in the destination administrator's secret store, not in a PR or LLM prompt.

Ask the Cloud Connector and SAP Basis administrators to complete [Principal Propagation Setup](principal-propagation-setup.md)
and create/review the destinations using [Destination Reference](btp-destination-setup.md).
**For single PP, both destinations must exist before deploying this profile:** startup resolves
the startup destination and fails if it is missing. Multi PP can start empty, but requires all
processes to restart after destinations are added. Then continue to step 5 below.

### Multi-target with a shared Basic exception

Use this complete extension profile instead of the PP-only profile, and only after the customer
accepts shared SAP attribution, reusable destination credentials, SAP account-lock exposure,
downtime for deployment, and no horizontal scaling:

```yaml
_schema-version: "3.1"
ID: arc1-mcp-overrides
extends: arc1-mcp

modules:
  - name: arc1-mcp-server
    parameters:
      instances: 1
    properties:
      ARC1_MULTI_TARGET_ENDPOINTS: "true"
      ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH: "true"
      ARC1_CACHE: none
```

This permits Basic destinations; it never converts PP destinations or provides a fallback. Every
XSUAA user authorized to call a Basic target acts in SAP as that destination's same technical user.
Use a separate principal-type-None Cloud Connector mapping with internal HTTPS and a dedicated,
least-privileged technical SAP user. See
[Shared Basic controls](multi-target-administration.md#basic-shared-identity-controls).

## 5. Validate, build, and inspect the MTAR

```bash
npm run btp:validate
npx mbt validate -e mta-overrides.mtaext
npm run btp:build
```

The first command validates tracked descriptors; the second validates your actual customer override. Both must pass. MBT creates `mta_archives/arc1-mcp_<version>.mtar`.

Before deploying, [inspect the MTAR](btp-archive-inspection.md): check every nested `data.zip` payload, then review the file lists for credentials and unexpected local files. Record the exact archive path and SHA-256 digest. On macOS/Linux:

```bash
shasum -a 256 "mta_archives/arc1-mcp_<version>.mtar"
```

On PowerShell, use `Get-FileHash "mta_archives/arc1-mcp_<version>.mtar" -Algorithm SHA256`.

## 6. Deploy the MTA

Run from the selected checkout as the CF Space Developer:

```bash
npm run btp:deploy-ext
```

This deploys `mta_archives/arc1-mcp_<package-version>.mtar` with the protected override. Confirm it is the archive inspected in step 5; rebuilding requires inspecting the new archive before deployment.

The deployment creates/updates:

- `arc1-mcp-server`, one 512 MB process by default;
- XSUAA with ARC-1 scopes, templates, and seven space-qualified role collections;
- Destination and Connectivity service instances and bindings; and
- a health check on `/health`.

The unconfigured base application and multi-target mode can start with no SAP targets. The
single-PP profile is different: its startup destination must already exist, as checked in step 4.

Verify platform state:

```bash
cf app arc1-mcp-server
cf services
cf logs arc1-mcp-server --recent
```

Expected result: one healthy process, bound `arc1-xsuaa`, `arc1-destination`, and
`arc1-connectivity` services, and no startup validation error. A multi-target registry with zero
targets is healthy-but-unconfigured, not ready for users.

## 7. Set the stable OAuth DCR key

Dynamic Client Registration (DCR) lets MCP clients register during OAuth login. Set a stable signing key once in an operator shell with restricted access:

```bash
cf set-env arc1-mcp-server ARC1_DCR_SIGNING_SECRET "$(openssl rand -base64 48)"
cf restage arc1-mcp-server
```

The dedicated key keeps stateless MCP client registrations valid when an XSUAA binding secret
rotates during later MTA deployments. Never commit the value, put it in the extension/MTAR, paste it
into support material, or expose unredacted `cf env` output. Store it in the customer's approved
secret process. Rotating it intentionally revokes every cached DCR registration.

See [BTP Administration](btp-administration.md#dcr-signing-secret) for lifecycle and limitations.

## 8. Verify role collections before assigning users

As User and Role Administrator:

1. Open **BTP Cockpit → Security → Role Collections**.
2. Find all seven collections for the CF space, for example `ARC-1 Viewer (dev)` through
   `ARC-1 Admin (dev)`.
3. Open each collection and confirm its **Roles** tab contains the expected current
   `arc1-mcp-<space>!t...` application role.
4. Assign `ARC-1 Viewer (<space>)` to the initial test user before their first login.

Do not stop after seeing the role templates under **Roles**. Older/recreated XSUAA deployments can
have missing or orphaned collections. A collection with an empty **Roles** tab grants nothing. See
[XSUAA role administration](xsuaa-setup.md#step-3-assign-role-collections) for repair and IdP-origin
details.

## 9. Configure SAP connectivity and destinations

For BTP ABAP or S/4HANA Cloud, verify the Internet destination from that cloud guide, then continue
to step 10. The on-premise steps below do not apply.

For on-premise SAP, verify the destinations and PP mapping prepared in step 4. Otherwise complete
them now (multi-target can start with an empty catalog).

Give the Cloud Connector and Destination administrators the subaccount, CF org/space, route, topology, SAP clients, destination names and test-user details from the [worksheet](btp-setup-worksheet.md).

For on-premise PP, complete [Principal Propagation Setup](principal-propagation-setup.md). It contains the
Cloud Connector/SAP certificate procedure. Expose `/sap/bc/adt` and required
subpaths, not `/`; preserve backend TLS verification; and prove issuer-restricted certificate
mapping in CERTRULE before testing ARC-1.

Then create the destinations using [BTP Destination Reference](btp-destination-setup.md):

- single target: the explicitly named startup and PP destinations in the extension;
- multi-target: one subaccount destination per SAP system/client, normally PP, with
  `sap-sysid`, `sap-client`, `Description`, and `arc1.enabled=true`.

Restart after multi-target destination additions or non-secret changes:

```bash
cf restart arc1-mcp-server
```

For a discovered multi-target Basic destination only, `User`/`Password` rotation is request-time and
needs no restart. A single-target `SAP_BTP_DESTINATION` is resolved at startup, so credential changes
require restarting every app instance. Every non-secret multi-target field belongs to the immutable
startup registry.

## 10. Verify the service in layers

### Process and OAuth metadata

```bash
ROUTE="https://<route-from-cf-app>"
curl -fsS "$ROUTE/health" | jq .
curl -fsS "$ROUTE/.well-known/oauth-authorization-server" | jq .
```

`/health` only proves process health. It does not prove that a destination is active, a user can map
through PP, or SAP authorizes ADT.

### Sign in and perform a safe read

Configure the client with exactly one selected endpoint:

| Mode | URL |
|---|---|
| Single target | `https://<route>/mcp` |
| Pinned target | `https://<route>/A4H/100/mcp` |
| Aggregate multi-target | `https://<route>/multi/mcp` |

Use the Viewer identity. After OAuth:

1. confirm the expected mutation-free/read-only tool catalog;
2. for aggregate mode with more than one active target, call `SAPTargets` and select the exact
   target; an Admin connection can inspect `SAPTargets` with zero, one, or many targets;
3. call `SAPRead` with `type: "SYSTEM"`;
4. call `SAPRead` with `type: "COMPONENTS"`; and
5. call `SAPSearch` for one known object.

These calls establish safe-read access, not the backend login identity: `SYSTEM.user` can come from
configuration or token claims. Follow [backend identity verification](principal-propagation-setup.md#verify-the-backend-identity)
with Basis and record that result separately. For shared Basic, verify the intended technical user
in the SAP logs; Admin `SAPTargets` labels that target `identity: "shared"`.

For the multi-only example, verify that `/mcp` is unavailable and pinned routes do not expose
`SAPTargets`. The aggregate catalog is configuration inventory, not proof of the user's SAP access.
For each PP target, use a test identity approved by the SAP administrator to verify that failed mapping or SAP
authorization does not become shared-user access. Do not change working users or grant Admin just
to manufacture a test. Repository metadata alone does not prove client isolation; keep any separate
client-data check unverified until approved rather than enabling data/SQL for the smoke test.

As Admin on multi-target, call `SAPTargets` and review zero/one/many behavior, registry revision,
quarantined/disabled entries, duplicate/shadow warnings, and instance policy narrowing. There is no
public or standalone `/targets` endpoint.

<a id="add-capability-only-after-acceptance"></a>

### Enable additional capabilities after verification

For a single-target instance, widen the application ceiling in the customer `.mtaext`, redeploy,
assign the least-privilege XSUAA collection, and retest the negative boundary. Data, SQL, writes,
transports, Git, and package scope are independent decisions.

For multi-target v1, data preview and SQL require both application ceilings and target-local
destination opt-ins. The [supported tools and actions](multi-target-setup.md#allowed-tools) also
include offline lint, read-only transport inspection, ATC and ABAP Unit. ATC/Unit execute SAP
workloads: keep them out of routine deployment smoke tests, and deny their actions when not approved.
Writes, activation, transport/Git mutations, SAP-backed formatter/settings actions, plugins, UI,
and hyperfocused mode remain unavailable.

Start data access with the shipped 2 MiB response allowance and two process-wide data-result slots. For larger results, change memory and both admission limits together using [BTP RAM sizing](btp-administration.md#data-preview-ram-sizing), then measure concurrent peak RSS. `0` is invalid for either limit.

Keep the MTA's `OPTIMIZE_MEMORY=true` and `exec sh ./bin/start-cf.sh` launcher. It derives Node old-space from CF memory. After resizing, verify the `Runtime memory envelope` and `Data-result safety envelope` startup logs.

## 11. Handover and ongoing operation

Before customer users connect, complete the
[checks before users connect](btp-administration.md#pre-customer-acceptance). Record:

- the Git revision and `.mtaext` desired state;
- exact route, org/space, services, mode, instance count, target ownership, and role assignments;
- DCR-key backup/rotation administrator without recording the value in the ticket;
- SAP/Cloud Connector checks and the first successful reads;
- concurrency/rate decisions and monitoring contact; and
- the prior MTAR and mode-appropriate rollback procedure.

Use [BTP Administration](btp-administration.md) for change/restart decisions, upgrades, role
lifecycle, scaling, logging, incidents, and rollback. Multi-target registry/status codes and Basic
lockout behavior remain in [Multi-Target Administration](multi-target-administration.md).

## Advanced deployment alternatives

The MTA path above is the supported BTP administrator journey because it keeps application and BTP
service topology together. Docker and direct buildpack deployment can be useful for a custom base
image, corporate CA bundle, or an organization with its own CF release pipeline, but then that
pipeline owns service creation, bindings, route, role collections, health checks, exact version
pinning, secret exclusion, and mode-specific scaling. Do not copy a generic `/mcp` manifest into a
multi-target deployment without reproducing every startup invariant.

For a container pipeline, start from [Docker Deployment](docker.md). Pin an exact ARC-1 version, not
`:latest`, and use a dedicated customer manifest rather than treating the repository MTA and a
manifest as two simultaneous desired-state sources.

## Deploying without Docker (Node.js buildpack)

The shipped MTA already deploys a Node.js buildpack module; it does not require Docker. If you mean a
manual `cf push` without MTA, build the runtime first and provide the same services/properties in a
customer-owned manifest:

```bash
npm ci
npm run build
cf push -f <customer-manifest.yml>
```

This is an advanced alternative. Validate it against `mta.yaml`, `xs-security.json`, the selected
single/multi startup requirements, the MTAR secret exclusions, and the connection checklist. A raw
buildpack push does not create the seven MTA role collections for you.

## Troubleshooting deployment

| Symptom | Check |
|---|---|
| MTA lifecycle type cannot change | Existing app was deployed through another lifecycle; use a separate beta space or an approved migration/rollback plan |
| App has no target but is healthy | Expected for target-free base; configure explicit `/mcp` destinations or marked multi destinations |
| Multi-target startup exits | Check XSUAA, Destination, Connectivity bindings and required mode invariants (`ARC1_CACHE=none`, standard tools, UI/plugins off) |
| Multi-target is ready with zero active targets | Call Admin `SAPTargets`; health is not SAP readiness |
| Role collection missing/empty | Perform full MTA deploy, inspect roles, reconcile stale collection roles with the identity administrator, then obtain a fresh token |
| OAuth `invalid_client` after deploy | Restore the intended DCR signing key or re-register clients; do not invent a new key on every deploy |
| OAuth `invalid_scope` after a grant | On the failure page choose **Role assigned? Refresh access**, then reconnect the MCP client; verify the user's IdP origin if it persists |
| SAP `401` through PP | Check generated user certificate, STRUST, trusted proxy, ICF logon, CERTRULE, and SU01 |
| SAP `403` after PP login | Check the actual propagated user's SAP authorizations |
| Destination change appears ignored | Restart every ARC-1 instance; only discovered multi-target Basic username/password fields are hot |

## Official references

- [SAP: Deploying Applications](https://help.sap.com/docs/btp/btp-admin-guide/deploying-applications)
- [SAP: Defining MTA Extension Descriptors](https://help.sap.com/docs/btp/sap-business-technology-platform/defining-mta-extension-descriptors)
- [SAP: Destination Service](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/destination-service)
- [SAP: Working with Role Collections](https://help.sap.com/docs/btp/sap-business-technology-platform/working-with-role-collections)
- [Cloud Foundry: Start, Restart, and Restage](https://docs.cloudfoundry.org/devguide/deploy-apps/start-restart-restage.html)
