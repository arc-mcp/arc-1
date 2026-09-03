# Issue #737 — data-preview responses need a bounded memory budget

**Status:** Confirmed ARC-1 resource-safety bug on 2026-09-02; the recommended fix is implemented
and locally validated in draft PR #739. The affected path is present in ARC-1
1.1.0 and at the original research baseline `7969a9b2` (1.1.2). The failure mechanism was validated
with the real ADT data-preview contract on S/4HANA 2023 / SAP_BASIS 758, with local RSS
measurements through ARC-1's actual parser and MCP result shape, and against the shipped Cloud
Foundry configuration. Implementation validation used a disposable CF app only; it was deleted
afterward, and no SAP object, BTP service, destination, or existing deployed application was
changed.

## TL;DR

[Issue #737](https://github.com/arc-mcp/arc-1/issues/737) is valid and is not a duplicate. A row
limit and the existing `ARC1_MAX_CONCURRENT` semaphore do not bound ARC-1's memory exposure:

- raw `SAPQuery.maxRows` is not clamped, even though table preview and structured table query are;
- every SAP response is fully decoded by `response.text()` before its status or size is inspected;
- the BTP Connectivity proxy path first buffers `resp.body.text()`, constructs a new `Response`
  from that string, and then the common path calls `response.text()` again;
- the data-preview XML is expanded into a generic object graph and row objects;
- `SAPQuery` parses the same multi-megabyte XML twice, once for rows and once for metrics;
- the result is serialized into tool JSON, wrapped in JSON-RPC/SSE, and UTF-8 encoded again;
- the SAP-request semaphore releases before parsing and result serialization; and
- automatic IN-list chunking can accumulate several individually bounded responses into one tool
  result.

On the live 758 system, `SELECT * FROM TADIR` with `rowNumber=10000` returned **6,690,675 bytes**
and no `Content-Length`. Two such responses contain only 12.76 MiB of raw XML, but the local
end-to-end model peaked at **340.3 MiB RSS** from a **98 MiB** baseline. That is about **19x the
combined raw-body size** in incremental RSS. The reporter's two parallel wider BW results can
therefore credibly cross a 512 MiB instance limit. Cloud Foundry documents that an instance which
exceeds its memory limit is restarted and shows status 137 for an out-of-memory termination.

The recommended fix is a bundle:

1. Add an enabled-by-default **post-content-decoding response-body byte budget for the complete
   data-preview tool call**. The first guarded data operation should lazily create one request-level
   budget in the existing `AsyncLocalStorage` context and pass it explicitly to the transport.
   Nested hyperfocused dispatch must inherit the outer MCP call's scope. Start with **2 MiB per
   call**, including the sum of auto-chunked and internal data-preview responses, and make the
   ceiling operator-configurable. A representative TADIR-shaped 1 MiB result was already roughly
   190,000–202,000 tokens, so the 2 MiB value is a server-safety and compatibility ceiling, not a
   promise that every client can use a near-limit result.
2. Add a separate **process-wide data-result semaphore**, default **2**, acquired lazily by that
   same request context and held through fetch, parse, row construction, tool JSON construction,
   and terminal audit formatting. It must be shared by all principal-propagation and multi-target
   clients. Ordinary source/metadata reads should remain governed only by `ARC1_MAX_CONCURRENT`.
   The semaphore remains part of the issue-closing boundary: a byte cap does not establish a fixed
   XML-to-heap amplification ratio or aggregate process limit.
3. Parse rows and metrics from one XML parse, and clamp every raw/chunked `SAPQuery` to the existing
   10,000-row ARC-1 ceiling as a secondary rail.
4. In the same PR, replace the shipped fixed **448 MiB** CF old-space value with a fail-closed
   launcher that validates the buildpack-provided `MEMORY_AVAILABLE`, computes 75%, and `exec`s
   Node. That produces 384 MiB old-space at the shipped 512 MiB container size and 768 MiB after a
   1 GiB memory override while preserving direct SIGTERM delivery. Ship this only together with the
   response guard: lowering the 512 MiB deployment's old-space before bounding responses could
   merely reach a fatal V8 allocation failure sooner. Do not use Node's percentage flag without
   first raising ARC-1's runtime floor: it was added in Node 22.21, while ARC-1 currently permits
   Node 22.19. More CF memory remains a mitigation, not the correctness fix.

The locked configuration contract is
`ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES` / `--max-datapreview-response-bytes` with default `2097152`,
and `ARC1_MAX_CONCURRENT_DATA_RESULTS` / `--max-concurrent-data-results` with default `2`. Accept
positive decimal safe integers only and fail startup for malformed, fractional, unsafe, negative,
or zero values; the first release should not include a magic `0` disable. The defaults are
intentionally conservative starting points for the shipped 512 MiB topology. Together they admit
at most 4 MiB of successful response bodies into the guarded phase before parsing amplification;
this is a sizing starting point, not a process-memory proof. The 2 MiB allowance leaves the
existing default 100-row preview usable with margin on representative wide table shapes;
concurrency 2 keeps the nominal admitted-body envelope at 4 MiB. They are behavior changes: a
previously successful bulk query can now be clamped or rejected, even if its result was impractical
for an LLM client. The release notes and upgrade guidance must say so, and the defaults must be
confirmed with the regression matrix below before implementation is merged.

## Implementation record in PR #739

The draft PR now implements the approved design as reviewable commits:

- `f742eafd` parses rows and metrics once, clamps raw and chunked freestyle queries at the required
  sink, and reports the requested/effective limits when the caller asked for more than 10,000 rows;
- `e506205e` adds strict configuration, the request-owned cumulative budget, the shared two-slot
  data-result semaphore, direct and BTP bounded streams, cancellation/teardown, stable errors, and
  safe audit events;
- `d28f0bad` removes the fixed 448 MiB value, enables `OPTIMIZE_MEMORY`, and logs the non-secret
  runtime memory envelope;
- `407e6dd9` refreshes the already-red audited transitive dependencies to patched lockfile versions;
  and
- `4d4a5cc0` extracts the bounded transport, table-query, and runtime-memory helpers so every source
  file remains within the existing CI size ratchets without increasing any budget; and
- `7cb2154e` replaces the BTP proxy's `Readable.toWeb()` cancellation path after a live CF soak
  reproduced an uncaught late-data race, adds the regression test, closes the pending-admission
  semaphore edge case, restores compressed SAPQuery guidance, and documents Docker sizing.

The MTA build succeeds with a tracked `exec ./bin/start-cf.sh` module command. The launcher validates
the buildpack-provided decimal-MiB value, applies the same 75% calculation, and fails closed if the
input is absent or malformed. Disposable live apps using Cloud Foundry Node.js buildpack 1.9.3
produced 384 MiB old-space at 512 MiB and 768 MiB at 1 GiB. A live restart and a memory-scale
restart both delivered SIGTERM to ARC-1's shutdown hook and exited Node with status 0 before the
replacement became healthy. This validates both adaptive heap mechanics and process ownership
without altering an existing ARC-1 deployment.

A read-only SAP_BASIS 758 acceptance run first used a deliberately lower 64 KiB ceiling: three
parallel 10,000-row narrowed TADIR queries all returned `AdtResponseLimitError`, observed
data-result concurrency was exactly two, all slots/waiters were released, incremental peak RSS was
12 MiB, and a subsequent five-row T000 query plus ordinary system read both succeeded. The same
test was then repeated at the shipped 2 MiB ceiling with `SELECT * FROM TADIR`: all three calls were
bounded, concurrency remained exactly two, all slots/waiters were released, subsequent data and
system reads succeeded, and incremental peak RSS was 25 MiB. No SAP state was changed.

The final local regression pass is green:

```text
npm test: 186 files, 5,449 tests passed
npm run lint: passed (two pre-existing Biome migration notices)
npm run typecheck: passed
npm run check:sizes: passed (all 428 tracked source/test files and every tool-schema budget)
npm run build: passed
npm audit --audit-level=high --omit=optional: 0 vulnerabilities
npm audit --prefix btp/approuter --audit-level=high --omit=optional: 0 vulnerabilities
btp/approuter npm ci && npm test: 3 tests passed
npm run btp:validate: passed for the base and documented extension combinations
npm run btp:build: passed
npm run docs:build: passed in strict mode
```

The direct and BTP Connectivity transports have deterministic unit coverage for response
boundaries, cancellation, retry charging, identity encoding, headers, and proxy-client teardown.
The branch was also deployed through a disposable Basic-auth Destination → Connectivity → Cloud
Connector → SAP route. Three waves of six concurrent 3,200-row TADIR requests returned bounded
errors under the two-slot semaphore, recovery queries succeeded, and the same process remained
healthy after each delayed-crash observation window. This is the real proxy transport branch, but
not a principal-propagation identity acceptance test.

## Reported impact and scope

The external report is for ARC-1 1.1.0 on Cloud Foundry with one 512 MiB instance,
`http-streamable`, XSUAA principal propagation, and both data preview and free SQL enabled. Two
parallel `SAPQuery` calls returned several megabytes each from BW tables. Cloud Foundry terminated
the instance twice within 31 seconds with `Exited with status 137 (out of memory)`. Every in-flight
MCP request on the instance was lost; sequential retries fit after the operator raised the instance
to 1 GiB. That change reduced total-RSS pressure, but the fixed start command left V8 old-space at
448 MiB.

The same mechanism affects:

- `SAPQuery` freestyle SQL, including the auto-chunked IN-list path;
- `SAPRead(type="TABLE_CONTENTS")` through `/datapreview/ddic`;
- `SAPRead(type="TABLE_QUERY")` and internal consumers of `runTableQuery()` through
  `/datapreview/freestyle`; and
- single-target, per-user principal-propagation, pinned multi-target, and aggregate multi-target
  routes, because all allocate in the same Node process.

This is release-neutral ARC-1 behavior after a successful ADT response. SAP releases can emit the
older ASX or newer data-preview XML shape, but both are fully buffered by the same client and
expanded by the same parser.

## Current implementation and root cause

### 1. The body is unbounded before ARC-1 can reject it

`src/adt/http.ts` calls `response.text()` at the initial fetch and in every retry branch. At the
researched HEAD those consumers are at lines 475, 520, 565, 609, 677, 713, and 788.
`response.text()` produces a complete UTF-8 string. Undici also exposes `Response.body` as a
`ReadableStream`, so ARC-1 can count chunks and cancel before the complete body is materialized.
See the official
[Undici Fetch documentation](https://github.com/nodejs/undici/blob/main/docs/docs/api/Fetch.md#bodytext)
and Node's
[Web Streams API](https://nodejs.org/api/webstreams.html#readablestreamgetreaderoptions).

The exact topology reported in #737 has an earlier BTP-specific exposure. When `btpProxy` is
configured, `doProxyRequest()` uses `undici.Client`, calls `resp.body.text()` at line 1393, builds
a new Fetch `Response` from the complete string, and returns it to the common path, which calls
`response.text()` again. A cap around only the currently returned `Response` would therefore be
too late for the first proxy allocation. The proxy adapter must instead expose its live
`BodyReadable` as a Web `ReadableStream`, after which the same transport-level wrapper can cap both
direct and proxy responses before any caller receives them.

A `Content-Length` check is useful only as a fast rejection when content encoding is absent or
identity. It cannot be the guard: the live 758 data-preview responses had no `Content-Length`, and
streamed/compressed responses need the actual post-content-decoding body chunks counted. A header
may reject early but must never authorize an otherwise unbounded read.

### 2. The row cap is incomplete and cannot represent a byte budget

`src/adt/client.ts` defines `MAX_TABLE_QUERY_ROWS = 10_000` and describes it as a memory-safety
rail. `getTableContents()` and `runTableQuery()` use `clampPreviewRows()`. The raw freestyle path
does not: `postFreestyleQuery()` interpolates the supplied `maxRows` verbatim, and
`handleSAPQuery()` accepts any coerced number. The tool schema likewise describes a default of 100
without a maximum.

This is an omission from the earlier hardening in
[PR #388](https://github.com/arc-mcp/arc-1/pull/388). That PR correctly clamped table contents,
search, and dependency results, but its statement that unbounded `maxRows` was fixed did not cover
raw `SAPQuery`. Issue #737 is therefore the same defect class, not a duplicate report.

Clamping raw `SAPQuery` to 10,000 is necessary but insufficient. Row width, selected columns,
string lengths, and XML element count determine bytes and heap expansion. SAP's UI limits are also
not a stable server contract: SAP's
[7.52 Data Preview documentation](https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_752/c238d694b825421f940829321ffa326a/2fd1241b187b4d6c989e1ff8b1f00ba1.html?locale=en-US&version=7.52.10)
states a maximum of 5,000 rows, while the current
[ABAP Platform 2025 documentation](https://help.sap.com/docs/ABAP_PLATFORM_NEW/c238d694b825421f940829321ffa326a/4ecc105a6e391014adc9fffe4e204223.html?locale=en-US&state=PRODUCTION&version=202510.001)
states 100,000. A server-side byte budget is required regardless of the chosen ARC-1 row ceiling.

### 3. One response becomes several simultaneous representations

`parseTableContents()` in `src/adt/xml-parser.ts`:

1. parses the complete string with `fast-xml-parser`;
2. retains a generic parsed object;
3. copies each column's values into `colData`; and
4. pivots those arrays into a new array of row objects with repeated property keys.

`runQueryWithMetrics()` then calls `parseTableContents(body)` and `parseDataPreviewMeta(body)`.
The latter invokes the full XML parser again. `handleSAPQuery()` serializes the rows with
`JSON.stringify`; `dispatch.ts` joins the result content for audit sizing/preview; and the MCP SDK's
HTTP transport wraps the text inside a JSON-RPC message and enqueues `TextEncoder.encode()` of the
whole SSE event. The SDK behavior was verified in the installed 1.30.0 source at
`node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js:422`.

The result is not a memory leak: most allocations eventually become collectible. It is a high,
concurrency-sensitive transient peak, which is sufficient for a cgroup termination.

### 4. The existing semaphore protects SAP work processes, not result memory

`ARC1_MAX_CONCURRENT` is a process-wide count of active SAP HTTP requests. In
`src/adt/http.ts:304`, its slot encloses `requestInner()`, which returns only after
`response.text()`, but parsing and MCP serialization occur after the slot is released. It has no
byte accounting and no data-specific admission rule. Lowering it helps operationally, especially
because the JavaScript parser itself runs synchronously, but it is neither a deterministic byte
bound nor a narrow long-term control.

The dedicated data semaphore should be acquired lazily by the first guarded client method and
released by the outer dispatch after `toolJson()` and terminal audit work. The MCP SDK's final
JSON-RPC/SSE encoding happens after the handler returns and is harder to include without changing
the transport contract; the benchmark shows that covering fetch, parse, and tool JSON captures the
dominant peak. The streaming byte cap remains the hard individual-call boundary.

### 5. Auto-chunking is a per-response-cap bypass unless the budget is request-scoped

`runChunkedSapQuery()` executes multiple statements sequentially and appends every chunk's rows to
one array. Any per-response limit would still permit several individually sub-limit chunks to
produce one much larger tool result. The budget object must therefore belong to the outer tool
call. Each data-preview read consumes from the same remaining post-content-decoding byte allowance,
and a later chunk fails or stops before the cumulative allowance is crossed.

The byte budget is not a truncation mechanism. If a later chunk would cross it, the complete tool
call fails and discards the partial aggregate. Separately, when `SAPQuery.maxRows` is reduced to the
10,000-row safety ceiling, the result must report `rowLimitClamped: true`, `requestedRows`, and
`effectiveMaxRows: 10000`. Those fields disclose the changed execution limit without claiming that
SAP definitely had more matching rows. Do not set `truncated: true` merely because the requested
limit was clamped.

### 6. Data-preview work is not confined to the two obvious handlers

Wrapping only `SAPQuery` and `SAPRead` would miss existing internal consumers. Database-backed
`SAPSearch.tadir_lookup`, `SAPNavigate.hierarchy`, where-used interface augmentation, and
`SAPDiagnose.authorization_trace` all reach `runQuery()`, `getTableContents()`, or
`runTableQuery()`. Several of those paths make more than one data request, and future handlers can
do the same. Giving every client method an independent budget would avoid an unbounded response but
would lose cumulative accounting and could acquire the same semaphore more than once inside one
tool call.

ARC-1 already has a per-tool-call `AsyncLocalStorage` context in `src/server/context.ts`. The safe
ownership boundary is one lazily initialized data-result context in that store. The first guarded
client method acquires the data slot and creates the budget; every later guarded method in the same
tool call reuses both. The outer dispatch releases the slot in `finally`, after result construction
and terminal audit formatting. This structurally covers current and future handler call paths
without a handler allowlist. Public `AdtClient` use outside an MCP request still needs a fallback
per-operation context so library callers do not silently receive an unbounded response.

Hyperfocused mode is a nested-dispatch exception: its `SAP` registry entry recursively calls
`handleToolCall()` for the expanded tool. That inner call must inherit the outer context's mutable
data-result scope and MCP signal instead of creating a second budget or lease. Only the outermost
owner releases the shared lease, after the outer tool's result/audit work. This preserves one
admission unit per actual MCP call and prevents early release or double release.

The current POST path also forwards its `AdtRequestOptions` to `fetchCsrfToken()`. A data response
budget must not follow that call into the discovery HEAD/GET: the fallback GET may have a body, is
not data-preview output, and could consume or trip the wrong allowance. Add a narrow
`withoutResponseBudget(options)` helper for CSRF bootstrap and preserve its signal, deadline,
fetch timeout, and other request controls.

`SAPRead.TABLE_CONTENTS` and `TABLE_QUERY` bypass the source/ETag caching layer, as do the freestyle
query methods. The budget therefore accounts only for live SAP response streams; there is no cached
data-preview body to charge, replay, or invalidate in this implementation.

### 7. MCP cancellation exists but is not yet connected to this work

The MCP SDK supplies `RequestHandlerExtra.signal` to the registered tool handler. `server.ts`
currently receives that `extra` object but does not pass its signal into `handleToolCall()`, whose
request context has no cancellation field. Queueing a data call without this signal can leave a
cancelled caller waiting for a slot, and starting HTTP work without it wastes SAP and proxy
resources after the MCP request is gone.

Pass `extra.signal` into `handleToolCall()`, store it in the request context, and use it for the lazy
data-semaphore acquisition and every guarded direct/proxy request. Cancellation must remove a
queued waiter without leaking a slot and cancel or destroy an active response stream and its proxy
client. This change is scoped to the guarded data path; broad cancellation plumbing for every
existing ADT operation is useful but not required to close #737.

### 8. The plugin facade has a separate data-method omission

FEAT-61 plugins cannot issue a raw data-preview POST through `ctx.http`: `createSafeHttpClient()`
rejects every POST to `/sap/bc/adt/...`, and the read-only client facade hides
`getTableContents()`, `runQuery()`, and `runTableQuery()`. Therefore generic plugin HTTP access is
not a bypass for this data-preview budget. The client-layer design also means every invocation of a
guarded high-level data method is bounded regardless of which handler called it.

However, `runQueryWithMetrics()` is missing from both the static `ReadOnlyAdtClient` omit list and
the runtime blocked-key set. That is an existing experimental-plugin scope-surface inconsistency,
not a reason to broaden #737 into a universal response cap. Track and fix it separately by updating
`src/public/types.ts`, `src/server/safe-http-client.ts`, and their focused tests. Generic plugin GET
responses and other non-data ADT reads remain subject to the existing general transport behavior;
a universal response-size policy would need separate compatibility research.

## Contract and reference implementation research

The verified ADT wire contract is:

- `POST /sap/bc/adt/datapreview/ddic?rowNumber={n}&ddicEntityName={name}` with an optional
  `text/plain` filter body; and
- `POST /sap/bc/adt/datapreview/freestyle?rowNumber={n}` with an ABAP SQL `text/plain` body.

The endpoints and request shapes agree across ARC-1's ADT inventory, the locally inspected Eclipse
ADT bundle inventory, and live SAP_BASIS 758 behavior. No ADT response pagination cursor or offset
contract was found. `maxRows` truncates the first result set; it is not paging. For subsequent
pages, callers need an explicit key-range predicate in the SQL. The over-limit message should
therefore say “lower `maxRows`, select fewer columns, or add a restrictive/key-range `WHERE`,” not
promise generic pagination.

The surveyed reference server
[`fr0ster/mcp-abap-adt`](https://github.com/fr0ster/mcp-abap-adt/blob/c6b69c42636d0532b9efa4f2e780d94ca62a780b/src/handlers/system/readonly/handleGetSqlQuery.ts)
also accepts an unbounded `row_number`, receives the complete XML string, builds column arrays and
row objects, and pretty-serializes the complete result. It confirms the endpoint and response
model, but it is not a safe implementation precedent.

No relevant SAP Note was found. This is an ARC-1 client-side resource budget problem, not evidence
of a faulty SAP data-preview response or a release correction requirement.

## Live and local validation

### Live SAP_BASIS 758 response growth

Read-only POSTs were made to the real freestyle endpoint on the A4H S/4HANA 2023 system with the
same query and increasing `rowNumber`. Only byte counts and structural counts were retained; no
table data or credentials are recorded here.

| Requested `rowNumber` | HTTP status | Raw XML bytes |
|---:|---:|---:|
| 100 | 200 | 73,382 |
| 1,000 | 200 | 678,035 |
| 5,000 | 200 | 3,351,802 |
| 10,000 | 200 | 6,690,675 |

The 10,000-row request was accepted by this release even though historical Eclipse UI
documentation used a lower maximum. None of these responses supplied `Content-Length`, directly
disproving a header-only solution for the available live contract.

### ARC-1 memory amplification

The repository was built on Node 22.21.1. A disposable local harness used the built `AdtClient`,
the real `parseTableContents()` / `parseDataPreviewMeta()` functions, the real `handleSAPQuery()`,
and the installed MCP SDK's equivalent JSON-RPC/SSE serialization. Each case ran in a fresh
process and retained its final values so garbage collection could not hide the relevant live set.
Maximum RSS came from `/usr/bin/time -l`.

This harness used the direct HTTPS transport, not `doProxyRequest()`. The measurements therefore
exclude the BTP proxy's initial `resp.body.text()` → new `Response` conversion and are a
conservative model of the reporter's Cloud Connector/principal-propagation topology.

| Stage | Concurrency | Raw body total | Maximum RSS | Increase over ~98 MiB baseline |
|---|---:|---:|---:|---:|
| `response.text()` only | 1 | 6.38 MiB | 124.1 MiB | 26.1 MiB |
| `response.text()` only | 2 | 12.76 MiB | 153.1 MiB | 55.1 MiB |
| one XML parse + rows | 1 | 6.38 MiB | 218.7 MiB | 120.7 MiB |
| one XML parse + rows | 2 | 12.76 MiB | 290.6 MiB | 192.6 MiB |
| current two parses | 1 | 6.38 MiB | 270.6 MiB | 172.6 MiB |
| current two parses | 2 | 12.76 MiB | 329.0 MiB | 231.0 MiB |
| handler + JSON-RPC/SSE wire | 1 | 6.38 MiB | 282.2 MiB | 184.2 MiB |
| handler + JSON-RPC/SSE wire | 2 | 12.76 MiB | **340.3 MiB** | **242.3 MiB** |

For one response, parsing once rather than twice reduced the measured peak from 270.6 MiB to
218.7 MiB, about 52 MiB in this fixture. It is a worthwhile optimization, but the remaining peak
proves that it is not the resource boundary.

The final compact tool JSON was 3,620,678 bytes and its SSE event was 4,500,832 bytes for a
6,690,675-byte SAP response. Running the two-response case with a deliberately small 64 MiB V8
old-space limit ended in a fatal allocation failure (exit 134). That is not the reporter's exact CF
137 path, but it independently validates that this allocation chain can terminate a process. The
shared live CF application was deliberately not crashed to reproduce 137.

### Reporter-side wide-table evidence

The issue reporter supplied
[follow-up evidence](https://github.com/arc-mcp/arc-1/issues/737#issuecomment-5516264336) from a
customer ERP QA system reached through the same Cloud Foundry, BTP Connectivity, Cloud Connector,
and principal-propagation topology as the incident. The directly observed metric was ARC-1's
`tool_call_end.resultSize` for
`SAPRead(type="TABLE_QUERY", maxRows=5)`. The current audit implementation computes that metric as
JavaScript string `.length` after XML parsing and compact JSON serialization. It is therefore tool
result **UTF-16 code units**, not UTF-8 transfer bytes, raw SAP XML bytes, proxy-buffer bytes, or
peak memory. Mostly ASCII table data makes code units numerically close to compact JSON bytes, but
the units must not be conflated.

Separate the direct observations from the derived sizing:

| Table | Columns | Direct observation | Derived sizing |
|---|---:|---|---|
| TADIR | 22 | 5-row tool result; about 430 code units per returned row when the complete result is divided by 5 | Applying the earlier large-result XML/JSON ratio gives about 0.8 KiB raw XML per row |
| MARA, including customer appends | 264 | 5-row tool result; about 4,556 code units per returned row by the same calculation | Roughly 0.8 MiB raw XML for 100 rows; the 1 MiB boundary is estimated around 100–125 rows |
| BSEG | 331 | No completed body: two end-to-end attempts timed out after 120 seconds, including attempts with `BUKRS` and `GJAHR` predicates | A per-cell extrapolation from MARA suggests 100 rows could approach 1 MiB; no BSEG response size was measured |

These calls travelled through the BTP/PP path, but `resultSize` is produced after the transport and
does not validate proxy double-buffering or its RSS cost. The BSEG observation likewise proves an
end-to-end timeout without a completed result; it does not identify whether time was spent in the
database, SAP response generation, the proxy, or transfer, nor whether partial network bytes had
arrived. A selective, index-aligned predicate is the main query-side mitigation. `maxRows` bounds
the returned rows but does not prove that SAP can avoid an expensive scan. The response-byte guard
cannot shorten work performed before a usable body is available, while the data-result semaphore
still limits how many such slow operations ARC-1 admits concurrently.

The five-row extrapolation also includes fixed JSON wrapper and `columns` costs. If a result has
fixed cost `F` and per-row cost `R`, dividing a five-row result by five yields `R + F/5`; scaling
that value to 100 rows counts the fixed cost twenty times. The approximately 1.85 raw-XML/tool-JSON
ratio measured on the earlier large TADIR result is also not stable for very small responses whose
XML metadata dominates.

A focused, content-free validation through the direct transport on the live 758 test system
demonstrates the effect. The same 22-column `TADIR` query was executed at three row limits,
recording only sizes and counts; no table values were logged or retained:

| Returned rows | Raw XML UTF-8 bytes | Compact tool JSON UTF-8 bytes | Raw-XML/tool-JSON ratio |
|---:|---:|---:|---:|
| 5 | 9,994 | 2,059 | 4.85 |
| 100 | 73,381 | 36,279 | 2.02 |
| 1,000 | 678,035 | 364,631 | 1.86 |

Scaling that five-row tool result directly to 100 rows predicts 41,180 code units, while the
observed 100-row result was 36,279, about 13.5% lower. The reporter's evidence therefore establishes
that a 1 MiB default has little compatibility margin for wide tables, but it does not establish
exact rejection rows. Use the MARA/BSEG figures as directional sizing inputs and confirm raw body
bytes, peak RSS, and proxy lifecycle on the offered development BW route before release.

### Consumer-side budget sizing

The server limit should also avoid spending substantial SAP, parser, transport, and model context
capacity on a result that its primary MCP consumers cannot use. Raw XML bytes do not map at a
fixed ratio to either compact JSON bytes or model tokens, so this is a sizing input rather than the
runtime enforcement unit.

A generated TADIR-shaped fixture used the same ten-column XML structure, ARC-1 pivot/result shape,
and compact JSON serialization as the measured path. Token counts from `gpt-tokenizer` 4.0.0 and
`@dqbd/tiktoken` 1.0.22 implementations of `o200k_base` and `cl100k_base` agreed exactly:

| Raw XML | Tool JSON | `o200k_base` tokens | `cl100k_base` tokens |
|---:|---:|---:|---:|
| 523,833 B (~0.5 MiB) | 302,750 B | 95,413 | 100,916 |
| 1,048,452 B (~1 MiB) | 607,011 B | 191,302 | 202,337 |
| 4,189,901 B (~4 MiB) | 2,428,941 B | 765,486 | 809,647 |
| 5,692,062 B (~5.43 MiB) | 3,300,142 B | 1,040,046 | 1,100,047 |

Consumer sizing alone would support a 1 MiB ceiling: the representative result already consumes
about an entire 200,000-token context before instructions, history, schemas, or the model's answer,
and a roughly 0.5 MiB response was still about 96,000–101,000 tokens. The reporter's wide-table
evidence adds a different constraint: 1 MiB can sit directly against ARC-1's ordinary 100-row
default. Use **2 MiB** as the server-safety and compatibility ceiling, while documenting that
normal agent requests should remain substantially smaller. The higher ceiling is not a statement
that a near-limit result fits a particular MCP client's usable context.

Nor is any fixed claim that multi-megabyte results fit “no model” durable. Current OpenAI models
advertise a 1.05M context window, and current Gemini documentation describes 1M-token models; see
the [OpenAI model catalog](https://platform.openai.com/docs/models) and
[Gemini long-context documentation](https://ai.google.dev/gemini-api/docs/long-context). Even
where a payload technically fits, using most of a context window for raw rows is expensive and
leaves too little working context. ARC-1 should therefore keep the byte budget independent of a
specific vendor tokenizer or model generation.

A second focused harness retained ten distinct ~1 MiB response bodies, ARC-1's current two-parse
results, compact tool results, and SSE-equivalent byte arrays. It peaked at 202.5 MiB RSS from a
49.3 MiB focused-process baseline (153.2 MiB incremental). Adding the separately measured full
server baseline still places this representative case below 512 MiB. This supports a 4 MiB raw
admission envelope as a plausible starting point, but it does **not** prove that `1 MiB × 4` and
`2 MiB × 2` have identical peak memory: the harness was synthetic, direct-transport-only, and
cannot establish a maximum amplification factor for every column/value shape or individual-call
temporary allocation. Lock the compatibility-oriented default at 2 MiB with concurrency 2, keep
the semaphore mandatory, and gate release on the two-response 2 MiB regression below.

### Transport-wrapper feasibility checks

A focused prototype against the installed Undici 8.10.0 validated the smaller transport design.
Wrapping `Response.body` in a bounded Web stream preserved a 206 status and status text, an ETag,
and two distinct `Set-Cookie` headers; a 304 retained its null body; and a body crossing the cap
rejected at `.text()` before a complete string was returned. The per-request proxy-client teardown
is idempotent because both source errors and consumer cancellation can reach it.

The first implementation adapted Undici's proxy `BodyReadable` through `Readable.toWeb()`. A real
BTP Connectivity soak found a cancellation race that the initial simple fixture missed: all six
over-limit calls returned the correct tool error, but queued body data later reached the already
closed web-stream controller, raised uncaught `ERR_INVALID_STATE`, and exited the process with
status 1. A focused late-data reproducer then triggered the old adapter 20/20 times. The corrected
adapter consumes the Node readable through its async iterator, owns body/client teardown directly,
and has no Node-to-Web controller for late source data to reach; the reproducer is 0/20 and three
live waves of six over-limit BTP calls left the same CF process healthy.

The prototype also showed why the BTP conversion must not become globally streaming in the first
fix. With an unread 16 MiB response, the source stream, Web response body, and per-request Client
were all still open after 100 ms and remained so until cancellation. Most normal `doFetch()` callers
read their body, but the CSRF HEAD/GET path can legitimately inspect headers without reading it.
Keep the existing buffer-and-close behavior for non-budgeted proxy calls; use the live stream only
when an explicit data response budget is attached. For 204/205/304, consume or destroy the Undici
body, close the client, and return `Response(null, ...)`: constructing a Fetch `Response` with a
non-null stream for one of these statuses throws a `TypeError`.

The same prototype exposed a compression distinction that the implementation must not hide. For
a 100,000-byte uncompressed body served as 133 bytes of gzip, `undici.fetch()` exposed 100,000 body
bytes while `Client.request()` exposed the 133 compressed bytes. Therefore the BTP adapter must
either stream-decompress before applying the shared cap, or request `Accept-Encoding: identity`
and reject an unexpected non-identity `Content-Encoding`; counting compressed proxy bytes would
create a large expansion bypass. This agrees with Undici's requirement that every Client response
body be consumed or destroyed and that `Client.close()` waits for enqueued requests to complete;
see the official [Dispatcher documentation](https://github.com/nodejs/undici/blob/main/docs/docs/api/Dispatcher.md#dispatcherclosecallback).
The Node stream is deliberately not bridged with `Readable.toWeb()` on this cancellation-sensitive
path; API stability does not remove the late-event race between the adapter and client destruction.

### Cloud Foundry sizing

The shipped `mta.yaml` allocates 512 MiB and starts Node with
`--max-old-space-size=448`, described as leaving 64 MiB headroom. A read-only CF inspection showed
the available test instance at the same 512 MiB size and about 100–108 MiB RSS while idle; the CF
V3 process record confirmed that its effective start command remained the fixed 448 MiB command.
The issue reporter observed the configuration drift tracked by
[#741](https://github.com/arc-mcp/arc-1/issues/741): after the affected production BW instance was
raised to 1 GiB through an `.mtaext` `parameters.memory` override, its old-space flag remained 448
MiB. The added container memory still benefited young-generation heap, external buffers, native
allocations, transport, and other process overhead, so it was not "wasted"; it did not, however,
increase V8's old-space ceiling.

Node documents that `--max-old-space-size` limits only V8's old-memory section and explicitly
recommends leaving memory for other uses. See
[Node's CLI documentation](https://nodejs.org/download/release/v22.19.0/docs/api/cli.html#--max-old-space-sizesize-in-mib).
The Node buildpack used by the inspected BTP deployment was 1.9.2. Its supported optional memory
optimization, like current upstream, sets `NODE_OPTIONS=--max_old_space_size=75%` of the
buildpack-provided `MEMORY_AVAILABLE` for its **default** `npm start` process. Its integration test
verifies 1,024 MiB available memory produces a 768 MiB flag. See its
[`bin/release`](https://github.com/cloudfoundry/nodejs-buildpack/blob/v1.9.2/bin/release) and
[`memory_test.go`](https://github.com/cloudfoundry/nodejs-buildpack/blob/v1.9.2/src/nodejs/integration/memory_test.go).
The initial implementation removed the custom MTA command and used that default process. Live
`cf restart` validation then showed that SIGTERM stopped at the npm process: ARC-1's shutdown hook
did not run. The final design keeps `OPTIMIZE_MEMORY: "true"` but uses the tracked
`exec ./bin/start-cf.sh` command. The launcher validates `MEMORY_AVAILABLE`, calculates the same 75%
old-space value, and `exec`s Node directly. It therefore follows durable MTA memory overrides while
restoring signal delivery and failing closed instead of evaluating an empty shell expression.

This 75% choice leaves a more realistic allowance for young-generation heap, external buffers,
native libraries, HTTP buffers, and platform process overhead. The existing claim that 448 MiB
leaves 64 MiB total-process headroom is invalid because the flag controls old space, not total V8
or process memory.

Node added `--max-old-space-size-percentage` in 22.21.0, but ARC-1's `package.json` permits
Node >=22.19. Using the percentage flag in `mta.yaml` without also raising the runtime floor can
therefore make an otherwise supported deployment fail at process startup. The implementation also
falls back from `uv_get_constrained_memory()` to total host memory when the constrained value is
unavailable; that is a code-path risk, not an observed failure on the target Diego environment.
Neither risk is justified when the CF launcher can use the buildpack-provided decimal-MiB input
with the existing old-space flag. See the
[Node 22.21.0 release notes](https://nodejs.org/en/blog/release/v22.21.0) and the
[percentage implementation](https://github.com/nodejs/node/blob/v22.21.1/src/node_options.cc#L2381-L2435).

Cloud Foundry exposes `MEMORY_LIMIT` as the maximum each application instance can consume and
restarts an instance which crosses it. See the
[environment-variable documentation](https://docs.cloudfoundry.org/devguide/deploy-apps/environment-variable.html#MEMORY_LIMIT)
and the [status-137 log example](https://docs.cloudfoundry.org/devguide/deploy-apps/streaming-logs.html#proxy).

The implementation publishes a conservative operator planning model and example combinations from
512 MiB through 4 GiB in the canonical
[BTP data-preview RAM sizing guide](../../../docs_page/btp-administration.md#data-preview-ram-sizing).
It treats the byte allowance and concurrent-data-result limit as one per-process raw admission
envelope, uses the measured amplification only as a planning input rather than a guarantee, and
requires a representative full-concurrency peak-RSS test before reducing the starting allocation.

Node 22's `process.constrainedMemory()` and `process.availableMemory()` could improve startup and
audit diagnostics. Both are stable in Node >=22.16, but available memory is inherently racy under
parallel requests. Log the non-secret CF memory inputs and effective V8 heap limit at startup so a
stale command or unexpected buildpack result is visible, but do not use a live available-memory
snapshot as an admission decision. If an MTA deployment cannot reliably clear the custom command,
the fallback is a small startup wrapper that strictly accepts the documented positive whole-memory
format, computes 75%, fails closed for missing/malformed input, logs the result, and `exec`s Node.
Do not ship the unvalidated `M=${MEMORY_LIMIT%M}` one-liner: absent input becomes a zero flag and
malformed units fail through incidental shell arithmetic rather than a deliberate diagnostic. See the
[Node process documentation](https://nodejs.org/download/release/v22.21.1/docs/api/process.html#processavailablememory).

### Existing regression suite

Before any fix, the focused current-HEAD suite passed:

```text
tests/unit/adt/http.test.ts
tests/unit/adt/table-query.test.ts
tests/unit/adt/client.test.ts
tests/unit/handlers/dispatch-misc.test.ts
tests/unit/server/config.test.ts

5 files, 756 tests passed
```

This confirms the report is an uncovered limit case, not an already-failing implementation test.

## Options evaluated

| Option | Prevents one oversized call | Prevents parallel aggregate peak | Compatibility / cost | Verdict |
|---|---|---|---|---|
| Raise CF memory to 1–2 GiB | No; moves the threshold | No | Immediate and operationally simple, but costs quota | Keep as mitigation only |
| Set `ARC1_MAX_CONCURRENT=1` | No | Helps, but releases before parse and serializes unrelated ADT work | Available today; throughput cost | Temporary workaround |
| Clamp every `maxRows` to 10,000 | No; wide rows still win | No | Small, consistent with existing table rails | Required secondary fix |
| Reduce the row cap to 5,000 | No | No | Breaks current use cases; SAP UI maxima vary by release | Do not use as primary fix |
| Check `Content-Length` | Only when trustworthy/present | No | Almost free | Fast reject only |
| Reject after `JSON.stringify` | No; peak already happened | No | Protects client context, not server memory | Defense-in-depth only |
| Stream-count post-content-decoding response bytes | **Yes** | No; it bounds each/cumulative tool result, not the process | Moderate, release-neutral | Primary individual-call boundary |
| Dedicated data concurrency = 2 | No | Bounds the guarded data phase to the configured cap | Queues only data work across targets; configurable | Required aggregate boundary |
| Parse rows and metrics once | No | Reduces amplification | About 52 MiB saved in the measured one-call fixture | Required amplification reduction in this PR |
| Validated CF launcher with `OPTIMIZE_MEMORY=true` | No | No | Adapts old-space to CF memory at 75% and `exec`s Node for direct signals | Required CF defense-in-depth |
| SAX/streaming XML parser | Can reduce amplification | Helps | High complexity; final row result still occupies memory | Follow-up optimization |
| Return files/object-store links | Avoids MCP result size | Depends on writer | Data governance, lifecycle, and authorization design required | Separate feature, not this fix |

## Recommended implementation

### A. One request-scoped post-content-decoding body budget

Use `ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES`, default `2097152` (2 MiB). It is a server-wide safety
ceiling, not a destination property and not user-expandable through scopes. An operator may raise
it for a larger deployment. The first release must reject `0` instead of offering a disable switch:
an apparently configured but unbounded data path would undermine the default-safe contract.
Bulk/file consumers should use an explicitly sized deployment override rather than causing the
shared MCP default to absorb multi-megabyte row sets. The default intentionally preserves margin
for the existing 100-row preview on wide table shapes; it is not a recommended target result size
for an LLM conversation.

Extend the existing `RequestContext` with the MCP abort signal and a shared data-result scope whose
budget and semaphore lease are initialized lazily. The scope owns one budget with `limitBytes`,
committed successful `consumedBytes`, and provisional successful bytes reserved by active response
streams. A nested `handleToolCall()`—currently the hyperfocused `SAP` wrapper—must inherit this
same scope and signal, with only the outermost owner responsible for final release.
`getTableContents()`, `runQuery()`, `runQueryWithMetrics()`, and `runTableQuery()` must all obtain
this context through one client-layer helper before issuing HTTP. This makes database-backed
search, navigation, where-used, authorization trace, and auto-chunking share the same allowance
automatically. Do not wrap a list of handlers. When no MCP `RequestContext` exists, each public
operation creates and releases a safe fallback data context for that operation.

Do not make the known data path depend on a caller remembering an optional option. Add one private
data-preview transport sink (for example `postDataPreview(...)`) whose budget/context parameter is
required. `postFreestyleQuery()` must also require and forward that value. The four public data
methods remain safe-by-default: each obtains the current or fallback context and passes its budget
to the required sink. This makes omission inside the known data chain a TypeScript error without
forcing library consumers to construct an internal safety object. Add a structural regression test
covering every `/datapreview/{ddic,freestyle}` call site. The generic HTTP layer still uses an
optional `AdtRequestOptions.responseBudget` because ordinary ADT requests are intentionally outside
this data-specific policy.

The required sink attaches the budget explicitly to `AdtRequestOptions` for the actual data POST.
The HTTP layer must not infer policy by matching `/datapreview/{ddic,freestyle}` path strings: path
sniffing would be fragile under endpoint variants, retries, and future callers. Before an automatic
data POST fetches a CSRF token, call `fetchCsrfToken(withoutResponseBudget(options))`. That helper
removes only the response budget; it must preserve the caller signal, deadline, fetch timeout, and
other request controls. Discovery HEAD/GET responses are not result data and must neither consume
nor trip the data allowance.

Count response-body `Uint8Array` chunks **after content decoding/decompression and before UTF-8
string conversion**. This is neither encoded `Content-Length` nor JavaScript string length. An
HTTP success means status 200–299 (`response.ok`). A 2xx response stream reserves bytes as chunks
arrive. The acceptance check is
`consumedBytes + allInFlightReservedBytes + nextChunkBytes <= limitBytes`, so two future parallel
responses in the same request cannot each start from the same stale cumulative count. On complete
2xx consumption, move that stream's reservation into `consumedBytes`; on cancellation or failure,
release it. Every non-2xx body—including 401, 406/415, 429, 500, and 503 retry candidates—uses the
same hard per-response limit but never reduces the cumulative successful-result allowance. Status
is known before the body is consumed, so this rule is deterministic. When the next chunk would
cross its applicable limit, cancel upstream, discard accumulated chunks, and throw a typed
`AdtResponseLimitError`. Do not include SQL, response prefixes, or row values in the error or audit
event.

Keep the existing Fetch `Response` contract. Inside `doFetch()`, wrap a response with
`capResponseBody(response, budget)` only when `options.responseBudget` is present. The helper wraps
a non-null `response.body` with a `TransformStream`, preserves status, status text, headers
(including multiple `Set-Cookie` values and ETags), and passes null bodies through. Existing initial
and retry `.text()` call sites then cannot bypass the cap, while unrelated transport behavior stays
unchanged.

For a **budgeted BTP request only**, request `Accept-Encoding: identity`, consume `resp.body`
directly through its Node async iterator, and construct the `Response` around the explicitly owned
live stream; do not use `Readable.toWeb()`, call `resp.body.text()`, or round-trip a complete string
through a second `Response`. Reject an unexpected non-identity `Content-Encoding` before returning
the body, destroying the response and client; the low-level `Client.request()` API does not provide
Fetch's automatic decompression. Transfer the short-lived Client's ownership to the returned stream
and close or destroy it exactly once when the underlying body ends, errors, or is cancelled,
including byte-limit cancellation. Late Node-readable data after cancellation must have no closed
Web controller to reach. Also clean up a client when `client.request()` fails before a response
exists. For 204/205/304, consume or destroy the Undici body, close the client, and return a null-body
`Response`.

Preserve the current buffered proxy conversion and `finally` cleanup for requests without an
explicit response budget. Making every proxy response live-streaming is a separate refactor and is
unsafe while callers such as CSRF bootstrap may inspect only headers and leave the body unread.

Suggested client-facing result:

```json
{
  "error": "DATA_RESPONSE_TOO_LARGE",
  "message": "The SAP data-preview result exceeded the 2 MiB server limit. Submit a new request with lower maxRows, fewer columns, or a restrictive non-overlapping key-range WHERE clause.",
  "limitBytes": 2097152,
  "retryable": false,
  "requestId": "..."
}
```

This should be a normal failed tool call; the process and unrelated MCP requests remain healthy.
It is deterministic for unchanged arguments, so `retryable` must be `false`: automatic retries
repeat the same expensive SAP work. The message asks the caller to submit a **separate tool call**
with lower `maxRows`, fewer selected columns, or a restrictive, non-overlapping key-range `WHERE`.
Smaller internal IN-list chunks do not solve a cumulative body-budget failure when their combined
result is unchanged. Keep the existing IN-list parser guidance cause-specific: it should recommend
shorter literal lists and smaller batches, with client-side union/re-sort where semantics permit.
Both errors should use consistent terms, but they must not give identical instructions. Do not
calculate a suggested `maxRows`; ARC-1 cannot infer row width safely, and silently changing query
semantics would surprise callers.

### B. A data-result semaphore held across the expensive phase

Add a shared process-wide `Semaphore`, configured by `ARC1_MAX_CONCURRENT_DATA_RESULTS` with
default `2`. Thread the one instance into every `AdtClient` in the same way as `adtSemaphore`,
including request-local principal-propagation and multi-target clients. The first guarded client
method in an MCP tool call acquires it lazily through the request-level data-result context; later
data methods and nested hyperfocused dispatch in that call reuse the lease and must not acquire a
nested slot. Only the outermost `handleToolCall()` owner releases the lease, in `finally` after tool
JSON, result sizing/preview, terminal audit, or error formatting completes. The MCP SDK's later
JSON-RPC/SSE encoding remains outside this lease. The wait and guarded HTTP work must honor
`RequestHandlerExtra.signal`.

Do not reuse or lower `ARC1_MAX_CONCURRENT`: that limiter protects SAP dialog work processes and
has different sizing semantics. A separate FIFO queue keeps ordinary source reads concurrent
while bounding admitted data work across every target. Default 2 leaves one data slot available
when another target has a slow call, preserves margin for wide 100-row previews under the 2 MiB
ceiling, and directly limits the incident's two-large-response shape. It still creates
process-wide head-of-line pressure in `/<target>/...` and `/multi/mcp`; cross-target FIFO progress
and ordinary-read independence are therefore release criteria, not assumptions.

Treat the product of the two knobs as an explicit raw-body admission envelope: the defaults are
`2 × 2 MiB = 4 MiB` before parser/result amplification. Equal products do not prove equal peak
RSS because individual-call temporary allocations and XML shapes can differ. Raising
`ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES` should normally be paired with a proportionate reduction in
`ARC1_MAX_CONCURRENT_DATA_RESULTS` unless a larger combined envelope has been benchmarked on the
deployed topology. The semaphore remains required because post-content-decoding bytes do not
impose a fixed heap multiplier, the current request semaphore ends before this phase, and an
operator may raise either ceiling.

### C. Close the known amplification gaps

- Refactor `xml-parser.ts` first to parse the XML once and derive
  `{ columns, rows, ...metrics }` from the same parsed object. Keep `parseTableContents()` and
  `parseDataPreviewMeta()` wrappers if public test compatibility is useful, but
  `runQueryWithMetrics()` must use the combined function. This is the best measured
  effort-to-benefit mitigation: the direct fixture saved about 52 MiB for a small code change. It
  still does not bound one response or aggregate concurrency.
- Apply `clampPreviewRows()` inside the freestyle sink, not only at callers, and clamp the outer
  `runChunkedSapQuery()` total. Sink enforcement prevents internal or future callers from bypassing
  it. When the user's positive finite requested limit exceeds 10,000, `SAPQuery` must add
  `rowLimitClamped`, `requestedRows`, and `effectiveMaxRows` metadata to both single and chunked
  results. Do not return partial rows after a byte-budget error.
- Update the tool description to distinguish the two limits: 10,000 is the hard maximum requested
  row count, while the 2 MiB cumulative decompressed-response ceiling can reject a wide result much
  earlier. In the live TADIR sample, 6,690,675 bytes for 10,000 rows averaged about 669 raw XML
  bytes per row, so a 2 MiB response is only roughly 3,100 rows for that shape. This is an
  illustration, not a row guarantee or a basis for automatic retry sizing.
- Avoid building aggregate `fullText` with `.map().join('')` in dispatch when there is only one
  text block; use the existing string directly, and compute multi-block size without concatenating
  when a preview does not require it. The current JavaScript engine may optimize the one-item join,
  so treat this as defensive cleanup rather than a measured part of the fix.
- Emit an audit event/error class with the limit, consumed threshold, data endpoint family,
  request ID, and queue timing. Never log the SQL or result body for this event.

### D. Correct the CF safety margin

In the same implementation PR, replace `command: node --max-old-space-size=448 dist/index.js` with
`command: exec ./bin/start-cf.sh` and add `OPTIMIZE_MEMORY: "true"` to the module properties. The
launcher accepts only a positive decimal `MEMORY_AVAILABLE`, calculates 75%, and `exec`s Node with
that old-space value. Expected flags are 384 MiB for the shipped 512 MiB module and 768 MiB for a
1 GiB `.mtaext` memory override. Direct `exec` is required because live `cf restart` testing showed
that the buildpack's default `npm start` process did not deliver SIGTERM to ARC-1's shutdown hook.

Do not use `--max-old-space-size-percentage`: it is newer than ARC-1's declared minimum Node
version and adds a host-memory fallback path. Do not use an unchecked shell expression derived
from `MEMORY_LIMIT`. Keep the strictly validated, fail-closed 75% launcher described above. Raise
the generic Docker-based direct-push manifest to 512 MiB with a matching 384 MiB numeric old-space
value; Docker does not run the buildpack launcher, so its memory and heap values must be changed in
lockstep.

Ship adaptive heap sizing atomically with the response budget and data semaphore in this PR.
Without the guard, lowering the 512 MiB deployment's V8 ceiling can turn the same unbounded request
into a fatal old-space allocation failure sooner. With the guard present, the 75% setting becomes
defense-in-depth and follows future CF memory overrides. The implementation PR closes both
[#737](https://github.com/arc-mcp/arc-1/issues/737) and
[#741](https://github.com/arc-mcp/arc-1/issues/741).

Do not make a larger instance the only remediation. Keep the reporter's 1 GiB allocation during
rollout, then choose instance memory from observed bounded peaks and user concurrency rather than
assuming the guard makes 512 MiB universally sufficient.

### E. Lock and validate the operator contract

Ship both environment variables and CLI flags, following the existing precedence
CLI > environment/`.env` > defaults:

| Purpose | Environment | CLI | Default |
|---|---|---|---:|
| Cumulative decompressed data body bytes per tool call | `ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES` | `--max-datapreview-response-bytes` | `2097152` |
| Process-wide admitted data-result calls | `ARC1_MAX_CONCURRENT_DATA_RESULTS` | `--max-concurrent-data-results` | `2` |

Both values must be positive base-10 integers within JavaScript's safe-integer range. Reject startup
for empty explicit values, signs, fractions, exponent notation, suffixes, zero, negatives, or unsafe
integers; do not clamp and do not silently fall back. This is intentionally stricter than the
legacy `ARC1_MAX_CONCURRENT` parser because accepting a malformed safety ceiling as another value
would create a misleading deployment.

At startup, log both effective values and their product as the raw-body admission envelope, without
logging secrets. Compute the product without numeric overflow. Warn when it exceeds the shipped
default envelope of 4 MiB, but do not auto-adjust either operator choice. The warning should tell
operators to benchmark bounded peak RSS and normally reduce concurrency when they raise the byte
limit.

## Landing sequence and compatibility

Continue draft PR #739 from research into the single implementation PR. Keeping the interacting
changes atomic prevents an unsafe intermediate deployment in which old-space is lowered without a
response guard, or the response guard ships while `.mtaext` memory scaling still leaves old-space
pinned. Organize the implementation as independently reviewable commits inside the same PR:

1. Parse rows and metrics once, enforce the 10,000-row sink clamp, and report clamp metadata.
2. Add the required lazy request-level budget/context, cancellation, strict configuration, and
   process-wide data-result semaphore.
3. Add the conditional direct/BTP response stream wrapper, CSRF budget stripping, bounded retry
   bodies, decompression policy, and correctly owned proxy teardown.
4. Add the stable non-retryable error, aligned but cause-specific query guidance, audit fields, and
   avoidable result-string cleanup.
5. Replace the fixed CF start command with the fail-closed adaptive launcher, enable buildpack
   memory input, add startup sizing diagnostics, and verify 512 MiB and 1 GiB MTA deployments.
6. Update operator documentation and release notes, then run the complete local/live regression
   matrix.

The byte budget and semaphore must not be reviewed away as optional optimizations: together they
are the individual-call and aggregate admission controls. The parse-once path and adaptive heap
sizing reduce independent amplifiers but do not replace either boundary. Once implementation and
verification are present, rename PR #739 to the normal `fix:` convention and make its description
close both #737 and #741. The qualified reporter evidence from PR #742 is incorporated in this
dossier; do not merge its estimates as unqualified proxy-body measurements.

Use the project's normal `fix:` convention for the resource-safety work. Independently of commit
type, the release notes and upgrade guidance must prominently say that:

- raw `SAPQuery.maxRows` values above 10,000 are now clamped and the result reports the requested
  and effective limits;
- successful results above the default 2 MiB cumulative post-content-decoding body ceiling now
  fail with an actionable error;
- 10,000 is only the maximum row request; wide rows can reach the byte ceiling and fail at a much
  lower row count;
- operators serving intentional batch/file consumers can raise the ceiling after sizing memory
  and data concurrency; and
- both new limits reject zero or malformed values at startup rather than disabling the boundary.

## Implementation surface

The implementation uses this surface:

- `src/server/context.ts` — carry the MCP abort signal plus the lazy request-level budget and data
  semaphore lease;
- `src/adt/http-deadline.ts` — carry the optional response budget and provide
  `withoutResponseBudget()` for CSRF bootstrap;
- `src/adt/bounded-response.ts` and `src/adt/http.ts` — bounded `Response.body` wrapper for
  explicitly budgeted direct/proxy responses; adapt the live BTP Node stream without
  `Readable.toWeb()` only on that path, keep non-budgeted proxy requests buffered, enforce identity
  encoding, handle null-body statuses, and close/destroy the per-request proxy client exactly once
  on every terminal path, including late data after cancellation;
- `src/adt/errors.ts` — typed response-limit error with secret-free fields; add it to both HTTP
  pass-through catches so it is not accidentally reclassified as `AdtNetworkError`; export it from
  `src/public/index.ts` for direct client consumers;
- `src/adt/config.ts`, `src/adt/client.ts`, and `src/adt/table-query.ts` — shared
  admission-controller plumbing, lazy/fallback data-operation context, required internal
  data-preview sink, all data-method coverage, sink row clamp, structured-query construction, and
  combined parser path;
- `src/adt/xml-parser.ts` — one-parse data-preview result extraction;
- `src/handlers/query.ts` — chunked row clamp; request-level budget ownership belongs below the
  handlers so `SAPRead`, `SAPSearch`, `SAPNavigate`, where-used, and authorization trace cannot be
  missed;
- `src/handlers/dispatch.ts` — request-context lifetime, lease release after result/audit work,
  nested hyperfocused scope inheritance, stable error formatting/audit classification, and
  avoidable string copy;
- `src/server/types.ts`, `src/server/config.ts`, `src/server/runtime-memory.ts`, and
  `src/server/server.ts` — defaults, strict CLI/env parsing, MCP signal propagation, process-wide
  semaphore shared by every server/client factory, startup envelope log, and warning;
- `src/handlers/tools.ts` — describe the row and byte ceilings (the schema retains sink clamping);
- `mta.yaml`, `bin/start-cf.sh`, `manifest.yml`, `.env.example`, `mta-overrides.mtaext.example`,
  `docs_page/configuration-reference.md`,
  `docs_page/rate-limiting.md`, `docs_page/btp-administration.md`, `docs_page/tools.md`, and release
  notes — operator contract and deployment guidance.
- `AGENTS.md` — add `AdtResponseLimitError` to the documented canonical ADT error set.

No ADT feature discovery or SAP release gate is needed.

## Required tests

1. **Bounded response stream:** missing `Content-Length`, exact boundary, first chunk over boundary,
   later chunk over boundary, UTF-8 split across chunks, body cancellation, reader errors, and a
   cheap identity-body header rejection. Run the same cases through direct Fetch and the budgeted
   BTP Connectivity adapter. Preserve status, status text, ETag, multiple `Set-Cookie` headers, and
   null-body 204/205/304 responses. Assert the proxy body is read exactly once, its per-request
   client closes exactly once on normal end, source error, cap cancellation, caller cancellation,
   unexpected encoding, null-body status, and pre-response request failure. Reproduce a late Node
   body event after cap cancellation and assert it cannot enqueue into a closed Web controller or
   escape as an uncaught exception. The parser must never run after an over-limit response.
2. **Transport scope and CSRF:** explicit `AdtRequestOptions.responseBudget`, not URL matching,
   activates the wrapper. A non-budgeted proxy response keeps the current buffer-and-close
   behavior. `withoutResponseBudget()` prevents both CSRF HEAD and fallback GET from consuming or
   tripping the data allowance while preserving signal, deadline, fetch timeout, and request flags.
   An unrelated large response must not accidentally acquire a data lease or budget.
3. **Retry coverage and charging:** 2xx bodies reserve and commit against the cumulative allowance.
   The complete bodies of 401, 406/415, 429, 500 DB-reconnect, and 503 retry responses cannot bypass
   the hard per-response ceiling but never charge the cumulative successful-result allowance.
4. **Request ownership and aggregate accounting:** several individually sub-limit IN-list or
   internal data responses cross the cumulative tool budget and fail without retaining/serializing
   the combined rows. Two simultaneous successful response streams in one request must include
   each other's provisional reservations, so their combined bytes cannot oversubscribe the limit.
   Cover `SAPQuery`, table-content/table-query reads, DB-backed TADIR lookup, class hierarchy,
   where-used interface augmentation, and authorization trace. Assert one lazy context and one
   non-nested semaphore lease per tool call. The hyperfocused `SAP` wrapper inherits the same
   budget/signal, the inner dispatch does not release it, and the outer dispatch releases it once
   after its own audit/result work. A direct `AdtClient` operation outside MCP receives a bounded
   fallback context and releases it.
5. **Row limits:** raw, single-statement, and chunked `SAPQuery` all clamp at the required sink to
   10,000; NaN, infinity, fractions, zero, and negatives retain the existing fallback semantics.
   An above-limit request reports `rowLimitClamped`, `requestedRows`, and `effectiveMaxRows` for
   both execution paths. Byte overflow still returns an error with no partial rows. Assert every
   data-preview endpoint literal routes through the required-budget sink, while ordinary public
   client callers receive a safe context automatically.
6. **Parser equivalence:** old ASX and current data-preview fixtures produce identical rows and
   metrics through the one-parse function, including empty/null values.
7. **Concurrency and cancellation:** three data calls never exceed the default data-result
   concurrency of two; an ordinary source read is not queued behind them; the semaphore is shared
   across per-user, pinned, and aggregate multi-target clients; queued work for a second target
   progresses in FIFO order as a slot frees, and one slow call against target A leaves one slot for
   target B. Pass the SDK's MCP abort signal into dispatch: an
   aborted waiter leaves no slot leak, and an active direct/BTP read is cancelled and cleaned up.
   The lease remains held through tool JSON and terminal audit work and is released on every
   success/error path. Also test a non-default value so the assertion proves configuration plumbing
   rather than a hard-coded value.
8. **Error contract:** single-target and multi-target routes return a stable, secret-free,
   actionable `DATA_RESPONSE_TOO_LARGE` error with `retryable:false`, the effective limit, and the
   request ID. Minimal-error mode must not hide the operator-defined limit or remediation. An
   unchanged request is never automatically retried and no guessed `maxRows` is returned.
9. **Deployment/config:** default, environment, CLI precedence, exact flag names, positive decimal
   safe-integer validation, rejection of zero/malformed/unsafe values, 4 MiB startup envelope log,
   larger-envelope warning, no auto-adjustment, adaptive MTA heap sizing, and docs are synchronized.
   Verify the MTA launcher rejects absent/malformed `MEMORY_AVAILABLE`, produces a 384 MiB old-space
   flag at 512 MiB and 768 MiB at 1 GiB, and delivers CF SIGTERM to ARC-1 after `exec`. The startup
   log must expose the non-secret memory inputs and effective V8 heap limit. Run startup coverage on
   the minimum supported Node version and assert that no deployment flag exceeds the declared
   engine floor.
10. **Live regression:** against the 758 system, run three parallel `TADIR` queries that cross the
   2 MiB test cap. The calls must fail or queue individually under the default two-call admission cap,
   `/health` and a subsequent small query must succeed, and CF/local RSS must remain below the test
   envelope. Separately retain two near-2-MiB successful results through the full direct path and
   prove the 512 MiB reference topology survives. Repeat both boundary and near-limit cases through
   a CF principal-propagation route without using production BW data; the reporter's offered
   development BW route is the preferred proxy acceptance test.

An exact RSS assertion should not be a normal unit-test gate because allocator and platform
behavior vary. Keep a child-process benchmark as release evidence and gate deterministic facts:
stream cancellation before the cap, no parser invocation, serialized data concurrency, and process
survival. Preserve the 0.5/1/4 MiB token-sizing fixture as research evidence; do not add a tokenizer
runtime dependency or make vendor-specific token counts part of ARC-1's safety decision.

## Operational guidance before a code fix ships

For affected operators:

1. Keep the larger CF memory allocation; it materially reduces immediate restart risk.
2. Set `ARC1_MAX_CONCURRENT=1` on a dedicated data-enabled instance if reliability matters more
   than throughput. This is coarse and not a proof of safety, but it matches the reporter's
   successful sequential behavior better than the default 10.
3. Keep `maxRows` near its default 100, select only needed columns, and add restrictive predicates.
   Do not request `SELECT *` from wide BW tables.
4. Monitor CF container memory and `app.crash` events. More horizontal instances distribute calls
   but do not protect any individual instance from one oversized response.
5. Do not lower only `--max-old-space-size` and call the issue fixed; without a body guard, V8 can
   still terminate the process rather than return a tool error.

## Out of scope

- Do not change the SAP SQL authorization model; the existing data/sql scope and safety gates are
  orthogonal and must remain.
- Do not add automatic offset pagination without a verified ADT cursor/offset contract.
- Do not return a byte-budget-partial result. A row-limit clamp reports the requested and effective
  limits without asserting that more matches existed. If a future partial/truncated mode is added,
  it needs explicit `truncated`, returned/total counts, and continuation semantics.
- Do not store query results on CF's ephemeral filesystem as the default workaround. A durable
  result-link feature would require separate storage, retention, authorization, and audit design.
- Do not use `process.availableMemory()` as the primary admission decision; although stable in
  the required Node runtime, it is a racy snapshot under parallel allocation.
- Do not turn the data-preview budget into a universal plugin/ADT response limit without separate
  compatibility research. Track the exposed `runQueryWithMetrics()` plugin-facade omission as an
  independent, surgical scope-hardening follow-up.

**Implementation review status:** PR #739 contains the complete issue-closing boundary: the
2 MiB streaming cumulative byte budget, two-slot data semaphore, one-pass parser, row clamp,
request-level ownership, conditional transport stream, cancellation/config/error contract, and
adaptive 75% CF heap sizing. The local, live-SAP, and disposable-CF BTP Connectivity regression
evidence is green after replacing the cancellation-racy `Readable.toWeb()` bridge. The fail-closed
launcher is live-verified at 512 MiB and 1 GiB, including direct SIGTERM delivery, clean exit, and
healthy restart. PR #739 is ready to merge; principal-propagation identity acceptance remains
optional because the tested Basic destination exercised the same proxy-body transport. These
controls make the shipped 512 MiB topology defensible without claiming that the 4 MiB raw admission
product is a process-memory proof. A SAX/columnar response path remains a later performance feature,
not a prerequisite for this fix.
