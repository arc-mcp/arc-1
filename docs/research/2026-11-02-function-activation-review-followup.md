# Private function activation: review 18 follow-up

This is an unfinished PR 2 implementation checkpoint. Public FUNC/FUGR/group-include activation
remains closed. Group generation is not evidence that function-module drafts became active.

## Independent review

Actual Claude Code `claude-opus-5-5`, effort `max`, reviewed immutable revision `9bd21e159`.
The [verbatim report](broader-pinned-pp-writes/claude-function-activation-review-20261102.md)
accepted continued development but not public admission or whole-PR merge. It found zero high,
two medium and four low issues. The reviewer ran 486 unit files / 13,000 tests, 59 historical
qualification scenarios, all three TypeScript projects, and size/schema checks. Its first/last
snapshot checks and the author's final check each confirmed 4,807 files unchanged.

The reviewer independently checked the retained native deletion receipts and all fifteen restored
parent baseline hashes. That one Basic-native run remains evidence for `5b1669eb`, not for this
new private activation code or PP. Review execution deviations and evidence limits are preserved
in the verbatim report.

## Changes under validation

| Finding | Follow-up |
| --- | --- |
| Medium 1: same-source metadata draft could remain while active source comparison passed | Capture bounded default metadata before activation and recheck before confirmation. Require both default and explicit active metadata to be active, have no inactive alternative, and match the captured normalized metadata. Active source must also match. Five regression cases failed before the fix. |
| Medium 2: direct handler FUNC admission lacked the second gate | Public handler refuses the function family. A module-private Symbol selects the internal qualification entry; tool arguments cannot supply it. Tests cover no-group dispatch, spoofed arguments and route-level rejection with an allowed CLAS control. |
| Low 3: minimal-error setting lost | Dispatch carries the setting into pinned activation. Both ordinary native rejection and errors after native success redact diagnostics in minimal mode; FUNC and PROG sentinel cases cover both settings. |
| Low 4: consumed operator procedure looked unexecuted | README now identifies the one-time run as consumed, links its result and uses “base” instead of claiming “stateless.” |
| Low 5: missing or misleading guards | Added drift between two allowed packages, exact post-activation name/type/container URI/type/package checks, namespaced module/source-frame workflows, non-FUNC group refusal and cancellation-state assertions. |
| Low 6: unbounded owner/lookup responses | Parent, child and group lookup each use a 1 MiB all-response stream budget. Tests exercise successful and error responses through the real HTTP limit. |

Metadata normalization expands namespace names, preserves values and repeated-child order,
and ignores only native state volatility: root core version/changedAt, ETags on recognized source
links, and one exact owned version-alternative link. All other fields remain in the hash; nested
version/changedAt/ETag and whitespace regressions prevent broad omission. The native-shape fixture
is a sanitized projection of the consumed run, with provenance hashes; it is not another live run.

The shared native activation engine now has an explicit private group-generation profile. It
accepts the native generation flag only for that profile and exact group reference, including
before confirmation. FUGR reports `generated`; group-INCL reports activation only after the exact
child's active/default metadata and active source agree with the captured draft. Results disclose
whole-group effects and do not imply module-draft activation. Other activation profiles retain
their prior generation-flag behavior.

## Author validation

The follow-up passes **490 files / 13,104 unit tests**, all three TypeScript projects,
build, policy validation, lint (three existing informational suggestions), file/schema budgets,
strict documentation build and all **59 historical offline harness scenarios**. The native-shape
metadata regressions number 15; private FUNC handler regressions number 52. No new live mutation
was performed for these checks.

## Remaining gates

An independent follow-up review must cover the final changes. No current-profile
native execution, public function-family admission, transport recording or fresh PP qualification
is claimed here. The latest PP artifact remains `77e41fdcd`. The remaining object/management
families and final merge gates are tracked in the
[PR 2 readiness checklist](../plans/2026-10-26-broader-pinned-pp-writes.md#merge-readiness--2-november-2026).

## Subsequent review

[Review 19 and corrections](2026-11-02-group-activation-review-followup.md) close all review 18
findings, add child/group recording agreement and distinguish generation from observed activation
state. Its revised result labels supersede the initial group-profile description above.
