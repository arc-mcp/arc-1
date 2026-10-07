# Optional BTP setup worksheet

Use this checklist when several people share a deployment. It is not a prerequisite or another
runbook; [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md) owns the setup steps.
One person may hold several owner roles.

Keep your completed copy in protected project records or the ignored `.arc1/btp/` directory.
Record secret-storage references, never passwords, tokens, private keys or raw binding dumps.

## Before setup

| Input | Agree with |
|---|---|
| Selected source revision and topology: single Basic, single PP, or multi PP | Deployment owner |
| Subaccount, CF API/org/space and service ownership | CF/IAM owners |
| Real SAP SID/client, destination names and descriptions | Destination/Basis owners |
| Cloud Connector virtual/internal mapping, verified HTTPS and location ID if used | Connector owner |
| Application test identity/IdP origin and expected SAP username in each client | IAM/Basis owners |
| Least-privilege role collection, secret owners and accepted safety settings | IAM/deployment owners |

If a required SAP client or user does not exist, ask Basis to provision it through their normal
process. A destination task does not authorize client copies or additional SAP roles.

## Target access setup and agent handoff

For opt-in filtering, use [Restrict access to systems and clients](multi-target-authorization.md)
as the procedure. Complete this section before making changes; it also gives an assisting agent
the inputs and authority boundaries. Leave unknown values explicitly **unverified**, not guessed.

| Input or decision | Record with the responsible owner |
|---|---|
| Feature availability | Source revision, [readiness](multi-target-authorization.md#availability-and-readiness), isolated pilot or approved rollout |
| Existing desired state | Owning `.mtaext`, CF app/space, XSUAA application identity and lifecycle owner; preserve existing settings |
| Target access | Current and intended `legacy` / `xsuaa-attribute` mode; static cohorts first, IAS only if its separate gates are met |
| Exact identifiers | Public system-or-alias/client IDs and corresponding destination names; keep these distinct |
| IAM test matrix | Identity/IdP references, collections, expected allowed and denied targets, expected SAP users; include no-grant and Admin-without-grants cases |
| Cutover | All existing readers, other apps sharing XSUAA, serving processes/routes, approved maintenance window and rollback owner |
| Permitted actions | What the agent may inspect/change and which CF, IAM, Connector or Basis actions need owner approval |

Use this evidence checklist alongside the guide, not as an additional deployment:

| Checkpoint | Evidence to retain | Stop if |
|---|---|---|
| Prepare configuration and roles | Reviewed extension diff, correct app's templates/role values, unassigned cohort | Ownership is unclear, a file would be overwritten, or an unrelated app/service would change |
| Enable enforcement | Effective mode and startup evidence for every serving process; Admin registry summary | Mixed single-target topology, legacy replicas still serving, or unavailable registry |
| Assign and sign in | Correct application identity/IdP, expected caller-specific tools and grants | Wrong identity or broader permissions than the agreed matrix |
| Test permitted and denied calls | Request IDs, pre-SAP denial evidence, safe-read results and separate backend identity verification | Unexpected target visibility/execution, or missing evidence to distinguish ARC-1 denial from SAP denial |
| Remove test access or diagnose stale access | IAM change evidence and old-token/refresh/fresh-login observations under the owner's procedure | Access is assumed revoked from assignment removal, restart or elapsed time alone |

Do not grant Admin/All Targets, switch to legacy, enable data/SQL, or change IAS mappings merely to
make a failing check pass. Hand the unresolved check to its named owner. Share safe status/count
summaries, not tokens, complete grant arrays, group lists or environment/binding dumps.

## After deployment

Record the actual route, source revision, MTAR path/digest, selected override and rollback reference.
For each target, record these checks separately as `pass`, `fail`, or `unverified` with a reason:

- Process health and OAuth login.
- Safe ADT read and bounded known-object search.
- [Backend identity verification](principal-propagation-setup.md#verify-the-backend-identity).
- Approved negative identity/authorization test; no shared-user fallback.
- If opting into target authorization, the agreed user/target matrix and cutover evidence above;
  configuration presence alone is not a pass.

Include a nonsecret evidence reference and owner for unresolved checks. A green configuration screen
or `SYSTEM.user` is not backend identity evidence. Client-isolation checks need separate evidence;
do not enable data/SQL or create test data just to complete this worksheet.
