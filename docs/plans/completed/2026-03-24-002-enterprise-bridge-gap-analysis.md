# Enterprise SAP Bridge — Gap Analysis (Dual Purpose)

**Date:** 2026-03-24
**Report ID:** 002
**Subject:** Comprehensive gap analysis of competing ADT MCP servers vs. vsp — enterprise bridge for Copilot Studio AND developer IDE proxy
**Related Documents:** 2026-03-23-001-enterprise-copilot-studio-plan.md, 2026-03-24-001-feature-parity-implementation.md

---

## Executive Summary

### Dual-Purpose Vision

vsp is not just a Copilot Studio ↔ SAP connector. It is an **enterprise-controlled proxy between any AI client (Copilot Studio, Claude, IDE extensions) and SAP systems**. Two deployment modes, same binary:

| Mode | Client | Auth (now) | Auth (future) | Tool Surface |
|------|--------|------------|---------------|--------------|
| **Copilot Studio connector** | Microsoft Copilot Studio | Hardcoded local config (user/password in vsp config) | OAuth / principal propagation via EntraID | 10–11 intent-based tools, read-only default |
| **Developer ADT proxy** | VS Code, Cursor, Claude Code, any MCP client | Basic auth, cookie, X.509 cert | Kerberos, OAuth, principal propagation | Full tool set (80+ tools), write-enabled |

Both modes share the same binary, same ADT client code, same safety system. The difference is tool surface, default permissions, and auth strategy.

### Key Findings

vsp is already the most feature-complete ADT MCP implementation. The gaps that matter:

1. **Auth is the biggest gap** — but the priorities differ by deployment mode:
   - *Copilot Studio (now):* Hardcoded basic auth in local config. Works. Ship it.
   - *Developer proxy (now):* Basic auth + cookie auth. Already works for local IDE use.
   - *Both (future):* X.509 mTLS → principal propagation → multi-user with audit trails.

2. **Multi-system routing** — table stakes for enterprise. One vsp instance serving dev/QA/prod.

3. **Developer-facing ADT gaps** are more important than previously rated: quick fix proposals, code refactoring (rename/extract method), ABAP documentation hover, recursive package tree — these are IDE-grade features that make vsp a legitimate VS Code ADT replacement.

4. **Object API release status (C1)** — critical for both Copilot ("is this API cloud-safe?") and developers ("can I use this in ABAP Cloud?").

5. **Migration/cloud readiness analysis** — high enterprise value for both modes.

---

## Repository Analysis

### 1. marcellourbani/abap-adt-api

**What it is:** The TypeScript reference library for SAP ADT REST API. Every other Node.js project wraps this library. It is the definitive inventory of what ADT endpoints exist.

**Complete method count: 127 methods** across session, navigation, CRUD, DDIC, code intelligence, refactoring, quick fixes, ATC, unit tests, traces, abapGit, transport, debugger.

**ADT endpoints in this library NOT in vsp:**

| Endpoint / Feature | ADT URL Pattern | Notes |
|--------------------|-----------------|-------|
| Code Refactoring – Rename | `/sap/bc/adt/refactorings?step=evaluate/preview/execute&rel=.../rename` | 3-step preview flow |
| Code Refactoring – Extract Method | `/sap/bc/adt/refactorings?step=...&rel=.../extractmethod` | |
| Code Refactoring – Change Package | `/sap/bc/adt/refactorings?step=...&rel=.../changepackage` | |
| Quick Fix Proposals | `/sap/bc/adt/quickfixes/evaluation` | Returns fix proposals for a diagnostic |
| Quick Fix Edits | `/sap/bc/adt/quickfixes/execution` | Applies a fix proposal |
| ABAP Documentation Hover | `/sap/bc/adt/docu/abap/langu` | Keyword/object doc at cursor position |
| SSCR Object Registration | `/sap/bc/adt/sscr/registration/objects` | Registration info for customer objects |
| Package Search Help | `/sap/bc/adt/packages/valuehelps/{type}` | Application components, software components, transport layers |
| ATC Exemption Proposal | `/sap/bc/adt/atc/exemptions/proposal` | Create exemption proposal |
| ATC Request Exemption | `/sap/bc/adt/atc/exemptions/apply` | Submit exemption request |
| ATC Contact / Reassignment | `/sap/bc/adt/atc/items` | Change finding contact |
| Trace Hit List | `/sap/bc/adt/runtime/traces/abaptraces/{id}/hitlist` | |
| Trace DB Access Detail | `/sap/bc/adt/runtime/traces/abaptraces/{id}/dbAccesses` | |
| Trace Statement Detail | `/sap/bc/adt/runtime/traces/abaptraces/{id}/statements` | |
| Trace Configuration CRUD | `/sap/bc/adt/runtime/traces/abaptraces/parameters` | |
| Trace Request Management | `/sap/bc/adt/runtime/traces/abaptraces/requests` | |
| abapGit Native REST | `/sap/bc/adt/abapgit/repos` | list, pull, push, branch switch (vsp uses WebSocket) |
| Usage Reference Snippets | `/sap/bc/adt/repository/informationsystem/usageSnippets` | Code context around where-used hits |
| Unit Test Occurrence Markers | `/sap/bc/adt/abapsource/occurencemarkers` | Test coverage markers in source |
| Transport Set Owner | `/sap/bc/adt/cts/transportrequests/{id}` (PATCH) | |
| Transport Add User | `/sap/bc/adt/cts/transportrequests/{id}` (PATCH) | |
| Transport Reference by Object | `/sap/bc/adt/cts/transportrequests/reference` | Which transport contains an object |

**Notable BearerFetcher pattern:** The library allows a dynamic `BearerFetcher` callback that is called on 401 to refresh a token. This means the client can be created once and tokens can be refreshed transparently — relevant for long-lived Copilot Studio server processes where OAuth tokens expire.

**Assessment:** vsp already covers ~70% of this library's surface. The gaps are real but narrowly scoped. No showstopper; each is a discrete add.

---

### 2. SaurabhVC/ABAPDocMCP

**What it does:** Generates 32-section technical specifications from SAP transport requests covering WRICEF categories (Reports, Interfaces, Conversions, Enhancements, Forms, Workflows, OData/RAP).

**Unique value:** The "generate a tech spec from transport numbers" use case. Given one or more transports, it reads all contained objects, fetches their source, and produces structured Markdown with Mermaid diagrams showing colour-coded object relationships. No equivalent in vsp.

**ADT endpoints:** Standard subset — transport metadata, object source, object type discovery. Nothing new at the API level.

**Auth:** Basic auth only.

**Enterprise Copilot Studio relevance: HIGH.** The tool pattern is highly relevant. A Copilot user saying "what does transport DEVK900123 do?" and getting a structured spec is a killer use case. This is pure business logic on top of existing ADT calls — no new ADT integration needed, just a new MCP tool that orchestrates multiple existing calls.

**Implementation effort: MEDIUM.** All ADT primitives already exist in vsp. Need orchestration logic to: (1) get transport content list, (2) fetch source for each object, (3) produce structured output. Could be a workflow/tool in vsp.

---

### 3. chandrashekhar-mahajan/abap-mcp-server

**What it does:** 15-tool Node.js MCP server with the most complete enterprise auth story of any competing implementation.

**Auth strategies (all implemented, in Node.js):**

#### Kerberos/SPNEGO
The Windows/AD SSO path. Flow:
1. User machine is domain-joined and has active Kerberos TGT from Active Directory / EntraID Kerberos.
2. MCP server calls `kerberos.initializeClient("HTTP/sap-host@CORP.DOMAIN")` using Windows SSPI.
3. Calls `client.step("")` to extract SPNEGO token from OS credential cache — **no password required**.
4. Sends `Authorization: Negotiate <base64-token>` to SAP ICM.
5. SAP validates via SPNEGO login module (configured in SAP profile, `login/create_sso2_ticket`).
6. SAP returns `MYSAPSSO2` cookie for subsequent requests.

**Go implementation:** `jcmturner/gokrb5` library. Medium effort. Relevant only when vsp runs on a domain-joined host. For a cloud-hosted Copilot Studio connector this does NOT apply — a cloud host has no Kerberos TGT.

**Enterprise relevance: Medium** — valuable for on-premise self-hosted deployments in corporate Windows environments. Not applicable for cloud-hosted connectors.

#### OAuth 2.0 + PKCE (SAP native)
Targets SAP's own OAuth 2.0 server at `/sap/bc/adt/sec/oauth2/`. Generates PKCE S256 challenge, opens browser for interactive consent. This is for **developer-facing** flows, not service-to-service.

**Enterprise relevance for Copilot Studio: LOW** — Copilot Studio uses server-to-server auth. Interactive PKCE is not viable.

#### X.509 mTLS
Loads client cert + private key, builds TLS connection, SAP maps cert Subject CN to SAP username via `CERTRULE`/`STRUST`. **This is the critical building block for principal propagation.**

**Go implementation:** Standard `crypto/tls` + `tls.Config.Certificates`. Low effort to add `--cert-file`/`--key-file` config. Existing test SAP server can be configured for cert auth.

**Enterprise relevance: HIGH.** Directly needed for principal propagation architecture.

#### Browser SSO Cookie Capture
Bookmarklet extracts session cookies, posts to MCP server. Manual, not scalable. **Not viable for Copilot Studio.**

**Auth auto-detection:** The server tries basic → cert → OAuth → browser SSO in sequence. Useful pattern — vsp could adopt an auth cascade with the same order.

**ADT coverage vs. vsp:** Standard set. No new ADT endpoints beyond what vsp has.

---

### 4. buettnerjulian/abap-adt-mcp

**What it does:** 22-tool Node.js server wrapping `abap-adt-api`. Clean implementation.

**Notable unique tool: `API_Releases`**
Retrieves the API release state of an ABAP object:
- Not Released
- Released for Key Users (C1)
- Released for System-External Use
- Deprecated

This uses object structure `<adtcore:link rel="...releases...">` to find the release info endpoint. High value for Copilot Studio users checking whether it is safe to use an API in an ABAP Cloud or extension scenario.

**`TLS_REJECT_UNAUTHORIZED` env var:** Maps to `SAP_INSECURE` in vsp — already covered. The env var name difference is just Node.js convention.

**Auth:** Basic only. No enterprise auth.

---

### 5. workskong/mcp-abap-adt

**What it does:** 22-tool Node.js server. Notable for two patterns:

**SAP_LANGUAGE per-request:** The language parameter is passed in every ADT request header (`sap-language: EN`). vsp has `--language` / `SAP_LANGUAGE` at startup but this shows that some ADT operations return different results depending on the language (descriptions, documentation text). Worth verifying vsp sends the language header on all requests.

**Per-request credential override via HTTP headers:** `X-SAP_USERNAME` / `X-SAP_PASSWORD` headers allow multi-user operation without per-user server instances. The server extracts credentials from the incoming request header rather than using a fixed configured credential. This is a lightweight (but insecure in production) multi-user pattern.

**`Get_MessageClass` tool:** Fetches ABAP message class contents. vsp does not have this as a dedicated tool — messages are part of the standard object structure but not specifically surfaced. Medium value.

**API_Releases:** Same as buettnerjulian. Not in vsp.

**Assessment:** Nothing unique beyond the language/per-request-credential patterns and `API_Releases`. All core ADT tools are better implemented in vsp.

---

### 6. DataZooDE/erpl-adt

**What it does:** C++ CLI + MCP server. Single binary, similar strategic positioning to vsp.

**Notable:** abapGit deploy state machine — tracks deployment state across multiple repositories with dependency ordering via YAML. This is a superset of vsp's batch import concept but at the infrastructure level. Not relevant for Copilot Studio use case.

**ADT coverage:** Standard set. No gaps vs. vsp.

**Auth:** CLI flags / `.adt.creds` file / env vars. Basic only.

**Assessment:** Nothing new for vsp's enterprise goals.

---

### 7. mario-andreschak/mcp-abap-adt

**What it does:** 13-tool minimal Node.js server.

**Notable edge case:** Uses a custom Z endpoint (`/z_mcp_abap_adt/z_tablecontent`) for table contents as a workaround for SAP BTP systems where `/sap/bc/adt/datapreview/ddic` is locked down. This is relevant: some SAP BTP tenants or hardened systems block the standard data preview endpoint. vsp should document this behaviour and potentially support a custom-endpoint config for these environments.

**ADT coverage:** Subset of vsp. Nothing new.

---

### 8. mario-andreschak/mcp-abap-abap-adt-api

**What it does:** Full-featured Node.js server wrapping `abap-adt-api`. The most complete Node.js implementation found.

**Notable tools not in vsp:**
- `GetAbapAST` — Abstract Syntax Tree extraction (server-side, via ADT `/sap/bc/adt/abapsource/ast` or similar). **Note:** vsp already has a superior Go-native abaplint lexer and parser, making this partially moot, but the server-side AST via ADT may provide richer semantic information.
- `GetAbapSemanticAnalysis` — Semantic analysis (type resolution, call graph at source level).
- `GetIncludesList` — Recursive include discovery for a program. Simple but useful.
- `GetPackageTree` / `GetPackageContents` — Recursive package tree walking. vsp has `GetPackage` for a single level but not recursive tree walk.
- `DescribeByList` — Bulk object description (batch metadata fetch for many objects in one call).
- `RuntimeListProfilerTraceFiles` / `RuntimeGetProfilerTraceData` — Profiler file listing and data at greater granularity than vsp's current `ListTraces`/`GetTrace`.

**Auth (same as fr0ster):** JWT/XSUAA (BTP), Service Key (destination-based), RFC (legacy), Basic, file-based sessions.

**BTP limitation handling:** Returns descriptive error when table data preview is blocked by BTP backend policies — graceful degradation rather than generic HTTP error.

**Handler groups:** `readonly`, `high` (write), `low` (dangerous writes), `legacy` — maps to vsp's focused/expert/read-only modes. Good pattern confirmation.

---

### 9. aws-solutions-library-samples/guidance-for-deploying-sap-abap-accelerator-for-amazon-q-developer

**This is the most strategically important repo in the ecosystem.** Take careful note.

**Architecture overview:**
Amazon Q Developer → MCP Server (Python/FastAPI) → SAP ABAP System
                           ↑
                    AWS Secrets Manager (CA key)
                    + Cognito/EntraID OIDC validation

**15 tools covered:**
- `aws_abap_cb_get_objects` — enumerate objects in package
- `aws_abap_cb_search_object` — object search
- `aws_abap_cb_get_source` — source retrieval
- `aws_abap_cb_create_object` — object creation
- `aws_abap_cb_update_source` — source update
- `aws_abap_cb_check_syntax` — syntax check
- `aws_abap_cb_activate_object` — activation
- `aws_abap_cb_run_atc_check` — ATC quality gate
- `aws_abap_cb_run_unit_tests` — unit tests
- `aws_abap_cb_get_test_classes` — test class discovery
- `aws_abap_cb_activate_objects_batch` — bulk activation
- `aws_abap_cb_create_or_update_test_class` — test infra management
- `aws_abap_cb_get_transport_requests` — transport status
- `aws_abap_cb_get_migration_analysis` — **cloud readiness assessment** (unique)
- `aws_abap_cb_connection_status` — system availability check

**Principal Propagation Architecture (CRITICAL for enterprise Copilot Studio):**

This is the pattern to adopt for vsp + EntraID + Azure Key Vault:

```
Copilot Studio User → EntraID login → OIDC token
       ↓
vsp HTTP server receives Bearer token in Authorization header
       ↓
vsp validates token (JWKS from EntraID tenant endpoint)
       ↓
vsp extracts user claim (email → SAP username mapping)
       ↓
vsp fetches CA private key from Azure Key Vault
       ↓
vsp generates ephemeral X.509 cert (5-min validity, CN=SAP_USERNAME)
       ↓
vsp uses ephemeral cert for SAP mTLS connection
       ↓
SAP validates cert against trusted CA (configured in STRUST)
SAP maps CN to SAP user via CERTRULE
```

**Key characteristics of this pattern:**
- Zero SAP credentials stored anywhere in the MCP server or config
- Each MCP request authenticates as the actual end user — full audit trail in SAP
- Ephemeral certs (5-min) mean compromised certs expire quickly
- Username mapping table handles `alice@company.com → ALICE_DEV` variations
- Per-system override mappings for dev/QA/prod username differences

**Multi-system routing:**
- `sap_system_id` parameter on each tool call
- `x-sap-system-id` HTTP header on the request
- `DEFAULT_SAP_SYSTEM_ID` environment variable fallback
- YAML config maps system IDs to SAP URLs (non-sensitive)
- Credentials derived from OIDC identity, not stored per-system

**Security controls:**
- Input validation: alphanumeric only for all object names (blocks injection)
- Audit logging: all requests logged with user identity, credential info redacted
- WAF rate limiting: 100 req/5min/IP
- Human-in-the-loop approval for write operations (built into the AI agent layer)

**`GetMigrationAnalysis` tool — unique in the ecosystem:**
Runs an ABAP cloud readiness assessment. Likely uses ATC with a cloud-readiness variant (`ABAP_CLOUD_READINESS` or similar). Returns: deprecated APIs, syntax not allowed in ABAP Cloud, missing clean core compliance, modernization recommendations. No equivalent in vsp.

**Azure/EntraID adaptation path (direct mapping):**

| AWS Component | Azure/EntraID Equivalent |
|---------------|--------------------------|
| AWS Secrets Manager | Azure Key Vault |
| AWS Parameter Store | Azure App Configuration |
| AWS ECS / ALB | Azure Container Apps / API Management |
| Cognito / Okta OIDC | EntraID (native OIDC/OAuth 2.0) |
| IAM task role | Azure Managed Identity |
| AWS WAF | Azure API Management policies / Front Door WAF |

**Setting up principal propagation on the test SAP server** (see `docs/sap-trial-setup.md`):

1. Generate a CA key pair (self-signed root CA)
2. Import CA certificate into SAP STRUST (`/nSTRUST` → SSL Client SSL Client Standard → Import Certificate)
3. Configure `CERTRULE` in SAP (`/nSMIME` or profile parameter `login/certificate_mapping_rulebased = 1`)
4. Add rule: `Subject CN = *` → `MAP TO USER: use CN value`
5. Generate a test ephemeral cert signed by the CA: `CN=DEVELOPER`, 5-min validity
6. Test with `curl --cert test.crt --key test.key https://sap-host:50001/sap/bc/adt/discovery`

This can absolutely be set up on the Hetzner trial server described in `sap-trial-setup.md`.

---

### 10. fr0ster/mcp-abap-adt

**What it does:** Node.js MCP server with `@mcp-abap-adt/connection` and `@mcp-abap-adt/adt-clients` packages. Same author as mario-andreschak (the full-featured one).

**Notable features:**
- `EmbeddableMcpServer` class — can be embedded into SAP CAP/CDS or Express applications. Interesting architectural pattern; not applicable to vsp's binary distribution model.
- YAML configuration support for multi-instance deployments.
- Same auth stack as mario-andreschak.

**Bug fixes / edge cases not in earlier analysis:**
- Handles `Content-Type: application/xml; charset=utf-8` variant (some SAP versions send charset).
- Explicit retry on CSRF token mismatch (409 → refetch token → retry once).
- `GetProgFullCode` — resolves all includes and returns a single concatenated source. This is useful because `GetSource` on a report returns only the top-level program; includes must be fetched separately. vsp has the same limitation.

**All ADT tools are better implemented in vsp** — the Go implementation is more performant, type-safe, and handles edge cases at least as well as this Node.js server.

---

## Full ADT API Gap Table

Features found across all repos that are **NOT currently in vsp**, with effort and enterprise Copilot Studio value:

| Feature | ADT URL Pattern | Found In | Effort | Enterprise Value |
|---------|----------------|----------|--------|-----------------|
| **Code Refactoring – Rename** | `/sap/bc/adt/refactorings` (rename) | marcellourbani, fr0ster | M | M |
| **Code Refactoring – Extract Method** | `/sap/bc/adt/refactorings` (extractmethod) | marcellourbani, fr0ster | M | M |
| **Code Refactoring – Change Package** | `/sap/bc/adt/refactorings` (changepackage) | marcellourbani, fr0ster | M | L |
| **Quick Fix Proposals** | `/sap/bc/adt/quickfixes/evaluation` | marcellourbani | M | H |
| **Quick Fix Apply** | `/sap/bc/adt/quickfixes/execution` | marcellourbani | M | H |
| **ABAP Documentation Hover** | `/sap/bc/adt/docu/abap/langu` | marcellourbani | L | H |
| **Object API Release Status (C1)** | Object structure link (rel=releases) | buettnerjulian, workskong | L | H |
| **ABAP AST (server-side)** | `/sap/bc/adt/abapsource/ast` (inferred) | fr0ster, mario-andreschak | H | M |
| **Semantic Analysis** | `/sap/bc/adt/abapsource/semanticanalysis` (inferred) | fr0ster | H | M |
| **Recursive Package Tree Walk** | `/sap/bc/adt/repository/nodestructure` (recursive) | mario-andreschak | L | M |
| **Bulk Object Describe** | Multiple object structure calls batched | mario-andreschak | L | M |
| **Include List (recursive)** | `/sap/bc/adt/repository/nodestructure` (includes) | fr0ster | L | M |
| **SSCR Object Registration** | `/sap/bc/adt/sscr/registration/objects` | marcellourbani | L | L |
| **Package Search Help** | `/sap/bc/adt/packages/valuehelps/{type}` | marcellourbani | L | M |
| **ATC Exemption Proposal** | `/sap/bc/adt/atc/exemptions/proposal` | marcellourbani | M | M |
| **ATC Request Exemption** | `/sap/bc/adt/atc/exemptions/apply` | marcellourbani | M | M |
| **ATC Contact Reassignment** | `/sap/bc/adt/atc/items` | marcellourbani | M | L |
| **Transport Set Owner** | `/sap/bc/adt/cts/transportrequests/{id}` (PATCH) | marcellourbani | L | M |
| **Transport Add User** | `/sap/bc/adt/cts/transportrequests/{id}` (PATCH) | marcellourbani | L | M |
| **Transport Reference by Object** | `/sap/bc/adt/cts/transportrequests/reference` | marcellourbani | L | L |
| **Trace Hit List** | `/sap/bc/adt/runtime/traces/abaptraces/{id}/hitlist` | marcellourbani | L | L |
| **Trace DB Access Detail** | `/sap/bc/adt/runtime/traces/abaptraces/{id}/dbAccesses` | marcellourbani | L | L |
| **Trace Statement Detail** | `/sap/bc/adt/runtime/traces/abaptraces/{id}/statements` | marcellourbani | L | L |
| **Trace Configuration CRUD** | `/sap/bc/adt/runtime/traces/abaptraces/parameters` | marcellourbani | L | L |
| **Trace Request Management** | `/sap/bc/adt/runtime/traces/abaptraces/requests` | marcellourbani | L | L |
| **abapGit Native REST** | `/sap/bc/adt/abapgit/repos` | marcellourbani | M | L |
| **Usage Reference Snippets** | `/sap/bc/adt/repository/informationsystem/usageSnippets` | marcellourbani | L | M |
| **Unit Test Occurrence Markers** | `/sap/bc/adt/abapsource/occurencemarkers` | marcellourbani | L | L |
| **Message Class Contents** | `/sap/bc/adt/messageclass` | workskong | L | M |
| **Migration / Cloud Readiness** | ATC with cloud-readiness variant | AWS accelerator | M | H |
| **Multi-Transport Tech Spec** | Orchestration over existing tools | SaurabhVC | M | H |
| **GetProgFullCode (include concat)** | Multiple GetSource + concatenation | fr0ster | L | M |
| **Multi-System Routing** | Config + per-request `sap_system_id` | AWS accelerator | M | H |
| **OIDC Token Validation** | JWT validation middleware | AWS accelerator | M | H |
| **X.509 mTLS Client Auth** | `tls.Config.Certificates` | chandrashekhar, AWS | L | H |
| **Principal Propagation (OAuth→X.509)** | Ephemeral cert generation | AWS accelerator | H | H |
| **Kerberos/SPNEGO** | `Authorization: Negotiate` | chandrashekhar | M | M |

---

## Auth Strategy Deep Dive

### Complete auth inventory

| Auth Method | Repos | vsp Status | Enterprise Copilot Relevance |
|-------------|-------|------------|------------------------------|
| Basic auth | All | ✅ Implemented | Dev/sandbox only |
| Cookie auth (MYSAPSSO2) | vsp, chandrashekhar | ✅ Implemented | Workaround, not scalable |
| Bearer token (BearerFetcher) | marcellourbani | ⚠️ Partial | Foundation for OAuth |
| Kerberos/SPNEGO | chandrashekhar | ❌ Missing | Medium (on-prem AD environments) |
| OAuth 2.0 + PKCE (SAP native) | chandrashekhar | ❌ Missing | Low (interactive only) |
| X.509 mTLS | chandrashekhar, AWS | ❌ Missing | **HIGH** — foundation for principal propagation |
| Browser SSO cookie capture | chandrashekhar | ❌ Missing | Low — manual, not scalable |
| JWT/XSUAA (BTP) | fr0ster, mario-andreschak | ❌ Missing | Medium — BTP-specific |
| Service Key (destination) | fr0ster | ❌ Missing | Low — BTP pattern |
| RFC auth (BASIS < 7.50) | fr0ster | ❌ Missing | Low — legacy systems |
| Principal Propagation (OAuth→X.509) | AWS accelerator | ❌ Missing | **CRITICAL** for multi-user enterprise |
| OIDC token validation (EntraID) | AWS accelerator | ❌ Missing | **CRITICAL** for Copilot Studio |
| Per-request credential override | workskong | ❌ Missing | Low — insecure pattern |

### Kerberos/SPNEGO: How It Works for SAP

Kerberos SPNEGO is the standard Windows corporate SSO mechanism. SAP ICM supports it via the SPNEGO login module.

**Flow:**
1. User machine is domain-joined; active directory has issued a Kerberos TGT.
2. vsp (running on the same machine or a domain-joined server) calls the OS Kerberos API: `initSecContext("HTTP/sap-host@CORP.DOMAIN")`.
3. OS returns a SPNEGO token from the TGT cache — no password ever touched.
4. vsp sends `Authorization: Negotiate <base64-token>` to SAP ICM.
5. SAP validates via the SPNEGO login module (profile: `login/create_sso2_ticket`).
6. SAP returns `MYSAPSSO2` SSO2 ticket / session cookie.

**SAP config required:** `icm/HTTPS/client_sni_enabled = TRUE`, SPNEGO login module enabled in logon procedure, SPN registered in AD for `HTTP/sap-host`.

**Go implementation:** `github.com/jcmturner/gokrb5/v8` — well-maintained, pure Go. Estimated effort: Medium (1–2 days for a working implementation + SAP config).

**Relevance for Copilot Studio:** **Limited.** Kerberos requires the vsp process to run on a domain-joined host with access to an AD KDC. Cloud-hosted Azure Container Apps instances will not have a Kerberos TGT. This is only relevant for **on-premise self-hosted** deployments in Windows environments. Worth documenting as a configuration option but not a priority.

### X.509 mTLS: The Critical Building Block

**How it works for SAP:**
1. SAP administrator imports a CA certificate into STRUST (`SSL Client SSL Client Standard` certificate list).
2. Profile parameters: `icm/HTTPS/verify_client = 1` (require client cert), `login/certificate_mapping_rulebased = 1`.
3. `CERTRULE` transaction: add rule `CN=*` → `MAP_TO_USER: use Subject CN as SAP username`.
4. vsp connects with a client certificate: `tls.Config{Certificates: []tls.Certificate{cert}}`.
5. SAP maps the cert's `Subject CN` to the SAP username and establishes an authenticated session.

**Go implementation:** Standard library only (`crypto/tls`, `crypto/x509`). Config: `--cert-file`/`--key-file`/`SAP_CERT_FILE`/`SAP_KEY_FILE`. Estimated effort: **LOW (half a day).**

**Setting this up on the trial server** (Hetzner, from `sap-trial-setup.md`):
```bash
# 1. Generate CA + test cert
openssl genrsa -out ca.key 4096
openssl req -new -x509 -key ca.key -out ca.crt -subj "/CN=vsp-test-ca"
openssl genrsa -out user.key 2048
openssl req -new -key user.key -out user.csr -subj "/CN=DEVELOPER"
openssl x509 -req -in user.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out user.crt -days 1

# 2. Import ca.crt into SAP STRUST (via /nSTRUST or HANA SQL on the trial system)
# 3. Add SAP profile parameters, restart ABAP
# 4. Test:
curl --cert user.crt --key user.key https://your-subdomain/sap/bc/adt/discovery
```

### Principal Propagation (OAuth → Ephemeral X.509): The Enterprise Pattern

This is the architecture needed for multi-user Copilot Studio without storing SAP credentials.

**Flow:**
```
Copilot Studio user (alice@company.com)
  → authenticates via EntraID
  → Copilot sends Bearer OIDC token to vsp's /mcp endpoint

vsp:
  1. Validates OIDC token signature (JWKS from https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys)
  2. Extracts claim: upn = "alice@company.com" → SAP_USER = "ALICE"
  3. Fetches CA private key from Azure Key Vault (once at startup or via Managed Identity)
  4. Generates ephemeral cert: CN=ALICE, NotAfter=now+5min, signed by CA
  5. Uses ephemeral cert for this SAP ADT request (mTLS)
  6. SAP validates cert, maps CN=ALICE to SAP user ALICE

Result: SAP audit log shows ALICE as the executing user. vsp holds zero SAP credentials.
```

**Go implementation pieces:**
- OIDC validation: `golang.org/x/oauth2` + manual JWKS fetch, or `github.com/coreos/go-oidc/v3`
- Cert generation: `crypto/x509` + `crypto/tls` (standard library)
- Azure Key Vault: `github.com/Azure/azure-sdk-for-go/sdk/keyvault/azsecrets`
- Username mapping: YAML config file or env vars

**Estimated effort: HIGH (3–5 days for full implementation + integration tests)**

**Trial server setup:** The `sap-trial-setup.md` system (Hetzner, HTTPS via Let's Encrypt, `DEVELOPER` user) is a perfect testbed for this architecture. The only SAP config needed is STRUST + CERTRULE, which takes ~30 minutes.

---

## Auth Strategy: What to Implement, When, and Why

### The Two Deployment Modes Need Different Auth at Different Times

```
                   ┌──────────────────────────────────────────┐
                   │            vsp (single binary)           │
                   │                                          │
                   │  ┌─────────────┐   ┌──────────────────┐ │
                   │  │ Copilot     │   │ Developer        │ │
                   │  │ Studio Mode │   │ Proxy Mode       │ │
                   │  │ (10 tools)  │   │ (80+ tools)      │ │
                   │  └─────────────┘   └──────────────────┘ │
                   └──────────────────────────────────────────┘
                              ↓                    ↓
                   ┌──────────────────────────────────────────┐
                   │           Auth Layer (pluggable)         │
                   │                                          │
                   │  Phase 1: Basic auth (hardcoded config)  │
                   │  Phase 2: X.509 mTLS                     │
                   │  Phase 3: OIDC + principal propagation   │
                   │  Phase 4: Kerberos (on-prem only)        │
                   └──────────────────────────────────────────┘
                              ↓
                   ┌──────────────────────────────────────────┐
                   │     SAP System(s) via ADT REST API       │
                   └──────────────────────────────────────────┘
```

### Auth Phase-by-Phase Evaluation

#### Phase 1: Basic Auth in Local Config (NOW — both modes)

| Aspect | Detail |
|--------|--------|
| **How** | `SAP_USER`/`SAP_PASSWORD` in env vars, `.env` file, or CLI flags |
| **Copilot Studio** | vsp runs as a sidecar/container, credentials in env vars. Copilot Studio connects to vsp's `/mcp` endpoint. No auth between Copilot and vsp — network-level isolation (same pod/VNet). |
| **Developer proxy** | Developer configures credentials in their MCP client config (Claude Code `~/.claude/mcp.json`, VS Code settings). Each developer has their own vsp instance. |
| **Limitation** | Single-user per vsp instance. Fine for POC, dev environments, and small teams. |
| **Effort** | ✅ Already implemented. Zero work. |

**Verdict: Ship with this. It works today. Don't over-engineer auth before the product proves value.**

#### Phase 2: X.509 mTLS (NEXT — both modes, unlocks principal propagation)

| Aspect | Detail |
|--------|--------|
| **How** | `--cert-file`/`--key-file` flags. vsp uses client certificate for SAP connection. SAP maps cert CN to user. |
| **Copilot Studio** | vsp is configured with a service certificate. All Copilot requests run as one SAP service user. Better than basic auth because the credential is a certificate (rotatable, no password in env var). |
| **Developer proxy** | Each developer gets their own cert (e.g., from corporate PKI). vsp reads cert from config. More secure than passwords in config files. |
| **Go implementation** | Standard library: `crypto/tls`, `crypto/x509`. Add 2 config params, ~30 lines in `http.go`. |
| **Effort** | **LOW** (half a day). All standard Go. |
| **SAP config** | Import CA into STRUST, enable `login/certificate_mapping_rulebased`, add CERTRULE. ~30 min on trial server. |

**Verdict: Implement early. Low effort, high security improvement, and prerequisite for Phase 3.**

#### Phase 3: OIDC + Principal Propagation (FUTURE — enterprise multi-user)

| Aspect | Detail |
|--------|--------|
| **How** | vsp validates incoming OIDC token → extracts username → generates ephemeral X.509 cert → authenticates to SAP as that user |
| **Copilot Studio** | Each Copilot user's EntraID identity flows through to SAP. Full audit trail. Zero credential storage. |
| **Developer proxy** | Developer authenticates via corporate SSO (EntraID). vsp generates per-request SAP cert. No SAP passwords distributed to developers. |
| **Go implementation** | `go-oidc/v3` for JWKS validation + `crypto/x509` for cert generation + Azure Key Vault SDK for CA key retrieval |
| **Effort** | **HIGH** (3–5 days). New architectural component: OIDC middleware, cert generator, Key Vault client, username mapping. |
| **SAP config** | Same as Phase 2 (STRUST + CERTRULE). Plus: EntraID app registration, Key Vault setup, Managed Identity if deployed on Azure. |
| **When** | After vsp proves value with Phase 1/2. This is enterprise scaling work. |

**Verdict: Design the interface now (pluggable auth provider in `http.go`), implement when scaling to multi-user. The AWS accelerator has proven this pattern works.**

#### Phase 4: Kerberos/SPNEGO (OPTIONAL — on-prem Windows environments only)

| Aspect | Detail |
|--------|--------|
| **How** | vsp running on a domain-joined Windows server uses Kerberos TGT to authenticate to SAP. No password needed — OS ticket cache. |
| **When viable** | ONLY when vsp runs on a domain-joined host. Cloud containers (Azure Container Apps, Kubernetes) do NOT have Kerberos TGTs. |
| **Copilot Studio** | **Not viable.** Copilot Studio's backend is cloud-hosted. Cannot do Kerberos. |
| **Developer proxy** | **Viable for on-prem.** Developer has vsp running on their AD-joined workstation. vsp picks up their Kerberos ticket for seamless SSO. No password config needed at all. |
| **Go implementation** | `github.com/jcmturner/gokrb5/v8` — pure Go, well-maintained. ~200 LOC for the auth provider. |
| **Effort** | **MEDIUM** (1–2 days). Needs SPN registration in AD, SPNEGO login module in SAP profile. |

**Verdict: Nice-to-have for on-prem developer proxy deployments. Not needed for Copilot Studio. Implement only if an enterprise customer specifically needs it.**

#### NOT implementing (and why)

| Auth Method | Why Not |
|-------------|---------|
| **OAuth 2.0 + PKCE (SAP native)** | Interactive browser flow. Not viable for server-to-server (Copilot Studio) or headless CI. Only useful for a desktop app. vsp is neither. |
| **Browser SSO cookie capture** | Manual, brittle, 30-min expiry. Not scalable. vsp already has `--cookie-string` for the rare case someone needs this. |
| **JWT/XSUAA (BTP only)** | BTP-specific pattern. Not relevant for on-prem SAP or Copilot Studio. If BTP becomes a target, principal propagation (Phase 3) handles it more generically. |
| **Service Key (BTP destinations)** | BTP-specific. Same reasoning as XSUAA. |
| **RFC auth (BASIS < 7.50)** | Legacy systems without ICM HTTP. If ADT isn't available, vsp can't work regardless. |
| **Per-request credential headers** | `X-SAP_USERNAME`/`X-SAP_PASSWORD` in HTTP headers. Insecure — credentials in plaintext on every request. Use principal propagation instead. |

---

## Feature-by-Feature Evaluation: Should We Implement It?

Every feature from the gap table, evaluated for both deployment modes.

### Implement YES — High value for one or both modes

| # | Feature | Effort | Copilot Value | Developer Value | Verdict |
|---|---------|--------|---------------|-----------------|---------|
| 1 | **ABAP Documentation Hover** | L | **HIGH** — LLM gets keyword/object documentation for better answers | **HIGH** — same as IDE F1 help | ✅ **YES.** Trivial to implement, massive context improvement. Single GET to `/sap/bc/adt/docu/abap/langu`. |
| 2 | **Object API Release Status (C1)** | L | **HIGH** — "Is this API safe for ABAP Cloud?" | **HIGH** — cloud readiness checking during development | ✅ **YES.** Reads from object structure links. ~50 LOC. |
| 3 | **Quick Fix Proposals + Apply** | M | **HIGH** — AI diagnoses, proposes fix, applies it in one flow | **HIGH** — IDE-grade auto-fix. This is what makes vsp a real development tool | ✅ **YES.** Two ADT calls: evaluate (get proposals) → execute (apply fix). Core AI-assisted coding workflow. |
| 4 | **Multi-System Routing** | M | **HIGH** — one connector for dev/QA/prod | **HIGH** — developer switches systems without restarting vsp | ✅ **YES.** Config file maps IDs to URLs. Per-request `sap_system_id` param or `x-sap-system-id` header. ~200 LOC. |
| 5 | **Code Refactoring – Rename** | M | Medium — Copilot users rarely refactor | **HIGH** — fundamental IDE operation. "Rename this method across all callers" | ✅ **YES.** 3-step flow (evaluate → preview → execute). Same pattern as quick fixes. Makes vsp an ADT replacement. |
| 6 | **Code Refactoring – Extract Method** | M | Low — Copilot users don't extract methods | **HIGH** — core refactoring. "Extract this block into a method" | ✅ **YES.** Same 3-step flow. Ship together with Rename. |
| 7 | **Recursive Package Tree Walk** | L | Medium — useful for "show me everything in this package" | **HIGH** — fundamental navigation. "Give me the full package hierarchy" | ✅ **YES.** Recursive call over existing `nodestructure` endpoint. ~30 LOC. |
| 8 | **Usage Reference Snippets** | L | **HIGH** — LLM sees the code context around each where-used hit | **HIGH** — "show me the code around each usage" | ✅ **YES.** Upgrade to existing `GetWhereUsed`. One additional POST with snippet request. |
| 9 | **GetProgFullCode (include concat)** | L | **HIGH** — LLM gets complete program source without multiple tool calls | **HIGH** — "give me the whole program including all includes" | ✅ **YES.** Orchestration: get include list → fetch each → concatenate. ~50 LOC. |
| 10 | **Message Class Contents** | L | Medium — useful for understanding error messages | **HIGH** — "what does message class ZMY message 001 say?" | ✅ **YES.** Simple GET. ~20 LOC. |
| 11 | **Migration / Cloud Readiness Analysis** | M | **HIGH** — "Is this code S/4HANA Cloud ready?" | **HIGH** — modernization assessment during development | ✅ **YES.** Run ATC with `ABAP_CLOUD_READINESS` check variant. Uses existing ATC infrastructure. |
| 12 | **Multi-Transport Tech Spec** | M | **HIGH** — "What does transport DEVK900123 do?" is a killer use case | Medium — developers know what they changed | ✅ **YES.** Pure orchestration over existing tools (get transport objects → fetch source → format). |
| 13 | **Transport Set Owner / Add User** | L | Low | **HIGH** — "add DEVELOPER2 to this transport" | ✅ **YES.** Simple PATCH calls. ~40 LOC. |
| 14 | **Transport Reference by Object** | L | Medium — "which transport has this object?" | **HIGH** — fundamental transport question | ✅ **YES.** Single GET. ~20 LOC. |

### Implement MAYBE — Evaluate later based on demand

| # | Feature | Effort | Copilot Value | Developer Value | Verdict |
|---|---------|--------|---------------|-----------------|---------|
| 15 | **Code Refactoring – Change Package** | M | Low | Medium — "move this object to a different package" | ⚠️ **MAYBE.** Less common than rename/extract. Implement if rename/extract flow is already built (same 3-step pattern). |
| 16 | **ATC Exemption Workflow** | M | Medium — manage exemptions conversationally | Medium — useful but most orgs handle via SAP GUI | ⚠️ **MAYBE.** 3 endpoints (proposal, request, contact). Implement when ATC is a proven Copilot use case. |
| 17 | **Include List (recursive)** | L | Medium | Medium — overlap with GetProgFullCode | ⚠️ **MAYBE.** If GetProgFullCode is implemented, this is mostly redundant. Only useful standalone for "list all includes" without fetching source. |
| 18 | **Bulk Object Describe** | L | Medium — batch metadata for many objects | Medium — useful for package exploration | ⚠️ **MAYBE.** Optimization of existing per-object calls. Nice performance win but not a new capability. |
| 19 | **Package Search Help** | L | Low | Medium — "show me all application components" | ⚠️ **MAYBE.** Useful for package creation workflows. Low urgency. |
| 20 | **Trace Hit List** | L | Low | Medium — "which methods ran the most?" | ⚠️ **MAYBE.** Extends existing `GetTrace`. Useful for developer performance debugging. |
| 21 | **Trace DB Access / Statement Detail** | L | Low | Medium — "which SQL statements were slow?" | ⚠️ **MAYBE.** Same as trace hit list — extend existing trace. |
| 22 | **Trace Configuration CRUD** | L | Low | Medium — "start a new trace for user X" | ⚠️ **MAYBE.** Useful but rarely needed in AI-assisted workflow. |

### Implement NO — Not worth the effort for either mode

| # | Feature | Effort | Reasoning |
|---|---------|--------|-----------|
| 23 | **SSCR Object Registration** | L | Bureaucratic SAP process. No practical value for AI-assisted development. Object registration is handled in SAP GUI during transport release. |
| 24 | **ABAP AST (server-side)** | H | vsp already has a **superior** native Go lexer+parser. Server-side AST would add a network round-trip for something vsp can do locally at 3.5M tokens/sec. Only potentially useful for semantic info (type resolution) — but that's what `FindDefinition` and `CodeCompletion` already provide. |
| 25 | **Semantic Analysis (server-side)** | H | Same reasoning as AST. vsp's local parser + ADT code intelligence tools (completion, find def, find refs) cover this. High effort, marginal benefit. |
| 26 | **Unit Test Occurrence Markers** | L | IDE-specific feature (highlights tested lines in source view). Not useful in an MCP tool context where there's no source view. `RunUnitTests` already gives pass/fail results. |
| 27 | **abapGit Native REST** | M | vsp's WebSocket-based abapGit integration already works. The native REST endpoints (`/sap/bc/adt/abapgit/repos`) are a different path to the same result. Not worth maintaining two abapGit code paths. |
| 28 | **ATC Contact Reassignment** | M | Administrative ATC management. Very niche. No value for AI workflows. |
| 29 | **Trace Request Management** | L | Creating/deleting trace requests is an admin task. The actual analysis (hit list, DB access, statements) is what matters, and that's in the MAYBE category. |
| 30 | **Kerberos/SPNEGO** | M | Only works on domain-joined hosts. Not viable for cloud-hosted Copilot Studio. Defer until an enterprise customer specifically requests on-prem Kerberos SSO for their developer proxy deployment. |

---

## Priority Recommendations (Revised for Dual Purpose)

### Phase 1: Ship Now (already works or < 1 day effort)

What's needed to ship vsp as both a Copilot Studio connector and developer proxy TODAY:

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Basic auth (hardcoded config) | ✅ Done | Works for both modes |
| 2 | HTTP Streamable transport | ✅ Done | Required for Copilot Studio |
| 3 | Read-only default mode | ✅ Done | Enterprise safety |
| 4 | Docker image | ✅ Done | Copilot Studio deployment |

### Phase 2: Quick Wins (1–3 days total for all)

Low-effort, high-impact features that elevate vsp beyond all competitors:

| # | Feature | Effort | Notes |
|---|---------|--------|-------|
| 5 | **ABAP Documentation Hover** | L (hours) | Single GET, huge LLM context improvement |
| 6 | **Object API Release Status (C1)** | L (hours) | Read from object structure link |
| 7 | **Usage Reference Snippets** | L (hours) | Upgrade existing GetWhereUsed |
| 8 | **GetProgFullCode (include concat)** | L (hours) | Orchestration over existing calls |
| 9 | **Message Class Contents** | L (hours) | Simple GET |
| 10 | **Transport Reference by Object** | L (hours) | Simple GET |
| 11 | **Recursive Package Tree Walk** | L (hours) | Recursive call on existing endpoint |
| 12 | **Transport Set Owner / Add User** | L (hours) | Simple PATCH |
| 13 | **X.509 mTLS client auth** | L (half day) | Foundation for Phase 4 |

### Phase 3: IDE-Grade Features (3–5 days total)

What makes vsp a legitimate developer tool, not just an AI connector:

| # | Feature | Effort | Notes |
|---|---------|--------|-------|
| 14 | **Quick Fix Proposals + Apply** | M | Core AI-assisted coding. Two ADT calls. |
| 15 | **Code Refactoring – Rename** | M | 3-step evaluate/preview/execute |
| 16 | **Code Refactoring – Extract Method** | M | Same 3-step pattern as rename |
| 17 | **Multi-System Routing** | M | Config + per-request `sap_system_id` |
| 18 | **Migration / Cloud Readiness Analysis** | M | ATC with cloud-readiness variant |
| 19 | **Multi-Transport Tech Spec** | M | Orchestration tool |

### Phase 4: Enterprise Scaling (5+ days)

Multi-user production deployments:

| # | Feature | Effort | Notes |
|---|---------|--------|-------|
| 20 | **OIDC token validation** | M | EntraID Bearer token validation middleware |
| 21 | **Principal propagation (OIDC → ephemeral X.509)** | H | Zero SAP credentials, full audit trail |
| 22 | **Azure Key Vault integration** | M | CA key retrieval for cert generation |
| 23 | **Username mapping** | L | EntraID UPN → SAP username table |

---

## Coverage Summary: vsp vs. All Competitors (Dual-Purpose View)

| Area | vsp Status | Key Gap | Mode |
|------|-----------|---------|------|
| Source read (all object types) | ✅ Complete | — | Both |
| Source write / CRUD | ✅ Complete | — | Developer |
| Search (object, CDS, grep) | ✅ Complete | — | Both |
| DDIC (table, domain, data element, structure) | ✅ Complete | — | Both |
| Code intelligence (find def, refs, completion) | ✅ Complete | Quick fixes, ABAP doc hover | Both |
| Refactoring | ⚠️ Partial | Rename, Extract Method | Developer |
| Activation (single, batch, package) | ✅ Complete | — | Developer |
| ATC | ⚠️ Partial | Exemptions (low priority) | Both |
| Unit tests | ✅ Complete | — | Developer |
| Tracing / Profiling | ⚠️ Partial | Hit list, DB access (MAYBE) | Developer |
| Runtime dumps | ✅ Complete | — | Both |
| SQL trace | ✅ Complete | — | Developer |
| Transport management | ⚠️ Partial | Set owner, add user, obj reference | Both |
| Package management | ⚠️ Partial | Recursive tree walk | Both |
| abapGit | ✅ Complete (via WebSocket) | — | Developer |
| Debugger | ⚠️ Experimental | Not relevant for Copilot | Developer |
| UI5 / BSP | ⚠️ Partial | — | Developer |
| Auth – Basic | ✅ Implemented | — | Both (Phase 1) |
| Auth – Cookie | ✅ Implemented | — | Developer |
| Auth – X.509 mTLS | ❌ Missing | Phase 2 | Both |
| Auth – OIDC / Principal Propagation | ❌ Missing | Phase 4 | Both |
| Auth – Kerberos | ❌ Missing | Defer | Developer (on-prem) |
| Multi-system routing | ❌ Missing | Phase 3 | Both |
| Object API release status (C1) | ❌ Missing | Phase 2 | Both |
| ABAP documentation hover | ❌ Missing | Phase 2 | Both |
| Migration / cloud readiness | ❌ Missing | Phase 3 | Both |
| Multi-transport tech spec | ❌ Missing | Phase 3 | Both |

---

## Notes on Specific Questions

### SSE transport (chandrashekhar, workskong)
SSE (`text/event-stream`) is deprecated in the MCP spec and superseded by HTTP Streamable. Correct to ignore it. All new implementations should use HTTP Streamable only.

### Language login parameter (workskong)
SAP ADT operations return descriptions and documentation in the language specified by the `sap-language` header (or `sap-client`). vsp already has `--language`/`SAP_LANGUAGE` at the global level. The per-request pattern (every tool call passes `language`) is overkill; global config is correct for a connector. **No change needed.**

### TLS_REJECT_UNAUTHORIZED (workskong, buettnerjulian)
Equivalent to vsp's `SAP_INSECURE`/`--insecure`. Already covered. The different env var name is a Node.js convention. For Docker deployments, document `SAP_INSECURE=true` clearly.

### Docker environment variables
Both workskong and buettnerjulian document their full env var set in `docker-compose.yml` / `Dockerfile`. vsp's Docker image should have equally clear documentation — all `SAP_*` variables listed in the `README` and `Dockerfile` ENV section. Currently good but worth checking completeness.

### ABAPDocMCP as a separate skill/agent
The multi-transport spec generation is well-suited as either: (a) a vsp tool that orchestrates existing ADT calls, or (b) a separate Copilot Studio skill/plugin. Given it requires no new ADT endpoints, implementing as a vsp tool (`DescribeTransport`) is the lower friction path.

### erpl-adt (DataZooDE) — nothing new
Confirmed: the C++ implementation covers no ADT endpoints beyond what vsp has. Its value is the single-binary positioning (same as vsp) and the abapGit deploy workflow (not needed for enterprise Copilot).

---

## Appendix: Setting Up Principal Propagation on Trial SAP Server

For reference when testing the Copilot Studio connector against the `docs/sap-trial-setup.md` system:

```bash
# 1. Generate test CA and user certificate
openssl genrsa -out ca.key 4096
openssl req -new -x509 -key ca.key -out ca.crt -days 365 \
  -subj "/CN=vsp-test-ca/O=Test"

openssl genrsa -out developer.key 2048
openssl req -new -key developer.key -out developer.csr \
  -subj "/CN=DEVELOPER"
openssl x509 -req -in developer.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out developer.crt -days 1

# 2. Import CA into SAP STRUST (HANA SQL path for trial system)
# Copy ca.crt content into base64 and use /nSTRUST transaction
# Or via HANA SQL (requires SAPA4H access)

# 3. Set SAP profile parameters (in A4H_D00_vhcala4hci):
# login/certificate_mapping_rulebased = 1
# icm/HTTPS/verify_client = 1    (or: = 0 for optional, = 1 for required)

# 4. Set certificate rule (via /nSMIME or CERTMAP):
# Attribute: Subject CN → SAP Username (use CN value as-is)

# 5. Test mTLS with vsp:
./vsp --url https://your-subdomain --cert-file developer.crt \
  --key-file developer.key
```

**Note:** The trial system uses Let's Encrypt, so the server-side TLS is already production-quality. Only the client cert addition is needed.
