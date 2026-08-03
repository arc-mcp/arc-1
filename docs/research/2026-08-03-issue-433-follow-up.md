# Issue #433 follow-up: CTS tooling improvements

Date: 2026-08-03

Issue: <https://github.com/arc-mcp/arc-1/issues/433>

Targets used for live checks: NW 7.50 SP02, SAP_BASIS 758 SP02, and SAP_BASIS 816; the mutation
spike was confined to the A4H 758 development system.

## Executive recommendation

The ticket mixes one shipped feature, one real parser defect, two useful but safety-sensitive
features, and several ideas that should either be narrowed or rejected.

| Proposal | Recommendation | Priority | Reason |
|---|---|---:|---|
| Return release-check reports | Done | — | Shipped by #514/v0.9.21 and subsequently hardened. |
| Add create/modify to `check` | Implement, together with the parser fix | P0 | The ADT contract distinguishes insert (`I`) from modify (empty), but the larger problem is that ARC-1 does not parse the real 7.58 response structure. |
| Ignore ATC during release | Implement only as an explicit two-phase override | P2 | Legitimate when SAP policy permits it, but the endpoint requires a fresh preceding check and must not be a blind boolean on normal release. |
| Ignore locks during release | Do not expose by default; consider a separately gated expert action | P4 | Live endpoint works, but bypassing locks can export an inconsistent intermediate state. |
| Idempotent `create` | Implement only with an explicit caller key | P2 | Matching descriptions is ambiguous. A stable key plus a SAP-visible marker provides useful retry recovery. |
| “Self-contained request” check | Do not promise this; optionally build an advisory dependency report | P3 | Source references are not the CTS closure and ARC-1 cannot know the target system baseline in normal single-target mode. |
| More compact responses | Done for the main problem | — | #583 added compact JSON, list summaries, and bounds. A compact `get` mode is optional follow-up, not urgent. |
| Parallel recursive delete/reassign | Defer until latency is measured | P4 | Few tasks are typical; parallel SAP mutations add enqueue/order and partial-failure complexity. Keep release sequential. |
| ABAP helper using `TR_OBJECTS_*` | Reject for core; retain as an optional customer plugin fallback | P4 | Eclipse ADT exposes REST relations for the relevant workflows. A helper would add an installed SAP component, unreleased API dependency, and a larger mutation surface. |

The best next increment is therefore not an override feature. It is a small, well-tested
`transportchecks` contract correction plus an explicit create/modify selector.

### Second-pass implementation decision

A second read-only pass on 2026-08-03 compared the private ADT response across NW 7.50 SP02,
SAP_BASIS 758 SP02, and SAP_BASIS 816. All three use the `REQUESTS`/`LOCKS` family documented below;
816 adds fields but does not change that structure. The reviewed implementation plan is
[`docs/plans/2026-08-03-issue-433-transport-check-correctness.md`](../plans/2026-08-03-issue-433-transport-check-correctness.md).

This PR-sized implementation deliberately covers parser correctness, create/modify selection,
bounded candidate output, and the inaccurate request-kind documentation. The other P2/P3 proposals
remain separate because their safety and cross-system contracts are not prerequisites for this fix.

### Transport-review semantics follow-up

The corrected candidate parser exposed a user-facing ambiguity in the legacy
`SAPTransport(action="history")` contract. The standard ADT endpoints do not provide complete object
transport history:

- `GET {objectUrl}/transports` returns the current parent request lock, at most one request;
- `POST /cts/transportchecks` returns modifiable requests the object could be assigned to;
- those candidate requests do not contain the object and are not history/conflict evidence;
- complete membership history requires E071/E070 access, as already recorded under FEAT-49.

This distinction matters more after the parser fix because real candidate lists are now visible. A
transport-review or overview skill that treats them as prior transports can manufacture false
import-order conflicts.

A read-only 758 manifest spike also found 299 CTS entries across 58 visible draft requests and 32
distinct `pgmid/type/wbtype` shapes. Alongside direct `R3TR/CLAS`, `R3TR/DDLS`, and similar entries,
the payload contained `LIMU/METH`, `LIMU/REPS`, `LANG/DTEL`, packages, and metadata-only types. The
transport-reference endpoint successfully resolved representative entries to canonical ADT URIs:

| CTS entry | Resolved ADT collection |
|---|---|
| `R3TR/CLAS` | `/sap/bc/adt/oo/classes/...` |
| `LIMU/METH` | owning `/sap/bc/adt/oo/classes/...` |
| `LIMU/REPS` | `/sap/bc/adt/programs/includes/...` |
| `LANG/DTEL` | `/sap/bc/adt/ddic/dataelements/...` |

That endpoint is useful for a future first-class transport-diff aggregator, but it is not currently
exposed as an MCP action. The shipped skills must therefore diff only safely resolved direct
repository objects, fold subobjects only when the parent is unambiguous, and label unresolved
coverage instead of guessing. A separate transport-level diff should add canonical URI resolution,
deduplication, snapshot-confidence labels, structured aggregation, and output bounds.

## Current implementation status

### Release reports are already implemented

PR [#514](https://github.com/arc-mcp/arc-1/pull/514) added parsing and surfacing of the
`newreleasejobs` report. Current code goes further:

- `releaseTransport()` returns all parsed release reports.
- a failed report is an error even when the HTTP request itself succeeded;
- recursive release treats the parent report as authoritative;
- the ED064-like “report failed but request is now released” race is reconciled with a fresh read;
- inactive objects are checked before release to avoid the SAP release pipeline hanging.

No further ticket item is needed merely to “return the check result”. More detailed report text may
be useful if a real backend response proves that ARC-1 drops data, but that should be driven by a
captured fixture rather than speculation.

### Token controls are also substantially shipped

PR [#583](https://github.com/arc-mcp/arc-1/pull/583) added compact JSON, bounded results, and a
summary transport list. Repository measurements recorded a roughly 37% reduction for transport
output. The current list summary omits the recursive object tree and defaults to 50 results.

This reduces model tokens, not SAP response time: ARC-1 still downloads the full tree. A future
`get` option such as `includeObjects=false` could be useful when a caller needs only header/status,
but it should not precede the correctness work below.

## P0: fix `transportchecks`, then add the operation selector

### Finding: the current parser does not match the live response

ARC-1 currently searches for:

- available requests under `TRANSPORTS/headers`; and
- an object lock under `LOCKS/HEADER`.

On A4H 758, a check of an object already locked in CTS returned the ABAP XML structure:

```text
DATA
├── KORRFLAG = X
├── RECORDING = ""
├── RESULT = S
├── REQUESTS
└── LOCKS
    └── CTS_OBJECT_LOCK
        └── LOCK_HOLDER
            ├── REQ_HEADER / TRKORR = A4HK906279
            └── TASK_HEADERS / TRKORR = A4HK906280
```

The third-party ADT client cited by the issue also parses `REQUESTS`, `LOCKS`, and `REQ_HEADER`, not
ARC-1's current `TRANSPORTS/headers` structure. As a result, ARC-1 can miss both candidate requests
and an existing lock. The current handler can then interpret blank `RECORDING` as “no transport
needed”, even though `KORRFLAG = X` and a lock holder is present.

### Finding: the operation flag is real but did not change sampled 758 outcomes

ADT sends:

- create/insert: `OPERATION = I`
- modify: `OPERATION = ""`

ARC-1's low-level function already accepts this value, but `SAPTransport action=check` always sends
`I`. Live comparisons on several existing and missing custom objects returned the same high-level
recording result for both values on this 7.58 system. That does not make the flag redundant: it is
part of the backend contract, may matter by object type/release, and is cheap to model correctly.

Read-only follow-up calls confirmed the surrounding response contract on 7.50 and 8.16 as well:

| Release | Scenario | Key result |
|---|---|---|
| 7.50 SP02 | `$TMP`, missing class | local package; empty request/lock containers |
| 7.50 SP02 | `ZLOCAL`, missing class | `RECORDING=X`; same top-level request/lock fields |
| 7.58 SP02 | locked interface | parent request and child task under the live lock-holder shape |
| 8.16 | `$TMP`, missing class | local package; additive `RECORD_CHANGES` field |
| 8.16 | `ZLOCAL`, missing class | `RECORDING=X`, one request under `CTS_REQUEST/REQ_HEADER` |

The 7.50 result also proves `KORRFLAG` cannot be the sole transport-requirement signal: it was empty
while `RECORDING=X`.

### Proposed implementation

1. Add `operation: "create" | "modify"` to the `check` schema and tool definition. Default to
   `create` for backward compatibility; map to `I` and empty string at the handler boundary.
2. Replace the response parser with a release-tolerant parser that supports the live structures:
   - candidate requests from `REQUESTS/CTS_REQUEST/REQ_HEADER`;
   - lock owner/request from `LOCKS/CTS_OBJECT_LOCK/LOCK_HOLDER/REQ_HEADER`;
   - task headers where useful;
   - retain old aliases only when backed by a real fixture/release.
3. Preserve `KORRFLAG`, `RESULT`, and backend messages in the structured result, or at minimum use
   them when building the summary.
4. Use summary precedence: existing lock, local package, recording required, candidate requests,
   then no-recording-needed. Never infer “local/no CTS” from blank `RECORDING` alone.
5. Add a sanitized 7.58 response fixture. The existing unit test's simplified
   `TRANSPORTS/headers` and `LOCKS/HEADER` fixture entrenches the wrong shape.

Suggested tests:

- create and modify map to `I` and empty `OPERATION`;
- locked object returns the parent request and task;
- candidates under `REQUESTS` are returned;
- `KORRFLAG=X`, blank `RECORDING`, and a lock never produces “no transport needed”;
- local package remains local;
- empty collections and optional nodes remain safe on 7.50/7.58/8.16 fixtures.

## Release overrides

### Live endpoint results

Both action resources require a transport-manager XML body. An empty POST was rejected with HTTP
400 because the backend expected the `tm:root` element.

With a minimal body containing the action and request ID:

| Action | Result on A4H 758 |
|---|---|
| `relwithignlock` | HTTP 200; request released. The deliberately retained evidence request is `A4HK906365`. |
| `relObjigchkatc` | HTTP 200 but report state `relobjchkobs`: the object check was outdated and release had to be relaunched. Request remained modifiable and was deleted. |

Three other disposable requests from the spike were also deleted. CTS cannot undo a successful
release, so `A4HK906365` remains in released state with an issue-433 spike description.

### Eclipse ADT behavior explains the ATC result

Inspection of the installed Eclipse ADT 3.60 transport model shows that release is stateful. Its
release service obtains a release timestamp, action, lock handle, and worklist-derived content, then
asks the transport model to generate the release-object XML posted to the chosen action URI. It also
exposes a distinct `preparerelease` relation.

Therefore `relObjigchkatc` is not a stateless equivalent of `ignoreATC=true`. It is a confirmation
step tied to a fresh preceding release/object check. The popular `abap-adt-api` implementation uses
two booleans and selects the endpoint directly; when both are true, ATC silently wins. ARC-1 should
not copy that API shape.

SAP's public CTS API similarly models “ignore noncritical object-check issues such as ATC findings”
as an explicit confirmation. SAP also recommends an explicit ATC run before transport release, and
system policy decides whether developers may override findings. See:

- [Correction and Transport System (XCO)](https://help.sap.com/docs/sap-btp-abap-environment/abap-environment/correction-and-transport-system)
- [Launching ATC Check Implicitly](https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_752/c238d694b825421f940829321ffa326a/d6ccb9bbafd44eb7bf9564e18b699112.html)
- [Setting Up ATC Transport Checking](https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_752/ba879a6e2ea04d9bb94c7ccd7cdac446/40c14df0a883467bb90ef5a70cee7cc2.html?version=7.52.11)

### Safe API design

Do not add `ignoreATC` and `ignoreLocks` booleans to normal `release`. Use policy-visible actions,
for example `release_ignore_atc` and (only if accepted) `release_ignore_locks`, so an administrator
can deny one independently with `SAP_DENY_ACTIONS`.

An override should:

1. be disabled by a new server-wide gate such as `SAP_ALLOW_TRANSPORT_RELEASE_OVERRIDES`;
2. perform/refresh the ordinary release check first;
3. allow only the override corresponding to the current overridable report;
4. bind the confirmation to transport, SAP user, action, and fresh report timestamp/digest;
5. reject stale, changed, already-released, or mismatched state;
6. emit a dedicated audit event including the blocker that was overridden;
7. never let an API-key/user scope expand the server ceiling.

For an MCP-friendly one-call flow, the server can perform the first phase and return a short-lived
opaque confirmation token. The second call supplies that token to the specific override action. A
single call that automatically retries with an override would erase the deliberate confirmation
boundary.

ATC override is useful under this design. Lock override is much harder to justify. SAP documents
that manually inserted objects initially lack locks and conflicts are checked during release; the
lock preserves a defined intermediate state. See [Including Objects in a Request Manually](https://help.sap.com/docs/SOFTWARE_LOGISTICS_TOOLSET_CTS_PLUG-IN/05c12df5b54849c49940a14bc089d8b4/5738e2864eb711d182bf0000e829fbfe.html?locale=en-US).
Unless a concrete administrator workflow requires it, omit `release_ignore_locks` from core.

## Idempotent request creation

The problem is real: the POST may commit in SAP while its response is lost, so a blind retry creates
a second request. Transparent matching by owner and description is not safe because request texts
are not unique, similar requests are legitimate, and concurrent agents can race.

### Recommended contract

Add an optional `idempotencyKey` to `create`:

- no key: retain current behavior and always create;
- key: scope it to SAP system/client, authenticated principal, request type, target, and key;
- derive a short hash and place a recognizable marker in the SAP request text (within the CTS text
  length limit), while keeping the human description readable;
- before POST, list the caller's modifiable requests and look for that exact marker;
- exactly one match: return it with `created: false, recovered: true`;
- multiple matches: fail closed and return their IDs;
- no match: serialize same-key creates in-process, create, then verify the marker.

A persistent local ledger alone cannot provide exactly-once semantics: a process can crash after SAP
commits but before the ledger is updated. A SAP-visible marker survives that window and server
restarts. In-process singleflight prevents duplicates within one instance, but cross-instance
exactly-once still cannot be guaranteed without a shared coordination store or a backend uniqueness
primitive. The documentation should call the feature retry recovery, not absolute exactly-once.

Do not silently alter descriptions when no key was provided, and do not reuse requests based only on
description equality.

## “Self-contained transport” validation

The proposed guarantee cannot be implemented honestly from the current data:

- ABAP where-used/code intelligence is predominantly reverse-reference data, not a complete forward
  deployable closure.
- ARC-1's AST dependency extraction covers useful static references, but not dynamic calls,
  generated artifacts, customizing/table contents, UI repository artifacts, or every R3TR/LIMU
  mapping.
- a referenced custom object missing from this request may already exist in the target system and
  therefore be correct;
- avoiding target-system RC8 requires target version/baseline knowledge. Normal ARC-1 is deliberately
  single-target, and the experimental multi-target mode is not a general cross-system dependency
  verifier.

### Useful narrowed feature

If users ask for it, add an advisory `readiness`/`dependency_check` action that:

- inventories objects and tasks in the request;
- extracts one-hop forward custom dependencies for supported source-bearing types;
- resolves the corresponding TADIR object keys where possible;
- classifies each reference as in-request, present-on-source, unresolved, SAP standard, dynamic, or
  not checkable;
- reports coverage and limitations prominently;
- never blocks release automatically.

Target-aware validation should be a separate future design requiring an explicit read-only target
and identity. It must compare target existence/version rather than treating “not in this request” as
an error.

In the near term, the stronger readiness sequence is already available: activate all objects, run
syntax/unit/ATC as applicable, reject inactive members, and return the authoritative SAP release
report.

## Recursive mutation and result size

Keep task release sequential. Parent release depends on task state, and the current ordering makes
failure recovery understandable.

Do not parallelize recursive delete/reassign without measurements. SAP enqueues and hierarchy
changes make bounded concurrency more complicated than a normal read fan-out, and most requests
have few tasks. If telemetry later shows material latency, use a small bounded pool with
`Promise.allSettled`, preserve per-task results, and mutate the parent only after every required child
succeeded. There is no evidence in this spike of a REST batch endpoint for these actions.

For output size, keep the compact list default. Consider `includeObjects=false` or a summarized
object count for `get` only after measuring a real model workflow that is still too large.

## Transport of copies and object-list copying

Do not begin with an ABAP wrapper around `TR_OBJECTS_CHECK` / `TR_OBJECTS_INSERT`.

The installed Eclipse ADT transport client advertises REST relations/actions for:

- `addobject`
- `addobjectfromrequest`
- `addobjectsfrompackage`
- `moveobjects`
- `merge`
- `preparerelease`

Its model also includes `ITransportofCopies` and a backend capability flag
`TransportOfCopiesCreationSupported`. This is strong evidence that the first spike should capture
the ADT REST requests for creating a transport of copies and copying an object list. Following the
relations returned by SAP is preferable to hard-coding guessed paths.

Suggested REST spike:

1. create a disposable Workbench request and task;
2. capture Eclipse's ToC creation request, media type, response, and feature flag;
3. capture `addobjectfromrequest` with and without documentation;
4. capture package addition, merge, and move only as needed;
5. replay on 7.50, 7.58, and 8.16; discovery-gate each relation;
6. determine package allowlist semantics from the source objects' real packages;
7. define per-action write policy and audit events before exposing anything to MCP.

Also correct the tool text while doing this: ARC-1's current create path always creates a Workbench
(`K`) request. A separate tool-description branch still claims that the backend infers K/W/T; that is
not the live behavior and should not be used as justification for ToC support.

### Optional helper fallback

If a required classic on-prem workflow truly has no ADT or released XCO surface, keep an ABAP helper
outside ARC-1 core:

- customer-installed and customer-owned;
- on-prem only, using a versioned and documented wrapper contract;
- invoked through a local ARC-1 plugin with `SAP_ALLOW_PLUGIN_EXECUTE=true`, `SAP_ALLOW_WRITES=true`,
  a write-scoped custom tool, package controls, authorization checks, and audit;
- never auto-deployed and never used as a principal-propagation fallback.

This preserves ARC-1's zero-footprint REST core and makes the dependency on unreleased classic APIs
an explicit administrator choice.

## Proposed issue split

1. **P0 — fix CTS transport-check parsing and add create/modify operation**
2. **P2 — explicit idempotency key for transport creation**
3. **P2 — design two-phase ATC release override with a separate safety gate**
4. **P2 — REST spike for ToC creation and `addobjectfromrequest`**
5. **P3 — advisory transport readiness report**, only if user demand justifies its incomplete coverage

Close the original release-report and token-size bullets as completed. Defer lock override,
parallel recursive mutations, and a core ABAP helper unless a concrete workflow and live evidence
change the risk/value balance.

## Evidence and limitations

- Read-only transport-check contract calls were verified on SAP_BASIS 750, 758, and 816. The
  release-override mutation spike was performed only on A4H SAP_BASIS 758 SP02.
- The installed Eclipse ADT model was version 3.60; class inspection established action relations and
  stateful release payload generation, but is not a public stability contract.
- Sanitized 758 candidate and lock-holder fixtures cover the private response structure in unit
  tests; the implementation was then rechecked read-only across the 750/758/816 release matrix.
- No production objects were changed. Four disposable CTS requests were created: three were deleted;
  one was deliberately released and is terminal by CTS design.
