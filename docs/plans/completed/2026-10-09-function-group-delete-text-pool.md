# Function-group deletion and inactive text pools

## Root cause

Deleting an active function group with a separately saved text draft can leave
`REPOTEXT R3STATE=I`. Its inactive feed contains `FUGR/F` (the group) and `PROG/PX`
(the pool). The pool is named for the group's SAPL main program and has URI
`/sap/bc/adt/textelements/functiongroups/<group>`. Matching the group name misses
it. A source-only draft does not require pool activation.

## Reviewed implementation

1. Keep the existing package gate. Match the `PROG/PX` entry by the text-pool URI,
   accepting raw and percent-encoded namespace separators. Comparing known URIs
   avoids decoding unrelated feed entries or deriving the SAPL program name.
2. Activate only that pool via the existing `activateTextPool`, before owner
   lock/delete. Preserve failure reporting and cache invalidation. Do not activate
   the FUGR or its source includes; no metadata or discovery probe is needed.
3. Extend the existing program-delete tests with FUGR pool, source-only, unrelated
   and namespaced cases. Shared tests cover activation/delete failures, minimal
   errors, cache invalidation and write/package gates.

The feed is not an ownership guarantee: it can include another user's draft in
one of the caller's transport requests, and omit drafts elsewhere. Cross-user
activation, shared requests, principal propagation and concurrent edits remain
COMPAT-12 research. No guessed caller identity or broader activation is added.
Roadmap: remove the verified same-user FEAT-81 case; retain COMPAT-12.

## Live verification

On 758 SP02 and 816/client 001/HTTPS Basic, empty, source-only, text-only and
source-plus-text deletion left no object or REPOTEXT rows; all fixtures were cleaned.
Real pool activation followed by an injected DELETE failure preserved active TOP
source and its pending draft and reported the preceding activation. This does not
verify native lock conflicts, namespaced drafts, two-user, 750 or BTP/PP deletion.
