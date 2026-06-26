# Issue #30: Object History and Transport Contents

> **Priority**: Medium
> **Source**: fr0ster issue #30 (open, 2026-04-01)
> **ARC-1 Matrix Ref**: #20 (transport contents), #25 (CompareSource)
> **ARC-1 component**: `src/adt/client.ts`, `src/adt/transport.ts`, `src/handlers/intent.ts`

## Issue description

Feature request to extend MCP tools with:
1. **Object version history** — list previous versions of an ABAP object
2. **Version diff/docs/compare** — docs/compare two versions of an object
3. **Transport contents** — list objects inside a transport request (E071 table equivalent)

## ARC-1 current state

- **Object history**: Not implemented. ADT provides `/sap/bc/adt/vit/wb/object_type/object_name/versions` endpoint.
- **Version diff**: Not implemented. ADT provides version comparison endpoints.
- **Transport contents**: Not implemented. ADT provides `/sap/bc/adt/cts/transportrequests/{id}` with task/object details.

## Assessment

### Transport contents (Medium priority)
Most useful of the three. The LLM often needs to know "what's in this transport?" to understand scope of changes. ARC-1's `listTransports` returns transport metadata but not the objects inside.

ADT endpoint: `GET /sap/bc/adt/cts/transportrequests/{trkorr}` returns task list with objects.

**Effort**: ~0.5d — parse transport detail XML, add to SAPTransport.

### Object version history (Low-medium priority)
Useful for understanding change history. The ADT versions endpoint returns a list of versions with dates, authors, and transport numbers.

**Effort**: ~1d — new ADT endpoint + parsing + handler action.

### Version diff/docs/compare (Low priority)
Cool but niche. The LLM can compare source by reading current vs a specific version. Native diff adds complexity.

**Effort**: ~1d — ADT comparison endpoint + diff formatting.

## Decision

**Transport contents: implement** — High value, low effort. Add to SAPTransport handler.
**Object history: consider for future** — Useful but not urgent.
**Version diff: defer** — LLM can handle comparison manually.
