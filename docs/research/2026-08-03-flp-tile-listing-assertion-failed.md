# FLP tile listing short-dumps the backend — `PageChipInstances` is navigation-only

**Date:** 2026-08-03
**Systems:** `npl` (NW 7.50 SP02), `a4h` (S/4HANA 2023, SAP_BASIS **758**), `a4h-2025` (ABAP Platform 2025, SAP_BASIS **816**)
**Trigger:** `SAPManage action=flp_list_tiles` produced an `ASSERTION_FAILED` ST22 short dump on every
call, and ARC-1 reported it to the LLM as a catalog-specific SAP defect.

## TL;DR

`PageChipInstances` in `/sap/opu/odata/UI2/PAGE_BUILDER_CUST` is a **navigation-only child collection
of `Pages`**. Reading it as a top-level entity set with `$filter=pageId eq …` hits a data accessor that
accepts exactly one filter property and `assert 1 = 2`s on anything else — a guaranteed backend short
dump, on every release tested. The fix is to read through the association:

```
GET /sap/opu/odata/UI2/PAGE_BUILDER_CUST/Pages('X-SAP-UI2-CATALOGPAGE%3A<domain>')/PageChipInstances
    ?$format=json&$top=500&$select=pageId,instanceId,chipId,title,configuration
```

This is also exactly how SAP's own launchpad client reads it. **Rule: never send `$filter` to
`PageChipInstances` from any path — not even on `pageId`, not even on `chipId`.**

## Root cause (ABAP source, read live from `a4h`)

`/UI2/CL_EDM_DA_V06_USAGE` (read via `GET /sap/bc/adt/oo/classes/%2FUI2%2FCL_EDM_DA_V06_USAGE/source/main`,
730 lines). Two methods matter.

`_get_filter_from_gw_selopt`, lines 623–646 — verbatim:

```abap
loop at gw_selopt into ls_selopt_in.
  case ls_selopt_in-property.
    when 'GADGET_ID'.
      ls_selopt_out-property = 'BASE_CHIP_ID'.
      ls_selopt_out-select_options = ls_selopt_in-select_options.
    when others.
      assert 1 = 2.          "  <-- ASSERTION_FAILED short dump
  endcase.
  insert ls_selopt_out into table lt_selopt_out.
endloop.
```

Its only caller, `get_entityset`, lines ~288–317:

```abap
data(lv_page_id) = /ui2/if_edm_data_accessor~previous_entity_keytab[ name = 'ID' ]-value.
...
if /ui2/if_edm_data_accessor~previous_entity = 'Page' ##no_text.
  assert lv_page_id is not initial.
  data(ls_page) = lr_cache->get_page( id = lv_page_id ).
  if ls_page is initial.
    /ui2/cx_runtime=>raise_resource_not_found( entity_type = 'Page' ).
  endif.
endif.

lr_cache->get_chip_instances( exporting page_id   = ls_page-id
                                        ir_filter = _get_filter_from_gw_selopt( it_filter_select_options )
                              importing chip_instances = lt_chip_instance ).
```

Two conclusions follow, and they are the whole story:

1. **The page is taken only from `previous_entity_keytab`** — i.e. from the navigation parent
   `Pages('<id>')`. There is no code path that derives the page from a `$filter`. A top-level
   `PageChipInstances` read is not a supported access shape; filtering it by `pageId` was never going to work.
2. **`$filter` select-options are passed straight into the asserting method.** Only the internal
   property `GADGET_ID` survives the `case`. The OData property names ARC-1 can send (`pageId`,
   `chipId`, …) all fall into `when others` — see the live matrix below.

The `raise_resource_not_found( 'Page' )` branch is why a bogus catalog on the navigation path returns a
clean OData 404 instead of a dump.

## Live evidence

### The bug is release-invariant

One deliberate reproduction per system; ST22 checked before and after each call on `a4h`.

| Release | `PageChipInstances?$filter=pageId eq …` | `Pages('…')/PageChipInstances` |
|---|---|---|
| NW 7.50 SP02 (`npl`) | HTTP 500, "The ASSERT condition was violated." | HTTP 200 — 6 tiles for `SAP_EPM_TC_T` (`chipCount` 0006) |
| S/4HANA 2023 / 758 (`a4h`) | HTTP 500, `<code>ASSERTION_FAILED</code>` + new ST22 entry | HTTP 200 — 2 tiles `ZARC1_DEMO`, 19 tiles `/UI2/FLP_ADMIN` (`chipCount` 0019), 141 tiles `SAP_BASIS_TCR_T` (`chipCount` 0141) |
| ABAP Platform 2025 / 816 (`a4h-2025`) | HTTP 500, `<code>ASSERTION_FAILED</code>` | HTTP 200 — 6 tiles for `SAP_EPM_BC_PURCHASER_T` (`chipCount` 0006) |

Returned row counts match the catalog's own `chipCount` exactly on every check, so the navigation path
returns the *complete* set — not a silently filtered subset.

ST22 on `a4h` across the whole session: the only new dumps were the deliberate `$filter` reproductions.
Every navigation-path call — including the 404 case — produced **zero** dumps.

### Query options are genuinely honored (not silently ignored)

Against `Pages('X-SAP-UI2-CATALOGPAGE%3ASAP_BASIS_TCR_T')/PageChipInstances` on `a4h`:

| Request | Observed |
|---|---|
| `$select=instanceId&$top=1` | 1 row, response keys = `['instanceId']` only |
| `$top=3` | 3 rows |
| no `$top` | 141 rows (full set; the service applies no default page size) |

So `$top=500` is a real cap, not decoration — a catalog with more than 500 tiles would be truncated.
Largest catalog observed anywhere: 162 (`FPM_TESTSUITE_GUIBB` on `a4h`).

### No `$filter` is safe, on any path

| Filter | Path | Result |
|---|---|---|
| `pageId eq '…'` | top-level entity set | **500 ASSERTION_FAILED** |
| `chipId eq '…'` | **navigation path** | **500 ASSERTION_FAILED** |

The second row is the important one: the fix is not "filter under the association instead". The DA's
`case` matches the *internal* name `GADGET_ID`, which no OData-visible property maps onto here, so
`$filter` is unusable against `PageChipInstances` regardless of parent. ARC-1 must never send one.

### Missing catalog

`Pages('X-SAP-UI2-CATALOGPAGE%3AZNOPE_XYZ')/PageChipInstances` →
`{"error":{"code":"/IWBEP/CM_MGW_RT/020","message":{"value":"Resource Page not found"}}}`, no dump.
A non-existent catalog is now a normal typed error rather than a silent empty list.

### URL encoding

ARC-1 emits the request through `AdtHttpClient.buildUrl()`, which re-serializes the query string
(`$` → `%24`) but leaves the path untouched. The byte-exact URL ARC-1 produces was verified live:

```
…/PAGE_BUILDER_CUST/Pages('X-SAP-UI2-CATALOGPAGE%3A%2FUI2%2FFLP_ADMIN')/PageChipInstances
  ?%24format=json&%24top=500&%24select=pageId%2CinstanceId%2CchipId%2Ctitle%2Cconfiguration&sap-client=001&sap-language=EN
```

→ HTTP 200, 19 tiles. `encodeURIComponent` on the whole `X-SAP-UI2-CATALOGPAGE:<domain>` key is required
and sufficient; slash-bearing domain IDs (`/UI2/FLP_ADMIN`) work as `%2F`.

## Cross-source check

| Source | Finding |
|---|---|
| **SAP's own client** — `sap/ushell_abap/pbServices/ui2/PageBuildingService.js`, fetched from the system at `/sap/public/bc/ui5_ui5/resources/…` | `readPage` builds `"Pages('" + encodeURIComponent(pageId) + "')"` and adds `?$expand=Bags/Properties,PageChipInstances/Chip/ChipBags/ChipProperties,PageChipInstances/RemoteCatalog,PageChipInstances/ChipInstanceBags/ChipInstanceProperties`. Every chip-instance read in the library is reached through `Pages(…)` or `PageSets(…)` — **never** a top-level `PageChipInstances` collection with a `$filter`. Same `encodeURIComponent` treatment of the key as the fix. |
| **Eclipse ADT** (`~/DEV/arc-1-eclipse-adt`) | `apis.md` lists "FLP OData: `/sap/opu/odata/UI2/PAGE_BUILDER_CUST`" explicitly as *not* an ADT parity target. No contract available — this is OData, not ADT. |
| **adt-ls** (`~/DEV/arc-1-lsp`) | No references to PAGE_BUILDER / PageChipInstance / CATALOGPAGE. |
| **`mcp-abap-adt`, `mcp-abap-adt-fr0ster`** | No FLP coverage at all. ARC-1 is alone in this area; no third-party implementation to compare against. |
| **OData `$metadata`** (fetched live) | `Page` declares `NavigationProperty Name="PageChipInstances"` via association `Page_PageChipInstance` (`Page` 1 → `PageChipInstance` *). `PageChipInstance`'s key is `(pageId, instanceId)`. Confirms the association is the modelled access path. |
| **SAP Notes** | **No Note covers this** — see the search log below. The `CA-FLP-ABA` Notes that *do* describe an `ASSERTION_FAILED` are corrected program errors in other operations, and Note **3472049** independently corroborates the design. |

### SAP Notes search log

Six queries, five angles (service name, class name, component + symptom, SAP's internal property names,
generic OData-filter phrasing). Nothing matches; the last query degenerated into unrelated components
(HANA SQL, Datasphere, Billing), which is the exhaustion signal.

| Query | Result |
|---|---|
| `PAGE_BUILDER_CUST PageChipInstances ASSERTION_FAILED` | 0 hits |
| `/UI2/CL_EDM_DA_V06_USAGE ASSERT condition violated` | 0 hits |
| `PAGE_BUILDER_CUST short dump` | 4 hits, none related (Fiori setup task lists, an OData namespace-node dump) |
| `CA-FLP-ABA ASSERTION_FAILED runtime error` | 15 hits — the three in-component ones are 2711280, 3075736 and two App-Manager dumps; none is a read of chip instances |
| `Fiori launchpad catalog tiles ASSERTION_FAILED` | 10 hits; only the top 3 are `CA-FLP-ABA` (2711280, 3149589, 2625256), all catalog *copy/create*. The remaining 7 are unrelated components (Screen Personas, Focused Build, Gateway 404) |
| `GADGET_ID BASE_CHIP_ID chip filter` | 2 hits, neither about filtering |

The two `CA-FLP-ABA` asserts read in full are both **genuine program errors that SAP corrected**, in
different operations:

- **2711280** — `PAGE_BUILDER_CONF/CloneCatalog` returns HTTP 500 `ASSERTION_FAILED` when copying a
  catalog whose chips reference a stale backend catalog. A data condition on a different service and
  endpoint; the resolution is to replicate the referenced catalog.
- **3075736** — `ASSERTION_FAILED` during backend-catalog replication when the backend catalog no
  longer exists. Shipped as a correction/support package.

That pattern is the point: SAP *does* correct real asserts in this component. There is no correction for
filtering `PageChipInstances` because there is no defect to correct — and the behavior is byte-identical
on 7.50, 758 and 816, i.e. unchanged across a decade of support packages.

**Corroboration from SAP's own vocabulary:** Note **3472049** (`CA-FLP-ABA`, 2024) is titled
"Significant Performance Improvements **EDM routed read requests** (allCatalogs, PageSets, ..)". It
reworks the `/UI2/CL_EDM_*` read path behind the Launchpad Designer and App Finder — and every request
it names is a read reached *through a parent entity*. SAP calls these reads "routed"; the routing is the
navigation, which is exactly what `get_entityset` reading `previous_entity_keytab` implements.

## Affected ARC-1 code

| File | Change |
|---|---|
| `src/adt/flp.ts` | `listTiles` — build the association URL; drop `isAssertionFailedError` and the `backendError` fallback |
| `src/adt/types.ts` | `FlpTileResult` existed only to carry `backendError` — remove; `listTiles` returns `FlpTileInstance[]` |
| `src/handlers/manage.ts` | `flp_list_tiles` — drop the `backendError` branch |
| `tests/unit/adt/flp.test.ts` | Replace the "handles ASSERTION_FAILED gracefully" test with shape assertions (no `$filter`; encoded association path incl. the slash case) |
| `docs_page/roadmap.md` | The FLP bullet advertised "Graceful ASSERTION_FAILED handling" as a feature |

Adjacent paths reviewed and deliberately **not** changed: `createTile` / `addTileToGroup` / `deleteCatalog`
POST/DELETE `PageChipInstances` and `Catalogs('<key>')` by key — no `$filter` involved, no dump risk.
`listCatalogs` and `listGroups` filter `Catalogs` / `Pages`, which are different accessors;
`listGroups`' `$filter=catalogId eq '/UI2/FLPD_CATALOG'` is live-verified working and untouched.

## Was ARC-1's error message right?

No, on both counts. It told the LLM this was "a known SAP issue with certain catalogs" and instructed it
not to try alternative queries. It is neither catalog-specific (every catalog dumps, on every release)
nor an SAP defect (ARC-1 was calling an unsupported shape), and the "do not attempt alternative queries"
line actively discouraged the one thing that works. Removed with the root cause.

## As-shipped verification

Driven end-to-end through the built ARC-1 CLI (`node dist/cli.js call SAPManage --arg
action=flp_list_tiles --arg catalogId=…`), not curl, so the whole handler → client → HTTP chain is
covered. ST22 entry count snapshotted before and after on `a4h`.

| System | Catalog | Result |
|---|---|---|
| `a4h` 758 | `ZARC1_DEMO` | 2 tiles (`chipCount` 0002) |
| `a4h` 758 | `/UI2/FLP_ADMIN` | 19 tiles (0019) — slash-bearing domain ID |
| `a4h` 758 | `X-SAP-UI2-CATALOGPAGE:SAP_BASIS_TCR_T` | 141 tiles (0141) — full-prefix form |
| `a4h` 758 | `ZNOPE_XYZ` | `FLP catalog "ZNOPE_XYZ" not found. Use SAPManage action="flp_list_catalogs" …` |
| `npl` 7.50 | `SAP_EPM_TC_T` | 6 tiles (0006) |
| `a4h-2025` 816 | `SAP_EPM_BC_PURCHASER_T` | 6 tiles (0006) |

**ST22 on `a4h`: 68 entries before, 68 after.** Zero dumps across all four calls, including the 404.

The FLP integration block also runs green live against `a4h`
(`tests/integration/adt.integration.test.ts`, 3 FLP tests incl. the catalog CRUD lifecycle). The tile
test now asserts `tiles.length === Number(catalog.chipCount)` with no dump-tolerant `try/catch`, so a
reintroduced `$filter` fails the suite instead of skipping it.

One wart surfaced only by this end-to-end run: the 404 initially reached `dispatch.ts`'s generic
not-found hint, which told the LLM to `SAPSearch with query ""` — `SAPManage` has no name/type args to
fill the template. `flp_list_tiles` now catches the 404 itself and names the catalog.

## Residual gaps

- `$top=500` truncates silently. No catalog observed anywhere on three systems comes close (max 162),
  but a large productive S/4 catalog could. The handler now flags the boundary rather than reporting a
  truncated count as complete.
- The `$expand` shape SAP uses (`PageChipInstances/Chip/ChipBags/ChipProperties` …) would return chip
  bag properties in one round trip. Not needed for `flp_list_tiles`, which only reports instance
  metadata. Noted if richer tile detail is ever wanted.
