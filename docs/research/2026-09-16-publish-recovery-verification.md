# BTP V4 publish recovery: verification and limits

## Scope and evidence

This change handles one observed BTP OData V4 UI publish error for service version `0001`:
`Local Publish of <binding> failed` / `Inbound service <binding>_0001_G4BA does not exist`.
It does not fix or identify the SAP backend root cause. The customer observed successful
repetition; the timed example included approximately ten seconds before the next attempt.

Research on SAP_BASIS/SAP_CLOUD 920 SP04, before this patch, found six normal first-publish
successes. Deleting only an owned, unpublished test binding's generated SCO2 deliberately
produced the exact error twice, including after a ten-second wait. Its active SRVB metadata
still reported `bindingCreated=true`. Re-activation and a save/activation did not recreate
that missing dependency. All test bindings and source objects were subsequently removed;
a pre-existing package-removal problem is separate from publish recovery.

The two XML fixtures in `tests/fixtures/xml/publish-recovery/` preserve the relevant live
wire shape, with object/package identities replaced and unrelated metadata omitted. They
contain no tenant endpoints, users, credentials or SAP implementation source.

## Behavior and review

- Eligibility uses structured SAP fields, confirmed BTP type and V4 routing. It requires
  exact binding-specific English text and version `0001`. Unknown targets, V2, other
  service versions and unrelated errors keep their original path.
- A fresh direct active metadata read must identify a single V4 UI binding and an explicit
  published boolean. Missing/ambiguous fields remain unknown. `bindingCreated` is not
  considered evidence that the generated inbound service exists.
- Already published means confirmed success, with the original failure retained in the
  response text and no repost. Otherwise the ten-second grace period is followed by
  another state check, a fresh real-package gate and the write ceiling before one retry.
- Recovery success needs explicit active publication evidence. Repeated SAP errors,
  exceptions and unverifiable completion retain an error with the initial failure and
  recovery outcome. Different retry failures do not receive a misleading missing-object hint.
- All state is local to the call and uses the original SAP client. No per-user data cache,
  background task, object repair, schema addition, release bump or unpublish change.
- Recovery has one 150-second deadline and a 20-send HTTP budget, including existing
  authentication/CSRF/content-negotiation sends. The original initial attempt retains its
  existing timeouts. Existing subtree package resolution retains its own bounded traversal
  and cache; waiting on it is deadline/cancellation bounded and a late result cannot publish.
- URL components are encoded at the sink. Reads and the retry retain operation safety;
  package resolution remains fail-closed. No new secret-bearing logging fields.

The ten seconds are an operational grace period, not a measured backend synchronization
SLA. A single retry cannot repair a permanently absent SCO2. A natural transient failure
with successful live recovery remains unobserved on our system.

## Validation

- Tests were added before implementation and failed against the original behavior.
- Strict reader tests cover true/false, inactive and malformed XML, namespaces/rebinding,
  wrong object/service/version/category, absent flags, multiple versions and input size.
- Dispatcher tests cover recovery success, persistent failure, state becoming published
  before/after waiting, unknown evidence, target/error exclusions, package changes and
  missing package metadata, write ceiling, deadline and cancellation.
- Actual loopback HTTP tests cover concurrent identities, physical requests through
  generic MIME and AS-XML fallback, denied state reads and cancellation of the real timer.
- A cancelled package-hierarchy lookup can resolve later without triggering a publish.
- Full unit suite: **6,836 passed in 222 files**. Build, typecheck, lint, action-policy
  validation, file-size ratchet and tool-schema budgets passed. Lint reported only the
  existing Biome configuration/template informational messages; tool schemas are unchanged.

## Changed-build live verification, 2026-09-17

Personal OAuth authentication was renewed and the existing free-tier system started through
the Landscape Portal. The tested product revision is `b156f805`, on freshly verified
SAP_BASIS/SAP_CLOUD 920 SP04, with writes restricted to one disposable test package.

- Nine ordinary first publications succeeded, each with exactly one physical publish POST
  and an explicit active `published=true` readback: one baseline plus eight variant runs.
- The eight runs repeat four variants twice: immediate publication, a ten-second pre-wait,
  an identical SRVD source update before activation, and a fresh HTTP client using the same
  OAuth identity between SRVB activation and publication. Immediate POSTs started
  0.614–0.679 seconds after activation completed. A new client does not prove a different
  SAP application server handled the request.
- A deliberately removed owned SCO2 produced the exact SAP error on both physical publish
  POSTs within one tool call. The call took 12.644 seconds, returned an error preserving both
  failures, and left explicitly unpublished metadata. There was no third publish POST.
- No natural missing-inbound or `Usage of <SRVD> not permitted` error occurred in these runs.
- All 50 new focused unit/loopback tests passed again. Every GitHub check on the tested
  revision passed, including integration and E2E; those generic checks alone do not establish
  successful recovery from the customer's transient BTP error.

The earlier authentication blocker is resolved. The PR remains draft because a natural
transient error followed by successful live recovery is still unobserved. The forced missing
SCO2 case validates bounded failure behavior, not the customer's root cause or retry success.
See the [feedback investigation](2026-09-17-publish-feedback-investigation.md) for the separate
create-response-loss control, its limitations, and the final cleanup record.

## Review validation, 2026-09-21

The tested implementation is `c9fe4de981e876432559278f07fb9f178d20a2c7`, including current
main `ef9f61bf`. Recovery now requires the target-scoped resolved BTP type; bearer-only
inference was removed. Every publication disables transient HTTP replay, while preserving
rejection-based authentication/CSRF/MIME handling. Unpublish and other mutations retain their
existing policies; this is not the general create/retry fix.

Seven new/changed regression cases failed before the fixes. The real transport against a
loopback SAP substitute now preserves a job committed before a replaced 429/500/502/503/504
response or dropped connection, without resending it. This covers both initial/recovery
attempts and both error-disclosure modes: completion stays unconfirmed, the tool recommends
reading publication state, and the substitute's readback proves the committed state remains.
These are controlled simulations, not live SAP failures or proof of the customer's cause.

All **7,017 tests in 229 files** pass. Typecheck, lint, build, policy, file/schema budgets and
strict MkDocs pass; lint has two existing informational notices. No size budget was raised.
Fresh live publication testing was unavailable: the configured BTP ADT endpoint returned
HTTP 503 to an unauthenticated discovery HEAD before login. No new BTP objects were created.
The 920 SP04 results above belong to the earlier build; the natural transient failure followed
by successful recovery remains unverified, so the PR stays draft. GitHub CI was not waited on.
