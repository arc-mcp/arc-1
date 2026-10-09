# Function-group deletion and inactive text pools

## Reproduction and contract

On SAP_BASIS 758 SP02, client 001, HTTPS/Basic, a disposable active `$TMP`
function group with a separately saved text draft leaves `REPOTEXT R3STATE=I`
after successful deletion. The inactive list contains only `FUGR/F`, not a pool.
Recreating the group, writing/activating a text part and deleting it removes the
orphan; this recovery cleaned the reproduction fixture.

Version-less GET of `/sap/bc/adt/textelements/functiongroups/<name>` returns
`rept:textElement` with `adtcore:type="FUGR/PX"` and `adtcore:version="active"`
for an empty active pool, then `inactive` after the separate draft save. This
metadata provides the missing signal; source-body equality does not.

## Plan and review

1. Preserve the existing package gate and per-user inactive-list boundary. For a
   listed function group, inspect the pool metadata only when its ADT collection
   is not known absent. Refuse unreadable or inconclusive metadata.
2. Activate only a confirmed inactive pool, reusing `activateTextPool`, before
   the existing owner lock/delete flow. Preserve cache invalidation and honest
   errors when activation or later deletion fails. Leave source drafts untouched.
3. Test inactive/active/empty and invalid metadata, namespaced names, unavailable
   discovery, failures, and mutation gates. Recheck program behavior.
4. Verify live deletion removes REPOTEXT rows and that isolated pool activation
   does not activate a pending TOP include. Exercise a no-text group too.

Review: use SAP's explicit version attribute, not a broad activation of FUGR or a
new discovery framework. The per-user list does not prove absence of another
user's draft, and separate calls do not eliminate concurrent-edit races. Those
limitations remain explicit; no cross-user activation is added intentionally.

Roadmap: remove the verified same-user FEAT-81 case; expand COMPAT-12 to retain
cross-user deletion and race research. Known-absent legacy services keep their
existing behavior; this change does not claim to repair that unverified case.

## Candidate verification

The built dispatcher deletes empty groups and groups with independently saved
text drafts, with zero remaining REPOTEXT rows and metadata GET returning 404.
A local injection that fails the DELETE call after real SAP pool activation
confirmed the warning reports the preceding activation, the active TOP source
stays byte-identical, and its pending source draft remains inactive. A subsequent
real deletion removes the group and all pool rows. This verifies activation
isolation; the injected failure is not evidence of a native SAP lock conflict.

All disposable 758 fixtures were cleaned. The first failure-injection attempt
patched an instance method which the session clone did not retain; deletion
succeeded instead. The corrected probe patches the process-local prototype and
passes. No product change was needed for that harness error. Live two-user,
750/816, BTP and PP testing remain unverified.

Automated validation: the new regression suite fails on main (11 failures) and
passes with the candidate. Full suite: 8,080 tests / 270 files. Typecheck, lint,
policy validation, build, file/schema budgets and strict docs build pass. Final
review retained the per-user scope and explicit failure behavior, with no further
findings. Pool activation occurs before the existing owner lock; concurrent-edit
behavior remains research under COMPAT-12.
