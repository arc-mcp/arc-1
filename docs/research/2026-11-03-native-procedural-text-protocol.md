# Fixed procedural and FUGR text-pool qualification candidate

This is a source-only candidate for one representative Basic-native A4H/001 lifecycle as
MARIAN in `$TMP`. It has not run against SAP. It does not qualify current-build PP, CTS
recording, public admission, every processing kind, or the separate CLAS/PROG text variants.
It changes qualification scripts only; production adapters, public schemas and policies are unchanged.

## Fixed graph and native contracts

`native-procedural.ts` fixes suffix `6D7A93E20B45C18F`, group
`ZARC1_PT_6D7A93E20B45C18F`, module `ZARC1_PM_6D7A93E20B45C18F` and structural
include `LZARC1_PT_6D7A93E20B45C18FF01`. No CLI owner, source, package, request, operation
or URL arguments are accepted. The fixed description and literal source marker bind the graph.

The driver uses the existing private function/text-pool context factories and the shared
create/save/delete/activation lifecycle through a real `AdtClient`. It does not execute ABAP,
use RFC/helpers, write the SAP-maintained group main source, or activate/delete generated
includes as independent owners. Its synthetic tests are not native observations.

The sequence is deliberately one dependency graph:

1. Typed native absence for group, module, structural include and generated pool, with a bounded
   inactive inventory. GET-only preflight uses no owning locks or writes.
2. Create the group; retain the complete native empty-generated-tree/source/text baseline;
   separately request group generation. Recheck the baseline before its native submission.
3. Create one normal module with an importing STRING parameter and mixed-case default literal.
   Verify native signature/processing metadata and saved source, then activate that exact module.
4. Prove a stale-source refusal; update only its structured signature, preserving its body and
   leaving a distinct inactive module draft alongside its earlier active source.
5. Create the own F01 with two FORM routines. Edit one and add another through the existing
   procedural-surgery helpers, preserve the untouched FORM, and request group generation with
   the selected include's explicit active-source/metadata proof. Group generation is not reported
   as activation of the separate module draft.
6. Prove the already-empty active symbols no-op; replace headings and symbols; replace the
   empty selection part; clear symbols while headings remain nonempty. Before each actual pool
   activation, inspect native inactive pool state, the requested inactive part, unchanged active
   parts and unchanged sibling parts. After activation, verify whole active/inactive part bodies.
   Recheck the module's distinct active and inactive sources throughout these pool operations.
7. Activate the module draft separately. Delete include, module, then group. Child deletion
   requires its exact current default/active receipt. Parent deletion additionally requires typed
   child absence and the original complete generated source/tree baseline, with only the
   already-verified whole-pool replacements incorporated. The shared parent/pool owning locks
   remain authoritative. Finish with typed absence and the bounded inactive inventory.

The metadata/source/activation representations reuse the retained A4H captures in
`tests/fixtures/function-owners/a4h-758.json`,
`tests/fixtures/adt/function-source-a4h-readback.json` and
`tests/fixtures/adt/function-metadata-a4h-activation.json`, plus the existing
[function protocol](2026-11-02-native-function-protocol.md),
[activation evidence](2026-11-02-function-activation-review-followup.md) and
[explicit pool version contract](2026-11-01-text-pool-active-version.md).
Those files are bound by the clean reviewed Git revision; no historical run is relabeled current.

## Phases and operator boundaries

After independent exact-source review, the operator uses Node **22.21.1**, a clean reviewed
execution checkout and the existing safe native launch environment. The only commands are:

```text
tsx scripts/qualification/pr1142/native-procedural.ts --prepare-reviewed-procedural FULL_REVIEWED_SHA
tsx scripts/qualification/pr1142/native-procedural.ts --preflight-reviewed-procedural FULL_REVIEWED_SHA
tsx scripts/qualification/pr1142/native-procedural.ts --check-reviewed-procedural FULL_REVIEWED_SHA
tsx scripts/qualification/pr1142/native-procedural.ts --execute-reviewed-procedural FULL_REVIEWED_SHA
tsx scripts/qualification/pr1142/native-procedural.ts --verify-reviewed-procedural-cleanup FULL_REVIEWED_SHA
```

The permanent root is `~/.local/state/arc1-qualification/pr1142-native-procedural-text-v1`.
Prepare is offline and exclusively creates the intent/root. Preflight and execute each have an
exclusive durable phase claim before credential loading; neither is retried. Check/final are
read-only, nonclaiming and do not load credentials or grant execution. Keep all failures and claims.

After successful preflight, save actual newly searched, visually inspected raw JPEG SM12 results
as `prerequisites/sm12-{suffix,user}.jpg` and a `sm12-baseline.json` with this exact schema:
`protocol`, `phase: "execute"`, `revision`, `intentHash`, `previousResultHash`,
`noConcurrentFixtureEditing: true`, and `suffixSearch`/`userSearch`. Each search records
`observedAt`, `client: "001"`, `table: "*"`, `lockCount: 0`, `evidenceSha256`, `user` and
`argument`. The suffix search is user `*`, argument `*6D7A93E20B45C18F*`; the user search is
`MARIAN`, argument `*`. The receipt binds the completed preflight result. Both captures must be
newer than preflight and less than five minutes old. Execution also retains the preflight's
five-minute ceiling. After execution, the analogous `final/` files use `phase: "final"` and bind
the execution result. A JPEG signature/hash is not a substitute for visual inspection.

The operator must separately establish no overlapping SAP/native CI or fixture editor, hold
the host awake, and retain those controls. No server-side global lock check is invented. The
driver has a four-minute cap, shared 768-attempt/2-MiB all-response budget, native 30-second
request clamps and final actual-send revalidation through queue/CSRF/auth waits. Owning unlock
and session close remain reachable after stop, expiry or source drift with separate bounded
cleanup. No retry/replay or automatic failure rollback is permitted. Confirmed historical
deletions remain recorded, while later present/uncertain owners return to residual/inspection
sets and prevent parent deletion.

## Remaining qualification

This run must still pass independent review and native execution/audit. A successful run would
cover normal FUNC creation/signature editing/readback, module activation, group generation,
FORM edit/add, structural membership/activation/deletion, FUGR headings/symbols and empty
selection replacement. It does not supply a selection screen, so nonempty FUGR selection text
is not claimed. Explicit RFC/update processing setters and their distinct metadata states remain
outside this representative normal-module run. No test method or function is executed.

Separate CLAS symbols and PROG symbols/selections/headings qualification, whole-empty-pool
inactive behavior (COMPAT-15), and pending sibling-part draft activation remain named accepted
text-pool variants. This graph retains nonempty headings before clearing symbols so it does
not manufacture an all-empty-pool repair. Current-build two-writer PP, recorded-object workflows,
negative routes and final PR acceptance remain required. No public qualification follows from
passing mocks or Basic-native receipts.
