# ARC-1 Architecture

This page explains how ARC-1 is put together for admins, integrators, and future
maintainers. It focuses on the runtime path a user request takes, the security
gates that protect SAP, and the code areas to inspect when extending the server.

For a flat list of flags, see [Configuration Reference](configuration-reference.md).
For exact tool inputs, see [Tools Reference](tools.md). For authorization recipes,
see [Authorization & Roles](authorization.md).

## Current model

| Area | Current architecture |
| ---- | -------------------- |
| Runtime | TypeScript MCP server on Node.js 22+, distributed as npm package and Docker image. |
| MCP transports | `stdio` for local clients and `http-streamable` for hosted/server deployments. |
| Tool surface | Standard mode exposes 12 intent-based tools. Hyperfocused mode exposes one `SAP` tool. |
| SAP access | ADT REST APIs under `/sap/bc/adt/*`, plus selected OData/utility endpoints for UI5, Git, FLP, and diagnostics. |
| MCP auth | HTTP mode supports API-key profiles, OIDC JWTs, and XSUAA OAuth proxy mode. Stdio relies on local process trust. |
| SAP identity | Shared SAP credentials, BTP ABAP service-key OAuth, BTP Destination, or per-user principal propagation. |
| Safety | Server opt-in flags form the ceiling. User scopes and SAP authorization can only restrict further. |
| Cache | Memory cache for local stdio by default; SQLite for HTTP by default. Server-validated freshness via `If-None-Match` / `ETag` (no TTL). Optional startup warmup. See [Caching System](caching.md). |
| Observability | Structured logs and audit events to stderr, optional file sink, and optional BTP Audit Log sink. |

## High-level architecture

```mermaid
flowchart TB
    subgraph Clients["MCP clients"]
        Claude[Claude / Claude Code]
        IDE[Cursor / VS Code / Gemini CLI]
        Copilot[Copilot Studio]
        Other[Other MCP clients]
    end

    subgraph Transport["ARC-1 transport"]
        Stdio[stdio]
        HTTP[Streamable HTTP<br/>/mcp + /health]
    end

    subgraph Auth["HTTP auth layer"]
        ApiKey[API-key profiles<br/>ARC1_API_KEYS]
        OIDC[OIDC JWT validation<br/>issuer + audience + JWKS]
        XSUAA[XSUAA OAuth proxy<br/>MCP auth endpoints + PRM]
    end

    subgraph Server["MCP server"]
        ListTools[Tool listing<br/>feature-aware + scope-pruned]
        Handler[Tool call handler<br/>policy + Zod + audit]
        Tools[12 intent tools<br/>or 1 hyperfocused SAP tool]
    end

    subgraph Policy["Authorization and safety"]
        ActionPolicy[ACTION_POLICY<br/>scope + operation type]
        Deny[SAP_DENY_ACTIONS]
        Safety[Safety config<br/>allow* flags + allowlists]
    end

    subgraph Runtime["Runtime services"]
        Cache[Cache layer<br/>memory / SQLite]
        Probe[Startup probes<br/>features + discovery map]
        Audit[Audit sinks<br/>stderr / file / BTP Audit Log]
    end

    subgraph ADT["SAP client layer"]
        Facade[AdtClient facade<br/>read/search/query]
        Modules[ADT modules<br/>CRUD, devtools, codeintel,<br/>diagnostics, transport, Git, FLP]
        HttpClient[ADT HTTP client<br/>CSRF, cookies, sessions,<br/>MIME negotiation, retries]
    end

    subgraph SAP["SAP landscape"]
        ADTAPI[SAP ADT REST API]
        BTP[BTP Destination / Connectivity / Cloud Connector]
        ABAP[BTP ABAP Environment OAuth]
    end

    Claude & IDE & Copilot & Other --> Stdio
    Claude & IDE & Copilot & Other --> HTTP
    HTTP --> Auth
    Auth --> Server
    Stdio --> Server
    ListTools --> Tools
    Handler --> ActionPolicy --> Deny --> Safety
    Handler --> Cache
    Handler --> Audit
    Handler --> Facade --> Modules --> HttpClient
    Probe --> ListTools
    Probe --> HttpClient
    Cache --> Facade
    HttpClient --> ADTAPI
    HttpClient --> BTP --> ADTAPI
    HttpClient --> ABAP --> ADTAPI
```

## Request flow

A tool call is intentionally gated more than once. ARC-1 blocks early when it can,
then SAP still performs the final authorization check with the SAP user identity.

```mermaid
sequenceDiagram
    participant Client as MCP client
    participant HTTP as HTTP auth layer
    participant Server as MCP server
    participant Policy as ACTION_POLICY + denyActions
    participant Safety as Effective safety config
    participant Handler as Intent handler
    participant ADT as ADT client
    participant SAP as SAP system

    Client->>HTTP: POST /mcp tool call
    alt HTTP auth configured
        HTTP->>HTTP: API key match or JWT validation
        HTTP-->>Server: authInfo with scopes
    else stdio or open HTTP
        HTTP-->>Server: no authInfo
    end

    Server->>Server: Startup auth preflight check
    alt Principal propagation enabled and JWT available
        Server->>Server: Create per-user ADT client from BTP Destination
    end

    Server->>Server: Normalize args (strip null/empty GPT-pollution, drop inapplicable include)
    Server->>Policy: Check required scope and SAP_DENY_ACTIONS
    Policy-->>Server: allow or deny
    Server->>Server: Zod input validation
    Server->>Safety: Derive effective safety from server ceiling + user scopes/profile
    Server->>Handler: Route by tool and action/type
    Handler->>ADT: High-level operation
    ADT->>ADT: checkOperation/checkPackage/checkTransport/checkGit
    ADT->>SAP: ADT HTTP request
    SAP-->>ADT: SAP response or SAP auth error
    ADT-->>Handler: Parsed result
    Handler-->>Server: Tool result
    Server-->>Client: MCP result
```

The important invariant is:

```text
Effective permission = server safety ceiling AND user scope/profile AND SAP authorization
```

A user role can never expand what the ARC-1 instance was configured to allow.
If `SAP_ALLOW_WRITES=false`, no user can write, even with `admin` scope.

### Rate-limiting layers in the request flow

Three rate-limiting layers gate the request flow at different stages:

- **Layer 1** runs at the HTTP edge BEFORE any auth middleware (`express-rate-limit` per-IP on `/register`, `/authorize`, `/token`, `/revoke`, `/mcp`). Anonymous probing is rejected with HTTP `429` before any work happens.
- **Layer 2** runs at the top of `handleToolCall`, AFTER `authInfo` is available but BEFORE scope/Zod/safety checks. A per-user token bucket returns an MCP tool error (not HTTP 429) so the LLM agent loop backs off.
- **Layer 3** is the server-wide `Semaphore` inside the ADT HTTP client — caps concurrent SAP requests across ALL users (shared + per-user PP). Honors `Retry-After` on `429`/`503` from SAP or BTP gateways.

See the [Rate Limiting Guide](rate-limiting.md) and [ADR-0004](../docs/adr/0004-layered-rate-limiting.md).

## Tool listing flow

Tool listing is dynamic. Users should treat the exposed schema as the server's
current capability view, not as a static contract copied from documentation.

```mermaid
sequenceDiagram
    participant Client as MCP client
    participant Server as MCP server
    participant Probe as Startup probe cache
    participant Tools as Tool definitions
    participant Policy as Scope/deny pruning

    Client->>Server: tools/list
    Server->>Probe: Wait up to 10s for feature probe
    Probe-->>Server: Features + ADT discovery map
    Server->>Tools: Build standard or hyperfocused tool schema
    alt authInfo present
        Server->>Policy: Remove actions/types missing scope or denied by policy
    end
    Server-->>Client: Available tools and input schemas
```

Tool schemas also adapt to backend and configuration:

- `ARC1_TOOL_MODE=standard` exposes the intent tools.
- `ARC1_TOOL_MODE=hyperfocused` exposes one `SAP` tool with an `action` router.
- BTP mode hides or rewords classic object types that are not available in BTP ABAP Environment.
- Write actions appear only when the relevant server flags are enabled.
- `SAPGit` appears only when gCTS or abapGit is detected or forced on.
- `SAPTransport` appears unless the transport feature is forced off.

## Tool surface

Standard mode groups many ADT endpoints into 12 intent-based tools.

| Tool | Intent | Notes |
| ---- | ------ | ----- |
| `SAPRead` | Read ABAP objects, DDIC metadata, system info, UI5/BSP files, API state, revisions. | `TABLE_CONTENTS` needs data-preview permission. |
| `SAPSearch` | Object search and source-code search. | Source-code search depends on backend support. |
| `SAPWrite` | Create, update, delete, method surgery, RAP batch/scaffold actions. | Registered only when writes are enabled. |
| `SAPActivate` | Activate objects and publish/unpublish service bindings. | Registered only when writes are enabled. |
| `SAPNavigate` | Definition, references, completion, hierarchy. | Some ADT read endpoints use POST. |
| `SAPQuery` | Freestyle ABAP SQL. | Requires SQL scope and `SAP_ALLOW_FREE_SQL=true`. |
| `SAPContext` | Dependency context, usages, and CDS impact analysis. | Uses cache for reverse usages. |
| `SAPLint` | Local abaplint, formatting, formatter settings, pre-write validation helpers. | Formatter settings mutation needs write permission. |
| `SAPDiagnose` | Syntax, unit tests, ATC, quick fixes, dumps, traces, gateway errors, system messages. | Diagnostic reads can still execute backend checks. |
| `SAPManage` | Feature probe, cache stats, packages, package moves, FLP catalog/group/tile actions. | Read actions stay visible in read-only mode. |
| `SAPTransport` | CTS list/get/check/history and mutations. | Write actions require transport write opt-in. |
| `SAPGit` | gCTS and abapGit read/write operations. | Feature-gated by detected backend support. |

Hyperfocused mode maps one `SAP` action to the same underlying handlers:

| `SAP` action | Delegates to |
| ------------ | ------------ |
| `read` | `SAPRead` |
| `search` | `SAPSearch` |
| `query` | `SAPQuery` |
| `write` | `SAPWrite` |
| `activate` | `SAPActivate` |
| `navigate` | `SAPNavigate` |
| `context` | `SAPContext` |
| `lint` | `SAPLint` |
| `diagnose` | `SAPDiagnose` |
| `transport` | `SAPTransport` |
| `git` | `SAPGit` |
| `manage` | `SAPManage` |

The concrete delegated tool/action still enforces the real policy.

## Authentication and SAP identity

ARC-1 has two separate authentication questions:

| Question | Layer | Current options |
| -------- | ----- | --------------- |
| Who is calling ARC-1? | MCP client auth | API key profiles, OIDC JWT, XSUAA OAuth proxy, or no auth in trusted local mode. |
| Who is ARC-1 in SAP? | SAP auth | Basic credentials, cookies, BTP ABAP service-key OAuth, BTP Destination, or principal propagation. |

### HTTP auth modes

```mermaid
flowchart TD
    Request[HTTP /mcp request] --> AuthMode{Configured auth?}
    AuthMode -->|API keys| ApiKey[Exact bearer token match<br/>profile -> scopes + profile safety]
    AuthMode -->|OIDC| OIDC[JWT verify<br/>issuer + audience + JWKS]
    AuthMode -->|XSUAA| XSUAA[MCP OAuth proxy<br/>authorize/token/register metadata]
    AuthMode -->|None| Open[Open HTTP endpoint<br/>trusted network only]

    ApiKey --> AuthInfo[authInfo.scopes]
    OIDC --> AuthInfo
    XSUAA --> AuthInfo
    Open --> NoAuth[No authInfo]

    AuthInfo --> ScopeCheck[Scope-aware runtime checks]
    NoAuth --> SafetyOnly[Server safety + SAP auth only]
```

API-key and OIDC mode expect the client to send `Authorization: Bearer ...` to
`/mcp`. XSUAA mode additionally exposes MCP OAuth endpoints through the SDK auth
router, including protected-resource metadata for `/mcp`.

### SAP identity modes

```mermaid
flowchart TD
    ToolCall[Tool call] --> PP{Principal propagation?}
    PP -->|Enabled + JWT| UserDest[Lookup BTP Destination<br/>with X-User-Token]
    UserDest --> PerUser[Per-user ADT client<br/>SAP sees end user]
    PP -->|Disabled or unavailable| Shared[Shared ADT client]

    Shared --> SharedAuth{Shared SAP auth}
    SharedAuth --> Basic[Basic username/password]
    SharedAuth --> Cookie[Cookie file/string]
    SharedAuth --> Dest[BTP Destination]
    SharedAuth --> ServiceKey[BTP ABAP service-key OAuth]

    PerUser --> SAP[SAP ADT authorization]
    Basic --> SAP
    Cookie --> SAP
    Dest --> SAP
    ServiceKey --> SAP
```

In strict principal propagation mode (`SAP_PP_STRICT=true`), a request fails if
ARC-1 cannot build the per-user SAP client. Without strict mode, ARC-1 can fall
back to the shared client after logging an audit event.

## Safety system

The server safety config is the hard ceiling for the instance. It uses positive
opt-ins and starts restrictive by default.

```mermaid
flowchart TD
    Request[Validated tool action] --> Denied{SAP_DENY_ACTIONS match?}
    Denied -->|Yes| BlockD[Blocked]
    Denied -->|No| Mutating{Mutation?}
    Mutating -->|Yes| Writes{SAP_ALLOW_WRITES=true?}
    Writes -->|No| BlockW[Blocked]
    Writes -->|Yes| Family{Transport/Git/Data/SQL family?}
    Mutating -->|No| Family

    Family -->|Table preview| Data{SAP_ALLOW_DATA_PREVIEW=true?}
    Family -->|Free SQL| Sql{SAP_ALLOW_FREE_SQL=true?}
    Family -->|Transport write| Transport{SAP_ALLOW_TRANSPORT_WRITES=true?}
    Family -->|Git write| Git{SAP_ALLOW_GIT_WRITES=true?}
    Family -->|Object/package write| Package{Package allowed?}
    Family -->|Plain read/search/nav| OK[Execute]

    Data -->|No| BlockData[Blocked]
    Sql -->|No| BlockSql[Blocked]
    Transport -->|No| BlockTransport[Blocked]
    Git -->|No| BlockGit[Blocked]
    Package -->|No| BlockPkg[Blocked]

    Data -->|Yes| OK
    Sql -->|Yes| OK
    Transport -->|Yes| OK
    Git -->|Yes| OK
    Package -->|Yes| OK
```

Runtime policy is centralized in `src/authz/policy.ts`. It maps every tool
action/type to a user scope and internal operation type. `src/handlers/intent.ts`
checks that policy before input validation, and `src/server/server.ts` uses the
same policy to prune tool schemas during `tools/list`.

## ADT client and HTTP layer

The ADT client layer is intentionally split by domain so the main client facade
does not become one huge file.

| Area | Main files | Responsibility |
| ---- | ---------- | -------------- |
| Client facade | `src/adt/client.ts` | Read/search/query methods and shared client construction. |
| HTTP transport | `src/adt/http.ts` | CSRF tokens, cookies, stateful sessions, auth headers, retries, concurrency limit, MIME negotiation. |
| CRUD | `src/adt/crud.ts` | Lock/create/update/delete/unlock flows. |
| Activation and checks | `src/adt/devtools.ts` | Syntax, activation, preaudit handshake, unit tests, ATC, quick fixes, PrettyPrinter. |
| Code intelligence | `src/adt/codeintel.ts` | Definition, references, where-used, completion. |
| Diagnostics | `src/adt/diagnostics.ts` | Dumps, traces, gateway errors, system messages. |
| Transports | `src/adt/transport.ts` | CTS list/get/check/create/release/delete/reassign/history. |
| Git | `src/adt/gcts.ts`, `src/adt/abapgit.ts` | gCTS and abapGit operations. |
| BTP | `src/adt/btp.ts`, `src/adt/oauth.ts` | Destination Service, Connectivity proxy, BTP ABAP service-key OAuth. |
| UI tooling | `src/adt/ui5-repository.ts`, `src/adt/flp.ts` | UI5 repository and FLP catalog/group/tile operations. |
| Parsing | `src/adt/xml-parser.ts` | ADT XML and Atom response parsing. |

All ADT endpoints must be guarded by `checkOperation()` before the HTTP request.
Write paths also use package, transport, or Git-specific checks where relevant.

Stateful mutation patterns use the same ADT session for lock, modify, and unlock:

```mermaid
sequenceDiagram
    participant Handler as SAPWrite handler
    participant HTTP as ADT HTTP client
    participant SAP as SAP ADT

    Handler->>HTTP: withStatefulSession()
    HTTP->>SAP: Lock object
    SAP-->>HTTP: Lock handle
    HTTP->>SAP: Modify source/metadata with lock handle
    SAP-->>HTTP: Update response
    HTTP->>SAP: Unlock object
    SAP-->>HTTP: Unlock response
    HTTP-->>Handler: Done
```

## Cache, probes, and audit

These services are cross-cutting rather than tied to one tool.

| Service | Main files | What it does |
| ------- | ---------- | ------------ |
| Cache | `src/cache/*` | Stores source (per-version, with SAP `ETag`), dependency graphs (hash-keyed), dependency edges, node metadata, function-group mappings, and a per-username inactive-objects list. Source reads use `If-None-Match` so the SAP backend itself confirms freshness on every cache hit. |
| Cache warmup | `src/cache/warmup.ts` | Pre-indexes custom objects so `SAPContext(action="usages")` can answer reverse dependency questions. Stores ETags so re-runs against unchanged systems are essentially free (304 responses). |
| Feature probes | `src/adt/features.ts`, `src/probe/*` | Detects backend support and builds the ADT discovery map used for tool schemas and MIME negotiation. |
| Context compression | `src/context/*` | Extracts public contracts, CDS dependencies, method-level slices, and compact dependency context. |
| Lint | `src/lint/*` | Builds ABAP lint config and runs local lint/format/pre-write validation. |
| AFF validation | `src/aff/*` | Validates ABAP File Format metadata for selected create/batch-create paths. |
| Audit | `src/server/audit.ts`, `src/server/sinks/*` | Emits tool, auth, HTTP, elicitation, activation, and server lifecycle audit events. |

## Deployment patterns

| Pattern | Transport | Typical SAP auth | Best for |
| ------- | --------- | ---------------- | -------- |
| Local developer | `stdio` | Basic credentials, cookies, or BTP ABAP service key | One developer using a local MCP client. |
| Shared HTTP server | `http-streamable` | Shared Basic/cookie/destination credentials | Team sandbox or controlled internal service. |
| Enterprise HTTP | `http-streamable` | OIDC/XSUAA for MCP auth plus shared SAP auth | Centralized ARC-1 with per-user ARC-1 scopes. |
| Enterprise with SAP identity | `http-streamable` | XSUAA/OIDC plus per-user BTP Destination path | SAP sees the real end user; strongest audit story. |
| BTP ABAP local | `stdio` | Service-key OAuth with browser login/token refresh | One developer connecting directly to SAP BTP ABAP Environment. |
| BTP ABAP on CF | `http-streamable` | XSUAA plus Destination `OAuth2UserTokenExchange` | Centrally managed, headless BTP ABAP access with per-user SAP identity. |

BTP Cloud Foundry with Destination Service and Cloud Connector looks like this:

```mermaid
flowchart LR
    Client[MCP client] -->|"HTTPS + bearer token"| ARC1[ARC-1 on BTP CF]
    ARC1 -->|"Destination lookup"| DS[Destination Service]
    ARC1 -->|"Connectivity proxy"| CS[Connectivity Service]
    CS -->|"Secure tunnel"| CC[Cloud Connector]
    CC -->|"HTTP/HTTPS"| SAP[On-prem SAP ABAP]
```

With principal propagation, ARC-1 performs the destination lookup with the user's
JWT so the Connectivity stack can propagate the user's identity to SAP.

For BTP ABAP Environment on Cloud Foundry, the same per-user destination path uses
`OAuth2UserTokenExchange` instead of Cloud Connector. The Destination service
returns an ABAP-context bearer token, and ARC-1 sends that token to ADT.

## Where to change code

| Change | Start here |
| ------ | ---------- |
| Add a new tool action/type | `src/handlers/schemas.ts`, `src/authz/policy.ts`, `src/handlers/tools.ts`, `src/handlers/intent.ts` |
| Add a new ADT read | `src/adt/client.ts`, parser in `src/adt/xml-parser.ts` if needed, handler in `src/handlers/intent.ts` |
| Add a new mutation | Domain module in `src/adt/`, safety checks in `src/adt/safety.ts`, route in `src/handlers/intent.ts` |
| Add scope or safety behavior | `src/authz/policy.ts`, `src/adt/safety.ts`, `src/server/server.ts` |
| Add HTTP auth behavior | `src/server/http.ts`, `src/server/xsuaa.ts` |
| Add SAP identity/BTP behavior | `src/adt/btp.ts`, `src/adt/oauth.ts`, `src/server/server.ts` |
| Add cache behavior | `src/cache/*`, `src/context/*` |
| Add diagnostics | `src/adt/diagnostics.ts`, `src/handlers/intent.ts`, `src/handlers/tools.ts` |

When adding a new action, keep the four source-of-truth files aligned:

1. Input schema in `src/handlers/schemas.ts`
2. User/safety policy in `src/authz/policy.ts`
3. Tool description/schema in `src/handlers/tools.ts`
4. Runtime handler in `src/handlers/intent.ts`

Then run:

```bash
npm run validate:policy
npm run typecheck
npm test
```
