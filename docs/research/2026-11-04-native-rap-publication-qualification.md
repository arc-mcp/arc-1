# Fixed RAP, behavior-pool, batch activation and V4 publication qualification

This is an offline-authored native qualification candidate, not native success, Principal
Propagation evidence or merge approval. It implements one representative graph from the
[accepted PR 2 plan](../plans/2026-10-26-broader-pinned-pp-writes.md). It changes no production
adapter, public schema, app setting, destination policy or SAP permission.

## Exact graph and coverage

`native-rap-fixtures.ts` compiles six fresh A4H/001, MARIAN, `$TMP` owners using one random
12-hex suffix. The table name is at most 16 characters. The dependency order is:

| Owner | Name | Evidence and work |
| --- | --- | --- |
| TABL/DT | `ZTRP<suffix>` | Create source, activate, native active/default source proof; retain the parent-owned DTT receipt |
| Root DDLS | `ZRRP_<suffix>` | Own-table root view, create and activate |
| Behavior-pool CLAS | `ZBP_RP_<suffix>` | Individual source create; native `behaviorPool` category and exact root entity; MAIN and all advertised editable includes |
| Managed BDEF | `ZRRP_<suffix>` | Individual source create; supported `strict(2)`, `Item` alias, instance authorization, CRUD and a real `approve` action |
| SRVD | `ZSRP_<suffix>` | Own-view service definition, create and activate |
| V4 SRVB | `ZBRP_<suffix>` | Own-service Web API binding, version `0001`; create, activate, publish/status and unpublish/status |

The shared RAP generator first previews, then saves required handler signatures and implementation
stubs under the behavior-pool lock. It preserves MAIN and every unselected include. An actually
typed-absent CCDEF/CCIMP can be initialized by the existing helper under that same lock. Fresh
BDEF evidence is checked again around generation; the class lock does not lock the BDEF.
The generated methods are compiled/activated, never executed.

There is one explicit two-owner CLAS+BDEF batch activation after generation. The production
batch helper retains its native preaudit, complete selected scope, partial outcomes and owning
cleanup. The resource fence allows only these owners and bounded native includes of this pool.
Other activation stages use the same helper for a single owner. **This does not qualify
`batch_create`: its existing behavior always activates, either per item or at the end.** An initial
synthetic attempt assuming deferred `batch_create` activation failed and was replaced with the
individual creates above; production batch semantics were not changed.

Reverse cleanup is one generated-binding parent DELETE, then SRVD, BDEF, CLAS, DDLS and table.
There are no arbitrary generated-child, G4BA, shared SRVD, database-row or helper/RFC calls. Own
children must be natively absent before deleting a dependency; a subsequently present or uncertain
child remains in current residuals even if its earlier deletion was confirmed. The implicit DTT
is tracked separately and must also be absent after the table is deleted.

## Native evidence and its limits

Fixture syntax follows `tests/e2e/rap-write.slow.e2e.test.ts` and the existing A4H behavior-pool
metadata fixture. The explicit `strict(2)` form, supported action and field mapping stay within the
current private parser. These sources are a recipe, not a new observation that this exact fresh
graph compiles. In particular, fresh inactive pool classification/root links, generated include
initialization and the complete publication/generated-delete roundtrip still require the reviewed
native attempt. Unknown native shapes stop with retained owners; there is no alternate graph.

The current DDL proof permits only its independently reviewed native formatting equivalence for
TABL source. Other sources remain exact under their existing editable-source rules. Stored source
hashes, default/active state, namespace-bound identities, package, marker, available native author
fields and full canonical metadata receipts are preserved and compared. Native create acknowledgments
provide provenance when native metadata omits an author; an omitted author is not invented.
Sequential observations are not an atomic snapshot of unlocked dependencies.

The native-governed publication profile requires both effective request policies to contain `*`.
The generated-binding cleanup profile additionally requires both effective package policies to
contain `*`. These grants exist only inside the compiled private stage/context and exact HTTP
graph fence. They are not changes to an application or destination. The profile uses the actual
source-backed same-parent V4 route and exact binding/service association checks.

Native publication status plus matching binding metadata can establish the observed published or
unpublished state. Recording stays `native-governed-unverified`; parent deletion stays
`accepted-unverified` for generated cleanup. Neither frontend/all-alias cleanup nor an actual CTS
receipt nor independently observed generated-resource absence is claimed. Results retain native
dispatch observations separately from adapter submission/uncertainty fields. An error or missing
native status cannot become success merely because a later metadata flag is false.

The native transport uses Basic as MARIAN. The internally constructed pinned context exercises
current private policy composition, not OAuth validation, destination selection or real PP.
Current-build two-writer PP and remaining family/operation qualification retain their separate
acceptance requirements. This graph adds no Cartesian coverage requirement and does not close
unsupported RAP parser/lifecycle variants.

## Phase binding and operator sequence

The fixed entry is `scripts/qualification/pr1142/native-rap-publication.ts`; the permanent root is
`~/.local/state/arc1-qualification/pr1142-native-rap-publication-v1`. No real phase/root was created
by author tests. Only the operator may run the independently reviewed exact commit from its clean
frozen checkout with the existing real dependencies and Node **22.21.1**. The shared binding checks
the full revision, entry, dependency lock, runtime and source at startup, asynchronous boundaries,
actual dispatch and result persistence. No caller root, graph, owner, policy or resume override exists.

After exact-source review and clearing overlapping SAP work/CI, the command shapes are:

```sh
node --import tsx scripts/qualification/pr1142/native-rap-publication.ts --prepare-reviewed-rap-publication-v1 <FULL_SHA>
node --import tsx scripts/qualification/pr1142/native-rap-publication.ts --preflight-reviewed-rap-publication-v1 <FULL_SHA>
node --import tsx scripts/qualification/pr1142/native-rap-publication.ts --check-reviewed-rap-publication-v1 <FULL_SHA> <PREFLIGHT_ID>
node --import tsx scripts/qualification/pr1142/native-rap-publication.ts --execute-reviewed-rap-publication-v1 <FULL_SHA> <PREFLIGHT_ID>
```

The shared environment guard must pass first, including removal of `GIT_*`, `NODE_OPTIONS` and
unsupported Node injection settings. Preparation is offline and permanently binds the fresh graph.
Preflight uses fixed bounded GETs for discovery, all six owners, the implicit DTT and inactive
inventory. Offline check is nonclaiming, performs no client/credential load and grants no execution.
Execution independently rereads the proof, consumes its exclusive permanent claim before credential
loading, and never replays a submitted operation or the claimed graph.

After the successful preflight, the operator must genuinely search SM12 twice and preserve the raw
JPEGs under `preflight/<PREFLIGHT_ID>/sm12-suffix.jpg` and `sm12-user.jpg`. The adjacent
`sm12-baseline.json` uses the shared schema: protocol, revision, canonical intent hash, preflightId,
then `suffixSearch`/`userSearch`, each with observedAt, client `001`, table `*`, zero lockCount and
the actual JPEG SHA256. Suffix search uses user `*`, argument `*<suffix>*`; user search uses
`MARIAN`, argument `*`. Both must be complete error-free current views, newer than the preparation
and preflight and within five minutes. A person must inspect the saved pixels; matching hashes alone
do not prove a search or absence. Keep the host awake and SAP/CI execution non-overlapping.

Execution is bounded by the immutable baseline freshness and a four-minute deadline, 640 request
attempts, 30-second native sends and bounded bodies. Each stage has an exact method/path/query/body
fence, final source/policy/deadline checks through real direct/proxy queue and authentication awaits,
and no replay after dispatch. Own unlock/session close retains bounded cleanup access on stop or
source drift. Failures retain partial facts and exact current/uncertain owners; no rollback or
automatic alternate cleanup starts. Any continuation requires separate inspection and review.

After the one attempt, the operator must preserve the full journal/result and capture fresh actual
user/suffix SM12 searches. These final controls and an independent execution audit remain required;
this entry does not fabricate a server-side global lock check or a final SM12 screenshot.

## Offline validation

Tests compose the real entry, client factory, AdtClient, production private adapters, owning-session
helpers and Undici dispatcher on a synthetic origin with both direct and proxy dispatchers mocked.
They include the successful graph, real missing-include initialization, stale dependency/native
identity refusal, source/stop/expiry after authentication waits, semaphore expiry, publication and
generated-delete uncertainty, child reappearance, implicit-resource residuals, stage scope,
nonclaiming check, one-shot claims and terminal proof failure. Synthetic metadata/status fixtures
are explicitly test models, not native execution evidence.

Roadmap impact: FEAT-93 gains this bounded qualification candidate; native/PP acceptance and the
named parser/generated-cleanup limits remain open.
