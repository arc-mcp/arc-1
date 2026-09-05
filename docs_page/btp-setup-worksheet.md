# BTP setup worksheet and owner handoff

Fill this once before preparing a [single-PP or multi-PP example](https://github.com/arc-mcp/arc-1/tree/main/examples/btp).
Use the examples and guides from the **same checkout as the artifact you build**; `main` may be
newer than your deployment. This worksheet coordinates decisions, not permissions to change systems.

Keep the completed copy in your protected project records or ignored `.arc1/btp/` directory,
not in tracked examples. Never put passwords, service keys, tokens, private keys, certificates,
full OAuth callback URLs or raw `cf env` output here or into an LLM prompt.

## Record inputs and evidence separately

For every row, record a value/reference, owner and state: **supplied** (owner stated it),
**observed** (you inspected it), or **unverified**. Include the date and a nonsecret evidence
reference for observations. A supplied setting is not a passed connectivity or authorization test.

| Input / decision | Typical owner | Value or evidence to record |
|---|---|---|
| Artifact and source | Deployment owner | Version, `git rev-parse HEAD`, exact MTAR path/digest, selected override, rollback artifact |
| Topology | ARC-1 owner | Single strict PP or PP-only multi; new deployment or separately reviewed migration |
| Platform context | CF owner | CF API, org, space, app and actual route; intended subaccount ID confirmed in cockpit |
| Service lifecycle | Deployment/IAM owners | XSUAA, Destination, Connectivity names and MTA/customer ownership; no inferred adoption |
| SAP target | Basis owner | Real SID, quoted client (e.g. `001`), factual description; alias only if required |
| Destinations | Destination owner | Names, subaccount level; single startup/request pairing or one PP destination per target |
| Cloud Connector | Connector owner | Virtual host/port, intended internal HTTPS backend, principal type and location ID or confirmed default |
| User mapping | Basis/security owner | Intended backend username in each client; exact email-to-CN mapping and sample certificate reference |
| Application identity | IAM owner | Application IdP origin, test identity and least-privilege role collection; not the platform CLI identity |
| Safety and workload | ARC-1 owner | Data/SQL/mutations off; ATC/Unit denied in these profiles; concurrency/rate limits reviewed |
| Secrets | Respective secret owner | Secure storage/rotation owner only, including DCR secret; no secret values |
| Acceptance | ARC-1/Basis/IAM owners | Per-target user/read/negative-check outcomes and unresolved checks; no health-only PP claim |

## Task handoffs

Each handoff needs **goal, owner, where, inputs, proposed change, expected evidence, failure route,
and next step**. The same person may hold several roles; do not assume an assistant has their authority.

| Task | Owner / where | Expected evidence and next step |
|---|---|---|
| First deployment | CF owner; [deployment runbook](btp-cloud-foundry-deployment.md) | Correct app/service/route context and inspected artifact; then IAM/Basis acceptance. Health establishes liveness only. |
| Add an existing system/client | Destination + Basis owners; [multi-target setup](multi-target-setup.md#3-create-one-destination-per-sidclient) | Confirm client/user already exists, unique destination/ID, strict mapping; restart after destination changes, then per-target safe reads. |
| Grant ARC-1 capability | IAM owner; [role assignment](xsuaa-setup.md#step-3-assign-role-collections) | Current role belongs to the intended application and correct IdP identity; obtain fresh user token and test the approved ceiling. |
| Diagnose login | User + IAM/deployment owner; [XSUAA troubleshooting](xsuaa-setup.md#insufficient-scope-invalid_scope) | Exact sanitized error and current roles/origin; distinguish invalid requested scope from stale session. Do not expand roles as a diagnostic shortcut. |
| Diagnose PP | Connector + Basis owners; [PP checklist](principal-propagation-setup.md) | Intended backend username/client through the live request, or correlated failure. CERTRULE green alone does not prove the whole path. |
| Upgrade / rollback | CF owner; [BTP administration](btp-administration.md#change-and-restart-matrix) | Reviewed source/override and known rollback artifact, then repeat the safe acceptance checks. |

If client `100` does not exist, stop the destination task and ask Basis for its approved provisioning
process. Do not run a client copy or copy another user's roles as an implicit setup step.

## Acceptance record template

Copy this nonsecret structure into the owner's change record; do not replace `unverified` with
`pass` merely because an example parses or a configuration screen is green.

```text
Goal / selected topology:
Source commit / package version / artifact digest:
Expected CF context / observed CF context:
Target ID / real SID / client:
Expected application identity / expected SAP username:
Checks: configuration, liveness, OAuth, PP identity, safe read, negative boundary
Result for each: pass | fail | unverified (reason and evidence reference)
Unresolved checks and owner:
Approved next action / rollback owner:
```

Default acceptance uses `SYSTEM`, `COMPONENTS` and a bounded known-object search. These do not prove
client isolation on their own. A separately approved existing client marker test requires data
authorization; record it as unverified until approved, rather than widening permissions for the test.
No ATC, Unit, SQL or mutation is required for the initial smoke check.
