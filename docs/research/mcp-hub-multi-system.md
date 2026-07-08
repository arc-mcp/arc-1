# Research: Multi-System MCP Access via a Hub (DEV/QA/PROD)

**Status:** Research / pre-ADR — captures the decision journey for future ADRs.
**Date:** 2026-06-17
**Scope:** A standalone, open-source **MCP multiplexing hub** that fronts multiple ARC-1
instances (one SAP system each — e.g. DEV/QA/PROD) behind one front door. **Not** introduced into
ARC-1 itself; ARC-1's [`one-instance-per-system`](../../AGENTS.md) model stays intact. The hub reuses
ARC-1's (being-carved-out) BTP auth module.

> This document records **why** we chose each option, **what we rejected and why**, and **what was
> proven live vs. still open**. It is deliberately verbose so future ADRs can cite the reasoning
> without re-deriving it.

---

## 1. Problem & motivation

Developers and admins repeatedly ask to use ARC-1 against **multiple SAP systems** (DEV/QA/PROD, or
several landscapes) without juggling N independent MCP server entries and N logins. ARC-1's ADR
deliberately refuses multiple destinations *inside one instance* (see §3.1). The recurring ask is
therefore: **can a front door give "one login, many systems" while preserving ARC-1's isolation,
per-user SAP identity, and safety guarantees?**

Primary goal: **use ARC-1 with multiple systems, configured with no code (a list of backends), one
login, per-user SAP identity preserved.** Optional/secondary: a more generic hub that could also
front heterogeneous backends.

## 2. Use cases

- **U1 (primary):** One developer works against DEV/QA/PROD of the same landscape through one hub.
- **U2:** An admin centrally manages which systems exist and who can reach them.
- **U3 (secondary, deferred):** A generic natural-language hub over *heterogeneous* business apps
  (the SAP TechEd-style demo — see §3.6). Different product; not the focus.

## 3. Options evaluated — and why most were rejected

The single most important output of this research is the **rejected** list, because each rejection
encodes a constraint that bounds the design.

### 3.1 Multiple destinations inside one ARC-1 instance — REJECTED (pre-existing ADR)
An LLM choosing the target system per call can write to PROD by accident; the safety ceiling
(`allowWrites`, package allowlists, deny actions) is calibrated per-system and can't be three things
at once. **Isolation by deployment** (one instance per system) is free on BTP/CF and keeps the
ceiling coherent. *Reason it matters: this is the constraint the hub must honor — it may centralize
**auth/routing**, never **per-call system selection by the LLM**.*

### 3.2 "One token for N servers" — REJECTED (spec-forbidden)
MCP mandates per-server audience binding (RFC 8707): a server **MUST** reject tokens not audienced
for it. One bearer valid at all backends is non-conformant. *Consequence: the achievable goal is
**one login → N tokens**, never one token.* (MCP Authorization spec 2025-06-18/2025-11-25.)

### 3.3 Shared authorization server to get "one token" in clients — REJECTED (doesn't work)
We checked VS Code's actual behavior: `mainThreadAuthentication.ts` keys credentials by
`(authorizationServer + resource)`, so two backends still get two tokens. The "shared token" in
issue #293533 is a same-resource multi-tenant bug, not applicable. *Consequence: client-side token
sharing is not a lever.*

### 3.4 CIMD / ID-JAG (enterprise SSO extensions) — DEFERRED (not login-solving / draft)
- **CIMD** (Nov 2025) reduces *client registration* friction, **not** login/consent count — every
  vendor (Scalekit, Descope, WorkOS) confirms. ARC-1 already solved registration churn with signed
  client_ids, so CIMD buys little here.
- **ID-JAG / Cross-App Access (SEP-990)** is the only standard that yields "one login → N per-server
  user tokens with zero per-server consent" — but it is a **draft MCP extension**, Okta Early-Access,
  WorkOS preview, IETF draft (not RFC). Track; don't build on.

### 3.5 Generative agentic hub with server-side LLM (SAP AI Core) — REJECTED for this use case
The TechEd demo puts the LLM **server-side**; the user talks NL to the hub, which plans/executes/
aggregates across backends. We evaluated it thoroughly and rejected it **for the dev-tool use case**:
- **Data through the LLM:** every tool I/O transits the server-side model (OWASP LLM02 surface). The
  demo slides themselves flag "Daten gehen durch das LLM".
- **Precision loss on writes:** interposing a planner/aggregator LLM adds a lossy translation step;
  τ-bench shows agents <25% reliable at pass^8 — unacceptable for surgical ABAP writes.
- **Per-user identity erodes** toward a service identity; **model lock-in**; latency + ~15× tokens.
- It is a **different product** (broad NL orchestration of heterogeneous apps), not a better ARC-1.
  Right for U3, wrong for U1/U2. Decision rule: choose the server-side hub only when (a) orchestrating
  many heterogeneous domains, (b) central governance > per-user precision, (c) data/ops tolerate a
  second LLM in the path. The dev-tool fails all three.

### 3.6 cf-mcp-sidecar as the hub base — REJECTED (wrong shape)
We read the actual repo (`Dominik23/cf-mcp-sidecar`, cloned to `~/dev/cf-mcp-sidecar`). It is a tiny
**registration agent** (3 files, no auth) for **plain-REST** apps: it advertises an app's REST
endpoints to a hub that then needs an **LLM to pick capabilities from NL**. Wrong for us because
(a) ARC-1 is *already* MCP (no sidecar needed — the hub connects as an MCP client), (b) DEV/QA/PROD
expose **identical** tool surfaces (no semantic routing to do), (c) **no model needed at all** for the
core use case. Keep it only as a *template* for wrapping a future non-MCP app.

### 3.7 Private/internal networking between hub and backends — REJECTED (impossible on BTP CF)
**SAP BTP does not support container-to-container networking.** `apps.internal` / `cf
add-network-policy` are disabled; the `network.*` scopes are withheld (KBA 3200585; "Supported and
Unsupported Cloud Foundry Features"; KBA 3481841). **Every hub→backend hop — even same-space — goes
over the backend's public route.** Network-level isolation only exists on Kyma, not CF.
*Consequence: backends are public by necessity, protected by XSUAA (+ optional IP-allowlist via the
`x-cf-true-client-ip` header, SAP Note 3714836). "Make it private" is not a lever.*

### 3.8 Transparent path-rewriting OAuth proxy (no token exchange) — REJECTED
RFC 9728 §3.3 requires the resource-metadata `resource` to equal the URL the client called. A hub at
`/dev/mcp` must therefore be its **own** resource server; it cannot relay the backend's auth while
rewriting the path. So the hub **must terminate auth and mint a per-backend token** (token exchange),
not passthrough.

### 3.9 Token passthrough (forward the client's token to the backend) — REJECTED
MCP spec: "MCP servers **MUST NOT** accept or transit any other tokens" / "MUST NOT pass through the
token it received from the MCP client." It also wouldn't validate (audience = hub, not backend).

## 4. Decisions (with rationale)

| # | Decision | Why |
|---|----------|-----|
| D1 | **Thin deterministic per-environment MCP multiplexer**, no server-side LLM | Identical tool surfaces → routing is by environment, not NL. Avoids §3.5 downsides entirely. |
| D2 | **Connection/path-scoped routing** (`/dev/mcp`, `/qa/mcp`, `/prod/mcp`); local client config picks **one** | Safest: within a session the LLM sees only one system's tools — cross-environment mistakes are *structurally impossible* (control poka-yoke / capability security), not just discouraged. Beats tool-name namespacing (36 sibling tools, prod one token away) and system-as-parameter (LLM picks target every call — the Replit/PocketOS prod-deletion failure mode). |
| D3 | **Per-instance safety ceilings**; PROD = `SAP_ALLOW_WRITES=false` **and** a read-only SAP user | Defense in depth: routing is structural; the ceiling is enforcement. Read-only flags can fail open (GitHub MCP #2156), so the read-only SAP user is the real backstop. Makes "LLM confused dev/prod" harmless. |
| D4 | **Same-subaccount** hub + backends for now; cross-subaccount → roadmap | Same subaccount = trivial jwt-bearer (shared issuer). Cross-subaccount hits the "Unable to map issuer" trust problem (= ARC-1 #434). |
| D5 | **Destination Service per backend**, `OAuth2JWTBearer` exchange (per-user token) | SAP-blessed, handles trust/cert plumbing; "add a backend" = add a destination + a config-list entry (no code). Reuses the same machinery ARC-1 already uses for SAP propagation. |
| D6 | **Public backends** (forced by §3.7), protected by their existing XSUAA | No private option exists on CF. |
| D7 | **Defer a separate PROD OAuth scope** | SAP enforces per-user authorization via principal propagation — a user without PROD SAP authz can't act on PROD even if they connect. The strongest boundary already exists. |
| D8 | **Build a custom ~250-line TS proxy**, not adopt a gateway | No gateway speaks BTP XSUAA + Destination + principal propagation natively; ARC-1 already implements it. Reuse the SDK (already a dependency) + the carved-out auth module. agentgateway is the fallback if gateway features (RBAC/rate-limit) are later wanted. |
| D9 | **Reuse ARC-1's carved-out BTP auth module**, role-configurable (front-door vs embedded) + an outbound token-exchange hook | The hub's inbound auth *is* ARC-1's existing resource-server/DCR/XSUAA code; the outbound hop *is* ARC-1's existing destination-exchange code pointed at a backend MCP server instead of an ABAP system. |

## 5. Chosen architecture

```
Developer's MCP client (its own LLM)
        │  one login (XSUAA/IAS, same subaccount)
        ▼
   ┌─────────────────────────────────────────┐
   │  HUB  (TS, MCP server + MCP client)       │
   │  /dev/mcp  /qa/mcp  /prod/mcp  (per env)  │   ← own XSUAA resource server (reuse ARC-1 auth)
   │  config: [{name,url,destination}]         │   ← no-code add a backend
   │  per backend: OAuth2JWTBearer destination │   ← mints per-user, backend-audienced token
   └─────────────────────────────────────────┘
        │ public route + per-user token (token exchange)
        ▼            ▼              ▼
   ARC-1 (DEV)   ARC-1 (QA)   ARC-1 (PROD, read-only ceiling + RO SAP user)
        │             │              │   ← each does its own principal propagation
        ▼             ▼              ▼
   SAP DEV       SAP QA        SAP PROD   (BTP ABAP / on-prem via CC / private|public S/4)
```

**Layering note (important):** "where the ARC-1 *instance* lives" (Layer 1, drives hub↔ARC-1 auth →
same-subaccount) is independent of "what SAP system each instance *targets*" (Layer 2 — BTP ABAP /
on-prem CC / S/4 — entirely ARC-1's existing concern). The hub treats every ARC-1 instance
identically. The SAP-target diversity adds exactly **one** thing to validate: chained propagation
(§7, open item).

## 6. Auth model (the crux)

- **Inbound (client → hub):** the hub is an OAuth 2.1 resource server with DCR — i.e. ARC-1's existing
  [`xsuaa.ts`](../../src/server/xsuaa.ts) / [`stateless-client-store.ts`](../../src/server/stateless-client-store.ts).
  One interactive login (silent SSO via the shared IdP session for subsequent endpoints).
- **Outbound (hub → ARC-1 backend):** **`OAuth2JWTBearer` token exchange** — the hub exchanges the
  user's token for one audienced at the backend's xsappname, carrying the user. **Requires an explicit
  grant chain** (see §6.1). Token passthrough is forbidden and wouldn't validate (§3.9).
- **Backend → SAP:** unchanged — ARC-1's existing principal propagation (destination / Cloud
  Connector), so SAP enforces per-user authorization (D7).

### 6.1 The grant chain (mandatory — same-subaccount is necessary but not sufficient)
Same-subaccount clears the **issuer** gate (proven live, §7). But the exchanged token's `aud` gets
the backend's xsappname **only** if a scope prefixed with that xsappname is in the token — which needs:

```jsonc
// ARC-1 backend xs-security.json (the granting/target app)
"scopes": [
  { "name": "$XSAPPNAME.mcp.invoke",
    "description": "Invoke the ARC-1 MCP endpoint",
    "granted-apps": [ "$XSAPPNAME(application,hub)" ] }
]
```
```jsonc
// hub xs-security.json (the consuming/calling app)
"foreign-scope-references": [ "$XSAPPNAME(application,arc-1)" ]
```
```jsonc
// hub destination (per backend)
{ "Name": "arc-1-dev", "Type": "HTTP", "ProxyType": "Internet",
  "URL": "https://<arc1-dev-host>/mcp",
  "Authentication": "OAuth2JWTBearer",
  "tokenServiceURLType": "Dedicated",
  "tokenServiceURL": "https://<subaccount>.authentication.<region>.hana.ondemand.com/oauth/token",
  "clientId": "<hub xsuaa clientid>", "clientSecret": "<hub xsuaa clientsecret>",
  "scope": "arc-1.mcp.invoke" }     // ← forces backend xsappname into aud
```
The caller passes the inbound user JWT via the `X-user-token` header (priority) or `Authorization`
(fallback); the Destination service returns `authTokens[0].http_header` to attach to the `/mcp` call.
There is **no** `audience` destination property for XSUAA targets — audience is shaped via `scope`.
The `client_id`-match audience-skip does **not** rescue a missing grant (token carries the hub's
client_id).

## 7. Live test findings (2026-06-17, against deployed instances)

Tested against two real ARC-1 instances in subaccount `joule2-7lrbs13d` (`arc1-mcp-joule2`,
`arc1-mcp-test`) on `us10-001`.

| # | Finding | Evidence |
|---|---------|----------|
| L1 | ARC-1 `/mcp` is a proper OAuth 2.1 resource server | 401 + `WWW-Authenticate` + RFC 9728 `resource_metadata`; self-advertised AS with `grant_types_supported: [authorization_code, refresh_token]`. |
| L2 | The `/mcp` validator accepts **any valid XSUAA bearer** audienced for it, regardless of how minted | Code: [`xsuaa.ts:78-113`](../../src/server/xsuaa.ts) just runs `@sap/xssec createSecurityContext` + scope check. DCR is only the *issuance* path, not an acceptance requirement. |
| L3 | ARC-1's XSUAA **blocks `client_credentials`** | Live: `invalid_client / "Unauthorized grant type"`. No technical-token shortcut. |
| L4 | **`jwt-bearer` is NOT enabled by default** — the grant-types allowlist `[authorization_code, refresh_token]` blocks it; the issuer check merely runs *first* | Live (corrected 2026-06-17): a **same-subaccount user token** (trusted issuer → issuer check passes) → `invalid_client / "Unauthorized grant type"`, identical to `client_credentials`. The earlier CF-token `"Unable to map issuer"` was the issuer check failing *before* the grant-type check, **masking** this. **Fix: add `urn:ietf:params:oauth:grant-type:jwt-bearer` to the grant-types of the app that INITIATES the exchange — the HUB's xsuaa, not ARC-1's.** ARC-1 only needs `granted-apps` + audience-validate. |
| L5 | Same-subaccount maps the issuer (proven); cross-subaccount fails issuer mapping | The issuer error vanished with a same-subaccount token (exposing L4); cross-subaccount = #434. |
| L6 | x5t / proof-of-possession is **not** a blocker — confirmed live | A real user token (no PoP binding) was ACCEPTED at `/mcp` (HTTP 200). Research: x5t/PoP is IAS-token-only + off by default in `@sap/xssec`. |
| L7 | ARC-1 `/mcp` **accepts a real user bearer obtained outside its DCR flow** | Live: `authorization_code` user token (`user=email=marian@zeis.de`) → `/mcp initialize` HTTP 200 ACCEPTED. Confirms L2 + item-4 end-to-end. |
| L8 | Claim preservation **through the exchange** — **PROVEN** | Live (throwaway xsuaa with jwt-bearer enabled): `authorization_code` user token → jwt-bearer self-exchange → **`user_name` + `email` preserved**, `grant_type` flips to `jwt-bearer`. The exchange carries user identity intact. |
| L9 | Real-world cross-subaccount Layer-2 already works | Deployed ARC-1's ABAP backend is in a *different* subaccount (`dev-9li7mzug`) via destination — ARC-1→SAP cross-subaccount runs in prod today, lowering chained-propagation risk. |

**Net — the auth chain is fully validated.** Login, `/mcp` acceptance of user tokens (L7), x5t
non-issue (L6), and identity-preserving exchange (L8) are all proven live. The **only remaining auth
work is config we now know exactly**: enable `jwt-bearer` on the **hub's** xsuaa (L4) + wire the
`granted-apps` audience chain (§6.1). That's a build-time wiring step, not a research risk. **The
transport has since been proven too — see §8.**

## 8. Validation status & remaining items

**Transport spike — DONE (2026-06-17).** A ~100-line transparent proxy (`~/dev/mcp-hub-spike/proxy.mjs`,
Inspector `mcpProxy` pattern: client-facing `StreamableHTTPServerTransport` ↔ backend-facing
`StreamableHTTPClientTransport`, bearer injected per request) listed **all 12 arc-1 tools through the
proxy** against the real `arc1-mcp-joule2` backend — `serverInfo` + session bridge + SSE transport +
scope-filtered `tools/list` all relayed transparently. Gotchas found & fixed: inject the bearer
**per request** (not per session — avoids a stale-token-per-session failure); silence benign
`terminated` SSE-teardown errors; arc-1 scopes are **instance-suffixed** (`arc1-mcp!t627062.admin`,
not `arc1-mcp.admin`); the user needs an arc-1 role collection assigned **`--of-idp sap.custom`** (the
`invalid_scope` cause — token `origin: sap.custom`).

**Still to confirm (build-time, low risk):**
1. **Grant-chain shape.** When wiring the real hub: confirm the **user** pair
   (`granted-apps`/`foreign-scope-references` + destination `scope`) yields `arc-1.*` in the exchanged
   token's `aud`; else switch to the client-credentials pair. Decode the minted JWT to verify.
2. **`@sap/xssec` version pin** on the backend — confirm audience-from-scopes + client_id-skip.
3. **`lookupDestinationWithUserToken` extraction** — verify it returns `bearerToken` for whichever
   destination type (`OAuth2JWTBearer` / `OAuth2UserTokenExchange`) the hub uses.

**Net: auth + transport both proven live. No research risk remains — next is assembling the hub.**

## 9. Roadmap (deferred)

- **Cross-subaccount backends:** `OAuth2SAMLBearerAssertion` per-pair trust, or a shared IAS tenant +
  RFC 8693 (collapses N pairwise trusts to one). No ARC-1 code change — BTP config only.
- **Separate PROD OAuth scope** (currently deferred — D7).
- **Generic NL hub for heterogeneous apps** (U3) — the §3.5 server-side-LLM product, only if a
  non-developer NL front door is wanted; built separately with masking/content-filtering.
- **Scale hub > 1 instance:** in-memory session map → shared store (Redis) or sticky sessions.

## 10. Key sources

- MCP Authorization & Security (audience binding, no passthrough): modelcontextprotocol.io/specification/2025-06-18/basic/{authorization,security_best_practices}; RFC 8707; RFC 9728 §3.3.
- BTP no C2C networking: SAP KBA 3200585; "Supported and Unsupported Cloud Foundry Features"; KBA 3481841; IP-allowlist SAP Note 3714836.
- jwt-bearer / principal propagation config: SAP-docs `application-security-descriptor-configuration-syntax`; `oauth-jwt-bearer-authentication`; "Exchanging User JWTs via OAuth2JWTBearer Destinations"; `@sap/xssec` README; `JwtAudienceValidator.java`; SAP Cloud SDK JS connectivity.
- Cross-subaccount issuer problem: ARC-1 #434; token-client README ("Unable to map issuer").
- Proxy mechanics: modelcontextprotocol.io transports/lifecycle; `@modelcontextprotocol/sdk` (v1.29.0) client/server StreamableHTTP transports; MCP Inspector `mcpProxy`; TBXark/mcp-proxy; MetaMCP #294; CF keep-alive (Gorouter 90s idle).
- Routing safety: AWS Well-Architected SEC01/SEC03; poka-yoke / capability-security / confused-deputy; Replit (AI Incident DB #1152) & PocketOS prod-deletion incidents; Anthropic tool-count guidance (~30–50).
