# Ralphex XML Escape Single Pass

## Overview

This plan addresses external feedback point 4: `escapeXmlAttr()` in `src/adt/xml-parser.ts` escaped five XML attribute characters with five chained `.replace()` calls. The function is small, but it is used from multiple ADT XML builders, so every invocation created up to five intermediate strings.

The implementation keeps the existing public contract and replaces the chained passes with one regex pass over the input string. The replacement table is module-local, allocation-free per call, and the tests lock down the important behavior that replacement text is not processed again during the same escape call.

## Context

### Current State

`src/adt/xml-parser.ts` exports `escapeXmlAttr()` near the top of the shared parser module. Before this plan it ran five serial replacements for `&`, `<`, `>`, `"`, and `'`. The existing unit tests in `tests/unit/adt/xml-parser.test.ts` covered the output shape, but did not explicitly protect the single-pass behavior for already escaped-looking text.

### Target State

`escapeXmlAttr()` performs one scan with `/[&<>"']/g` and maps each matched character through a stable module-level escape table. All callers keep the same escaped output. The regression test proves that input such as `&lt;already&gt; & raw` becomes `&amp;lt;already&amp;gt; &amp; raw`, not a result produced by re-processing generated replacement text.

### Key Files

| File | Role |
|------|------|
| `src/adt/xml-parser.ts` | Shared ADT XML parsing and XML attribute escaping helpers |
| `tests/unit/adt/xml-parser.test.ts` | Unit coverage for XML parser helpers and ADT XML response parsing |

### Verified Live Evidence

2026-06-12 live read smoke after implementation, using `node ./dist/cli.js call SAPRead --json '{"type":"COMPONENTS"}' --output json` with credentials parsed from `/Users/marianzeis/DEV/arc-1/.env.infrastructure`:

- NW 7.50 NPL: HTTPS endpoint returned `SAP_BASIS=750`.
- S/4HANA 2023: HTTP endpoint returned `SAP_BASIS=758`, `S4FND=108`.
- ABAP Platform 2025: HTTP endpoint returned `SAP_BASIS=816`, `S4FND=109`.

The change is release-invariant because it only affects local XML escaping before requests are sent. The smoke still verifies that the built CLI can perform a read-only ADT round trip on all three configured SAP releases.

### Design Principles

1. Preserve exact escaped output for all five XML attribute characters.
2. Keep the replacement table module-local and stable so the hot path does not allocate the mapping on every call.
3. Do not change parser configuration, ADT endpoints, request bodies, safety checks, or tool schemas.
4. Treat this as a local performance cleanup; no docs, feature matrix, roadmap, or user-facing behavior changes are needed.

## Development Approach

Use the existing parser unit test file rather than adding a new test module. First update `escapeXmlAttr()` to use a single regex replacement and a constant escape map. Then add a focused regression test in the existing `describe('escapeXmlAttr')` block for already escaped-looking text, which proves generated entities are not recursively escaped during the same call.

The full local gate is required because `xml-parser.ts` is shared across ADT parsing and XML construction paths. Live SAP verification is a read-only `SAPRead COMPONENTS` smoke on 7.50, 758, and 816; no write, activation, transport, or DDIC behavior is involved.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Replace chained XML attribute escaping with a single pass

**Files:**
- Modify: `src/adt/xml-parser.ts`
- Modify: `tests/unit/adt/xml-parser.test.ts`

Convert `escapeXmlAttr()` to a single regex scan while keeping output exactly identical for every existing caller.

- [x] Add a module-level XML escape map for `&`, `<`, `>`, `"`, and `'`.
- [x] Replace the chained `.replace()` sequence in `escapeXmlAttr()` with `s.replace(/[&<>"']/g, ...)`.
- [x] Keep the exported function name and signature unchanged.
- [x] Add a regression test proving replacement text is not processed again during the same escape pass.
- [x] Run the focused parser test: `npm test -- tests/unit/adt/xml-parser.test.ts`.

### Task 2: Final verification

- [x] Run full test suite: `npm test` - all tests pass.
- [x] Run typecheck: `npm run typecheck` - no errors.
- [x] Run lint: `npm run lint` - no errors.
- [x] Run build: `npm run build` - no errors.
- [x] Live SAP read-only smoke on 7.50 via HTTPS: `SAPRead COMPONENTS` returned `SAP_BASIS=750`.
- [x] Live SAP read-only smoke on 2023 via HTTP: `SAPRead COMPONENTS` returned `SAP_BASIS=758`.
- [x] Live SAP read-only smoke on 2025 via HTTP: `SAPRead COMPONENTS` returned `SAP_BASIS=816`.
