# Example: one SAP system/client with shared Basic authentication

One XSUAA-protected `/mcp` endpoint whose SAP requests all use the same technical user. Use these
files at
[step 4 of the deployment runbook](../../../docs_page/btp-cloud-foundry-deployment.md#4-create-the-landscape-extension);
the runbook contains the copy command, deployment order and acceptance checks.

| File | Replace with your landscape values |
|---|---|
| [profile.mtaext](profile.mtaext) | Destination name; keep the conservative policy for initial acceptance |
| [basic.destination.json](basic.destination.json) | Name, virtual URL, SID/client and description; user and secret supplied securely by their owner |

The profile explicitly disables Principal Propagation because the base MTA enables it. XSUAA still
identifies and authorizes the MCP caller, but SAP audit records show only the destination's shared
technical user. Use a dedicated least-privileged account, not `SAP_ALL` or a dialog administrator.

The initial profile is ADT-only: it disables gCTS, FLP and UI5 Repository feature probes so Cloud
Connector needs only `/sap/bc/adt` with all sub-paths. If one of those capabilities is later
approved, add its exact resource path first and change its `SAP_FEATURE_*` setting in the reviewed
extension; see the
[Cloud Connector path reference](../../../docs_page/btp-destination-setup.md#cloud-connector-url-path-reference).

The destination must exist before ARC-1 starts with this profile. Acceptance uses safe reads
followed by [backend identity verification](../../../docs_page/principal-propagation-setup.md#verify-the-backend-identity)
with Basis; for this topology the expected identity is the approved technical user.
