# Publication failure inspection and replay prevention

## Evidence and limits

The customer reported successful repetition after the exact English `Local Publish of
<name> failed` / `Inbound service <name>_0001_G4BA does not exist` error. One interval
between tool calls was approximately ten seconds. On SAP_BASIS/SAP_CLOUD 920 SP04, ordinary
first publications succeeded; deleting an owned generated SCO2 reproduced permanent failure.
Neither retry nor reactivation repaired that deletion. `bindingCreated=true` was not readiness
proof. This does not disprove the customer report, but does not establish a transient cause
or a reliable automatic remedy. Unique live evidence is retained in the
[verification record](../research/2026-09-16-publish-recovery-verification.md) and
[feedback investigation](../research/2026-09-17-publish-feedback-investigation.md).

A separate loopback reproduction commits a publication then replaces its response with
429/503/database-session 500. The old transport repeats that job. Automatic repetition needs
evidence that it is safe or the first request was not applied
([RFC 9110 §9.2.2](https://httpwg.org/specs/rfc9110.html#idempotent.methods)).

## Final implementation

1. Disable transient HTTP replay for publication with one internal request option. Preserve
   existing authentication/CSRF/MIME handling; notably, any 403 still causes one token-refresh
   replay. Unpublish and other operations retain their existing policies.
2. Report 429/5xx/network failure as unconfirmed completion with state-read guidance. Minimal
   mode retains the normal HTTP status/category and request-correlation hints, without SAP text.
3. Only for the resolved BTP type, V4 endpoint, version `0001` and exact binding-specific
   missing-inbound error, read fresh active metadata through the same client. Keep caller
   cancellation and normal HTTP limits; do not introduce a recovery timer or total-send claim.
4. Require valid namespaces, matching active SRVB/SVB identity, one V4 UI service/version and
   an explicit published boolean. Already published: confirmed state plus original error.
   Unpublished/unknown: preserve the error and return inspection guidance. Never republish,
   activate or repair dependencies from this path.

## Review decisions and validation

Accepted F3/F4: disclose the retained 403 replay and reuse minimal HTTP error formatting.
F5 is removed with its cause: no recovery package traversal or 20-send budget remains.
Deleted the automatic second publish, ten-second delay, second state read, 150-second deadline
and recovery-only package-check plumbing. The original publish's write/package gates remain.
Tests exercise strict state parsing, concurrent identities, cancellation, safe read retries,
MIME/403 behavior, committed state after response loss and both disclosure modes. Current
counts and live limits are recorded in the verification document. No roadmap impact.
