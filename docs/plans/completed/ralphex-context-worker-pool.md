# Ralphex Plan: SAPContext Dependency Worker Pool

## Overview

This plan fixes the convoy effect in `SAPContext` dependency resolution. The existing implementation resolves dependencies in fixed five-request waves; the next wave cannot start until the slowest request in the current wave completes. The target behavior is a bounded worker pool that keeps up to five dependency fetches in flight and starts the next dependency as soon as any slot frees up.

The change is intentionally local to context compression. It does not add an ADT endpoint, alter safety policy, change response schemas, or change dependency ordering in the final result.

## Context

### Current State

`fetchContractsParallel()` in `src/context/compressor.ts` slices dependencies into `MAX_CONCURRENT` batches and awaits `Promise.all()` for each batch. `resolveCdsDepthLevel()` uses the same fixed-wave pattern for CDS dependency reads. Heterogeneous SAP request latency means four worker slots can sit idle behind one slow dependency.

The repository already has a FIFO semaphore in `src/adt/semaphore.ts`, but this call site only needs bounded ordered mapping inside `compressor.ts`; pulling in the ADT semaphore would not remove much complexity because the result array must remain dependency-order stable.

### Target State

`SAPContext` dependency resolution uses a small local `mapWithConcurrency()` helper. It preserves result order, caps concurrency at `MAX_CONCURRENT`, and starts the next dependency immediately after any current dependency settles.

### Key Files

| File | Role |
|------|------|
| `src/context/compressor.ts` | Fetches and compresses ABAP/CDS dependency contracts for `SAPContext` |
| `tests/unit/context/compressor.test.ts` | Unit coverage for context compression, dependency limits, failure tolerance, and new worker-pool scheduling |

### Verified Live Evidence

2026-06-12, local `.env` target: `SAPRead(type="COMPONENTS")` succeeded against S/4HANA 2023 with `SAP_BASIS` release `758` and `S4FND` release `108`.

2026-06-12, same target: built `dist/`, then `SAPRead(type="SYSTEM")` succeeded through the CLI dispatcher. This verifies the branch still builds and reaches a live ADT backend on the available 2023 system.

Local direct 7.50 and 2025 execution could not be completed in this workspace because no `NPL_*` / A4H 2025 environment variables were present. The repository workflow labels `TEST_SAP_*` live CI as `A4H 2025`, so PR CI is the available 2025 verification path for this branch. The change is release-invariant because it only schedules existing client calls and does not alter ADT URLs, headers, XML parsing, or object payloads.

### Design Principles

1. Preserve observable output order even when dependency fetches complete out of order.
2. Keep the existing `MAX_CONCURRENT = 5` ceiling.
3. Do not change failure semantics: per-dependency failures still produce empty contracts via existing fetch helpers.
4. Keep the helper local until another module needs the same ordered bounded mapping behavior.
5. Treat live SAP release behavior as unchanged because the same ADT calls are issued; only their scheduling changes.

## Development Approach

Implement the helper first, then switch both ABAP contract resolution and CDS dependency resolution to use it. Add deterministic unit tests with controlled promises so the test can prove the sixth dependency starts immediately after one of the first five resolves, instead of waiting for all five to settle.

No user-facing docs are required because this is a performance and scheduling fix behind the existing `SAPContext` behavior.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Replace Fixed Dependency Waves With Ordered Worker Pool

**Files:**
- Modify: `src/context/compressor.ts`

Introduce a bounded ordered mapper and use it in both dependency-resolution paths.

- [x] Add a local `mapWithConcurrency<T, R>()` helper that preserves input order.
- [x] Use the helper in `fetchContractsParallel()` for ABAP contract dependencies.
- [x] Use the helper in `resolveCdsDepthLevel()` for CDS dependency reads.
- [x] Keep `MAX_CONCURRENT` unchanged at five.
- [x] Leave all existing fetch/error handling helpers intact.

### Task 2: Add Scheduling Regression Coverage

**Files:**
- Modify: `tests/unit/context/compressor.test.ts`

Add tests that would fail under the previous fixed-wave implementation.

- [x] Add an ABAP dependency test with six mocked class reads and controlled promise release.
- [x] Assert only five reads start initially.
- [x] Resolve one early dependency and assert the sixth read starts immediately.
- [x] Add the same scheduling assertion for CDS dependency reads.
- [x] Assert final dependency counts remain correct.

### Task 3: Final Verification and PR Handoff

**Files:**
- Modify: `docs/plans/completed/ralphex-context-worker-pool.md`

Run fast gates and record live-system limits for the PR.

- [x] Run targeted unit tests: `npm test -- tests/unit/context/compressor.test.ts`.
- [x] Run full unit suite: `npm test`.
- [x] Run typecheck: `npm run typecheck`.
- [x] Run lint: `npm run lint`.
- [x] Run build: `npm run build`.
- [x] Run read-only live CLI smoke on the available S/4HANA 2023 / SAP_BASIS 758 system.
- [x] Confirm local 7.50 and 2025 credentials are unavailable in this workspace and document that PR CI is the available A4H 2025 verification path.
