# TEXT_ELEMENTS — Pseudo: program text-element read

## TL;DR
`TEXT_ELEMENTS` is a **pseudo type** — it reads the text-element segment of a classic
ABAP program via `GET /sap/bc/adt/programs/programs/{name}/textelements`. Not a TADIR
type. Tied to PROG; conceptually a *part of* a PROG object, exposed separately because
ADT serves it at a sub-resource URL.

## TADIR ground truth
- **R3TR type**: does not exist (text elements are part of a `PROG` object, table TEXTPOOL)
- **LIMU sub-objects**: N/A — they are program properties, not catalogued in TADIR
- **abap-file-formats support**: indirectly ✅ — abap-file-formats `prog/` includes a
  text-elements section in the program serialization.
- **Source URL or fixture**: `src/adt/client.ts:653-657`, `src/handlers/intent.ts:1727-1728`.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| (none — sub-resource) | program text elements | `/sap/bc/adt/programs/programs/{name}/textelements` | a4h ✅, 7.50 ✅ |

The URL is a sub-resource of `PROG`, not its own collection. ARC-1 returns the raw
response body; no parser. BTP correctly excluded (no classic programs).

## SAP docs & notes
- Maintained via tx `SE38 → Goto → Text Elements`. The ADT URL is the same one Eclipse
  ADT uses for the "Text Elements" tab.

## Other MCP servers / cross-reference
- `mcp-abap-abap-adt-api` exposes a textelements API (mentioned in
  `docs/compare/00-feature-matrix.md:5`). Most others don't.

## Live verification
### a4h (S/4HANA 2023)
- Test object: any classic report (e.g., `RSPARAM`).
- ADT response: 200 with text-element XML (selection-text + list-heading sections).

### 7.50 (NW 7.50)
- Same.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/schemas.ts` | 42 (Read onprem only — correctly excluded from BTP) | `TEXT_ELEMENTS` | ✅ pseudo |
| `src/handlers/intent.ts` BTP_HINTS | 1241 | "not available on BTP" hint | ✅ |
| `src/handlers/intent.ts` Read switch | 1727-1728 | calls `getTextElements(name)` | ✅ |
| `src/adt/client.ts` getTextElements | 653-657 | GET sub-resource URL | ✅ |

## Verdict
- **Status**: pseudo (legitimate)
- **Evidence**: verified-from-source
- **Issue**: returns raw XML body — no parser. An LLM consumer gets unstructured XML.

## Recommendation
- **Keep as pseudo type.** Optional follow-up: add a `parseTextElements` parser in
  `src/adt/xml-parser.ts` that returns `{ selectionTexts, listHeadings, ... }` JSON,
  matching the shape of `getMessageClassInfo`. This is a UX improvement, not a
  correctness fix.
- **Breaking change**: no (parser is purely additive, response can keep raw fallback for
  one release).
- **Test gap to close**: parser unit test on a fixture XML in
  `tests/unit/adt/xml-parser.test.ts`.
