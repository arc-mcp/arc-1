# Text-pool state after writes

## Reproduction

On SAP_BASIS 758 SP02, 816 SP01 and BTP 920 SP05, saving empty symbols on a
freshly activated class leaves its text pool inactive even though activation reports
success. The caller's inactive feed is empty. CLAS metadata uses `CLAS/OCX`.
FUGR reproduces the same behavior on 758/816 (`FUGR/PX`). Activating the generated
program name or the owner does not repair it. Clearing a never-activated nonempty
FUGR text draft also leaves an inactive pool hidden from that feed.

Native `REPT_OBJECT_ACTIVATE` conditionally deletes the inactive pool after updating
or deleting the active pool. This matches the observed absent-active-pool case;
the native return codes were not traced. No supported ADT discard was established.

## Plan and review

1. Keep the existing write/package gates and pool lock. For exact empty symbols
   input on CLAS/FUGR with an empty native body, require exact active pool metadata
   under that lock before skipping PUT and activation. Unknown/mismatched metadata
   stops this empty write; an inactive pool is never treated as a no-op.
2. After a real activation, read explicit inactive-version metadata once in the
   same session. Return observed active/inactive/unknown state and removal details.
   The handler must not infer activation from HTTP success or the inactive feed.
   A failed final read preserves the known save and reports unverified state as an error.
   Inactive CLAS/FUGR state is also an error; expected inactive PROG state retains
   the first-owner-activation hint. Recovery advice must involve ADT or the user,
   since part-body reads cannot establish the whole pool state.
3. Keep the first-owner-activation hint for PROG. The empty no-op excludes PROG:
   that failure was not reproduced there and its first-activation path differs. Remove the unverified instruction
   to resolve an empty FUGR draft in ADT. Never add automatic placeholder texts,
   catalog writes, discard, or activation retries.
4. Test ordering, exact metadata, no-op scope, inactive/unknown outcomes, read/lock
   failures and removal reports. Re-run disposable public-tool lifecycles on
   758/816/BTP and verify cleanup; 750 must retain the discovery refusal.

Reviewed against the live research and independent Opus 5.5 Max review: a narrow
no-op is prevention, not recovery. Equality alone cannot authorize skipping an
inactive draft. A final state read can race with another user's later save, so
describe the observed state without attributing ownership or cause. No new tool
arguments, global cache, generic mutation framework, or activation transaction.

The low-level write result gains explicit state; `writeClassTextSymbols` retains
its void wrapper. The earlier removal-summary return was introduced on unreleased
main; the released 1.5.2 wrapper returned void. Tool schemas are unchanged.

## Deferred boundary

Refusing a clear of a never-activated draft needs a qualified whole-pool condition
across active/working versions and all parts. It is not inferred from empty symbols
alone. Recording transports and principal propagation remain separate qualification.

Roadmap: correct COMPAT-12's obsolete auto-activation description and retain the
unresolved recovery/draft-clearing work as COMPAT-15.

## Validation

12 October: 8,449 unit tests pass; typecheck, lint, policy, build and size gates pass.
The nine-case public-tool text-elements integration suite passes on 758. Additional
public-tool create → empty no-op → write → clear → delete checks pass for CLAS/FUGR
on 758/816 and CLAS on BTP 920; all five owners are absent afterward. On-prem fixture
REPOTEXT queries return no rows. 750 retains its discovery refusal. These are
named-user/local-package tests, not recording-transport or principal-propagation proof.

Final review: inactive CLAS/FUGR and unknown final states now return errors while
preserving the known save. Forced legacy empty drafts reproduced the new error,
then explicit fixture-only recovery/clear/delete passed on 758 and 816. BTP's
follow-up stopped at CSRF acquisition (503); its earlier lifecycle passed, but the
new result-classification repeat remains pending system availability. Unit coverage
includes unknown state for CLAS, FUGR and PROG; known inactive PROG keeps its hint.
COMPAT-12 restores the evidence link lost in release commit 2bf00bf1.
