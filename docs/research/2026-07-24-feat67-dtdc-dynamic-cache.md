# FEAT-67 — DTDC (Dynamic Cache) read/write dossier

> Live-verified 2026-07-24 on **a4h-2025 (816)** and **a4h 2023 (758)** — full create→update→activate→
> read→delete round-trip through the built CLI on BOTH releases (implementation phase).
> Independent repo corroboration from `~/DEV/mcp-abap-adt-fr0ster` discovery capture.
> Builds directly on the server-driven-object (SDO) engine shipped in PR #604.

## Goal

Expose `SAPRead type=DTDC` and `SAPWrite create/update/delete type=DTDC` for Dynamic Cache objects,
by generalizing the existing SDO engine so it is no longer hardcoded to the `<blue:blueSource>`
metadata format.

## Verified ADT contract (live, content-checked — not assumed)

| Aspect | Value | Evidence |
|---|---|---|
| Collection | `POST /sap/bc/adt/ddic/dtdc/sources` | discovery both releases; fr0ster `adt-discovery.xml:2728` |
| Metadata content type | `application/vnd.sap.adt.ddic.dtdc.v1+xml` (**not** `blues`) | live GET + discovery `app:accept` |
| Metadata root element | `<dtdc:dtdcSource>` ns `http://www.sap.com/adt/ddic/dtdcsources` | live GET body |
| `adtcore:type` (create subtype) | **`DTDC/DF`** | live read of `DEMO_DDIC_DYNAMIC_CACHE` (`adtcore:type="DTDC/DF"`); fr0ster term `dtdcdf` corroborates |
| Source URL | `…/sources/{name}/source/main` | discovery templateLink |
| Source flavor | **DDL text** (`define dynamic cache …`); PUT `text/plain` | read `atom:link rel=source type="text/plain"`; live PUT 200 + activation OK |
| Availability | **758 AND 816** (like DSFD; unlike DTSC which is 816-only) | discovery both; instances `DEMO_DDIC_DYNAMIC_CACHE`, `SDDIC_TEST_DTDC_SIMPLE01` |
| Bonus (deferred) | `…/dtdc/createstatements/{name}` "Show SQL", `…/dtdc/parser/info` | createstatements is **POST-only** (GET→405 live); parser/info 406. Not in scope. |

### Live round-trip proof (816, in `$TMP`, cleaned up)

```
CREATE  POST /ddic/dtdc/sources  <dtdc:dtdcSource adtcore:type="DTDC/DF" …>  → 201
PUT     …/source/main  Content-Type: text/plain  (define dynamic cache ZARC1_DYN_CACHE on demo_ddic_types {…})  → 200
ACTIVATE POST /activation?method=activate  → 200  <chkl:properties checkExecuted="true" activationExecuted="true"/>   ← mandatory success
DELETE  lock → DELETE  → 200 ;  verify GET → 404
```

The created shell reads back with `adtcore:type="DTDC/DF"`, `abapLanguageVersion="standard"` (SAP
defaulted it — the create body omits it, exactly like the other SDO types).

> Note on the source content type: a clean json-vs-text A/B was muddied by a stale-lock artifact in
> the probe loop (json PUT returned 423 "not locked", not a clean 415). `text/plain` is nonetheless
> settled: the read `atom:link rel=source` declares `type="text/plain"`, the `text/plain` PUT
> returned 200, activation succeeded, and the sibling DDL-text SDO types (DTSC, DSFD) both 415 on
> json (PR #604 evidence). `sourceFormat: 'text'`.

## Why the current SDO engine can't do DTDC yet

The engine (`src/adt/server-driven.ts`) is hardcoded to the `<blue:blueSource>` format in **three**
places. DTDC's metadata body is **structurally identical** (same `adtcore:*` attributes + same
`<adtcore:packageRef>`) — only the root element name/namespace and the discovery marker differ. So
the generalization is narrow:

| Site | Current (blue-only) | Needs |
|---|---|---|
| `parseBlueSource` (`xml-parser.ts:1263`) | `parseXml(xml).blueSource` — keys off the local name `blueSource` (`removeNSPrefix:true`) | parse the per-type root local name (`dtdcSource`) |
| `buildBlueSourceXml` (`server-driven.ts:227`) | emits literal `<blue:blueSource xmlns:blue="…/wbobj/blue">` | emit the per-type root qname + namespace |
| `supportsServerDrivenObject` gate (`server-driven.ts:181`) | `(discoveryAcceptFor(href) ?? '').includes('blues')` | match the per-type marker (`dtdc` etc.) |

`blueContentType` is already per-entry, so the metadata Accept/Content-Type needs no new plumbing —
just the DTDC value. Everything downstream (read/create/update/delete flow, tool-registry rows,
schemas, policy) already derives from `SDO_TYPES`/`SDO_REGISTRY` (proven in #604).

### Proposed registry shape (add 3 fields, generalize the "blue" naming)

```ts
interface SdoRegistryEntry {
  href; label; createType; sourceFormat;              // existing
  metadataContentType: string;                          // rename of blueContentType (Accept + create CT)
  metadataRootLocalName: string;                         // 'blueSource' | 'dtdcSource'  (parse)
  metadataRootQName: string; metadataNamespace: string; // '<blue:blueSource>' tag + xmlns  (build)
  discoveryMarker: string;                               // 'blues' | 'dtdc'  (gate substring)
}
DTDC: { href:'/sap/bc/adt/ddic/dtdc/sources', createType:'DTDC/DF', sourceFormat:'text',
        metadataContentType:'application/vnd.sap.adt.ddic.dtdc.v1+xml',
        metadataRootLocalName:'dtdcSource',
        metadataRootQName:'dtdc:dtdcSource', metadataNamespace:'http://www.sap.com/adt/ddic/dtdcsources',
        discoveryMarker:'dtdc' }
```
Whether to rename `blueContentType`→`metadataContentType`/`buildBlueSourceXml`→`buildServerDrivenMetadataXml`
etc. (honest but wider diff) vs. keep the `blue*` names (smaller diff, misleading) is a plan decision.

## HARD BLOCKER — tool-schema budget

`check:sizes` `standard-full-git` is at **67,986 / 68,000 bytes** on the #604 branch (14 bytes free);
the wall is documented "Ceilings, not ratchets — trim the surface, don't raise." DTDC adds a type
code to **3 enums** (SAPRead type, SAPWrite type, batch_create item) + description prose — well over
14 bytes. **The PR MUST include a surface trim** (tighten the SDO description sentence / compact the
type list) to pay for DTDC. This is a required task, not optional.

## Affected ARC-1 files

| File | Change |
|---|---|
| `src/adt/server-driven.ts` | registry fields + DTDC entry; generalize `buildBlueSourceXml` + gate; `SDO_TYPES` += DTDC |
| `src/adt/xml-parser.ts` | `parseBlueSource` takes the root local name (or new generic parser) |
| `src/handlers/tools.ts`, `tool-descriptions.ts` | DTDC in the 4 SDO description sentences (+ **trim** to fit budget) |
| `src/handlers/write.ts`, `write/create.ts`, `probe/catalog.ts` | SDO-list comments (DTDC), batch_create SDO guard already covers it |
| `tests/unit/adt/server-driven.test.ts`, `tests/unit/handlers/{schemas,tools}.test.ts` | DTDC in the per-type loops + a parse/build test for the dtdc root |
| `tests/fixtures/tool-definitions/*.json` | regenerate (DSFD+DTDC in enums) |
| `docs_page/tools.md`, `docs/dev-guide.md`, `docs_page/btp-abap-environment.md`, `AGENTS.md`, `docs_page/roadmap.md` | DTDC rows; mark FEAT-67 done |

Confirmed auto-derived (no change): `tool-registry.ts`, `schemas.ts`, `authz/policy.ts` (falls back to
tool-level rows), `SAPActivateSchema` (free-form). Same as #604.

## Dependency + branching

DTDC is DDL-text source → depends on #604's `sourceFormat`. **#604 merged to main 2026-07-23**, so
FEAT-67 branches cleanly from `origin/main` (which now has `sourceFormat` + DSFD). No stacking.

## Phase-1 exit gate — all YES
- [x] Exact endpoint + verified response **content** live (metadata body, source, create 201, activate 200)
- [x] Checked adt-ls + fr0ster + eclipse-adt (fr0ster discovery corroborates type/URLs; none implement it)
- [x] Per-release: 758 + 816 both advertise + read; **create→activate→delete proven on BOTH** (built CLI, implementation phase)
- [x] Every affected ARC-1 file listed
- [x] Written here with cited evidence

## Open questions for the plan
- Rename `blue*`→`metadata*` (honest) or keep names (small diff)? → recommend rename; it's bounded.
- ~~Confirm DTDC create on 758~~ — **done**: create→update→activate→read→delete round-tripped live on 758 (and 816) through the built CLI during implementation; DESD regression-checked.
- `createstatements` (Show SQL) — explicitly OUT of scope for this PR (POST-only, separate feature).
