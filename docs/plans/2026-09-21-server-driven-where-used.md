# Server-driven where-used routing — #809

## Root cause and correction

`SAPNavigate(references, type, name)` resolves an object URI before calling the where-used engine.
`objectBasePath()` has no server-driven cases, so its fallback treats them as programs. SAP returns
HTTP 200 with no references for that valid but wrong URI. Explicit `uri` navigation and
search-resolved `SAPContext` usages avoid this path.

`resolveWhereUsedUri` now uses the existing server-driven registry and encoded URL builder.
This keeps the fix local; changing generic routing also affects other tools that need separate
validation. The registry-derived dispatch tests cover every `SDO_TYPES` entry and a mixed-case
namespaced name, including argument normalization and the actual requested URI.

## Live evidence — 2026-09-21

SAP S/4HANA 2023, SAP_BASIS 758 SP02, client 001, Basic over HTTPS, read-only:

| Object | `/programs/programs/<name>` | `/ddic/dsfd/sources/<name>` |
|---|---|---|
| `CALENDAR_OPERATION` | 0 entries | 5 entries |
| `RATIO_OF` | 0 entries | 5 entries |

Neither lookup used the old-endpoint fallback. The built CLI's `SAPNavigate` handler returned
the same five entries for `CALENDAR_OPERATION`: one DSFI implementation, one SKTD documentation
node and three DEVC package nodes. They are reference entries, not five code callers.
The contributor's earlier 816 evidence is separate; this check used 758. No SAP objects changed
and no installed MCP client session was tested. The dispatch regressions failed with the original
resolver and passed with the fix.

On the same system, `SAPTransport(history, DSFD, CALENDAR_OPERATION)` still returned an empty
result with the program URI; `SAPDiagnose(syntax, DSFD, …)` reported a missing REPORT/PROGRAM
statement. Related generic-routing gaps remain in [ARCH-02](../../docs_page/roadmap.md#arch-02).
