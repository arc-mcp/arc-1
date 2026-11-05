# Independent private native-governed publication review

Candidate: `8e0ef608b5f97f6e638b714aa501dd511e5e5bd5`; base `3a231558f16f6e538a5f4e9cc0f945f4acec8e09`.
Verdict: **NO-GO for private integration pending two P2 corrections.** No native, PP or public-admission approval.

I authored neither this implementation nor its candidate tests. The clean candidate was archived before
its author checkout was reused. First and final review verification bind all **4,746 files unchanged**.
This review uses that independent immutable snapshot, not the later contents of the author checkout.

## F1 — Do not complete publication actions from an unreliable matching getter

`src/adt/pinned-publication-execute.ts` returns `already-reported`, `ok:true`, `state:complete` without
submitting a job whenever the initial `published` flag equals the requested state. The newly admitted
native-governed profile explicitly lacks the branch/configuration proof needed for stronger conclusions.
The captured `CL_ODATAV4_BINDING_TYPE_IMPL` method `IF_SRVB_BINDING_TYPE~IS_PUBLISHED` initializes false,
catches `CX_SRVB_EXCEPTION` without propagating it, and otherwise treats any nonempty service URL as true.
The source-covered cloud getter can also describe test-catalog assignment. Matching flags therefore do
not establish that the explicit whole-binding publication workflow has completed or can be skipped.

The direct and Connectivity independent reproductions request unpublication while the getter reports
false and a synthetic runtime remains published. The authorized mocked native job would remove that
publication, but the candidate sends zero POSTs and reports complete success instead. Both fail the
negative assertion; positive-state controls each send exactly one job and pass. The synthetic runtime
is a control illustrating the documented caught-error ambiguity, not a claim about live SAP state.

The required correction is to avoid successful no-op completion from that weak observation. Submit the
authorized native job once through the existing guards, or retain an explicitly unverified non-success
outcome. Apply this consistently wherever the same getter is used as authority; preserve distinct
recording contracts and ordinary single-target semantics. A prose disclaimer beside a green complete
result does not fix the skipped operation. Add matching-false and branch-dependent matching-true controls.

## F2 — Honor minimalErrors at the new publication result boundary

`src/handlers/pinned-publication-native-governed.ts` directly serializes the executor result through
`pinnedOperationResult`. Neither that serializer nor the executor projects native diagnostic text using
`config.minimalErrors`. Both real-HTTP transport branches return a native ERROR short-text sentinel to
the caller even when minimalErrors is true. The same projection is absent from the existing private
configured-publication wrapper; do not leave the shared publication result inconsistently protected.

The independent direct and Connectivity probes both fail: `PRIVATE_NATIVE_DIAGNOSTIC_MARKER` survives
inside `items[].nativeStatus.shortText` in a client-facing tool error. Ordinary diagnostic controls with
minimalErrors=false both pass. Strip native short/long diagnostic text at the client result boundary
when required, preserving native severity, submission/partial-state evidence and useful structural
observations. Keep complete backend evidence private; do not mutate the source result or broaden this
into unrelated adapter changes.

## Other inspected boundaries and verification

Both explicit unrestricted request policies remain independently required, with the original strict
predicate extracted unchanged from FLP. The registered context/profile checks, exact target/client and
raw scopes, package-policy snapshots, direct/Connectivity final send checks, request-bound cumulative
budgets and original 30-second membership lease remain in place. The prior non-recording profile stays
distinct; public schemas/admission and generated-binding deletion remain closed. Full batch scope is
preauthorized, each binding is reread, and the sender retains one-use/no-replay behavior. Native status
and state are observations, not exhaustive alias/frontend/generated-state proof.

Independent checks at the exact candidate:

- **365 affected tests across four files pass**, including the new handler, existing publication,
  FLP and legacy devtools suites.
- **Eight independent real-client/mock-transport probes: four pass and four fail**, exactly the two
  direct/proxy reproductions for each finding. The final probe config aliases Undici consistently
  across the external test and source graph. An initial external mock-scope setup failure is retained
  separately and is not an acceptance result. Final direct and Connectivity cases use the same
  MockAgent with external connections disabled and synthetic credentials/invalid-domain endpoints.
- All three TypeScript projects, policy validation and file/schema budgets pass.
- First/final snapshot verification: all 4,746 files unchanged; `.env` absent. Probe source, configs,
  observations and logs are outside source. No real SAP endpoint or native phase was invoked.
- The author's separate clean-archive full suite of 546 files / 15,864 tests is recorded as author
  evidence; it is not claimed as a second independent full-suite run. Its initial archive setup
  failures and ambient-environment caveat remain in the unchanged author report.

The two findings are concrete result/operation defects, not demands for another native configuration
API or deeper CTS research. The both-wildcard native-governed alternative remains viable after correction.
Native lifecycle, generated-owner cleanup, current-build two-writer PP and public admission remain separate.
