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

Copy `.env.example` to `.env`. All options live in `src/server/config.ts` (parser) and `src/server/types.ts` (`ServerConfig` defaults).

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
| `SAP_DENY_ACTIONS` / `--deny-actions` | Per-action denial; CSV or file. Grammar: `Tool`, `Tool.action`, `Tool.glob*`. See [authorization.md](docs_page/authorization.md#advanced-deny-actions). |
| `ARC1_API_KEYS` / `--api-keys` | API keys + profiles (`key1:viewer,key2:developer`). Profiles: `viewer`, `viewer-data`, `viewer-sql`, `developer`, `developer-data`, `developer-sql`, `admin`. Profile safety is intersected with server ceiling. |
| `SAP_OIDC_ISSUER` / `--oidc-issuer` | OIDC issuer URL for JWT validation |
| `SAP_OIDC_AUDIENCE` / `--oidc-audience` | OIDC audience for JWT validation |
| `ARC1_OAUTH_DCR_TTL_SECONDS` / `--oauth-dcr-ttl-seconds` | Lifetime of an OAuth Dynamic Client Registration `client_id` in seconds. Default: `2592000` (30 days). Positive values are clamped to `[60s, 7776000s]` (90 days). Set to `0` (or any non-positive value) to disable expiration entirely — recommended when MCP clients in use don't auto-re-register on `invalid_client` (Copilot CLI, Cursor) and a finite TTL would just produce periodic outages without security gain. Only consulted when `SAP_XSUAA_AUTH=true`. |
| `ARC1_DCR_SIGNING_SECRET` / `--dcr-signing-secret` | Optional dedicated secret for HMAC-signing DCR `client_id`s. When set, decouples the DCR signing key from the XSUAA `clientsecret`, so MTA `cf deploy` (which recreates the service binding and rotates the `clientsecret`) does NOT invalidate cached `client_id`s. Recommended length: ≥32 bytes of entropy (e.g. `openssl rand -base64 48`); ARC-1 emits a soft warn at startup if the trimmed value is shorter than 16 bytes (128 bits — the conservative HMAC floor). Empty or whitespace-only values fall back to the legacy `clientsecret` mode (with a warn) instead of crashing startup. Set once via `cf set-env` so it survives across deploys. Falls back to the XSUAA `clientsecret` when omitted (legacy behavior, with the redeploy-invalidation caveat). Only consulted when `SAP_XSUAA_AUTH=true`; if set without `SAP_XSUAA_AUTH=true` ARC-1 emits a `[warn]` (orphan secret, not used). Re-setting the value is the explicit revocation knob — a `cf restage` after the change invalidates every outstanding `client_id`. |
| `ARC1_ALLOWED_ORIGINS` / `--allowed-origins` | Comma-separated CORS allowlist for **browser-based** MCP clients. Empty (default) = CORS disabled. Native MCP clients (Claude Desktop / Cursor / VS Code Copilot / Copilot Studio) don't need this — they use native HTTP, not the browser fetch API. Pairs with `credentials: true`, so origins are exact-match only (no wildcards). |
| `ARC1_PUBLIC_URL` | Public URL ARC-1 advertises in OAuth metadata (issuer, authorize / token / register / revoke endpoints, protected-resource metadata, and `WWW-Authenticate` `resource_metadata` URL). Set this when ARC-1 is reached through a reverse proxy on a different hostname or under a base-path prefix than the bound CF route — without it, MCP clients receive metadata pointing at `VCAP_APPLICATION.application_uris[0]` and bypass the proxy. Optional path prefix is supported (e.g. `https://gateway.example.com/arc1`); leave the path off for a root-mounted proxy. Trailing slash is stripped. Defaults to the CF route from `VCAP_APPLICATION`, then to `http://<bind-host>:<port>`. |
| `SAP_BTP_SERVICE_KEY` / `--btp-service-key` | BTP ABAP service key JSON (direct connection) |
| `SAP_BTP_SERVICE_KEY_FILE` / `--btp-service-key-file` | Path to BTP ABAP service key file |
| `SAP_BTP_OAUTH_CALLBACK_PORT` / `--btp-oauth-callback-port` | OAuth browser callback port (default: auto) |
| `SAP_SYSTEM_TYPE` / `--system-type` | System type: `auto` (default), `btp`, or `onprem` |
| `SAP_ABAP_RELEASE` / `--abap-release` | Optional SAP_BASIS release override for local tooling such as abaplint (for example `758` for S/4HANA 2023). Probe-detected release still wins when available. |
| `ARC1_TOOL_MODE` / `--tool-mode` | Tool mode: `standard` (12 tools, `SAPGit` feature-gated) or `hyperfocused` (1 universal SAP tool, ~200 tokens) |
| `SAP_ABAPLINT_CONFIG` / `--abaplint-config` | Path to custom abaplint.jsonc config file for lint rules |
| `SAP_LINT_BEFORE_WRITE` / `--lint-before-write` | Enable pre-write lint validation (default: true) |
| `SAP_CHECK_BEFORE_WRITE` / `--check-before-write` | Pre-write SAP-side syntax check via ADT checkruns; warnings appended to response (non-blocking). Default `false` (extra round-trip; activation is the definitive check). |
| `ARC1_CACHE` / `--cache` | Cache mode: `auto` (default), `memory`, `sqlite`, `none` |
| `ARC1_CACHE_FILE` / `--cache-file` | SQLite cache file path (default: `.arc1-cache.db`) |
| `ARC1_CACHE_WARMUP` / `--cache-warmup` | Pre-warm cache on startup via TADIR scan (default: false) |
| `ARC1_CACHE_WARMUP_PACKAGES` / `--cache-warmup-packages` | Package filter for warmup (e.g., "Z*,Y*") |
| `ARC1_MAX_CONCURRENT` / `--max-concurrent` | Max concurrent SAP HTTP requests (default: `10`). Prevents work process exhaustion |
| `SAP_BTP_DESTINATION` | BTP Destination name (overrides URL/user/password) |
| `SAP_BTP_PP_DESTINATION` | BTP PP Destination name (PrincipalPropagation type) |
| `SAP_PP_ENABLED` / `--pp-enabled` | Enable per-user principal propagation (default: false) |
| `SAP_PP_STRICT` / `--pp-strict` | PP failure = error, no fallback to shared client (default: false) |
| `SAP_PP_ALLOW_SHARED_COOKIES` / `--pp-allow-shared-cookies` | Escape hatch: allow `SAP_COOKIE_FILE`/`STRING` to coexist with `SAP_PP_ENABLED` (cookies stay on shared client only). Default `false`. |
| `SAP_DISABLE_SAML` / `--disable-saml` | Disable SAML redirect (`X-SAP-SAML2: disabled` + `?saml2=disabled`). Do NOT use on BTP ABAP or S/4 Public Cloud. Default `false`. |
| `ARC1_PROFILE` / `--profile` | Safety profile shortcut: `viewer`, `viewer-data`, `viewer-sql`, `developer`, `developer-data`, `developer-sql` |
| `ARC1_LOG_HTTP_DEBUG` | Attach full request/response bodies+headers to `http_request` audit events. Sensitive headers redacted, bodies truncated at 64KB. Not for production. Default `false`. |

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
│   ├── rap-generate.ts         # RAP behavior pool one-shot orchestrator (discover BDEF + scaffold + activate)
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
    ├── pre-write-hints.ts      # ARC-1-native pre-write semantic hints (TABL %admin draft include, ...)
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
| Add new ADT slash alias to `SLASH_TYPE_MAP` | `src/handlers/intent.ts` (`SLASH_TYPE_MAP` + `SLASH_TYPE_EVIDENCE` + `KNOWN_BASE_TYPES` for new canonical types), `tests/unit/handlers/slash-type-map.test.ts`. Citation guard requires a matching `research/abap-types/types/<short>.md` evidence file. Verify against Eclipse apidoc + live `<adtcore:type>` first. See PR #222/#223 (issue #218). |
| Add AUTH/FEATURE_TOGGLE/ENHO read (read-only DDIC metadata; deprecated alias `FTG2` accepted with warning) | `src/adt/client.ts`, `src/adt/xml-parser.ts`, `src/adt/types.ts`, `src/handlers/intent.ts`, `src/handlers/schemas.ts`, `src/handlers/tools.ts` |
| Read message classes via `MSAG` (canonical short type added in audit Plan B; `MESSAGES` deprecated alias) | `src/handlers/intent.ts` (case 'MSAG'/'MESSAGES'), `src/handlers/schemas.ts`, `src/handlers/tools.ts`, `src/adt/client.ts` (`getMessageClassInfo`) |
| Add source revision history read (VERSIONS / VERSION_SOURCE) | `src/adt/client.ts`, `src/adt/xml-parser.ts`, `src/adt/types.ts`, `src/handlers/intent.ts`, `src/handlers/schemas.ts`, `src/handlers/tools.ts` |
| Add DCL (access control) read/write | `src/adt/client.ts`, `src/handlers/intent.ts`, `src/handlers/schemas.ts`, `src/handlers/tools.ts` |
| Add fix proposal / quickfix operation | `src/adt/devtools.ts`, `src/handlers/intent.ts`, `src/handlers/tools.ts`, `src/handlers/schemas.ts`, `tests/unit/adt/devtools.test.ts` |
| Add OData-based read (non-ADT) | `src/adt/ui5-repository.ts`, `src/handlers/intent.ts`, `src/handlers/tools.ts`, `src/handlers/schemas.ts` |
| Add FLP operation | `src/adt/flp.ts`, `src/handlers/intent.ts`, `src/handlers/tools.ts`, `src/handlers/schemas.ts` |
| Add package create/delete/move (DEVC) | `src/handlers/intent.ts` (`handleSAPManage`), `src/handlers/tools.ts`, `src/handlers/schemas.ts`, `src/adt/ddic-xml.ts`, `src/adt/refactoring.ts` |
| Add FUGR/FUNC write (issue #250) | FUNC URL pre-resolution + `stripFmParamCommentBlock` in `src/handlers/intent.ts` (`handleSAPWrite`/`handleSAPActivate`); `case 'FUGR'`/`case 'FUNC'` in `buildCreateXml`; FUGR routes through normal `objectBasePath` fallback, FUNC bypasses `objectBasePath('FUNC')` (keep that throw intact). `'FUGR'` in `SAPWRITE_TYPES_ONPREM` + `group` field on `SAPWriteSchema` (schemas.ts/tools.ts). SAPGUI-style `*"…"*` blocks auto-stripped before PUT (SAP rejects `FUNC_ADT028`). See `docs/plans/completed/add-func-fugr-create-write.md`. |
| Add FUNC structured parameters (issue #252) | Pure module `src/adt/fm-signature.ts` (`buildFmSignatureClause`/`parseFmSignature`/`spliceFmSignature`) — array → ABAP source signature, parser returns `{params, bodyStart, bodyEnd}`. Wired into `handleSAPWrite` FUNC create+update: when `args.parameters` is set, splice the signature into the user's source (wrap body-only source first; fetch existing source when only `parameters` is supplied). `handleSAPRead` FUNC returns JSON `{source, signature: {importing, exporting, changing, tables, exceptions, raising}}` when `args.includeSignature===true`. `parameters` on SAPWrite schemas; `includeSignature` on SAPRead schemas. **`FUNC` removed from `runPreWriteLint` LINTABLE_TYPES** — abaplint can't parse source-based FM signatures (parser_error blocks every signature PUT). Falls back to opt-in `SAP_CHECK_BEFORE_WRITE` + activate. See `docs/plans/completed/add-fm-parameters.md`. |
| Modify CLAS include writes | `src/handlers/intent.ts` (`SAPWrite update` branch with `include=definitions|implementations|macros|testclasses`, parent class lock + include URL PUT), `src/handlers/schemas.ts` (`SAPWRITE_CLAS_INCLUDES` + include guard), `src/handlers/tools.ts`, `tests/unit/handlers/intent.test.ts`, `tests/unit/handlers/schemas.test.ts`, `tests/unit/handlers/tools.test.ts` |
| Modify package listing (`SAPRead type=DEVC`) | `src/adt/client.ts` (`getPackageContents` uses `informationsystem/search?packageName=...` GET, not `nodestructure` POST — the latter mis-aligns descriptions; `maxResults` clamps to `[1,1000]`, default 200), `src/adt/xml-parser.ts`, `src/handlers/intent.ts`, `src/handlers/schemas.ts`, `src/handlers/tools.ts`, `tests/{unit/adt,integration}/...`, `tests/fixtures/xml/package-contents-search.xml`. Search endpoint omits legacy SEGW-generated types (e.g. `IWSV`) — use `SAPSearch` for those. See `docs/plans/completed/fix-devc-listing-descriptions.md`. |
| Add object transport history (reverse lookup) | `src/adt/transport.ts` (`getObjectTransports`), `src/adt/types.ts` (`ObjectTransportHistory`), `src/handlers/intent.ts` (`handleSAPTransport` case `history`), `src/handlers/schemas.ts`, `src/handlers/tools.ts` |
| Modify SAPTransport.create endpoint or DEVCLASS default | `src/adt/transport.ts` (`createTransport` — POSTs `/sap/bc/adt/cts/transports` with `asx:abap` `CreateCorrectionRequest`; defaults DEVCLASS to `$TMP` when caller omits `targetPackage`), `src/handlers/intent.ts` (`handleSAPTransport` case `create`), `src/handlers/tools.ts` (tool description for `package`/`type`), `tests/unit/adt/transport.test.ts`, `tests/integration/transport.integration.test.ts` |
| Add gCTS / abapGit operation | `src/adt/gcts.ts` or `src/adt/abapgit.ts`, `src/handlers/intent.ts` (`handleSAPGit`), `src/handlers/tools.ts`, `src/handlers/schemas.ts` |
| Add RAP deterministic preflight checks | `src/adt/rap-preflight.ts`, `src/handlers/intent.ts` (`runRapPreflightValidation`), `src/handlers/tools.ts`, `src/handlers/schemas.ts`, `tests/unit/adt/rap-preflight.test.ts` |
| Add RAP behavior handler scaffolding logic | `src/adt/rap-handlers.ts`, `src/handlers/intent.ts` (`SAPWrite action=scaffold_rap_handlers`), `src/handlers/tools.ts`, `src/handlers/schemas.ts`, `tests/unit/adt/rap-handlers.test.ts`. **`ensureRapHandlerSkeletons` writes both DEFINITION + IMPLEMENTATION blocks to CCIMP only** per ABAP doc `ABENABP_HANDLER_CLASS_GLOSRY` and SAP demo class `BP_DEMO_RAP_STRICT` — CCDEF (`/source/definitions`) is never modified by the scaffold pipeline; the activator rejects handler classes derived from `cl_abap_behavior_handler` outside `Local Definitions/Implementations` (= CCIMP). Fixtures: `tests/fixtures/abap/bp-demo-rap-strict-{ccdef,ccimp}.abap`. |
| Add high-level RAP behavior implementation orchestration (`SAPWrite action=generate_behavior_implementation`) | `src/adt/rap-generate.ts`, `src/adt/xml-parser.ts` (`parseClassMetadata` rootEntityRef), `src/adt/types.ts` (`ClassRootEntityRef`), `src/handlers/intent.ts` (`case 'generate_behavior_implementation'`), `src/handlers/schemas.ts`, `src/handlers/tools.ts`, `src/authz/policy.ts`, `tests/unit/adt/rap-generate.test.ts`. Composes scaffold + include-write + activate; auto-discovers BDEF via class metadata's `<class:rootEntityRef>` element. Avoids the broken `/sap/bc/adt/quickfixes/proposals/.../create_class_implementation` server endpoint (HTTP 500 on a4h, verified live PR-C research 2026-05-10). |
| Add new tool type | `src/handlers/tools.ts`, `src/handlers/schemas.ts`, `src/handlers/intent.ts` |
| Add/modify tool input schema | `src/handlers/schemas.ts`, `src/handlers/tools.ts` |
| Add DDIC domain/data element write | `src/adt/ddic-xml.ts`, `src/adt/crud.ts`, `src/handlers/intent.ts` |
| Modify ADT service discovery / MIME types | `src/adt/discovery.ts`, `src/adt/http.ts` |
| Improve DDIC save diagnostics + SAP-domain error hints (T100/line + lock/auth/dependency hints) | `src/adt/errors.ts` (`extractDdicDiagnostics`, `formatDdicDiagnostics`, `classifySapDomainError`), `src/handlers/intent.ts` (`enrichWithSapDetails`, `formatErrorForLLM`) |
| Add SAP error classification (new `category` + hint) | `src/adt/errors.ts` (`extractExceptionType`/`extractLockOwner`/`classifySapDomainError`/`SapErrorClassification`), `src/handlers/intent.ts` (`formatErrorForLLM`/`classifyError`), `tests/unit/adt/errors.test.ts`. Existing categories live in the union type. Ground hints in verified SAP Notes/KBAs (use `mcp__sap-notes__search`) — no speculative tcode pointers. |
| Add release-gated content-type fallback (e.g. DTEL v2→v1 on 415) | `src/adt/crud.ts` (`CONTENT_TYPE_FALLBACKS` map — narrow static allowlist, 415-only retry in both `createObject` and `updateObject`), `tests/unit/adt/crud.test.ts`. Don't turn it into a generic retry loop — each entry must be a specific, tested compatibility gap. |
| Add / update test skip reason | `tests/helpers/skip-policy.ts`, `tests/e2e/helpers.ts` (`classifyToolErrorSkip`), `docs/integration-test-skips.md`, `scripts/ci/summarize-skips.mjs`. Skip messages are the taxonomy's public API — keep all four in sync. |
| Run ADT type-availability probe against a live system | `scripts/probe-adt-types.ts` (`npm run probe`), `src/probe/{catalog,runner,fixtures}.ts`, `tests/unit/probe/replay.test.ts`. New fixture set: `npm run probe -- --save-fixtures tests/fixtures/probe/<name>`. See [docs/probe-adt-types.md](docs/probe-adt-types.md). |
| Add CDS impact classifier / extend downstream grouping | `src/adt/cds-impact.ts`, `src/adt/codeintel.ts` (`findWhereUsed`), `tests/unit/adt/cds-impact.test.ts` |
| Add inactive syntax-check support | `src/adt/devtools.ts` (`syntaxCheck` options.version), `src/handlers/intent.ts` (`tryPostSaveSyntaxCheck`) |
| Add method-level surgery | `src/context/method-surgery.ts`. `MethodInfo.containingClass` tracks the local-class that contains each METHOD block (for CCDEF/CCIMP with multiple `lhc_*`/`lcl_*` classes); `extractMethod` honors `<localclass>~<method>` qualified specifiers (lookup order: exact match → qualified-class match → fuzzy-interface fallback). Bare-name lookups across multiple containing classes return an ambiguity error. |
| Extend edit_method for class-local includes (CCDEF/CCIMP) | `src/handlers/intent.ts` (`detectLocalHandlerInclude` + `case 'edit_method'` include= routing), `src/handlers/schemas.ts` (`validateSapWriteInput` accepts `include` for `edit_method` + `update`), `src/handlers/tools.ts` (tool description), `tests/unit/handlers/intent.test.ts`, `tests/unit/handlers/schemas.test.ts`, `tests/integration/adt.integration.test.ts`. Auto-detection prefixes: `lhc_*`/`lcl_*` → `implementations`, `ltc_*` → `testclasses`; global-interface (`zif_X~method`) stays on MAIN. Reuses `safeUpdateSource(...classIncludeUrl(name, include)...)` from PR #257. Include reads bypass `cachingLayer.getSource` (cache key doesn't yet differentiate by include — follow-up). |
| Add SAPSearch tadir_lookup `source` variants (adt/db/both) | `src/handlers/intent.ts` (`handleSAPSearch` tadir_lookup branch — synth `actionOrType=tadir_lookup_<source>` for db/both; merge layer + splitBrain detection), `src/handlers/schemas.ts` (`SAPSearchSchema` + `SAPSearchSchemaNoSource` `source` enum), `src/handlers/tools.ts` (source enum in JSON Schema), `src/adt/client.ts` (`lookupObjectsViaDb` + private `tadirObjectUrl` URL builder; the DB path uses `runQuery` → FreeSQL safety check + sql scope), `src/authz/policy.ts` (`SAPSearch.tadir_lookup_db` / `tadir_lookup_both` entries), `src/adt/types.ts` (`AdtSearchResult._origin`), tests under `tests/unit/{handlers,adt,authz}/` + `tests/integration/adt.integration.test.ts`. Default `'adt'` preserves today's read-scoped behavior; `'db'`/`'both'` escalate to sql scope so viewer-only profiles cannot piggyback. |
| Add SAPWrite batch_create `activateAtEnd` (deferred batch activation) | `src/handlers/intent.ts` (`case 'batch_create'` — accumulates `writtenObjects: BatchActivationObject[]`, skips per-object inline `activate()` when `activateAtEnd=true`, fires one terminal `activateBatch` after loop, defers cache invalidation until terminal activate succeeds; FUNC group URL resolved at staging time using same pattern as `handleSAPActivate`), `src/handlers/schemas.ts` (`activateAtEnd: z.coerce.boolean().optional()` on `SAPWriteSchema` + `SAPWriteSchemaBtp`), `src/handlers/tools.ts` (`activateAtEnd` JSON Schema property), tests in `tests/unit/handlers/intent.test.ts` + `tests/integration/adt.integration.test.ts`. Default `false` preserves today's per-object inline activation. For interdependent objects in `batch_create`, prefer `activateAtEnd: true` so SAP's activator resolves cross-references in one pass. |
| Modify hyperfocused mode | `src/handlers/hyperfocused.ts`, `src/handlers/tools.ts` |
| Add XML response parser | `src/adt/xml-parser.ts` |
| Add safety check | `src/adt/safety.ts` |
| Add/modify PrettyPrint action | `src/adt/devtools.ts`, `src/handlers/intent.ts` (handleSAPLint), `src/handlers/tools.ts`, `src/handlers/schemas.ts` |
| Add lint rule config | `src/lint/lint.ts`, `src/lint/config-builder.ts`, `src/lint/presets/` |
| Add an ARC-1-native pre-write semantic hint for a new object type | `src/lint/pre-write-hints.ts` (add `inspect<Type>Source` pure function returning `LintResult[]` with `severity:'warning'`), `src/lint/lint.ts` (wire into `validateBeforeWrite()` filename-gated by extension), `tests/unit/lint/pre-write-hints.test.ts` (positive/negative/edge tests, comments stripped, mixed case), `tests/unit/lint/lint.test.ts` (integration via `validateBeforeWrite`) |
| Add dependency pattern | `src/context/deps.ts` |
| Add CDS dependency pattern | `src/context/cds-deps.ts` |
| Add contract extraction for new type | `src/context/contract.ts` |
| Modify context output format | `src/context/compressor.ts` |
| Add runtime diagnostic | `src/adt/diagnostics.ts`, `src/handlers/intent.ts` |
| Add source state diagnostic | `src/adt/diagnostics.ts`, `src/adt/types.ts`, `src/handlers/intent.ts`, `src/handlers/schemas.ts`, `src/handlers/tools.ts` |
| Add audit logging | `src/server/audit.ts`, `src/server/sinks/` |
| Add audit event type | `src/server/audit.ts` (typed `*Event` interface + `AuditEvent` union); emit via `logger.emitAudit({...})` from the call site (e.g. `confirmPreaudit` in `src/adt/devtools.ts`) |
| Add/modify Dependabot config | `.github/dependabot.yml` — npm + github-actions + docker, weekly. Grouping + ignore rules in-file. |
| Add/modify npm audit / SAST / dep review CI gate | `.github/workflows/test.yml` (`npm audit --audit-level=high`); `.github/workflows/dependency-review.yml` (license allow/deny). |
| Add/modify container scanning | Trivy advisory in `docker.yml`, gating in `release.yml`; SARIF uploaded via `github/codeql-action/upload-sarif@v4`. |
| Pin a third-party GitHub Action | `uses: <owner>/<action>@<40-char-sha>  # <tag>` (trailing comment lets Dependabot bump SHA + tag together). GitHub-owned `actions/*`/`github/*` stay tag-pinned. |
| Update vulnerability reporting policy | `SECURITY.md` (Supported Versions, Reporting channels, Response SLAs, CVE handling, Out of Scope, Safe Harbor) |
| Add CLI sub-command (`call`, `tools`, shortcuts) | `src/cli.ts` (Commander wiring), `src/cli-args.ts` (pure arg parsing helpers + tests in `tests/unit/cli/cli-args.test.ts`) — never duplicate Zod validation; `handleToolCall` does it |
| Add SAP version-quirk workaround (NW 7.50 / S/4 gating) | Prefer `extractExceptionType` in `src/adt/errors.ts` (structured XML error). Body-marker heuristics only with a release-scoped guard — see `convertHtmlConflictToProperError` in `src/adt/crud.ts` (Layer 1 exception type → Layer 2 body marker scoped to `cachedFeatures.abapRelease < 751`). Inline-comment WHY the heuristic self-scopes. ADR-0002 in [PR #199](https://github.com/marianfoo/arc-1/pull/199). |
| Add activation batch quirk recovery | `src/adt/devtools.ts` (`activateBatch`, ED064 retry helper), `tests/unit/adt/devtools.test.ts`. Pure ED064 / "no next/previous object found" batch failures are retried once as individual activations; mixed real errors must not retry. |
| Add elicitation prompt | `src/server/elicit.ts` |
| Add XSUAA/JWT auth | `src/server/xsuaa.ts` |
| Modify OAuth DCR client store / signed-token format | `src/server/stateless-client-store.ts` (HMAC sign/verify, payload schema, TTL); `src/server/xsuaa.ts`, `src/server/http.ts`; `tests/unit/server/stateless-client-store.test.ts`. Bumping `KDF_LABEL` is the in-code revocation knob; `cf bind-service` rotates upstream secrets. Audit events: `oauth_client_registered` / `oauth_client_lookup_failed` / `oauth_redirect_uri_registered`. |
| Modify scope enforcement | `src/authz/policy.ts` (`ACTION_POLICY`), `src/handlers/intent.ts` (runtime check), `src/server/server.ts` (tool listing filter) |
| Modify OIDC token handling | `src/server/http.ts` (validateOidcToken, ~line 274) |
| Add/modify auth scopes | `xs-security.json`, `src/server/xsuaa.ts`, `src/server/http.ts`, `src/handlers/intent.ts` |
| Add / modify auth combination rule | `src/server/config.ts` (validateConfig at ~line 305), `src/server/types.ts` (ServerConfig), `tests/unit/server/config.test.ts`, `docs/enterprise-auth.md` (Coexistence Matrix) |
| Add Layer B auth mechanism | `src/adt/http.ts` (applyAuthHeader at ~line 830, fetchCsrfToken at ~line 669), `src/server/server.ts` (buildAdtConfig — perUser flag), `tests/unit/adt/http.test.ts` |
| Add safety config option | `src/adt/safety.ts`, `src/server/config.ts`, `src/server/types.ts` |
| Add feature probe | `src/adt/features.ts` (`PROBES` array — one endpoint per feature; status classification by `classifyFeatureProbeStatus`: 2xx/400/405/5xx → available, 401/403/404 → unavailable; surface reason via `FeatureStatus.message`). |
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

A tool call traverses these layers in order:

1. **Transport** (`src/server/http.ts` or stdio). Stdio has no auth; HTTP runs the auth chain.
2. **Auth** (HTTP only): XSUAA → OIDC JWT → API key. Each yields `AuthInfo { scopes, clientId?, userName? }`.
3. **Per-user client** (`src/server/server.ts`): if `ppEnabled` + JWT, mint a per-user SAP session via BTP Destination Service.
4. **`handleToolCall`** (`src/handlers/intent.ts`): scope check (`ACTION_POLICY`) → Zod validation (`getToolSchema`) → handler dispatch → package check (`checkPackage` for SAPWrite). Source-read path consults inactive-list cache + ETag-revalidated source cache (key `(type, name, active|inactive)`).
5. **ADT client** (`src/adt/{client,crud,devtools}.ts`): every endpoint guarded by `checkOperation(safety, OperationType.X, 'Y')`.
6. **HTTP** (`src/adt/http.ts`): proactive MIME negotiation (discovery map, startup-cached); conditional GET; CSRF (HEAD/refresh on 403); 406/415 one-retry; cookie hot-reload on stale 401; stateful sessions for lock→modify→unlock.
7. **SAP ABAP**: native auth (`S_DEVELOP`, `S_ADT_RES`, `S_TRANSPRT`).

**Key invariant:** scope ∧ safety ∧ SAP auth — all must pass.

## Authorization & Safety System

**Safety ceiling** (`src/adt/safety.ts`, set at startup): `allowWrites`, `allowDataPreview`, `allowFreeSQL`, `allowTransportWrites`, `allowGitWrites`, `allowedPackages`, `allowedTransports`, `denyActions`. All ADT endpoints MUST go through `checkOperation()`. `OperationType` enum is internal-only — admins drive policy via the `allow*` flags + `SAP_DENY_ACTIONS`. Mutations require `allowWrites=true`; transport/git writes additionally require their respective flag.

**Scopes** (`src/authz/policy.ts`): `read`, `write`, `data`, `sql`, `transports`, `git`, `admin`. `admin` ⊇ all; `write` ⊇ `read`; `sql` ⊇ `data`. `ACTION_POLICY` maps `(tool, action/type) → required scope` and is the single source of truth for runtime checks + tool-list pruning. Stdio skips scope checks (no user identity).

**Auth providers** (HTTP, chained in `src/server/http.ts` + `xsuaa.ts`): XSUAA OAuth → OIDC JWT (JWKS) → API key.

**Principal propagation**: when `ppEnabled=true`, JWT mints a per-user SAP session via BTP Destination Service; SAP-level auth applies per user, ARC-1 scopes still enforced as defense-in-depth.

**ADT POSTs that look like reads**: 9+ "read" endpoints (findDefinition, findWhereUsed, getCompletion, syntax check, unit tests, ATC, quickfix evaluation, apply-delta, table preview) use HTTP POST. Read-only SAP users need `S_ADT_RES` with `ACTVT=01 AND 02`.

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

### Fixtures + helpers

- E2E persistent objects: `tests/e2e/fixtures.ts`, sync via `tests/e2e/setup.ts` (auto-run by `npm run test:e2e`).
- Transient objects: `try/finally` cleanup, tagged `// best-effort-cleanup`.
- Skip policy: `tests/helpers/skip-policy.ts` — `requireOrSkip(ctx, value, reason)` + `SkipReason` constants. Valid skips: missing creds / fixture / unsupported backend. Never `if (!x) return;` or empty catches.
- Error assertions: `tests/helpers/expected-error.ts` — `expectSapFailureClass(err, [statuses], [patterns])`, `classifySapError(err)`.
- Integration: `getTestClient()`, sequential, CRUD uses `generateUniqueName()`.
- E2E: `connectClient()`/`callTool()`/`expectToolSuccess()`, 120s timeout, sequential.

### Unit Test Mocking

```typescript
import { mockResponse } from '../../helpers/mock-fetch.js';
const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: mockFetch,
}));
// beforeEach: vi.resetAllMocks(); mockFetch.mockResolvedValue(mockResponse(200, 'source', { 'x-csrf-token': 'T' }));
```

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

Automated via [release-please](https://github.com/googleapis/release-please) — no manual version bumps or changelog edits.

- **Commits:** `feat:` → minor, `fix:` → patch, `feat!:` / `BREAKING CHANGE:` → major. `chore:`/`docs:`/`ci:` → no release.
- **Process:** merge PR to `main` → release-please opens Release PR → merge → npm publish + Docker push + GitHub Release.
- **Version in two places:** `package.json` (auto) + `src/server/server.ts` `VERSION` (via `x-release-please-version` marker).
- **npm trusted publishing:** OIDC, no `NPM_TOKEN`. Requires `id-token: write`.
- **Files:** `.github/workflows/release.yml`, `release-please-config.json`, `.release-please-manifest.json`.

## Security & Architectural Invariants

- **stdout is sacred** — logging goes to stderr; stdout carries MCP JSON-RPC only. `console.log` breaks the protocol.
- Never commit `.env`, `cookies.txt`, `.arc1.json`. Sensitive fields (password/token/cookie) are redacted in logs.
- **MTA layout** — `mta.yaml` committed (placeholder destinations, safe defaults); `mta-overrides.mtaext` gitignored (copy from `.example`). Deploy: `cf deploy ... -e mta-overrides.mtaext` or `npm run btp:build-deploy-ext`.
- **Safety config is the server ceiling** — per-user scopes can only restrict further.
- **Per-user auth never inherits shared credentials** — `buildAdtConfig(..., { perUser: true })` strips `username`/`password`/`cookies`/`cookieFile`/`cookieString`. Any new Layer B field must respect this flag; never bypass via `createPerUserClient`'s `adtConfig`.
- **Cookie auth hot-reload** — `SAP_COOKIE_FILE` is re-read lazily on persistent 401 (`cookiesCleared` flag in `src/adt/http.ts`); startup auth-preflight is non-blocking in cookie mode. `SAP_COOKIE_STRING` cannot hot-reload (logged warning).
- **All ADT endpoints have safety guards** — every `http.{get,post,put,delete}` call preceded by `checkOperation()`. No unguarded HTTP calls.
- **Error types**: `AdtApiError` (SAP HTTP), `AdtSafetyError` (blocked by config), `AdtNetworkError` (connectivity). `intent.ts` formats them with LLM-friendly hints.
- **Stateful sessions**: lock→modify→unlock uses `http.withStatefulSession()` to share cookies/CSRF.
- **CSRF auto-managed** by `src/adt/http.ts` (HEAD fetch, refresh on 403).
- **Tool schema three-file sync** — every property must exist in `tools.ts` (JSON Schema for LLMs), `schemas.ts` (Zod), and `intent.ts` (handler). A property missing from `tools.ts` is invisible to LLMs. Batch schemas (`batch_create` items) live separately from the top-level schema — update both.

## History

Migrated from Go to TypeScript on 2026-03-26.
