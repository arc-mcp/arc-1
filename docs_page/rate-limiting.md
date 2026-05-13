# Rate Limiting Guide

This is the single source of truth for ARC-1's rate limiting. Read this end-to-end before tuning anything.

---

## 1. Why ARC-1 rate-limits

100 developers on Eclipse type at human speeds. 100 developers steering ARC-1 from an LLM fire batch tool calls every 1–3 seconds. The aggregate request rate from ARC-1 can be **10–50× higher than the equivalent Eclipse workload** — and the same SAP dialog-work-process pool absorbs both.

Three layers gate this traffic, each addressing a distinct threat:

| | Layer 1 — HTTP edge | Layer 2 — Per-user MCP quota | Layer 3 — SAP-bound semaphore |
|---|---|---|---|
| **Protects against** | OAuth brute-force / `/mcp` probing | One developer monopolizing slots | SAP work-process exhaustion |
| **Keyed on** | Source IP | Authenticated user (`userName`/`clientId`) | (global) |
| **Mechanism** | `express-rate-limit` token bucket | `rate-limiter-flexible` token bucket | FIFO `Semaphore` |
| **On hit** | HTTP `429` + `Retry-After` | MCP tool error with `retryAfter` | Queue wait (no rejection) |
| **Audit event** | `auth_rate_limited` | `mcp_rate_limited` | `http_request` status 429/503 |
| **Env var** | `ARC1_AUTH_RATE_LIMIT` | `ARC1_RATE_LIMIT` | `ARC1_MAX_CONCURRENT` |

```
   ┌──────────────────────────────────────────────────────────┐
   │ Layer 1 — HTTP edge (per-IP)                             │
   │   express-rate-limit on /register /authorize /token      │
   │                       /revoke /mcp                       │
   │   ARC1_AUTH_RATE_LIMIT (default 20/min/IP)               │
   └──────────────────────────────────────────────────────────┘
                              │
   ┌──────────────────────────────────────────────────────────┐
   │ Layer 2 — Per-user MCP quota (token bucket)              │
   │   Applied inside handleToolCall                          │
   │   ARC1_RATE_LIMIT (default 60/min/user)                  │
   └──────────────────────────────────────────────────────────┘
                              │
   ┌──────────────────────────────────────────────────────────┐
   │ Layer 3 — SAP-bound shared semaphore (FIFO queue)        │
   │   ONE Semaphore for the whole process, all clients share │
   │   Honors Retry-After on 429/503                          │
   │   ARC1_MAX_CONCURRENT (default 10, server-wide)          │
   └──────────────────────────────────────────────────────────┘
                              │
                       SAP work processes
```

## 2. The three env vars in plain English

These are all the knobs you have. Set values via env vars, CLI flags, or `.env`. The default is conservative — most operators never need to tune these.

### `ARC1_AUTH_RATE_LIMIT` — Layer 1 (default `20`)

**What it caps.** Requests per minute, per source IP, to the OAuth endpoints (`/register`, `/authorize`, `/token`, `/revoke`). `/mcp` gets a separately-derived higher cap (`max(value × 30, 600)/min/IP`) to absorb legitimate MCP batch traffic while still gating anonymous probing.

**Copilot Studio note.** Copilot Studio POSTs MCP JSON-RPC bodies to `/authorize` instead of `/mcp` (a documented quirk of that client). On `/authorize`, ARC-1 stacks two `express-rate-limit` middlewares — one with the OAuth cap (skips Copilot JSON-RPC), one with the `/mcp` cap (only counts Copilot JSON-RPC). Each request increments exactly one bucket. Real OAuth `/authorize` flows are still rate-limited at the OAuth cap; legitimate Copilot tool calls flow through at the higher `/mcp` cap. The two `/mcp`-capped buckets (one for direct `/mcp`, one for `/authorize` JSON-RPC) are stored independently — at default config a malicious client alternating routes effectively gets `2 × max(authRateLimit × 30, 600)/min/IP` = 1200/min, still well below abuse thresholds.

**What happens on hit.** HTTP `429 Too Many Requests` with `Retry-After` and RFC 9331 `RateLimit-Limit, remaining, reset` headers. Emits one `auth_rate_limited` audit event per denial.

**When to tune.**
- Increase if you operate an automated security scanner or load test against the OAuth surface from one IP.
- Set to `0` only if an upstream reverse proxy already rate-limits this surface.
- Per-endpoint differentiation lives in code (not env) so the operator surface stays one knob. If the per-endpoint logic needs adjustment, it's a code change in [src/server/http.ts](https://github.com/marianfoo/arc-1/blob/main/src/server/http.ts).

### `ARC1_RATE_LIMIT` — Layer 2 (default `60`)

**What it caps.** MCP tool calls per minute, per authenticated user. Stdio mode (no `authInfo`) is exempt entirely — there's no user identity to key on, and stdio is single-user-by-design.

**User-key derivation** walks identity claims most-specific-first so users sharing an OAuth `azp` (app id) never collapse into one bucket:

1. `extra.userName` — XSUAA logon name (`SecurityContext.getLogonName()`).
2. `extra.email` — XSUAA email or any OIDC token that populates the claim.
3. `extra.sub` — OIDC subject. Guaranteed unique per user within an issuer. **This is the critical hop for OIDC** — without it, distinct users on the same OAuth app would all share `clientId = azp`.
4. `extra.preferred_username` — sometimes set on OIDC tokens.
5. `clientId` — last resort. For OIDC this is `azp`, for API keys it's `api-key:<profile>`. Falling here means everyone using that client/profile shares one bucket; tune `ARC1_RATE_LIMIT` accordingly or configure auth so an earlier candidate is populated.
6. `'__anon__'` — token with no usable identity. Shared bucket for anonymous traffic; production deployments should configure auth so this branch is never reached.

**What happens on hit.** An MCP **tool error** (not HTTP 429) with structured content:
```json
{ "error": "rate_limited", "retryAfter": 47, "message": "Rate limit exceeded (60/min per user). Retry after 47 seconds." }
```
`retryAfter` is in **seconds**, rounded up. The LLM client surfaces this as a tool failure, and the agent loop backs off via its own retry policy. Emits one `mcp_rate_limited` audit event per denial.

**Why not HTTP 429?** Because the MCP transport carries tool results, not HTTP status codes. Returning 429 at the HTTP layer would mean *"the whole MCP session failed"* rather than *"this one tool call failed"* — Layer 1 already does the former; Layer 2 needs to fail this one call so the agent retries it.

**When to tune.**
- Increase if a single user does legitimate heavy batch work (60/min = 1/sec sustained, with bucket-refill burst tolerance).
- Set to `0` for single-user deployments or when you trust the upstream client to self-throttle.

### `ARC1_MAX_CONCURRENT` — Layer 3 (default `10`)

**What it caps.** Concurrent in-flight SAP HTTP requests, **server-wide across all users**. Excess requests wait in a FIFO queue — no rejection. With principal propagation, one shared semaphore enforces the cap across all per-user clients, NOT `10` per user.

**What happens on hit.** New requests wait. No 429 is emitted. Wait time depends on how fast in-flight requests release the slot.

**Retry-After honoring.** When SAP or an upstream gateway (Web Dispatcher, BTP API Management) returns `429`/`503` with a `Retry-After` header, ARC-1 waits the indicated duration (clamped to `[0, 60_000]` ms) and retries once. The audit event includes `source: header` or `source: fallback` so you can see whether the wait came from the server or our jitter floor.

**When to tune.** Use the sizing math below.

## 3. Capacity sizing math against `rdisp/wp_no_dia`

The hard ceiling on the SAP side is the dialog-work-process count, configurable via the SAP profile parameter `rdisp/wp_no_dia`. Find your system's value with transaction `RZ11` → search `rdisp/wp_no_dia`.

**Rule of thumb:** reserve about 60% of dialog WPs for the ARC-1 fleet total. The remaining 40% stays available for Eclipse, SAPGUI, batch users, and headroom against bursts.

**Formula:**
```
ARC1_MAX_CONCURRENT = floor(0.6 × wp_no_dia / N_instances)
```

**Worked example.** SAP system with `rdisp/wp_no_dia=40`, two ARC-1 instances behind a load balancer:
```
ARC1_MAX_CONCURRENT = floor(0.6 × 40 / 2) = 12 per instance
```

Total ARC-1 fleet uses ≤ 24 dialog WPs out of 40, leaving 16 (40%) for everyone else.

**BTP ABAP Environment / Steampunk.** The platform enforces its own quotas (BTP API Management policies and platform-side throttling). Start with `ARC1_MAX_CONCURRENT=20` per instance and watch for `http_request` audit events with `statusCode=429` and `source: header` — those are the gateway actively throttling you. Lower the cap until they stop.

## 4. Recommended settings by team size

Copy-paste these into `.env` or your deployment env block.

### Small team (≤5 developers, dev sandbox)

Defaults are fine. No action required.
```bash
# (no rate-limit env vars set — defaults apply)
# ARC1_AUTH_RATE_LIMIT=20
# ARC1_RATE_LIMIT=60
# ARC1_MAX_CONCURRENT=10
```

### Medium team (5–20 developers, shared sandbox)

```bash
ARC1_MAX_CONCURRENT=15
ARC1_RATE_LIMIT=90
# Layer 1 default is fine — OAuth surface doesn't scale with developer count
```

### Large team (20–100 developers, multiple ARC-1 instances behind a load balancer)

Use the sizing math above. Example for `wp_no_dia=60`, four instances:
```bash
ARC1_MAX_CONCURRENT=9      # floor(0.6 × 60 / 4)
ARC1_RATE_LIMIT=120        # 2/sec/user sustained
# ARC1_AUTH_RATE_LIMIT=20  # default still fits
```

## 5. Audit events

| Event | Layer | Meaning | What to do |
|-------|-------|---------|------------|
| `auth_rate_limited` | 1 | OAuth or `/mcp` endpoint hit the per-IP cap. Usually OAuth probing; legitimate spikes happen during deploy storms. | If frequent from one IP → probe attack, investigate. If from many IPs → raise `ARC1_AUTH_RATE_LIMIT`. |
| `mcp_rate_limited` | 2 | A single user hit the per-user quota. Their LLM was in a tight retry loop or doing heavy batch work. | Check user behavior. If legitimate → raise `ARC1_RATE_LIMIT`. If runaway loop → the limit is working as designed. |
| `http_request` status `429` | 3 | SAP or BTP gateway throttled us; we retried once after honoring `Retry-After`. | If frequent → lower `ARC1_MAX_CONCURRENT`. You're running too hot. |
| `http_request` status `503` | 3 | SAP overloaded (ICM / work-process exhaustion); we retried. | Same as 429 — lower the concurrency cap. Cross-check with SAP transaction `SM50`. |

Event payloads include `requestId` so you can correlate a rate-limit denial with the full tool-call lifecycle in your audit log.

## 6. Troubleshooting decision tree

> *"My MCP client returns HTTP 429."*
**Layer 1.** Check `auth_rate_limited` audit events. If the IP is yours, raise `ARC1_AUTH_RATE_LIMIT` or set to `0` if an upstream proxy handles it. If the IP is unknown, that's probably abuse — leave the limiter alone.

> *"My MCP client returns a tool error with `\"error\":\"rate_limited\"`."*
**Layer 2.** Check `mcp_rate_limited` audit events for the affected user. If they're doing legitimate batch work, raise `ARC1_RATE_LIMIT`. Don't increase it just because *any* `mcp_rate_limited` event fires — that's the limit doing its job during a retry storm.

> *"SAP transaction `SM50` shows work-process exhaustion from ARC-1."*
**Layer 3** is too loose. Lower `ARC1_MAX_CONCURRENT`. Use the sizing math.

> *"SAP transaction `SM21` shows ICM thread exhaustion."*
ARC-1 isn't the only consumer. Either tune at the SAP profile (`icm/max_threads`) or lower `ARC1_MAX_CONCURRENT` further to be a better citizen.

> *"My audit log has many `http_request` 429 events with `source: header`."*
A gateway (SAP Web Dispatcher / BTP API Management) is actively throttling ARC-1. You're running too hot. Lower `ARC1_MAX_CONCURRENT`.

> *"Audit log has `http_request` 429 with `source: fallback`."*
No `Retry-After` header — gateway returned a bare 429. Same action as `source: header` (lower the concurrency cap), but the gateway isn't telling you how long to wait.

## 7. Disabling each layer

| Layer | How to disable |
|-------|----------------|
| 1 | `ARC1_AUTH_RATE_LIMIT=0`. Use only when an upstream reverse proxy already rate-limits the OAuth surface. |
| 2 | `ARC1_RATE_LIMIT=0`. Use for single-user deployments or when the upstream client self-throttles. |
| 3 | No on/off switch. Lower the cap to throttle harder; raise it to allow more. The cap exists to protect SAP from ARC-1, not the other way around — never set it disproportionately high. |

## 8. Multi-instance considerations

All three layers use **per-instance, in-memory state** — no Redis, no shared store. With `N` instances behind a load balancer:

- **Layer 1**: effective ceiling is `N × ARC1_AUTH_RATE_LIMIT` per IP. Plenty of room for normal OAuth flows; multi-instance attackers cost `N × limit`.
- **Layer 2**: effective ceiling is `N × ARC1_RATE_LIMIT` per user, **only when the load balancer is not sticky**. If sticky, each user is pinned to one instance and the per-instance cap is the effective cap.
- **Layer 3**: each instance has its own cap. Size as `floor(target / N)` per instance using the sizing math.

The rationale for per-instance is recorded in [ADR-0004](../docs/adr/0004-layered-rate-limiting.md) — per-instance preserves the stateless deployment property won by PR #212 (stateless DCR).

## 9. Operational checklist

For deployments with >5 developers, walk through this once at deploy time:

1. Find `rdisp/wp_no_dia` via SAP transaction `RZ11`.
2. Compute `ARC1_MAX_CONCURRENT = floor(0.6 × wp_no_dia / N_instances)`. Set it explicitly in your deployment env — don't rely on the default.
3. Decide the per-user cap. The default `ARC1_RATE_LIMIT=60` (1/sec sustained) is fine for most cases.
4. Decide on Layer 1. Default `20/min/IP` is fine unless you have a security scanner or load-tester whose IP would hit the cap.
5. Watch `auth_rate_limited`, `mcp_rate_limited`, and `http_request` (statusCode 429/503) for the first week. Tune up if false positives; tune down if SAP overload.
6. If you're on BTP ABAP environment, also watch for `http_request` with `statusCode: 429` and `source: header` — that's the BTP API Management gateway throttling you, signalling Layer 3 is too loose.

## 10. CodeQL & compliance

Layer 1 closes CodeQL alert `js/missing-rate-limiting` on `/authorize` (alert #12 in the GitHub Security UI, previously dismissed with rationale *"tracked in SEC-05"*). After this ships, the alert auto-closes on the next scan.

## See also

- [Configuration Reference](configuration-reference.md) — flat reference for every env var ARC-1 reads
- [Security Guide](security-guide.md) — broader security model and the full audit-event list
- [Architecture](architecture.md) — request flow and layer ordering
- [ADR-0004 Layered Rate Limiting](../docs/adr/0004-layered-rate-limiting.md) — design rationale and rejected alternatives
