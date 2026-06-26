# Ralphex Plan: Memoize abaplint Default Config

## Overview

This plan addresses external feedback point 3: several hot paths call `Config.getDefault(version)` during every parse or lint-config build. The `Registry` must stay fresh because it holds file/parse state, but the default abaplint config is version-constant and can be memoized.

The implementation adds a small cache module under `src/lint/` and routes all production `Config.getDefault()` call sites through it. Parser users still construct a new `Registry(config)` per parse. Config-builder users receive an isolated JSON clone before applying presets or user overrides, so no mutable caller can corrupt the cached default.

## Context

### Current State

`Config.getDefault()` is called in dependency extraction, contract extraction, method surgery, lint config building, pre-write config building, and the legacy lint fallback. On workflows like `SAPContext`, a single request can parse the root source plus many dependencies, rebuilding the same default config repeatedly.

### Target State

Default configs are memoized by abaplint `Version`. Registry instances remain per-call. Config-builder code gets fresh clones derived from a cached serialized default config, preserving caller isolation while avoiding repeated default-rule construction.

### Key Files

| File | Role |
|------|------|
| `src/lint/abaplint-config-cache.ts` | Central cache for abaplint default configs and cloneable default JSON |
| `src/context/deps.ts` | AST dependency extraction for `SAPContext` |
| `src/context/contract.ts` | Public contract extraction for classes/interfaces |
| `src/context/method-surgery.ts` | Method list/extract/splice AST parsing |
| `src/lint/config-builder.ts` | Builds customized lint and pre-write configs from defaults |
| `src/lint/lint.ts` | Offline lint wrapper and legacy default config fallback |
| `tests/unit/lint/abaplint-config-cache.test.ts` | Cache identity and clone-isolation tests |

### Verified Live Evidence

2026-06-12, local `.env` target: built `dist/`, then `SAPRead(type="COMPONENTS")` succeeded against S/4HANA 2023 with `SAP_BASIS` release `758` and `S4FND` release `108`.

Local direct 7.50 and 2025 execution could not be completed in this workspace because no `NPL_*` / A4H 2025 environment variables were present. The repository workflow labels `TEST_SAP_*` live CI as `A4H 2025`, so PR CI is the available 2025 verification path for this branch. The change is release-invariant because it affects local abaplint config construction only; it does not change ADT calls, release detection, SAP payloads, or server safety behavior.

### Design Principles

1. Cache default `Config` per abaplint `Version`.
2. Never cache or reuse `Registry` instances.
3. Give mutable config-builder callers isolated clones.
4. Keep the cache module small and explicit, with a test-only clear helper.
5. Preserve all version mapping, parser-ceiling, preset, and user override behavior.

## Development Approach

Create the cache module first, then update each production `Config.getDefault()` call site. Add focused unit tests for same-version reuse, different-version separation, and clone isolation. Run targeted lint/context tests before the full suite because this change crosses both `src/lint` and `src/context`.

No user-facing documentation is required because this is an internal performance fix with no tool-schema, CLI, configuration, or SAP behavior change.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add Default Config Cache

**Files:**
- Create: `src/lint/abaplint-config-cache.ts`

Centralize default abaplint config creation.

- [x] Add `getDefaultAbaplintConfig(version)` backed by a `Map`.
- [x] Add `cloneDefaultAbaplintConfig(version)` that caches serialized default JSON and returns a fresh parsed object.
- [x] Add `clearAbaplintConfigCacheForTests()` for deterministic unit tests.
- [x] Key the cache by abaplint `Version`.

### Task 2: Route Production Call Sites Through the Cache

**Files:**
- Modify: `src/context/deps.ts`
- Modify: `src/context/contract.ts`
- Modify: `src/context/method-surgery.ts`
- Modify: `src/lint/config-builder.ts`
- Modify: `src/lint/lint.ts`

Replace repeated default-config construction while keeping parse state fresh.

- [x] Replace context parser `Config.getDefault()` calls with `getDefaultAbaplintConfig()`.
- [x] Keep `new Registry(config)` per parse.
- [x] Replace config-builder deep-copy logic with `cloneDefaultAbaplintConfig()`.
- [x] Replace the legacy fallback default in `lint.ts` with the cache helper.
- [x] Confirm `src/` has no direct `Config.getDefault()` calls outside the cache module.

### Task 3: Add Cache Regression Tests

**Files:**
- Create: `tests/unit/lint/abaplint-config-cache.test.ts`

Prove the cache behavior without coupling tests to abaplint internals.

- [x] Assert same-version calls reuse the same `Config` object.
- [x] Assert different versions return distinct cached configs.
- [x] Assert cloned default configs are isolated from caller mutation.
- [x] Run targeted lint/context tests covering cache consumers.

### Task 4: Final Verification and PR Handoff

**Files:**
- Modify: `docs/plans/completed/2026-06-12-ralphex-abaplint-config-memo.md`

Run validation and capture release notes for the PR.

- [x] Run targeted unit tests for cache, config builder, lint, dependency extraction, contract extraction, and method surgery.
- [x] Run full unit suite: `npm test`.
- [x] Run typecheck: `npm run typecheck`.
- [x] Run lint: `npm run lint`.
- [x] Run build: `npm run build`.
- [x] Run read-only live CLI smoke on the available S/4HANA 2023 / SAP_BASIS 758 system.
- [x] Confirm local 7.50 and 2025 credentials are unavailable in this workspace and document that PR CI is the available A4H 2025 verification path.
