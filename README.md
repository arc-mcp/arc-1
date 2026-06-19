# ARC-1 — SAP ADT MCP Server

**ARC-1** (pronounced _arc one_ [ɑːrk wʌn]) — Enterprise-ready MCP server for SAP ABAP systems. Secure by default, deployable to BTP or on-premise, and hardened with large unit/integration/E2E test coverage.

ARC-1 connects AI assistants (Claude, GitHub Copilot, Copilot Studio, and any MCP client) to SAP systems via the [ADT REST API](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/about-abap-development-tools). It ships as an [npm package](https://www.npmjs.com/package/arc-1) and [Docker image](https://github.com/arc-mcp/arc-1/pkgs/container/arc-1).

[![Test](https://github.com/arc-mcp/arc-1/actions/workflows/test.yml/badge.svg)](https://github.com/arc-mcp/arc-1/actions/workflows/test.yml)
[![CodeQL](https://github.com/arc-mcp/arc-1/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/arc-mcp/arc-1/security/code-scanning)
[![Dependency Review](https://github.com/arc-mcp/arc-1/actions/workflows/dependency-review.yml/badge.svg)](https://github.com/arc-mcp/arc-1/actions/workflows/dependency-review.yml)

**[Full Documentation](https://docs.arc-1-mcp.com/)** | **[Quickstart](https://docs.arc-1-mcp.com/quickstart/)** | **[Tool Reference](https://docs.arc-1-mcp.com/tools/)** | **[Blog Series](https://blog.zeis.de/tags/ai-abap-development-series/)**

> 📖 **New: AI ABAP Development blog series** — long-form posts on AI for ABAP, ARC-1 design, and real-world BTP / Copilot Studio / Joule walkthroughs. **[Read the series →](https://blog.zeis.de/tags/ai-abap-development-series/)**

## Why ARC-1?

Built for organizations that need AI-assisted SAP development with guardrails. Inspired by the pioneering work of [abap-adt-api](https://github.com/marcellourbani/abap-adt-api), [mcp-abap-adt](https://github.com/mario-andreschak/mcp-abap-adt), and [vibing-steampunk](https://github.com/oisee/vibing-steampunk) — ARC-1 adds what's needed to run in production:

### Security & Admin Controls

- **Safe by default** — read-only, no free SQL, no table preview, no transport writes, no Git writes. Enable each capability with explicit `SAP_ALLOW_*` flags
- **Action deny list** — block specific tool actions with `SAP_DENY_ACTIONS` (for example `SAPWrite.delete`), without exposing low-level operation codes to admins
- **Package restrictions** — limit AI write operations (create, update, delete) to specific packages with wildcards (`--allowed-packages "Z*,$TMP"`). Read operations are not restricted by package — use SAP's native authorization for read-level access control
- **Data access control (off by default)** — `SAPRead(type=TABLE_CONTENTS)` and `SAPQuery` are gated behind explicit env vars (`SAP_ALLOW_DATA_PREVIEW=true`, `SAP_ALLOW_FREE_SQL=true`). These capabilities can expose application data or run ad-hoc SQL, so they are intentionally separated from the default development-tooling surface. They can be enabled for governed use cases, but should be reviewed against the current [SAP API Policy](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf), your SAP agreement, and internal data-governance rules
- **Transport safety** — transport reads are available for review, while transport mutations require both `--allow-writes` and `--allow-transport-writes`. Update/delete operations auto-use the lock correction number when no explicit transport is provided
- **Git workflow safety** — Git operations are disabled by default. Enable explicitly with `--allow-git-writes` / `SAP_ALLOW_GIT_WRITES=true`
- **API-key profiles** — multi-key HTTP deployments can assign `viewer`, `viewer-data`, `viewer-sql`, `developer`, `developer-data`, `developer-sql`, or `admin` per key
- **Writes restricted to `$TMP` when enabled** — only local/throwaway objects; writing to transportable packages requires explicit `--allowed-packages`
- **HTTP security headers (helmet) on by default** — HSTS, CSP, X-Frame-Options, CORP, X-Content-Type-Options. COOP is deliberately not set so popup-based OAuth flows (Copilot Studio) keep working. No flag to disable.
- **Opt-in CORS for browser MCP clients** — `ARC1_ALLOWED_ORIGINS` (comma-separated, exact match). Off by default; native MCP clients don't need it
- **Layered rate limiting** — three layers out of the box: per-IP OAuth/`/mcp` edge (Layer 1, default 20/min/IP, **on**), per-user MCP quota (Layer 2, **off by default** — multi-user deployments opt in via `ARC1_RATE_LIMIT=60`), server-wide SAP-bound semaphore (Layer 3, default 10, **on**). Honors `Retry-After` on 429/503 from SAP / BTP gateways. Two operator env vars; per-endpoint OAuth ceilings are constants in code. Closes CodeQL alert `js/missing-rate-limiting`. See the [Rate Limiting Guide](https://docs.arc-1-mcp.com/rate-limiting/)
- **Supply-chain security** — Dependabot (npm + GitHub Actions + Docker, weekly + same-day security advisories), `npm audit --audit-level=high` PR gate, GitHub Dependency Review on every PR, CodeQL SAST, Trivy container scanning (gating on release, advisory on dev), all third-party GitHub Actions pinned to commit SHA, [`SECURITY.md`](SECURITY.md) policy with severity-tiered SLAs. Image and npm package both ship with [provenance attestations](https://docs.npmjs.com/generating-provenance-statements). See the [security guide §13](https://docs.arc-1-mcp.com/security-guide/#13-dependency--supply-chain-security)

### Authentication

- **API key** — simple Bearer token for internal deployments
- **OIDC / JWT** — Entra ID, Keycloak, or any OpenID Connect provider
- **OAuth 2.0** — local browser-based login for BTP ABAP Environment service-key development
- **XSUAA** — SAP BTP native auth with automatic token proxy for MCP clients
- **Per-user SAP identity** — BTP Destination Service forwards the MCP user to SAP: Cloud Connector principal propagation for on-premise SAP, or `OAuth2UserTokenExchange` for BTP ABAP Environment

### BTP Cloud Foundry Deployment

Deploy ARC-1 as a Cloud Foundry app on SAP BTP with full platform integration:

- **Destination Service** — connect to SAP systems via managed destinations
- **Cloud Connector** — reach on-premise systems through the connectivity proxy
- **Per-user destinations** — user identity forwarded end-to-end via X.509 certificates for on-premise SAP, or exchanged for an ABAP bearer token for BTP ABAP Environment
- **XSUAA OAuth proxy** — MCP clients authenticate via standard OAuth, ARC-1 handles the BTP token exchange
- **Audit logging** — structured events to stderr, file, or BTP Audit Log Service

### Token Efficiency

- **12 intent-based tools** instead of 200+ individual tools — keeps tool selection simple, with the schema payload guarded by CI budgets and a hyperfocused 1-tool mode for tight context windows
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

- **3,474 unit tests** (`104` unit test files, mocked HTTP)
- **262-test default integration profile** against live SAP systems, with explicit skip reasons when credentials or fixtures are missing
- **141-test default E2E profile** that executes real MCP tool calls against a running ARC-1 server and live SAP system
- **Manual slow SAP profiles** keep expensive cache warmup, broad where-used, RAP full-stack, and recursive CTS release coverage out of the PR path (`test:integration:slow`, `test:e2e:slow`, GitHub **SAP Slow Tests** workflow)
- **CRUD lifecycle and BTP smoke lanes** included (`test:integration:crud`, `test:integration:btp:smoke`)
- **CI matrix** on Node `22` and `24`; live SAP integration + E2E run on internal PRs and manual dispatch, with SAP jobs gated off for docs/chore PRs and external forks
- **Reliability telemetry + coverage** published as informational CI signals (non-blocking)

### Tools Refined for Real-World Usage

The 12 tools are designed from real LLM interaction feedback:

| Tool | What it does |
|------|-------------|
| **SAPRead** | Read ABAP source, table data, CDS views, access controls (`DCLS`), metadata extensions (`DDLX`), service bindings (`SRVB`), knowledge-transfer docs (`SKTD`), message classes (`MSAG`), revision history (`VERSIONS`/`VERSION_SOURCE`), inactive object state, BOR objects, deployed UI5/Fiori apps (BSP, BSP_DEPLOY), and ABAP Platform 2025 server-driven objects (`DESD`, `EVTB`, `EVTO`, `DTSC`, `CSNM`, `COTA`). On-prem metadata reads include authorization fields (`AUTH`), feature toggles (`FEATURE_TOGGLE`), and enhancement implementations (`ENHO`). Structured format for classes returns metadata + decomposed includes as JSON. Optional `grep` regex returns only matching source lines (+context, method-annotated for classes) for token-efficient search. (Deprecated aliases `MESSAGES`/`FTG2` accepted for one minor.) |
| **SAPSearch** | Object search + full-text source code search across the system |
| **SAPWrite** | Create/update/delete ABAP source and DDIC metadata with automatic lock/unlock (PROG, CLAS, INTF, FUNC, FUGR, INCL, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD, TABL, DOMA, DTEL, MSAG; availability adapts for BTP). Class updates can target local includes (`definitions`, `implementations`, `macros`, `testclasses`); class-section surgery (`edit_class_definition`, `add_method`, `edit_method_signature`, `delete_method`, `change_method_visibility`) lets an LLM edit a global class signature without re-sending `/source/main`; RAP behavior-pool scaffolding can auto-create `lhc_*` skeletons before injecting signatures/stubs. Batch creation supports terminal activation for interdependent multi-object workflows (e.g., RAP stack or domain+data element in one call) |
| **SAPActivate** | Activate ABAP objects — single or batch (essential for RAP stacks), with guarded retry for the S/4HANA ED064 batch quirk. Publish/unpublish OData service bindings (SRVB) |
| **SAPNavigate** | Go-to-definition, find references, code completion |
| **SAPQuery** | Execute ABAP SQL with table-not-found suggestions and automatic chunking for simple long literal `IN (...)` lists |
| **SAPTransport** | CTS transport management (list/get/create/release/delete/reassign/release-recursive), transport layer/target lookup, package transport requirement checks, and reverse lookup history (`action="history"`) |
| **SAPGit** | Git-based ABAP workflows across gCTS and abapGit (list/clone/pull/push/commit/branch/unlink) with backend auto-selection and safety gating (`--allow-git-writes`) |
| **SAPContext** | Compressed dependency context (`action="deps"`), reverse dependency lookup (`action="usages"`), and CDS upstream/downstream impact analysis (`action="impact"` for DDLS) |
| **SAPLint** | Local ABAP lint (system/release-aware presets, auto-fix, pre-write validation) + ADT PrettyPrint (server-side formatting) |
| **SAPDiagnose** | Syntax check, ABAP Unit tests, ATC code quality, CDS test-case suggestions, active/inactive object-state comparison, generic ADT quickfix proposals/application deltas, gateway/system message diagnostics, short dumps, and profiler traces |
| **SAPManage** | Feature probing, cache statistics, package lifecycle/change-package operations, and FLP catalog/group/tile helpers |

Tool definitions automatically adapt to the target system (BTP vs on-premise), removing unavailable types and adjusting descriptions so the LLM never attempts unsupported operations.

### Feature Detection

ARC-1 probes the SAP system at startup and adapts its behavior:

- Detects HANA, gCTS, abapGit, RAP/CDS, AMDP, UI5, and transport availability
- Auto-detects BTP vs on-premise systems
- Maps SAP_BASIS release to the correct ABAP language version
- Each feature can be forced on/off or left on auto-detect
- In shared-credential mode (technical user), runs a startup auth preflight once and blocks SAP tool calls with a clear error on 401/403 to avoid repeated failed logins and potential user lockout

## ADT API Status and Strategy

SAP's current [SAP API Policy](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf) is v.4.2026a. It allows published/documented APIs for the purposes described in SAP documentation, while restricting unsupported internal APIs, misuse, unmanaged autonomous AI call patterns, and large-scale extraction outside endorsed paths. ARC-1 is designed as a governed development-tooling proxy around ADT behavior, not as a bulk data-extraction product.

For typical internal developer workflows, ARC-1 should be treated as generally usable when it stays close to documented/discoverable ADT behavior, runs with real user identity, respects SAP authorization, and keeps audit and rate controls in place. Customers should still review their exact landscape, SAP agreement, and AI governance rules, especially when the MCP client can plan or execute sequences of tool calls.

Concretely, ARC-1 is positioned as a custom developer utility for internal development automation: code checks, build/activate, transport management, AI-assisted ABAP authoring, and Git workflows.

Two ARC-1 capabilities can expose business data or execute ad-hoc SQL. Both are **off by default** and require explicit opt-in env vars, so the operator makes a deliberate decision before they are reachable:

| Capability | Env var | Default | Policy note |
| ---------- | ------- | ------- | ----------- |
| Named table content preview (`SAPRead(type=TABLE_CONTENTS)`) | `SAP_ALLOW_DATA_PREVIEW=true` | `false` (off) | Can expose application-table data; keep off unless the use case is approved. |
| Freestyle ABAP SQL (`SAPQuery`) | `SAP_ALLOW_FREE_SQL=true` | `false` (off) | Executes ad-hoc ABAP SQL; keep off unless the use case is approved. |

With both flags at their defaults, ARC-1's data/sql rows are unreachable. Turning either flag on is a valid operational choice for approved scenarios, but it should be deliberate: check the current SAP API Policy, the customer's SAP agreement, SAP authorizations, and internal data-protection rules before enabling it on a productive system.

Beyond the policy, the public signals for ADT remain consistent: SAP publishes an [ADT SDK](https://tools.hana.ondemand.com/#abap), a guide for [creating and consuming RESTful APIs in ADT](https://www.sap.com/documents/2013/04/12289ce1-527c-0010-82c7-eda71af511fa.html), and has described the ABAP language server direction as an ["ADT SDK 2.0"](https://community.sap.com/t5/technology-blog-posts-by-sap/abap-development-tools-for-vs-code-everything-you-need-to-know/bc-p/14263439/highlight/true#M186133).

ARC-1's strategy is to stay close to documented and discoverable ADT behavior, probe system capabilities before exposing tools, keep conservative security defaults (writes off, data preview off, free SQL off, package allowlist `$TMP`), and continuously review SAP's guidance as it evolves. This README is not a compliance decision for any specific customer landscape, but the default posture is intended to support normal governed development use rather than block it.

## Quick Start

**Install in Claude** — pick your surface (full guide: [Install in Claude](https://docs.arc-1-mcp.com/install-in-claude/)):

- **Claude Desktop** — download the latest `arc-1-*.mcpb` from [Releases](https://github.com/arc-mcp/arc-1/releases) and double-click it (or Settings → Extensions). Claude prompts for your SAP connection. (The `.mcpb` is attached to releases automatically; if the newest one doesn't have it yet, see [Install in Claude](https://docs.arc-1-mcp.com/install-in-claude/).)
- **Claude Code** — one install for the MCP server **and** all [SAP skills](https://github.com/arc-mcp/arc-1/tree/main/skills):

  ```text
  /plugin marketplace add arc-mcp/arc-1
  /plugin install arc-1@arc-1
  ```

- **Any MCP client / manual** — run it directly:

  ```bash
  npx arc-1@latest --url https://your-sap-host:44300 --user YOUR_USER
  ```

- **Trying it out on your laptop?** → [Quickstart](https://docs.arc-1-mcp.com/quickstart/)
- **Full local dev setup (Docker, cookie extractor, client configs)?** → [Local Development](https://docs.arc-1-mcp.com/local-development/)
- **Deploying for a team / BTP?** → [Deployment](https://docs.arc-1-mcp.com/deployment/)

## Blog Series — AI ABAP Development

A long-form series on [blog.zeis.de](https://blog.zeis.de/tags/ai-abap-development-series/) covering AI for ABAP development, ARC-1's design, and real-world walkthroughs:

1. [How I Use AI for Development and Why Context Matters](https://blog.zeis.de/posts/2026-04-20-how-i-use-ai/)
2. [ABAP and Agentic AI: The Hidden Problem in Real Projects](https://blog.zeis.de/posts/2026-04-22-ai-abap-development/)
3. [Introducing ARC-1: A Secure ADT MCP Server for Enterprise SAP Development](https://blog.zeis.de/posts/2026-04-27-arc-1/)
4. [ARC-1 on SAP BTP: Secure ABAP Agentic Development Beyond the Laptop](https://blog.zeis.de/posts/2026-04-29-arc-1-btp/)
5. [ARC-1 with Copilot Studio: SAP System Context Beyond Developers](https://blog.zeis.de/posts/2026-05-05-arc-1-copilot-studio/)
6. [ARC-1 with Joule Studio: Bringing Real ABAP System Context into Joule](https://blog.zeis.de/posts/2026-05-08-arc-1-joule-studio-clean-core/)
7. [From SEGW and Legacy UI5 to RAP with ARC-1](https://blog.zeis.de/posts/2026-05-11-segw-to-rap/)

Full list and new posts → **[blog.zeis.de/tags/ai-abap-development-series](https://blog.zeis.de/tags/ai-abap-development-series/)**.

## Documentation

Full documentation is available at **[docs.arc-1-mcp.com](https://docs.arc-1-mcp.com/)**.

| Guide | Description |
|-------|-------------|
| [Quickstart](https://docs.arc-1-mcp.com/quickstart/) | 5-minute npx + Claude Desktop setup |
| [Install in Claude](https://docs.arc-1-mcp.com/install-in-claude/) | Desktop `.mcpb`, Claude Code plugin (server + skills), and remote BTP connector |
| [Local Development](https://docs.arc-1-mcp.com/local-development/) | Full local dev — all install methods, MCP client configs, SSO cookie extractor |
| [Deployment](https://docs.arc-1-mcp.com/deployment/) | Multi-user deployment — Docker, BTP Cloud Foundry, BTP ABAP |
| [Configuration](https://docs.arc-1-mcp.com/configuration-reference/) | Every flag and env var, one table |
| [Updating](https://docs.arc-1-mcp.com/updating/) | Update procedures per install method |
| [Enterprise Auth](https://docs.arc-1-mcp.com/enterprise-auth/) | Layer A / Layer B auth internals, coexistence matrix |
| [Tool Reference](https://docs.arc-1-mcp.com/tools/) | Complete reference for all 12 tools |
| [Extensions (Custom Tools)](https://docs.arc-1-mcp.com/extensions/) | Add your own `Custom_*` tools without forking (FEAT-61) — reads, gated non-ADT writes, console-class execute |
| [Architecture](https://docs.arc-1-mcp.com/architecture/) | System architecture with diagrams |
| [AI Usage Patterns](https://docs.arc-1-mcp.com/mcp-usage/) | Agent workflow patterns and best practices |
| [Blog Series](https://docs.arc-1-mcp.com/blog-series/) | Long-form posts on AI for ABAP development, ARC-1 internals, and real-world walkthroughs |

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
