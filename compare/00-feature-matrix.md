# Cross-Project Feature Matrix

A comprehensive comparison of all SAP ADT/MCP projects against ARC-1.

_Last updated: 2026-06-24 (deep fr0ster v7.2.1 + sapcli scan — net new: **SEC-14** DNS-rebinding gap + **CDS API-release-write** dual-signal; see the 2026-06-24 tracker rows below). Earlier — 2026-06-05. **New column — "SAP ABAP MCP"**: SAP's official `SAPSE.adt-vscode` bundled ABAP MCP server (headless Eclipse/Equinox + Anthropic MCP Java SDK 1.0.1; localhost Streamable-HTTP on port 2236, static bearer token; 14 built-in tools + dynamic backend "IDE Actions"; ABAP-Cloud / RAP-generation scope; disabled-by-default, part of Joule for Developers; GA Q2 2026, v1.0.0). Detailed teardown: [J4D/02-sap-abap-mcp-server-vscode.md](J4D/02-sap-abap-mcp-server-vscode.md). Earlier dated changelog prose has been trimmed for readability — see git history and per-project docs for the full change log._

## Legend
- ✅ = Supported
- ⚠️ = Partial / Limited
- ❌ = Not supported
- N/A = Not applicable

---

## 1. Core Architecture

| Feature | ARC-1 | SAP ABAP MCP | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|---------|-------|---|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Language | TypeScript | Java (Eclipse/Equinox) + TS | Go 1.24 | TypeScript | TypeScript | Python 3.12 | TypeScript | TypeScript | JavaScript (compiled TS) | Python 3.10+ |
| Tool count | 12 intent-based | 14 built-in + dynamic | 1-99 (3 modes) | ~15 | 13 | 15 | 316 (4 tiers) | 3 (hierarchical) | 53 | 28+ CLI commands (not MCP) |
| ADT client | Custom (undici/fetch) | Eclipse ADT (embedded, 2.9M LOC) | Custom (Go) | abap-adt-api | Custom (axios) | Custom (aiohttp) | Custom (axios) | SAP Cloud SDK | abap-adt-api | Custom (requests) |
| npm package | ✅ `arc-1` | ❌ (VSIX) | ❌ (binary) | ❌ | ❌ | ❌ | ✅ `@mcp-abap-adt/core` | ❌ | ❌ (MCPB) | N/A (Python, git install) |
| Docker image | ✅ ghcr.io | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Stars | — | N/A (closed source) | 295 | 125 | 103 | 35 | 43 | 120 | 37 | 79 |
| Active development | ✅ | ✅ SAP official (v1.0.0, GA Q2 2026) | ✅ Stable (v2.38.1; commits quiet since 2026-04-15, issues active #105–#124) | ❌ Dormant (Feb 2025) | ❌ Dormant | ⚠️ Stale (Mar 2026) | ✅ Very (v6.5.1, 6 releases in 9 days; open issue #77 FM-update parameter loss) | ⚠️ Dormant (Jan 2026) | ✅ Stable (53 tools, no commits since Apr 14) | ✅ Very (since 2018) |
| Release count | — | N/A (VS Code extension) | 32+ | — | — | — | 95+ (5 months) | — | rolling | rolling "latest" |
| NPM monthly downloads | — | N/A | N/A | — | — | — | 3,625 | — | N/A | N/A |

## 2. MCP Transport

| Transport | ARC-1 | SAP ABAP MCP | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|-----------|-------|---|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| stdio | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | N/A (CLI) |
| HTTP Streamable | ✅ | ✅ (localhost:2236/mcp) | ✅ (v2.38.0) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | N/A |
| SSE | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ⚠️ | ❌ | N/A |
| TLS/HTTPS | ❌ | ❌ (localhost only, bearer token) | ❌ | ❌ | ❌ | ✅ | ✅ (v4.6.0) | ❌ | ❌ | N/A |

## 3. Authentication

| Auth Method | ARC-1 | SAP ABAP MCP | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|-------------|-------|---|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Basic Auth | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Cookie-based | ✅ | ✅ (Eclipse session) | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ (requests.Session) |
| API Key (MCP) | ✅ | ✅ (static bearer token, localhost) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| OIDC/JWT (MCP) | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| XSUAA OAuth | ✅ | ✅ (BTP ABAP via Eclipse auth) | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ (Apr 2026) | ❌ |
| BTP Service Key | ✅ | ✅ (ABAP Cloud project) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Principal Propagation | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (X.509) | ✅ | ✅ | ❌ | ❌ |
| MCP OAuth 2.0 per-user | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (Apr 2026) | ❌ |
| SAML | ❌ | ✅ (reentrance ticket) | ✅ (v2.39.0+, PR #97) | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| X.509 Certificates | ❌ | ⚠️ (Eclipse-supported) | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Device Flow (OIDC) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Browser login page | ❌ | ✅ (reentrance ticket) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ |
| Auth providers total | 4 | Eclipse stack (Basic/SSO/X.509/BTP) | 2 | 1 | 1 | 5+ | 9 | 2 | 4 | 1 (Basic) |

## 4. Safety & Security

| Safety Feature | ARC-1 | SAP ABAP MCP | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|----------------|-------|---|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Read-only mode | ✅ | ❌ | ✅ | ❌ | N/A (read-only) | ❌ | ⚠️ exposition tiers | ❌ | ❌ | ❌ |
| Op allowlist/blocklist | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Package restrictions | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Block free SQL | ✅ | N/A (no free SQL) | ✅ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ | ❌ |
| Transport gating | ✅ | ⚠️ (human-in-the-loop selection) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Dry-run mode | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Audit logging | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (CloudWatch) | ❌ | ❌ | ❌ | ❌ |
| Input sanitization | ✅ (Zod) | ⚠️ (Eclipse client) | ✅ | ❌ | ⚠️ | ✅ (defusedxml) | ✅ (Zod) | ✅ (Zod) | ⚠️ | ⚠️ (argparse) |
| MCP elicitation | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (10+ flows) | N/A |
| Try-finally lock safety | ✅ | ✅ (Eclipse ADT) | ✅ | ❌ | N/A | ✅ | ✅ (v4.5.0) | N/A | ⚠️ (abap-adt-api) | ✅ |
| MCP scope system (OAuth) | ✅ (2D: scopes+roles+safety) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| Layered rate limiting | ✅ (3 layers: per-IP edge + per-user MCP quota + server-wide SAP semaphore) | ❌ | ❌ | ❌ | ❌ | ⚠️ (API Gateway-side only) | ❌ | ❌ | ❌ | N/A |
| `Retry-After` honoring (429/503) | ✅ (RFC 7231, clamped 60 s, audit records source) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| DNS-rebinding protection (Host-header allowlist) | ❌ (gap → SEC-14) | ⚠️ (localhost + static bearer) | ❌ | ❌ | ❌ | ❌ | ✅ (v7.2.0) | ❌ | ❌ | ❌ |

### 4.1 Supply-Chain Security (SEC-11, Tier 1)

Where the rest of §4 covers *runtime* guardrails, this sub-table covers *build-time and distribution-time* guardrails — the controls that make the published npm package and Docker image trustworthy. Status for competitors is based on a 2026-05-08 inspection of their public `.github/`, `package.json`, and release-related workflow files; "—" means the project doesn't ship the relevant artifact (e.g. no Docker image to scan).

| Control | ARC-1 | SAP ABAP MCP | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|---|---|---|---|---|---|---|---|---|---|---|
| Dependabot (or equivalent) | ✅ | N/A (closed src) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `npm audit` PR gate | ✅ | N/A (closed src) | N/A (Go) | ❌ | ❌ | N/A (Python) | ❌ | ❌ | ❌ | N/A (Python) |
| GitHub Dependency Review | ✅ | N/A (closed src) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| CodeQL / SAST in CI | ✅ | N/A (closed src) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Container image scanning | ✅ (Trivy) | N/A (closed src) | — | — | — | ⚠️ (AWS-side) | — | — | — | — |
| Workflow `permissions:` minimum | ✅ | N/A (closed src) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Third-party action SHA pinning | ✅ | N/A (closed src) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| npm package provenance | ✅ | N/A (closed src) | N/A (Go) | ❌ | ❌ | N/A (Python) | ❌ | ❌ | ❌ | N/A (Python) |
| `SECURITY.md` policy | ✅ | N/A (closed src) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Private Vulnerability Reporting | ✅ | ⚠️ (SAP PSRT) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Tier 2 (CycloneDX SBOM, Cosign image signing, OpenSSF Scorecard) and Tier 3 (Socket.dev malicious-package detection, vulnerability triage runbook) are tracked in `docs/plans/` and will move into this matrix as they land.

## 5. ABAP Read Operations

| Read Feature | ARC-1 | SAP ABAP MCP | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|-------------|-------|---|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Programs (PROG) | ✅ | ❌ (reads via LSP/editor, not MCP tools) | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |
| Classes (CLAS) | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ (incl. locals, test) |
| Interfaces (INTF) | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | N/A | ✅ | ✅ |
| Function modules (FUNC) | ✅ | ❌ (classic, out of scope) | ✅ | ✅ | ✅ | ❌ | ✅ | N/A | ✅ | ✅ (auto-group) |
| Function groups (FUGR) | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | N/A | ✅ (bulk) | ✅ |
| Includes (INCL) | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | N/A | ✅ | ✅ |
| CDS views (DDLS) | ✅ | ⚠️ (LSP-side) | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| Behavior defs (BDEF) | ✅ | ⚠️ (LSP-side) | ✅ | ❌ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| Service defs (SRVD) | ✅ | ⚠️ (LSP-side) | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| Service bindings (SRVB) | ✅ | ⚠️ (LSP-side) | ✅ | ❌ | ❌ | ✅ | ✅ | N/A | ❌ | ✅ |
| Tables (DDIC) | ✅ | ❌ | ✅ | ✅ | ✅ | ⚠️ | ✅ | N/A | ✅ | ✅ |
| Table contents | ✅ | ❌ | ✅ | ✅ | ⚠️ Z-service | ❌ | ✅ | N/A | ✅ | ✅ (freestyle SQL) |
| Packages (DEVC) | ✅ | ⚠️ (list_destinations + LSP) | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |
| Metadata ext (DDLX) | ✅ | ⚠️ (LSP-side) | ❌ | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ❌ |
| Structures | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | N/A | ❌ | ✅ |
| Domains | ✅ | ❌ | ❌ | ✅ | ⚠️ | ❌ | ✅ | N/A | ❌ | ⚠️ (PR #149 in progress) |
| Data elements | ✅ | ❌ | ❌ | ✅ | ⚠️ | ❌ | ✅ | N/A | ❌ | ✅ |
| Enhancements (BAdI/ENHO) | ✅ (`GET /sap/bc/adt/enhancements/enhoxhb/{name}`) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (on-prem only; `GET /sap/bc/adt/programs/programs/{name}/source/main/enhancements/elements` + `GET /sap/bc/adt/enhancements/enhsxsb/{spot}`) | N/A | ❌ | ✅ (BAdI/enhancement impl) |
| Authorization fields (AUTH) | ✅ (`GET /sap/bc/adt/aps/iam/auth/{name}`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ✅ (`GET /sap/bc/adt/aps/iam/auth/{name}`) |
| Feature toggles (`FEATURE_TOGGLE`; deprecated alias `FTG2`) | ✅ (states only, `GET /sap/bc/adt/sfw/featuretoggles/{name}/states`; renamed from `FTG2` in audit Plan B) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ✅ (states + toggle/check/validate) |
| Source version history | ✅ (`VERSIONS` list + `VERSION_SOURCE` fetch via `GET {sourceUrl}/versions` Atom feed) | ❌ | ✅ (3 tools: list/compare/get) | ✅ (`revisions()` + `getObjectSource(url, {version})`) | ❌ | ❌ | ❌ | N/A | ✅ (`abap_get_revisions` list-only) | ❌ |
| Transactions | ✅ | ❌ (classic) | ✅ | ❌ | ✅ | ❌ | ✅ | N/A | ❌ | ❌ |
| Free SQL | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ | ✅ |
| Exact object-directory lookup | ✅ (`SAPSearch searchType=tadir_lookup`; ADT quick search, grouped by requested name) | ⚠️ (LSP-side) | ❌ | ✅ (quickSearch primitive) | ✅ (search) | ❌ | ✅ | N/A | ✅ | ✅ |
| System info / components | ✅ | ✅ (abap_list_destinations) | ✅ | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ✅ |
| BOR business objects | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Messages (T100, `MSAG`; deprecated alias `MESSAGES`) | ✅ (read+write; canonical short type `MSAG` from audit Plan B) | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Text elements | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Variants | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Structured class decomposition (metadata + includes) | ✅ | ⚠️ (LSP-side) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ✅ (locals_def/imp/test/macros) |
| Grep/regex search within source (SAPRead `grep`) | ✅ (matches +context, line numbers; method-annotated for CLAS; literal fallback) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| GetProgFullCode (include traversal) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (on-prem only; `GET /sap/bc/adt/repository/nodestructure?objecttype=PROG/P&objectname={name}` + recursive INCL fetch) | N/A | ❌ | ❌ |
| SKTD (Knowledge Transfer Documents) | ✅ (merged PR #134 2026-04-16; `GET/PUT/POST /sap/bc/adt/documentation/ktd/documents/`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |

## 6. Write / CRUD Operations

| Write Feature | ARC-1 | SAP ABAP MCP | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|--------------|-------|---|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Create objects | ✅ | ✅ (abap_creation ×4) | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| Update source | ✅ | ⚠️ (via editor/LSP, not MCP) | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| Delete objects | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ | ❌ |
| Dependency-aware DDLS CRUD guidance (update/activate/delete hints) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Activate | ✅ | ✅ (abap_activate_objects) | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| Batch activate | ✅ | ✅ (abap_activate_objects) | ✅ | ✅ | ❌ | ✅ (with dep resolution) | ✅ | N/A | ✅ (v2.0, Apr 2026) | ✅ (mass activation) |
| Lock/unlock | ✅ | ✅ (Eclipse ADT) | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| EditSource (surgical) | ✅ (edit_method, local handlers May 2026; class-section surgery May 2026 — edit_class_definition/add_method/edit_method_signature/delete_method) | ❌ (editor-side) | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ✅ (edit_method, Apr 2026) | ❌ |
| CloneObject | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Execute ABAP | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | N/A | ✅ | ✅ (abap run) |
| RAP CRUD (BDEF, SRVD, DDLX, SRVB) | ✅ (DDLS, DDLX, DCLS, BDEF, SRVD, SRVB write) | ✅ (primary scope — generators + business_services) | ⚠️ (some) | ❌ | ❌ | ✅ (BDEF, SRVD, SRVB) | ✅ (all incl. DDLX) | N/A | ⚠️ (BDEF create, SRVB publish) | ⚠️ (DDLS, DCL, BDEF write; SRVB publish) |
| Domain write (DOMA) | ✅ | ❌ (classic DDIC, out of scope) | ❌ | ✅ | ❌ | ❌ | ✅ | N/A | ❌ | ✅ (PR #149 merged) |
| Data element write (DTEL) | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | N/A | ❌ | ✅ |
| Multi-object batch creation | ✅ (item-level package/transport overrides) | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Deterministic RAP preflight (TABL/BDEF/DDLX/DDLS static checks) | ⚠️ (in-flight PR [#173](https://github.com/arc-mcp/arc-1/pull/173) — `preflightBeforeWrite` toggle) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| RAP behavior-pool handler scaffolding | ✅ (`SAPWrite action=scaffold_rap_handlers` dry-run/autoApply, native CLAS include writes, auto-creates missing `lhc_*` skeletons in CCIMP only — both DEFINITION + IMPLEMENTATION blocks per SAP-canonical layout, verified against demo `BP_DEMO_RAP_STRICT`) | ✅ (abap_generators) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Generate Behavior Implementation (RAP one-shot) | ✅ (`SAPWrite action=generate_behavior_implementation` — auto-discover BDEF via rootEntityRef, scaffold all handlers in CCIMP, write under one lock, optionally activate; reliable equivalent of Eclipse ADT's Cmd+1 "Generate Behavior Implementation" quickfix without the broken server endpoint) | ✅ (abap_generators — native Joule skill) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| AFF schema validation (pre-create) | ✅ | ⚠️ (AFF used internally) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Type auto-mappings (CLAS→CLAS/OC) | ✅ | ✅ (Eclipse ADT) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ✅ | ✅ (ADTObjectType) |
| Create test class | ❌ | ⚠️ (creation/generators) | ✅ | ❌ | ❌ | ✅ | ✅ | N/A | ✅ (abap_create_test_include) | ✅ (class write test_classes) |
| Table write (TABL) | ✅ (TABL/DT + TABL/DS subtype routing; #285 follow-up) | ❌ (classic, out of scope) | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ | ✅ |
| Package create (DEVC) | ✅ | ✅ (abap_creation) | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ | ✅ |
| Service binding create (SRVB) | ✅ | ✅ (abap_business_services) | ❌ | ❌ | ❌ | ✅ | ✅ | N/A | ❌ | ✅ |
| Message class write (MSAG) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ✅ |
| DCL write (DCLS) | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ✅ |
| SKTD write (Knowledge Transfer Docs) | ✅ (merged PR #134 2026-04-16; base64 Markdown in XML envelope; create requires refObjectType) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Server-driven objects (8.16+: DESD, EVTB, DTSC, CSNM, EVTO, COTA) | ✅ (read **+ write** — generic discovery-gated AFF engine: `SAPRead` + `SAPWrite create/update/delete` + `SAPActivate`; `<blue:blueSource>` metadata + AFF JSON source; #356 read, write 2026-06-05; live-verified on ABAP Platform 2025) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Function group write (FUGR create / delete) | ✅ (issue #250; create+delete; package via packageRef) | ❌ (classic, out of scope) | ✅ | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ✅ |
| Function module write (FUNC create / source-update / delete) | ✅ (issue #250; requires `group`; SAPGUI `*"…"*` parameter comment blocks auto-stripped on PUT) | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ (parameter loss bug — fr0ster open issue #77) | N/A | ❌ | ⚠️ (no signature mgmt) |
| Function module signature management (structured `parameters` array — IMPORTING/EXPORTING/CHANGING/TABLES/EXCEPTIONS/RAISING) | ✅ (issue #252; `SAPWrite(type='FUNC', parameters=[…])` builds the source-based signature clause; `SAPRead(type='FUNC', includeSignature=true)` returns parsed JSON — verified live on a4h S/4HANA 2023 + NPL 7.50 SP02; closes fr0ster #77 parameter-loss class) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |

## 7. Code Intelligence

| Feature | ARC-1 | SAP ABAP MCP | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|---------|-------|---|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Find definition | ✅ | ❌ (LSP-side, not MCP) | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | ✅ (Apr 2026) | ❌ |
| Find references | ✅ | ❌ (LSP-side) | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ | ✅ (where-used with scope) |
| Code completion | ✅ | ❌ (LSP-side) | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Context compression | ✅ (SAPContext, 7-30x) | ❌ | ✅ (auto, 7-30x) | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Method-level surgery | ✅ (95% reduction) | ❌ | ✅ (95% reduction) | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| ABAP AST / parser | ⚠️ (abaplint for lint) | ✅ (Eclipse ADT, IDE-side) | ✅ (native Go port) | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ❌ |
| Semantic analysis | ❌ | ⚠️ (Eclipse, IDE-side) | ❌ | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ❌ |
| Call graph analysis | ❌ | ❌ | ✅ (5 tools) | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Type hierarchy | ✅ (via SQL) | ⚠️ (LSP-side) | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| CDS dependencies | ✅ | ⚠️ (LSP-side) | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| CDS impact analysis (upstream+downstream) | ✅ (`SAPContext action=impact`, RAP-aware buckets) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| CDS sibling DDLS/DDLX consistency | ✅ (PR #177 2026-04-22 — detects asymmetric metadata-extension coverage across sibling variants in same package) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |

## 8. Code Quality

| Feature | ARC-1 | SAP ABAP MCP | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|---------|-------|---|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Syntax check | ✅ | ✅ (on activate; LSP diagnostics) | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| ATC checks | ✅ | ⚠️ (Joule/IDE; not a built-in MCP tool) | ✅ | ✅ | ❌ | ✅ (with summary) | ❌ | N/A | ✅ (severity grouping) | ✅ (checkstyle/codeclimate) |
| abaplint (local offline) | ✅ | ❌ (uses native ATC) | ✅ (native Go port, 8 rules) | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Unit tests | ✅ (with coverage — statement/branch/procedure, PR #503) | ✅ (abap_run_unit_tests) | ✅ | ✅ | ❌ | ✅ (with coverage) | ✅ | N/A | ✅ (Apr 2026) | ✅ (with coverage + JUnit4/sonar) |
| CDS unit tests | ✅ (`generate-cds-unit-test` skill closes the loop: discover testable semantics → generate test class → `SAPWrite`/`SAPActivate` → run via `SAPDiagnose(unittest)`. On SAP_BASIS 8.16+ the discovery step uses SAP-native `SAPDiagnose(cds_testcases)` — CDS Test Double Framework, PR #351; older releases fall back to DDL semantic analysis) | ⚠️ (via run_unit_tests) | ❌ | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ❌ |
| API release state (clean core) | ✅ (read + **write/release**, PR #506) | ⚠️ (Eclipse, IDE-side) | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Fix proposals | ✅ | ⚠️ (Joule AI) | ❌ | ✅ | ❌ | ❌ | ❌ | N/A | ✅ (Apr 2026) | ❌ |
| PrettyPrint | ✅ | ⚠️ (IDE-side) | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | ✅ (Apr 2026) | ❌ |
| Migration analysis | ❌ | ⚠️ (Joule CCM, separate) | ❌ | ❌ | ❌ | ✅ | ❌ | N/A | ❌ | ❌ |

## 9. Transport / CTS

| Feature | ARC-1 | SAP ABAP MCP | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|---------|-------|---|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| List transports | ✅ | ✅ (abap_transport-get) | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ (-r/-rr/-rrr detail) |
| Create transport | ✅ (K/W/T) | ✅ (abap_transport-create) | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ | ✅ (5 types: K/W/T/S/R) |
| Release transport | ✅ | ❌ (IDE human-in-the-loop) | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | ✅ | ✅ (recursive) |
| Recursive release | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ✅ (recursive) |
| Delete transport | ✅ (recursive) | ❌ | ❌ | ❌ | ��� | ❌ | ❌ | N/A | ❌ | ✅ |
| Transport contents | ⚠️ (forward lookup: `SAPTransport get`) | ⚠️ (abap_transport-get) | ❌ | ✅ | ❌ | ❌ | ❌ | N/A | ✅ | ✅ (-rrr objects) |
| Object → transport reverse lookup | ✅ (history action) | ❌ | ❌ | ⚠️ (URI resolve only) | ❌ | ❌ | ❌ | N/A | ⚠️ (URI resolve only) | ❌ |
| Transport assign | ✅ (reassign owner) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ✅ | ✅ (reassign owner) |
| Transport gating | ✅ | ⚠️ (human-in-the-loop selection) | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Inactive objects list | ✅ (rich user/deleted/transport metadata + flat fallback) | ⚠️ (IDE-side) | ✅ | ��� | ❌ | ❌ | ✅ | N/A | ❌ | ✅ |

## 10. Diagnostics & Runtime

| Feature | ARC-1 | SAP ABAP MCP | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|---------|-------|---|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Short dumps (ST22) | ✅ (focused sections by default + `includeFullText` opt-in, PR #174) | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ | ❌ |
| ABAP profiler traces | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ (8 tools: list/params/config/hit-list/statements/db-access/delete×2) | ❌ |
| System messages (SM02) | ✅ (`SAPDiagnose action=system_messages`, ADT feed, PR #174 2026-04-21) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (v5.0.0) | N/A | ❌ | ❌ |
| Gateway error log (IWFND) | ✅ (`SAPDiagnose action=gateway_errors`, on-prem, list + detailUrl/id detail modes, PR #174 2026-04-21) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (v5.0.0, on-prem) | N/A | ❌ | ❌ |
| ADT feed reader (unified) | ✅ (dumps + traces + system_messages + gateway_errors; all under `SAPDiagnose`) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (v5.0.0, 5 types) | N/A | ❌ | ❌ |
| SQL traces | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| ABAP debugger | ❌ | ⚠️ (Eclipse debugger, IDE-side, not MCP) | ✅ (8 tools) | ✅ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| AMDP/HANA debugger | ❌ | ⚠️ (Eclipse, IDE-side) | ✅ (7 tools) | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Execute with profiling | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ❌ |

## 11. Advanced Features

| Feature | ARC-1 | SAP ABAP MCP | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|---------|-------|---|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Feature auto-detection | ✅ (8 probes + ADT discovery/MIME + standalone type-availability probe with multi-signal classifier, PR #163) | ✅ (Eclipse ADT discovery) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (ADT discovery/MIME) |
| Caching (SQLite) | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ETag source revalidation | ✅ (`If-None-Match`, active/inactive cache keys) | ⚠️ (Eclipse client) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| UI5/Fiori BSP | ❌ | ❌ | ⚠️ (3 read-only; 4 write tools disabled — ADT filestore returns 405) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (OData upload/download) |
| abapGit/gCTS | ✅ | ⚠️ (local sync via AFF planned, not abapGit) | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | ✅ | ✅ (full gCTS + checkout/checkin) |
| BTP Destination Service | ✅ | ❌ (local destinations file) | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Cloud Connector proxy | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Multi-system support | ❌ | ✅ (abap_list_destinations) | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ (SAP UI Landscape XML, Apr 2026) | ✅ (kubeconfig contexts) |
| OData bridge | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ (BSP, FLP via OData) |
| Lua scripting engine | ❌ | ❌ | ✅ (50+ bindings) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| WASM-to-ABAP compiler | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| MCP client configurator | ❌ | N/A (IDE-embedded) | ❌ | ❌ | ❌ | ❌ | ✅ (11 clients) | ❌ | ❌ | ❌ |
| CLI mode (non-MCP) | ⚠️ (generic `call`/`tools` entry points + 6 ergonomic shortcuts; 9 of 12 MCP tools lack shortcuts or expose fewer knobs than the Zod schema — tracked as [FEAT-60](../docs_page/roadmap.md#feat-60-cliserver-alignment-shortcut-parity-with-mcp-tool-schemas) + PR [#179](https://github.com/arc-mcp/arc-1/pull/179)) | ❌ (VS Code only) | ✅ (28 commands) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (28+ commands, primary mode) |
| Health endpoint | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (v4.3.0) | ❌ | ✅ | ❌ |
| RFC connectivity | ❌ | ✅ (bundles JCo) | ❌ | ❌ | ❌ | ❌ | ✅ (sap-rfc-lite) | ❌ | ❌ | ✅ (PyRFC, optional) |
| MCPB one-click install | ❌ | ❌ (VSIX marketplace) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Lock registry / recovery | ❌ | ⚠️ (Eclipse locks) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Batch HTTP operations | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (multipart/mixed) | ❌ | ❌ | ❌ |
| RAG-optimized tool descriptions | ⚠️ (intent-based tool blurbs; compact 12-tool surface) | ✅ (heavily agent-engineered: USE WHEN/WORKFLOW/CRITICAL) | ❌ | ❌ | ❌ | ❌ | ✅ (v4.4.0; v6.2.0 extended to per-object-type context for 13 types — PR #66) | ❌ | ❌ | ❌ |
| Embeddable server (library mode) | ❌ | ❌ (VS Code-embedded only) | ❌ | ❌ | ❌ | ❌ | ✅ (v6.4.0 adds per-instance `systemType` for multi-tenant) | ❌ | ❌ | ❌ |
| Error intelligence (hints) | ✅ (SAP-domain classification: lock-conflict/enqueue/auth/activation/object-exists/transport/method-not-supported/icf-handler-not-bound — last category added 2026-04-20 for SICF misconfiguration on DTEL create) | ⚠️ (Eclipse + Joule explanations) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (extensive) | ✅ (typed error hierarchy) |

## 12. Token Efficiency

| Feature | ARC-1 | SAP ABAP MCP | vibing-steampunk | fr0ster | sapcli |
|---------|-------|---|-----------------|---------|--------|
| Schema token cost | ~200 (hyperfocused) / ~moderate (12 tools) | ~moderate (14 tools, verbose descriptions) | ~200 (hyperfocused) / ~14K (focused) / ~40K (expert) | ~high (303 tools) | N/A (CLI) |
| Context compression | ✅ SAPContext (7-30x) | ❌ | ✅ Auto-append (7-30x) | ❌ | N/A |
| Method-level surgery | ✅ (95% source reduction) | ❌ | ✅ (95% source reduction) | ❌ | N/A |
| Hyperfocused mode (1 tool) | ✅ (~200 tokens) | ❌ | ✅ (~200 tokens) | ❌ | N/A |
| Compact/intent mode | ✅ (12 intent tools) | ❌ | N/A | ✅ (22 compact tools) | N/A |

## 13. Testing & Quality

| Metric | ARC-1 | SAP ABAP MCP | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|--------|-------|---|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Unit tests | 1315 | N/A (closed source) | 222 | 0 | 0 | 0 | Yes (Jest) | 0 | 163 | ~90 files (unittest) |
| Integration tests | ✅ (on-prem CI + BTP scheduled smoke) | N/A | ✅ | ❌ | 13 (live SAP) | ❌ | ✅ | ❌ | ⚠️ scaffold | ✅ (shell scripts) |
| CI/CD | ✅ (release-please + reliability telemetry) | N/A (SAP internal) | ✅ (GoReleaser) | ❌ | ❌ | ❌ | ⚠️ (Husky + lint-staged) | ❌ | ❌ | ✅ (GitHub Actions + codecov) |
| Input validation | Zod v4 | Eclipse/Java | Custom | Untyped | Untyped | Pydantic | Zod v4 | Zod | Manual | argparse |
| Linter | Biome | N/A | — | — | — | — | Biome | — | — | pylint + flake8 + mypy |

---

## Priority Action Items

> All prioritized items with evaluation details are maintained in the [roadmap](../docs_page/roadmap.md#prioritized-execution-order). The feature matrix tables above are the source of truth for _what exists_; the roadmap is the source of truth for _what to build next and why_.

---

## Corrections from Previous Matrix (2026-03-30)

The following items were incorrectly marked in the previous version and have since been updated:

| Item | 2026-03-30 | 2026-04-01 | 2026-04-02 | Reason |
|------|-----------|-----------|-----------|--------|
| ARC-1 Short dumps (ST22) | ✅ (wrong) | ❌ | ✅ | Implemented in PR #24 (SAPDiagnose dumps action) |
| ARC-1 ABAP profiler | ✅ (wrong) | ❌ | ✅ | Implemented in PR #24 (SAPDiagnose traces action) |
| ARC-1 SQL traces | ✅ (wrong) | ❌ | ❌ | Still not implemented |
| ARC-1 DDLX read | — | ❌ | ✅ | Implemented in PR #22 |
| ARC-1 SRVB read | — | ❌ | ✅ | Implemented in PR #22 |
| ARC-1 Batch activation | — | ⚠️ | ✅ | Implemented in PR #22 |
| ARC-1 RAP CRUD | — | ❌ | ✅ | DDLS/DDLX/BDEF/SRVD write in PR #22 |
| VSP tool count | 1-122 | 1-99 (54 focused, 99 expert per README_TOOLS.md) | Updated from actual tool documentation |
| fr0ster version | v4.5.2 | v4.7.1 → v4.8.1 | Updated to current release (85+ releases) |
| fr0ster TLS support | not listed | ✅ (v4.6.0) | New feature added Mar 31 |
| fr0ster sap-rfc-lite | not listed | ✅ (v4.7.0) | Replaced archived node-rfc |
| dassian column name | dassian-adt | dassian-adt / abap-mcpb | Successor repo albanleong/abap-mcpb created Mar 31 |
| VSP abaplint | ❌ (Go lexer) | ✅ (native Go port, 8 rules) | v2.32.0 added native linter |
| VSP HTTP Streamable | ❌ | ✅ (v2.38.0, mcp-go v0.47.0) | ARC-1 no longer unique on HTTP transport |
| VSP version | v2.32.0 | v2.39.0+ | Massive feature sprint Apr 2-8 (40+ commits) |
| fr0ster version | v4.8.1 | v4.8.7 | Continued iteration |
| fr0ster version | v4.8.7 | v5.0.8 (303 tools) | v5.0.7: 14 activation tools (+14), post-merge naming fix in v5.0.8 |
| fr0ster version | v5.0.8 (303 tools) | v5.1.1 (316 tools) | v5.1.0: 13 Check handlers, Node 22 minimum, stdio log fix, CSRF fix |
| fr0ster version | v5.1.1 (316 tools) | v6.1.0 (~320 tools) | v5.2.0: SRVD/SRVB activate + ServiceBindingVariant. v6.0.0 BREAKING: RuntimeListDumps removed, dump reads via RuntimeListFeeds; UpdateInterface BTP corrNr fix. v6.1.0: RFC decoupled from legacy. |
| fr0ster version | v6.1.0 | v6.4.1 (2026-04-21) | 4 releases in one week. v6.2.0: per-object-type tool descriptions across 13 types (PR #66). v6.4.0: per-instance `systemType` option for EmbeddableMcpServer (PR #69/#70, multi-tenant use case). v6.4.1: Dockerfile HTTP/header fix. Stars 35→43. |
| ARC-1 System messages (SM02) | ❌ | ✅ (PR #174 2026-04-21) | `SAPDiagnose action=system_messages` via ADT feed with user/from/to/maxResults filters. Closes the last fr0ster-v5-unique diagnostics gap. |
| ARC-1 Gateway error log (IWFND) | ❌ | ✅ (PR #174 2026-04-21) | `SAPDiagnose action=gateway_errors` (on-prem /IWFND/ERROR_LOG). Supports list mode and detail mode via `detailUrl` (preferred) or `id+errorType`. |
| ARC-1 ADT type-availability probe | not tracked | ✅ (PR #163 2026-04-20) | FEAT-50 base feature shipped as standalone diagnostic (`npm run probe`). Multi-signal classifier (discovery + collection GET + known-object GET + release floor). Fixture-driven replay tests. Synthetic 7.52 corpus + real NW 7.58 capture. No runtime gating — explicit design choice after PR #93/#96 regression. |
| ARC-1 DTEL v2→v1 content-type fallback | not tracked | ✅ (PR #169 2026-04-20) | Narrow static allowlist in `CONTENT_TYPE_FALLBACKS`; 415-only retry for DTEL create on older releases where `vnd.sap.adt.dataelements.v2+xml` is unsupported. |
| ARC-1 SICF-aware error hints | not tracked | ✅ (PR #169 2026-04-20) | New `icf-handler-not-bound` classification for DTEL create failures caused by missing SICF node (actionable hint points to SICF activation). |
| ARC-1 CDS sibling DDLS/DDLX consistency | not tracked | ✅ (PR #177 2026-04-22) | `SAPContext action=impact` additive sibling-consistency pass detecting asymmetric metadata-extension coverage across variants (common RAP bug: one DDLS has DDLX, sibling doesn't → missing UI fields on one routing path). Bounded (`siblingCheck`, `siblingMaxCandidates`), degrades to warnings on failure. |
| ARC-1 SAPManage scope split | not tracked | ✅ (PR #171) | Read sub-actions (features/probe/cache_stats) vs write sub-actions (package/FLP lifecycle) enforced via `SAPMANAGE_ACTION_SCOPES` in both standard and hyperfocused mode. Read-only clients keep diagnostic manage actions. |
| ARC-1 first-party skills | 4 (RAP + workflow) | 7 (added `sap-clean-core-atc`, `sap-unused-code`, `sap-object-documenter`) | Productization layer expanded beyond RAP into clean-core ATC review, dead-code detection, and object-level documentation capture. |
| dassian-adt | 33 stars | 37 stars | Still quiet — no commits since Apr 14. |
| abap-adt-api (mario) | 109 stars | 125 stars | Repo remains dormant (last commit Feb 2025). Star growth is retrospective, not activity-driven. |
| VSP stars | 279 | 295 | Quiet since 2026-04-15. Latest release v2.38.1 (2026-04-07). |
| dassian-adt | 0 stars, 25 tools, no OAuth | 33 stars, 53 tools, OAuth/XSUAA, multi-system | Explosive growth: 28 new tools, OAuth, multi-system in 2 weeks. No new commits since Apr 14. |
| dassian-adt transport tool count | 6 | 9 | Deep analysis: +transport_set_owner, +transport_add_user, +transport_delete in TransportHandlers.ts |
| dassian-adt trace tools | (unlisted) | 8 (TraceHandlers.ts) | Full profiler workflow: list/params/config/hit-list/statements/db-access/delete/delete-config |
| dassian-adt test include | ❌ | ✅ abap_create_test_include | TestHandlers.ts confirmed in deep analysis 2026-04-16 |
| VSP stars | 273 | 279 | New issues: 103 (SAProuter support), 104 (CSRF HEAD 403 on S/4HANA public cloud) |
| fr0ster stars | 29 | 35 | v6.1.0 |
| sapcli stars | 77 | 79 | PR #149 merged (domain support), PR #147 (auth fields), HTTP refactor |
| VSP lock-handle bug | ⚠️ (ongoing 423 errors) | ✅ (22517d4 — modificationSupport guard) | Root cause fixed in VSP; ARC-1 aligned with COMPAT-01 fix on 2026-04-16 (`lockObject` now checks `MODIFICATION_SUPPORT`/`modificationSupport`). |
| VSP version | v2.39.0+ | v2.40.0+ (Apr 13-15 sprint) | cr-config-audit CLI tools, RecoverFailedCreate primitive, lock-handle fix |
| S/4HANA Public Cloud CSRF | not tracked | ✅ fixed 2026-04-16 | VSP issue #104 confirmed the HEAD incompatibility. ARC-1 now retries CSRF fetch with GET when HEAD returns 403. |
| ARC-1 V4 SRVB publish endpoint | not tracked | ✅ fixed 2026-04-15 (PR #130) | `publishServiceBinding()`/`unpublishServiceBinding()` now use resolved binding type (`odatav2`/`odatav4`) instead of hardcoded v2. |
| ARC-1 SKTD (Knowledge Transfer Documents) | ❌ | ✅ (merged PR #134 2026-04-16) | PR #134 by lemaiwo — full SKTD read/write: `GET/PUT/POST /sap/bc/adt/documentation/ktd/documents/`, base64-decoded Markdown, create requires refObjectType, update preserves server-side metadata. |
| GetProgFullCode (include traversal) availability | ✅ fr0ster | ✅ fr0ster (on-prem only) | fr0ster v6.1.0 deep analysis: uses `GET /sap/bc/adt/repository/nodestructure?objecttype=PROG/P&objectname={name}` + recursive include fetch. NOT available on BTP Cloud (missing node API). |
| fr0ster Enhancements endpoint | noted | documented | fr0ster deep analysis: `GET /sap/bc/adt/programs/programs/{name}/source/main/enhancements/elements` (base64-encoded source, on-prem only); enhancement spot: `GET /sap/bc/adt/enhancements/enhsxsb/{spotName}`; on-prem only. |
| dassian-adt deep analysis | partial | complete | 2026-04-16 deep dive: 9 transport tools (was 6), 8 trace tools, abap_run endpoint `POST /sap/bc/adt/oo/classrun/{name}`, multi-system `sap_system_id` injection, OAuth self-hosted AS with PKCE. New folder: compare/dassian-adt/ |
| **— 2026-06-24 deep scan (fr0ster + sapcli focus) —** | | | |
| fr0ster version | v6.5.1 (2026-04-27, 29★) | **v7.2.1** (2026-06-22, 63★) | 22 releases, 97 commits. v6.6–6.8 SearchSource (package source grep) + RuntimeRunClass profiling; v6.9 certificate/Kerberos auth + NTLM reject; v7.0.0 BREAKING Read/Get dedup; v7.1 function-group include CRUD; **v7.2.0 DNS-rebinding (Host/Origin allowlist)**. Details: [05-fr0ster](05-fr0ster-mcp-abap-adt.md). |
| sapcli activity | last scan 2026-04-12 (79★) | **2026-06-22 (91★)** | ~100 commits. BTP OAuth + auth_plugin protocol; abapCheckRun-before-save; **AUnit branch/procedure coverage**; MSAG CRUD; Transaction (TRAN) write; BDEF listinterfaces/extensions/adtTemplate; DDL API-release write; package `--package-type`/recordChanges. Details: [09-sapcli](09-sapcli.md). |
| ARC-1 DNS-rebinding / Host-header validation | not tracked | ❌ **GAP → SEC-14 (P2)** | fr0ster v7.2.0 + MCP spec recommend a Host-header allowlist for HTTP/SSE. ARC-1 validates `Origin`/CORS + OAuth hosts but not `Host` (`src/server/http.ts`); matters for localhost / stdio-HTTP-bridge deploys. Fix = Express middleware + `ARC1_ALLOWED_HOSTS`. |
| ARC-1 CDS API-release **write** (set C1 / apistate) | read-only (FEAT-02) | gap confirmed — **dual-signal** | Both sapcli (`874c3b3` apistate set) AND vibing-steampunk now *set* the release contract; ARC-1 only *reads* via `getApiReleaseState`. Rising clean-core relevance → extend FEAT-02. |
| ARC-1 AUnit coverage (FEAT-31/41) | tracked, no ref impl | sapcli reference impl shipped | sapcli `942d70b` prints branch + procedure coverage; ARC-1 still hardcodes `coverage active="false"` (`devtools.ts:554`). Raises confidence on FEAT-41. |
| ARC-1 TRAN write (FEAT-62) | tracked (research only) | sapcli reference impl merged | sapcli `d7a6f2d`/`df954a3` shipped the TRAN ADT mapper + create envelope — concrete reference for FEAT-62. |
| vibing-steampunk | 295★ | **392★** | Quiet in-window (1 doc commit since v2.40.0); +97★. Boundary/dynamic-call analyzer already captured (doc 01); deliberate defer (roadmap 29n). |
| dassian-adt | "no commits since Apr 14", 37★ | **active again** — 11 commits May–Jun, 5★ | **Was wrongly logged as dormant.** The private→public repo toggle (2026-06) reset GitHub's star count (33★→5★) — not a loss of interest. New gaps from the deep scan: **pre-release inactive-objects check** (High, S — primitive exists), **unknown-column self-correcting hint** (High), **TTYP create** (Med), **ToC bundling** (verify — advertise-vs-impl mismatch). Already-have: class-local include reads, transport/lock/write resilience, output cap+compress. Details: [07-dassian-adt](07-dassian-adt.md). |
| **— 2026-06-25 SHIPPED (the 2026-06-24 deep-scan gaps, closed) —** | | | All implemented + tested live on a4h 758 (S/4HANA 2023) AND a4h-2025 816 (ABAP Platform 2025); per-PR detail below. |
| ARC-1 pre-release inactive-objects check (FEAT-63, #1) | GAP (High, S) | **✅ PR #501** | `inactiveObjectsForTransport` matcher + `precheckInactiveForRelease` block-before-release for SAPTransport `release`/`release_recursive`; safety ceiling enforced before the diagnostic read; also fixed the misleading K/W/T create-claim text (COMPAT-05, #3). |
| ARC-1 unknown-column self-correcting hint (FEAT-64, #4) | GAP (High) | **✅ PR #502** | `extractUnknownColumn`/`formatUnknownColumnHint` anchored on the language-stable T100 id `ADT_DATAPREVIEW_MSG/004`; wired into SAPQuery + SAPRead TABLE_QUERY; ReDoS- and injection-guarded. |
| ARC-1 AUnit coverage (FEAT-41, #5) | GAP (sapcli ref impl) | **✅ PR #503** | `SAPDiagnose action=unittest` `coverage:true` → statement/branch/procedure %; 2-step ADT flow (run → measurement query); cross-release `CLAS/OM[/vis]` handled; degrades to `{tests}` on absence. |
| ARC-1 TTYP read + create (FEAT-65, #8) | GAP (Med) | **✅ PR #504** | `SAPRead`/`SAPWrite type=TTYP`; built-in + structure row types; create is POST shell → follow-up PUT that sets the REAL row type (SAP's POST ignores it); discovery-gated off NW 7.50. |
| ARC-1 FUGR structural-include write (FEAT-18 sibling, #9) | GAP | **✅ PR #505** | `SAPWrite update type=INCL`+`group` edits `LZ<grp>TOP`/form includes; lock-the-include (not the group); fail-closed package gate via the include's containerRef; bare INCL stays standalone. |
| ARC-1 CDS API-release **write** (FEAT-02 follow-up, #7) | dual-signal GAP | **✅ PR #506** | `SAPManage action=set_api_state` releases/revokes an object's C1 contract; narrow v10 GET→PUT transform (drops response-only nodes; ≥1 visibility); fail-closed package gate; idempotent no-op handling. |
| ARC-1 RAP behavior **extension** create (`extend behavior for`, #10) | GAP (sapcli BDEF extend) | **✅ PR #507** | `SAPWrite create type=BDEF` with `extend behavior for X` source; the create POST carries `adtcore:adtTemplate(base_bdef)` **before** packageRef (schema-ordered); base must be `extensible`; comment/string-stripped source detection + non-blocking read-back verify. |
| ARC-1 DNS-rebinding / Host-header validation (SEC-14, #2) | GAP → P2 | **⏸ PR #500 — implemented then DEFERRED** | Mandatory HTTP auth is the primary rebind control; Host validation only matters in the no-auth mode a real deploy shouldn't use. Parked to avoid `ARC1_ALLOWED_HOSTS` setup surface. Decision + resume guide: [docs/plans/sec-14-dns-rebinding-host-validation.md](../docs/plans/sec-14-dns-rebinding-host-validation.md). |
| ARC-1 TRAN write (FEAT-62, #6) | tracked (sapcli ref impl) | **⛔ HARD BLOCKER — deferred** | `/sap/bc/adt/aps/iam/tran` returns 404 on 758 + 816 and is absent from discovery on all three systems — no backend to implement or verify against. Stays tracked; see [docs/research/adt-transaction-source-write.md](../docs/research/adt-transaction-source-write.md). |

---

## Competitive Positioning Summary

### ARC-1 Unique Strengths (no other project has all of these)
1. **Intent-based routing** — 12 tools vs 25-303. Simplest LLM decision surface.
2. **Declarative safety system** — Read-only, op filter, pkg filter, SQL blocking, transport gating, dry-run. Most comprehensive.
3. **MCP scope system** — OAuth scope-gated tool access (read/write/admin).
4. **BTP ABAP Environment** — Full OAuth 2.0 browser login, direct connectivity.
5. **Principal propagation** — Per-user SAP identity via Destination Service.
6. **MCP elicitation** — Interactive parameter collection for destructive ops.
7. **Audit logging** — BTP Audit Log sink for compliance.
8. **Context compression** — AST-based dependency extraction with depth control.
9. **First-party workflow skills** — researched RAP/common-use-case playbooks can encode provider-contract choices, clean-core guardrails, and recent primitives (`impact`, revisions, formatter settings, SKTD, `SAPGit`) on top of the compact intent-tool surface.
10. **npm + Docker + release-please** — Most professional distribution pipeline.

### Biggest Competitive Threats
1. **vibing-steampunk** (295 stars) — Community favorite but quiet since 2026-04-15 (latest release v2.38.1, 2026-04-07). Has Streamable HTTP (v2.38.0), SAML SSO (PR #97). Massive early-Apr sprint: i18n, gCTS, API release state, version history, code coverage, health analysis, rename preview, dead code analysis, package safety hardening, RecoverFailedCreate primitive. Defaults to hyperfocused mode (1 tool). Open issues: OAuth2 BTP request (#99), recurring lock handle bugs (fix in 22517d4), CSRF HEAD 403 on S/4HANA public cloud (#104), SAProuter support (#103).
2. **fr0ster** (v6.4.1, 100+ releases, 43 stars) — Closest enterprise competitor and the only active one this week (4 releases in 4 days, Apr 17-21). ~320 tools, 9 auth providers, TLS, RFC, embeddable. v6.2.0 shipped per-object-type tool descriptions (13 types) — same direction ARC-1 took with intent-based tools, but via per-type enrichment instead of collapsing to 12 intents. v6.4.0 added per-instance `systemType` to `EmbeddableMcpServer` (multi-tenant capability ARC-1 lacks — worth tracking for enterprise customers running one gateway per portfolio of SAP systems). v6.0.0 BREAKING: simplified dump API + fixed UpdateInterface on BTP (corrNr bug — not applicable to ARC-1 due to centralized safeUpdateSource). ARC-1 has already aligned on V4 SRVB publish endpoint support (PR #130, 2026-04-15) and closed the last unique diagnostics gap by adding SM02 + IWFND to `SAPDiagnose` (PR #174, 2026-04-21).
3. **dassian-adt** (37 stars, 53 tools) — Stabilized after explosive April sprint (0 → 37 stars, 25 → 53 tools in 2 weeks). OAuth/XSUAA/multi-system/per-user auth all added. Deep analysis (2026-04-16): 9 transport tools, 8 trace tools, abap_create_test_include confirmed. No new commits since Apr 14 — stable but stalled. Lacks: safety system, BTP Destination/PP, caching, linting.
4. **SAP ABAP MCP Server** (official, `SAPSE.adt-vscode` v1.0.0 — now a tracked matrix column) — SAP's own ABAP MCP server now ships inside the ABAP Development Tools for VS Code extension (GA Q2 2026). It runs in a bundled headless Eclipse/Equinox app (full ADT toolset + JCo for RFC) and exposes **14 built-in tools** (`abap_creation-*` ×4, `abap_generators-*` ×3, `abap_business_services-*` ×2, `abap_activate_objects`, `abap_run_unit_tests`, `abap_transport-{get,create}`, `abap_list_destinations`) **plus dynamic per-destination "IDE Actions"** — over Streamable-HTTP on `localhost:2236` with a static bearer token. Tool descriptions are heavily agent-prompt-engineered (USE WHEN / TYPICAL WORKFLOW / CRITICAL ordering; transport selection forced human-in-the-loop). **Strengths vs ARC-1:** RAP/clean-core *generation* (Generate-Behavior-Implementation as a first-class tool), native ATC/Joule AI, bundled RFC, and the embedded 16-year Eclipse ADT client. **Gaps vs ARC-1:** owns the *local, single-developer, in-IDE* slot only — no centralized multi-user deployment, no scopes/package-gates/audit, no Principal Propagation, no generic source *reads* exposed as MCP tools (reads happen via the LSP/editor), no SQL/diagnostics, no classic ABAP (Dynpro/FUGR/FUNC out of scope), VS Code only, disabled-by-default + part of commercial Joule for Developers. The "backend IDE-Actions → MCP tools" mechanism is the most interesting idea to watch. Full teardown: [J4D/02-sap-abap-mcp-server-vscode.md](J4D/02-sap-abap-mcp-server-vscode.md).
5. **btp-odata-mcp** (120 stars) — Different category (OData not ADT). Dormant since Jan 2026. High stars but no recent development.

### Key Gaps to Close

**Closed gaps:**
- ~~Diagnostics~~ → ST22 + profiler traces + **SM02 system messages** + **/IWFND/ERROR_LOG gateway errors** all under `SAPDiagnose` (PR #174, 2026-04-21)
- ~~RAP completeness~~ → DDLX/SRVB read, DDLS/DDLX/BDEF/SRVD write, batch activation
- ~~DDIC completeness~~ → DOMA, DTEL, TRAN read; TABL covers transparent tables AND DDIC structures (Model B, 2026-05-07 — collapsed legacy STRU into TABL to match TADIR R3TR TABL and abapGit conventions)
- ~~Token efficiency~~ → method-level surgery, hyperfocused mode, context compression
- ~~Workflow/productization gap~~ → first-party skills now cover RAP workflows, clean-core ATC review, dead-code detection, object-level documentation capture, plus provider contracts / draft-auth defaults / impact analysis / revision history / formatter settings / SKTD docs / SAPGit delivery context.
- ~~Diagnostic compatibility visibility~~ → standalone ADT type-availability probe (`npm run probe`) with multi-signal classifier, fixture-driven replay tests (PR #163, 2026-04-20).

**Recently merged / productized:**
- ~~**SM02 + IWFND in `SAPDiagnose`**~~ — **✅ Merged PR #174 (2026-04-21)**. Added `system_messages` and `gateway_errors` actions, closing the last fr0ster-v5-unique diagnostics gap. Dumps action rewritten for focused sections (`kap0`/`kap3`/…) with `includeFullText` opt-in to reduce token usage.
- ~~**ADT type-availability probe (FEAT-50 base)**~~ — **✅ Merged PR #163 (2026-04-20)**. Standalone `npm run probe` command, multi-signal classifier, fixture-driven replay tests (synthetic 7.52 + real NW 7.58). Diagnostic-only, no runtime gating.
- ~~**DTEL v2→v1 fallback + SICF-aware error hints**~~ — **✅ Merged PR #169 (2026-04-20)**. Narrow static Content-Type fallback + new `icf-handler-not-bound` error category for SICF misconfig.
- ~~**SAPContext impact sibling DDLS/DDLX consistency**~~ — **✅ Merged PR #177 (2026-04-22)**. Catches the "one sibling has DDLX, the other doesn't" RAP bug that missing UI fields trace back to.
- ~~**SAPManage scope split + data preview hardening**~~ — **✅ Merged PR #171**. Read sub-actions (features/probe/cache_stats) vs write sub-actions (package/FLP), enforced in both standard and hyperfocused mode.
- ~~**Three new first-party skills**~~ — **✅ Merged PR #164 (2026-04-19)**. `sap-clean-core-atc`, `sap-unused-code`, `sap-object-documenter` — broadens the workflow layer from RAP into clean-core review, dead-code detection, and object-level documentation capture.
- ~~**SKTD (Knowledge Transfer Documents)**~~ — **✅ Merged PR #134 (2026-04-16)** by lemaiwo. Full read/write for Markdown docs attached to ABAP objects. Unique to ARC-1 among all competitors.
- **RAP/common-use-case skill refresh (2026-04-18)** — `generate-rap-service-researched`, `generate-rap-service`, and `generate-rap-logic` now explicitly use `SAPContext(action="impact")`, `SAPRead(type="VERSIONS")`, `SAPTransport(action="history")`, `SAPLint(action="format"/"get_formatter_settings")`, `SAPRead/SAPWrite(type="SKTD")`, and `SAPGit`.
- **Workflow research conclusion** — external steering/skill repos (`sap-abap-base`, `sap-skills`) reinforce that the next differentiation layer is codified workflows, not raw tool-count inflation. ARC-1 is now positioned to ship tighter first-party playbooks on top of its intent-tool model.

**P0 — production blockers:**
- ~~415/406 content-type auto-retry (SAP version compatibility)~~ — ✅ Implemented. [Deep dive](fr0ster/evaluations/v4.5.0-release-deep-dive.md)
- ~~ADT service discovery / MIME negotiation (FEAT-38)~~ — ✅ completed 2026-04-14
- ~~401 session timeout auto-retry (centralized gateway idle)~~ — ✅ Implemented in `src/adt/http.ts`
- ~~TLS/HTTPS for HTTP Streamable~~ — downgraded to P3: most deployments use reverse proxy
- ~~**modificationSupport guard in lockObject()**~~ — ✅ fixed 2026-04-16 in `src/adt/crud.ts`. Lock responses with explicit `MODIFICATION_SUPPORT=false`/`modificationSupport=false` now fail early with actionable 423 guidance. [Eval](vibing-steampunk/evaluations/22517d4-lock-handle-bug-class.md)
- ~~**CSRF HEAD fallback for S/4HANA Public Cloud**~~ — ✅ fixed 2026-04-16 in `src/adt/http.ts`. CSRF fetch now retries with GET when HEAD returns 403. [Eval](vibing-steampunk/evaluations/22517d4-lock-handle-bug-class.md) / VSP issue #104
- ~~**V4 SRVB publish endpoint bug**~~ — ✅ fixed 2026-04-15 in PR #130 (`9b0601c`). Publish/unpublish now respect resolved service binding type (`odatav2`/`odatav4`). [Eval](fr0ster/evaluations/51781d3-srvd-srvb-activate-variant.md)
- ~~**BTP transport omission in safeUpdateSource()**~~ — **Likely NOT applicable.** ARC-1's centralized `safeUpdateSource()` already uses `transport ?? (lock.corrNr || undefined)` for all types — fr0ster's bug was per-handler (only `UpdateInterface` was missing it). Verify with BTP INTF update integration test. [Eval](fr0ster/evaluations/c2b8006-dump-simplify-updateintf-fix.md)

**P1 — remaining high-value gaps:**
- Function group bulk fetch
- Documentation (Copilot Studio guide, Basis Admin guide)
- Expand first-party workflow skills beyond RAP into transport review, diagnostics, clean-core checks, and Git-backed change review

**P2+ — future gaps:**
- ~~System messages (SM02)~~ — **✅ shipped in PR #174 (2026-04-21)** as `SAPDiagnose action=system_messages`.
- ~~Gateway error log (IWFND)~~ — **✅ shipped in PR #174 (2026-04-21)** as `SAPDiagnose action=gateway_errors` (on-prem only).
- Compare/diff on top of FEAT-20 + FEAT-49
- ABAP documentation / F1 help, table pagination / offset
- SQL traces, coverage/reporting enhancements
- Cloud readiness assessment, enhancement framework
- Multi-system routing, rate limiting
- Per-instance `systemType` / embeddable multi-tenant (fr0ster v6.4.0 pattern) — track if enterprise customers need one gateway for multiple SAP systems
- Dynpro (screen) metadata — ADT endpoint `/sap/bc/adt/programs/programs/<PROG>/dynpros` (abap-adt-api #44)
- RecoverFailedCreate — partial-create recovery on 5xx (VSP f00356a)

**Not planned (intentional):**
- ABAP debugger (WebSocket + ZADT_VSP), execute ABAP (security risk), Lua scripting (VSP-unique)
