# SQL result counts and row limits (#1219)

## Reproduction and cause

Read-only T005 queries reproduced the report on SAP_BASIS 758 SP02 and 816 SP01,
client 001, using direct HTTPS Basic authentication on 12 November 2026.

| Query | Returned rows | SAP `totalRows` on 758 / 816 |
|---|---:|---:|
| `COUNT(*)` | 1 | 250 / 250 |
| `MAX(land1)` with `land1 LIKE 'B%'` | 1 | 20 / 20 |
| `DISTINCT xegld` | 2 | 250 / 2 |
| `COUNT(DISTINCT ...)` over a self-join | 1 | 250 / 1 |
| B/C country `UNION ALL`, `maxRows=5` | **40** | 0 / 0 |

Grouped counts report two groups correctly. Empty-input COUNT returns one padded
string value `0 ` with SAP count zero. An aggregate `HAVING` condition can return
no rows, so an aggregate result total cannot simply be forced to one.

The installed 758 `CL_ADT_DP_FREESTYLE_RES.POST` runs a separate rewritten count
query and substitutes zero on failure. `CL_ADT_DP_OPEN_SQL_HANDLER` replaces the
projection for that count and explicitly removes its generated `UP TO` clause
for UNION. SAP source was inspected locally and is not copied here.

ARC-1 forwards the count under an ambiguous name. Its single-statement path also
trusts SAP's row limit, whereas the multi-statement path already caps returned
rows. The native XML fixtures in `tests/fixtures/xml/query-1219-*.xml` capture
these 758 responses; they contain reference-table values only.

## Reviewed repair

- Slice single-query free-SQL results at the existing effective
  row cap. Preserve SQL, row order, duplicates, padding and authorization.
- Expose SAPQuery's optional raw count as `sapReportedTotalRows`, replacing
  `totalRows`. It is diagnostic metadata, not a result total or source-row count.
- Report `rowLimitReached` from the returned row count and effective cap. It means
  more rows may exist; false means fewer rows than the cap.
- Keep the existing byte budget before parsing. A small `maxRows` cannot guarantee
  bounded SAP work or a small transfer when SAP ignores its limit.

Avoid a second SQL parser, guessed totals, extra count queries or UNION rewriting.
Even an explicit ordered UNION with `UP TO 5 ROWS` was rejected by both tested
ADT parsers. The [ABAP UNION clause](https://help.sap.com/docs/abap-cloud/abap-keyword/ABAPUNION_CLAUSE.html)
and [HAVING rules](https://help.sap.com/docs/abap-cloud/abap-keywords/select-having)
describe language behavior, not a guarantee of ADT acceptance.

Claude Code Opus 5.5 Max approved this design. Review narrowed the slice to free
SQL: structured TABLE_QUERY readers must retain their fail-closed oversized-row
checks. It also required updating the performance skill and notebook guidance.
COUNT-only HAVING incorrectly returns a zero-valued row on both tested releases;
the fixture test preserves this SAP behavior and the user docs disclose it.

No roadmap impact: FEAT-32 concerns stable pagination, which this fix does not add.
The reporter's 7.57 system, BTP and principal propagation remain untested.

## Verification

The built stdio MCP server passed 13 cases on each system: aggregate/empty/HAVING,
DISTINCT, join, grouping, projection and UNION below/at/above the cap, including
duplicate rows. Regression fixtures exercise the same wire responses through the
public handler and direct free-SQL APIs. Byte-limit refusal still precedes parsing.
The available 750 SP02 freestyle endpoint was rechecked and returns 404; it is not
counted as SQL coverage. No SAP source or configuration was changed.
