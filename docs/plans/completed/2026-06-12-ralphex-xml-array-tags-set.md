# Ralphex Plan: XML Parser Array Tag Set

## Overview

This plan addresses external feedback point 1: the `fast-xml-parser` `isArray` callback in `src/adt/xml-parser.ts` allocated a fresh array literal and ran `.includes()` for every parsed XML element. ADT XML parsing is a hot path, so the callback should be allocation-free and constant-time.

The fix hoists the repeatable-tag list to a module-level `Set` and changes the callback to `ARRAY_TAGS.has(name)`. Parser behavior remains the same: known repeatable ADT elements are arrays even when only one element is present.

## Context

### Current State

The shared `XMLParser` instance uses `isArray: (name) => { return [...].includes(name); }`. `fast-xml-parser` invokes this callback for each parsed tag, so every XML parse performs avoidable allocations and linear scans. This is visible on large ADT responses such as object lists, inactive-object lists, message classes, and Atom feeds.

### Target State

The repeatable tag collection is created once at module load. Each callback invocation performs only `Set.has(name)`.

### Key Files

| File | Role |
|------|------|
| `src/adt/xml-parser.ts` | Shared ADT XML parser and parser helper functions |
| `tests/unit/adt/xml-parser.test.ts` | Parser behavior regression coverage |

### Verified Live Evidence

2026-06-12, local `.env` target: built `dist/`, then `SAPRead(type="COMPONENTS")` succeeded against S/4HANA 2023 with `SAP_BASIS` release `758` and `S4FND` release `108`. This exercises the shared XML parser against a real installed-components Atom feed.

Local direct 7.50 and 2025 execution could not be completed in this workspace because no `NPL_*` / A4H 2025 environment variables were present. The repository workflow labels `TEST_SAP_*` live CI as `A4H 2025`, so PR CI is the available 2025 verification path for this branch. The change is release-invariant because it preserves XML parser configuration semantics and changes only the lookup data structure inside the callback.

### Design Principles

1. Preserve the exact repeatable-tag list.
2. Keep the shared parser instance and all parser options unchanged.
3. Avoid exporting the tag set until another module needs it.
4. Add behavior tests rather than micro-benchmark assertions.
5. Do not touch XML response parsing logic outside the callback hot path.

## Development Approach

First hoist the array literal into a module-level `Set`, then add direct `parseXml()` coverage for both sides of the parser contract: configured repeatable tags become arrays for single elements, while unconfigured tags remain plain objects. Run the XML parser test file first, then the full fast validation gates.

No user-facing documentation is required because this is an internal parser-performance fix with no schema, CLI, or tool contract change.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Hoist Repeatable XML Tags Into a Set

**Files:**
- Modify: `src/adt/xml-parser.ts`

Remove per-tag callback allocation without changing parser behavior.

- [x] Move the repeatable ADT tag names into a module-level `ARRAY_TAGS` set.
- [x] Change `isArray` to `ARRAY_TAGS.has(name)`.
- [x] Preserve all existing parser options.
- [x] Preserve the existing tag list exactly.

### Task 2: Add Parser Contract Regression Tests

**Files:**
- Modify: `tests/unit/adt/xml-parser.test.ts`

Lock down the behavior the hotpath optimization must preserve.

- [x] Add a `parseXml()` test showing a single Atom `entry` is still parsed as an array.
- [x] Add a `parseXml()` test showing a single Atom `link` is still parsed as an array.
- [x] Add a negative control showing an unconfigured single tag remains an object.
- [x] Run targeted parser tests.

### Task 3: Final Verification and PR Handoff

**Files:**
- Modify: `docs/plans/completed/2026-06-12-ralphex-xml-array-tags-set.md`

Run validation and capture release notes for the PR.

- [x] Run targeted unit tests: `npm test -- tests/unit/adt/xml-parser.test.ts`.
- [x] Run full unit suite: `npm test`.
- [x] Run typecheck: `npm run typecheck`.
- [x] Run lint: `npm run lint`.
- [x] Run build: `npm run build`.
- [x] Run read-only live CLI smoke on the available S/4HANA 2023 / SAP_BASIS 758 system.
- [x] Confirm local 7.50 and 2025 credentials are unavailable in this workspace and document that PR CI is the available A4H 2025 verification path.
