# Cloud table-type authoring

## Root cause and plan review

The Cloud read/write registry excludes TTYP although native metadata, create,
locked PUT, activation and deletion are supported on the captured ABAP Environment
920. Expose read/write only after the shared dimensions contract (#963).

Flip the two registry rows, add the same dimension fields and validation to BTP
single/batch schemas, and publish the same concise field help. Reuse current
handler, discovery, package and scope gates. Do not advertise advanced keys,
reference/range definitions or arbitrary standard-type creation. Keep no parallel
Cloud write engine. Remove redundant BTP action enumerations in property help to
fit existing schema budgets.

Test public single/batch DEC creation, scale/length changes, inactive partial
updates, dictionary rows, invalid inputs, safety refusals and cleanup on Cloud.
Repeat the existing on-prem matrix on 750/758/816; 750 should refuse the absent
endpoint. Type and schema parity must cover read/write and both batch surfaces.
Use an owned Cloud data element for the dictionary row rather than assuming a
classic SAP type is released for Cloud development.

## Validation and final review (2026-10-09 UTC)

Compiled public dispatcher: 16 scenario records each on 758, 816 and BTP920 SP04:
single/batch DEC(5,2), length-only update preserving scale, explicit zero scale,
description-only preservation, CHAR(32), STRING, dictionary row, invalid dimensions,
and successful following update after a refused write. Cloud used a fresh owned
DTEL CHAR(12); every TTYP and DTEL was deleted and returned 404. 750 refused the
missing collection and created no table type. Evidence is retained locally in the
816 validation audit's implementation/ttyp-public-{750,758,816,btp}.json.

36 schema/dimension tests cover both platforms; 11 public dispatcher controls cover
scope, deny action, write ceiling, real-package enforcement and missing discovery.
The full suite and typecheck, lint, policy, build, file/schema budgets and docs build
pass. Snapshot review confirms TTYP in both Cloud registries and dimensions on
both single and batch surfaces. No new write engine, auth exception, or advanced
key/range support was introduced. The initial discovery-control test seeded the
HTTP MIME map instead of the handler feature cache; correcting the test setup
exercised the existing gate successfully.

Roadmap reviewed: FEAT-78 remains about advanced definitions. This scoped exposure
does not implement it; the local audit's FEAT-82 recommendation is covered here.
Depends on the dimension contract in #963.


## 1.6 refresh (2026-10-11)

Merged refreshed #963, including released main `2bf00bf1`. Independent review keeps
the shared read/write implementation and single/batch schema parity. Removed the
BTP type parameter's incomplete duplicate type list (it omitted TTYP); the enum is
the authoritative list, and specific surgery/UIAD guidance remains. This also
reduces the combined schema footprint without a new abstraction.

Fresh native single/batch dimension lifecycles on 758 SP02 and 816 SP01 are recorded
in #963's updated plan, with 750 discovery refusal and all fixture deletions confirmed.
Later that day, combined build `fadfeae5` passed these lifecycles on BTP 920 SP05
(client 100, named-user OAuth), including an owned Cloud data-element row. Both
TTYPs and the data element returned metadata404 and zero directory rows after
deletion. This tests the compiled dispatcher, not HTTP MCP/PP. FEAT-78's advanced
definitions remain deferred.

Final local validation: 8,214 unit tests, typecheck, lint, policy, build, size/schema
budgets and strict docs pass. The existing help-text test now checks the authoritative
BTP enum (including TTYP) instead of requiring a duplicate list in prose; the only
snapshot change from this review is that prose removal.
