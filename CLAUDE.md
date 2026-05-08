# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ARC-1** is a TypeScript MCP (Model Context Protocol) server for SAP ABAP Development Tools (ADT). It provides 12 intent-based tools (SAPRead, SAPSearch, SAPWrite, SAPActivate, SAPNavigate, SAPQuery, SAPTransport, SAPGit, SAPContext, SAPLint, SAPDiagnose, SAPManage) for use with Claude and other MCP-compatible LLMs.

Distributed as an npm package (`arc-1`) and Docker image (`ghcr.io/marianfoo/arc-1`).

## Design Principles

1. **Centralized admin control** — Runs as a managed service, not on developer laptops. Admins configure a server-wide safety ceiling (`allowWrites`, package allowlists, SQL/data/transport/Git gates, deny actions) per instance. Every tool call is audited with user identity. Per-user JWT scopes can restrict further but never expand beyond server config.

2. **Per-user SAP identity** — Principal propagation maps each MCP user to their own SAP user via BTP Destination Service + Cloud Connector. SAP's native authorization (S_DEVELOP, package checks) applies per user. No shared service accounts.

3. **Token-efficient tool design** — 12 intent-based tools (~5K schema tokens) instead of 200+ endpoints. Hyperfocused mode: 1 tool (~200 tokens). Method-level surgery (95% reduction) and context compression (7-30x) keep responses within tight context windows. This is the difference between working and not working on mid-tier LLMs (GPT-4o-mini, Copilot Studio).

4. **BTP-native deployment** — First-class BTP CF support: Destination Service, Cloud Connector, XSUAA OAuth, BTP Audit Log Service. Also deployable as Docker or npm. Local stdio mode for development.

5. **Multi-client, vendor-neutral** — Standard MCP protocol. Three auth modes coexist: XSUAA OAuth + Entra ID OIDC + API key. Same instance serves Claude, Copilot Studio, VS Code Copilot, Gemini CLI, Cursor.

6. **Safe defaults, opt-in power** — Read-only by default. Free SQL blocked. Package allowlist defaults to `$TMP`. Writing to transportable packages requires explicit config. Everything forbidden until the admin allows it.

## Quick Reference

### Build & Test

```bash
npm ci                          # Install dependencies
npm run build                   # TypeScript → dist/ (also copies AFF schemas)
npm test                        # Unit tests (all)
npm run test:watch              # Unit tests (watch mode)
npx vitest run tests/unit/adt/client.test.ts   # Run a single test file
npx vitest run -t "getProgram"  # Run tests matching a name pattern
npm run typecheck               # Type check (tsc --noEmit)
npm run lint                    # Lint (biome check)
npm run lint:fix                # Lint + auto-fix (biome check --write)
npm run format                  # Format (biome format --write)
npm run dev                     # Dev mode (stdio)
npm run dev:http                # Dev mode (HTTP Streamable)
npm run test:integration        # Integration tests (needs SAP credentials)
npm run test:integration:crud   # CRUD lifecycle tests (needs SAP credentials)
npm run test:e2e                # E2E tests (syncs fixtures first, needs running MCP server)
# BTP tests (local only — needs service key + browser login):
TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json npm run test:integration:btp
TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json npm run test:integration:btp:smoke
```

### Pre-commit Hook

Husky runs `lint-staged` on commit, which auto-fixes lint/format via Biome on staged `*.{ts,js,json}` files.

### Configuration (Priority: CLI > Env > .env > Defaults)

```bash
# Using environment variables
SAP_URL=http://host:50000 SAP_USER=user SAP_PASSWORD=pass npm run dev

# Using .env file (copy .env.example to .env)
npm run dev
```

Copy `.env.example` to `.env` for local development. All config options are defined in `src/server/config.ts` (parser) and `src/server/types.ts` (ServerConfig type with defaults).

| Variable / Flag | Description |
|-----------------|-------------|
| `SAP_URL` / `--url` | SAP system URL (e.g., `http://host:50000`) |
| `SAP_USER` / `--user` | SAP username |
| `SAP_PASSWORD` / `--password` | SAP password |
| `SAP_CLIENT` / `--client` | SAP client number (default: 100) |
| `SAP_LANGUAGE` / `--language` | SAP language (default: EN) |
| `SAP_INSECURE` / `--insecure` | Skip TLS verification (default: false) |
| `SAP_TRANSPORT` / `--transport` | MCP transport: `stdio` (default) or `http-streamable` |
| `ARC1_PORT` / `--port` | HTTP server port (default: `8080`). Simpler alternative to `ARC1_HTTP_ADDR` when only the port needs to change |
| `ARC1_HTTP_ADDR` / `--http-addr` | HTTP server bind address (default: `0.0.0.0:8080`). Use when you need to change both host and port |
| `SAP_ALLOW_WRITES` / `--allow-writes` | Enable object mutations (create/update/delete/activate/FLP/package mgmt). Default: `false` (restrictive). Also required for transport/git writes. |
| `SAP_ALLOW_DATA_PREVIEW` / `--allow-data-preview` | Enable named table content preview (`SAPRead(type=TABLE_CONTENTS)`). Default: `false`. |
| `SAP_ALLOW_FREE_SQL` / `--allow-free-sql` | Enable freestyle SQL (`SAPQuery`). Default: `false`. |
| `SAP_ALLOW_TRANSPORT_WRITES` / `--allow-transport-writes` | Enable transport mutations (`SAPTransport.create`/`release`/`delete`). Default: `false`. **Also requires** `SAP_ALLOW_WRITES=true`. |
| `SAP_ALLOW_GIT_WRITES` / `--allow-git-writes` | Enable git mutations (`SAPGit.clone`/`pull`/`push`). Default: `false`. **Also requires** `SAP_ALLOW_WRITES=true`. |
| `SAP_ALLOWED_PACKAGES` / `--allowed-packages` | Restrict write operations to packages (default: `$TMP`; supports wildcards: `Z*`). `*` = any. Reads are never package-gated. |
| `SAP_DENY_ACTIONS` / `--deny-actions` | Fine-grained per-action denial. Grammar: `Tool`, `Tool.action`, `Tool.glob*` (tool-qualified only). Inline CSV or file path. Fails fast on invalid input. See [authorization.md](docs_page/authorization.md#advanced-deny-actions). |
| `ARC1_API_KEYS` / `--api-keys` | Multiple API keys with profiles (`key1:viewer,key2:developer`). Valid profiles: `viewer`, `viewer-data`, `viewer-sql`, `developer`, `developer-data`, `developer-sql`, `admin`. Each profile maps to a scope set AND a partial SafetyConfig intersected with the server ceiling. Single `ARC1_API_KEY` was removed in v0.7. |
| `SAP_OIDC_ISSUER` / `--oidc-issuer` | OIDC issuer URL for JWT validation |
| `SAP_OIDC_AUDIENCE` / `--oidc-audience` | OIDC audience for JWT validation |
| `ARC1_OAUTH_DCR_TTL_SECONDS` / `--oauth-dcr-ttl-seconds` | Lifetime of an OAuth Dynamic Client Registration `client_id` in seconds. Default: `2592000` (30 days). Min `60`, max `7776000` (90 days). Only consulted when `SAP_XSUAA_AUTH=true`. Lower values bound the blast radius if the signing key leaks; higher reduces re-auth churn. |
| `ARC1_ALLOWED_ORIGINS` / `--allowed-origins` | Comma-separated CORS allowlist for **browser-based** MCP clients. Empty (default) = CORS disabled. Native MCP clients (Claude Desktop / Cursor / VS Code Copilot / Copilot Studio) don't need this — they use native HTTP, not the browser fetch API. Pairs with `credentials: true`, so origins are exact-match only (no wildcards). |
| `ARC1_PUBLIC_URL` | Public URL ARC-1 advertises in OAuth metadata (issuer, authorize / token / register / revoke endpoints, protected-resource metadata, and `WWW-Authenticate` `resource_metadata` URL). Set this when ARC-1 is reached through a reverse proxy on a different hostname or under a base-path prefix than the bound CF route — without it, MCP clients receive metadata pointing at `VCAP_APPLICATION.application_uris[0]` and bypass the proxy. Optional path prefix is supported (e.g. `https://gateway.example.com/arc1`); leave the path off for a root-mounted proxy. Trailing slash is stripped. Defaults to the CF route from `VCAP_APPLICATION`, then to `http://<bind-host>:<port>`. |
| `SAP_BTP_SERVICE_KEY` / `--btp-service-key` | BTP ABAP service key JSON (direct connection) |
| `SAP_BTP_SERVICE_KEY_FILE` / `--btp-service-key-file` | Path to BTP ABAP service key file |
| `SAP_BTP_OAUTH_CALLBACK_PORT` / `--btp-oauth-callback-port` | OAuth browser callback port (default: auto) |
| `SAP_SYSTEM_TYPE` / `--system-type` | System type: `auto` (default), `btp`, or `onprem` |
| `ARC1_TOOL_MODE` / `--tool-mode` | Tool mode: `standard` (12 tools, `SAPGit` feature-gated) or `hyperfocused` (1 universal SAP tool, ~200 tokens) |
| `SAP_ABAPLINT_CONFIG` / `--abaplint-config` | Path to custom abaplint.jsonc config file for lint rules |
| `SAP_LINT_BEFORE_WRITE` / `--lint-before-write` | Enable pre-write lint validation (default: true) |
| `SAP_CHECK_BEFORE_WRITE` / `--check-before-write` | Opt-in: pre-write SAP-side syntax check via ADT checkruns with inline content (default: **false**). When enabled, errors/warnings from the proposed source are **appended to the write response** (non-blocking). Off by default because it adds a round-trip per write and, during multi-file edits, surfaces dependency-related errors that self-resolve once later files land. Activation remains the definitive check. |
| `ARC1_CACHE` / `--cache` | Cache mode: `auto` (default), `memory`, `sqlite`, `none` |
| `ARC1_CACHE_FILE` / `--cache-file` | SQLite cache file path (default: `.arc1-cache.db`) |
| `ARC1_CACHE_WARMUP` / `--cache-warmup` | Pre-warm cache on startup via TADIR scan (default: false) |
| `ARC1_CACHE_WARMUP_PACKAGES` / `--cache-warmup-packages` | Package filter for warmup (e.g., "Z*,Y*") |
| `ARC1_MAX_CONCURRENT` / `--max-concurrent` | Max concurrent SAP HTTP requests (default: `10`). Prevents work process exhaustion |
| `SAP_BTP_DESTINATION` | BTP Destination name (overrides URL/user/password) |
| `SAP_BTP_PP_DESTINATION` | BTP PP Destination name (PrincipalPropagation type) |
| `SAP_PP_ENABLED` / `--pp-enabled` | Enable per-user principal propagation (default: false) |
| `SAP_PP_STRICT` / `--pp-strict` | PP failure = error, no fallback to shared client (default: false) |
| `SAP_PP_ALLOW_SHARED_COOKIES` / `--pp-allow-shared-cookies` | Opt-in escape hatch allowing `SAP_COOKIE_FILE`/`SAP_COOKIE_STRING` to coexist with `SAP_PP_ENABLED`. Cookies stay on shared client only. (default: false) |
| `SAP_DISABLE_SAML` / `--disable-saml` | Opt-in: disable SAML redirect via `X-SAP-SAML2: disabled` + `?saml2=disabled`. Do NOT use on BTP ABAP or S/4 Public Cloud. (default: false) |
| `ARC1_PROFILE` / `--profile` | Safety profile shortcut: `viewer`, `viewer-data`, `viewer-sql`, `developer`, `developer-data`, `developer-sql` |
| `ARC1_LOG_HTTP_DEBUG` | Opt-in: attach full request/response bodies and headers to `http_request` audit events (default: false). Sensitive headers redacted, bodies truncated at 64KB. Not for production. |

## Codebase Structure

```
src/
├── index.ts                    # MCP server entry (bin: arc1)
├── cli.ts, cli-args.ts         # CLI entry (bin: arc1-cli) — `call`, `tools`, `read`, `activate`, ...
├── extract-sap-cookies.ts      # Cookie helper invoked via `arc1-cli extract-cookies`
├── server/
│   ├── server.ts               # MCP server setup, tool registration
│   ├── config.ts               # Config parser (CLI > env > .env > defaults)
│   ├── http.ts                 # HTTP Streamable transport + API key/OIDC auth
│   ├── logger.ts               # Structured logger (stderr only, never stdout)
│   ├── types.ts                # ServerConfig type, defaults
│   ├── audit.ts                # Audit logging (tool calls, elicitation events)
│   ├── context.ts, elicit.ts   # MCP context helpers, elicitation
│   ├── xsuaa.ts                # XSUAA JWT validation for BTP
│   ├── stateless-client-store.ts # OAuth DCR store (HMAC-signed client_ids, restart-resilient)
│   └── sinks/                  # Audit sinks: stderr, file, btp-auditlog
├── handlers/
│   ├── intent.ts               # 12 intent-based tool router (handleToolCall)
│   ├── tools.ts                # Tool definitions (names, descriptions, JSON schemas)
│   ├── schemas.ts              # Zod v4 input schemas (runtime validation)
│   ├── zod-errors.ts           # Zod error formatting for LLM clients
│   └── hyperfocused.ts         # Hyperfocused mode (single SAP tool, ~200 tokens)
├── adt/
│   ├── client.ts               # ADT client facade (all read operations)
│   ├── http.ts                 # HTTP transport (undici/fetch, CSRF, cookies, sessions)
│   ├── discovery.ts            # ADT discovery (endpoint MIME map fetch + resolve)
│   ├── errors.ts               # Typed errors (AdtApiError, AdtSafetyError, AdtNetworkError)
│   ├── safety.ts               # Safety system (positive opt-ins, package gates, deny actions)
│   ├── features.ts             # Feature detection (auto/on/off)
│   ├── config.ts, types.ts     # ADT client config + response types
│   ├── xml-parser.ts           # XML parser (fast-xml-parser v5)
│   ├── btp.ts                  # BTP Destination Service + Connectivity proxy
│   ├── cookies.ts, oauth.ts    # Cookie parsing, OAuth 2.0 for BTP ABAP
│   ├── crud.ts                 # CRUD operations (lock, create, update, delete)
│   ├── ddic-xml.ts             # Metadata XML builders (DOMA/DTEL/MSAG/DEVC/SRVB create/update payloads)
│   ├── devtools.ts             # Syntax check, activate, publish SRVB, unit tests
│   ├── diagnostics.ts          # Short dumps (ST22), ABAP profiler traces
│   ├── codeintel.ts            # Find def, refs, where-used, completion
│   ├── gcts.ts                 # gCTS Git backend client (/sap/bc/cts_abapvcs/*, JSON)
│   ├── abapgit.ts              # abapGit ADT bridge client (/sap/bc/adt/abapgit/*, XML/HATEOAS)
│   ├── cds-impact.ts           # CDS downstream impact classifier (RAP-oriented buckets)
│   ├── rap-preflight.ts        # Deterministic RAP static-rule validator (TABL/BDEF/DDLX/DDLS)
│   ├── rap-handlers.ts         # RAP handler signature/stub extraction, matching, and injection helpers
│   ├── ui5-repository.ts       # UI5 ABAP Repository OData client
│   ├── flp.ts                  # FLP PAGE_BUILDER_CUST OData client
│   └── transport.ts            # CTS transport management
├── context/
│   ├── deps.ts, cds-deps.ts    # AST-based dependency extraction
│   ├── contract.ts             # Public API contract extraction
│   ├── compressor.ts           # Orchestrator (fetch + compress + format)
│   └── method-surgery.ts       # Method-level extraction and surgical replacement
├── cache/
│   ├── cache.ts, memory.ts     # Cache interface + in-memory impl
│   ├── sqlite.ts               # SQLite cache (default for http-streamable)
│   ├── inactive-list-cache.ts   # Per-user inactive draft list cache
│   ├── caching-layer.ts        # Source + dep caching, ETag revalidation, invalidation
│   └── warmup.ts               # Pre-warmer: TADIR scan, bulk fetch
├── aff/
│   ├── validator.ts            # AFF JSON schema validator (Ajv 2020-12)
│   └── schemas/                # Bundled AFF schemas: clas, intf, prog, ddls, bdef, srvd, srvb
└── lint/
    ├── lint.ts                 # ABAP lint wrapper (@abaplint/core)
    ├── config-builder.ts       # System-aware config builder (cloud/onprem)
    └── presets/                # cloud.ts (strict), onprem.ts (relaxed)

scripts/ci/                     # collect-test-reliability, assert-required-test-execution, coverage-summary

tests/
├── helpers/                    # mock-fetch.ts, skip-policy.ts, expected-error.ts
├── unit/                       # adt/, cache/, context/, handlers/, server/, lint/, aff/, cli/
├── integration/                # helpers.ts, crud-harness.ts, adt/btp-abap/crud/elicitation tests
├── e2e/                        # fixtures.ts, setup.ts, helpers.ts, *.e2e.test.ts
└── fixtures/                   # xml/, abap/, test-results/, coverage/
```

## Key Files for Common Tasks

| Task | Files |
|------|-------|
| Add new read operation | `src/adt/client.ts`, `src/handlers/intent.ts`, `src/handlers/tools.ts` (for structured format, also `src/adt/xml-parser.ts`, `src/adt/types.ts`) |
| Add new ADT slash alias to `SLASH_TYPE_MAP` | `src/handlers/intent.ts` (`SLASH_TYPE_MAP` + `SLASH_TYPE_EVIDENCE` + `KNOWN_BASE_TYPES` if introducing a new canonical type), `tests/unit/handlers/slash-type-map.test.ts` (citation guard asserts the two map keysets are equal AND every cited path exists). Adding a `SLASH_TYPE_MAP` entry without a matching `SLASH_TYPE_EVIDENCE` entry pointing at an existing `research/abap-types/types/<short>.md` file fails the guard. Verify the slash code against Eclipse `com.sap.adt.core.apidoc-3.58.1` AND a live `<adtcore:type>` response from a real SAP system before adding. `objectBasePath` throws for any slash-form input that reaches it (last-resort fence for non-enum-typed tools like `SAPNavigate`/`SAPActivate`/`SAPDiagnose`/`SAPTransport`). See PR #222 (audit research) and PR #223 (Plan A implementation, issue #218). |
| Add AUTH/FEATURE_TOGGLE/ENHO read (read-only DDIC metadata; deprecated alias `FTG2` accepted with warning) | `src/adt/client.ts`, `src/adt/xml-parser.ts`, `src/adt/types.ts`, `src/handlers/intent.ts`, `src/handlers/schemas.ts`, `src/handlers/tools.ts` |
| Read message classes via `MSAG` (canonical short type added in audit Plan B; `MESSAGES` deprecated alias) | `src/handlers/intent.ts` (case 'MSAG'/'MESSAGES'), `src/handlers/schemas.ts`, `src/handlers/tools.ts`, `src/adt/client.ts` (`getMessageClassInfo`) |
| Add source revision history read (VERSIONS / VERSION_SOURCE) | `src/adt/client.ts`, `src/adt/xml-parser.ts`, `src/adt/types.ts`, `src/handlers/intent.ts`, `src/handlers/schemas.ts`, `src/handlers/tools.ts` |
| Add DCL (access control) read/write | `src/adt/client.ts`, `src/handlers/intent.ts`, `src/handlers/schemas.ts`, `src/handlers/tools.ts` |
| Add fix proposal / quickfix operation | `src/adt/devtools.ts`, `src/handlers/intent.ts`, `src/handlers/tools.ts`, `src/handlers/schemas.ts`, `tests/unit/adt/devtools.test.ts` |
| Add OData-based read (non-ADT) | `src/adt/ui5-repository.ts`, `src/handlers/intent.ts`, `src/handlers/tools.ts`, `src/handlers/schemas.ts` |
| Add FLP operation | `src/adt/flp.ts`, `src/handlers/intent.ts`, `src/handlers/tools.ts`, `src/handlers/schemas.ts` |
| Add package create/delete/move (DEVC) | `src/handlers/intent.ts` (`handleSAPManage`), `src/handlers/tools.ts`, `src/handlers/schemas.ts`, `src/adt/ddic-xml.ts`, `src/adt/refactoring.ts` |
| Add object transport history (reverse lookup) | `src/adt/transport.ts` (`getObjectTransports`), `src/adt/types.ts` (`ObjectTransportHistory`), `src/handlers/intent.ts` (`handleSAPTransport` case `history`), `src/handlers/schemas.ts`, `src/handlers/tools.ts` |
| Add gCTS / abapGit operation | `src/adt/gcts.ts` or `src/adt/abapgit.ts`, `src/handlers/intent.ts` (`handleSAPGit`), `src/handlers/tools.ts`, `src/handlers/schemas.ts` |
| Add RAP deterministic preflight checks | `src/adt/rap-preflight.ts`, `src/handlers/intent.ts` (`runRapPreflightValidation`), `src/handlers/tools.ts`, `src/handlers/schemas.ts`, `tests/unit/adt/rap-preflight.test.ts` |
| Add RAP behavior handler scaffolding logic | `src/adt/rap-handlers.ts`, `src/handlers/intent.ts` (`SAPWrite action=scaffold_rap_handlers`), `src/handlers/tools.ts`, `src/handlers/schemas.ts`, `tests/unit/adt/rap-handlers.test.ts` |
| Add new tool type | `src/handlers/tools.ts`, `src/handlers/schemas.ts`, `src/handlers/intent.ts` |
| Add/modify tool input schema | `src/handlers/schemas.ts`, `src/handlers/tools.ts` |
| Add DDIC domain/data element write | `src/adt/ddic-xml.ts`, `src/adt/crud.ts`, `src/handlers/intent.ts` |
| Modify ADT service discovery / MIME types | `src/adt/discovery.ts`, `src/adt/http.ts` |
| Improve DDIC save diagnostics + SAP-domain error hints (T100/line + lock/auth/dependency hints) | `src/adt/errors.ts` (`extractDdicDiagnostics`, `formatDdicDiagnostics`, `classifySapDomainError`), `src/handlers/intent.ts` (`enrichWithSapDetails`, `formatErrorForLLM`) |
| Add SAP error classification (new `category` + hint) | `src/adt/errors.ts` (`extractExceptionType`, `extractLockOwner`, `classifySapDomainError`, `SapErrorClassification`), `src/handlers/intent.ts` (`formatErrorForLLM`, `classifyError`), `tests/unit/adt/errors.test.ts`. Current categories: `lock-conflict`, `enqueue-error`, `authorization`, `activation-dependency`, `transport-issue`, `object-exists`, `method-not-supported`, `icf-handler-not-bound`. Ground hints in verified SAP Notes / KBAs when possible (use `mcp__sap-notes__search` or equivalent) — don't ship speculative tcode pointers. |
| Add release-gated content-type fallback (e.g. DTEL v2→v1 on 415) | `src/adt/crud.ts` (`CONTENT_TYPE_FALLBACKS` map — narrow static allowlist, 415-only retry in both `createObject` and `updateObject`), `tests/unit/adt/crud.test.ts`. Don't turn it into a generic retry loop — each entry must be a specific, tested compatibility gap. |
| Add / update test skip reason (integration or E2E) | `tests/helpers/skip-policy.ts` (`SkipReason` constants + `requireOrSkip`), `tests/e2e/helpers.ts` (`classifyToolErrorSkip` for MCP tool errors), `docs/integration-test-skips.md` (user-facing taxonomy — update the relevant category), `scripts/ci/summarize-skips.mjs` (regex patterns that group skips — extend when adding a new message shape). Every skip message is the public API of the taxonomy — changing wording means updating all four. |
| Run ADT type-availability probe against a live system (diagnostic; no product behavior) | `scripts/probe-adt-types.ts` (CLI entry: `npm run probe`), `src/probe/catalog.ts` (per-type collection URL + known-object fixtures), `src/probe/runner.ts` (multi-signal classifier), `src/probe/fixtures.ts` (record/replay), `tests/unit/probe/replay.test.ts` (fixture-backed unit tests). Contribute new fixture sets via `npm run probe -- --save-fixtures tests/fixtures/probe/<name>`. See [docs/probe-adt-types.md](docs/probe-adt-types.md). |
| Add CDS impact classifier / extend downstream grouping | `src/adt/cds-impact.ts`, `src/adt/codeintel.ts` (`findWhereUsed`), `tests/unit/adt/cds-impact.test.ts` |
| Add inactive syntax-check support | `src/adt/devtools.ts` (`syntaxCheck` options.version), `src/handlers/intent.ts` (`tryPostSaveSyntaxCheck`) |
| Add method-level surgery | `src/context/method-surgery.ts` |
| Modify hyperfocused mode | `src/handlers/hyperfocused.ts`, `src/handlers/tools.ts` |
| Add XML response parser | `src/adt/xml-parser.ts` |
| Add safety check | `src/adt/safety.ts` |
| Add/modify PrettyPrint action | `src/adt/devtools.ts`, `src/handlers/intent.ts` (handleSAPLint), `src/handlers/tools.ts`, `src/handlers/schemas.ts` |
| Add lint rule config | `src/lint/lint.ts`, `src/lint/config-builder.ts`, `src/lint/presets/` |
| Add dependency pattern | `src/context/deps.ts` |
| Add CDS dependency pattern | `src/context/cds-deps.ts` |
| Add contract extraction for new type | `src/context/contract.ts` |
| Modify context output format | `src/context/compressor.ts` |
| Add runtime diagnostic | `src/adt/diagnostics.ts`, `src/handlers/intent.ts` |
| Add audit logging | `src/server/audit.ts`, `src/server/sinks/` |
| Add audit event type | `src/server/audit.ts` (typed `*Event` interface + `AuditEvent` union); emit via `logger.emitAudit({...})` from the call site (e.g. `confirmPreaudit` in `src/adt/devtools.ts`) |
| Add/modify Dependabot config | `.github/dependabot.yml` (three ecosystems: npm + github-actions + docker; weekly Mondays 06:00 Europe/Berlin; grouping rules for dev-deps / @types / SAP SDK / MCP SDK / Biome; ignore rules for `@types/node` major and Docker `node` major — manually bumped on the LTS cadence) |
| Add/modify npm audit / SAST / dep review CI gate | `.github/workflows/test.yml` (`Security audit (npm audit)` step, `--audit-level=high`); `.github/workflows/dependency-review.yml` (PR-time `actions/dependency-review-action@v4` with license allow/deny lists) |
| Add/modify container scanning | `.github/workflows/docker.yml` (Trivy non-gating, `exit-code: 0`); `.github/workflows/release.yml` (Trivy gating, `exit-code: 1`); both upload SARIF to GitHub Security tab via `github/codeql-action/upload-sarif@v4` |
| Pin a third-party GitHub Action | Replace `uses: <owner>/<action>@<tag>` with `uses: <owner>/<action>@<40-char-sha>  # <tag>` (trailing comment lets Dependabot bump SHA + tag together). GitHub-owned `actions/*` and `github/*` are tag-pinned by design — only third-party actions (currently `googleapis/release-please-action`, `docker/*`, `aquasecurity/trivy-action`) get SHA pinning. |
| Update vulnerability reporting policy | `SECURITY.md` (Supported Versions, Reporting channels, Response SLAs, CVE handling, Out of Scope, Safe Harbor) |
| Add CLI sub-command (`call`, `tools`, shortcuts) | `src/cli.ts` (Commander wiring), `src/cli-args.ts` (pure arg parsing helpers + tests in `tests/unit/cli/cli-args.test.ts`) — never duplicate Zod validation; `handleToolCall` does it |
| Add SAP version-quirk workaround (NW 7.50 / S/4 gating) | Prefer body-marker self-gating (e.g. `"Logon Error Message"` in `src/adt/crud.ts` `lockObject` and `src/adt/devtools.ts` `rethrowOrLockHint`) when the marker is unique to the affected release. Always inline-comment WHY the heuristic self-scopes so future readers don't hunt for a `detectSystemCapabilities()` call. |
| Add elicitation prompt | `src/server/elicit.ts` |
| Add XSUAA/JWT auth | `src/server/xsuaa.ts` |
| Modify OAuth DCR client store / signed-token format | `src/server/stateless-client-store.ts` (HMAC sign/verify, payload schema, TTL); `src/server/xsuaa.ts` (`createXsuaaOAuthProvider` wires `dcrTtlSeconds`); `src/server/http.ts` (passes `config.oauthDcrTtlSeconds`); `tests/unit/server/stateless-client-store.test.ts`. Bumping `KDF_LABEL` (`arc1-dcr/v1` → `v2`) is the in-code revocation knob; `cf bind-service` rotates the upstream secret. Emits audit events `oauth_client_registered` / `oauth_client_lookup_failed` / `oauth_redirect_uri_registered`. |
| Modify scope enforcement | `src/authz/policy.ts` (`ACTION_POLICY`), `src/handlers/intent.ts` (runtime check), `src/server/server.ts` (tool listing filter) |
| Modify OIDC token handling | `src/server/http.ts` (validateOidcToken, ~line 274) |
| Add/modify auth scopes | `xs-security.json`, `src/server/xsuaa.ts`, `src/server/http.ts`, `src/handlers/intent.ts` |
| Add / modify auth combination rule | `src/server/config.ts` (validateConfig at ~line 305), `src/server/types.ts` (ServerConfig), `tests/unit/server/config.test.ts`, `docs/enterprise-auth.md` (Coexistence Matrix) |
| Add Layer B auth mechanism | `src/adt/http.ts` (applyAuthHeader at ~line 830, fetchCsrfToken at ~line 669), `src/server/server.ts` (buildAdtConfig — perUser flag), `tests/unit/adt/http.test.ts` |
| Add safety config option | `src/adt/safety.ts`, `src/server/config.ts`, `src/server/types.ts` |
| Add feature probe | `src/adt/features.ts` (`PROBES` array — single endpoint per feature; HTTP-status classification handled centrally by `classifyFeatureProbeStatus`: 2xx/400/405/5xx → available, 401/403/404 → unavailable with diagnostic reason. Surface the reason via `FeatureStatus.message`.) |
| Add feature-gated write guard | `src/handlers/intent.ts` (checkRapAvailable pattern), `src/adt/features.ts` |
| Add E2E test | `tests/e2e/`, helpers in `tests/e2e/helpers.ts`, fixtures in `tests/e2e/fixtures.ts` |
| Add/modify E2E fixture | `tests/e2e/fixtures.ts` (define object), `tests/fixtures/abap/` (source file), `tests/e2e/setup.ts` (sync logic) |
| Modify source caching / ETag revalidation | `src/cache/caching-layer.ts`, `src/cache/cache.ts`, `src/cache/memory.ts`, `src/cache/sqlite.ts`, `src/adt/client.ts` |
| Modify inactive-draft source awareness | `src/cache/inactive-list-cache.ts`, `src/handlers/intent.ts`, `src/adt/client.ts`, `src/adt/xml-parser.ts`, `src/adt/types.ts` |
| Add cache warmup feature | `src/cache/warmup.ts`, `src/server/server.ts` |
| Add integration test | `tests/integration/adt.integration.test.ts` |
| Add BTP ABAP integration test | `tests/integration/btp-abap.integration.test.ts` |
| Add BTP smoke test | `tests/integration/btp-abap.smoke.integration.test.ts` |
| BTP ABAP Environment auth | `src/adt/oauth.ts`, `src/server/server.ts` |
| BTP Destination Service / Connectivity proxy | `src/adt/btp.ts` |
| Add AFF schema | `src/aff/schemas/` (add `{type}-v1.json`), `src/aff/validator.ts` (add type mapping) |
| Modify AFF validation | `src/aff/validator.ts`, `src/handlers/intent.ts` (create/batch_create paths) |
| Add skip policy test | `tests/helpers/skip-policy.ts` |
| Add expected error assertion | `tests/helpers/expected-error.ts` |
| Add CRUD integration test | `tests/integration/crud-harness.ts`, `tests/integration/crud.lifecycle.integration.test.ts` |
| Modify CI coverage reporting | `scripts/ci/coverage-summary.mjs`, `.github/workflows/test.yml`, `.github/workflows/release.yml` |
| Modify CI reliability reporting | `scripts/ci/collect-test-reliability.mjs`, `scripts/ci/assert-required-test-execution.mjs`, `.github/workflows/test.yml` |

## Architecture: Request Flow

Understanding how a request flows through the system is essential for working on any part of ARC-1:

```
MCP Client (Claude Desktop, Cursor, Copilot Studio)
  │
  ▼
MCP Transport (stdio or HTTP Streamable)
  │
  ├─ stdio: no auth, safety config is the only gate
  │
  ├─ HTTP: auth layer (server/http.ts)
  │   ├─ XSUAA OAuth (xsuaa.ts) → checkLocalScope() → AuthInfo { scopes, clientId, userName }
  │   ├─ OIDC JWT (http.ts) → jwtVerify() → AuthInfo { scopes }
  │   └─ API key (http.ts) → exact match in ARC1_API_KEYS → AuthInfo { scopes from profile }
  │
  ▼
Tool Call Handler (server/server.ts)
  │
  ├─ Per-user client? (PP: ppEnabled + JWT → BTP Destination → per-user SAP session)
  │
  ▼
handleToolCall (handlers/intent.ts)
  │
  ├─ 1. Scope check: ACTION_POLICY[tool/action-or-type] vs authInfo.scopes (only when authInfo present)
  ├─ 2. Zod validation: getToolSchema(toolName) → safeParse(args) (rejects invalid input with LLM-friendly errors)
  ├─ 3. Route to handler: handleSAPRead(), handleSAPWrite(), etc.
  ├─ 4. Package check: checkPackage(safety, packageName) (for all SAPWrite actions: create, update, delete, edit_method)
  ├─ SAPRead source path with cache:
  │   ├─ Inactive-list cache resolves draft warning / version="auto"
  │   ├─ Source cache key: (object type, name, active|inactive)
  │   └─ Cached source sends If-None-Match and returns cached body only after SAP 304
  │
  ▼
ADT Client Method (adt/client.ts, crud.ts, devtools.ts, etc.)
  │
  ├─ 5. Safety check: checkOperation(safety, OperationType.Read, 'GetProgram')
  │
  ▼
HTTP Request (adt/http.ts)
  │
  ├─ Proactive MIME negotiation via `/sap/bc/adt/discovery` map (startup-cached)
  ├─ ETag / If-None-Match conditional GET for cached source reads
  ├─ CSRF token management (auto-fetch via HEAD, refresh on 403)
  ├─ Content negotiation fallback (one-retry on 406/415 with header mutation)
  ├─ Cookie/session management
  ├─ Stateful sessions for lock→modify→unlock sequences
  │
  ▼
SAP ABAP System (ADT REST API)
  └─ SAP-level authorization (S_DEVELOP, S_ADT_RES, S_TRANSPRT, etc.)
```

**Key invariant:** Checks are additive — scope check AND safety check AND SAP auth must all pass. If any layer blocks, the operation fails.

## Authorization & Safety System

### Safety System (`src/adt/safety.ts`)

Server-level config, set at startup via env vars / CLI flags, applies to all users as the ceiling:
`allowWrites`, `allowDataPreview`, `allowFreeSQL`, `allowTransportWrites`, `allowGitWrites`,
`allowedPackages`, `allowedTransports`, and `denyActions`.

The internal `OperationType` enum is still used by code (`Read`, `Search`, `Query`, `FreeSQL`,
`Create`, `Update`, `Delete`, `Activate`, `Test`, `Lock`, `Intelligence`, `Workflow`,
`Transport`), but op-code env vars were removed. Admins use the high-level `allow*` flags plus
`SAP_DENY_ACTIONS`.

Mutating operations require `allowWrites=true`. Transport writes additionally require
`allowTransportWrites=true`; Git writes additionally require `allowGitWrites=true`.
All ADT endpoints must have `checkOperation()` guards.

### Scope Enforcement (`src/authz/policy.ts`, `src/handlers/intent.ts`)

`ACTION_POLICY` maps each `(tool, action/type)` to a required scope and operation type. It is the
single source of truth for runtime scope checks and tool-list pruning. Stdio has no user auth, so
only the server safety ceiling and SAP authorization apply.

Supported user scopes: `read`, `write`, `data`, `sql`, `transports`, `git`, `admin`.
`admin` implies all scopes; `write` implies `read`; `sql` implies `data`.

### Auth Providers (Chained)

In HTTP mode, `src/server/http.ts` and `src/server/xsuaa.ts` handle auth:
1. **XSUAA** (BTP): OAuth proxy, `checkLocalScope()` extracts read/write/data/sql/admin
2. **OIDC** (self-hosted): JWT verification via JWKS, scopes from `scope`/`scp` claim
3. **API key**: Exact match, full access

### Principal Propagation

When `ppEnabled=true`, the user's JWT is used to get a per-user SAP session via BTP Destination Service. SAP sees the real user identity → SAP-level auth applies per-user. ARC-1 scopes still enforced as defense-in-depth.

### Important: POST Needed for Read Operations

9+ "read" endpoints use HTTP POST: code intelligence (findDefinition, findWhereUsed, getCompletion), syntax check, unit tests, ATC, quickfix proposal evaluation/apply-delta, table preview. A read-only SAP user needs `S_ADT_RES ACTVT=01 AND 02`.

## Code Patterns

### ADT Client Method

```typescript
async getProgram(name: string, opts: SourceReadOptions = {}): Promise<SourceReadResult> {
  checkOperation(this.safety, OperationType.Read, 'GetProgram');
  return this.fetchSource(`/sap/bc/adt/programs/programs/${encodeURIComponent(name)}/source/main`, opts);
}
```

### Handler Pattern (intent.ts)

```typescript
case 'PROG':
  return textResult((await client.getProgram(name)).source);
case 'TABL':
  // Unified TABL: covers transparent tables AND DDIC structures.
  // client.getTabl() tries /tables/ first, falls back to /structures/ on 404.
  return textResult((await client.getTabl(name)).source);
case 'DOMA': {
  const domain = await client.getDomain(name);
  return textResult(JSON.stringify(domain, null, 2));
}
```

### Safety Check

```typescript
checkOperation(this.safety, OperationType.Create, 'CreateObject');
// Throws AdtSafetyError if blocked by allowWrites, allowFreeSQL, package gates, etc.
```

### CRUD Pattern (lock → modify → unlock)

```typescript
await http.withStatefulSession(async (session) => {
  const lock = await lockObject(session, objectUrl);
  const effectiveTransport = transport ?? (lock.corrNr || undefined);
  try {
    await updateSource(session, safety, sourceUrl, source, lock.lockHandle, effectiveTransport);
  } finally {
    await unlockObject(session, objectUrl, lock.lockHandle);
  }
});
```

**Note:** `lockObject()` returns `{ lockHandle, corrNr }`. When the caller omits `transport`, `safeUpdateSource()` and the delete flow automatically use `lock.corrNr` if present. Explicit `transport` always takes precedence.

## Testing

Every code change requires tests. See `docs/testing-skip-policy.md` for the full skip taxonomy.

### Test Levels

| Level | Command | SAP Required | Config |
|-------|---------|--------------|--------|
| Unit | `npm test` | No | `vitest.config.ts` |
| Integration | `npm run test:integration` | Yes (`TEST_SAP_URL`) | `vitest.integration.config.ts` |
| CRUD Lifecycle | `npm run test:integration:crud` | Yes (`TEST_SAP_URL`) | same |
| BTP Smoke | `npm run test:integration:btp:smoke` | Yes (`TEST_BTP_SERVICE_KEY_FILE`) | same |
| BTP Integration | `npm run test:integration:btp` | Yes (local only, interactive) | same |
| E2E | `npm run test:e2e` | Yes (MCP server running) | `tests/e2e/vitest.e2e.config.ts` |

### E2E Fixtures

- `tests/e2e/fixtures.ts` defines persistent objects (`ZARC1_TEST_REPORT`, `ZIF_ARC1_TEST`, `ZCL_ARC1_TEST`, `ZCL_ARC1_TEST_UT` in `$TMP`)
- `tests/e2e/setup.ts` has `syncPersistentFixtures()` / `deletePersistentFixtures()`
- `npm run test:e2e` auto-syncs fixtures before running tests
- Transient objects use `try/finally` for cleanup
- **Key rule:** Never silently pass when fixtures are missing — use `requireOrSkip()`, not `if (!x) return;`

### Skip Policy (`tests/helpers/skip-policy.ts`)

- `requireOrSkip(ctx, value, reason)` — skip if nullish, narrow type otherwise
- `SkipReason` constants: `NO_CREDENTIALS`, `NO_FIXTURE`, `BACKEND_UNSUPPORTED`, `NO_TRANSPORT_PACKAGE`, etc.
- **Valid:** missing credentials, fixture not on system, unsupported backend. **Invalid:** early return without skip, empty catch blocks.

### Error Assertions (`tests/helpers/expected-error.ts`)

- `expectSapFailureClass(err, [404, 403], [/not found/i])` — assert expected HTTP status or message
- `classifySapError(err)` — returns `'not-found'` | `'forbidden'` | `'not-released'` | `'connectivity'` | `'unknown'`

### Unit Test Mocking

```typescript
const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});
// In beforeEach: vi.resetAllMocks(); mockFetch.mockResolvedValue(mockResponse(200, 'source', { 'x-csrf-token': 'T' }));
import { mockResponse } from '../../helpers/mock-fetch.js';
```

### try/catch Rules

- **DO:** Assert success shape in try, expected error class in catch (`expectSapFailureClass`), tag cleanup with `// best-effort-cleanup`
- **DON'T:** Empty catch blocks, catch-and-continue without assertion, try/catch hiding precondition failures (use `requireOrSkip`)

### Integration / E2E Notes

- Integration: `TEST_SAP_*` env vars, `getTestClient()` factory, sequential execution, CRUD uses `generateUniqueName()`
- E2E: MCP SDK client, `connectClient()`/`callTool()`/`expectToolSuccess()` helpers, 120s timeout, sequential
- E2E RAP lifecycle: `tests/e2e/rap-write.e2e.test.ts` — TABL/DDLS/DCLS/BDEF/SRVD/SRVB create+activate+publish+delete (skips gracefully when `rap.available=false`)
- BTP: local only (not CI), needs `TEST_BTP_SERVICE_KEY_FILE`, interactive browser login
- CI telemetry: `scripts/ci/` aggregates JSON reports into GitHub step summaries. Coverage is informational only.

## Code Style & Module Conventions

- **ESM-only** (`"type": "module"`). All local imports must use `.js` extensions: `import { foo } from './bar.js'`
- **Formatting** (Biome): 2-space indent, single quotes, semicolons, trailing commas, 120-char line width
- **TypeScript**: strict mode, `noUnusedLocals`, `noUnusedParameters`, Node16 module resolution
- **Logging**: All logging to stderr via `src/server/logger.ts`. Never use `console.log` — it corrupts MCP JSON-RPC on stdout.

## Technology Stack

| Technology | Purpose |
|-----------|---------|
| TypeScript 5.8 | Language |
| Node.js 22+ | Runtime |
| `@modelcontextprotocol/sdk` | MCP protocol |
| `@abaplint/core` | ABAP lexer/parser/linter |
| `undici` | HTTP client (fetch, CSRF, cookies, proxy, TLS) |
| `fast-xml-parser` v5 | ADT XML parsing |
| `better-sqlite3` | SQLite cache |
| `commander` | CLI framework |
| `ajv` v8 (2020-12) | AFF JSON schema validation |
| `zod` v4 | Tool input validation & error formatting |
| `vitest` | Testing |
| `biome` | Linting + formatting |

## Releasing

Automated via [release-please](https://github.com/googleapis/release-please). No manual version bumps or changelog edits.

- **Commit conventions:** `feat:` -> minor, `fix:` -> patch, `feat!:` / `BREAKING CHANGE:` -> major. `chore:`/`docs:`/`ci:` -> no release.
- **Process:** Merge PRs to `main` -> release-please creates Release PR -> merge it -> npm publish + Docker push + GitHub Release
- **Version in two places:** `package.json` (auto-bumped) + `src/server/server.ts` `VERSION` constant (via `x-release-please-version` marker)
- **npm trusted publishing:** OIDC-based, no `NPM_TOKEN` secret. Requires `id-token: write` permission.
- **Key files:** `.github/workflows/release.yml`, `release-please-config.json`, `.release-please-manifest.json`

## Security & Architectural Invariants

- **stdout is sacred**: All logging goes to stderr. stdout is exclusively for MCP JSON-RPC protocol messages. Any `console.log` breaks the protocol.
- Never commit `.env`, `cookies.txt`, or `.arc1.json` (all in `.gitignore`)
- **`mta.yaml` is committed; `mta-overrides.mtaext` is gitignored** — The base `mta.yaml` is tracked and ships with placeholder destinations (`your-basic-destination` / `your-pp-destination`) plus safe defaults (writes off, free SQL off, `$TMP` only). Per-landscape values live in `mta-overrides.mtaext` (gitignored — copy from `mta-overrides.mtaext.example`) or any `mta-*.mtaext` file. Deploy with `cf deploy ... -e mta-overrides.mtaext` (or `npm run btp:build-deploy-ext`). The `mta-overrides.mtaext.example` template is tracked so deployers always have a reference.
- Sensitive fields (password, token, cookie) are redacted in logs
- CSRF tokens are auto-managed by `src/adt/http.ts` (fetch via HEAD, refresh on 403)
- **Safety config is the server ceiling** — per-user scopes (JWT) can only restrict further, never expand beyond server config
- **Per-user auth never inherits shared credentials.** `buildAdtConfig(config, btpProxy?, bearerTokenProvider?, { perUser: true })` strips `username`/`password`/`cookies`. Any new Layer B field must respect this flag. Never add auth fields directly to `createPerUserClient`'s `adtConfig` without going through `buildAdtConfig`.
- **All ADT endpoints have safety guards** — every `http.get/post/put/delete` call is preceded by `checkOperation()`. No unguarded HTTP calls.
- **Error types matter**: `AdtApiError` (SAP HTTP error), `AdtSafetyError` (blocked by config), `AdtNetworkError` (connectivity). `intent.ts` formats these with LLM-friendly hints.
- **Stateful sessions**: Lock→modify→unlock sequences must use `http.withStatefulSession()` to share cookies/CSRF tokens across requests

## History

This project was migrated from Go to TypeScript on 2026-03-26.
