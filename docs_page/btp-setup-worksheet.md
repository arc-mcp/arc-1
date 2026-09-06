# Optional BTP setup worksheet

Use this checklist when several people share a deployment. It is not a prerequisite or another
runbook; [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md) owns the setup steps.
One person may hold several owner roles.

Keep your completed copy in protected project records or the ignored `.arc1/btp/` directory.
Record secret-storage references, never passwords, tokens, private keys or raw binding dumps.

## Before setup

| Input | Agree with |
|---|---|
| Selected source revision and topology: single PP or multi PP | Deployment owner |
| Subaccount, CF API/org/space and service ownership | CF/IAM owners |
| Real SAP SID/client, destination names and descriptions | Destination/Basis owners |
| Cloud Connector virtual/internal mapping, verified HTTPS and location ID if used | Connector owner |
| Application test identity/IdP origin and expected SAP username in each client | IAM/Basis owners |
| Least-privilege role collection, secret owners and accepted safety settings | IAM/deployment owners |

If a required SAP client or user does not exist, ask Basis to provision it through their normal
process. A destination task does not authorize client copies or additional SAP roles.

## After deployment

Record the actual route, source revision, MTAR path/digest, selected override and rollback reference.
For each target, record these checks separately as `pass`, `fail`, or `unverified` with a reason:

- Process health and OAuth login.
- Safe ADT read and bounded known-object search.
- [Backend identity verification](principal-propagation-setup.md#verify-the-backend-identity).
- Approved negative identity/authorization test; no shared-user fallback.

Include a nonsecret evidence reference and owner for unresolved checks. A green configuration screen
or `SYSTEM.user` is not backend identity evidence. Client-isolation checks need separate evidence;
do not enable data/SQL or create test data just to complete this worksheet.
