# BTP Cloud Foundry Deployment

This is the canonical administrator runbook for deploying ARC-1 on SAP BTP Cloud Foundry. It uses
the repository's SAP Multi-Target Application (MTA) descriptor so XSUAA, Destination, Connectivity,
bindings, role collections, health checks, and safe defaults are deployed together.

The first acceptance target is deliberately read-only. Widen a single-target instance only after
identity, authorization, audit, and rollback have been proven. ARC-1 multi-target routes remain
mutation-free in v1 regardless of the single-target ceiling.

!!! note "Two meanings of multi-target"

    An SAP **Multi-Target Application** is the `.mtar` deployment format built from `mta.yaml`.
    ARC-1 **multi-target** is an experimental runtime mode serving several SAP system/client targets.
    You use the MTA format for both single- and multi-target ARC-1 deployments.

## 1. Choose the topology before configuring anything

| Topology | Public MCP URL | SAP identity | Capabilities | Start here |
|---|---|---|---|---|
| One general SAP target | `/mcp` | Principal Propagation recommended; shared Basic is possible | Full ARC-1 feature set, still constrained by instance flags and roles | This page, then [Destination Reference](btp-destination-setup.md) |
| Many SAP system/clients | `/<SYSTEM>/<CLIENT>/mcp` and `/multi/mcp` | PP recommended; optional shared Basic exception | Mutation-free v1: read/search/query/navigate/diagnose/context | This page, then [Multi-System Setup](multi-target-setup.md) |
| One `/mcp` beside multi-target routes | All of the above | Configured independently | `/mcp` may be writable; multi routes never are | Read [side-by-side risks](multi-target-administration.md#optional-single-target-mcp) first |
| BTP ABAP Environment | `/mcp` | `OAuth2UserTokenExchange` | Single target | [BTP ABAP Environment](btp-abap-environment.md) |
| S/4HANA Public Cloud | `/mcp` | SAML/OAuth user exchange | Single target | [S/4HANA Public Cloud](s4hana-public-cloud.md) |

Use separate ARC-1 applications when you need different mutation ceilings, hard target-inventory
separation, different capacity limits, writable multi-system access, or separation between Admin
diagnostics and a writable `/mcp`. For a customer beta or cutover, a separate CF space is safer than
replacing an existing app in place: the shipped XSUAA application and role-collection names are
space-qualified.

Principal Propagation is the normal customer path because SAP receives the human identity. Shared
Basic is a default-off compatibility exception: SAP sees a reusable technical user, and a
multi-target app containing any Basic destination must run exactly one non-rolling CF process.

## 2. Assign owners

Deployment crosses several independent control planes. Confirm the handoffs before the change
window. The [optional worksheet](btp-setup-worksheet.md) can help record them.

| Task | Typical owner |
|---|---|
| Entitlements and subaccount/space | BTP subaccount administrator |
| MTA build, deploy, route, and bindings | CF Space Developer |
| Destination fields and credentials | Destination Administrator |
| XSUAA role collections and users/groups | User and Role Administrator |
| Cloud Connector mapping and resources | Cloud Connector administrator |
| STRUST, CERTRULE, ICM/SICF, SU01, SAP roles | SAP Basis/security |
| MCP client and safe-read acceptance | ARC-1 service owner/user |

The resources live at different levels:

```text
BTP global account
└── subaccount
    ├── trust and subaccount destinations
    └── Cloud Foundry org
        └── space
            ├── ARC-1 application
            └── XSUAA, Destination, Connectivity service instances
```

Multi-target discovery uses subaccount destinations. A different CF space in the same subaccount is
not a hard destination-inventory boundary. Use separate subaccounts if that inventory itself must
be isolated.

## 3. Prepare the landscape

### Prerequisites

- Cloud Foundry is enabled in the intended BTP subaccount.
- The subaccount has quota for XSUAA (`application`), Destination (`lite`), and Connectivity (`lite`).
- Node.js 22.19 or later, npm, CF CLI, CF MultiApps plugin, and MBT are available.
- The operator is logged in and targeted at the intended org and space.
- For on-premise SAP, Cloud Connector is connected to this exact subaccount.
- For PP, the SAP and Cloud Connector administrators can complete the
  [Principal Propagation runbook](principal-propagation-setup.md).
- A User and Role Administrator can inspect and assign the generated collections.

SAP Business Application Studio can supply the CLI toolchain when an administrator cannot build on
a local workstation. Use a controlled Dev Space, clone the reviewed revision, and follow the same
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

Read the `cf services` output before deploying into a space that already runs ARC-1 or shares
platform services. `arc1-destination` and `arc1-connectivity` are declared as
`org.cloudfoundry.managed-service`, and a managed instance is named after its resource — so a
landscape whose instances are named differently gets additional instances rather than reuse.

Because this guide uses subaccount-level destinations, which any Destination instance in the
subaccount can resolve, the duplicate usually costs Destination/Connectivity `lite` quota and
landscape clarity rather than function. It does fail the deploy outright on a subaccount already at
its quota, and ARC-1 genuinely loses the targets if the shared instance carries **instance-level**
destinations (see [Destination level and visibility](btp-destination-setup.md#destination-level-and-visibility)).

An extension descriptor cannot change a resource's `type` — `mbt validate` rejects `type` in
`mta.ResourceExt`. It can only repoint a managed resource at a specific instance name:

```yaml
resources:
  - name: arc1-destination
    parameters:
      service-name: my-shared-destination
```

That binds the named instance, but the resource stays MTA-managed: the deploy creates it if it is
absent, and `cf undeploy --delete-services` would delete it. Use it only when this ARC-1 deployment
is meant to own that instance. Binding an instance whose lifecycle belongs to someone else requires
`org.cloudfoundry.existing-service` in `mta.yaml` itself, which the shipped descriptor does not
offer — treat that landscape as needing a reviewed descriptor change, not an extension.

## 4. Create the landscape extension

`mta.yaml` owns versioned safe defaults and BTP resource topology. A customer-owned extension owns
durable landscape-specific settings. Destinations own target-local connection and identity data.

```bash
git clone https://github.com/arc-mcp/arc-1.git
cd arc-1
git checkout <reviewed-tag-or-commit>
npm ci
```

Choose **one** profile below from this checkout. If `mta-overrides.mtaext` already exists, compare
and adapt it instead of copying another template over it. The `cp -n` commands preserve an existing
file; a skipped copy does not mean the selected profile was applied.

The real `mta-overrides.mtaext` is gitignored. Store the reviewed copy in the customer's protected
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
They also deny ATC/Unit workloads for initial acceptance; that is a profile choice, not a general
multi-target limitation. Do not combine the profiles or add UI overlays.

Replace names, virtual URLs, real SID/client and descriptions in your private destination files.
Keep clients such as `001` quoted. Add `CloudConnectorLocationId` only if the Connector owner
supplies one. JSON files show the destination fields to create in the cockpit; they do not provision
anything or guarantee a particular import format. Keep startup credentials in the owner's secure
process, not in a PR or LLM prompt.

Ask the Connector/Basis owners to complete [Principal Propagation Setup](principal-propagation-setup.md)
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

`npm run btp:validate` checks the repository's base and tracked example descriptors. The explicit
`npx mbt validate -e` command checks the customer's actual protected override. Expected result:
both checks succeed and MBT creates
`mta_archives/arc1-mcp_<version>.mtar`.

Before a customer deploy, inspect the archive in a protected workspace. Three things make a naive
listing useless here:

- **The MTAR is a wrapper.** Each deployed module is one nested `<module>/data.zip`, and the
  application lives inside it. Listing the MTAR shows you `META-INF/` and those nested archives and
  nothing about their contents. The UI variant (`npm run btp:build-ui-ext`) ships more than one
  payload, so inspect every member rather than assuming one.
- **`mta_archives/` accumulates every version you have built.** A glob matching several archives is
  a false green: `unzip -l` treats the second path as a filter *inside* the first and reports
  **0 files** (exit 11), while PowerShell's `OpenRead` fails outright. Resolve one archive and echo
  which one.
- **A gate that cannot find anything must fail, not pass.** No archive, no `data.zip` member, or an
  unreadable payload has to be an error; otherwise a broken workspace reports a clean release.
- **The UI AppRouter has one audited `.npmrc`.** Its `install-links=true` setting is required to
  install the local `decode-uri-component` compatibility bridge reliably. The checks below allow
  only the root `.npmrc` in `arc1-ui-router/data.zip`, and only when it is byte-for-byte identical
  to the reviewed `btp/approuter/.npmrc`; every other `.npmrc` remains denied.

```bash
inspect_mtar() (
  set -o pipefail
  deny='\.env|\.npmrc|service-key|\.(key|pem|p12|pfx|pse|jks|keystore)$'
  mtar=$(ls -t mta_archives/*.mtar 2>/dev/null | head -1)
  [ -n "$mtar" ] || { echo 'FAIL: no archive in mta_archives/'; return 1; }
  echo "$mtar"
  unzip -l "$mtar" || { echo 'FAIL: unreadable archive'; return 1; }
  members=$(unzip -Z1 "$mtar" | grep '/data\.zip$') ||
    { echo 'FAIL: no <module>/data.zip member'; return 1; }
  tmp=$(mktemp -d) || return 1
  trap 'rm -rf "$tmp"' EXIT
  for member in $members; do
    unzip -p "$mtar" "$member" > "$tmp/payload.zip" || { echo "FAIL: cannot extract $member"; return 1; }
    entries=$(unzip -Z1 "$tmp/payload.zip") || { echo "FAIL: cannot read $member"; return 1; }
    n=$(printf '%s\n' "$entries" | wc -l) || { echo "FAIL: cannot count $member"; return 1; }
    echo "-- $member: $n entries"
    bad=$(printf '%s\n' "$entries" | grep -Ei "$deny" || true)
    if [ "$member" = 'arc1-ui-router/data.zip' ]; then
      printf '%s\n' "$entries" | grep -Fx '.npmrc' >/dev/null ||
        { echo 'FAIL: arc1-ui-router/data.zip is missing its required .npmrc'; return 1; }
      unzip -p "$tmp/payload.zip" .npmrc > "$tmp/approuter.npmrc" ||
        { echo 'FAIL: cannot extract arc1-ui-router/.npmrc'; return 1; }
      cmp -s "$tmp/approuter.npmrc" btp/approuter/.npmrc ||
        { echo 'FAIL: packaged arc1-ui-router/.npmrc differs from the reviewed source'; return 1; }
      bad=$(printf '%s\n' "$bad" | grep -Ev '^\.npmrc$' || true)
    fi
    [ -z "$bad" ] || { printf '%s\n' "$bad"; echo "FAIL: denied path in $member"; return 1; }
  done
  echo 'PASS: every payload inspected, no denied paths or unreviewed npm config'
)
inspect_mtar
```

It returns zero only after inspecting every payload successfully, so it is safe to run unattended.
The function body is a subshell, so `pipefail` and the cleanup trap do not leak into your session.

Read a full listing too — the pattern covers today's known names, and the point of the gate is to
catch a file type no denylist anticipated. Take the member names from the wrapper listing above:

```bash
unzip -p "$MTAR" '<module>/data.zip' > payload.zip && unzip -l payload.zip | less
```

On Windows, `Expand-Archive` needs a `.zip` extension, so copy first:

```powershell
$ErrorActionPreference = 'Stop'
$deny = '\.env|\.npmrc|service-key|\.(key|pem|p12|pfx|pse|jks|keystore)$'
$mtar = Get-ChildItem mta_archives\*.mtar | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $mtar) { throw 'FAIL: no archive in mta_archives/' }
$mtar.FullName
$tmp = Join-Path $env:TEMP ([guid]::NewGuid())
try {
  Copy-Item $mtar.FullName "$tmp.zip"
  Expand-Archive "$tmp.zip" "$tmp-outer"
  $members = @(Get-ChildItem "$tmp-outer" -Recurse -Filter data.zip -File)
  if ($members.Count -eq 0) { throw "FAIL: no <module>/data.zip member in $($mtar.Name)" }
  $bad = @()
  foreach ($member in $members) {
    $dest = Join-Path "$tmp-payload" $member.Directory.Name
    Expand-Archive $member.FullName $dest
    $files = @(Get-ChildItem $dest -Recurse -File)
    if ($files.Count -eq 0) { throw "FAIL: empty payload $($member.Directory.Name)" }
    "-- $($member.Directory.Name): $($files.Count) files"
    $allowedNpmrc = $null
    if ($member.Directory.Name -eq 'arc1-ui-router') {
      $allowedNpmrc = Join-Path $dest '.npmrc'
      if (-not (Test-Path $allowedNpmrc -PathType Leaf)) {
        throw 'FAIL: arc1-ui-router/data.zip is missing its required .npmrc'
      }
      $sourceNpmrc = (Resolve-Path 'btp/approuter/.npmrc').Path
      if ((Get-FileHash $allowedNpmrc -Algorithm SHA256).Hash -ne
          (Get-FileHash $sourceNpmrc -Algorithm SHA256).Hash) {
        throw 'FAIL: packaged arc1-ui-router/.npmrc differs from the reviewed source'
      }
    }
    $bad += $files | Where-Object {
      $_.Name -match $deny -and (!$allowedNpmrc -or $_.FullName -ne $allowedNpmrc)
    }
  }
  if ($bad) { $bad.FullName; throw 'FAIL: denied path in payload' }
  'PASS: every payload inspected, no denied paths or unreviewed npm config'
} finally {
  Remove-Item "$tmp.zip","$tmp-outer","$tmp-payload" -Recurse -Force -ErrorAction SilentlyContinue
}
```

A checksum is not a substitute: it proves the archive did not change, not that no secret was packaged.

The application payload must not contain `.env*`, service-key exports, customer `.mtaext` files,
private keys, certificates, local MCP configuration, source tests, operator artifacts, or an
`.npmrc` other than the exact reviewed `btp/approuter/.npmrc` in the UI AppRouter payload. The MTA
build has an explicit denylist and CI coverage for critical names; archive inspection is still a
release gate because a future file type can evade a denylist.

## 6. Deploy the MTA

Run from the reviewed checkout as the CF Space Developer:

```bash
npm run btp:deploy-ext
```

Or build and deploy together:

```bash
npm run btp:build-deploy-ext
```

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

Do this once in a protected operator shell:

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

If step 4 already prepared the destinations and PP mapping, verify those settings here; do not
recreate them. Otherwise complete the setup now (multi-target can start with an empty catalog).

The deployment owner can hand off these stable values now:

- BTP subaccount and CF org/space;
- ARC-1 route from `cf app arc1-mcp-server`;
- selected topology and client number(s);
- Cloud Connector virtual host/port convention;
- destination names for `/mcp`, or destination marker contract for multi-target; and
- initial role collection and acceptance user.

For on-premise PP, complete [Principal Propagation Setup](principal-propagation-setup.md). It is the
only canonical Cloud Connector/SAP certificate procedure. Expose `/sap/bc/adt` and required
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
in the backend evidence; Admin `SAPTargets` labels that target `identity: "shared"`.

For the multi-only example, verify that `/mcp` is unavailable and pinned routes do not expose
`SAPTargets`. The aggregate catalog is configuration inventory, not proof of the user's SAP access.
For each PP target, use an owner-approved negative identity to verify that failed mapping or SAP
authorization does not become shared-user access. Do not change working users or grant Admin just
to manufacture a test. Repository metadata alone does not prove client isolation; keep any separate
client-data check unverified until approved rather than enabling data/SQL for the smoke test.

As Admin on multi-target, call `SAPTargets` and review zero/one/many behavior, registry revision,
quarantined/disabled entries, duplicate/shadow warnings, and instance policy narrowing. There is no
public or standalone `/targets` endpoint.

### Add capability only after acceptance

For a single-target instance, widen the application ceiling in the reviewed `.mtaext`, redeploy,
assign the least-privilege XSUAA collection, and retest the negative boundary. Data, SQL, writes,
transports, Git, and package scope are independent decisions.

For multi-target v1, only named data preview and SQL can be added. They require both application
ceilings and target-local destination opt-ins. Writes, activation, transport/Git mutations, ATC,
ABAP Unit, SAPLint, plugins, UI, and hyperfocused mode remain unavailable.

When data preview or SQL is enabled, keep the shipped 2 MiB cumulative response allowance and two
process-wide data-result slots initially. Wide rows can reach the byte ceiling below the 10,000-row
request cap. If an approved batch/file consumer needs more, set
`ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES` and `ARC1_MAX_CONCURRENT_DATA_RESULTS` together in the
extension, benchmark peak RSS, and normally reduce concurrency as the byte allowance rises. Both
values are positive integers; `0` is rejected at startup. Use the
[BTP data-preview RAM sizing table](btp-administration.md#data-preview-ram-sizing) to change the two
limits and the module's `parameters.memory` value as one reviewed deployment decision.

The base MTA also sets `OPTIMIZE_MEMORY=true`; do not replace its `exec sh ./bin/start-cf.sh` launcher
with a fixed `node --max-old-space-size=...` command in the extension. The launcher validates the
buildpack-provided `MEMORY_AVAILABLE`, derives old-space from the durable CF allocation (384 MiB at
512 MiB, 768 MiB at 1 GiB), and `exec`s Node so CF's SIGTERM reaches ARC-1. Verify the `Runtime
memory envelope` and `Data-result safety envelope` startup logs after every memory or limit change.

## 11. Handover and ongoing operation

Before customer users connect, complete the
[pre-customer acceptance checklist](btp-administration.md#pre-customer-acceptance). Record:

- the reviewed Git revision and `.mtaext` desired state;
- exact route, org/space, services, mode, instance count, target ownership, and role assignments;
- DCR-key backup/rotation owner without recording the value in the ticket;
- SAP/Cloud Connector evidence and the first successful safe reads;
- concurrency/rate decisions and monitoring owner; and
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

## Deploying Without Docker (Node.js Buildpack)

The shipped MTA already deploys a Node.js buildpack module; it does not require Docker. If you mean a
manual `cf push` without MTA, build the runtime first and provide the same services/properties in a
customer-owned manifest:

```bash
npm ci
npm run build
cf push -f <reviewed-customer-manifest.yml>
```

This is an advanced alternative. Validate it against `mta.yaml`, `xs-security.json`, the selected
single/multi startup contract, the MTAR secret exclusions, and the acceptance checklist. A raw
buildpack push does not create the seven MTA role collections for you.

## Troubleshooting deployment

| Symptom | Check |
|---|---|
| MTA lifecycle type cannot change | Existing app was deployed through another lifecycle; use a separate beta space or an approved migration/rollback plan |
| App has no target but is healthy | Expected for target-free base; configure explicit `/mcp` destinations or marked multi destinations |
| Multi-target startup exits | Check XSUAA, Destination, Connectivity bindings and required mode invariants (`ARC1_CACHE=none`, standard tools, UI/plugins off) |
| Multi-target is ready with zero active targets | Call Admin `SAPTargets`; health is not SAP readiness |
| Role collection missing/empty | Perform full MTA deploy, inspect roles, remove/recreate orphaned collection if needed, then reassign |
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
