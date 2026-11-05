# Fixed package, batch-create, recorded move and API qualification

The original A4H/001 MARIAN attempt is consumed: it completed request/task creation,
LOCAL root/child creation and real batch creation/activation, then stopped on the
nonempty-root refusal classifier. All four repository owners remain. A [separate retained
tail](2026-11-04-native-package-api-retained.md) adopts this exact state without repeating
the successful prefix. It does not establish PP, public-route or whole-PR readiness. The accepted
[PR 2 plan](../plans/2026-10-26-broader-pinned-pp-writes.md) remains the acceptance scope.

The previous three-owner LOCAL run created/read back root, child and class, then stopped
at an unclassified DELETE400 whose body was not retained. Its separate audited recovery
deleted those three owners. Both claims remain consumed. The new experiment uses fresh
names and preserves the unknown original refusal; it does not replay that graph.

## One compiled graph

`native-package-api.ts` shares the existing package phase, receipt and owning-session
lifecycle. Its fixed profile adds one independent interface to the new local root:

| Resource | Placement / purpose |
|---|---|
| `$ARC1_PK_R_<suffix>` | New parentless LOCAL development package, non-recording |
| `$ARC1_PK_C_<suffix>` | Actual child of the new root, non-recording |
| `ZIF_ARC1_PK_<suffix>` | Independent interface in the root; no class dependency |
| `ZCL_ARC1_PK_<suffix>` | Simple class initially in the child, then moved once to ZARC1_DEMO |
| `ZARC1_DEMO` | Existing read-only reference/destination, never an owned cleanup target |
| Native generated request/task | One new owned empty-target Workbench pair; retained bookkeeping |

The 16-character hexadecimal suffix is fixed by prepare. There are no caller-selected
names, objects, packages, contracts, request IDs or resume points. The old 605/606 and
607/608 request/task pairs are explicitly excluded.

The fixed sequence is:

1. Read the existing ZARC1_DEMO metadata; create one request with the existing CTS helper.
   Read back its generated parent and exactly one MARIAN task, both modifiable, with an
   empty target, client001, exact request description and no object entries. Preserve the
   native task label; do not assume S/Q/X. Missing/ambiguous tasks stop without another CREATE.
2. Create the local root and child. Use the existing `batch_create` adapter for INTF + CLAS
   with `activateAtEnd:true`, followed by its one native two-owner activation. Preserve
   each item's create/activation outcome, stored source hash and owning session closure.
3. Attempt the normal shared native deletion primitive on the populated root and child.
   The root contains the child and interface; the child contains the class. Only the
   existing exact native nonempty classifier qualifies a refusal. A generic400 or an early
   browser refusal does not. The fixed negative path uses the shared deletion primitive,
   so the optional positive-content browser shortcut cannot replace the native response.
4. Move the class once from the child to ZARC1_DEMO using the existing preview/execute
   helper. Bind the exact owner and native parent request; verify source/package/author
   and native request membership. Preview may have effects and is not described as read-only.
5. Release C1 with explicit Cloud Development visibility, refuse a stale expected state
   with no PUT, then revoke C1 without a visibility argument. Verify the APIS resource's
   actual package, native recording and current release states before class deletion.
6. Delete the class with its exact recorded request, then the local interface, child and
   root. Verify typed owner absence and suffix inventory, retaining newly present/uncertain
   owners even when an earlier deletion was confirmed.

Request/task records and their actual CLAS/APIS entries remain explicit retained
bookkeeping. They are not released, imported, deleted or automatically stripped of
entries. A repository owner404 does not prove API directory/TADIR absence. This graph
does not qualify recorded DEVC deletion, recorded-to-local moves, other API contracts or
an independent API-catalog cleanup guarantee.

## Authorization, evidence and failure handling

Both package policies name the exact new root, child and ZARC1_DEMO. There is no invented
`$TMP/**` ancestry. The compiled LOCAL root and CTS creation contexts have the explicit
request policies required by their existing adapters. All later operations use the one
newly verified parent request on both request policies. CTS management is enabled only
for the prepared create helper; later operations retain a recording-only ceiling. These
are internal native test contexts, not changes to application or destination policies.

The current ZARC1_DEMO observation is active, HOME, recording enabled, with an explicitly
empty layer. Its `isAddingObjectsAllowed=false` field is retained without interpreting
it alone as an object-creation ban. Fresh metadata is required before request creation
and recorded operations. No extra standard-source GET, guessed metadata API, package
browser authorization, SQL/RFC/ABAP helper or ABAP execution is introduced.

Fresh namespace-bound owner metadata, actual version, author, source and native CTS
receipts are checked around operations and under owning deletion locks. Parent receipts
are rechecked between batch saves. Move/API helpers keep their documented lack of a
cross-request lock; revalidation does not promise cross-writer atomicity.

One permanent attempt claim, immutable intent/preflight/JPEG proof, source binding,
four-minute workflow ceiling, original five-minute prerequisite freshness, 30-second
request clamps, 640 attempts, cumulative2MiB response allowance and no replay apply.
Both direct and Connectivity sends repeat checks after queue/auth/CSRF waits. Only own
unlock/session cleanup retains its bounded cleanup allowance after expiry or stop.

Expected nonempty refusals followed by verified changed-state move/deletion are distinct
planned operations. Any other failure stops with exact per-item/adapter outcomes,
observed CTS bookkeeping and current residuals; there is no rollback or automatic retry.
The existing bounded non-secret native DELETE diagnostic is retained for this profile
without changing the refusal classifier or rewriting the old failed result.

## Operator phase binding

The only entry is `scripts/qualification/pr1142/native-package-api.ts`; its permanent root
is `~/.local/state/arc1-qualification/pr1142-native-package-api-v1`. Run only the exact
independently reviewed clean revision on Node22.21.1 with the existing runtime restrictions.
Prepare/check do not load native credentials or create native clients.

```text
--prepare-reviewed-package-api-v1 <full-reviewed-sha>
--preflight-reviewed-package-api-v1 <full-reviewed-sha>
--check-reviewed-package-api-v1 <full-reviewed-sha> <fresh-preflight-id>
--execute-reviewed-package-api-v1 <full-reviewed-sha> <fresh-preflight-id>
```

The preflight performs six fixed GETs: four absent owned resources, the suffix inventory,
and the existing recorded package. After preflight, `sm12-baseline.json` binds protocol,
revision, intentHash and preflightId to two genuine fresh raw JPEG searches: client001,
table `*`, user `*`/argument `*<suffix>*`, and user MARIAN/argument `*`, both complete zero
locks. The operator independently inspects pixels and ensures no CI/native overlap and
an awake host. Check is read-only and nonclaiming; it grants no reusable execution permission.

After execution, preserve all raw receipts and the final result, capture fresh equivalent
SM12 controls, and independently audit the exact owners and retained request/task. A
failed/consumed attempt must never be rerun; inspect any residual before proposing a
separately reviewed fixed continuation or cleanup.

## Remaining qualification

Native batch creation, non-cascade refusal, recorded move and APIS recording on this
current graph remain unobserved until the reviewed attempt and audit succeed. The old
native local cleanup can be retained only with its documented narrow component comparison.
Current-build PP, public-route negatives, other named resource gates and final integration
review/CI remain separate accepted-plan work.
