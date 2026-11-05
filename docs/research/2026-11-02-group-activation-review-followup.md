# Private group activation: review 19 follow-up

Actual Claude Code `claude-opus-5-5`, effort `max`, accepted `909419f7e` as a development
checkpoint with **0 High / 1 Medium / 5 Low** findings. It closed all six findings from review 18.
The [verbatim report](broader-pinned-pp-writes/claude-group-activation-review-20261102.md) preserves
its evidence limits and execution deviations. Reviewer first/last and author final checks each
confirmed **4,816 files unchanged**. This is not public function admission or whole-PR acceptance.

## Corrections

| Finding | Disposition |
| --- | --- |
| Medium 1: group-include recording checked the group only | Check the exact child first, then the group using that allowed request; require matching locality/request on every validation. Five regressions failed before the fix and pass after it, covering forbidden child request, different allowed group request, an unlocked group, both URI bodies and preconfirmation drift. |
| Low 2: already-active include could claim a new transition | Generation-only INCL reports `already-active` if the first capture was active with no inactive alternative. FUGR reports `generated` for generation and `native-operation-confirmed` for SAP's activation flag, without claiming a proved group state transition. Tests cover both. |
| Low 3: catch results lost whole-group scope | Every failure after group submission retains the selected group, operation scope and whole-group warning. Native execution kind remains available even when diagnostics are minimized. Network loss and post-success verification failures are covered. |
| Low 4: masked or absent test guards | Split default-only and active-only metadata/alternative faults. Added lowercase namespace escapes in real-shaped state links, repeated-child order, invalid namespace/depth/expanded-name cases, group namespaces, metadata drift, recording refusal, cancellation and minimal-error rows. |
| Low 5: namespace copying could amplify comparison cost | Reuse inherited bindings when there are no declarations; cap in-scope bindings at 64 and total element traversal visits at 16,384, in addition to the existing byte/depth limits. Namespace and element-count regressions failed before the fix and pass afterward. This is a bound, not a measured timing guarantee. |
| Low 6: older activation document looked current | Added an explicit historical/superseded pointer to the original activation record. |

The parser retains native values and repeated-child order. The node budget counts visits across
identity reads and canonical comparison for one parsed document, not merely unique XML nodes;
this bounds repeated traversal too. Normal native metadata samples stay well below those caps.

## Validation and limits

The focused activation suites pass **128 tests** (55 FUNC, 33 group-profile and 40 program cases).
Native XML budget/comparison tests also pass. The independent review ran the unchanged 909419f7e
baseline: 490 files / 13,104 tests, 59 historical offline harness scenarios, three TypeScript
projects and size/schema checks. On the corrected author tree, **493 files / 13,201 tests**, all 59 historical offline scenarios,
three TypeScript projects, build, lint (three pre-existing informational findings), policy, size/schema
and strict documentation checks pass. These corrections and the separately committed private
CDS/RAP CRUD profiles still require follow-up review.

The verbatim report SHA-256 is
`9775545b901cbd47843f9d642be59bf260766c208728bd6d72fae03bcbb13bc8`.

No native mutation or PP test was performed for these corrections. A group-generation flag does
not prove module drafts activated; group-include draft transition and metadata-only drafts still
need live evidence. Broader group effects, recording-policy behavior and different activating
users must be checked on the current implementation before public admission. Historical Basic
and PP evidence is not silently upgraded to cover this code.

[Review 20](2026-11-02-declarative-review-followup.md) closed these listed findings and identified
the native-activation-flag variant of the already-active include case, now covered by a follow-up.
