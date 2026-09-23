# Plan — FEAT-67: DTDC (Dynamic Cache) read/write

> Evidence: [docs/research/2026-07-24-feat67-dtdc-dynamic-cache.md](../research/2026-07-24-feat67-dtdc-dynamic-cache.md)
> (live create→source→**activate**→delete round-trip proven on 816). Branch: `feat/dtdc-dynamic-cache` from `origin/main`.

## What ships

`SAPRead type=DTDC` and `SAPWrite create/update/delete type=DTDC` (+ `SAPActivate`) for Dynamic Cache
objects, by generalizing the server-driven-object (SDO) engine so it is no longer hardcoded to the
`<blue:blueSource>` metadata format. DTDC uses `<dtdc:dtdcSource>` + `application/vnd.sap.adt.ddic.dtdc.v1+xml`.

## Verified contract (from dossier — live 816)

- Collection `POST /sap/bc/adt/ddic/dtdc/sources`; metadata CT `application/vnd.sap.adt.ddic.dtdc.v1+xml`; root `<dtdc:dtdcSource>` (ns `http://www.sap.com/adt/ddic/dtdcsources`).
- `adtcore:type="DTDC/DF"`; source is **DDL text** → PUT `text/plain` (`sourceFormat: 'text'`).
- Available on **758 and 816**; discovery-gated (same mechanism as EVTB/DSFD on 758).
- Round-trip proven: create 201 → source 200 → **activate 200 `activationExecuted="true"`** → delete 200 → GET 404.

## The generalization (narrow — 3 sites)

DTDC's metadata body is structurally identical to `<blue:blueSource>` (same `adtcore:*` attrs + `<adtcore:packageRef>`); only the root tag/namespace + discovery marker differ. Add per-entry fields and thread them through:

| Site | Now (blue-only) | Change |
|---|---|---|
| `SdoRegistryEntry` | `blueContentType` | rename → `metadataContentType`; add `metadataRootLocalName`, `metadataRootQName`, `metadataNamespace`, `discoveryMarker` |
| `parseBlueSource(xml)` (`xml-parser.ts:1263`) | `parseXml(xml).blueSource` | `parseServerDrivenMetadata(xml, rootLocalName)` — key off the per-type local name (`removeNSPrefix` strips the prefix, so `dtdcSource`) |
| `buildBlueSourceXml` (`server-driven.ts:227`) | literal `<blue:blueSource xmlns:blue=…>` | `buildServerDrivenMetadataXml` — emit per-entry qname + xmlns |
| `supportsServerDrivenObject` (`server-driven.ts:181`) | `.includes('blues')` | `.includes(entry.discoveryMarker)` |

Rename `blue*`→`metadata*`/`serverDriven*` (honest — a `parseBlueSource` that parses `<dtdc:dtdcSource>` lies). **Rename blast radius (corrected after plan review — mechanical, typecheck-guarded):**
- `parseBlueSource`→`parseServerDrivenMetadata` (2-arg): caller `server-driven.ts` (`createServerDrivenObject`… actually the READ path `getServerDrivenObject`) + `server-driven.test.ts` (3 call sites).
- `buildBlueSourceXml`→`buildServerDrivenMetadataXml`: callers `server-driven.ts` (`createServerDrivenObject`), `server-driven.test.ts`, **`tests/integration/btp-abap.integration.test.ts`**.
- `serverDrivenBlueContentType`→`serverDrivenMetadataContentType`: callers `server-driven.ts` + **`src/handlers/activate.ts`** + **`src/handlers/write-helpers.ts`**.
- field `blueContentType`→`metadataContentType`: `server-driven.ts` + `server-driven.test.ts` only.

Keep `SDO_TYPES`/`SDO_REGISTRY` names.

### DTDC registry entry
```ts
DTDC: {
  href: '/sap/bc/adt/ddic/dtdc/sources', label: 'CDS Dynamic Cache', createType: 'DTDC/DF',
  sourceFormat: 'text',
  metadataContentType: 'application/vnd.sap.adt.ddic.dtdc.v1+xml',
  metadataRootLocalName: 'dtdcSource',
  metadataRootQName: 'dtdc:dtdcSource', metadataNamespace: 'http://www.sap.com/adt/ddic/dtdcsources',
  discoveryMarker: 'dtdc',
}
```
Existing 7 entries gain `metadataRootLocalName:'blueSource'`, `metadataRootQName:'blue:blueSource'`, `metadataNamespace:'http://www.sap.com/wbobj/blue'`, `discoveryMarker:'blues'` (all identical for the blue family — factor a `BLUE_METADATA` spread to avoid 7× repetition).

## HARD BLOCKER — tool-schema budget

`standard-full-git` wire wall is 68,000; main sits at 67,986 (14 B). DTDC adds a type code to **3 enums** (SAPRead type, SAPWrite type, batch_create item) + description prose. **Must trim** the SDO description sentences to fit — same technique as FEAT-68 (tighten genuinely verbose SAPRead/SAPWrite type-description clauses; measure with `check:sizes`).

## Files (per dossier)

`src/adt/server-driven.ts` (registry + gate + build), `src/adt/xml-parser.ts` (parse), `src/handlers/tools.ts` + `tool-descriptions.ts` (DTDC in 4 SDO sentences + **trim**), `src/handlers/write.ts`/`write/create.ts`/`probe/catalog.ts` (SDO-list comments; batch guard already covers DTDC via `isServerDrivenObjectType`), tests (`server-driven.test.ts`, `schemas.test.ts`, `tools.test.ts` + a dtdc parse/build test), fixtures, docs (`tools.md`, `dev-guide.md`, `btp-abap-environment.md`, `AGENTS.md`, `roadmap.md` mark FEAT-67 done). No change to `tool-registry.ts`/`schemas.ts` action/`policy.ts` (derive from `SDO_TYPES`, same as DSFD in #604).

## Test

1. Unit: parse a real `<dtdc:dtdcSource>` body via the generalized parser; build emits `<dtdc:dtdcSource>`; DTDC in every per-type loop. Regression guard: the existing blue types still parse/build/gate unchanged.
2. Full gate: `npm test`, typecheck, lint, `validate:policy`, build, `check:sizes`.
3. **Live (mandatory, both releases)**: built CLI create→update→**activate**→read→delete DTDC in `$TMP` on 816; create/activate/delete on 758 (DTDC ships there too); confirm an existing blue type (DESD) still round-trips (no regression from the generalization).

## Risk

Moderate — the generalization touches the shared parse/build/gate used by all 7 existing SDO types. Mitigation: the blue family keeps byte-identical behavior (same root/ns/marker via the shared spread), and the regression test proves it. Budget trim must not drop capability. Fixture diff must be DTDC-only.

## Out of scope
- `createstatements` ("Show SQL", POST-only) + `parser/info` — separate feature.
- No new auth/discovery model (ADR-0005/0006 boundary): DTDC is a plain single-target read/write type.
