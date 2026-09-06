# Example: one SAP system/client with Principal Propagation

One `/mcp` endpoint with per-user SAP requests. Use these files at
[step 4 of the deployment runbook](../../../docs_page/btp-cloud-foundry-deployment.md#4-create-the-landscape-extension);
the runbook contains the copy command, deployment order and acceptance checks.

| File | Replace with your landscape values |
|---|---|
| [profile.mtaext](profile.mtaext) | Both destination names; keep the conservative policy for initial acceptance |
| [startup.destination.json](startup.destination.json) | Name, virtual URL, SID/client, description; startup user and secret supplied securely by their owner |
| [request.destination.json](request.destination.json) | Name, virtual URL, same SID/client, description; optional connector location |

The Basic startup destination and PP request destination must reach the **same physical backend
and client**. They may use different virtual mappings: startup uses principal type None, while PP
uses strict X.509 user propagation. Verify internal HTTPS for both. Matching labels alone do not
prove the mappings; ask the Connector/Basis owner to confirm them.

The startup user is not a PP fallback. Use a least-privileged startup account, not `SAP_ALL` or a
dialog administrator. Both destinations must exist before ARC-1 starts with this profile.

Acceptance uses safe reads followed by [backend identity verification](../../../docs_page/principal-propagation-setup.md#verify-the-backend-identity).
`SAPRead(SYSTEM).user` alone is not proof of the SAP login identity.
