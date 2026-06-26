# Zod v4 Input Validation

## Overview

Upgrade Zod from v3 (unused) to v4 and introduce runtime input validation for all 11 MCP tool calls. Currently, tool input schemas are hand-written JSON Schema objects in `src/handlers/tools.ts`, and argument validation in `src/handlers/intent.ts` is ad-hoc `String(args.x ?? '')`/`Number(args.y ?? default)` coercion that can drift from the schema definitions. Zod v4 provides a single source of truth: define schemas once, derive both JSON Schema (for MCP tool listings via `z.toJSONSchema()`) and runtime validation from them.

This also makes the feature matrix entry honest — row 212 claims "Zod v3" for input validation, but Zod is not actually imported anywhere in the codebase.

## Context

### Current State

- `package.json` lists `"zod": "^3.24.0"` but it is **never imported** in `src/` or `tests/`
- 11 tools defined with hand-written JSON Schema in `src/handlers/tools.ts` (lines 282-596)
- Each handler in `src/handlers/intent.ts` manually coerces args: `String(args.type ?? '')`, `Number(args.maxRows ?? 100)`, `Boolean(args.expand_includes)`
- Required-field checks are scattered across handlers: `if (!source) return errorResult('"source" is required...')`
- BTP vs on-prem conditional schemas use separate type arrays (`SAPREAD_TYPES_ONPREM` vs `SAPREAD_TYPES_BTP`)
- Error formatting for LLM clients exists in `formatErrorForLLM()` (lines 112-129) — handles `AdtApiError`, `AdtNetworkError`, not validation errors
- Feature matrix (`docs/compare/00-feature-matrix.md` line 212) claims "Zod v3" — inaccurate since Zod is unused

### Target State

- Zod v4 schemas defined in `src/handlers/schemas.ts` — one schema per tool, with BTP variants
- `handleToolCall()` validates args via `schema.safeParse(args)` before dispatching to handlers
- Validation errors formatted as LLM-friendly messages with field paths and expected values
- `getToolDefinitions()` derives `inputSchema` from Zod via `z.toJSONSchema()`
- Handlers receive typed, validated args — no more manual coercion
- Feature matrix updated to "Zod v4"

### Key Files

| File | Role |
|------|------|
| `src/handlers/schemas.ts` | **NEW** — Zod v4 schemas for all 11 tools |
| `src/handlers/zod-errors.ts` | **NEW** — Format Zod validation errors for LLM clients |
| `src/handlers/intent.ts` | Add validation step in `handleToolCall()`, remove manual coercion from handlers |
| `src/handlers/tools.ts` | Replace hand-written JSON Schema with `z.toJSONSchema()` |
| `src/handlers/hyperfocused.ts` | Add schema for universal `SAP` tool |
| `tests/unit/handlers/schemas.test.ts` | **NEW** — Zod schema unit tests |
| `tests/unit/handlers/zod-errors.test.ts` | **NEW** — Error formatting tests |
| `tests/unit/handlers/tools.test.ts` | Update existing schema tests |
| `tests/unit/handlers/intent.test.ts` | Update existing handler tests |
| `package.json` | Upgrade zod from `^3.24.0` to `^4.0.0` |
| `docs/compare/00-feature-matrix.md` | Update row 212: "Zod v3" → "Zod v4" |
| `docs/roadmap.md` | Add FEAT-30 entry for Zod v4 input validation |
| `docs/architecture.md` | Add validation layer to request flow diagram |
| `CLAUDE.md` | Add `schemas.ts` and `zod-errors.ts` to codebase structure and key files tables |
| `.claude/commands/implement-feature.md` | Update Phase 3.c reference from "use zod schemas" to reflect actual implementation |

### Design Principles

1. **Validation is additive** — Zod validation runs before existing handler logic. If validation passes, the handler receives the same data it always did, just typed. Existing error handling (AdtApiError, AdtSafetyError, etc.) is unchanged.
2. **Single source of truth** — Zod schemas define both runtime validation and MCP tool listing schemas. No more hand-written JSON Schema that can drift from handler logic.
3. **Coercion for MCP compatibility** — Use `z.coerce.number()` for numeric fields because MCP clients may send `"100"` as a string. Use `z.coerce.boolean()` for boolean fields.
4. **BTP variants as separate schemas** — `SAPReadSchema` (on-prem, 23 types) and `SAPReadSchemaBtp` (BTP, 19 types) are separate Zod schemas, selected at validation time based on `config.systemType`.
5. **LLM-friendly errors** — Validation errors include field paths, expected values, and received values. Formatted consistently with existing `errorResult()` pattern.
6. **No handler signature changes** — Handlers still receive `Record<string, unknown>` (which is now validated). Typed args can be added later as a follow-up.

## Development Approach

- Each task is self-contained and can be executed in a fresh Claude Code session
- Tests are written alongside implementation (not strictly TDD, since we're replacing existing working behavior)
- Tasks are ordered to minimize cross-task dependencies: schemas first, then validation, then JSON Schema derivation, then cleanup
- The existing test suite must pass after every task — no regressions

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Upgrade Zod to v4 and create schema definitions

**Files:**
- Modify: `package.json`
- Create: `src/handlers/schemas.ts`
- Create: `tests/unit/handlers/schemas.test.ts`

Upgrade Zod from v3 to v4 and define Zod schemas for all 11 MCP tools. The schemas must match the existing hand-written JSON Schema in `src/handlers/tools.ts` exactly — same required fields, same enum values, same defaults.

- [ ] In `package.json`, change `"zod": "^3.24.0"` to `"zod": "^4.0.0"` and run `npm install`
- [ ] Create `src/handlers/schemas.ts` with Zod v4 schemas for all 11 tools. Reference the existing JSON Schema definitions in `src/handlers/tools.ts` (lines 282-596) for exact field names, types, enums, and required fields. Key details:
  - **SAPRead**: `type` required (enum from `SAPREAD_TYPES_ONPREM` at line 37-62), `name`/`include`/`group`/`method` optional strings, `expand_includes` optional boolean (on-prem only), `maxRows` optional number default 100, `sqlFilter` optional string. Create a separate `SAPReadSchemaBtp` using `SAPREAD_TYPES_BTP` (line 65-85) without `expand_includes`.
  - **SAPSearch**: `query` required string, `maxResults` optional number default 50, `searchType` optional enum `['quick', 'source_code']` (only when text search available), `objectType` optional string, `packageName` optional string. Built dynamically by `buildSAPSearchTool()` (line 224-270).
  - **SAPQuery**: `sql` required string, `maxRows` optional number default 100
  - **SAPWrite**: `action` required enum `['create', 'update', 'delete', 'edit_method']`, `type` required string (enum from `SAPWRITE_TYPES_ONPREM`/`_BTP` at lines 95-96), `name` required string, `source`/`method`/`package`/`transport`/`description` optional strings. Create BTP variant.
  - **SAPActivate**: `name` optional string, `type` optional string, `objects` optional array of `{type: string, name: string}`
  - **SAPNavigate**: `action` required enum `['find_definition', 'find_references', 'where_used', 'completion', 'element_info', 'expand_includes']`, `uri`/`type`/`name`/`objectType`/`source` optional strings, `line`/`column` optional numbers
  - **SAPLint**: `action` required enum `['lint', 'lint_and_fix']`, `source`/`name` optional strings, `rules` optional record
  - **SAPDiagnose**: `action` required enum `['atc_run', 'atc_customizing', 'short_dumps', 'short_dump_detail', 'profiler_list', 'profiler_detail']`, `name`/`type`/`variant`/`id`/`user`/`analysis` optional strings, `maxResults` optional number
  - **SAPTransport**: `action` required enum `['list', 'get', 'create', 'release']`, `id`/`description`/`user` optional strings
  - **SAPContext**: `name` required string, `action` optional enum `['compress', 'list_methods', 'get_method']`, `type`/`source`/`group`/`method` optional strings, `maxDeps`/`depth` optional numbers
  - **SAPManage**: `action` required enum `['probe', 'features', 'cache_stats', 'invalidate_cache']`
  - Use `z.coerce.number()` for all numeric fields (MCP clients may send strings)
  - Use `z.coerce.boolean()` for boolean fields
  - Export a `getToolSchema(toolName: string, isBtp: boolean): ZodSchema | undefined` function
- [ ] Add unit tests (~25 tests) in `tests/unit/handlers/schemas.test.ts`:
  - Each schema accepts valid input matching the tool's required/optional fields
  - Each schema rejects missing required fields
  - Enum fields reject invalid values
  - Number coercion works (`"100"` → `100`)
  - Boolean coercion works (`"true"` → `true`)
  - BTP variants reject on-prem-only types (e.g., `PROG` for SAPRead)
  - Default values are applied (maxRows=100, maxResults=50)
  - `getToolSchema()` returns correct schema for each tool name
- [ ] Run `npm test` — all tests must pass

### Task 2: Add Zod error formatting

**Files:**
- Create: `src/handlers/zod-errors.ts`
- Create: `tests/unit/handlers/zod-errors.test.ts`

Create a formatting function that converts Zod v4 validation errors into LLM-friendly messages. These should be consistent with the existing error style in `src/handlers/intent.ts` — the `errorResult()` function (line 106) returns `{ content: [{ type: 'text', text: message }], isError: true }`.

- [ ] Create `src/handlers/zod-errors.ts` with a `formatZodError(error: ZodError, toolName: string): string` function. The output should be a multi-line string like:
  ```
  Invalid arguments for SAPRead:
    - "type": got "PROGG", expected one of: PROG, CLAS, INTF, ...
    - "maxRows": expected number, got string
  
  Hint: Check the tool schema for valid parameter types and values.
  ```
  Handle these Zod v4 issue types (note: Zod v4 changed error structure from v3):
  - `invalid_enum_value` → show received value and valid options
  - `invalid_type` → show expected vs received type
  - `unrecognized_keys` → list unknown parameter names
  - `missing_keys` / required field missing → show which fields are required
  - Default case → show the Zod message as-is
- [ ] Add unit tests (~10 tests) in `tests/unit/handlers/zod-errors.test.ts`:
  - Format error for invalid enum value
  - Format error for missing required field
  - Format error for wrong type
  - Format error for multiple issues at once
  - Format error for unrecognized keys
  - Output includes tool name
  - Output includes hint line
- [ ] Run `npm test` — all tests must pass

### Task 3: Wire validation into handleToolCall

**Files:**
- Modify: `src/handlers/intent.ts`

Add Zod validation to `handleToolCall()` in `src/handlers/intent.ts`. The validation step goes after the scope check (line ~195) and before the switch statement (line ~200). This is the core integration point.

- [ ] Import `getToolSchema` from `./schemas.js` and `formatZodError` from `./zod-errors.js`
- [ ] Add validation logic after the scope check block (around line 198), before `return requestContext.run(...)`:
  ```typescript
  const schema = getToolSchema(toolName, isBtpMode(config));
  if (schema) {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      return errorResult(formatZodError(parsed.error, toolName));
    }
    args = parsed.data; // Use validated, coerced, defaulted args
  }
  ```
  Note: `isBtpMode()` is defined in `src/handlers/tools.ts` (line 30) — import or replicate the check (`config.systemType === 'btp'`). Also consider passing `textSearchAvailable` for the SAPSearch schema variant (check if `cachedFeatures?.textSearch` is available).
- [ ] For hyperfocused mode (`case 'SAP'`), validation happens on the recursive `handleToolCall()` call after args are expanded, so no special handling needed here. But add a basic schema for the hyperfocused `SAP` tool itself in `schemas.ts` if not already done: `{ action: string, type?: string, name?: string, params?: Record<string, unknown> }`.
- [ ] Verify that the validation doesn't break existing handler tests. The key concern is that handlers currently receive `Record<string, unknown>` and do their own coercion. After validation, `args` will contain Zod-parsed values (strings are already strings, numbers are already numbers, defaults are applied). Handlers that do `String(args.type ?? '')` will still work because `String('PROG')` === `'PROG'`.
- [ ] Update existing handler tests in `tests/unit/handlers/intent.test.ts` if any fail due to validation rejecting previously-accepted invalid input. For example, if a test passes `{}` as args for SAPRead (missing required `type`), it will now fail at validation. Fix these test cases to pass valid args.
- [ ] Add new tests (~5 tests) in `tests/unit/handlers/intent.test.ts` for validation behavior:
  - Tool call with invalid enum value returns validation error (not SAP error)
  - Tool call with missing required field returns validation error
  - Tool call with valid args passes through to handler
  - Validation error is marked as `isError: true`
  - Validation error message includes the tool name
- [ ] Run `npm test` — all tests must pass

### Task 4: Replace hand-written JSON Schema with Zod-derived schemas

**Files:**
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/tools.test.ts`

Replace the hand-written `inputSchema` objects in `src/handlers/tools.ts` with Zod-derived JSON Schema using `z.toJSONSchema()`. This makes the Zod schemas the single source of truth for both validation and tool listing.

- [ ] Import the Zod schemas from `./schemas.js` and `z` from `zod`
- [ ] For each tool definition in `getToolDefinitions()` (lines 282-596), replace the hand-written `inputSchema: { type: 'object', properties: {...}, required: [...] }` with `inputSchema: z.toJSONSchema(SchemaName)`. Use the BTP variants when `isBtpMode(config)` is true.
- [ ] Handle the `SAPSearch` conditional schema: when `textSearchAvailable === false`, use a variant without the `source_code` search type. Create `SAPSearchSchemaNoSource` in `schemas.ts` if not already present.
- [ ] Handle the `expand_includes` conditional property in SAPRead: only present when `!btp`. The BTP variant schema already excludes it, so `z.toJSONSchema(SAPReadSchemaBtp)` handles this.
- [ ] Remove the now-unused hand-written constant arrays: `SAPREAD_TYPES_ONPREM`, `SAPREAD_TYPES_BTP`, `SAPWRITE_TYPES_ONPREM`, `SAPWRITE_TYPES_BTP`, `SAPCONTEXT_TYPES_ONPREM`, `SAPCONTEXT_TYPES_BTP`, and the `SAPREAD_DESC_ONPREM`/`SAPREAD_DESC_BTP` strings (keep tool descriptions in the tool definitions, just derive the schema part from Zod).
- [ ] Verify that `z.toJSONSchema()` output matches what the MCP SDK expects: `{ type: 'object', properties: {...}, required: [...] }`. Zod v4's `z.toJSONSchema()` returns standard JSON Schema draft-2020-12. The MCP SDK uses `zod-to-json-schema` internally for its own schemas, so this should be compatible.
- [ ] **Important**: Ensure every array property still has an `items` definition. There's an existing test in `tests/unit/handlers/tools.test.ts` for this (Issue #47, OpenAI compatibility). Verify `z.toJSONSchema()` includes `items` for `z.array()` schemas.
- [ ] **Important**: Zod v4 uses `.meta({ description: '...' })` instead of `.describe()` for JSON Schema descriptions. Add `.meta()` to schema fields that need descriptions in the JSON Schema output (e.g., parameter descriptions that help LLMs understand the field).
- [ ] Update tests in `tests/unit/handlers/tools.test.ts`:
  - Existing tests should still pass (tool names, required fields, schema structure)
  - The "every array property has items" test should still pass
  - Update any snapshot-style tests that docs/compare exact schema output
- [ ] Run `npm test` — all tests must pass

### Task 5: Clean up manual coercion in handlers

**Files:**
- Modify: `src/handlers/intent.ts`

Now that Zod validation runs before handlers, remove the manual `String()`/`Number()`/`Boolean()` coercion from each handler. The validated `args` object already has the correct types and defaults applied.

- [ ] In `handleSAPRead()` (line ~339): Remove `String(args.type ?? '')`, `String(args.name ?? '')`, etc. Use `args.type`, `args.name` directly. Zod guarantees `type` is a valid enum string, `name` is `string | undefined`, `maxRows` defaults to 100.
- [ ] In `handleSAPSearch()` (line ~549): Remove `String(args.query ?? '')`, `Number(args.maxResults ?? 100)`. Zod guarantees `query` is a string, `maxResults` defaults to 50.
- [ ] In `handleSAPQuery()` (line ~586): Remove `String(args.sql ?? '')`, `Number(args.maxRows ?? 100)`.
- [ ] In `handleSAPLint()` (line ~635): Remove `String(args.action ?? '')`, `String(args.source ?? '')`.
- [ ] In `handleSAPWrite()` (line ~886): Remove coercion for `action`, `type`, `name`, `source`, `transport`.
- [ ] In `handleSAPNavigate()` (line ~1097): Remove coercion for `action`, `uri`, `line`, `column`, `source`.
- [ ] In `handleSAPDiagnose()` (line ~1183): Remove coercion for `action`, `name`, `type`.
- [ ] In `handleSAPTransport()` (line ~1251): Remove coercion for `action`.
- [ ] In `handleSAPActivate()` (line ~1059): Remove coercion for `type`, simplify array handling.
- [ ] In `handleSAPContext()` (line ~1290): Remove coercion for `action`, `type`, `name`, `maxDeps`, `depth`. Remove `Math.min(Math.max(Number(args.depth ?? 1), 1), 3)` — add depth clamping to the Zod schema instead (`.min(1).max(3).default(1)`) in `schemas.ts`.
- [ ] In `handleSAPManage()`: Remove coercion for `action`.
- [ ] Remove ad-hoc required-field checks that Zod now handles. For example, in `handleSAPLint()`: `if (!source) return errorResult('"source" is required for lint action.')` — but **only** remove checks for fields that are unconditionally required in the Zod schema. Some checks are conditional (e.g., `source` is required for `lint` action but not for listing rules), so keep those — Zod's object-level schema doesn't express action-dependent requirements.
- [ ] Run `npm test` — all existing tests must pass. Fix any tests that break due to the removal of coercion (e.g., tests that relied on `String(undefined)` returning `'undefined'`).

### Task 6: Update documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/architecture.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `.claude/commands/implement-feature.md`

Update all documentation to reflect the Zod v4 integration.

- [ ] **CLAUDE.md** — Codebase Structure section:
  - Add `src/handlers/schemas.ts` with description "Zod v4 input schemas for all MCP tools"
  - Add `src/handlers/zod-errors.ts` with description "Zod validation error formatting for LLM clients"
  - In the "Key Files for Common Tasks" table, add a row: "Add/modify tool input schema" → `src/handlers/schemas.ts`, `src/handlers/tools.ts`
  - In the "Code Patterns" section, add a "Tool Input Schema" pattern example showing how to define a Zod schema and use it
  - In the "Technology Stack" table, update zod entry or add one: `zod v4` → "Tool input validation & JSON Schema generation"
- [ ] **docs/architecture.md** — Request Flow section:
  - Add a "Zod Validation" step between "Scope check" and "Route to handler" in the request flow diagram (around line 76-103). The flow should show: `Scope check → Zod validation (schemas.ts) → Route to handler`
  - Brief description: "All tool arguments are validated against Zod schemas before reaching handler logic. Invalid input is rejected with structured error messages."
- [ ] **docs/roadmap.md** — Add FEAT-30 entry after FEAT-29:
  ```
  ### FEAT-30: Zod v4 Input Validation
  | Field | Value |
  |-------|-------|
  | **Priority** | 🟠 P1 |
  | **Effort** | M (3-5 days) |
  | **Risk** | Low |
  | **Usefulness** | High — runtime safety, better LLM error messages |
  | **Status** | ✅ Complete |
  
  **What:** Runtime input validation for all 11 MCP tools using Zod v4 schemas as single source of truth. Replaces hand-written JSON Schema and ad-hoc argument coercion.
  ```
  Also add FEAT-30 to the Prioritized Execution Order, Phase B (Core Value Features), after existing items.
- [ ] **docs/compare/00-feature-matrix.md** — line 212: Change `Zod v3` to `Zod v4` in the ARC-1 column
- [ ] **.claude/commands/implement-feature.md** — Phase 3.c (line ~116): Update the bullet `- **Input validation**: use zod schemas in tool definitions` to reference the actual file: `- **Input validation**: define Zod v4 schemas in src/handlers/schemas.ts — see existing schemas for pattern`
- [ ] Run `npm run lint` — ensure no lint errors in markdown files

### Task 7: Add E2E validation error test

**Files:**
- Modify: `tests/e2e/smoke.e2e.test.ts`

Add an E2E test that verifies validation errors are properly returned through the full MCP protocol stack. This test requires a running ARC-1 server (auto-skipped if `E2E_MCP_URL` is not set).

- [ ] Read the E2E test helpers in `tests/e2e/helpers.ts` to understand the `connectClient()`, `callTool()`, `expectToolError()` pattern
- [ ] Add a test case in `tests/e2e/smoke.e2e.test.ts` that calls `SAPRead` with an invalid `type` value (e.g., `type: 'INVALID_TYPE'`) and verifies:
  - The response has `isError: true`
  - The error message contains "Invalid arguments"
  - The error message mentions the invalid value
  - The error does NOT contain raw XML or stack traces (use `expectToolError()`)
- [ ] Add a test case that calls `SAPRead` with missing `type` field and verifies a validation error is returned
- [ ] Run `npm test` — all unit tests must pass (E2E tests only run with `npm run test:e2e`)

### Task 8: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify that the Zod schemas match the tool definitions by running `npm test` and checking that the "every array property has items" test (Issue #47) still passes
- [ ] Verify that `z.toJSONSchema()` output is valid JSON Schema by inspecting one tool's schema in a test
- [ ] Verify no `console.log` statements were added (stdout is sacred for MCP JSON-RPC)
- [ ] Move this plan to `docs/plans/completed/`
