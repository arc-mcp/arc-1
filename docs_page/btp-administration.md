# BTP Administration

Operate an ARC-1 deployment on SAP BTP Cloud Foundry after the first successful read. This page
covers the controls shared by single-target and multi-target deployments. For initial installation,
start with [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md). For registry reason codes
and the shared-Basic exception, use [Multi-Target Administration](multi-target-administration.md).

## Know the boundary you operate

Multi-target discovery reads **subaccount destinations**. CF spaces separate apps and service instances, but do not isolate destination inventory within a subaccount. Use a dedicated subaccount when that inventory requires isolation.

For topology selection, use [BTP: Start here](btp-overview.md).

## Responsibilities

Use the [deployment owner map](btp-cloud-foundry-deployment.md#2-assign-owners) for CF, Destination, IAM, Connector and SAP changes. Destination administrators also control credentials for shared Basic users.

## Configuration ownership

Use one source of truth for each kind of value:

| Location | Put here | Avoid here |
|---|---|---|
| `mta.yaml` | Versioned safe product defaults, resources, bindings, role collections | Customer destinations and secrets |
| Customer `mta-overrides.mtaext` | Durable route, instance count, named single target, and application safety ceilings | Destination credentials |
| BTP subaccount destination | URL, SAP client, identity mode, Cloud Connector routing, and target-local multi-target data/SQL policy | Global write or authorization policy |
| `cf set-env` | Stable `ARC1_DCR_SIGNING_SECRET`; controlled emergency overrides | Preferred desired state for ordinary non-secret values |
| `VCAP_SERVICES` | Platform-generated binding credentials | Manual edits or copies into support tickets |
| Cloud Connector and SAP | Network exposure, certificate trust/mapping, SAP authorization | ARC-1 OAuth roles |

Keep the customer `.mtaext` in an access-controlled configuration repository. It is ignored by the
ARC-1 repository by default. Never edit generated `mtad.yaml`; rebuild it from the reviewed source
descriptor and extension.

An MTA extension can add or override values but cannot remove a base property. Use an explicit off
value such as `"false"` when disabling something inherited from `mta.yaml`. A direct `cf set-env`
change is useful for an incident, but the next MTA deployment reapplies every property declared by
the descriptors. Reconcile the desired-state file after the incident.

## Change and restart matrix

Use the smallest action that makes the change effective and preserves desired state.

| Change | ARC-1 action | Notes |
|---|---|---|
| Add/remove a multi-target destination | `cf restart arc1-mcp-server` | Registry discovery is a startup snapshot; no MTAR rebuild |
| Change destination URL, client, alias, description, identity mode, `arc1.*`, or location ID | Restart every app instance | Calls fail closed on detected drift until restart |
| Change only a discovered multi-target Basic destination `User`/`Password` | None | Resolved on the next protected request; verify a safe read |
| Change a single-target `SAP_BTP_DESTINATION` credential | Restart every app instance | The single-target destination is resolved at startup; restart promptly to avoid retrying an obsolete password |
| Change SU01 e-mail, CERTRULE/VUSREXTID, or SAP role | None | Retry with the same MCP session; PP failures are not negatively cached |
| Change Cloud Connector mapping/resource/trust | Usually none | Retry after save; restart ARC-1 only if target configuration also changed |
| Change STRUST or ICM/profile setting | SAP/ICM action as required | Follow the SAP Basis change procedure |
| Change a role assignment | New OAuth login/token | Restart clients that cache the tool catalog |
| Change `.mtaext`, service resources, binding, app memory, or instance count | Build and deploy MTA | This is durable desired-state change |
| Change a runtime environment variable with `cf set-env` | `cf restart` normally; `cf restage` when staging must rerun | Reconcile non-secret values into `.mtaext` |
| Change code, Node dependencies, or buildpack inputs | Rebuild and deploy | Verify the exact deployed version |
| Rotate `ARC1_DCR_SIGNING_SECRET` | Restart/restage and reauthenticate every client | Intentional global DCR revocation |

`cf restart` reuses the staged droplet. `cf restage` stages a new droplet and is appropriate when
buildpack or staging inputs changed. Destination restart behavior is an ARC-1 registry property, not
a general Destination Service limitation.

## Role and user administration

The MTA creates seven role collections with the CF space suffix, for example
`ARC-1 Viewer (dev)`. After every new or upgraded XSUAA deployment:

1. Open **BTP Cockpit → Security → Role Collections**.
2. Confirm all expected `ARC-1 … (<space>)` collections exist.
3. Open each collection and confirm its **Roles** tab contains roles for the current
   `arc1-mcp-<space>!t...` application identifier.
4. Assign the least-privilege collection before the user's first MCP login.
5. Have the user sign in again and restart/reconnect the MCP client if its tool catalog is cached.

An older or recreated XSUAA instance can leave same-name collections with empty/orphaned roles.
First [inspect and reconcile the collection with its owner](xsuaa-setup.md#repair-missing-or-stale-collection-roles-with-the-owner);
empty roles alone do not justify deletion. Only when the owner confirms an orphaned collection
requires replacement, record its roles, user/group assignments and IdP mappings before removal.
Then perform the reviewed MTA deployment, inspect the recreated roles, restore the approved
assignments/mappings and verify a fresh user grant. This is not a generic login fix and does not
require deleting XSUAA.

When changing the roles contained in a predefined collection, prefer a newly named/versioned
collection: deploy it, inspect it, assign users/groups, reauthenticate and test, then remove old
assignments. Renaming a collection does not carry user assignments forward.

See [XSUAA Setup](xsuaa-setup.md) for the complete scope matrix, OAuth flow, IdP-origin handling, and
client configuration.

## DCR signing secret

ARC-1 Dynamic Client Registration is stateless. Ordinary `cf restart`, `cf push`, `cf restage`, or
horizontal scale does not lose registrations while every process uses the same signing key.

Set a dedicated key once so XSUAA binding-secret rotation does not invalidate cached MCP
`client_id`s:

```bash
# Run in a protected operator shell. Do not paste the value into tickets or chat.
cf set-env arc1-mcp-server ARC1_DCR_SIGNING_SECRET "$(openssl rand -base64 48)"
cf restage arc1-mcp-server
```

Keep a recoverable copy in the approved secret store. Do not put the key in source, `.mtaext`, MTARs or support tickets; restrict CF environment access. ARC-1 reads it from the environment, so privileged CF operators can read it.

Changing this key revokes every cached DCR client registration. Ordinary restart, restage, scaling or XSUAA rebinding preserves registrations when the dedicated key stays the same.

## Deployment and scaling by identity mode

| Mode | Instances | Upgrade strategy |
|---|---:|---|
| Single target | One or more after testing stateful operations and load | Rolling can be used when release notes allow it |
| Multi-target, PP only | One or more after load testing | Rolling can be used when old/new versions are compatible |
| Multi-target with any Basic destination | **Exactly one** | **Non-rolling stop/deploy/start with downtime** |
| Mixed multi-target PP + Basic | **Exactly one** | Basic restriction governs the whole process |

For PP-only scaling, every process has its own immutable destination snapshot, per-user/IP rate
buckets, and SAP semaphore. Restart and verify every process after target changes. Maximum SAP
pressure is approximately:

```text
number of ARC-1 processes × ARC1_MAX_CONCURRENT
```

Include other ARC-1 deployments that reach the same SAP system when sizing against Basis dialog
work processes. Sticky sessions do not turn process-local state into shared coordination.

### Data-preview RAM sizing

Data-preview memory admission is independently process-local. Each process admits at most
`ARC1_MAX_CONCURRENT_DATA_RESULTS` data-result calls and gives each complete tool call a cumulative
`ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES` successful-body allowance. Calculate the raw admission
envelope `E` in MiB as:

```text
E = (ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES / 1,048,576)
    × ARC1_MAX_CONCURRENT_DATA_RESULTS
```

At the defaults, `E = 2 MiB × 2 = 4 MiB` per process. This is the admitted raw response size, **not a heap limit**. XML parsing, strings and serialization use additional memory.

For an unbenchmarked limit combination, estimate:

```text
planning RSS (MiB) = 256 + (32 × E)
```

Choose the next CF memory tier **above** that estimate, then measure peak RSS with representative requests at full concurrency. The estimate includes a 256 MiB baseline and a conservative amplification allowance; it is not a guarantee. See the [measurement background](https://github.com/arc-mcp/arc-1/blob/main/docs/research/issues/737-datapreview-response-memory-budget.md#arc-1-memory-amplification).

| Response allowance per tool call | Concurrent data results | Raw envelope `E` | Planning estimate | Recommended starting CF RAM |
|---:|---:|---:|---:|---:|
| 2 MiB (`2097152`) | 2 | 4 MiB | 384 MiB | **512M** (shipped default) |
| 4 MiB (`4194304`) | 1 | 4 MiB | 384 MiB | **512M** |
| 2 MiB | 4 | 8 MiB | 512 MiB | **1G** |
| 4 MiB | 2 | 8 MiB | 512 MiB | **1G** |
| 8 MiB (`8388608`) | 1 | 8 MiB | 512 MiB | **1G** |
| 4 MiB | 4 | 16 MiB | 768 MiB | **1G** |
| 8 MiB | 2 | 16 MiB | 768 MiB | **1G** |
| 16 MiB (`16777216`) | 1 | 16 MiB | 768 MiB | **1G** |
| 8 MiB | 4 | 32 MiB | 1,280 MiB | **2G** |
| 16 MiB | 2 | 32 MiB | 1,280 MiB | **2G** |
| 16 MiB | 4 | 64 MiB | 2,304 MiB | **4G** |

Choose the pair for the workload rather than raising both automatically:

- For a batch/file consumer that needs a larger single result, raise
  `ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES` and normally lower concurrency to `1` first.
- For more interactive users whose results stay small, keep the 2 MiB allowance and raise
  `ARC1_MAX_CONCURRENT_DATA_RESULTS`; `4` should be the first load-tested step.
- If both result size and throughput must grow, raise CF RAM from the table first, deploy, and run
  the maximum-size requests concurrently. Keep at least 20% observed RSS headroom under the CF
  limit; step up another tier if the test crosses 80%.
- `ARC1_MAX_CONCURRENT` is the separate SAP HTTP-request limit. Raising it can add other in-flight
  response and request memory that this table does not model; do not use it as a substitute for the
  data-result limit, and continue to size it against SAP dialog work processes.

The MTA's `OPTIMIZE_MEMORY=true` and `bin/start-cf.sh` launcher derive Node old-space from the buildpack's validated `MEMORY_AVAILABLE`: 75% of CF RAM (384 MiB at 512 MiB; 768 MiB at 1 GiB). Keep that launcher when resizing. The `Runtime memory envelope` log reports total V8 heap, which is slightly larger than old-space.

Put the RAM and limit changes together in the durable customer `.mtaext`:

```yaml
modules:
  - name: arc1-mcp-server
    parameters:
      memory: 1G
    properties:
      ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES: "4194304"
      ARC1_MAX_CONCURRENT_DATA_RESULTS: "2"
```

Build and deploy the MTA so the next deployment retains the new limits. Afterward, check `Runtime memory envelope` and `Data-result safety envelope` in the startup logs, then measure the widest approved rows at full concurrency. A temporary `cf scale -m` change is overwritten by the next descriptor deployment.

### Non-rolling update for shared Basic

Build and [inspect the exact MTAR](btp-archive-inspection.md) before the maintenance window. Confirm the protected override sets one instance. During the window, use the inspected artifact without rebuilding; do not pass a rolling strategy or use blue-green deployment:

```bash
# CF Space Developer, from the reviewed source checkout
cf stop arc1-mcp-server
npm run btp:deploy-ext
cf scale arc1-mcp-server -i 1
cf start arc1-mcp-server
cf app arc1-mcp-server
```

The normal MTA deploy may already start the application; the explicit start is harmless. The final
`cf app` output must show exactly one desired/running instance before users reconnect. Roll back by
stopping the app, deploying the previous reviewed MTAR with the same `.mtaext` and DCR secret, and
again verifying exactly one process.

`enable-parallel-deployments: true` in `mta.yaml` lets the MTA deployer schedule independent MTA
operations. It does not authorize two ARC-1 application processes and does not make rolling Basic
deployment safe.

## Monitoring and incident evidence

Use request IDs to correlate MCP responses, ARC-1 audit events, Connectivity/Cloud Connector logs,
and SAP logs. Keep log access restricted: even with central redaction, logs contain identities,
target IDs, paths, statuses, timing, and topology evidence.

Useful read-only checks:

```bash
cf app arc1-mcp-server
cf services
cf env arc1-mcp-server        # sensitive: inspect locally, never paste unredacted
cf logs arc1-mcp-server --recent
curl -fsS "https://<route>/health" | jq .
```

`/health` confirms that the process is up. In multi-target mode, HTTP 200 can coexist with zero
active targets or quarantined configuration. It does not prove Destination Service, PP, SAP login,
SAP authorization, data/SQL policy, or a usable tool catalog.

For multi-target acceptance, call `SAPTargets` as an Admin, review exclusions and registry revision,
then perform the same safe read as a Viewer through each endpoint style. Verify the actual SAP identity separately with [backend identity evidence](principal-propagation-setup.md#verify-the-backend-identity). `SYSTEM.user` may come from configuration or token claims. PP must reach the intended human; Basic must reach the approved technical user, with the human caller recorded in ARC-1 audit.

## Pre-customer acceptance

Record the checks in the [setup worksheet](btp-setup-worksheet.md). Include evidence and an owner for unresolved items.

| Area | Acceptance evidence |
|---|---|
| Reproducible deployment | Source revision, protected `.mtaext`, route/org/space, inspected MTAR and rollback artifact |
| Services and roles | Intended bindings; seven space-specific collections with current roles; fresh user tokens |
| SAP access and identity | Safe reads succeed; backend evidence identifies the intended user; approved unmapped/unauthorized users fail without fallback |
| Network | Required Connector paths only; verified backend HTTPS |
| Multi-target catalog | Admin `SAPTargets` explains exclusions, conflicts and narrowing; selected endpoint styles work |
| Capabilities | User scopes and app/target settings enforce the [allowed action surface](multi-target-setup.md#allowed-tools); multi-target mutations stay unavailable |
| Data and SQL | Enabled only where both app and destination permit them; tested only if required |
| Workload controls | ATC/Unit explicitly allowed or denied; RAM, concurrency and rate limits reviewed |
| Shared Basic, if enabled | Least-privileged technical user, lockout monitoring, one process and non-rolling rollback rehearsed |
| Client and operations | Required clients complete login/reconnect and a safe call; audit, secret rotation, incident and rollback owners accept handover |

Do not use ATC/Unit as routine deployment smoke tests. Mark unapproved data/client-isolation checks unverified instead of enabling capabilities just to complete the checklist.

## Troubleshooting order

Work from the outer layer inward:

1. **Process and route:** `cf app`, `/health`, route, TLS, security headers.
2. **MCP OAuth:** protected-resource metadata, XSUAA token, role collection, fresh login.
3. **Registry:** Admin `SAPTargets`, destination marker/fields, duplicates, shadows, revision.
4. **Destination/Connectivity:** binding, lookup, Cloud Connector location and resource exposure.
5. **SAP authentication:** certificate generated, STRUST, trusted proxy, CERTRULE/SU01 or Basic credential.
6. **SAP authorization:** propagated/technical user has only required ADT permissions.
7. **ARC-1 policy:** instance ceiling, destination data/SQL narrowing, user scope, deny actions.

Do not “fix” a downstream failure by widening an upstream boundary. For example, a SAP `403` after
successful PP login is an SAP-role problem, not a reason to expose `/` in Cloud Connector or grant
ARC-1 Admin.

## Further references

- [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md)
- [Multi-System Setup](multi-target-setup.md)
- [Multi-Target Administration](multi-target-administration.md)
- [Principal Propagation Setup](principal-propagation-setup.md)
- [XSUAA Setup](xsuaa-setup.md)
- [BTP Destination Reference](btp-destination-setup.md)
- [Authorization](authorization.md)
- [Rate Limiting](rate-limiting.md)
- [Configuration Reference](configuration-reference.md)
- [Updating ARC-1](updating.md)
