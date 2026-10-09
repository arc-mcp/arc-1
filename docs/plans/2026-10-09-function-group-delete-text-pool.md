# Function-group deletion and inactive text pools

## Reproduction and corrected root cause

On SAP_BASIS 758 SP02, client 001, HTTPS/Basic, deleting a disposable active
`$TMP` function group with a separately saved text draft leaves `REPOTEXT
R3STATE=I`. Recreating the group, writing/activating a text part and deleting it
removed the reproduction orphan.

The original probe incorrectly filtered the inactive feed by the group name.
Claude's review and an independent 758 reproduction showed both `FUGR/F` (the
group) and `PROG/PX` (the pool). The pool is named `SAPL<group>` and has URI
`/sap/bc/adt/textelements/functiongroups/<group>`. A source-only draft does not
need pool activation. There is no need for the first implementation's metadata
GET, version parsing, changedBy comparison or discovery branch.

## Revised plan and review

1. Keep the existing package gate. Match a `PROG/PX` entry by the function group's
   text-pool URI, accepting raw and percent-encoded namespace separators. Avoid
   decoding unrelated feed URIs, which may be malformed.
2. Activate only that pool via the existing `activateTextPool`, before owner
   lock/delete. Preserve failure reporting and cache invalidation. Do not activate
   the FUGR or its source includes.
3. Cover absent, unrelated and namespaced pool entries, source-only drafts with
   and without discovery, activation/delete failures (including minimal errors),
   and the write ceiling. Retain the program regressions.
4. Verify live empty, source-only, text-only and source-plus-text deletion and
   pool-only activation isolation. Check metadata absence and zero REPOTEXT rows.

Review: this is the same direct feed signal as the program guard. The feed is
not an ownership guarantee: Claude observed another user's draft inside the
caller's transport request. It can also omit other users' drafts. The former
metadata changedBy comparison only matched the feed entry's user, not the caller.
No guessed caller identity or broader activation is added. Cross-user activation,
shared requests, principal propagation and concurrent edits remain COMPAT-12
research, with evidence needed before choosing a guard.

Roadmap: remove the verified same-user FEAT-81 case; retain and correct COMPAT-12.

## Verification

The revised regression suite fails against the first PR head in 12 of 14 cases.
The candidate uses the feed directly and requires no text-pool metadata request.

Live verification passed with the built revised dispatcher against authorized 758 and 816
systems over HTTPS/Basic using disposable `$TMP` groups. It covered empty,
source-only, text-only and source-plus-text deletion. A process-local injected
DELETE failure after real SAP pool activation tests that the active TOP source
stays byte-identical, its pending source draft stays inactive, and the failure
reports the preceding text activation. Subsequent real deletion left
metadata GET returning 404 and no REPOTEXT rows. All eight fixtures were cleaned. The injected failure is not
evidence of a native SAP lock conflict.

Two-user, 750, BTP and principal-propagation deletion remain unverified. Separate
activation and deletion calls do not eliminate concurrent-edit races.

All 8,080 unit tests / 270 files, typecheck, lint, policy validation, build,
file/schema budgets and strict docs build pass. Final diff review retained the
existing package gate, failure reporting and cache invalidation.
