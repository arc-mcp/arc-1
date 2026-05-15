# DEVCLASS Subtree Enumeration — ADT Endpoint Comparison

Research note documenting the candidate endpoints for the
`allowedPackages` `X/**` subtree-rule resolver
([`src/adt/package-hierarchy.ts`](../../src/adt/package-hierarchy.ts),
[`src/adt/client.ts`](../../src/adt/client.ts) `getSubpackages`).

**TL;DR:** Use `POST /sap/bc/adt/repository/nodestructure` with
`parent_type=DEVC/K&parent_name=<pkg>`. This is the canonical primitive
for "direct children of package X." The alternative
`virtualfolders/contents` endpoint also works and returns richer
metadata (child counts + descriptions), but adds a second XML
envelope to parse for no gain at the safety-gate boundary. The
previously-attempted `informationsystem/search?packageName=<pkg>&objectType=DEVC/K`
combination **does not work** — SAP silently ignores `packageName` in
that combination and returns up to 1000 unrelated packages from across
the system.

## Why this matters

`SAP_ALLOWED_PACKAGES='ZFOO/**'` means "permit writes to `ZFOO` and
every transitive sub-package per `TDEVC.PARENTCL`." Computing the
descendant set requires a runtime ADT round-trip per parent. If the
endpoint returns the wrong set, the safety gate either over-grants
(security regression) or denies legitimate writes (functional
regression). The implementation must use an endpoint whose semantics
match `SELECT devclass FROM tdevc WHERE parentcl = ?` exactly.

## The broken endpoint — `informationsystem/search` (do not use for this)

```
GET /sap/bc/adt/repository/informationsystem/search
    ?operation=quickSearch
    &query=*
    &packageName=<pkg>
    &objectType=DEVC/K
    &maxResults=1000
```

**Behaviour observed on S/4HANA 2023 (a4h.marianzeis.de, SAP_BASIS 758)
and confirmed identical on the npl backend:**

```
md5 with-packageName=SABP_UNIT      : 935976917fb24bb4e8ca66b98024d206
md5 without-packageName (no filter) : 935976917fb24bb4e8ca66b98024d206
sets equal? True (1000/1000 names match)
SABP_UNIT_CORE present in either response? No.
```

The `packageName` parameter is silently ignored when `objectType=DEVC/K`
is also present. The endpoint returns the first 1000 DEVC/K rows in
TADIR — unrelated to the requested package. SAP itself documents this
endpoint as a general object-type search; the `packageName` filter is
honoured for *contained objects* (classes, programs, etc.) but not when
the type filter is `DEVC/K`.

The ADT integration test file at
[`tests/integration/adt.integration.test.ts:585-605`](../../tests/integration/adt.integration.test.ts)
already carries a comment noting that `informationsystem/search`
"silently ignores unknown filters anyway" — the `packageName` filter is
one of those ignored cases. This research turned the comment into a
verified bug class.

### Security impact of the broken endpoint

Trace through the BFS resolver with `SAP_ALLOWED_PACKAGES='ZFOO/**'`:

1. `getSubpackages('ZFOO')` returns 1000 unrelated DEVC packages
   (`/AIF/RUNTIME`, `/IWBEP/MGW_B2C`, `BUPA_HIERARCHY_BW`, ...).
2. All 1000 enter the visited set as "children" of `ZFOO`.
3. BFS expands each; SAP returns the **same** 1000 every time.
4. Dedup drops them all → frontier empties → BFS terminates.
5. `maxPackages=10000` is never tripped (set bounded at ~1001).
6. `checkPackage('/AIF/RUNTIME')` against `ZFOO/**` → `allowed`.

The admin sets `ZFOO/**` and gets "ZFOO plus 1000 random SAP packages."
SAP-side `S_DEVELOP` still gates the actual write — but the ARC-1
safety ceiling is supposed to be a first line of defence, not delegate
to SAP. This is the regression this fix closes.

## Option A — `repository/nodestructure` (chosen)

```http
POST /sap/bc/adt/repository/nodestructure
     ?parent_type=DEVC%2FK
     &parent_name=<pkg>
     &parent_tech_name=<pkg>
     &withShortDescriptions=true
Accept:       application/vnd.sap.as+xml
Content-Type: application/vnd.sap.as+xml; charset=UTF-8; dataname=null

<?xml version="1.0" encoding="UTF-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values><DATA><TV_NODEKEY>000000</TV_NODEKEY></DATA></asx:values>
</asx:abap>
```

Response shape (excerpt from `SABP_UNIT`):

```xml
<asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>
<TREE_CONTENT>
  <SEU_ADT_REPOSITORY_OBJ_NODE>
    <OBJECT_TYPE>DEVC/KI</OBJECT_TYPE>              <!-- package interface — filter out -->
    <OBJECT_NAME/>                                   <!-- empty — placeholder for parent itself -->
    ...
  </SEU_ADT_REPOSITORY_OBJ_NODE>
  <SEU_ADT_REPOSITORY_OBJ_NODE>
    <OBJECT_TYPE>DEVC/K</OBJECT_TYPE>
    <OBJECT_NAME>SABP_UNIT_CORE</OBJECT_NAME>        <!-- keep -->
    <OBJECT_URI>/sap/bc/adt/packages/sabp_unit_core</OBJECT_URI>
    ...
  </SEU_ADT_REPOSITORY_OBJ_NODE>
  ...
</TREE_CONTENT>
</DATA></asx:values></asx:abap>
```

Filter the response: `OBJECT_TYPE === 'DEVC/K'` AND non-empty
`OBJECT_NAME`. Drops both the package-interface rows (`DEVC/KI`) and the
placeholder rows for the queried package itself.

### Verified against live SAP

S/4HANA 2023 (a4h.marianzeis.de), BFS via `nodestructure` matches
`SELECT devclass FROM tdevc WHERE parentcl = ?` byte-perfectly:

| Root | Depth | API subtree | TDEVC subtree | Difference |
|------|-------|-------------|---------------|------------|
| `SABP_TOOLS` | 5 | 127 | 127 | **0** |
| `/AIF/MAIN` (namespace) | 3 | 107 | 107 | **0** |
| `SABP_UNIT` | 2 | 19 | 19 | **0** |
| `SABP` | 2 | 38 | 38 | **0** |

Edge cases tested live and behaving as required for a safety gate:

- **Nonexistent parent** (`ZNO_SUCH_PKG_99X`) → HTTP 200, empty body →
  parser returns `[]` (no error). The safety gate continues with the
  empty subtree.
- **Namespace packages** (`/AIF/MAIN`) → 52 direct children, every
  child also namespace-prefixed; URL-encoded `parent_name=%2FAIF%2FMAIN`
  works correctly.
- **`$TMP`** → API returns the TADIR-active subset. Orphan TDEVC rows
  (entries that point at deleted packages but were not cleaned up) are
  filtered server-side. This is desirable for a safety gate: a write
  to a non-existent package would fail anyway.
- **Deep subtree** (`SABP_TOOLS`, 5 levels, 127 packages) → byte-perfect
  match with TDEVC; BFS depth and size caps are not tripped.

### Endpoint used by other ABAP tooling

`nodestructure` is the de-facto-standard primitive for ADT clients:

- [`marcellourbani/abap-adt-api`](https://github.com/marcellourbani/abap-adt-api/blob/main/src/api/nodeContents.ts) — canonical TypeScript ADT library used by Eclipse-flavoured ADT clients
- [`fr0ster/mcp-abap-adt-clients`](https://github.com/fr0ster/mcp-abap-adt-clients/blob/main/src/core/shared/nodeStructure.ts) — sibling repo of `fr0ster/mcp-abap-adt`; in production since Dec 2025
- [`oisee/vibing-steampunk`](https://github.com/oisee/vibing-steampunk/blob/main/pkg/adt/client.go) (Go) — explicit comment "retrieves the contents of a package using the nodestructure API"
- [`mario-andreschak/mcp-abap-adt`](https://github.com/mario-andreschak/mcp-abap-adt/blob/main/src/handlers/handleGetPackage.ts) (127★)
- [`jfilak/sapcli`](https://github.com/jfilak/sapcli/blob/master/sap/adt/repository.py) (Python, mature CLI)

All five use the same URL, query params, and XML envelope.

## Option B — `repository/informationsystem/virtualfolders/contents`

Equally correct primitive, returns richer metadata (per-child object
counts and descriptions). Documented here as a follow-up if the safety
layer ever wants to surface diagnostics like "rule grants writes to 127
packages including ZX, ZY, …" without a second round-trip per child.

```http
POST /sap/bc/adt/repository/informationsystem/virtualfolders/contents
Content-Type: application/vnd.sap.adt.repository.virtualfolders.request.v1+xml
Accept:       application/vnd.sap.adt.repository.virtualfolders.result.v1+xml

<?xml version="1.0" encoding="UTF-8"?>
<vfs:virtualFoldersRequest xmlns:vfs="http://www.sap.com/adt/repository/virtualfolders">
  <vfs:preselection facet="package">
    <vfs:value><pkg></vfs:value>            <!-- WITHOUT `..` prefix → child packages -->
  </vfs:preselection>
  <vfs:facetorder>
    <vfs:facet>package</vfs:facet>
    <vfs:facet>group</vfs:facet>
    <vfs:facet>type</vfs:facet>
  </vfs:facetorder>
</vfs:virtualFoldersRequest>
```

The leading `..` prefix on `<vfs:value>` switches the response from
"child packages" to "directly assigned objects in this package," so the
absence of `..` is what selects sub-DEVCLASS rows. Response includes
`<count>` and `<description>` per folder.

Used by
[`Artisan-Edge/Catalyst-Relay`](https://github.com/Artisan-Edge/Catalyst-Relay/blob/main/src/core/adt/discovery/tree/childPackages.ts).
That repo's source comment captures the trade-off precisely:

> "Unlike `getSubpackages` (nodestructure), this returns packages WITH
> counts and descriptions."

For the safety gate's current needs (boolean "is X a descendant of root"),
Option A is sufficient and simpler. Adopting Option B would be a
one-file change at the `getSubpackages` boundary — the resolver, BFS,
cache, and call-site wiring all remain unchanged. The new parser would
walk `<vfs:folder facet="PACKAGE">` instead of
`<SEU_ADT_REPOSITORY_OBJ_NODE><OBJECT_TYPE>DEVC/K</OBJECT_TYPE>`.

## Decision

`nodestructure` is chosen because:

1. **Simpler envelope** — one POST with a well-known XML body; one
   filter (`OBJECT_TYPE === 'DEVC/K'` AND non-empty name) at parse time.
2. **De-facto standard** — five independent ABAP clients converge on
   it. Adopting the same primitive lowers maintenance friction and
   keeps response-shape evolution in sync with the broader ecosystem.
3. **No extra metadata to consume** — the safety gate only needs the
   set of descendant names. Counts and descriptions would be
   unused payload for this consumer.
4. **Returns the exact set required** — verified live against
   `TDEVC.PARENTCL` across four different parent packages and three
   depth profiles. No filtering of unrelated rows beyond the standard
   `DEVC/K` / non-empty-name guard.

If a future PR adds diagnostics surfacing (e.g. "this `ZFOO/**` rule
expands to 127 packages — show first 5: ZX, ZY, ZZ, ZW, ZV") and the
extra `<count>` / `<description>` metadata becomes valuable, switching
to Option B is a one-file change inside `getSubpackages` with no
ripple effects on the resolver, cache, or call sites.

## See also

- [`src/adt/client.ts`](../../src/adt/client.ts) `getSubpackages`
- [`src/adt/xml-parser.ts`](../../src/adt/xml-parser.ts) `parseSubpackageNodestructure`
- [`src/adt/package-hierarchy.ts`](../../src/adt/package-hierarchy.ts) — BFS, cache, fail-closed semantics
- [`tests/integration/adt.integration.test.ts`](../../tests/integration/adt.integration.test.ts) — "getSubpackages (repository/nodestructure)" suite, live coverage against SABP_UNIT / /AIF/MAIN / nonexistent
- [`tests/fixtures/xml/nodestructure-sabp_unit-devc.xml`](../../tests/fixtures/xml/nodestructure-sabp_unit-devc.xml) — captured-live SABP_UNIT response (5 children)
