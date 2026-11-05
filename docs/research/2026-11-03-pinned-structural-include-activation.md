# Pinned structural-include activation correction

The retained procedural attempt at `e557fe6cf5d6d912c108a44807e2811fe6f5fd79`
completed both FORM edits, then stopped at include activation on A4H/001 (758).
The pinned path submitted the owning FUGR URI. SAP returned HTTP 200 with
`activationExecuted=true` and `generationExecuted=true`, but the selected
structural include's default metadata remained inactive. The existing strict
verification correctly returned `activation-not-confirmed`. No text-pool write
or deletion followed, and all three test owners remain.

The execution ran at 16:29:40–16:30:01 UTC on 3 November. Its result SHA-256 is
`922835968de9926e12dbf2a4820ec60d51c7b6f4d87eed5aa7515b616522b1be`.
The 210-byte activation response has SHA-256
`c133bb966fcddec726a0314273490d805f43b1feaf39701442184025aff815d9`.
Fresh post-run SM12 observations showed no locks for the user and fixture suffix;
that verifies lock cleanup, not object deletion. A separate 32-GET inspection
confirmed the active parent, unchanged module draft, edited inactive include,
old active include source, and unchanged active text pool.

## Correction

The single-target path already uses the exact structural include URI under
`/sap/bc/adt/functions/groups/.../includes/...`. Its documented contract explains
why standalone include aliases and whole-group generation are insufficient;
see the [namespaced include research](2026-10-02-issue-904-namespaced-fugr-includes.md).
Pinned activation now uses the same URI and selected include name. Only an
explicit FUGR selection submits the whole group.

Preaudit may confirm exactly one selected `FUGR/I` reference. Group, sibling,
module, standalone-alias, deleted, duplicate, and mismatched references remain
refused. Package and child/parent recording checks, bounded request lifetime,
metadata drift checks, and raw inactive/active source hashes remain enforced.
Success and uncertain outcomes identify `selected-group-include-only`; the
warning preserves possible group regeneration and makes no claim that sibling
function-module drafts were activated.

The previous synthetic backend incorrectly promoted the include on a group
POST. Both the handler and real-client qualification models now preserve that
draft unless its exact structural URI is selected. This is a production routing
fix, not a relaxation of the state observer.

## Remaining qualification

The consumed execution and its earlier history are immutable. A separately
reviewed continuation must bind the new current state, start at include
activation, and retain the original empty-group baseline for final cleanup.
It must not replay completed FORM edits or the failed group activation. Native
verification of this correction, text-pool stages, final module activation,
reverse cleanup, and current PP remain open. FEAT-93 stays open.
