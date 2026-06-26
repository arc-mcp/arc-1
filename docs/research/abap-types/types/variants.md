# VARIANTS — Pseudo: program variants read

## TL;DR
`VARIANTS` is a **pseudo type** — reads the saved selection-screen variants of a classic
ABAP program via `GET /sap/bc/adt/programs/programs/{name}/variants`. Not a TADIR type.
Tied to PROG. BTP-excluded, correctly, because BTP has no classic programs.

## TADIR ground truth
- **R3TR type**: does not exist as `VARIANTS`. Variants live in tables `VARI`/`VARID`.
  TADIR has `VARX` (variant catalog) and individual variants tracked under their parent
  PROG.
- **LIMU sub-objects**: variants stored under their parent program; not a top-level
  workbench object.
- **abap-file-formats support**: ❌ no `variants/` dir; `prog/` may include variant data
  in the program serialization.
- **Source URL or fixture**: `src/adt/client.ts:659-663`, `src/handlers/intent.ts:1729-1730`.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| (none — sub-resource) | program variants | `/sap/bc/adt/programs/programs/{name}/variants` | a4h ✅, 7.50 ✅ |

## SAP docs & notes
- Maintained via tx `SE38 → Variant` or `SA38`. ADT exposes them at the sub-resource URL.

## Other MCP servers / cross-reference
- No competitor publishes a `VARIANTS` short form.

## Live verification
### a4h (S/4HANA 2023)
- Test object: any classic report with saved variants.
- ADT response: 200 XML body listing variants.

### 7.50 (NW 7.50)
- Same.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/schemas.ts` | 43 (Read onprem only — correctly excluded from BTP) | `VARIANTS` | ✅ pseudo |
| `src/handlers/intent.ts` BTP_HINTS | 1243 | "Variants are not available on BTP" hint | ✅ |
| `src/handlers/intent.ts` Read switch | 1729-1730 | calls `getVariants(name)` | ✅ |
| `src/adt/client.ts` getVariants | 659-663 | GET sub-resource URL | ✅ |

## Verdict
- **Status**: pseudo (legitimate)
- **Evidence**: verified-from-source
- **Issue**: same as `TEXT_ELEMENTS` — raw XML body, no parser.

## Recommendation
- **Keep.** Optional: add structured parser. No change to type code.
- **Breaking change**: no.
- **Test gap to close**: parser unit test if/when a structured shape is added.
