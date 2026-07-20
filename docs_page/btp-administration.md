# BTP Administration

Operate an ARC-1 deployment on SAP BTP Cloud Foundry after the first successful read. This page
covers the controls shared by single-target and multi-target deployments. For initial installation,
start with [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md). For registry reason codes
and the shared-Basic exception, use [Multi-Target Administration](multi-target-administration.md).

## Know the boundary you operate

```text
BTP global account
└── subaccount
    ├── trust and subaccount destinations
    └── Cloud Foundry org
        └── space
            ├── ARC-1 application and route
            └── XSUAA, Destination, and Connectivity service instances
```

ARC-1 multi-target v1 reads **subaccount destinations**. A CF space is not a hard target-inventory
boundary. Another application with suitable Destination Service access in the same subaccount may
resolve the same subaccount destinations. Use a dedicated subaccount when destination inventory
itself requires strong isolation.

SAP Multi-Target Application (MTA) packaging and ARC-1 multi-target routing are unrelated:

- the SAP **MTA** is the `.mtar` deployment format described by `mta.yaml`;
- ARC-1 **multi-target** is the optional runtime mode that exposes several SAP systems/clients.

## Responsibilities

One person may hold several roles in a small landscape, but each handoff should remain explicit.

| Work | Typical owner |
|---|---|
| Entitlements and subaccount isolation | BTP subaccount administrator |
| MTA deployment, route, app environment, and bindings | CF Space Developer |
| Destination fields and Basic credentials | Destination Administrator |
| XSUAA role collections and assignments | User and Role Administrator |
| Cloud Connector mappings, trust, and resource allowlist | Cloud Connector administrator |
| STRUST, CERTRULE, ICM/SICF, SU01, and SAP roles | SAP Basis/security |
| MCP client acceptance and service ownership | ARC-1 service owner |

Do not solve a missing permission by giving all owners broad BTP or SAP administration. In
particular, anyone who can read or change a Basic destination is a credential administrator for its
shared SAP user.

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

Keep these XSUAA concepts separate:

| Concept | Meaning |
|---|---|
| Scope | Capability checked by ARC-1, such as `read`, `data`, or `sql` |
| Role template | Application declaration that groups scopes |
| Role | XSUAA instance-specific role created from a template |
| Role collection | Subaccount bundle that administrators assign |
| Assignment | User/group grant that produces scopes in a new token |

The MTA creates seven role collections with the CF space suffix, for example
`ARC-1 Viewer (dev)`. After every new or upgraded XSUAA deployment:

1. Open **BTP Cockpit → Security → Role Collections**.
2. Confirm all expected `ARC-1 … (<space>)` collections exist.
3. Open each collection and confirm its **Roles** tab contains roles for the current
   `arc1-mcp-<space>!t...` application identifier.
4. Assign the least-privilege collection before the user's first MCP login.
5. Have the user sign in again and restart/reconnect the MCP client if its tool catalog is cached.

An older or recreated XSUAA instance can leave same-name collections with empty/orphaned roles. Do
not infer that an assignable collection exists merely because a role template exists. If a
collection is empty, remove the orphaned collection, perform the reviewed MTA deployment, inspect
the recreated roles, and reassign users.

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

Treat this as a deployment secret:

- never commit it, add it to `.mtaext`, or package it in the MTAR;
- limit CF roles that can inspect app environment;
- never attach unredacted `cf env` output to an issue;
- store a recoverable copy in the customer's approved secret-management process; and
- rotate it only as a security event, because rotation invalidates every stateless DCR client.

With a dedicated secret, rebinding XSUAA no longer revokes DCR registrations by itself. Rotate
`ARC1_DCR_SIGNING_SECRET` when global DCR revocation is intended. ARC-1 currently consumes it as an
environment variable; sufficiently privileged CF operators can therefore read it. A bound/file
secret is a future hardening item, not a property that documentation can provide today.

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

### Non-rolling update for shared Basic

Use a maintenance window. Do not pass a rolling strategy and do not use blue-green deployment:

```bash
# CF Space Developer, from the reviewed source checkout
cf stop arc1-mcp-server
npm run btp:build
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
then perform the same safe read as a Viewer through each endpoint style. For PP, `SAPRead SYSTEM`
must identify the human SAP user. For shared Basic, it must identify only the approved technical
user, and the ARC-1 audit record must identify the human XSUAA caller.

## Pre-customer acceptance

Record evidence rather than only checking configuration screens.

- [ ] The deployment mode and SAP identity model are written down.
- [ ] The reviewed `.mtaext`, deployed ARC-1 version, route, CF org/space, and rollback MTAR are recorded.
- [ ] The built MTAR was inspected and contains no `.env`, service key, private key, certificate, or local operator file.
- [ ] XSUAA, Destination, and Connectivity bindings point to the intended subaccount and space.
- [ ] All seven space-specific role collections exist and contain current roles.
- [ ] Viewer, Data Viewer, Viewer + SQL, Admin, and no-role behavior match the expected tool surface.
- [ ] Every test user obtains a fresh token after role changes; cached client catalogs were refreshed.
- [ ] PP maps to the intended SAP human in each target; wrong/unmapped and SAP-unauthorized users fail conclusively and can retry after repair.
- [ ] Cloud Connector exposes only the required paths and uses verified backend HTTPS.
- [ ] Multi-target Admin `SAPTargets` shows no unexpected quarantine, duplicate, shadow, or policy narrowing.
- [ ] Pinned, aggregate, unknown-target, lowercase-route, bare `/mcp`, and absent `/targets` behavior match the selected topology.
- [ ] Named data preview and SQL work only where both instance and destination allow them.
- [ ] Multi-target routes expose no mutation, transport, Git, ATC, ABAP Unit, plugin, UI, or hyperfocused capability.
- [ ] Shared Basic, if enabled, uses a least-privilege non-`SAP_ALL` user, monitored lockout/expiry, one CF process, and a rehearsed non-rolling update.
- [ ] PP-only scale testing includes total process concurrency and consistent registry revisions.
- [ ] VS Code/GitHub Copilot, Cursor, and any customer-required MCP client completed OAuth, reconnect, catalog refresh, and one safe call.
- [ ] Logs/audit, backup, incident, secret-rotation, destination-change, and rollback owners accepted the handover.

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
