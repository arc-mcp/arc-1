# abap-adt-api v8.3.0 — Text element support

> **Priority**: Low
> **Source**: marcellourbani/abap-adt-api commit `a3a8ffd` (2026-04-26)
> **ARC-1 component**: `src/adt/client.ts` (`getTextElements`)

## What they added

A new `textelements` API module (`src/api/textelements.ts`, +188 lines) for reading and likely also writing text elements (titles, selection texts, text symbols) attached to ABAP programs / classes. Plus 286 lines of new test coverage and a 54-line disruptive (write) test.

## ARC-1 current state

ARC-1 has **read-only** support via `getTextElements(program)` (`src/adt/client.ts:577`):

```typescript
async getTextElements(program: string): Promise<string> {
  GET /sap/bc/adt/programs/programs/{program}/textelements
}
```

Exposed as `SAPRead(type='TEXT_ELEMENTS', name='ZARC1_REPORT')`. The current implementation just returns the raw response body — no parsing into a structured `TextSymbol[]` / `SelectionText[]` shape.

No write support. Callers can update text elements only by editing the program's full source and re-uploading (since text symbols `TEXT-001 = 'Hello'.` are part of the source body for some program classes), or by going through SAPGUI/Eclipse for the symbol-table form.

## Assessment

Gap exists but low priority — text-element editing is rare for the LLM-driven workflows we target, and the read path already serves the common "what does TEXT-001 mean" question for code review.

If we ever need it:

- **Read structured**: parse the XML response into `TextSymbol[]` / `SelectionText[]` / `TitleSet`. Trivial extension to `getTextElements`.
- **Write**: needs the metadata-XML round-trip pattern (already used for DTEL/DOMA in `src/adt/ddic-xml.ts`). Adds a new write target type.

## Decision

**consider-future / defer** — track the abap-adt-api implementation as the reference if/when we add text-element write. No code change today. Their +286 line test file is the best single source for the XML shape if/when we look.
