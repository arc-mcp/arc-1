# Legacy data preview and SQL: availability before fallback

Investigation [#1067](https://github.com/arc-mcp/arc-1/issues/1067), following
[#996](https://github.com/arc-mcp/arc-1/issues/996).

## Decision

Do not add a core workaround for 740 SP04 preview or SQL. SAP documents data preview
from **740 SP05**, and SQL Console from **740 SP08**. The reported system predates both.
Keep backend errors explicit and ask for native evidence before treating an unexpected
failure on a supported release as a missing feature or ARC-1 defect.

Sources: [SAP backend configuration guide, authorization URI table](https://help.sap.com/doc/2e65ad9a26c84878b1413009f8ac07c3/202210.000/en-US/config_guide_system_backend_abap_development_tools.pdf#page=7),
[SAP-authored SQL Console introduction](https://community.sap.com/t5/application-development-and-automation-blog-posts/sql-console-in-aie/ba-p/13096113).
These prerequisites are not universal endpoint/version gates: backports, routing,
authorization and installed configuration still matter.

## Read-only controls, 22 October 2026

Native HTTP and public client calls used ARC-1 1.7.0 (`7b210cbf`), TLS and the configured
identity. Component metadata confirmed SAP_BASIS 750 SP02 and 758 SP02. No 740 system
was available. No objects, services, permissions or configuration were changed.

| Check | 750 SP02 | 758 SP02 |
|---|---|---|
| Discovery advertises `/datapreview/ddic` and `/freestyle` | Yes | Yes |
| POST freestyle, `rowNumber=1`, `SELECT COUNT(*) AS cnt FROM t000` | 404, `No suitable resource found` | 200, one result row |
| POST DDIC preview, `rowNumber=1&ddicEntityName=T000` | Same 404 | 200, two rows |
| Public `getTableContents('T000', 1)` | Not repeated after native 404 | Two rows: separate confirmed client bug #1068 |
| Public structured query / free SQL selecting `MANDT`, maxRows 1 | Not repeated after native 404 | One row each |

Table values are intentionally omitted from this note. Inspecting the 750 handler
`CL_ADT_DATAPREVIEW_RES_APP` confirmed registrations for the two routes and their query
parameters. This establishes that code and discovery entries exist; it does **not**
explain why that installation's effective route returns 404. The behavior was already
recorded in [integration skips](../integration-test-skips.md). We have no evidence that
enabling a guessed SICF child, changing MIME type or applying an unrelated KBA fixes it.

## What can be done now

- Fix the independently reproduced returned-row cap in [#1068](https://github.com/arc-mcp/arc-1/issues/1068).
  DDIC preview retrieves a lookahead row; cap the parsed result locally without changing
  the SAP request limit. Preserve response-memory budgets, identity and data gates.
- Retain tests for missing/empty-HTML responses, SQL line wrapping, syntax classification,
  byte limits and cancellation. They validate the client, not an absent SP04 backend.
- On the 750 installation, compare a successful native Eclipse preview request with the
  failing ARC-1 method/path/headers and inspect the effective ADT resource handler and
  SAP error log. A successful native baseline is the next decision point. If Eclipse
  also fails, the SAP owner must resolve the installation before a client fix is justified.

## Alternatives evaluated

| Alternative | Why it is not the proposed core fix |
|---|---|
| `TABLE_QUERY` structured parameters | Still uses `/datapreview/freestyle`; it cannot supply a missing endpoint |
| CDS preview | No verified substitute for arbitrary table/free SQL reads on SP04; requires its own native capability |
| Catalog/source APIs | Read definitions, not table data or arbitrary SELECT results |
| Broad release hard-block | Could reject a working backport; retain exact discovery/error evidence |
| Direct RFC, generated ABAP or installed helper | Outside core under [ADR-0009](../adr/0009-abap-execution-and-rfc-belong-in-extensions.md) |
| Operator GUI workflow | Human workaround where available, not an automatic MCP fallback or permission bypass |

Any later adapter needs a separate issue, a proven native contract, failing regression
tests and read-only native checks. It must preserve `allowDataPreview` versus
`allowFreeSQL`, source blocklists, per-user identity and bounded results. Do not mark
#996 resolved based on newer controls; #1063 tracks the reporter's SP04 confirmation.

Roadmap reviewed: no new feature is justified by this evidence. The concrete row-limit
bug is tracked separately; unresolved 750 routing needs installation evidence first.
