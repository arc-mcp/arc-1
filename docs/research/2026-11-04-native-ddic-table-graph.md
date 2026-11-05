# Fixed transparent table, settings, lock object and nonunique index qualification

This is an offline-authored private qualification candidate based on `be9cb1041c4b7d508c842fea2340cc1c40e532ad`. It is not native execution evidence, PP qualification or a public capability change. Independent exact-source review must precede any real phase.

## Small representative graph

`native-ddic-table-graph.ts` binds the permanent `pr1142-native-ddic-table-graph-v1` root. Preparation draws a fresh 48-bit suffix and fixes one 16-character `ZTTG<suffix>` transparent table, its `TABL/DTT` resource, one 16-character `EZTG<suffix>` lock object and the nonunique `ZTTG<suffix>~001` index. Identity is MARIAN, target A4H/client 001, package `$TMP`; both request policies are empty, using the existing native local recording/own-lock proof. No transport release/import, data writes, forced locks, conversion helper, generated-module operation or ABAP execution belongs to the graph.

The existing fixed DDIC phase and lifecycle engines run 19 compiled stages: create/activate the table; observe its active implicit settings, reject a stale hash, patch size category to 2 and activate; create/activate ENQU over the two table keys, reject a stale hash, change only its lock mode E→S and reactivate; create/activate the nonunique CLIENT/STATUS index, reject a stale source hash, append ID to its index fields and reactivate; delete index, lock object, then table. The baseline settings must have a different size category so the patch is substantive. The table definition itself is not adjusted after activation; no physical database conversion is requested.

Settings have no independent native CREATE/DELETE. `adopted` records the observed parent-created resource; `confirmedDeleted` names only the three actual DELETE owners. After table deletion, a separate typed settings absence read records `removedWithParent`. Later present/uncertain resources remain in `remaining` and `inspectionRequired` even when an earlier deletion is historically confirmed. Unknown stages never fall through to deletion. Every forward failure stops without guessed compensation/replay, while bounded own UNLOCK/session closure remains available.

## Evidence and compatibility boundaries

The native wire basis is the retained [technical settings dossier](2026-10-12-table-technical-settings.md), [secondary index dossier](2026-10-12-table-indexes.md), [ENQU dossier](2026-09-28-enqu-lock-object-adt-contract.md), and current production factory/read/write/activation/delete adapters. The captured settings/index XML fixtures ground namespace and parent representations; the new synthetic tests do not claim new SAP observations.

The runner fetches bounded current discovery before any object creation and requires the settings/index/ENQU/deletion-check services used by this exact graph. Subsequent adapters reuse that request-local map. Default/explicit inactive and, after activation, active metadata/source are freshly read. Actual native type, version, package, author and marker are verified; query parameters never establish active state. Raw XML and source bytes/digests, semantic metadata hashes and exact optimistic/stored source hashes are retained. Table DDL reuses the reviewed blank-line/internal code-alignment proof; token separation, other line whitespace and literal/comment contents remain exact. Index source fields must retain the fixed nonunique definition; native `new` after save is a draft, and activation warnings remain unverified rather than proof of a physical database index. ENQU derived keys must match the owned table; generated lock-module references confer no extra activation or deletion scope.

Before each child mutation/activation, the owning request wrapper rechecks the retained parent receipt. DELETE additionally checks the current selected receipt under its own lock and requires dependent independent owners absent before parent removal. These are bounded observations during the explicit no-concurrent-editing window, not cross-object atomic locks. Unexpected parent bookkeeping or unsupported native shapes stop honestly rather than being silently normalized. The source, policy, cancellation and original freshness/deadline proof still reaches final direct/Connectivity dispatch after asynchronous waits. The graph has 640 attempts, a four-minute outer bound inside the original five-minute SM12 freshness, two MiB aggregate responses and existing 30-second per-request/own-cleanup bounds.

The index's advertised deletion check is sent once through the production helper under its own lock. Its request body contains a native lock handle, so that route's journal retains byte count/hash instead of raw body. Source and metadata bodies remain available. Native failures are not translated into successful absence or a classifier not proved by their actual response.

## Operator phases, still pending

With the independently reviewed exact source/runtime frozen, the existing commands are:

```text
node --import tsx scripts/qualification/pr1142/native-ddic-table-graph.ts --prepare-reviewed-ddic-table-graph-v1 <reviewed-full-SHA>
node --import tsx scripts/qualification/pr1142/native-ddic-table-graph.ts --preflight-reviewed-ddic-table-graph-v1 <reviewed-full-SHA>
node --import tsx scripts/qualification/pr1142/native-ddic-table-graph.ts --check-reviewed-ddic-table-graph-v1 <reviewed-full-SHA> <preflight-id>
node --import tsx scripts/qualification/pr1142/native-ddic-table-graph.ts --execute-reviewed-ddic-table-graph-v1 <reviewed-full-SHA> <preflight-id>
```

Preparation is offline; preflight is fixed GET-only discovery, four typed absences and complete suffix-free inactive inventory. Check is nonclaiming and file-only. Execute exclusively consumes its new claim before credentials and revalidates all source/intent/prerequisite bindings. The existing prerequisite schema binds the exact revision/intent/sample, actual fresh raw JPEG screenshots and search timestamps: client 001/table*, user MARIAN/argument*, and user*/argument*<suffix>*, both complete zero-lock results after the successful fresh preflight. The operator must visually inspect actual searches, ensure no CI/native or fixture-edit overlap and keep the host awake. After any attempt, preserve its claim/result and independently capture/audit both fresh SM12 searches and current residuals. No phase is run by author tests, and no earlier root or claim is reopened.

The remaining gates are independent source review, the actual native roundtrip and post-controls/audit, integration/component comparison, and current-build PP/recording and overall accepted-plan gates. Secondary-user role expiry is unrelated to this Basic-native qualification and is not extended. The source candidate neither qualifies every table/index variant nor silently drops the remaining accepted families.

## Actual stopped prefix and fixed retained continuation

The once-only `bf4b7590` attempt on 4 November returned table CREATE 201 and source PUT 200, then stopped because ordinary native field alignment failed the source proof. It did not activate or delete anything. The actual table `ZTTGEEE257AEFB75` and its implicit settings remained native `new`; default, active-query and inactive-query receipts agreed on that state. ENQU `EZTGEEE257AEFB75` and index `ZTTGEEE257AEFB75~001` were typed absent. Fresh observed source was 360 bytes, SHA-256 `a9b595f9d35811a62397d8d8ff4a846c8b77f531371451eae83665f43ab11a46`. The original claim is consumed; its commands above are historical, not a retry procedure.

The independently reviewed `8c0ac809` correction accepts only the qualified internal DDL code alignment while preserving literals/comments, line structure, token separation and exact optimistic/stored hashes. It is source evidence, not a completed table lifecycle. The separate [fixed retained continuation](2026-11-04-native-ddic-table-retained.md) adopts those two exact observed resources and skips both submitted prefix mutations permanently. Its own source review and actual remaining lifecycle are pending.
