# Implementation plan: pinned PP writes in multi-target mode

**Status:** Proposed implementation contract; no runtime writes enabled by this PR.
**Review/test baseline:** `origin/main` at `565e6c68db0de3355da94dd5338cf83289fe5e06`, 22 October 2026.
**Final main revalidation:** `d3c0191ced917da7ff77258dc9368ab4d0751be3`; the intervening #1074
change caps returned TABLE_CONTENTS rows and updates its tests/docs, without changing write policy
or authentication. The independent review and 307-test run remain evidence for the earlier baseline.
**Tracks:** FEAT-93; [research and alternatives](../research/2026-10-22-multi-target-write-strategy.md);
[PR #906](https://github.com/arc-mcp/arc-1/pull/906) is implementation material, not the branch to merge unchanged.

This is the implementation entry point. The research note explains the evidence and tradeoffs;
the older [V2 roadmap](multi-target-v2-roadmap.md) is background. Accepted ADR-0006/0007/0008
remain authoritative until the [proposed write ADR](../adr/0010-pinned-pp-multi-target-writes.md)
is accepted. Implementation stages below do not authorize a production rollout or SAP writes.

## 1. Outcome and fixed decisions

One BTP CF application serves read-only aggregate discovery and explicitly writable pinned
SAP targets. A client uses the existing `/A4H/001/mcp` connection for development and
`/multi/mcp` for cross-target reads. Configuring that URL is not itself an authorization grant.

| Decision | Contract |
|---|---|
| Global opt-in | Reuse `SAP_ALLOW_WRITES=false` by default. No `ARC1_MULTI_TARGET_ALLOW_WRITES`. |
| Target opt-in | Proposed `arc1.allow_writes=true` plus explicit `arc1.allowed_packages` on an enabled PP destination. |
| Routes | Existing pinned URLs only. No `/write/mcp`; aggregate and its `/authorize` compatibility alias always reject mutations. |
| Authentication | Strict PP for multi-target writes, never Basic fallback. Existing single-target auth/write behavior stays unchanged. |
| User authorization | Target-filtered access plus verified functional write permission and an exact target write grant. |
| Policy precedence | Server restrictions and destination restrictions both apply; neither replaces the other. |
| Surface | Explicit action/type/input allowlist; never expose the entire single-target write surface. |
| Operations | Existing request isolation, cache none, plugins/UI off, immutable registry and drift rejection. |

Scope is BTP CF hosting with supported on-premise SAP destinations through Cloud Connector.
This does not add BTP ABAP/Public Cloud target authentication, SaaS, direct OIDC/API-key multi-target
writes, ABAP/RFC execution, aggregate writes or shared-Basic writes. PP-only CF replica qualification
is separate from SAP multi-target routing; mixed Basic deployments keep the one-instance contract.

## 2. First executable scope

The first enablement is an experimental **`$TMP` object-write beta**.
Transportable packages follow only after stage 6. Publish this limitation beside the configuration
example, not solely in an ADR.

| Tool/action | Beta types and input restrictions |
|---|---|
| `SAPWrite.create` | One CLAS or INTF; explicit package; no batch, transport, generated RAP or auxiliary metadata workflow. Save inactive source; activation is separate. |
| `SAPWrite.update` | Existing CLAS or INTF main source only; require `expectedSourceHash`; no include, group, package change, metadata-only or side-effect options. |
| `SAPWrite.edit_method` | Existing CLAS main-source method body only; require the existing hash for the complete editable source being locked/spliced. No local-class include or signature/visibility change. |
| `SAPActivate` / `activate` | One explicit CLAS or INTF owner. No `objects[]`, service publication, `preaudit=false` or caller URI. Whole-owner activation, never a promise of method-only activation. |

Normalize omitted `SAPActivate.action` to `activate` before scope, allowlist, deny and audit checks
on the multi-target path. This must make `SAP_DENY_ACTIONS=SAPActivate.activate` effective for
both forms. The existing single-target omitted-action deny behavior is a separate fix.

Preserve existing mutation-free reads. Exclude every other mutation, including delete, method
addition/deletion/signature changes, unit-test surgery, batch creation, DDIC/RAP, package management,
FLP/UI5, settings, tracing, Git and transport management. Enforce meaningful prohibited inputs at
runtime after the existing empty-value normalization; do not rely on removing fields from schemas.
“Meaningful” means a supplied value remaining after that normalization that differs from the
operation's documented default; dangerous false values such as `preaudit=false` remain meaningful.
Remove prohibited properties from pinned schemas too. Reject derived local includes for
`edit_method` (`lhc_*`, `lcl_*`, `ltc_*`), not only explicit `include` parameters.
No new target argument on pinned calls; reject a meaningful supplied `target`, even if it matches.

The beta permits only `$TMP`, checked against both configured policies and the real owner package.
A `$` prefix alone is not authorization evidence. Prove the `$TMP` create contract live before
enabling it. Locked edits require an affirmative `IS_LOCAL` result and an empty `corrNr`; missing,
ambiguous or conflicting lock evidence denies the save. Other local packages are deferred.
Reject an explicit transport before SAP preparation. If a lock unexpectedly returns a CTS request
or task, unlock and refuse before PUT. Creation must establish local eligibility before POST;
the current best-effort `resolveCreateTransport` fallback is not sufficient proof.

Explicit activation authorizes the complete selected owner, including its existing inactive drafts.
Document that scope in the tool description, successful write response and operator guide. It is
not a change-set ownership guarantee. Do not invent a persistent change-set store for this beta.
If that scope is unacceptable to an operator, `SAP_DENY_ACTIONS=SAPActivate` can disable activation.

## 3. Configuration and effective policy

### Destination grammar and defaults

Keep one shared parser used by startup projection, registry validation and per-request drift checks.
New property names below are proposed, not usable on current main.

| Property | Default and validation |
|---|---|
| `arc1.allow_writes` | Absent means false; reuse strict destination boolean parsing. Empty/invalid values quarantine an enabled destination. |
| `arc1.allowed_packages` | Required whenever the destination requests writes, even if the global switch is off. In the beta the only supported list is exactly `$TMP` after ASCII trim/case normalization and deduplication; reject empty CSV members, wildcards, other packages, non-ASCII and values over 128 bytes. Stage 6 expands destination package grammar only with its own validation/tests. Existing global package patterns retain their semantics. |
| Transport/Git write properties | Remain unsupported/quarantined in the local beta. Add only with the corresponding later capability, documented parser, scope and acceptance evidence. |

A valid package list alone never enables writes. Validate it if supplied on a read-only destination.
A Basic destination requesting writes is quarantined even if `SAP_ALLOW_WRITES=false`; it must not
silently become a writable candidate later. Valid PP write policy with the global switch off stays
readable, visibly limited by the server. Invalid enabled targets remain quarantined; unrelated valid
targets retain current discovery behavior. Unknown `arc1.*` keys remain errors.

Writable destinations require `ARC1_MULTI_TARGET_AUTHORIZATION=xsuaa-attribute`. In `standard`
mode, write-related destination properties remain quarantined per destination, matching today's
behavior; destination contents must not crash the whole application or its independent `/mcp`.
Use a stable diagnostic explaining that target-filtered access is required. Global server/mode
configuration errors retain their existing startup checks. Target-filtered mode retains its earlier
rejection of independent single-target connection settings.

On upgrade in target-filtered mode, a previously quarantined destination with now-valid write
properties can become readable for granted users even with global writes off. Document that
availability change explicitly; it does not grant writes without the new exact write attribute.

### Composition rules

```text
canWrite = pinned route AND PP identity AND target-filtered mode
           AND SAP_ALLOW_WRITES AND destination.allowWrites
           AND verified raw write scope AND exact target write grant
           AND existing target-access grant AND supported action/type/input
           AND no action denial AND package allowed by BOTH policies
           AND eligible local/transport policy AND SAP authorization
```

Evaluate global and destination package matchers against the resolved real package independently.
Reuse the existing hierarchy resolver under the selected identity for `/**`; unresolved metadata
or hierarchy denies. Never union allowlists, replace one with the other, or turn an empty overlap
into the existing unrestricted `[]` representation. Creates check their requested package and
backend eligibility before creation; updates/activation resolve existing owner metadata rather
than trusting `args.package`. Recheck mutable owner metadata under the lock where the backend
contract allows; do not substitute locality for package authorization. An object moved between
local packages can stay local while leaving the allowlist. Document and test remaining
external-administrator race limits.

Carry a required discriminated policy context through `SafetyConfig`: an explicit legacy
single-target branch, or a multi-target branch with required route, target identity and destination
package restriction. A missing multi-target restriction is invalid/deny-all, never unrestricted `[]`.
Extend `decidePackageAllowed`/`checkPackage` and the real-package helper so both predicates apply
at every existing write/activation call site. In particular, its current early return for an empty
global `allowedPackages` must not skip the destination check. Preserve this context through
`deriveUserSafety`, safety clones and `withSafety`; no caller may downgrade it to the legacy branch.

The following examples explain the general composition rule. Only the `$TMP` configuration is
accepted by the first beta; other destination package names belong to stage 6.

| Server packages | Destination packages | Result |
|---|---|---|
| `ZTEAM*` | `ZTEAM_API` | Only `ZTEAM_API` passes package policy; beta local eligibility is a separate requirement. |
| `ZTEAM_API` | `ZTEAM*` | Only `ZTEAM_API` passes. |
| `$TMP` | `ZTEAM_API` | No package passes both; explain the server default. |
| `$TMP` | `$TMP` | `$TMP` passes; all other write gates still apply. |

Keep the global package parser's existing semantics for single-target deployments. Strict new
destination validation must not silently redefine global empty lists or wildcard behavior.
Global `SAP_DENY_ACTIONS` always applies. No destination deny-list property is needed initially.
Source reads are not package-restricted; data/SQL retain their separate existing permissions.

### Carry settings intentionally

The runtime currently starts from `DEFAULT_CONFIG` plus an explicit allowlist. Retain that design;
never spread the entire single-target configuration or inherit credentials, cookies or relaxed TLS.

- Reuse global `SAP_ALLOW_WRITES` and both package restrictions for the new path.
- Preserve action denies, data/SQL ceilings and blocklist, rate/concurrency/data-result limits,
  minimal errors, feature flags and strict PP. Preserve existing read-only surfaces.
- Carry `SAP_ABAPLINT_CONFIG` along with the already-copied `SAP_LINT_BEFORE_WRITE`. Honor
  `SAP_CHECK_BEFORE_WRITE` on qualified write paths. Validate with selected-target release evidence;
  do not reuse another target's inferred syntax version or introduce a misleading global release override.
- Keep lint's current per-call skips/type exceptions/fail-open engine errors and syntax-check
  advisory behavior explicit. These are not non-bypassable security controls.
- Keep transport/Git mutations off structurally in the beta, even if their global switches are true.
  Stage 6 must explicitly pass transport restrictions to write validation without accidentally
  changing current multi-target transport-read semantics.

## 4. IAM and request enforcement

Add a required string attribute **`arc1_write_targets`** to the XSUAA descriptor and a new
unassigned role template **`MCPTargetDeveloper`** with `read`, `write` and references to both
`arc1_targets` and `arc1_write_targets`. Static roles explicitly assign the same development IDs
to both attributes; additional read roles may add other targets. No wildcard/default values on
the write attribute. Preserve existing roles and collections; do not add transport/Git scopes to
this role and do not auto-assign it. Keep this attribute-bearing template out of `mta.yaml`'s
predefined role collections; create concrete roles with explicit values in Cockpit. IAS mappings
remain optional and separately qualified.

Example: read grants `A4H/001,QAS/100`, write grants `A4H/001`, scopes `read,write` permit writes
only on A4H's pinned route. A read `*` does not supply a write grant. Admin must hold the same exact
write grant; current `MCPAdmin` already includes raw write scopes, so a raw-scope check alone is
not enough. Operator diagnostics do not grant SAP execution.

Extend the verified XSUAA attribute allowlist; never decode the bearer token in application code.
Use the existing auth-library verifier with identity scope expansion to obtain verified raw local
scopes, copy them into immutable request-local authorization data, then apply existing expansion
for normal reads/dispatch. Implement this at the existing multi-target bearer boundary, not as a
new auth framework; preserve the SDK's header, expiry and principal-error handling. Do not capture
raw scopes in a mutable closure shared across requests.
No dependency upgrade is assumed: the installed `@arc-mcp/xsuaa-auth` 1.1.0 has the required
`expandScopes` and `userAttributeNames` seams. Test the wrapper against its actual returned shape.

Write-grant parsing reuses the existing bounded exact target grammar: at most 1,024 raw values,
128 bytes/value, 16 KiB total and 256 unique canonical IDs; reject `*`, globs, CSV strings, Unicode
folding, inherited/accessor values and malformed mixtures. Missing or invalid write claims deny all
writes but do not destroy otherwise valid read grants when failure is confined to that attribute.
The auth library also has a shared 64 KiB extraction limit across requested attributes: exceeding it
invalidates both read and write attributes. Preserve that fail-closed behavior and test it explicitly.
Read-claim failure retains today's behavior. Bounds are parser limits, not a claim that such a token
fits a gateway.

Build one immutable caller projection before instructions and `tools/list`, including raw write
consent and exact write grants. Thread a **required** route discriminator through policy/runtime
construction, including both `buildMultiTargetConfig` callers in `server.ts` and
`multi-target-server.ts`. One evaluator serves schemas, execution and operator explanations. In aggregate
mode, write capability is unconditionally false, including before and after selecting a destination.

Enforcement ordering:

1. Verify the supported XSUAA user, syntax and global read eligibility using existing HTTP checks.
2. Keep the existing HTTP target-access check before registry membership, preserving indistinguishable
   unknown/ungranted failures. At per-call preparation, check the normalized mutation, raw write scope
   and exact write grant before selected-destination lookup or SAP work. The earlier pinned HTTP route
   may already have resolved membership for an access-authorized caller; do not claim otherwise.
3. Resolve the immutable descriptor; check route, identity, global/destination policy, action/type/input
   and denies before selected-destination lookup or feature probes.
4. Fetch the selected subaccount destination uncached; check owner and snapshot fingerprint;
   obtain strict PP identity. No fallback or alternate target.
5. Perform authorized metadata/package/local-recording checks before lock/create; apply source and
   actual lock-derived transport checks before save; audit decision and outcome.

Old tokens without the new attribute remain read-only. Existing live evidence shows that replayed
access tokens and refresh sessions can retain removed grants; a new expiry is not revocation.
Require sign-out and a genuinely fresh authorization flow after role changes, then verify actual
permissions. This does not revoke all outstanding tokens or refresh sessions. Current configured
lifetimes are one hour/access and 30 days/refresh, neither a revocation guarantee. Before the pilot,
IAM/security owners must decide and record acceptable lifetime/SSO settings and containment; a
shorter refresh lifetime is not applied retroactively or silently changed for single-target users.

For urgent containment, close the affected app/route, disable a target's writes and restart every
instance, or disable global writes everywhere. SAP owners can revoke the propagated user's write
authorizations or lock the account and verify the effect, including existing sessions. Do not call
role removal or client sign-out immediate revocation. Destination policy participates in fingerprinting.
Repointing a public target ID retains grants after restart. For a different physical backend, use a
new public alias/ID and explicitly assign its grants; do not reuse an old ID while old tokens can
authorize it. Verify same-backend URL migrations through operator connectivity inventory. There is
no automatic persistent backend identity authority, and a SID alone cannot establish sameness.

## 5. Mutation lifecycle and activation

Use current `expectedSourceHash` validation under lock; reject a missing/malformed hash on the
supported update/method actions. The hash must be for the complete selected editable source, not
a displayed method fragment or a different include. This is a content-only SHA-256 hash: identical
source on another target hashes identically. Target binding comes from the pinned route, immutable
request policy and exact grants, not the hash.

Lock, read, compare, save and unlock stay in one synchronous tool call under one user/target.
No elicitation, asynchronous MCP task or approval wait may hold a lock. Check cancellation before
lock and before each not-yet-started mutation phase. Pass explicit bounded request options through
qualified CRUD paths; do not assume the current HTTP layer consumes an ambient signal. In-flight
cancellation may leave completion unknown. Cleanup receives its own bounded opportunity, with
the original session identity intact, even when the caller signal is aborted.
No route, identity or config switch midway through a call; an already admitted operation may finish
after an operator starts disabling the deployment.

Preserve create/activation no-replay controls. Explicitly disable transient replay for beta lock and
save operations and inspect authentication retries too. Current transient 500 recovery can call
`resetSession()` and discard the lock-owning cookie jar; this must not occur within the qualified
stateful write lifecycle. Keep the owning session through bounded unlock/close. Preserve a primary
error when `finally` cleanup also fails, attaching cleanup status rather than replacing the outcome.
A partial create
(metadata created, source save failed) is reported as partial with the known object; do not delete it
automatically. Distinguish confirmed failure, completed change and unknown completion. Cleanup
failure must be visible without replacing the original outcome. Verify inactive and active state
as appropriate; never label a save as activation success.

Fix the client-facing multi-target outcome path in `handlers/dispatch.ts`: its generic network/5xx
classification currently precedes `formatErrorForLLM`, says “try again”/“Retry once” and defaults to
`retryable:true`. Recognize uncertain or partial mutations before that classifier, return
`retryable:false` with bounded state-inspection guidance, and cover both thrown and returned-error
paths in normal/minimal-error modes. Add explicit partial-state reporting around CLAS/INTF
create-then-source-save failures. Existing no-replay HTTP behavior alone cannot prevent an LLM
from following misleading retry advice.

For multi-target PP creation, do not use the XSUAA display username as SAP `adtcore:responsible`.
Omit that field where the qualified endpoint supports SAP's own assignment, or require authoritative
mapped SAP identity evidence if it is mandatory. Verify creator/changer and responsible fields live;
the ARC-1 client marker or display username is not proof of the propagated SAP user.

Activation needs a required multi-target validation context at the low-level preaudit/confirmation
boundary, including recovery paths. Existing single-target callers must pass an explicit legacy
context: direct/batch activation, batch-create activation, text-element activation and RAP generation.
No omitted context may select permissive legacy behavior for a multi-target request.
Validate canonical same-target references, their real package,
and ownership/type before confirmation. For the beta, permit only the requested owner and proven
components of that owner through an exact known owner/include URI mapping, not a broad path-prefix
match. Reuse the checked owner package only when ownership is proven; reject additional owners,
unknown references and cross-origin URIs before
the confirmation POST. Do not send `preaudit=false` to escape validation. The first preaudit request
can itself activate without a prompt; authorization of the complete initial owner must precede it.
Keep the current bounded activation deadline and uncertain-outcome behavior. Test actual SAP
preaudit shapes; if safe scope validation cannot be demonstrated, activation remains unavailable.

Audit verified caller, selected target/identity, safe policy revision, action/object, denying layer,
request correlation and outcome. Preserve centralized redaction. Current BTP Audit Log delivery
is asynchronous: the beta explicitly retains that contract and requires monitoring, not a false
durable-before-write guarantee. Mandatory acknowledged audit admission is separate future work.

## 6. OAuth, clients and operator experience

Keep aggregate PRM and Copilot `/authorize` alias mutation-free. Pinned metadata may advertise
`write` only when `SAP_ALLOW_WRITES=true` and mode is `xsuaa-attribute`, using route syntax and
deployment configuration, never target existence, destination
policy or user grants. Do not advertise transport/Git capabilities for the beta. Tokens remain subject
to XSUAA audience verification plus application target grants; a pinned resource URL does not by
itself bind a token to one backend.

Qualify a minimal pinned read/write authorization flow in each supported beta client. Prefer a
usable scope challenge; if clients cannot step up, explicitly provision the minimal fixed scope set
for that pinned connection. A JSON-RPC tool error is not proof of HTTP `insufficient_scope` behavior.
Do not add hand-rolled JSON-RPC HTTP parsing just to claim transparent step-up. Record actual
client versions, protocol, fresh login and cached-token/catalog behavior. Clients that only use the
aggregate compatibility alias do not support this write beta.

Pinned write tools must carry truthful mutation annotations: `readOnlyHint:false`,
`destructiveHint:true`, with no unsupported idempotence claim. Current multi-target pruning forces
read-only annotations for every tool; split that logic explicitly and test schemas plus direct calls.
Client confirmations are additional UX, never the authorization boundary.

Extend existing admin `SAPTargets` diagnostics with fixed-size requested/effective booleans, rule
counts, policy digest and stable reason codes. Do not inline package/transport arrays in the complete
catalog: its 512 KiB startup budget can otherwise make the whole registry unavailable. Test the
worst 256-target snapshot and maximum permitted rules, including future stage-6 lists. Readers see
only their granted targets/capabilities; no raw grants, secrets, URLs or hidden inventory. Admin
preview does not prove SAP permissions or mutate settings. Reuse startup effective-policy logging
and existing config validation; a separate offline checker/generator is optional. No new HTTP
endpoint, admin UI or fourth policy store. Any live check is explicit, bounded and read-only under
the requesting user.

The public guide must explain this sequence:

1. **What works:** route/auth/action matrix and `$TMP` beta limits; PP is mandatory only here.
   Explain cross-client repository impact and whole-owner activation at this entry point.
2. **Who sets what:** server operator sets `.mtaext` ceilings; destination owner sets target policy;
   IAM owner assigns roles; SAP owner verifies PP and native authorizations.
3. **Minimal setup:** reuse current multi-PP and target-authorization overlays, then set:

   ```yaml
   # Proposed additional app properties after implementation; not a standalone MTA file
   SAP_ALLOW_WRITES: "true"
   SAP_ALLOWED_PACKAGES: "$TMP"
   SAP_ALLOW_TRANSPORT_WRITES: "false"
   SAP_ALLOW_GIT_WRITES: "false"
   ```

   ```properties
   # Proposed additions to one existing, enabled PP destination
   arc1.allow_writes=true
   arc1.allowed_packages=$TMP
   ```

   Assign exact target read/write role values, then register its existing pinned URL. The implementation
   must ship a complete, validated example alongside these explanatory fragments.
4. **What wins:** AND/intersection examples, all absent/false/empty/malformed cases, default `$TMP`,
   separate read/data/SQL policy, and advisory quality checks.
5. **Verification/troubleshooting:** effective policy, harmless denied cases, PP identity and an
   explicitly authorized disposable-object write/read-back/activation test. Health alone is insufficient.
6. **Change/disable/rollback:** restart every instance for destination changes; after role changes,
   sign out, start a fresh authorization flow, verify actual grants, then reload tools. Refresh alone
   is insufficient. Explicitly set `SAP_ALLOW_WRITES: "false"` in `.mtaext` to disable. For immediate
   containment drain/unroute; in-flight work may finish. Before old-binary rollback remove all new
   destination keys, even false-valued keys, because old v1 quarantines them.

Canonical files: `docs_page/multi-target-setup.md`, `multi-target-administration.md`,
`multi-target-authorization.md`, `configuration-reference.md`, `configuration-precedence.md`,
`authorization.md` and the multi-PP examples. Update the topology entry links and AGENTS summary
when implementation ships. Keep deep evidence out of public setup instructions.

## 7. Ordered implementation stages

Each stage lands with tests and a reviewed diff. The first four may be developed without exposing
write tools; do not present a partial implementation as supported configuration.

| Stage | Files / work | Completion gate |
|---|---|---|
| 1. ADR and bounded spikes | Proposed ADR-0010/security-model; live XSUAA static write role and raw-scope wrapper; real-client pinned OAuth; local package/preaudit evidence. | Verify “write A/read B”, Admin without grant, fresh/old tokens and actual propagated SAP user. Capture blockers before enabling. |
| 2. Pure policy and parser | `multi-target-destination-config.ts`, discovery/registry/runtime, `adt/safety.ts` and real-package helper; required discriminated policy; strict validation/fingerprints. | Truth tables; standard-mode write properties quarantine only their target; no-overlap/missing policy denies; empty global list still checks destination; aggregate/Basic remain read-only; old read fixtures unchanged. |
| 3. Verified grants and projection | `http.ts`, `multi-target-authorization.ts`, request projection/bearer boundary; `xs-security.json`, example roles. | Verified-only extraction, concurrent-user isolation, exact access/write intersection, no Admin/wildcard bypass, denial before target lookup. |
| 4. Common mutation controls | `handlers/write*`, `handlers/dispatch.ts`, `adt/crud.ts`, HTTP request options, source-precondition and activation modules; explicit policy contexts for legacy callers. | `$TMP`/lock locality, two package constraints, freshness, derived-include rejection, complete activation scope, no transient lock/save replay or cookie reset, bounded cleanup preserving primary error, partial/unknown results with `retryable:false`. |
| 5. Pinned local beta and docs | `multi-target-tools.ts`, `multi-target-server.ts`, `server.ts`, `http.ts`, `handlers/tools.ts`, schemas/policy; `scripts/ci/check-tool-schema-budget.ts`; docs/examples and bounded diagnostics. | Supported-client PP tests on frozen artifact; truthful annotations and omitted-action denials; pinned-write schema budget scenario; maximum catalog size; negative matrix; clean docs walkthrough. Then accept ADR/enable pilot. |
| 6. Transportable object writes | Add documented `arc1.allowed_transports` grammar and global/target membership checks; no new global flag. Cover create preflight, explicit request/task and lock-derived CTS IDs. | Prove real request/task resolution and recording under PP, deny on unknown/unlisted actual recording target; preserve transport management switch separation and legacy single-target/read behavior. No permissive fallback. |
| Later, separate changes | Additional source types, surgical actions, deletes/batches, transport/Git management. | Each adds its own action/type/side-effect evidence; no automatic single-target parity. |

Stage 6 is follow-on design work, not part of the beta's shipped configuration contract. Expand
destination package syntax there with explicit names first, bounded lists and separate pattern
qualification if needed; retain independent global policy checks throughout.
For stage 6, an absent destination transport list denies transport-bound writes. Global empty-list
semantics remain legacy-unrestricted, but the explicit destination list still restricts. Check both
actual task and parent request when either can receive the record; do not treat a parent grant as
an undocumented wildcard for every task. Reject unresolvable hierarchy before mutation. Ordinary
object recording must not require `SAP_ALLOW_TRANSPORT_WRITES`; management actions still require
that switch and their own scopes. No transport/Git destination enabling properties ship until their
management feature is separately implemented.

Rebase selective ideas from #906: route discrimination, strict properties, fingerprints and
instructions are useful. Do not carry its three duplicate global switches, full single-target
surface, Admin scope shortcut, destination-only package policy, empty transport policy, conflicting
ADR number or stale residual-risk number. No wholesale cherry-pick.

## 8. Acceptance matrix

| Boundary | Required negative / positive controls |
|---|---|
| Configuration | Global off; destination off/missing; malformed booleans/lists; empty CSV; Basic write request; standard-mode write keys quarantine one target and never crash independent `/mcp`; newly readable destination after target-filtered upgrade; no spontaneous writes. |
| Routes/surface | Pinned success versus same payload on aggregate, Copilot alias and Basic; hidden actions/types/options; derived local includes; omitted/explicit activation action obey same deny; truthful write annotations; supplied target rejected; old catalogs cannot bypass runtime checks. |
| Grants | Write A/read B; read `*` plus write A; raw admin-only; MCPAdmin without exact write grant; unknown/ungranted IDs; malformed/expired/write-specific versus shared-limit claims; wrong audience/app; client credentials; concurrent users; old refresh sessions after role removal versus fresh authorization. |
| Packages | `$TMP` allowed/denied globally; empty global list still constrained by destination; malformed/missing destination restriction denies; beta rejects non-`$TMP` destinations; global subtree metadata failures fail closed; real-package spoof/move races; later broadened lists test both directions/overlap; reads unchanged. |
| Local/CTS | Reject explicit transport in beta; prove local creation before POST; lock returns unexpected CTS ID => unlock/no PUT; later explicit/automatic task-parent mapping, failures and mismatches. |
| Lifecycle | Stale/missing hash and content-only limitations; lock conflict; network/5xx during create, activation and post-create source save => honest unknown/partial response with `retryable:false`; no automatic replay/session reset; cancellation boundaries, cleanup preserving primary outcome; PP creator/responsible read-back; no cross-call locks. |
| Activation | Allowed owner/components; foreign/unresolved preaudit refs; forbidden owner/package; caller disables preaudit; recovery path retains checks; existing drafts are documented whole-owner scope. |
| Isolation | Two users/two targets; same SID aliases; same repository through two clients; PP denial never falls back; policy/destination remap drift; target feature/lint release isolation. |
| Operations | All-instance rollout; fresh authorization and tools after role changes; target/global disable; new public ID for a new backend; old-binary rollback; worst-size catalog; failed audit delivery semantics; existing shared process budgets. |

Run relevant registry/runtime/grant/tool/HTTP/handler/ADT tests first; then full unit suite,
`npm run typecheck`, `npm run lint`, `npm run validate:policy`, `npm run build`,
`npm run check:sizes`, `npm run docs:build`, and effective MTA/profile validation for changed
examples. Use meaningful regression tests at runtime boundaries, not prose-presence assertions.

Live acceptance is distinct: frozen build/version, BTP CF/Cloud Connector/PP route, actual SAP
release and independently confirmed SAP author, two user identities, exact role sets, tested MCP
client versions, object read-back/activation and cleanup. Direct Basic CLI tests are not PP evidence.
Use a real non-production backend and one designated development client per physical repository;
the ABAP repository is cross-client. SID/URL labels do not prove isolation or production status.

An unfamiliar operator must configure one writable and one read-only target, explain conflicting
package policies, diagnose an intentional denial and disable writes using only the public guide.
A passing docs build alone is not this usability result.

## 9. Remaining evidence and plan review

No live write qualification is claimed by this planning PR. Stage 1 must settle raw-scope/attribute
composition under real XSUAA, client scope negotiation, authoritative local-recording evidence,
and SAP's complete activation/preaudit reference shapes. Failed evidence narrows the beta or keeps
the affected action disabled; it never permits a broader fallback. Durable audit admission and
large-landscape fairness/caching are not hidden prerequisites to the small pilot.

Independent review: Claude Code **Opus 5.5**, effort **max**, completed against the first frozen
draft. [Review and dispositions](../research/multi-target-pinned-writes/claude-plan-review.md)
record hashes, confirmed findings, corrections and the simplifications retained/rejected. This
revised plan incorporates the assessed findings; that is not an independent approval of code or
acceptance of the ADR. The 307 focused baseline tests passed on `565e6c68`; none
tests a writable multi-target implementation because this PR contains documentation only.

Primary design references: [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
for resource/audience and scope handling, [MCP scope minimization](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices#scope-minimization),
and [SAP repository/client structure](https://learning.sap.com/courses/introducing-sap-abap-platform-fundamentals/exploring-the-data-structure-of-sap-systems-based-on-abap-platform).
These establish design constraints; they do not prove the installed SDK, a client, or a SAP release
has passed the concrete scenarios above.
