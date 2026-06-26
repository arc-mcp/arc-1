# Op Allowlist/Blocklist — Rename, Clarify, and Harden

## Overview

The safety system supports a per-op allowlist (`SAP_ALLOWED_OPS`) and blocklist (`SAP_DISALLOWED_OPS`) that gates which operation types (Read, Search, Create, Delete, …) the server will execute. The feature was historically documented as "Op whitelist/blacklist".

This plan does three things in one pass:

1. **Rename** the user-facing terminology to "allowlist/blocklist" across code comments, docs, tests, and the comparison matrix. CLI flag names, env var names, and field names (`allowedOps`, `disallowedOps`, `--allowed-ops`, `SAP_ALLOWED_OPS`) stay the same — only explanatory copy changes.
2. **Clarify** the feature so admins can implement it without reading the source: CLAUDE.md/AGENTS.md list the op codes inline, `configuration-reference.md` documents the evaluation order and the interaction with `readOnly`, and `checkOperation()` error messages name the specific gate that blocked the call.
3. **Harden** the feature by validating op codes at startup (warn on typos) and reconciling `defaultSafetyConfig()` with the actual runtime default in `DEFAULT_CONFIG` so the two no longer disagree.

## Context

### Current State

- Terminology: "Whitelist operation types" / "Blacklist operation types" appears in `src/adt/safety.ts`, `CLAUDE.md`, `AGENTS.md`, `docs_page/configuration-reference.md`, `docs_page/authorization.md`, `docs_page/cli-guide.md`, `docs_page/index.md`, `docs/research/2026-04-08-authorization-concept.md`, `docs/compare/00-feature-matrix.md`, `docs/compare/dassian-adt/evaluations/abap-run-execution.md`, and two test names in `tests/unit/adt/safety.test.ts`.
- Error messages: `checkOperation()` in `src/adt/safety.ts:119` throws `"Operation 'CreateObject' (type C) is blocked by safety configuration"` — doesn't say which gate (readOnly vs. disallowedOps vs. allowedOps) blocked it. LLMs can't self-correct without digging into the server config.
- Op-code table: lives only in `docs_page/configuration-reference.md:92-101`. `CLAUDE.md` and `AGENTS.md` point at the flags but never enumerate R/S/Q/F/C/U/D/A/T/L/I/W/X.
- Evaluation order: the 7-step precedence in `isOperationAllowed()` (src/adt/safety.ts:93-116) is not documented anywhere. Users setting `SAP_ALLOWED_OPS=C` while `readOnly=true` get silently blocked by readOnly, with no hint why.
- Input validation: `resolve('allowed-ops', …)` in `src/server/config.ts:205-206` accepts any string. Typos like `SAP_ALLOWED_OPS=XYZ` silently block every op (none of XYZ match a known code), with no warning at startup.
- Default mismatch: `defaultSafetyConfig()` in `src/adt/safety.ts:59-73` sets `allowedOps: 'RSQTI'` and `allowedPackages: []`, but the runtime ship default in `DEFAULT_CONFIG` (`src/server/types.ts:121-135`) uses `allowedOps: ''` and `allowedPackages: ['$TMP']`. `defaultSafetyConfig()` is only referenced by two tests (`tests/unit/adt/flp.test.ts:153,184` and `tests/unit/adt/ui5-repository.test.ts:71`), so it's effectively a test fixture masquerading as a "safe default".

### Target State

- Every Op-feature-related mention of "whitelist"/"blacklist" uses "allowlist"/"blocklist" (transport whitelist, package allowlist, CC resource whitelisting are out of scope — they are separate features).
- `checkOperation()` error messages name the gate: e.g. `"reason: readOnly=true blocks write ops (CDUAW)"` or `"reason: 'C' is not in allowedOps allowlist 'RS'"`.
- `CLAUDE.md` / `AGENTS.md` list the 13 op codes inline with a link to the deeper reference.
- `configuration-reference.md` has an explicit 8-step evaluation order, a "Key interactions" section covering readOnly precedence and invalid-code handling, and an example of how to layer an allowlist on top of `readOnly=false`.
- `parseArgs()` (src/server/config.ts) warns via `logger.warn` when `SAP_ALLOWED_OPS` or `SAP_DISALLOWED_OPS` contains characters that are not in the known op-code set. Parsing still succeeds — no hard failure.
- `defaultSafetyConfig()` matches the real runtime default (`allowedOps: ''`, `allowedPackages: ['$TMP']`). The doc comment clarifies it mirrors `DEFAULT_CONFIG`. Tests that relied on the old `'RSQTI'` value are updated to set the value explicitly if they needed it.

### Key Files

| File | Role |
|------|------|
| `src/adt/safety.ts` | Core safety check logic: `OperationType` codes, `isOperationAllowed`, `checkOperation`, `defaultSafetyConfig`, `describeSafety`. |
| `src/server/config.ts` | CLI/env parser; currently reads `allowedOps`/`disallowedOps` without validation. |
| `src/server/types.ts` | `ServerConfig` type and `DEFAULT_CONFIG` (the real runtime defaults). |
| `src/server/server.ts` | Passes parsed config into `SafetyConfig` when building the ADT client. |
| `CLAUDE.md` | Top-level assistant guide with the flag/env config table. |
| `AGENTS.md` | Agent guide, mirrors CLAUDE.md's config table. |
| `.env.example` | Reference env file; comments guide admins. |
| `docs_page/configuration-reference.md` | Deep reference. Contains the op-code table and the full safety-flag matrix. |
| `docs_page/authorization.md` | Auth model; lists safety controls table. |
| `docs_page/cli-guide.md` | CLI usage examples with inline comments. |
| `docs_page/index.md` | Landing page, mentions "whitelisted operations". |
| `docs/research/2026-04-08-authorization-concept.md` | Research doc with stale default (`RSQTI`) and whitelist/blacklist terminology. |
| `docs/compare/00-feature-matrix.md` | Feature comparison matrix; row `Op whitelist/blacklist`. |
| `docs/compare/dassian-adt/evaluations/abap-run-execution.md` | Comparative eval mentions "operation whitelist". |
| `tests/unit/adt/safety.test.ts` | Safety unit tests (64 tests); two test names use whitelist/blacklist. |
| `tests/unit/server/config.test.ts` | Config parsing tests; missing coverage for op-code validation. |
| `tests/unit/adt/flp.test.ts`, `tests/unit/adt/ui5-repository.test.ts` | Call `defaultSafetyConfig()` — two callsites that need to be safe after the default reconciliation. |

### Design Principles

1. **Interface stability**: no renames to CLI flags, env vars, or field names. Only explanatory copy changes. Backward-compatible for every deployment.
2. **Out of scope**: other "whitelist/blacklist" terms in the repo — transport whitelist in `allowedTransports`, package allowlist, CC resource whitelisting, SQL-injection regex whitelist. These are separate features or SAP's own terminology.
3. **Validation is advisory**: unknown op codes log a warning but don't fail startup. Preserves current silent-block-on-typo behavior as a floor, adds a signal that would have caught the typo.
4. **Error messages target LLMs**: include both the op code and the reason so a model can self-correct (e.g. tell the user "set `SAP_READ_ONLY=false` and add C to `SAP_ALLOWED_OPS`").
5. **Tests lock in behavior**: every code change ships with a unit test. Integration/E2E are not needed — no SAP interaction or MCP-protocol change.

## Development Approach

- Pure server-side code: **unit tests only** (no integration / E2E needed).
- Each code task adds explicit tests for the new behavior.
- Run `npm test`, `npm run typecheck`, and `npm run lint` after each task; the pre-commit hook auto-fixes biome formatting on commit but tasks should leave the tree clean before committing.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Rename "whitelist/blacklist" to "allowlist/blocklist" in `src/adt/safety.ts`

**Files:**
- Modify: `src/adt/safety.ts`
- Modify: `tests/unit/adt/safety.test.ts`

The two code comments at `src/adt/safety.ts:109` and `:112` describe the Op filter as "blacklist" / "whitelist". Rename to "blocklist" / "allowlist" to match the user-facing terminology we're adopting. Also rename the two test-case titles in `tests/unit/adt/safety.test.ts` that use the old terms. Do **not** touch the transport-whitelist helper `isTransportInWhitelist()` — that's a separate feature and out of scope for this rename.

- [x] In `src/adt/safety.ts`, change `// Disallowed ops blacklist (takes precedence over allowed)` → `// Disallowed ops blocklist (takes precedence over allowed)`.
- [x] In `src/adt/safety.ts`, change `// Allowed ops whitelist (if set, only listed ops are allowed)` → `// Allowed ops allowlist (if set, only listed ops are allowed)`.
- [x] In `tests/unit/adt/safety.test.ts`, rename `'enforces allowedOps whitelist'` → `'enforces allowedOps allowlist'`.
- [x] In `tests/unit/adt/safety.test.ts`, rename `'enforces disallowedOps blacklist'` → `'enforces disallowedOps blocklist'`.
- [x] Run `npm test` — all safety tests must pass (64 tests at baseline).

### Task 2: Improve `checkOperation()` error messages to name the blocking gate

**Files:**
- Modify: `src/adt/safety.ts`
- Modify: `tests/unit/adt/safety.test.ts`

Today's error from `checkOperation()` is `"Operation 'CreateObject' (type C) is blocked by safety configuration"` — accurate but not actionable. LLMs and admins have no way to know whether `readOnly`, the blocklist, or the allowlist fired. Add a private helper `explainOperationBlock(config, op)` that returns a `reason:` string, and append it to the error message.

- [x] Add `explainOperationBlock(config: SafetyConfig, op: OperationTypeCode): string` as a non-exported helper below `checkOperation()`. It assumes the op IS blocked and returns strings like `"reason: readOnly=true blocks write ops (CDUAW)"`, `"reason: blockFreeSQL=true"`, `"reason: blockData=true"`, `"reason: enableTransports=false"`, `"reason: 'C' is in disallowedOps blocklist 'CU'"`, or `"reason: 'C' is not in allowedOps allowlist 'RS'"`. Fallback: `"reason: unknown"`.
- [x] Update `checkOperation()` to include the helper output: `"Operation '${opName}' (type ${op}) is blocked by safety configuration (${explainOperationBlock(config, op)})"`.
- [x] Add unit tests (3 tests) in the `describe('checkOperation', …)` block:
  - [x] `'error message explains readOnly blocks write ops'` → `readOnly: true` + Create → message contains `'readOnly=true'`.
  - [x] `'error message explains disallowedOps blocklist hit'` → `disallowedOps: 'C'` + Create → message contains `'disallowedOps'` and `'blocklist'`.
  - [x] `'error message explains allowedOps allowlist miss'` → `allowedOps: 'RS'` + Create → message contains `'allowedOps'` and `'allowlist'`.
- [x] Run `npm test` — all safety tests and existing `tests/unit/handlers/intent.test.ts` (which has a `'TABLE_CONTENTS is blocked by safety configuration'` assertion via a separate code path in `src/handlers/intent.ts:375`) must still pass.
- [x] Run `npm run lint` — biome wants a line break on the disallowedOps reason string; respect the 120-char width.

### Task 3: Update `CLAUDE.md`, `AGENTS.md`, and `.env.example` to use new terminology and list op codes inline

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

The existing rows for `SAP_ALLOWED_OPS` / `SAP_DISALLOWED_OPS` say "Whitelist operation types (e.g., RSQ)" / "Blacklist operation types (e.g., CDUA)" — rename and enumerate the codes inline. `.env.example` already uses the flag names without whitelist/blacklist terminology, so no changes needed there.

- [x] In `CLAUDE.md`, replace the two rows in the config table:
  - `SAP_ALLOWED_OPS` → `Allowlist operation type codes (e.g., "RSQ"). If set, only listed codes are permitted. Codes: R/S/Q/F/C/U/D/A/T/L/I/W/X — see [configuration-reference.md](docs_page/configuration-reference.md#operation-type-codes)`
  - `SAP_DISALLOWED_OPS` → `Blocklist operation type codes (e.g., "CDUA"). Listed codes are always blocked; takes precedence over SAP_ALLOWED_OPS`
- [x] Apply the same two changes to `AGENTS.md`.
- [x] Run `npm run lint` (markdown is not lint-checked by biome but keep consistent).

### Task 4: Update `docs_page/*.md` and the feature matrix to use new terminology

**Files:**
- Modify: `docs_page/configuration-reference.md`
- Modify: `docs_page/authorization.md`
- Modify: `docs_page/cli-guide.md`
- Modify: `docs_page/index.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `docs/compare/dassian-adt/evaluations/abap-run-execution.md`

Fix user-facing copy across the docs site. `configuration-reference.md` also gets the expanded evaluation-order / interactions section so admins can implement without reading the source.

- [x] In `docs_page/configuration-reference.md:85-86`, rename "Whitelist operation codes" → "Allowlist of operation codes" and "Blacklist operation codes" → "Blocklist of operation codes". Add "Takes precedence over `--allowed-ops`" to the blocklist row.
- [x] Expand the "Operation-type codes" section (src/docs_page/configuration-reference.md around line 92) with:
  - An 8-step **evaluation order** (dryRun → readOnly → blockFreeSQL → blockData → transport opt-in → disallowedOps → allowedOps → allow).
  - A **Key interactions** section covering: empty-allowlist semantics, precedence of blocklist over allowlist, readOnly always blocks CDUAW regardless of allowlist, invalid codes silently block.
- [x] In `docs_page/authorization.md:158-159`, rename the "Allowed/Disallowed operations" row descriptions.
- [x] In `docs_page/cli-guide.md:114`, change the `# Whitelist operations` comment to `# Allowlist operations (only Read/Search/Query permitted; everything else blocked)`.
- [x] In `docs_page/index.md:24`, change `whitelisted operations` → `an operation allowlist`.
- [x] In `docs/compare/00-feature-matrix.md:61`, change the row label `Op whitelist/blacklist` → `Op allowlist/blocklist`.
- [x] In `docs/compare/dassian-adt/evaluations/abap-run-execution.md:57`, change `operation whitelist` → `operation allowlist`.

### Task 5: Update the research doc terminology and fix the stale `RSQTI` default

**Files:**
- Modify: `docs/research/2026-04-08-authorization-concept.md`

The research doc at `docs/research/2026-04-08-authorization-concept.md:45-46` still says "Whitelist of operation type codes / Blacklist of operation type codes" and — critically — claims the default for `--allowed-ops` is `RSQTI`. The real runtime default in `DEFAULT_CONFIG` is `''` (empty = no allowlist filter). Leaving that stale looks like a bug to anyone reading the doc.

- [x] Rename whitelist/blacklist in the two table rows.
- [x] Change the default column for `--allowed-ops` from `RSQTI` to `""` (with a brief note in parens: `"" (no allowlist filter)`).
- [x] Add "takes precedence over allowlist" to the blocklist row.

### Task 6: Validate op codes at startup and warn on typos

**Files:**
- Modify: `src/server/config.ts`
- Modify: `tests/unit/server/config.test.ts`

Today `SAP_ALLOWED_OPS=XYZ` silently blocks every operation because none of X/Y/Z match a known code. Add a validation step in `parseArgs()` that iterates the characters in each string and logs a warning for anything outside the known op-code set. Parsing still succeeds — backward compatible.

- [x] In `src/server/config.ts`, after the two `resolve('allowed-ops', …)` / `resolve('disallowed-ops', …)` calls (lines 205-206), add a helper `validateOpCodes(value: string, varName: string)` that:
  - Returns early if `value` is empty.
  - Computes the set of known codes from `OperationType` (import from `src/adt/safety.js`).
  - For each character in `value`, if not in the known set, collects it into an `unknown: string[]` list.
  - If `unknown.length > 0`, logs a single warning via the existing `logger` helper: `logger.warn(\`\${varName} contains unknown operation codes: \${unknown.join(',')} — known codes: R/S/Q/F/C/U/D/A/T/L/I/W/X. These characters have no effect.\`, { value, unknown })`.
  - Deduplicate unknown chars to avoid spammy messages for `XXX`.
- [x] Call `validateOpCodes(config.allowedOps, 'SAP_ALLOWED_OPS')` and `validateOpCodes(config.disallowedOps, 'SAP_DISALLOWED_OPS')`.
- [x] In `tests/unit/server/config.test.ts`, add unit tests (~4 tests) inside `describe('parseArgs', …)`:
  - [x] `'validates SAP_ALLOWED_OPS: warns on unknown codes'` — set `process.env.SAP_ALLOWED_OPS = 'RXZ'`, spy on `logger.warn`, assert warn called once with a message containing `'SAP_ALLOWED_OPS'`, `'X'`, `'Z'`.
  - [x] `'validates SAP_DISALLOWED_OPS: warns on unknown codes'` — same shape for disallowed.
  - [x] `'does not warn for valid op codes'` — `SAP_ALLOWED_OPS = 'RSQCU'` → no warning.
  - [x] `'does not warn when allowedOps is empty'` — `SAP_ALLOWED_OPS = ''` → no warning.
- [x] Follow the existing test pattern: the tests use `vi.spyOn(logger, 'warn')` or similar — check how `SAP_ALLOWED_PACKAGES` validation tests handle this and mirror the approach.
- [x] Run `npm test` — new tests pass; existing config tests still pass.
- [x] Run `npm run typecheck` and `npm run lint` — both clean.

### Task 7: Reconcile `defaultSafetyConfig()` with the real runtime default

**Files:**
- Modify: `src/adt/safety.ts`
- Modify: `tests/unit/adt/safety.test.ts`
- Verify: `tests/unit/adt/flp.test.ts`
- Verify: `tests/unit/adt/ui5-repository.test.ts`

`defaultSafetyConfig()` at `src/adt/safety.ts:59-73` returns `allowedOps: 'RSQTI'` and `allowedPackages: []`. The actual runtime default set in `DEFAULT_CONFIG` (`src/server/types.ts:121-135`) and plumbed through `src/server/server.ts:176-188` is `allowedOps: ''` and `allowedPackages: ['$TMP']`. Two competing "defaults" is bug-bait.

Two existing callsites use `defaultSafetyConfig()`:
- `tests/unit/adt/flp.test.ts:153` and `:184` — both override with an explicit `disallowedOps`. The behavior under the new default (empty allowlist = all ops allowed) is compatible: the disallowed op is still blocked, and no other op in these tests triggers the allowlist-miss path. Verify when you get there.
- `tests/unit/adt/ui5-repository.test.ts:71` — same pattern, `disallowedOps: 'R'` on a Read call. Compatible.

- [x] Update `defaultSafetyConfig()` so its return value matches `DEFAULT_CONFIG` for safety fields:
  - `allowedOps: ''` (was `'RSQTI'`)
  - `allowedPackages: ['$TMP']` (was `[]`)
  - keep `readOnly: true`, `blockFreeSQL: true`, `blockData: true`, `disallowedOps: ''`, `dryRun: false`, `enableGit: false`, `enableTransports: false`, `transportReadOnly: false`, `allowedTransports: []`.
- [x] Update the doc comment on `defaultSafetyConfig()` to read: `/** Safe defaults — mirrors DEFAULT_CONFIG in src/server/types.ts. Used by tests that want the real ship default without re-deriving it. */`
- [x] Update the existing safety-test assertion at `tests/unit/adt/safety.test.ts:107-115` (`'default config blocks writes, free SQL, and data queries'`). Review the expectations under the new defaults:
  - `Read` → still allowed (empty allowlist = no filter, not blocked otherwise).
  - `Search` → still allowed.
  - `Create` → still blocked (readOnly).
  - `FreeSQL` → still blocked (blockFreeSQL).
  - `Query` → still blocked (blockData).
  - These all still hold. Add: `expect(cfg.allowedOps).toBe('');` and `expect(cfg.allowedPackages).toEqual(['$TMP']);` to pin the reconciled defaults.
- [x] Run `tests/unit/adt/safety.test.ts`, `tests/unit/adt/flp.test.ts`, `tests/unit/adt/ui5-repository.test.ts` — all pass.
- [x] Run `npm test` — full suite green.

### Task 8: Final verification

- [x] Run full test suite: `npm test` — all tests pass (safety + config + flp + ui5-repo + the rest).
- [x] Run typecheck: `npm run typecheck` — no errors.
- [x] Run lint: `npm run lint` — no errors.
- [x] `grep -iRn 'whitelist\|blacklist' .` — remaining hits should only be transport whitelist (separate feature), package allowlist legacy mentions, SQL-injection regex whitelist, CC resource whitelisting, or docs/plans/completed historical references. No hits in: `CLAUDE.md`, `AGENTS.md`, `docs_page/configuration-reference.md`, `docs_page/authorization.md`, `docs_page/cli-guide.md`, `docs_page/index.md`, `docs/compare/00-feature-matrix.md`, `docs/research/2026-04-08-authorization-concept.md`, `tests/unit/adt/safety.test.ts`, or `src/adt/safety.ts` (except the intentional transport-whitelist helper).
- [x] Manual sanity check: start the server with `SAP_ALLOWED_OPS=XZ npm run dev` (no SAP connection needed — it logs on startup). Confirm the new warning fires.
- [x] Manual sanity check: trigger a blocked op in a unit test and confirm the error message contains a `reason:` suffix.
- [x] Move this plan to `docs/plans/completed/`.
