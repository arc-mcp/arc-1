# Rate limiting

<a id="rate-limiting-guide"></a>

Use rate limits to control incoming traffic and concurrency limits to control work sent to SAP.
For a shared server, first agree on a SAP capacity budget, then tune user and HTTP quotas from audit logs.

## 1. Why ARC-1 rate-limits

One MCP call can trigger several SAP requests. ARC-1 limits traffic at three points:

| Boundary | Default | When full |
|---|---|---|
| HTTP edge, per IP | OAuth: 20/min; MCP: 600/min | HTTP `429` with `Retry-After` |
| MCP calls, per user | Off | Tool error with `retryAfter` |
| SAP HTTP requests, process-wide | 10 concurrent | Wait in a shared queue |

All limits are per process. More instances increase the fleet's possible traffic.

## 2. The rate and concurrency settings in plain English

### `ARC1_AUTH_RATE_LIMIT` — Layer 1 (default `20`)

Caps requests per minute per IP to `/register`, `/authorize`, `/token`, `/revoke` and `/oauth/callback`.
`0` disables the OAuth limit only; keep it enabled unless an upstream service protects those routes.
A denial emits `auth_rate_limited` with the OAuth endpoint.

### `ARC1_MCP_HTTP_RATE_LIMIT` — Layer 1 MCP override (default unset)

Caps MCP HTTP requests per minute per IP. Unset uses `max(ARC1_AUTH_RATE_LIMIT × 30, 600)`;
a positive integer replaces that value; `0` disables this bucket only.

One bucket covers `/mcp`, all pinned routes, `/multi/mcp` and Copilot JSON-RPC sent to `/authorize`.
Normal OAuth requests to `/authorize` use the OAuth bucket.
MCP denials use the audit label `endpoint="/mcp"`, regardless of the actual route.

### `ARC1_RATE_LIMIT` — Layer 2 (default `0` — DISABLED)

Caps tool calls per minute per authenticated user. Use a positive value when shared access needs fairness;
stdio calls without authentication context are exempt.

The user key prefers `userName`, `email`, `sub`, `preferred_username`, then `clientId` and finally an anonymous fallback.
Users falling back to the same client/profile identity share a quota. API-key callers with the same profile can therefore share a bucket.

A denied call returns an MCP tool error, not HTTP `429`:

```json
{"error":"rate_limited","retryAfter":47,"message":"Rate limit exceeded (60/min per user). Retry after 47 seconds."}
```

`retryAfter` is seconds rounded up. Multi-target quota checks run before destination lookup or SAP probes;
`SAPTargets` consumes quota without calling SAP.

### `ARC1_MAX_CONCURRENT` — Layer 3 (default `10`)

Caps in-flight SAP HTTP requests across all clients in one ARC-1 process, including every PP user.
Excess requests wait; reaching this cap does not itself return `429`.

When SAP or a gateway responds with `429`/`503`, ARC-1 can retry once using `Retry-After`, clamped to 60 seconds,
or its fallback delay. Reduce concurrency if throttling is persistent.

### Data-result memory admission (defaults: 2 MiB and `2` calls)

These separate limits protect memory:

| Setting | Limit |
|---|---|
| `ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES` | Cumulative successful data-preview body bytes per tool call |
| `ARC1_MAX_CONCURRENT_DATA_RESULTS` | Concurrent data calls retained through fetch, parse, serialization and audit |

The default raw-body product is `2 MiB × 2 = 4 MiB`. Parsing and serialization use additional memory;
this is not an RSS guarantee. Both values require positive integers; `0` does not disable them.
Before raising either, measure peak RSS and follow [BTP RAM sizing](btp-administration.md#data-preview-ram-sizing).

## 3. Capacity sizing math against `rdisp/wp_no_dia`

Ask Basis for the dialog-work-process count and the share available to ARC-1. On on-premise SAP,
`RZ11` shows `rdisp/wp_no_dia`. Include other consumers and every ARC-1 process that can reach the backend.

For an agreed budget of 24 simultaneous requests and two ARC-1 processes:

```text
ARC1_MAX_CONCURRENT = floor(24 / 2) = 12 per process
```

Allocating 60% of dialog processes is a starting estimate, not a universal safe allocation.
For example, Basis might allocate `floor(0.6 × 40) = 24` from a 40-process pool.
HTTP concurrency is not an exact work-process guarantee: validate the budget using SAP workload and latency measurements.

On BTP ABAP, use platform quota and throttling evidence. Start with the default `10` or lower;
raise it only after measurement.

## 4. Recommended settings by team size

<a id="small-team-5-developers-dev-sandbox-or-single-user"></a><a id="medium-team-520-developers-shared-sandbox"></a><a id="large-team-20100-developers-multiple-arc-1-instances-behind-a-load-balancer"></a>

User count alone does not determine SAP capacity. Start with:

| Deployment | First action |
|---|---|
| Single local user | Keep HTTP/user quotas at defaults; lower SAP concurrency for a constrained backend |
| Shared team | Start with `ARC1_RATE_LIMIT=120`, then measure legitimate batch work and queueing |
| Several ARC-1 instances | Divide the agreed SAP budget across all processes; account for per-process HTTP/user quotas |
| Many users behind one corporate IP | Inspect `auth_rate_limited` before changing the relevant per-IP cap |

<a id="multi-target-shared-beta-btp-cf"></a>

### Multi-target shared beta (BTP CF)

Each process has one SAP request queue shared by all targets. For every backend:

```text
sum(ARC1_MAX_CONCURRENT for every process that can reach that backend)
  <= agreed concurrent-request budget for that backend
```

Use the most constrained target when assigning a common process cap. Multiple SAP clients on one SID
may share the same dialog pool; confirm with Basis. Split deployments when backend capacities need different limits.
Shared Basic multi-target permits exactly one instance, including during updates.

These multi-target starting values allow corporate login bursts and per-user fairness. They do
not increase the SAP concurrency budget:

| Active users | `ARC1_AUTH_RATE_LIMIT` | `ARC1_MCP_HTTP_RATE_LIMIT` | `ARC1_RATE_LIMIT` |
|---:|---:|---:|---:|
| 1–5 | 30 | 1,000 | 120 |
| 6–20 | 60 | 3,000 | 120 |
| 21–50 | 120 | 7,500 | 180 |
| 51–100 | 240 | 20,000 | 180 |

Measure denials, queueing and latency before raising them. Repeated pinned OAuth connections can create login bursts. An aggregate endpoint can reduce the number of
connections when a user needs several targets; a pinned endpoint fixes the target while an aggregate call requires explicit selection.

## 5. Audit events

| Event | Meaning | Action |
|---|---|---|
| `auth_rate_limited` | HTTP quota reached | Check IP and `endpoint`; tune OAuth or MCP quota separately |
| `mcp_rate_limited` | User quota reached | Check for a retry loop before increasing the quota |
| `http_request` with `429` | SAP/gateway throttling | Reduce concurrency or investigate upstream quota |
| `http_request` with `503` | Upstream service unavailable or overloaded | Check SAP/gateway health; lower concurrency if overload is confirmed |
| `data_response_limited` | Data call exceeded byte limit | Reduce rows/columns; resize only after memory testing |

Tool-level events carry `requestId`. HTTP-edge denials happen before the MCP context, so correlate them by IP and timestamp.

## 6. Troubleshooting decision tree

| Symptom | Check |
|---|---|
| MCP client receives HTTP `429` | `auth_rate_limited.endpoint`: `/mcp` means the shared MCP bucket; another OAuth path means the OAuth bucket |
| Tool result says `rate_limited` | User/profile quota and client retry behavior |
| Tool waits without a quota error | SAP duration and concurrent work; requests may be queued |
| SAP work processes are saturated | Lower concurrency; review the fleet budget with Basis |
| Requests from all users look like one IP | Proxy forwarding and corporate egress before raising the per-IP limit |

## 7. Disabling each layer

| Limit | Disable |
|---|---|
| OAuth HTTP | `ARC1_AUTH_RATE_LIMIT=0` |
| MCP HTTP | `ARC1_MCP_HTTP_RATE_LIMIT=0` |
| Per-user tools | `ARC1_RATE_LIMIT=0` |
| SAP concurrency | No disable switch; set a positive capacity limit |

Disable HTTP protection only when the same endpoints are protected upstream.

## 8. Multi-instance considerations

HTTP and user quotas are in memory. With N non-sticky instances, callers may receive up to N times the
configured allowance. Sticky routing can change distribution but does not create a shared limiter.
For a hard fleet-wide quota, enforce it at the gateway.

## 9. Operational checklist

1. Agree on backend capacity and allocate it across all ARC-1 processes.
2. Configure per-user fairness where needed.
3. Verify the proxy reports the intended source IP.
4. Exercise representative traffic and inspect denials, queueing, SAP latency and peak RSS.
5. Save final values in the durable deployment configuration.

## See also

<a id="10-codeql-compliance"></a>

- [Configuration Reference](configuration-reference.md) — flags, defaults and validation
- [Log Analysis](log-analysis.md) — audit queries
- [ADR-0004](https://github.com/arc-mcp/arc-1/blob/main/docs/adr/0004-layered-rate-limiting.md) — design rationale
