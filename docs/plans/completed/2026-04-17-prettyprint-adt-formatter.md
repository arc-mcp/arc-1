# PrettyPrint (ADT Code Formatter)

## Overview

Add ABAP PrettyPrint via SAP's native ADT `prettyprinter` endpoint as a new **SAPLint** action (`format`), plus settings read/write actions. This is FEAT-10 from `docs/roadmap.md`: dassian-adt and VSP both ship PrettyPrint; ARC-1 currently does not. Placing it on SAPLint (alongside `lint` and `lint_and_fix`) keeps all code-quality / formatting operations under one tool.

Unlike the existing SAPLint actions (which run offline via `@abaplint/core`), PrettyPrint hits the SAP system. It uses the system-wide formatter settings (indentation on/off, keyword style `keywordUpper`/`keywordLower`/`keywordAuto`/`none`) — so the format always matches whatever the ABAP developer community on that SAP system has agreed on. That is the main reason this exists alongside `lint_and_fix`: `lint_and_fix` enforces abaplint's opinionated rules; `format` enforces the SAP system's own settings.

Endpoints verified live against the A4H test system (see `INFRASTRUCTURE.md`):
- `POST /sap/bc/adt/abapsource/prettyprinter` — body is raw ABAP source (`text/plain; charset=utf-8`), response is formatted ABAP source (`text/plain`). Requires CSRF token (auto-managed by `AdtHttpClient.post`).
- `GET /sap/bc/adt/abapsource/prettyprinter/settings` — returns `<abapformatter:PrettyPrinterSettings indentation="true" style="keywordUpper" xmlns:abapformatter="http://www.sap.com/adt/prettyprintersettings"/>` under `Accept: application/vnd.sap.adt.ppsettings.v2+xml`.
- `PUT /sap/bc/adt/abapsource/prettyprinter/settings` with same body shape writes global settings.

## Context

### Current State

- `src/handlers/intent.ts:1073-1128` — `handleSAPLint` supports only `lint`, `lint_and_fix`, `list_rules`. The `_client` parameter is prefixed with `_` because none of these actions hit SAP.
- `src/adt/devtools.ts` has `syntaxCheck`, `activate`, `runUnitTests`, `runAtcCheck`, `getFixProposals`, `applyFixProposal`, `publishServiceBinding` etc. No PrettyPrint.
- `docs/compare/00-feature-matrix.md:160` — ARC-1 PrettyPrint row is `❌`.
- `docs/roadmap.md:48,560` — FEAT-10 listed as P1, XS, **Not started**.

### Target State

- A new `format` action on SAPLint that POSTs source to `/sap/bc/adt/abapsource/prettyprinter` and returns formatted source.
- Two settings actions on SAPLint: `get_formatter_settings` (GET) and `set_formatter_settings` (PUT).
- Full unit test coverage for the new client functions (mocked `undici`).
- Smoke E2E test that calls `SAPLint(action="format")` against the A4H test system.
- Docs/roadmap/feature matrix updated.

### Key Files

| File | Role |
|------|------|
| `src/adt/devtools.ts` | Host the new `prettyPrint`, `getPrettyPrinterSettings`, `setPrettyPrinterSettings` client functions |
| `src/adt/safety.ts` | `OperationType.Intelligence` ('I') for `format`, `OperationType.Read`/`OperationType.Update` for settings |
| `src/handlers/intent.ts` | `handleSAPLint` — add three new action cases; drop `_client` underscore since `format` + settings use it |
| `src/handlers/tools.ts` | SAPLint tool definition — extend description + action enum |
| `src/handlers/schemas.ts` | `SAPLintSchema` — extend action enum + add `indentation`, `style` optional fields |
| `tests/unit/adt/devtools.test.ts` | Unit tests for the three new functions (mocked HTTP) |
| `tests/unit/handlers/intent.test.ts` (if present) | Add action-dispatch tests for SAPLint `format`/settings |
| `tests/e2e/smoke.e2e.test.ts` | Add one `SAPLint format` smoke test against A4H |
| `docs/tools.md` | SAPLint section — document three new actions |
| `CLAUDE.md` | "Key Files for Common Tasks" — note SAPLint now has server-side actions |
| `docs/roadmap.md` | Move FEAT-10 from "Not yet implemented" to "Completed" |
| `docs/compare/00-feature-matrix.md` | PrettyPrint row — flip ARC-1 ❌ → ✅ |
| `README.md` | SAPLint bullet — mention PrettyPrint |

### Design Principles

1. **Host on SAPLint, not a new tool.** The user mental model "I want this code formatted" sits next to "I want this code linted". XS feature — no new tool, no new scope.
2. **Use `OperationType.Intelligence` for `format`.** It's a stateless transformation of provided source — not a read of a SAP object, not a write. Mirrors how completion/code-intelligence is classified.
3. **`set_formatter_settings` is gated by `readOnly`.** It modifies system-wide state; use `OperationType.Update` so `--read-only=true` (default) blocks it.
4. **No lock/unlock cycle.** PrettyPrint is stateless; no transport; no package check needed (source is supplied by the caller, not an SAP object ref).
5. **CSRF handled by `AdtHttpClient.post`.** Pattern already proven in `devtools.ts` — `checkOperation` then `http.post(path, body, 'text/plain; charset=utf-8', { Accept: 'text/plain' })`.
6. **Return raw text for `format`.** Do not wrap in JSON — consumers will feed the result straight back into SAPWrite. Use `textResult(resp.body)`.
7. **Return structured JSON for `*_formatter_settings`.** `{ indentation: boolean, style: 'keywordUpper' | 'keywordLower' | 'keywordAuto' | 'none' }`.

## Development Approach

- Build bottom-up: add client functions first, then wire through the handler, then schema/tool-def, then tests, then docs.
- Every task ends with `npm test` to catch regressions.
- Do **not** invoke the live A4H system from unit tests — mock `undici` following the existing pattern in `tests/unit/adt/devtools.test.ts:18-27`.
- The E2E smoke test is optional but low-cost (one POST) and confirms end-to-end wiring.
- Biome formatting is auto-fixed by the pre-commit hook — don't hand-format.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add `prettyPrint` + settings client functions in `src/adt/devtools.ts`

**Files:**
- Modify: `src/adt/devtools.ts`

Add three new exported functions to the devtools module. Mirror the signature and safety-check style of the existing `syntaxCheck` function at `src/adt/devtools.ts:17-36`. The endpoints were verified live against the A4H test system.

- [ ] Add `export async function prettyPrint(http: AdtHttpClient, safety: SafetyConfig, source: string): Promise<string>`:
  - Call `checkOperation(safety, OperationType.Intelligence, 'PrettyPrint')`
  - Call `http.post('/sap/bc/adt/abapsource/prettyprinter', source, 'text/plain; charset=utf-8', { Accept: 'text/plain' })`
  - Return `resp.body`
- [ ] Add `export interface PrettyPrinterSettings { indentation: boolean; style: 'keywordUpper' | 'keywordLower' | 'keywordAuto' | 'none' }`
- [ ] Add `export async function getPrettyPrinterSettings(http: AdtHttpClient, safety: SafetyConfig): Promise<PrettyPrinterSettings>`:
  - Call `checkOperation(safety, OperationType.Read, 'GetPrettyPrinterSettings')`
  - Call `http.get('/sap/bc/adt/abapsource/prettyprinter/settings', { Accept: 'application/vnd.sap.adt.ppsettings.v2+xml' })`
  - Parse the XML (use `parseXml` from `./xml-parser.js` like other devtools functions). Extract `@_abapformatter:indentation` ("true"/"false") and `@_abapformatter:style` from the root `abapformatter:PrettyPrinterSettings` element. Default to `{ indentation: true, style: 'keywordUpper' }` if attributes are missing.
- [ ] Add `export async function setPrettyPrinterSettings(http: AdtHttpClient, safety: SafetyConfig, settings: PrettyPrinterSettings): Promise<void>`:
  - Call `checkOperation(safety, OperationType.Update, 'SetPrettyPrinterSettings')`
  - Build XML body: `<?xml version="1.0" encoding="utf-8"?><abapformatter:PrettyPrinterSettings abapformatter:indentation="${settings.indentation}" abapformatter:style="${settings.style}" xmlns:abapformatter="http://www.sap.com/adt/prettyprintersettings"/>`
  - Call `http.put('/sap/bc/adt/abapsource/prettyprinter/settings', body, 'application/vnd.sap.adt.ppsettings.v2+xml')`
- [ ] Update the module header comment (line 1-8) to list PrettyPrint among the tools.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm test` — all existing tests must still pass.

### Task 2: Unit tests for the three new client functions

**Files:**
- Modify: `tests/unit/adt/devtools.test.ts`

Mirror the mock pattern already at `tests/unit/adt/devtools.test.ts:18-27` (`mockHttp` factory). Unit tests must not hit the network.

- [ ] Import `prettyPrint`, `getPrettyPrinterSettings`, `setPrettyPrinterSettings` from `../../../src/adt/devtools.js` (add to the existing import block at lines 1-13).
- [ ] Add `describe('prettyPrint', ...)` block (~4 tests):
  - Returns formatted source on 200: mock `post` to return body `"REPORT ztest.\nDATA lv TYPE string.\n"`; assert returned string matches.
  - Passes `text/plain; charset=utf-8` Content-Type and `Accept: text/plain`: assert `post` was called with those exact args.
  - Hits the correct endpoint path `/sap/bc/adt/abapsource/prettyprinter`: assert `post.mock.calls[0][0]`.
  - Blocked by `readOnly`? No — `Intelligence` is a read-class op, so a readOnly config must still allow it. Assert no throw on `readOnly: true` config (use `defaultSafetyConfig()`).
- [ ] Add `describe('getPrettyPrinterSettings', ...)` block (~3 tests):
  - Parses a realistic XML response `<abapformatter:PrettyPrinterSettings abapformatter:indentation="true" abapformatter:style="keywordUpper" xmlns:abapformatter="http://www.sap.com/adt/prettyprintersettings"/>` → `{ indentation: true, style: 'keywordUpper' }`.
  - Parses `indentation="false"` and `style="keywordLower"` correctly.
  - Falls back to `{ indentation: true, style: 'keywordUpper' }` when attributes are missing.
- [ ] Add `describe('setPrettyPrinterSettings', ...)` block (~3 tests):
  - Sends the expected XML body (assert `put.mock.calls[0][1]` contains both attributes).
  - Uses the `application/vnd.sap.adt.ppsettings.v2+xml` Content-Type.
  - Throws `AdtSafetyError` when called with a `readOnly: true` config (this is a write op — use `defaultSafetyConfig()` and assert `.toThrow(AdtSafetyError)`).
- [ ] Run `npm test` — all tests (new + existing) pass.

### Task 3: Extend `SAPLintSchema` in `src/handlers/schemas.ts`

**Files:**
- Modify: `src/handlers/schemas.ts`

The Zod schema at `src/handlers/schemas.ts:394-399` restricts `action` to three values. Extend it.

- [ ] Change the `action` enum to `['lint', 'lint_and_fix', 'list_rules', 'format', 'get_formatter_settings', 'set_formatter_settings']`.
- [ ] Add optional fields for the `set_formatter_settings` payload:
  - `indentation: z.coerce.boolean().optional()`
  - `style: z.enum(['keywordUpper', 'keywordLower', 'keywordAuto', 'none']).optional()`
- [ ] Do NOT add conditional required-ness via `.refine()` — keep it consistent with `SAPDiagnoseSchema` (all fields optional, handler validates). The handler (Task 5) validates action-specific requirements with `errorResult()`.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm test` — all tests pass.

### Task 4: Extend SAPLint tool definition in `src/handlers/tools.ts`

**Files:**
- Modify: `src/handlers/tools.ts`

The tool definition at `src/handlers/tools.ts:738-766` is what the MCP client sees. Update it to advertise the new actions.

- [ ] Extend the `description` string (line 741-747) to mention the three new actions. Keep the "Actions:" bullet list style. Add:
  - `- "format": Pretty-print ABAP source via SAP's ADT formatter (uses the SAP system's global formatter settings). Requires source. Returns the formatted source.`
  - `- "get_formatter_settings": Read the SAP system's global PrettyPrinter settings (indentation, keyword style). No params.`
  - `- "set_formatter_settings": Update the SAP system's global PrettyPrinter settings. Requires indentation (bool) and/or style (keywordUpper|keywordLower|keywordAuto|none). Blocked in read-only mode.`
- [ ] Add a short note that `format` calls SAP (vs `lint`/`lint_and_fix`/`list_rules` which run offline). E.g. at the end of the description: `Note: lint/lint_and_fix/list_rules run locally; format/*_formatter_settings call the SAP system.`
- [ ] Extend the `action` enum in `inputSchema.properties.action.enum` from `['lint', 'lint_and_fix', 'list_rules']` to include the three new actions.
- [ ] Add `indentation: { type: 'boolean', description: 'PrettyPrinter: indent source (for set_formatter_settings)' }` and `style: { type: 'string', enum: ['keywordUpper', 'keywordLower', 'keywordAuto', 'none'], description: 'PrettyPrinter: keyword casing (for set_formatter_settings)' }` to `inputSchema.properties`.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm test` — all tests pass.

### Task 5: Wire the new actions into `handleSAPLint` in `src/handlers/intent.ts`

**Files:**
- Modify: `src/handlers/intent.ts`

The handler at `src/handlers/intent.ts:1075-1128` currently treats `_client` as unused. Two of the three new actions need the live ADT client.

- [ ] Rename `_client: AdtClient` → `client: AdtClient` in the function signature at line 1076. Update the comment at line 1073-1074 to say "Some actions (format, *_formatter_settings) hit SAP; others run offline via @abaplint/core."
- [ ] Import the three new functions at the top of `intent.ts` from `../adt/devtools.js` (find the existing import block that imports from `../adt/devtools.js` — add `prettyPrint`, `getPrettyPrinterSettings`, `setPrettyPrinterSettings`, and the `PrettyPrinterSettings` type).
- [ ] Add three new `case` branches inside the `switch (action)` at line 1084, before the `default` at line 1123:
  - `case 'format': { const source = String(args.source ?? ''); if (!source) return errorResult('"source" is required for format action.'); const formatted = await prettyPrint(client.http, client.safety, source); return textResult(formatted); }`
  - `case 'get_formatter_settings': { const settings = await getPrettyPrinterSettings(client.http, client.safety); return textResult(JSON.stringify(settings, null, 2)); }`
  - `case 'set_formatter_settings': { const indentation = args.indentation as boolean | undefined; const style = args.style as PrettyPrinterSettings['style'] | undefined; if (indentation === undefined && !style) return errorResult('At least one of "indentation" or "style" is required for set_formatter_settings.'); const current = await getPrettyPrinterSettings(client.http, client.safety); const next: PrettyPrinterSettings = { indentation: indentation ?? current.indentation, style: style ?? current.style }; await setPrettyPrinterSettings(client.http, client.safety, next); return textResult(JSON.stringify(next, null, 2)); }`
- [ ] Update the error message in the `default` branch at line 1125 to list all six actions.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm test` — all tests pass.

### Task 6: Handler unit tests for the three new actions

**Files:**
- Modify: `tests/unit/handlers/intent.test.ts` (if it exists) OR create `tests/unit/handlers/saplint-format.test.ts`

First check whether `tests/unit/handlers/intent.test.ts` exists. If yes, add to it; if no, create a new focused test file. Use `vi.mock` to stub the devtools functions so we test handler wiring in isolation.

- [ ] Add test: `SAPLint format` happy path — mock `prettyPrint` to return a known string, dispatch `SAPLint` with `{ action: 'format', source: 'report ztest.' }`, assert result text equals the mocked return value.
- [ ] Add test: `SAPLint format` without source returns error "\"source\" is required for format action.".
- [ ] Add test: `SAPLint get_formatter_settings` — mock `getPrettyPrinterSettings` to return `{ indentation: true, style: 'keywordUpper' }`, assert result is that JSON.
- [ ] Add test: `SAPLint set_formatter_settings` with only `style` preserves existing `indentation` (mock `getPrettyPrinterSettings` for the merge path, assert `setPrettyPrinterSettings` called with merged settings).
- [ ] Add test: `SAPLint set_formatter_settings` with neither `indentation` nor `style` returns error.
- [ ] Add test: `SAPLint` with an unknown action mentions `format`/`get_formatter_settings`/`set_formatter_settings` in the error message (regression-guards Task 5's `default` update).
- [ ] Run `npm test` — all tests pass.

### Task 7: E2E smoke test for `SAPLint format` against the A4H system

**Files:**
- Modify: `tests/e2e/smoke.e2e.test.ts`

The existing SAPLint smoke test is at `tests/e2e/smoke.e2e.test.ts:168-177`. Add a second test immediately after it. The test hits the live SAP system via the running MCP server (see `tests/e2e/helpers.ts`).

- [ ] Add a new `it('SAPLint — formats ABAP source via ADT PrettyPrinter', ...)` test:
  - Call `callTool(client, 'SAPLint', { action: 'format', source: 'report ztest.\ndata lv type string.\n' })`.
  - `expectToolSuccess(result)` to extract the text body.
  - Assert the response includes uppercased keywords (`REPORT`, `DATA`) — the A4H default is `keywordUpper`. Use case-sensitive `.toContain('REPORT')` and `.toContain('DATA')`.
  - Do NOT assert exact whitespace — SAP's formatter is free to change indentation based on system settings.
- [ ] Add a second `it('SAPLint — reads formatter settings', ...)` test:
  - Call `callTool(client, 'SAPLint', { action: 'get_formatter_settings' })`.
  - Parse the JSON body; assert it has `indentation` (boolean) and `style` (one of the four enum values).
- [ ] Do NOT add an E2E test for `set_formatter_settings` — that would mutate global state on the test system; rely on unit tests.
- [ ] Run `npm run test:e2e` if you can (requires running MCP server per `CLAUDE.md`). If the MCP server isn't running, `npm test` still covers the unit path — note this in the task summary.

### Task 8: Documentation updates — SAPLint, CLAUDE.md, feature matrix, roadmap

**Files:**
- Modify: `docs/tools.md`
- Modify: `CLAUDE.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `docs/roadmap.md`
- Modify: `README.md`

Update all artifacts per the ralphex-plan skill's doc-audit checklist.

- [ ] **`docs/tools.md`** — at `docs/tools.md:486` (SAPLint section):
  - Extend the `action` row in the Parameters table to list all six actions.
  - Add `indentation` and `style` rows to the Parameters table (with short descriptions).
  - Add three bullets to the "Actions:" list (after the `list_rules` bullet at line 503) for `format`, `get_formatter_settings`, `set_formatter_settings`.
  - Add a "Response shapes" entry for `format` (plain text — formatted source) and for the settings actions (JSON `{ indentation, style }`).
  - Add three new example lines at the end of the Examples block (line ~544):
    ```
    SAPLint(action="format", source="report ztest. data lv type string.")
    SAPLint(action="get_formatter_settings")
    SAPLint(action="set_formatter_settings", style="keywordLower")
    ```
  - Add a note: `format` and `*_formatter_settings` hit the SAP system (unlike the local actions).
- [ ] **`CLAUDE.md`** — "Key Files for Common Tasks" table: add a row `| Add/modify PrettyPrint action | \`src/adt/devtools.ts\`, \`src/handlers/intent.ts\` (handleSAPLint), \`src/handlers/tools.ts\`, \`src/handlers/schemas.ts\` |`. Place it near the SAPLint-related rows (grep for `SAPLint` / `abaplint` in the table).
- [ ] **`docs/compare/00-feature-matrix.md:160`** — change the ARC-1 column (first data column) from `❌` to `✅` on the PrettyPrint row. Also update any "Last Updated" date near the top of the file if present.
- [ ] **`docs/roadmap.md`**:
  - Remove the `FEAT-10` row from the "Not Yet Implemented" overview table (line 48) — re-number subsequent rows in that section.
  - Add `| FEAT-10 | PrettyPrint (Code Formatting) | 2026-04-17 | Features |` to the "Overview: Completed" table (line 88 area), in the correct date order.
  - Replace the `FEAT-10` detail block at line 560-576:
    - Change `**Status**` to `Done`
    - Replace the `**Why not:**` block with a short "**Resolution:**" paragraph pointing to `docs/plans/completed/2026-04-17-prettyprint-adt-formatter.md` and noting that it's exposed as SAPLint actions `format` / `get_formatter_settings` / `set_formatter_settings`.
  - Remove or update the `2026-04-14 priority re-evaluation` sentence (line 148) that mentions pretty-print urgency — at minimum add "(completed)" next to FEAT-10.
  - Remove the `FEAT-10` line at line 190 (already a stale `~~...~~` strikethrough) if it's now redundant.
- [ ] **`README.md:81`** — extend the SAPLint row: `| **SAPLint** | Local ABAP lint (system-aware presets, auto-fix, pre-write validation) + ADT PrettyPrint (server-side formatting) |`.
- [ ] No new config flags or env vars are introduced, so `docs/cli-guide.md`, `.env.example`, `src/server/config.ts`, `src/server/types.ts` do NOT need updates.
- [ ] No changes to authentication/scope model, so `docs/authorization.md`, `docs/security-guide.md`, `xs-security.json` do NOT need updates (SAPLint already maps to `read` scope in `TOOL_SCOPES` at `src/handlers/intent.ts:141` — the new actions inherit that, and the handler-level safety check gates `set_formatter_settings` via `readOnly`).
- [ ] Run `npm test` — all tests pass.

### Task 9: Skills audit — update `.claude/commands/*.md` if they reference SAPLint actions

**Files:**
- Modify (conditionally): `.claude/commands/implement-feature.md`, `.claude/commands/docs/compare-projects.md`, `.claude/commands/update-competitor-tracker.md`, `.claude/commands/ralphex-plan.md`

The ralphex-plan skill mandates a skills audit. Keep this scoped — only touch skills that reference SAPLint or PrettyPrint.

- [ ] Grep `.claude/commands/` for `SAPLint`, `lint_and_fix`, `PrettyPrint`, `pretty`. If any skill lists SAPLint's action set, extend it with `format`, `get_formatter_settings`, `set_formatter_settings`.
- [ ] If `implement-feature.md` has a formatting-related step, mention that `SAPLint(action="format")` is now available as an alternative to `lint_and_fix`.
- [ ] No changes are required to the ralphex-plan skill itself.
- [ ] If the grep finds no references, this task is a no-op (document that in the task summary).
- [ ] Run `npm test` — all tests pass.

### Task 10: Final verification

- [ ] Run full test suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors. (Biome fixes are auto-applied by the pre-commit hook; only hard errors need manual attention.)
- [ ] Manual sanity check against A4H:
  ```bash
  curl -sS -u DEVELOPER:UBqEYcdvsVLtkiiCU1UHdKeT -H "sap-client: 001" \
    -c /tmp/c.txt -b /tmp/c.txt -I -X HEAD \
    "http://65.109.59.210:50000/sap/bc/adt/abapsource/prettyprinter" \
    -H "x-csrf-token: fetch"
  # Extract x-csrf-token from response headers, then:
  curl -sS -u DEVELOPER:UBqEYcdvsVLtkiiCU1UHdKeT -H "sap-client: 001" \
    -b /tmp/c.txt -c /tmp/c.txt \
    -H "x-csrf-token: <token>" \
    -H "Content-Type: text/plain; charset=utf-8" -H "Accept: text/plain" \
    -X POST "http://65.109.59.210:50000/sap/bc/adt/abapsource/prettyprinter" \
    --data-binary $'report ztest.\ndata lv type string.\n'
  ```
  Expect uppercased keywords in the response (matches the default `keywordUpper` style).
- [ ] Verify `docs/roadmap.md` renders correctly (no broken table rows, FEAT-10 moved to Completed section).
- [ ] Verify `docs/compare/00-feature-matrix.md` row 160 shows ARC-1 as `✅`.
- [ ] Move this plan file from `docs/plans/completed/2026-04-17-prettyprint-adt-formatter.md` to `docs/plans/completed/2026-04-17-prettyprint-adt-formatter.md`.
- [ ] Stage a single commit with message `feat: FEAT-10 SAPLint PrettyPrint (ADT code formatter)` — the release-please `feat:` prefix triggers a minor bump.
