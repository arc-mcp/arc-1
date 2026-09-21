# Example: multiple SAP systems/clients with Principal Propagation

Two fictional targets, `QAS/001` and `QAS/100`, each using per-user PP. This mode remains
experimental and mutation-free. Use these files at
[step 4 of the deployment runbook](../../../docs_page/btp-cloud-foundry-deployment.md#4-create-the-landscape-extension);
the runbook contains the copy command, deployment order and acceptance checks.

| File | Replace with your landscape values |
|---|---|
| [profile.mtaext](profile.mtaext) | No target values; enables multi-only mode with conservative policy |
| [qas-001.destination.json](qas-001.destination.json) | Name, virtual URL, real SID/client, description; optional connector location |
| [qas-100.destination.json](qas-100.destination.json) | Name, virtual URL, real SID/client, description; optional connector location |

Create destinations at **subaccount** level; avoid same-name service-instance destinations.
Keep clients as three-character strings. Each virtual URL must map to internal HTTPS with strict
X.509 user-certificate propagation. Adding a destination does not create the SAP client or users.

This profile has no independent `/mcp`: keep `SAP_BTP_DESTINATION` and `SAP_BTP_PP_DESTINATION`
absent, including from existing app environment settings. It does not enable shared Basic access.

After destination changes, restart every ARC-1 process. `SAPTargets` lists configured targets,
not proven SAP access, and current v1 does not filter that list per user. Verify safe reads and
[backend identity](../../../docs_page/principal-propagation-setup.md#verify-the-backend-identity)
separately for each client; repository metadata alone cannot prove client isolation.
