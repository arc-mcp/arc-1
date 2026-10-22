# Example: multiple SAP systems/clients with Principal Propagation

Two fictional targets, `QAS/001` and `QAS/100`, each using per-user PP. This base profile is read-only. An optional write overlay adds scoped pinned PP writes. Use these files at
[step 4 of the deployment runbook](../../../docs_page/btp-cloud-foundry-deployment.md#4-create-the-landscape-extension);
the runbook contains the copy command, deployment order and acceptance checks.

| File | Replace with your landscape values |
|---|---|
| [profile.mtaext](profile.mtaext) | No target values; enables multi-only mode with conservative policy |
| [target-authorization.mtaext](target-authorization.mtaext) | Optional single-setting overlay; prepare unassigned roles, enable/verify enforcement, then assign restricted users |
| [qas-001.destination.json](qas-001.destination.json) | Name, virtual URL, real SID/client, description; optional connector location |
| [qas-100.destination.json](qas-100.destination.json) | Name, virtual URL, real SID/client, description; optional connector location |

Create destinations at **subaccount** level; avoid same-name service-instance destinations.
Keep clients as three-character strings. Each virtual URL must map to internal HTTPS with strict
X.509 user-certificate propagation. Adding a destination does not create the SAP client or users.

This profile has no independent `/mcp`: keep `SAP_BTP_DESTINATION` and `SAP_BTP_PP_DESTINATION`
absent, including from existing app environment settings. It does not enable shared Basic access.

The initial profile disables gCTS, FLP and UI5 Repository feature probes so Cloud Connector needs
only `/sap/bc/adt` with all sub-paths. Multi-target v1 excludes `SAPGit` and `SAPManage`, so gCTS
and FLP actions cannot be enabled through feature toggles. The optional `SAPRead` type
`BSP_DEPLOY` reads UI5 Repository metadata outside ADT; it is disabled by this initial profile's
`SAP_FEATURE_UI5REPO=off`. Keep all three probes off for ADT-only acceptance.

The unchanged `profile.mtaext` keeps **standard access** (`standard`): readers may see/try all active
targets, and SAP still checks their access. Both access modes are supported. Optional filtering
is most useful when different teams need different subsets of a larger landscape; it follows IAM
assignments rather than automatically discovering SAP accounts. Static roles need no IAS change.
For opt-in filtering, the canonical runbook adds the one
`ARC1_MULTI_TARGET_AUTHORIZATION: xsuaa-attribute` property to the customer's existing multi-only
extension. The optional overlay is for advanced extension chains **after** the example profile;
its `extends` references that profile's ID, not the base MTA ID. `npm run btp:validate`
also generates and checks the effective merged descriptor; schema validation alone is insufficient.
It is not a complete profile by itself and does not assign users or modify destinations.
Follow [Restrict access to systems and clients](../../../docs_page/multi-target-authorization.md)
for readiness, activation and acceptance, and its linked administration procedure for rollback;
removing enforcement restores broader standard access, not a security-neutral fallback.

Start with a static `MCPTargetReadAccess` role granting only `QAS/001`; leave active `QAS/100`
ungranted for the pilot's negative test. Later cohorts can contain several exact values. The
separately generated `ARC-1 All Targets (<space>)` collection supplies
explicit `*` for every current and future target; assign it only deliberately. Existing functional
collections are unchanged, and Admin diagnostics do not bypass target grants for SAP calls.

After destination changes, restart every ARC-1 process. `SAPTargets` still lists configured targets,
not proven SAP access, even when its reader view is restricted by target grants. Verify safe reads and
[backend identity](../../../docs_page/principal-propagation-setup.md#verify-the-backend-identity)
separately for each client; repository metadata alone cannot prove client isolation.

## Optional pinned writes

After read-only acceptance, follow [the write guide](../../../docs_page/multi-target-writes.md).
Apply `pinned-writes.mtaext` after `target-authorization.mtaext`; its `extends` names that overlay.
Use `dev-001-write.destination.json` with your virtual URL, real SID/client and allowed package/request.
Keep QAS destinations unchanged. Verify enforced mode before assigning `MCPTargetDeveloper` with
read grants DEV/001 and QAS/001 and exact write grant DEV/001. Register DEV/001/mcp separately.
The examples are parser-tested; destination URLs, packages and request IDs are fictional and must
be replaced. They do not create IAM roles, users, SAP objects or transport requests.
