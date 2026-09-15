# Customer feedback PRs: Claude review handoff

Reviewed 2026-09-15 against `main` at `6dd53c14eb0bf0f2a90502995b6f9bfe0a0c444f`.
This file replaces the earlier handoff that was saved outside the repository and was
therefore unavailable to the reviewer. Review fixes remain visible as new commits.
No GitHub PRs were merged, and no contributor comment was posted.

## Assessment of round 3

The approval is supported by the code and regression tests: no required round-2
finding remains open. Two optional observations warranted small fixes, described
below. The earlier live evidence and the reviewer's additional live observations
support the release-specific behavior; those are distinguished from this round's
local checks.

A clean, gated six-PR integration validates that combined tree. It does not establish
that every possible merge permutation was tested. The shared activation helper added
by #788 and #790 is byte-identical; the current six heads merge without textual
conflicts. Recheck the integration if another change lands on the base.

## Revisions to review

These are the tested code revisions. A later documentation-only commit on #790 adds
this handoff without changing the tested source.

| PR | Code revision | Status |
|---|---|---|
| [#786](https://github.com/arc-mcp/arc-1/pull/786) | `f1e15791fb557b6102eb408798879fcc647caa67` | Unchanged this round. The 7.50 subtype caveat is documented. |
| [#787](https://github.com/arc-mcp/arc-1/pull/787) | `e9248fb8cb3aa4e2a5c26707038be0559f100ffa` | Unchanged; no outstanding finding. |
| [#788](https://github.com/arc-mcp/arc-1/pull/788) | `6a1eb97fd24020e365c83b36f856cc762f729e13` | Unchanged. Own-error attribution, shared transport preflight, CLAS/INTF duplicate detection and bounded diagnostics are covered. |
| [#789](https://github.com/arc-mcp/arc-1/pull/789) | `0330aa4d43aa9820cbd171fb30dd4d972ab389bd` | Added a safe debug event when regex/format schema constraints prevent local validation. |
| [#779](https://github.com/arc-mcp/arc-1/pull/779) | `8946b5a06dc32f196791409f9fe3e473b78e960b` | Unchanged. Empty selection excludes package-only rows; partial results survive later failures; budget fixes remain. |
| [#790](https://github.com/arc-mcp/arc-1/pull/790) | `169076db1fd3e3dba083647b1b48c6c841efd3b9` | Flat-only and informational global activation messages are retained and deduplicated. |

## Fixes made in this round

### #790: preserve global activation messages

The formatter returned early when structured details were absent, losing flat-only
messages. Further review found a related case: global informational details had been
removed from the flat list by deduplication, but the formatter rendered only errors
and warnings. Both cases are fixed. Informational and otherwise-unrepresented flat
messages now appear once, including alongside errors/warnings. Object attribution,
success decisions and unknown activation states are unchanged.

Four new regressions failed before the fix: flat-only success/failure and mixed
structured/flat output with informational or warning details and duplicate text.
The focused activation suites pass all 52 tests. The shared formatter also serves
single activation; the existing single-object tests remain green.

### #789: make schema fallback diagnosable

Schemas containing `pattern`, `patternProperties` or `format` continue to report
schema validation as unavailable without compiling backend regexes. A debug event
now includes only the fixed reason `pattern_or_format` and operation `create` or
`update`. It contains no schema, pattern, candidate source or backend response.
Normal schemas emit no fallback event. SAP candidate and save checks still apply.

The three keyword cases failed the new log assertion before the fix. A new control
also verifies that a supported schema produces no fallback event. This change does
not expand the set of schemas that ARC-1 evaluates.

## Validation of the updated revisions

| Target | This round's result |
|---|---|
| #789 | Build, typecheck, lint, policy, size/schema gates; **6,625 tests / 215 files** passed. |
| #790 | Build, typecheck, lint, policy, size/schema gates; **6,590 tests / 214 files** passed. |
| Combined six PRs | Build, typecheck, lint, policy, size/schema gates and strict documentation build passed; **6,802 tests / 220 files** passed. |

The combined source revision is local integration commit
`a678a132560ff9ecd4b30ec73f5e708b77d3b519`. The first combined unit run passed 6,801
tests and failed one existing HTTP route test with `Parse Error: Expected HTTP/,
RTSP/ or ICE/`. All six tests in `http-multi-target-routes.test.ts` then passed in
isolation, and the complete 6,802-test suite passed without code changes. No tests,
assertions or gates were disabled. Full suites used four workers.

Budget measurements are unchanged by these fixes:

| Metric | Measured | Limit | Remaining |
|---|---:|---:|---:|
| `tools.ts` lines | 1,782 | 1,782 | 0 |
| BTP full schema tokens | 17,326 | 17,350 | 24 |
| Standard full write surface bytes | 72,701 | 74,000 | 1,299 |
| Standard default description tokens | 8,490 | 8,800 | 310 |
| BTP full description tokens | 11,939 | 12,200 | 261 |

No budget was raised and no tool-definition snapshot changed. Future additions to
the tool surface need an explicit budget check. These are local verification
results; GitHub checks for newly pushed commits run separately.

## Live evidence and remaining limits

No additional SAP writes were needed for this round's formatting/logging fixes. New
fault shapes were injected locally; the previous wire behavior is unchanged.

- #788 has recorded live preflight/attribution evidence for 7.50, 7.58 and 8.16.
  The reviewer independently repeated the failed batch and shared OO-name cases on
  7.58 using the combined build.
- #790 has recorded live evidence for 8.16. The reviewer additionally verified
  prefix-sharing interfaces on 7.50 and 7.58. SAP's global cancellation severity is
  rendered as supplied; a warning does not make the batch successful.
- #789 has an 8.16 lifecycle record. The reviewer repeated create/read/update/delete
  and schema/semantic refusal cases. The vendored UIAD schema contains none of the
  regex/format keywords that trigger local validation fallback.
- #779's reviewer-run 7.58 structure-only exact/tree selections started no ATC runs;
  real harmless AUnit passing/failing cases returned CLI exit 0/1 respectively.
  **Successful on-prem ATC completion, BTP SAP_COM_0901/0735 end-to-end operation,
  and UIAD saving on BTP remain unverified.** They are not claimed by this review.

Recorded and reviewer-reported disposable live fixtures were cleaned up. The new
unit tests create no SAP objects.

## Evidence accessible before merging

- #786: [search filter investigation](https://github.com/arc-mcp/arc-1/blob/f1e15791fb557b6102eb408798879fcc647caa67/docs/research/2026-09-14-object-search-filter.md).
- #788: [preflight plan](https://github.com/arc-mcp/arc-1/blob/6a1eb97fd24020e365c83b36f856cc762f729e13/docs/plans/2026-09-14-batch-preflight-and-outcomes.md) and [live evidence](https://github.com/arc-mcp/arc-1/blob/6a1eb97fd24020e365c83b36f856cc762f729e13/docs/research/2026-09-15-batch-preflight-review-live.json).
- #789: [UIAD implementation and validation](https://github.com/arc-mcp/arc-1/blob/0330aa4d43aa9820cbd171fb30dd4d972ab389bd/docs/research/2026-09-14-uiad-validation-implementation.md).
- #779: [review hardening plan](https://github.com/arc-mcp/arc-1/blob/8946b5a06dc32f196791409f9fe3e473b78e960b/docs/plans/2026-09-14-pr779-review-hardening.md).
- #790: [activation plan](../plans/2026-09-15-batch-activation-status.md) and [live evidence](2026-09-15-batch-activation-status-live.json).

## Release-note wording to carry forward

For the next release-please PR, include the intentional single-create behavior change
from #788. This is proposed wording, not an announcement of a released version:

> Single and batch SAPWrite create now stop when transport preflight returns a safety
> refusal or HTTP 401/403. Previously, single create could continue after those errors.
> Resolve the authorization or transport-policy issue before retrying. Local packages
> whose names start with `$` skip the CTS lookup.

Keep the existing release process; do not rewrite the already-published release notes.

## Draft contributor note for #779 — not sent

> Thanks for the CI integration contribution. The maintainer commits narrow this first
> version to explicit packages and package trees, reuse harmless-only AUnit execution,
> and make incomplete or unverifiable results fail the CLI gate. They also preserve
> partial results and keep the combined tool surface within its existing budgets.
> Software-component selection is deferred until we can verify its selection and
> completeness semantics. BTP communication-arrangement end-to-end validation and a
> successful on-prem ATC completion are still needed; the PR records those limits.

The supplied review recommends posting a comment, but it is review material rather
than authorization to message a contributor. This draft is available for the
maintainer to use.
