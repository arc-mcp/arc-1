# Authorization Refactor v2 — Single Policy Matrix, Positive Opt-In Flags, True Mutation Gate

## Overview

Rewrite ARC-1's authorization system to be simpler for admins to configure and harder for developers to misclassify. Introduces a single `ACTION_POLICY` matrix as the source of truth for `(tool, action-or-type) → { scope, opType, featureGate? }`; renames all safety flags to positive opt-ins (`allow*`); makes `allowWrites=false` truly block every mutation (including transports, git, activation); fixes six known scope/safety classification bugs; adds per-user scopes for transports and git; implements real per-key API-key safety intersection; and deletes the `ARC1_PROFILE` server preset, the single `ARC1_API_KEY` mode, and the op-code allowlist/blocklist env vars.

This is a **breaking change**. Pre-1.0, no backward compatibility is provided. Old env vars and flag names are removed outright. Continues PR [#181](https://github.com/marianfoo/arc-1/pull/181) — the earlier commits on that branch (op-code rename/harden, doc clarifications) will be superseded by this work.

Documentation is treated as core scope: every doc referencing a removed identifier is updated in this PR (list built by repo-wide grep in Task 0, not by hand-curation). Tests are also core scope: the `ACTION_POLICY` validator runs in CI to prevent future drift.

## Context

### Current State

- `SafetyConfig` in [src/adt/safety.ts:44-56](src/adt/safety.ts:44) has 11 fields mixing negations (`readOnly`, `blockData`, `blockFreeSQL`) with opt-ins (`enableGit`, `enableTransports`). Admin UX is inconsistent.
- Op-code allowlist/blocklist (`allowedOps`/`disallowedOps`, 13 codes) are admin-facing, overlap with boolean flags, and have ~25 doc/test references.
- `ARC1_PROFILE` env var (6 profiles) seeds partial server safety config with inconsistent field coverage. `enableGit` is never set by any profile.
- Single `ARC1_API_KEY` grants all scopes. Multi-key `ARC1_API_KEYS` maps to scopes via `PROFILE_SCOPES` but NOT to full safety config — docs claim per-key profile safety applies, but `allowedPackages`/`enableTransports`/`enableGit` are always inherited from server (silent security gap).
- Six scope-vs-safety classification bugs: `SAPLint.set_formatter_settings` is scope `read` but calls `OperationType.Update`; `SAPManage.flp_list_*` is scope `write` but calls `OperationType.Read`; `SAPTransport.check`/`history` require `write` but are read-only; `SAPTransport` tool only registered when `enableTransports=true`; `checkTransport` and `checkGit` don't consult `readOnly`.
- `deriveUserSafety` treats `admin` scope alone as most-restrictive (unintuitive).
- `dryRun` field exists but is not wired to any env var or flag — vestigial.
- Action-level scope enforcement is scattered: `SAPManage` at top level, `SAPGit` inside its handler, `SAPTransport`/`SAPLint` have none.
- Tool-list pruning exists for `SAPManage` and hyperfocused `SAP` only.

### Target State

- **Single source of truth**: new `src/authz/policy.ts` exports `ACTION_POLICY` — a map of `Tool` or `Tool.action-or-type` keys to `{ scope, opType, featureGate? }`. All scope checks, safety checks, and tool-list pruning read from it. Paired with a committed CI validator script (`scripts/validate-action-policy.ts`) that asserts every action in the code's schema enums is covered by the matrix, preventing future drift.
- **7 scopes** (xs-security.json + new `API_KEY_PROFILES`): `read`, `write`, `data`, `sql`, `transports` (NEW), `git` (NEW), `admin`. `admin` expands to imply all other scopes at extraction time.
- **7 server flags** (all positive opt-ins, defaults restrictive):
  - `allowWrites` (default `false`) — replaces `readOnly`
  - `allowDataPreview` (default `false`) — replaces `blockData`
  - `allowFreeSQL` (default `false`) — replaces `blockFreeSQL`
  - `allowedPackages` (default `['$TMP']`) — write-only restriction; reads are never gated by package
  - `allowTransportWrites` (default `false`) — replaces `enableTransports` + `transportReadOnly`
  - `allowGitWrites` (default `false`) — replaces `enableGit`
  - `allowedTransports` (default `[]`) — advanced CTS whitelist, unchanged
- **Two-gate rule** (the mental model): every mutation requires BOTH the matching user scope AND the corresponding server flag. Reads of SAP objects require only the `read` scope. Table data preview and free SQL are separately gated by their own (scope, flag) pair.
- **True mutation block**: `allowWrites=false` blocks object writes, transport writes, git writes, and activation. No loopholes.
- **SAPTransport/SAPGit always registered** when the feature is available. Read actions work with read scope; mutating actions require their specific scope (`transports`/`git`) + the corresponding server flag.
- **Per-key API-key safety intersection**: `ARC1_API_KEYS="key:developer"` maps the profile name to a partial `SafetyConfig`, intersected with the server ceiling field-by-field. Fixes the current silent-broaden bug for `allowedPackages`/transports/git.
- **SAP_DENY_ACTIONS** env var for fine-grained per-action denials. Grammar is tool-qualified: `Tool`, `Tool.action`, `Tool.glob*` (no cross-tool wildcards like `*.delete`). Either inline CSV or path to a JSON array file (auto-detected). Fails fast at startup on any validation error.
- **Deleted**: `ARC1_PROFILE`, `--profile`, `PROFILES`, `PROFILE_SCOPES`, single `ARC1_API_KEY`/`--api-key`, `SAP_ALLOWED_OPS`, `SAP_DISALLOWED_OPS`, `dryRun`, `transportReadOnly`. The `MCPDeveloperRestricted` role template variant is NOT shipped (per user decision C1: restricted developer is admin's own responsibility, not a shipped preset).
- **Observability**: startup effective-policy log with per-field source attribution (env var name / CLI flag / default); contradiction warnings (`allowTransportWrites=true` with `allowWrites=false` etc.); new `arc-1 config show` subcommand that uses the same resolver.
- **Role template changes** (xs-security.json): `MCPDeveloper` expanded to `[read, write, transports, git]` (explicit bundling). Existing `MCPViewer`/`MCPDataViewer`/`MCPSqlUser`/`MCPAdmin` keep their scope sets with `admin` semantically implying all.
- **Config resolver**: new `resolveConfig()` function returns `{ config, sources }` — the sources map is consumed by the startup log and `config show`. `parseArgs()` stays as a thin wrapper that returns just `config` for callers that don't need provenance.

### Key Files

| File | Role |
|------|------|
| `src/authz/policy.ts` | **NEW** — `ACTION_POLICY` matrix (single source of truth for scope/opType/featureGate per Tool or Tool.action-or-type) |
| `scripts/validate-action-policy.ts` | **NEW** — CI validator script; asserts every action from `src/handlers/schemas.ts` is in ACTION_POLICY |
| `src/adt/safety.ts` | Rewrites `SafetyConfig` (new field names, positive opt-ins); `checkTransport`/`checkGit` consult `allowWrites`; `deriveUserSafety` implements admin-implies-all; new `deriveUserSafetyFromProfile` for API-key path |
| `src/server/types.ts` | `ServerConfig` field renames to match new safety model |
| `src/server/config.ts` | Removes `ARC1_PROFILE`/`PROFILES`/`PROFILE_SCOPES`/single `ARC1_API_KEY`/op-code env vars; adds `API_KEY_PROFILES` map (scopes + partial SafetyConfig per profile name); adds `SAP_DENY_ACTIONS` parsing + fail-fast validation; extracts `resolveConfig()` separate from `parseArgs()` |
| `src/server/deny-actions.ts` | **NEW** — parses `SAP_DENY_ACTIONS` (inline CSV or file path), glob matching, validation against ACTION_POLICY |
| `src/server/xsuaa.ts` | Adds `transports`/`git` scope extraction; admin-implies-all expansion |
| `src/server/http.ts` | Same (`extractOidcScopes` at [http.ts:424](src/server/http.ts:424) is the actual location); also removes single-API-key code path |
| `src/handlers/intent.ts` | `TOOL_SCOPES`/`SAPMANAGE_ACTION_SCOPES`/`SAPGIT_ACTION_SCOPES` deleted — all replaced by `ACTION_POLICY` lookup via new unified top-level check |
| `src/handlers/tools.ts` | SAPTransport and SAPGit always registered when feature is available (no `enableTransports` gate for the whole tool) |
| `src/handlers/hyperfocused.ts` | `getHyperfocusedScope` deleted; action lookups go through `getActionPolicy('SAP', action)` |
| `src/server/server.ts` | `filterToolsByAuthScope` reads from `ACTION_POLICY`; action-level pruning for all mixed tools; SAPRead TYPE-enum pruning (TABLE_CONTENTS pruned when user lacks `data` scope); startup effective-policy log + contradiction warnings |
| `src/cli.ts` | Adds `arc-1 config show` subcommand (uses `resolveConfig`) |
| `src/adt/transport.ts` | `listTransports`/`checkTransport`/`history` remain as safety-gated reads; `enableTransports` gate removed (ACTION_POLICY handles via scope) |
| `xs-security.json` | Adds `transports`/`git` scopes; updates `MCPDeveloper` scope set |
| `.env.example` | Complete rewrite — commented "recipe blocks" replacing the deleted `ARC1_PROFILE` concept |
| `docs_page/authorization.md` | Complete rewrite around three-layer model |
| `docs_page/configuration-reference.md` | Complete rewrite — new flag table, new recipes, new `SAP_DENY_ACTIONS` section |
| `docs_page/xsuaa-setup.md` | Updates for new scopes |
| `docs_page/security-guide.md` | Updates hardening recipes |
| `docs_page/updating.md` | **ADDS** migration section with old-to-new flag mapping |
| Other docs | Exact list built in Task 0 via grep — everything that references a removed identifier |
| `CLAUDE.md` | Rewrites the config table |
| `README.md` | Updates "Safety & Admin Controls" section |
| `CHANGELOG.md` | Adds breaking-change release notes |

### Design Principles

1. **Single source of truth**: `ACTION_POLICY` is the only place that declares scope/opType per action. Tool listing, runtime enforcement, and CI validator all read from it. If an action isn't in `ACTION_POLICY`, the CI validator fails.
2. **Positive opt-in everywhere**: every capability-gating flag is `allow*=true` to enable. Defaults restrictive. No mix of negations and opt-ins.
3. **Two-gate rule**: mutations need BOTH server flag AND user scope. Reads of SAP objects need only scope. Data preview and free SQL have their own server flag.
4. **Server ceiling preserved**: per-user scopes can only tighten, never loosen. Server's effective safety is the maximum any user gets.
5. **Per-key API-key profile = real safety intersection**: profile name on a key maps to a partial `SafetyConfig`; `deriveUserSafetyFromProfile(server, profile)` intersects it with the server ceiling field-by-field.
6. **Admin implies all scopes** — breaking behavior change. Currently `admin` alone is most-restrictive; after this refactor, `admin` is expanded to include all other scopes at extraction time.
7. **Fail fast on invalid config**: any malformed `SAP_DENY_ACTIONS` entry, unknown action name, unparseable JSON, or unreadable file aborts startup with a specific error.
8. **Observability is core**: startup log shows effective policy with per-field source; contradictions warn loudly; `arc-1 config show` is a first-class subcommand.
9. **Documentation is core scope**: every affected doc is updated in this PR. Task 0 produces the exhaustive list via grep.
10. **Breaking is fine**: no deprecation aliases. Old env vars cause startup errors with a migration-guide pointer.
11. **No shipped restricted-developer role**: the `MCPDeveloper` template bundles `[read, write, transports, git]`. Admins who need a write-only-no-CTS-no-Git user create their own XSUAA role template or use `SAP_DENY_ACTIONS`.

## Development Approach

- **Testing strategy**: code changes + tests in the same task. Every code task ends with `npm test` passing.
- **Ordering**: grep-inventory (Task 0) → foundation types (Tasks 1-2) → config (Tasks 3-4) → scope extraction (Task 6) → runtime wiring (Task 5) → external configs (Task 7) → observability (Tasks 8-9) → docs (Task 10) → final verification (Task 11).
- **PR branch**: continues `claude/peaceful-chaplygin-5625a8` (PR #181). Earlier op-code rename commits are superseded; final task updates PR title/description.
- **SAP test system for manual testing**: credentials are in `INFRASTRUCTURE.md` (A4H: `http://a4h.marianzeis.de:50000`, user per INFRASTRUCTURE.md). Never paste real passwords into plan or code.
- **No test is silently skipped**: use `requireOrSkip()` from `tests/helpers/skip-policy.ts` when needed. Every classification-fix test runs unconditionally on unit tier.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npx tsx scripts/validate-action-policy.ts` (new — runs in CI, added in Task 1)

### Task 0: Extract action/type surface and build doc/test inventory

**Files:**
- Create: `docs/plans/artifacts/authz-refactor-inventory.md` (scratch inventory; deleted in Task 11)

This task produces the raw material for Tasks 1 and 10 by extracting the current surface directly from the codebase. No production code changes. The inventory file is written to a `artifacts/` subfolder so it's obvious it's a working artifact.

- [ ] Extract every tool+action or tool+type combination from [src/handlers/schemas.ts](src/handlers/schemas.ts):
  - SAPRead `type` enum (lines 17-54, on-prem) and (lines 56-81, BTP subset)
  - SAPWrite `action` enum (line 329)
  - SAPActivate `action` enum (line 417)
  - SAPNavigate `action` enum (line 436)
  - SAPLint `action` enum (line 449)
  - SAPDiagnose `action` enum (line 460)
  - SAPTransport `action` enum (line 494)
  - SAPGit `action` enum (line 509)
  - SAPContext `action` enum (line 569)
  - SAPManage `action` enum (line 607)
  - SAPSearch, SAPQuery (no action enum — tool-level scope)
- [ ] For each extracted action/type, record the actual `checkOperation(OperationType.X, ...)` call in the handler chain (grep `src/adt/**` and `src/handlers/intent.ts`). This tells you the real opType the implementation uses — which the ACTION_POLICY must match.
- [ ] Run an exhaustive grep across the entire repo for every removed identifier. Emit a Markdown list of filepaths, grouped by directory, organized as "Must update (user-facing doc)", "Must update (test)", "Update in place (config/CI)", "Leave as-is (historical record)". Use the following patterns (combine into one ripgrep call with `\|` alternation): `readOnly`, `blockData`, `blockFreeSQL`, `enableTransports`, `enableGit`, `transportReadOnly`, `allowedOps`, `disallowedOps`, `dryRun`, `ARC1_PROFILE`, `--profile`, `SAP_READ_ONLY`, `SAP_BLOCK_DATA`, `SAP_BLOCK_FREE_SQL`, `SAP_ENABLE_TRANSPORTS`, `SAP_ENABLE_GIT`, `SAP_ALLOWED_OPS`, `SAP_DISALLOWED_OPS`, and the exact phrase `ARC1_API_KEY ` (trailing space, to exclude `ARC1_API_KEYS`). Exclude `docs/plans/completed/**`, `compare/**` (historical/out-of-scope) and `docs/plans/authorization-refactor-v2.md` (this plan).
- [ ] Write the inventory to `docs/plans/artifacts/authz-refactor-inventory.md` with two sections:
  1. **Action/type surface** — table: Tool | Action-or-Type | Current `OperationType` | Current scope assignment (from TOOL_SCOPES / SAPMANAGE_ACTION_SCOPES / SAPGIT_ACTION_SCOPES) | Classification bug? (Y/N with note)
  2. **Files to update** — grouped list of every non-excluded file with at least one hit, one line per file noting the type of change (rename safety flag / rewrite scope example / migration-note addition / etc.)
- [ ] The inventory file is a working artifact — not committed long-term. Task 11 deletes it.
- [ ] Run `npm test` — no code changes; baseline confirmed.
- [ ] Run `npm run typecheck` — clean.
- [ ] Run `npm run lint` — clean.

### Task 1: Create ACTION_POLICY matrix, policy.ts module, and validator script

**Files:**
- Create: `src/authz/policy.ts`
- Create: `scripts/validate-action-policy.ts`
- Create: `tests/unit/authz/policy.test.ts`
- Modify: `package.json` (add `validate:policy` script)

The foundation for every other task. ACTION_POLICY is the declarative table. The validator script runs in CI to ensure no action in the code's schema enums is missing from the matrix (and vice versa). Read the inventory from Task 0 before writing the matrix.

- [ ] Create `src/authz/policy.ts` exporting:
  ```typescript
  import type { OperationTypeCode } from '../adt/safety.js';
  import { OperationType } from '../adt/safety.js';

  export type Scope = 'read' | 'write' | 'data' | 'sql' | 'transports' | 'git' | 'admin';
  export type FeatureGate = 'rap' | 'git' | 'transport' | 'flp' | 'ui5-repo';
  export interface ActionPolicy { scope: Scope; opType: OperationTypeCode; featureGate?: FeatureGate }
  export const ACTION_POLICY: Record<string, ActionPolicy> = { /* see below */ };
  ```
- [ ] Fill `ACTION_POLICY` using the inventory from Task 0. Key format: `Tool` (tool-level default) and `Tool.actionOrType` (action/type-specific override). Lookup order: specific key first, then tool-level default. Required entries (exact keys — verify against Task 0 inventory):
  - `SAPRead`: `{ scope: 'read', opType: OperationType.Read }` (default for all types)
  - `SAPRead.TABLE_CONTENTS`: `{ scope: 'data', opType: OperationType.Query }` (override)
  - `SAPSearch`: `{ scope: 'read', opType: OperationType.Search }`
  - `SAPQuery`: `{ scope: 'sql', opType: OperationType.FreeSQL }`
  - `SAPWrite` default: `{ scope: 'write', opType: OperationType.Update }`. Per-action overrides: `SAPWrite.create` → `{ scope: 'write', opType: OperationType.Create }`, `SAPWrite.delete` → `{ scope: 'write', opType: OperationType.Delete }`, `SAPWrite.update`/`edit_method`/`batch_create` → `{ scope: 'write', opType: OperationType.Update }`.
  - `SAPActivate` default: `{ scope: 'write', opType: OperationType.Activate }`. All three actions (activate / publish_srvb / unpublish_srvb).
  - `SAPNavigate` default: `{ scope: 'read', opType: OperationType.Intelligence }`. All four actions.
  - `SAPLint.lint` / `lint_and_fix` / `list_rules` / `format` / `get_formatter_settings` → `{ scope: 'read', opType: OperationType.Intelligence }`.
  - **`SAPLint.set_formatter_settings` → `{ scope: 'write', opType: OperationType.Update }`** (fixes classification bug).
  - `SAPDiagnose.syntax` → `{ scope: 'read', opType: OperationType.Read }`; `unittest` → `{ scope: 'read', opType: OperationType.Test }`; `atc` → `{ scope: 'read', opType: OperationType.Read }`; `dumps` / `traces` / `system_messages` / `gateway_errors` → `{ scope: 'read', opType: OperationType.Read }`; `quickfix` / `apply_quickfix` → `{ scope: 'read', opType: OperationType.Read }` (quickfix evaluation is a POST but doesn't mutate source).
  - `SAPTransport.list` / `get` / `check` / `history` → `{ scope: 'read', opType: OperationType.Read }` (fixes classification bug — check/history were write before).
  - `SAPTransport.create` / `release` / `release_recursive` / `reassign` / `delete` → `{ scope: 'transports', opType: OperationType.Transport }`.
  - `SAPGit` read actions: `list_repos` / `whoami` / `config` / `branches` / `external_info` / `history` / `objects` / `check` → `{ scope: 'read', opType: OperationType.Read, featureGate: 'git' }`.
  - `SAPGit` write actions: `stage` / `clone` / `pull` / `push` / `commit` / `switch_branch` / `create_branch` / `unlink` → `{ scope: 'git', opType: OperationType.Update, featureGate: 'git' }`.
  - `SAPContext` default: `{ scope: 'read', opType: OperationType.Intelligence }`. All three actions.
  - `SAPManage.features` / `probe` / `cache_stats` → `{ scope: 'read', opType: OperationType.Read }`.
  - `SAPManage.create_package` / `delete_package` / `change_package` → `{ scope: 'write', opType: OperationType.Create|Delete|Update }` per action.
  - **`SAPManage.flp_list_catalogs` / `flp_list_groups` / `flp_list_tiles` → `{ scope: 'read', opType: OperationType.Read, featureGate: 'flp' }`** (fixes classification bug — were write before).
  - `SAPManage.flp_create_catalog` / `flp_create_group` / `flp_create_tile` / `flp_add_tile_to_group` / `flp_delete_catalog` → `{ scope: 'write', opType: OperationType.Workflow, featureGate: 'flp' }`.
  - `SAP` (hyperfocused) — add entries mirroring the non-hyperfocused tools: the hyperfocused action namespace is flat (`read`, `write`, etc.), so keys are `SAP.{action}` mapping to the same scopes.
- [ ] Export helpers:
  - `getActionPolicy(tool: string, action?: string): ActionPolicy | undefined` — look up `Tool.action` first, fall back to `Tool`. Returns undefined if neither exists (caller handles "unknown action" error).
  - `allPolicyKeys(): string[]` — returns all keys (for validator + consistency tests).
  - `hasRequiredScope(scopes: string[], required: Scope): boolean` — with implications: `admin` implies all, `write` implies `read`, `sql` implies `data`. Returns `true` if the user has the required scope via any implication path.
  - `expandScopes(scopes: string[]): string[]` — returns the full implied scope set (admin → all 7; write → [read, write]; sql → [data, sql]). Used at scope-extraction time.
- [ ] Create `scripts/validate-action-policy.ts` — a tsx script that:
  - Imports `ACTION_POLICY` and `allPolicyKeys()`.
  - Parses `src/handlers/schemas.ts` action/type enums (regex or AST — simple regex is fine: match `action: z.enum([...])` and `SAPREAD_TYPES_ONPREM/BTP`).
  - For every extracted `Tool.action` and `SAPRead.{type}`, assert it's present in ACTION_POLICY (either as specific key or tool-level default).
  - For every ACTION_POLICY key, assert it corresponds to a real action/type in schemas.ts (no dead entries).
  - Exits 0 on match, non-zero on any mismatch with a specific diff report.
- [ ] In `package.json`, add `"validate:policy": "tsx scripts/validate-action-policy.ts"` under `"scripts"`.
- [ ] Add unit tests (`tests/unit/authz/policy.test.ts`, ~25 tests):
  - ACTION_POLICY includes every top-level tool (12 entries).
  - ACTION_POLICY includes `SAPRead.TABLE_CONTENTS` with scope `data`, opType Query.
  - ACTION_POLICY includes `SAPLint.set_formatter_settings` with scope `write`.
  - ACTION_POLICY includes `SAPManage.flp_list_catalogs` with scope `read`.
  - ACTION_POLICY includes `SAPTransport.check` with scope `read`.
  - ACTION_POLICY includes `SAPTransport.create` with scope `transports`.
  - ACTION_POLICY includes `SAPGit.push` with scope `git`.
  - `getActionPolicy('SAPRead', 'TABLE_CONTENTS').scope === 'data'`.
  - `getActionPolicy('SAPRead', 'PROG').scope === 'read'` (falls back to tool default).
  - `getActionPolicy('SAPRead', undefined).scope === 'read'` (tool-level lookup).
  - `getActionPolicy('SAPFoo', 'bar') === undefined`.
  - `hasRequiredScope(['admin'], 'write') === true` (admin implies all).
  - `hasRequiredScope(['admin'], 'transports') === true`.
  - `hasRequiredScope(['admin'], 'git') === true`.
  - `hasRequiredScope(['write'], 'read') === true` (write implies read).
  - `hasRequiredScope(['sql'], 'data') === true` (sql implies data).
  - `hasRequiredScope(['read'], 'write') === false`.
  - `hasRequiredScope(['write'], 'transports') === false` (orthogonal).
  - `hasRequiredScope(['read', 'transports'], 'transports') === true`.
  - `expandScopes(['admin']).length === 7` (all 7 scopes returned).
  - `expandScopes(['write']).sort().join(',') === 'read,write'`.
  - `expandScopes(['sql']).sort().join(',') === 'data,sql'`.
  - `expandScopes(['admin']).includes('transports') === true`.
  - `expandScopes(['read']).length === 1`.
  - `allPolicyKeys()` returns >70 entries (matches inventory count).
- [ ] Run `npx tsx scripts/validate-action-policy.ts` — passes (ACTION_POLICY matches schemas.ts).
- [ ] Run `npm test` — all pass.
- [ ] Run `npm run typecheck` — clean.

### Task 2: Refactor SafetyConfig and safety checks

**Files:**
- Modify: `src/adt/safety.ts`
- Modify: `tests/unit/adt/safety.test.ts`

This task replaces the old `SafetyConfig` shape with positive opt-in flags, fixes two security gaps (`checkTransport`/`checkGit` now consult `allowWrites`), and implements admin-implies-all in `deriveUserSafety`. Downstream files that use the old fields will break; they're fixed in later tasks.

- [ ] In `src/adt/safety.ts`, rewrite `SafetyConfig` interface:
  ```typescript
  interface SafetyConfig {
    allowWrites: boolean;
    allowDataPreview: boolean;
    allowFreeSQL: boolean;
    allowTransportWrites: boolean;
    allowGitWrites: boolean;
    allowedPackages: string[];      // write-only restriction
    allowedTransports: string[];    // advanced CTS whitelist
    denyActions: string[];          // parsed from SAP_DENY_ACTIONS at startup
  }
  ```
- [ ] Delete fields: `readOnly`, `blockFreeSQL`, `blockData`, `allowedOps`, `disallowedOps`, `dryRun`, `enableGit`, `enableTransports`, `transportReadOnly`.
- [ ] Rewrite `defaultSafetyConfig()` to return all `allow*: false`, `allowedPackages: ['$TMP']`, `allowedTransports: []`, `denyActions: []`. Rewrite `unrestrictedSafetyConfig()` to return all `allow*: true`, `allowedPackages: []`, `allowedTransports: []`, `denyActions: []`.
- [ ] Rewrite `isOperationAllowed(config, op)`:
  - `OperationType.Create/Update/Delete/Activate/Workflow`: require `config.allowWrites`.
  - `OperationType.Transport`: require `config.allowWrites && config.allowTransportWrites`.
  - `OperationType.Query`: require `config.allowDataPreview`.
  - `OperationType.FreeSQL`: require `config.allowFreeSQL`.
  - `OperationType.Read/Search/Intelligence/Test/Lock`: always allowed.
- [ ] Rewrite `explainOperationBlock()` error messages to reference new field names.
- [ ] Update `checkTransport(config, transport, opName, isWrite)`:
  - Remove `enableTransports` check.
  - If `isWrite`: require `allowWrites && allowTransportWrites` (throw with message naming which flag is false).
  - Remove the `transportReadOnly` branch (subsumed).
  - Keep `allowedTransports` whitelist check.
- [ ] Update `checkGit(config, operation, isWrite = true)`:
  - Change signature to accept `isWrite` parameter (default `true` for backward-compatible inside this file during refactor; later callers will pass explicitly).
  - If `isWrite`: require `allowWrites && allowGitWrites`.
  - If read: always allow.
- [ ] Rewrite `deriveUserSafety(serverConfig, scopes)`:
  - Import `expandScopes` from `src/authz/policy.ts` and call it first: `const expanded = expandScopes(scopes)`.
  - Start with `effective = { ...serverConfig, allowedPackages: [...serverConfig.allowedPackages], allowedTransports: [...serverConfig.allowedTransports], denyActions: [...serverConfig.denyActions] }`.
  - If `!expanded.includes('write')`: `effective.allowWrites = false`.
  - If `!expanded.includes('data')`: `effective.allowDataPreview = false`.
  - If `!expanded.includes('sql')`: `effective.allowFreeSQL = false`.
  - If `!expanded.includes('transports')`: `effective.allowTransportWrites = false`.
  - If `!expanded.includes('git')`: `effective.allowGitWrites = false`.
  - Return `effective`.
- [ ] Add new function `deriveUserSafetyFromProfile(serverConfig, profileName)`:
  - Imports `API_KEY_PROFILES` from `src/server/config.ts` (will be added in Task 3). To avoid circular imports, accept an optional `profileSafety: Partial<SafetyConfig>` parameter instead and have the caller pass the partial from API_KEY_PROFILES.
  - Field-by-field intersection with server ceiling: `allowWrites: serverConfig.allowWrites && profileSafety.allowWrites`, etc. (tight side wins).
  - For array fields: `allowedPackages` — if profile defines a restricted set (e.g., `['$TMP']`) and server has `['*']`, result is `['$TMP']`. If profile has `['*']` and server has `['$TMP']`, result is `['$TMP']` (server ceiling wins). Semantics: profile's allowedPackages is the FURTHER restriction; server's is the UPPER BOUND. Use set-intersect on prefix semantics — if either specifies `['*']` or `[]` (no restriction), use the other. Otherwise take the union narrowing (if server allows `['$TMP', 'Z*']` and profile narrows to `['$TMP']`, result is `['$TMP']`).
- [ ] Delete `expandImpliedScopes` (moved to `policy.ts` as `expandScopes`). Update all imports.
- [ ] Update `describeSafety()` to use new field names.
- [ ] Rewrite `tests/unit/adt/safety.test.ts`:
  - Delete ~12 tests referencing `dryRun`, `allowedOps`, `disallowedOps`, `enableTransports`/`transportReadOnly` as distinct flags, and the "admin scope → most restrictive" test.
  - Convert ~50 existing assertions that used old flag names (invert polarity where appropriate).
  - Add ~20 new tests: `checkTransport` requires `allowWrites && allowTransportWrites`; `checkGit(isWrite=true)` requires `allowWrites && allowGitWrites`; `deriveUserSafety(['admin'])` returns all `allow*` true (preserving server ceiling, so if server is more restrictive, the ceiling still wins); `deriveUserSafetyFromProfile` intersection semantics (4 scenarios: server=*/profile=$TMP → $TMP; server=$TMP/profile=* → $TMP; server=writes-off/profile=writes-on → writes-off; server=writes-on/profile=writes-off → writes-off).
- [ ] Run `npm test` safety.test.ts — all pass.
- [ ] Run `npm run typecheck` — expect downstream breakage (expected); safety.ts is clean in isolation.

### Task 3: Rewrite server config parser, introduce resolveConfig, add API_KEY_PROFILES

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/config.ts`
- Modify: `tests/unit/server/config.test.ts`

This task makes `parseArgs`/`resolveConfig` produce valid new-shape `ServerConfig`, deletes all removed env vars and flags, introduces `API_KEY_PROFILES` (scope + partial SafetyConfig per named profile), and emits migration errors when old names are seen.

- [ ] In `src/server/types.ts`:
  - Update `ServerConfig` interface: rename `readOnly` → `allowWrites` (inverted default), `blockFreeSQL` → `allowFreeSQL` (inverted), `blockData` → `allowDataPreview` (inverted), `enableTransports` → `allowTransportWrites`, `enableGit` → `allowGitWrites`. Add `denyActions: string[]`. Delete `allowedOps`, `disallowedOps`, `transportReadOnly`, `dryRun`, `apiKey`. Keep `apiKeys`.
  - Update `DEFAULT_CONFIG`: all `allow*: false`, `allowedPackages: ['$TMP']`, `allowedTransports: []`, `denyActions: []`.
  - Update header doc comment to reflect new precedence chain (no profile layer).
  - Add new type `ConfigSource = 'default' | { env: string } | { flag: string } | { file: string }` for source attribution.
- [ ] In `src/server/config.ts`:
  - Delete `PROFILES`, `PROFILE_SCOPES`, `validateOpCodes`, and the `--profile` / `ARC1_PROFILE` resolution block (~lines 205-212, 214-250).
  - Delete single `--api-key` / `ARC1_API_KEY` parsing at line 268.
  - Delete the conditional-reset patterns (`if (explicit !== undefined) ... else if (!profileName) ...`) — every flag now reads simple env-or-CLI-or-default.
  - Add the 5 new `allow*` flags parsing. Each pattern:
    ```typescript
    config.allowWrites = resolveBool('allow-writes', 'SAP_ALLOW_WRITES', false);
    ```
    Similarly `allow-data-preview`/`SAP_ALLOW_DATA_PREVIEW`, `allow-free-sql`/`SAP_ALLOW_FREE_SQL`, `allow-transport-writes`/`SAP_ALLOW_TRANSPORT_WRITES`, `allow-git-writes`/`SAP_ALLOW_GIT_WRITES`.
  - Add `denyActions` raw-value read: `const denyActionsRaw = resolve('deny-actions', 'SAP_DENY_ACTIONS', '');` — actual parsing happens in Task 4.
  - Add new export `API_KEY_PROFILES`:
    ```typescript
    export interface ApiKeyProfile { scopes: string[]; safety: Partial<SafetyConfig> }
    export const API_KEY_PROFILES: Record<string, ApiKeyProfile> = {
      viewer: { scopes: ['read'], safety: { allowWrites: false, allowDataPreview: false, allowFreeSQL: false, allowTransportWrites: false, allowGitWrites: false } },
      'viewer-data': { scopes: ['read', 'data'], safety: { allowWrites: false, allowDataPreview: true, allowFreeSQL: false, ... } },
      'viewer-sql': { scopes: ['read', 'data', 'sql'], safety: { allowWrites: false, allowDataPreview: true, allowFreeSQL: true, ... } },
      developer: { scopes: ['read', 'write', 'transports', 'git'], safety: { allowWrites: true, allowTransportWrites: true, allowGitWrites: true, allowDataPreview: false, allowFreeSQL: false, allowedPackages: ['$TMP'] } },
      'developer-data': { ...developer, safety: { ...developer.safety, allowDataPreview: true } },
      'developer-sql': { ...developer-data, safety: { ...developer-data.safety, allowFreeSQL: true } },
      admin: { scopes: ['read', 'write', 'data', 'sql', 'transports', 'git', 'admin'], safety: { allowWrites: true, allowDataPreview: true, allowFreeSQL: true, allowTransportWrites: true, allowGitWrites: true, allowedPackages: [] } },
    };
    ```
  - Update multi-key parser: `key:profile` entries validate `profile` against `Object.keys(API_KEY_PROFILES)`; unknown profile throws.
  - Extract a new `resolveConfig(args: string[]): { config: ServerConfig; sources: Record<string, ConfigSource> }` function that returns both the config and a per-field source map. Every field-assignment in the current `parseArgs` updates `sources[fieldName]` too. The existing `parseArgs` becomes: `export function parseArgs(args) { return resolveConfig(args).config; }`.
  - Migration errors: if ANY of `SAP_READ_ONLY`, `SAP_BLOCK_DATA`, `SAP_BLOCK_FREE_SQL`, `SAP_ENABLE_TRANSPORTS`, `SAP_ENABLE_GIT`, `SAP_ALLOWED_OPS`, `SAP_DISALLOWED_OPS`, `ARC1_PROFILE`, `ARC1_API_KEY` is set in env OR provided via CLI (`--read-only`, `--enable-git`, `--allowed-ops`, `--profile`, `--api-key`), throw a specific migration error listing the variable(s) and pointing to `docs_page/updating.md#v07-authorization-refactor`.
  - Update `validateConfig()` to reject these legacy vars explicitly with the migration message.
- [ ] Update `tests/unit/server/config.test.ts`:
  - Delete ~20 tests for the removed profile system and op-code validation.
  - Delete ~5 tests for single `ARC1_API_KEY`.
  - Update ~40 assertions for flag parsing (rename + invert).
  - Add ~25 tests: each new `SAP_ALLOW_*` env var parses correctly (true/false/default); default `ServerConfig` has all `allow*: false`; legacy env vars throw specific migration errors with correct URL; `ARC1_API_KEYS` rejects unknown profile names (`viewer` / `admin` valid, `xxx` throws); `API_KEY_PROFILES` has exactly 7 entries with matching scope arrays; `resolveConfig` returns correct `sources` for each field (env-sourced → `{ env: 'SAP_X' }`, flag-sourced → `{ flag: '--x' }`, not set → `'default'`).
- [ ] Run `npm test` tests/unit/server/config.test.ts — all pass.
- [ ] Run `npm run typecheck` — expect breakage in server.ts, intent.ts, etc.; those are fixed in later tasks.

### Task 4: Add SAP_DENY_ACTIONS parser with fail-fast validation (tool-qualified grammar)

**Files:**
- Create: `src/server/deny-actions.ts`
- Create: `tests/unit/server/deny-actions.test.ts`
- Modify: `src/server/config.ts` (wire in resolved denyActions)

Admin-facing replacement for op-code blocklists. Grammar is **tool-qualified only**: `Tool`, `Tool.action`, `Tool.glob*`. No cross-tool wildcards. Value is inline CSV or a file path (auto-detected). Fails fast on any validation error.

- [ ] Create `src/server/deny-actions.ts` exporting:
  - `parseDenyActions(raw: string): string[]` — returns normalized patterns. Auto-detects path vs inline:
    - Path: value starts with `/`, `./`, `~/`, or `../`. Read UTF-8, parse JSON array of strings. Any read/JSON error throws with specific message including path.
    - Inline: split on `,`, trim each, filter empty.
    - Empty raw input returns `[]`.
  - `validateDenyActions(patterns: string[], actionPolicy: typeof ACTION_POLICY): void` — validates each pattern:
    1. Grammar: `/^[A-Z][A-Za-z]+(\.[A-Za-z_][A-Za-z0-9_*]*)?$/`. Matches `Tool`, `Tool.action`, `Tool.glob*`. Reject any other format (including `*.xxx`).
    2. Tool must exist as a key in ACTION_POLICY (either `Tool` itself or `Tool.{action}` for any action).
    3. If action specified (even as glob): at least one concrete action in ACTION_POLICY must match (use glob: `*` → `.*` → regex test). E.g., `SAPManage.flp_*` must match at least `SAPManage.flp_list_catalogs`.
    4. Throw with specific message on violation, including the offending pattern and a hint (e.g., "Unknown tool 'SAPFoo'. Valid tools: SAPRead, SAPWrite, ...").
  - `isActionDenied(tool: string, action: string | undefined, patterns: string[]): boolean` — matches `tool` and `tool.action` against patterns using glob → regex expansion.
- [ ] Glob semantics: only `*` supported, matches `.*` (any chars including `.`). No `?`, `[]`, or `**`. Pattern `SAPManage.flp_*` → regex `/^SAPManage\.flp_.*$/`.
- [ ] In `src/server/config.ts`, at the end of `resolveConfig`:
  - Read `denyActionsRaw`.
  - If non-empty: call `parseDenyActions(raw)` then `validateDenyActions(patterns, ACTION_POLICY)`. If either throws, re-throw with `cause: ` set. Startup aborts.
  - Store the resolved patterns in `config.denyActions: string[]`. Source attribution: if raw started with path prefix, `sources.denyActions = { file: path }`; else `{ env: 'SAP_DENY_ACTIONS' }` or `{ flag: '--deny-actions' }`.
- [ ] Add unit tests (`tests/unit/server/deny-actions.test.ts`, ~25 tests):
  - Parses `"SAPWrite.delete,SAPManage.flp_*"` → `['SAPWrite.delete', 'SAPManage.flp_*']`.
  - Whitespace trimmed.
  - Empty string → `[]`.
  - Path detection: `"/etc/deny.json"`, `"./deny.json"`, `"~/deny.json"`, `"../deny.json"` all treated as paths.
  - File read: valid JSON array loaded.
  - File read: invalid JSON throws with "invalid JSON" and path in message.
  - File read: nonexistent file throws with path in message.
  - Validation: grammar rejects `*.delete` with "cross-tool wildcards not supported" hint.
  - Validation: grammar rejects `sap-write.delete` (must be capitalized).
  - Validation: unknown tool `SAPFoo.bar` throws with "valid tools" list.
  - Validation: unknown action `SAPWrite.noSuchAction` throws with "valid actions for SAPWrite" list.
  - Validation: glob that matches no actions `SAPManage.zzz_*` throws.
  - Validation: valid exact match `SAPWrite.delete` passes.
  - Validation: valid tool-only `SAPWrite` passes.
  - Validation: valid glob `SAPManage.flp_*` passes.
  - Validation: valid glob `SAPTransport.*` passes.
  - `isActionDenied('SAPWrite', 'delete', ['SAPWrite.delete'])` → true.
  - `isActionDenied('SAPWrite', 'create', ['SAPWrite.delete'])` → false.
  - `isActionDenied('SAPManage', 'flp_create_tile', ['SAPManage.flp_*'])` → true.
  - `isActionDenied('SAPManage', 'create_package', ['SAPManage.flp_*'])` → false.
  - `isActionDenied('SAPWrite', undefined, ['SAPWrite'])` → true (tool-level).
  - `isActionDenied('SAPWrite', 'delete', ['SAPWrite'])` → true (tool-level pattern covers actions).
- [ ] Run `npm test` deny-actions.test.ts — all pass.

### Task 5: Wire ACTION_POLICY into runtime and add type-aware pruning

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/hyperfocused.ts`
- Modify: `src/server/server.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`
- Modify: `tests/unit/handlers/hyperfocused.test.ts`
- Modify: `tests/unit/server/server.test.ts`

Deletes scattered scope-checking constants (`TOOL_SCOPES`, `SAPMANAGE_ACTION_SCOPES`, `SAPGIT_ACTION_SCOPES`, `getSapManageActionScope`, `hasRequiredScope` in intent.ts, `getHyperfocusedScope` in hyperfocused.ts). All checks route through `ACTION_POLICY`. Tool-list pruning handles both `action` enums AND SAPRead's `type` enum (TABLE_CONTENTS pruned when user lacks `data` scope).

- [ ] In `src/handlers/intent.ts`:
  - Delete `TOOL_SCOPES` (line 177-190), `SAPMANAGE_ACTION_SCOPES` (line 192-207), `SAPGIT_ACTION_SCOPES` (line 209-226), `getSapManageActionScope` (line 228-230), `hasRequiredScope` (line 237-246).
  - Import `getActionPolicy`, `hasRequiredScope`, `ACTION_POLICY`, `type Scope` from `src/authz/policy.js`. Import `isActionDenied` from `src/server/deny-actions.js`.
  - Replace the existing tool-level scope check (line 634-652) with a unified check:
    ```typescript
    const action = typeof args.action === 'string' ? args.action : undefined;
    // SAPRead uses `type` not `action`:
    const actionKey = toolName === 'SAPRead' ? (typeof args.type === 'string' ? args.type : undefined) : action;
    const policy = getActionPolicy(toolName, actionKey);
    if (!policy) return errorResult(`Unknown tool or action: ${toolName}${actionKey ? `.${actionKey}` : ''}`);
    if (authInfo && !hasRequiredScope(authInfo.scopes, policy.scope)) {
      // log auth_scope_denied
      return errorResult(`Insufficient scope: '${policy.scope}' required for ${toolName}${actionKey ? `(${actionKey})` : ''}. Your scopes: [${authInfo.scopes.join(', ')}]`);
    }
    if (isActionDenied(toolName, actionKey, client.safety.denyActions)) {
      return errorResult(`Action '${toolName}${actionKey ? `.${actionKey}` : ''}' is denied by server policy (SAP_DENY_ACTIONS).`);
    }
    ```
  - Delete the redundant `SAPManage` action-level check block (line 679-701) — now handled uniformly above.
  - Inside `handleSAPGit`, delete the per-action scope check (line 3433-3442) — now handled at top-level.
  - No change needed in the `SAPTransport` handler dispatcher itself — scope check at top level replaces the previous hardcoded write gate.
- [ ] In `src/handlers/tools.ts`:
  - Remove `if (config.enableTransports)` gate at line 1117 — SAPTransport is always registered when `featureTransport === 'on'` OR auto-detected.
  - Similarly ensure SAPGit is always registered when `featureGit` is available (check current `enableGit` usage at the tool registration site and remove).
  - No other changes needed here (descriptions, etc. remain).
- [ ] In `src/handlers/hyperfocused.ts`:
  - Delete `getHyperfocusedScope` and the inline action-scope table.
  - Replace scope lookup with `getActionPolicy('SAP', action)` — add `SAP.*` entries to ACTION_POLICY in Task 1.
- [ ] In `src/server/server.ts`:
  - Rewrite `filterToolsByAuthScope(tools, scopes)` to read from `ACTION_POLICY`:
    - For each tool in the input list:
      - Inspect the tool's schema. If it has an `action` enum, for each action look up `getActionPolicy(tool.name, action)` and keep only actions where the user has the required scope (`hasRequiredScope(scopes, policy.scope)`) and the action is NOT denied by `safety.denyActions`.
      - If it's SAPRead (has `type` enum), same pruning on the type enum — TABLE_CONTENTS is filtered when user lacks `data` scope.
      - For single-scope tools (no action enum), use `getActionPolicy(tool.name)` for the tool-level scope.
      - If after pruning the action (or type) enum is empty, remove the tool entirely.
    - Also prune actions matching `safety.denyActions` (tools declaring an action appearing in the deny list are hidden from the list for all users).
  - Delete `pruneSapManageActionsForScope`, `pruneHyperfocusedActionsForScope`, `hasNonEmptyActionEnum` — subsumed by the generic pruning.
  - The safety config needed for denyActions pruning comes from the server's safety (not per-user — deny is server-global). Pass `config.safety` or equivalent to the filter function.
- [ ] Update `tests/unit/handlers/intent.test.ts`:
  - Delete tests for the old constants.
  - Update ~20 scope-enforcement tests: `SAPTransport(action='check')` with `['read']` → succeeds; `SAPTransport(action='create')` with `['write']` and no `transports` → fails; `SAPLint(action='set_formatter_settings')` with `['read']` → fails; `SAPLint(action='set_formatter_settings')` with `['write']` → succeeds; `SAPManage(action='flp_list_catalogs')` with `['read']` → succeeds.
  - Add ~10 tests for `isActionDenied` at runtime: denied action returns specific error with pattern name; `SAPRead(type='TABLE_CONTENTS')` with `['read']` but no `data` fails; same with `['read', 'data']` succeeds.
- [ ] Update `tests/unit/handlers/tools.test.ts`:
  - Remove assertions expecting SAPTransport hidden when `enableTransports=false` (obsolete — the scope-based pruning handles this now).
  - Add ~5 assertions: SAPTransport always registered when `featureTransport` is on; SAPGit always registered when `featureGit` is on.
- [ ] Update `tests/unit/handlers/hyperfocused.test.ts`:
  - Remove `getHyperfocusedScope` tests; replace with `getActionPolicy` equivalents.
- [ ] Update `tests/unit/server/server.test.ts`:
  - Rewrite `filterToolsByAuthScope` tests. Add tests for type-enum pruning: user with `['read']` but no `data` sees SAPRead with all types EXCEPT `TABLE_CONTENTS`; user with `['read', 'data']` sees all types including `TABLE_CONTENTS`.
  - Add tests: `SAPGit.push` is hidden from tool catalog for users without `git` scope; `SAPTransport.create` is hidden for users without `transports` scope; all mixed tools get action-level pruning consistently.
  - Add tests for `denyActions` pruning: action matching a deny pattern is hidden from the tool catalog entirely.
- [ ] Run `npm test` — all pass.
- [ ] Run `npm run typecheck` — clean.

### Task 6: Update scope handling in XSUAA/OIDC and wire per-key profile safety

**Files:**
- Modify: `src/server/xsuaa.ts`
- Modify: `src/server/http.ts`
- Modify: `src/server/server.ts`
- Modify: `tests/unit/server/http.test.ts`
- Modify: `tests/unit/server/xsuaa.test.ts` (create if absent)

Adds `transports` and `git` to scope extraction, makes `admin` expand to imply all scopes, implements real per-key-profile safety intersection, and deletes single `ARC1_API_KEY` code paths.

- [ ] In `src/server/http.ts`:
  - `extractOidcScopes` at line 424: extend the accepted scope list to include `transports`, `git` alongside existing `read/write/data/sql/admin`. After extraction, call `expandScopes(scopes)` (imported from `src/authz/policy.js`) so `admin` propagates.
  - Delete the single `config.apiKey` branch at line 59-61.
  - Update multi-key path at line 49-57: replace `PROFILE_SCOPES[entry.profile] ?? ['read']` with `API_KEY_PROFILES[entry.profile]?.scopes` (throws if unknown — should have been caught at config parse, but defense in depth).
  - Update OIDC JWT scope extraction path (~line 357/401): same admin-implies-all expansion after extracting scopes from `scope`/`scp` claim.
  - Update `authMode` derivation (~line 286): remove the `'API key'` single-key label; just use `'api-key'` when any `apiKeys` entry matches.
- [ ] In `src/server/xsuaa.ts`:
  - Update the `for (const scope of ['read', 'write', 'data', 'sql', 'admin'])` loop at line 266 to include `transports` and `git`.
  - After the loop, apply `expandScopes()` to the extracted scope list so admin implies all.
  - Delete single `config.apiKey` branch at line 316.
  - Update multi-key path (line 308-311) the same way as http.ts.
- [ ] In `src/server/server.ts`, at the tool-call dispatcher where `deriveUserSafety` is called per request (line ~577):
  - If auth method is API-key with a profile name: call `deriveUserSafetyFromProfile(serverSafety, API_KEY_PROFILES[profile].safety)` to build the effective safety config.
  - Else (XSUAA or OIDC with scope list): continue using `deriveUserSafety(serverSafety, scopes)`.
  - The auth info's `scopes` already includes implied scopes from the extraction step.
- [ ] Update `tests/unit/server/http.test.ts`:
  - Delete ~5 tests for single-key mode.
  - Update ~10 multi-key tests to expect the new scope sets (with `transports`, `git`).
  - Add ~15 tests: OIDC with `transports` scope extracted; OIDC with `git` scope extracted; OIDC with `admin` scope yields all 7 scopes; OIDC with `write` scope yields `['read', 'write']` (implication applied at extraction); API-key `developer` profile gives scopes `['read','write','transports','git']`; API-key `admin` gives all 7; unknown profile in multi-key auth throws.
- [ ] Create or update `tests/unit/server/xsuaa.test.ts` with ~10 tests:
  - `extractLocalScopes` returns `transports` when XSUAA context has it.
  - `extractLocalScopes` returns `git` when XSUAA context has it.
  - Admin-implies-all: `['admin']` expands to all 7.
  - Write-implies-read: `['write']` expands to `['read', 'write']`.
- [ ] Run `npm test` — all pass.
- [ ] Run `npm run typecheck` — clean.

### Task 7: Update xs-security.json, .env.example, and external configs

**Files:**
- Modify: `xs-security.json`
- Rewrite: `.env.example`
- Check (no changes expected): `Dockerfile`, `package.json` (scripts)

- [ ] In `xs-security.json`:
  - Add two new scopes:
    - `{ "name": "$XSAPPNAME.transports", "description": "Create, release, and manage CTS transport requests" }`
    - `{ "name": "$XSAPPNAME.git", "description": "Push, pull, and manage abapGit/gCTS repositories" }`
  - Update `MCPDeveloper` role template: scopes `["$XSAPPNAME.read", "$XSAPPNAME.write", "$XSAPPNAME.transports", "$XSAPPNAME.git"]`.
  - Leave `MCPViewer`/`MCPDataViewer`/`MCPSqlUser` unchanged.
  - Update `MCPAdmin`: explicitly list all 7 scopes (`read`, `write`, `data`, `sql`, `transports`, `git`, `admin`).
  - **Do NOT add `MCPDeveloperRestricted`** (per user decision C1 — restricted developer is NOT a shipped preset).
  - Leave role collection names unchanged. `ARC-1 Developer` automatically gets transports+git via the updated template.
- [ ] Rewrite `.env.example` with commented recipe blocks replacing the deleted `ARC1_PROFILE`:
  - Header: explain the two-gate model and point to `docs_page/authorization.md`.
  - Block 1: `# === Safe defaults (read-only, no data preview, no SQL, $TMP only) ===` — show all `SAP_ALLOW_*=false` explicitly even though they are defaults.
  - Block 2: `# === Developer mode (writes to $TMP/Z*, no data preview) ===` — `SAP_ALLOW_WRITES=true`, `SAP_ALLOWED_PACKAGES='$TMP,Z*'`.
  - Block 3: `# === Developer + Transports (write + CTS) ===` — prior + `SAP_ALLOW_TRANSPORT_WRITES=true`.
  - Block 4: `# === Developer + Data preview ===` — prior + `SAP_ALLOW_DATA_PREVIEW=true`.
  - Block 5: `# === Developer + SQL ===` — prior + `SAP_ALLOW_FREE_SQL=true`.
  - Block 6: `# === Developer + Git (abapGit/gCTS) ===` — prior + `SAP_ALLOW_GIT_WRITES=true`.
  - Block 7: `# === Full local dev (everything on, any package) ===` — all true, `SAP_ALLOWED_PACKAGES='*'`.
  - Block 8: `# === Fine-grained denial example ===` — explain `SAP_DENY_ACTIONS='SAPWrite.delete,SAPManage.flp_*'` (inline CSV) and `SAP_DENY_ACTIONS=./deny-actions.json` (file path) with a sample JSON array content.
  - Block 9: `# === Multi-key API auth ===` — `ARC1_API_KEYS='key-viewer:viewer,key-dev:developer-sql'` with the 7 valid profile names listed in a comment.
  - Remove all references to deleted env vars.
- [ ] Check `Dockerfile` — if it references any deleted env var, update. Otherwise note "clean" in commit.
- [ ] Check `package.json` scripts for any deleted flag reference (e.g. `--read-only` in a start script). Update if present.
- [ ] Verify `xs-security.json` is valid JSON: `node -e "JSON.parse(require('fs').readFileSync('xs-security.json'))"`.
- [ ] Run `npm test` — no test changes in this task, but baseline rerun.

### Task 8: Add startup observability — effective-policy log + contradiction warnings

**Files:**
- Modify: `src/server/server.ts`
- Create: `src/server/effective-policy-log.ts`
- Modify: `tests/unit/server/server.test.ts`
- Create: `tests/unit/server/effective-policy-log.test.ts`

Admins need visibility into the resolved safety config with per-field source attribution AND loud warnings on useless/dangerous combinations.

- [ ] Create `src/server/effective-policy-log.ts` exporting:
  - `logEffectivePolicy(config: ServerConfig, sources: Record<string, ConfigSource>, logger: Logger): void`:
    - JSON form (structured log via `logger.info`): `{ event: 'effective_policy', allowWrites, allowDataPreview, allowFreeSQL, allowedPackages, allowTransportWrites, allowGitWrites, allowedTransports, denyActionsCount }`.
    - Human-readable one-liner: `effective safety: writes=YES/NO data=YES/NO sql=YES/NO packages=[$TMP,Z*] transports=YES/NO git=YES/NO denyActions=N`.
    - Source attribution: additional `logger.debug` line with field→source map from the `sources` parameter (e.g., `allowWrites: env SAP_ALLOW_WRITES`, `allowedPackages: default`).
  - `detectContradictions(config: ServerConfig): string[]` — returns an array of human-readable warning strings:
    1. `allowTransportWrites=true && allowWrites=false` → `"allowTransportWrites=true has no effect when allowWrites=false; transport writes are blocked"`.
    2. `allowGitWrites=true && allowWrites=false` → `"allowGitWrites=true has no effect when allowWrites=false; git writes are blocked"`.
    3. `allowedPackages` differs from default `['$TMP']` AND `allowWrites=false` → `"allowedPackages restriction configured but allowWrites=false; restriction has no effect"`.
    4. Any `denyActions` entry whose action is already unreachable per the effective policy (e.g., denies `SAPWrite.delete` while `allowWrites=false`) → `"denyActions entry 'SAPWrite.delete' is already blocked by allowWrites=false (informational)"`.
  - `logContradictions(warnings: string[], logger: Logger): void` — logs each via `logger.warn`.
- [ ] In `src/server/server.ts`, at server startup (after `parseArgs` and `validateConfig`):
  - Call `logEffectivePolicy(config, sources, logger)` once.
  - Call `logContradictions(detectContradictions(config), logger)`.
  - All logs go to stderr.
- [ ] Add tests (`tests/unit/server/effective-policy-log.test.ts`, ~15 tests):
  - JSON form emitted exactly once.
  - JSON form contains all 7 safety fields + `denyActionsCount`.
  - Human form shows YES/NO correctly for each field.
  - Source attribution in debug log: `env:SAP_ALLOW_WRITES` when set via env; `default` when unset; `flag:--allow-writes` when CLI.
  - `detectContradictions`: returns empty for consistent config.
  - `detectContradictions`: returns 1 warning for `allowTransportWrites=true, allowWrites=false`.
  - Same for gitWrites.
  - Returns warning when `allowedPackages !== ['$TMP']` and `allowWrites=false`.
  - Returns informational for redundant `denyActions` entry.
  - No password or sensitive value ever in logs (integration check: SAP_PASSWORD absent from log output).
- [ ] Update `tests/unit/server/server.test.ts`: assert `logEffectivePolicy` called exactly once on startup.
- [ ] Run `npm test` — all pass.

### Task 9: Add `arc-1 config show` subcommand

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/unit/cli/config-show.test.ts`

A debug tool for admins. Prints the resolved effective config (same content as Task 8's startup log) without starting the server.

- [ ] In `src/cli.ts`, add a commander subcommand `config show`:
  - Invokes `resolveConfig(process.argv.slice(2))` same way the server does.
  - If the legacy migration error is thrown during resolve, print it to stderr and exit 1.
  - Otherwise print the effective policy + sources.
  - `--format json|table` flag (default `table`).
  - Table: one field per line: `allowWrites: false (default)`, `allowedPackages: [$TMP,Z*] (env SAP_ALLOWED_PACKAGES)`, etc. One extra section at the end for `denyActions` (if any) with source attribution.
  - JSON: full structured output (safety object + sources map + denyActions with source).
  - Exits 0 on success, 1 on any config error.
- [ ] Add tests (`tests/unit/cli/config-show.test.ts`, ~10 tests):
  - Default config → table output with all `false` entries + `$TMP` packages.
  - With env vars set (inject via process.env mock) → correct values + sources.
  - `--format json` → valid JSON including `config`, `sources`, `denyActions`.
  - Exit 0 on success.
  - Exit 1 on invalid `SAP_DENY_ACTIONS` (e.g., unknown tool) with error text mentioning the pattern.
  - Exit 1 on legacy env var (`SAP_READ_ONLY=true`) with migration message.
  - Deny actions shown: pattern + source file/env.
- [ ] Run `npm test` — all pass.

### Task 10: Rewrite documentation and migration guide

**Files:**
The exact list comes from the Task 0 inventory. The guaranteed set:

- Modify: `docs_page/authorization.md` (complete rewrite)
- Modify: `docs_page/configuration-reference.md` (complete rewrite)
- Modify: `docs_page/xsuaa-setup.md`
- Modify: `docs_page/security-guide.md`
- Modify: `docs_page/oauth-jwt-setup.md`
- Modify: `docs_page/local-development.md`
- Modify: `docs_page/cli-guide.md`
- Modify: `docs_page/docker.md`
- Modify: `docs_page/deployment.md`
- Modify: `docs_page/deployment-best-practices.md`
- Modify: `docs_page/quickstart.md`
- Modify: `docs_page/api-key-setup.md`
- Modify: `docs_page/principal-propagation-setup.md`
- Modify: `docs_page/enterprise-auth.md`
- Modify: `docs_page/log-analysis.md`
- Modify: `docs_page/index.md`
- Modify: `docs_page/tools.md`
- Modify: `docs_page/roadmap.md`
- Modify: `docs_page/architecture.md`
- Modify: `docs_page/phase4-btp-deployment.md`
- Modify: `docs_page/updating.md` (add migration section)
- Modify: `docs/research/authorization-concept.md` (add postscript)
- Modify: `docs/research/sap-backend-roles.md` (if references old flags — check via Task 0 inventory)
- Modify: `docs/publishing-guide.md` (if hits from Task 0 inventory)
- Modify: `docs/plans/ralphex-data-preview-probe-scope-hardening.md` (in-progress plan — if hits)
- Modify: `docs/plans/oauth-security-hardening.md` (in-progress plan — if hits)
- Modify: `docs/implementation-plan-sapcontext-sapmanage.md` (if hits)
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `CHANGELOG.md` (breaking-change release notes)
- Modify: `.claude/skills/arc1-cursor-regression/SKILL.md` (if hits)
- Modify: `compare/00-feature-matrix.md` (timestamp refresh + add "central ACTION_POLICY" row)
- Plus: any additional files from Task 0 grep not listed above.

- [ ] Rewrite `docs_page/authorization.md` around the three-layer model:
  - Section "At a glance": three layers (server flag → user scope → SAP auth). One table: capability → (scope, server flag).
  - Section "Server flags": table of 7 flags with defaults.
  - Section "Scopes": 7 scopes, admin-implies-all rule, implication rules (write→read, sql→data).
  - Section "Two-gate rule": explicit for every capability. Reads of SAP objects need only scope. Data preview and free SQL have their own flag.
  - Section "API-key profiles": the 7 profile names + their (scopes, flag-overrides) mapping.
  - Section "BTP XSUAA setup": MCPViewer/MCPDataViewer/MCPSqlUser/MCPDeveloper/MCPAdmin with scopes. How to grant restricted access (create your own role template with fewer scopes, or use `SAP_DENY_ACTIONS`).
  - Section "Deny actions (advanced)": SAP_DENY_ACTIONS grammar, inline vs file, glob semantics, examples, fail-fast behavior.
  - Section "Recipes": 8 copy-pasteable config blocks matching `.env.example`.
  - Section "Troubleshooting": "Which layer blocked me?" table mapping error fragments to layer + fix.
  - Remove all references to old flags/profiles/op-codes.
- [ ] Rewrite `docs_page/configuration-reference.md`:
  - Replace entire safety section with new 7-flag table.
  - Replace profile section with the 7 API-key profiles.
  - Delete the op-code 8-step evaluation order (obsolete).
  - Add section on `SAP_DENY_ACTIONS` (grammar + examples).
  - Add "Operation types (internal)" explaining `OperationType` is internal.
  - Update "Common recipes" to match `.env.example`.
- [ ] Update `docs_page/xsuaa-setup.md`:
  - Add `transports` and `git` to the scope table.
  - Update `MCPDeveloper` row to show `[read, write, transports, git]`.
  - Add sentence: "The `admin` scope is automatically expanded to all other scopes by ARC-1's scope extractor."
  - Explain how to create a custom "restricted developer" role template by defining one with only `[read, write]`.
- [ ] Update every other doc in the list above — for each, replace old flag/env-var names with new ones; rewrite examples; drop references to `--profile` and `ARC1_PROFILE`.
- [ ] `docs_page/updating.md`: add a new section titled `## v0.7 — Authorization Refactor (Breaking Change)`:
  - Overview paragraph.
  - Table: old identifier → new identifier (or deletion reason). Include all 11 removed identifiers.
  - Migration steps for `.env` / shell env (find and replace per table).
  - Migration steps for CLI flags (e.g., `--read-only=true` → `--allow-writes=false`).
  - Migration steps for BTP: redeploy `xs-security.json`, reassign users to existing role collections (which now auto-grant `transports` + `git` if using `MCPDeveloper`).
- [ ] `README.md`: refresh "Safety & Admin Controls" section with new flag names. Update defaults list.
- [ ] `CLAUDE.md`: rewrite the config table (old lines 54-107) with new flag/env var names. Update Key Files table to include `src/authz/policy.ts`. Update codebase structure tree to include `src/authz/`.
- [ ] `AGENTS.md`: sync with CLAUDE.md updates for any duplicated content.
- [ ] `CHANGELOG.md`: prepend a top entry `## [Unreleased] — Authorization Refactor (breaking)` with bullet list of removed identifiers, new flags/scopes, migration pointer.
- [ ] `compare/00-feature-matrix.md`: refresh "Last Updated" date; add a row: "Central ACTION_POLICY matrix (single source of truth for scope/opType per action)" → ✅ ARC-1 vs ❌ competitors.
- [ ] `docs/research/authorization-concept.md`: add a postscript section dated 2026-04-2x noting this refactor supersedes the earlier model; keep the SAP auth objects reference content intact.
- [ ] While editing docs, flag unrelated stale content (broken links, outdated version numbers, wrong test counts) and fix inline. List in commit message.
- [ ] Run `npm test` — should still pass (docs-only task).
- [ ] Spot-check rendered output: read `docs_page/authorization.md` top-to-bottom for flow issues.

### Task 11: Final verification and manual testing

**Files:**
- Delete: `docs/plans/artifacts/authz-refactor-inventory.md` (working artifact, cleanup)
- Verify: full test suite, doc link check, manual local, manual BTP, PR update

- [ ] Run full test suite: `npm test` — all ~2400+ tests pass (new count includes added tests, minus deleted).
- [ ] Run `npm run typecheck` — zero errors.
- [ ] Run `npm run lint` — clean.
- [ ] Run `npm run validate:policy` — ACTION_POLICY validator passes.
- [ ] Search for residual old identifiers:
  ```
  grep -rE "readOnly|blockData|blockFreeSQL|enableTransports|enableGit|transportReadOnly|allowedOps|disallowedOps|dryRun|ARC1_PROFILE|SAP_READ_ONLY|SAP_BLOCK_DATA|SAP_BLOCK_FREE_SQL|SAP_ENABLE_TRANSPORTS|SAP_ENABLE_GIT|SAP_ALLOWED_OPS|SAP_DISALLOWED_OPS" \
    --include='*.ts' --include='*.md' --include='*.json' --include='*.example' \
    --exclude-dir=node_modules --exclude-dir=dist --exclude-dir='completed' --exclude-dir='reports'
  ```
  Allowed hits: `src/server/config.ts` migration-error messages, `docs_page/updating.md` migration table, `CHANGELOG.md` breaking-change list, `.env.example` migration note (if any), this plan, and the `docs/research/authorization-concept.md` postscript. Anything else = miss; fix.
- [ ] Manual local testing against the A4H test system. Credentials are in `INFRASTRUCTURE.md` — export them via environment (never paste into code or logs). Export template (fill in from INFRASTRUCTURE.md):
  ```bash
  export SAP_URL="http://a4h.marianzeis.de:50000"
  export SAP_USER="..."  # from INFRASTRUCTURE.md
  export SAP_PASSWORD="..."  # from INFRASTRUCTURE.md
  export SAP_CLIENT="001"
  ```
- [ ] **Scenario 1 (safe defaults)**: `npm run dev` (stdio). Startup log shows `effective safety: writes=NO data=NO sql=NO packages=[$TMP] transports=NO git=NO denyActions=0`. Call SAPSearch for "ZARC1" — succeeds. Call SAPWrite(action=create) — blocked with "allowWrites=false" in error. Call SAPRead(type=TABLE_CONTENTS, name=T000) — blocked with "allowDataPreview=false".
- [ ] **Scenario 2 (developer + transports)**: restart with `SAP_ALLOW_WRITES=true SAP_ALLOWED_PACKAGES='$TMP,Z*' SAP_ALLOW_TRANSPORT_WRITES=true`. Startup shows writes=YES transports=YES. Call SAPWrite(action=create) on a $TMP object — succeeds. Call SAPTransport(action=check) — succeeds (read action). Call SAPTransport(action=create) — succeeds (write + transports on).
- [ ] **Scenario 3 (contradiction)**: restart with `SAP_ALLOW_TRANSPORT_WRITES=true` (leave `SAP_ALLOW_WRITES=false`). Startup log shows `WARN: allowTransportWrites=true has no effect when allowWrites=false`. SAPTransport(action=create) blocked.
- [ ] **Scenario 4 (deny actions)**: restart with `SAP_ALLOW_WRITES=true SAP_DENY_ACTIONS='SAPWrite.delete,SAPManage.flp_*'`. Startup log shows `denyActions=2`. SAPWrite(action=delete) blocked with "denied by server policy". SAPManage(action=flp_create_catalog) blocked. SAPWrite(action=create) succeeds.
- [ ] **Scenario 5 (fail-fast)**: run with `SAP_DENY_ACTIONS='SAPFoo.bar'` — server aborts at startup with specific error pointing to the invalid pattern. Run with `SAP_READ_ONLY=true` (legacy) — server aborts with migration error pointing to `docs_page/updating.md#v07-authorization-refactor`.
- [ ] **Scenario 6 (config show subcommand)**: `node dist/cli.js config show` with various env combos. Output matches startup log; shows source attribution; exits 0 on success.
- [ ] Manual BTP testing (deploy to Cloud Foundry per `INFRASTRUCTURE.md` § BTP section):
  - Build + deploy: `mbt build && cf deploy mta_archives/arc1-mcp_*.mtar`.
  - In BTP Cockpit → Security → Role Collections, open `ARC-1 Developer` — confirm it now shows the 4 scopes (read, write, transports, git) after the xs-security.json redeploy.
  - Assign yourself to `ARC-1 Developer`.
  - Connect via MCP Inspector with OAuth. Token should include `transports` and `git`.
  - Call SAPTransport(action=check) — succeeds.
  - Call SAPTransport(action=create) — succeeds (scope `transports` granted AND server `allowTransportWrites=true`).
  - Call SAPGit(action=list_repos) — succeeds.
  - Switch role collection to `ARC-1 Viewer` → SAPTransport(action=create) blocked with "Insufficient scope: 'transports' required"; SAPWrite(action=create) blocked with "Insufficient scope: 'write' required"; SAPRead works.
  - Confirm effective-policy and any contradiction warnings appear in CF logs: `cf logs arc1-mcp --recent`.
- [ ] Update PR [#181](https://github.com/marianfoo/arc-1/pull/181):
  - New title: `feat: authorization refactor v2 — ACTION_POLICY matrix, positive opt-in flags, admin-implies-all`.
  - Body: list the 11 removed identifiers + 7 new flags/scopes/profiles + 6 classification bug fixes + 1 security-gap fix (readOnly-now-blocks-transport/git-writes). Include a one-paragraph migration note referencing `docs_page/updating.md`.
  - Update PR test plan checklist: unit tests pass; typecheck clean; lint clean; validate:policy clean; manual local (6 scenarios); manual BTP (1 scenario).
- [ ] Delete `docs/plans/artifacts/authz-refactor-inventory.md` — working artifact is no longer needed.
- [ ] Move this plan to `docs/plans/completed/authorization-refactor-v2.md`.
