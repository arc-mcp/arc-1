# Read Handlers Returning Source + Metadata Together

> **Priority**: Medium
> **Source**: fr0ster v4.2.0 — commit e5628dc (2026-03-14)
> **ARC-1 component**: `src/adt/client.ts`, `src/handlers/intent.ts` (SAPRead)

## What fr0ster did

Added `Read*` handlers (ReadClass, ReadProgram, etc.) that return both source code AND object metadata in a single response:
```json
{
  "source": "CLASS zcl_foo DEFINITION ...",
  "metadata": {
    "name": "ZCL_FOO",
    "type": "CLAS/OC",
    "package": "ZTEST",
    "responsible": "DEVELOPER",
    "lastChangedAt": "2026-03-14T10:00:00Z",
    "description": "Test class"
  }
}
```

Previously they had separate Get (source only) and GetObjectInfo (metadata only) calls.

## ARC-1 current state

SAPRead returns source only for most types. Object metadata requires a separate SAPNavigate call with `action: "info"`. This means 2 round trips when the LLM wants both.

## Assessment

**Pros**:
- Reduces LLM round trips (1 call vs 2)
- LLM gets package/responsible/description context alongside source
- Small implementation effort — metadata is already fetched during source retrieval in many cases

**Cons**:
- Increases response size for cases where only source is needed
- ARC-1's SAPRead already returns structured data for some types (DOMA, DTEL, STRU, TRAN)

**Middle ground**: Add an optional `include_metadata: true` parameter to SAPRead that appends object metadata to the response. Default to false to keep backward compatibility.

## Decision

**Consider for future** — Not urgent. The 2-call pattern works. But if we're doing a SAPRead enhancement pass, bundling metadata is a nice UX improvement. Low effort (~0.5d) since `getObjectInfo` already exists in client.ts.
