# CLAUDE.md - AI Assistant Guidelines

This file provides context for AI assistants (Claude, etc.) working on this project.

## Project Overview

**ARC-1** is a TypeScript MCP (Model Context Protocol) server for SAP ABAP Development Tools (ADT). It provides 12 intent-based tools (SAPRead, SAPSearch, SAPWrite, SAPActivate, SAPNavigate, SAPQuery, SAPTransport, SAPGit, SAPContext, SAPLint, SAPDiagnose, SAPManage) for use with Claude and other MCP-compatible LLMs.

Distributed as an npm package (`arc-1`) and Docker image (`ghcr.io/marianfoo/arc-1`).

## Design Principles

1. **Centralized admin control** — Runs as a managed service, not on developer laptops. Admins configure positive opt-in safety gates (writes, data preview, SQL, package allowlists, transport/Git writes, deny actions) per instance. Every tool call is audited with user identity. Per-user JWT scopes can restrict further but never expand beyond server config.

2. **Per-user SAP identity** — Principal propagation maps each MCP user to their own SAP user via BTP Destination Service + Cloud Connector. SAP's native authorization (S_DEVELOP, package checks) applies per user. No shared service accounts.

3. **Token-efficient tool design** — 12 intent-based tools (~5K schema tokens) instead of 200+ endpoints. Hyperfocused mode: 1 tool (~200 tokens). Method-level surgery (95% reduction) and context compression (7-30x) keep responses within tight context windows. This is the difference between working and not working on mid-tier LLMs (GPT-4o-mini, Copilot Studio).

4. **BTP-native deployment** — First-class BTP CF support: Destination Service, Cloud Connector, XSUAA OAuth, BTP Audit Log Service. Also deployable as Docker or npm. Local stdio mode for development.

5. **Multi-client, vendor-neutral** — Standard MCP protocol. Three auth modes coexist: XSUAA OAuth + Entra ID OIDC + API key. Same instance serves Claude, Copilot Studio, VS Code Copilot, Gemini CLI, Cursor.

6. **Safe defaults, opt-in power** — Read-only by default. Free SQL blocked. Package allowlist defaults to `$TMP`. Writing to transportable packages requires explicit config. Everything forbidden until the admin allows it.

## Quick Reference

### Build & Test

```bash
npm ci                          # Install dependencies
npm run build                   # TypeScript → dist/
npm test                        # Unit tests
npm run test:watch              # Unit tests (watch mode)
npm run typecheck               # Type check
npm run lint                    # Lint
npm run test:integration        # Integration tests (needs SAP credentials)
npm run test:integration:crud   # CRUD lifecycle tests (needs SAP credentials)
npm run test:coverage           # Unit tests with coverage (informational)
npm run test:coverage-report    # Coverage summary (Markdown)
npm run dev                     # Dev mode (stdio)
npm run dev:http                # Dev mode (HTTP Streamable)
# BTP tests (local only — needs service key + browser login):
TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json npm run test:integration:btp
TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json npm run test:integration:btp:smoke
```

### Configuration (Priority: CLI > Env > .env > Defaults)

```bash
# Using environment variables
SAP_URL=http://host:50000 SAP_USER=user SAP_PASSWORD=pass npm run dev

# Using .env file (copy .env.example to .env)
npm run dev
```

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
| `SAP_ALLOW_WRITES` / `--allow-writes` | Enable object mutations (default: `false`). Required for transport/git writes too. |
| `SAP_ALLOW_DATA_PREVIEW` / `--allow-data-preview` | Enable named table preview (default: `false`) |
| `SAP_ALLOW_FREE_SQL` / `--allow-free-sql` | Enable freestyle SQL (default: `false`) |
| `SAP_DENY_ACTIONS` / `--deny-actions` | Fine-grained per-action denial. Grammar: `Tool`, `Tool.action`, `Tool.glob*`. Inline CSV or file path. See [authorization.md](docs_page/authorization.md#advanced-deny-actions). |
| `SAP_ALLOWED_PACKAGES` / `--allowed-packages` | Restrict write operations to packages (default: `$TMP`; supports wildcards: "Z*"). Reads never package-gated. |
| `SAP_ALLOW_TRANSPORT_WRITES` / `--allow-transport-writes` | Enable transport mutations (default: `false`). Requires `SAP_ALLOW_WRITES=true`. |
| `SAP_ALLOW_GIT_WRITES` / `--allow-git-writes` | Enable git mutations (default: `false`). Requires `SAP_ALLOW_WRITES=true`. |
| `ARC1_API_KEYS` / `--api-keys` | Multiple API keys with profiles (`key1:viewer,key2:developer`). Valid profiles: `viewer`, `viewer-data`, `viewer-sql`, `developer`, `developer-data`, `developer-sql`, `admin`. |
| `SAP_OIDC_ISSUER` / `--oidc-issuer` | OIDC issuer URL for JWT validation |
| `SAP_OIDC_AUDIENCE` / `--oidc-audience` | OIDC audience for JWT validation |
| `SAP_BTP_SERVICE_KEY` / `--btp-service-key` | BTP ABAP service key JSON (direct connection) |
| `SAP_BTP_SERVICE_KEY_FILE` / `--btp-service-key-file` | Path to BTP ABAP service key file |
| `SAP_BTP_OAUTH_CALLBACK_PORT` / `--btp-oauth-callback-port` | OAuth browser callback port (default: auto) |
| `SAP_SYSTEM_TYPE` / `--system-type` | System type: `auto` (default), `btp`, or `onprem` |
| `SAP_ABAP_RELEASE` / `--abap-release` | Optional SAP_BASIS release override for local tooling such as abaplint (for example `758` for S/4HANA 2023). Probe-detected release still wins when available. |
| `ARC1_TOOL_MODE` / `--tool-mode` | Tool mode: `standard` (12 tools, default) or `hyperfocused` (1 universal SAP tool, ~200 tokens) |
| `SAP_ABAPLINT_CONFIG` / `--abaplint-config` | Path to custom abaplint.jsonc config file for lint rules |
| `SAP_LINT_BEFORE_WRITE` / `--lint-before-write` | Enable pre-write lint validation (default: true) |
| `ARC1_CACHE` / `--cache` | Cache mode: `auto` (default), `memory`, `sqlite`, `none` |
| `ARC1_CACHE_FILE` / `--cache-file` | SQLite cache file path (default: `.arc1-cache.db`) |
| `ARC1_CACHE_WARMUP` / `--cache-warmup` | Pre-warm cache on startup via TADIR scan (default: false) |
| `ARC1_CACHE_WARMUP_PACKAGES` / `--cache-warmup-packages` | Package filter for warmup (e.g., "Z*,Y*") |
| `SAP_BTP_DESTINATION` | BTP Destination name (overrides URL/user/password) |
| `SAP_BTP_PP_DESTINATION` | BTP PP Destination name (PrincipalPropagation type) |
| `SAP_PP_ENABLED` / `--pp-enabled` | Enable per-user principal propagation (default: false) |
| `SAP_PP_STRICT` / `--pp-strict` | PP failure = error, no fallback to shared client (default: false) |

## Codebase Structure

```
src/
├── index.ts, cli.ts            # Entry points (MCP server, CLI)
├── server/
│   ├── server.ts               # MCP server setup, tool registration
│   ├── config.ts               # Config parser (CLI > env > .env > defaults)
│   ├── http.ts                 # HTTP Streamable transport + API key/OIDC auth
│   ├── logger.ts               # Structured logger (stderr only, never stdout)
│   ├── types.ts                # ServerConfig type, defaults
│   ├── audit.ts                # Audit logging (tool calls, elicitation events)
│   ├── context.ts, elicit.ts   # MCP context helpers, elicitation
│   ├── xsuaa.ts                # XSUAA JWT validation for BTP
│   └── sinks/                  # Audit sinks: stderr, file, btp-auditlog
├── handlers/                   # one module per tool (split from the former intent.ts monolith)
│   ├── dispatch.ts             # handleToolCall router + scope checks + LLM error formatting (was intent.ts; the intent.ts barrel is now deleted — import from the owning module)
│   ├── read.ts, write.ts       # SAPRead / SAPWrite handlers (write/ package: create, update-delete, class-surgery, rap)
│   ├── search.ts, query.ts, activate.ts, navigate.ts, diagnose.ts, git.ts, transport.ts, context.ts, lint.ts, manage.ts  # the other tool handlers
│   ├── object-types.ts, write-helpers.ts, cds-hints.ts, tool-registry.ts, feature-cache.ts, cache-security.ts, shared.ts  # shared leaf modules
│   ├── tools.ts                # Tool definitions (names, descriptions, JSON schemas)
│   ├── schemas.ts              # Zod v4 input schemas (runtime validation)
│   ├── zod-errors.ts           # Zod error formatting for LLM clients
│   └── hyperfocused.ts         # Hyperfocused mode (single SAP tool, ~200 tokens)
├── adt/
│   ├── client.ts               # ADT client facade (all read operations)
│   ├── http.ts                 # HTTP transport (undici/fetch, CSRF, cookies, sessions)
│   ├── errors.ts               # Typed errors (AdtApiError, AdtSafetyError, AdtNetworkError)
│   ├── safety.ts               # Safety system (positive opt-ins, package gates, deny actions)
│   ├── features.ts             # Feature detection (auto/on/off)
│   ├── config.ts, types.ts     # ADT client config + response types
│   ├── xml-parser.ts           # XML parser (fast-xml-parser v5)
│   ├── btp.ts                  # BTP Destination Service + Connectivity proxy
│   ├── cookies.ts, oauth.ts    # Cookie parsing, OAuth 2.0 for BTP ABAP
│   ├── crud.ts                 # CRUD operations (lock, create, update, delete)
│   ├── devtools.ts             # Syntax check, activate, publish SRVB, unit tests
│   ├── diagnostics.ts          # Short dumps (ST22), ABAP profiler traces
│   ├── codeintel.ts            # Find def, refs, where-used, completion
│   ├── ui5-repository.ts       # UI5 ABAP Repository OData client
│   └── transport.ts            # CTS transport management
├── context/
│   ├── deps.ts, cds-deps.ts    # AST-based dependency extraction
│   ├── contract.ts             # Public API contract extraction
│   ├── compressor.ts           # Orchestrator (fetch + compress + format)
│   └── method-surgery.ts       # Method-level extraction and surgical replacement
├── cache/
│   ├── cache.ts, memory.ts     # Cache interface + in-memory impl
│   ├── sqlite.ts               # SQLite cache (default for http-streamable)
│   ├── caching-layer.ts        # Source + dep caching, invalidation
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
| Add new read operation | `src/adt/client.ts`, `src/handlers/read.ts`, `src/handlers/tools.ts` (for structured format, also `src/adt/xml-parser.ts`, `src/adt/types.ts`) |
| Add OData-based read (non-ADT) | `src/adt/ui5-repository.ts`, `src/handlers/read.ts`, `src/handlers/tools.ts`, `src/handlers/schemas.ts` |
| Add new tool type | `src/handlers/tools.ts`, `src/handlers/schemas.ts`, `src/handlers/dispatch.ts` |
| Add/modify tool input schema | `src/handlers/schemas.ts`, `src/handlers/tools.ts` |
| Add method-level surgery | `src/context/method-surgery.ts` |
| Modify hyperfocused mode | `src/handlers/hyperfocused.ts`, `src/handlers/tools.ts` |
| Add XML response parser | `src/adt/xml-parser.ts` |
| Add safety check | `src/adt/safety.ts` |
| Add lint rule config | `src/lint/lint.ts`, `src/lint/config-builder.ts`, `src/lint/presets/` |
| Add activation batch quirk recovery | `src/adt/devtools.ts`, `tests/unit/adt/devtools.test.ts` |
| Add dependency pattern | `src/context/deps.ts` |
| Add CDS dependency pattern | `src/context/cds-deps.ts` |
| Add contract extraction for new type | `src/context/contract.ts` |
| Modify context output format | `src/context/compressor.ts` |
| Add runtime diagnostic | `src/adt/diagnostics.ts`, `src/handlers/diagnose.ts` |
| Add audit logging | `src/server/audit.ts`, `src/server/sinks/` |
| Add elicitation prompt | `src/server/elicit.ts` |
| Add XSUAA/JWT auth | `src/server/xsuaa.ts` |
| Modify scope enforcement | `src/authz/policy.ts` (`ACTION_POLICY`), `src/handlers/dispatch.ts` (runtime check), `src/server/server.ts` (tool listing filter) |
| Modify OIDC token handling | `src/server/http.ts` (validateOidcToken, ~line 274) |
| Add/modify auth scopes | `xs-security.json`, `src/server/xsuaa.ts`, `src/server/http.ts`, `src/handlers/dispatch.ts` |
| Add safety config option | `src/adt/safety.ts`, `src/server/config.ts`, `src/server/types.ts` |
| Add feature probe | `src/adt/features.ts` |
| Add E2E test | `tests/e2e/`, helpers in `tests/e2e/helpers.ts`, fixtures in `tests/e2e/fixtures.ts` |
| Add/modify E2E fixture | `tests/e2e/fixtures.ts` (define object), `tests/fixtures/abap/` (source file), `tests/e2e/setup.ts` (sync logic) |
| Modify object caching | `src/cache/caching-layer.ts`, `src/cache/cache.ts` |
| Add cache warmup feature | `src/cache/warmup.ts`, `src/server/server.ts` |
| Add integration test | `tests/integration/adt.integration.test.ts` |
| Add BTP ABAP integration test | `tests/integration/btp-abap.integration.test.ts` |
| Add BTP smoke test | `tests/integration/btp-abap.smoke.integration.test.ts` |
| BTP ABAP Environment auth | `src/adt/oauth.ts`, `src/server/server.ts` |
| BTP Destination Service / Connectivity proxy | `src/adt/btp.ts` |
| Add AFF schema | `src/aff/schemas/` (add `{type}-v1.json`), `src/aff/validator.ts` (add type mapping) |
| Modify AFF validation | `src/aff/validator.ts`, `src/handlers/write/create.ts` (create/batch_create paths) |
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
handleToolCall (handlers/dispatch.ts)
  │
  ├─ 1. Scope check: ACTION_POLICY[tool/action-or-type] vs authInfo.scopes (only when authInfo present)
  ├─ 2. Zod validation: getToolSchema(toolName) → safeParse(args) (rejects invalid input with LLM-friendly errors)
  ├─ 3. Route to handler: handleSAPRead(), handleSAPWrite(), etc.
  ├─ 4. Package check: checkPackage(safety, packageName) (for all SAPWrite actions: create, update, delete, edit_method)
  │
  ▼
ADT Client Method (adt/client.ts, crud.ts, devtools.ts, etc.)
  │
  ├─ 5. Safety check: checkOperation(safety, OperationType.Read, 'GetProgram')
  │
  ▼
HTTP Request (adt/http.ts)
  │
  ├─ CSRF token management (auto-fetch via HEAD, refresh on 403)
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

### Scope Enforcement (`src/authz/policy.ts`, `src/handlers/dispatch.ts`)

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

7+ "read" endpoints use HTTP POST: code intelligence (findDefinition, findWhereUsed, getCompletion), syntax check, unit tests, ATC, table preview. A read-only SAP user needs `S_ADT_RES ACTVT=01 AND 02`.

## Code Patterns

### ADT Client Method

```typescript
async getProgram(name: string): Promise<string> {
  checkOperation(this.safety, OperationType.Read, 'GetProgram');
  const resp = await this.http.get(`/sap/bc/adt/programs/programs/${encodeURIComponent(name)}/source/main`);
  return resp.body;
}
```

### Handler Pattern (per-tool handler module, e.g. read.ts)

```typescript
case 'PROG':
  return textResult(await client.getProgram(name));
case 'STRU':
  return textResult(await client.getStructure(name));
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
  const lockHandle = await lockObject(session, objectUrl);
  try {
    await updateSource(session, sourceUrl, source, lockHandle, transport);
  } finally {
    await unlockObject(session, objectUrl, lockHandle);
  }
});
```

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
- `SkipReason` constants: `NO_CREDENTIALS`, `NO_FIXTURE`, `BACKEND_UNSUPPORTED`, etc.
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
- BTP: local only (not CI), needs `TEST_BTP_SERVICE_KEY_FILE`, interactive browser login
- CI telemetry: `scripts/ci/` aggregates JSON reports into GitHub step summaries. Coverage is informational only.

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
- Sensitive fields (password, token, cookie) are redacted in logs
- CSRF tokens are auto-managed by `src/adt/http.ts` (fetch via HEAD, refresh on 403)
- **Safety config is the server ceiling** — per-user scopes (JWT) can only restrict further, never expand beyond server config
- **All ADT endpoints have safety guards** — every `http.get/post/put/delete` call is preceded by `checkOperation()`. No unguarded HTTP calls.
- **Error types matter**: `AdtApiError` (SAP HTTP error), `AdtSafetyError` (blocked by config), `AdtNetworkError` (connectivity). `dispatch.ts` formats these with LLM-friendly hints.
- **Stateful sessions**: Lock→modify→unlock sequences must use `http.withStatefulSession()` to share cookies/CSRF tokens across requests

## History

This project was migrated from Go to TypeScript on 2026-03-26.
