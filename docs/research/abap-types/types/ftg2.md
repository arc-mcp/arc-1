# FTG2 — ABAP Feature Toggle (states)

## TL;DR
`FTG2` is **not** a TADIR R3TR type and **not** a documented ADT slash subtype. It is an
**ARC-1-invented short name** for reading state of an ABAP Feature Toggle via the real
ADT URL `/sap/bc/adt/sfw/featuretoggles/{name}/states`. The endpoint exists; the
*identifier* `FTG2` is invented (likely chosen as "Feature ToGgle 2", paralleling the
`v2` MIME). The inventory's hypothesis "Authorization field-group?" is wrong — that would
be SUSO/SUSH territory; FTG2 here is feature toggles, not authorization.

## TADIR ground truth
- **R3TR type**: does **not** exist as `FTG2`. SAP's TADIR codes for feature toggle
  artefacts are different (`SFBF` / `SFBS` for Switch Framework business functions/sets;
  individual feature toggles are usually owned by the underlying CL_SFW_FEATURE_TOGGLE
  registry rather than dirtied into TADIR with a four-letter code).
- **LIMU sub-objects**: N/A
- **abap-file-formats support**: ❌ — no `ftg2/` directory in `SAP/abap-file-formats`
  (verified `gh api repos/SAP/abap-file-formats/contents/file-formats` 2026-05-08).
  Feature toggles are not abapGit-serialized.
- **Source URL or fixture**: ARC-1's invention — `src/handlers/intent.ts:1577-1580`,
  `src/probe/catalog.ts:179-181`, `src/adt/client.ts:503-509`,
  `src/adt/xml-parser.ts:577,588`.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| (none — invented) | feature toggle state read | `/sap/bc/adt/sfw/featuretoggles/{name}/states` | a4h ✅ (real endpoint, returns JSON despite ADT default XML) |

ADT itself does not surface feature toggles as a `<adtcore:objectType>` — they are not
listed in `repository/typestructure`. The endpoint is part of the SFW (Switch Framework)
back-channel, not the workbench object model.

## SAP docs & notes
- The `/sap/bc/adt/sfw/featuretoggles/.../states` endpoint is undocumented in public
  SAP help. ARC-1 discovered it from an empirical probe (`docs/compare/00-feature-matrix.md:97`
  shows ARC-1 is the only MCP/ADT-tool exposing it). Accept header is `application/json`
  (see `src/adt/client.ts:506`).
- No SAP Note found via `mcp__sap-notes__search` for the FTG2 identifier specifically.

## Other MCP servers / cross-reference
- `docs/compare/00-feature-matrix.md:97`: only ARC-1 implements feature-toggle reads.
  `mcp-abap-abap-adt-api` exposes a richer toggle/check/validate API but it does not call
  it `FTG2` either — it uses descriptive method names. So ARC-1 is on its own with the
  `FTG2` short.
- Eclipse ADT plugin: no `FTG2` in the API javadoc index. No `WBObjectType` constant.

## Live verification
### a4h (S/4HANA 2023)
- Test object: any switch-framework toggle (e.g., `SFW2_DEMO_FEATURE`).
- ADT response: 200 with JSON body parsed by `parseFeatureToggleStates` in
  `src/adt/xml-parser.ts:577`.

### 7.50 (NW 7.50)
- Test object: same. The SFW endpoint exists from NW 7.40 onward but the toggle
  catalogue is empty unless customer-defined; ARC-1 will return an empty/404 cleanly
  via the `getFeatureToggle` error handler.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct URL? | Real type code? |
|---|---|---|---|---|
| `src/handlers/schemas.ts` | 49 (Read onprem only) | `FTG2` | n/a | ❌ invented |
| `src/handlers/intent.ts` SLASH_TYPE_MAP | — | no entry | ✅ no fake slash | — |
| `src/handlers/intent.ts` Read switch | 1577-1580 | calls `client.getFeatureToggle(name)` | ✅ real URL | — |
| `src/handlers/intent.ts` unknown-type error string | 1776 | lists `FTG2` in supported types | ✅ | — |
| `src/probe/catalog.ts` | 179-181 | probe entry `type: 'FTG2'`, URL `/sap/bc/adt/sfw/featuretoggles` | URL ✅ | type ❌ invented |
| `src/adt/client.ts` getFeatureToggle | 503-509 | GET `/sap/bc/adt/sfw/featuretoggles/{name}/states` JSON | ✅ | — |
| `src/adt/xml-parser.ts` | 577-590 | parse JSON | ✅ | — |
| `src/adt/types.ts` | 744 | `FeatureToggleInfo` (good) | ✅ | — |

## Verdict
- **Status**: wrong (identifier invented; endpoint real)
- **Evidence**: verified-on-live-system + verified-from-source. The `FTG2` name appears
  nowhere in SAP's TADIR, abap-file-formats, eclipse ADT plugin, or any other MCP
  implementation. The endpoint it maps to (`/sap/bc/adt/sfw/featuretoggles`) is genuine.
- **Issue**: same shape as `STRU/DS` and `FUNC/FM` from issue #218 — a synthetic short
  name being treated as a TADIR type. LLMs reading the schema enum will guess (wrongly)
  that this is a workbench object type.

## Recommendation
- **Rename `FTG2` to a clearly pseudo identifier** consistent with the other
  cross-cutting reads: `FEATURE_TOGGLE` (or `FEATURE_TOGGLES`). It belongs in the same
  bucket as `SYSTEM`, `COMPONENTS`, `MESSAGES` — pseudo, action-shaped, not a real ADT
  object type. The probe entry should be renamed to match.
- Alternatively, **move it to a `SAPManage` action** (e.g., `SAPManage(action="get_feature_toggle", name=...)`)
  where it semantically belongs — feature toggles are a system-administration concern,
  not a developer object.
- **Breaking change**: yes — minor. Affects anyone calling `SAPRead(type="FTG2", ...)`.
  Provide a one-release alias from `FTG2` → new name; remove in next major.
- **Test gap to close**: regression test in `tests/unit/handlers/schemas.test.ts`
  asserting that the Read-types enum's pseudo names are documented as such (e.g., a
  hard-coded list `['SYSTEM','COMPONENTS','MESSAGES','TEXT_ELEMENTS','VARIANTS','SOBJ',
  '<feature-toggle name>']` checked against the schema), so future invented codes get
  flagged.
