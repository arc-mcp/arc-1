# Text symbols / text pool (Textelemente) read + write via ADT

**Date:** 2026-07-02 · **Systems:** a4h 758, a4h-2025 816, npl 7.50 · **Status:** Phase 1 research complete, verified live.

## Motivation

A user rewriting a report class to use text symbols (`'Text'(001)`) hit ATC finding
*"Textsymbol 001 nicht definiert"*: the inline reference alone only shifts the finding — ATC then
demands maintained **text pool** entries. ARC-1 could not read or write class text pools, so
maintaining them was a manual SE24/Eclipse step. This dossier establishes the real ADT contract so
ARC-1 can read **and write** class (and program / function-group) text symbols.

## TL;DR

- The **only** working text-elements API is the top-level service:
  `/sap/bc/adt/textelements/{programs|classes|functiongroups}/{NAME}/source/{symbols|selections}`.
- **Read** = GET with `Accept: application/vnd.sap.adt.textelements.symbols.v1`.
- **Write** = lock the *textelements* object → `PUT …/source/symbols` (Content-Type **and** Accept =
  `…symbols.v1`) → unlock. Immediately active; no separate activation; `$TMP` needs no transport.
- **Release-gated**: present on 758 + 816, **entirely absent on 7.50** (not in discovery).
- **Bug found**: ARC-1's existing `SAPRead type=TEXT_ELEMENTS` calls
  `/sap/bc/adt/programs/programs/{name}/textelements`, which returns **404 on every tested release**
  (7.50, 758). The feature is dead in the field; only a mocked unit test covers it.

## Verified ADT contract

### Endpoint shape
```
GET  /sap/bc/adt/textelements/classes/{NAME}                 → rept:textElement metadata (subobjects + etags)
GET  /sap/bc/adt/textelements/classes/{NAME}/source/symbols  → text symbols  (Accept: …symbols.v1)
GET  /sap/bc/adt/textelements/classes/{NAME}/source/selections → selection texts (Accept: …selections.v1)
POST /sap/bc/adt/textelements/classes/{NAME}?_action=LOCK&accessMode=MODIFY   → lock handle
PUT  /sap/bc/adt/textelements/classes/{NAME}/source/symbols?lockHandle=…      → write (200)
POST /sap/bc/adt/textelements/classes/{NAME}?_action=UNLOCK&lockHandle=…
```
`classes` swaps to `programs` / `functiongroups` for those object types. Media types (from SAP's
`com.sap.adt.textelements` bundle): `…textelements.v1+xml` (metadata), `…symbols.v1`,
`…selections.v1`, `…headings.v1`.

### Symbols body format (properties-style, per-symbol MaxLength)
```
@MaxLength:15
001=Name

@MaxLength:15
002=Typ
```
Each entry is `@MaxLength:NN` then `{NNN}={text}`, blank-line separated. `@MaxLength` is **per
symbol** — a shared/missing length → `406 "Text elements contain errors; correct all inconsistencies"`
and the write is rejected (no partial commit).

### Write gotchas (live-verified on a4h 758)
1. **Lock the textelements object**, not the class: `POST /sap/bc/adt/textelements/classes/{n}?_action=LOCK`
   returns `<LOCK_HANDLE>` with `IS_LOCAL=X` for `$TMP` (→ no transport). Transportable objects
   would carry `CORRNR` like any other lock.
2. **PUT needs both `Content-Type` AND `Accept` = `…symbols.v1`.** Missing `Accept` → `400 "Accept
   header missing"` (and — fragile quirk — it still commits the body). Always send Accept.
3. On success PUT returns 200 with the written body echoed; read-back confirms persistence.
4. **No activation step** — the metadata reports `version="active"` and the pool is live immediately.

### Live evidence (a4h 758)
```
# read a standard class' symbols
GET textelements/classes/cl_gui_alv_grid/source/symbols  → 200  "@MaxLength:13\r\n003=Einblenden...\r\n\r\n…"
# full write round-trip on a throwaway $TMP class ZCL_ARC1_TESPIKE (created + deleted):
[0] GET  symbols BEFORE        → 200  ''
[2] LOCK textelements obj      → 200  LOCK_HANDLE=…  IS_LOCAL=X
[3] PUT  source/symbols (CT+Accept=symbols.v1) body "@MaxLength:10\n001=Servus\n" → 200
[4] UNLOCK                     → 200
[5] GET  symbols AFTER         → 200  '@MaxLength:10\r\n001=Servus'   ✓ persisted
# malformed body (one @MaxLength for two symbols)  → 406, not persisted
# missing Accept on PUT                            → 400 "Accept header missing"
```

## Per-release matrix

| Check | npl 7.50 | a4h 758 | a4h-2025 816 |
|---|---|---|---|
| `textelements/*` in discovery | **absent (0)** | present | present (read verified) |
| `textelements/classes/{n}/source/symbols` GET | 404 ResourceNotFound | **200** | **200** |
| class symbols write (lock→PUT→unlock) | n/a (no service) | **200 verified** | not written (read-only smoke) |
| legacy `programs/programs/{n}/textelements` (ARC-1 today) | **404** | **404** | not tested |

7.50 lacks the service entirely → hard release gate (gate on discovery presence of the
`textelements/{type}` collection, no bespoke probe needed). `programs/programs/{n}/source/main`
returns 200 on 7.50, so the base path is fine — only `/textelements` is missing.

## The legacy-endpoint bug

`src/adt/client.ts` `getTextElements()` → `/sap/bc/adt/programs/programs/{name}/textelements`.
Live: **404 "No suitable resource found"** on both 7.50 and 758, even for `RSWATCH0` which clearly
has text symbols (2.4 KB via the new endpoint). Only `tests/unit/adt/client.test.ts:682` (mocked)
covers it. So today `SAPRead type=TEXT_ELEMENTS` never works against a real system. Fixing it to the
new service kills the bug and adds classes/function-groups for free.

## ARC-1 impact map

| File | Change |
|---|---|
| `src/adt/client.ts:1386` | Replace `getTextElements` with the top-level-service call; add class/funcgroup read + `writeTextSymbols` (lock→PUT→unlock via stateful session) |
| `src/handlers/read.ts:30,669` | Route text-symbol reads by object type (program/class/funcgroup) instead of program-only |
| `src/handlers/tools.ts` (16,89,92,97,505) | Update descriptions; decide read surface (extend `TEXT_ELEMENTS` vs per-object aspect); write surface on SAPWrite |
| `src/handlers/schemas.ts` | Zod for the read/write params (three-file sync) |
| `src/handlers/tool-registry.ts:90` | `TEXT_ELEMENTS` row; classes make it **BTP-eligible** if Steampunk has the service (open Q) |
| `src/adt/discovery.ts` / `features.ts` | Discovery/feature gate on the `textelements/{type}` collection (fail clean on 7.50) |
| tests + `tests/fixtures/tool-definitions/*` | Unit (real endpoint), integration round-trip, frozen tool-surface fixtures |

## Design options (for Phase 2)

- **Read surface.** (a) Fix `TEXT_ELEMENTS` and let it accept the object's type (needs a type param —
  today it's program-only), or (b) model text symbols as an *aspect* of the object
  (`SAPRead type=CLAS name=X aspect=text_symbols`). (b) is cleaner but touches more of the read
  schema.
- **Write surface.** Natural fit is a `SAPWrite` action, e.g. `edit_text_symbols` with
  `{type, name, source=<properties body>}`, reusing the lock/PUT/unlock engine. Selection texts
  (`source/selections`) are the same shape — include or defer.
- **Safety.** Writes ride the existing write scope + package allowlist (enforced against the object's
  real package). No new opt-in needed beyond `SAP_ALLOW_WRITES`.

## Open questions

1. **BTP / Steampunk (919)**: does the `textelements` service exist on ABAP Cloud? Classes exist
   there; if the service is present this becomes a BTP feature too (today `TEXT_ELEMENTS` is
   BTP-excluded). Needs a live check on Steampunk.
2. **Selections + headings**: include selection texts and list headings now, or symbols-only first?
3. **Transportable objects**: verify a non-`$TMP` write threads the lock's `CORRNR` (should mirror
   the generic source-write path).
4. **abaplint / pre-write lint**: text-symbol bodies are not ABAP source — must bypass pre-write lint.

## Addendum (2026-07-02, post-implementation live findings)

- **Class selection texts do not exist.** During live implementation testing, `edit_selection_texts`
  on a class returned **406 "Cannot parse the source code, due to invalid syntax"**, and every class's
  `source/selections` reads back **empty** (verified on `cl_gui_alv_grid`, len 0). Selection texts are
  a *program selection-screen* concept — a class has no `PARAMETERS`/`SELECT-OPTIONS`, so the segment
  is structurally empty and un-writable. **Shipped scope was therefore narrowed to text symbols only**
  (the actual ATC pain); selection texts move to the program follow-up. Open question #2 resolved.
- **Shipped surface:** `SAPRead type=CLAS include=text_symbols` + `SAPWrite action=edit_text_symbols`
  (on-prem only). Verified end-to-end on a4h 758: create `$TMP` class referencing `'Hi'(001)` →
  `edit_text_symbols` → read back → activate clean; malformed body → 406; delete. Integration test
  `crud.lifecycle.integration.test.ts` "class text symbols" passed live.
- **Discovery gate nuance:** the clean 7.50 error fires only when discovery is loaded
  (`http.hasDiscoveryData()`). The real MCP server loads it (`server.ts` `setDiscoveryMap`), so 7.50
  users get the friendly message; the CLI one-shot doesn't load discovery, so it falls back to SAP's
  raw 404 — acceptable by design.

## Repro commands
```bash
PW=$(grep '^SAP_PASSWORD=' .env | cut -d= -f2-)
curl -u MARIAN:$PW -H 'Accept: application/vnd.sap.adt.textelements.symbols.v1' \
  http://a4h.marianzeis.de:50000/sap/bc/adt/textelements/classes/cl_gui_alv_grid/source/symbols
# write spike: scratchpad/te_write_spike.py (lock→PUT→unlock→read-back)
```
