# DRTY (CDS Type) — ADT wire contract

**Status:** live-verified, 2026-09-18
**System:** ABAP Cloud Developer Trial (`abap-cloud-developer-trial:2025`), SAP_BASIS **816** SP0001,
on-prem, client 001
**Conclusion:** `DRTY` is a plain "blue" server-driven object — a structural sibling of `DSFD`. It
needs **one registry entry** in `src/adt/server-driven.ts`, not a bespoke code path.

## Why it looked unsupported

Earlier attempts read DRTY through the **DDLS** endpoint (`/sap/bc/adt/ddic/ddl/sources/…`), which
404s: a CDS type is not a DDL source. The real collection is `/sap/bc/adt/ddic/drty/sources`, and it
is advertised in ADT discovery under the `Dictionary` workspace as:

```
<app:collection href="/sap/bc/adt/ddic/drty/sources">
  <atom:title>Type</atom:title>
  <app:accept>application/vnd.sap.adt.blues.v1+xml</app:accept>
  <app:accept>text/html</app:accept>
```

The title is the generic word `Type`, so searching titles alone for "DRTY"/"CDS type" misses it; the full href does contain `drty`. The sibling sub-resources (`$metadata`, `$navigation`,
`$codecompletion`, `$formatter`, `$elementinfo`, `$outlineconfiguration`, `$occurrencemarkers`,
`validation`) all say `for type DRTY` explicitly and confirm the collection identity.

## Verified operations

All calls below carry `sap-client=001`. Lock/modify/unlock requires
`X-sap-adt-sessiontype: stateful` — without it the PUT fails **423 `ExceptionResourceInvalidLockHandle`**
even though the LOCK itself returned 200 with a handle.

| Op | Request | Result |
|----|---------|--------|
| Read metadata | `GET /sap/bc/adt/ddic/drty/sources/{name}`<br>`Accept: application/vnd.sap.adt.blues.v1+xml` | 200 `<blue:blueSource>` |
| Read source | `GET …/{name}/source/main`<br>`Accept: text/plain` | 200 DDL text |
| Create | `POST /sap/bc/adt/ddic/drty/sources`<br>`Content-Type: application/vnd.sap.adt.blues.v1+xml` | **201**, object `version="inactive"`, empty source |
| Update source | lock → `PUT …/{name}/source/main?lockHandle=…`<br>`Content-Type: text/plain` → unlock | 200, echoes the stored source |
| Activate | `POST /sap/bc/adt/activation?method=activate&preauditRequested=true` (generic `adtcore:objectReferences`) | 200 `activationExecuted="true"`, metadata flips to `version="active"` |
| Delete | lock → `DELETE …/{name}?lockHandle=…` → unlock | 200; subsequent GET 404 |

### Create body (minimal, verified sufficient)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:type="DRTY/STY"
                 adtcore:name="ZARC1_DRTY_PROBE"
                 adtcore:description="…">
  <adtcore:packageRef adtcore:name="$TMP"/>
</blue:blueSource>
```

This is byte-for-byte the shape the existing SDO engine already builds for the blue family — no new
builder is required.

## Source media type

`sourceFormat: 'text'` is **not** a guess. Negative test: the same PUT under a valid lock with
`Content-Type: application/json` returns **415 `ExceptionUnsupportedMediaType`**. It also matches the
discovery `$formatter` sub-resource, which advertises `text/plain`.

## One subtype covers everything

`DRTY` spans scalar types *and* enumerated types, but SAP models both with the **single** subtype
`DRTY/STY` — so create needs no subtype routing (unlike TABL `/DT` vs `/DS`, #285). Sampled live:

| Object | `adtcore:type` | `abapLanguageVersion` | Shape |
|--------|----------------|----------------------|-------|
| `DEMO_SIMPLE_TYPE` | `DRTY/STY` | cloudDevelopment | over builtin (`abap.int4`) |
| `DEMO_SIMPLE_TYPE_DE` | `DRTY/STY` | cloudDevelopment | over a data element |
| `DEMO_SIMPLE_TYPE_INHERITANCE` | `DRTY/STY` | cloudDevelopment | over another CDS type |
| `DEMO_CDS_ENUM_WEEKDAY` | `DRTY/STY` | cloudDevelopment | `enum { … }`, int1 |
| `DEMO_CDS_ENUM_BOOLEAN` | `DRTY/STY` | cloudDevelopment | `enum { … }`, char(1) |
| `DD_DRTY_ST_ENUM_LENGTHS` | `DRTY/STY` | **standard** | `enum { … }`, numc(6) |

The created probe object came back `abapLanguageVersion="standard"` in `$TMP` on on-prem 816, so DRTY
is **not** restricted to ABAP Cloud — matching `DD_DRTY_ST_ENUM_LENGTHS`, a standard-language SAP
object.

## Source-language notes (relevant to lint / pre-write hints)

- `define type` and `DEFINE TYPE` are both accepted (`DEMO_BT_DATE` uses upper case).
- Annotations precede the definition: `@EndUserText.label` / `.heading` / `.quickInfo`.
- Enum members use `NAME = initial;` for the initial value and quoted or unquoted literals
  thereafter, each optionally annotated with its own `@EndUserText.label`.
- The body is a single statement terminated by `;` — ARC-1 does not integrate DRTY linting, so SAP activation remains the syntax authority
  (same posture as the other DDL-text SDO types). abaplint recognizes the DRTY object class;
  that alone does not establish parser/semantic coverage.

## Test corpus on the trial

384 `DRTY` rows in TADIR. Useful read fixtures live in `SABAP_DEMOS_ABAP_CDS_CLOUD` (`DEMO_*`),
`SD_CDS_TYPES` (`DD_DRTY_ST_ENUM_*`), and `SABAP_DEMOS_ABAP_LANGU_CLOUD`.

## Follow-up boundaries

1. Explicit active/inactive selection now checks the returned metadata version; omitted/auto
   preserves the developer view. See [the version contract](../plans/completed/2026-09-25-server-driven-versions.md) (#840).
2. `$elementinfo` / `$navigation` and `SAPContext` dependency walking remain outside this PR.
3. Generic `SAPDiagnose`/`SAPTransport` routing is resolved by #849. ARCH-02 now tracks
   server-driven `object_state` version verification; incomplete ATC remains incomplete.

## End-to-end matrix through ARC-1 (2026-09-18, SAP_BASIS 816)

Run through `bin/arc1-cli.js` — the same code path as the MCP server — after the registry entry
landed. Every case below was executed against the live trial; nothing is inferred.

### Reads

| Case | Result |
|------|--------|
| Scalar over builtin, over data element, over another CDS type; enums int1 / char / numc | metadata + DDL source, `type: DRTY/STY`, annotations preserved verbatim |
| Standard-language SAP object (`DD_DRTY_ST_ENUM_LENGTHS`) | `abapLanguageVersion: standard` — DRTY is not Cloud-only |
| Lower-case name, lower-case type (`drty`) | normalised, same result |
| Non-existent object | clean 404 with a `SAPSearch` hint |
| `type=DRTY/STY` (the form `SAPSearch` returns) | validation error listing accepted types — pre-existing gap shared by every SDO type, out of scope |
| `SAPSearch` | `objectType: DRTY/STY` + collection URI |
| `SAPRead type=DEVC SD_CDS_TYPES` | 8 `DRTY/STY` entries listed |
| Hyperfocused mode (`SAP action=read`) | works |
| `SAPRead type=VERSIONS objectType=DRTY` | clean "Unsupported object type DRTY for revisions" — no revision URL builder, expected |
| `SAPContext action=usages` | resolves `DRTY/STY` via search, 6 usages |
| `SAPNavigate action=references type=DRTY` | 6 references after the shared routing fix in [#809](https://github.com/arc-mcp/arc-1/pull/809) |

### Writes

| Case | Result |
|------|--------|
| create with inline source (3 `@EndUserText` annotations) → activate → read | active, annotations intact |
| create without source → read → update (enum) → read → activate → read | `inactive`/empty → `inactive`/new source → `active` |
| transportable package (`ZMCP_TESTING`) with `transport=` | created, **E071 row recorded**; update and delete propagate the lock's `corrNr` |
| transportable package without `transport=` | SAP 400 `Parameter corrNr could not be found` + ARC-1 hint to supply `transport` |
| structure package (`ZLOCAL`) | SAP 409 `Structure packages cannot contain development objects`, clean |
| two types, child inherits from base, **batch** `SAPActivate objects=[…]` | both active in one call |
| persistent SQLite cache: read → update → read | fresh source (SDO path bypasses the source cache) |
| `SAP_CHECK_BEFORE_WRITE=true` + `SAP_LINT_BEFORE_WRITE=true` | update unaffected (SDO path skips ABAP pre-write steps) |
| CRLF source | stored and returned byte-identical |

### Safety and negatives

| Case | Result |
|------|--------|
| `SAP_ALLOW_WRITES=false` | `CreateServerDrivenObject` blocked by safety |
| `SAP_ALLOWED_PACKAGES=$TMP`, create in `ZLOCAL` | blocked before any SAP call |
| `SAP_ALLOWED_PACKAGES=$TMP`, update/delete of a SAP object | blocked against the **real** package (`SABAP_DEMOS_ABAP_CDS_CLOUD`), fail-closed |
| `SAP_DENY_ACTIONS=SAPWrite.create` | denied by policy |
| duplicate create | SAP 400 `does already exist`, clean |
| update / delete / activate of a non-existent object | clean 404 |
| invalid DDL (`abap.notatype`), unknown data element | stored (SAP does not validate on PUT), activation fails with line-anchored SAP diagnostics, object stays `inactive` |
| `batch_create` with DRTY | preflight refusal: "create it with a single SAPWrite call" |
| name with hyphen / 31 characters | SAP 422 / 404 with the exact rule, clean |
| JSON string as source | stored verbatim as text (no client-side JSON parse for text types), activation fails |
| **delete a type that another type inherits from** | **false success — see "Findings"** |

### Findings

**Deleting a CDS type that another object still references leaves an orphan, and ARC-1
reports success.** Sequence on 816: `ZARC1_DRTY_BASE` active, `ZARC1_DRTY_CHILD : zarc1_drty_base`
active. `SAPWrite delete BASE` → SAP answers **200** → ARC-1 prints `Deleted DRTY ZARC1_DRTY_BASE`.
Afterwards: TADIR row gone, metadata GET still **200** with `version="active"` and **no
`packageRef`**, where-used still lists CHILD, CHILD still active. From then on the object cannot be
removed through ADT at all: DELETE → 409 `CTS_WBO_API018 "Object R3TR DRTY … cannot be created
without a package"` (CTS cannot record a deletion for an object with no directory entry), and
create → 400 `does already exist`. Deleting CHILD afterwards does not unblock it. `SAPSearch` no
longer finds it (TADIR-based); `SAPRead` still does.

Recovery, verified: restore the directory entry with function module `TR_TADIR_INTERFACE` in SE37
(`WI_TADIR_PGMID=R3TR`, `WI_TADIR_OBJECT=DRTY`, `WI_TADIR_OBJ_NAME`, `WI_TADIR_DEVCLASS=$TMP`,
`WI_TADIR_AUTHOR`, `WI_TADIR_SRCSYSTEM`, `WI_TADIR_MASTERLANG=E`) and **clear `WI_TEST_MODUS`** — its
signature says `DEFAULT 'X'`, so a run with the default validates and writes nothing. Once the row is
back the metadata carries `packageRef` again and a normal `SAPWrite delete` succeeds (read → 404).
Neither SE03 nor `RS_TADIR_INTERFACE` (absent on 816; `TR_TADIR_INTERFACE` in `SAPLSTRD` is the one
that exists) worked on this trial.

This is SAP-side behaviour — a type without dependents deletes cleanly and reads 404 afterwards, as
the same matrix shows — but ARC-1's SDO delete does no readback, so the partial deletion surfaces as
a plain success. The existing `resourceExistenceAfterDelete` follow-up probe in
`src/handlers/write/update-delete.ts` only runs when DELETE *fails* with 404. The shared deletion
path needs investigation; this DRTY observation does not establish the same backend defect on
other types or releases. Compare SAP's dependency checks with a post-delete readback that reports
a surviving object or an unconfirmed outcome. Tracked in [#839](https://github.com/arc-mcp/arc-1/issues/839).

## Cross-release verification — 2026-09-23

| Target | DRTY discovery/read | Dispatcher lifecycle | Cleanup |
|---|---|---|---|
| SAP_BASIS 758 SP02 | Present; `DEMO_CDS_ENUM_WEEKDAY` is DRTY/STY in SABAPDEMOS | scalar create/activate; replace with enum draft; read draft while explicit raw `version=active` still returns scalar; activate enum; invalid DDL saves but activation refuses; repair own draft | DELETE then metadata 404 |
| SAP_BASIS 816 SP01 | Present; same enum in SABAP_DEMOS_ABAP_LANGU_CLOUD | same complete sequence | DELETE then metadata 404 |
| SAP_BASIS 750 SP02 | Collection absent; existing discovery gate returns unavailable | no mutation attempted | none created |

On both 758 and 816, separate negative probes confirmed the write-disabled ceiling and real-package
refusals for update, delete and activation despite a forged package argument. A JSON source PUT
under a valid stateful lock returned 415; source was unchanged. Both additional fixtures were
deleted and confirmed absent. The focused read integration test executed on 758/816; 750 skipped
through the capability gate, which is absence evidence rather than positive read coverage.

The contributor's dependent-delete orphan finding was not independently repeated; the probes used
types without consumers. BTP runtime was not tested.

### Cross-checks against primary sources

- [SAP CDS feature table](https://help.sap.com/docs/ABAP_Cloud/abap-cloud-docs_abap-keyword-documentation_abap-for-cloud-development/abencds_language_elements.html)
  lists both `DEFINE TYPE` and `DEFINE TYPE ... ENUM` on on-premise 7.58. Runtime discovery remains
  the gate; this is not a reason to add a release-number conditional.
- [SAP’s DRTY file format](https://github.com/SAP/abap-file-formats/tree/main/file-formats/drty)
  has separate `.drty.json` metadata and `.drty.acds` source. An AFF file format does not mean the
  ADT `/source/main` accepts JSON.
- [abapGit’s DRTY implementation](https://github.com/abapGit/abapGit/blob/main/src/objects/aff/zcl_abapgit_object_drty.clas.abap)
  reuses its common AFF object machinery and adds the `.acds` source extension; this supports a
  small registry entry here rather than a new DRTY client module.
- [abaplint’s DRTY object](https://github.com/abaplint/abaplint/blob/main/packages/core/src/objects/cds_type.ts)
  supplies type/name metadata. ARC-1’s pre-write lint does not currently handle this object.

### Deletion follow-up — 2026-09-25

The dependent-type orphan was independently reproduced on 816 and recovered using an owned,
fixed-name repair helper. SAP's deletion precheck returned `isDeletable=false` before the raw DELETE
that caused the orphan. The shared path now consults that advertised check under the lock and
verifies metadata absence afterward; it reports surviving and unconfirmed outcomes separately.
See the [deletion investigation](../plans/completed/2026-09-25-server-driven-deletion.md). No automatic directory
repair is part of ARC-1.
