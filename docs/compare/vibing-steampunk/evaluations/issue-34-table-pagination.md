# Issue #34: GetTableContents Pagination and Schema Introspection

> **Priority**: Medium
> **Source**: VSP issue #34 (open, 2026-02-23)
> **ARC-1 component**: `src/adt/client.ts` (RunQuery), `src/handlers/intent.ts`

## Issue description

Feature request to enhance GetTableContents with:
1. **Pagination** — cursor-based pagination for large result sets
2. **Schema introspection** — return column types, lengths, descriptions before querying
3. **Row count estimation** — approximate row count before full query

## ARC-1 current state

- `SAPQuery` tool supports `RunQuery` with `maxRows` parameter (default 100)
- No cursor-based pagination — user must modify WHERE clause manually
- No schema introspection separate from query execution
- Table structure is available via `SAPRead` (reads DDIC table definition with fields/types)

## Assessment

ARC-1's approach of separating table structure read (SAPRead) from data query (SAPQuery) is cleaner than combining them. The LLM can:
1. Read table structure first (`SAPRead type=TABL name=TABLE_NAME`)
2. Then query with appropriate filters (`SAPQuery action=RunQuery`)

Cursor pagination would be useful for large tables but adds complexity. The current `maxRows` + WHERE clause approach works for most AI use cases.

## Decision

**No action needed** — ARC-1's separation of structure read and data query covers the use case. `maxRows` provides basic pagination. Schema introspection is already available through SAPRead. True cursor pagination would be a nice-to-have but isn't blocking any workflows.

**Effort**: 1d (if cursor pagination added later)
