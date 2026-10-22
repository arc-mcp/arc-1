# Secure multi target writes and configuration strategy

**Recommendation:** add a narrow object-development capability to pinned Principal Propagation
routes in one ARC-1 deployment. Keep `/multi/mcp` and shared Basic targets mutation-free. Require
an exact write grant for the selected target, enforce both instance and destination policy, and
ship a configuration validator with the capability. Use PR #906 as implementation material;
rework its authorization and operation surface against current main before enabling writes.

This covers multiple SAP targets in one BTP CF application. Multiple CF replicas and SaaS tenants
are separate concerns. It covers repository development, not business-data updates or ABAP/RFC
execution. These recommendations do not change the accepted ADRs or enable runtime writes.

## Agreed configuration direction

- Reuse **`SAP_ALLOW_WRITES`** as the only global write switch; do not add
  `ARC1_MULTI_TARGET_ALLOW_WRITES` or duplicate transport/Git switches.
- Opt each target in through proposed destination properties `arc1.allow_writes` and
  `arc1.allowed_packages`. A destination cannot enable a capability forbidden by the server.
- Use the existing pinned `/<SYSTEM-OR-ALIAS>/<CLIENT>/mcp` URL. No additional `/write/mcp`
  endpoint is needed. `/multi/mcp` remains structurally mutation-free.
- Require PP for **multi-target writes only**. Multi-target Basic destinations stay read-only;
  existing single-target `/mcp` authentication support and write semantics stay unchanged.
- Document server settings, destination settings and user grants separately, with one minimal
  setup and an explanation of the effective permissions. Do not describe proposed settings as
  available on the current release.

## Baseline and current evidence

Research date: **22 October 2026**. A fresh `git fetch origin main` resolved to
[`7b210cbfa91a0cc8e22ccb9c2c2c68f4060d89f1`](https://github.com/arc-mcp/arc-1/commit/7b210cbfa91a0cc8e22ccb9c2c2c68f4060d89f1),
release **1.7.0**. The local checkout matched that revision.
[PR #906](https://github.com/arc-mcp/arc-1/pull/906) was open and unmerged at head
`9250a24f887540450e091f29294cf0572dffd472`. Its merge base was `1f00c7acae59f9f25027956ee472ae1cac13a9fe`;
main had 111 subsequent commits and the PR had 13. GitHub reported it non-mergeable at inspection.

| Area | Current main | Implication |
|---|---|---|
| Mutation boundary | `multiTargetSafety` hardcodes writes off; write destination properties are quarantined; tools and dispatch have an explicit read allowlist. | This needs a deliberate new boundary, not just exposing SAPWrite. |
| Target authorization | #677 merged on 14 October. `xsuaa-attribute` projects verified `arc1_targets` before instructions, schemas and execution; standard mode remains available. | Reuse the verified projection and denial ordering. Read visibility does not grant a target-specific capability. |
| Identity and drift | Strict PP, isolated request clients, startup snapshot, uncached destination drift checks and subaccount-owner checks already exist. | Preserve these paths, including the newer destination-runtime module absent from #906's changed-file list. |
| Stale edits | #853 supplies editable source hashes and optional `expectedSourceHash`, checked under the SAP lock. | Require this existing mechanism for supported beta source updates. It protects freshness, not target identity. |
| Uncertain results | #830 disables transient replay for creates and marks ambiguous outcomes; #1050 adds bounded activation and uncertain-completion handling. | Reuse these controls; review remaining update/lock retry paths separately. |
| Cancellation | MCP signals reach dispatch context; activation consumes a shared deadline and signal. | The older V2 roadmap's blanket absence of cancellation plumbing is stale. General CRUD and cleanup still need targeted qualification. |
| Audit | BTP audit delivery is asynchronous and does not block mutations on delivery failure. | Do not claim durable audit-before-write guarantees. Define the required operating contract. |

Source anchors: [registry](../../src/server/destination-registry.ts),
[runtime construction](../../src/server/multi-target-runtime.ts),
[verified grants](../../src/server/multi-target-authorization.ts),
[request projection](../../src/server/multi-target-request-projection.ts),
[early dispatch gates](../../src/server/multi-target-server.ts),
[destination resolution](../../src/server/multi-target-destination-runtime.ts),
[source checks](../../src/adt/source-precondition.ts), [CRUD](../../src/adt/crud.ts),
[create replay policy](../../src/adt/create-request.ts), [activation](../../src/adt/devtools.ts),
[audit sink](../../src/server/sinks/btp-auditlog.ts).

Source hashes and create replay protection predate #906; target authorization and the latest
activation handling are subsequent changes. The useful comparison is the actual current code,
not the age of every individual control.

The [V2 roadmap](../plans/multi-target-v2-roadmap.md) already recommends pinned PP writes,
capability-bound grants and staged delivery. Its deferred-work inventory is useful, but it is a
draft, and individual claims must be reconciled with current code. The
[latest #677 acceptance record](2026-10-13-pr677-final-build-acceptance.md) supports the default-off
feature while retaining gaps in independent SAP-user attribution, named clients, some identity
isolation cases, enterprise token sizes and durable audit delivery. Merged does not mean every
customer acceptance gate passed.

## Strategies compared

| Strategy | Configuration and user experience | Security and implementation tradeoff | Assessment |
|---|---|---|---|
| Separate writable applications per target | More deployments and connections; independent ceilings and lifecycles. | Strongest process isolation; available today. | Retain for production and different trust domains. |
| Integrate #906 with its full single-target surface | Small conceptual change: enable instance and destination writes. | Global capability scopes, broad mutation surface and incomplete transport policy require significant follow-up. | Useful prototype; insufficient as the customer contract. |
| Narrow pinned PP writes in one application | One deployment; one read connection plus a few explicitly configured write connections. | Exact target/capability grants and shared policy checks reduce routing errors; process failure domain remains shared. | **Recommended first implementation.** |
| Writes through `/multi/mcp` | One connection for everything. | The model selects the write target on each call; needs stronger intent binding, retry semantics and client evidence. | Excluded from the agreed design; aggregate remains mutation-free. |

Do not require developers to configure 100 writable connectors. Keep the aggregate catalog for
research and provision pinned connectors only for their active development systems. A single
deployment is achievable without making every tool choose a target dynamically.

## SAP repository scope changes the safety model

The ABAP repository is cross-client: changing repository code through one logon client changes
the repository used by other clients of the same physical SAP system. SAP explicitly distinguishes
this from client-specific application data in its
[ABAP Platform data-structure guidance](https://learning.sap.com/courses/introducing-sap-abap-platform-fundamentals/exploring-the-data-structure-of-sap-systems-based-on-abap-platform).

Consequently, a grant for `A4H/001` controls the identity and route used to make a change; it does
not promise that the change is invisible to `A4H/100`. A read-only route for client 100 cannot
protect that shared repository from an authorized writer entering through client 001. A separate
ARC-1 application alone also cannot isolate two clients sharing one SAP repository.

For the first pilot, use a real non-production SAP system, designate one development login client
per physical repository, and show the cross-client impact in the configuration preview. Group
capacity controls by physical backend as well as public route. Do not deduce physical identity or
production status from SID spelling: independent systems can share a SID, and several URLs can
reach one system. Use verified connectivity inventory and an explicit operator mapping where
automatic evidence is insufficient.

Package restrictions limit what ARC-1 may edit. They are not a runtime sandbox for the ABAP code
that is subsequently executed, and `$TMP` means local transport handling, not isolated execution.

## What to retain and change from PR 906

Retain its required route discriminator, structural aggregate/Basic denial, mandatory nonempty
destination package list, policy fingerprinting, default-off rollout and contextual server
instructions. These are sound building blocks.

Change the following before a customer write release:

1. **Bind the write capability to a target.** #906 has no capability-bound grants. If writes were
   enabled using current main's read-grant model, combining global `write` with
   `arc1_targets=[A,B]` would permit writing both enabled targets even when the intended assignment
   was “develop on A, inspect B.” Current main's structural read-only ceiling prevents that today.
   A read `*` grant must never become a write wildcard.
2. **Keep the existing instance ceiling authoritative.** The PR derives effective writes from
   `multiTargetAllowWrites` and destination properties, uses the destination's package list and
   constructs `allowedTransports: []`. It deliberately uses independent multi-target write flags.
   Reuse the existing `SAP_ALLOW_WRITES` ceiling without a second multi-target write switch, with
   instance and target package/transport restrictions checked independently. Never union them or
   approximate wildcard intersections by comparing pattern strings.
3. **Allow reviewed actions explicitly.** The PR returns the normal single-target tool surface
   when pinned writes are enabled. That includes package/system operations beyond code editing.
   Package lists cannot constrain formatter settings, trace control or all FLP/UI5 operations.
   Operators should not need a growing deny list to recover the intended beta scope.
4. **Handle transport recording before transport management.** Ordinary object saves can carry an
   explicit transport or use the lock's `corrNr`; disabling `SAPTransport` mutations does not
   prevent that. Current generic CRUD paths pass these values without a transport-allowlist check.
   Add coverage for both sources before transportable packages enter the beta.
5. **Reconcile current identifiers and architecture.** ADR-0008 now means target authorization,
   ADR-0009 covers execution extensions, and security risk R22 is already allocated. Allocate a
   new write ADR and risk entry. Preserve #677's multi-only guard and caller projection rather
   than mechanically resolving the old branch's conflicts.
6. **Qualify real PP writes.** #906 reports unit coverage and explicitly no real-system write
   test. A direct Basic-auth test against SAP cannot validate the BTP/PP route.

These are architectural integration gaps, not a claim that every PR path has an exploitable defect.

## Proposed authorization and configuration contract

A write should require all of these:

```text
valid supported XSUAA user
  AND pinned Principal Propagation route
  AND existing instance write ceiling (SAP_ALLOW_WRITES)
  AND destination write opt-in
  AND verified explicit functional write scope
  AND exact target write grant
  AND reviewed action and object type
  AND instance AND target package and transport restrictions
  AND no matching deny rule
  AND SAP authorization
```

Use the same evaluator for tool visibility, execution and administrator explanations. Execute the
checks again for direct calls even when the client caches tools. Unknown actions must stay denied
when new single-target functionality ships. Reject caller-supplied target selectors on pinned
mutation calls so a conflicting argument cannot be silently ignored.

### Server restrictions and destination restrictions both apply

Current main already combines data-preview and free-SQL permissions as **server AND
destination**, then checks user scopes and SAP authorization. It also propagates the global data
source blocklist and action denials. This does **not** establish package-policy inheritance for
writes: `multiTargetSafety` currently hardcodes writes off, packages to `$TMP`, and transports to
an empty list. An enabled destination containing write/package properties is quarantined, even
when a write property is `false`.

The write implementation must make the following rules explicit:

| Kind of setting | Proposed rule | Example |
|---|---|---|
| Capability switches | Server and destination must both allow it; omitted destination opt-in means off. | Global writes off plus destination writes on still means no writes. |
| Allowed packages | The real package must satisfy both independent allowlists. | Server `ZTEAM*`, destination `ZTEAM_API`: only `ZTEAM_API` passes. |
| Disjoint package lists | Deny the write; never interpret an empty intersection as unrestricted. | Server `$TMP`, destination `ZTEAM_API`: neither package passes both. |
| Allowed transports | Check global and target restrictions against the actual transport/task used by the operation. | A destination cannot authorize an ID excluded by `SAP_ALLOWED_TRANSPORTS`. |
| Denied actions | Every applicable deny rule wins. If target-local denials are added later, combine them with the server denies. | A server-denied `SAPWrite.delete` stays denied for every target and user. |
| Shared runtime limits | Retain the process-wide limits; adding destinations does not multiply the budget. | `ARC1_MAX_CONCURRENT=10` remains ten across the process. |

Do not call this “server overwrites destination”: replacement could erase a narrower destination
policy. The useful operator rule is **a destination can restrict the server's permissions, never
expand them**. A broader server package list is a ceiling, not permission to use every package on
every target. Leaving the server default `$TMP` will intentionally block a destination requesting
only `ZTEAM_API`; the operator must deliberately permit that package at both layers. Package lists
constrain writes, not source reads or table/SQL visibility.

Check package patterns independently against the resolved package, including live hierarchy
resolution for `/**`. Do not approximate this by intersecting pattern strings. Permission-switch
rules also do not apply blindly to quality settings: their existing override and failure semantics
must be documented separately.

### Existing controls to reuse or complete

| Control | Current multi-target behavior | Write implementation recommendation |
|---|---|---|
| `SAP_ALLOW_WRITES`, `SAP_ALLOWED_PACKAGES` | Writes hard-disabled; global packages are not propagated into the isolated runtime. | Introduce the reviewed pinned-PP path and enforce both package policies; keep aggregate/Basic denial structural. |
| `SAP_ALLOWED_TRANSPORTS` | Isolated runtime uses `[]`; the global transport list is not inherited. | Carry the restriction deliberately and check transport recording in ordinary creates/updates as well as enabled transport operations. Qualify existing transport reads too, since the shared ID checker also filters reads. |
| `SAP_ALLOW_TRANSPORT_WRITES`, `SAP_ALLOW_GIT_WRITES` | Both forced off. | Reuse these existing switches when the corresponding capabilities are qualified; keep them off for the first object-write beta. They still also require `SAP_ALLOW_WRITES`. |
| `SAP_DENY_ACTIONS` | Already inherited and enforced before selected-target SAP work. | Preserve for writes, including direct hidden-action calls. Keep the beta's built-in action/type allowlist so new single-target actions cannot appear automatically. A destination deny-list property is not required for the first release. |
| `SAP_LINT_BEFORE_WRITE`, `SAP_ABAPLINT_CONFIG` | Lint flag is copied; custom config is not copied into the target runtime. Writes are unavailable. | Carry the selected global lint configuration, validate against the selected target release, and keep lint on by default. Current per-call skips, type exceptions and fail-open lint errors mean this is a quality aid, not a non-bypassable authorization boundary. |
| `SAP_CHECK_BEFORE_WRITE` | Forced false in the target runtime. | Honor the existing global setting on qualified write paths. Describe it as optional SAP syntax feedback: findings and request failures do not block saves. |
| `expectedSourceHash` | Available in single-target source update paths; no multi-target writes. | Require it for the supported beta source updates, with fresh comparison under the selected user's SAP lock. No extra deployment switch is needed. |
| Activation scope | Activation unavailable. | Before enabling it, validate every affected object, including SAP preaudit additions, against the same action/type/package boundary. This is an implementation invariant, not another operator flag. |
| Data preview, free SQL, `SAP_BLOCKED_DATA_SOURCES` | Already enforced separately from repository access. | Preserve unchanged; enabling writes must never implicitly enable data/SQL or weaken the blocklist. |
| Rate limits, concurrency, data-result limits, strict PP and drift checks | Already present. | Preserve, qualify write cleanup/cancellation and policy changes, and add target fairness only when supported by operating evidence. |

For normal object saves, transport membership must be checked independently of the
transport-management switch. Calling `checkTransport(..., true)` blindly would require
`SAP_ALLOW_TRANSPORT_WRITES` merely to save into an existing request, changing the intended
separation between development and transport administration. Document legacy global empty-list
semantics and the proposed stricter per-target write policy explicitly rather than changing
single-target defaults as a side effect.

Evidence: [registry policy](../../src/server/destination-registry.ts),
[isolated runtime](../../src/server/multi-target-runtime.ts),
[safety checks](../../src/adt/safety.ts), [pre-write validation](../../src/handlers/write-helpers.ts),
[configuration reference](../../docs_page/configuration-reference.md).

### Keep IAM simple and capability specific

For the first object-write release, prefer a dedicated verified attribute such as
`arc1_write_targets`, containing exact public IDs. Keep `arc1_targets` for access/visibility and
require both grants. The attribute name binds the values to writing, so independent read roles
cannot create the cross-product above. Missing, malformed or oversized write claims deny writes;
no wildcard or inherited write targets.

| Representation | Advantage | Cost | Recommendation |
|---|---|---|---|
| Separate exact list per capability | Familiar extension of today's target attribute; simple Cockpit values and parser. | More attributes when transport/Git arrive. | Start with one write attribute. |
| One list of `TARGET#capability` values | Explicit binding and flexible later capabilities. | New grammar and less convenient manual entry. | Reconsider if several capabilities are actually needed. |
| One scope per target and capability | Direct OAuth terminology. | Large descriptor/role administration surface and token churn. | Avoid for a growing target inventory. |
| External policy service | Central enterprise policy and potentially faster revocation. | New availability, freshness and operating dependencies. | Only for a demonstrated IAM requirement. |

Add a focused object-developer role granting `read` and `write`; do not require the existing
`MCPDeveloper`, which also grants transports and Git. Preserve single-target roles unchanged.
Provide a diagnostics role for operators. Current `MCPAdmin` explicitly contains write scopes,
and runtime `admin` also implies them: checking raw scopes alone is insufficient to separate
administration from development. Exact target write grants remain mandatory even for Admin.

The current auth dependency returns expanded scopes. Obtain verified raw local scopes before
expansion through an explicit verifier wrapper or an additive dependency API; do not decode an
unverified JWT or trust caller-supplied metadata. The existing verifier supports an optional scope
expander, so a dependency change is not automatically required. Exercise multiple role collections,
token/header limits and old-token behavior in the live XSUAA spike.

### Generate a small operator setup

Keep `.mtaext` as the instance source, Destination Service as the connection/target-policy source,
and XSUAA as the grant source. A setup generator should produce these artifacts from a short
questionnaire; it must not create a fourth runtime policy store.

The following is a **proposed contract, not working configuration on 1.7.0**. The global switches
already exist, but current main does not support these write destination properties or the proposed
write attribute:

```yaml
# Proposed .mtaext properties for a local-object pilot
ARC1_MULTI_TARGET_ENDPOINTS: "true"
ARC1_MULTI_TARGET_AUTHORIZATION: xsuaa-attribute
SAP_ALLOW_WRITES: "true"
SAP_ALLOWED_PACKAGES: "$TMP"
SAP_ALLOW_TRANSPORT_WRITES: "false"
SAP_ALLOW_GIT_WRITES: "false"
ARC1_CACHE: none
```

```properties
# Existing PP connection fields plus proposed target write policy
Authentication=PrincipalPropagation
sap-sysid=A4H
sap-client=001
arc1.enabled=true
arc1.allow_writes=true
arc1.allowed_packages=$TMP
```

```text
Verified example user:
  functional scopes: read, write
  arc1_targets:       A4H/001, QAS/100
  arc1_write_targets: A4H/001                  (proposed)

Effective result:
  /A4H/001/mcp   reviewed object writes in $TMP
  /QAS/100/mcp   read-only for this user
  /multi/mcp     read-only for every user
```

Require an explicit destination package list. Reject empty/malformed lists and standalone `*` in
the initial write profile; local `$TMP` is suitable for disposable test objects, while an exact
team package is the subsequent normal setup. Do not silently inherit `Z*` or an unrestricted
empty array. For transportable packages, add a reviewed target transport list: absence means no
transport-bound saves, even though today's single-target empty transport list means unrestricted.

In multi-target mode, keep Basic writes, aggregate writes, plugins and alternate auth paths
structurally unavailable. This does not impose PP on existing single-target writes. The recommended
IAM design requires target-filtered access for writable multi-target destinations. Configuration
errors should identify the field and reason without echoing untrusted values or secrets. With
`SAP_ALLOW_WRITES=false`, valid future PP write policy may remain readable and visibly disabled;
invalid policy must fail closed.

The validator should show requested and effective capabilities, packages, transport rules, route,
identity mode, backend repository grouping, policy revision, and the exact denying layer. An
administrator preview of destination policy is not proof of a user's SAP permissions: user-level
checks require that user's verified token and, where appropriate, bounded PP probes. Diagnostic
tools must never assign roles, enable writes or retry with a technical identity automatically.

### Operator documentation is part of the release

Update the existing setup/administration guides and configuration reference in the implementation
PR, when they can describe shipped behavior. Keep this research note clearly separate. The public
guide must answer these questions in order, without requiring readers to reconstruct the ADR:

1. **What works?** A compact route/auth/action matrix: pinned PP may write; aggregate and Basic
   remain read-only; independent single-target behavior is unchanged. List supported beta actions
   and the separately deferred operations.
2. **Where do I configure it?** App operator: `.mtaext` properties for server ceilings. Destination
   owner: connection plus target policy. IAM owner: user scopes and exact target grants. SAP owner:
   propagated identity and native authorizations. No new configuration file or duplicate global flag.
3. **What is the smallest setup?** One complete PP/local-package example, its role assignment and
   the exact existing pinned URL to register. Keep transportable-package and advanced-pattern
   examples separate; preserve the existing PP/Cloud Connector prerequisites by linking their
   canonical setup steps.
4. **What wins when settings differ?** Show the AND/intersection rules and examples above. Include
   omitted, false, empty, malformed and conflicting values, the `$TMP` server default, and what
   happens when no package can pass. Distinguish security restrictions from optional quality checks.
5. **How do I verify it?** Explain the configured versus effective policy and the denying layer,
   then separately verify the user's SAP identity and bounded write acceptance. A healthy app or
   visible tool does not prove write authorization.
6. **How do I change or disable it?** Explain destination drift/restarts, client token/tool refresh,
   all-instance rollout and the global kill switch. On MTA deployment, explicitly set
   `SAP_ALLOW_WRITES: "false"`; deleting the extension line does not reliably unset it. Document
   removal of unsupported destination keys before rolling back to the old read-only binary.

Use a documentation walkthrough as an acceptance check: an unfamiliar operator must configure one
writable target and one read-only target, explain the effective package policy, diagnose a deliberate
global/destination mismatch, and disable writes. Test example configurations against the parser and
policy evaluator, in addition to the strict documentation build. Avoid adding another runtime
switch for every internal safeguard.

## Mutation behavior to qualify

Start with a reviewed subset of CLAS/INTF create/update and selected method edits, plus explicit
activation for those objects. Require `expectedSourceHash` for supported updates using the current
editable-read flow. Defer delete, batch creation, package moves, DDIC structural changes, service
publication, trace/settings changes, transport management and Git mutation.

Before activation, validate the complete proposed activation scope, including additional object
references returned by SAP preaudit. Current `confirmPreaudit` serializes SAP-returned references;
checking only the original handler arguments is not sufficient evidence that every affected
object stays inside the beta type/package boundary. Similarly, a full-object activation must not
be presented as activating only the one method the model edited. Inactive work outside the reviewed
change needs explicit handling.

Preserve one selected target and one authenticated user throughout a call. Lock, save and unlock
must finish within that synchronous call. Perform identity/action/package checks before acquiring
a mutation lock. For transports, preauthorize the candidate before lock where possible and check
the actual `corrNr` before save; if a release cannot establish the required policy safely, exclude
that flow. A post-lock rejection still needs cleanup and must not be described as “no lock sent.”

Test cancellation separately for the main operation and cleanup: an already-aborted user signal
must not make an essential unlock impossible. Report success, confirmed failure, partial change
and unknown completion distinctly. Preserve current create/activation replay protection; inspect
remaining transient HTTP retries before enabling each path. Never repeat an uncertain mutation
automatically on another target or under another identity.

Keep caches off initially. Reuse existing request isolation, add bounded queue waits and backend
fairness appropriate to the pilot, and test two users against two systems and two clients. Session
reuse is a separate optimization, not a prerequisite to the first correct write. PP-only replica
support needs its own concurrency/rollout evidence; mixed Basic deployments retain their existing
one-instance restriction.

Audit each decision and outcome with verified caller, public target, safe policy/backend revision,
action, object and correlation ID. Do not log source bodies or credentials. For a development
pilot, explicitly accept and monitor the existing asynchronous audit contract. Where durable
pre-write evidence is required, add a bounded durable receipt/outbox or acknowledged audit path
and refuse new writes when admission fails. A remote sink outage cannot roll back a SAP mutation
that already completed.

## OAuth and client usability

The [current MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
defines resource indicators, audience checks and scope challenges. Its
[security guidance](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices#scope-minimization)
recommends minimal initial scopes and targeted elevation. Those are design inputs; they do not
prove the installed ARC-1 SDK or each client implements a usable write step-up flow.

Prototype a real HTTP `403 insufficient_scope` challenge before SAP mutation preparation. Today's
MCP tool error alone is not that flow. If supported clients cannot elevate reliably, qualify a
fixed minimal read/write scope set for pinned development connections, with explicit connector
provisioning. Do not advertise transports/Git in the first beta. Aggregate metadata and Copilot's
aggregate `/authorize` compatibility path stay mutation-free. Keep metadata independent of target
existence to preserve the pre-authentication inventory boundary.

A pinned resource URL is not a per-target token restriction unless XSUAA demonstrably issues and
the server validates that restriction. Exact target write grants remain authoritative. Connector
names should identify the target and write policy, and responses should carry the executed target
without corrupting source payloads. User confirmations can help prevent mistakes but cannot replace
server authorization or survive prompt injection as the sole control.

## Delivery sequence and release gates

| Work package | Reviewable outcome | Gate before proceeding |
|---|---|---|
| 1. Decision and two focused spikes | New write ADR; XSUAA exact write grants/raw scopes; real-client OAuth choice; repository-wide impact model. | Demonstrate “write A, read B” with separate users and no Admin bypass. |
| 2. Policy and configuration tooling | Strict target policy, generated examples/roles, requested-versus-effective diagnostics, drift and replica rollout checks; writes still disabled. | An unfamiliar operator configures the pilot and diagnoses deliberate mistakes. |
| 3. Common mutation hardening | Transport checks, source preconditions, complete activation scope, cleanup/cancellation, retry/outcome and audit contract. | Negative tests prove the permitted preparation and mutation behavior at each gate. |
| 4. Pinned PP object-write beta | Small action/type allowlist, no new target argument, no aggregate/Basic writes. | Isolated BTP test with actual PP, independently verified SAP author, cross-client checks and client reconnect tests. |
| 5. Controlled expansion | Transportable packages, additional object types/actions, then destructive actions, transport management and Git in separate changes. | Evidence for each capability; no automatic inheritance from the single-target surface. |

This can deliver a small developer pilot without first completing caching, dynamic registry refresh,
an admin UI, SaaS, or the entire 100-target operations roadmap. Customer-scale claims still require
load, fairness, token-size and client evidence at the intended size.

The essential negative matrix includes writes disabled at each layer; Admin without write grants;
read-all plus write-one; mixed roles; wrong/malformed/expired claims; direct hidden-action calls;
Basic and aggregate attempts; same physical repository behind aliases/clients; destination remap;
stale source; package escape; explicit and lock-derived transport mismatch; expanded activation;
PP failure without fallback; cancellation; ambiguous response; and old client tool catalogs.

Roll out with flags off, prepare exact grants, enable one non-production PP target/package, inspect
effective policy, restart all serving instances and refresh client tokens/catalogs. Preserve current
destination drift refusal. Do not silently repoint a writable public ID to a different backend:
require reviewed re-grant/re-enrollment. An emergency flag takes effect only after every instance
applies it; drain/unroute for immediate containment, and expect in-flight work may complete. Binary
rollback to current v1 requires removing unsupported write destination properties. Merely turning
their values false still leaves keys that v1 quarantines.

## Verification and roadmap impact

At the baseline above, **233 tests in seven files passed** for registry, runtime, tool allowlists,
target grants/enforcement, HTTP routes and action policy. Another **74 tests in two files passed**
for source preconditions and activation timeout/outcome handling: **307 focused tests total**.
Dependencies were installed with `npm ci --ignore-scripts --no-audit --no-fund`; Node 22.21.1
reported lint-staged's newer engine requirement, while these selected tests completed successfully.
These are current-main local tests, not tests of #906's branch or a live writable PP deployment.
No SAP writes, IAM changes, destination edits or deployments were performed for this research.
The strict documentation-site build passed, all checked local/main-branch file links in the
assessment and roadmap resolved locally, and the final origin fetch still matched the baseline.

Roadmap: add **FEAT-93** for the focused pinned PP object-write outcome and link this assessment
and #906. Leave **FEAT-59** scoped to embedding/multitenancy. **OPS-06** session reuse,
**OPS-08** outage/queue isolation and **FEAT-66** destructive confirmation remain independent
work; none is completed by this research. Reconcile the older V2 work inventory during the ADR
step rather than treating every historical prerequisite as absent on current main.
