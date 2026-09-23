# Create requests with unknown completion

## Root cause and evidence

`AdtHttpClient` retries 429, 503 and the recognized database-connection 500 for
all methods unless the caller disables transient retries. A create can already
have committed when an intermediary loses/replaces its response. Repetition then
creates duplicate transports/FLP tiles or reports an object conflict instead of the
original failure. The generic database-500 hint also encouraged callers to retry.
#795 protected publication only. The controlled SAP reproduction is in
[the publish investigation](../research/2026-09-17-publish-feedback-investigation.md).
[RFC 9110 §9.2.2](https://httpwg.org/specs/rfc9110.html#idempotent.methods) requires
knowledge of safe semantics or non-application before replaying a non-idempotent call.

## Plan

1. Use one small `postCreate` helper at repository metadata, server-driven object,
   class-include initialization, both transport creation APIs and all four FLP catalog/
   group/tile creation call sites. Disable availability retries using the existing
   option; retain auth/CSRF/MIME rejection
   recovery, including the DTEL v2→v1 fallback. Keep read POST behavior unchanged.
2. Preserve the original error type/status/body. Mark network, 429 and 5xx create
   failures as unknown completion; the dispatcher must advise state inspection,
   including inactive source, instead of another blind create or overwrite.
   Existing batch persistence accounting remains authoritative. Cache cleanup is
   best-effort and must preserve the error and final audit even if the cache throws.
3. Test actual HTTP sends and backend state for commit-then-error/lost response,
   pre-execution rejection, safe reads and POST reads, auth/CSRF/MIME controls,
   denied writes and batch unknown outcomes. Run the focused tests before/after.
4. Run local checks and controlled live SAP tests with disposable owned objects;
   distinguish injected failures from naturally observed SAP errors. Review diff,
   documentation, safety gates and roadmap before opening the PR.

## Scope

No new retry framework, automatic reconciliation, rollback, overwrite, configuration
or public tool schema. Other operations (activation, lock/unlock, refactoring, Git)
retain their existing policies; this change protects creation, not every mutation.
No existing roadmap item describes this defect; no roadmap impact.

## Live validation

Live a4h SAP_BASIS 758, client 001, direct HTTPS Basic: a disposable `$TMP` PROG
was created and its successful response replaced locally with a synthetic 503.
One create POST occurred; the dispatcher reported 503 and unconfirmed completion.
Metadata read-back proved persistence; an explicit source update/read-back succeeded.
Cleanup completed and metadata returned 404. No naturally occurring 503 is claimed.
Live review follow-up on the same system/route: a disposable FLP catalog and its
catalog tile each committed before the harness substituted a synthetic 503. Exactly
one POST per create and one catalog tile were observed; both errors carried FLP
inspection guidance. The owned catalog was deleted and its GET returned 404.
Other SAP releases, BTP routes, transport creation, FLP groups and group assignment
were not tested live; their retry behavior has local HTTP coverage.
