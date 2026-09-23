# Publish feedback: live reproduction and separate create retry risk

> Historical investigation (2026-09-17): the automatic retry discussed here was removed
> after independent review. See [the final design](../plans/2026-09-16-publish-recovery.md)
> for current behavior; retain the live evidence and separate create/retry findings below.

Reviewed 2026-09-17 against PR #795 revision `b156f805`.

## Findings and scope

PR #795 is a narrow recovery measure for the reported English BTP V4 version `0001`
missing-inbound error. It does not establish or repair the SAP backend cause. Nine new
ordinary first publications succeeded on SAP_BASIS/SAP_CLOUD 920 SP04. A deliberately absent
owned SCO2 exercised the new retry path live and correctly remained an error after one retry.
The naturally transient customer case and the separate SRVB activation error remain
unreproduced on this tenant.

A separate controlled experiment demonstrated a create replay problem in the existing HTTP
transport. If SAP creates an SRVD but a 503 replaces its successful response, ARC-1 repeats
the create POST. SAP then reports that the object already exists, while the follow-up source
write never occurred. This supports investigating the customer's create-shell report; it
does not prove that a 503 occurred there. The live control returned HTTP **400**, not the
customer's reported **409**, and a malformed-definition activation error, not the reported
missing-inactive-version error.

The existing manual SRVD-activation and create-shell workarounds are unaffected by #795.
No automatic reactivation, recreation, broader error matching, or transport-policy change
was added during this investigation.

## Bounded live test matrix

All test objects belonged to one disposable package. Tests used the actual PR build,
personal OAuth, the normal tool dispatcher and package gates. Physical ADT sends and response
bodies were recorded locally without authorization/cookie headers. Fresh names were checked
before creation. A raw first publish error could not be hidden by a successful recovery.
The exposed entity was a small flat CDS view over `I_Language`; the customer's actual entity
source and network topology were not available. Both reports identify release 920 SP04.

| Case | Repetitions | Result |
|---|---:|---|
| Baseline create, activate, publish | 1 | One POST; explicitly published; tool duration 81.315 s |
| Publish immediately after activation | 2 | One POST each; start delay 0.679 / 0.614 s |
| Wait ten seconds before publishing | 2 | One POST each; start delay 10.938 / 10.941 s |
| Identical SRVD update, then activate and publish | 2 | One POST each; explicitly published |
| Fresh HTTP client after activation, same OAuth identity | 2 | One POST each; explicitly published |
| Delete own generated SCO2 before first publish | 1 | Exact missing-inbound error twice; explicitly unpublished; no third POST |

The supplied customer example has 10.011 seconds between the first error response and the
next tool invocation; this does not establish a universal synchronization interval. In the
investigated backend path, SCO2 is the inbound service and SIA6 is the derived IAM app.
ARC-1 sends its configured language as `sap-language`; browser logon language alone does
not determine the ADT response language.

The eight variant tool durations were 45.058–52.308 seconds. The forced missing-SCO2 tool
call took 12.644 seconds. A new HTTP client neither proves a different SAP application server
nor reproduces the customer's network path. These are bounded negative reproduction results,
not proof that timing, session routing or buffering cannot explain the customer incident.

## Controlled create response loss

Six loopback spikes used ARC-1's real HTTP transport against a synthetic upstream:

| Injected condition | Observed behavior |
|---|---|
| Create persisted; response replaced with 503 | Two create POSTs; synthetic backend returns 409 on the duplicate |
| Create persisted; response replaced with 502 | One POST; original 502 remains |
| Create persisted; response connection drops | One POST; network error remains |
| Publish returns gateway 502 or 504 | One POST each; HTTP error remains; no invented SAP missing-inbound message |
| Create persisted; 503 with local no-replay prototype | One POST; original 503 / unknown completion remains |

The live control then used a fresh owned SRVD and replaced exactly one actual successful
201 response with a **synthetic** 503 inside the local test harness. SAP itself did not return
that 503. The unmodified ARC-1 transport replayed the collection POST, and real SAP responded
400, `Resource Service Definition <name> does already exist`. The inactive source read was
empty; activation failed with `Illegal syntax. Malformed service definition`. Explicit source
update followed by activation succeeded and the exact active source was read back.

A second fresh SRVD repeated the injected response-loss scenario with a local guard
prototype that stops before the generic replay. Exactly one create POST occurred; the
original synthetic 503 remained visible. The shell still existed, as expected after the
successful backend create. Explicit update and activation again completed successfully.
Preventing replay does not undo the first write or by itself complete the two-step create.

One further finding: the generic 503 error hint still advises waiting and retrying, even when
the guard's error says create completion is unknown. A production fix must address both the
transport policy and that user/model-facing hint; otherwise callers may manually repeat the
same unsafe create.

## Possible separate fix

The existing `src/adt/http.ts` 503 branch retries all methods on the assumption that ICM
rejected the operation before execution. A generic 503, especially from an intermediary,
does not establish that. HTTP permits automatic repetition of non-idempotent operations only
with knowledge that their semantics allow repetition or that the first attempt was not
applied. See [RFC 9110 section 9.2.2](https://httpwg.org/specs/rfc9110.html#idempotent.methods).

Recommended next work, in a separate transport change:

1. Inventory the retry branches and affected call sites, including 429 and the specific
   database-session retry. Classify writes by their actual replay semantics; some ADT reads
   also use POST, so a method-only rule can be unnecessarily disruptive.
2. Stop automatically replaying non-idempotent creates after ambiguous availability failures.
   Preserve the original status and an explicit unknown completion outcome. Keep safe read
   retries and verified rejection-based authentication/CSRF/MIME negotiation behavior.
3. Make ambiguous-write hints request-aware: inspect actual identity, package and source
   before deciding whether to update. Never turn an arbitrary conflict into an overwrite.
4. Keep regression controls for commit-then-503, rejection-before-execution, response loss,
   safe reads, denied writes, cancellation and budgets. Verify both physical send counts and
   persistence, not merely the final HTTP status. Repeat the controlled BTP test.

The local no-replay wrapper is only a spike, not the proposed production architecture. It
demonstrates that avoiding the replay prevents the duplicate-conflict symptom, but leaves
reconciliation and error guidance to implement and review.

## What would distinguish the remaining causes

For the next **naturally occurring** incident, preserve the failed first request before
performing a workaround. Capture UTC start/end times, installed ARC-1 version/revision,
configured language, exact SRVD/SRVB versions and names, raw ADT status/body, and the physical
HTTP sequence including internal retries. Redact credentials, cookies, tokens and private
URLs before sharing.

For the publish case, read active publication state and the generated SCO2 immediately after
failure and after the single retry. If buffering or routing is suspected, a SAP owner needs
to correlate those times with backend message/trace and application-server identity; our
client responses did not expose an application-server correlation. A new client alone is
insufficient. For the create case, look specifically for an earlier 503 and duplicate
collection POST. For `Usage of <SRVD> not permitted`, retain the activation response and
SRVD active source/state before reactivating it.

A proxy can lose or replace a response; the controlled tests demonstrate one consequence.
They do not establish the customer's proxy involvement and cannot explain a structured SAP
missing-inbound message solely from a gateway timeout. Prior inspection of the SCO2 read and
table-buffer configuration remains a backend hypothesis, not an identified root cause.

## Cleanup

All nine published test bindings were explicitly unpublished and their unpublished state
confirmed before deletion. All 23 created source/binding objects were then deleted: ten SRVBs,
twelve SRVDs and one CDS view. Direct object reads returned 404 for every one. The twenty known
generated SCO2/SIA6 active-object endpoints also returned 404.

The reused disposable package remains. SAP still rejects its deletion with the pre-existing
PAK 051 error saying it contains development objects or packages. A namespace search returns
only the package, but that is not a complete backend object-directory inventory. No forced
deletion, direct database repair, buffer changes or wider package access was attempted.
