# Authorization Roles & Scopes — Objects vs Data

## Overview

Implement a two-dimensional authorization model separating ABAP object access (read/write source code) from SAP data access (table preview, freestyle SQL). Add `data` and `sql` scopes, update XSUAA role templates, add per-request safety config derived from JWT scopes, and add `--profile` shortcuts for local usage.

**Reference document:** `docs/research/2026-04-08-authorization-concept.md` contains the full research, SAP auth object mapping, endpoint inventory, and design rationale. Read it for context.

## Context

### Current State
- Safety system (`src/adt/safety.ts`): 12 operation types, `readOnly`, `blockFreeSQL`, `allowedOps`, `allowedPackages` — all global/server-level
- XSUAA scopes: `read`, `write`, `admin` — enforced per-tool in `src/handlers/intent.ts` via TOOL_SCOPES mapping
- OIDC tokens get hardcoded full scopes (`http.ts:274`: `scopes: ['read', 'write', 'admin']`)
- SAPTransport requires `admin` scope (should be `write` — developers need transports)
- SAPQuery is gated by `read` scope (should be separate — table data != source code)
- No way to separate table data access from object read access

### Target State
- **4 scopes**: `read` (objects), `write` (objects+transports), `data` (named table preview), `sql` (freestyle SQL)
- **Implied scopes**: `write` implies `read`, `sql` implies `data`
- **Per-request safety config**: `deriveUserSafety()` merges server ceiling with JWT scopes (scopes can only restrict, never expand)
- **New config**: `--block-data` / `SAP_BLOCK_DATA` flag for named table preview
- **Profiles**: `--profile viewer|viewer-data|viewer-sql|developer|developer-data|developer-sql`
- **XSUAA**: Renamed templates (MCPViewer, MCPDeveloper, MCPDataViewer, MCPSqlUser), new role collections

### Key Files

| File | Role |
|------|------|
| `src/adt/safety.ts` | Safety config type + operation checking |
| `src/server/config.ts` | CLI/env config parsing |
| `src/server/types.ts` | ServerConfig type |
| `src/handlers/intent.ts` | TOOL_SCOPES mapping + scope enforcement |
| `src/server/http.ts` | OIDC token validation + scope extraction |
| `src/server/xsuaa.ts` | XSUAA token verification + scope extraction |
| `src/server/server.ts` | Tool call handler wiring |
| `src/adt/features.ts` | Feature/auth probing at startup |
| `xs-security.json` | XSUAA scopes, role templates, role collections |

### Design Principles
1. **Server config is the ceiling.** Scopes can only restrict further, never expand. If server says `readOnly=true`, no JWT scope overrides it.
2. **Objects and data are separate dimensions.** Reading source code (`read`) and reading table data (`data`) are different permissions.
3. **Implied scopes:** `write` implies `read`. `sql` implies `data`.
4. **Defense in depth.** Even with principal propagation, ARC-1 enforces scopes. SAP is the final authority.

### Scope Model

| Scope | Category | Description | Op Types | Implies |
|-------|----------|-------------|----------|---------|
| `read` | Objects | Read ABAP source, search, navigate, test, diagnose | R, S, I, T | — |
| `write` | Objects | Create, modify, delete, activate, transport | C, U, D, A, L, W, X | `read` |
| `data` | Data | Preview named table contents | Q | — |
| `sql` | Data | Execute freestyle SQL queries | F | `data` |
| `admin` | Admin | Reserved for future admin features | — | — |

### TOOL_SCOPES Mapping (target)

```
SAPRead: 'read'          SAPWrite: 'write'
SAPSearch: 'read'        SAPActivate: 'write'
SAPNavigate: 'read'      SAPManage: 'write'
SAPContext: 'read'        SAPTransport: 'write'    (was 'admin')
SAPLint: 'read'           SAPQuery: 'data'          (was 'read')
SAPDiagnose: 'read'
```

Note: SAPRead `TABLE_CONTENTS` sub-type calls `getTableContents()` which checks `OperationType.Query` — blocked by `blockData=true` in safety system. The layering works without changing SAPRead's tool scope.

### Profile Mapping

| Profile | readOnly | blockData | blockFreeSQL | enableTransports | allowTransportableEdits |
|---------|----------|-----------|--------------|------------------|----|
| viewer | true | true | true | false | false |
| viewer-data | true | false | true | false | false |
| viewer-sql | true | false | false | false | false |
| developer | false | true | true | true | true |
| developer-data | false | false | true | true | true |
| developer-sql | false | false | false | true | true |

## Development Approach

- **Testing approach**: Regular (code changes + tests in same task)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all existing tests must still pass after each task** (707 unit tests)
- Run `npm test` after every task to verify no regressions
- Run `npm run typecheck` after every task
- Follow existing code patterns (see CLAUDE.md for conventions)
- This is a **breaking change** release — document in commit messages

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add `blockData` to safety system

**Files:**
- Modify: `src/adt/safety.ts`
- Modify: `tests/unit/adt/safety.test.ts`

Add a new `blockData` field to `SafetyConfig` that blocks the `Query` (Q) operation type, analogous to the existing `blockFreeSQL` for `FreeSQL` (F).

- [x] Add `blockData: boolean` field to `SafetyConfig` interface (after `blockFreeSQL`, line ~46)
- [x] Set `blockData: true` in `defaultSafetyConfig()` (safe by default)
- [x] Set `blockData: false` in `unrestrictedSafetyConfig()`
- [x] Add check in `isOperationAllowed()`: `if (config.blockData && op === OperationType.Query) return false;`
- [x] Update `describeSafety()` to include `'NO-DATA'` when `blockData` is true
- [x] Add unit tests (~8 tests): blockData blocks Q, allows F, both blockData+blockFreeSQL, default config blocks Q, unrestricted allows Q, checkOperation throws for Q when blocked, dryRun bypasses blockData
- [x] Run `npm test` — all 707+ existing tests must still pass plus new ones

### Task 2: Add `deriveUserSafety()` function

**Files:**
- Modify: `src/adt/safety.ts`
- Modify: `tests/unit/adt/safety.test.ts`

Add a function that merges server-level safety config (ceiling) with user JWT scopes. Scopes can only RESTRICT, never expand.

- [x] Add `deriveUserSafety(serverConfig: SafetyConfig, scopes: string[]): SafetyConfig` function (export it)
- [x] Logic: no `write` scope → `readOnly=true`, `enableTransports=false`
- [x] Logic: no `data` and no `sql` scope → `blockData=true`
- [x] Logic: no `sql` scope → `blockFreeSQL=true`
- [x] Handle implied scopes inside the function: if `sql` in scopes, treat as having `data`; if `write` in scopes, treat as having `read`
- [x] Key principle: start with `{ ...serverConfig }`, only tighten — never set a boolean from true to false
- [x] Add unit tests (~20 tests): no write → readOnly, no data/sql → blockData, no sql → blockFreeSQL, write scope present → readOnly unchanged, sql scope → blockFreeSQL unchanged, data scope → blockData unchanged, server readOnly=true + write scope → still true (server wins), server blockFreeSQL=true + sql scope → still blocked, server blockData=true + data scope → still blocked, implied scopes (sql but no data → blockData unchanged), empty scopes → most restrictive, scopes with write but no read → readOnly unchanged (write implies read)
- [x] Run `npm test`

### Task 3: Parse `--block-data` and `--profile` in config

**Files:**
- Modify: `src/server/config.ts`
- Modify: `src/server/types.ts`
- Modify: `tests/unit/server/config.test.ts` (or `tests/unit/cli/` — check which exists)

- [x] Add `blockData: boolean` to `ServerConfig` type in `types.ts`
- [x] Add `config.blockData = resolveBool('block-data', 'SAP_BLOCK_DATA', true)` in `config.ts` (default true = safe)
- [x] Add `--block-data` CLI flag registration (follow pattern of `--block-free-sql`)
- [x] Add `--profile` CLI flag (string type) with allowed values: `viewer`, `viewer-data`, `viewer-sql`, `developer`, `developer-data`, `developer-sql`
- [x] When `--profile` is set, apply profile defaults BEFORE individual flag overrides (so `--profile viewer --read-only=false` works — explicit flags win)
- [x] Profile mapping implementation: create a `const PROFILES: Record<string, Partial<ServerConfig>>` map
- [x] Wire `blockData` through to the safety config in `server.ts` where `adtConfig.safety` is built
- [x] Add unit tests (~8 tests): blockData parsed from env, blockData parsed from CLI flag, each profile sets correct defaults, explicit flag overrides profile, unknown profile name errors
- [x] Run `npm test` and `npm run typecheck`

### Task 4: Update TOOL_SCOPES and add `hasRequiredScope()`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

- [x] Change `SAPQuery: 'read'` to `SAPQuery: 'data'` in TOOL_SCOPES
- [x] Change `SAPTransport: 'admin'` to `SAPTransport: 'write'` in TOOL_SCOPES
- [x] Add `hasRequiredScope(authInfo: AuthInfo, requiredScope: string): boolean` function with implied scope logic: `write` implies `read`, `sql` implies `data`
- [x] Replace the inline scope check in `handleToolCall()` (line ~162) to use `hasRequiredScope()` instead of `authInfo.scopes.includes(requiredScope)`
- [x] Add SQL scope check: in the SAPQuery handler (or in handleToolCall before dispatching), if the args indicate freestyle SQL and authInfo exists, check that `authInfo.scopes.includes('sql')` — return clear error if missing
- [x] Update tool listing filter in `server.ts` (where tools are filtered by user scopes) to use the same `hasRequiredScope()` logic so implied scopes work for tool listing too
- [x] Add unit tests (~20 tests): hasRequiredScope direct match, implied write→read, implied sql→data, missing scopes, SAPQuery requires data scope, SAPQuery with sql scope works (implied data), SAPQuery blocked with only read scope, SAPTransport requires write, SAPTransport blocked with read only, SAPTransport allowed with write (no admin needed), freestyle SQL blocked without sql scope, freestyle SQL allowed with sql scope, all read tools still work with read scope
- [x] Run `npm test`

### Task 5: Fix OIDC scope extraction

**Files:**
- Modify: `src/server/http.ts`
- Modify: `tests/unit/server/http.test.ts`

The OIDC token verifier at `http.ts:274` hardcodes `scopes: ['read', 'write', 'admin']` for all OIDC tokens. Fix it to extract scopes from the JWT.

- [x] In the OIDC token validation function (around line 274), replace the hardcoded scopes with extraction from JWT claims: try `payload.scope` (space-separated string, standard OIDC), then `payload.scp` (array, Azure AD style), fallback to `['read', 'write', 'data', 'sql', 'admin']` for backward compat
- [x] Filter to known scopes only: `['read', 'write', 'data', 'sql', 'admin']`
- [x] Apply implied scope expansion: if `sql` present but not `data`, add `data`; if `write` present but not `read`, add `read`
- [x] If no known scopes after filtering, default to `['read']` (minimum access)
- [x] Add unit tests (~7 tests): scope from space-separated string claim, scope from array claim, unknown scopes filtered out, no scope claims → full access fallback, implied scope expansion (sql adds data, write adds read), empty after filter → minimum read
- [x] Run `npm test`

### Task 6: Update XSUAA scope extraction

**Files:**
- Modify: `src/server/xsuaa.ts`
- Modify: `tests/unit/server/xsuaa.test.ts`

Add `data` and `sql` to the XSUAA local scope check, and add implied scope expansion.

- [x] In `createXsuaaTokenVerifier()` (around line 144), add `'data'` and `'sql'` to the scope check loop: `for (const scope of ['read', 'write', 'data', 'sql', 'admin'])`
- [x] After collecting scopes, apply implied scope expansion (same logic as OIDC): `sql` → add `data`, `write` → add `read`
- [x] Add unit tests (~4 tests): data scope extracted, sql scope extracted, implied scope expansion after extraction, legacy tokens (only read/write/admin) still work
- [x] Run `npm test`

### Task 7: Wire per-request safety config in server.ts

**Files:**
- Modify: `src/server/server.ts`

Connect `deriveUserSafety()` to the tool call handler so per-request safety config is applied based on JWT scopes.

- [x] Import `deriveUserSafety` from `src/adt/safety.ts`
- [x] In the tool call handler (where `handleToolCall` is called), before passing the config, derive per-request safety: `const effectiveSafety = authInfo?.scopes ? deriveUserSafety(config.safety, authInfo.scopes) : config.safety`
- [x] Pass the effective safety config to the AdtClient or handleToolCall (check how the safety config flows from server.ts → intent.ts → client operations and adjust accordingly)
- [x] Ensure the tool listing handler also uses `hasRequiredScope()` for filtering (may already be done in Task 4)
- [x] Run `npm test` and `npm run typecheck`

### Task 8: Update xs-security.json

**Files:**
- Modify: `xs-security.json`

Update XSUAA configuration to match the new scope model. This is a config-only change.

- [x] Add `$XSAPPNAME.data` scope: `"description": "Preview named table contents"`
- [x] Add `$XSAPPNAME.sql` scope: `"description": "Execute freestyle SQL queries (implies data)"`
- [x] Rename role template `MCPReader` → `MCPViewer` with scope `[$XSAPPNAME.read]`
- [x] Rename role template `MCPEditor` → `MCPDeveloper` with scopes `[$XSAPPNAME.read, $XSAPPNAME.write]`
- [x] Keep `MCPAdmin` with scopes `[$XSAPPNAME.read, $XSAPPNAME.write, $XSAPPNAME.admin]`
- [x] Add `MCPDataViewer` role template with scope `[$XSAPPNAME.data]` (additive)
- [x] Add `MCPSqlUser` role template with scopes `[$XSAPPNAME.data, $XSAPPNAME.sql]` (additive)
- [x] Update role collections: "ARC-1 Viewer" → MCPViewer, "ARC-1 Developer" → MCPDeveloper, add "ARC-1 Data Viewer" (MCPViewer + MCPDataViewer), add "ARC-1 Developer + Data" (MCPDeveloper + MCPDataViewer), add "ARC-1 Developer + SQL" (MCPDeveloper + MCPSqlUser)
- [x] Run `npm test` (config change should not break any tests)

### Task 9: Add startup authorization probe

**Files:**
- Modify: `src/adt/features.ts`
- Modify: `tests/unit/adt/features.test.ts` (if exists, else add tests)

Extend the existing feature probe mechanism to check basic SAP authorization at startup and log warnings.

- [x] Read the existing `probeFeatures()` function in `features.ts` to understand the pattern (HEAD requests, 2xx = available, 404/error = not available)
- [x] Add a lightweight authorization probe that runs after feature probing: try a search request (`GET /sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=CL_ABAP_*&maxResults=1`) — if 403, log warning about missing search authorization
- [x] Optionally probe transport access: `GET /sap/bc/adt/cts/transportrequests?user=__PROBE__` — if 403, log info that transport access is not available (not a warning since many setups don't need it)
- [x] Log results at info level (not error) — missing authorization is informational, not a server error
- [x] Do NOT probe write operations (too risky — would modify state)
- [x] Add unit tests if the feature probe tests exist, otherwise skip
- [x] Run `npm test`

### Task 10: Update CLAUDE.md and documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md` (if scope model is documented there)

- [x] Update the configuration table in CLAUDE.md: add `SAP_BLOCK_DATA` / `--block-data`, add `ARC1_PROFILE` / `--profile`
- [x] Update the "Key Files for Common Tasks" table if needed
- [x] If README.md documents scopes or roles, update to reflect new 4-scope model
- [x] Do NOT create new documentation files unless they already exist — keep changes minimal
- [x] Run `npm test` and `npm run lint`

### Task 11: Final verification

- [x] Run full test suite: `npm test` — all tests pass (existing + new)
- [x] Run typecheck: `npm run typecheck` — no errors
- [x] Run lint: `npm run lint` — no errors
- [x] Verify the scope model is consistent: grep for old scope references (search for `'admin'` in TOOL_SCOPES context, hardcoded scopes in http.ts)
- [x] Verify implied scope logic is applied in ALL auth paths: XSUAA (xsuaa.ts), OIDC (http.ts), tool listing filter (server.ts), tool call scope check (intent.ts)
- [x] Move this plan to `docs/plans/completed/`
