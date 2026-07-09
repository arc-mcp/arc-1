# SAPQuery Freestyle Capability Matrix

This matrix documents what ABAP SQL supports as a language versus what the ADT freestyle endpoint (`/sap/bc/adt/datapreview/freestyle`) may accept or reject in practice on specific backend stacks.

## Scope

- ARC-1 tool: `SAPQuery`
- Endpoint: `/sap/bc/adt/datapreview/freestyle`
- Transport: HTTP POST with SQL text body

## Matrix

| Construct | ABAP SQL language support | Observed ADT/freestyle behavior | Recommended fallback in ARC-1 workflows | Primary source(s) |
|---|---|---|---|---|
| Single `SELECT ... WHERE ... ORDER BY ...` | Supported | Generally reliable | Keep as-is; cap rows with `maxRows` | ABAP keyword docs (Open SQL)
| Qualified field access | Uses `alias~field` | `alias~field` works; `alias.field` can fail with `Only one SELECT statement is allowed` because `.` ends an ABAP statement | Replace every `alias.field` with `alias~field` | Live-verified on SAP_BASIS 758
| `ORDER BY ... ASC/DESC` (SQL standard keywords) | Not ABAP syntax | Rejected with parser errors | Use `ASCENDING` / `DESCENDING` | ABAP keyword docs (Open SQL)
| `LIMIT n` | Not ABAP syntax | Rejected | Use `maxRows` parameter on `SAPQuery` | ARC-1 contract + ABAP SQL syntax
| `GROUP BY`, `COUNT(*)` | Supported | Usually works, but ABAP aggregate rules are strict | Include every non-aggregated selected field in `GROUP BY` | ABAP keyword docs
| `JOIN` (`INNER`/`LEFT OUTER`) | Supported | Works on the tested freestyle endpoint; historical failures attributed to JOINs were caused by `alias.field` dot notation | Keep the JOIN and use `alias~field` consistently | ABAP keyword docs + live verification on SAP_BASIS 758
| Subquery (`IN (SELECT ...)`) | Supported | Works on the tested freestyle endpoint | Keep as one SELECT; ARC-1 does not rewrite subqueries | ABAP keyword docs + live verification on SAP_BASIS 758
| Long literal `IN (...)` lists | Supported | Some backends mis-parse a long list as one text literal; messages vary (`Only one SELECT...` or `longer than 255 characters`) | ARC-1 chunks the longest literal list, including multi-`IN` filters, for plain SELECTs. Ordered/grouped/distinct/aggregate queries must be split manually to preserve semantics | Observed backend variance + ARC-1 implementation
| ABAP target clauses (`INTO`, `APPENDING`, `PACKAGE SIZE`) inside freestyle SQL text | Valid in ABAP programs but not expected in ADT SQL console query text | Common parser errors such as `"INTO" is invalid ...` | Remove target clauses; return set is handled by endpoint and `maxRows` | SAP KBA 3690844 preview + ADT SQL console behavior
| Multiple statements separated by `;` | Not supported by endpoint contract | Rejected with `Only one SELECT statement is allowed` | Submit exactly one statement per call | SAP KBA 3690844 preview + observed endpoint errors

## Practical Rules for Agents

1. Send exactly one SELECT statement per `SAPQuery` call.
2. Qualify fields with a tilde (`alias~field`), never a dot (`alias.field`).
3. Use `ASCENDING`/`DESCENDING`, not `ASC`/`DESC`.
4. Do not include ABAP target clauses (`INTO`, `APPENDING`, `PACKAGE SIZE`) in the query text.
5. JOINs, aggregates, and subqueries are valid; do not split a JOIN merely because a generic parser error appeared.
6. If a long literal `IN` list fails in an ordered or aggregate query, split that list manually and combine the results with the required global sort or reduction.
7. For table preview-like checks where query complexity is low, consider `SAPRead(type="TABLE_CONTENTS")` with `sqlFilter` condition expressions.

## Notes on Interpretation

- A parser failure at `/datapreview/freestyle` does not automatically mean the SQL construct is unsupported by ABAP SQL as a language.
- Conversely, language support does not guarantee acceptance by the ADT freestyle endpoint on every backend release.

## Sources

- SAP ABAP Keyword Documentation: Open SQL (`SELECT`, joins, strict mode)  
  - https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/abenabap_sql_strictmode_750.htm
  - https://help.sap.com/doc/abapdocu_752_index_htm/7.52/en-US/abapselect_join.htm
- SAP Developers tutorial (SQL Console usage patterns):  
  - https://developers.sap.com/tutorials/abap-display-data-queries.html
- SAP KBA preview (ADT SQL parser signatures):  
  - https://userapps.support.sap.com/sap/support/knowledge/en/3690844
- ARC-1 implementation references:
  - `src/adt/client.ts` (`runQuery` uses `/sap/bc/adt/datapreview/freestyle`)
  - `src/handlers/query.ts` (`handleSAPQuery`, `classifySapQueryParserError`, `planSimpleInListChunking`)
