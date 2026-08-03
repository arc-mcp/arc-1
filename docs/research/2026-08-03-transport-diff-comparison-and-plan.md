# Transport diff: SAP's ADT MCP tool vs. ARC-1 — findings and improvement plan

Date: 2026-08-03

> **Superseded in part.** This is the comparison that motivated the work. The live-verified wire
> facts, the corrections they forced, and the shipped design live in
> [docs/plans/2026-08-03-transport-diff.md](../plans/2026-08-03-transport-diff.md) — read that for
> what is true, this for why. Notably §3/G1 understates the parser bug: ARC-1 matched the wrong
> atom `rel` entirely, so `transport` was *always* absent, not merely lossy.

Sources (all verified, none from memory):

- SAP: `com.sap.adt.tm.model_3.60.1.jar` from `sapse.adt-vscode-1.1.1-darwin-arm64`, decompiled
  (`javap -c -p com.sap.adt.tm.backend.diff.TransportDiffService`, `…mcp.GenerateTransportDiffTool`).
- PoC: `marianfoo/arc1-transport-review-poc-private@191b267` —
  `scripts/transport-review/{revisions,source-resolution,object-model,transport-selection,parsers}.mjs`,
  `docs/{sap-adt-transport-diff,transport-result-audit-2026-07-23}.md`.
  Live-verified against 13 real customer transports.
- ARC-1: this repo — `src/adt/{version-diff,source-diff,client,xml-parser,transport}.ts`,
  `src/handlers/{read,transport}.ts`, `~/.claude/skills/sap-transport-review/SKILL.md`.

---

## 1. SAP's algorithm, exactly

Tool `abap_transport-unifiedDifference` (`AbstractTransportMcpTool.DOMAIN_TRANSPORT_PREFIX =
"abap_transport-"` + `getToolName() = "unifiedDifference"`).

Input schema (embedded string constant in `GenerateTransportDiffTool`):

```json
{"type":"object","properties":{
  "destination":{"type":"string"},
  "transportNumber":{"type":"string","minLength":1,"maxLength":20},
  "cursor":{"type":"string"},
  "pageSize":{"type":"integer","minimum":1,"maximum":40,"default":40}},
 "required":["destination","transportNumber","pageSize"]}
```

Output: `{batchInfo:{currentBatchSize,totalObjects,processedCount,remainingCount,batchHasChanges,
status},message,nextCursor,diffResult}`. `diffResult` is one concatenated unified-diff string.

Pipeline (`TransportDiffService.generateDiffForMultipleObjectsPaginated`):

1. `filterUniqueObjects(objects)`
   - **drops every entry whose `wbtype` is null or blank**;
   - `wbtype.startsWith("CLAS/")` → `handleClassObject`: entries containing `/OM` (methods) yield to
     the whole-class entry; `CLAS/OSI`, `CLAS/OC`, `CLAS/OI` collapse to one per class.
     `extractClassName` = `replace("%20"," ")` then `^([^\s]+)`, default `"UNKNOWN"`.
     **No `=====CP` class-pool suffix handling.**
   - everything else: dedup key `name + wbtype`.
2. `subList(startIndex, endIndex)` per `pageSize`; cursor = `PaginationCursor(index, transportNumber)`,
   validated against the requested transport on the next call.
3. `batchResolveObjectUris` — one ADT batch request, `Accept:
   application/vnd.sap.adt.transportorganizer.v1+xml`, takes `links[0].href`.
4. `resolveObjectToSourceFile` — ADT URI → `IAdtUriMappingService.getPlatformResource` → SFS `IFile`.
   Not an `IFile` → `Feature not supported for object {0}`. Not remote-existing →
   `Object {0} does not exist or was deleted from the system`.
5. `fetchVersionHistory` — Eclipse Team `IFileHistoryProvider` over the SFS file; `$TMP` objects are
   filtered by `isLocalObject` (checks `packageRef`/`containerRef` == `$TMP`).
6. **Revision selection** — the part that matters:

```java
sortRevisionsByDateDesc(revs);   // Comparator.comparing(timestamp, nullsLast(reverseOrder()))

int cur = findCurrentRevisionIndex(revs, requestNumber);
// for each rev, in date-desc order:
//   requestNumber non-empty && rev.getVersion().getCorrectionNumber().equals(requestNumber) -> i
//   requestNumber empty     && IRevision.ACTIVE_UI_TEXT.equals(rev.getVersion().getVersionId()) -> i
// else -1
if (cur == -1 && revs.length > 0) cur = 0;          // silent fallback to newest

int prev = findPreviousRevisionIndex(revs, cur);
// cur is ACTIVE          -> cur+1
// revs[cur+1] is ACTIVE  -> cur+2
// otherwise              -> cur+1
```

7. `executeDiffCalculation(inputs, UNIFIED_DIFF)` — `DiffCalculator` over Eclipse
   `rangedifferencer` with a `LineComparator` that compares lines by plain `String.equals`.
   `UnifiedDiffFormatter` writes `@@` hunks, honors `\ No newline at end of file`, context lines
   configurable, concurrent formatting above a threshold.

### 1.1 Four defects in SAP's logic

**D1 — request vs. task, silently.** `getCorrectionNumber()` is the correction the version was
written under. A version saved under task `…AK` does not `.equals("…AJ")`, the parent request. When
the reviewer passes the request — the normal case, and what the schema asks for — `findCurrentRevisionIndex`
returns `-1` and the caller silently substitutes index `0`. The diff becomes *"newest change vs. the
one before it"*, not *"what this transport did"*. `batchHasChanges` still reports `true` and the
output schema has no field that could reveal the substitution.

**D2 — multi-correction inside one transport.** `findPreviousRevisionIndex` skips at most **one**
ACTIVE entry and never checks whether `revs[cur+1]` belongs to the *same* transport. Save an object
twice under one TR (two tasks, or two save cycles) and the diff shows only the last save. The review
misses the earlier hunks of the same change set.

**D3 — no line-ending normalization.** `LineComparator.rangesEqual` is `String.equals`. A CRLF/LF
flip renders as a full-file rewrite.

**D4 — dropped inventory is invisible.** Blank `wbtype` entries vanish in `filterUniqueObjects`;
unsupported objects produce a message string inside `diffResult`, not a machine-readable coverage
status. A release gate cannot distinguish *"no source change"* from *"we could not look"*.

---

## 2. What the PoC got right

`selectTransportRevisionPair(revisions, currentTransportIds)` in `revisions.mjs` is the corrected
version of SAP's step 6. Differences that each fix a real, observed failure:

| PoC behavior | Fixes |
|---|---|
| `currentTransportIds = {request, trigger, ...tasks}` (`artifact-builder.mjs:119`) | D1 |
| Predecessor loop skips `00000` **and** every further revision belonging to the current transport | D2 |
| Transport id extracted by regex `[A-Z0-9]{3}K[A-Z0-9]{6}` over the atom link's `@_title` + `@_version` + **`@_href`**, and over the entry `title` | Revisions whose transports link has a blank title — see below |
| `selectionMethod ∈ {exact-transport, latest-revision-fallback, active-only-fallback, no-revisions}` returned to the caller | D4 |
| `skipped[]` carries each rejected revision + `rejectionReason` | auditability |
| **Predecessor is not required to carry a CTS id** | the `T4DK9A21AJ` bug |
| `normalizeSource`: CRLF→LF, strip trailing `[ \t]+`, force trailing newline (`config.mjs:102`) | D3 |
| Baseline states `prior-revision` / `no-prior-snapshot` / `baseline-ambiguous` / `baseline-unavailable`; creation confirmed **only** when `exact-transport` **and** no predecessor | D4 |
| `preferActiveSource` when transport status is `D`/modifiable | open transports have no snapshot |

The `T4DK9A21AJ` finding is the sharpest one and is worth quoting from `docs/sap-adt-transport-diff.md`:
revisions `00005` and `00008` are valid immediate predecessors *even though their Atom transport link
is blank*. Requiring every baseline revision to carry a CTS id picks an older, wrong base.

Two more PoC rules that are not about revision selection but decide whether a review is readable at
all:

- **Logical object rollup** (`object-model.mjs:117`): LIMU `CINC/CPRI/CPRO/CPUB/CLSD/METH/REPT` and
  `wbtype CLAS/*` → owner class, stripping the `=====CP` class-pool suffix and truncating to 30
  chars; LIMU `REPS/REPT` → `PROG`. Without this, a transport's raw entry list is unusable as a
  review scope.
- **FUGR include ownership** (`parsers.mjs:681`): only includes named `L<group>*` or
  `/ns/L<group>*` belong to the group. Audit finding F1: accepting every direct `FUGR/I` reference
  emitted 379 spurious diff files across the corpus, dominated by SAP framework includes `LSVIM*`,
  and pushed four function groups into an artificial `coverage-limit` failure.

Also worth carrying over: `CLAS` is **five** source parts, each with its own versions feed —
`main`, `definitions`, `implementations`, `macros`, `testclasses` (`object-model.mjs:180`).

---

## 3. ARC-1 today — gap list

ARC-1 has no transport-level diff. The primitive is `SAPRead(action="diff", from, to)`
(`src/handlers/read.ts:153` → `src/adt/version-diff.ts`), and the `sap-transport-review` skill loops
it over `SAPTransport(action="get")`. Concrete defects when that path is used for a review:

**G1 — transport attribution is lossy.** `parseRevisionFeed` (`src/adt/xml-parser.ts:1540`):

```ts
const transport = String(transportLink?.['@_title'] ?? transportLink?.['@_version'] ?? '');
```

No `@_href`, no id regex, no fallback to the entry `title`. This is exactly the blank-title case the
PoC had to fix. Any revision-pair logic built on this field inherits the bug.

**G2 — no revision number.** `RevisionInfo` (`src/adt/types.ts:1150`) has `id`, `author`,
`timestamp`, `versionTitle?`, `transport?`, `uri`. There is no parsed 5-digit version number, so
`00000` (the active work state) cannot be identified or skipped.

**G3 — no pair selection at all.** `getVersionDiff` resolves whatever `from`/`to` the caller names.
Choosing the pair is delegated to the LLM, which means it is chosen differently every run and no
evidence of the choice survives into the output.

**G4 — CLAS reviews are incomplete by default.** `fetchSourceByType` uses `getClass(name)` unless
`include` is passed, and `revisionsUrlFor` defaults to `includes/main/versions`. A class whose change
lives in `CCIMP`/`testclasses` diffs clean. Silently.

**G5 — `DIFF_SUPPORTED_TYPES` overstates support.** `FUGR`, `DDLX`, `TABL` are listed
(`src/adt/version-diff.ts:22`) but `revisionsUrlFor` (`src/adt/client.ts:982`) throws for all three.
Only `active`↔`inactive` works for them; a revision-based transport diff cannot cover them. The code
comment acknowledges this; the tool description does not.

**G6 — no LIMU rollup.** `parseTransportRequests` (`src/adt/transport.ts:880`) captures `pgmid`,
`type`, `name`, `wbtype` correctly — the raw material is there — but nothing collapses LIMU entries
to their R3TR owner. Feeding `ZCL_FOO=========CP` or a `METH` entry into `SAPRead` is a 404.

**G7 — partial whitespace normalization.** `unifiedDiff` (`src/adt/source-diff.ts:23`) normalizes
CRLF — better than SAP — but does not strip trailing whitespace or force a trailing newline. ABAP
editors pad lines; a save cycle can flip trailing blanks across a whole include.

**G8 — no coverage taxonomy.** `errorResult` for a failed diff is a string. Nothing distinguishes
"metadata type, no source diff" from "object deleted" from "we could not read it".

---

## 4. Plan

Ranked. P0 is small and useful on its own; P1 is the tool; P2 is honesty.

### P0 — three surgical fixes to existing code (no new tool)

**P0.1 Fix revision attribution.** `src/adt/xml-parser.ts` `parseRevisionFeed`:
join `@_title`, `@_version`, `@_href` plus the entry `<title>`, extract with
`/(?:^|[^A-Z0-9])([A-Z0-9]{3}K[A-Z0-9]{6})(?=$|[^A-Z0-9])/`, fall back to the raw title as today.
Add `number: string` to `RevisionInfo` — 5-digit group from `id` or `uri`. ~15 lines, plus fixture
tests in `tests/unit/adt/xml-parser.test.ts`. Fixes G1+G2 and unblocks everything below.

**P0.2 Port `selectTransportRevisionPair`.** New `src/adt/transport-diff.ts` (~70 lines), a direct
port of `revisions.mjs` with the PoC's four fixes. Signature:

```ts
selectTransportRevisionPair(revisions: RevisionInfo[], transportIds: Set<string>):
  { current: RevisionInfo|null; previous: RevisionInfo|null;
    selectionMethod: 'exact-transport'|'latest-revision-fallback'|'active-only-fallback'|'no-revisions';
    skipped: Array<RevisionInfo & { rejectionReason: string }> }
```

Pure function over `RevisionInfo[]` — unit-testable with no SAP.

**P0.3 Logical rollup on `SAPTransport(action="get")`.** Port `logicalTransportObject` into
`src/adt/transport.ts` and add `logicalType`/`logicalName`/`logicalPgmid` to each returned object,
keeping the raw entry intact. Additive; existing consumers unaffected. Fixes G6 and immediately
improves the current skill without any new tool.

### P1 — `SAPTransport(action="diff", id=…)`

Handler in `src/handlers/transport.ts`, engine in `src/adt/transport-diff.ts`. Composition only —
`getTransport` → rollup → source parts → `getRevisions` → `selectTransportRevisionPair` →
`getRevisionSource` ×2 → `unifiedDiff`. No new ADT endpoint, no new safety surface (`read` scope,
`OperationType.Read`, same guards as `GetRevisions`/`GetRevisionSource`).

Arguments: `id`, `offset`/`limit` (cap 40, mirroring SAP so the two are comparable), `maxObjects`.

Per-object result — the shape that makes it a *review* rather than a dump, and the shape SAP's output
schema is missing:

```
{ type, name, taskIds[],
  selectionMethod, baselineStatus,
  from: {id, number, transport, timestamp} | null,
  to:   {id, number, transport, timestamp},
  added, removed, diff }
```

`baselineStatus ∈ prior-revision | no-prior-snapshot | baseline-ambiguous | baseline-unavailable |
not-supported | failed`, with `no-prior-snapshot` (= created here) asserted **only** when
`selectionMethod === 'exact-transport'` and there is no predecessor. Everything else that looks like
creation is `baseline-ambiguous`.

Transport-id set = request + all task ids, per P0.2 — this is the D1 fix and the single biggest
correctness win over SAP's tool.

Open transports (`status` `D`/modifiable): diff `active`↔`inactive` and label it, rather than
reporting empty batches. ABAP snapshots only on release, so for an open TR the revision path has
nothing to find — SAP's tool returns empty batches here by construction.

CLAS expands to its five includes; each gets its own pair selection and its own diff block.

### P2 — coverage honesty

- Emit `not-supported` for the metadata types instead of an error string, and keep them in the object
  table so the reviewer sees they were in scope (audit F5: 137 of `T4DK9A21AJ`'s 142 entries are ADIR
  inventory, not missing code).
- Never convert a 404 on the versions feed into `no-prior-snapshot` (audit F4).
- FUGR: apply the `L<group>*` ownership rule when expanding includes (audit F1).
- Correct `DIFF_SUPPORTED_TYPES` / the tool description for G5 — FUGR/DDLX/TABL are
  `active`↔`inactive` only.
- `normalizeSource` in `unifiedDiff`: strip trailing `[ \t]+` per line, force trailing newline (G7).

---

## 5. Out of scope

- Cross-system diff — stays a skill orchestration (two `--url` runs), not a tool.
- Metadata serializers for DOMA/DTEL/MSAG/SRVB/… — type-specific work with its own baseline
  semantics; inventory-only is the correct representation until then.
- Copying SAP's cursor encoding — plain `offset`/`limit` is equivalent and stateless.
- A server-side comparison endpoint. ADT exposes none; the diff is computed client-side in all three
  implementations.
