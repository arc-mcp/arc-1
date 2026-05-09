# Centralized MCP Server Authentication Architecture

**Date:** 2026-03-25
**Report ID:** 003
**Subject:** Authentication options for centralized vsp deployment (BTP, company server, cloud)
**Related Documents:** 2026-03-25-001-enterprise-auth-research.md, 2026-03-25-002-enterprise-auth-implementation-plan.md

---

## Context & Architectural Constraint

**vsp is never used locally by a developer.** It is always deployed as a centralized MCP server — either on SAP BTP, a company-managed server, or a cloud environment (AWS, Azure, etc.). Multiple MCP clients (developer IDEs, Copilot Studio) connect to it remotely.

This means there are always **two authentication hops**:

```
┌────────────────┐         Hop 1          ┌──────────────┐         Hop 2          ┌────────────────┐
│  MCP Client    │ ──────────────────────► │  vsp Server  │ ──────────────────────► │  SAP ABAP      │
│  (IDE/Copilot) │   OAuth / API Key /    │  (centralized)│   Basic / OAuth /     │  System        │
│                │   OIDC Bearer          │               │   X.509 / XSUAA       │                │
└────────────────┘                        └──────────────┘                        └────────────────┘
```

**Hop 1:** MCP Client → vsp (who is the user? are they allowed?)
**Hop 2:** vsp → SAP (authenticate as which SAP user?)

---

## Table of Contents

1. [MCP Protocol Auth Standard](#1-mcp-protocol-auth-standard)
2. [Hop 1: MCP Client → vsp Authentication](#2-hop-1-mcp-client--vsp-authentication)
3. [Hop 2: vsp → SAP Authentication](#3-hop-2-vsp--sap-authentication)
4. [Deployment Scenarios](#4-deployment-scenarios)
5. [MCP Client Compatibility Matrix](#5-mcp-client-compatibility-matrix)
6. [Reference Implementations](#6-reference-implementations)
7. [Option Comparison Matrix](#7-option-comparison-matrix)
8. [Recommendations](#8-recommendations)

---

## 1. MCP Protocol Auth Standard

The MCP specification (draft, post-2025) defines an **optional OAuth 2.1 authorization flow** for HTTP Streamable transport:

### How It Works

1. Client sends request without token
2. Server responds `401 Unauthorized` with `WWW-Authenticate: Bearer resource_metadata="<URL>"`
3. Client fetches **Protected Resource Metadata** (RFC 9728) from server
4. Client discovers Authorization Server via `.well-known/oauth-authorization-server`
5. Client registers dynamically (RFC 7591) or uses pre-registered credentials
6. **Authorization Code + PKCE** flow (mandatory S256)
7. Client sends `Authorization: Bearer <token>` on **every** subsequent request
8. Token **must** include `resource` parameter (RFC 8707) binding it to the specific MCP server

### Key Constraints

- OAuth 2.1 with **mandatory PKCE** — no implicit flow, no password grant
- Servers **must** implement Protected Resource Metadata (RFC 9728)
- Servers **must not** pass through received tokens to upstream APIs (confused deputy prevention)
- STDIO transport does **not** use this flow (credentials from environment)

### What This Means for vsp

To be a spec-compliant remote MCP server, vsp needs to either:
- **Option A:** Implement the MCP OAuth 2.1 endpoints (discovery, token validation)
- **Option B:** Sit behind a reverse proxy/gateway that handles MCP auth
- **Option C:** Use simpler auth (API key) for clients that support it

---

## 2. Hop 1: MCP Client → vsp Authentication

### Option 1A: MCP OAuth 2.1 (Spec-Compliant)

vsp acts as a **Protected Resource** and delegates to an external Authorization Server (EntraID, Cognito, Okta, Keycloak).

**What vsp implements:**
- `GET /.well-known/oauth-protected-resource` → returns metadata with `authorization_servers`
- JWT Bearer token validation on `POST /mcp` (signature, issuer, audience, expiry)
- Username extraction from token claims

**What vsp does NOT implement:**
- Authorization Server itself (delegates to EntraID/Cognito/Keycloak)
- Token issuance, refresh — that's the Authorization Server's job

**Pros:**
- Spec-compliant — works with any MCP client
- Copilot Studio supports this (OAuth 2.0 Dynamic Discovery mode)
- VS Code, Cursor support this natively
- User identity flows through (enables per-user SAP auth in Hop 2)

**Cons:**
- Must implement Protected Resource Metadata endpoint
- Requires an external Authorization Server (EntraID, Cognito, Keycloak)
- More complex than API key

**Implementation effort:** Medium — JWT validation + 1 metadata endpoint

### Option 1B: API Key (Simple)

vsp checks a shared secret in a request header.

```
Authorization: Bearer <static-api-key>
# or
x-api-key: <static-api-key>
```

**Pros:**
- Trivial to implement (1 header check)
- Copilot Studio supports this natively
- Works behind any reverse proxy

**Cons:**
- No user identity — everyone shares one key
- Cannot do per-user SAP auth (Hop 2 must use a service account)
- Secret rotation requires redeploying all clients
- Not spec-compliant MCP auth

**Implementation effort:** Trivial

### Option 1C: Reverse Proxy / API Gateway Handles Auth

vsp runs unprotected internally. A reverse proxy (Azure API Management, AWS API Gateway, Traefik, Cloudflare Access, nginx + oauth2-proxy) handles authentication and forwards the user identity to vsp via headers.

```
MCP Client → [API Gateway + OAuth] → vsp (receives x-user-id header)
```

**Pros:**
- vsp stays simple — just reads a trusted header
- Gateway handles token validation, rate limiting, TLS termination
- Enterprise IT teams often prefer this pattern (centralized auth policy)

**Cons:**
- Requires additional infrastructure (gateway)
- Gateway must support MCP's session semantics (`mcp-session-id`)
- Extra hop / latency

**Implementation effort for vsp:** Trivial (read header). Infrastructure effort: Medium.

### Option 1D: XSUAA OAuth (BTP-Only)

When deployed on BTP, vsp binds to an XSUAA service instance. XSUAA becomes the Authorization Server. vsp proxies OAuth endpoints to XSUAA (like Wouter's pattern).

```
MCP Client → vsp (proxies /oauth/* to XSUAA) → validates JWT via xssec
```

**Pros:**
- Tight BTP integration — roles, scopes, user management via SAP
- Wouter's btp-sap-odata-to-mcp-server proves this works
- Principal propagation to SAP backend via Destination Service
- Copilot Studio, VS Code, Cursor all work with this

**Cons:**
- BTP-only — not portable to non-BTP deployments
- Requires XSUAA service instance + app registration
- Go implementation needs XSUAA JWT validation (no official SAP Go SDK)

**Implementation effort:** Medium-High for Go (need to port xssec JWT validation)

---

## 3. Hop 2: vsp → SAP Authentication

### Option 2A: Basic Auth (Service Account)

vsp uses a single SAP username/password to connect to SAP. All users share the same SAP identity.

**Pros:** Simplest. Already implemented in vsp.
**Cons:** No per-user audit trail. One set of SAP authorizations for everyone.
**When to use:** Development, small teams, read-only scenarios.

### Option 2B: OAuth2 / XSUAA Bearer (BTP Destination)

vsp obtains a Bearer token via XSUAA client_credentials or user-token exchange and sends it to SAP.

**Two sub-options:**
- **2B-i: Client credentials** — service account, technical user, no user identity
- **2B-ii: User token exchange** — forward user's JWT, destination service maps to SAP user via OAuth2SAMLBearerAssertion

**Pros:** Standard BTP pattern. User identity can flow through. No passwords stored.
**Cons:** BTP-only. Requires SAP Cloud Connector for on-prem SAP. Complex setup.
**When to use:** BTP deployment with Destination Service.

### Option 2C: X.509 mTLS (Static Certificate)

vsp presents a client certificate to SAP. SAP maps the certificate CN to a SAP user.

**Pros:** No passwords. Certificate rotation is operationally clean.
**Cons:** Single identity (like service account). Cert must be provisioned and rotated.
**When to use:** Service-to-service with a fixed technical user.

### Option 2D: Principal Propagation (Ephemeral X.509)

vsp generates a short-lived (5-minute) X.509 certificate per request, with the user's SAP username as CN, signed by a trusted CA.

**Pros:** Per-user SAP identity. Full audit trail. No shared credentials.
**Cons:** Requires CA key management. SAP-side STRUST + CERTRULE setup. RSA key generation per request (~2ms).
**When to use:** Enterprise multi-user with per-user SAP authorization.

### Option 2E: SAP OAuth2 (AS ABAP OAuth Provider)

SAP AS ABAP has a built-in OAuth2 provider (`/sap/bc/sec/oauth2/*`). vsp obtains tokens directly from SAP.

**Pros:** No BTP needed. Works with on-prem SAP.
**Cons:** Requires SAP OAuth2 configuration (SOAUTH2, SICF). Less common pattern.
**When to use:** On-prem SAP without BTP, when basic auth isn't acceptable.

---

## 4. Deployment Scenarios

### Scenario A: BTP Cloud Foundry

```
┌──────────────┐     OAuth 2.0      ┌─────────────────┐    Destination     ┌────────────┐
│  IDE/Copilot │ ─────────────────► │  vsp on BTP CF  │ ────Service───────► │  SAP ABAP  │
│              │   XSUAA tokens     │  (MTA deploy)   │    (Cloud Conn.)   │  (on-prem) │
└──────────────┘                    └─────────────────┘                    └────────────┘
```

**Hop 1:** XSUAA OAuth (Option 1D)
**Hop 2:** BTP Destination Service with Cloud Connector (Option 2B)

**Required BTP services:** XSUAA, Destination, Connectivity
**Reference:** Wouter's `btp-sap-odata-to-mcp-server`

**Challenges for vsp (Go):**
- No official SAP Go SDK for XSUAA / Destination Service / Cloud Connector
- Would need to implement: XSUAA JWT validation, Destination API calls, token exchange
- OR: deploy a sidecar/proxy (e.g., approuter) for auth, vsp handles only MCP+ADT

### Scenario B: Company Server (AWS / Azure / On-Prem)

```
┌──────────────┐    OAuth 2.0       ┌─────────────────┐    mTLS/Basic/     ┌────────────┐
│  IDE/Copilot │ ─────────────────► │  vsp on Server  │ ────OAuth──────────► │  SAP ABAP  │
│              │   EntraID/Cognito  │  (ECS/VM/K8s)   │   (direct network)│  (on-prem) │
└──────────────┘                    └─────────────────┘                    └────────────┘
```

**Hop 1:** MCP OAuth 2.1 with external IdP (Option 1A) or API Gateway (Option 1C)
**Hop 2:** Principal Propagation (Option 2D) or Basic Auth (Option 2A) or Static mTLS (Option 2C)

**Reference:** AWS ABAP Accelerator ECS Fargate deployment

**Network requirements:**
- vsp server must have HTTPS network access to SAP system
- ALB/Load Balancer with TLS termination for MCP clients
- VPC peering or Direct Connect/ExpressRoute for SAP connectivity
- Secrets management (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault) for certs/credentials

### Scenario C: Hybrid (Company Server + BTP Destination)

```
┌──────────────┐    OAuth 2.0       ┌─────────────────┐    BTP Dest.      ┌────────────┐
│  IDE/Copilot │ ─────────────────► │  vsp on Server  │ ────Service API───► │  SAP ABAP  │
│              │   EntraID/Cognito  │  (ECS/VM/K8s)   │   (via Cloud Conn)│  (on-prem) │
└──────────────┘                    └─────────────────┘                    └────────────┘
```

vsp runs on company infrastructure but uses the BTP Destination Service API to handle SAP auth. Avoids implementing mTLS/principal propagation, but adds BTP dependency.

---

## 5. MCP Client Compatibility Matrix

| MCP Client | OAuth 2.0 (MCP Spec) | API Key | Transport |
|------------|---------------------|---------|-----------|
| **VS Code** | ✅ Full (Auth Code + PKCE, DCR) | ✅ (Bearer header) | Streamable HTTP |
| **Cursor** | ✅ (DCR-based) | ✅ (Bearer/header) | Streamable HTTP |
| **Copilot Studio** | ✅ (Dynamic Discovery, Manual) | ✅ (Header/query) | Streamable HTTP only |
| **Claude Desktop** | ✅ (via mcp-remote bridge) | ✅ (via mcp-remote) | Streamable HTTP |
| **Amazon Q Developer** | ✅ (IAM-based) | ❓ | Streamable HTTP |
| **Windsurf** | ✅ | ✅ | Streamable HTTP |
| **Generic HTTP** | ✅ (manual) | ✅ | Streamable HTTP |

**Key finding:** All major MCP clients support OAuth 2.0 for remote servers. Copilot Studio requires Streamable HTTP (no SSE).

---

## 6. Reference Implementations

### 6a. Wouter's BTP MCP Server (`lemaiwo/btp-sap-odata-to-mcp-server`)

| Aspect | Detail |
|--------|--------|
| **Language** | TypeScript (Node.js) |
| **Deployment** | BTP Cloud Foundry (MTA) |
| **Hop 1** | XSUAA OAuth 2.0 — proxies OAuth endpoints to XSUAA |
| **Hop 2** | BTP Destination Service (technical user for discovery, JWT-forwarded for execution) |
| **Per-session auth** | Each MCP session gets its own `MCPServer` instance with user JWT baked in |
| **Scopes/Roles** | `read`, `write`, `admin` via XSUAA role templates |
| **Transport** | Streamable HTTP (primary) + stdio (secondary) |
| **Redirect URIs** | Pre-configured for Claude AI, Cursor, localhost |

**Pattern to adopt:** Per-session MCP server instances with user context. OAuth endpoint proxying to external IdP.

### 6b. AWS ABAP Accelerator ECS Fargate

| Aspect | Detail |
|--------|--------|
| **Language** | Python (FastMCP) |
| **Deployment** | AWS ECS Fargate behind ALB |
| **Hop 1** | OAuth 2.0 (Cognito/Okta/EntraID) — OIDC token validation |
| **Hop 2** | Principal Propagation — ephemeral X.509 certs signed by CA in Secrets Manager |
| **Multi-system** | `x-sap-system-id` header routes to different SAP systems |
| **User mapping** | JWT claim → cert CN → SAP CERTRULE → SAP user |
| **Network** | ALB + WAF → private subnets → VPC peering/Direct Connect → SAP |
| **Secrets** | AWS Secrets Manager (CA key), Systems Manager (SAP endpoints, user exceptions) |

**Pattern to adopt:** Principal propagation for per-user SAP auth. Multi-system routing. Secrets management for CA keys.

---

## 7. Option Comparison Matrix

### Hop 1 Options Compared

| | 1A: MCP OAuth 2.1 | 1B: API Key | 1C: API Gateway | 1D: XSUAA |
|-|-------------------|-------------|-----------------|-----------|
| **User identity** | ✅ Per-user | ❌ Shared | ✅ Per-user | ✅ Per-user |
| **Spec compliant** | ✅ | ❌ | ✅ (transparent) | ✅ (compatible) |
| **Copilot Studio** | ✅ | ✅ | ✅ | ✅ |
| **VS Code/Cursor** | ✅ | ✅ | ✅ | ✅ |
| **Implementation** | Medium | Trivial | Trivial (vsp) | Medium-High |
| **Dependencies** | External IdP | None | Gateway infra | BTP XSUAA |
| **Portability** | Any cloud/server | Any | Any | BTP only |

### Hop 2 Options Compared

| | 2A: Basic Auth | 2B: XSUAA/Dest | 2C: Static mTLS | 2D: Principal Prop | 2E: SAP OAuth |
|-|---------------|----------------|-----------------|-------------------|---------------|
| **Per-user SAP auth** | ❌ | ✅ (with token exchange) | ❌ | ✅ | ✅ (per-user token) |
| **SAP audit trail** | Single user | Per-user possible | Single user | ✅ Per-user | ✅ Per-user |
| **No passwords stored** | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Works without BTP** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **SAP-side setup** | None | Destination+CC | STRUST+CERTRULE | STRUST+CERTRULE | SOAUTH2 |
| **Implementation** | Done ✅ | High | Low | Medium | Medium |

---

## 8. Recommendations

### Recommended Architecture: Tiered Approach

Implement in phases, each building on the previous:

### Phase 1: API Key + Basic Auth (Quick Win)

```
IDE/Copilot ──[API Key in Bearer header]──► vsp (HTTP Streamable) ──[Basic Auth]──► SAP
```

**What to implement:**
- vsp checks `Authorization: Bearer <api-key>` against a configured secret
- vsp connects to SAP with existing Basic Auth (already done)
- Environment variables: `VSP_API_KEY` for the shared key

**Gets you:** A working centralized MCP server that Copilot Studio, VS Code, and Cursor can all connect to. No user identity, single SAP service account.

**Effort:** ~1 day
**Limitation:** No per-user SAP auth. Acceptable for PoC, small teams, read-only.

### Phase 2: MCP OAuth 2.1 + Basic Auth (User Identity)

```
IDE/Copilot ──[OAuth 2.1 / EntraID]──► vsp (validates JWT) ──[Basic Auth]──► SAP
```

**What to implement:**
- Protected Resource Metadata endpoint (`/.well-known/oauth-protected-resource`)
- JWT Bearer token validation (signature, issuer, audience, expiry)
- Per-session user context (extract username from JWT claims)
- Support for EntraID, Cognito, Okta, Keycloak as Authorization Servers

**Gets you:** User identity in vsp (logging, audit), but SAP still uses a shared service account.

**Effort:** ~1 week
**Go dependencies:** `github.com/coreos/go-oidc/v3` for JWKS+JWT validation

### Phase 3: MCP OAuth 2.1 + Principal Propagation (Full Enterprise)

```
IDE/Copilot ──[OAuth 2.1 / EntraID]──► vsp (validates JWT, generates ephemeral cert) ──[mTLS]──► SAP
```

**What to implement:**
- Ephemeral X.509 certificate generation (Go stdlib `crypto/x509`)
- Per-request HTTP client with ephemeral cert
- CA key management (load from file, env, or secrets manager)
- SAP-side: STRUST + CERTRULE configuration

**Gets you:** Per-user SAP authentication. Full audit trail. No shared SAP passwords.

**Effort:** ~1 week (code) + SAP admin setup
**Go dependencies:** None beyond stdlib

### Phase 4 (Optional): BTP Deployment with Destination Service

Only pursue this if customers specifically need BTP deployment. Requires significant Go SDK work for XSUAA/Destination/Connectivity integration, or running vsp behind an approuter sidecar.

---

### Decision Framework

| Question | Answer → Recommendation |
|----------|------------------------|
| Do you need a PoC fast? | Phase 1 (API Key + Basic) |
| Do you need to know who's calling? | Phase 2 (OAuth + Basic) |
| Do you need per-user SAP authorizations? | Phase 3 (OAuth + Principal Propagation) |
| Must you deploy on BTP? | Phase 4 (XSUAA + Destination) |
| Copilot Studio is the primary client? | All phases work. Start with Phase 1. |
| Is it a developer IDE (VS Code/Cursor)? | All phases work. Phase 2+ for user identity. |

### What NOT to Implement

- **Static X.509 from local machine** — Not the use case (vsp is never local)
- **XSUAA Go SDK from scratch** — Too much effort; use standard OAuth2/OIDC instead
- **Kerberos/SPNEGO** — Niche, complex, not needed for centralized deployment
- **Browser SSO** — Not applicable to MCP server-to-server flow

---

## Appendix: MCP OAuth 2.1 Endpoints vsp Needs

For Phase 2, vsp needs these HTTP endpoints in addition to `POST /mcp`:

```
GET  /.well-known/oauth-protected-resource    → Returns JSON:
     {
       "resource": "https://vsp.company.com",
       "authorization_servers": ["https://login.microsoftonline.com/{tenant}/v2.0"],
       "bearer_methods_supported": ["header"],
       "scopes_supported": ["openid", "profile", "SAP.Access"]
     }

POST /mcp                                     → Validates Bearer token, processes MCP request
     Returns 401 with WWW-Authenticate if no/invalid token
```

vsp does NOT need to implement:
- `/oauth/authorize` (that's the Authorization Server's endpoint)
- `/oauth/token` (that's the Authorization Server's endpoint)
- Dynamic Client Registration (optional, client manages this with the Authorization Server)

The only new logic is: **validate JWT on every request + serve one metadata endpoint.**

---

## Sources

### MCP Specification
- [MCP Authorization Specification (Draft)](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [Auth0 - MCP Specs Update: All About Auth](https://auth0.com/blog/mcp-specs-update-all-about-auth/)

### Reference Implementations
- [lemaiwo/btp-sap-odata-to-mcp-server](https://github.com/lemaiwo/btp-sap-odata-to-mcp-server) — BTP + XSUAA + Destination Service
- [AWS ABAP Accelerator](https://github.com/aws-solutions-library-samples/guidance-for-deploying-sap-abap-accelerator-for-amazon-q-developer) — ECS Fargate + Principal Propagation

### Client Compatibility
- [Copilot Studio - Connect MCP Server](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)
- [VS Code MCP Authorization (Issue #247759)](https://github.com/microsoft/vscode/issues/247759)
- [Secure MCP with Entra ID for Copilot Studio](https://ashiqf.com/2026/03/19/secure-your-mcp-server-with-entra-id-authentication-for-copilot-studio/)
