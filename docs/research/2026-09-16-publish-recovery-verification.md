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
- Already published means no repost. Otherwise the ten-second grace period is followed by
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

Changed-build BTP verification is pending renewed personal browser authentication. The
prepared live checks cover an ordinary one-POST publish and the deliberately missing SCO2
case, expecting exactly two publish POSTs, an honest error and successful object cleanup.
This status must be updated before marking the PR ready for merge.
