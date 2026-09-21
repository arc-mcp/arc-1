# Bounded BTP V4 publication recovery

## Evidence and root-cause limits

The customer repeated an unchanged V4 UI publish successfully after the exact English
`Local Publish of <name> failed` / `Inbound service <name>_0001_G4BA does not exist` error;
one timed interval was approximately ten seconds. On SAP_BASIS/SAP_CLOUD 920 SP04 we
observed ordinary first-attempt success and reproduced the error by deleting an owned
unpublished binding's generated SCO2. Retry and reactivation did not repair that deletion.
`bindingCreated=true` persisted, so it is not readiness evidence. The natural transient
cause and a successful live recovery remain unobserved. Preserve the historical results in
[verification](../research/2026-09-16-publish-recovery-verification.md) and the
[feedback investigation](../research/2026-09-17-publish-feedback-investigation.md).

A separate real-HTTP reproduction showed that publication can commit before a response is
replaced with 429/503/database-session 500; generic transport retries then resend the job.
This does not prove the customer's root cause. Automatic repetition of a non-idempotent
request needs evidence of safe replay or non-application
([RFC 9110 §9.2.2](https://httpwg.org/specs/rfc9110.html#idempotent.methods)).

## Implemented design

1. Admit only the target-scoped resolved BTP type, V4 endpoint, version `0001`, and exact
   binding-specific structured SAP error. Unknown targets (including bearer-only), other
   versions/languages/errors and V2/on-prem targets do not enter recovery.
2. Read active metadata through the same client without cache. The strict reader requires
   valid namespaces, matching active SRVB/SVB identity, one V4 UI service/version and an
   explicit published boolean. Malformed, incomplete or conflicting data stays unknown.
3. Already published: report the confirmed state and original failure without another POST.
   Unknown or unreadable: stop. Explicitly unpublished: wait ten seconds and check again.
   This is an operational grace period, not a measured SAP synchronization guarantee.
4. Recheck the real package and write ceiling before one logical retry. Require explicit
   published readback for recovery success; preserve the original error and retry outcome.
   Never activate, recreate dependencies or recursively retry.
5. Bound recovery with caller cancellation, a 150-second deadline and 20 physical HTTP
   sends, including CSRF/authentication/MIME handling. Subtree lookup retains its existing
   traversal/cache limits; a late answer cannot authorize a cancelled or expired publish.
6. Disable transient HTTP replay for every publication attempt with one internal request
   option, preserving rejection-based authentication/CSRF/MIME handling. Report 429/5xx/
   network failure as unconfirmed completion with state-read guidance in both error modes.
   Keep unpublish and other operations unchanged; the broader create/retry fix is separate.

## Review and validation

The 2026-09-21 review added failing dispatcher/real-HTTP tests before removing bearer-only
eligibility and hidden publication replay. Tests cover both attempts, both disclosure modes,
committed backend state after response loss, MIME budgets, isolated identities, package and
write gates, cancellation, strict state parsing and unchanged ordinary success.
Current validation and live-access limitations are recorded in the verification document.
No tool fields, public configuration, schemas, background work or roadmap items were added.
