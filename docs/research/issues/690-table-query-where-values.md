# Issue #690 — TABLE_QUERY documents the wrong quoting contract

**Status:** Confirmed bug; root cause validated live on 2026-08-10 against A4H/S/4HANA 2023 (SAP_BASIS 758) and A4H/ABAP Platform 2025 (SAP_BASIS 816). The SQL builder is correct; the LLM-visible schema description is stale.

## TL;DR

`SAPRead(type="TABLE_QUERY")` accepts raw `where[].value` strings and quotes/escapes them in ARC-1. The `IN`/`NOT IN` schema text instead tells callers to supply SQL-quoted literals. A caller following that text receives a successful query with zero rows, because the quote characters become part of the compared value.

This is a client documentation/schema bug, not an SAP release defect and not a SQL-injection issue. The minimum safe fix is to correct the schema description and its frozen tool-definition fixtures. The existing builder and unit tests should remain unchanged.

## Claim and scope

The issue reports that the `where` schema says `IN`/`NOT IN` values must be `"'261','262'"`, while `buildInList()` treats each input item as raw data, escapes it, and wraps it in quotes. It also notes that the same raw-value contract applies to scalar operators such as `=` and `LIKE`, although those examples already use bare values.

Relevant HEAD code:

- `src/adt/client.ts:192-204` documents and implements raw `IN` values: trim each item, escape single quotes, then wrap it in a SQL literal.
- `src/adt/client.ts:286-293` applies the same raw-value treatment to `IN` and scalar comparisons.
- `src/handlers/tools.ts:552-555` incorrectly asks the caller for pre-quoted `IN`/`NOT IN` literals.
- `tests/unit/adt/table-query.test.ts:74-80` already asserts the intended raw-value behavior (`261,262` → `('261', '262')`).

## Research evidence

### ADT contract

ARC-1 sends the generated statement to SAP's freestyle data-preview endpoint:

`POST /sap/bc/adt/datapreview/freestyle?rowNumber=<n>`

with `Content-Type: text/plain`. The local Eclipse ADT research notes identify this endpoint but do not define a structured `where` contract; the raw SQL text is the contract at the ADT boundary. ARC-1's structured `TABLE_QUERY` layer therefore owns the conversion from raw values to SQL literals.

The SAP ABAP language reference confirms that single-quoted text field literals represent character values and that embedded quote characters are escaped by doubling them. It also documents that dynamic SQL values must be escaped before being concatenated. That matches the current builder's behavior and does not support passing the caller's delimiters through as data.

### Reference implementation check

The local `mcp-abap-adt-fr0ster` reference exposes freestyle SQL as a raw `sql_query` string and does not add a structured `IN`-list value layer. No reference implementation supplied evidence that ARC-1 should receive pre-quoted values.

### Live validation

Commands were run through the supported `arc1-cli` path with the existing A4H test credentials loaded from the local infrastructure reference. Only `SAP_ALLOW_DATA_PREVIEW=true` was enabled; no writes were enabled.

The query shape was:

```json
{
  "type": "TABLE_QUERY",
  "name": "TADIR",
  "columns": ["PGMID", "OBJECT", "OBJ_NAME"],
  "where": [
    {"field": "OBJ_NAME", "op": "IN", "value": "<value>"},
    {"field": "OBJECT", "op": "=", "value": "TABL"}
  ],
  "maxRows": 10
}
```

| System | Input | HTTP/tool result | Returned rows |
|---|---|---|---|
| A4H, SAP_BASIS 758 | `OBJ_NAME IN 'T000','T001'` | success | `[]` |
| A4H, SAP_BASIS 758 | `OBJ_NAME IN T000,T001` | success | `R3TR/TABL/T000` |
| A4H, SAP_BASIS 758 | `OBJ_NAME = 'T000'` | success | `[]` |
| A4H, SAP_BASIS 758 | `OBJ_NAME = T000` | success | `R3TR/TABL/T000` |
| A4H-2025, SAP_BASIS 816 | `OBJ_NAME IN 'T000','T001'` | success | `[]` |
| A4H-2025, SAP_BASIS 816 | `OBJ_NAME IN T000,T001` | success | `R3TR/TABL/T000` |

The successful empty responses are the dangerous part: this is a silent false negative, not an input validation error. The result is consistent across both releases, so no release-specific client workaround is indicated.

## Root cause

The schema and implementation disagree about who owns SQL quoting. For the documented input `"'T000','T001'"`, the builder splits the value into `"'T000'"` and `"'T001'"`, escapes each embedded quote, and wraps each item again. The emitted SQL is equivalent to:

```sql
OBJ_NAME IN ('''T000''', '''T001''')
```

Those literals contain quote characters as data, so the query is valid but does not match `T000` or `T001`.

## Recommended fix and affected files

Implement the narrow documentation fix:

1. Update `src/handlers/tools.ts` to say that `IN`/`NOT IN` values are comma-separated bare values, that ARC-1 quotes and escapes each item, and that callers must not add quotes.
2. Add a focused assertion in `tests/unit/handlers/tools.test.ts` for the corrected contract.
3. Regenerate and review the frozen tool-definition fixtures. The wording appears in all seven fixture variants that expose the shared SAPRead schema.
4. Leave `src/adt/client.ts` and `tests/unit/adt/table-query.test.ts` unchanged; their raw-value behavior is already correct and security-tested.

## Out of scope

- Do not strip caller quotes in `buildInList()` as part of this fix. That would add a second input dialect, is unnecessary once the schema is corrected, and would need separate semantics for escaped SQL literals.
- Do not change scalar value semantics or the SAP ADT endpoint.
- Do not relax data-preview safety gates.

## Paste-able GitHub reply

```markdown
Confirmed — this is a real documentation/schema bug, and I reproduced it on both A4H SAP_BASIS 758 and A4H-2025 SAP_BASIS 816.

`TABLE_QUERY` correctly treats `where[].value` as raw values and quotes/escapes them. Following the current `IN` example (`"'T000','T001'"`) therefore emits literals containing quote characters and returns a successful empty result. The bare form (`"T000,T001"`) returns the expected `TADIR` row. The same distinction is visible for `=`.

The SQL builder and its unit tests already implement the intended raw-value contract, so the fix is to correct the LLM-visible schema description and frozen tool-definition fixtures. I’ll keep the change narrow and leave the safety-tested builder unchanged.
```

**Recommendation:** fix it with the schema/fixture update, then open a PR. Do not close as duplicate or works-as-designed.
