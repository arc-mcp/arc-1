# XSUAA Target Authorization: Research and Provisioning Validation

- **Date:** 2026-09-05
- **Purpose:** refine [the proposed target-authorization spec](../plans/xsuaa-target-authorization.md)
  after Wouter's review; this is not evidence that ARC-1 already enforces target grants.
- **Code baseline:** ARC-1 `origin/main` at `347d83f3`, version 1.2.0 with
  `@arc-mcp/xsuaa-auth ^1.0.2`; current auth-package source was inspected as well.

## Outcome

Keep BTP-native XSUAA attributes, mandatory enforcement and the explicit all-target value `*`.
Change the previous draft's reusable role template: an ordinary exact-target role must **not**
default to all targets. Two separate templates provide a clearer least-privilege workflow:

| Template | Attribute reference | Generated default role |
|---|---|---|
| `MCPTargetReadAccess` | Required `arc1_targets`, no default | None; administrator creates exact/static or IdP-sourced role |
| `MCPAllTargetReadAccess` | Required `arc1_targets`, default `["*"]` | Explicit broad role, usable by one new predefined collection |

The test subaccount's live broker accepted this design on **both create and update**. The ordinary
template accepted administrator-created static and IdP-sourced roles without a broad default.
Issued-user-token behavior was not tested in this run.

## What SAP guidance establishes

### Required attributes and the documentation conflict

SAP's descriptor documentation describes a required attribute used in one template with defaults
and another without; only the former generates a role. A later restriction appears to forbid the
latter. This conflict is also present in SAP's published documentation source. It does not justify
defaulting every ordinary role to `*`. The live broker evidence below supports separate templates,
but customer rollout still needs a full-descriptor rehearsal.
[SAP descriptor documentation source](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/application-security-descriptor-configuration-syntax-517895a.md)

SAP CAP guidance recommends restricted attributes and warns that combining Unrestricted and
restricted assignments can produce surprising narrowing. ARC-1 is not a CAP app and must implement
its own checks; the transferable principle is to avoid interpreting absence as all access. Literal
`*` is an explicit **ARC-1 contract**, not an automatic XSUAA pattern-matching feature.
[SAP CAP authorization guidance](https://cap.cloud.sap/docs/guides/security/authorization#unrestricted-xsuaa-attributes)

### Provisioning and lifecycle

Static BTP role values and values from a trusted IdP are supported instance-authorization inputs.
Lead customer documentation with reusable static cohorts mapped to existing groups; a dedicated
IAS attribute is useful when corporate IAM already maintains the authoritative target list.
Neither method discovers whether the user's SAP account exists. A customer must configure the
actual SAML/OIDC claim and mappings; a screenshot showing an IdP attribute is not proof of the
resulting application JWT.
[SAP instance-based authorization](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/setting-up-instance-based-authorizations)

Add new templates rather than adding attribute references to existing templates during update.
Do not broaden existing assigned predefined collections. The new all-target collection is created
unassigned and requires an explicit IAM grant.
[Compatible descriptor changes](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/compatible-changes-in-the-security-descriptor-file-c3b892e.md),
[Predefined collection restrictions](https://help.sap.com/docs/btp/sap-business-technology-platform/cannot-add-role-templates-to-predefined-role-collections)

### Revocation and limits

Offline validation can accept an old signed access token until it expires despite server-side
revocation. Main currently configures a one-hour access token; role removal, fresh login, refresh
exchange and browser-session reuse must be tested separately. No ARC-1 grant cache does not imply
instant revocation. SAP currently recommends short token validity, but not less than 30 minutes.
[Token validation/revocation](https://help.sap.com/docs/btp/sap-business-technology-platform/validation-and-revocation-of-access-tokens),
[XSUAA security considerations](https://help.sap.com/docs/btp/sap-business-technology-platform/security-considerations-for-sap-authorization-and-trust-management-service)

SAP documents a 16 K token-size failure scenario and recommends limiting unnecessary groups and
role-collection claims. Removing redundant system claims is an optional tested optimization, not
an unconditional descriptor change: inspect PP and other bound consumers first. Measure full
tokens and headers, not only the target array.
[SAP token-size troubleshooting](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/400-error-call-to-oauth-token-was-not-successful?locale=en-US&state=PRODUCTION&version=Cloud)

SAP's subaccount/descriptor artifact limits are another reason to reuse cohorts rather than
creating an object for every user/target pair. The spec distinguishes those SAP limits from its
own proposed parser, registry and MCP-output budgets.
[SAP technical-artifact limits](https://help.sap.com/docs/btp/sap-business-technology-platform/limits-for-technical-artifacts-of-sap-authorization-and-trust-management-service)

## Live probe — reproducible outline and actual results

The operator CLI sessions were available. Inspection showed the existing ARC-1 XSUAA service was
bound to multiple running applications, so it was **not updated**. Instead, the probe used a
uniquely named, unbound `xsuaa/application` service in the test CF space. No service keys or
bindings were created; no users received the new roles/collection; no SAP requests were made.

| Step | Action | Observed result |
|---|---|---|
| 1 | Create disposable service with a read scope and plain baseline Viewer template | `create succeeded` |
| 2 | Update it with required `arc1_targets`, exact no-default template, separate `*` template and unassigned predefined collection | Update complete |
| 3 | Read roles through BTP CLI | Broad read-only default has static `["*"]`; no generated role for exact template; baseline Viewer remains |
| 4 | Create exact custom role from `MCPTargetReadAccess` | Stored static values exactly `["A4H/001", "A4H/100"]`; no `*` |
| 5 | Create IdP-sourced custom role from same template | Stored source `idp`, source attribute `arc1_target_ids`; required value retained |
| 6 | Inspect predefined collection's direct user assignments | Zero assignments |
| 7 | Remove the two custom roles and disposable service; inspect collection list | Service absent and its predefined collection absent |
| 8 | Fresh-create disposable service directly from full two-template descriptor | `create succeeded`; same generated-role behavior |
| 9 | Delete fresh-create service and verify absence | Cleanup verified after the probe |

The descriptor fragments are in the spec. A repeatable customer rehearsal should use unique
non-production names and these supported commands, with **no** existing production service name:

```bash
cf create-service xsuaa application <disposable-service> -c <baseline.json>
cf update-service <disposable-service> -c <two-template-descriptor.json>
btp create security/role <exact-role> --of-app '<returned-application-id>' \
  --of-role-template MCPTargetReadAccess --attributes <exact-values.json>
btp create security/role <idp-role> --of-app '<returned-application-id>' \
  --of-role-template MCPTargetReadAccess --attributes <idp-values.json>
```

Only after confirming these are the artifacts created by the rehearsal, delete its custom roles
with `btp delete security/role` and the unbound service with `cf delete-service`. Verify both role
and collection cleanup. Do not delete or rewrite a customer's in-use XSUAA service to perform this
test. The CLI application ID is returned by BTP; never hardcode the test tenant's suffix.

## Source-review findings incorporated in the spec

- **Mixed-route bypass:** current main only warns about PP `/mcp` overlap. Proposed enforcement
  rejects mixed single/multi runtimes; normal single-target-only remains unchanged.
- **Capability cross-product:** global SQL/data/Admin scopes apply over the complete target union.
  Separate role collections do not preserve target/capability pairs. Per-target capability
  separation needs distinct applications or a later reviewed model.
- **Machine Admin:** omitting attributes from machine tokens is insufficient when Admin can see
  diagnostics without execution grants. Reject machines before both catalog and execution.
- **Hidden surface:** Copilot JSON-RPC `/authorize` must use the aggregate projection too.
- **Schemas:** project granted destination policies before tool generation; do not let shared SAP
  feature-probe evidence reshape another user's tool definitions.
- **No paging:** bound malformed diagnostic fields and complete serialized output, not just valid
  target count. Over-limit deployments get an explicit failure summary, not a hidden first page.

## What remains unproven

The following are implementation/release acceptance gates, not completed tests:

1. Application-user JWT claims for exact, static+static, static+IAS and `*`+exact unions; SDK
   treatment of missing/empty/Unrestricted values.
2. Trusted human-principal classification across authorization-code, refresh and supported user
   exchange flows, and rejection of machine tokens even with Admin scope.
3. Old-token replay after removal, refresh behavior, reused browser session, fresh sign-in, and
   actual MCP catalog refresh behavior.
4. Realistic 50/100/256-target JWTs and complete unpaged catalogs through customer proxies and MCP
   clients; the proposed hard bounds are not measured capacity claims.
5. Runtime enforcement across pinned, aggregate and Copilot alias routes; no such runtime code is
   included in this documentation PR.

Those tests need an isolated test application and a real application-user login. CF/BTP CLI login
alone cannot prove them. Use the designated secondary account in a fresh incognito session for
user-assisted tests; never reuse the primary administrator's normal browser session.
