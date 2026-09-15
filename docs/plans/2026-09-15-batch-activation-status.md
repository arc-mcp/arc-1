# Batch activation attribution and uncertainty

## Root cause and plan

The mapper used a raw URI prefix, so an error on ZFIRST2 was assigned to ZFIRST.
It also inferred active from absence of a diagnostic after SAP cancelled the batch.
Reproduced with seven failing regressions before implementation, including namespace
boundaries, source fragments, warning-only members, and global cancellation.

Use a shared boundary-aware object/source matcher (the same helper as #788), mark
unreported members unknown when the overall activation fails, retain their own
warnings, and render global messages separately. Include the status in every row,
including rows with messages. Retain the existing inactive syntax diagnostics.

Plan review: overall success still permits active/warning statuses; an own error
always wins. Names sharing a prefix must not share diagnostics. No transport,
activation protocol, publication retry or authorization changes are needed.

## Verification

All 48 focused activation tests passed. Build, typecheck, lint, policy and size/schema
checks passed, as did **6,586 tests in 214 files** with four test workers. A concurrent
full-suite run timed out in the unrelated OAuth callback tests; all 18 callback tests
passed in isolation before the full successful rerun. No checks were disabled.

Compiled CLI live test on SAP_BASIS 8.16: two interface names deliberately share a
prefix, and only the second contains an unknown type. SAP cancelled batch activation;
the first was reported unknown and the second error. Readback showed the empty active
shells and the submitted inactive sources. Both fixtures were deleted and confirmed
absent. [Sanitized evidence](../research/2026-09-15-batch-activation-status-live.json).

This is a standalone follow-up to #788. The shared helper file is byte-identical in
both PRs so either merge order is supported; combined checks cover their composition.

## Review round 3

The optional flat-message finding is valid: an early return suppressed messages when
no structured details existed. Further review found that global informational details
were also filtered out of the flat list and then discarded by the formatter.

Plan and implementation: retain informational details and otherwise-unrepresented flat
messages, deduplicate them, and render them alongside any error/warning sections. Keep
per-object attribution and unknown activation states unchanged. Four new regressions
failed before the fix; they cover success/failure with flat-only messages and mixed
structured/flat messages, including duplicate text.

All 52 focused activation tests and **6,590 tests in 214 files** passed. Build,
typecheck, lint, policy and size/schema checks passed. This follow-up changes output
formatting only; it adds no SAP requests. No additional live run was needed for these
injected response shapes; the release-specific live evidence above remains applicable.
