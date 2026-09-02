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

1. Add an enabled-by-default **post-content-decoding response-body byte budget for the complete
   data-preview tool call** and pass it explicitly from the data operation into the transport.
   Start with **1 MiB per call**, including the sum of auto-chunked responses, and make the ceiling
   operator-configurable. This is still roughly 190,000–202,000 tokens for a representative
   TADIR-shaped result, so it is a server-safety ceiling rather than a promise that every client
   can use a near-limit result.
2. Add a separate **process-wide data-result semaphore**, default **4**, held through fetch, parse,
   row construction, and tool JSON serialization. It must be shared by all principal-propagation
   and multi-target clients. Ordinary source/metadata reads should remain governed only by
   `ARC1_MAX_CONCURRENT`. The semaphore remains part of the issue-closing boundary: a byte cap
   does not establish a fixed XML-to-heap amplification ratio or aggregate process limit.
3. Parse rows and metrics from one XML parse, and clamp every raw/chunked `SAPQuery` to the existing
   10,000-row ARC-1 ceiling as a secondary rail.
4. Change the shipped fixed CF old-space limit from **448 MiB to 384 MiB** so native,
   young-generation, HTTP-buffer, and platform overhead have real headroom. Do not use Node's
   percentage flag without first raising ARC-1's runtime floor: it was added in Node 22.21, while
   ARC-1 currently permits Node 22.19. More CF memory remains a mitigation, not the correctness fix.

The defaults—1 MiB per tool call and four concurrent data calls—are intentionally conservative
starting points for the shipped 512 MiB topology. Together they admit at most 4 MiB of successful
response bodies into the guarded phase before parsing amplification; this is a sizing starting
point, not a process-memory proof. They are behavior changes: a previously successful bulk query
can now be clamped or rejected, even if its result was impractical for an LLM client. The release
notes and upgrade guidance must say so, and the defaults must be confirmed with the regression
matrix below before implementation is merged.

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

The dedicated data semaphore should cover the complete handler work through `toolJson()`. The MCP
SDK's final JSON-RPC/SSE encoding happens after the handler returns and is harder to include without
changing the transport contract; the benchmark shows that covering fetch, parse, and tool JSON
captures the dominant peak. The streaming byte cap remains the hard individual-call boundary.

### 5. Auto-chunking is a per-response-cap bypass unless the budget is request-scoped

`runChunkedSapQuery()` executes multiple statements sequentially and appends every chunk's rows to
one array. Any per-response limit would still permit several individually sub-limit chunks to
produce one much larger tool result. The budget object must therefore belong to the outer tool
call. Each data-preview read consumes from the same remaining post-content-decoding byte allowance,
and a later chunk fails or stops before the cumulative allowance is crossed.

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

This supports lowering the provisional default from 4 MiB to **1 MiB**. It does not prove that a
near-limit response fits every MCP conversation: the representative result alone consumes about
an entire 200,000-token context before instructions, history, schemas, or the model's answer. A
roughly 0.5 MiB response was still about 96,000–101,000 tokens. Operators should keep `maxRows`
well below the rejection boundary for normal agent use.

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
server baseline still places this representative case below 512 MiB. This supports 1 MiB as a
plausible default, but it does **not** make aggregate admission optional: the harness was synthetic,
direct-transport-only, and cannot establish a maximum amplification factor for all column/value
shapes or account for operators raising the byte limit. Keep the data-result semaphore in the
issue-closing design.

### Transport-wrapper feasibility checks

A focused prototype against the installed Undici 8.10.0 validated the smaller transport design.
Wrapping `Response.body` in a `TransformStream` preserved a 206 status and status text, an ETag,
and two distinct `Set-Cookie` headers; a 304 retained its null body; and a body crossing the cap
rejected at `.text()` before a complete string was returned. A local `undici.Client` response
adapted through `Readable.toWeb()` was destroyed when the cap rejected. Both `error` and `close`
can reach cleanup, so the per-request proxy-client teardown must be idempotent.

The same prototype exposed a compression distinction that the implementation must not hide. For
a 100,000-byte uncompressed body served as 133 bytes of gzip, `undici.fetch()` exposed 100,000 body
bytes while `Client.request()` exposed the 133 compressed bytes. Therefore the BTP adapter must
either stream-decompress before applying the shared cap, or request `Accept-Encoding: identity`
and reject an unexpected non-identity `Content-Encoding`; counting compressed proxy bytes would
create a large expansion bypass. This agrees with Undici's requirement that every Client response
body be consumed or destroyed and that `Client.close()` waits for enqueued requests to complete;
see the official [Dispatcher documentation](https://github.com/nodejs/undici/blob/main/docs/docs/api/Dispatcher.md#dispatcherclosecallback).
`Readable.toWeb()` is stable since Node 22.17, below ARC-1's 22.19 floor; see the
[Node stream documentation](https://nodejs.org/download/release/v22.19.0/docs/api/stream.html#streamreadabletowebstreamreadable-options).

### Cloud Foundry sizing

The shipped `mta.yaml` allocates 512 MiB and starts Node with
`--max-old-space-size=448`, described as leaving 64 MiB headroom. A read-only CF inspection showed
the available test instance at the same 512 MiB size and about 108 MiB RSS while idle.

Node documents that `--max-old-space-size` limits only V8's old-memory section and explicitly
recommends leaving memory for other uses. See
[Node's CLI documentation](https://nodejs.org/download/release/v22.19.0/docs/api/cli.html#--max-old-space-sizesize-in-mib).
The current Cloud Foundry Node buildpack's optional memory optimization uses 75% of available
memory, not 87.5%; see its
[`bin/release`](https://github.com/cloudfoundry/nodejs-buildpack/blob/master/bin/release).
ARC-1 also needs young-generation heap, external buffers, native libraries, HTTP buffers, and
platform process overhead. The existing 64 MiB comment is therefore not a valid total-process
headroom calculation.

Node added `--max-old-space-size-percentage` in 22.21.0, but ARC-1's `package.json` permits
Node >=22.19. Using the percentage flag in `mta.yaml` without also raising the runtime floor can
therefore make an otherwise supported deployment fail at process startup. The implementation also
falls back from `uv_get_constrained_memory()` to total host memory when the constrained value is
unavailable; that is a code-path risk, not an observed failure on the target Diego environment.
Neither risk is justified here because the MTA memory and command are maintained together. Use the
fixed 384 MiB value. See the
[Node 22.21.0 release notes](https://nodejs.org/en/blog/release/v22.21.0) and the
[percentage implementation](https://github.com/nodejs/node/blob/v22.21.1/src/node_options.cc#L2381-L2435).

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
| Stream-count post-content-decoding response bytes | **Yes** | No; it bounds each/cumulative tool result, not the process | Moderate, release-neutral | Primary individual-call boundary |
| Dedicated data concurrency = 4 | No | Bounds the guarded data phase to the configured cap | Queues only data work; configurable | Required aggregate boundary |
| Parse rows and metrics once | No | Reduces amplification | About 52 MiB saved in the measured one-call fixture | Land first as lower-risk mitigation |
| SAX/streaming XML parser | Can reduce amplification | Helps | High complexity; final row result still occupies memory | Follow-up optimization |
| Return files/object-store links | Avoids MCP result size | Depends on writer | Data governance, lifecycle, and authorization design required | Separate feature, not this fix |

## Recommended implementation

### A. One request-scoped post-content-decoding body budget

Add a server configuration property provisionally named
`ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES`, default `1048576` (1 MiB). It is a server-wide safety
ceiling, not a destination property and not user-expandable through scopes. An explicit operator
may raise it for a larger deployment; if disabling it is supported, `0` must be documented as an
unsafe opt-out. Bulk/file consumers should use an explicitly sized deployment override rather than
causing the shared MCP default to absorb multi-megabyte row sets.

Create a small request-scoped budget object with `limitBytes` and `consumedBytes`. Pass the same
object through every data-preview request made by one tool call, including automatic IN-list
chunks. Count the response-body `Uint8Array` chunks emitted by the HTTP transport **after any
content decoding/decompression and before UTF-8 string conversion**. This is neither the encoded
`Content-Length` nor JavaScript string length. For each body, retain its starting cumulative count,
check `start + seen` as chunks arrive, and commit the new cumulative count only when a successful
body is fully read. Non-success and discarded retry bodies use the same hard per-response ceiling
but do not reduce the later successful-result allowance. When the next chunk would cross its
applicable limit, cancel upstream, discard accumulated chunks, and throw a typed
`AdtResponseLimitError`. Do not include the SQL, response prefix, or row values in the error or
audit event.

The data operation must attach this budget explicitly through request/client options. The HTTP
layer must not infer policy by matching `/datapreview/{ddic,freestyle}` path strings: path sniffing
would be fragile under endpoint variants, retries, and future callers. The explicit object is also
what makes all chunks in one outer tool call share the same cumulative allowance.

Keep the existing Fetch `Response` contract. Inside `doFetch()`, immediately before returning
either branch, pass the response through one `capResponseBody(response, budget)` helper. The helper
wraps a non-null `response.body` with a `TransformStream`, preserves status, status text, headers
(including multiple `Set-Cookie` values and ETags), and passes 204/205/304 null bodies through.
Existing initial and retry `.text()` call sites then cannot bypass the cap, so this avoids a
high-risk transport return-type rewrite across all response consumers.

For the BTP branch, convert `resp.body` with `Readable.toWeb()` and construct the `Response` around
that live stream; do not call `resp.body.text()` or round-trip a complete string through a second
`Response`. Because `doProxyRequest()` creates one short-lived `undici.Client` per request, it must
also transfer client ownership to the returned stream. Close or destroy the client exactly once
when the underlying body ends, errors, or is cancelled—including cancellation caused by the byte
cap. The current `finally { await client.close(); }` cannot remain around a returned live body:
`Client.close()` waits for response bodies to finish, while the caller cannot consume the body
until `doProxyRequest()` returns. Preserve abort/deadline behavior and cancel upstream on failure.
For request-scoped data budgets, prefer `Accept-Encoding: identity` and reject an unexpected
encoded response unless the adapter adds a streaming decoder before `capResponseBody()`; low-level
`Client.request()` does not provide Fetch's automatic decompression.

Suggested client-facing result:

```json
{
  "error": "DATA_RESPONSE_TOO_LARGE",
  "message": "The SAP data-preview result exceeded the 1 MiB server limit. Lower maxRows, select fewer columns, or add a restrictive/key-range WHERE clause, then retry.",
  "limitBytes": 1048576,
  "retryable": true,
  "requestId": "..."
}
```

This should be a normal failed tool call; the process and unrelated MCP requests remain healthy.
Do not automatically rerun with a lower limit: that repeats SAP work, still cannot infer row width,
and may surprise callers with silently different query semantics.

### B. A data-result semaphore held across the expensive phase

Add a shared process-wide `Semaphore`, provisionally configured by
`ARC1_MAX_CONCURRENT_DATA_RESULTS` with default `4`. Thread it through every `AdtClient` in the
same way as `adtSemaphore`, including request-local principal-propagation and multi-target clients.
Acquire it outside the complete data handler and release only after rows and compact tool JSON have
been built or an error returned. The wait must honor the MCP/ADT request abort signal.

Do not reuse or lower `ARC1_MAX_CONCURRENT`: that limiter protects SAP dialog work processes and
has different sizing semantics. A separate FIFO queue keeps ordinary source reads concurrent
while bounding admitted data work across every target. Default 4 is a compromise between the
measured ten-call representative case and head-of-line blocking in `/<target>/...` and `/multi/mcp`;
it is not evidence that four arbitrary near-limit SAP results always fit 512 MiB.

Treat the product of the two knobs as an explicit raw-body admission envelope: the defaults are
`4 × 1 MiB = 4 MiB` before parser/result amplification. Raising
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
`--max-old-space-size=384`. Update the comment so it does not describe old-space headroom as
total-process headroom. Do not use `--max-old-space-size-percentage`: the flag is newer than
ARC-1's declared minimum Node version, and its total-host-memory fallback adds a failure mode that
buys little while `memory:` and `command:` live in the same MTA module. Consider raising the
generic direct-push manifest from 256 MiB after measuring its real startup and bounded query peaks.

Do not make a larger instance the only remediation. Keep the reporter's 2 GiB allocation during
rollout, then choose instance memory from observed bounded peaks and user concurrency rather than
assuming the guard makes 512 MiB universally sufficient.

## Landing sequence and compatibility

Use two implementation PRs so the measured low-risk reductions can land without weakening the
definition of done for #737:

1. **Mitigation PR — does not close #737:** combine the one-pass rows/metrics parser, sink-level
   10,000-row clamp for raw and chunked `SAPQuery`, and fixed `448` → `384` MiB old-space change.
   The parser change is intended to preserve results. The clamp and heap setting are deliberate
   behavior/operational changes, although the clamp matches the silent, graceful policy already
   used by `TABLE_CONTENTS` and `TABLE_QUERY` after #388.
2. **Issue-closing PR:** add the explicitly threaded 1 MiB cumulative body budget in the shared
   direct/BTP response-stream wrapper, remove the proxy's second body conversion with correct
   stream-owned client teardown, and add the shared
   data-result semaphore. Neither the byte budget nor the semaphore should be reviewed away as an
   optional optimization; together they are the individual-call and aggregate admission controls.

Use the project's normal `fix:` convention for the resource-safety work. Independently of commit
type, the release notes and upgrade guidance must prominently say that:

- raw `SAPQuery.maxRows` values above 10,000 are now clamped;
- successful results above the default 1 MiB cumulative post-content-decoding body ceiling now
  fail with an actionable error;
- operators serving intentional batch/file consumers can raise the ceiling after sizing memory
  and data concurrency; and
- `0`, if implemented, disables an important safety boundary and is not recommended.

## Affected files

Expected implementation surface:

- `src/adt/http-deadline.ts` — carry the optional response budget/request context;
- `src/adt/http.ts` — one bounded `Response.body` stream wrapper applied inside `doFetch()` to the
  direct and proxy branches; expose the BTP `BodyReadable` as a Web stream, remove its string →
  `Response` → string round-trip, and close the per-request proxy client on end/error/cancel;
- `src/adt/errors.ts` — typed response-limit error with secret-free fields; add it to both HTTP
  pass-through catches so it is not accidentally reclassified as `AdtNetworkError`;
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
- `AGENTS.md` — add the response-limit type to the documented canonical ADT error set.

No ADT feature discovery or SAP release gate is needed.

## Required tests

1. **Bounded response stream:** missing `Content-Length`, exact boundary, first chunk over boundary,
   later chunk over boundary, UTF-8 split across chunks, body cancellation, reader errors, and a
   cheap identity-body header rejection. Run the same cases through direct Fetch and the BTP
   Connectivity proxy adapter. Preserve status, status text, ETag, multiple `Set-Cookie` headers,
   and null-body 204/205/304 responses. Assert the proxy body is read exactly once, its per-request
   client closes exactly once on end/error/cancel, and the parser is never called after an
   over-limit response. Assert the budget is activated by explicit request context rather than URL
   matching, and that an unrelated large response cannot accidentally consume it.
2. **Retry coverage:** 401, 429, 503, and content-negotiation retry responses cannot bypass a hard
   per-response ceiling. Assert that discarded error/retry bodies do not consume the cumulative
   successful-result allowance, while no individual body can be read without a bound.
3. **Aggregate chunking:** several individually sub-limit IN-list responses cross the cumulative
   tool budget and fail without retaining/serializing the combined rows.
4. **Row limits:** raw, single-statement, and chunked `SAPQuery` all clamp at the sink to 10,000;
   NaN, infinity, fractions, zero, and negatives retain the existing fallback semantics.
5. **Parser equivalence:** old ASX and current data-preview fixtures produce identical rows and
   metrics through the one-parse function, including empty/null values.
6. **Concurrency:** five data calls never exceed the default data-result concurrency of four; an
   ordinary source read is not queued behind them; the semaphore is shared across per-user, pinned,
   and aggregate multi-target clients; queued work for a second target progresses in FIFO order as
   a slot frees; aborted waiters leave no slot leak. Also test a non-default value so the assertion
   proves configuration plumbing rather than hard-coded behavior.
7. **Error contract:** single-target and multi-target routes return a stable, secret-free,
   actionable error and keep the request ID. Minimal-error mode must not hide the operator-defined
   limit or remediation.
8. **Deployment/config:** default, env, CLI precedence, invalid values, MTA heap ratio, and docs are
   synchronized. Run startup coverage on the minimum supported Node version so a deployment flag
   cannot exceed the declared engine floor again.
9. **Live regression:** against the 758 system, run five parallel `TADIR` queries that cross the
   test cap. The calls must fail or queue individually under the default four-call admission cap,
   `/health` and a subsequent small query must succeed, and CF/local RSS must remain below the test
   envelope. Repeat through a CF principal-propagation route without using production BW data.

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
- Do not silently return a partial result as if it were complete. If a future truncated mode is
  added, it needs explicit `truncated`, returned/total counts, and continuation semantics.
- Do not store query results on CF's ephemeral filesystem as the default workaround. A durable
  result-link feature would require separate storage, retention, authorization, and audit design.
- Do not use `process.availableMemory()` as the primary admission decision; although stable in
  the required Node runtime, it is a racy snapshot under parallel allocation.

**Recommendation:** accept #737 and implement the layered fix above. Treat the streaming cumulative
byte budget and dedicated data semaphore together as the issue-closing boundary. Land the
one-pass parser, raw row clamp, and fixed CF heap correction first as a lower-risk mitigation, then
ship the two admission controls together. They address independently measured amplifiers and make
the default 512 MiB topology defensible. Revisit a SAX/columnar response path only as a later
performance feature.
