# Implementation plan: pinned PP writes in multi-target mode

**Status:** Implemented, qualified and independently reviewed in [PR #1080](https://github.com/arc-mcp/arc-1/pull/1080).
**Baseline:** `origin/main` `815e3ddb` incorporated at `11092547`; latest-main `06517021` (documentation only) incorporated at `da44218c`, 22 October 2026.
**Release objective:** Deliver all scoped features below together. No separate beta release.
Local-only stages are internal qualification milestones and are not the end goal of this PR.

This is the implementation contract. See the [alternatives research](../research/2026-10-22-multi-target-write-strategy.md),
[live qualification evidence](../research/2026-10-22-multi-target-write-qualification.md),
[ADR-0010](../adr/0010-pinned-pp-multi-target-writes.md), and
[Claude plan review and dispositions](../research/multi-target-pinned-writes/claude-plan-review.md).
The owner explicitly authorized implementation and isolated testing after the plan-only draft.
Accepted ADR-0010 qualifies ADR-0006/0007/0008 only for the complete scoped surface below.

## 1. Fixed decisions

| Boundary | Required behavior |
|---|---|
| Global opt-in | Reuse `SAP_ALLOW_WRITES`, default false. No extra global multi-write parameter. |
| Target opt-in | Enabled PP destination with `arc1.allow_writes=true` and explicit `arc1.allowed_packages`. |
| Routes | Only the existing pinned `/<SYSTEM-OR-ALIAS>/<CLIENT>/mcp`. No new write URL. `/multi/mcp` and the Copilot `/authorize` compatibility alias always remain mutation-free. |
| SAP identity | Strict per-user PP for multi-target writes. Basic remains read-only and never supplies a PP fallback. Single-target behavior stays unchanged. |
| IAM | `ARC1_MULTI_TARGET_AUTHORIZATION=xsuaa-attribute`, access grant in `arc1_targets`, verified raw `write` scope, and exact `arc1_write_targets` grant for this pinned target. All are required. |
| Precedence | Server and destination restrictions both apply. Neither replaces or unions the other. User grants narrow further. |
| Runtime | Cache none, standard tools, UI/plugins off, immutable startup registry, uncached per-call Destination resolution and drift rejection. |

Scope is BTP CF hosting and on-premise SAP through Cloud Connector. This does not add direct
OIDC/API-key multi-target writes, shared-Basic writes, BTP ABAP/Public Cloud target authentication,
SaaS, RFC/ABAP execution, or single-target parity. Mixed Basic deployments retain their existing
one-instance limitation. Route/client identity is not SAP repository isolation: ABAP repository
objects are cross-client. Use a designated development client per physical repository.

## 2. Complete shipped mutation surface

| Action | Supported inputs and behavior |
|---|---|
| `SAPWrite.create` | One CLAS or INTF, explicit package and source. Local or transportable package. Save inactive source; activation is separate. |
| `SAPWrite.update` | Existing CLAS/INTF main source, mandatory `expectedSourceHash` from the complete editable source. |
| `SAPWrite.edit_method` | Existing CLAS main-source method body, mandatory hash of the complete editable source being locked and spliced. |
| `SAPActivate` / `activate` | One explicit CLAS/INTF owner, with preaudit. Activates the complete owner and all existing inactive includes/drafts. |

No delete, include editing, batch, method addition/deletion/signature/visibility change, unit-test
surgery, RAP/DDIC, package management, publication, FLP/UI5, tracing, Git or transport management.
Those are separately deferred capabilities, not unfinished parts of #1080. Runtime must reject
meaningful unsupported fields even if the client retained an old tool catalog. Reject a supplied
`target` on pinned writes, explicit preaudit=false, caller URIs, and derived local-class include
methods (`lhc_*`, `lcl_*`, `ltc_*`). Normalize omitted activation action before scope/deny/audit checks.
Schemas expose only the scoped fields and carry readOnly=false, destructive=true, idempotent=false.

## 3. Destination and server policy

| Destination property | Contract |
|---|---|
| `arc1.allow_writes` | Absent=false; true/false only. Invalid enabled destination is quarantined. |
| `arc1.allowed_packages` | Required when writes are requested, even while the global switch is off. Bounded ASCII CSV, no empty members, at most 128 entries / 8192 characters / 128 per member. Exact names, prefix `Z*`, subtree `ZROOT/**`, or explicit `*`; case normalized. |
| `arc1.allowed_transports` | Absent means no CTS-bound object writes. Same CSV bounds; exact canonical request IDs, prefixes or explicit `*`. No subtree syntax. Authorizes parent requests and their SAP-managed tasks. |
| `arc1.allow_transport_writes`, `arc1.allow_git_writes` | Unsupported; quarantine enabled destination. They do not ship in this scope. |

A valid list alone never enables writes. Supplied lists are validated even when destination writes
are off. Basic write requests are quarantined. In standard authorization mode, write-related
properties quarantine the affected destination, never the whole process or an independent `/mcp`.
Unknown properties continue to fail closed. Supported values participate in drift fingerprints.

`SAP_ALLOWED_PACKAGES` is checked independently from the destination list, including subtree
resolution; resolver errors deny. Global empty-list legacy semantics do not bypass the explicit
destination constraint. Existing-object checks use the real owner package, again under the editing
lock, and reject package changes. Reads are unaffected. `SAP_ALLOWED_TRANSPORTS` and the destination
transport list both constrain the canonical CTS request. Ordinary object recording does **not**
require `SAP_ALLOW_TRANSPORT_WRITES`; that flag remains for transport management, which is unavailable
on these routes. Global deny actions and data/SQL/blocklist policies still apply. Carry global lint
configuration and advisory SAP syntax-check configuration into the target runtime; callers cannot
disable these through unsupported per-call write options.

Diagnostics expose bounded configured/effective flags, counts, digest and denial reason. Do not
copy raw package/transport arrays into every catalog row. Preserve the 512 KiB catalog envelope
at 256 targets and secret-safe behavior. Configuration diagnostics must explain global-off,
destination-off, Basic, standard mode, missing/invalid write grant and missing raw scope distinctly
without leaking ungranted target existence to ordinary callers.

## 4. Verified identity and grants

Use the auth package's verified and allowlisted attributes, never decoded JWT data or caller args.
Extract both `arc1_targets` and `arc1_write_targets` with the existing shared extraction bound.
Malformed write-only data denies writes; extraction-wide overflow invalidates both. Write grants
use the existing bounded exact-ID parser but reject `*`, CSV, globs and Unicode folding. Read `*`
remains valid. Unknown exact IDs are inert, not automatic errors or discovered inventory.

Capture raw scopes immediately after verification, before admin expansion. Admin-only raw scope
must not create write permission. MCPAdmin includes raw write scope but still needs the exact write
attribute and access grant. Build an immutable projection per HTTP request; both tools/list and
calls use it. Read A/B plus write A must never expose/execute write B. Deny before per-user
Destination lookup when grants/scopes/route prohibit the action. No token/claim cache may broaden it.

Add an `arc1_write_targets` attribute and `MCPTargetDeveloper` role template with read/write scopes
and both attributes to xs-security. No prepopulated broad role collection. Administrators create
concrete roles with exact values and assign them through collections. BTP CLI creation was verified
live; document it together with Cockpit steps. Updating the service descriptor alone grants nothing.
Existing deployments keep their read behavior and gain no write access spontaneously.

Role removal is not an immediate revocation guarantee. Earlier live evidence showed old refresh
sessions retaining old assignments. Require a fresh authorization flow and verify resulting claims;
for immediate disable use server/destination policy and restart all app instances. Backend remaps
require new public IDs and grants. Do not claim token expiry alone resolves retained refresh grants.

## 5. Local and CTS protocol

Preflight must affirm result S, exact package and operation. Locality requires affirmative local
and delivery-unit evidence, no CTS owner, and no contradictory recording flag; neither `$` prefixes
nor `recording=false` alone prove locality. Explicit CTS input on a local object is rejected.

For nonlocal writes, require a caller-selected or already-recorded request; never pick an arbitrary
candidate. Resolve request/task IDs from SAP and verify exact tree membership. A task maps to one
modifiable Workbench parent; canonicalize corrNr to that parent before create/save. Validate both
policy lists against the parent, including lock-derived parents. A request grant intentionally
covers SAP-managed child tasks; a task-only allowlist entry does not authorize its parent. Reject
missing, ambiguous, closed, mismatched or unresolved recording evidence before mutation.

Live evidence changed the original parent-plus-task policy: SAP accepted a task during creation
but rejected it during source save, leaving a stub. Canonical request policy matches the actual
wire protocol and avoids requiring administrators to predict SAP-created task IDs. Both CLAS and
INTF succeeded using the canonical parent, with allowTransportWrites=false for object writes.

## 6. Mutation and activation lifecycle

Use a dedicated scoped write orchestrator to keep general single-target paths unchanged, while
reusing package, source-hash, lint, syntax, XML, session and activation primitives. Every multi-target
runtime carries an explicit read-only or enabled write policy through server config into ADT safety;
missing context must not silently select a legacy write path. Both runtime factory call sites need
route and verified projection input. Shared package primitives enforce both constraints, including
when the global list is empty.

Update/edit flow: validate inputs → real package and CTS preflight → owning stateful lock → reread
package and recording evidence → validate lock locality/CTS → fresh editable main source/hash →
splice if requested → lint/advisory syntax → PUT → content read-back → bounded unlock/session close.
SAP LF/CRLF and terminal line-break normalization are allowed; all other source differences are incomplete outcomes.
Return the hash of SAP's actual editable bytes, never the submitted representation.
Creation runs package/recording/lint checks before metadata POST, then the same locked save checks.
Omit responsible so SAP assigns the qualified PP identity. Never copy a JWT email into that field.

Disable transient, auth/session-reset, CSRF and negotiation replay for the scoped mutation session.
Cancellation stops subsequent unsent phases. Unlock uses the owning session and an independent
bounded cleanup budget; cleanup errors must not replace the primary outcome. A failed create/save
may leave a stub or saved draft. Return explicit unchanged/partial/unknown states and retryable=false,
including minimal-error mode; generic multi-target 5xx retry advice must not overwrite them.
The source hash protects byte freshness only, not target identity or prior user intent.

Activation authorizes the complete initial owner before the first preaudit POST (which may itself
activate). Require a validator at the low-level multi-target activation boundary; missing validation
and batch/recovery paths must refuse. Before confirmation, permit only the exact requested owner
and known same-owner CLAS include URI mappings, recheck package/recording, and reject extra owners,
absolute/cross-origin/query/fragment/unknown references. No prefix-only authorization. Preserve the
activation deadline and no-replay policy. On this scoped path, require a SAP checklist with
positive activation-execution evidence before reporting success, including after confirmation;
empty/unknown/non-executed responses are uncertain results. Legacy single-target parsing stays unchanged. The tested SAP system completed initial preaudit without
an expanded prompt; controlled wire fixtures must test confirmation refusals and allowed mappings.

Audit caller, target/identity, action/object, denial and outcome with existing correlation and
redaction. Audit Log delivery remains asynchronous; monitoring is required. Durable-before-write
audit admission is separate work and must not be claimed by this change.

## 7. OAuth, documentation and operations

Aggregate metadata stays mutation-free. Pinned PRM advertises write only from global write opt-in
and target-filtered mode, using route syntax rather than destination inventory/grants. A resource
URL does not bind an XSUAA token to one backend. Test fresh pinned read/write authorization and
read-only tokens with a real MCP client; explicitly document reconnection/fresh tools/list after
role/config changes. Do not claim transparent scope step-up based solely on a tool error.

Public guide: short read-only vs writable route table; one writable + one read-only target recipe;
server/destination/IAM precedence examples; local and CTS examples; role creation; allowed operations;
whole-owner activation; common denial diagnostics; policy changes/restart; immediate disable and
rollback. Preserve existing Basic/operator documentation and label all remaining restrictions.
No new beta version/profile or second write enable flag.

## 8. Implementation and acceptance sequence

1. Preimplementation PP/XSUAA/ADT qualification and adapt this plan (evidence linked above).
2. Destination grammar/fingerprint, independent package/CTS policies, verified raw scope/exact grant.
3. Pinned surface, scoped mutation lifecycle, activation validation and bounded diagnostics.
4. Focused negative/positive unit and HTTP tests, schema budget and documentation examples.
5. Deploy the frozen artifact to the isolated reused test app; qualify the full local **and** CTS
   scope over MCP, including read A/B + write A, read-only token, aggregate/alias/Basic denials,
   disallowed package/request, stale hash, real PP author, activation/read-back and cleanup.
6. Review evidence and limitations, run full checks, independent Claude Code Opus 5.5 max review,
   address findings, retest, update this PR and report readiness. No merge/release is implied.

Required regression matrix: global/destination off; malformed/write properties in standard mode;
empty/global/destination package restrictions and hierarchy failure; raw admin-only and wildcard
write grants; expired/wrong-app/service tokens; two-user/two-target isolation; supplied pinned target;
hidden types/actions/fields; omitted activation deny; local-vs-CTS ambiguity and task canonicalization;
under-lock package/recording drift; stale/missing hash; create/save/activation uncertainty; no replay;
cancellation/cleanup; foreign preaudit refs; destination remap; maximum catalog; shared budgets;
unchanged single-target, aggregate reads and Basic lockout behavior.

Run focused tests, full unit suite, typecheck, lint, validate:policy, build, check:sizes, docs:build,
schema budgets and changed MTA/example validation. Record actual results, not only intended checks.
Live acceptance is distinct from mocks: frozen artifact, real PP, SAP metadata author, tested MCP
client/protocol, role sets and cleanup. Repeat refresh-revocation evidence where practical. A docs
build is not an operator usability test; walk the public recipe and record unresolved limitations.

## 9. Review status

The [implementation review and dispositions](../research/multi-target-pinned-writes/claude-implementation-review.md)
record the broad review, live-driven follow-up and final review. All scoped features shipped together
in this PR; broader mutations remain FEAT-93, not an unfinished beta stage. Live and automated checks
and their precise limitations are recorded in the linked qualification evidence. No merge/release
is implied by completion of implementation and review.
