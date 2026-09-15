# Issue #692 — DDLS table-function guard and delete 404 misclassification

**Status:** Fixed and validated; root causes and implementation tested live on 2026-08-11 against
NW 7.50 SP02 (`SAP_BASIS 750`) and S/4HANA 2023 (`SAP_BASIS 758`).

## TL;DR

Issue #692 contains two real ARC-1 defects and one unverified SAP-side hypothesis that the live
tests disproved:

1. `guardCdsSyntax()` is supposed to guard only `define table entity`, but its regex accidentally
   includes `function`. A live 7.50 system contains active SAP-delivered CDS table functions and
   can create, update, activate, and delete a custom one. ARC-1 nevertheless rejects the same
   construct when startup feature evidence is cached, with an error about `define table entity`.
2. `batch_create` omits `guardCdsSyntax()` entirely, so single create/update and batch create do not
   enforce the same release rule. The fix is to restore the intended entity-only regex and run the
   guard in the batch source-validation phase too.
3. NW 7.50 overloads HTTP 404 for a DDLS delete rejected because an active DDLS consumer still
   exists. ARC-1's dependency detector recognizes the English text but misses the German text, and
   the dispatcher then unconditionally says the object was not found. Use independent metadata
   resolution after the failed mutation as language-independent existence evidence and record a
   tri-state result (`exists`, `absent`, or `unknown`). Use a confirmed post-lock DDLS 404 as a
   dependency signal, suppress the generic not-found hint when existence is confirmed, and report
   uncertainty when the follow-up probe itself fails. A post-fix live review found that 7.50 can
   return a lock handle for an absent DDLS, so lock success alone is deliberately not used.

The reporter's proposed underlying cause for delete — the table function's HANA runtime object or
its AMDP implementation — is not the cause. Deleting an active table function while its active AMDP
class still existed succeeded on both test systems. Adding an active DDLS consumer reproduced the
404 on 7.50; deleting that consumer made the table-function delete succeed immediately.

## Claim and scope

The issue reports:

- `SAPWrite(update, DDLS)` rejects a valid `define table function` on `SAP_BASIS 750`, before SAP is
  called, using an error that names `define table entity` and requires release 757.
- `batch_create` accepted the same table function because it does not call the CDS release guard.
- A later DDLS delete returned HTTP 404 with German text `konnte nicht gelöscht werden`, but ARC-1
  added `Object ... was not found` even though it had already locked the object.

This dossier covers the DDLS source write guard, batch parity, and LLM-facing delete diagnostics. It
does not change the ADT CRUD wire contract or add a bypass for genuinely unsupported
`define table entity` syntax.

## HEAD behavior and repository history

### Table-function false positive

`src/handlers/cds-hints.ts` currently contains:

```ts
if (/\bdefine\s+table\s+(entity|function)\b/i.test(source)) {
```

The surrounding comment and error both describe only `define table entity`. The approved plan,
`docs/plans/completed/2026-04-13-cds-write-robustness.md`, also specified exactly:

```ts
/\bdefine\s+table\s+entity\b/i
```

Git history shows that commit `c06d8847` introduced the widened `(entity|function)` implementation
even though its plan, commit message, tests, comment, and error string all described an entity-only
guard. This is an implementation typo in the original feature, not a later release change.

The guard is called from:

- `src/handlers/write/create.ts` `writeActionCreate()`;
- `src/handlers/write/update-delete.ts` `writeActionUpdate()`.

It is not called from `src/handlers/write/create.ts` `writeActionBatchCreate()`, whose per-object
source-validation block currently runs RAP preflight and lint only.

### Delete misclassification

`src/handlers/write/update-delete.ts` does the correct stateful sequence:

```text
LOCK object -> DELETE object?lockHandle=... -> UNLOCK
```

Its `isDeleteDependencyError()` recognizes DDIC diagnostic 039 and a list of English phrases. A
German 404 without a T100 diagnostic misses both branches, so no `buildCdsDeleteDependencyHint()`
result is attached.

Separately, `src/handlers/dispatch.ts` treats every `AdtApiError.isNotFound` as proof that the named
object is absent. The dispatcher lacks the handler's stronger lifecycle and metadata evidence.

## ADT contract

The local Eclipse ADT contract research gives the canonical DDLS resource and capabilities:

- collection/object: `/sap/bc/adt/ddic/ddl/sources[/{name}]`;
- source: `/sap/bc/adt/ddic/ddl/sources/{name}/source/main`;
- DDLS advertises locking and native deletion;
- lock: `POST {object}?_action=LOCK&accessMode=MODIFY`;
- source update: `PUT {source}?lockHandle=...` with `Content-Type: text/plain`;
- delete: `DELETE {object}?lockHandle=...`;
- unlock: `POST {object}?_action=UNLOCK&lockHandle=...`.

Sources:

- `~/DEV/arc-1-eclipse-adt/api/01-rap-object-types-and-uris.md`;
- `~/DEV/arc-1-eclipse-adt/api/05-lock-create-update-transport.md`.

SAP's own adt-ls independently models DDLS as a supported source object and deletes an existing
object only after resolving it by repository search, then deleting its metadata URI. See
`~/DEV/arc-1-lsp/dist/adt-ls/lifecycle.js` and `docs/adt-ls-reference.md` section 5. It does not expose
a client-side table-function release guard.

The fr0ster reference client also routes `DDLS/DF` through its normal view update/delete lifecycle.
It contains the same unsafe assumption that any 404 from its high-level delete means "not found",
so it is evidence for the shared endpoint, not a model for correct error classification.

The official ABAP language reference search returned `ABENNEWS-750-ABAP_CDS`, which explicitly lists
`DEFINE TABLE FUNCTION` as new in release 7.50, plus the current
`ABENCDS_F1_DEFINE_TABLE_FUNCTION` contract. No relevant SAP Note was found for the overloaded delete
404; the live system behavior is sufficient and deterministic.

## Live validation

All mutations used unique `$TMP` objects and were deleted afterwards. TADIR lookup returned zero
remaining test objects on both systems.

### 1. SAP-delivered table functions are active on 750 and 758

Command shape:

```bash
arc1-cli call SAPRead --json \
  '{"type":"DDLS","name":"DEMO_CDS_GET_SCARR_SPFLI","version":"active"}'
```

| System | Result content |
|---|---|
| NW 7.50 SP02 / `SAP_BASIS 750` | Active source starts `define table function DEMO_CDS_GET_SCARR_SPFLI` and names `CL_DEMO_AMDP_FUNCTIONS=>GET_SCARR_SPFLI_FOR_CDS`. |
| S/4HANA 2023 / `SAP_BASIS 758` | Active source contains the same table-function construct and AMDP implementation contract. |

This proves the guarded token sequence is a real supported DDLS construct on the release named by
the issue; it is not merely syntax accepted by a newer client.

### 2. Current ARC-1 reproduces the false positive on live 750 evidence

The startup-equivalent feature probe returned:

```json
{"release":"750","systemType":"onprem"}
```

Calling the normal `handleToolCall()` path for a `$TMP` DDLS create containing
`define table function Z_I692_GUARD_ONLY ...` then returned in 5 ms, before any create request:

```text
"define table entity" syntax requires ABAP Cloud (BTP) or S/4HANA on-premise
with SAP_BASIS >= 757. This system reports SAP_BASIS 750.
```

The requested object was never created.

### 3. `batch_create` proves the same construct works end to end on 750

Because current `batch_create` omits the guard, it was used to create the isolated
`Z_I692_NPL_TF_0811` table function. The returned result was:

```text
Batch created 1 objects in package $TMP: Z_I692_NPL_TF_0811 (DDLS) ✓ [$TMP]
```

`SAPRead(version="active")` returned the exact active source, including
`define table function Z_I692_NPL_TF_0811`. A matching AMDP class was then created and activated.
This validates create, source write, and activation on the real 7.50 system rather than relying only
on the SAP-delivered demo.

### 4. Table function plus AMDP alone does not cause delete failure

The same isolated table-function/AMDP pair was created and activated on 750 and 758. Deleting the
DDLS while the active AMDP class still existed succeeded on both systems:

```text
Deleted DDLS Z_I692_NPL_TF_0811.   # 750
Deleted DDLS Z_I692_TF_0811.       # 758
```

This disproves the issue's tentative HANA-runtime/AMDP-blocker theory.

### 5. An active DDLS consumer reproduces the German 404 on 750

On 750, the table function was recreated and an active classic CDS view
`Z_I692_NPL_USE_0811` was added with `select from Z_I692_NPL_TF_0811`. Deleting the table function
with `SAP_LANGUAGE=DE` produced:

```text
HTTP 404 DELETE
/sap/bc/adt/ddic/ddl/sources/Z_I692_NPL_TF_0811?lockHandle=<redacted>

Ddl Source Z_I692_NPL_TF_0811 konnte nicht gelöscht werden

Hint: Object "Z_I692_NPL_TF_0811" (type DDLS) was not found.
```

The path contains a real lock handle obtained immediately before DELETE. The object was also still
readable and active after the failure.

Repeating only the delete with `SAP_LANGUAGE=EN` returned the same HTTP 404 and operation path, but
the body changed to:

```text
DDL source Z_I692_NPL_TF_0811 could not be deleted
```

The English phrase triggered the current dependency enrichment, while the generic not-found hint
still appeared before it. Thus the difference is client-side language matching, not different SAP
semantics.

Finally, deleting `Z_I692_NPL_USE_0811` first made the same table-function delete succeed. The AMDP
class could be deleted independently. TADIR lookup then confirmed all three objects absent.

### 6. Plan review found that lock success alone is insufficient on 750

During the first post-fix live pass, `batch_create` correctly rejected `Z_I692_BAD_ENT` before its
create POST and TADIR lookup confirmed the object was absent. A defensive cleanup delete against
that absent name nevertheless received a lock handle from 7.50; DELETE then returned HTTP 423
`Resource Data Definition ... is not locked (invalid lock handle ...)`.

This falsified the first draft's assumption that LOCK success alone proves existence on this old
stack. The refined design requires independent object metadata evidence as well:

- every post-lock 404 triggers a follow-up metadata read, independent of package-gate settings;
- a successful post-failure metadata read records `exists`;
- only a metadata-probe 404 records `absent` and suppresses 404 phrase-based dependency matching;
- any other metadata-probe failure records `unknown`, avoids a false missing-object claim, and
  preserves message-based dependency enrichment without inferring a localized DDLS dependency.

The reported dependent-DDLS object remains distinguishable: it was readable before the attempt and
remained readable after the 404.

### Result matrix

| Scenario | 750 | 758 |
|---|---|---|
| Read active SAP-delivered table function | success | success |
| Create/write/activate isolated table function | success via current batch path | success via normal create/update/activate |
| Delete table function while AMDP class exists | success | success |
| Delete table function with active DDLS consumer | HTTP 404; German body misses detector, English body hits it | Not needed to establish 750 issue; endpoint delete itself already validated |
| Delete after consumer removal | success | n/a |
| LOCK an absent, batch-rejected DDLS name | returns a handle; DELETE later fails 423 | n/a |

## Root cause

### Bug 1

The regex's `|function` alternation is accidental. It contradicts the construct named by the comment
and error, the original reviewed plan, official 7.50 release documentation, and both live systems.

`batch_create` independently skipped the guard because its source-validation pipeline was copied
without the `guardCdsSyntax()` call. This made the accidental single-object false positive visible:
batch create reached SAP and worked, while update stopped client-side.

### Bug 2

The HTTP status is not sufficient to classify ADT delete failures. On NW 7.50's DDLS native-delete
handler, 404 can mean "the deletion could not be completed" rather than "the object URI does not
exist". The handler can combine a successful post-failure metadata resolution with its knowledge
that the error came from DELETE, not the earlier lookup/lock stage.

The existing dependency detector relies on English response text when no diagnostic number is
present. The German body therefore misses enrichment. The dispatcher then compounds the problem by
mapping every 404 to a missing object without considering operation stage.

The robust signal is structural, not linguistic:

- a 404 during metadata resolution or LOCK may still mean absent and should retain the generic
  not-found hint;
- LOCK alone is not proof on 7.50 because an absent DDLS can receive a handle;
- a 404 from DELETE after LOCK plus successful post-failure metadata confirmation is a
  delete-handler failure and must not be described as object absence;
- a non-404 failure from the follow-up probe is inconclusive and must not be converted into an
  absent-object claim; existing structured/message dependency evidence remains valid on that path;
- for DDLS, the live-verified post-lock 404 should trigger existing where-used enrichment even when
  the localized response text is unknown;
- other object types should still suppress the false absence claim, but should not be labeled as a
  dependency failure without their existing structured or message evidence.

## Recommended fix and affected files

1. `src/handlers/cds-hints.ts`
   - narrow the table-entity regex to `\bdefine\s+table\s+entity\b`;
   - keep the existing release threshold and no-feature-evidence fail-open behavior.
2. `src/handlers/write/create.ts`
   - invoke `guardCdsSyntax()` in the `batch_create` per-object source-validation block before any
     object is created;
   - record a per-item failure and stop consistently with the existing RAP/lint branches.
3. `src/adt/errors.ts`
   - add an optional handler-owned `resourceExistenceAfterDelete` state to `AdtApiError`, analogous
     to `extraHint` but used for classification rather than appended prose.
4. `src/handlers/write/update-delete.ts`
   - track whether LOCK succeeded;
   - confirm existence with a metadata read after every post-lock 404;
   - record `exists`, `absent`, or `unknown` from the follow-up metadata probe;
   - treat a confirmed post-lock DDLS 404 as a dependency signal independent of localized message
     text, and reuse `buildCdsDeleteDependencyHint()`; retain the existing detector for other
     sensitive types and non-404 errors, but require the same confirmation for its 404 matches.
5. `src/handlers/dispatch.ts`
   - distinguish confirmed existence, confirmed absence, and an inconclusive metadata probe;
   - never emit the missing-object hint when the probe is inconclusive;
   - allow `extraHint` to remain the final, detailed remediation block.
6. Focused tests:
   - `tests/unit/handlers/cds-write-guard.test.ts`: table functions pass the 750 guard on single
     create/update and batch; table entities remain blocked on 750, including batch;
   - `tests/unit/handlers/transport.test.ts`: German post-lock DDLS 404 receives dependency guidance
     without a missing-object hint; a pre-lock 404 retains normal not-found guidance; a non-CDS
     post-lock delete 404 receives the generic delete-handler explanation; an English dependency
     404 whose metadata probe fails non-404 retains remediation without claiming absence; a
     non-CDS inconclusive probe directs the caller to verify current state with `SAPSearch`.

No tool schema or public parameter changes are needed, so `tools.ts`, `schemas.ts`, and frozen tool
definition fixtures stay unchanged.

The focused guard suite was split out of `write-create-batch.test.ts` during final review because
the combined file exceeded the repository's 3,000-line size ratchet. The budget was not raised.

## Fix validation

Local validation after the final review:

- focused handler suite: 228 tests passed;
- full unit suite: 171 files and 4,993 tests passed;
- `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run check:sizes` passed;
- lint reported only the repository's pre-existing Biome 2.5.5 schema / 2.5.7 CLI notices.

Live validation of the built implementation:

- 750: normal single create, update, activation, and active readback of `Z_I692_FIX_TF` passed;
- 750: batched `define table entity` was rejected with the 750/757 guard and no TADIR object;
- 750: an active `Z_I692_FIX_USE` consumer reproduced the German delete 404; the fixed response
  retained the SAP text, said ARC-1 confirmed the object still existed, appended dependency
  follow-up, and did not say `was not found`;
- 758: normal single create, update, activation, active readback, and delete of
  `Z_I692_FIX23_TF` passed;
- final TADIR lookups confirmed all temporary names absent on both systems.

## Out of scope

- Do not add a `preflightBeforeWrite` or lint override for the deterministic table-entity release
  guard. Correctly detected `define table entity` remains unsupported below 757; bypassing the guard
  would only defer the same failure to SAP.
- Do not add German-specific phrases as the primary fix. That would leave every other SAP logon
  language vulnerable to the same misclassification.
- Do not change ADT CRUD paths, media types, or stateful-session handling.
- Do not claim the 7.50 where-used API always lists the blocker. On the test system it returned no
  references for this dependency; the fallback guidance remains necessary.

## Paste-able GitHub reply

```markdown
Confirmed both defects and reproduced them on a real NW 7.50 system, with a cross-check on S/4HANA 2023 / SAP_BASIS 758.

The table-function rejection is an ARC-1 regex bug. The original reviewed plan guarded only `define table entity`, but the implementation accidentally shipped `(entity|function)`. SAP's own 7.50 demo `DEMO_CDS_GET_SCARR_SPFLI` is an active `define table function`, and an isolated `$TMP` table function also created, wrote, activated, read back, and deleted successfully on our 7.50 system. `batch_create` currently works only because it omits this guard.

I also reproduced the exact German delete response on 7.50:

`HTTP 404 ... Ddl Source Z_I692_NPL_TF_0811 konnte nicht gelöscht werden`

The underlying blocker was an active DDLS consumer. After deleting that consumer, the table function deleted successfully. The AMDP class by itself did **not** block deletion on either 750 or 758, so the tentative HANA-runtime/AMDP theory is not the cause.

The diagnostic bug has two layers: the dependency matcher is English-only, and the dispatcher treats every 404 as absence. Here a metadata read after the failed DELETE proves the object still exists. (Live review also showed that 7.50 may issue a lock handle for an absent DDLS, so lock alone is not used.) The fix will use that combined evidence instead of adding another translated phrase: confirmed post-lock 404s will no longer say "object not found", and DDLS will run the existing dependency enrichment regardless of response language.

The implementation will therefore restore the entity-only guard, add the same guard to `batch_create`, and make post-lock delete classification language-independent, with regression coverage for German 404 and genuine pre-lock not-found behavior.
```

**Recommendation:** Fix both ARC-1 defects and open a PR linked to #692.
