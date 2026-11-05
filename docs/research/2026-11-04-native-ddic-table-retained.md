# Fixed retained table/settings continuation

This private qualification candidate builds on the independently reviewed `8c0ac8095853b6af818cbf9a56a87555402ff96a` DDL source proof. It makes no production/public permission change and is not native or PP qualification. It uses the existing DDIC phase, HTTP, lifecycle, snapshot and own-cleanup helpers; there is no caller-selected resume stage or graph.

## Bound failure and exact state

The consumed `pr1142-native-ddic-table-graph-v1` attempt at `bf4b7590a60f666ea961a3a2ecad955ce3668183` submitted table CREATE 201 and initial source PUT 200, then stopped at source verification. No activation, ENQU/index creation or deletion ran. `created: []` is incomplete-stage history, not absence. Its fixed intent hash is `c8edda194ee9ee30b0f9d518ac14ade05b5198160c7e5f5ce213b2ec84c1f77b`; failed result hash is `4dc0d60a23fe5e605d84a356d972fbfadb89615455ee4d44d04b54c1a1582e1a`.

The continuation binds the complete 125-file original protocol, operator and fresh GET-only inspection ledger, plus the sealed operator and independent audit reports. Every source proof revalidates their bytes, membership, permissions and ownership. The fresh native metadata proves MARIAN/$TMP on A4H/001: TABL/DT `ZTTGEEE257AEFB75` and its TABL/DTT resource are `new`; active query parameters do not override that actual state. Initial default/inactive metadata must match the captured raw table/settings hashes exactly. Table source must match the exact 360-byte stored hash `a9b595f9d35811a62397d8d8ff4a846c8b77f531371451eae83665f43ab11a46`. The repository fixtures contain only these disposable owned resources' metadata/source; private operator packets and standard SAP implementation source are not copied.

## Compiled remaining graph

The permanent new root is `pr1142-native-ddic-table-retained-v1`, with suffix `EEE257AEFB75`. Initial preflight is fixed GET-only discovery, exact retained table/settings snapshots, fresh typed ENQU/index absence and structurally valid inactive inventory. The inventory may contain the retained draft, so it cannot be described as suffix-free. The execute path repeats these proofs before any mutation.

Eighteen compiled stages begin with table activation, then observe the parent-created active settings, stale-hash refusal, settings update/activation, ENQU creation/activation/stale-refusal/update/reactivation, nonunique index creation/activation/stale-refusal/update/reactivation, and reverse index→ENQU→table deletion. The request fence explicitly refuses table CREATE and table source PUT even if a caller tries to supply an otherwise valid stage. Before first table activation, the owning wrapper also rechecks the exact retained settings receipt because that implicit resource may be affected. Child writes retain the existing fresh parent proof, exact own optimistic hashes, final send source/history/policy/deadline checks and normal owning cleanup. Bounded observations do not claim a cross-object atomic lock.

`retainedOwners` identifies the two prior resources separately from newly `created` children and settings `adopted` in this attempt. Three actual DELETE owners and independently observed settings `removedWithParent` remain distinct. A known pre-entry refusal reports the two retained owners; an unexpected runtime escape conservatively reports all four potentially touched resources. Present/uncertain child absence proofs and later failures remain in inspection results without erasing historically confirmed deletions. Failure stops the graph; it does not start an invented rollback, replay or unrelated child cleanup.

The unchanged limits are 640 attempts, a four-minute workflow inside original five-minute control freshness, bounded all-response bytes and existing final-send/own-cleanup time bounds. No data writes, import, transport release, ABAP execution, forced lock, generated module operation or new grant is permitted.

## Operator sequence after independent exact-source approval

```text
node --import tsx scripts/qualification/pr1142/native-ddic-table-retained.ts --prepare-reviewed-ddic-table-retained-v1 <reviewed-full-SHA>
node --import tsx scripts/qualification/pr1142/native-ddic-table-retained.ts --preflight-reviewed-ddic-table-retained-v1 <reviewed-full-SHA>
node --import tsx scripts/qualification/pr1142/native-ddic-table-retained.ts --check-reviewed-ddic-table-retained-v1 <reviewed-full-SHA> <preflight-id>
node --import tsx scripts/qualification/pr1142/native-ddic-table-retained.ts --execute-reviewed-ddic-table-retained-v1 <reviewed-full-SHA> <preflight-id>
```

Preparation is offline. The immutable source/runtime/environment rules still apply, including clearing prohibited loader/Git overrides. The existing prerequisite schema binds exact source/intent/sample, a successful fresh preflight and fresh raw JPEG receipts from actual SM12 searches: client 001/table*, user MARIAN/argument*, and user*/argument*EEE257AEFB75*, complete zero locks. The operator visually inspects both searches, verifies no CI/native/fixture-edit overlap and keeps the host awake. File-only check grants no execution authority and consumes no claim. Execute creates a permanent exclusive new claim before credential loading and repeats all bindings through final result persistence. After any attempt, retain every receipt and independently audit new post-SM12 controls and residuals.

The original failed claim/result and their 125 files remain unchanged. No new native phase was run during authoring. Independent source review, the actual bounded continuation/post-controls/audit, integration comparison, and current PP/recording/final accepted-plan evidence remain outstanding. No unsupported variant or remaining family is removed from the plan.
