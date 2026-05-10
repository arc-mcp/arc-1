# ARC-1 — SAP ADT MCP Server

**ARC-1** (pronounced _arc one_ [ɑːrk wʌn]) — Enterprise-ready MCP server for SAP ABAP systems. Secure by default, deployable to BTP or on-premise, and hardened with large unit/integration/E2E test coverage.

ARC-1 connects AI assistants (Claude, GitHub Copilot, Copilot Studio, and any MCP client) to SAP systems via the [ADT REST API](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/about-abap-development-tools). It ships as an [npm package](https://www.npmjs.com/package/arc-1) and [Docker image](https://github.com/marianfoo/arc-1/pkgs/container/arc-1).

[![Test](https://github.com/marianfoo/arc-1/actions/workflows/test.yml/badge.svg)](https://github.com/marianfoo/arc-1/actions/workflows/test.yml)
[![CodeQL](https://github.com/marianfoo/arc-1/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/marianfoo/arc-1/security/code-scanning)
[![Dependency Review](https://github.com/marianfoo/arc-1/actions/workflows/dependency-review.yml/badge.svg)](https://github.com/marianfoo/arc-1/actions/workflows/dependency-review.yml)

**[Full Documentation](https://marianfoo.github.io/arc-1/)** | **[Quickstart](https://marianfoo.github.io/arc-1/quickstart/)** | **[Tool Reference](https://marianfoo.github.io/arc-1/tools/)**

## Why ARC-1?

Built for organizations that need AI-assisted SAP development with guardrails. Inspired by the pioneering work of [abap-adt-api](https://github.com/marcellourbani/abap-adt-api), [mcp-abap-adt](https://github.com/mario-andreschak/mcp-abap-adt), and [vibing-steampunk](https://github.com/oisee/vibing-steampunk) — ARC-1 adds what's needed to run in production:

### Security & Admin Controls

- **Safe by default** — read-only, no free SQL, no table preview, no transport writes, no Git writes. Enable each capability with explicit `SAP_ALLOW_*` flags
- **Action deny list** — block specific tool actions with `SAP_DENY_ACTIONS` (for example `SAPWrite.delete`), without exposing low-level operation codes to admins
- **Package restrictions** — limit AI write operations (create, update, delete) to specific packages with wildcards (`--allowed-packages "Z*,$TMP"`). Read operations are not restricted by package — use SAP's native authorization for read-level access control
- **Data access control (off by default)** — `SAPRead(type=TABLE_CONTENTS)` and `SAPQuery` are gated behind explicit env vars (`SAP_ALLOW_DATA_PREVIEW=true`, `SAP_ALLOW_FREE_SQL=true`). These two capabilities sit outside the [SAP API Policy FAQ](#adt-api-status-and-strategy) "endorsed development tooling" scope (which excludes business-data reads and SQL against backend systems), so they are intentionally separated from the policy-aligned default surface and must be turned on deliberately
- **Transport safety** — transport reads are available for review, while transport mutations require both `--allow-writes` and `--allow-transport-writes`. Update/delete operations auto-use the lock correction number when no explicit transport is provided
- **Git workflow safety** — Git operations are disabled by default. Enable explicitly with `--allow-git-writes` / `SAP_ALLOW_GIT_WRITES=true`
- **API-key profiles** — multi-key HTTP deployments can assign `viewer`, `viewer-data`, `viewer-sql`, `developer`, `developer-data`, `developer-sql`, or `admin` per key
- **Writes restricted to `$TMP` when enabled** — only local/throwaway objects; writing to transportable packages requires explicit `--allowed-packages`
- **HTTP security headers (helmet) on by default** — HSTS, CSP, X-Frame-Options, CORP, X-Content-Type-Options. COOP is deliberately not set so popup-based OAuth flows (Copilot Studio) keep working. No flag to disable.
- **Opt-in CORS for browser MCP clients** — `ARC1_ALLOWED_ORIGINS` (comma-separated, exact match). Off by default; native MCP clients don't need it
- **Supply-chain security** — Dependabot (npm + GitHub Actions + Docker, weekly + same-day security advisories), `npm audit --audit-level=high` PR gate, GitHub Dependency Review on every PR, CodeQL SAST, Trivy container scanning (gating on release, advisory on dev), all third-party GitHub Actions pinned to commit SHA, [`SECURITY.md`](SECURITY.md) policy with severity-tiered SLAs. Image and npm package both ship with [provenance attestations](https://docs.npmjs.com/generating-provenance-statements). See the [security guide §13](https://marianfoo.github.io/arc-1/security-guide/#13-dependency--supply-chain-security)

### Authentication

- **API key** — simple Bearer token for internal deployments
- **OIDC / JWT** — Entra ID, Keycloak, or any OpenID Connect provider
- **OAuth 2.0** — browser-based login for BTP ABAP Environment
- **XSUAA** — SAP BTP native auth with automatic token proxy for MCP clients
- **Principal Propagation** — per-user identity forwarded through Cloud Connector (every SAP action runs as the actual user, not a technical account)

### BTP Cloud Foundry Deployment

Deploy ARC-1 as a Cloud Foundry app on SAP BTP with full platform integration:

- **Destination Service** — connect to SAP systems via managed destinations
- **Cloud Connector** — reach on-premise systems through the connectivity proxy
- **Principal Propagation** — user identity forwarded end-to-end via X.509 certificates
- **XSUAA OAuth proxy** — MCP clients authenticate via standard OAuth, ARC-1 handles the BTP token exchange
- **Audit logging** — structured events to stderr, file, or BTP Audit Log Service

### Token Efficiency

- **12 intent-based tools** (~5K schema tokens) instead of 200+ individual tools — keeps the LLM's context window small
- **Method-level read/edit** — read or update a single class method, not the whole source (up to 20x fewer tokens)
- **Context compression** — `SAPContext` returns public API contracts of all dependencies in one call (7-30x compression)

### Built-in Object Caching

- **Server-validated source caching** — every SAP object read is cached in memory (stdio) or SQLite (http-streamable). Repeated reads use `If-None-Match`/ETag conditional GET, so unchanged objects return from cache after SAP confirms `304 Not Modified`.
- **Dependency graph caching** — `SAPContext` dep resolution keyed by source hash; unchanged objects skip all ADT calls on subsequent runs.
- **Pre-warmer** — start with `ARC1_CACHE_WARMUP=true` to pre-index all custom objects at startup, enabling reverse dependency lookup (`SAPContext(action="usages")`) and fast CDS impact workflows (`SAPContext(action="impact", type="DDLS")`).
- **Active/inactive source views** — `SAPRead` accepts `version="active" | "inactive" | "auto"` and warns when the active source has an unactivated draft.
- **Write invalidation** — when `SAPWrite` or `SAPActivate` mutates an object, both active and inactive source cache entries are dropped; next read revalidates or fetches fresh source.

See **[docs/caching.md](docs/caching.md)** for full documentation.

### Testing

- **1,367+ unit tests** (`53` unit test files, mocked HTTP)
- **~160 integration tests** against live SAP systems, with explicit skip reasons when credentials or fixtures are missing
- **~70 E2E tests** that execute real MCP tool calls against a running ARC-1 server and live SAP system
- **CRUD lifecycle and BTP smoke lanes** included (`test:integration:crud`, `test:integration:btp:smoke`)
- **CI matrix** on Node `22` and `24`; integration + E2E run on `push` to `main` and internal PRs
- **Reliability telemetry + coverage** published as informational CI signals (non-blocking)

### Tools Refined for Real-World Usage

The 12 tools are designed from real LLM interaction feedback:

| Tool | What it does |
|------|-------------|
| **SAPRead** | Read ABAP source, table data, CDS views, metadata extensions (DDLX), service bindings (SRVB), message classes (`MSAG`), BOR objects, deployed UI5/Fiori apps (BSP, BSP_DEPLOY), plus on-prem metadata reads for authorization fields (`AUTH`), feature toggles (`FEATURE_TOGGLE`), and enhancement implementations (`ENHO`). Structured format for classes returns metadata + decomposed includes as JSON. (Deprecated aliases `MESSAGES`/`FTG2` accepted for one minor.) |
| **SAPSearch** | Object search + full-text source code search across the system |
| **SAPWrite** | Create/update/delete ABAP source and DDIC metadata with automatic lock/unlock (PROG, CLAS, INTF, FUNC, INCL, DDLS, DDLX, BDEF, SRVD, DOMA, DTEL). Class updates can target local includes (`definitions`, `implementations`, `macros`, `testclasses`), and RAP behavior-pool scaffolding can auto-create `lhc_*` skeletons before injecting signatures/stubs. Batch creation for multi-object workflows (e.g., RAP stack or domain+data element in one call) |
| **SAPActivate** | Activate ABAP objects — single or batch (essential for RAP stacks), with guarded retry for the S/4HANA ED064 batch quirk. Publish/unpublish OData service bindings (SRVB) |
| **SAPNavigate** | Go-to-definition, find references, code completion |
| **SAPQuery** | Execute ABAP SQL with table-not-found suggestions |
| **SAPTransport** | CTS transport management (list/create/release/delete/reassign), transport requirement checks, and reverse lookup history (`action="history"`) |
| **SAPGit** | Git-based ABAP workflows across gCTS and abapGit (list/clone/pull/push/commit/branch/unlink) with backend auto-selection and safety gating (`--allow-git-writes`) |
| **SAPContext** | Compressed dependency context (`action="deps"`), reverse dependency lookup (`action="usages"`), and CDS upstream/downstream impact analysis (`action="impact"` for DDLS) |
| **SAPLint** | Local ABAP lint (system/release-aware presets, auto-fix, pre-write validation) + ADT PrettyPrint (server-side formatting) |
| **SAPDiagnose** | Syntax check, ABAP Unit tests, ATC code quality, generic ADT quickfix proposals/application deltas, short dumps, profiler traces |
| **SAPManage** | Feature probing — detect what the system supports before acting |

Tool definitions automatically adapt to the target system (BTP vs on-premise), removing unavailable types and adjusting descriptions so the LLM never attempts unsupported operations.

### Feature Detection

ARC-1 probes the SAP system at startup and adapts its behavior:

- Detects HANA, gCTS, abapGit, RAP/CDS, AMDP, UI5, and transport availability
- Auto-detects BTP vs on-premise systems
- Maps SAP_BASIS release to the correct ABAP language version
- Each feature can be forced on/off or left on auto-detect
- In shared-credential mode (technical user), runs a startup auth preflight once and blocks SAP tool calls with a clear error on 401/403 to avoid repeated failed logins and potential user lockout

## ADT API Status and Strategy

SAP published a new [SAP API Policy](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf) in April 2026, accompanied by an [SAP API Policy FAQ](https://www.sap.com/documents/2026/04/e2a0665e-4c7f-0010-bca6-c68f7e60039b.html). The FAQ section *"How does the policy apply to ADT-based access and developer tooling?"* explicitly endorses ADT-based developer tooling:

> ADT APIs are SAP internal APIs and may be used for development purposes through endorsed channels only. Endorsed channels include SAP-published Eclipse ABAP Development Tools (the primary supported client), abapGit (an endorsed tool for ABAP development), SAP-provided developer tools that leverage ADT APIs, CI/CD pipelines using SAP-published tooling, and **custom developer utilities built on the documented Eclipse Java SDK for internal development automation such as code checks, build processes, and transport management**.

ARC-1 is designed to stay within the ADT development-tooling scope described in SAP's API Policy FAQ v1.1. It uses documented ADT / Eclipse SDK capabilities for internal development-related use cases and does not expose ADT Data Preview, SQL execution, table reads, or business-data extraction.

When ARC-1 is used with AI assistants or MCP clients, customers should apply additional governance for AI-driven or automated access patterns, including real user identity, authorization checks, audit logging, rate limits, conservative tool exposure, and customer-side review against SAP documentation and agreements.

Concretely, ARC-1 is positioned as a custom developer utility for internal development automation: code checks, build/activate, transport management, AI-assisted ABAP authoring, and Git workflows. The default tool surface — read source/metadata, search, navigate, lint, write/activate ABAP objects, manage transports, drive Git — matches the "development tooling framework" scope the policy describes.

The same FAQ also lists what ADT APIs are **not** intended for:

> Specifically, ADT APIs are not intended for **programmatic reading of application tables or export of business data, SQL execution against SAP backend systems, business data integration or runtime orchestration, agentic AI workflows operating on business data, or substitution for business APIs**.

Two ARC-1 capabilities fall outside that "development tooling" scope. Both are **off by default** and require explicit opt-in env vars, so the operator makes a deliberate decision before they are reachable:

| Capability | Env var | Default | Policy note |
| ---------- | ------- | ------- | ----------- |
| Named table content preview (`SAPRead(type=TABLE_CONTENTS)`) | `SAP_ALLOW_DATA_PREVIEW=true` | `false` (off) | Reading application tables / exporting business data is explicitly excluded by the FAQ. Keep this off for the policy-aligned development use case. Enable only for development scenarios that genuinely require reading specific custom-table content, against your SAP contract and your data-protection rules. |
| Freestyle ABAP SQL (`SAPQuery`) | `SAP_ALLOW_FREE_SQL=true` | `false` (off) | SQL execution against SAP backend systems is explicitly excluded by the FAQ. Keep this off for the policy-aligned development use case. Enable only for ad-hoc development queries, against your SAP contract and your data-protection rules. |

With both flags at their defaults, ARC-1 stays inside the FAQ envelope for "endorsed development tooling". Turning either flag on is a customer decision that must be made against the SAP API Policy, the customer's SAP agreement, and the customer's internal data-protection rules — not a flag to flip casually on a productive system.

Beyond the policy, the public signals for ADT remain consistent: SAP publishes an [ADT SDK](https://tools.hana.ondemand.com/#abap), a guide for [creating and consuming RESTful APIs in ADT](https://www.sap.com/documents/2013/04/12289ce1-527c-0010-82c7-eda71af511fa.html), and has described the ABAP language server direction as an ["ADT SDK 2.0"](https://community.sap.com/t5/technology-blog-posts-by-sap/abap-development-tools-for-vs-code-everything-you-need-to-know/bc-p/14263439/highlight/true#M186133).

ARC-1's strategy is to stay close to documented and discoverable ADT behavior, probe system capabilities before exposing tools, keep conservative security defaults (writes off, data preview off, free SQL off, package allowlist `$TMP`), and continuously review SAP's guidance as it evolves. This README is not a compliance decision for any specific customer landscape — review the policy and your agreements before productive use.

## Quick Start

```bash
npx arc-1@latest --url https://your-sap-host:44300 --user YOUR_USER
```

- **Trying it out on your laptop?** → [Quickstart](https://marianfoo.github.io/arc-1/quickstart/)
- **Full local dev setup (Docker, cookie extractor, client configs)?** → [Local Development](https://marianfoo.github.io/arc-1/local-development/)
- **Deploying for a team / BTP?** → [Deployment](https://marianfoo.github.io/arc-1/deployment/)

## Documentation

Full documentation is available at **[marianfoo.github.io/arc-1](https://marianfoo.github.io/arc-1/)**.

| Guide | Description |
|-------|-------------|
| [Quickstart](https://marianfoo.github.io/arc-1/quickstart/) | 5-minute npx + Claude Desktop setup |
| [Local Development](https://marianfoo.github.io/arc-1/local-development/) | Full local dev — all install methods, MCP client configs, SSO cookie extractor |
| [Deployment](https://marianfoo.github.io/arc-1/deployment/) | Multi-user deployment — Docker, BTP Cloud Foundry, BTP ABAP |
| [Configuration](https://marianfoo.github.io/arc-1/configuration-reference/) | Every flag and env var, one table |
| [Updating](https://marianfoo.github.io/arc-1/updating/) | Update procedures per install method |
| [Enterprise Auth](https://marianfoo.github.io/arc-1/enterprise-auth/) | Layer A / Layer B auth internals, coexistence matrix |
| [Tool Reference](https://marianfoo.github.io/arc-1/tools/) | Complete reference for all 12 tools |
| [Architecture](https://marianfoo.github.io/arc-1/architecture/) | System architecture with diagrams |
| [AI Usage Patterns](https://marianfoo.github.io/arc-1/mcp-usage/) | Agent workflow patterns and best practices |

## Development

```bash
npm ci && npm run build && npm test
```

See [CLAUDE.md](CLAUDE.md) for codebase structure, testing commands, and contribution guidelines.

## Credits

| Project | Author | Contribution |
|---------|--------|--------------|
| [vibing-steampunk](https://github.com/oisee/vibing-steampunk) | oisee | Original Go MCP server — ARC-1's starting point |
| [abap-adt-api](https://github.com/marcellourbani/abap-adt-api) | Marcello Urbani | TypeScript ADT library, definitive API reference |
| [mcp-abap-adt](https://github.com/mario-andreschak/mcp-abap-adt) | Mario Andreschak | First MCP server for ABAP ADT |
| [abaplint](https://github.com/abaplint/abaplint) | Lars Hvam | ABAP parser/linter (used via @abaplint/core) |

## License

MIT
