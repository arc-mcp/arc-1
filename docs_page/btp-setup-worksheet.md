# BTP setup worksheet

<a id="optional-btp-setup-worksheet"></a>

Copy this optional worksheet into protected project records or the ignored `.arc1/btp/` directory. Use it with the [deployment runbook](btp-cloud-foundry-deployment.md) to collect owner inputs and verification results.

Record secret-storage references, never secret values.

## Before setup

| Input | Value / owner |
|---|---|
| Source revision; single-PP or multi-PP topology | |
| Subaccount; CF API, org and space | |
| CF deployment, Destination, IAM, Connector and Basis owners | |
| Real SAP SID/client; destination names and descriptions | |
| Connector virtual/internal mapping, verified HTTPS and location ID | |
| Application test identity, IdP origin and expected SAP user per client | |
| Role collection, safety settings and secret-storage references | |

## After deployment

| Deployment record | Value |
|---|---|
| Actual route and source revision | |
| MTAR path/digest and inspected payload evidence | |
| Protected override and rollback artifact | |
| Instance count, concurrency and rate limits | |
| Audit, incident, upgrade and rotation owners | |

For each target, record `pass`, `fail` or `unverified`, plus evidence and an owner:

| Check | Target | Result / evidence / owner |
|---|---|---|
| Process health and OAuth login | | |
| Safe ADT read and known-object search | | |
| [Actual backend SAP identity](principal-propagation-setup.md#verify-the-backend-identity) | | |
| Approved negative identity/authorization test | | |
| Client isolation, if separately required and approved | | |

`SYSTEM.user` and green configuration screens do not prove the identity of a live SAP request. Keep missing identity or client-isolation evidence **unverified**; do not enable data/SQL or create test data just to complete the worksheet.
