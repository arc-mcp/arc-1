# Restrict access to systems and clients

Use opt-in target authorization when each ARC-1 user should see and call only the SAP system/client
targets assigned by your identity administrator. Start with **static XSUAA role values**; IAS
changes are optional. This guide owns the target-access setup. The
[Cloud Foundry runbook](btp-cloud-foundry-deployment.md) still owns service creation and deployment.

## Availability and readiness

!!! warning "PR #677 implementation candidate — not customer-ready yet"

    This is an unreleased feature in PR #677, not a setting to copy into an older installation.
    The required companion API is published in `@arc-mcp/xsuaa-auth` 1.1.0 and integrated in the
    PR's manifest/lockfile. Live acceptance remains incomplete. Use an isolated maintainer test
    deployment until the remaining gates are closed; a documentation update is not release approval.

Use this guide, the deployment runbook and examples from the **same source revision** as the artifact.
The design and remaining acceptance gates are in `docs/plans/xsuaa-target-authorization.md` and
`docs/adr/0008-opt-in-xsuaa-target-authorization.md` in that checkout. The
[historical validation snapshot](https://github.com/arc-mcp/arc-1/blob/5c100257a6fa28d45e0908d6b03631f2a0b76d7f/docs/research/2026-09-15-pr677-target-authorization-implementation.md)
records tested builds, not a pass for a later build. Check [PR #677](https://github.com/arc-mcp/arc-1/pull/677)
and the checkout's `docs/research/2026-09-15-pr677-target-authorization-implementation.md` for follow-ups.

## What changes when you opt in

| Deployment setting | Target access |
|---|---|
| Unset or `ARC1_MULTI_TARGET_AUTHORIZATION=legacy` | Existing behavior: global readers can discover and try every active target. SAP and the other policy layers still decide whether a call succeeds. Target attributes are not enforced. |
| `ARC1_MULTI_TARGET_AUTHORIZATION=xsuaa-attribute` | Only supported verified XSUAA user tokens enter these routes. Exact target grants restrict reader discovery and every aggregate/pinned SAP call. Missing or invalid grants never fall back to legacy. |

Unset or explicit `legacy` leaves existing authorization, paging and tool visibility unchanged.
Display-label sanitization applies in both modes; see the [compatibility note](multi-target-administration.md#enforced-catalog-differences).

Enforcement is **multi-only**: an independently configured single-target `/mcp` cannot coexist in
the same app. Single-target deployments remain unchanged. A separate app with a distinct XSUAA
identity is needed if you also require independent single-target access.

### Four terms you need

- **Target ID:** the public system-or-alias/client identifier, such as `QAS/001`. It is not the
  destination name. Use the public alias when configured and retain the three-digit client.
- **Role template:** the application's `MCPTargetReadAccess` defines `read` plus the required
  `arc1_targets` attribute. It has no default grant.
- **Role:** an instance of that template with exact attribute values, for example a role granting
  both `QAS/001` and `QAS/100`. One role can represent a team with several targets.
- **Role collection:** the assignable container for that role. Assign it to users under the
  application's IdP origin; later, IAM can map an existing corporate group to the collection.

The flow is: IAM assignment → verified XSUAA token → ARC-1 target check → PP/SAP authorization.
ARC-1 does not scan SAP accounts at login, store a grant database, or infer grants from successful
SAP logins. A grant does not create an SAP user, prove backend access, or allow multi-target writes.

## Before you change anything

Agree on the source revision, CF org/space/app, XSUAA lifecycle owner and application identity,
public target IDs, test users/IdP origin, and expected SAP users. Record these in the
[optional setup worksheet](btp-setup-worksheet.md#target-access-setup-and-agent-handoff).
CLI or cockpit login does not prove that the MCP application's user has the right roles.

**Ordering matters:** target roles also supply global `read`. Assigning them while a reachable
instance is still `legacy` grants that user access to **all** its configured targets, not just the
role's cohort. Prepare roles unassigned; activate and verify enforcement before assigning restricted
users. An isolated pilot needs its own app/XSUAA identity, not a second route to a legacy instance.

For an existing deployment, plan the impact on **every existing reader**: functional roles alone
will not grant SAP execution after enforcement. Prepare the intended cohorts first and agree a
cutover window. Keep the route unavailable to users during the switch; quiesce legacy replicas so
legacy and enforced processes never serve the same route together. Do not remove existing roles
or alter another app's XSUAA service as an implicit setup step.

## Minimal static role setup

Keep the first pilot simple: **one static cohort role, one collection, one test user**. No IAS
change, HANA store, extra runtime service, new OAuth scope, or SAP login sweep is needed. An approved
operator handles the separate Admin diagnostic checks; do not give the test user Admin. Use the
fictional `QAS/001` and `QAS/100` destinations from `examples/btp/multi-pp/` only as templates;
replace them with reviewed public IDs from your own deployment.

### 1. Prepare the app and descriptor

**New isolated app:** have the deployment owner include the setting from step 3 in its first
deployment through the Cloud Foundry runbook, leaving end-user/group assignments empty. Then return
here to check the templates and create the cohort. This avoids deploying legacy mode just to switch
it immediately. **Existing pilot app:** prepare the descriptor and unassigned roles below, then
apply the mode change in step 3. Both paths require step 3's checks before step 4's assignment.

The service owner uses the [XSUAA lifecycle procedure](xsuaa-setup.md#step-1-identify-the-xsuaa-lifecycle-owner)
to install the additive descriptor while preserving the application identity, existing functional
roles and assignments. For this unreleased pilot, use an isolated app/XSUAA identity. Do not create
a second service for an existing app merely because a different guide contains a create command.

**Check:** the intended application's `MCPTargetReadAccess` template exists with required
`arc1_targets`, and `MCPAllTargetReadAccess` has the explicit `*` default. Descriptor installation
does not activate enforcement or assign users. Stop if the application identity or owner is unclear.
Return here after checking the descriptor; do not substitute that guide's ordinary Viewer
assignment for the target-role order below.

### 2. Create an unassigned cohort

In BTP Cockpit **Security → Roles**, select that application's `MCPTargetReadAccess` template.
Create a role named `QASReaders`, set `arc1_targets` to **Static**, and add `QAS/001` and `QAS/100`
as **two separate values**, not one comma-separated value. Add this role to a deliberately named
collection, for example `ARC-1 QAS Readers (<space>)`, without assigning users or group mappings yet.

**Check:** the collection contains the intended application's role and both exact values. Review
other apps bound to that XSUAA identity: an unrestricted endpoint in another app is not protected
by this app's setting. Neither `arc1_targets` nor `user_attributes` is an OAuth scope; do not add
either to the client's scope request.

### 3. Enable enforcement through the deployment owner

Select the [multi-PP profile](btp-cloud-foundry-deployment.md#multi-target-pp-only-profile) for a new
pilot, or adapt the existing landscape extension without overwriting it. Keep the app multi-only:
remove independent single-target connection settings, including `SAP_BTP_DESTINATION` and
`SAP_BTP_PP_DESTINATION`, through their owning configuration. Check existing CF environment values
too; deleting a line from an extension does not remove a deployed value. If single-target access
is still required, stop and separate the applications and XSUAA identities.

Add this property under the **existing** app's `modules[].properties` map; do not replace its other
settings or introduce a second `modules` key:

```yaml
ARC1_MULTI_TARGET_AUTHORIZATION: xsuaa-attribute
```

The same-checkout `examples/btp/multi-pp/target-authorization.mtaext` is an optional overlay **after**
the multi-PP profile, not a standalone profile. Adding its one property to your existing extension
is the simpler path. On CF, `.env` is not deployed. Follow the
[runbook's validation and deployment steps](btp-cloud-foundry-deployment.md#4-create-the-landscape-extension)
for the actual extension; do not restart a second deployment workflow here.

**Check before assigning restricted users:** inspect the effective CF setting and each serving process's
startup log. The message starts `Multi-target authorization enforced;` with
`mode: "xsuaa-attribute"`. A healthy process alone is not evidence of enforcement or usable targets.
After those startup checks pass, use a separate approved operator with the ordinary Admin collection
(no target grant needed). In that Admin MCP session, `SAPTargets` must report
`admin.authorization.mode="xsuaa-attribute"` and the intended targets as active. This summary is
about that Admin's grants, not another user's. Stop if any process is legacy or the registry is
unavailable. Keep full environment/binding dumps and tokens out of chat and tickets.

### 4. Assign the pilot user and sign in again

Only after step 3 passes, assign `ARC-1 QAS Readers (<space>)` under the actual application IdP
origin. This role already supplies `read`; no Admin, Data, SQL or All Targets assignment is needed
for this source-read pilot. Confirm no other collections supply unintended capabilities or targets.

Start a fresh application sign-in, then reconnect the MCP client and reload its tool catalog.
When switching test identities, use a private browser session and confirm the intended identity.
For stale access, use the [role-change workflow](multi-target-administration.md#target-authorization-lifecycle);
do not assume refreshing a token recomputes IAM membership or clear every browser cookie.

**Check:** the two-target pilot gets `SAPTargets` with exactly `QAS/001` and `QAS/100`. Test a safe
read and verify [backend identity](principal-propagation-setup.md#verify-the-backend-identity)
separately. Listing a target, a green configuration screen or `SYSTEM.user` is not proof of the
propagated SAP user. Then complete the positive and negative checks below before widening the pilot.

## Worked example and acceptance checks

Assume both QAS targets are active and no deny-action removes the catalog. These are separate
test identities, using roles from `MCPTargetReadAccess` with the listed static values. Give the
no-grant reader the ordinary Viewer collection and the operator only the Admin collection.
Do not accumulate test collections on one user without accounting for their union.

| Identity and grant | Expected aggregate tools and catalog | Execution check |
|---|---|---|
| Alice: `QAS/001` | SAP tools require the explicit `QAS/001` target; no `SAPTargets` | Safe read on 001 can proceed to SAP; 100 must be denied before SAP |
| Bob: `QAS/001`, `QAS/100` | `SAPTargets` lists exactly both IDs | Each target can proceed to its own PP/SAP check |
| Reader with `read`, no grants | `tools: []` and a caller-only no-target explanation | Neither target is executable |
| Operator with Admin, no grants | `SAPTargets` shows full safe inventory with `granted:false` | Admin must not execute on either target |

For each identity, check both `/multi/mcp` and the relevant pinned `/<SYSTEM>/<CLIENT>/mcp` route.
In particular, Alice must not reach `QAS/100` through either route. Pair the denial with the
operator's [audit evidence](multi-target-administration.md#user-access-failures-and-retries) that it
stopped at ARC-1, before a SAP request; a client error alone does not prove that. Use only known,
approved test IDs. Unknown and ungranted IDs deliberately have the same public denial.

Also repeat with a disjoint reader granted only `QAS/100`; a one-target catalog change must not
leak Alice's projection. Calling hidden `SAPTargets` directly must return `UNKNOWN_TOOL` for
readers with zero/one granted active targets. Existing deny-actions still apply to Admin.

Record each check as **pass, fail or unverified**, with source revision, identity/IdP reference,
request ID and nonsecret evidence. Reconnect after changing identity or grants. These checks are
pilot acceptance, not substitutes for the full release gates in the specification.

## Permission combinations and limits

**All targets is an explicit IAM assignment.** The separate `ARC-1 All Targets (<space>)` collection
contributes literal `*`, including future configured targets, and `read`; deployment assigns it to
nobody. Combine it with Data, SQL or Admin collections only when needed. Do not use `QAS/*`, regular
expressions, or XSUAA **Unrestricted**. Existing functional collections do not acquire target grants;
Admin sees operator diagnostics but cannot execute on an ungranted target.

**Capabilities are global over the grant union.** SQL capability plus a grant for `QAS/001`,
combined with another role granting `QAS/100`, makes SQL eligible on **both** where
instance/destination/SAP policy also permits it. Do not label a collection “SQL only on 001”.
See [Authorization & Roles](authorization.md#opt-in-multi-target-grants) for the separation required
when one user's capabilities must differ by target. Keep data and SQL off for initial acceptance.

Target grants select a destination/logon client, not a SQL row-isolation policy. Before enabling
freestyle SQL, review the [client-isolation limitation](multi-target-administration.md#sql-and-client-isolation).
Enforced catalogs are unpaged but bounded to 256 total ARC-related candidates and 512 KiB for the
full result. Parser limits do not guarantee a customer's token fits every proxy/client; see
[catalog bounds](multi-target-administration.md#enforced-catalog-differences).

## Optional IAS provisioning

**IAS-fed values are optional and not yet a verified operator recipe.** They supply the same
verified XSUAA `arc1_targets` attribute as static roles, not another ARC-1 mode. First prove static
cohorts. Mapping an existing corporate group to a static role collection is different from using
an IAS attribute to provide the target values dynamically.

Before adopting dynamic values, IAM must prove a dedicated administrator-controlled attribute
emits exact multi-valued IDs, excludes unrelated groups, and combines with static grants correctly
on sign-in and refresh. Do not pass raw `groups`, use self-editable profile fields, or assume IAS
discovers SAP accounts. Retain the static path until the optional live acceptance gates are closed.

## Changes and troubleshooting

- **Login fails:** distinguish an invalid requested scope from missing roles or stale state with
  the [XSUAA decision table](xsuaa-setup.md#insufficient-scope-invalid_scope). Do not add scopes
  named after attributes or assign Admin to make login succeed.
- **Login works but no tools appear:** check the correct app/IdP, exact public IDs, active registry,
  and the caller's grant status through the [operator diagnostics](multi-target-administration.md#user-access-failures-and-retries).
  One invalid value rejects the whole grant set; a valid ID may also have no active destination.
  An Admin's authorization summary does not diagnose another user's token.
- **Access persists after removal:** old tokens and refreshed/reused SSO sessions can retain grants.
  Follow the [lifecycle and revocation procedure](multi-target-administration.md#target-authorization-lifecycle).
  Restarting ARC-1 is not revocation; neither a fresh expiry nor an elapsed hour proves removal.
- **Considering rollback:** selecting `legacy` restores broader all-reader access. Obtain security
  approval and follow the same lifecycle procedure, including outstanding tokens and reader review.
  Use explicit `ARC1_MULTI_TARGET_AUTHORIZATION: legacy` in the owning extension for an approved
  rollback; deleting its line is not reliable. Never disable enforcement as automatic error recovery.

Keep tokens, complete grant arrays, IAS group lists and credentials out of support records. Use
request IDs and safe status/count summaries. Stop and ask the named owner when evidence is missing;
do not report an unverified setup or revocation as complete.
