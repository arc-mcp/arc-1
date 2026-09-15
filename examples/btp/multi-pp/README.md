# Example: multiple SAP systems/clients with Principal Propagation

Two fictional targets, `QAS/001` and `QAS/100`, each using per-user PP. This mode remains
experimental and mutation-free. Use these files at
[step 4 of the deployment runbook](../../../docs_page/btp-cloud-foundry-deployment.md#4-create-the-landscape-extension);
the runbook contains the copy command, deployment order and acceptance checks.

| File | Replace with your landscape values |
|---|---|
| [profile.mtaext](profile.mtaext) | No target values; enables multi-only mode with conservative policy |
| [target-authorization.mtaext](target-authorization.mtaext) | Optional single-setting overlay; enable only after preparing and testing XSUAA target grants |
| [qas-001.destination.json](qas-001.destination.json) | Name, virtual URL, real SID/client, description; optional connector location |
| [qas-100.destination.json](qas-100.destination.json) | Name, virtual URL, real SID/client, description; optional connector location |

Create destinations at **subaccount** level; avoid same-name service-instance destinations.
Keep clients as three-character strings. Each virtual URL must map to internal HTTPS with strict
X.509 user-certificate propagation. Adding a destination does not create the SAP client or users.

This profile has no independent `/mcp`: keep `SAP_BTP_DESTINATION` and `SAP_BTP_PP_DESTINATION`
absent, including from existing app environment settings. It does not enable shared Basic access.

The unchanged `profile.mtaext` keeps legacy authorization: global readers see all configured targets.
For opt-in filtering, use the target-authorization overlay **after** that profile, or add its one
`ARC1_MULTI_TARGET_AUTHORIZATION: xsuaa-attribute` property to the customer's existing multi-only
extension. It is not a complete profile by itself and does not assign users or modify destinations.
Follow [Multi-Target Setup](../../../docs_page/multi-target-setup.md) for activation and rollback;
removing enforcement restores broader legacy access, not a security-neutral fallback.

Start with a static `MCPTargetReadAccess` role containing exact `arc1_targets` values such as
`QAS/001` and `QAS/100`. The separately generated `ARC-1 All Targets (<space>)` collection supplies
explicit `*` for every current and future target; assign it only deliberately. Existing functional
collections are unchanged, and Admin diagnostics do not bypass target grants for SAP calls.

After destination changes, restart every ARC-1 process. `SAPTargets` still lists configured targets,
not proven SAP access, even when its reader view is restricted by target grants. Verify safe reads and
[backend identity](../../../docs_page/principal-propagation-setup.md#verify-the-backend-identity)
separately for each client; repository metadata alone cannot prove client isolation.
