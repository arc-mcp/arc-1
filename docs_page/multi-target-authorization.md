# Restrict access to systems and clients

**Optional: show each user only their assigned systems and clients, and reject calls to the others.**
This adds per-user target filtering to ARC-1's read-only multi-system mode. For example, a shared
gateway can contain many systems while a project team sees only its two assigned targets in
`SAPTargets` and the tool selectors. The same restriction applies if someone supplies another
target manually or uses its pinned URL.

**This is not automatic SAP-account discovery.** Your identity/access administrator assigns the
target list; ARC-1 does not check every SAP system at login to find the user's accounts. Keep those
assignments aligned with SAP access through your organization's access process. A listed target
can still reject a call if the SAP user, permissions or connection are missing.

Start with **static XSUAA role values**: maintain a reusable list of targets for a team in BTP.
No new IAS configuration is required. This guide owns that access setup; the
[Cloud Foundry runbook](btp-cloud-foundry-deployment.md) owns building and deploying the application.

## When to use it

| Your situation | Recommendation |
|---|---|
| Many systems, with different teams allowed to see/use different subsets | Enable target filtering. This is where it usually brings the most benefit: less irrelevant inventory for people and agents, plus an ARC-1 access check before SAP. |
| Only a few targets, but their existence must be hidden from other readers | Enable it too; confidentiality, not a minimum system count, is the deciding factor. Trusted Admins still see diagnostic inventory. |
| A small/shared landscape where every ARC-1 reader may see and attempt all targets | Keep **standard access**. SAP still checks each propagated user's access; target filtering would add IAM maintenance without the same benefit. |
| One SAP target or hard isolation | Use [single-target or separate instances](multi-target-administration.md#when-separate-instances-are-safer). For scoped multi-target development, add [pinned PP writes](multi-target-writes.md) to this target-filtered setup. |

Both access modes are supported choices. Upgrading alone does not require any target-role or IAS change.

## Availability and readiness

!!! info "Version availability"

    Target authorization is available from ARC-1 **1.6.0**. Confirm that your selected release includes
    this feature before using the setting; older installations do not enforce it. The required
    companion API is provided by `@arc-mcp/xsuaa-auth` 1.1.0 and included in ARC-1's dependencies.
    Upgrading does not enable enforcement: existing deployments keep standard access until you opt in.

Use this guide, the deployment runbook and examples from the **same source revision** as the artifact.
Complete the acceptance checks below in your own landscape before a wider rollout. Optional IAS
provisioning has additional validation requirements described later in this guide. Maintainers can
find the design and release-validation requirements in `docs/plans/xsuaa-target-authorization.md`
and `docs/adr/0008-opt-in-xsuaa-target-authorization.md` in that checkout.

## How the parts fit together

You do not need to configure all of BTP again to add this feature:

| Part | Its job in this setup | Learn more if needed |
|---|---|---|
| SAP BTP / Cloud Foundry (CF) | Hosts ARC-1 and its bound services. A space holds the deployed app; its `.mtaext` file holds durable deployment settings. | [BTP Start Here](btp-overview.md) |
| BTP destination | Connection configuration for one SAP system/client; its public **target ID** is what the user selects. It is not a user assignment. | [Destination fields](multi-target-setup.md#destination-configuration) |
| XSUAA | SAP Authorization and Trust Management service. After sign-in, it issues the app's signed access token containing permissions and assigned target values. | [XSUAA setup](xsuaa-setup.md) |
| Identity provider (IdP), optionally IAS | Authenticates the person. IAS is SAP Cloud Identity Services' Identity Authentication service; keep your existing application login for the static setup. | [Application users and IdP origin](xsuaa-setup.md#step-3-assign-role-collections) |
| Principal Propagation (PP) and SAP | Carry the person to their SAP user; SAP makes the final operation-level authorization check. Target roles do not replace these controls. | [Principal Propagation](principal-propagation-setup.md) |

The flow is: sign in → XSUAA token with assigned targets → ARC-1 target check → PP/SAP authorization.
SAP calls still need the existing capability permissions and server/destination settings. A target
grant does not create an SAP user or prove backend access. Writes additionally require the
[separate exact write grant and pinned PP policy](multi-target-writes.md).

## What changes when you opt in

**Standard access** uses `standard` (the default): no additional target filtering.
**Target-filtered access** uses `xsuaa-attribute`. Both are supported choices.

| Deployment setting | Target access |
|---|---|
| Unset or `ARC1_MULTI_TARGET_AUTHORIZATION=standard` | **Standard access:** readers can discover and try every active target. SAP and the other policy layers still decide whether a call succeeds. Target attributes are not enforced. |
| `ARC1_MULTI_TARGET_AUTHORIZATION=xsuaa-attribute` | **Target-filtered access:** only supported verified XSUAA user tokens enter these routes. Assigned targets restrict reader discovery and every aggregate/pinned SAP call. Missing or invalid grants deny access; they never turn filtering off. |

Unset or explicit `standard` leaves existing authorization, paging and tool visibility unchanged.
Display-label sanitization applies in both modes; see the [compatibility note](multi-target-administration.md#enforced-catalog-differences).

Enforcement is **multi-only**: an independently configured single-target `/mcp` cannot coexist in
the same app. Single-target deployments remain unchanged. A separate app with a distinct XSUAA
identity is needed if you also require independent single-target access.

### Roles and target values

- **Target ID:** the public system-or-alias/client identifier, such as `QAS/001`. It is not the
  destination name. Use the public alias when configured and retain the three-digit client.
- **Role template:** the application's `MCPTargetReadAccess` defines `read` plus the required
  `arc1_targets` attribute. It has no default grant.
- **Role:** an instance of that template with exact attribute values, for example a role granting
  both `QAS/001` and `QAS/100`. This reusable target set is called a **cohort** below; create it once
  for the team, not once per user.
- **Role collection:** the assignable container for that role. Assign it to users under the
  application's **IdP origin** (the identifier of the provider used for application sign-in, not
  necessarily your cockpit login). Later, IAM can map an existing corporate group to the collection.

For example: Alice → `ARC-1 QAS Readers (<space>)` collection → `QASReaders` role →
`arc1_targets` values `QAS/001` and `QAS/100`. This is an ARC-1/XSUAA role, **not an SAP PFCG role**.
See SAP's [instance-based authorization explanation](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/setting-up-instance-based-authorizations)
for the underlying role/attribute model.

## Before you change anything

**New to BTP?** Start at [BTP Start Here](btp-overview.md), choose the multi-PP topology and identify
the owners. Existing connectivity, PP trust and SAP users are prerequisites, not created by these
target roles. If multi-system access already works, keep those connections and follow this guide
to add filtering; do not repeat the entire infrastructure setup.

Agree on the source revision, CF org/space/app, XSUAA lifecycle owner and application identity,
public target IDs, test users/IdP origin, and expected SAP users. Record these in the
[optional setup worksheet](btp-setup-worksheet.md#target-access-setup-and-agent-handoff).
CLI or cockpit login does not prove that the MCP application's user has the right roles.

**Ordering matters:** target roles also supply global `read`. Assigning them while a reachable
instance still uses standard access (`standard`) lets that user see/try **all** its configured targets, not just the
role's cohort. Prepare roles unassigned; activate and verify enforcement before assigning restricted
users. An isolated pilot needs its own app/XSUAA identity, not a second route to a standard-access instance.

For an existing deployment, plan the impact on **every existing reader**: functional roles alone
will not grant SAP execution after enforcement. Prepare the intended cohorts first and agree a
cutover window. Keep the route unavailable to users during the switch; stop/drain standard-access
replicas so standard and enforced processes never serve the same route together. Do not remove existing roles
or alter another app's XSUAA service as an implicit setup step.

## Minimal static role setup

Keep the first pilot simple: **one static cohort role, one collection, one test user**. Use two
approved active targets: grant `QAS/001` and leave `QAS/100` ungranted so the same user tests both
success and denial. No IAS change, HANA store, extra runtime service, new OAuth scope, or SAP login
sweep is needed. An approved operator handles the separate Admin checks; do not give the test user
Admin. These QAS IDs are fictional examples from `examples/btp/multi-pp/`; replace them with your
reviewed public IDs. If a second active test target is unavailable, record the denial test as
unverified—an unknown ID alone does not prove rejection of an existing ungranted target.

### 1. Prepare the app and descriptor

**New isolated app:** first complete [Cloud Foundry runbook steps 1–9](btp-cloud-foundry-deployment.md).
Its multi-PP profile section shows the property to enable filtering from the first deployment;
leave restricted users unassigned. Return here after the destinations exist and the app has
restarted. **Arrived from runbook step 9?** Those prerequisites are already done; continue with
the checks below, not another deployment. **Existing app:** prepare the descriptor and unassigned
roles, then apply the mode change in step 3 under the agreed cutover procedure.

If the templates below are missing, the service owner uses the
[XSUAA lifecycle procedure](xsuaa-setup.md#step-1-identify-the-xsuaa-lifecycle-owner) to install the
additive descriptor while preserving the application identity, functional roles and assignments.
Do not create a second service for an existing app merely because another guide contains a create command.

**Check:** the intended application's `MCPTargetReadAccess` template exists with required
`arc1_targets`, and `MCPAllTargetReadAccess` has the explicit `*` default. Descriptor installation
does not activate enforcement or assign users. Stop if the application identity or owner is unclear.
Return here after checking the descriptor; do not substitute that guide's ordinary Viewer
assignment for the target-role order below.

### 2. Create an unassigned cohort

In the intended BTP subaccount:

1. Open **Security → Roles**, select the intended application's `MCPTargetReadAccess` template
   and create a role named `QASReaders`.
2. For `arc1_targets`, choose **Static**. Enter only `QAS/001` for this pilot and confirm with Enter;
   leave `QAS/100` ungranted. For a later multi-target cohort, enter each ID separately—not one
   comma-separated value. Use public target IDs, not destination names, SAP usernames or role names.
   See SAP's
   [new-role attribute instructions](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/specify-attributes-in-new-role)
   if the attribute editor is unfamiliar.
3. In **Security → Role Collections**, create `ARC-1 QAS Readers (<space>)` and add that application's
   `QASReaders` role. Save it **without users or group mappings** yet. Replace `<space>` with your
   actual CF space, for example `dev`; these are example names, not pre-created exact-target roles.

**Check:** the collection contains the intended application's role and only the allowed exact ID. Review
other apps bound to that XSUAA identity: an unrestricted endpoint in another app is not protected
by this app's setting. `arc1_targets` is an attribute, not an OAuth scope. Do not add it or
`user_attributes` to ARC-1's scope request; the latter is a separate UAA scope, not required for
these XSUAA role attributes. See the [scope distinction](xsuaa-setup.md#target-attributes-and-oauth-scopes).

### 3. Enable enforcement through the deployment owner

For a new app deployed with filtering in runbook step 4, skip to **Check before assigning restricted
users** below; the property is already applied. For an existing app, adapt its landscape extension
without overwriting it. Keep the app multi-only:
remove independent single-target connection settings, including `SAP_BTP_DESTINATION` and
`SAP_BTP_PP_DESTINATION`, through their owning configuration. Check existing CF environment values
too; deleting a line from an extension does not remove a deployed value. If single-target access
is still required, stop and separate the applications and XSUAA identities.

Add this property under the **existing** app's `modules[].properties` map; do not replace its other
settings or introduce a second `modules` key:

```yaml
ARC1_MULTI_TARGET_AUTHORIZATION: xsuaa-attribute
```

On CF, `.env` is not deployed. Have the deployment owner apply the reviewed extension using the
[existing-app change procedure](btp-administration.md#change-and-restart-matrix), with the
[runbook's build/deploy checks](btp-cloud-foundry-deployment.md#5-validate-build-and-inspect-the-mtar).
Do not repeat greenfield service creation or overwrite an existing extension.

**Check before assigning restricted users:** inspect the effective CF setting and each serving process's
startup log. The message starts `Multi-target authorization enforced;`; its JSON field is
`"mode":"xsuaa-attribute"`. A healthy process alone is not evidence of enforcement or usable targets.
After those startup checks pass, use a separate approved operator with the ordinary Admin collection
(no target grant needed). In that Admin MCP session, `SAPTargets` must report
`admin.authorization.mode="xsuaa-attribute"` and the intended targets as active. This summary is
about that Admin's grants, not another user's. Stop if any process still uses standard access or the registry is
unavailable. Keep full environment/binding dumps and tokens out of chat and tickets.

### 4. Assign the pilot user and sign in again

Only after step 3 passes, assign `ARC-1 QAS Readers (<space>)` under the actual application IdP
origin. This role already supplies `read`; no Admin, Data, SQL or All Targets assignment is needed
for this source-read pilot. Confirm no other collections supply unintended capabilities or targets.

Start a fresh application sign-in, then reconnect the MCP client and reload its tool catalog.
When switching test identities, use a private browser session and confirm the intended identity.
For stale access, use the [role-change workflow](multi-target-administration.md#target-authorization-lifecycle);
do not assume refreshing a token recomputes IAM membership or clear every browser cookie.

**Check:** the pilot's SAP tools offer only `QAS/001`; `SAPTargets` is absent for a one-target
reader. A safe read on 001 must succeed, while the same read on the active but ungranted 100 must
be denied through **both aggregate and pinned routes**, as detailed below. Verify
[backend identity](principal-propagation-setup.md#verify-the-backend-identity) separately: a listed
target, green screen or `SYSTEM.user` is not proof of the propagated SAP user.

## Worked example and acceptance checks

Assume both QAS targets are active and no deny-action removes the catalog. The minimal pilot above
creates the first reader case; the approved operator uses Admin without target grants. No other
test users or roles are assumed to exist.

| Identity and grant | Expected aggregate tools and catalog | Execution check |
|---|---|---|
| Pilot reader: `QAS/001` | SAP tools require the explicit `QAS/001` target; no `SAPTargets` | Safe read on 001 succeeds; 100 must be denied before SAP |
| Operator with Admin, no grants | `SAPTargets` shows full safe inventory with `granted:false` | Admin must not execute on either target |

For each identity, check both `/multi/mcp` and the relevant pinned `/<SYSTEM>/<CLIENT>/mcp` route.
In particular, the pilot reader must not reach `QAS/100` through either route. Pair the denial with the
operator's [audit evidence](multi-target-administration.md#user-access-failures-and-retries) that it
stopped at ARC-1, before a SAP request; a client error alone does not prove that. Use only known,
approved test IDs. Unknown and ungranted IDs deliberately have the same public denial.

Before widening the rollout, agree the following additional fixtures with IAM. Tests may reuse the
pilot account sequentially after verified new sign-in, except the two-user isolation case. Do not
accumulate collections without accounting for their union; restore temporary assignments afterward.

| Additional case | Setup change and expected result |
|---|---|
| Two granted targets | Temporarily add `QAS/100` as a second Static value to the pilot role. After new sign-in, `SAPTargets` lists exactly both IDs; both can proceed to PP/SAP checks. |
| Reader with `read`, no grants | Assign ordinary Viewer and remove all target-role assignments from the test user. After the [role-change procedure](multi-target-administration.md#role-changes-and-revocation), expect `tools: []` and neither target executable. Separately record any old-token access. |
| Concurrent disjoint readers | Create another cohort/collection using the same steps but granting only `QAS/100`, assigned to a second approved identity; restore the first user's exact `QAS/001` grant. Interleave calls: neither user may inherit the other's target projection. If no second identity is available, mark unverified. |

Calling hidden `SAPTargets` directly must return `UNKNOWN_TOOL` for readers with zero/one granted
active targets. Existing deny-actions still apply to Admin.

Record each check as **pass, fail or unverified**, with source revision, identity/IdP reference,
request ID and nonsecret evidence. Reconnect after changing identity or grants. These checks are
pilot acceptance, not substitutes for the full release gates in the specification.

## Permission combinations and limits

**All targets is an explicit IAM assignment.** The separate `ARC-1 All Targets (<space>)` collection
contributes literal `*`, including future configured targets, and `read`; deployment assigns it to
nobody. Combine it with Data, SQL or Admin collections only when needed. Do not use `QAS/*`, regular
expressions, or XSUAA **Unrestricted**. Existing functional collections do not acquire target grants;
Admin sees operator diagnostics but cannot execute on an ungranted target.

A literal `*` supplied by **any assigned role** gives all-target access if the complete grant set
is valid; it is not tied to the All Targets collection's name. One malformed value still invalidates
the whole set. XSUAA **Unrestricted** omits the attribute for that role: by itself it supplies no
target grant and execution is denied, though other assigned roles may still supply valid grants.

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
verified XSUAA `arc1_targets` attribute as static roles, not another ARC-1 mode. Choose the simplest
administration option that fits your organization:

| Option | Where target IDs are maintained | What the administrator does |
|---|---|---|
| **Start here: static roles, direct user assignments** | BTP role's Static values | Create each team's target set once; assign its collection to team members. No IAS change. |
| Static roles, existing corporate group assignments | Still in the BTP role | Map a trusted group to the collection. Existing group membership controls who receives it; no dynamic target attribute is needed. |
| Advanced: IAS-fed target values | Dedicated administrator-controlled IdP attribute | Select Identity Provider as the role attribute source and validate the exact emitted values and lifecycle with IAM. |

The group option can reduce manual assignments without changing the runtime model. It requires the
application's existing trust/group configuration; follow SAP's
[group-to-role-collection mapping guide](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/map-role-collections-to-user-groups)
with the IAM owner. Mapping a group to a static collection is **not** the same as feeding target IDs
from IAS. Neither option discovers or provisions SAP accounts.

Before adopting dynamic values, IAM must prove a dedicated administrator-controlled attribute
emits exact multi-valued IDs, excludes unrelated groups, and combines with static grants correctly
on sign-in and refresh. Do not pass raw `groups`, use self-editable profile fields, or assume IAS
discovers SAP accounts. Retain the static path until the optional live acceptance gates are closed.

## Changes and troubleshooting

- **`SAPTargets` is missing:** on `/multi/mcp`, a reader gets it only with **more than one granted
  active target**. With one, the other tools name that target; with zero, the tool list is empty.
  Pinned routes never expose `SAPTargets`. Admin is the deliberate diagnostic exception and sees
  safe inventory even without execution grants. Do not add Admin just to make the tool appear.
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
- **Considering rollback:** selecting `standard` restores broader all-reader access. Obtain security
  approval and follow the same lifecycle procedure, including outstanding tokens and reader review.
  Use explicit `ARC1_MULTI_TARGET_AUTHORIZATION: standard` in the owning extension for an approved
  rollback; deleting its line is not reliable. Never disable enforcement as automatic error recovery.

Keep tokens, complete grant arrays, IAS group lists and credentials out of support records. Use
request IDs and safe status/count summaries. Stop and ask the named owner when evidence is missing;
do not report an unverified setup or revocation as complete.

**Using an assistant to help?** Give it this guide and the same-revision
[setup worksheet](btp-setup-worksheet.md#target-access-setup-and-agent-handoff), including the agreed
mode, allowed/denied target matrix, owners and approved changes. Have it report each acceptance
check as pass, fail or unverified. Credentials and full tokens stay outside prompts and commits.
