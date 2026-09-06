# XSUAA Target Authorization for Read-Only Multi-Target

- **Status:** Proposed implementation specification
- **Date:** 2026-08-04
- **Last revised:** 2026-09-06 (approved opt-in rollout, simple-first scope, implementation-gap review)
- **Code baseline reviewed:** `origin/main` at `5c36f2a7` (ARC-1 1.2.0;
  `@arc-mcp/xsuaa-auth ^1.0.2`), not the older dependencies installed in this spec worktree
- **Applies to:** experimental BTP Cloud Foundry multi-target mode from
  [ADR-0006](../adr/0006-experimental-read-only-multi-target.md)
- **Scope:** target visibility and routing authorization for mutation-free XSUAA users
- **Does not add:** writes, activation, transport/Git mutations, controlled-execution capabilities, SaaS,
  cross-subaccount discovery, API keys, or direct OIDC

## Decision

Add **opt-in target authorization**, leaving existing deployments unchanged on upgrade:

```dotenv
# Explicit opt-in, only after provisioning and testing target roles.
ARC1_MULTI_TARGET_AUTHORIZATION=xsuaa-attribute
```

Omitting this setting, or explicitly setting `ARC1_MULTI_TARGET_AUTHORIZATION=legacy`, preserves
current multi-target behavior: global readers see all accepted targets, subject to the existing
scopes, destination/instance ceilings, and SAP authorization. It does not enforce `arc1_targets`.

In `xsuaa-attribute` mode, every multi-target user needs either exact public target IDs or the
reserved all-target value `*` in the verified XSUAA role attribute `arc1_targets`. ARC-1 filters
`SAPTargets`, aggregate tool schemas, destination-policy unions, and aggregate/pinned requests
before target lookup or SAP contact. Missing or invalid grants **never fall back to legacy**.

The effective mutation-free authorization **when enforcement is enabled** is:

```text
existing functional scope (read, data, sql, admin)
  ∩ exact arc1_targets grant or explicit * grant
  ∩ active destination and target policy
  ∩ instance safety ceiling
  ∩ SAP authorization / Principal Propagation identity
```

Target grants restrict where an existing functional capability may be used. They do not expand
`data`, `sql`, or `admin`, and they must never be reused as authorization for future writes. The
feature is additive: single-target deployments and legacy multi-target deployments remain unchanged.
Throughout the remaining target-grant sections, requirements apply to `xsuaa-attribute` mode unless
explicitly stated otherwise. Existing safety controls still apply in both modes.

This is a **proposal, not a shipped authorization feature**. The implementation must record a new
accepted ADR qualifying ADR-0006's global-reader, mixed-route, and paged-catalog rules **only for
the opted-in mode** before code merges. ADR-0007's shared-Basic restrictions and the mutation-free
boundary are not relaxed; the ADR must also qualify ADR-0007's eight-row diagnostic limit for the
opted-in catalog only. This spec update authorizes no implementation or live configuration change.

### Decisions after Wouter's review

| Feedback / issue | Refined decision |
|---|---|
| Remove the all-readers property | Qualified by the later, explicit non-breaking rollout decision: retain one deployment opt-in. Once enabled, no request, role, missing claim, or error can bypass grant enforcement. Removing the setting is a security downgrade, described below. |
| Allow a role for all systems | Accepted as the complete literal `*`; not `A4H/*`, regex, or SAP Unrestricted. |
| Provide useful predefined collections | One new all-target collection; no automatic assignment and no broadening existing collections. |
| Avoid accidental global access in ordinary roles | Two templates: exact/IAS with **no default**, separately named all-target template with `*`. Both were accepted by the live broker. |
| Make setup practical for other companies | Lead with static cohort roles mapped to existing corporate groups; offer dedicated IAS attributes when IAM already owns those values. |
| Prevent alternate-route bypass | Single-target-only remains unchanged; enforced multi-target apps must not also configure bare `/mcp`. |

The [research and validation record](../research/2026-09-05-xsuaa-target-authorization-validation.md)
separates SAP documentation, local code evidence, live provisioning results, and untested token
behavior. The two-template choice replaces the previous draft's unsafe default-`*` exact template.

### Simple first release, optional complexity later

The minimum deployment uses the **existing CF app, existing XSUAA service, one exact-target role
and one collection**, directly assigned to a pilot user. Static values need no IAS change. Add the
descriptor artifacts, verify a fresh application token, then enable the one setting. Existing
multi-only deployments do not need a second app, database, additional service, or new OAuth scope.

| First release: required | Optional adoption / deliberately excluded complexity |
|---|---|
| One `legacy` / `xsuaa-attribute` deployment setting | No automatic activation, shadow mode, persistent activation latch, or per-user mode |
| Static exact-value roles as the quickstart | Map existing corporate groups to cohorts; later use a dedicated IAS attribute if IAM owns the values |
| Literal `*` via a separately named role and one unassigned predefined collection | No partial wildcards, per-target capability pairs, or role-combination matrix |
| One verified attribute parser and caller projection across every route/schema | No provider framework, AMS adapter, HANA store, or SAP-access discovery |
| Complete bounded unpaged catalog in the opted-in mode | No second paging switch, new catalog endpoint, UI, or independently configurable limits |
| Safe errors, existing audit integration, effective-mode visibility and rollout tests | General deployment doctor, Terraform modules, IAM provisioning automation and UI are separate work |
| Existing JWT lifetime and refresh/sign-out workflow | Immediate revocation/introspection, token pruning, and customer-specific IAS transformations are separate decisions |

Supporting static and IAS-fed values does **not** require two authorization implementations or an
IAS integration in ARC-1. Both feed the same verified attribute. Prove static provisioning first;
publish an IAS setup recipe only after its own live tests pass. Do not make a customer's IAS
transformation project a prerequisite for the static feature.

Security checks, cross-user isolation, bounded parsing and negative tests are not optional
complexity. They belong in the first implementation, even for a one-user pilot.

## Why This Design

Multi-target v1 deliberately lets every global reader see every accepted target. That is adequate
when SAP Principal Propagation is the only data boundary, but it does not satisfy customers that
treat the configured system/client inventory as confidential or want a user to see only the systems
assigned by corporate identity administration.

SAP BTP's native instance-based authorization model already separates:

- scopes for functional access;
- role-template attributes for instance restrictions;
- roles that instantiate those attributes; and
- role collections mapped to users, IAS groups, or IAS attributes.

Using that model avoids an ARC-1 database, login-time SAP fan-out, remembered SAP failures, and a
second entitlement protocol. Both static BTP role values and IAS-fed values produce the same
verified `xs.user.attributes.arc1_targets` claim, so ARC-1 needs only one runtime contract.

## Boundaries and Non-Goals

This specification is deliberately narrower than the write-oriented target grants discussed in the
[multi-target v2 roadmap](multi-target-v2-roadmap.md):

- it authorizes mutation-free target visibility and routing only;
- it does not cache or infer whether a user's SAP account exists;
- it does not probe SAP while listing targets;
- it does not store user-to-target assignments in ARC-1;
- it does not make an Admin omnipotent on target routes;
- it does not add a public target endpoint or UI;
- it accepts only exact target IDs or the reserved complete value `*`, not destination names,
  descriptions, URLs, SIDs without clients, environment labels, partial wildcards, or patterns; and
- it does not define target/capability pairs for future writes.

Shared Basic targets can be granted, but the grant controls only which XSUAA users may route to the
shared destination. Every granted user still becomes the same technical SAP user, as defined by
ADR-0007. Customers requiring per-human SAP authorization should use Principal Propagation.
Existing ADR-0006 treatment of ATC/ABAP Unit as workload-producing reads is unchanged; this feature
does not silently remove those actions or add new controlled-execution capabilities.

## Normative Identity Contract

### Canonical target value

Each value is one existing ARC-1 public target ID:

```text
A4H/001
A4H/100
A4H-2025/001
```

The grammar is the existing `TARGET_ID_PATTERN`: an uppercase public system segment of 3–32
characters (letters, digits, and internal hyphens; starts with a letter and does not end with a
hyphen), `/`, then exactly three client digits.

The one reserved non-ID value is:

```text
*
```

It grants every current and future active target accepted into the ARC-1 registry. It is not a
pattern operator and cannot be combined with a prefix. `A4H/*`, `A4*`, regular expressions, and
similar values remain invalid. Assigning `*` is intentionally as consequential as assigning a
broad administrative role because newly discovered targets become accessible without another role
change.

The grant binds to the public target ID, including `arc1.target_alias` when configured. Renaming an
alias therefore removes access until identity administration explicitly grants the new ID. Changing
a destination description has no effect. Repointing a destination while retaining the same public
ID preserves the existing grants after snapshot reload. The Destination administrator can make
that change; ARC-1 does **not** enforce a joint approval or automatic IAM re-grant. Require joint
review through the customer's change process when repointing crosses an access boundary. Customers
that cannot accept this trust model need separate instances or a later stable authorization-identity
contract rather than treating a public alias as immutable backend identity.

### Claim location and bounds

ARC-1 reads only the allowlisted XSUAA security-context attribute named `arc1_targets`. It does not
decode an unverified JWT and does not scan a generic `extra` bag.

The auth package normalizes verified scalar/string-array claims into a string array. ARC-1's
boundary parser defensively validates that output (and scalar input in isolated parser tests):

1. accepts only scalar string or string-array forms returned through the verified auth-package
   contract; bounds the raw input **before** copying, normalizing, or deduplicating: at most 1,024
   entries, 128 UTF-8 bytes per entry, and 16 KiB summed value bytes;
2. trims surrounding whitespace;
3. recognizes the literal `*` before applying the public-target normalization used by request
   routing to every other value (uppercase the system segment; retain the three client digits);
4. rejects the complete grant set if any entry has the wrong type or invalid syntax;
5. deduplicates canonical values without yet collapsing a set containing `*`;
6. rejects the complete input above 256 unique canonical values, including `*`, before collapsing
   it; duplicate input still counts toward the raw bounds; and
7. only after those checks, collapses a set containing `*` to all-target; intersects exact grants,
   or projects the all-target grant, over the immutable active registry snapshot.

Valid but unknown values grant nothing and are not returned to the caller. This permits safe
identity-first provisioning before a destination is deployed. Missing, empty, malformed, or
oversized attributes mean **zero target grants** in enforced mode; ARC-1 never falls back to all
targets. Extraction failure status from the auth package must survive normalization so malformed
and over-limit claims are not accidentally reported as ordinary missing assignments.

The 256-value parser bound is separate from the deployment bound: unknown values still count toward
the parser limit. Enforced mode also bounds the complete ARC-related destination diagnostic set to
256, not only enabled targets, so its unpaged administrator response remains finite and complete.
Exceeding either bound fails closed with a stable diagnostic. Legacy mode retains the existing
enabled-target bound and paged diagnostics; enabling enforcement is an explicit acceptance of the
new catalog contract and its total-candidate bound.

Start customer sizing with 50 and 100 exact grants per user, not 256 as a promised operating size.
Users who genuinely need the complete landscape can receive the one-value all-target role. SAP
documents token-size failures around 16 K; measure the complete JWT and HTTP headers through XSUAA,
CF gorouter, any customer proxy, Node, and supported MCP clients. The 256 parser ceiling does not
prove that tokens fit. Do not raise gateway/header limits or assign `*` merely to make a token fit.

### No pattern wildcards

Only the complete sentinel `*` is supported. `A4H/*`, prefix matching, regular expressions, and
XSUAA's **Unrestricted** attribute source are not supported. SAP documents an unrestricted
attribute as behaving as though the attribute does not exist; ARC-1 must instead distinguish the
explicit `*` grant from a missing attribute, which always grants zero targets. Exact cohorts are
represented by one role containing multiple exact values or by IAS group membership.

## XSUAA Descriptor

Add one required attribute and two new role templates to `xs-security.json` (merge this fragment
with the existing descriptor; do not replace its scopes, templates, or OAuth configuration).
Their presence does not activate ARC-1 enforcement, and legacy deployments need no assignments to
these new roles merely to upgrade:

```json
{
  "attributes": [
    {
      "name": "arc1_targets",
      "description": "Exact ARC-1 public target IDs, or explicit * for all targets",
      "valueType": "string",
      "valueRequired": true
    }
  ],
  "role-templates": [
    {
      "name": "MCPTargetReadAccess",
      "description": "Read-only ARC-1 access to selected SAP targets",
      "scope-references": ["$XSAPPNAME.read"],
      "attribute-references": ["arc1_targets"]
    },
    {
      "name": "MCPAllTargetReadAccess",
      "description": "Read-only ARC-1 access to all current and future SAP targets",
      "scope-references": ["$XSAPPNAME.read"],
      "attribute-references": [
        {
          "name": "arc1_targets",
          "default-values": ["*"]
        }
      ]
    }
  ]
}
```

Both templates intentionally reference the existing `read` scope. A target-aware role is itself a
read authorization for the targets it carries. `data`, `sql`, and `admin` remain separate global
roles and are still intersected with the target set at runtime. An Admin with an exact target role
can execute only on those targets; an Admin who also receives the all-target role can execute on
all targets. The existing Admin-wide secret-safe `SAPTargets` diagnostics remain a separate
operator capability and do not authorize SAP execution.

`MCPTargetReadAccess` has no default values and generates no default role. Administrators supply
exact static values or an IdP source when creating its role instances. The **separate**
`MCPAllTargetReadAccess` template generates a read-only default role containing `*`. A normal
exact-target role must never start with `*` and rely on an administrator remembering to remove it.

SAP's descriptor page contains conflicting statements about required references without defaults.
On 2026-09-05 the test subaccount's XSUAA `application` broker accepted the two-template shape on
update, generated only the broad default role, and accepted exact and IdP-sourced custom roles.
This is observed provisioning behavior, not proof of issued-token contents or every regional broker
version. Rehearse the complete descriptor on the customer's broker before rollout. If rejected,
stop and resolve the contract; do not silently substitute optional attributes, empty-as-all, or a
broad default. See the linked validation record for create/update evidence and remaining gates.

Add one new predefined collection in `mta.yaml` for the default role generated by
`MCPAllTargetReadAccess`:

```yaml
- name: "ARC-1 All Targets (${space})"
  description: "Read-only ARC-1 access to all current and future configured SAP targets"
  role-template-references:
    - "$XSAPPNAME.MCPAllTargetReadAccess"
```

SAP permits predefined collections to reference an attributed template when every referenced
attribute has a default value. Do not add this role to the existing Viewer, Data, SQL, Developer,
or Admin collections: SAP refuses to add or remove role-template references from a predefined
collection that is already assigned or otherwise in use. Assign the new collection alongside an
existing functional collection when broad access is intended. The all-target collection already
includes `read`, so it is sufficient by itself for an all-target Viewer; Data, SQL, and Admin users
combine it with their existing capability collection.

Do not predefine every Viewer/Data/SQL/Admin × all-target combination. One orthogonal collection
avoids a growing role-collection matrix and lets customers combine target reach with the existing
capability collections. Exact target collections cannot be predefined because their values are
customer-specific.

Role collections are subaccount-scoped. Preserve the existing `${space}` naming convention for one
deployment per space; multiple ARC-1 instances in a space require a collision-free deployment suffix
and distinct XSUAA application identity. Customer-owned collection names and assignments belong to
customer IAM automation, not ARC-1's runtime. Never assign the generated all-target collection to
everyone as an installation convenience.

Do not modify `MCPViewer`, `MCPDataViewer`, `MCPSqlUser`, `MCPDeveloper`, or `MCPAdmin`. SAP documents
adding a new attribute and role template as a compatible descriptor change, while adding an
attribute reference to an existing role template is not a supported service-update change. Existing
role collections can also be in use and must not be rewritten.

### OAuth scopes do not change

Multi-target protected-resource metadata continues to advertise only:

```text
read data sql admin
```

Neither `arc1_targets` nor `user_attributes` is an OAuth scope. A live spike that requested
`user_attributes` as an ARC-1 scope failed at XSUAA with `invalid_scope`; that scope belongs to the
separate approuter User API scenario and is not required when the verified XSUAA security context
reads an application role attribute.

No `target_access` marker scope is added. The new target-aware role already references `read`, which
ensures it participates in the existing OAuth grant without introducing another client-visible
scope or login failure mode.

## BTP and IAS Provisioning Modes

The two attribute sources below share one planned runtime contract. Static BTP values are the
baseline acceptance path; IAS-fed values are an optional provisioning path with additional live
acceptance gates. ARC-1 neither infers nor independently queries the provisioning source after
token verification. Mode C is a convenience role using a static value, not a third runtime engine.

### Mode A — Static values in a BTP role

Use this for a quick deployment, a small number of access cohorts, or a customer whose existing
groups cannot be changed:

1. create a role from `MCPTargetReadAccess`;
2. choose **Static** for `arc1_targets`;
3. enter one or more exact values such as `A4H/001` and `A4H/100`;
4. add the role to a role collection; and
5. assign or map that collection to the intended users or an existing IAS group.

A role may contain several targets and a collection may contain several target roles. This avoids a
mandatory one-role-per-system model. The same collection can also include Data Viewer or SQL when
that whole cohort needs those global capabilities.

**This is the recommended starting point for most customers.** For example, one customer-owned
`ARC-1 Finance Development Targets` collection can hold `A4H/001` and `A4H/100` and be mapped to an
existing corporate group through the customer's trusted IdP. No new per-developer group workflow,
HANA database, or automatic SAP login checks are required. Direct user assignment is suitable for
the pilot; production lifecycle should follow existing IAM joiner/mover/leaver and access-review
processes. Static values do not require IAS, although IAS can proxy the corporate IdP and supply
group membership.

### Functional scopes apply across the entire target union

XSUAA's resulting scope list and `arc1_targets` list do **not** preserve which role supplied which
pair. This limitation already matters for data confidentiality, even with no write operations:

```text
SQL capability + target A, plus a different role granting target B
    => SQL is eligible on A AND B, wherever both destination and instance permit SQL.
```

Consequently, use separate capability names (`ARC-1 SQL`) and reach names (`Finance Targets`). Do
not advertise a collection as "SQL only on A" or "Admin only on A". `MCPAdmin` expands all functional
scopes and exposes the complete secret-safe operator catalog, even with only one execution grant.
Every capability applies over the final target union. The same rule applies to data preview.

Customers needing SQL on A but only source reads on B must use separate applications with distinct
XSUAA identities/role assignments, or wait for a separately reviewed capability-bound target model.
Disabling SQL on B's destination works only when it should be disabled for **everyone** in that
instance. PP remains necessary but is not a substitute for an ARC-1 policy the customer expects.

### Mode B — Values supplied by IAS

Use this when corporate IAM owns target membership:

1. create a role from `MCPTargetReadAccess`;
2. choose **Identity Provider** for `arc1_targets`;
3. map it to a dedicated IAS application attribute whose emitted values are exact ARC-1 target IDs;
4. add the role to a role collection; and
5. map the collection to the relevant IAS population.

The recommended IAS application attribute is also named `arc1_targets`. Its values must come from
an authoritative, administrator-controlled source, not a self-editable profile field. Map a
dedicated claim from the corporate IdP, or a reviewed IAS transformation/provisioning flow that
actually supports the customer's source. Do not assume IAS can infer SAP accounts or transform
arbitrary groups into target IDs without configuration. Establish claim name, multiplicity, and
origin on the actual SAML/OIDC trust; a comma-separated string is not a multi-valued claim.

Do not put raw `groups` passthrough in the production quickstart. Existing pilots that used target
IDs as group names are evidence of plumbing only. An unrelated group would invalidate the entire
ARC claim; filter at the IdP into the dedicated attribute and test it before assigning the role.
IAS attribute values and static role values use one ARC-1 enforcement path, not two selectable
authorization engines. IAS is optional for static provisioning, not an alternative to XSUAA token
validation in this feature.

### Mode C — Explicit all-target role

Use the predefined `ARC-1 All Targets (${space})` collection when a trusted operator, landscape
reader, or administrator needs every current and future target. Its default role contributes the
single value `*`; no custom role creation is required. Combine the collection with Data, SQL, or
Admin collections when those capabilities are also required.

Do not use XSUAA's **Unrestricted** source for this purpose. It is semantically equivalent to the
attribute being absent and therefore cannot be distinguished from a missing or incomplete target
assignment. Do not emit `*` from a broad, generic IAS group claim; map the predefined collection to
an intentionally named administrative group instead.

### Combining values

XSUAA is expected to union attribute values from the user's assigned target roles. Exact static
roles, IAS-fed roles, and the all-target default role may therefore be combined. ARC-1 collapses a
verified set containing `*` to all-target access after validating and bounding the complete set.
XSUAA's union behavior must be proven against the deployed service before implementation is
enabled; see the acceptance gates below. ARC-1 consumes only the final verified array and does not
implement its own role-merging rules.

### Token lifetime, reassignment, and revocation

ARC-1 does not cache grants beyond the request's verified `AuthInfo`, but an already-issued JWT
still contains its old grants. The reviewed main descriptor sets `token-validity: 3600`; offline
verification can accept that token until expiry even after role removal or server-side revocation.
Restarting ARC-1 or closing the browser is not a stolen-token revocation mechanism. SAP documents
this limitation of offline validation explicitly.

Test role removal separately with the old access token, refresh exchange, reused browser session,
and a fresh authorization-code login. Do not promise that refresh recalculates IAS membership or
adds newly assigned scopes. Prefer ARC-1's existing refresh-access/sign-out workflow before asking
users to remove specific cookies. MCP clients may also retain a tool catalog after token renewal.

Keep the current token lifetime unchanged in this feature. Customer IAM must accept the effective
revocation window; SAP currently recommends short validity but not less than 30 minutes. Online
introspection adds availability/load dependencies and does not itself recalculate old claims, so
it is a separate reviewed extension if immediate revocation is required. For an emergency, isolate
the affected route/app or disable a destination and reload its snapshot; those controls affect all
its users. Record the action and preserve audit correlation.

## `@arc-mcp/xsuaa-auth` Changes

Release an additive minor version of `@arc-mcp/xsuaa-auth` before the ARC-1 implementation.
The current package already validates through `@sap/xssec` but copies only logon name and email into
`AuthInfo.extra`. The installed `XsuaaSecurityContext.getAttribute(name)` reads the verified
`xs.user.attributes` value, so no second JWT library, User API call, or raw-token decoder is needed.

### Public API

Extend the verifier options:

```ts
createXsuaaTokenVerifier(credentials, {
  expandScopes,
  acceptedScopes,
  logger,
  userAttributeNames: ['arc1_targets'],
  requireUserToken: true,
})
```

Both options are additive and omitted by existing consumers. With both absent, behavior and the
structure of `AuthInfo` remain compatible. When extraction is requested, the verifier calls
`getAttribute(name)` on the successfully created `@sap/xssec` XSUAA security context and returns
only requested names:

```ts
authInfo.extra.xsuaaUserAttributes = {
  arc1_targets: ['A4H/001', 'A4H/100'],
};
authInfo.extra.xsuaaUserAttributeStatus = {
  arc1_targets: 'valid',
};
```

The proposed exported types use readonly records and readonly arrays. The status record has exactly
one entry per requested name, with `valid | missing | invalid | limit_exceeded`; it carries no raw
values or SDK errors. Freeze both records and arrays before returning them. This small typed
boundary is necessary for useful diagnostics, not a general claim-transformation API.

Package responsibilities:

- extraction happens only after SAP XSUAA signature, issuer/tenant, audience, and expiry validation;
- the allowlist is copied and validated at construction (maximum 16 distinct names, 64 ASCII
  characters per name, no prototype-reserved names); invalid options fail construction;
- values normalize from scalar string or string array to immutable string arrays;
- only names with status `valid` appear in the values record; missing names are omitted and have
  status `missing`, and invalid/over-limit names are omitted with their respective status;
- an empty array is valid with zero values; a present mixed/non-string value or a blank scalar/
  array element has status `invalid` and no accepted values;
  `@sap/xssec.getAttribute()` maps some falsy values to `null`, so do not promise missing versus
  malformed diagnostics when the SAP accessor does not preserve that distinction;
- before copying, cap extraction at 1,024 entries/name, 1,024 UTF-8 bytes/value, 64 KiB combined
  value bytes across requested names. Per-name limit failures have status `limit_exceeded` and no
  accepted values for that name. A combined-byte failure invalidates **all requested names** with
  that status, independent of allowlist order. Never return partly accepted lists; ARC-1 applies
  its narrower target-specific bounds afterwards;
- dangerous object keys cannot modify prototypes;
- raw attributes and values are never logged; only requested/present counts may be logged;
- machine or unclassifiable principals expose no user attributes (when extraction alone is enabled,
  requested names have status `missing`); and
- `requireUserToken` rejects machine or unclassifiable principals before returning `AuthInfo`,
  including machine tokens with `admin` scope. Classification uses the **verified** SAP context's
  grant type and supported user-token evidence, not the existence of an email or a client-supplied
  `extra` field. User refresh and supported JWT-bearer exchanges must continue to work; do not test
  solely for `authorization_code`. Freeze the supported verified claim/grant-type combinations
  with live fixtures before this option is released.

`requireUserToken` means a supported **user principal**, not proof that a physical human is present
or that the user exists in SAP. Include the supported classification and typed error contract in
the auth-package release, not only in later ARC-1 integration.

Expose a typed forbidden-principal failure distinct from malformed/expired-token errors. ARC-1's
enforced multi HTTP adapter must map it to a generic 403 without revealing principal claims;
ordinary token verification failures retain 401. The current MCP bearer middleware catches verifier
exceptions itself: an arbitrary custom error becomes 500, not 403, and a generic OAuth error need
not become 403 either. Specify and test the adapter with the actual installed middleware; no
message-string matching, repeated login challenge, or downstream authentication fallback.

ARC-1 maps `missing` and valid-empty to `TARGET_GRANT_MISSING`, `invalid` to
`TARGET_GRANT_MALFORMED`, and `limit_exceeded` to `TARGET_GRANT_LIMIT_EXCEEDED`. Its own parser uses
the same latter two codes for target-specific syntax/bounds. When SAP's accessor collapses a falsy
claim to `null`, use `missing`; never claim diagnostics distinguish facts the SDK did not preserve.

The auth package does not know target syntax, grant limits, registry membership, or ARC-1 policy.
Those remain ARC-1 responsibilities.

### Package tests

Add focused tests for scalar, array, missing, empty, mixed-type, and client-credentials attributes;
multiple allowlisted names; prototype-shaped names; logger redaction; and unchanged output when the
options are omitted. Include wrong issuer, audience, expiry, machine-Admin, supported user exchanges,
typed error mapping through the real bearer middleware, status preservation, immutable output,
allowlist-order-independent aggregate limits, raw-duplicate overload, and extraction byte limits.
Mock the security context for extraction tests; retain real signature/audience validation tests for
the verifier integration.

## ARC-1 Runtime Changes

### Configuration and startup

Add one setting, `ARC1_MULTI_TARGET_AUTHORIZATION`, resolved once at startup:

| Configuration | Required behavior |
|---|---|
| Unset | `legacy`: preserve existing multi-target behavior, including verifier options, mixed routes, catalog schema and enabled-target bound |
| `legacy` | Same as unset; do not extract or enforce target attributes |
| `xsuaa-attribute` | Require verified user-principal target grants throughout multi-target handling; use the new unpaged catalog |
| Empty/whitespace-only or another value | Clear startup configuration error; never silently choose legacy |
| `xsuaa-attribute` with multi-target endpoints disabled | Clear startup configuration error so a misplaced setting cannot falsely claim protection of single-target `/mcp` |

Trim surrounding whitespace but accept only the two exact lowercase mode names. Single-target
deployments with the setting absent or `legacy` are unchanged. XSUAA auth, its service binding, and
HTTP transport remain multi-target prerequisites; this feature adds no new auth mechanism. Do not
infer enforcement from a claim, role assignment, descriptor version, or whether a token has grants.

The base deployment must not set `xsuaa-attribute` automatically on upgrade. Provide a small,
explicit opt-in MTA override/example rather than duplicating the full application manifest. New
customer instructions recommend that override after setup; runtime defaults cannot distinguish
a new installation from an existing one.

**Enforced multi-target deployments must be multi-only.** Reject a simultaneously configured
single-target runtime (`SAP_BTP_DESTINATION`, `SAP_BTP_PP_DESTINATION`, or any equivalent resolved
single-target connection) with a clear startup configuration error. Do not silently ignore it, and
do not mount bare `/mcp` as a fallback. On current main, PP connection overlap merely warns while
both routes stay usable; that is not sufficient once target restrictions are enabled. Connection
fingerprints also cannot reliably detect two virtual URLs reaching the same SAP client, so an
overlap check alone is not the chosen boundary. Run this configuration guard **before** single-target
startup canaries, feature probes, or any SAP authentication/contact. Legacy mixed deployments retain
their current behavior; only customers enabling enforcement must split them.

Customers needing single-target writes must run a separate application and XSUAA identity with
separate reviewed role assignments. Multi-only users must not inherit that application's broader
permissions automatically. A separate app/XSUAA is needed for this overlapping single-target
boundary, not for a normal multi-only opt-in installation.

Activation review must also inventory **other apps bound to the same XSUAA identity**. A guard in
this process cannot restrict another app's `/mcp` endpoint. If that app gives these users overlapping
single-target access that defeats the intended boundary, separate its identity/assignments too.
Do not promise that target authorization in one app changes permissions in other applications.

Only enforced mode enables the auth package's `userAttributeNames: ['arc1_targets']` and
`requireUserToken: true`. Add a small pure ARC-1 parser that returns an immutable grant (`none`,
`exact`, or `all`) plus its internal status. Keep the selected deployment mode separate: legacy
is **not** a fabricated `*` claim. Do not thread raw attributes through the server.

Use an explicit mode branch, parser, and caller-projection function. No pluggable
`TargetAuthorizationProvider`, adapter registry, new service, or provider selection framework is
needed for this release. Existing legacy functions should remain reusable without duplicating
the entire server; shared refactoring must pass the legacy regression suite.

**Accepted compatibility tradeoff:** deleting the setting or selecting `legacy` restores broader
access. This is not fully equivalent to Wouter's proposed mandatory enforcement. Without durable
state, ARC-1 cannot know a previously enforced installation lost its setting. Do not add a database
or persistent activation latch to solve that in v1. Keep the setting in version-controlled
deployment configuration, emit the effective mode at startup, and make rollout verification check
that all serving instances use the expected mode. A missing claim never changes that mode.

Only trusted CF application operators may change this policy. SAP documents Space Developer as
able to manage applications/services with broad binding and sensitive-data access; an operator who
can replace code or reconfigure XSUAA is already in the deployment trust boundary. Keep ordinary
ABAP developers out of that role where separation is required. Reverting the mode is a reviewed
security downgrade, never an automatic recovery or ordinary troubleshooting step.

### Authorization order

In enforced mode, for pinned and aggregate calls, including the Copilot JSON-RPC `/authorize` alias:

1. authenticate the bearer token and require a supported user principal;
2. require the existing global `read` scope;
3. parse the target grant set;
4. normalize the requested target syntax;
5. require an exact or all-target grant **before** registry lookup or target-specific response;
6. resolve the target from the immutable registry;
7. enforce the selected target's policy and requested tool/action capability; and
8. create the request-local SAP runtime and contact SAP.

Freeze these outcomes; do not let framework exception handling select them accidentally:

| Condition | Pinned HTTP endpoint | Aggregate tool call |
|---|---|---|
| Invalid/expired/wrong-audience token | 401 | HTTP 401 before MCP dispatch |
| Disallowed principal or missing `read` | 403 | HTTP 403 before MCP dispatch |
| Missing required aggregate target / invalid syntax | Invalid pinned syntax follows the existing route grammar/404 contract | MCP `isError: true`, `TARGET_REQUIRED` / `INVALID_TARGET` |
| Valid target not granted | 404, generic `Target not available` body | MCP `isError: true`, `TARGET_NOT_AVAILABLE`, same generic text |
| Granted target absent, disabled, or quarantined | Same generic 404 | Same generic `TARGET_NOT_AVAILABLE` error |
| Registry unavailable, target not granted | Same generic 404 **before** registry lookup | Same generic `TARGET_NOT_AVAILABLE` error **before** registry lookup |
| Registry unavailable, target granted | 503, generic registry-unavailable body | MCP `isError: true`, `MULTI_TARGET_REGISTRY_UNAVAILABLE`, no destination detail |

These execution errors are the same for Admin and readers. Admin uses `SAPTargets`, not richer
target-call errors, to inspect configuration. A zero-grant reader still receives the caller-only
empty initialization/tool surface below. Direct invocation of an unlisted `SAPTargets` by a reader
with zero or one visible target returns `UNKNOWN_TOOL`, independent of how many other targets
exist. The existing deny-action policy also applies to direct invocation, including by Admin.

Admin can inspect the complete secret-safe registry through `SAPTargets`, but Admin does not bypass
the exact/all-target grant for pinned or aggregate SAP execution. A user that has only Admin and no
target role can diagnose configuration but cannot contact a target.

### One request projection for every target-derived surface

Pass the verified HTTP auth projection into MCP server construction, **before** generating
initialization instructions or tool schemas. The current server factory can build these before a
handler sees `extra.authInfo`; filtering only in `tools/list` would be too late. Use the same
immutable per-request projection for initialization, listing, and dispatch. Its inputs are the
selected mode, verified grants, instance configuration and immutable registry snapshot. Never
reuse another request's or OAuth session's projection, even for the same email address.

For a selected target, check the parsed grant before resolving registry membership. Catalog
projection may iterate the in-memory snapshot after authentication; it must not perform destination
fetches or SAP probes. An aggregate capability union is only a schema-generation aid; dispatch must
still recheck the chosen target's own policy on every call.

The same granted-active-target projection must drive:

- reader `SAPTargets` output;
- whether reader `SAPTargets` is listed (more than one granted active target);
- aggregate `tools/list` capability unions;
- exact target enums through 16 visible targets;
- the pattern-based schema and model guidance above 16 targets;
- aggregate call dispatch;
- pinned route authorization and initialization descriptions; and
- the Copilot JSON-RPC `/authorize` compatibility route (ordinary OAuth `/authorize` is unchanged).

`SAPTargets` remains available to Admin at zero, one, or many grants. Pinned URLs remain usable when
a user has only one target; no implicit target or `/mcp` alias is introduced. Define the aggregate
edge cases explicitly:

- zero granted active targets: readers get `tools: []`, never an empty JSON Schema enum, and an
  initialization explanation that no targets are available **to this account**; do not reveal the
  estate's counts, registry revision, or whether other users have targets;
- one: the usual permitted tools carry the single target enum and a bounded factual label;
  `target` is still mandatory on every aggregate call and reader `SAPTargets` is absent;
- two through 16: exact visible enums and reader `SAPTargets`;
- 17 through 256: pattern plus reader `SAPTargets`; membership is rechecked at dispatch; and
- Admin: `SAPTargets` is always available unless the existing deny-action policy removes it;
  SAP-contacting tools still depend only on the caller's granted-active projection.

Build unions from granted destination policies, **not** the runtime SAP feature cache. The current
multi-target schema deliberately ignores user-backed feature evidence; preserve that isolation.
No SAP or destination request is introduced by initialization, `tools/list`, or `SAPTargets`.
Tool responses, errors, and initialization must use private/no-store response semantics wherever
HTTP caching applies; never cache a user's catalog for another subject.

Do not compute a process-wide union and prune it after `tools/list`: that can reveal tools or
features belonging only to ungranted systems and can make the model choose an impossible action.

### `SAPTargets` contract without paging — enforced mode only

Remove the `offset` input and all `diagnosticOffset`, `diagnosticNextOffset`, returned/truncated, and
shared-auth exception truncation fields. An omitted `query` returns the complete role-sensitive
view in one result:

- reader: every active target in the exact grant intersection, or every active target for `*`;
- Admin: every active target plus one secret-safe diagnostic for every ARC-related destination,
  including active, disabled, ignored, and quarantined entries; and
- Admin active target rows include `granted: true|false` without exposing the raw claim.

Keep only the existing optional `query` input (maximum 160 characters, trim and case-insensitive
matching), with no pagination option. Reader matching uses public target ID and description; Admin
diagnostics additionally match their safe destination name, status, code and message. Filter the
complete set, not a page. Sort target rows by canonical ID and diagnostic rows by safe destination
name (empty sort key when omitted), target and primary code using deterministic ordering. It
performs no SAP or Destination Service request. Counts describe the **unfiltered** snapshot;
filtering does not hide failures or
change authorization status. Basic passive-health counts describe all active Basic targets, while
an explicit query filters exception rows by their corresponding target ID/description.

This is an explicit **opt-in** experimental API change. Legacy mode keeps the current inputs,
paging/truncation fields and output shape. Enforced callers sending `offset` receive schema
validation failure. Activation instructions must say to remove that argument and refresh cached
MCP schemas. Do not introduce a second catalog-mode flag or silently return a first page.

#### Result shape

Retain the reader array of `{target, description, identity}` (`identity` is `per-user` or `shared`)
without grant/status metadata. For a reader granted both clients, the complete result payload is:

```json
[
  {"target": "A4H/001", "description": "Development", "identity": "per-user"},
  {"target": "A4H/100", "description": "Test", "identity": "per-user"}
]
```

For Admin, keep the `targets` / `admin` envelope and existing safe diagnostic fields, add
`granted` on active target rows and the following `admin.authorization` object:

```json
{
  "mode": "xsuaa-attribute",
  "grantMode": "exact",
  "status": "valid",
  "exactGrantCount": 2
}
```

`status` is `valid` or one of `TARGET_GRANT_MISSING`, `TARGET_GRANT_MALFORMED`,
`TARGET_GRANT_LIMIT_EXCEEDED`. Failure status implies `grantMode: "none"`; a valid unknown-only
grant remains `exact` even with no active match. `exactGrantCount` is the deduplicated, valid exact
claim count **before** registry intersection, including unknown IDs, and is present only for
`grantMode: "exact"`. An explicit `*` yields `all` / `valid` with that count omitted. An Admin
without a grant gets `none` / `TARGET_GRANT_MISSING`; all its active rows have `granted: false`.
Do not return the input entitlement list, including unknown IDs.

On a healthy snapshot, retain `admin.state`, `source: "btp-subaccount"`, `loadedAt`, `revision`,
the existing `counts` names, and `destinations`, with `countsComplete: true`. Include all safe
destination diagnostics, not only exceptions. Omit absent optional fields. Legacy output gets no
new authorization object; startup mode logging covers both modes. A deployment check that expects
enforcement must require `admin.authorization.mode === "xsuaa-attribute"`; an absent field is
not evidence of enforcement. This uses Admin `SAPTargets`, not a new public health endpoint.

An over-limit snapshot detected at the 257th ARC-related candidate produces the following bounded
Admin payload (inside the normal MCP result wrapper with `isError: true`):

```json
{
  "targets": [],
  "admin": {
    "state": "error",
    "source": "btp-subaccount",
    "authorization": {
      "mode": "xsuaa-attribute",
      "grantMode": "none",
      "status": "TARGET_GRANT_MISSING"
    },
    "countsComplete": false,
    "arcRelatedAtLeast": 257,
    "failure": {
      "code": "TARGET_LIMIT_EXCEEDED",
      "message": "More than 256 ARC-related destinations; no discovered target is active."
    },
    "destinations": []
  }
}
```

Use the actual caller's authorization status in this failure result. Include snapshot timestamp/
revision when available. Unknown totals are omitted, never reported as zero. `arcRelatedAtLeast`
is present only when that lower bound is known; `countsComplete: false` also covers discovery
failures with no counts. Complete counts may be returned if the entire scan finished; do not label
early-exit counts complete. Registry-wide and catalog-budget failures use MCP `isError: true` for
Admin `SAPTargets`; healthy/degraded diagnostic inventories are successful tool results. Readers
receive no failure inventory: unavailable snapshots yield their empty tool surface described above.

#### Projection and size bounds

To make the unpaged contract safe, enforced-mode discovery must reject the complete registry
snapshot when more than 256 ARC-related destination candidates are present. Counting only enabled
candidates is insufficient because Admin must receive every exclusion diagnostic. The response is
bounded by **new explicit diagnostic projection limits**, not merely today's valid-field checks:

- retain only allowlisted safe fields; invalid names/types are omitted rather than echoing raw
  values; at most 200 characters for a valid destination name, 160 for a normalized description,
  36 for a target ID, 64 for safe categorical fields, and 256 for a fixed diagnostic message;
- retain no raw unknown `arc1.*` keys or values. Report a count plus `UNKNOWN_ARC1_PROPERTY`, with
  BTP Cockpit as the source for the exact malformed configuration;
- consolidate repeated warnings into a fixed reason-code set, with at most 16 distinct codes per
  candidate and one primary diagnostic per candidate;
- include every Basic passive-health exception within the same 256-target bound, without the
  current eight-row truncation; and
- test a **512 KiB full serialized MCP ToolResult budget**, including duplicate text/structured
  representations if present. This is a proposed ARC-1 engineering ceiling, not a SAP limit or a
  guarantee every client/model can consume that result. Keep valid fixtures comfortably below it.

Separate canonical **validation facts** from the public diagnostic projection. Omitting an unsafe
name/value must not erase an unknown property, a forbidden write property, a type error, or a drift
condition and thereby turn a quarantined destination into an active one. Preserve bounded flags/
counts and the existing canonical fingerprint inputs for validation and request-time drift checks;
never validate against a truncated display string. Count all ARC-related candidates according to
the existing case-insensitive `arc1.*` discovery contract, including disabled/malformed entries.

At 257 ARC-related candidates, return `state: error`, a count and one stable
`TARGET_LIMIT_EXCEEDED` diagnostic, with no partial destination list and no active routes. This is
the explicit exception to complete inventory: the configuration exceeds the supported deployment
size. An oversized safe projection similarly yields `CATALOG_SIZE_LIMIT_EXCEEDED` and no partial
inventory; validate the worst-case unfiltered representation before accepting a registry snapshot.
If a later shared-health update exceeds the defensive serialization budget, return a bounded
catalog error rather than silently truncate. That defensive response does not mutate the immutable
registry or invent a new automatic route-shutdown state. The user narrows/fixes the deployment in
BTP, not by paging through an unsupported registry. Counts must say whether they are complete or
lower bounds.

The discovery boundary is still the **subaccount**, not the CF space. Additional apps/spaces in
the same subaccount still see the same ARC-marked candidates; they do not solve this candidate
limit or isolate the Admin inventory. Removing markers from retired destinations affects every
consumer of that discovery contract and needs coordination. Estates beyond the bound need a
deliberately separate destination/subaccount boundary or a future reviewed partitioning design,
not an undocumented per-app filter.

Undefined/default-valued fields should be omitted when unambiguous; do not repeat defaults on every
row. Test adversarial invalid fields as well as 256 healthy targets. The implementation must not
raise schema-size or result-size budgets merely to make the tests pass.

### Audit and logs

Add stable internal decision codes:

```text
TARGET_GRANT_MISSING
TARGET_GRANT_MALFORMED
TARGET_GRANT_LIMIT_EXCEEDED
TARGET_NOT_GRANTED
```

Audit/log fields may include authorization mode (`legacy` or `xsuaa-attribute`), grant mode
(`none`, `exact`, or `all`, only when enforced), exact-grant count, decision
code, registry revision, authenticated subject using the existing identity treatment, and the
normalized requested target after syntax validation. They must not contain raw grant arrays, IAS
groups, role names, tokens, or XSUAA attribute objects.

Startup logs report the effective authorization mode. Legacy mode clearly states that per-target
grants are not enforced; enforced mode states the total-candidate bound. Enforced `SAPTargets`
Admin diagnostics report mode and caller grant parsing status/count, never raw values. Do not log
misleading missing-grant failures for legacy requests.

## Security Analysis

The grant controls below apply in enforced mode. Legacy is a deliberate compatibility policy,
**not** a claim that target-inventory confidentiality is provided without grants.

| Threat | Required control |
|---|---|
| Target enumeration | Authenticate and require `read`; check exact/all-target grant before registry lookup; unknown and ungranted target-execution responses are indistinguishable, including for Admin. |
| Forged JWT attribute | Read only from the verified `@sap/xssec` security context. |
| Missing/malformed claim | Zero grants; no fallback to legacy access. |
| Broad role assigned accidentally | Only literal `*` grants all targets; give its predefined collection an explicit name and map it only to an intentional administrative cohort. |
| New destination under `*` | All-target access deliberately includes future active targets; exact grants are required where this is unacceptable. |
| Attribute cross-product | Functional scopes apply over the full target union, including data/SQL. Document the concrete cross-product and require separate applications where per-target capability pairing is needed. |
| Admin bypass | Admin diagnostics may see all configuration, but execution still needs an exact or all-target grant. |
| Group-name collision | Recommend a dedicated IAS application attribute; require exact canonical values and reject malformed claims. |
| Stale role/group membership | Offline JWTs retain old grants until expiry; separately test refresh and fresh login. Do not claim immediate revocation or that restart revokes a token. |
| Token/header growth | Cap at 256; measure real XSUAA and gorouter behavior before release; recommend materially fewer grants per user. |
| Alias rename/reuse | Exact public ID requires re-grant after rename. Destination/authorization admin trust is explicit. |
| Logging privacy | Never log or return raw attributes/groups/grants. |
| Machine token | Reject a verified machine/unknown principal before catalog or target authorization, even with Admin; allow tested user refresh/exchange flows. |
| Authorization mode removed/changed | Accepted opt-in downgrade risk. Protect durable deployment configuration, log mode, verify all serving replicas and require reviewed rollback. No claim/error may trigger fallback. Deployment operators remain trusted. |
| Alternate `/mcp` path | Disallow a coexisting single-target runtime in enforced multi mode; separate applications use separate identities and assignments. |

Target grants are not evidence that the SAP user exists or has ADT authorization. Principal
Propagation and SAP authorizations remain the final boundary, and direct calls are never denied from
a remembered SAP login failure.

## Compatibility and Rollout

**An ordinary upgrade must not require an IAM migration.** Unset/legacy preserves single-target and
multi-target routes, current auth behavior, role assignments, schemas, paging and diagnostic bounds.
Adding templates or upgrading the auth dependency does not activate enforcement. Keep regression
fixtures for the existing configurations, including mixed deployments.

The explicit opt-in has these additional requirements:

- provision exact roles or the separate all-target collection; old capability collections remain
  unchanged but no longer suffice by themselves on enforced routes;
- split a mixed independent single-target `/mcp` runtime only before enabling enforcement;
- accept the enforced catalog's no-`offset` schema and 256 total-candidate bound; and
- use supported verified user tokens, not administrative CLI or client-credentials tokens.

Existing multi-only customers keep their app, destinations, target URLs, current scope set, and
restart-only discovery; they can retain XSUAA subject to the shared-binding review above. No
replacement endpoint, subscription, HANA store, mandatory IAS migration, or extra runtime service
is required. In enforced mode broad access is granted via
the explicit `*` role, not inferred from Admin. Future mutations cannot be enabled in legacy mode
or authorized with these mutation-free grants; they require their separate reviewed design.

Recommended rollout:

1. upgrade in legacy mode and verify unchanged behavior. Inventory bound consumers, existing role
   assignments, IdP origins, token lifetime, mixed routes and total ARC-related candidates;
2. rehearse the additive descriptor update on an isolated XSUAA instance with existing assigned
   roles, then apply the compatible artifacts. The ARC-1 release may ship both descriptor and
   runtime changes together with enforcement **off**; a separate descriptor-only release is not
   required. Do not recreate the bound service or rewrite existing collections;
3. start with one static exact role/collection for a pilot user and inspect the predefined
   all-target role. Reuse cohort roles for the eventual population, not one role per person/target;
4. before moving the shared route, assign target roles to its intended users/cohorts. Split mixed
   runtimes if needed; retain separate identities for independent single-target boundaries;
5. obtain and verify an application user token locally; record only assertion outcomes and byte
   counts. CLI administration tokens do not prove application grants or PP. Never paste raw tokens
   or customer entitlement arrays into issues, logs, or online JWT decoders;
6. enable `ARC1_MULTI_TARGET_AUTHORIZATION=xsuaa-attribute` explicitly in a test app's durable
   deployment configuration and run the role/target matrix. A separate test app is a rehearsal
   environment, not a new production architecture requirement;
7. apply that configuration to the intended route. Replace/restart **all** serving processes and
   verify their mode; an old legacy replica must not remain reachable when enforcement is declared
   active. Use a controlled cutover without old-mode overlap. ADR-0007's one-instance/non-rolling
   constraint still applies whenever shared Basic is enabled;
8. test Viewer, Data, SQL, Admin, exact, all-target, missing-grant, malformed-grant, and
   revoked-grant users; and
9. reconnect clients so cached tokens/tool schemas refresh, then repeat the verified procedure for
   the customer route, with a recorded IAM owner and accepted revocation window.

A rollback to pre-feature code, deleting the opt-in setting, or selecting `legacy` restores
**broader all-reader behavior**. It is not a security-neutral rollback. Prefer fixing forward with
enforcement still enabled. If inventory confidentiality is required, isolate/stop the route first
and restore service only under an approved policy; do not recommend bypassing grants to fix an
outage. Keep descriptor templates and assignments during emergency rollback; deleting them can
break other bound consumers and is unnecessary. Assigning `*` is an audited IAM privilege change,
not a runtime troubleshooting toggle.

### Customer administration and handover

| Owner | Deliverable / continuing responsibility |
|---|---|
| ARC-1 maintainer | Tested descriptor/templates, auth-package API, enforcement, migration and conformance tests; no customer grants shipped. |
| CF application operator | Explicit opt-in and verified effective mode on all serving instances; multi-only boundary when enabled, protected deployment configuration and reviewed downgrade/rollback plan. |
| Customer IAM administrator | Cohort ownership, static/IdP values, collection mappings, joiner/mover/leaver lifecycle, review of every `*` assignment. |
| Destination administrator | Stable public IDs, approved data/SQL ceiling, controlled alias/repoint changes and supported estate size. |
| SAP/Basis owner | PP mapping, per-user least privilege, ADT/workload consent and backend access review. |

Manage reusable cohort roles declaratively through the supported BTP CLI/authorization APIs where
the customer already has IAM automation. Read/compare before changing, make assignments explicitly,
and require human review for new `*` grants; do not create one role per developer per target.
Avoid deprecated XSUAA `apiaccess` as a new dependency. ARC-1's request path must never need BTP
administrative credentials or role-management calls. BTP audits entitlement changes; ARC-1 audits
request authorization decisions. Keep both records under customer retention/access policy.

Subaccount artifact limits are separate from ARC-1 runtime bounds: SAP currently documents 50
descriptor attributes, 500 role templates, 250 predefined collections, 2,500 administrator-created
roles and 5,000 administrator-created collections. One attribute, two templates, and cohort reuse
avoid a per-user/per-system artifact explosion; customers must budget for their other applications.

## Implementation Sequence

Keep three implementation work packages after the final spec review; avoid a release train of
independently configurable subfeatures:

0. **Decision and focused evidence:** approve this spec and its qualifying ADR before enforcement
   code merges. Before freezing the auth-package API, capture application-token fixtures for
   exact/static union, `*`, user-principal classification and application isolation. Existing
   provisioning evidence does not cover those contracts.
1. **Auth package PR:** additive verified extraction, typed status, principal classification,
   forbidden-principal error contract, real-middleware mapping tests and compatibility tests;
   release one minor `@arc-mcp/xsuaa-auth` version after the relevant token fixtures pass.
2. **ARC-1 opt-in PR:** compatible descriptor/templates and one collection; the single mode setting;
   auth integration and one request projection; pinned/aggregate/Copilot checks; multi-only guard;
   mode-aware legacy/enforced catalog contracts and bounds; audit/diagnostics and full regression
   tests. Ship these together so enabling enforcement cannot leave a route or schema unfiltered.
   The release remains default-legacy. Add the minimal static setup/activation/rollback instructions
   and explicit MTA override, not a parallel full set of deployment artifacts.
3. **Acceptance and optional IAS recipe:** run the deployed role/target, scale, refresh and client
   matrix; record supported sizes and limitations. Test IAS-fed and combined assignments before
   publishing that optional recipe as verified. Rehearse the customer's descriptor/bindings before
   its rollout. A failed optional IAS transformation does not prevent a verified static-only pilot.

The ARC-1 PR may be split if necessary, but incomplete enforcement must not become selectable in a
release. General setup automation, a provider abstraction, online introspection and write support
are not prerequisites or hidden additions to these packages. No implementation begins in this
spec-editing task; the next step is the final review and focused unresolved evidence gates.

### Expected file map

The implementation should remain concentrated in these areas:

| Repository | Files/areas | Responsibility |
|---|---|---|
| `@arc-mcp/xsuaa-auth` | XSUAA verifier options/types, verifier tests, README/changelog | Allowlisted extraction/status from the verified context, user-principal classification and typed failures; no ARC-1 target policy. |
| ARC-1 configuration/provisioning | `src/server/{config,types}.ts`, `xs-security.json`, `mta.yaml`, one opt-in example/override | One default-legacy setting; two templates, no broad exact-role default, one unassigned collection. Base MTA never implicitly enables enforcement. |
| ARC-1 HTTP/auth | `src/server/http.ts`, small target-authorization module | Request allowlisted attributes, reject machine tokens, enforce pinned/aggregate/Copilot alias before lookup. |
| ARC-1 multi-target | `src/server/{server,multi-target-runtime,multi-target-server,multi-target-tools,multi-target-catalog,destination-discovery,destination-registry}.ts` | Enforced mode: reject mixed routes before startup contact, project caller policy before construction, preserve feature-cache independence; bound/unpage catalog. Preserve legacy behavior. |
| ARC-1 tests | focused `tests/unit/server/*multi-target*` plus deployed-CF acceptance script | Role/target matrix, enumeration resistance, schema isolation, catalog completeness, redaction. |
| ARC-1 docs | New ADR qualifying ADR-0006/0007, setup, administration, configuration reference, release notes | Minimal static setup, explicit activation, opt-in schema migration, refresh and reviewed rollback. |

Do not put grant parsing into general scope expansion in `src/authz/policy.ts`: functional scopes
and exact target grants are different dimensions, and collapsing them makes future review harder.

## Test Matrix

### Unit and property tests

- unset and explicit legacy preserve existing single/multi/mixed behavior, verifier output, scopes,
  paging and enabled-target bound; descriptor installation/role presence never auto-activates;
- explicit enforcement applies to every multi surface; missing/invalid grants never select legacy;
- invalid/empty mode and enforcement with multi disabled fail clearly; opted-in mixed-runtime
  configurations fail **before** startup canaries/probes/authentication;
- deleting the setting on a subsequent startup deliberately selects legacy, is logged as such,
  and fails a rollout assertion expecting enforcement; no hidden previous-mode state;
- wrong issuer/audience/tenant and machine-Admin rejected before request-time target resolution or
  Admin diagnostics;
- scalar/array/missing/empty/malformed/oversized claim handling and typed extraction-status mapping;
- normalization, exact dedupe, aliases, unknown values, literal `*`, mixed exact-plus-`*`, and
  rejection of every partial/pattern wildcard;
- in enforced mode, broad-reader behavior requires the explicit all-target role; otherwise zero
  grants fail closed. Legacy access must not be represented as a synthetic `*` grant;
- a future destination becomes visible to `*` but not to an unrelated exact role;
- two users with disjoint target sets, alternating/concurrent initialize/list/call requests and
  renewed tokens: no schema, initialization-instruction, capability-union or feature leakage;
- Viewer/Data/SQL/Admin scope × target A/B matrix, including the documented SQL/data cross-product;
- Admin diagnostics without execution bypass;
- pinned/aggregate failure-matrix status and payload assertions, including unknown vs ungranted,
  ungranted during registry failure and actual middleware mapping for forbidden principals;
- aggregate and Copilot JSON-RPC `/authorize` target recheck on every call; hidden tools cannot bypass it;
- reader SAPTargets visibility at zero, one, two, 16, 17, 100, and 256 grants;
- complete unpaged Admin diagnostics at 256 ARC-related candidates;
- 257 candidates fail the registry snapshot with a bounded summary, not a partial list;
- overlong invalid fields, huge unknown property names/counts, duplicate-heavy grants, and complete
  serialized MCP response budgets; raw unknown properties are not retained, while validation facts
  and drift checks still reject forbidden/malformed configurations after display sanitization;
- registry failure, grant to disabled/quarantined/unknown ID, zero-reader tools and initialization,
  `SAPTargets` deny actions, zero/one-reader direct calls to unlisted SAPTargets, query/order/count
  semantics, Admin status/examples and shared-Basic passive-health exceptions without truncation;
- no raw/full entitlement claims in logs, audit, errors, health, or results. Reader views exclude
  ungranted inventory; specified authorized catalog/schema projections, normalized requested-target
  audit context, and the deliberate Admin diagnostic view remain allowed; and
- concurrent users cannot share a grant projection or target runtime.

### Live BTP acceptance gates

Separate core acceptance from optional IAS setup. Gates 1–2, 5–7, 9–13 apply before the **static**
feature is documented as customer-ready; IAS gates 3–4 and 8 additionally apply before recommending
the IAS-fed/combined recipe. Gate 11's IAS-specific combinations apply to that optional recipe.
Customer-specific transformations and optional token pruning are not core release requirements.

1. creating and updating an isolated service with the two-template descriptor succeeds; no default
   exact role exists; the all-target default is exactly `*`. An existing-instance rehearsal must
   preserve existing roles/assignments. Provisioning portions passed in the 2026-09-05 isolated
   probe; **issued-token assertions are still required** for single and multiple exact values;
2. the default role behind `ARC-1 All Targets (${space})` combines correctly with Admin/Data/SQL
   collections and grants a target added after the role assignment;
3. an IAS-fed role emits the expected exact value for a user-group assignment;
4. static and IAS-fed roles assigned together produce the expected union after new login and after
   refresh;
5. removing a group/role produces the documented outcome for old-token replay, refresh, reused
   session, and fresh login; characterize any stale claims and accept the revocation window;
6. roles with 50 and 100 realistic target IDs pass XSUAA authorization, token exchange, CF gorouter,
   ARC-1 verification, and MCP `tools/list`/call;
7. 256 values and realistic enterprise groups are measured; publish supported end-to-end sizes
   rather than claiming the parser limit is an operational guarantee. A lower measured supported
   size is acceptable only if documented; unexplained truncation or grant widening is not. A
   separate later spike may test `oauth2-configuration.system-attributes: []` if redundant groups/
   collections dominate token size; do not change that configuration in this feature;
8. unrelated IAS groups do not enter the dedicated `arc1_targets` application attribute;
9. Viewer, Data, SQL, and Admin behavior, opt-in schema refresh and unchanged legacy behavior are
   verified in MCP Inspector, VS Code/Copilot, Cursor, and one additional supported client;
10. the exact sign-out/reconnect procedure is verified for a revoked and newly granted user;
11. explicit `*` plus exact/static/IAS roles stays all-target, while missing, empty, malformed,
    Unrestricted, and unsupported sentinel values fail closed;
12. supported user initial/refresh/exchange tokens pass; machine/unknown principals, including
    Admin, fail before either target execution or Admin inventory. Keep this separate from a
    technical CLI login; and
13. two isolated XSUAA application identities use the same `arc1_targets` name with different roles.
    Wrong-audience tokens are rejected and an application's token cannot acquire another app's
    grants/scopes. Include the same email under different IdP origins and an update rehearsal with
    existing assigned roles. This is a required isolation test, not a confirmed cross-app defect.

The 2026-08-04 live spike created a target-aware role, collection, and IAS group mapping successfully
in the ARC-1 test subaccount. The final token callback timed out before claim inspection. The
2026-09-05 isolated probe additionally verified broker create/update and static/IdP role creation,
not user-token claims. All token, runtime, scale, and MCP-client gates remain open. A previous
attempt proved that requesting `user_attributes` as a scope is incorrect for this design because
XSUAA rejected it as an invalid application scope.

## Final Spec Review and Remaining Evidence

The 2026-09-06 review resolves the product choices for the minimal release: one opt-in; unchanged
legacy deployments; static roles first; optional IAS provisioning through the same verified claim;
explicit `*`; no Admin execution bypass; and one complete bounded catalog when enabled. It also
specifies error/status propagation and pre-construction caller projection rather than leaving
those security-sensitive contracts to implementation guesswork. The roadmap now uses the same
rollout policy; the earlier live-test record remains historical evidence, not a current mandate.

No further product decision is required for the static path. **This is not runtime sign-off.**
Token classification, grant union and cross-application isolation must be proven before freezing
the auth-package contract; the rest of the deployed acceptance matrix follows implementation.
No runtime code, service binding, role assignment or deployed mode is changed by this spec review.

## Open Questions

The opt-in decision is settled; these remaining items require evidence, not more runtime switches.
Do not freeze the auth-package release or claim customer readiness before the corresponding gate
passes. No implementation is started by this document update:

1. **XSUAA union semantics:** confirm the exact scalar/array form when multiple static and IAS-fed
   roles contribute the same attribute and whether refresh tokens immediately reflect changed role
   membership.
2. **Practical token and client ceiling:** measure full tokens and catalogs at 50/100/256 under
   actual proxy/client constraints. Parser and response ceilings alone are not a sizing promise.
3. **Customer-specific IAS mapping:** static cohorts are the default recommendation; the customer's
   IAM owner must identify the authoritative attribute source, emitted multivalue format, trust
   origin and supported transformation before using dynamic values. Raw `groups` is not a
   production recipe.
4. **Verified user-token classification and isolation:** capture the SDK-visible user initial,
   refresh/exchange and machine shapes. Freeze `requireUserToken` behavior only from that evidence.
   Prove app/tenant/origin isolation with actual application tokens, not just a broker role response.
5. **Customer activation readiness:** count total ARC-related candidates before opting in, split
   mixed routes if present, verify effective mode on all serving instances, and accept the reviewed
   downgrade/revocation risk. The 256 total bound and opt-in behavior are decided, not open options.
6. **Customer broker rehearsal:** local two-template provisioning passed despite contradictory SAP
   text. Rehearse the full production descriptor and existing assignments on the customer's broker;
   preserve the evidence and raise a SAP support case if it behaves differently. Empty defaults
   and optional attributes are not automatic fallbacks.

## Troubleshooting Contract

The administration guide added by the implementation must use this order:

1. confirm the effective mode from startup logs and enforced Admin `SAPTargets`; in legacy mode
   target assignments are intentionally not enforced. Never infer activation from role presence;
2. confirm the user has `read` and the expected exact or all-target role collection;
3. inspect the role instance's `arc1_targets` source and configured source-name/value;
4. inspect BTP role-collection mapping and IAS group/application-attribute membership if used;
5. obtain a fresh token and inspect only the verified attribute count/values locally;
6. confirm exact target syntax/case and current destination alias;
7. call Admin `SAPTargets` for registry and grant-parser status;
8. distinguish ARC-1 `TARGET_NOT_GRANTED` audit from downstream PP/SAP authorization failure; and
9. restart the MCP client if it retains an old token or tool catalog.

The implementation guide must also include these targeted cases:

| Symptom | Safe diagnostic and action |
|---|---|
| `invalid_scope` names `user_attributes` | Fix OAuth configuration; this is not evidence the user merely lacks a role. Do not send them through repeated cookie resets. |
| Logged in but no tools | In enforced mode, confirm user identity, `read`, exact/all grants and current active IDs; zero is intentional fail-closed behavior. |
| Wrong user / IdP origin | Confirm the principal and collection assignment under the correct trust origin. Test secondary accounts in a fresh incognito session. |
| More targets than expected | Check the effective mode first. When enforced, inspect all assigned roles for a literal `*` and the union of static/IAS grants; removing one narrow role is not a deny. |
| SQL also works on another granted target | Expected global-scope cross-product; split security boundaries if that violates policy. |
| Role removed but requests still work | Check access-token expiry and fresh-login/refresh behavior; restart alone is not revocation. |
| Token exchange 400 or proxy 431 | Measure JWT/header bytes, dedicated claim multiplicity and redundant groups/collections; do not widen grants to reduce size. |
| Descriptor update rejected | Compare exact new templates, immutable defaults and assigned predefined collections; do not mutate old templates or retry with Unrestricted. |
| Mixed-runtime startup rejected after opting in | Move independent single `/mcp` to its own app/XSUAA; disabling enforcement is not a troubleshooting fix. |
| `offset` rejected after opting in | Refresh the MCP schema and omit `offset`; enforced SAPTargets returns the complete bounded view. Legacy paging remains unchanged. |
| Over-limit unpaged Admin catalog | Fix total ARC-related candidates or malformed diagnostic inputs in BTP; no hidden first-page subset exists. |

Do not tell operators to clear arbitrary browser cookies first. Prefer the existing ARC-1
refresh-access/sign-out workflow, then a clean authorization-code login. Never request
`arc1_targets` or `user_attributes` as an OAuth scope.

## Primary References

- SAP Help: [Attributes](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/attributes)
- SAP Help: [Authorization Entities](https://help.sap.com/docs/btp/sap-business-technology-platform/authorization-entities)
- SAP Help: [Application Security Descriptor Configuration Syntax](https://help.sap.com/docs/btp/sap-business-technology-platform/application-security-descriptor-configuration-syntax)
- SAP Help: [Setting Up Instance-Based Authorizations](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/setting-up-instance-based-authorizations)
- SAP Help: [Create Role Collections with Predefined Roles](https://help.sap.com/docs/btp/sap-business-technology-platform/create-role-collections-with-predefined-roles)
- SAP Help: [Compatible Changes in the Security Descriptor File](https://help.sap.com/docs/btp/sap-business-technology-platform/compatible-changes-in-security-descriptor-file)
- SAP Help: [Cannot Add Role Templates to Predefined Role Collections](https://help.sap.com/docs/btp/sap-business-technology-platform/cannot-add-role-templates-to-predefined-role-collections)
- SAP Help: [Map Role Collections to User Groups](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/map-role-collections-to-user-groups)
- SAP Help: [Manage Environment Variables](https://help.sap.com/docs/btp/sap-business-technology-platform/manage-environment-variables)
- SAP Help: [About Roles in the Cloud Foundry Environment](https://help.sap.com/docs/btp/sap-btp-neo-environment/09076385086b4da3bd1808d5ef572862.html?state=PRODUCTION&version=Cloud)
- SAP Help: [Configuration Options for XSUAA](https://help.sap.com/docs/btp/sap-business-technology-platform/configuration-options-for-sap-authorization-and-trust-management-service)
- SAP Help: [Configure Subject Patterns](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/configure-subject-patterns-for-principal-propagation)
- SAP CAP: [Restricted and Unrestricted XSUAA Attributes](https://cap.cloud.sap/docs/guides/security/authorization#unrestricted-xsuaa-attributes)
- SAP documentation source: [Descriptor Syntax and Default-Value Caveat](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/application-security-descriptor-configuration-syntax-517895a.md)
- SAP Help: [Validation and Revocation of Access Tokens](https://help.sap.com/docs/btp/sap-business-technology-platform/validation-and-revocation-of-access-tokens)
- SAP Help: [XSUAA Security Considerations](https://help.sap.com/docs/btp/sap-business-technology-platform/security-considerations-for-sap-authorization-and-trust-management-service)
- SAP Help: [Token-Size Troubleshooting](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/400-error-call-to-oauth-token-was-not-successful?locale=en-US&state=PRODUCTION&version=Cloud)
- SAP Help: [Technical-Artifact Limits](https://help.sap.com/docs/btp/sap-business-technology-platform/limits-for-technical-artifacts-of-sap-authorization-and-trust-management-service)
- SAP Help: [BTP Security Recommendations](https://help.sap.com/docs/btp/sap-btp-security-recommendations-c8a9bb59fe624f0981efa0eff2497d7d/sap-btp-security-recommendations)
