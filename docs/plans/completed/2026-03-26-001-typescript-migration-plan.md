# ARC-1 TypeScript Migration Plan

**Date:** 2026-03-26
**Report ID:** 001
**Subject:** Complete port of ARC-1 from Go to TypeScript
**Related Documents:** [Roadmap](../docs/roadmap.md), [CLAUDE.md](../CLAUDE.md)

---

## 1. Executive Summary

This document describes the complete migration of ARC-1 (ABAP Relay Connector) from Go to TypeScript. The migration preserves all existing functionality — 11 intent-based MCP tools, safety system, feature detection, transport management, authentication, caching, and context compression — while leveraging the TypeScript ecosystem for the ADT HTTP layer, ABAP analysis (`@abaplint/core`), and MCP protocol (`@modelcontextprotocol/sdk`).

**What changes:**
- Language: Go → TypeScript (Node.js 20+)
- MCP SDK: `mcp-go` → `@modelcontextprotocol/sdk`
- ABAP analysis: custom Go lexer/parser/linter → `@abaplint/core`
- HTTP client: custom Go `net/http` → custom axios-based client (inspired by `abap-adt-api` and `@mcp-abap-adt/adt-clients`)
- Cache: `go-sqlite3` → `better-sqlite3`
- CLI: Cobra → `commander.js`
- Testing: `go test` → Vitest
- Distribution: single binary → npm package + Docker image

**What stays the same:**
- 11 intent-based tool architecture (SAPRead, SAPSearch, SAPWrite, etc.)
- Safety system (read-only, operation filter, package filter, transport guard)
- Feature detection (auto/on/off for abapGit, RAP, AMDP, UI5, Transport)
- Context compression (dependency extraction + contract generation)
- Authentication methods (basic, cookie, OAuth2/XSUAA, mTLS, OIDC)
- Configuration priority (CLI > env > .env > defaults)
- All unit and integration tests (ported to Vitest)

**What is removed:**
- Lua scripting engine (`pkg/scripting/`)
- Embedded ABAP deployment (`embedded/abap/`)
- WebSocket AMDP debugger (`amdp_debugger.go`, `amdp_websocket.go`)
- External debugger (`debugger.go`)
- DSL/workflow engine (`pkg/dsl/`, workflow patterns)
- GoReleaser / single-binary distribution
- Native Go ABAP lexer/parser/linter (replaced by `@abaplint/core`)

---

## 2. Approach: Test-Driven Migration (TDD)

The migration follows a strict TDD discipline:

```
Phase 1: Project Scaffold & Infrastructure
Phase 2: Port Tests (unit + integration) — tests fail initially
Phase 3: Port Implementation — make tests pass module by module
Phase 4: Integration Testing — end-to-end against SAP system
Phase 5: CI/CD, Docker, npm — production readiness
```

**For each module, the workflow is:**
1. Read the Go test file, understand what it tests
2. Write the equivalent Vitest test in TypeScript (it will fail)
3. Port the Go implementation to TypeScript
4. Run tests until green
5. Move to next module

This ensures we never ship code without test coverage, and we catch regressions immediately.

---

## 3. Technology Stack

### Runtime & Language

| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js | ≥ 20.0.0 | Runtime |
| TypeScript | ~5.7+ | Language |
| ES2022 | — | Target (top-level await, private fields) |
| module: node16 | — | Module resolution |

### Core Dependencies

| Package | Purpose | Replaces (Go) |
|---------|---------|---------------|
| `@modelcontextprotocol/sdk` | MCP protocol | `mcp-go` (mark3labs) |
| `@abaplint/core` | ABAP lexer, parser, linter | `pkg/abaplint/` (custom Go port) |
| `axios` | HTTP client for ADT | `net/http` (stdlib) |
| `fast-xml-parser` | XML parsing (ADT responses) | `encoding/xml` (stdlib) |
| `zod` | Runtime schema validation | manual validation |
| `better-sqlite3` | SQLite cache | `go-sqlite3` (mattn) |
| `commander` | CLI framework | `cobra` (spf13) |
| `dotenv` | .env file loading | `godotenv` (joho) |

### Development Dependencies

| Package | Purpose |
|---------|---------|
| `vitest` | Test framework |
| `biome` | Linter + formatter |
| `tsx` | TypeScript execution (dev mode) |
| `tsup` or `tsc` | Build (compile to dist/) |

### Rationale for Key Choices

**axios over fetch:** ADT requires cookie jars, CSRF token headers, stateful sessions, and interceptors for token refresh. Axios has mature support for all of these via interceptors and cookie jar plugins. The `abap-adt-api` and fr0ster repos both use axios successfully for ADT.

**fast-xml-parser over xml2js:** SAP ADT responses are XML. `fast-xml-parser` is faster, has better TypeScript support, and is used by fr0ster's repo. Handles ADT's namespace-heavy XML well.

**zod for validation:** The MCP SDK uses zod internally. Using it for our own input validation keeps the dependency tree lean and provides runtime type safety for tool arguments.

**commander over yargs/oclif:** Lightweight, well-maintained, good TypeScript support. We need a minimal CLI, not a framework.

---

## 4. Project Structure

```
arc-1/
├── src/
│   ├── index.ts                    # Main entry point (MCP server)
│   ├── cli.ts                      # CLI entry point
│   │
│   ├── server/
│   │   ├── server.ts               # MCP server setup, tool registration
│   │   ├── config.ts               # Server configuration (ServerConfig type)
│   │   ├── transports.ts           # stdio + http-streamable transport setup
│   │   └── types.ts                # Shared server types
│   │
│   ├── handlers/
│   │   ├── intent.ts               # 11 intent-based tool routers
│   │   ├── tools.ts                # Tool definitions (names, descriptions, schemas)
│   │   ├── read.ts                 # SAPRead sub-handlers
│   │   ├── search.ts               # SAPSearch sub-handlers
│   │   ├── write.ts                # SAPWrite sub-handlers (source CRUD)
│   │   ├── activate.ts             # SAPActivate sub-handlers
│   │   ├── navigate.ts             # SAPNavigate sub-handlers
│   │   ├── query.ts                # SAPQuery sub-handlers
│   │   ├── transport.ts            # SAPTransport sub-handlers
│   │   ├── context.ts              # SAPContext sub-handlers
│   │   ├── lint.ts                 # SAPLint sub-handlers
│   │   ├── diagnose.ts             # SAPDiagnose sub-handlers
│   │   ├── manage.ts               # SAPManage sub-handlers
│   │   └── helpers.ts              # Shared handler utilities
│   │
│   ├── adt/
│   │   ├── client.ts               # ADT client facade (main entry point)
│   │   ├── http.ts                 # HTTP transport (axios, CSRF, cookies, sessions)
│   │   ├── types.ts                # XML types, ADT response types
│   │   ├── config.ts               # ADT client configuration
│   │   ├── safety.ts               # Safety system (read-only, op filter, pkg filter)
│   │   ├── features.ts             # Feature detection (auto/on/off)
│   │   ├── read.ts                 # Read operations (programs, classes, tables, etc.)
│   │   ├── crud.ts                 # CRUD operations (lock, create, update, delete)
│   │   ├── devtools.ts             # Dev tools (syntax check, activate, unit tests)
│   │   ├── codeintel.ts            # Code intelligence (find def, refs, completion)
│   │   ├── transport.ts            # CTS transport management
│   │   ├── ddic.ts                 # Data dictionary (tables, domains, elements)
│   │   ├── cds.ts                  # CDS view dependency analysis
│   │   ├── ui5.ts                  # UI5/Fiori BSP management
│   │   ├── whereused.ts            # Where-used analysis (XREF)
│   │   ├── enhancements.ts         # Enhancement spots/implementations
│   │   ├── history.ts              # Execution history tracking
│   │   ├── cookies.ts              # Cookie file parsing (Netscape format)
│   │   ├── oauth.ts                # OAuth2/XSUAA (BTP)
│   │   ├── oidc.ts                 # OIDC authentication
│   │   └── principal-propagation.ts # Per-user ephemeral X.509
│   │
│   ├── cache/
│   │   ├── cache.ts                # Cache interface + types
│   │   ├── memory.ts               # In-memory cache
│   │   └── sqlite.ts               # SQLite cache (better-sqlite3)
│   │
│   ├── context/
│   │   ├── analyzer.ts             # Dependency extraction (uses @abaplint/core)
│   │   ├── compressor.ts           # Contract compression
│   │   └── types.ts                # Contract types
│   │
│   ├── lint/
│   │   └── lint.ts                 # Thin wrapper around @abaplint/core
│   │
│   └── config/
│       └── systems.ts              # Multi-system profile management
│
├── tests/
│   ├── unit/
│   │   ├── adt/
│   │   │   ├── client.test.ts
│   │   │   ├── http.test.ts
│   │   │   ├── safety.test.ts
│   │   │   ├── features.test.ts
│   │   │   ├── crud.test.ts
│   │   │   ├── devtools.test.ts
│   │   │   ├── codeintel.test.ts
│   │   │   ├── transport.test.ts
│   │   │   ├── cookies.test.ts
│   │   │   ├── config.test.ts
│   │   │   ├── read.test.ts
│   │   │   ├── ddic.test.ts
│   │   │   ├── ui5.test.ts
│   │   │   ├── whereused.test.ts
│   │   │   ├── oauth.test.ts
│   │   │   └── oidc.test.ts
│   │   ├── cache/
│   │   │   ├── memory.test.ts
│   │   │   └── sqlite.test.ts
│   │   ├── context/
│   │   │   ├── analyzer.test.ts
│   │   │   └── compressor.test.ts
│   │   ├── handlers/
│   │   │   ├── intent.test.ts
│   │   │   ├── read.test.ts
│   │   │   ├── write.test.ts
│   │   │   └── tools.test.ts
│   │   ├── server/
│   │   │   ├── server.test.ts
│   │   │   ├── config.test.ts
│   │   │   └── transports.test.ts
│   │   └── cli/
│   │       └── cli.test.ts
│   ├── integration/
│   │   ├── adt.integration.test.ts
│   │   └── helpers.ts
│   └── fixtures/
│       ├── xml/                    # Sample ADT XML responses
│       └── abap/                   # Sample ABAP source files
│
├── bin/
│   └── arc1.js                     # CLI entry point (shebang)
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── biome.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
├── CLAUDE.md
└── docs/                           # Existing docs (preserved)
```

**Key structural decisions:**

1. **Single `src/` package** — no monorepo, but clear internal module boundaries via directories
2. **`tests/` outside `src/`** — keeps production code clean, Vitest discovers tests by glob pattern
3. **Handler files mirror Go** — each intent tool gets its own handler file
4. **ADT client matches Go structure** — `adt/client.ts` is the facade, sub-modules handle specific operations
5. **`tests/fixtures/`** — XML response samples extracted from Go test mocks, shared across tests

---

## 5. Module-by-Module Migration Plan

### 5.1 Phase 1: Project Scaffold (Day 1)

**Goal:** Working TypeScript project that compiles and runs an empty MCP server.

| Step | Action | Files |
|------|--------|-------|
| 1.1 | Initialize `package.json` with dependencies | `package.json` |
| 1.2 | Configure TypeScript (`tsconfig.json`) | `tsconfig.json` |
| 1.3 | Configure Vitest | `vitest.config.ts` |
| 1.4 | Configure Biome (linter/formatter) | `biome.json` |
| 1.5 | Create empty MCP server that starts on stdio | `src/index.ts`, `src/server/server.ts` |
| 1.6 | Verify: `npm run build` compiles, `npm run dev` starts | — |
| 1.7 | Create Dockerfile (multi-stage) | `Dockerfile` |
| 1.8 | Create `.env.example` | `.env.example` |
| 1.9 | Update `.gitignore` for TS artifacts | `.gitignore` |
| 1.10 | Create first test: `server.test.ts` (server starts without error) | `tests/unit/server/server.test.ts` |

**package.json outline:**

```json
{
  "name": "arc-1",
  "version": "3.0.0",
  "description": "MCP Server for SAP ABAP Systems",
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "bin": { "arc1": "./bin/arc1.js" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "dev:http": "tsx src/index.ts --transport http-streamable",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:coverage": "vitest run --coverage",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "cli": "tsx src/cli.ts",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.0",
    "@abaplint/core": "^2.x",
    "axios": "^1.7.0",
    "better-sqlite3": "^11.0.0",
    "commander": "^12.0.0",
    "dotenv": "^16.4.0",
    "fast-xml-parser": "^4.5.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "biome": "^1.9.0",
    "tsx": "^4.19.0",
    "typescript": "~5.7.0",
    "vitest": "^2.1.0"
  }
}
```

**tsconfig.json outline:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

### 5.2 Phase 2: ADT HTTP Transport (Days 2–3)

**Goal:** Port `pkg/adt/http.go` — the HTTP client with CSRF token handling, cookie management, and stateful sessions.

This is the foundation everything else builds on. Every ADT operation goes through this layer.

#### Go Source → TypeScript Mapping

| Go File | Lines | TypeScript File | Key Concepts |
|---------|-------|----------------|--------------|
| `pkg/adt/http.go` | 512 | `src/adt/http.ts` | CSRF fetch/refresh, cookie jar, stateful sessions, request/response interceptors |
| `pkg/adt/cookies.go` | 62 | `src/adt/cookies.ts` | Netscape cookie file parsing |
| `pkg/adt/config.go` | 331 | `src/adt/config.ts` | Configuration types, option pattern |
| `pkg/adt/xml.go` | 329 | `src/adt/types.ts` | ADT XML response types |

#### TDD Steps

1. **Write tests first** (from Go test files):
   - `http.test.ts` — CSRF token fetch, refresh on 403, cookie handling, stateful sessions, request recording
   - `cookies.test.ts` — Netscape format parsing, inline cookie string parsing
   - `config.test.ts` — Config creation, option merging, env var loading

2. **Port implementation:**

**`src/adt/http.ts`** — ADT HTTP Transport

```typescript
// Key design (inspired by Go http.go + fr0ster sessionUtils.ts):
export class AdtHttpClient {
  private csrfToken: string = '';
  private sessionId: string = '';
  private cookieJar: Map<string, string>;
  private axios: AxiosInstance;

  constructor(config: AdtConfig) { /* ... */ }

  // GET with auto CSRF fetch on first request
  async get(path: string, headers?: Record<string, string>): Promise<AdtResponse>;

  // POST/PUT/DELETE with CSRF token, auto-refresh on 403
  async post(path: string, body: string, contentType: string): Promise<AdtResponse>;
  async put(path: string, body: string, contentType: string): Promise<AdtResponse>;
  async delete(path: string): Promise<AdtResponse>;

  // Stateful session management (lock → modify → unlock must share session)
  async withStatefulSession<T>(fn: (client: AdtHttpClient) => Promise<T>): Promise<T>;

  // CSRF token lifecycle
  private async fetchCsrfToken(): Promise<string>;
  private async refreshCsrfOnForbidden(request: () => Promise<AdtResponse>): Promise<AdtResponse>;
}
```

**Key patterns from reference repos:**

- **CSRF handling** (from `abap-adt-api` and fr0ster): Fetch token via `GET /sap/bc/adt/discovery` with `X-CSRF-Token: Fetch` header. Cache token. On 403, re-fetch and retry once.
- **Stateful sessions** (from fr0ster `sessionUtils.ts`): Use `x-sap-adt-sessiontype: stateful` header. Same `sap-adt-connection-id` across lock/modify/unlock. Different `sap-adt-request-id` per request.
- **Cookie management**: axios `withCredentials: true` + custom cookie jar for SAP-specific cookies (`sap-usercontext`, `SAP_SESSIONID_xxx`).

#### Test Count Target

| Test File | Go Tests | TS Tests (Target) |
|-----------|----------|-------------------|
| `http.test.ts` | ~20 (from `http_test.go`, 627 lines) | ~20 |
| `cookies.test.ts` | ~5 (from `cookies_test.go`) | ~5 |
| `config.test.ts` | ~10 (from `config_test.go`) | ~10 |

#### Fixtures Needed

Extract from Go test files:
- Sample CSRF token response headers
- Sample ADT discovery XML
- Sample 403 response for CSRF refresh
- Sample Netscape cookie file

---

### 5.3 Phase 3: Safety System (Day 3)

**Goal:** Port `pkg/adt/safety.go` — the operation filtering and package restriction system.

This is critical infrastructure that gates all write operations.

#### Go Source → TypeScript Mapping

| Go File | Lines | TypeScript File |
|---------|-------|----------------|
| `pkg/adt/safety.go` | 391 | `src/adt/safety.ts` |
| `pkg/adt/safety_test.go` | 819 | `tests/unit/adt/safety.test.ts` |

#### TDD Steps

1. **Write tests first** — Port all 25 tests from `safety_test.go`:
   - Operation type filtering (R, S, Q, C, D, U, A)
   - Allowed/disallowed operation lists
   - Package restrictions with wildcard matching (`Z*`, `$TMP`)
   - Read-only mode enforcement
   - Block free SQL mode
   - Transport operation checks
   - Allow transportable edits flag
   - Edge cases (empty config, conflicting allow/disallow)

2. **Port implementation:**

```typescript
export interface SafetyConfig {
  readOnly: boolean;
  blockFreeSQL: boolean;
  allowedOps: string;      // e.g., "RSQ"
  disallowedOps: string;   // e.g., "CDUA"
  allowedPackages: string[];
  allowTransportableEdits: boolean;
}

export class SafetyChecker {
  constructor(private config: SafetyConfig) {}

  checkOperation(opType: OperationType): SafetyResult;
  checkPackage(packageName: string): SafetyResult;
  checkTransportableEdit(isTransportable: boolean): SafetyResult;
  isPackageAllowed(packageName: string): boolean;
}
```

#### Test Count Target: 25 tests

---

### 5.4 Phase 4: Feature Detection (Day 4)

**Goal:** Port `pkg/adt/features.go` — auto-detect SAP system capabilities.

| Go File | Lines | TypeScript File |
|---------|-------|----------------|
| `pkg/adt/features.go` | 382 | `src/adt/features.ts` |

#### TDD Steps

1. **Write tests** — feature probe logic, auto/on/off evaluation, graceful degradation
2. **Port implementation:**

```typescript
export interface FeatureConfig {
  abapGit: 'auto' | 'on' | 'off';
  rap: 'auto' | 'on' | 'off';
  amdp: 'auto' | 'on' | 'off';
  ui5: 'auto' | 'on' | 'off';
  transport: 'auto' | 'on' | 'off';
  hana: 'auto' | 'on' | 'off';
}

export class FeatureProber {
  constructor(private client: AdtHttpClient, private config: FeatureConfig) {}
  async probe(): Promise<ResolvedFeatures>;
}
```

#### Test Count Target: ~10 tests

---

### 5.5 Phase 5: ADT Client — Read Operations (Days 4–6)

**Goal:** Port `pkg/adt/client.go` read operations — the largest single file (2,422 lines).

This is the core of the ADT client. Every `SAPRead` tool call routes through here.

#### Go Source → TypeScript Mapping

| Go File | Lines | TypeScript File | Operations |
|---------|-------|----------------|------------|
| `pkg/adt/client.go` | 2,422 | `src/adt/client.ts` + `src/adt/read.ts` | GetProgram, GetClass, GetInterface, GetFunction, GetFunctionGroup, GetInclude, GetPackage, GetTable, GetTableContents, GetSystemInfo, GetInstalledComponents, GetObjectStructure, GetCallGraph, GetMessages, GetTextElements, GetVariants, SearchObject, GrepObjects, GrepPackages |

#### TDD Steps

1. **Write tests first** — Port from `client_test.go` and related test files:
   - Mock HTTP responses for each operation
   - XML parsing verification
   - Error handling (404, 500, auth failures)
   - Object type routing

2. **Port implementation** — Method by method, each with its own test.

**ADT XML parsing pattern** (using `fast-xml-parser`):

```typescript
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,  // Strip ADT namespaces
});

// Parse ADT response
const result = parser.parse(xmlString);
```

**Key reference:** Study `abap-adt-api` for XML parsing patterns — it handles the same ADT XML formats we do. Also study fr0ster's `@mcp-abap-adt/adt-clients` for CRUD operation patterns.

#### Sub-operations to Port (Priority Order)

| # | Operation | ADT Endpoint | Complexity |
|---|-----------|-------------|------------|
| 1 | SearchObject | `/sap/bc/adt/repository/informationsystem/search` | Low |
| 2 | GetProgram | `/sap/bc/adt/programs/programs/{name}/source/main` | Low |
| 3 | GetClass | `/sap/bc/adt/oo/classes/{name}/source/main` | Medium (includes) |
| 4 | GetInterface | `/sap/bc/adt/oo/interfaces/{name}/source/main` | Low |
| 5 | GetFunction | `/sap/bc/adt/functions/groups/{group}/fmodules/{name}/source/main` | Medium |
| 6 | GetFunctionGroup | `/sap/bc/adt/functions/groups/{name}` | Low |
| 7 | GetInclude | `/sap/bc/adt/programs/includes/{name}/source/main` | Low |
| 8 | GetTable | `/sap/bc/adt/ddic/tables/{name}` | Medium (XML) |
| 9 | GetTableContents | `/sap/bc/adt/datapreview/table` | Medium |
| 10 | GetPackage | `/sap/bc/adt/packages/{name}` | Low |
| 11 | GetSystemInfo | `/sap/bc/adt/core/discovery` | Low |
| 12 | GetInstalledComponents | `/sap/bc/adt/informationsystem/sapcomponents` | Low |
| 13 | GetObjectStructure | `/sap/bc/adt/repository/nodestructure` | Medium (XML) |
| 14 | GetCallGraph | `/sap/bc/adt/repository/informationsystem/callGraph` | Medium |
| 15 | GrepObjects | `/sap/bc/adt/repository/informationsystem/search` (text) | Low |
| 16 | GrepPackages | Composite (search + filter) | Medium |
| 17 | GetMessages | `/sap/bc/adt/messageclass/{name}` | Low |
| 18 | GetTextElements | `/sap/bc/adt/programs/programs/{name}/textelements` | Low |
| 19 | GetVariants | `/sap/bc/adt/programs/programs/{name}/variants` | Low |

#### Test Count Target: ~40 tests

---

### 5.6 Phase 6: ADT Client — CRUD Operations (Days 6–7)

**Goal:** Port `pkg/adt/crud.go` — lock, create, update, delete with stateful sessions.

| Go File | Lines | TypeScript File |
|---------|-------|----------------|
| `pkg/adt/crud.go` | 1,046 | `src/adt/crud.ts` |

#### TDD Steps

1. **Write tests** — Lock/unlock sequences, create with transport, update with lock verification, delete safety checks
2. **Port implementation:**

```typescript
export class AdtCrud {
  constructor(private http: AdtHttpClient, private safety: SafetyChecker) {}

  async lockObject(uri: string): Promise<LockHandle>;
  async unlockObject(uri: string, lockHandle: string): Promise<void>;
  async createObject(type: string, name: string, pkg: string, source: string, transport?: string): Promise<void>;
  async updateObject(uri: string, source: string, lockHandle: string): Promise<void>;
  async deleteObject(uri: string, lockHandle: string, transport?: string): Promise<void>;
}
```

**Critical pattern:** Lock → modify → unlock must use the same stateful HTTP session. In Go this uses a single `*http.Client` with cookie jar. In TypeScript, use `AdtHttpClient.withStatefulSession()`.

**Reference:** Study fr0ster's guaranteed unlock via try-finally pattern:
```typescript
const lock = await this.lockObject(uri);
try {
  await this.updateSource(uri, source, lock);
} finally {
  await this.unlockObject(uri, lock);
}
```

#### Test Count Target: ~15 tests

---

### 5.7 Phase 7: ADT Client — DevTools (Days 7–8)

**Goal:** Port `pkg/adt/devtools.go` — syntax check, activation, unit test execution.

| Go File | Lines | TypeScript File |
|---------|-------|----------------|
| `pkg/adt/devtools.go` | 1,199 | `src/adt/devtools.ts` |

#### Operations

| Operation | ADT Endpoint | Notes |
|-----------|-------------|-------|
| SyntaxCheck | `/sap/bc/adt/checkruns` | POST with object URI |
| Activate | `/sap/bc/adt/activation` | POST, may return warnings |
| RunUnitTests | `/sap/bc/adt/abapunit/testruns` | POST, returns XML results |
| RunATCCheck | `/sap/bc/adt/atc/runs` | POST, async result polling |

#### Test Count Target: ~15 tests

---

### 5.8 Phase 8: ADT Client — Code Intelligence (Day 8)

**Goal:** Port `pkg/adt/codeintel.go`.

| Go File | Lines | TypeScript File |
|---------|-------|----------------|
| `pkg/adt/codeintel.go` | 635 | `src/adt/codeintel.ts` |

#### Operations

| Operation | ADT Endpoint |
|-----------|-------------|
| FindDefinition | `/sap/bc/adt/navigation/target` |
| FindReferences | `/sap/bc/adt/repository/informationsystem/usageReferences` |
| GetCompletion | `/sap/bc/adt/abapsource/codecompletion/proposals` |

#### Test Count Target: ~10 tests

---

### 5.9 Phase 9: ADT Client — Transport Management (Days 8–9)

**Goal:** Port `pkg/adt/transport.go`.

| Go File | Lines | TypeScript File |
|---------|-------|----------------|
| `pkg/adt/transport.go` | 1,012 | `src/adt/transport.ts` |

#### Operations

| Operation | ADT Endpoint |
|-----------|-------------|
| ListTransports | `/sap/bc/adt/cts/transportrequests` |
| GetTransport | `/sap/bc/adt/cts/transportrequests/{id}` |
| CreateTransport | `/sap/bc/adt/cts/transportrequests` (POST) |
| AddToTransport | `/sap/bc/adt/cts/transportrequests/{id}/tasks/{taskId}/objects` |
| ReleaseTransport | `/sap/bc/adt/cts/transportrequests/{id}/newreleasejobs` |

#### Test Count Target: ~10 tests

---

### 5.10 Phase 10: Remaining ADT Operations (Days 9–10)

**Goal:** Port remaining ADT modules.

| Go File | Lines | TypeScript File | Test Target |
|---------|-------|----------------|-------------|
| `pkg/adt/ddic.go` | 473 | `src/adt/ddic.ts` | ~8 |
| `pkg/adt/ui5.go` | 402 | `src/adt/ui5.ts` | ~5 |
| `pkg/adt/cds.go` | 208 | `src/adt/cds.ts` | ~5 |
| `pkg/adt/whereused.go` | 249 | `src/adt/whereused.ts` | ~5 |
| `pkg/adt/enhancements.go` | 165 | `src/adt/enhancements.ts` | ~3 |
| `pkg/adt/history.go` | 521 | `src/adt/history.ts` | ~5 |
| `pkg/adt/oauth.go` | 255 | `src/adt/oauth.ts` | ~5 |
| `pkg/adt/oidc.go` | 471 | `src/adt/oidc.ts` | ~8 |
| `pkg/adt/principal_propagation.go` | 245 | `src/adt/principal-propagation.ts` | ~5 |
| `pkg/adt/btp.go` | 389 | *(merged into oauth.ts / oidc.ts)* | — |

---

### 5.11 Phase 11: Cache (Day 10)

**Goal:** Port `pkg/cache/` with `better-sqlite3`.

| Go File | Lines | TypeScript File | Test Target |
|---------|-------|----------------|-------------|
| `pkg/cache/cache.go` | 211 | `src/cache/cache.ts` | ~5 |
| `pkg/cache/memory.go` | 500 | `src/cache/memory.ts` | ~8 |
| `pkg/cache/sqlite.go` | 477 | `src/cache/sqlite.ts` | ~8 |

#### Key Difference from Go

Go's `go-sqlite3` uses CGO. TypeScript's `better-sqlite3` is a native Node.js addon (synchronous API, faster than async alternatives). The API maps naturally:

```typescript
import Database from 'better-sqlite3';

export class SqliteCache implements Cache {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createTables();
  }

  putNode(node: CacheNode): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO nodes ...');
    stmt.run(node.id, node.objectType, ...);
  }
}
```

---

### 5.12 Phase 12: Context Compression (Days 10–11)

**Goal:** Port `pkg/ctxcomp/` using `@abaplint/core` for dependency analysis.

| Go File | Lines | TypeScript File | Test Target |
|---------|-------|----------------|-------------|
| `pkg/ctxcomp/analyzer.go` | 423 | `src/context/analyzer.ts` | ~8 |
| `pkg/ctxcomp/compressor.go` | 223 | `src/context/compressor.ts` | ~5 |
| `pkg/ctxcomp/contract.go` | 189 | `src/context/types.ts` | ~3 |

#### Key Improvement

The Go version had a custom ABAP tokenizer for dependency extraction. The TypeScript version uses `@abaplint/core`'s full AST, which gives us:
- Complete dependency resolution (not just token-level)
- Method signatures with types
- Interface implementations
- Proper class hierarchy

```typescript
import { ABAPFile, MemoryFile, Registry } from '@abaplint/core';

export class DependencyAnalyzer {
  analyzeDependencies(source: string, objectName: string): Dependency[] {
    const file = new MemoryFile(`${objectName}.prog.abap`, source);
    const reg = new Registry().addFile(file).parse();
    // Extract dependencies from AST
  }
}
```

---

### 5.13 Phase 13: ABAP Lint Wrapper (Day 11)

**Goal:** Thin wrapper around `@abaplint/core` for the SAPLint tool.

| Go File | Lines | TypeScript File | Test Target |
|---------|-------|----------------|-------------|
| `pkg/abaplint/lexer.go` | 462 | *(not needed — @abaplint/core)* | — |
| `pkg/abaplint/statements.go` | 217 | *(not needed)* | — |
| `pkg/abaplint/lint.go` | — | `src/lint/lint.ts` | ~8 |
| `pkg/abaplint/rules.go` | 367 | *(not needed — @abaplint/core rules)* | — |

```typescript
import { Registry, MemoryFile, Config } from '@abaplint/core';

export interface LintResult {
  rule: string;
  message: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
}

export function lintAbapSource(source: string, filename: string, config?: object): LintResult[] {
  const reg = new Registry(new Config(config ?? defaultConfig));
  reg.addFile(new MemoryFile(filename, source));
  reg.parse();
  return reg.findIssues().map(issue => ({
    rule: issue.getKey(),
    message: issue.getMessage(),
    line: issue.getStart().getRow(),
    column: issue.getStart().getCol(),
    severity: mapSeverity(issue.getSeverity()),
  }));
}
```

---

### 5.14 Phase 14: MCP Server & Handlers (Days 11–13)

**Goal:** Port `internal/mcp/` — the MCP server, tool registration, and all 11 intent-based handlers.

#### Go Source → TypeScript Mapping

| Go File | Lines | TypeScript File |
|---------|-------|----------------|
| `internal/mcp/server.go` | 514 | `src/server/server.ts` |
| `internal/mcp/tools_intent.go` | 591 | `src/handlers/tools.ts` |
| `internal/mcp/handlers_intent.go` | 953 | `src/handlers/intent.ts` |
| `internal/mcp/handlers_source.go` | 439 | `src/handlers/read.ts` (merged) |
| `internal/mcp/handlers_read.go` | 363 | `src/handlers/read.ts` (merged) |
| `internal/mcp/handlers_crud.go` | 429 | `src/handlers/write.ts` |
| `internal/mcp/handlers_codeintel.go` | 383 | `src/handlers/navigate.ts` |
| `internal/mcp/handlers_transport.go` | 330 | `src/handlers/transport.ts` |
| `internal/mcp/handlers_context.go` | 467 | `src/handlers/context.ts` |
| `internal/mcp/handlers_analysis.go` | 316 | `src/handlers/diagnose.ts` |
| `internal/mcp/handlers_devtools.go` | — | `src/handlers/activate.ts` |
| `internal/mcp/handlers_search.go` | — | `src/handlers/search.ts` |
| `internal/mcp/handlers_grep.go` | — | `src/handlers/search.ts` (merged) |
| `internal/mcp/handlers_universal.go` | 183 | *(merged into intent handlers)* |
| `internal/mcp/handlers_ui5.go` | 233 | `src/handlers/read.ts` (merged) |
| `internal/mcp/handlers_ddic.go` | 206 | `src/handlers/read.ts` (merged) |
| `internal/mcp/handlers_traces.go` | — | `src/handlers/diagnose.ts` (merged) |
| `internal/mcp/handlers_sqltrace.go` | — | `src/handlers/diagnose.ts` (merged) |
| `internal/mcp/handlers_dumps.go` | — | `src/handlers/diagnose.ts` (merged) |
| `internal/mcp/handlers_atc.go` | — | `src/handlers/lint.ts` |
| `internal/mcp/handlers_whereused.go` | — | `src/handlers/navigate.ts` (merged) |
| `internal/mcp/handlers_system.go` | — | `src/handlers/read.ts` (merged) |

#### MCP SDK Integration Pattern

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export function createServer(client: AdtClient, config: ServerConfig): Server {
  const server = new Server(
    { name: 'arc-1', version: '3.0.0' },
    { capabilities: { tools: {} } }
  );

  // Register all 11 intent-based tools
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: getToolDefinitions(config),
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) =>
    handleToolCall(client, config, request)
  );

  return server;
}
```

#### Tool Definitions with Zod

```typescript
import { z } from 'zod';

export const SAPReadSchema = z.object({
  type: z.enum(['PROG', 'CLAS', 'INTF', 'FUNC', 'FUGR', 'TABL', 'TABLE_CONTENTS',
    'INCL', 'DEVC', 'SYSTEM', 'COMPONENTS', 'STRUCTURE', 'CALLGRAPH',
    'MESSAGES', 'TEXT_ELEMENTS', 'VARIANTS', 'FEATURES']),
  name: z.string().optional(),
  // ... other params per type
});

export const tools = [
  {
    name: 'SAPRead',
    description: 'Read any SAP object...',
    inputSchema: zodToJsonSchema(SAPReadSchema),
  },
  // ... 10 more tools
];
```

#### Test Count Target: ~30 tests (server + handlers)

---

### 5.15 Phase 15: CLI (Days 13–14)

**Goal:** Port minimal CLI using `commander`.

| Go File | Lines | TypeScript File |
|---------|-------|----------------|
| `cmd/arc1/main.go` | 738 | `src/index.ts` + `src/cli.ts` |
| `cmd/arc1/cli.go` | 356 | `src/cli.ts` |
| `cmd/arc1/config_cmd.go` | 982 | *(deferred — only essential commands)* |

#### Minimal CLI Commands (per roadmap requirements)

```
arc1                        # Start MCP server (stdio, default)
arc1 --transport http-streamable  # Start MCP server (HTTP)
arc1 search <query>         # Search objects
arc1 source <type> <name>   # Get source code
arc1 lint <type> <name>     # Lint source
arc1 config list            # List configured systems
arc1 config add <name>      # Add system config
arc1 version                # Show version
```

#### Test Count Target: ~5 tests

---

### 5.16 Phase 16: Server Transports (Day 14)

**Goal:** stdio + HTTP Streamable transports.

```typescript
// stdio transport (default)
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// HTTP Streamable transport
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
```

The MCP SDK provides both transports out of the box. We just need to wire configuration and startup.

#### Test Count Target: ~5 tests

---

### 5.17 Phase 17: Integration Tests (Days 14–15)

**Goal:** Port `pkg/adt/integration_test.go` (1,948 lines, 34 tests).

Integration tests run against a live SAP system. They are skipped if `TEST_SAP_*` env vars are not set.

```typescript
// vitest.integration.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000,  // SAP can be slow
  },
});
```

```typescript
// tests/integration/helpers.ts
export function skipIfNoSAP() {
  if (!process.env.TEST_SAP_URL) {
    return true;  // Skip
  }
  return false;
}

export function getTestClient(): AdtClient {
  return new AdtClient({
    baseUrl: process.env.TEST_SAP_URL!,
    username: process.env.TEST_SAP_USER!,
    password: process.env.TEST_SAP_PASSWORD!,
    client: process.env.TEST_SAP_CLIENT ?? '001',
    language: process.env.TEST_SAP_LANGUAGE ?? 'EN',
    insecure: process.env.TEST_SAP_INSECURE === 'true',
  });
}
```

#### Integration Test Categories

| Category | Tests | Description |
|----------|-------|-------------|
| Read operations | 8 | GetProgram, GetClass, SearchObject, etc. |
| CRUD operations | 6 | Create in $TMP, update, activate, delete |
| DevTools | 4 | SyntaxCheck, Activate, RunUnitTests |
| Transport | 4 | List, create, add object, release |
| Code Intelligence | 3 | FindDefinition, FindReferences |
| System | 3 | GetSystemInfo, GetInstalledComponents, GetFeatures |
| Safety | 3 | Read-only mode, blocked operations |
| DDIC | 3 | GetTable, GetTableContents |

---

### 5.18 Phase 18: Docker & npm Publish (Day 15)

**Goal:** Production-ready Dockerfile and npm publish configuration.

#### Dockerfile

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
RUN npm prune --omit=dev

# Stage 2: Runtime
FROM node:20-alpine
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

USER node

# Connection
ENV SAP_URL=""
ENV SAP_USER=""
ENV SAP_PASSWORD=""
ENV SAP_CLIENT="001"
ENV SAP_LANGUAGE="EN"
ENV SAP_INSECURE="false"

# Safety
ENV SAP_READ_ONLY="false"
ENV SAP_BLOCK_FREE_SQL="false"
ENV SAP_ALLOWED_OPS=""
ENV SAP_DISALLOWED_OPS=""
ENV SAP_ALLOWED_PACKAGES=""
ENV SAP_ALLOW_TRANSPORTABLE_EDITS="false"

# Transport
ENV SAP_TRANSPORT="http-streamable"
ENV SAP_HTTP_ADDR="0.0.0.0:8080"

# Features
ENV SAP_FEATURE_ABAPGIT="auto"
ENV SAP_FEATURE_RAP="auto"
ENV SAP_FEATURE_AMDP="auto"
ENV SAP_FEATURE_UI5="auto"
ENV SAP_FEATURE_TRANSPORT="auto"
ENV SAP_FEATURE_HANA="auto"

ENV SAP_VERBOSE="false"

EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
```

#### npm Publish

```json
{
  "files": ["dist", "bin", "README.md", "LICENSE"],
  "publishConfig": { "access": "public" }
}
```

#### GitHub Actions

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm test

# .github/workflows/docker.yml
name: Docker
on:
  push:
    tags: ['v*']
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          push: true
          platforms: linux/amd64,linux/arm64
          tags: ghcr.io/marianfoo/arc-1:${{ github.ref_name }}
```

---

## 6. Migration Dependency Graph

The following shows the build order — each phase depends on the ones above it:

```
Phase 1: Scaffold
    │
    ▼
Phase 2: ADT HTTP Transport
    │
    ├───────────────────┐
    ▼                   ▼
Phase 3: Safety     Phase 4: Features
    │                   │
    └───────┬───────────┘
            ▼
Phase 5: ADT Read Operations
            │
    ┌───────┼───────────┬──────────────┐
    ▼       ▼           ▼              ▼
Phase 6  Phase 7     Phase 8       Phase 9
CRUD     DevTools    CodeIntel     Transport
    │       │           │              │
    └───────┴───────────┴──────────────┘
            │
            ▼
Phase 10: Remaining ADT (DDIC, UI5, CDS, Auth)
            │
    ┌───────┼───────────┐
    ▼       ▼           ▼
Phase 11 Phase 12   Phase 13
Cache    CtxComp    Lint (@abaplint)
    │       │           │
    └───────┴───────────┘
            │
            ▼
Phase 14: MCP Server & 11 Intent Handlers
            │
    ┌───────┤
    ▼       ▼
Phase 15 Phase 16
CLI      Transports
    │       │
    └───────┘
            │
            ▼
Phase 17: Integration Tests
            │
            ▼
Phase 18: Docker + npm Publish + CI/CD
```

---

## 7. Test Summary

### Unit Tests (Target: ~250)

| Module | Go Tests | TS Tests (Target) | Priority |
|--------|----------|-------------------|----------|
| ADT HTTP | ~20 | ~20 | P0 |
| Safety | 25 | 25 | P0 |
| Features | ~10 | ~10 | P0 |
| ADT Read | ~40 | ~40 | P0 |
| ADT CRUD | ~15 | ~15 | P0 |
| ADT DevTools | ~15 | ~15 | P1 |
| ADT CodeIntel | ~10 | ~10 | P1 |
| ADT Transport | ~10 | ~10 | P1 |
| ADT DDIC/UI5/CDS | ~20 | ~20 | P1 |
| ADT Auth (OAuth/OIDC) | ~15 | ~15 | P1 |
| Cache (memory) | ~8 | ~8 | P1 |
| Cache (sqlite) | ~8 | ~8 | P1 |
| Context Compression | ~15 | ~15 | P2 |
| Lint | ~8 | ~8 | P2 |
| MCP Server | ~15 | ~15 | P0 |
| MCP Handlers | ~15 | ~15 | P0 |
| CLI | ~5 | ~5 | P2 |
| Config | ~10 | ~10 | P1 |
| **Total** | **~264** | **~264** | — |

### Integration Tests (Target: ~34)

| Category | Tests |
|----------|-------|
| Read operations | 8 |
| CRUD operations | 6 |
| DevTools | 4 |
| Transport | 4 |
| Code Intelligence | 3 |
| System | 3 |
| Safety | 3 |
| DDIC | 3 |
| **Total** | **34** |

---

## 8. Go → TypeScript Pattern Mapping

### 8.1 Error Handling

```go
// Go: error return values
func (c *Client) GetProgram(ctx context.Context, name string) (string, error) {
    resp, err := c.http.Get(ctx, url)
    if err != nil {
        return "", fmt.Errorf("failed to get program %s: %w", name, err)
    }
    // ...
}
```

```typescript
// TypeScript: exceptions with typed errors
export class AdtError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly adtMessage?: string,
  ) {
    super(message);
    this.name = 'AdtError';
  }
}

async getProgram(name: string): Promise<string> {
  try {
    const resp = await this.http.get(`/sap/bc/adt/programs/programs/${name}/source/main`);
    return resp.data;
  } catch (err) {
    throw new AdtError(`Failed to get program ${name}`, err.response?.status);
  }
}
```

### 8.2 Context & Cancellation

```go
// Go: context.Context for cancellation
func (c *Client) Search(ctx context.Context, query string) ([]Object, error) {
    resp, err := c.http.Get(ctx, url)
```

```typescript
// TypeScript: AbortSignal for cancellation
async search(query: string, signal?: AbortSignal): Promise<Object[]> {
  const resp = await this.http.get(url, { signal });
```

### 8.3 Interfaces

```go
// Go: implicit interfaces
type Cache interface {
    PutNode(ctx context.Context, node *Node) error
    GetNode(ctx context.Context, id string) (*Node, error)
}
```

```typescript
// TypeScript: explicit interfaces
export interface Cache {
  putNode(node: CacheNode): void;        // better-sqlite3 is synchronous
  getNode(id: string): CacheNode | null;
}
```

### 8.4 Options Pattern

```go
// Go: functional options
type Option func(*Config)
func WithClient(client string) Option { return func(c *Config) { c.Client = client } }
```

```typescript
// TypeScript: object spread with defaults
export interface AdtClientOptions {
  baseUrl: string;
  username?: string;
  password?: string;
  client?: string;    // default: "001"
  language?: string;  // default: "EN"
  insecure?: boolean; // default: false
  // ...
}

const defaults: Partial<AdtClientOptions> = {
  client: '001',
  language: 'EN',
  insecure: false,
};
```

### 8.5 Concurrency

```go
// Go: goroutines + channels
go func() {
    result <- c.fetchData()
}()
```

```typescript
// TypeScript: Promise.all for parallel operations
const [programs, classes] = await Promise.all([
  client.searchPrograms(query),
  client.searchClasses(query),
]);
```

### 8.6 Struct Methods → Class Methods

```go
// Go: methods on struct
func (c *Client) GetProgram(ctx context.Context, name string) (string, error) {
```

```typescript
// TypeScript: class methods
export class AdtClient {
  async getProgram(name: string): Promise<string> {
```

---

## 9. Files to Delete (Go artifacts)

After migration is complete, these Go-specific files are removed:

```
# Go source
cmd/                    # Replaced by src/cli.ts + src/index.ts
internal/               # Replaced by src/server/ + src/handlers/
pkg/                    # Replaced by src/adt/ + src/cache/ + src/context/ + src/lint/

# Go build
go.mod
go.sum
Makefile               # Replaced by package.json scripts
.goreleaser.yml        # No longer needed (npm + Docker)

# Removed features
embedded/              # Embedded ABAP deployment (removed)
```

**Files to keep:**
- `docs/` — all documentation (update references)
- `reports/` — all reports (historical)
- `.github/workflows/` — rewrite for Node.js
- `CLAUDE.md` — update for TypeScript
- `README.md` — rewrite
- `.env.example` — update
- `.gitignore` — update for node_modules, dist/
- `Dockerfile` — rewrite for Node.js
- `cliff.toml` — keep for changelog generation

---

## 10. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| CSRF token handling differences | High — breaks all ADT operations | Study abap-adt-api + fr0ster implementations closely; port HTTP tests first |
| Stateful session behavior | High — breaks CRUD operations | Test lock/modify/unlock sequences in integration tests early |
| XML parsing differences | Medium — wrong data extraction | Create XML fixtures from Go test mocks; compare parsed output |
| better-sqlite3 native addon | Medium — Docker/CI build issues | Use node:20-alpine with build tools; test in CI early |
| @abaplint/core API surface | Low — well-documented package | Use existing abaplint documentation; already TS-native |
| MCP SDK API changes | Low — well-maintained | Pin to specific version; follow SDK changelog |
| Auth token flows (OAuth/OIDC) | Medium — enterprise-critical | Port auth tests first; test with BTP system |
| Performance regression | Low — Node.js is fast for I/O | ADT operations are network-bound, not CPU-bound |

---

## 11. Timeline Estimate

| Phase | Days | Description |
|-------|------|-------------|
| 1 | 1 | Project scaffold |
| 2–3 | 2 | ADT HTTP + Safety |
| 4–5 | 3 | Features + Read operations |
| 6–9 | 4 | CRUD, DevTools, CodeIntel, Transport |
| 10 | 2 | Remaining ADT operations |
| 11–13 | 2 | Cache, Context, Lint |
| 14 | 3 | MCP Server + 11 Handlers |
| 15–16 | 2 | CLI + Transports |
| 17 | 2 | Integration tests |
| 18 | 1 | Docker + npm + CI/CD |
| **Total** | **~22** | **Working days** |

---

## 12. Version Strategy

- Current Go version: `v2.32`
- TypeScript version starts at: `v3.0.0`
- Pre-release tags: `v3.0.0-alpha.1`, `v3.0.0-beta.1`, etc.
- The Go code stays in the repo history (git) but is removed from `main` branch once TS migration is complete

---

## 13. Checklist: Definition of Done

- [ ] All 11 intent-based tools work (SAPRead through SAPManage)
- [ ] All ~264 unit tests pass in Vitest
- [ ] All ~34 integration tests pass against SAP system
- [ ] Safety system enforces all 11 flags correctly
- [ ] Feature detection probes and degrades gracefully
- [ ] Cache (memory + SQLite) stores/retrieves/invalidates correctly
- [ ] Context compression extracts dependencies via @abaplint/core
- [ ] ABAP linting via @abaplint/core returns correct results
- [ ] stdio transport works with Claude Desktop / Claude Code
- [ ] HTTP Streamable transport works with remote clients
- [ ] Docker image builds and runs (multi-arch: amd64/arm64)
- [ ] npm package installs and runs via `npx arc-1`
- [ ] CLI commands work (search, source, lint, config, version)
- [ ] All auth methods work (basic, cookie, OAuth2, OIDC)
- [ ] CI/CD pipeline (test + lint on PR, Docker + npm on tag)
- [ ] CLAUDE.md updated for TypeScript project
- [ ] README.md rewritten for TypeScript
- [ ] .env.example updated
- [ ] No Go source files remain on main branch

---

## 14. Architecture Addendum — Design Rationale & Security Hardening

*Added 2026-03-26 after reviewing MCP spec security requirements (CoSAI threat model, OWASP MCP guide), latest npm versions, and reference implementations (fr0ster, abap-adt-api, lemaiwo).*

### 14.1 Updated Dependency Versions (as of 2026-03-26)

| Package | Version | Notes |
|---------|---------|-------|
| `@modelcontextprotocol/sdk` | `^1.28.0` | Latest MCP SDK with Streamable HTTP + OAuth 2.1 |
| `@abaplint/core` | `^2.115.27` | Full ABAP lexer/parser/linter |
| `axios` | `^1.13.6` | HTTP client with interceptors |
| `better-sqlite3` | `^12.8.0` | Synchronous SQLite (native addon) |
| `commander` | `^14.0.3` | CLI framework |
| `dotenv` | `^17.3.1` | .env file loading |
| `fast-xml-parser` | `^5.5.9` | v5 — breaking changes from v4, uses new API |
| `zod` | `^3.24.0` | Stay on v3 — zod v4 has breaking API changes and the MCP SDK uses zod v3 internally |
| `vitest` | `^4.1.1` | Test framework |
| `typescript` | `~5.8.0` | Stay on TS 5.x — TS 6.0 is too new, ecosystem compatibility uncertain |
| `tsx` | `^4.21.0` | Dev-time TS execution |
| `@biomejs/biome` | `^2.4.8` | Linter + formatter |
| `@types/better-sqlite3` | `^7.6.13` | Type definitions |
| `@types/node` | `^22.0.0` | Match Node 22 LTS types |

**Key version decisions:**
- **zod v3 (not v4):** The MCP SDK uses zod v3 internally. Mixing v3 and v4 causes type incompatibilities. Stay on v3 until the MCP SDK upgrades.
- **TypeScript 5.8 (not 6.0):** TS 6.0 released recently — ecosystem tooling (Vitest, Biome, tsx) may not fully support it yet. 5.8 is stable and battle-tested.
- **Node 22 LTS (not 20):** Node 22 is the current LTS (April 2025). Use it for better performance and ESM support. Keep `engines: ">=20.0.0"` for compatibility.
- **fast-xml-parser v5:** Breaking API change from v4 — `XMLParser` constructor options changed. Worth upgrading since we're starting fresh.

### 14.2 Architecture: Why Intent-Based Tools (Not Per-Object)

**ARC-1's 11 intent-based tools vs. fr0ster's 200+ individual tools:**

fr0ster's approach (one tool per operation per object type) creates tool explosion — `getClass`, `createClass`, `deleteClass`, `getProgram`, `createProgram`, etc. This is problematic for LLMs:

1. **Context window cost:** 200+ tool definitions consume significant prompt space
2. **Tool selection confusion:** LLMs must choose among many similar tools
3. **Maintenance burden:** Adding a new object type requires N new tools

ARC-1's intent-based approach groups operations by *intent* (Read, Write, Search, etc.) with a `type` parameter for routing:

```
SAPRead(type="CLAS", name="ZCL_ORDER")    — reads a class
SAPRead(type="PROG", name="ZREPORT")      — reads a program
SAPRead(type="TABLE", name="MARA")        — reads a table structure
```

**Why this is better for LLMs:**
- **11 tool definitions** instead of 200+ — fits in any context window
- **Natural language alignment** — "read", "write", "search" match how users think
- **Easy extensibility** — new object type = new case in existing handler, no new tool
- **Optimized for mid-tier LLMs** — Copilot Studio, Claude Haiku, etc. handle 11 tools well

*This is ARC-1's key architectural differentiator and must be preserved in the TS port.*

### 14.3 Architecture: ADT HTTP Client Design

**Why build our own instead of using `abap-adt-api` or fr0ster's packages:**

1. **Full control over CSRF lifecycle** — SAP ADT's CSRF behavior has edge cases (token expiry under load, token scope per URL prefix) that generic wrappers don't handle well. Both `abap-adt-api` and fr0ster have had bugs here (see fr0ster's `sessionUtils.ts` evolution).

2. **Stateful session isolation** — CRUD operations require lock → modify → unlock on the same HTTP session (same cookies, same CSRF token). Our `withStatefulSession()` pattern guarantees session isolation. fr0ster uses `AsyncLocalStorage` for this, which is more complex.

3. **Safety integration** — Every HTTP call must pass through the safety checker before reaching SAP. Owning the HTTP layer lets us inject safety checks at the transport level, not the handler level.

4. **Cookie authentication** — ARC-1 supports Netscape cookie files and inline cookie strings (for BTP Cloud Connector scenarios). Neither `abap-adt-api` nor fr0ster supports this.

**What we borrow from reference implementations:**
- **From `abap-adt-api`:** XML parsing patterns for ADT responses, ADT endpoint URLs, object type mappings
- **From fr0ster:** CSRF token fetch pattern, stateful session header conventions (`x-sap-adt-sessiontype`, `sap-adt-connection-id`), guaranteed unlock via try-finally
- **From lemaiwo:** OAuth proxy pattern for XSUAA, destination-based auth

### 14.4 Security Hardening (MCP Spec + OWASP + CoSAI)

Based on the MCP specification (2025-11-25), OWASP MCP guide, and CoSAI threat model:

#### 14.4.1 Input Validation (CoSAI MCP-T3)

Every tool argument must be validated before passing to SAP:

```typescript
// src/handlers/helpers.ts — centralized input sanitization

/** Validate ABAP object names: only A-Z, 0-9, _, /, $ allowed */
export function validateObjectName(name: string): string {
  if (!/^[A-Z0-9_/$]+$/i.test(name)) {
    throw new AdtError(`Invalid object name: ${name}`);
  }
  return name.toUpperCase();
}

/** Validate SQL queries: block destructive statements */
export function validateSqlQuery(sql: string): string {
  const forbidden = /\b(DROP|ALTER|DELETE|UPDATE|INSERT|TRUNCATE|GRANT|REVOKE)\b/i;
  if (forbidden.test(sql)) {
    throw new AdtError('Destructive SQL statements are blocked');
  }
  return sql;
}
```

**Why:** SAP ADT endpoints don't always validate input thoroughly — a malformed object name could trigger unexpected behavior on the SAP side.

#### 14.4.2 Transport Security (CoSAI MCP-T7)

For HTTP Streamable transport:

```typescript
// src/server/transports.ts

// MUST validate Origin header (MCP spec requirement)
// Prevents DNS rebinding attacks (CoSAI MCP-T7)
function validateOrigin(req: IncomingMessage, allowedOrigins: string[]): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // Same-origin requests have no Origin header
  return allowedOrigins.includes(origin);
}

// MUST validate MCP-Protocol-Version header (MCP spec requirement)
function validateProtocolVersion(req: IncomingMessage): boolean {
  const version = req.headers['mcp-protocol-version'];
  return version === '2025-11-25';
}

// Session IDs: cryptographically random, ASCII only (MCP spec)
function generateSessionId(): string {
  return crypto.randomUUID();
}
```

#### 14.4.3 Logging (CoSAI MCP-T12, OWASP)

**Critical:** Never use `console.log()` for stdio transport — it corrupts the JSON-RPC stream.

```typescript
// src/server/logger.ts

// All logging goes to stderr (safe for stdio transport)
// JSON format for cloud deployments, text for local dev
export class Logger {
  private output: 'json' | 'text';

  log(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
    };

    if (this.output === 'json') {
      process.stderr.write(JSON.stringify(entry) + '\n');
    } else {
      process.stderr.write(`[${entry.timestamp}] ${level}: ${message}\n`);
    }
  }
}
```

**Audit fields per tool call (per Datadog + OWASP guidance):**
- Tool name, action, target object
- Authenticated user (from OIDC token if present)
- SAP user used
- Duration (ms)
- Success/error + HTTP status
- MCP session ID (correlation)

#### 14.4.4 Secrets Management

- **Never log credentials** — redact passwords, tokens, cookies from all log output
- **Never expose credentials to LLM** — tool results must not contain auth headers or tokens
- **Cookie security** — `HttpOnly`, `SameSite=Lax` for any cookies we set
- **OAuth state parameters** — cryptographically random, single-use, 10-minute expiry
- **Environment variables** — only way to pass credentials (no config files with secrets)

#### 14.4.5 Rate Limiting (CoSAI MCP-T10)

```typescript
// Simple token bucket per MCP session
// Prevents runaway AI loops from overwhelming SAP
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number = 60,  // requests per minute
    private refillRate: number = 1,   // tokens per second
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  tryConsume(): boolean { /* ... */ }
}
```

### 14.5 Architecture: Layered Error Handling

**Why:** SAP ADT returns errors in multiple formats — HTTP status codes, XML exception bodies, HTML error pages, and sometimes plain text. We need a consistent error model.

```
Layer 1: AdtHttpClient
  ├── Network errors → AdtNetworkError
  ├── HTTP 401/403 → AdtAuthError (with CSRF retry logic)
  ├── HTTP 404 → AdtNotFoundError
  └── HTTP 500 → AdtServerError (parse XML exception body)

Layer 2: ADT Operations (client.ts, crud.ts, etc.)
  ├── Wraps Layer 1 errors with operation context
  └── Adds object name, operation type to error

Layer 3: MCP Handlers (handlers/*.ts)
  ├── Catches all errors
  ├── Returns MCP-formatted error responses
  └── Never leaks internal details to LLM
```

**From fr0ster:** They learned the hard way that generic error handling hides SAP-specific issues. Their `extractAdtErrorMessage()` function parses the XML exception body from SAP to get the actual error message. We should do the same.

### 14.6 Documentation Updates Required

| Document | Action | Reason |
|----------|--------|--------|
| `CLAUDE.md` | **Rewrite** | All Go-specific content replaced with TS equivalents |
| `README.md` | **Rewrite** | Installation (npm), usage, configuration |
| `docs/architecture.md` | **Update** | TS architecture, module structure |
| `docs/tools.md` | **Keep** | Tool descriptions unchanged (same 11 tools) |
| `docs/mcp-usage.md` | **Update** | npm-based setup instead of binary |
| `docs/cli-guide.md` | **Update** | TS CLI commands |
| `docs/docker.md` | **Update** | Node.js Dockerfile |
| `docs/enterprise-auth.md` | **Update** | TS auth implementation references |
| `docs/roadmap.md` | **Update** | Mark migration complete, adjust roadmap items |
| `docs/changelog.md` | **Add** | v3.0.0 entry documenting migration |
| `docs/phase*.md` | **Keep** | Historical auth setup guides |
| `docs/adr/` | **Add** | ADR-004: Go to TypeScript migration decision |
| `.env.example` | **Update** | Same env vars, updated comments |
| `mkdocs.yml` | **Update** | Navigation adjustments |

### 14.7 ARC-1 Naming Consistency

Ensure "ARC-1" (ABAP Relay Connector) is used consistently:

- **npm package name:** `arc-1`
- **CLI binary name:** `arc1`
- **Docker image:** `ghcr.io/marianfoo/arc-1`
- **MCP server name:** `arc-1` (in Server constructor)
- **GitHub repo:** `marianfoo/arc-1`
- **User-facing docs:** "ARC-1" (capitalized, with hyphen)
- **Internal references:** `arc1` (no hyphen, lowercase)

### 14.8 Key Architectural Principles (For Maintainability)

1. **One file per concern** — each ADT operation group gets its own file (read.ts, crud.ts, devtools.ts). No 2,000-line files.

2. **Dependency injection via constructor** — `AdtClient` receives `AdtHttpClient`, `SafetyChecker`, `FeatureProber` via constructor. Makes testing easy (inject mocks).

3. **No global state** — no singletons, no module-level variables. All state lives in class instances. This is critical for HTTP Streamable transport where multiple sessions run concurrently.

4. **Fail fast, fail loud** — validate inputs at the boundary (handler layer). Don't pass invalid data deeper into the stack.

5. **Types over runtime checks** — use TypeScript's type system to prevent invalid states at compile time. Runtime validation (zod) only at MCP boundary where we receive untyped JSON.

6. **Comments explain "why", not "what"** — the code should be self-documenting. Comments explain business rules, SAP quirks, and design decisions.

7. **No unnecessary abstractions** — if there's only one implementation of an interface, don't create the interface. Add it when the second implementation appears.

8. **Test the behavior, not the implementation** — test what the function does (input → output), not how it does it. This allows refactoring without breaking tests.
