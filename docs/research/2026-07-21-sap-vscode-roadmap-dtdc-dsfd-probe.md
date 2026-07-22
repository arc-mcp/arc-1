# SAP ADT-for-VS-Code roadmap → ARC-1 gap probe (DTDC, DSFD, ATC, activation log)

> Live-probed 2026-07-21 against **a4h 2023 (SAP_BASIS 758)** and **a4h-2025 (816)**.
> Trigger: SAP's ADT-for-VS-Code 1.2/1.3 roadmap (Q4/2026–Q1/2027) — which of its object types
> ARC-1 already covers, and what the genuinely missing ones cost.

## TL;DR

1. **DSFD (CDS Scalar Function Definition) is an exact server-driven-object (SDO) match** — same
   `blue:blueSource` metadata root and `blues.v1+xml` content type as the already-shipped DTSC.
   Available on **758 AND 816** (DTSC is 816-only). Create verified live → `201`.
2. **DTDC (Dynamic Cache) is NOT a drop-in** — it uses a type-specific content type
   (`application/vnd.sap.adt.ddic.dtdc.v1+xml`) and a `<dtdc:dtdcSource>` root, so it fails the
   generic engine's `.includes('blues')` gate and its `parseBlueSource`/create-body assumptions.
   Also available on both 758 and 816.
3. **BUG — SDO source write is broken for DDL-text types.** `SDO_SOURCE_CONTENT_TYPE` was hardcoded
   to `application/json`; a live `PUT …/source/main` with that
   content type returns **`415 Unsupported Media Type`**. DTSC and DSFD sources are plain DDL text,
   not AFF JSON. **DTSC source update is broken in shipped code** — confirmed below, and fixed in the same PR as this dossier.

## What SAP is shipping vs. what ARC-1 has

Of the 17 roadmap capabilities checked, 5 are already shipped in ARC-1 (DTSC, DTEL write, DEVC,
transport release, API state) — several **ahead of SAP's own dates** (API state is their Q1/2027;
ARC-1 shipped it 2026-06-25). The remainder are catalogued below with live evidence.

## Endpoint probe results

Bare `GET` on the collection: `400` = exists/needs a name, `404` = absent.

| Endpoint | 758 | 816 | Meaning |
|---|---|---|---|
| `ddic/dtsc/sources` | 404 | 400 | Static Cache — **816 only** (matches the existing gate) |
| `ddic/dtdc/sources` | **400** | **400** | Dynamic Cache — **both releases** |
| `ddic/dsfd/sources` | **400** | **400** | Scalar Function Definition — **both releases** |
| `atc/variants` | **200** | **200** | ATC check-variant listing — returns data on both |
| `atc/checkcategories` | 400 | 400 | Exists, unconsumed |
| `activation/runs` | 405 | 405 | **POST-only action endpoint — not a GET-able activation log** |
| `ddic/db/indexes` | 406 | 406 | Exists — the `406` was my wrong `Accept`; discovery advertises **blues v1** (see §Three-system scan) |
| `ddic/extensionindexes` | 406 | 406 | Same — advertises **blues v1** |

`…/$schema` returned `406` for all three DDIC types (including the known-good DTSC), so the
AFF JSON-Schema endpoint is not at `<collection>/$schema` for these — it is at the bare type root
for types whose collection href has no `/sources` suffix (e.g. `ddic/desd/$schema`, per the
2026-06-05 dossier). Not decision-relevant.

## Contract details (from live discovery + real object reads)

### DSFD — drop-in SDO type

```
href:  /sap/bc/adt/ddic/dsfd/sources          title: Scalar Function Definition
accept: application/vnd.sap.adt.blues.v1+xml           ← identical to DTSC
template: …/{object_name}{?corrNr,lockHandle,version,accessMode,_action}
template: …/{object_name}/source/main{?corrNr,lockHandle,version}
```

Real instances exist on both systems (SAP-delivered): `CALENDAR_OPERATION`, `CALENDAR_SHIFT`,
`COLUMN_TOTAL` (758); `/IWBEP/CONCAT_TECH_32_VERS` etc. (816).

- Metadata `GET` → `200`, root `<blue:blueSource>` — **exact SDO contract**.
- Source `GET` → `200`, body is **plain DDL text**: `define scalar function calendar_operation with parameters …`
- Create `POST` with `adtcore:type="DSFD/SCF"` + minimal `<blue:blueSource>` + `packageRef $TMP` → **`201`** (verified).

→ One `SDO_REGISTRY` row (`href`, label, `createType: 'DSFD/SCF'`, `BLUES_V1`) exposes read +
create + delete. Read/write tool-registry rows derive automatically from `SDO_TYPES`. The existing
discovery gate handles the 758-vs-816 difference with no release logic (same mechanism that already
lets EVTB work on 758).

### DTDC — needs generalization, not a registry row

```
href:  /sap/bc/adt/ddic/dtdc/sources          title: Dynamic Cache
accept: application/vnd.sap.adt.ddic.dtdc.v1+xml       ← type-specific, NOT blues
template: …/{object_name}{?corrNr,lockHandle,version,accessMode,_action}
template: …/{object_name}/source/main{?corrNr,lockHandle,version}
```

Instances: `DEMO_DDIC_DYNAMIC_CACHE`, `SDDIC_TEST_DTDC_SIMPLE01` (both systems).
Metadata root is `<dtdc:dtdcSource>`, source is DDL text
(`define dynamic cache DEMO_DDIC_DYNAMIC_CACHE on demo_ddic_types { … } where int1 = 4 segregated …`).

Three places assume "blues" and would need loosening:
- `supportsServerDrivenObject()` gates on `.includes('blues')` (`server-driven.ts`, the discovery gate)
- `parseBlueSource()` expects the `blue:` root
- `buildBlueSourceXml()` emits a literal `<blue:blueSource>` element

DTDC also has extra surface worth noting: `ddic/dtdc/createstatements/{name}` (the "Show SQL"
equivalent, sibling of the `cds_sql` feature ARC-1 already has) and `ddic/dtdc/parser/info`.

## BUG — `SDO_SOURCE_CONTENT_TYPE` is wrong for DDL-text types

The pre-fix code asserted:

```ts
/** AFF source is JSON for every server-driven type (read GET + write PUT). */
const SDO_SOURCE_CONTENT_TYPE = 'application/json';
```

That premise is false. Live on 816, against a freshly created DSFD in `$TMP`:

```
PUT …/ddic/dsfd/sources/zarc1_probe_sf/source/main   Content-Type: application/json
  -> 415 Unsupported Media Type
```

The read path is unaffected — it sends `Accept: 'application/json, */*'`,
whose `*/*` fallback lets DDL text through. Only the **write** path is affected.

Why this survived: the 2026-06-05 SDO-write verification (roadmap completed-table entry) states
*"all 6 types create, DESD full create→source→activate→read→delete round-trip"* — i.e. only
**DESD**'s source write was exercised, and DESD genuinely is AFF JSON. The DDL-text types (DTSC,
and now DSFD) were create-verified but never source-write-verified. Unit tests are mock-based and
assert whatever the code sends, so they cannot catch a content-type the real server rejects.

**Fix as shipped:** a required per-registry-entry `sourceFormat: 'json' | 'text'` that drives BOTH
the PUT content type AND the client-side `JSON.parse` gate in `handleServerDrivenObjectWrite` —
the second place the same false premise was encoded, which rejected DDL text before any HTTP call.
`text/plain` is what ARC-1's proven generic source-update path already uses for every text source.

**Verified (2026-07-21, after the first pass).** A per-type `$TMP` create → lock → PUT → delete
probe on 816 pins the flavor for every registered type. `415` = content type rejected, `200` = accepted:

| Type | `application/json` | `text/plain` | Flavor |
|---|---|---|---|
| DESD | **200** | 415 | JSON |
| CSNM | **200** | 415 | JSON |
| EVTB | **200** | 415 | JSON |
| EVTO | **200** | 415 | JSON |
| COTA | **200** | 415 | JSON |
| DTSC | 415 | **200** | **text** |
| DSFD | 415 | **200** | **text** |

Every probe object was created and deleted cleanly (`delete=200`, `verify=404`). This is the exact
split now encoded as `sourceFormat` in `SDO_REGISTRY`, and it confirms DTSC source writes were
impossible before the fix.

**End-to-end verified through the built CLI** (i.e. through ARC-1's own code path, not raw curl):

| System | DSFD create→update→read→delete | DTSC create→update→delete | DESD (JSON regression) |
|---|---|---|---|
| 816 (a4h-2025) | ✅ all OK | ✅ all OK — **the previously-415 write** | ✅ unregressed |
| 758 (a4h 2023) | ✅ all OK | n/a — 404, type not on 758 | n/a — 404 |

Note: on 758 the unavailable types return a raw ADT `404` rather than the clean "requires 8.16+"
gate message, because `supportsServerDrivenObject` returns `undefined` (not `false`) when discovery
has not been primed — pre-existing behavior, unchanged by this work.

## Probe hygiene note

The `$TMP` probe object `ZARC1_PROBE_SF` (DSFD, a4h-2025) was created to test the PUT contract. The
`415` aborted the script before its unlock, leaving a stale ADT session lock
(`EU510 User MARIAN is currently editing ZARC1_PROBE_SF`) that blocked deletion for ~3 minutes.
**Cleaned up** once the session lock expired (`DELETE 200`, verify `GET 404`) — nothing left behind.

Lesson for any future live write probe: acquire the lock inside a stateful session
(`x-sap-adt-sessiontype: stateful` + `Accept: …dataname=com.sap.adt.lock.result`) and unlock in a
`finally`, exactly as `withStatefulSession` does — a bare-curl probe that bails on a non-2xx strands
the enqueue lock.

## Three-system scan + SAP/abap-file-formats cross-reference

> Added 2026-07-21 (second pass), after the fix. Question asked: does this work on **all** systems,
> or is it simply missing on 7.50? Answer: **missing, not broken.**

[SAP/abap-file-formats](https://github.com/SAP/abap-file-formats) catalogues **100** object types
(`dsfd`, `dtsc`, `dtdc`, `dtix`, `dsfi`, `dras`, `drty`, `chkc/chko/chkv`, `enhs`, … ). That repo is
the *file-format* spec, not an ADT-endpoint list — a type having an AFF schema does not mean this
system exposes it. The authoritative test is one discovery fetch per system, filtering for
collections that advertise a `blues` accept type (exactly what the engine's `.includes('blues')`
gate matches).

| System | total collections | advertising `blues` |
|---|---|---|
| npl **7.50** | 214 | **8** |
| a4h **758** | — | **43** |
| a4h-2025 **816** | — | **68** |

**7.50 verdict — absent, not broken.** The `blues` mechanism itself exists on 7.50 (8 collections,
incl. `ddic/structures` and the Code Composer types), but **none of the seven registered SDO types
appear at all** — DESD, DTSC, CSNM, EVTB, EVTO, COTA and DSFD are all missing from the 7.50
discovery document. So DSFD is not a regression on 7.50; it is simply one more type that release
does not ship. Verified through the built CLI against npl: every SDO read/create fails cleanly with
a server `404` + hint and **no crash**, DSFD behaving identically to the pre-existing types.

> Caveat on the gate message: in a single CLI call, discovery is not primed, so
> `supportsServerDrivenObject` returns `undefined` (not `false`) and the request proceeds to a raw
> ADT `404` instead of the friendlier "requires 8.16+" text. A long-running MCP server primes
> discovery and gets the nicer message. Pre-existing behavior, unchanged by this work.
>
> Also note `npl` must be reached over **HTTPS** (`https://npl.marianzeis.de`, self-signed →
> `SAP_INSECURE=true`); the HTTP URL 301-redirects and curl drops credentials across the redirect,
> which silently yields an empty discovery document and a false "0 collections" reading.

### Further drop-in SDO candidates found by the same scan

Verified by reading a real instance under the advertised blues Accept:

| Type | Collection | blues | Source flavor | 758 | 816 |
|---|---|---|---|---|---|
| **DRTY** (Type) | `ddic/drty/sources` | v1 | **DDL text** (`define type …`) | ✅ `blue:blueSource` | ✅ |
| **DRAS** (Aspect) | `ddic/dras/sources` | v1 | **DDL text** (`@EndUserText.label: … define …`) | advertised, no instance | ✅ `blue:blueSource` |
| **DSFI** (Scalar Function Impl. Ref.) | `ddic/dsfi` | v2 | AFF JSON | ⚠ metadata GET returned `exc:exception` — needs a per-release check | ✅ `blue:blueSource` |
| **DTIX** (Table/Entity Index) | `ddic/db/indexes` | v1 | unknown | **no instance on either system** | **no instance** |

DRTY and DRAS are the same DDL-text flavor this PR just made expressible — good evidence the
`sourceFormat` split generalizes rather than being a two-type special case.

**Deliberately NOT added to this PR.** Two reasons, one hard:

1. **The LLM tool surface is at its ceiling.** `check:sizes` reports `standard-full-git` at
   **67 986 / 68 000 bytes** — **14 bytes** of headroom against a wall documented as *"Ceilings, not
   ratchets — trim the surface, don't raise."* Three more type codes across three enums plus
   description prose breaches it immediately. Adding types now requires trimming the surface first;
   that is its own change, not a rider on a bug fix.
2. `createType` is **not** derivable — it is `EVTB/EVB`, `DSFD/SCF`, `DESD/TYP`. Each new type needs
   its own live `$TMP` create probe, i.e. real verification work, not a guessed registry row.

## Revised recommendations

| Item | Verdict | Effort |
|---|---|---|
| **Fix SDO source content type** | Real defect in shipped code (DTSC write) | XS |
| **DSFD** | Registry row, both releases; blocked behind the CT fix for source writes | XS |
| **ATC check-variant listing** | `atc/variants` returns 200 on both releases; today an LLM must guess the `variant` string it passes to `SAPDiagnose action=atc` | XS |
| **Mass syntax check** | `syntaxCheck()` already builds a list-shaped `chkrun:checkObjectList` with exactly one entry (`devtools.ts:39`) | XS |
| **DTDC** | Worth doing, but needs the blues-assumption generalization above | S |
| **Table technical settings** | Completeness gap — TABL create ships with no delivery class / data class / size category / buffering | M |
| **Dictionary activation log** | **Downgraded** — `activation/runs` is `405` POST-only, so there is no simple GET log reader; needs its own research | M |
| CDS entity indexes | Both advertise **blues v1** on 758 + 816 — likely drop-in, but **neither system holds a single instance**, so unverifiable here | S |
| XSLT, CHKO/CHKC authoring | Skip — niche / Basis-governance work, not LLM-driven | — |
