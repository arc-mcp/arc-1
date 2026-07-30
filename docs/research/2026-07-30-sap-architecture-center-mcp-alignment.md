# SAP Architecture Center: "Third-Party MCP Access to SAP Solutions" — ARC-1 alignment

**Date:** 2026-07-30
**Source:** [architecture.learning.sap.com/docs/ref-arch/137800](https://architecture.learning.sap.com/docs/ref-arch/137800)
**Related SAP pages:** [A2A and MCP for Interoperability](https://architecture.learning.sap.com/docs/ref-arch/76ec36) ·
[Agentic AI & AI Agents](https://architecture.learning.sap.com/docs/ref-arch/98efa0)
**Status:** evaluated; two gaps closed in this change, the rest classified below.

> **Scope note.** This dossier answers *"is the architecture sound?"* — measurable, and mostly yes.
> It does **not** answer *"is the use permitted?"* under the SAP API Policy, which turns on ADT being a
> non-published API and on §2.2.2's endorsed-architecture requirement. That question, and the
> recommendation to consult your SAP contact, live in
> [`docs_page/sap-api-policy-and-architecture.md`](../../docs_page/sap-api-policy-and-architecture.md).

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
| 4 | **Never proxy the caller's token to a downstream API — use RFC 8693 token exchange** | **Met** | PP goes through the Destination Service: `OAuth2UserTokenExchange` / `OAuth2JWTBearer` (RFC 8693) or a SAML bearer assertion. The one path that *reads* like an exception — `SAP-Connectivity-Authentication: Bearer <userJwt>` — targets the **Cloud Connector**, which exchanges it for a short-lived X.509 user certificate. Recorded explicitly in [security-model.md §4](../security-model.md#4-deployment-mode-scoping) so it is not misfiled in review |
| 5 | **The exchanged token must carry the calling agent's identity while retaining user context** | **Partial — structurally bounded** | User context: yes, that is exactly what PP produces. Agent identity: **ABAP has no claim slot for it.** SAP-side records (SM20, `adtcore:changedBy`, transport owner) attribute the human. ARC-1 closes its own half — `clientAgent` on every audit event and in the BTP Audit Log, beside the registered `clientId`. Claiming more would be false |
| 6 | Input validation and sanitization of all tool parameters | **Met** | Zod v4 schemas + `stripLlmEmptyValues` + invariant **I6** (per-segment URL encoding, SQL/XML escaping, header charset allowlists) |
| 7 | TLS 1.2+ on all connections | **Met** | Platform TLS, certificate validation on by default; `SAP_INSECURE` logs a warning (R7 closed) |
| 8 | Dedicated secrets management (SAP Credential Store, Vault) | **Deviates** | Env vars + CF service bindings + Destination Service. See "Deliberate deviations" |
| 9 | Adhere to OWASP MCP Top 10 | **Met, now provable** | Substantively covered by the 7 invariants + residual-risk register; the explicit mapping is now [security-model.md §9](../security-model.md#9-external-framework-mapping--owasp-mcp-top-10) |

### Scalability and reliability

| # | SAP requirement | Verdict | ARC-1 |
|---|---|---|---|
| 10 | Rate limits must never exceed the underlying SAP API quotas; per-consumer limits when agents share an entry point | **Met, operator-configured** | Three layers: per-IP OAuth, per-IP/per-user MCP, and a server-wide SAP concurrency semaphore. Defaults are conservative rather than landscape-derived (`ARC1_RATE_LIMIT` 0, `ARC1_MAX_CONCURRENT` 10 — not read from `rdisp/wp_no_dia`), so the ceiling is a deployment decision documented in the checklist. Whether to change the shipped default is in "Open" |
| 11 | Timeouts and circuit breakers | **Partial / Deviates** | Timeouts: 120 s `AbortSignal.timeout` on every request. 503 and 429 retried once honouring `Retry-After`. Circuit breaker: not implemented, deliberately |
| 12 | Stateless design for horizontal scaling | **Met, with per-process state documented** | No session store; the MCP transport runs stateless and OAuth `client_id`s are HMAC-derived rather than stored. Rate limiters, feature probe and cache are per-process, and ADR-0007 shared-Basic requires exactly one instance. Consequences now documented in [deployment-best-practices.md](../../docs_page/deployment-best-practices.md#scaling-out-what-changes-at-more-than-one-instance) |

### Observability

| # | SAP requirement | Verdict | ARC-1 |
|---|---|---|---|
| 13 | Log every tool invocation with caller identity, parameters (PII redacted), target API, response status | **Met** | Typed `tool_call_start` / `tool_call_end` / `http_request` events with `user`, `clientId`, `clientAgent`, `requestId`; central redaction before any sink write (R5 closed); file sink `0600` |
| 14 | **Propagate distributed trace context (W3C TraceContext) through to SAP APIs** | **Gap — closed here** | A valid inbound `traceparent`/`tracestate` is now forwarded verbatim on every outbound SAP call. See "What changed" |
| 15 | Alerts on error spikes, latency degradation, authentication failures | **Met (operator-side)** | Every field needed was already emitted; the missing piece was guidance. Now [What to alert on](../../docs_page/deployment-best-practices.md#what-to-alert-on) |

### Lifecycle

| # | SAP requirement | Verdict | ARC-1 |
|---|---|---|---|
| 16 | Version tool manifests; coordinate breaking changes across servers and clients | **Met** | The LLM-visible surface is frozen byte-for-byte by `tests/fixtures/tool-definitions/`; release-please semver; a manifest change needs a reviewed fixture diff |
| 17 | Track the MCP specification roadmap; the upcoming release candidate carries breaking changes | **Tracked** | SDK `^1.28.0`, deliberately legacy-era; [ADR-0006](../adr/0006-mcp-legacy-era-until-triggers.md) sets the migration triggers and `mcp-era-contract.test.ts` freezes the transport behaviors a dependency bump could silently change |

### Positioning

| # | SAP guidance | ARC-1 |
|---|---|---|
| 18 | Prefer the MCP Gateway in SAP Integration Suite, Joule Studio-generated MCP servers, or A2A via the Agent Gateway | Joule Studio generates from SAP's **business** API catalog; there is no ADT/developer-tooling surface in it, so it does not overlap ARC-1's domain. A2A is for multi-agent delegation, orthogonal to a tool server. The MCP Gateway is complementary infrastructure rather than a substitute — but note it **cannot front ARC-1 today**: its documented creation methods (API artifact, OpenAPI HTTP endpoint, RFC backend) are API-to-MCP wrapping, not MCP-to-MCP federation. Detail and sources in [`docs_page/sap-api-policy-and-architecture.md` §4](../../docs_page/sap-api-policy-and-architecture.md) |

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

Each of these is a "no" with a reason, so they do not return as review comments.

| Item | Why not |
|---|---|
| **Circuit breaker** (#11) | A breaker protects a caller from one of *many* backends. ARC-1 has exactly one, already bounded by a server-wide semaphore, a 120 s timeout, and single-shot 503/429 retries honouring `Retry-After`. Adding a breaker introduces a new failure mode (open circuit on a healthy system) to solve a problem the semaphore already solves |
| **SAP Credential Store / Vault** (#8) | Env + CF service bindings + Destination Service is the CF-native path and already satisfies "no long-lived credentials in the server" for the recommended PP topology. A credential-store dependency adds a runtime call and an outage mode without changing the threat model |
| **Saga / compensation engine** | See the caveat under #1. `batch_create` already reports per-item outcomes and flags written-but-not-activated objects. Automatic rollback of development objects destroys diagnostic evidence; the developer decides |
| **Generating a `traceparent` when the client sends none** | ARC-1 is not a tracer. `requestId` already correlates its logs; a synthesized trace-id no collector knows about is noise, and the spec asks pass-through systems to forward, not originate |
| **`SAP-PASSPORT`** | SAP's own end-to-end trace header is a distinct format requiring real span generation and an SAP-side collector. Genuinely useful for STAD/Solution Manager correlation — a candidate for later, not a small change |
| **A kill-switch env var for trace forwarding** | ARC-1 already carries ~50 options. The header is inert and secret-free; if a real system ever rejects it, that is a patch, not a permanent flag |
| **Splitting `clientAgent` into `clientName`/`clientVersion`/`userAgent`** | Three audit columns to say one thing. One field, one resolution order |

---

## Open — needs a decision, not code

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
