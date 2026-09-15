# BTP setup worksheet

<a id="optional-btp-setup-worksheet"></a>

Copy this optional worksheet into protected project records or the ignored `.arc1/btp/` directory. Use it with the [deployment runbook](btp-cloud-foundry-deployment.md) to collect connection settings and test results.

Record secret-storage references, never secret values.

## Before setup

| Input | Value / administrator |
|---|---|
| Source revision; single-PP or multi-PP topology | |
| Subaccount; CF API, org and space | |
| CF, Destination, identity, Cloud Connector and SAP Basis administrators | |
| Real SAP SID/client; destination names and descriptions | |
| Connector virtual/internal mapping, verified HTTPS and location ID | |
| Application test identity, IdP origin and expected SAP user per client | |
| Role collection, safety settings and secret-storage references | |

If a required SAP client or user is missing, ask the SAP Basis administrator to provision it.

## After deployment

| Deployment record | Value |
|---|---|
| Actual route and source revision | |
| MTAR path/digest and payload inspection result | |
| Protected override and rollback artifact | |
| Instance count, concurrency and rate limits | |
| Contacts for audit, incidents, upgrades and secret rotation | |

For each target, record `pass`, `fail` or `unverified`, plus a result reference and the administrator responsible:

| Check | Target | Result / log reference / administrator |
|---|---|---|
| Process health and OAuth login | | |
| Safe ADT read and known-object search | | |
| [Actual backend SAP identity](principal-propagation-setup.md#verify-the-backend-identity) | | |
| Approved negative identity/authorization test; PP fails without shared-user fallback | | |
| Client isolation, if separately required and approved | | |

`SYSTEM.user` and green configuration screens do not prove the identity of a live SAP request. Mark identity or client isolation **unverified** when it has not been checked; do not enable data/SQL or create test data just to complete the worksheet.
