# ABAP Documentation (F1 Help) API

> **Priority**: Medium
> **Source**: abap-adt-api commit 7d5c653 (v7.1.0, 2025-12-19)
> **ARC-1 component**: `src/adt/client.ts` (new feature)

## What abap-adt-api added

`abapDocumentation(uri, line, column, content)` — retrieves ABAP keyword documentation (F1 help) for a given position in source code. Uses ADT endpoint `/sap/bc/adt/docu/abap/langu`.

## ARC-1 current state

- No ABAP documentation/help API
- Listed as "GetAbapHelp (F1 documentation)" in feature matrix — Medium priority, 0.5d effort
- VSP has this as `GetAbapHelp`

## Assessment

Valuable for AI-assisted development — when the LLM encounters an unfamiliar ABAP keyword or statement, it can fetch official documentation instead of hallucinating syntax. Low effort since the endpoint is straightforward.

## Decision

**Consider future** — Add to SAPRead or SAPNavigate as `action: abap_help`. The endpoint takes a URI + position (line/column) + source content and returns formatted documentation text.

**Effort**: XS (0.5d — single GET endpoint with query params)

**API pattern** (from abap-adt-api):
```
POST /sap/bc/adt/docu/abap/langu
Body: { uri, line, column, content }
Returns: HTML/text documentation
```
