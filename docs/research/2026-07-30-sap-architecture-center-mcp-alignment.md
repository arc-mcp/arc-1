# SAP Architecture Center: "Third-Party MCP Access to SAP Solutions" — ARC-1 alignment

**Date:** 2026-07-30
**Source:** [architecture.learning.sap.com/docs/ref-arch/137800](https://architecture.learning.sap.com/docs/ref-arch/137800)
**Related SAP pages:** [A2A and MCP for Interoperability](https://architecture.learning.sap.com/docs/ref-arch/76ec36) ·
[Agentic AI & AI Agents](https://architecture.learning.sap.com/docs/ref-arch/98efa0)
**Status:** historical July assessment; superseded for current policy and control conclusions.

> **Correction, 2026-10-21:** use the [current research dossier](2026-10-21-sap-api-policy-custom-mcp.md)
> and [public guidance](../../docs_page/sap-api-policy-and-architecture.md). SAP's FAQ Q56 supports
> custom MCP under conditions; Q33 gives explicit ADT-channel and data-use restrictions. Current
> SAP Help documents remote MCP proxying through Integration Suite. July's “Met” ratings below
> are historical judgments, not a current compliance score. In particular, user propagation does
> not establish registered agent identity or per-tool downstream scope; TLS, secrets, quotas and
> alerts require deployment evidence. The affected rows and rationale are corrected below.

---

## What the page is

Not a specification — a **permission-with-conditions**. SAP states that customers and partners may
use third-party MCP servers to reach SAP APIs *provided* the SAP API Policy (particularly General API
Controls) is honoured, authentication and authorization are enforced on every connection, underlying
API rate limits are respected, and the hardening it describes is in place. It then lists the
hardening.

ARC-1 sits in **both** patterns the page names — Pattern 1 (external MCP server on a third-party
platform: npm/Docker/stdio self-hosted) and Pattern 2 (custom MCP server on SAP BTP: the CF
deployment). In both, the page places full operational and security responsibility on the deployer.

Its sharpest technical claim is the one worth internalizing: wiring an MCP server straight onto raw
SAP transactional APIs, with no semantic layer, degrades entity-discovery accuracy, burns tokens, and
— on writes — risks producing incorrect business transactions.

That is ARC-1's founding thesis (design principle 3), not a new requirement — 12 intent tools over
200+ ADT endpoints, CI-budgeted schema payload, context compression.

---

## Point-by-point

Legend: **Met** · **Partial** (met with a stated boundary) · **Gap** (closed here) · **Deviates**
(evaluated and deliberately not implemented).

### Semantics

| # | SAP requirement | Verdict | ARC-1 |
|---|---|---|---|
| 1 | No raw-API exposure without semantic enrichment | **Met** | Intent tools, not endpoint mirrors. See design principle 3 in [AGENTS.md](../../AGENTS.md) |

**Caveat worth stating plainly:** ARC-1's domain is ABAP *development objects*, not business
transactions. SAP's "incorrect business transaction" risk (and the sagas/compensation argument that
follows from it) does not transfer literally — there is no GR/IR to unbalance. Its analogue is a
multi-step write that half-succeeds: `batch_create` failing at object 3 of 5, or an activation batch
failing after the objects are written. ARC-1 reports per-item `status: 'failed'` and explicitly flags
written-but-not-activated objects rather than rolling back, because **auto-deleting half-created
development objects destroys the evidence a developer needs to fix them**. See "Deliberate
deviations" below.

### Security

| # | SAP requirement | Verdict | ARC-1 |
|---|---|---|---|
| 2 | Authenticate every inbound request and every outbound API call | **Met** | XSUAA → OIDC → API key inbound; SAP-native (`S_DEVELOP`, `S_ADT_RES`) outbound. stdio is unauthenticated by design (local, single-user, scope checks skipped) |
| 3 | Never store long-lived credentials | **Partial** | PP is the documented default and the recommended production topology. Shared `SAP_USER`/`SAP_PASSWORD` remains supported for on-prem/stdio, and the ADR-0007 shared-Basic multi-target identity is default-off, mutation-free and one-instance. Both are operator choices with stated ceilings, not silent fallbacks |
| 4 | New downstream credentials instead of caller-token forwarding | **Partial; corrected 2026-10-21** | Destination-specific user-context exchange is supported. `OAuth2UserTokenExchange` / `OAuth2JWTBearer` are not interchangeable with `OAuth2TokenExchange` or universally RFC 8693. Connectivity-proxy PP is an intermediary flow; see the current dossier for agent/scope gaps. |
| 5 | Agent identity retained alongside user context | **Partial; corrected 2026-10-21** | Current PP preserves user context but does not establish a registered CIS agent identity in the downstream credential. `clientAgent` is a caller-controlled audit label. The earlier claim that ABAP universally has no agent-identity slot was unsupported. |
| 6 | Input validation and sanitization of all tool parameters | **Met** | Zod v4 schemas + `stripLlmEmptyValues` + invariant **I6** (per-segment URL encoding, SQL/XML escaping, header charset allowlists) |
| 7 | TLS 1.2+ on all connections | **Deployment-dependent** | Certificate validation defaults on; verify actual inbound/outbound TLS and configuration. Code defaults alone are not evidence that every deployed hop satisfies the requirement. |
| 8 | Dedicated secrets management (SAP Credential Store, Vault) | **Deviates** | Env vars + CF service bindings + Destination Service. See "Deliberate deviations" |
| 9 | OWASP MCP Top 10 mitigations | **Mapped, not certified** | See [security-model.md §9](../security-model.md#9-external-framework-mapping--owasp-mcp-top-10) and its residual risks; a mapping is not proof of comprehensive compliance. |

### Scalability and reliability

| # | SAP requirement | Verdict | ARC-1 |
|---|---|---|---|
| 10 | Downstream API quotas and per-consumer limits | **Deployment-dependent** | Limits exist; the user limit defaults off. Tool calls can fan out into many SAP requests and replicas multiply process-local allowances. Quota adherence requires workload and deployment evidence. |
| 11 | Timeouts and circuit breakers | **Partial** | HTTP timeouts and retry limits exist. No built-in circuit breaker; ordinary semaphore waits have no universal queue deadline. See the current dossier for the remaining gap. |
| 12 | Stateless design for horizontal scaling | **Met, with per-process state documented** | No session store; the MCP transport runs stateless and OAuth `client_id`s are HMAC-derived rather than stored. Rate limiters, feature probe and cache are per-process, and ADR-0007 shared-Basic requires exactly one instance. Consequences now documented in [deployment-best-practices.md](../../docs_page/deployment-best-practices.md#scaling-out-what-changes-at-more-than-one-instance) |

### Observability

| # | SAP requirement | Verdict | ARC-1 |
|---|---|---|---|
| 13 | Log every tool invocation with caller identity, parameters (PII redacted), target API, response status | **Met** | Typed `tool_call_start` / `tool_call_end` / `http_request` events with `user`, `clientId`, `clientAgent`, `requestId`; central redaction before any sink write (R5 closed); file sink `0600` |
| 14 | **Propagate distributed trace context (W3C TraceContext) through to SAP APIs** | **Gap — closed here** | A valid inbound `traceparent`/`tracestate` is now forwarded verbatim on every outbound SAP call. See "What changed" |
| 15 | Alerts on errors, latency and authentication failures | **Operator configuration required** | Audit fields and [alert guidance](../../docs_page/deployment-best-practices.md#what-to-alert-on) exist; functioning alerts still need configuration and testing. |

### Lifecycle

| # | SAP requirement | Verdict | ARC-1 |
|---|---|---|---|
| 16 | Version tool manifests; coordinate breaking changes across servers and clients | **Met** | The LLM-visible surface is frozen byte-for-byte by `tests/fixtures/tool-definitions/`; release-please semver; a manifest change needs a reviewed fixture diff |
| 17 | Track the MCP specification roadmap; the upcoming release candidate carries breaking changes | **Tracked** | SDK `^1.28.0`, deliberately legacy-era; [ADR-0006](../adr/0006-mcp-legacy-era-until-triggers.md) sets the migration triggers and `mcp-era-contract.test.ts` freezes the transport behaviors a dependency bump could silently change |

### Positioning

| # | SAP guidance | ARC-1 |
|---|---|---|
| 18 | SAP-managed MCP infrastructure | **Updated 2026-10-21:** SAP now documents remote MCP servers as an Integration Suite source. The previous claim that the Gateway cannot front ARC-1 is superseded. ARC-1 interoperability and delegated identity through that path remain unverified; see [current guidance](../../docs_page/sap-api-policy-and-architecture.md). |

---

## What changed in this PR

**Trace context (#14).** `src/server/trace-context.ts` validates the inbound `traceparent` against
the [W3C spec](https://www.w3.org/TR/trace-context/) — lowercase hex shape, version `ff` rejected,
all-zero trace-id and parent-id rejected, version `00` held to exactly 55 characters while a higher
version may append dash-delimited fields that are forwarded blind — and `tracestate` only when a
valid `traceparent` accompanies it (the spec forbids it travelling alone), length-capped and
charset-restricted to printable ASCII plus HTAB so CR/LF header injection is structurally impossible.
`serveMcpRequest` captures it into the existing `AsyncLocalStorage` request context;
`AdtHttpClient.doFetch` — the single outbound choke point, covering the Cloud Connector proxy branch
too — re-emits it.

ARC-1 forwards and **never originates**. The spec's rule for a non-participating pass-through service
is to forward unchanged; only a system that owns spans may rewrite `parent-id`. Minting trace-ids no
tracer knows about would be noise, and ARC-1's `requestId` already correlates its own logs.

**Agent identity (#5, ARC-1 half).** `clientAgent` on every audit event emitted during a tool call —
`tool_call_start`/`tool_call_end`, the `http_request` events beneath them, and the pre-dispatch
denials (`safety_blocked`, `auth_scope_denied`, `mcp_rate_limited`) — and in the BTP Audit Log next to
`clientId`. Resolution: MCP handshake `clientInfo` (`name/version`) → HTTP `User-Agent` → absent.

> **Why the fallback exists:** the HTTP transport is stateless — `serveMcpRequest` builds a fresh
> `Server` per POST, and the SDK populates `_clientVersion` only from `initialize`, which arrives on
> a *different* POST. So `getClientVersion()` returns `undefined` for every HTTP `tools/call` and is
> exact only on stdio. (The same blind spot affects the existing `ARC1_SCHEMA_NULLABLE_OPTIONALS=auto`
> client heuristic in `server.ts` — out of scope here, worth a follow-up.)
>
> `clientAgent` is caller-controlled: sanitized, truncated to 200 chars, **audit-only, never sent to
> SAP, and never an authorization input.**

Both are unconditional — no new configuration. Blast radius is small by construction: the trace
headers appear **only when an MCP client sends a valid `traceparent`**, which few do today, so the
default request shape to SAP is unchanged. Not yet live-verified with a real traceparent against a
real system — ICM is expected to ignore unknown request headers, and the integration/e2e suites pass,
but those exercise the no-trace-context path. A system that rejected the header would fail loudly on
the first traced call; the fix would be a patch, not a config flag.

---

## Deliberate deviations

Historical decisions, with corrections where current evidence does not support the original rationale.

| Item | Why not |
|---|---|
| **Circuit breaker** (#11) | **Earlier rejection superseded.** A semaphore bounds concurrency but does not suppress repeated failing calls, including to a single backend. Evaluate target-specific outage isolation and recovery; see OPS-08 in the current roadmap. |
| **SAP Credential Store / Vault** (#8) | **Earlier equivalence withdrawn.** PP avoids end-user passwords but application credentials remain. Environment variables and CF bindings are not evidence of dedicated storage/rotation. Verify the deployed secret lifecycle against the reference architecture. |
| **Saga / compensation engine** | See the caveat under #1. `batch_create` already reports per-item outcomes and flags written-but-not-activated objects. Automatic rollback of development objects destroys diagnostic evidence; the developer decides |
| **Generating a `traceparent` when the client sends none** | ARC-1 is not a tracer. `requestId` already correlates its logs; a synthesized trace-id no collector knows about is noise, and the spec asks pass-through systems to forward, not originate |
| **`SAP-PASSPORT`** | SAP's own end-to-end trace header is a distinct format requiring real span generation and an SAP-side collector. Genuinely useful for STAD/Solution Manager correlation — a candidate for later, not a small change |
| **A kill-switch env var for trace forwarding** | ARC-1 already carries ~50 options. The header is inert and secret-free; if a real system ever rejects it, that is a patch, not a permanent flag |
| **Splitting `clientAgent` into `clientName`/`clientVersion`/`userAgent`** | Three audit columns to say one thing. One field, one resolution order |

---

## Historical open questions — verify current status before resuming

1. **Should the shipped `ARC1_RATE_LIMIT` default change?** (#10) The layers are there and documented;
   the question is only whether "off unless configured" is the right *default* for a multi-user HTTP
   instance, given the SAP page's "must not exceed" wording. Options: default ~60/min on HTTP
   transports, or a startup warning when HTTP + multi-user + limit off. Behavior change → deliberately
   not bundled here.
2. **The `500 "database connection is not open"` retry fires for all methods**
   ([`src/adt/http.ts`](../../src/adt/http.ts)). The 503 retry above it is correctly justified — ICM
   rejects before the request reaches a work process, so nothing executed. The DB-connection retry is
   not proven the same way; a work process without HANA almost certainly did nothing, but "almost
   certainly" is the wrong standard for a POST. Low severity, worth narrowing to idempotent methods
   or proving the claim.
3. **Stateless `getClientVersion()` blind spot** also degrades the `ARC1_SCHEMA_NULLABLE_OPTIONALS=auto`
   heuristic on HTTP (it only ever resolves on stdio).
