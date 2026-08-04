# Plan: `SAPTransport action="diff"` — transport-scoped review diffs

Status: proposed → implementing
Companion research: [2026-08-03-transport-diff-comparison-and-plan.md](../research/2026-08-03-transport-diff-comparison-and-plan.md)

Reference implementations, in order of authority:

1. **SAP** (gold standard) — `com.sap.adt.tm.backend.diff.TransportDiffService` +
   `com.sap.adt.tools.core.versioning.internal.{Revision,AdtObjectHistoryService}`,
   ADT bundle 3.60.1 / `sapse.adt-vscode` 1.1.1, decompiled.
2. **PoC** (validated refinement) — `marianfoo/arc1-transport-review-poc-private@191b267`,
   run against 13 real customer transports.
3. Live spikes on `a4h.marianzeis.de` (S/4HANA 2023, SAP_BASIS 758) — section 1.

---

## 1. Verified facts (live spikes, 2026-08-03)

Every design decision below rests on one of these. Nothing here is assumed.

**F1 — the transport link's rel and attribute.** Real feed for `ZARC1_DEMO_REPORT`:

```xml
<atom:entry>
  <atom:content type="text/plain" src=".../source/main/versions/20260623093443/00001/content"/>
  <atom:id>00001</atom:id>
  <atom:link adtcore:name="A4HK906289"
             href="/sap/bc/adt/cts/transportrequests/A4HK906289"
             rel="http://www.sap.com/adt/relations/transport/request"
             type="application/vnd.sap.adt.transportrequests.v1+xml"
             title="ARC-1 demo: new package + classes + programs 2026-06-23"/>
  <atom:title>ARC-1 demo: new package + classes + programs 2026-06-23</atom:title>
  <atom:updated>2026-06-23T09:34:43Z</atom:updated>
</atom:entry>
```

The rel is `…/adt/relations/transport/**request**`; the transport id is `adtcore:name`; `atom:title`
is the transport **description**, not the id. Two link variants per entry (`…sapgui`,
`…transportrequests.v1+xml`) carry the same `adtcore:name`. This matches SAP's
`AdtObjectHistoryService`, which reads exactly this rel + `QName(adtcore, "name")`.

**F2 — ARC-1 never sees the transport today.** `parseRevisionFeed` looks for rel
`http://www.sap.com/adt/relations/transport**s**`, which does not exist in the feed. Spike output
(ARC-1's own parser over the captured XML) — no `transport` key on any revision:

```
{ "id": "00002", "author": "MARIAN", "timestamp": "2026-06-23T11:23:41Z",
  "versionTitle": "test review", "uri": ".../versions/20260623112341/00002/content" }
```

This is the root defect. Every transport-aware behavior is blocked on it.

**F3 — `<atom:id>` is the 5-digit version number; `00000` is ACTIVE.** Confirmed against SAP's
`Revision` constructor, which maps `"00000"` → `ACTIVE_UI_TEXT` (`"Active"`) and `"99999"` →
`INACTIVE_UI_TEXT`, and against the live feed.

**F4 — feed order is neither version order nor date order.** `ZCL_ARC1_DEMO_CALC` main feed returns
document order `00002, 00000, 00001` with timestamps `11:23:41, 11:22:09, 09:34:43`. The ACTIVE entry
sits **between** two released revisions. Any implementation that trusts document order is wrong.

**F5 — an object with no released history has exactly one entry: `00000`, no transport link, no
title.** (`ZCL_ABAPGIT_AUTH`.) Distinguishing this from "created in this transport" needs positive
evidence, not the absence of a predecessor.

**F6 — version records reference the REQUEST sometimes and the TASK other times.** `VRSD ⋈ E070`
for the demo objects: every `KORRNUM` resolves to `TRFUNCTION = 'K'` with blank `STRKORR` — a
workbench request. But the versions feed for `CERTRULE_DYNP` names `A4HK900111`, and
`E070` says `A4HK900111 → STRKORR A4HK900110` — a **task** of the request being reviewed.

So both occur on one system. SAP's exact-match on the single `transportNumber` argument would miss
the task case and fall back silently. Matching request **∪ tasks** is a strict superset and handles
both. *(Verified end-to-end: `diff A4HK900110` selects the right pair only because of this rule.)*

**F7 — released versions with a blank transport exist.** `VRSD` row
`DDLS ZARC1_DV_MNZQP5V11PD2 versno=00001 korrnum=<blank>`. This independently reproduces the PoC's
`T4DK9A21AJ` finding on a second system: **a predecessor must not be required to carry a CTS id.**

**F8 — transport payload shape.** `GET /sap/bc/adt/cts/transportrequests/A4HK906291` with
`Accept: application/vnd.sap.adt.transportorganizer.v1+xml` works for a **released** transport and
returns:

- `pgmid="CORR" type="RELE" name="A4HK906292 20260623 112341 MARIAN"` — release-comment noise;
- `pgmid="LIMU" type="METH" name="ZCL_ARC1_DEMO_CALC            SUBTRACT" wbtype="CLAS/OM"` — the
  real change, at method level, with a 30-char padded class name;
- the same object repeated under `<tm:all_objects>` and under `<tm:task>`.

Four raw entries, one logical object (`CLAS ZCL_ARC1_DEMO_CALC`).

**F8b — ARC-1 already collects task-level objects only.** `parseTransportList`
(`src/adt/transport.ts:875`) walks `<tm:task>` and ignores request-level `<tm:abap_object>` and
`<tm:all_objects>`. So the `CORR/RELE` noise and the request/`all_objects` duplicates never reach the
handler; the remaining problem is purely the **LIMU name** (`ZCL_ARC1_DEMO_CALC            SUBTRACT`),
which no ADT endpoint resolves. The `CORR` guard stays as cheap defence, not as the main fix.

**F9 — end-to-end golden case.** Transport `A4HK906291` ⇒ logical object `CLAS ZCL_ARC1_DEMO_CALC`
⇒ current revision `00002` (`adtcore:name="A4HK906291"`) ⇒ predecessor `00001` (skipping the ACTIVE
`00000`) ⇒ a real, non-empty diff. Known-good expectation for the integration test.

**F10 — a revision may carry NO `<atom:updated>` at all.** `CERTRULE_DYNP` version `00001` has no
timestamp element. Sorting must treat undated entries as oldest; comparing them on the version
number instead lets a high-numbered undated revision outrank a genuinely newer dated one *and*
breaks comparator transitivity, so the result depends on input order. Found by running the tool
live — no fixture suggested it.

**F12 — DDLS and DCLS hang their versions feed off the OBJECT, not off `/source/main`.**
Probed across every type in `revisionsUrlFor` on a4h:

| Type | `…/source/main/versions` | `…/versions` |
|---|---|---|
| PROG, INTF, INCL, FUNC, BDEF, SRVD | ✅ | 404 |
| CLAS (`…/includes/{inc}/versions`) | ✅ | — |
| **DDLS, DCLS** | **404** | **✅** |

Not a guessable pattern — `ddic/srvd/sources` uses the long form while `ddic/ddl/sources` and
`acm/dcl/sources` use the short one. ARC-1 used the long form for all three, so **every CDS view and
access control in a transport reported `baseline-unavailable`**, and revision-id diffs for those
types never worked. Pre-existing bug, fixed here.

**F13 — `99999` is the INACTIVE draft, and it is not a baseline.** SAP's `Revision` constructor maps
`00000` → "Active" and `99999` → "Inactive". A CDS view created but not yet activated has *only* a
`99999` entry. Either pseudo-version may legitimately be the **current** side of a review — that is
the change being shipped — but neither is ever a transported predecessor, and the fallback must not
select one as `current` when a real snapshot exists.

**F11 — while a transport is open, its objects' ACTIVE entry carries the transport link.**
`CERTRULE_DYNP`'s `00000` names `A4HK900110` (status D). So an unreleased transport needs **no
special case**: the active revision matches on the normal path and the walk back lands on the last
released state. The planned `active↔inactive` branch was removed as dead weight — one algorithm
covers "what did this ship" and "what am I about to ship", with the same evidence labels.

---

## 2. Design

### 2.1 Revision-pair selection

SAP's algorithm, with the PoC's four corrections. Pure function, no I/O:

```ts
selectTransportRevisionPair(revisions: RevisionInfo[], transportIds: Set<string>): TransportRevisionPair
```

1. Sort newest-first: `timestamp` desc → `number` desc → original index (stable). *(SAP sorts on
   date only; F4 shows document order is meaningless, so ties must break on the version number.)*
2. `current` = first revision whose `transport` ∈ `transportIds` → `selectionMethod: 'exact-transport'`.
3. else first revision with `number !== '00000'` → `'latest-revision-fallback'`.
4. else index 0 → `'active-only-fallback'`. Empty input → `'no-revisions'`.
5. `previous` = walk forward from `current + 1`, skipping revisions that are `00000` **or** that also
   belong to `transportIds`; record each as `skipped[]` with a reason. *(SAP skips at most one ACTIVE
   entry and never a same-transport sibling — F4 shows one skip is enough for the common case, but
   two saves under one transport need the loop.)*
6. `previous` is **not** required to carry a transport id (F7).

`selectionMethod` is returned, never swallowed — a reviewer must be able to tell exact evidence from
a fallback guess. SAP's output schema has no equivalent field.

### 2.2 Baseline status

| status | meaning | condition |
|---|---|---|
| `prior-revision` | real diff against the immediately preceding revision | `exact-transport` + previous resolved |
| `prior-revision-unverified` | a predecessor exists, but the "after" side was only guessed — the diff may belong to another change | fallback selection + previous resolved |
| `no-prior-snapshot` | **created in this transport** | `exact-transport`, no predecessor, **and** no older revision anywhere in the feed |
| `baseline-ambiguous` | no usable baseline: either the current revision was not matched, or an older revision exists that the walk did not reach | — |
| `baseline-unavailable` | no revision feed, or the feed read failed | — |

A type with no diffable source is NOT a `BaselineStatus`; it is reported as `inventoryReason` on the
object, so it stays visible in the review without pretending to be a failed diff.

Creation is asserted only on positive evidence (PoC rule; SAP does not distinguish these at all).

### 2.3 Logical object rollup

Port `logicalTransportObject` (PoC) + SAP's `filterUniqueObjects` intent:

- drop `pgmid="CORR"` (release comments, F8);
- LIMU class components (`CINC/CPRI/CPRO/CPUB/CLSD/METH/REPT`, or `wbtype` starting `CLAS/`) →
  `R3TR CLAS <owner>`, where owner = `name.slice(0, 30).replace(/=+.*$/, '').trimEnd()`. This
  handles both the `====CP`/`====CCIMP` class-pool forms and the 30-char-padded `METH` form (F8).
  *(SAP's `extractClassName` takes `^([^\s]+)`, which handles `METH` but leaves `====CCIMP` attached;
  the PoC's form covers both.)*
- LIMU `REPS`/`REPT` → `R3TR PROG`;
- dedup on `pgmid:type:name`, merging `taskIds`.

### 2.4 Open transports — no special case (revised after F11)

The plan originally called for an `active ↔ inactive` branch when `status === 'D'`. Live testing
showed it was unnecessary and worse: while a transport is open its objects are locked, so the ACTIVE
revision carries the transport link and matches on the normal path (F11). The branch was removed —
the general algorithm produces the same pair with *better* evidence (`exact-transport` rather than a
fallback label). Fewer code paths, one comparison model.

### 2.4b Which class includes to diff

CTS states it directly, so read it rather than inferring: a `LIMU CINC <class padded to 30>CCIMP`
entry names the include, `METH`/`CPUB`/`CPRI`/`CPRO`/`CLSD` mean the main source. The suffix starts
at a FIXED offset 30 — CTS pads with `=` only when the name is shorter, and 6.6% of live CINC rows
are 30-character names with no padding at all, where splitting on `=` silently resolves to `main`.

A bare `R3TR CLAS` entry carries no component detail, so it falls back to all five includes. That is
correct by construction: `R3TR CLAS X` and any `LIMU <sub> X` are **mutually exclusive per request**
— measured across ~640k LIMU rows on 758, zero counterexamples — so an `R3TR CLAS` entry is exactly
the case where CTS deliberately records nothing finer. Corollary: a transport carrying `LIMU METH`
and no `CINC` is positive evidence that the include was not saved into that request.

For that fallback shape only, the four untouched includes would render SAP's boilerplate headers as
fresh additions. `suppressUntouchedParts` blanks their diff while keeping the row for coverage — but
only when a sibling part matched the transport exactly, and never for a row whose read failed.

Known limit: `LIMU CINC` and `LIMU METH` are distinct CTS keys with distinct locks, so a class's
include can legitimately live in a *different* request. That is inherent to transport-scoped review,
not a defect here.

### 2.5 CLAS expansion

A class is five source parts, each with its own versions feed (`main`, `definitions`,
`implementations`, `macros`, `testclasses`) — `revisionsUrlFor` already supports all five. Each part
gets its own pair selection and its own diff block; parts with no feed are silently omitted, parts
that fail are reported.

### 2.6 Tool surface

`SAPTransport(action="diff", id, offset?, limit?)` — `scope: 'read'`, `opType: Read`,
`featureGate: 'transport'`, identical to `SAPTransport.get`. `limit` defaults to 20, capped at 40
(SAP's `pageSize` ceiling, so results are comparable). Plain `offset`/`limit` instead of SAP's opaque
cursor — same capability, stateless.

Output: header line + per-object blocks with type/name, `selectionMethod`, `baselineStatus`,
`from`→`to` revision evidence, `+N/-M`, and the hunks. Objects with no diffable source are listed as
inventory with a reason, never silently dropped (SAP D4).

---

## 3. Changes

| # | File | Change |
|---|---|---|
| C1 | `src/adt/xml-parser.ts` | `parseRevisionFeed`: match rel `…/transport/request` (keep `…/transports` as fallback), read `adtcore:name`, fall back to `href` tail then `@_title`; add `number` |
| C2 | `src/adt/types.ts` | new `TransportRevisionPair`, `TransportObjectDiff`, `TransportDiffResult`. **No** `RevisionInfo.number` — the number is derived by an exported `revisionNumber(rev)` helper in C3, so the shared type is untouched |
| C3 | `src/adt/transport-diff.ts` *(new)* | `selectTransportRevisionPair`, `rollupTransportObjects`, `diffTransportObjects` |
| C4 | `src/adt/source-diff.ts` | `normalizeSource`: strip trailing `[ \t]+`, force trailing newline |
| C5 | `src/handlers/transport.ts` | `case 'diff'` |
| C6 | `src/handlers/schemas.ts` | `'diff'` in the action enum + `offset`/`limit` |
| C7 | `src/handlers/tools.ts` | JSON-Schema properties + description |
| C8 | `src/authz/policy.ts` | `'SAPTransport.diff'` = read / Read / transport |

No new ADT endpoint, no new safety flag, no change to `checkOperation` coverage — every call goes
through the already-guarded `getTransport`, `getRevisions`, `getRevisionSource`, and the existing
source readers.

---

## 4. Tests

### Unit — `tests/unit/adt/transport-diff.test.ts`

Fixtures captured live from a4h go to `tests/fixtures/adt/versions/`.

Revision-pair selection:

1. exact-transport match returns that revision and `selectionMethod: 'exact-transport'`
2. **F4 ordering**: `[00002@11:23, 00000@11:22, 00001@09:34]` in feed order → current `00002`,
   previous `00001`, `00000` in `skipped` with the active reason
3. no match → `latest-revision-fallback`, and `00000` is not chosen as current
4. only `00000` present (F5) → `active-only-fallback`, `previous: null`
5. `[]` → `no-revisions`
6. **F7**: predecessor with a blank `transport` is still selected
7. two revisions of the same transport → the older sibling is skipped, previous is the one before
   the transport (SAP D2)
8. equal timestamps → tiebreak on version number desc
9. task id matches as well as the request id (F6 superset rule)
10. `skipped[]` carries a distinct reason for `00000` vs. same-transport

Rollup:

11. `CORR/RELE` entry dropped (F8)
12. `LIMU METH "ZCL_X            SUBTRACT"` → `R3TR CLAS ZCL_X`
13. `LIMU CINC "ZCL_X============CCIMP"` → `R3TR CLAS ZCL_X`
14. `LIMU REPS Z_PROG` → `R3TR PROG Z_PROG`
15. the same object under two tasks collapses to one logical object with both `taskIds` (F8b: the
    request/`all_objects` duplicates never reach us, but cross-task duplicates do)
16. `R3TR DDLS` passes through untouched

Baseline status:

17. exact-transport + no predecessor → `no-prior-snapshot`
18. fallback + no predecessor → `baseline-ambiguous` (**not** creation)
19. feed read throws → `baseline-unavailable`, no exception escapes

### Unit — `tests/unit/adt/xml-parser.test.ts` (extend)

20. real class feed (F1/F4 fixture) → all three revisions carry `transport`, ids `00002/00000/00001`
21. `00000` entry has no `transport`
22. legacy rel `…/relations/transports` still parses (back-compat)
23. link without `adtcore:name` → falls back to the id in `href`
24. *(moved to C3)* `revisionNumber()` reads the number from `id`, and from `uri` when `id` is not a
    bare number

### Unit — `tests/unit/adt/source-diff.test.ts` (extend)

25. trailing-whitespace-only change produces no hunks
26. missing trailing newline on one side produces no hunks

### Unit — `tests/unit/handlers/transport.test.ts` (extend)

27. `action="diff"` without `id` → clear error
28. `limit` above 40 is clamped
29. rendered output contains `selectionMethod` and `baselineStatus` per object
30. metadata-only object appears as inventory with a reason, not an error

### Snapshot

31. `tests/fixtures/tool-definitions/*.json` regenerated (`vitest -u`) and the diff reviewed — the
    only change may be the new `SAPTransport` action + two properties

### Policy

32. `npm run validate:policy` — `SAPTransport.diff` present, scope `read`

### Integration — `tests/integration/adt.integration.test.ts` (extend, opt-in)

33. **F9 golden case**: `diff` of `A4HK906291` yields exactly one logical object
    `CLAS ZCL_ARC1_DEMO_CALC`, `selectionMethod: 'exact-transport'`, `from` `00001` → `to` `00002`,
    non-empty hunks. Guarded by `requireOrSkip` on `TEST_SAP_URL`.

### Gate

`npm test && npm run typecheck && npm run lint && npm run validate:policy && npm run build && npm run check:sizes`

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Other releases use the old `…/relations/transports` rel | both rels accepted (test 22) |
| `<atom:id>` is a URN on some release, not a bare number | `number` parsed from `id` **or** `uri` (test 24) |
| Version records carry a task, not the request (F6 unproven elsewhere) | match request ∪ tasks — a superset of SAP's rule |
| Large transports blow up the response | `limit` default 20 / cap 40, mirroring SAP |
| `parseRevisionFeed` change breaks existing consumers | `transport` is currently always absent (F2), so nothing can depend on it; `number` is additive |

## 6. Out of scope

Cross-system diff; metadata serializers for DOMA/DTEL/MSAG/SRVB; FUGR include expansion (needs the
`L<group>*` ownership rule and its own evidence pass — tracked separately); an opaque cursor.

---

## 7. Live verification matrix (2026-08-03)

Two purpose-built transports on a4h, covering create → release → modify-subset → release.

**A4HK906369** — creates `INTF ZIF_ARC1_TD_SHAPE`, `CLAS ZCL_ARC1_TD_CALC` (with a CCIMP local
class), `PROG ZARC1_TD_REPORT`, `DDLS ZARC1_TD_VIEW`, `DOMA ZARC1_TD_DOM`.
**A4HK906371** — modifies only the class main, the class CCIMP, and the program.

| Case | Expected | Observed |
|---|---|---|
| Created objects, transport open | `exact-transport` / `no-prior-snapshot` | ✅ (matched on the **task** id for 4 of 5 — the request-only match would have failed) |
| Created objects, transport released | `exact-transport` / `no-prior-snapshot` | ✅ |
| Modified class main | `prior-revision` 00001 → 00002, the one changed line | ✅ |
| **Modified class CCIMP** | own `prior-revision` pair, the local-class line | ✅ — the multi-include claim, proven |
| Untouched class includes | listed, no diff | ✅ `not changed by this transport` |
| Untouched objects (INTF/DDLS/DOMA) | absent from transport B | ✅ |
| Metadata type (DOMA) | inventory, not an error | ✅ |
| CDS view | real diff | ✅ **after F12** — reported `baseline-unavailable` before |
| Unactivated CDS view | current = `99999` draft | ✅ **after F13** |

Both bugs were found by running the tool against real transports; neither was visible from fixtures.
