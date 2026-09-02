# Issue #737 — data-preview responses need a bounded memory budget

**Status:** Confirmed ARC-1 resource-safety bug on 2026-09-02. The affected path is present in
ARC-1 1.1.0 and remains present at HEAD `7969a9b2` (1.1.2). The failure mechanism was validated
with the real ADT data-preview contract on S/4HANA 2023 / SAP_BASIS 758, with local RSS
measurements through ARC-1's actual parser and MCP result shape, and against the shipped Cloud
Foundry configuration. No SAP object, BTP service, destination, or deployed application was
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

1. Add an enabled-by-default **decoded-byte budget for the complete data-preview tool call** and
   enforce it while reading every `/datapreview/ddic` or `/datapreview/freestyle` response stream.
   Start with **4 MiB per call**, including the sum of auto-chunked responses, and make the ceiling
   operator-configurable.
2. Add a separate **process-wide data-result semaphore**, default **1**, held through fetch, parse,
   row construction, and tool JSON serialization. It must be shared by all principal-propagation
   and multi-target clients. Ordinary source/metadata reads should remain governed only by
   `ARC1_MAX_CONCURRENT`.
3. Parse rows and metrics from one XML parse, and clamp every raw/chunked `SAPQuery` to the existing
   10,000-row ARC-1 ceiling as a secondary rail.
4. Replace the shipped fixed 448 MiB CF old-space limit with Node's
   `--max-old-space-size-percentage=75` (supported by ARC-1's required Node >=22.19), so native,
   young-generation, HTTP-buffer, and platform overhead have real and instance-size-adaptive
   headroom. This is 384 MiB on the shipped 512 MiB instance. More CF memory remains a mitigation,
   not the correctness fix.

The 4 MiB/one-data-call defaults are an intentionally conservative starting point for the shipped
512 MiB topology, not a proof that every possible XML shape has a fixed amplification factor.
They should be confirmed with the regression matrix below before implementation is merged.

## Reported impact and scope

The external report is for ARC-1 1.1.0 on Cloud Foundry with one 512 MiB instance,
`http-streamable`, XSUAA principal propagation, and both data preview and free SQL enabled. Two
parallel `SAPQuery` calls returned several megabytes each from BW tables. Cloud Foundry terminated
the instance twice within 31 seconds with `Exited with status 137 (out of memory)`. Every in-flight
MCP request on the instance was lost; sequential retries fit after the operator raised the instance
to 2 GiB.

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
`response.text()` again. An outer bounded reader would therefore be too late for the first proxy
allocation and would preserve an avoidable body conversion. The limit must be enforced at the
first consumer of the proxy `BodyReadable`, and the transport abstraction should return one
normalized bounded body rather than round-trip it through a second `Response`.

A `Content-Length` check is useful only as a fast rejection when content encoding is absent or
identity. It cannot be the guard: the live 758 data-preview responses had no `Content-Length`, and
streamed/compressed responses need the actual delivered body chunks counted. A header may reject
early but must never authorize an otherwise unbounded read.

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

The dedicated data semaphore should cover the complete handler work through `toolJson()`. The MCP
SDK's final JSON-RPC/SSE encoding happens after the handler returns and is harder to include without
changing the transport contract; the benchmark shows that covering fetch, parse, and tool JSON
captures the dominant peak. The streaming byte cap remains the hard individual-call boundary.

### 5. Auto-chunking is a per-response-cap bypass unless the budget is request-scoped

`runChunkedSapQuery()` executes multiple statements sequentially and appends every chunk's rows to
one array. Limiting each HTTP response to 4 MiB would still permit, for example, four 3 MiB chunks
to produce one much larger tool result. The budget object must therefore belong to the outer tool
call. Each data-preview read consumes from the same remaining decoded-byte allowance, and a later
chunk fails or stops before the cumulative allowance is crossed.

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

### Cloud Foundry sizing

The shipped `mta.yaml` allocates 512 MiB and starts Node with
`--max-old-space-size=448`, described as leaving 64 MiB headroom. A read-only CF inspection showed
the available test instance at the same 512 MiB size and about 108 MiB RSS while idle.

Node documents that `--max-old-space-size` limits only V8's old-memory section and explicitly
recommends leaving memory for other uses. Node 22 also provides
`--max-old-space-size-percentage`, which takes precedence over the fixed-size flag and calculates
the ceiling from available system memory. See
[Node's CLI documentation](https://nodejs.org/download/release/v22.21.1/docs/api/cli.html#--max-old-space-size-percentagepercentage).
The current Cloud Foundry Node buildpack's optional memory optimization independently uses the
same 75% policy, not 87.5%; see its
[`bin/release`](https://github.com/cloudfoundry/nodejs-buildpack/blob/master/bin/release).
ARC-1 also needs young-generation heap, external buffers, native libraries, HTTP buffers, and
platform process overhead. The existing 64 MiB comment is therefore not a valid total-process
headroom calculation.

Cloud Foundry exposes `MEMORY_LIMIT` as the maximum each application instance can consume and
restarts an instance which crosses it. See the
[environment-variable documentation](https://docs.cloudfoundry.org/devguide/deploy-apps/environment-variable.html#MEMORY_LIMIT)
and the [status-137 log example](https://docs.cloudfoundry.org/devguide/deploy-apps/streaming-logs.html#proxy).

Node 22's `process.constrainedMemory()` and `process.availableMemory()` could improve startup and
audit diagnostics. Both are stable in Node >=22.16, but available memory is inherently racy under
parallel requests. They should not replace a deterministic configured budget. See the
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
| Stream-count decoded response bytes | **Yes** | Only with a shared/cumulative budget | Moderate, release-neutral | Primary boundary |
| Dedicated data concurrency = 1 | No | Strongly reduces overlap | Queues only data work; configurable | Pair with byte boundary |
| Parse rows and metrics once | No | Reduces amplification | Low risk, measurable benefit | Include in fix |
| SAX/streaming XML parser | Can reduce amplification | Helps | High complexity; final row result still occupies memory | Follow-up optimization |
| Return files/object-store links | Avoids MCP result size | Depends on writer | Data governance, lifecycle, and authorization design required | Separate feature, not this fix |

## Recommended implementation

### A. One request-scoped decoded-byte budget

Add a server configuration property provisionally named
`ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES`, default `4194304` (4 MiB). It is a server-wide safety
ceiling, not a destination property and not user-expandable through scopes. An explicit operator
may raise it for a larger deployment; if disabling it is supported, `0` must be documented as an
unsafe opt-out.

Create a small request-scoped budget object with `limitBytes`, `consumedBytes`, and a method that
atomically charges each chunk. Pass the same object through every data-preview request made by one
tool call, including automatic IN-list chunks. Count the response-body `Uint8Array` chunks delivered
by Undici before converting them into a complete JavaScript string. Successful result bodies
consume the cumulative tool-call budget; non-success and discarded retry bodies use the same hard
per-response ceiling but should not reduce the later successful-result allowance. When the next
chunk would cross its applicable limit, cancel the reader, discard accumulated chunks, and throw a
typed `AdtResponseLimitError`. Do not include the SQL, response prefix, or row values in the error
or audit event.

Refactor the transport choke point so the direct Fetch and BTP `undici.Client` branches both feed
the same bounded-body decoder and return a normalized `{ status, headers, body }` exactly once.
For the BTP branch, consume and cap `resp.body` before closing its short-lived `Client`; do not
construct a second `Response` from the complete string. This is required for #737's reported
topology—adding a reader only after `doFetch()` returns would not protect it.

Every initial and retry response must use one shared bounded-body helper; leaving even one
`retryResp.text()` branch creates a bypass. Preserve abort/deadline behavior and always release the
reader lock/cancel the body on failure.

Suggested client-facing result:

```json
{
  "error": "DATA_RESPONSE_TOO_LARGE",
  "message": "The SAP data-preview result exceeded the 4 MiB server limit. Lower maxRows, select fewer columns, or add a restrictive/key-range WHERE clause, then retry.",
  "limitBytes": 4194304,
  "retryable": true,
  "requestId": "..."
}
```

This should be a normal failed tool call; the process and unrelated MCP requests remain healthy.
Do not automatically rerun with a lower limit: that repeats SAP work, still cannot infer row width,
and may surprise callers with silently different query semantics.

### B. A data-result semaphore held across the expensive phase

Add a shared process-wide `Semaphore`, provisionally configured by
`ARC1_MAX_CONCURRENT_DATA_RESULTS` with default `1`. Thread it through every `AdtClient` in the
same way as `adtSemaphore`, including request-local principal-propagation and multi-target clients.
Acquire it outside the complete data handler and release only after rows and compact tool JSON have
been built or an error returned. The wait must honor the MCP/ADT request abort signal.

Do not reuse or lower `ARC1_MAX_CONCURRENT`: that limiter protects SAP dialog work processes and
has different sizing semantics. A separate queue keeps ordinary source reads concurrent while
making data-memory exposure predictable. Operators with measured headroom can raise the data
value.

### C. Close the known amplification gaps

- Refactor `xml-parser.ts` to parse the XML once and derive `{ columns, rows, ...metrics }` from the
  same parsed object. Keep `parseTableContents()` and `parseDataPreviewMeta()` wrappers if public
  test compatibility is useful, but `runQueryWithMetrics()` must use the combined function.
- Apply `clampPreviewRows()` inside the freestyle sink, not only at callers, and clamp the outer
  `runChunkedSapQuery()` total. Update the tool description to state max 10,000. Sink enforcement
  prevents internal or future callers from bypassing it.
- Avoid building aggregate `fullText` with `.map().join('')` in dispatch when there is only one
  text block; use the existing string directly, and compute multi-block size without concatenating
  when a preview does not require it. The current JavaScript engine may optimize the one-item join,
  so treat this as defensive cleanup rather than a measured part of the fix.
- Emit an audit event/error class with the limit, consumed threshold, data endpoint family,
  request ID, and queue timing. Never log the SQL or result body for this event.

### D. Correct the CF safety margin

For the shipped MTA, replace `--max-old-space-size=448` with
`--max-old-space-size-percentage=75`. ARC-1 requires Node >=22.19, so this flag is within the
supported runtime baseline; it yields 384 MiB on the current 512 MiB instance and scales if the
instance allocation changes. Update the comment so it does not describe old-space headroom as
total-process headroom. The buildpack's opt-in memory calculator is a viable alternative, but
using Node's flag in the explicit application command makes the policy visible and removes the
need to verify a buildpack-specific opt-in. Consider raising the generic direct-push manifest from
256 MiB after measuring its real startup and bounded query peaks.

Do not make a larger instance the only remediation. Keep the reporter's 2 GiB allocation during
rollout, then choose instance memory from observed bounded peaks and user concurrency rather than
assuming the guard makes 512 MiB universally sufficient.

## Affected files

Expected implementation surface:

- `src/adt/http-deadline.ts` — carry the optional response budget/request context;
- `src/adt/http.ts` — one bounded stream reader used at the first direct/proxy body consumer and by
  the initial and all retry branches; remove the BTP string → `Response` → string round-trip;
- `src/adt/errors.ts` — typed response-limit error with secret-free fields;
- `src/adt/config.ts` and `src/adt/client.ts` — budget/semaphore plumbing, sink row clamp, combined
  parser path;
- `src/adt/xml-parser.ts` — one-parse data-preview result extraction;
- `src/handlers/query.ts` and `src/handlers/read.ts` — outer cumulative budget and actionable result;
- `src/handlers/dispatch.ts` — error formatting/audit classification and avoidable string copy;
- `src/server/types.ts`, `src/server/config.ts`, `src/server/server.ts`, and
  `src/server/multi-target-runtime.ts` — defaults, CLI/env parsing, and process-wide semaphore;
- `src/handlers/tools.ts` and possibly `src/handlers/schemas.ts` — describe/enforce the row ceiling;
- `mta.yaml`, `manifest.yml`, `.env.example`, `docs_page/configuration-reference.md`,
  `docs_page/rate-limiting.md`, `docs_page/btp-administration.md`, `docs_page/tools.md`, and release
  notes — operator contract and deployment guidance.

No ADT feature discovery or SAP release gate is needed.

## Required tests

1. **Bounded reader:** missing `Content-Length`, exact boundary, first chunk over boundary, later
   chunk over boundary, UTF-8 split across chunks, body cancellation, reader errors, and a cheap
   identity-body header rejection. Run the same cases through direct Fetch and the BTP Connectivity
   proxy adapter. Assert the proxy body is read exactly once and the parser is never called after
   an over-limit response.
2. **Retry coverage:** 401, 429, 503, and content-negotiation retry responses cannot bypass a hard
   per-response ceiling. Assert that discarded error/retry bodies do not consume the cumulative
   successful-result allowance, while no individual body can be read without a bound.
3. **Aggregate chunking:** several individually sub-limit IN-list responses cross the cumulative
   tool budget and fail without retaining/serializing the combined rows.
4. **Row limits:** raw, single-statement, and chunked `SAPQuery` all clamp at the sink to 10,000;
   NaN, infinity, fractions, zero, and negatives retain the existing fallback semantics.
5. **Parser equivalence:** old ASX and current data-preview fixtures produce identical rows and
   metrics through the one-parse function, including empty/null values.
6. **Concurrency:** two data calls never exceed the configured data-result concurrency; an ordinary
   source read is not queued behind them; the semaphore is shared across per-user and multi-target
   clients; aborted waiters leave no slot leak.
7. **Error contract:** single-target and multi-target routes return a stable, secret-free,
   actionable error and keep the request ID. Minimal-error mode must not hide the operator-defined
   limit or remediation.
8. **Deployment/config:** default, env, CLI precedence, invalid values, MTA heap ratio, and docs are
   synchronized.
9. **Live regression:** against the 758 system, run two parallel `TADIR` queries that cross the test
   cap. Both calls must fail or queue individually as configured, `/health` and a subsequent small
   query must succeed, and CF/local RSS must remain below the test envelope. Repeat through a CF
   principal-propagation route without using production BW data.

An exact RSS assertion should not be a normal unit-test gate because allocator and platform
behavior vary. Keep a child-process benchmark as release evidence and gate deterministic facts:
stream cancellation before the cap, no parser invocation, serialized data concurrency, and process
survival.

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
- Do not silently return a partial result as if it were complete. If a future truncated mode is
  added, it needs explicit `truncated`, returned/total counts, and continuation semantics.
- Do not store query results on CF's ephemeral filesystem as the default workaround. A durable
  result-link feature would require separate storage, retention, authorization, and audit design.
- Do not use `process.availableMemory()` as the primary admission decision; although stable in
  the required Node runtime, it is a racy snapshot under parallel allocation.

## Paste-able GitHub reply

```markdown
Confirmed on 1.1.0 and current HEAD: #737 is a real ARC-1 resource-safety bug, not a duplicate.

The response path is currently unbounded. `src/adt/http.ts` calls `response.text()` before checking
size; on the BTP Connectivity path it has already called `resp.body.text()` and rebuilt a second
`Response`, so that topology buffers/converts the body twice before parsing. Data-preview XML is
then expanded into a generic object graph plus row objects; `SAPQuery` parses the same body a second
time for metrics; and the result is JSON-serialized and wrapped/encoded by the MCP HTTP transport.
`ARC1_MAX_CONCURRENT` only counts active SAP HTTP requests and releases its slot before
parsing/result serialization. Raw `SAPQuery.maxRows` also missed the sink clamp added by #388.

I validated the exact path on S/4HANA 2023 / SAP_BASIS 758. `SELECT * FROM TADIR` with
`rowNumber=10000` returned 6,690,675 bytes and no `Content-Length`. In a fresh-process benchmark
through ARC-1's real parser, handler, and SSE result shape, two such responses (12.76 MiB raw total)
peaked at 340.3 MiB RSS from a ~98 MiB baseline. Parsing rows+metrics once instead of twice saved
about 52 MiB for one response, but still did not create a hard bound. That benchmark used direct
HTTPS and therefore excludes the BTP proxy's extra body conversion. I did not deliberately crash
the shared CF app; the reported 137 events plus this measured allocation chain are sufficient.

Recommended fix:

1. an enabled-by-default decoded-byte budget, enforced while streaming each
   `/datapreview/{ddic,freestyle}` body and shared across every response/chunk in one tool call;
2. a separate process-wide data-result semaphore (default 1) held through fetch, parse, row
   construction, and tool JSON, shared across PP/multi-target clients;
3. a one-pass rows+metrics parser and the existing 10,000-row sink clamp applied to raw/chunked
   `SAPQuery`; and
4. a safer, adaptive CF heap target (the shipped 448 MiB old-space inside a 512 MiB container
   leaves too little total-process headroom; Node's 75% flag gives 384 MiB at that size and scales
   with the instance limit).

I would start with a configurable 4 MiB cumulative decoded-data budget for the shipped 512 MiB
topology and return `DATA_RESPONSE_TOO_LARGE` with: lower `maxRows`, select fewer columns, or add a
restrictive/key-range `WHERE`. `Content-Length` alone is insufficient (the live response omitted
it), a post-parse check is too late, and more CF memory only moves the failure threshold.

Until that ships, the practical mitigation is to keep the 2 GiB allocation and use
`ARC1_MAX_CONCURRENT=1` on the data-enabled instance if the throughput tradeoff is acceptable.
```

**Recommendation:** accept #737 and implement the layered fix above. Treat the streaming cumulative
byte budget as the issue-closing boundary; ship the dedicated data semaphore, one-pass parser, raw
row clamp, and CF heap correction in the same PR because they address independently measured
amplifiers and make the default 512 MiB topology defensible. Revisit a SAX/columnar response path
only as a later performance feature.
