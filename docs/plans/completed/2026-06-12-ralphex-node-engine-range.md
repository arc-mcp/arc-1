# Relax Node Engine Patch Pin

## Overview

The external feedback called out the `engines.node` value as a patch-level pin that makes installation stricter than the project needs. This plan relaxes the ARC-1 package metadata from `>=22.22.1` to the lowest defensible Node 22 minor supported by the current runtime dependency graph.

The target is `>=22.19`, not a broad `>=22`, because the installed `undici` package declares `node >=22.19.0`. This removes the patch-level friction while avoiding a false support claim for earlier Node 22 releases.

## Context

### Current State

- `package.json` declares `engines.node` as `>=22.22.1`.
- `package-lock.json` mirrors the root package engine metadata.
- `.github/dependabot.yml` documents why `@types/node` must stay on major 22, but its comment references the old patch-level range.
- CI already runs on Node 22 and 24, so this is package metadata hygiene rather than a runtime code change.

### Target State

- ARC-1 declares `engines.node` as `>=22.19`.
- The lockfile root package metadata is in sync with `package.json`.
- The Dependabot comment explains the range is aligned to the strictest runtime dependency floor, while keeping `@types/node` on major 22.
- No application behavior, public tool schema, SAP endpoint, or cache behavior changes.

### Key Files

| File | Role |
|------|------|
| `package.json` | Public npm package engine declaration. |
| `package-lock.json` | Root package metadata synchronized with `package.json`. |
| `.github/dependabot.yml` | Documents why `@types/node` major is pinned to the minimum supported runtime major. |
| `docs/plans/completed/2026-06-12-ralphex-node-engine-range.md` | Completed implementation plan and verification evidence. |

### Verified Live Evidence

Release-invariant smoke verification was run after the metadata change against all three live SAP targets using the built CLI command `SAPRead` with `{"type":"COMPONENTS"}`:

- 2026-06-12, NPL 7.50: `SAP_BASIS=750`, `S4FND=-`.
- 2026-06-12, S/4HANA 2023: `SAP_BASIS=758`, `S4FND=108`.
- 2026-06-12, ABAP Platform 2025: `SAP_BASIS=816`, `S4FND=109`.

This point does not touch ADT endpoints or SAP release-specific logic; the live smoke confirms the package still builds and the CLI still connects successfully across the supported live systems.

### Design Principles

1. Do not pin to a specific Node patch unless a concrete runtime bug requires it.
2. Do not claim support for Node 22.0 through 22.18 while `undici` currently requires Node `>=22.19.0`.
3. Keep package metadata and lockfile metadata in sync.
4. Keep `@types/node` on major 22 so TypeScript cannot accidentally reference Node 24-only APIs while the minimum runtime is Node 22.
5. Make no runtime behavior changes for SAP calls, MCP tools, or CI workflows.

## Development Approach

This is a narrow metadata-only change. First, inspect the current engine declaration and dependency floors. Then change the package engine to `>=22.19`, mirror it in the lockfile, and update the Dependabot comment so future automated dependency updates preserve the Node-major invariant. Finally, run the normal gates plus a build and live SAP smoke across 7.50, 2023, and 2025.

No unit test changes are needed because there is no runtime function or schema behavior to exercise. The relevant regression check is that package metadata is synchronized and the existing full test suite remains green.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Relax the Node engine metadata

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/dependabot.yml`

Replace the patch-level engine floor with the strictest current runtime dependency floor, and keep comments aligned so future dependency updates do not reintroduce the stale range.

- [x] Change `package.json` `engines.node` from `>=22.22.1` to `>=22.19`.
- [x] Change the root `package-lock.json` `engines.node` value to `>=22.19`.
- [x] Update the `.github/dependabot.yml` comment to explain the range follows the strictest runtime dependency floor and that the major remains 22.
- [x] Verify both package metadata entries with `node -p`.

### Task 2: Final verification

- [x] Run full unit suite: `npm test` - all tests pass.
- [x] Run typecheck: `npm run typecheck` - no errors.
- [x] Run lint: `npm run lint` - no errors.
- [x] Run build: `npm run build` - succeeds.
- [x] Run live SAP smoke on NPL 7.50 - `SAP_BASIS=750`, `S4FND=-`.
- [x] Run live SAP smoke on S/4HANA 2023 - `SAP_BASIS=758`, `S4FND=108`.
- [x] Run live SAP smoke on ABAP Platform 2025 - `SAP_BASIS=816`, `S4FND=109`.
