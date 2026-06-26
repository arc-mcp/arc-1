# Plan — SAPQuery metrics + ABAP trace requests

**Status:** done — shipped, live-verified on a4h 758, passed Claude code-review + Codex review (2026-06-25)
**Evidence:** [docs/research/2026-06-25-abap-trace-requests-and-sapquery-metrics.md](../research/2026-06-25-abap-trace-requests-and-sapquery-metrics.md) (live-verified on a4h 758)
**Use case:** perf-debugging slow OData searches — give arc-1 (a) server-side query timing/row counts and
(b) the ability to *arm* an ABAP profiler trace (SQL capture on) so a reproduced OData call can then be read
via the existing `SAPDiagnose action=traces analysis=dbAccesses`.

## Scope

**Feature 2 — SAPQuery metrics (XS).** Surface `totalRows`, `queryExecutionTimeMs`, `executedQueryString`
that `datapreview/freestyle` already returns and arc-1 discards.

**Feature 1 — ABAP trace requests (S).** Three new `SAPDiagnose` actions: `trace_start` (arm), `trace_requests`
(list armed), `trace_cancel` (delete armed). Existing `traces` action (list/analyze recorded traces) unchanged.

### Non-goals (deliberately cut — ponytail)
- No standalone ST05 (no ADT REST resource — see dossier/FEAT-09).
- No "delete recorded trace result" action, no run-class-with-profiling, no HANA EXPLAIN, no gateway stats.
- No new metrics on `runTableQuery`/TABLE_QUERY (feature 2 is SAPQuery only).
- Don't expose all 13 trace parameters — only the few that matter; sane internal defaults for the rest.

## Feature 2 tasks

1. `src/adt/xml-parser.ts` — add `parseDataPreviewMeta(xml): { totalRows?: number; queryExecutionTimeMs?: number; executedQueryString?: string }`. Tolerant: fields absent → omitted. (`queryExecutionTime` is ms per Eclipse Data Preview.)
2. `src/adt/client.ts` — `runQuery()` returns `{ columns, rows, ...meta }` (additive optional fields; merge `parseDataPreviewMeta(resp.body)`). `runTableQuery`/`searchObject`/`runChunkedSapQuery` keep compiling (structural).
3. `src/handlers/query.ts` — include the metrics in the JSON output. Chunked long-IN-list path: sum `totalRows` and `queryExecutionTimeMs` across chunks; omit `executedQueryString` (multiple).
4. Unit tests: `parseDataPreviewMeta` (present/absent/partial), handler output includes metrics, chunked aggregation.

## Feature 1 tasks

1. `src/adt/types.ts` — `TracedProcessType`/`TracedObjectType` unions, `TRACE_PROCESS_TYPE_URIS`/`TRACE_OBJECT_TYPE_URIS`/`TRACE_PROCESS_OBJECTS` maps, `TraceRequest`, `TraceRequestCreateOptions`.
2. `src/adt/xml-parser.ts` — `parseTraceRequestFeed(xml): TraceRequest[]` (atom feed; id = `<atom:id>` text; pull `trc:extendedData` host/client/description/expires/processType/object/executions max+completed). Reused for both list + create responses.
3. `src/adt/diagnostics.ts`:
   - `createTraceRequest(http, safety, opts)` — `checkOperation(Update)`; POST `/parameters` (build XML, read `parametersId` from `Location`); POST `/requests?<qs>` (server/description/traceUser/traceClient/processType-uri/objectType-uri/expires-ISO/maximalExecutions/parametersId); return parsed `TraceRequest`. Validate processType→objectType via `TRACE_PROCESS_OBJECTS`; default objectType = first valid for the process type.
   - `listTraceRequests(http, safety, user)` — `checkOperation(Read)`; GET `/requests?user=UPPER` → `parseTraceRequestFeed`.
   - `deleteTraceRequest(http, safety, id)` — `checkOperation(Update)`; DELETE `/requests/{id}` (id verbatim, may contain `%2c`).
4. `src/handlers/diagnose.ts` — route `trace_start` / `trace_requests` / `trace_cancel`. Defaults: traceUser = connected user (`client` exposes it), processType `http`, maxExecutions 1, sqlTrace true, aggregate true, expiresHours 24.
5. `src/handlers/schemas.ts` — add the 3 actions to the enum; add fields `traceUser?`, `processType?` (enum any/http/dialog/batch/rfc), `objectType?` (enum), `maxExecutions?` (number), `expiresHours?` (number), `sqlTrace?`/`aggregate?` (**`looseOptionalBoolean`**, never coerce). `id` reused for `trace_cancel`.
6. `src/handlers/tools.ts` — add the 3 actions + new properties to the JSON schema; extend the `action` description block (what each does, the arm→reproduce→read loop). Three-file sync.
7. `src/authz/policy.ts` — `SAPDiagnose.trace_start` = write/Update, `SAPDiagnose.trace_cancel` = write/Update, `SAPDiagnose.trace_requests` = read/Read. (CI `validate:policy` enforces schema↔policy parity.)
8. Tests: parsers (real captured XML from dossier), client fns (mocked undici), handler routing, schema validation (incl. loose-boolean), and refresh tool-definition snapshot (`vitest -u` + review diff).

## Validation gate
`npm run lint && npm run typecheck && npm test && npm run validate:policy && npm run build && npm run check:sizes`,
then live on a4h via `arc1-cli call SAPDiagnose` (trace_start → trace_requests → trace_cancel) and `arc1-cli sql`
(metrics). Re-verify trace_start round-trip on 816 if cheap.

## Ponytail review (self)
- Reuse over new: feature 2 is pure parse-and-surface of bytes already fetched — no new request, no wall-clock
  timer (server time is better and free). ✅
- Smallest safe surface for feature 1: arm + list + cancel. List+cancel aren't gold-plating — they're the
  safety valve for a feature that writes *persistent* server state (otherwise stale armed requests silently
  trace future traffic). ✅
- Invariant by construction: 3 separate actions so scope (`read` vs `write`) rides the `ACTION_POLICY` key the
  dispatcher already uses — no per-mode special-casing. ✅
- Cut everything not needed for the OData loop (see Non-goals). ✅
