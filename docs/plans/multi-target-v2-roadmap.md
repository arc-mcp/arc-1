# Multi-Target V2 Roadmap

- **Status:** Draft roadmap for future pull requests
- **Date:** 2026-07-20
- **Baseline:** experimental mutation-free multi-target v1 from PR
  [#579](https://github.com/arc-mcp/arc-1/pull/579)
- **Scope:** BTP Cloud Foundry, subaccount Destination Service, XSUAA, and on-premise SAP
  targets through Cloud Connector

This document records what remains after multi-target v1 and proposes a safe order for future work.
It is deliberately a roadmap, not a specification or authorization to enable writes. Each security
boundary change still needs its own ADR, threat-model update, implementation plan, tests, and
review. The current normative v1 contract remains
[destination-discovered multi-target v1](destination-discovered-multi-target-v1.md).

## Executive Decision

Multi-target v2 should be delivered as a sequence of small, independently reversible pull requests.
It must not be one feature-parity PR.

The recommended progression is:

1. finish v1 evidence, automation, and operational hardening;
2. add target-specific authorization without enabling new tools;
3. add destination write policy and common mutation hardening without enabling writes;
4. validate OAuth scope escalation in every supported MCP client;
5. enable a narrow Principal Propagation-only write beta on existing pinned target URLs;
6. expand read-only parity, fairness, caching, refresh, and controlled execution independently;
7. add transport and Git mutation only after the object-write beta is proven; and
8. keep aggregate writes, shared-Basic writes, SaaS, and non-BTP discovery outside the initial v2
   contract.

The first write-capable design should reuse `/<SYSTEM-OR-ALIAS>/<CLIENT>/mcp`. The URL already binds
the connection to one target and avoids doubling the endpoint count for large landscapes.
`/multi/mcp` remains structurally mutation-free. It must not gain write tools merely because a
`target` parameter exists.

### Dependency overview

The work IDs below are dependency labels, not a demand for one long-lived branch:

| Work | Hard dependencies | Security boundary change |
|------|-------------------|--------------------------|
| V2-00 baseline evidence | #579 | No |
| V2-00B deployment doctor | V2-00 | Read-only operational tooling |
| V2-00C config/DCR hardening | V2-00 | Additive config loading/generation |
| V2-06 read-only parity | V2-00 | No mutation; sensitive metadata gets new opt-ins |
| V2-01 draft write ADR/threat model | V2-00 | Design only; accepted after V2-05 evidence |
| V2-02A target-grant feasibility | V2-01 | Research only |
| V2-02B target-grant implementation | V2-02A | Authorization plumbing, no tools |
| V2-03 destination write policy | V2-01 | Policy plumbing, no tools |
| V2-04 mutation hardening | V2-01 | Hardening only |
| V2-05 OAuth/client spike | V2-01 | Research/prototype only |
| V2-07 fairness/metrics | V2-00 | Operational behavior |
| V2-08 pinned PP write beta | V2-00B/C, V2-02B, V2-03, V2-04, V2-05, V2-07 | Yes |
| V2-09 through V2-11 | Successful V2-08 evidence | Yes, action by action |
| V2-12 memory cache | V2-07; V2-08 before write coexistence | Optional performance boundary |
| V2-13 registry refresh | V2-00B, V2-03; V2-08 before write coexistence | Operational/security state change |
| V2-14 controlled execution | V2-02B, V2-04, V2-07 | Yes |
| V2-15 Admin UI | Dedicated XSUAA session/UI security ADR | Optional new HTTP surface |

## What V1 Already Establishes

The roadmap builds on these implemented properties rather than redesigning them:

| Area | V1 contract |
|------|-------------|
| Discovery | Startup snapshot of subaccount destinations explicitly marked `arc1.enabled=true`. |
| Identity | Strict Principal Propagation per request, or the separate default-off shared Basic exception from ADR-0007. There is never fallback between them. |
| Routes | A pinned route per accepted target and an aggregate `/multi/mcp` route with an explicit `target` argument. Single-target `/mcp` remains independent. |
| Target identity | Real `sap-sysid` and `sap-client` are mandatory. An optional alias changes only the public route ID. |
| Policy | The ARC-1 instance is the ceiling; destination data/SQL properties can only narrow or opt in beneath that ceiling. |
| Authorization | XSUAA is checked before target existence. Global roles grant read/data/SQL/admin capabilities; SAP remains the final per-user boundary under PP. |
| Tool surface | Six mutation-free SAP tools plus aggregate-only `SAPTargets`; readers see the catalog when multiple targets are active, while Admin retains secret-safe diagnostics at zero, one, or many targets. Data and SQL are separately opted in. |
| Safety | Cache none, standard tool mode, UI and plugins off, no write/lock/enqueue operation classes, and no target-access failure cache. |
| Scale guard | At most 256 enabled candidates. Duplicate destination names or public target IDs activate none of their claimants. Physical URL/client/location duplication is additionally quarantined for shared Basic; v1 does not generally collapse PP aliases that reach the same physical client. |
| Operations | Non-secret destination changes require an app restart. Basic User/Password rotation is request-time and secret-safe. |

The beta has manual PP tool evidence on S/4HANA 2023 and 2025, PP setup evidence on SAP Basis 7.50,
multi-client setup on the 2023 system, and multiple XSUAA roles. It is still an experimental
contract until the live evidence and customer acceptance matrix below are complete.

### Evidence carried forward from the v1 beta

This is useful evidence, but much of it was collected manually and must become repeatable before it
is treated as a release gate:

| Area | Evidence already collected | Remaining gap |
|------|----------------------------|---------------|
| PP connectivity | Read/search/system/DDIC smoke tests reached S/4HANA 2023 and 2025 with the propagated SAP user. | Automate failure classification and regression reporting. |
| Same SID/client identity | Independent systems sharing a real SID/client were served through distinct public aliases without changing their SAP identity. | Keep duplicate/alias/remap cases in a permanent acceptance suite. |
| Multiple SAP clients | A second client was created on the 2023/758 system, its user/certificate mapping prepared, and login/client markers verified. | Run the full pinned and aggregate tool matrix against both clients automatically. |
| Basis 7.50 | PP/CERTRULE setup was prepared for NPL client 001. | Record an MCP smoke result and per-operation support/skip evidence alongside 758/816. |
| XSUAA roles | Viewer, Data Viewer, SQL, and Admin role collections and a second human identity were exercised during beta setup. | Automate the complete role/target matrix and token/tool-cache reset cases. |
| MCP clients | Cursor exposed the role-scope caching issue that led to mutation-free PRM advertising of `read data sql admin`. | Repeat pinned/aggregate login and catalog tests in every supported client. |
| Unit/security tests | Registry projection, conflict handling, auth-before-existence, route behavior, PP/Basic separation, schema pruning, and secret-safe diagnostics have focused coverage. | Add a dedicated deployed-CF multi-target integration/E2E suite. |
| Shared Basic | The default-off design, process guard, request-local secret handling, and tests exist. | Complete or explicitly waive live acceptance before changing ADR status. |

## Non-Negotiable Invariants

Every future PR must preserve these rules:

1. **One selected target per SAP call.** The route or validated aggregate argument selects the
   target once. Authentication, policy, runtime construction, audit, and SAP I/O use that same
   immutable target record.
2. **No target enumeration before authentication.** OAuth metadata and challenges may depend on
   route syntax, never on whether a target exists or is active.
3. **No implicit target.** Do not remember a previous target, pick the first target, or infer a
   target from an LLM conversation.
4. **No identity fallback.** PP failure must never fall back to Basic, a technical destination, or
   another user's session.
5. **The instance remains the ceiling.** Destination properties, target grants, and user scopes
   restrict capabilities; none may enable a globally disabled operation.
6. **Basic stays mutation-free.** ADR-0007's shared technical identity is not eligible for object,
   activation, transport, Git, configuration, or execution mutations.
7. **Aggregate stays mutation-free until a separate ADR.** A `target` string alone is not adequate
   wrong-target protection.
8. **No cross-target security/session/cache state.** Cookies, CSRF tokens, locks, feature probes,
   caches, runtime clients, and destination credentials are isolated at the appropriate
   target/user/identity generation. The global semaphore and per-user quota deliberately span all
   targets; future per-target/backend queues are additive fairness controls, not separate ceilings
   that multiply capacity.
9. **No secrets in retained state or output.** Destination credentials, assertions, bearer tokens,
   certificates, and connection details remain absent from registries, logs, audit events, errors,
   `SAPTargets`, cache metadata, and diagnostics.
10. **Unknown security configuration fails closed.** An unrecognized `arc1.*` property cannot be
    silently ignored.
11. **Admin is diagnostic, not omnipotent.** Admin may inspect secret-safe target status, but it
    must not bypass a target grant required for mutation or controlled execution.
12. **Production is not inferred.** ARC-1 must not guess DEV/QAS/PRD from SID, URL, destination name,
    or description. Operators express policy explicitly.
13. **Old deployments remain safe.** With new rollout flags off, the v1 tool surface and behavior
    remain unchanged.

## Complete V1 Deferral Inventory

| Deferred item | Recommendation | Track |
|---------------|----------------|-------|
| Object writes and activation | Add only on pinned PP routes, behind all authorization layers and a narrow action allowlist. | Initial v2 security track |
| Transport mutations | Add after object writes; first close transport-allowlist gaps across every write path. | Later v2 |
| Git mutations | Add last, after repository/remote/credential threat review. | Later v2 |
| Full-write destination sample | Do not publish until the supported mutation set passes live customer acceptance. | Documentation after implementation |
| Per-target ARC authorization | Add exact target/capability grants before customer-grade writes. | Initial v2 prerequisite |
| Persisted per-user availability | Do not cache SAP access failures. Consider only an authoritative external entitlement source in a separate design. | Deferred research |
| API-key and direct Entra/IAS OIDC multi auth | Keep out of the first write release; design equivalent target grants and resource binding first. | Later identity track |
| SaaS and cross-subaccount discovery | Treat as a separate multitenancy program, not a flag on subaccount discovery. | Separate program |
| S/4HANA Public Cloud/SAML assertion targets | Add only after a dedicated identity and live-integration design. | Later identity track |
| Basic over Internet or Private Link | Keep mutation-free and require a separate connectivity, TLS, SSRF, credential, and live-test design. | Later identity/connectivity track |
| Paired design-time/technical destinations | Not required for v2. A future pair may serve metadata maintenance only and must never be a PP fallback. | Deferred |
| Per-target/SID fairness | Add a keyed scheduler and observability before broad customer scale. | v2 operations track |
| Additional SQL governance | Keep outside this roadmap; existing data/SQL gates remain the boundary. | Separate security enhancement |
| Cache modes other than none | Add bounded, target/user-safe memory caching first; SQLite only after an explicit storage design. | v2 performance track |
| Plugins, UI, and hyperfocused mode | Keep disabled until each can preserve target selection, policy, and audit invariants. Hyperfocused mode is not recommended for large landscapes. | Optional later track |
| SAP-backed SAPLint actions | V1 permits only offline `lint`, `lint_and_fix`, and `list_rules`; review `format` and `get_formatter_settings` separately and keep the mutating setter excluded. | Read-only parity |
| ATC and ABAP Unit workload hardening | V1 permits both under the existing read scope and global controls. Add explicit opt-in/grants, cancellation, quotas, and workload controls before broader execution use. | Later execution track |
| Browser target catalog/session UI | Keep `SAPTargets` as the authenticated catalog. No public/session catalog; rendering the same sanitized model behind Admin is optional research. | Optional later track |
| Dynamic destination refresh | Add explicit preview/apply and atomic snapshot replacement; no automatic polling initially. | v2 operations track |
| Write-safe aggregate routing | Requires a new ADR, client interaction evidence, and stronger wrong-target consent. | Research only |

## V2 Capability Model

### Effective authorization lattice

A mutation is permitted only when every layer agrees:

```text
multi-target write rollout flag
  ∩ existing instance SAP_ALLOW_* ceiling
  ∩ destination target policy
  ∩ OAuth functional scope
  ∩ exact target capability grant
  ∩ strict Principal Propagation identity
  ∩ route/action allowlist and SAP_DENY_ACTIONS
  ∩ package/transport safety checks
  ∩ SAP authorization
```

The implementation should return a stable reason code for the first denying layer without revealing
an unknown target to an unauthorized caller. Audit events may include the authenticated subject,
public target ID, policy fingerprint, action, decision layer, and correlation ID, but never tokens or
destination secrets.

### Functional scopes and target grants are different

The existing XSUAA scopes answer “may this person perform writes at all?” They do not answer “on
which target?” Reusing one global `write` role for every system would make every write-enabled
target available to that role and is not sufficient for customer landscapes.

V2 should add an independent, exact capability-bound grant such as:

```text
A4H/100#write
QAS/200#transports
A4H-2025/001#git
```

The exact token representation is deliberately not locked here. The authorization PR must compare:

- XSUAA role attributes or dedicated scopes;
- token and gorouter header size with 100 targets;
- role-collection administration cost;
- the behavior of `@arc-mcp/xsuaa-auth`; and
- a future external entitlement service if XSUAA does not scale acceptably.

Initial grants must be exact—no target wildcards and no inheritance. A single generic list of
systems combined with global write roles is unsafe because independent token attributes can create
an unintended cross-product of targets and capabilities. The Admin scope may inspect target
diagnostics but must still hold the exact target capability for a mutation.

ARC-1 currently expands `admin` to include `write`, `transports`, and `git`, and the XSUAA
verifier retains the expanded result. Multi-target mutation must not mistake that implication for
explicit functional consent. The recommended contract is to preserve verified raw scopes in
`AuthInfo` and require an explicitly granted raw `write`, `transports`, or `git` scope plus
the exact target grant. An Admin token without that raw functional scope remains diagnostic.

The first v2 write release does not need to make read visibility target-specific. Existing global
read/data/SQL roles plus per-user SAP authorization can remain the read boundary. A later
target-specific read grant is useful only when a customer must hide targets before contacting SAP;
if added, `SAPTargets` must filter to authoritative grants rather than probing SAP or remembering
prior successes/failures.

The authorization design must also decide what an exact grant is bound to. Renaming an alias or
changing a destination's physical identity must not silently transfer a capability to an unrelated
target. The V2-01 threat model and V2-02A/B work must define the trust boundary between the XSUAA
administrator and Destination administrator, the binding fields, and explicit re-grant behavior.

If V2-02A chooses token-carried XSUAA attributes, `@arc-mcp/xsuaa-auth` exposes only an opt-in
allowlist from one verified, documented attribute location. If it chooses an external entitlement
source, V2-02B instead needs a fail-closed adapter with bounded caching, revocation/freshness,
availability, tenant, and audit semantics. In either case the authorization ADR chooses one
canonical target/capability encoding. ARC-1 rejects noncanonical values, bounds grant count and value
length, and safely deduplicates only exact duplicates; it must not derive grants from `email`,
`userName`, or a generic extras bag. Raw claims/grants must not be logged or returned by
`SAPTargets`. Token/header testing applies to a token-carried design and covers realistic
one/two-target users plus 16, 64, 100, and worst-case 256 grants—not merely a registry containing
that many targets.

### Destination policy

The destination remains the natural per-target policy location. Proposed first-stage properties are:

```properties
arc1.enabled=true
arc1.allow_writes=true
arc1.allowed_packages=$TMP,ZTEAM*
arc1.allowed_transports=A4HK*
```

Later capabilities may add:

```properties
arc1.allow_transport_writes=true
arc1.allow_git_writes=true
arc1.deny_actions=SAPWrite.delete,SAPTransport.release*
```

Names are provisional until the write ADR is accepted. The parser must have a strict allowlist,
bounded values, normalized package/transport patterns, and stable admin reason codes.

Policy combination is mechanical:

- every boolean capability is a logical AND across rollout, instance, and target layers;
- global and target package/transport allowlists are enforced independently, never unioned;
- global and target deny-action lists are unioned;
- `arc1.deny_actions` may only add validated actions/patterns from the action registry; and
- target configuration can narrow the instance ceiling but never broaden it.

`arc1.allowed_transports` belongs to the first object-write policy even though
`arc1.allow_transport_writes` is deferred: ordinary `SAPWrite` operations can record changes in
a transport. For multi-target writes, an omitted target transport list denies transport-bound
object writes; `$TMP`/local-package work remains possible. Any explicit, auto-resolved, or
lock-correlated transport must pass both the instance and target lists. This is intentionally
stricter than the current single-target meaning of an empty `SAP_ALLOWED_TRANSPORTS` list.

No generic `arc1.config_version` is recommended. V1 already rejects unknown `arc1.*` properties,
and a generic version does not identify which semantic changed. If an incompatible write-policy
format later becomes unavoidable, add a narrow `arc1.write_policy_version`.

When the new binary sees write properties on a PP target but the instance rollout flag is off, the
recommended behavior is to keep the target active as read-only, report effective writes as false to
admins, and log one warning per snapshot. A Basic target with any mutation property is always
quarantined. A v1 binary will safely quarantine either destination as
`UNSUPPORTED_V1_WRITE_CONFIG`; the rollback runbook must therefore remove write properties before
rolling the binary back to v1.

The existing `$TMP` default may remain when `arc1.allowed_packages` is omitted, matching
single-target behavior. Customer documentation should strongly recommend an explicit package list.
An empty or malformed package list fails closed.

### Instance rollout controls

The first implementation should require a new default-off multi-target write rollout flag in
addition to the existing `SAP_ALLOW_WRITES`. Transport and Git continue to require their existing
independent instance flags. The final flag name belongs in the ADR/config PR; using a separate flag
allows immediate rollback without changing every destination.

The write rollout flag implies target-grant enforcement. Startup must refuse multi-target writes if
the canonical grant verifier or raw-scope evidence is disabled/unavailable; there is no supported
“writes on, target grants off” combination.

The effective order is:

1. deploy the v2-capable binary with all new rollout flags off;
2. configure target grants;
3. add target destination policy;
4. inspect `SAPTargets` as Admin and run the read-only acceptance suite;
5. enable the instance rollout flag and restart;
6. force MCP clients to discard cached tools/tokens and authenticate again; and
7. enable one non-production target/package before widening the rollout.

### Initial mutation allowlist

The first write beta should expose only:

- selected `SAPWrite create` actions for well-tested repository object types;
- selected `SAPWrite update` and method/include editing actions;
- `SAPActivate(action=activate)` for the same allowed package boundary.

It should initially exclude:

- delete and batch delete;
- `SAPWrite.delete_method`, which is destructive even though its current internal operation class
  is Update;
- package create/move/delete;
- batch creation until per-item target/package/transport checks are proven;
- `SAPActivate(action=publish_srvb)` and `SAPActivate(action=unpublish_srvb)`;
- API publication/revocation and other `SAPManage` mutations;
- transport create/release/reassign operations;
- Git push/pull/clone/branch-changing operations;
- FLP, SQL-trace, and system-global settings; and
- plugin execute/raw writes.

Expansion is action-by-action. Tool membership or an internal operation class alone is not an
adequate write allowlist.

## Routing, OAuth, and LLM Target Confidence

### Reuse the pinned route

Pinned routes already give one MCP connection a stable target. V2 should not introduce a parallel
`/<TARGET>/<CLIENT>/write/mcp` tree unless client interoperability proves that the existing route
cannot safely negotiate scopes.

Pinned write tools receive no additional `target` parameter. Instead:

- server instructions and tool descriptions state the bound target ID and description;
- every SAP-contacting result and error includes the public target ID;
- audit records include the target ID, real SID/client, registry/policy revision, and secret-safe
  connection fingerprint—the target is immutable only within that registry revision;
- pinned mutation tools are listed only for PP targets when rollout, instance ceiling, target
  policy, explicit raw functional scope, exact target grant, and action allowlist all permit them;
- direct calls repeat that full lattice because client-cached tool catalogs are advisory;
- Basic never lists or dispatches a mutation; and
- destructive operations remain absent until a separate confirmation design is proven.

Descriptions are human/LLM labels only. They never participate in authorization.

Reusing the route does not remove the client-side cost: each writable pinned URL is a separate MCP
server connection with its own OAuth/DCR/tool-catalog lifecycle. The aggregate route remains the
single-connection answer for read-only access to a 100-system catalog. Client acceptance and
documentation must test the intended number of simultaneously configured writable targets rather
than assume that all 100 pinned URLs are practical in every client.

### OAuth scope escalation

V1's protected-resource metadata advertises the complete mutation-free set
`read data sql admin`, and XSUAA returns only the user's assigned subset. Adding mutation scopes to
that eager set would be a material security change.

Today, HTTP authentication completes before JSON-RPC dispatch. A missing tool scope becomes an MCP
tool error; ARC-1 does not yet turn it into an HTTP 403 challenge that can reauthorize a client.
Runtime step-up is therefore a hypothesis that V2-05 must prototype in both the server transport/SDK
and clients, not an available behavior.

The preferred outcome, if that prototype is interoperable, is:

1. keep aggregate metadata mutation-free;
2. use registry-independent metadata for any syntactically valid pinned route;
3. on a write call without the required functional scope, return RFC 6750-style
   `insufficient_scope` information and let the client reauthorize; and
4. require both the functional scope and exact target grant after reauthorization.

Before implementation, the client spike must verify this behavior with VS Code, GitHub Copilot,
Cursor, Claude, and Copilot Studio. MCP clients cannot be assumed to honor runtime scope escalation
or `notifications/tools/list_changed`.

If runtime escalation is not interoperable, the fallback is a fixed, registry-independent mutation
scope set on pinned-route metadata only. XSUAA still grants only assigned scopes. The aggregate
route and Copilot aggregate alias must never advertise mutation scopes. A separate write URL is the
last fallback, not the default architecture. RFC 8707 resource indicators and canonical route URLs
must not be treated as target authorization unless XSUAA is proven to bind and validate the token
for that exact resource; exact target grants remain authoritative.

### Wrong-target protection

The initial beta reduces wrong-target risk through a pinned URL, exact target grant, explicit target
identity in the model surface, an allowlist that excludes delete/release/Git, package gates, and SAP
authorization. It does not add a target argument to every pinned tool.

Before enabling delete, transport release, Git mutation, or aggregate writes, decide whether the
clients reliably support:

- form elicitation with an exact target/action confirmation;
- a short-lived, target-bound consent token;
- OAuth step-up tied to the canonical target resource; or
- a separate administratively provisioned high-risk endpoint.

Elicitation is a user-experience safeguard, never authorization. Any future consent token must be
server-minted, single-use, short-lived, and bound to the verified subject/client, canonical target,
action/input hash, and registry revision. It does not make aggregate writes safe by itself.

Conversation memory or a server-side “last target” value is never acceptable consent.

## Parallel V2 Workstreams

### 1. Read-only tool parity

Read parity has high value and does not need to wait for write support, but it still requires
action-level review:

| Tool | Candidate v2 actions | Excluded until separate review |
|------|----------------------|--------------------------------|
| `SAPLint` | V1 already has offline `lint`, `lint_and_fix`, and `list_rules`; v2 may review `format` and `get_formatter_settings` | `set_formatter_settings` |
| `SAPTransport` | V1 already has `list`, `get`, `check`, and `history`; v2 may review `layers` and `targets` | create, release, reassign, delete, remove-object actions |
| `SAPManage` | cached `features` initially; selected FLP reads only after data review | `probe` as ordinary Viewer work, `cache_stats` before cache exists, and package/API/FLP/global mutations |
| `SAPGit` | `list_repos`, `whoami`, `config`, `branches`, `history`, `objects`, `check`, after backend/output review | `external_info` pending SSRF/credential review and every remote/credential-changing action |

The registry should derive schemas from one explicit multi-target action table so list-time pruning
and call-time enforcement cannot diverge. Sensitive transport/Git metadata should be default-off
behind explicit instance and target opt-ins, especially for shared Basic. Review `SAPGit.config`
for secrets and test aggregate union schemas where one target supports/allows an action and another
does not. `SAPManage.probe` belongs to authenticated Admin maintenance because it creates backend
load and changes shared feature state.

### 2. Controlled execution

V1 exposes ATC and ABAP Unit through the existing `read` scope and global rate/concurrency controls.
They are not simple reads even when they do not persist repository content: they consume SAP work
processes, may create worklists/results, and can be expensive across 100 systems.

V2 should replace that compatibility-oriented baseline with a separate, PP-only and
pinned-route-only controlled-execution capability with:

- an instance opt-in and per-target opt-in;
- a required explicit execution scope and exact target execution grant;
- package/object bounds;
- lower concurrency and timeout limits;
- cancellation and stable retry semantics;
- audit start/end/duration/result-size fields; and
- per-target quotas.

ATC should precede ABAP Unit because its worklist behavior and operational impact can be measured
separately.

### 3. Fair scheduling and observability

The global semaphore prevents target count from multiplying concurrency inside one process, but one
busy target can still monopolize it. Start with per-target fairness. Group targets only by a
validated, secret-safe connectivity identity (for example virtual URL plus Cloud Connector location)
or an explicit operator override—never by SID, because independent systems may reuse it. Define a
new hashed backend-scheduling key that excludes SAP client and authentication; do not reuse
`TargetDescriptor.connectionFingerprint`, which includes the client. State/session/cache isolation
continues to use target/client/user keys:

- retain a hard global maximum;
- add per-backend queues or reservations;
- let target config lower, never raise, its limit;
- group aliases/clients that share one backend where appropriate;
- bound queue length and waiting time;
- add centrally defined, bounded operation weights so a metadata read, object write, ATC/Unit run,
  and Git job do not all consume one identical quota point;
- expose secret-safe queue, latency, error, and PP-resolution metrics; and
- audit rejection/timeout decisions.

Recommended starting values remain operational guidance, not automatic formulas. Measure SAP dialog
work processes, request duration, concurrent users, and CF instance count before raising
`ARC1_MAX_CONCURRENT`. Fairness, rate limits, and queues are process-local unless a later shared
service says otherwise. With PP scale-out, aggregate potential SAP concurrency is approximately
`instance count × per-instance cap`; sizing guidance must make that multiplication explicit.

### 4. Request-driven cache

V1's `none` mode remains safest. If measurements justify caching, implement bounded in-memory
caching first with an explicit cache-class policy:

- source entries include target/fingerprint, client, object, and version, and may be reused only
  after mandatory conditional revalidation under the current caller;
- inactive and authorization-sensitive state is additionally keyed by verified user identity;
- authorization failures and per-user target availability are never cached;
- data/SQL results are not cached in the first multi-target cache PR;
- PP dependency payload caching remains disabled until independently proven safe;
- a technical/prewarm identity never populates content later served to PP users;
- use per-target and global byte/entry limits, TTL, and LRU eviction;
- invalidate on writes, target policy/destination fingerprint changes, and registry replacement;
- preserve ETag/revalidation behavior;
- expose only counts/ages in diagnostics; and
- prove parallel-user/target isolation.

Memory state and invalidation are local to one CF instance. When writes and multiple PP instances
coexist, every source hit must still revalidate with SAP; local invalidation alone is insufficient.
SQLite comes later. CF local disk is ephemeral and instance-local, and cached ABAP source is
sensitive. A SQLite design needs encryption/permissions, schema migration, quota, crash recovery,
multi-instance semantics, and an explicit data-retention decision.

### 5. Controlled destination refresh

Do not begin with automatic polling. Add an authenticated Admin operation that:

1. fetches a complete candidate set;
2. validates every entry and computes conflicts/limit status;
3. returns a secret-safe preview and revision;
4. applies only with an explicit revision match;
5. atomically swaps one immutable registry snapshot;
6. lets in-flight requests finish on the previous snapshot;
7. invalidates changed runtime/features/cache state; and
8. emits one audit event with old/new revision and counts.

The current Basic credential-generation guard is process-local and keyed by public target. Refresh
must not let alias rename/remove/re-add reset lockout protection or exhaust its bounded 256-target
state. Before Basic refresh is supported, derive a stable physical security key independent of
alias, preserve blocked generations across snapshot changes for a safe TTL, and retire state only
under explicit bounds. HTTP routing also needs a registry-holder indirection; capturing one static
registry at startup cannot implement atomic replacement.

This flow is safe only for one CF instance. A multi-instance PP deployment instead needs a shared
desired revision, coordinated apply, and readiness that succeeds only after every serving instance
has the same revision. Until that exists, controlled refresh must refuse multi-instance operation;
an Admin call routed to one arbitrary instance must never create divergent registries behind the
gorouter.

Revoking write policy in a new snapshot blocks new calls after apply, but a write already authorized
against the previous immutable snapshot may complete. The operational contract and audit revision
must make that explicit.

Clients should keep stable pattern schemas and reconnect after refresh. Optional
`tools/list_changed` notifications may improve capable clients but cannot be required for safety.

### 6. Identity expansion

Direct OIDC/API-key multi-target support must reproduce the same functional scope, target-grant,
resource binding, revocation, and audit properties as XSUAA. It cannot map “authenticated” to all
targets. In the current model an API key cannot drive Principal Propagation; it could reach only the
shared-Basic read-only path unless a new per-user identity/credential mapping is designed. It is not
a shortcut to writes. S/4HANA Public Cloud needs a separate SAML assertion/PP integration and live
tests.

Shared Basic remains read-only. High availability for even read-only Basic requires an external
atomic generation/lockout store with TTL and compare-and-set semantics; otherwise exactly one
non-rolling instance remains mandatory. V1 cannot reliably infer the desired CF scale at runtime;
this is currently an MTA/operator contract. A deployment doctor with CF access should verify desired
and running instances, and any mixed PP+Basic registry inherits the Basic one-instance constraint.

### 7. Optional UI, plugins, and hyperfocused mode

An authenticated admin UI could eventually render the same sanitized catalog as `SAPTargets`, but
it must not become a second policy source or public catalog. Plugins need declared per-action
capabilities and the same selected-target runtime; no plugin may receive raw destination objects.

Hyperfocused mode remains unsupported and is not recommended for large landscapes because one
generic tool reduces target/action clarity. Revisit only with measured token savings and equal
wrong-target safeguards.

### 8. SaaS and subscriber isolation

SaaS is a separate architecture program. It needs SAP SaaS Provisioning lifecycle callbacks, shared
XSUAA tenant handling, subscriber-aware destination resolution, tenant-qualified registry/cache/rate
keys, tenant audit and quotas, offboarding, and cross-tenant leakage tests. Subaccount-only discovery
must not be generalized into provider/subscriber discovery by adding a broad flag.

Non-BTP multi-system deployments should continue to use separate ARC-1 instances behind an MCP hub.

### 9. Deployment and configuration tooling

The beta showed that most operator errors occur before the first MCP call: missing role
collections, wrong Destination properties, unstable DCR secrets, stale client tokens, or a CF
setting that conflicts with the multi-target contract. Reduce that risk without creating a second
configuration source:

- add a secret-safe `arc1 doctor`/validation command or equivalent deployment check for service
  bindings, XSUAA role collections, instance count, required flags, Destination candidates,
  conflicts, PP/Basic prerequisites, and advertised URLs;
- provide a dry-run mode that reports the same reason codes as Admin `SAPTargets` without printing
  destination credentials;
- generate destination-property documentation, parser fixtures, and examples from one typed
  contract where practical so Cockpit, CLI, tests, and docs cannot drift;
- provide repeatable role-collection creation/check steps instead of assuming that every template
  has a collection;
- support a bound/file-backed `ARC1_DCR_SIGNING_SECRET` so redeployments do not invalidate client
  registrations and the secret does not need to live in plain MTA overrides;
- publish provenance/reproducible-build guidance for customers who currently build their own MTAR;
  a signed release MTAR is a separate release-engineering decision, not a requirement for the write
  architecture; and
- make destination export/import examples safe by clearly separating non-secret configuration from
  credentials and certificates.

The doctor diagnoses and recommends; it must not silently create role assignments, rewrite
destinations, enable writes, or contact SAP with a technical fallback identity.

## Prioritization

| Work | User value | Security/complexity | Recommendation |
|------|------------|---------------------|----------------|
| V1 evidence and automated CF acceptance | High | Low–medium | Do first |
| Deployment doctor/config contract | High | Low–medium | Do before customer scale |
| Read-only tool parity | High | Low–medium | Early v2 |
| Exact target grants | Critical for writes | High | Prerequisite |
| Per-backend fairness/metrics | High at 100 targets | Medium | Before broad rollout |
| Pinned PP object writes | High | High | Narrow beta after prerequisites |
| Activation and destructive object actions | High | High | Expand gradually |
| Transport writes | Medium–high | High | After object-write evidence |
| Git writes | Medium | Very high | Last mutation track |
| Request-driven memory cache | Medium | Medium–high | Only after measurement |
| Dynamic refresh | High operational value | Medium–high | After stable snapshot metrics |
| Hardened ATC/Unit execution | Medium | Medium–high | Independent opt-in track |
| Aggregate writes | Convenience | Very high | Research only |
| Basic writes | Low | Critical | Reject |
| SaaS/cross-subaccount | Potentially high | Very high | Separate program |

## Proposed Pull Request Work Packages

Each PR should start from the latest main after #579 merges, keep new behavior default-off, and be
mergeable without the next PR. The numeric IDs group dependencies; independent work such as V2-06
may land earlier. Avoid a long-lived stacked beta branch.

### V2-00 — Stabilize the v1 baseline

**Goal:** turn the existing beta evidence into a repeatable gate.

**Work:**

- complete live shared-Basic acceptance or retain it as explicitly unverified;
- reconcile ADR-0006/0007 status with actual evidence;
- add a dedicated CF multi-target acceptance harness;
- record the tested 7.50/758/816 and multi-client fixtures;
- add secret scans and structured log assertions; and
- preserve the current customer rollback/runbook evidence.

**Acceptance:** one command/report distinguishes unit, simulated BTP, and live SAP coverage. No
capability change.

**Rollback:** documentation/test-only; production behavior unchanged.

### V2-00B — Implement the deployment doctor

**Goal:** detect the configuration mistakes observed during beta before a customer connects an MCP
client.

**Likely code:** `src/cli.ts`, `src/cli-args.ts`, shared destination validation/projection
helpers, and deployment-focused tests.

**Work:** add a strictly read-only multi-target doctor that checks bindings, effective instance
flags, advertised URL, XSUAA role-collection existence, desired/running CF instance count when that
API is available, Destination candidates/conflicts/limit, PP/Basic prerequisites, and restart/tool
cache requirements. It emits the same stable reason codes as Admin `SAPTargets` without exposing
secrets and never creates roles, changes a destination, enables a flag, or contacts SAP through a
fallback identity.

**Acceptance:** deterministic fixtures plus a CF/BTP smoke cover missing Viewer/Data/SQL/Admin role
collections, zero/two Basic instances, bad bindings, unknown properties, duplicate/257 candidates,
wrong public URL, and unavailable control-plane APIs. Output, logs, and exit diagnostics pass secret
scanning.

**Rollback:** remove/disable the additive command; server runtime behavior is unchanged.

### V2-00C — Harden the configuration contract and DCR secret

**Goal:** prevent Cockpit/CLI/docs/parser drift and make client registrations survive safe
redeployments.

**Work:** derive destination field reference/examples/parser fixtures from one typed contract where
practical; add bound/file-backed `ARC1_DCR_SIGNING_SECRET` loading with permission and rotation
guidance; and document reproducible customer MTAR provenance. A signed release MTAR remains a
separate release-engineering decision.

**Acceptance:** generated artifacts have drift tests; bound/file precedence and rotation are
test-covered; redeploy preserves valid DCR registrations; unreadable/empty secret material fails
closed; no secret enters MTA examples, logs, or build artifacts.

**Rollback:** retain the existing explicit environment-variable path; no automatic secret migration.

### V2-01 — Draft the write ADR and threat model

**Goal:** draft the authorization lattice, route choice, identity boundary, initial action
allowlist, OAuth alternatives, audit contract, and rollback order before prototyping.

**Work:** update ADR-0005/0006 or supersede the mutation section with a new ADR; threat-model
confused-deputy, target alias, stale registry, token replay, role-attribute cross-product, client
catalog caching, PP failure, transport escape, and rollback scenarios. Treat audit delivery as a
security decision rather than assuming the current best-effort sinks are sufficient: define
pre-attempt and outcome events, their correlation and ordering, bounded retry/queue behavior,
process-crash semantics, and whether a missing, unavailable, or backpressured BTP Audit Log binding
makes customer writes fail open or fail closed.

**Acceptance:** security review approves the threat model and PP-only/pinned direction, explicitly
leaves aggregate and Basic mutation out, and locks the Destination-admin/role-admin trust assumption
or a stable authorization identity/re-grant workflow. Alias recycling, backend repointing,
destination rename, and stale-token cases are covered. OAuth behavior remains a recorded choice
between alternatives until V2-05 evidence finalizes and accepts the ADR. The ADR also records the
approved audit availability contract and whether a healthy BTP Audit Log binding is a prerequisite
for enabling writes.

**Rollback:** no runtime change.

### V2-02A — Prove target-grant feasibility

**Goal:** determine whether XSUAA or a fail-closed external entitlement source can represent and
administer exact dynamic target/capability grants at ARC-1's supported landscape sizes.

**Work:** compare role attributes, dedicated scopes, and an external entitlement source; measure
real XSUAA token and gorouter header behavior for one/two, 16, 64, 100, and worst-case 256 grants;
prototype role-collection maintenance; define canonical encoding; and settle alias/physical
identity binding plus the Destination-admin/role-admin trust boundary.

**Acceptance:** one representation has documented size limits, administration workflow, stale-token
behavior, rename/repoint behavior, and failure semantics. If none is viable, do not implement
in-process multi-target writes; retain separate instances/hub routing.

**Rollback:** research/prototype only.

### V2-02B — Add exact target grants

**Goal:** authorize target/capability pairs without enabling writes.

**Likely code:** always `src/server/http.ts`, `src/authz/policy.ts`,
`src/server/multi-target-server.ts`, and `@arc-mcp/xsuaa-auth` (or an explicitly chosen equivalent
verifier) so ARC-1 retains verified raw functional scopes before Admin implication. If V2-02A
selects token-carried XSUAA grants, also `xs-security.json` and bounded target-grant claim
extraction in the auth package; if it selects external entitlements, add a narrow entitlement
adapter/client instead and do not invent equivalent target-grant token claims.

**Work:** implement exact matching, raw functional scope retention, reason codes, and audit. For a
token-carried design, add bounded canonical claim extraction and role-collection administration
examples. For an external-entitlement design, add fail-closed lookup, bounded freshness/cache,
revocation, availability, tenant binding, and circuit-failure behavior. Prevent Admin bypass and
capability cross-products in either branch.

**Acceptance:** exhaustive target A/B and capability read/write matrix, including forged,
duplicate, oversized, missing, and malformed claims or entitlement responses according to the
chosen branch. Both branches prove explicit raw functional scope can be distinguished from Admin
implication. With enforcement disabled, v1 behavior is observably unchanged at the HTTP/tool
surface.

**Rollback:** before writes exist, this code is behaviorally inert and may be rolled back without
destination changes. Once V2-08 exists, multi-target writes must imply target-grant enforcement and
startup must refuse writes when its verifier is disabled/unavailable. Turn writes off on every
instance before removing or rolling back grant enforcement.

### V2-03 — Parse destination write policy without exposing writes

**Goal:** add the target policy model and diagnostics while keeping every multi-target runtime
mutation-free.

**Likely code:** `multi-target-destination-config.ts`, `destination-registry.ts`,
`multi-target-catalog.ts`, `multi-target-runtime.ts`, and focused registry tests.

**Work:** add strict write/package properties, effective-policy fingerprint, rollout-off warning,
Basic quarantine, conflict behavior, bounds, and admin output. Do not retain raw properties.

**Acceptance:** malformed/unknown settings fail closed; rollout-off targets remain readable in the
new binary; Basic plus any mutation property is rejected; v1 binary rollback behavior is
documented.

**Rollback:** remove write properties before rolling back to a v1 binary.

### V2-04 — Harden common mutation safety

**Goal:** close single-target safety gaps before reusing handlers from multi-target routes.

**Work:**

- enforce `allowedTransports` for every `SAPWrite` path that accepts a transport, not only
  `SAPTransport`;
- verify real-package checks for create/update/activate/include/batch paths;
- detect physical overlap between independent `/mcp` and discovered targets; keep current
  read-only coexistence with a warning, but make the discovered target ineligible for multi-target
  writes whenever the independent `/mcp` is writable, regardless of whether policies look equal;
  do not silently disable or alter `/mcp`;
- detect discovered PP destinations that claim the same physical URL/client/Cloud Connector
  location under different public aliases; if any claimant requests writes, make every claimant
  write-ineligible (or quarantine all of them) regardless of equal/different policy so another alias
  cannot bypass grants or create ambiguous audit identity;
- make lock/session cleanup target-safe under failure and cancellation;
- plumb a caller `AbortSignal` end to end from MCP/HTTP transport through dispatch, handler, ADT
  request, and stateful-session cleanup; cancellation is not currently a guaranteed end-to-end
  capability;
- require the complete mutation lattice before CSRF acquisition, lock, or enqueue; no lock action
  is exposed to a caller, and the current internal read classification for lock cannot authorize a
  multi-target mutation by itself;
- add target/policy revision to mutation audit events; and
- verify action-level deny rules cover direct unlisted calls.

**Acceptance:** mutation tests independently fail every safety layer and prove no CSRF, lock,
enqueue, or modifying ADT request was sent. Overlap tests cover equal/different policies, aliases,
the same URL/client/location, and document alternate undetectable URLs as a privileged
Destination-administrator risk. Discovered-PP duplicate tests cover equal/different policies,
one-write/one-read, two-write, and aliases. Disconnect/cancel tests prove SAP requests stop where
possible and locks/sessions are released deterministically.

**Rollback:** hardening stays valid for single-target deployments.

### V2-05 — OAuth and MCP-client interoperability spike

**Goal:** choose runtime step-up, eager pinned scopes, or—only if unavoidable—a separate write URL.

**Clients:** VS Code/GitHub Copilot, Cursor, Claude, and Copilot Studio.

**Acceptance:** capture initial login, token scopes, tools/list refresh, insufficient-scope behavior,
reauthorization, logout/token-cache reset, Admin-implied versus explicit raw mutation scope, and
aggregate isolation. Prove whether the server transport/SDK can issue a standards-compliant
reauthorization challenge after a tool call. The result finalizes V2-01 before write code is
exposed.

**Rollback:** no production feature enabled.

### V2-06 — Add mutation-free tool parity

**Goal:** extend the v1 offline-SAPLint/read-only-transport baseline with reviewed SAP-backed
SAPLint, transport-topology, SAPManage, and SAPGit read actions.

**Scheduling:** this can land directly after V2-00 and in parallel with V2-01–V2-05. It is not
blocked by write authorization.

**Work:** retain v1's explicit action registry for schemas, list pruning, call enforcement, and
tests. Keep additional controlled execution and every state-changing action out. Add explicit
instance/target opt-ins for sensitive transport/Git metadata.

**Acceptance:** every listed action is callable, every omitted action is rejected even by direct
tool call, aggregate schemas remain safe across different target policies, and Basic/PP expose only
explicitly opted-in ARC-level surfaces subject to SAP authorization.

**Rollback:** per-tool rollout switches or one parity flag; the v1 action allowlists remain.

### V2-07 — Add fair scheduling and metrics

**Goal:** prevent one backend or client from monopolizing a 100-target instance.

**Acceptance:** deterministic load tests cover aliases, two clients on one SID, slow/failing targets,
queue overflow, cancellation, and multiple PP users. Global limits cannot be multiplied by target
count inside a process; two-instance tests measure the expected multiplication across processes.
Publish sizing guidance based on active users, SAP dialog work processes, request duration, and CF
instance count. Weight tests prove expensive execution/Git work consumes the configured shared
budget without creating a per-target capacity multiplier.

**Rollback:** switch to the existing global semaphore.

### V2-08 — Enable pinned PP object-write beta

**Goal:** expose the narrow initial `SAPWrite` create/update subset plus only
`SAPActivate(action=activate)` on existing pinned routes.

**Prerequisites:** V2-00B/C, V2-01, V2-02A/B, V2-03, V2-04, V2-05, and V2-07. Fair scheduling and
metrics are a hard prerequisite even for the beta, not only for later broad rollout.

**Work:** require the full authorization lattice, construct only per-request PP runtimes, generate
target-specific tools/instructions, invalidate target/user state after successful writes, and emit
correlated pre-attempt and outcome audit decisions under the availability contract chosen in
V2-01. Never send the modifying SAP request if a required pre-attempt event cannot be accepted.

**Acceptance:** live create/update/activate sequences in explicit `$TMP`/Z packages on 7.50, 758,
and 816 where supported, with cleanup performed by a named trusted test-admin path until delete is
part of the allowlist; two clients of one SID; two users with different target grants; parallel
cross-target writes; PP mapping loss; explicit/auto-resolved/lock-correlated wrong transports; wrong
package; stale policy; and restart/rollback. No Basic or aggregate mutation tool appears or
dispatches. Audit tests cover an unavailable binding, backpressure, retry exhaustion, recovery,
process termination between attempt and outcome, correlation without secret leakage, and the exact
fail-open/fail-closed behavior approved by the ADR.

**Rollback:** turn off the multi-target write rollout flag and restart. Reads remain available.

### V2-09 — Expand `SAPWrite` action coverage incrementally

**Goal:** add the remaining object-write actions only after beta evidence.

**Work:** first expand V2-08's narrow `create`/`update` object-type matrix only with per-type live
evidence. Then evaluate every remaining current `SAPWrite` action separately: `delete`,
`edit_method`, `edit_unit`, `edit_class_definition`, `add_method`, `edit_method_signature`,
`delete_method`, `change_method_visibility`, `edit_text_symbols`, `batch_create`,
`scaffold_rap_handlers`, and `generate_behavior_implementation`. Derive a CI checklist from the
action registry so later actions cannot become unowned. Each action needs an explicit
target-confirmation decision, dependency checks, real-package and transport enforcement, audit,
and its own rollback switch. This PR family does not silently inherit mutating actions from
SAPActivate, SAPManage, SAPDiagnose, or SAPLint; those are owned by the backlog below.

**Acceptance:** inactive/active state, dependent-object failures, mixed batch
packages/transports/object types, injected target-field rejection, client cache refresh,
cancellation, and idempotent retry are covered live. A pinned batch never accepts per-item targets.

**Rollback:** action-level feature switches or deny rules.

### V2-10 — Add transport mutation action by action

**Goal:** reach reviewed transport-mutation parity only after transport allowlists are universally
enforced.

**Work:** begin with `create`; then review and enable `release`, `release_recursive`, `reassign`,
`delete`, and `remove_object` separately. Every action requires the exact target transport grant,
instance and target opt-ins, transport pattern validation, target-bound confirmation where the
operation is destructive or irreversible, and SAP authorization evidence. Release variants also
require inactive-object preflight; ownership changes and request/object removal need independent
policy and recovery tests.

`create` needs its own pre-mutation rule because SAP chooses the new request ID only after POST, so
`arc1.allowed_transports` cannot authorize that ID in advance. The recommended first increment
allows only a package-driven route whose package passes both instance and target allowlists, and
rejects caller-supplied `target` and `transportLayer`. A later increment may accept either override
only after adding exact target/layer allowlists and validating the value before POST. The ADR must
also decide whether a restrictive request-ID allowlist can prove the generated namespace in
advance; a post-create ID check is never authorization and cannot undo the mutation.

**Acceptance:** every enabled action has wrong-target/package/transport, authorization, retry,
partial-failure, and rollback tests. Recursive release, inactive objects, recursive reassignment,
request deletion, object removal, and unsupported 7.50 endpoints are covered where applicable.
Create tests prove `target`/`transportLayer` are refused before any SAP request until their exact
allowlists exist, and that no generated-ID post-check is treated as consent. An action absent from
the rollout allowlist is neither listed nor dispatchable. Aggregate and Basic remain excluded.

**Rollback:** disable target and instance transport flags.

### V2-11 — Add Git mutation

**Goal:** add only explicitly reviewed gCTS/abapGit mutations.

**Work:** threat-model remote URLs, SSRF, credential sources, repository scope, branch/ref changes,
large operations, cancellation, and rollback. Define instance/target Git policy for allowed URL
schemes, hosts, and repositories before accepting remote input. Clarify which requests are fetched
by ARC-1 versus by the SAP backend: an ARC-side network guard cannot prevent SAP-side access to a
private host. Never reveal remote credentials to the model.

**Acceptance:** allowlisted remotes/repositories, denied private-network pivots, audit, timeout, and
partial-failure recovery are proven under that explicit policy, including SAP-side remote-fetch
behavior.

**Rollback:** disable Git globally and per target.

### Higher-impact mutation backlog

The action registry contains additional write-classified operations that must not become available
merely because an entire tool is added for read parity. Each row owns a future decision so no
mutation is hidden behind “other actions”:

| Action family | Disposition and required first PR |
|---------------|-----------------------------------|
| `SAPActivate.publish_srvb` / `unpublish_srvb` | Separate pinned-PP service-exposure PR after V2-08; require an exact target write grant, target policy, package check, explicit exposure confirmation, and publish/unpublish recovery tests. |
| `SAPManage.create_package` / `delete_package` / `change_package` | Separate package-administration PR after V2-09; define parent-package, software-component, transport-layer, move, dependency, and rollback policy. Do not infer permission from general object writes. |
| `SAPManage.set_api_state` | Separate clean-core API-publication PR; bind contract/visibility decisions to the selected target and require package/release-state evidence plus an exact action grant. |
| `SAPManage.flp_create_*`, `flp_add_tile_to_group`, `flp_delete_catalog` | Keep deferred until a dedicated FLP/OData mutation threat model covers IDs, overwrite/delete semantics, CSRF, target policy, and recovery. |
| `SAPDiagnose.apply_quickfix` | This currently returns proposed deltas rather than persisting source, but is classified `Update`; add only in a focused PP-pinned PR that proves no hidden state change and preserves the raw-write lattice before a later `SAPWrite` persists anything. |
| `SAPDiagnose.trace_start` / `trace_cancel` | Separate diagnostic-control PR after V2-14; treat armed traces as target-global state with exact execution/operations grants, ownership, expiry, cancellation, quota, and cleanup. |
| `SAPDiagnose.set_sql_trace_state` | Keep out of general v2 writes. It flips target-level ST05 state across instances and needs a dedicated privileged-operations ADR, collision/ownership model, auto-disarm, and recovery. |
| `SAPLint.set_formatter_settings` | Keep out of multi-target v2 unless a customer use case appears; it changes global PrettyPrinter settings and is not required for source lint/format workflows. |
| Plugin execute/raw writes | Keep prohibited. A future extension-capability ADR must preserve selected-target construction, operation classification, allowlists, SSRF controls, and audit without exposing raw destinations. |

None of these rows is enabled by V2-08, V2-09, or tool-level schema parity. Each future PR must add
the exact action to schemas, listing, direct-call enforcement, tests, documentation, and an
action-level rollback switch together.

### V2-12 — Add bounded in-memory cache

**Goal:** improve repeated reads without weakening PP isolation.

**Prerequisites:** V2-07 for bounds/metrics. A read-only cache may be prototyped earlier, but it must
refuse multi-target write coexistence until V2-08 write invalidation and mandatory caller
revalidation are proven.

**Acceptance:** target/user/client/package isolation, write invalidation, policy revision changes,
memory pressure, eviction, mandatory caller revalidation, and multi-instance behavior are covered.
Data/SQL, auth failures, and PP dependency payloads remain uncached.

**Rollback:** set cache to `none`; no persisted migration.

### V2-13 — Add controlled registry refresh

**Goal:** add destinations without app restart while preserving immutable routing.

**Prerequisites:** V2-00B and V2-03. A read-only refresh may be implemented first, but it must refuse
write-capable operation until V2-08 old-snapshot/invalidation behavior is proven. Basic additionally
requires the stable physical guard key described above.

**Acceptance:** preview/apply race, duplicate/257-entry failure, changed identity mode, removed target,
alias rename/remove/re-add, Basic guard retention/bounds, in-flight old-snapshot write, client
reconnect, and audit revision tests. It either refuses more than one instance or proves shared
desired-revision coordination and readiness across every instance.

**Rollback:** disable refresh and return to startup snapshots.

### V2-14 — Add controlled execution

**Goal:** move the v1 ATC/ABAP Unit baseline behind independent workload controls and, after client
compatibility review, restrict controlled execution to pinned PP routes.

**Prerequisites:** V2-02B exact execution grants, V2-04 end-to-end cancellation, V2-07 weighted
scheduling/quotas, and a per-target execution-policy addition with the same strict parser rules as
V2-03.

**Acceptance:** quotas, cancellation, timeout, result bounds, worklist cleanup, SAP authorization,
and noisy-neighbor tests. If aggregate and Basic execution is removed, document and test the
migration/compatibility behavior before changing the v1 surface.

**Rollback:** disable execution without changing read/write policy.

### V2-15 — Optional authenticated administration surface

**Goal:** only if operators need it, render sanitized `SAPTargets` diagnostics behind Admin auth.

**Prerequisite:** a dedicated XSUAA browser-session, CSRF, authorization, and UI security ADR. V1
structurally forces UI off in multi-target mode; this PR must not weaken that guard before the new
surface is approved.

**Non-goals:** no public catalog, no browser cookie-auth bypass, no second configuration database,
and no destination secret display.

## Unscheduled Backlog

These items are intentionally not inserted into the write-critical path. Each begins with a small
ADR/research PR when its trigger is real:

| Item | Trigger and prerequisites | First future PR | Explicit non-goal |
|------|---------------------------|-----------------|-------------------|
| Target-specific read visibility | Customer must hide configured targets before SAP contact; V2-02A grant representation scales | Define exact `#read` semantics and filtered `SAPTargets` behavior | No SAP access probing or success/failure cache |
| API-key/direct OIDC multi auth | Supported client demand; equivalent raw scopes, exact grants, resource binding, revocation, and audit exist | Identity ADR plus verifier contract | “Authenticated” never means all targets |
| S/4HANA Public Cloud | Working SAML assertion destination and test tenant | Identity/runtime spike with live reads | No technical-user fallback |
| Basic Internet/Private Link | Concrete non-Cloud-Connector deployment | TLS/SSRF/credential threat model and mutation-free live spike | No Basic writes |
| Basic high availability | Need more than one CF instance or rolling deployment | External atomic generation/lockout state with CAS, TTL, crash tests, and readiness | No process-local approximation |
| Design-time/technical destination pairing | Measurements show PP metadata maintenance is inadequate | Pairing ADR with explicit purpose and identity separation | Never execution or PP fallback |
| SQLite/external shared cache | Memory-cache evidence shows sufficient benefit and a retention owner exists | Storage, encryption, migration, quota, invalidation, and multi-instance ADR | CF local disk is not shared/durable storage |
| Read-only plugins | Concrete extension needs multi-target access | Capability manifest and selected-target runtime design | No raw Destination object or inherited write |
| Hyperfocused mode | Measured token benefit without loss of target confidence | Schema/UX experiment across large catalogs | Not the recommended multi-target mode |
| SaaS kickoff | Provider/subscriber business requirement and tenant operations owner | Multitenancy ADR covering subscription lifecycle, tenant-qualified DCR/auth grants/destinations/cache/quotas/audit/offboarding | No cross-tenant lookup and no shared Basic initially |
| Additional SQL governance | Separate requirement for statement/row controls | SQL-specific security plan | Not coupled to routing v2 |
| Non-BTP multi-system | Customer cannot use BTP Destination/XSUAA model | Improve MCP hub deployment guidance | No second discovery/auth model in ARC-1 core |

## Aggregate Writes: Research Gate, Not a Planned PR

Aggregate writes would let one MCP connection address many targets and therefore restore the
confused-deputy risk that pinned routes reduce. Do not schedule implementation until all of these
are demonstrated:

- exact target grants work at customer scale;
- all supported clients reliably surface the selected target;
- a target-bound, short-lived confirmation mechanism works across clients;
- mutation scopes can be escalated without leaking route membership;
- retry/idempotency semantics cannot replay on another target;
- audit can prove the confirmed and executed target are identical; and
- a security review updates ADR-0005/0006.

If those conditions are not met, pinned write routes remain the final architecture.

## Test and Evidence Matrix

### Compatibility

- multi-target flag off with every existing single-target auth/deployment style;
- independent writable `/mcp` beside mutation-free multi routes;
- zero, one, two, 16, 17, 100, 256, and 257 enabled candidates;
- duplicate destination names, physical IDs, aliases, and route shadows;
- PP-only, Basic-only, and mixed read-only registries;
- Reader/Admin `SAPTargets` behavior at zero, one, and many active targets;
- aggregate union schemas when target A supports/allows an action and target B does not;
- restart with destination add/change/remove; and
- new-binary rollback to v1 after removing new destination properties.

### Authorization

- no token, malformed/expired/wrong-audience token, no role, and read-only role;
- data, SQL, write, transport, Git, and Admin functional roles independently;
- exact target grants for A/not B and capability A/not B;
- alias rename/recycling, destination recreation/rename, physical identity change, and stale grant
  tokens;
- Admin diagnostics without target mutation grant;
- explicit raw mutation scopes versus scopes implied only by Admin;
- forged/oversized/duplicate/malformed target claims;
- missing, locked, expired, or unauthorized SAP user;
- PP certificate/mapping/Cloud Connector failure with no Basic fallback;
- Basic opt-in, credential rotation, generation lockout, and guaranteed mutation rejection; and
- authentication before unknown-route/target distinction.

### Policy lattice

For each candidate mutation, independently deny at these ARC-side layers:

1. rollout flag;
2. instance `SAP_ALLOW_*` flag;
3. destination opt-in;
4. functional scope;
5. exact target grant;
6. PP identity requirement;
7. deny action;
8. allowed package;
9. allowed transport.

Each ARC-side case must prove that no mutation-preparation CSRF, lock, enqueue, or modifying SAP
request was sent. Test SAP authorization as a tenth, separate boundary: SAP necessarily receives
the request or authentication exchange, rejects it, no state changes, and the correlated audit event
records the SAP-side denial safely.

Also cover write properties on Basic targets, write properties while rollout is off, first-beta
absence of `publish_srvb`/`unpublish_srvb`, and rollback to a v1 binary.

### Isolation and concurrency

- two systems, two clients of one SID, two users, and aliases in parallel;
- cookies, SAML/PP tokens, CSRF, sessions, locks, feature flights, cache, and errors never cross;
- one unauthorized user's failure does not poison another user's features or availability;
- access revoked after a previously cached read and access granted after an earlier failed call;
- target removal/revision during an in-flight call;
- one slow target does not consume every worker indefinitely;
- consistent registry revisions across serving CF instances;
- total PP concurrency and process-local rate/fairness behavior across two CF instances; and
- the MTA/deployment doctor/operator acceptance check rejects Basic scale-out, blue/green overlap,
  and rolling operation; mixed PP+Basic registries inherit that constraint.

### MCP clients

For VS Code/GitHub Copilot, Cursor, Claude, and Copilot Studio, record the exact product version, OS,
and test date:

- OAuth login and role-specific scopes;
- pinned and aggregate configuration;
- one, two, and the documented upper practical count of pinned writable connections, including
  separate OAuth/DCR and cached tool catalogs;
- `SAPTargets` visibility;
- exact and pattern target schemas;
- cached tool catalog after policy/role changes;
- insufficient-scope reauthorization;
- clear PP/SAP authorization errors and retry after access is granted; and
- logout/token/DCR recovery.

### Live SAP

- Basis 7.50, 758, and 816 where the operation exists;
- two clients on the same 758 system to prove client pinning;
- disposable `$TMP` and dedicated Z-package objects only;
- source read/search/data/SQL regression;
- create/update/activate/delete only when its PR explicitly enables it;
- transport/Git only on dedicated test artifacts; and
- audit correlation from MCP request through SAP result.

### Operations and security

- startup time and memory at 100/256 targets;
- Destination Service latency/failure/credential rotation;
- mixed Destination and XSUAA-administrator changes during restart/refresh;
- global and per-target rate/concurrency limits;
- CF restart, crash, scale-out, rolling deployment, and rollback;
- log/audit/heap/error secret scanning;
- `SAPGit.config` and all new admin/read-parity output secret scanning;
- dependency and container scans;
- customer runbook dry run by an administrator unfamiliar with the implementation; and
- recovery when a client retains an old token or tool catalog.

## Documentation and Rollout

Keep the end-user multi-target documentation at two pages:

- `docs_page/multi-target-setup.md` for deployers and first connection;
- `docs_page/multi-target-administration.md` for policy, roles, operations, diagnostics, and
  security.

This roadmap remains an internal planning page and should not become a third setup guide. As each PR
lands:

1. update the v1/v2 capability matrix;
2. add only currently supported destination fields and examples;
3. state required roles, PP behavior, restart/refresh behavior, and rollback;
4. document unsupported operations explicitly;
5. update ADR status/evidence; and
6. verify examples through BTP Cockpit import/export and CF/BTP CLI where applicable.

Do not publish a “full write” example, claim feature parity, or remove the experimental label until
the target authorization and live customer matrix pass.

## Migration and Rollback

### Safe migration

1. Upgrade every serving instance with every new multi-target rollout flag off.
2. Drain all v1 instances before adding any v2-only destination property. A mixed v1/v2 fleet would
   quarantine a target on v1 while keeping it readable on v2.
3. Confirm existing read-only pinned and aggregate routes.
4. Create exact target grants and test with separate users.
5. Add destination policy to one non-production PP target.
6. Restart or explicitly apply a future registry revision.
7. Inspect effective policy through Admin `SAPTargets`.
8. Enable the instance flag on every serving instance and restart all of them.
9. Clear client token/tool caches and reauthenticate.
10. Run read-only regression, then disposable write acceptance.
11. Widen one target/package at a time.

### Immediate capability rollback

Disable the multi-target write rollout flag and restart/reload every serving instance. New calls are
denied only after every instance has applied the change; an already-authorized in-flight mutation
may complete. A destination-property edit alone is ineffective until registry reload.

For emergency containment, stop or unroute the app and revoke the XSUAA grant, SAP authorization,
or Cloud Connector path as appropriate. Do not rely on a rolling restart as an instantaneous kill
switch.

### Binary rollback to v1

Remove all v2-only `arc1.*` destination properties, restart to confirm the v2 binary sees a v1
snapshot, then roll back the application. If the properties remain, v1 safely quarantines those
destinations rather than serving them with ambiguous policy.

## Decisions Locked by This Roadmap

- v2 is a set of future PRs, not one release-sized change;
- existing pinned target URLs are the preferred write endpoint;
- aggregate and shared-Basic routes remain mutation-free;
- strict PP is mandatory for the initial write beta;
- exact target/capability authorization precedes customer-grade writes;
- multi-target mutation requires an explicit raw functional scope; Admin implication alone is not
  write consent;
- enabling multi-target writes necessarily enables target-grant enforcement;
- no generic destination config version;
- destination descriptions are labels, never security inputs;
- no per-user SAP failure cache or remembered target;
- no automatic destination polling initially;
- no technical/design-time destination fallback;
- no wildcard target grants initially;
- Admin diagnostics do not imply target mutation permission;
- no direct OIDC/API-key write path in the initial beta;
- no mutation scopes on aggregate metadata or the Copilot aggregate `/authorize` alias;
- no hyperfocused recommendation for multi-target landscapes; and
- no SaaS or cross-subaccount expansion inside this roadmap.

## Open Decisions Required Before V2-08

1. Can XSUAA represent target grants administrably within token/gorouter limits at 100 targets, or
   is a fail-closed external entitlement source required?
2. Do all supported MCP clients handle runtime `insufficient_scope`, or is fixed pinned-route scope
   advertisement required?
3. Which exact create/update/object-type subset has sufficient cross-release live coverage for the
   first beta alongside `SAPActivate(action=activate)`?
4. Is explicit package configuration mandatory for customer beta even though `$TMP` remains the
   safe code default?
5. Which high-risk actions require elicitation or short-lived target-bound consent?
6. What policy prevents an independently configured writable `/mcp` destination from shadowing or
   bypassing a discovered target policy?
7. Is a public target ID sufficient grant identity under the Destination-admin trust model, or is a
   separate stable authorization identity/re-grant workflow required?
8. What evidence threshold changes ADR-0006 from Proposed/experimental?
9. Must customer writes fail closed when BTP Audit Log is unavailable or backpressured, and what
   delivery/correlation guarantees are required around process failure?

These are design gates, not reasons to combine the prerequisite PRs.

## Rejected Shortcuts

- global `SAPWrite` permission for every discovered target;
- deriving target access from the first failed/successful SAP request;
- caching that a user cannot access a target;
- using destination name/description/SID patterns as an environment or authorization signal;
- using one technical destination when PP fails;
- enabling writes for the shared Basic identity;
- adding `target` to aggregate write tools without stronger consent;
- using global write scope plus a separate generic systems list;
- loading destination configuration on every tool call;
- mutating a registry snapshot in place;
- relying on `tools/list_changed` or conversational memory for safety;
- storing raw destinations or credentials in caches/diagnostics;
- adding a second destination solely for cache warmup;
- using CF local disk as a shared/durable cache; and
- treating SaaS as cross-subaccount Destination Service lookup.

## Definition of Done

Multi-target v2 can be called customer-ready only when:

- the relevant ADRs are accepted;
- every mutation or controlled-execution capability has the target authorization required by its
  ADR and an action-level policy;
- PP-only pinned writes pass the full client/SAP/role/isolation matrix;
- aggregate and Basic mutation remain impossible;
- automated CF acceptance covers the supported deployment;
- 100-target load/fairness behavior is measured and documented;
- all configuration, diagnostics, and audit output are secret-safe;
- migration and rollback are rehearsed;
- the two administrator-facing pages are current and independently usable; and
- unsupported capabilities are explicit rather than silently degraded.

## References

Repository decisions and plans:

- [ADR-0005: Single SAP system per ARC-1 instance](../adr/0005-single-system-per-instance.md)
- [ADR-0006: Experimental read-only multi-target](../adr/0006-experimental-read-only-multi-target.md)
- [ADR-0007: Shared Basic identity exception](../adr/0007-shared-basic-identity-for-read-only-multi-target.md)
- [Destination-discovered multi-target v1](destination-discovered-multi-target-v1.md)
- [Shared Basic v1 implementation plan](2026-07-20-multi-target-basic-auth-v1.md)
- [MCP hub multi-system research](../research/mcp-hub-multi-system.md)
- [BTP documentation architecture research](../research/2026-07-20-btp-documentation-architecture.md)

External standards and platform guidance:

- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
- [MCP tools and list-changed notifications](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [RFC 8707 resource indicators](https://www.rfc-editor.org/rfc/rfc8707.html)
- [MCP security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [SAP application security descriptor](https://help.sap.com/docs/btp/sap-business-technology-platform/application-security-descriptor-configuration-syntax)
- [SAP BTP application protection and role collections](https://help.sap.com/docs/btp/sap-business-technology-platform/protecting-your-application)
- [SAP authorization roles and role collections](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/building-roles-and-role-collections-for-applications)
- [SAP Audit Logging in Cloud Foundry](https://help.sap.com/docs/btp/sap-business-technology-platform/audit-logging-in-cloud-foundry-environment)
- [SAP Destination Service](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/destination-service)
- [SAP Cloud SDK destination retrieval](https://sap.github.io/cloud-sdk/docs/js/features/connectivity/destinations)
- [SAP Cloud SDK destination cache isolation](https://sap.github.io/cloud-sdk/docs/js/features/connectivity/destination-cache)
- [Cloud Foundry local storage behavior](https://docs.cloudfoundry.org/devguide/deploy-apps/prepare-to-deploy.html)
