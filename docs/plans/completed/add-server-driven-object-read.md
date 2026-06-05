# Generic Server-Driven Object (SDO) Read Path (816 roadmap #2)

## Overview

ABAP Platform 2025 (SAP_BASIS 8.16) introduces ~46 new "server-driven" repository object types that all share **one** AFF generic-object contract: metadata via `GET …/{name}` (`application/vnd.sap.adt.blues.v1+xml`) and content via `GET …/{name}/source/main` (AFF **JSON**). Instead of per-type plumbing, this plan adds **one generic read engine** plus a curated registry of high-value types, exposed through `SAPRead` and **discovery-gated** so pre-8.16 systems degrade cleanly.

This is item #2 from `docs/research/abap-platform-2025-new-adt-apis.md` (§4 / §6). The mandatory spike is **done** — see "Verified Live Evidence" — so the wire contract, the discovery gate, and real 200 round-trips against two high-value dev types (DESD, EVTB) are confirmed, not assumed.

Key decisions:
- **Read-only, generic engine.** `getServerDrivenObject(http, safety, code, name)` reads metadata + source for any registered code via discovery-resolved hrefs. Write (lock → PUT JSON → activate, with `$schema` validation) is a deliberate follow-up — "read before write."
- **Curated registry of 6 high-value types** (DESD, DTSC, CSNM, EVTB, EVTO, COTA), not all 46. The engine is generic, so adding more later is a one-line registry entry. Low-value/internal types (SUSI, SFPF, UIAD, AIF*, ILMB, …) are intentionally left out of the user-facing surface.
- **Discovery-gate** on the collection advertising `blues.v1+xml` (mirrors the transport-target / cds_testcases gates). 758 → friendly "needs 8.16+" message.
- **Output is JSON** (parsed metadata fields + the AFF JSON source), unlike normal source-returning `SAPRead` types.

## Context

### Current State

- `SAPRead` (`handleSAPRead`, `src/handlers/intent.ts:1476`) validates `type` against `z.enum(SAPREAD_TYPES_ONPREM)` (`src/handlers/schemas.ts:17`) and routes via `switch (type)` at `:1537`. None of the new 816 server-driven types are supported.
- arc-1 has never used the `blues.v1+xml` / `serverdriven.schema` content types.
- `src/adt/discovery.ts` already caches the discovery map; `http.discoveryAcceptFor(path)` + `http.hasDiscoveryData()` exist (used by `supportsExplicitTransportTarget` / `supportsCdsTestCases`).

### Target State

- `SAPRead(type="DESD", name="DEMO_CDS_LOGICL_EXTERNL_SCHEMA")` → JSON:
  ```json
  {
    "name": "DEMO_CDS_LOGICL_EXTERNL_SCHEMA",
    "type": "DESD/TYP",
    "description": "Demo CDS Logical External Schema",
    "package": "SABAP_DEMOS_ABAP_CDS_CLOUD",
    "masterLanguage": "EN",
    "abapLanguageVersion": "cloudDevelopment",
    "responsible": "SAP",
    "version": "active",
    "changedBy": "SAP", "changedAt": "2024-07-01T14:27:57Z",
    "source": { "formatVersion": "1", "header": { "description": "...", "originalLanguage": "en", "abapLanguageVersion": "cloudDevelopment" } }
  }
  ```
- `SAPRead(type="EVTB", name="S_BUSINESSPARTNER_CHANGE")` → JSON whose `source` carries `boName`/`boOperation`/`events[]` (RAP event binding).
- On 758 / 7.5x: `SAPRead(type="DESD", …)` → clear "requires SAP_BASIS 8.16+ … does not expose this server-driven object type" (discovery-gated).
- Nonexistent name → SAP `404` surfaced via the normal error path.

### Verified Live Evidence (spike — 2026-06-05, a4h-2025 / 816 vs a4h / 758)

- **46 Class-A collections** on 816 advertise `application/vnd.sap.adt.blues.v1+xml` in discovery, all with the uniform templateLinks `…/{object_name}{?corrNr,lockHandle,version,accessMode,_action}` + `…/{object_name}/source/main`. The `blues.v1+xml` accept is the gate signature.
- **`$schema` works**: `GET …/{collection}/$schema` (Accept `application/vnd.sap.adt.serverdriven.schema.v1+json; framework=objectTypes.v1`) → 200 AFF JSON schema (desd/cota/swcr confirmed). (Used by the future write path; not required for read.)
- **Real 200 round-trips** (TADIR-discovered instances — name-guessing failed, TADIR is the way):
  - **DESD** `DEMO_CDS_LOGICL_EXTERNL_SCHEMA` (pkg `SABAP_DEMOS_ABAP_CDS_CLOUD`): metadata 3178 B, source 176 B.
  - **EVTB** `S_BUSINESSPARTNER_CHANGE` (pkg `MDC_BUPA_BO`, +7 more): metadata 5677 B, source 541 B.
  - Also readable: UIAD (200), SFPF (117), SUSI (63), ILMB (8), BGQC, SMBC. **0 instances** on the trial for DTSC/CSNM/COTA/EVTO/SPRV/UIPG/UIST/DCAT/SAIA/SWCR/AIF*/INTS/INTM/CMPT (still routed + gated).
- **Metadata shape** (`<blue:blueSource>`, ns `http://www.sap.com/wbobj/blue`): attrs `adtcore:name`, `adtcore:type` (e.g. `DESD/TYP`, `EVTB/EVB`), `adtcore:description`, `adtcore:masterLanguage`, `adtcore:responsible`, `adtcore:version`, `adtcore:changedAt/By`, `adtcore:createdAt/By`, `adtcore:abapLanguageVersion`; child `<adtcore:packageRef adtcore:name="…">`; `<atom:link rel=".../source" type="application/json">` confirms the source is JSON.
- **Source shape** (`/source/main`): AFF JSON — `{ "formatVersion", "header": { "description", "originalLanguage", "abapLanguageVersion"? }, …type-specific… }`.
- **Gate proof**: `http.discoveryAcceptFor('/sap/bc/adt/ddic/desd')` → `blues.v1+xml` on 816, `undefined` on 758 (collection absent). Bare/nonexistent name → 404.
- Captured fixtures live in `tests/fixtures/sdo/{desd,evtb}-{metadata.xml,source.json}`.

### Key Files

| File | Role |
|------|------|
| `src/adt/server-driven.ts` (new) | `SDO_REGISTRY` (code → {href,label}), `isServerDrivenObjectType`, `supportsServerDrivenObject`, `getServerDrivenObject` |
| `src/adt/xml-parser.ts` | `parseBlueSource(xml)` → metadata attrs (mirror `parseClassMetadata`) |
| `src/adt/types.ts` | `ServerDrivenObjectMetadata` + `ServerDrivenObjectResult` |
| `src/handlers/intent.ts` | early SDO branch in `handleSAPRead` (before `switch` at `:1537`) |
| `src/handlers/schemas.ts` | add 6 codes to `SAPREAD_TYPES_ONPREM` (`:17`) + `SAPREAD_TYPES_BTP` (`:64`) |
| `src/handlers/tools.ts` | document the 6 types in SAPRead's `type` description |
| `src/probe/catalog.ts` | add 6 catalog entries (`minRelease: 816`; knownObjects for DESD/EVTB) |
| `tests/fixtures/sdo/*` | real captured metadata + source |

### Design Principles

1. **One generic engine, discovery-resolved.** No per-type read code; the registry maps code → collection href, the engine does metadata + source GET.
2. **Discovery-gated, fail-soft.** Gate known-absent → friendly message; gate-unknown (discovery not loaded) → attempt and let 404/406 surface.
3. **Read scope only.** `SAPRead` is already read-scoped; new types inherit. No write, no `$schema` validation (follow-up).
4. **Parser mirrors `parseClassMetadata`** (attribute reads on a single root element; `removeNSPrefix` strips `blue:`/`adtcore:`).
5. **Curated, not exhaustive.** 6 high-value types; engine generic for trivial future expansion.

## Development Approach

Build the pure parser + engine + registry first (fixtures), then wire the `handleSAPRead` branch, then schema/tools/probe, then live integration (DESD+EVTB) + e2e, then docs. Every code task ends with `npm test`. Integration uses the skip-policy (gate `false` → `requireOrSkip` with `|| undefined`, since it only skips on null/undefined).

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Types, parser, registry, engine, discovery gate

**Files:**
- Modify: `src/adt/types.ts`, `src/adt/xml-parser.ts`
- Create: `src/adt/server-driven.ts`
- Create: `tests/unit/adt/server-driven.test.ts`
- Modify: `tests/unit/adt/xml-parser.test.ts`

- [ ] `src/adt/types.ts`: add
  ```ts
  export interface ServerDrivenObjectMetadata {
    name: string; type: string; description?: string; package?: string;
    masterLanguage?: string; abapLanguageVersion?: string; responsible?: string;
    version?: string; changedBy?: string; changedAt?: string; createdBy?: string; createdAt?: string;
  }
  export interface ServerDrivenObjectResult extends ServerDrivenObjectMetadata { source: unknown; }
  ```
- [ ] `src/adt/xml-parser.ts`: add `parseBlueSource(xml): ServerDrivenObjectMetadata` mirroring `parseClassMetadata` (`:1086`): `const root = (parseXml(xml).blueSource ?? {}) as Record<string,unknown>;` then read `root['@_name']`, `@_type`, `@_description`, `@_masterLanguage`, `@_responsible`, `@_version`, `@_changedAt`, `@_changedBy`, `@_createdAt`, `@_createdBy`, `@_abapLanguageVersion`; package from `(root.packageRef as any)?.['@_name']`. Omit empty-string fields.
- [ ] `src/adt/server-driven.ts`:
  ```ts
  export const SDO_REGISTRY: Record<string, { href: string; label: string }> = {
    DESD: { href: '/sap/bc/adt/ddic/desd', label: 'CDS Logical External Schema' },
    DTSC: { href: '/sap/bc/adt/ddic/dtsc/sources', label: 'CDS Static Cache (table-entity buffer)' },
    CSNM: { href: '/sap/bc/adt/csn/csnm', label: 'Core Schema Notation Model (CSN)' },
    EVTB: { href: '/sap/bc/adt/businessservices/evtbevb', label: 'RAP Event Binding' },
    EVTO: { href: '/sap/bc/adt/businessservices/evtoevo', label: 'RAP Event Object' },
    COTA: { href: '/sap/bc/adt/conn/commtargets', label: 'Communication Target' },
  };
  export function isServerDrivenObjectType(code: string): boolean { return code in SDO_REGISTRY; }
  export function supportsServerDrivenObject(http: AdtHttpClient, code: string): boolean | undefined {
    const e = SDO_REGISTRY[code]; if (!e) return false;
    if (!http.hasDiscoveryData()) return undefined;
    return (http.discoveryAcceptFor(e.href) ?? '').includes('blues');
  }
  export async function getServerDrivenObject(http, safety, code, name): Promise<ServerDrivenObjectResult> {
    checkOperation(safety, OperationType.Read, 'GetServerDrivenObject');
    const e = SDO_REGISTRY[code]; if (!e) throw new AdtApiError(`Unknown server-driven object type ${code}`, 400, '');
    const meta = await http.get(`${e.href}/${encodeURIComponent(name)}`, { Accept: 'application/vnd.sap.adt.blues.v1+xml' });
    const metadata = parseBlueSource(meta.body);
    const src = await http.get(`${e.href}/${encodeURIComponent(name)}/source/main`, { Accept: 'application/json, */*' });
    let source: unknown = src.body;
    try { source = JSON.parse(src.body); } catch { /* keep raw text */ }
    return { ...metadata, source };
  }
  ```
- [ ] Add unit tests (~12): `parseBlueSource` on DESD + EVTB + SUSI(*) fixtures → name/type/description/package/masterLanguage etc.; `getServerDrivenObject` issues the two GETs with the right paths+Accept (mock `http.get`), JSON-parses source, falls back to raw on non-JSON; `supportsServerDrivenObject` returns undefined (no discovery) / true (blues advertised) / false (absent or unknown code); `isServerDrivenObjectType` true/false. (*) capture SUSI fixture too, or use DESD+EVTB only.
- [ ] Run `npm test`.

### Task 2: Wire SDO into `handleSAPRead`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

- [ ] Import `getServerDrivenObject, isServerDrivenObjectType, supportsServerDrivenObject` from `../adt/server-driven.js`.
- [ ] In `handleSAPRead` (`:1476`), add an early branch **before** `switch (type)` (`:1537`), after the `format==='structured'` guard:
  ```ts
  if (isServerDrivenObjectType(type)) {
    if (!name) return errorResult(`"name" is required for SAPRead type=${type}.`);
    if (supportsServerDrivenObject(client.http, type) === false) {
      return errorResult(
        `SAPRead type=${type} (server-driven object) requires SAP_BASIS 8.16+ (ABAP Platform 2025 / S/4HANA 2025). ` +
          `This system does not expose this object type.`,
      );
    }
    const result = await getServerDrivenObject(client.http, client.safety, type, name);
    return textResult(JSON.stringify(result, null, 2));
  }
  ```
  Note: do NOT route through `cachedGet`/`objectUrlForType`; SDO uses its own href + JSON output. `normalizeObjectType` leaves DESD/EVTB/… unchanged (not in `SLASH_TYPE_MAP`).
- [ ] Add unit tests (~5) in `tests/unit/handlers/intent.test.ts` (mirror the `SAPDiagnose cds_testcases` block, `mockFetch`): success for DESD (return the metadata fixture for the `…/desd/<name>` GET and the source fixture for `…/source/main`), assert `payload.type==='DESD/TYP'`, `payload.package`, `payload.source.header`; missing-name error; gated-out (spy `hasDiscoveryData`→true, `discoveryAcceptFor`→undefined → "requires SAP_BASIS 8.16+", no SAP call); 404 nonexistent surfaces an error.
- [ ] Run `npm test`.

### Task 3: Schema, tool definition, probe catalog

**Files:**
- Modify: `src/handlers/schemas.ts`, `src/handlers/tools.ts`, `src/probe/catalog.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`, `tests/unit/handlers/tools.test.ts`

- [ ] `schemas.ts`: add `'DESD','DTSC','CSNM','EVTB','EVTO','COTA'` to `SAPREAD_TYPES_ONPREM` (`:17`) and `SAPREAD_TYPES_BTP` (`:64`) (these types are ABAP-Cloud-native; the discovery gate protects non-8.16 systems).
- [ ] `tools.ts`: in the SAPRead `type` description, add a line listing the server-driven 816 types (DESD/DTSC/CSNM/EVTB/EVTO/COTA) and that they return JSON metadata + AFF-JSON source, 8.16+ only.
- [ ] `probe/catalog.ts`: add 6 entries — `{ type, collectionUrl, objectUrlTemplate: '<href>/{name}', knownObjects, minRelease: 816, note }`. `knownObjects`: DESD `['DEMO_CDS_LOGICL_EXTERNL_SCHEMA']`, EVTB `['S_BUSINESSPARTNER_CHANGE']`; leave empty for DTSC/CSNM/EVTO/COTA.
- [ ] Tests: `schemas.test.ts` — `SAPReadSchema.safeParse({type:'EVTB',name:'X'}).success===true`; `tools.test.ts` — SAPRead type description/enum includes `DESD`/`EVTB`.
- [ ] Run `npm test`.

### Task 4: Live integration test (816), skip-safe on 758

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

- [ ] Add `describe('getServerDrivenObject (816 SDO read)')` (mirror the `getCdsTestCases` block): load discovery (`fetchDiscoveryDocument` + `setDiscoveryMap`), gate via `requireOrSkip(ctx, supportsServerDrivenObject(client.http,'DESD') || undefined, ${SkipReason.BACKEND_UNSUPPORTED}: server-driven objects need SAP_BASIS 8.16+)`.
  - DESD read: `getServerDrivenObject(client.http, unrestrictedSafetyConfig(), 'DESD', 'DEMO_CDS_LOGICL_EXTERNL_SCHEMA')` → `type==='DESD/TYP'`, `package` truthy, `source` is an object with a `header`.
  - EVTB read: `'S_BUSINESSPARTNER_CHANGE'` → `source.events` is a non-empty array; `source.boName` truthy.
  - Nonexistent → `expectSapFailureClass(err, [404], [/not exist|not found|reading the object/i])`.
- [ ] Operator-run against 816 (`SAP_A4H_2025_*`); confirm pass on 816 + clean skip on 758. Run `npm test` (unit) green.

### Task 5: E2E test via MCP

**Files:**
- Modify: `tests/e2e/*` (new `tests/e2e/server-driven-read.e2e.test.ts` or extend an existing read e2e)

- [ ] `callTool(client, 'SAPRead', { type: 'EVTB', name: 'S_BUSINESSPARTNER_CHANGE' })`; if `isError` (pre-8.16), `ctx.skip(...)`; else `JSON.parse(expectToolSuccess(...))` and assert `type`, `source`. Run `npm test` green (e2e operator-run).

### Task 6: Documentation

**Files:**
- Modify: `docs_page/tools.md`, `CLAUDE.md`, `docs/research/abap-platform-2025-new-adt-apis.md`, `docs_page/roadmap.md`, `compare/00-feature-matrix.md`

- [ ] `docs_page/tools.md` (SAPRead): document the server-driven object types — purpose, the JSON output (metadata + AFF-JSON source), 8.16-only gate, read-only, and that write is a follow-up.
- [ ] `CLAUDE.md`: Key Files row for the SDO read path (`src/adt/server-driven.ts` engine + registry, `parseBlueSource`, discovery-gate, `handleSAPRead` branch; metadata `blue:blueSource` XML + source AFF JSON; 8.16+ only; verified DESD/EVTB).
- [ ] `docs/research/abap-platform-2025-new-adt-apis.md`: mark §4 / §6 #2 **implemented** (read path) with the verified instance names; note write is the remaining follow-up.
- [ ] `docs_page/roadmap.md`: add a completed row. `compare/00-feature-matrix.md`: add/refresh a row if one fits; refresh "Last updated".
- [ ] Run `npm run lint` + `npm run typecheck`.

### Task 7: Final verification

- [ ] `npm test` (all pass), `npm run typecheck` (clean), `npm run lint` (clean).
- [ ] Three-file sync: the 6 codes appear in `SAPREAD_TYPES_ONPREM`/`_BTP` (schemas), the SAPRead `type` description (tools), and the `isServerDrivenObjectType` branch (intent).
- [ ] Integration (operator, 816): DESD + EVTB read pass; 758 skips.
- [ ] Move this plan to `docs/plans/completed/`.
