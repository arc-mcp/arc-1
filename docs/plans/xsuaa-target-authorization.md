# XSUAA Target Authorization for Read-Only Multi-Target

- **Status:** Proposed implementation specification
- **Date:** 2026-08-04
- **Applies to:** experimental BTP Cloud Foundry multi-target mode from
  [ADR-0006](../adr/0006-experimental-read-only-multi-target.md)
- **Scope:** target visibility and routing authorization for mutation-free XSUAA users
- **Does not authorize:** writes, activation, transport/Git mutations, controlled execution, SaaS,
  cross-subaccount discovery, API keys, or direct OIDC

## Decision

Add an optional XSUAA authorization mode in which target-authorized users receive an exact set of
public target IDs in the verified XSUAA role attribute `arc1_targets`. ARC-1 uses that set to filter
`SAPTargets`, aggregate tool schemas, feature/tool unions, and both aggregate and pinned requests
before target lookup or SAP contact.

The existing behavior remains the default:

```text
ARC1_MULTI_TARGET_AUTHORIZATION=all-readers       # default; current v1 behavior
ARC1_MULTI_TARGET_AUTHORIZATION=xsuaa-attribute   # exact target grants required
```

The effective mutation-free authorization is:

```text
existing functional scope (read, data, sql, admin)
  ∩ exact arc1_targets grant
  ∩ active destination and target policy
  ∩ instance safety ceiling
  ∩ SAP authorization / Principal Propagation identity
```

Target grants restrict where an existing functional capability may be used. They do not expand
`data`, `sql`, or `admin`, and they must never be reused as authorization for future writes.

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
- it does not accept wildcards, destination names, descriptions, URLs, SIDs without clients, or
  environment labels as grants; and
- it does not define target/capability pairs for future writes.

Shared Basic targets can be granted, but the grant controls only which XSUAA users may route to the
shared destination. Every granted user still becomes the same technical SAP user, as defined by
ADR-0007. Customers requiring per-human SAP authorization should use Principal Propagation.

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

The grant binds to the public target ID, including `arc1.target_alias` when configured. Renaming an
alias therefore removes access until identity administration explicitly grants the new ID. Changing
a destination description has no effect. Repointing a destination while retaining the same public
ID is trusted as a deliberate joint action by the Destination and authorization administrators;
customers that do not accept that trust boundary must use separate ARC-1 instances.

### Claim location and bounds

ARC-1 reads only the allowlisted XSUAA security-context attribute named `arc1_targets`. It does not
decode an unverified JWT and does not scan a generic `extra` bag.

Accepted verifier output is a string array. The parser:

1. accepts the scalar string or string-array forms returned by `@sap/xssec` and normalizes them to an
   immutable array;
2. trims surrounding whitespace;
3. applies the same public-target normalization as request routing;
4. rejects the complete grant set if any entry has the wrong type or invalid syntax;
5. deduplicates exact canonical values;
6. rejects the complete grant set above 256 unique values; and
7. intersects valid grants with the immutable active registry snapshot.

Valid but unknown values grant nothing and are not returned to the caller. This permits safe
identity-first provisioning before a destination is deployed. Missing, empty, malformed, or
oversized attributes mean **zero target grants** in `xsuaa-attribute` mode; ARC-1 never falls back to
all targets.

The 256-value parser bound matches ARC-1's multi-target deployment ceiling. The implementation that
removes `SAPTargets` paging must also bound the complete ARC-related destination diagnostic set to
256, not only enabled targets, so the unpaged administrator response remains finite and complete.
Exceeding either bound fails closed with a stable diagnostic.

The operational recommendation is at most 100 target grants per user. A synthetic compact-JWT
estimate using maximum-length target IDs was about 6.1 KiB at 100 values and 14.2 KiB at 256 values,
before a real customer's other groups, role collections, and claims. SAP documents token issuance
failure when attributes push the access token beyond 16 KiB, so the 256 parser ceiling is not a
promise that every tenant can issue or route such a token.

### No wildcard

`*`, `A4H/*`, prefix matching, regular expressions, and unrestricted XSUAA attribute values are not
supported. Cohorts are represented by one role containing multiple exact values or by IAS group
membership, not by a runtime wildcard.

## XSUAA Descriptor

Add one attribute and one role template to `xs-security.json`:

```json
{
  "attributes": [
    {
      "name": "arc1_targets",
      "description": "Exact ARC-1 public SAP target IDs permitted for this user",
      "valueType": "string",
      "valueRequired": true
    }
  ],
  "role-templates": [
    {
      "name": "MCPTargetReadAccess",
      "description": "Read-only ARC-1 access restricted to exact SAP targets",
      "scope-references": ["$XSAPPNAME.read"],
      "attribute-references": ["arc1_targets"]
    }
  ]
}
```

The template intentionally references the existing `read` scope. A target-aware role is itself a
read authorization for the targets it carries. `data`, `sql`, and `admin` remain separate global
roles and are still intersected with the target set at runtime.

Do not add `MCPTargetReadAccess` to the predefined role collections in `mta.yaml`: target values are
customer-specific and a required attribute cannot be safely instantiated by a generic deployment.
Administrators create roles and role collections after deployment.

Do not modify `MCPViewer`, `MCPDataViewer`, `MCPSqlUser`, `MCPDeveloper`, or `MCPAdmin`. SAP documents
adding a new attribute and role template as a compatible descriptor change, while adding an
attribute reference to an existing role template is not a supported service-update change. Existing
role collections can also be in use and should not be rewritten.

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

Both modes below are supported because they end in the same verified XSUAA attribute. ARC-1 neither
knows nor trusts the provisioning origin after token verification.

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

### Mode B — Values supplied by IAS

Use this when corporate IAM owns target membership:

1. create a role from `MCPTargetReadAccess`;
2. choose **Identity Provider** for `arc1_targets`;
3. map it to a dedicated IAS application attribute whose emitted values are exact ARC-1 target IDs;
4. add the role to a role collection; and
5. map the collection to the relevant IAS population.

The recommended IAS application attribute is also named `arc1_targets`. It should filter or derive
values from authoritative corporate groups and emit only canonical target IDs. Passing the generic
IAS `groups` collection directly is supported only when every emitted value is intentionally an
ARC-1 target ID. Otherwise unrelated group names make the claim malformed and ARC-1 denies all
targets by design.

Exact group names such as `A4H/100` work for a controlled pilot. A large customer should prefer a
dedicated application attribute or namespaced groups transformed to exact IDs, so ordinary
corporate groups do not inflate the JWT or collide with target names.

### Combining values

XSUAA is expected to union attribute values from the user's assigned target roles. Static roles and
IAS-fed roles may therefore be combined. This must be proven against the deployed XSUAA service
before implementation is enabled; see the acceptance gates below. ARC-1 consumes only the final
verified array and does not implement its own role-merging rules.

Role/group changes apply when XSUAA issues a new token. ARC-1 does not cache target grants beyond the
request's verified `AuthInfo`. Administrators must expect MCP clients to retain OAuth tokens and
tool catalogs; troubleshooting must include sign-out/reconnect and, where necessary, a full client
restart.

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
})
```

When `userAttributeNames` is absent, behavior and the structure of `AuthInfo` remain compatible with
the current package contract. When present, the verifier calls `getAttribute(name)` on the
successfully created `@sap/xssec` XSUAA security context and returns only requested names:

```ts
authInfo.extra.xsuaaUserAttributes = {
  arc1_targets: ['A4H/001', 'A4H/100'],
};
```

Package responsibilities:

- extraction happens only after SAP XSUAA signature/audience validation;
- the allowlist is copied and validated at verifier construction;
- values normalize from scalar string or string array to immutable string arrays;
- missing names are omitted;
- an attribute that is present but empty, mixed, or non-string is represented by an empty array, so
  the consumer can distinguish malformed from missing while still failing closed;
- dangerous object keys cannot modify prototypes;
- raw attributes and values are never logged; only requested/present counts may be logged; and
- client-credentials tokens expose no user attributes.

The auth package does not know target syntax, grant limits, registry membership, or ARC-1 policy.
Those remain ARC-1 responsibilities.

### Package tests

Add focused tests for scalar, array, missing, empty, mixed-type, and client-credentials attributes;
multiple allowlisted names; prototype-shaped names; logger redaction; and unchanged output when the
option is omitted. Mock the security context rather than parsing an unverified JWT.

## ARC-1 Runtime Changes

### Configuration and startup

Add the enum to `ServerConfig`, CLI/env parsing, `.env.example`, and the configuration reference.
`xsuaa-attribute` is valid only when all of these are true:

- `ARC1_MULTI_TARGET_ENDPOINTS=true`;
- XSUAA auth is configured and its service binding is available; and
- the HTTP transport is used.

Invalid combinations fail startup. Single-target `/mcp`, API-key auth, and direct OIDC remain
unchanged. The setting must not be inferred from destinations or from the mere presence of a token
attribute.

The XSUAA verifier requests only `arc1_targets` when the mode is active. Add a small ARC-1 parser
that returns a typed immutable grant set plus an internal reason code; do not thread raw attribute
objects through the server.

An internal `TargetAuthorizationProvider` interface is acceptable if it keeps request handling
simple, but only `all-readers` and `xsuaa-attribute` are implemented. Do not add an unused AMS or
database adapter.

### Authorization order

For pinned and aggregate calls:

1. authenticate the bearer token;
2. require the existing global `read` scope;
3. parse the target grant set;
4. normalize the requested target syntax;
5. require an exact grant **before** registry lookup or target-specific response;
6. resolve the target from the immutable registry;
7. derive the target policy/tool schema; and
8. create the request-local SAP runtime and contact SAP.

For a non-Admin caller, an ungranted valid target and an unknown valid target produce the same
generic response and status. Client-facing errors must not reveal which condition occurred. Audit
may retain distinct internal decision codes after authentication.

Admin can inspect the complete secret-safe registry through `SAPTargets`, but Admin does not bypass
the exact grant for pinned or aggregate SAP execution. A user that has only Admin and no target role
can diagnose configuration but cannot contact a target.

### Filter every target-derived surface

The same granted-active-target projection must drive:

- reader `SAPTargets` output;
- whether reader `SAPTargets` is listed (more than one granted active target);
- aggregate `tools/list` capability unions;
- exact target enums through 16 visible targets;
- the pattern-based schema and model guidance above 16 targets;
- aggregate call dispatch;
- pinned route authorization; and
- feature/tool availability derived from target runtime state.

`SAPTargets` remains available to Admin at zero, one, or many grants. Pinned URLs remain usable when
a user has only one target; no implicit target or `/mcp` alias is introduced.

Do not compute a process-wide union and prune it after `tools/list`: that can reveal tools or
features belonging only to ungranted systems and can make the model choose an impossible action.

### `SAPTargets` contract without paging

Remove the `offset` input and all `diagnosticOffset`, `diagnosticNextOffset`, returned/truncated, and
shared-auth exception truncation fields. An omitted `query` returns the complete role-sensitive
view in one result:

- reader: every active target in the exact grant intersection;
- Admin: every active target plus one secret-safe diagnostic for every ARC-related destination,
  including active, disabled, ignored, and quarantined entries; and
- Admin active target rows include `granted: true|false` without exposing the raw claim.

The optional case-insensitive `query` may remain as a convenience filter and must filter the complete
set, not select a page. It performs no SAP or Destination Service request.

This is intentionally an experimental API change. Existing callers that send `offset` will receive
schema validation failure after the change. Release notes and migration docs must say to remove the
argument; the current v1 behavior remains available only by staying on the previous ARC-1 version.

To make the unpaged contract safe, registry discovery must reject the complete multi-target
snapshot when more than 256 ARC-related destination candidates are present. Counting only enabled
candidates is insufficient because Admin must receive every exclusion diagnostic. The response is
still bounded by existing per-field limits and secret projection. Undefined and default-valued
diagnostic fields should be omitted where their absence is unambiguous; the complete result should
not repeat configuration defaults on every row.

### Audit and logs

Add stable internal decision codes:

```text
TARGET_GRANT_MISSING
TARGET_GRANT_MALFORMED
TARGET_GRANT_LIMIT_EXCEEDED
TARGET_NOT_GRANTED
```

Audit/log fields may include authorization mode, grant count, decision code, registry revision,
authenticated subject using the existing identity treatment, and the normalized requested target
after syntax validation. They must not contain raw grant arrays, IAS groups, role names, tokens, or
XSUAA attribute objects.

Startup logs report the authorization mode and bound only. `SAPTargets` Admin diagnostics report
grant parsing status/count for the current caller, never values.

## Security Analysis

| Threat | Required control |
|---|---|
| Target enumeration | Authenticate and require `read`; check exact grant before registry lookup; non-Admin unknown and ungranted responses are indistinguishable. |
| Forged JWT attribute | Read only from the verified `@sap/xssec` security context. |
| Missing/malformed claim | Zero grants; no fallback to `all-readers`. |
| Attribute cross-product | This specification is mutation-free. `data`/`sql` still need global scope and target policy. Future writes require capability-bound grants and a new ADR. |
| Admin bypass | Admin diagnostics may see all configuration, but execution still needs an exact grant. |
| Group-name collision | Recommend a dedicated IAS application attribute; require exact canonical values and reject malformed claims. |
| Stale role/group membership | No server cache; new token required; document client token/catalog reset. SAP and instance policy still apply on every call. |
| Token/header growth | Cap at 256; measure real XSUAA and gorouter behavior before release; recommend materially fewer grants per user. |
| Alias rename/reuse | Exact public ID requires re-grant after rename. Destination/authorization admin trust is explicit. |
| Logging privacy | Never log or return raw attributes/groups/grants. |
| Machine token | No user attribute means zero grants; multi-target human access remains XSUAA authorization-code based. |

Target grants are not evidence that the SAP user exists or has ADT authorization. Principal
Propagation and SAP authorizations remain the final boundary, and direct calls are never denied from
a remembered SAP login failure.

## Compatibility and Rollout

Although target-specific authorization is new, the implementation still has compatibility duties:

- default `all-readers` preserves current single- and multi-target behavior;
- existing role templates and MTA-created role collections remain unchanged;
- the auth-package API is additive and opt-in;
- single-target `/mcp` does not read `arc1_targets`;
- destination format and restart-only discovery remain unchanged;
- `xsuaa-attribute` can be rolled back by changing the enum to `all-readers` and restarting; and
- removing SAPTargets paging is a separately documented change to the experimental multi-target
  tool schema.

Recommended rollout:

1. deploy the additive XSUAA descriptor and updated auth package with enforcement still
   `all-readers`;
2. create and inspect target roles/collections;
3. decode a short-lived test token with a secret-safe local tool and verify only counts/expected
   target IDs; never paste the token into issues or logs;
4. run the complete role/target matrix in a non-customer space;
5. enable `xsuaa-attribute` on one CF instance and restart;
6. test Viewer, Data, SQL, Admin, missing-grant, malformed-grant, and revoked-grant users; and
7. only then deploy to the customer space.

Rollback enforcement first. Deleting the descriptor attribute/template is optional and should not
be part of emergency rollback.

## Implementation Sequence

Keep this as small reviewable pull requests:

1. **Auth package:** allowlisted verified user-attribute extraction and tests; release a minor
   `@arc-mcp/xsuaa-auth` version.
2. **Descriptor/config:** additive XSUAA attribute/template, ARC-1 enum parsing, startup validation,
   and docs; runtime remains `all-readers` by default.
3. **Authorization projection:** exact parser, filter projection, auth-before-existence, pinned and
   aggregate enforcement, audit codes, and security tests.
4. **Catalog contract:** remove paging/truncation, bound all ARC-related candidates to 256, return
   complete Admin diagnostics, and update ADR-0006 plus end-user/admin docs.
5. **Live acceptance:** CF/IAS role matrix, token/header-size measurements, supported MCP clients,
   revocation/token refresh, and customer-space rehearsal.

The PRs may be combined only if each layer remains independently reviewable in commits and tests.
None may enable multi-target writes.

### Expected file map

The implementation should remain concentrated in these areas:

| Repository | Files/areas | Responsibility |
|---|---|---|
| `@arc-mcp/xsuaa-auth` | XSUAA verifier options/types, verifier tests, README/changelog | Allowlisted extraction from the verified security context; no ARC-1 target policy. |
| ARC-1 auth/config | `xs-security.json`, `src/server/config.ts`, `src/server/types.ts`, `.env.example` | Additive role attribute/template and default-off mode. |
| ARC-1 HTTP/auth | `src/server/http.ts` and a small new target-authorization module | Request the allowlisted attribute, build the grant projection, preserve auth-before-existence. |
| ARC-1 multi-target | `multi-target-server.ts`, `multi-target-tools.ts`, `multi-target-catalog.ts`, `destination-registry.ts` | Filter every target surface; remove catalog paging; enforce the total diagnostic bound. |
| ARC-1 tests | focused `tests/unit/server/*multi-target*` plus deployed-CF acceptance script | Role/target matrix, enumeration resistance, schema isolation, catalog completeness, redaction. |
| ARC-1 docs | ADR-0006, setup, administration, configuration reference, release notes | Customer setup, experimental schema migration, refresh and troubleshooting. |

Do not put grant parsing into general scope expansion in `src/authz/policy.ts`: functional scopes
and exact target grants are different dimensions, and collapsing them makes future review harder.

## Test Matrix

### Unit and property tests

- mode parsing/default/invalid combinations;
- scalar/array/missing/empty/malformed/oversized claim handling;
- normalization, exact dedupe, aliases, unknown values, and no wildcard;
- all-reader compatibility and zero-grant fail-closed behavior;
- two users with disjoint target sets and no schema/feature leakage;
- Viewer/Data/SQL/Admin scope × target A/B matrix;
- Admin diagnostics without execution bypass;
- pinned unknown vs ungranted indistinguishability;
- aggregate target recheck on every call;
- reader SAPTargets visibility at zero, one, two, 16, 17, 100, and 256 grants;
- complete unpaged Admin diagnostics at 256 ARC-related candidates;
- 257 candidates fail the registry snapshot;
- no grant values in logs, audit, errors, health, or tool results; and
- concurrent users cannot share a grant projection or target runtime.

### Live BTP acceptance gates

The following must pass before `xsuaa-attribute` is documented as customer-ready:

1. a static XSUAA role emits one and multiple `arc1_targets` values;
2. an IAS-fed role emits the expected exact value for a user-group assignment;
3. static and IAS-fed roles assigned together produce the expected union after new login and after
   refresh;
4. removing a group/role removes the value after token renewal without an ARC-1 restart;
5. a role with 100 realistic target IDs passes XSUAA authorization, token exchange, CF gorouter,
   ARC-1 verification, and MCP `tools/list`/call;
6. 256 values are measured and either pass end to end or the documented operational recommendation
   and hard parser limit are lowered before implementation;
7. unrelated IAS groups do not enter the dedicated `arc1_targets` application attribute;
8. Viewer, Data, SQL, and Admin behavior is verified in MCP Inspector, VS Code/Copilot, Cursor, and
   one additional supported client; and
9. the exact sign-out/reconnect procedure is verified for a revoked and newly granted user.

The 2026-08-04 live spike created a target-aware role, collection, and IAS group mapping successfully
in the ARC-1 test subaccount. The final token callback timed out before claim inspection, so gates
1–6 remain evidence requirements rather than assumed facts. A previous attempt also proved that
requesting `user_attributes` as a scope is incorrect for this design because XSUAA rejected it as an
invalid application scope.

## Open Questions

These do not block writing the implementation, but they block declaring the feature
customer-ready:

1. **XSUAA union semantics:** confirm the exact scalar/array form when multiple static and IAS-fed
   roles contribute the same attribute and whether refresh tokens immediately reflect changed role
   membership.
2. **Practical token ceiling:** SAP documents a 16 KiB access-token failure threshold, but the
   usable budget depends on the customer's other scopes, groups, and claims. The synthetic estimate
   is about 6.1 KiB at 100 maximum-length IDs and 14.2 KiB at 256; measure both with realistic values
   through the actual gorouter and supported clients.
3. **Customer provisioning recommendation:** both modes remain supported. After the live union and
   token-size tests, decide whether documentation leads with static cohort roles mapped to existing
   IAS groups or with a dedicated IAS `arc1_targets` application attribute.
4. **Raw IAS groups shortcut:** decide whether to document direct `groups` passthrough at all. It is
   convenient for a pilot but fragile in a large tenant unless IAS filters the values.
5. **Total diagnostic ceiling migration:** confirm whether changing the existing enabled-target cap
   to a total ARC-related-candidate cap can reject any real customer destination estate. The
   fail-closed 256 total is the recommended answer for an unpaged catalog.

## Troubleshooting Contract

The administration guide added by the implementation must use this order:

1. confirm the user has `read` and the expected target-aware role collection;
2. inspect the role instance's `arc1_targets` source and configured source-name/value;
3. inspect BTP role-collection mapping and IAS group/application-attribute membership;
4. obtain a fresh token and inspect only the verified attribute count/values locally;
5. confirm exact target syntax/case and current destination alias;
6. call Admin `SAPTargets` for registry and grant-parser status;
7. distinguish ARC-1 `TARGET_NOT_GRANTED` audit from downstream PP/SAP authorization failure; and
8. restart the MCP client if it retains an old token or tool catalog.

Do not tell operators to clear arbitrary browser cookies first. Prefer the existing ARC-1
refresh-access/sign-out workflow, then a clean authorization-code login. Never request
`arc1_targets` or `user_attributes` as an OAuth scope.

## Primary References

- SAP Help: [Attributes](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/attributes)
- SAP Help: [Authorization Entities](https://help.sap.com/docs/btp/sap-business-technology-platform/authorization-entities)
- SAP Help: [Application Security Descriptor Configuration Syntax](https://help.sap.com/docs/btp/sap-business-technology-platform/application-security-descriptor-configuration-syntax)
- SAP Help: [Compatible Changes in the Security Descriptor File](https://help.sap.com/docs/btp/sap-business-technology-platform/compatible-changes-in-security-descriptor-file)
- SAP Help: [Map Role Collections to User Groups](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/map-role-collections-to-user-groups)
- SAP Help: [Configuration Options for XSUAA](https://help.sap.com/docs/btp/sap-business-technology-platform/configuration-options-for-sap-authorization-and-trust-management-service)
- SAP Help: [Configure Subject Patterns](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/configure-subject-patterns-for-principal-propagation)
