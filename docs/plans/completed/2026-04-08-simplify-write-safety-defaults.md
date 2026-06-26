# Simplify Write Safety: Default $TMP, Remove allowTransportableEdits, Enforce Package Allowlist

## Overview

This plan simplifies ARC-1's write safety model by making three key changes:

1. **Default `allowedPackages` to `['$TMP']`** when writes are enabled — so out-of-the-box, the AI can only write to the local/throwaway package. Writing to transportable packages requires explicit opt-in via `--allowed-packages`.
2. **Remove `allowTransportableEdits`** — this flag is redundant with the package allowlist. If `allowedPackages` only contains `$TMP`, transportable writes are impossible. If it includes `Z*`, the user already opted into transportable writes.
3. **Actually enforce `checkPackage()`** — the function exists and is tested but is **never called in production code**. The `create` action in `handleSAPWrite` extracts `pkg` (line 933 of intent.ts) but never validates it against `allowedPackages`. This is a safety bug.

Additionally: fix npx examples in docs (add `@latest`, use `-y` flag consistently, add `SAP_CLIENT`), and add package restriction info to tool descriptions so the LLM knows what it's allowed to write to.

## Context

### Current State

- `readOnly=false` is the default (line 117 of types.ts) — writes are enabled out of the box
- `allowedPackages` defaults to `[]` (empty = unrestricted) — no package restriction
- `allowTransportableEdits` is a separate boolean flag that gates whether a transport ID can be passed to write operations
- `enableTransports` gates the SAPTransport tool (list/create/release)
- **Critical bug**: `checkPackage()` in `safety.ts:148` is defined and unit-tested but never called from any handler or CRUD operation — the package allowlist is completely unenforced
- `checkTransportableEdit()` in `safety.ts:229` is called from `crud.ts:61,81` but is redundant with a properly enforced package allowlist
- Tool descriptions for SAPWrite don't tell the LLM which packages it's restricted to
- npx examples in docs use `["-y", "arc-1"]` instead of `["-y", "arc-1@latest"]` and are missing `SAP_CLIENT`

### Target State

- `allowedPackages` defaults to `['$TMP']` — safe out of the box
- `allowTransportableEdits` removed from codebase entirely (config, safety, types, tests, docs)
- `checkPackage()` enforced in `handleSAPWrite` for `create` action and in `createObject()` for defense-in-depth
- `enableTransports` simplified: gates SAPTransport tool only (no more dual-flag interaction with `allowTransportableEdits`)
- SAPWrite tool description includes allowed packages info so the LLM knows its boundaries
- Error messages guide users on how to widen package access
- npx examples use `arc-1@latest` and include `SAP_CLIENT` where relevant

### Key Files

| File | Role |
|------|------|
| `src/server/types.ts` | `ServerConfig` interface, `DEFAULT_CONFIG` |
| `src/adt/safety.ts` | `SafetyConfig`, `checkPackage()`, `checkTransportableEdit()`, `checkTransport()`, `deriveUserSafety()`, `describeSafety()` |
| `src/adt/crud.ts` | `createObject()`, `safeUpdateSource()` — CRUD with safety checks |
| `src/server/config.ts` | `PROFILES`, `parseArgs()` — config parsing |
| `src/server/server.ts` | `buildAdtConfig()` — maps ServerConfig → SafetyConfig |
| `src/handlers/intent.ts` | `handleSAPWrite()` — write handler, package enforcement point |
| `src/handlers/tools.ts` | Tool definitions, descriptions, registration conditions |
| `src/handlers/hyperfocused.ts` | Hyperfocused mode transport action condition |
| `src/handlers/schemas.ts` | Zod schemas for SAPWrite, SAPTransport |
| `tests/unit/adt/safety.test.ts` | Safety system tests |
| `tests/unit/adt/transport.test.ts` | Transport function tests |
| `tests/unit/handlers/tools.test.ts` | Tool registration/visibility tests |
| `tests/unit/server/config.test.ts` | Config parsing / profile tests |
| `docs/index.md` | Getting started, MCP client config examples |
| `docs/tools.md` | Tool reference |
| `docs/authorization.md` | Auth model, safety config |
| `docs/security-guide.md` | Security best practices |
| `docs/setup-guide.md` | Setup reference, config table |
| `docs/cli-guide.md` | CLI reference |
| `README.md` | Quick start |
| `CLAUDE.md` | Config table, codebase structure |

### Design Principles

1. **Safe by default** — enabling writes should not give unrestricted access. `$TMP` is the safe sandbox.
2. **Explicit opt-in for danger** — writing to transportable packages (`--allowed-packages "Z*"`) is a conscious choice.
3. **Package allowlist is the single gate** — no redundant `allowTransportableEdits` flag. The package filter naturally handles the `$TMP` vs transportable distinction.
4. **LLM awareness** — the tool description tells the LLM which packages it can write to, so it doesn't waste tool calls on blocked operations.
5. **Breaking changes are OK** — this project is pre-release. No backward-compat shims for `allowTransportableEdits`.
6. **Defense in depth** — enforce `checkPackage()` both in the handler (early, good error message) and in CRUD (safety net).

## Development Approach

Tasks are ordered: types/safety core first, then wiring, then config/profiles, then tool descriptions, then tests, then docs. Each task runs `npm test` to verify. Unit tests only — this is a code-only change (no new SAP interaction).

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Remove `allowTransportableEdits` from types and safety core

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/adt/safety.ts`

Remove the `allowTransportableEdits` field and its associated functions from the core type definitions and safety module. This is the foundation that all other tasks depend on.

- [x] In `src/server/types.ts`: remove `allowTransportableEdits: boolean` from `ServerConfig` interface (line 44). Remove `allowTransportableEdits: false` from `DEFAULT_CONFIG` (line 123).
- [x] In `src/adt/safety.ts`: remove `allowTransportableEdits: boolean` from `SafetyConfig` interface (line 55). Remove from `defaultSafetyConfig()` (line 71) and `unrestrictedSafetyConfig()` (line 88).
- [x] In `src/adt/safety.ts`: delete the entire `checkTransportableEdit()` function (lines 228-247) and its export.
- [x] In `src/adt/safety.ts`: simplify `checkTransport()` (lines 188-226). The read-check at line 189 currently uses `config.enableTransports || config.allowTransportableEdits` — change to just `config.enableTransports`. Remove the special error message about `--allow-transportable-edits` at lines 202-206.
- [x] In `src/adt/safety.ts`: update `deriveUserSafety()` (line 280) — remove `effective.allowTransportableEdits = false` line.
- [x] In `src/adt/safety.ts`: update `describeSafety()` (line 312) — remove the `TRANSPORTABLE-EDITS-ALLOWED` label.
- [x] Change default `allowedPackages` in `DEFAULT_CONFIG` from `[]` to `['$TMP']` (line 122 of types.ts). This makes `$TMP` the default write sandbox.
- [x] Run `npm run typecheck` to find any remaining references to `allowTransportableEdits` that need cleanup — fix all type errors.
- [x] Run `npm test` — some tests will fail (expected, will fix in Task 5).

### Task 2: Remove `allowTransportableEdits` from CRUD and enforce `checkPackage()`

**Files:**
- Modify: `src/adt/crud.ts`
- Modify: `src/handlers/intent.ts`

Remove the `checkTransportableEdit()` calls from CRUD operations and add the missing `checkPackage()` enforcement. Currently `checkPackage()` exists in `safety.ts:148` but is never called — this is a safety bug.

- [x] In `src/adt/crud.ts`: remove `import { checkTransportableEdit }` (line 14). Remove the `if (transport) checkTransportableEdit(...)` call in `createObject()` (line 61) and `safeUpdateSource()` (line 81).
- [x] In `src/handlers/intent.ts`: in `handleSAPWrite()`, add `checkPackage()` enforcement for the `create` action. After `const pkg = String(args.package ?? '$TMP')` at line 933, add: `checkPackage(client.safety, pkg)`. Import `checkPackage` from `../adt/safety.js`. This validates the target package against `allowedPackages` before creating the object.
- [x] Ensure the error message from `checkPackage()` (in safety.ts) is LLM-friendly. The current message at line 150-152 says: `Operations on package '${pkg}' are blocked by safety configuration (allowed: ${JSON.stringify(config.allowedPackages)})`. This is good — it tells the LLM which packages ARE allowed.
- [x] Run `npm test` — verify no regressions from CRUD changes.

### Task 3: Update config parsing and profiles

**Files:**
- Modify: `src/server/config.ts`
- Modify: `src/server/server.ts`

Remove `allowTransportableEdits` from profiles and config parsing. Update the `allowedPackages` default behavior.

- [x] In `src/server/config.ts`: remove `allowTransportableEdits: false` from all three `viewer*` profiles (lines 75, 82, 89) and `allowTransportableEdits: true` from all three `developer*` profiles (lines 97, 103, 111).
- [x] In `src/server/config.ts`: remove the `allowTransportableEdits` parsing block (lines 201-206) that reads `--allow-transportable-edits` / `SAP_ALLOW_TRANSPORTABLE_EDITS`.
- [x] In `src/server/config.ts`: update `allowedPackages` parsing (lines 199-200). Currently if no packages are configured, it sets `[]`. After the change, if no explicit `--allowed-packages` is set AND no profile overrides it, keep the DEFAULT_CONFIG default of `['$TMP']`. The current code `config.allowedPackages = pkgs ? pkgs.split(',').map((p) => p.trim()) : []` should change the empty case to not override the default. Change to: if `pkgs` is non-empty, split it; otherwise leave `config.allowedPackages` unchanged (it already has `['$TMP']` from DEFAULT_CONFIG).
- [x] In `src/server/config.ts`: for `developer*` profiles, set `allowedPackages: ['$TMP']` explicitly. This makes it clear that developer profiles default to local-only writes. Users who need broader access use `--allowed-packages "Z*,$TMP"`.
- [x] In `src/server/server.ts`: remove `allowTransportableEdits: config.allowTransportableEdits` from the safety config object in `buildAdtConfig()` (line 61).
- [x] Run `npm test` — some tests will fail (expected, will fix in Task 5).

### Task 4: Update tool descriptions and registration

**Files:**
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/hyperfocused.ts`

Update SAPWrite tool description to tell the LLM which packages are allowed. Simplify SAPTransport registration. This is critical for LLM awareness — the LLM needs to know it can only write to `$TMP` (or whatever packages are configured).

- [x] In `src/handlers/tools.ts`: update `buildToolDefinitions()` to accept `allowedPackages` from config (it already receives `config: ServerConfig`). Append package restriction info to the SAPWrite description. For example, if `allowedPackages` is `['$TMP']`, append: `' Write access is restricted to package: $TMP. Objects in other packages cannot be created or modified.'`. If `allowedPackages` is `['Z*', '$TMP']`, append: `' Write access is restricted to packages: Z*, $TMP.'`. If `allowedPackages` is empty (unrestricted), append nothing.
- [x] In `src/handlers/tools.ts`: update SAPTransport tool registration condition at line 581. Change from `if (config.enableTransports || !config.readOnly)` to `if (config.enableTransports)`. The SAPTransport tool should only appear when transports are explicitly enabled. Without `allowTransportableEdits`, the `!config.readOnly` fallback is no longer meaningful — users writing to `$TMP` don't need transport management.
- [x] In `src/handlers/hyperfocused.ts`: update the admin actions condition at line 93. Change from `config.enableTransports || !config.readOnly` to just `config.enableTransports`.
- [x] Run `npm test` — tool visibility tests will need updating in Task 5.

### Task 5: Update all unit tests

**Files:**
- Modify: `tests/unit/adt/safety.test.ts`
- Modify: `tests/unit/adt/transport.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`
- Modify: `tests/unit/server/config.test.ts`

Update all tests to reflect the removal of `allowTransportableEdits`, the new `$TMP` default, the `checkPackage` enforcement, and the simplified transport gating. This task is large because tests span 4 files, but each file is independent.

- [x] In `tests/unit/adt/safety.test.ts`: remove all `allowTransportableEdits` from safety config objects in tests. Remove the `checkTransportableEdit` import (line 5) and its test block (around lines 251-272). Update `checkTransport` tests (around lines 229-249) to remove dual-flag scenarios — transport read now only checks `enableTransports`. Update `deriveUserSafety` tests to remove `allowTransportableEdits` assertions. Update any test that creates a `SafetyConfig` object to exclude `allowTransportableEdits`.
- [x] In `tests/unit/adt/safety.test.ts`: add new tests for `checkPackage` with the `$TMP` default. Test: default config (`allowedPackages: ['$TMP']`) allows `$TMP` but blocks `ZTEST`. Test: `allowedPackages: ['Z*', '$TMP']` allows both. Test: `allowedPackages: []` allows anything (unrestricted — for `--allowed-packages "*"` equivalent).
- [x] In `tests/unit/adt/transport.test.ts`: remove all `allowTransportableEdits` from safety config objects. Update `listTransports` test (around lines 44-49) that tested `allowTransportableEdits: true` enabling read access — this scenario no longer exists. `listTransports` read access now requires `enableTransports: true`. Update all safety config objects to exclude `allowTransportableEdits`.
- [x] In `tests/unit/handlers/tools.test.ts`: update SAPTransport visibility tests. The test at line 48-52 ("hides SAPTransport in read-only mode without enableTransports") stays. The key change: SAPTransport should now ALSO be hidden when `readOnly: false` but `enableTransports: false` — previously it was shown via the `!config.readOnly` fallback. Add test: SAPTransport hidden when `readOnly: false, enableTransports: false`. Add test: SAPTransport shown when `enableTransports: true`.
- [x] In `tests/unit/server/config.test.ts`: update profile tests to remove `allowTransportableEdits` assertions. Update developer profile test to verify `allowedPackages: ['$TMP']`. Update the `allowedPackages` default test (around lines 102-105): when not configured, should now be `['$TMP']` not `[]`. Add test: `--allowed-packages "Z*,$TMP"` overrides the default.
- [x] Add new test in `tests/unit/handlers/intent.test.ts` (or appropriate test file): verify that `handleSAPWrite` with `create` action rejects packages not in `allowedPackages`. Mock a write call with `package: 'ZTEST'` when `allowedPackages: ['$TMP']` — should throw `AdtSafetyError`.
- [x] Run `npm test` — all tests must pass.
- [x] Run `npm run typecheck` — no errors.

### Task 6: Update documentation — setup, tools, auth, security

**Files:**
- Modify: `docs/index.md`
- Modify: `docs/tools.md`
- Modify: `docs/authorization.md`
- Modify: `docs/security-guide.md`
- Modify: `docs/setup-guide.md`
- Modify: `docs/cli-guide.md`
- Modify: `docs/deployment-best-practices.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`

Update all documentation to reflect the simplified safety model, new defaults, and fixed npx examples. Remove all references to `allowTransportableEdits` / `--allow-transportable-edits` / `SAP_ALLOW_TRANSPORTABLE_EDITS`.

- [x] In `docs/index.md`: fix all npx examples. Change `"args": ["-y", "arc-1"]` to `"args": ["-y", "arc-1@latest"]` in both Claude Desktop (line 65) and Claude Code (line 85) examples. Add `"SAP_CLIENT": "100"` to the env blocks. Add a write access example showing how to enable write access with package restriction:
  ```json
  {
    "mcpServers": {
      "sap": {
        "command": "npx",
        "args": ["-y", "arc-1@latest"],
        "env": {
          "SAP_URL": "https://your-sap-host:44300",
          "SAP_USER": "your-username",
          "SAP_PASSWORD": "your-password",
          "SAP_CLIENT": "100",
          "SAP_ALLOWED_PACKAGES": "*"
        }
      }
    }
  }
  ```
  Add a note explaining: by default, write access is limited to `$TMP` (local objects). To write to custom packages, set `SAP_ALLOWED_PACKAGES` (e.g., `"Z*,$TMP"` for Z-packages, or `"*"` for unrestricted).
- [x] In `docs/tools.md`: update SAPWrite section (around line 82-99). Add note about package restriction default. Remove any mention of `--allow-transportable-edits`. Update SAPTransport section (around line 181-195): note it requires `--enable-transports` (remove "or not in read-only mode" condition).
- [x] In `docs/authorization.md`: remove all references to `allowTransportableEdits` and `--allow-transportable-edits`. Update the safety config controls section (around lines 145-160). Update profile tables to remove the transport edits column. Explain the new default: writes are restricted to `$TMP` unless `--allowed-packages` is set.
- [x] In `docs/security-guide.md`: remove `--allow-transportable-edits` from the safety configuration table (around lines 95-122). Update the profile reference table. Add note about `$TMP` default.
- [x] In `docs/setup-guide.md`: remove `--allow-transportable-edits` / `SAP_ALLOW_TRANSPORTABLE_EDITS` from config table (around line 639). Update quick reference. Fix npx examples to use `arc-1@latest`. Add `SAP_CLIENT` to examples.
- [x] In `docs/cli-guide.md`: remove `--allow-transportable-edits` references. Update examples.
- [x] In `docs/deployment-best-practices.md`: update security recommendations (around lines 195-203). Remove `allowTransportableEdits` references. Note the new safe default.
- [x] In `README.md`: fix npx example at line 100 to use `arc-1@latest`. Ensure quick start mentions that writes default to `$TMP`.
- [x] In `CLAUDE.md`: remove `SAP_ALLOW_TRANSPORTABLE_EDITS` / `--allow-transportable-edits` from the config table. Update the `allowedPackages` default description from `(all)` to `$TMP`. Update the codebase structure if any files changed. Update the code patterns section if the safety check pattern changed. Update the Key Files table if needed.
- [x] Run `npm test` — all tests still pass after doc changes.

### Task 7: Update roadmap, feature matrix, and skills

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `.claude/commands/implement-feature.md` (if it references transport/package flags)
- Modify: `.claude/commands/generate-rap-service.md` (if it references transport/package flags)

Update peripheral documentation artifacts.

- [x] In `docs/roadmap.md`: check for any items about `allowTransportableEdits` or transport gating simplification. Mark as completed or update wording. Add a note under the safety section that package allowlist defaults to `$TMP`.
- [x] In `docs/compare/00-feature-matrix.md`: update the "Transport gating" row if its description mentions `allowTransportableEdits`. The feature still exists (via `enableTransports`), just simplified. Update "Last Updated" date.
- [x] Check `.claude/commands/*.md` skill files for any references to `--allow-transportable-edits`, `allowTransportableEdits`, or outdated transport flags. Update any found references to use `--allowed-packages` and `--enable-transports` instead.
- [x] Run `npm test` — all tests pass.

### Task 8: Final verification

- [x] Run full test suite: `npm test` — all tests pass (1108 tests)
- [x] Run typecheck: `npm run typecheck` — no errors
- [x] Run lint: `npm run lint` — no errors
- [x] Grep the entire codebase for `allowTransportableEdits`, `allow-transportable-edits`, `SAP_ALLOW_TRANSPORTABLE_EDITS`, `checkTransportableEdit` — zero results in production/active docs (only in plan file and historical research docs)
- [x] Grep for `TRANSPORTABLE-EDITS` — zero results in production code
- [x] Verify default config: read `src/server/types.ts` and confirm `allowedPackages: ['$TMP']`
- [x] Verify `checkPackage` is called in `handleSAPWrite` create action
- [x] Verify SAPWrite tool description includes package restriction info
- [x] Verify npx examples in `docs/index.md` use `arc-1@latest` and include `SAP_CLIENT`
- [x] Move this plan to `docs/plans/completed/`
