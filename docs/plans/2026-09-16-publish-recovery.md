# Bounded recovery for the BTP V4 missing-inbound publish error

## Evidence and scope

A customer reports that repeating an unchanged BTP OData V4 UI publish succeeds after
`Local Publish of <name> failed` / `Inbound service <name>_0001_G4BA does not exist`.
The timed customer example included approximately ten seconds between attempts.
Our SAP_BASIS/SAP_CLOUD 920 SP04 investigation found six normal first-attempt successes.
A controlled deletion of our own generated SCO2 reproduced the exact AS-XML error,
but neither a ten-second retry nor reactivation restored that missing object.
Active metadata still reported `bindingCreated=true`. This is recovery for a specific
failure, not a claim that the backend root cause or readiness delay is known.

No new tool fields, schema descriptions, user configuration, unpublish behavior,
object creation, automatic activation, or background work. No SAP source or credentials
in the patch. Existing normal publish and other error paths retain their behavior.

## Implementation plan

1. Only enter recovery for a confirmed BTP target, the V4 endpoint, requested version
   `0001`, and exact structured `PublishResult` severity/short/long text for this binding.
   The generated V4 inbound identifier is fixed to `0001`; do not generalize to other
   versions or languages without evidence. Probed system type wins over bearer fallback.
2. Read active SRVB XML directly through the current client, with read safety, no cache,
   and a strict identity/namespace/version reader. Require an active SRVB/SVB, ODATA V4
   UI binding, one matching service/version, and explicit boolean publication state.
   Malformed, inactive, conflicting or incomplete evidence is unknown, never false.
3. If already published, report the original failure and the confirmed state without
   another POST. If unknown/unreadable, preserve the original error and stop.
4. If explicitly unpublished, wait ten seconds, then read the active state again.
   Ten seconds is a bounded operational grace period based on the observed customer
   interval, not a measured SAP buffering guarantee. It is never paid on success.
5. If still explicitly unpublished, re-run the real-package gate and write safety,
   then invoke the existing publisher once using the same client/name/version/type.
   Keep content negotiation intact. Read active metadata afterwards; report recovery
   only on an explicit published state and a non-error retry result. Never turn a
   retry exception, authorization failure, or repeated SAP error into success.
6. Preserve the original SAP message and retry outcome in the tool result. Ambiguous
   completion says to read status, not to blindly retry. No recursive recovery.
7. A single 150-second deadline starts at recovery admission and covers status reads,
   wait, package verification, retry and verification. The original first attempt
   retains its existing timeouts. Thread cancellation through the existing HTTP options.
   Cap recovery HTTP sends through the shared request-attempt budget (20, including
   CSRF/HTTP recovery); a logical retry may include existing protocol-negotiation sends.
   Existing subtree package resolution is also awaited within the deadline; a late
   result cannot authorize a publish after timeout/cancellation. Its existing separate
   traversal limits/cache remain unchanged.

## Plan review before implementation

- A permanently missing SCO2 is a required negative test, not evidence of a transient
  race. Do not rely on `bindingCreated` or automatically repair the object graph.
- Match the structured SAP result before formatting; do not retry generic HTTP errors,
  other bindings' messages, on-prem/V2 calls, or unknown target types.
- Do not use the permissive general SRVB parser for retry authorization: it defaults
  absent publication state to false and omits active-version identity.
- Readiness polling through SCO2 is deferred: a single 404 cannot distinguish delay
  from deletion, and a successful read need not share the next publish's app server.
- Package revalidation and cancellation must finish before the second logical POST.
  Preserve the same SAP identity and request-local state; no shared recovery cache.
- Prefer one dedicated helper and one strict metadata reader over refactoring all
  activation paths. Keep schema snapshots and size budgets unchanged where possible.

## Verification and completion criteria

Tests first: real-shape sanitized metadata and AS-XML fixtures; successful recovery;
permanent failure; already-published before/after waiting; unknown/inactive/mismatched
metadata; wrong target/version/category/error; read errors; second-call failures;
changed/unknown package; write ceiling; cancellation during wait and package lookup;
shared deadline; HTTP negotiation/attempt accounting; concurrent identities isolated.
Run relevant existing activate/devtools/HTTP tests, then all repository gates. Review
argument encoding, safety, failure reporting and complexity against the final diff.
Finally run the changed build on the owned BTP system with an ordinary publish and a
controlled missing-inbound case, clean up, document limits, and open a PR. Do not merge.

## Implementation review outcome

The exact missing-inbound negative case, strict metadata gate, repeated real-package
check, shared HTTP recovery budget and caller cancellation are implemented. Review found
and corrected a misleading missing-dependency hint for a different retry error, and verified
that a late package-hierarchy answer cannot trigger a publish after cancellation. The strict
state read also checks cancellation/deadline again after receiving its response.

Local gates and loopback HTTP checks passed; detailed evidence and the current live-test
status are in [the verification record](../research/2026-09-16-publish-recovery-verification.md).
