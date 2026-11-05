# Fixed API and cleanup tail after the recorded package MOVE

This qualification-only profile adopts the same four owned fixtures with suffix
`EC079E6DF825234F`. It does not add a public permission or a generic resume operation.
The two preceding claims remain failed and consumed.

The first run created request 609 and task 610, the parentless LOCAL root, its real child and
the independent INTF/simple CLAS through real batch creation and activation. The retained
run then confirmed both native PAK051 nonempty-package refusals and physically moved the
class into `ZARC1_DEMO`. The production adapter reported `ok:true`, `state:moved` and
recording request 609. Qualification stopped afterward because the native parent now had
two tasks, whereas its fixture expected one. No API-state or cleanup stage ran.

The actual parent 609 and direct 611 responses establish task 611 as MARIAN, modifiable,
`Development/Correction`, empty description/target, client 001 and parent 609. It contains
one R3TR CLAS entry for the exact moved class; the parent's aggregate repeats that entry.
There are no LIMU entries. Original task 610 remains empty and `Unclassified`.
This does not require a production policy relaxation: [ADR-0011](../adr/0011-broader-pinned-pp-mutations.md) and the [accepted plan](../plans/2026-10-26-broader-pinned-pp-writes.md)
authorize canonical parents and verified native children. `pinnedRecording` checks both
request policies against the parent and validates locked-task membership. This profile
still requires explicit request 609 in both policies and keeps transport management disabled.

The subsequent v10 GET shows C1 and C4 `NOT_RELEASED`, C1 creatable, no released contract,
and the exact native APIS resource in `ZARC1_DEMO`. Its 40-character key has native spacing;
the profile derives it from the document rather than constructing it from a guessed width.
The observed body/hash is an initial prerequisite, not permission to skip the production
API owner's package, current state, behaviour, visibility or recording checks.

The new fixed entry is `scripts/qualification/pr1142/native-package-api-moved.ts` and its
permanent root is `~/.local/state/arc1-qualification/pr1142-native-package-api-moved-v1`.
It binds the original 525 files, retained 907 files and separate 4-file API read addendum.
Fresh preflight rereads all 19 exact captured views, then uses the production package/owner
parsers. A compiled profile starts at C1 release, tests stale-state refusal, revokes C1 and
deletes the class, independent interface, child package and root package in that order.
No CREATE, MOVE, negative-package DELETE, activation or CTS-management prefix is repeated.
Previously completed stages and the separately observed successful MOVE remain distinct
in the result; neither failed result is rewritten as success.

Before subsequent recording, the qualifier checks exactly 609/610/611, their native owners,
types, explicit empty targets, parents and complete direct/aggregate object membership.
Task 610 must stay empty. Only the fixed class and, after native API binding, its exact APIS
resource are admitted. A third task, foreign row, LIMU row, missing member or inconsistent
aggregate stops the tail. Parent-request authorization does not grant this fixture runner
permission to adopt any future task automatically.

Existing phase/HTTP/owning-session functions provide the permanent once claim, bounded
attempts/bodies/deadline, final-send source/history/policy checks and owning cleanup.
An uncertain API PUT or DELETE is retained without replay. Typed current repository
absence is checked after reverse cleanup; reappearing/uncertain objects stay in residuals
alongside earlier deletion facts. Request 609 and tasks 610/611 retain native bookkeeping;
they are not released, deleted, imported, reassigned or called clean.

Independent exact-source review is required before root-only preparation, GET preflight,
fresh actual raw-JPEG SM12 controls, nonclaiming offline check and one execution. The four
flags are `--prepare-reviewed-package-api-moved-v1`,
`--preflight-reviewed-package-api-moved-v1`, `--check-reviewed-package-api-moved-v1` and
`--execute-reviewed-package-api-moved-v1`; each takes the reviewed full revision, and the
last two also take the returned preflight ID. Retain the existing freshness/no-overlap/awake
requirements and capture fresh post-controls. This source candidate is not native, PP or
merge qualification; current PP and final integration evidence remain separate.
