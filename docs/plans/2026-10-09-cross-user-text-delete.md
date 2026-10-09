# Refuse deletion over an unowned inactive text pool

## Root cause and native proof

On 758, TEST_USER can save a PROG text draft while MARIAN's default inactive feed
remains empty. MARIAN can then delete the program, leaving REPOTEXT state I.
USERNAME=TEST_USER exposes the entry; USERNAME=* returns no entries, so wildcard
enumeration is not a safe guard. Pool changedBy still names the owner and must not
be treated as draft ownership. Identical-content drafts also report version=inactive.

GET the pool with version=inactive instead: a clean activated pool returns
adtcore:version=active; a real inactive pool returns inactive even for another user.
Owner locking alone does not exclude a second user's pool lock. Native proof on
758/816 shows that holding BOTH owner and pool locks excludes the second session
and permits owner DELETE. All proof fixtures were recovered/removed.

## Reviewed plan

Review rejected automatic activation, even when a feed entry names the caller: the
feed is user-specific and cannot prove exclusive ownership of the global pool. A
second user's later draft could be activated between the feed read and deletion.
Remove that automation for PROG and FUGR. Refuse every inactive pool and request
explicit review/activation with its author. No identity inference or enumeration.

Inside the existing owner delete lock, acquire the pool lock for discovered
PROG/FUGR textelements collections. Read explicit inactive metadata under that
lock. Validate exact pool name/type and active/inactive version. Refuse inactive
or unverified state; otherwise delete while both locks are held. Release both on
all paths. Missing/invalid/unauthorized metadata fails closed. Known missing service
(750) retains legacy deletion. Never compare content to infer draft absence.

Native 758/816 controls show a newly created PROG initially has an inactive pool,
although its owner metadata already reports active. This is indistinguishable from
an identical-content user draft. Conservatively require its first explicit owner
activation before deletion. Do not invent a bypass from owner metadata or empty
text content. Initial FUGR pools already report active.

One helper in text-elements.ts wraps the pool lock/check/delete callback; the
existing handler retains scope/package/transport checks. No schema or new option.
The follow-up is stacked on #959 and replaces its automatic activation policy.

## Tests and acceptance

Native 758 two-user changed/identical drafts: DELETE refused, owner and draft remain;
draft author explicitly activates, retry deletes and catalog has no rows. 758/816
same-user empty/source/text/mixed and never-activated controls; hold both locks and
attempt a second-session pool save to exclude the race. 750 missing-service behavior;
BTP PROG/FUGR writes remain excluded (no native write claim). Local malformed/403/
unknown-identity/foreign-feed, cleanup on error, transport and package controls.
Full checks, combined-tree review, then a PR stacked on #959.

## Results and final review — 2026-10-10 CEST

- Compiled public dispatcher, 2026-10-09 22:02–22:03 UTC: 16 PROG/FUGR cases
  per 758/816 (new, clean, source, text, mixed, identical, independent session,
  lock race). 758 uses TEST_USER for the foreign draft and competing lock; 816
  uses two sessions of the same identity. Both owners and drafts survive refusal.
  Clean/source-only deletion holds both locks and competing pool locks return 409.
  Every owned fixture ends with owner404 and zero exact-name REPOTEXT rows.
- 750: six new/clean/source controls pass through known-missing-service behavior;
  text-specific cases unavailable. BTP: public PROG/FUGR write exclusion verified,
  no native creation. No namespace, recording-transport or PP live claim.
- Native edge: empty FUGR draft activation reports success but leaves REPOTEXT I
  on 758 and 816; whole-owner activation also leaves it. Retry remains refused.
  Only the disposable test pool was recovered by writing a nonempty symbol,
  activating it, then explicitly clearing/activating and deleting. This is evidence
  of SAP's activation limitation, not an automatic product workaround. The hint
  requires draft resolution in ADT if activation leaves it inactive. All earlier
  destructive reproductions were recovered, including ZMXP_V1I308V on 758.
- Final review found and fixed misleading DELETE diagnostics: pool-read 404 must
  not be described as a rejected DELETE. Post-delete existence probing now runs
  only after DELETE was actually attempted. Write ceiling is checked before locks.
- 8,077 unit tests / 269 files pass, including 65 text-element cases. Typecheck,
  lint, policy validation, build, file/schema budgets, documentation build pass.
  Tests cover malformed metadata, unknown version, foreign pool name/type,
  403/404/406/500, lock/delete/unlock failure, minimal errors, namespace encoding,
  package/write/deny gates, transport propagation and unchanged class deletion.

Remaining native qualification is COMPAT-12's shared recording transport and PP
route; neither is inferred from this Basic-auth local-package evidence. No further
ARC-1 defect was found in the final reviewed guard. COMPAT-15 tracks the native empty-activation
limitation; it remains explicit rather than being hidden by a successful HTTP result.

Final missed-case follow-up: FUGR `edit_text_symbols` now says activation was
requested, matching the existing PROG response rather than claiming a proven
postcondition from SAP's empty success response. This is the smallest truthful
fix; it adds no heuristic retries or writes. COMPAT-15 retains supported native
draft resolution/postcondition research, not an uncorrected success wording bug.
Public compiled empty-FUGR writes on 758/816 at 22:08 UTC reproduce this exact
case: success text says activation requested; native pool remains inactive;
delete refuses; controlled test recovery ends owner404 + zero REPOTEXT. All
8,077 tests, typecheck, lint and build pass after the wording correction.
