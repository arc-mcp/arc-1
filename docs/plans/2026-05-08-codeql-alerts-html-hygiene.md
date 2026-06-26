# CodeQL HTML Hygiene Fixes — Alerts #6, #7, #8

## Overview

This plan closes three open HIGH CodeQL alerts in the same surface area — HTML/XML entity decoding and tag stripping helpers used by `SAPDiagnose` to render SAP error pages and `xml-parser` to decode raw XML attribute values. The bugs are real (CodeQL is correct) but the blast radius is low because consumers render the output as plain text or JSON, not HTML in a browser. They are still worth fixing because the fixes are tiny and make the helpers behave as their function names imply.

The three alerts:

- **#6 — `js/incomplete-multi-character-sanitization`** at [src/adt/diagnostics.ts:1112](src/adt/diagnostics.ts:1112) — `stripHtmlTags()` uses a single-pass regex `<[^>]*>` so `<<script>script>` strips to `<script>` instead of empty. Single pass cannot handle nested or malformed HTML.
- **#7 — `js/double-escaping`** at [src/adt/diagnostics.ts:1116](src/adt/diagnostics.ts:1116) — `decodeHtmlEntities()` decodes `&amp;` *first*, so `&amp;lt;` → `&lt;` → `<` instead of staying as the literal text `&lt;`.
- **#8 — `js/double-escaping`** at [src/adt/xml-parser.ts:908](src/adt/xml-parser.ts:908) — `decodeXmlEntities()` has the same `&amp;`-first ordering bug.

The fixes are mechanical (loop-until-stable for #6, reorder replacements for #7/#8) and small (~10 LOC total). The plan also adds first-class unit tests for these helpers — they currently have **no direct test coverage** (verified via `grep` of `tests/unit/adt/`), which is how the bugs survived. After this PR all 7 helpers (the four entity decoders, the tag stripper, and `sanitizeHtmlCellValue`/`decodeUriComponentSafe`) get a regression suite.

Design decisions:

- **Loop-until-stable** for `stripHtmlTags`, not a third-party HTML sanitizer. The use case is converting SAP HTML error responses to plain text for terminal/JSON output — not user-facing HTML rendering. A 4-line iterative fix matches the actual surface; pulling in `sanitize-html` or `dompurify` would add a 100KB dep for a 10-character bug.
- **`&amp;` decoded last**, not refactored to use a real HTML entity decoder. Same logic — the two helpers each handle ~10 specific entities tied to SAP's response format. A real entity decoder (`he`, `entities`) is overkill.
- **Tests cover the bug class**, not just the specific reported strings. The adversarial `<<script>script>` and `&amp;lt;` cases are obvious; the test suite also covers benign nested cases (`<div><span>x</span></div>`) and chained entities (`&amp;amp;`, `&amp;quot;`).

## Context

### Current State

- `src/adt/diagnostics.ts` defines three private helpers used by `SAPDiagnose` HTML-page parsing (gateway error logs, ST22 short dumps): `stripHtmlTags()`, `decodeHtmlEntities()`, `sanitizeHtmlCellValue()` (which composes the first two).
- `src/adt/xml-parser.ts` exports `decodeXmlEntities()` used to decode XML attribute values when `processEntities: false` is configured on `fast-xml-parser`.
- `tests/unit/adt/diagnostics.test.ts` exists but does NOT exercise `stripHtmlTags` / `decodeHtmlEntities` directly — it tests the higher-level diagnostic parsing functions. The helpers are untested.
- `tests/unit/adt/xml-parser.test.ts` exists but does NOT exercise `decodeXmlEntities` directly — same pattern.
- CodeQL has 3 open HIGH alerts on these helpers (alerts #6, #7, #8 on `branch:main`).

### Target State

- All three helpers behave correctly under adversarial inputs:
  - `stripHtmlTags("<<script>script>alert(1)</script>")` → `"alert(1)"` (currently `"<script>alert(1)"`)
  - `decodeHtmlEntities("&amp;lt;")` → `"&lt;"` (currently `"<"`)
  - `decodeXmlEntities("&amp;lt;")` → `"&lt;"` (currently `"<"`)
- New direct unit tests for each helper covering: happy path, double-escape inputs, nested/malformed HTML, chained entities.
- `npm run typecheck`, `npm run lint`, `npm test` all clean.
- After CodeQL re-scans, alerts #6, #7, #8 auto-close.

### Key Files

| File | Role |
|------|------|
| `src/adt/diagnostics.ts` | Defines `stripHtmlTags` (line 1111), `decodeHtmlEntities` (line 1115), `sanitizeHtmlCellValue` (line 1105) — composed in `parseGatewayCallStackHtml` and similar. Three helpers, ~25 LOC total. |
| `src/adt/xml-parser.ts` | Exports `decodeXmlEntities` (line 907) — used by `SAPRead` / metadata parsers when entity decoding is disabled at the parser level. |
| `tests/unit/adt/diagnostics.test.ts` | Existing diagnostics test file — no direct helper coverage today. Add a new `describe("HTML hygiene helpers", ...)` block. |
| `tests/unit/adt/xml-parser.test.ts` | Existing xml-parser test file — no direct `decodeXmlEntities` coverage today. Add a new `describe("decodeXmlEntities", ...)` block. |

### Design Principles

1. **Minimal surface change.** Don't introduce a sanitization library; the existing string-replacement approach is correct once the order/loop bugs are fixed. The helpers are private/internal and not part of any public API.
2. **Test the bug class, not just CodeQL's example.** Each fix gets adversarial cases plus benign cases plus a "regression locked" case for the literal CodeQL-reported input.
3. **No behavior change for valid HTML/XML.** The fix to `stripHtmlTags` must produce identical output to the old version for any input that didn't trigger the partial-strip bug; same for the entity decoders on inputs without `&amp;` chains.
4. **Inline comment the WHY.** Each fixed helper gets a short comment explaining why the order/loop matters, citing the CodeQL alert IDs. This prevents a future contributor "simplifying" the code back into the bug.

## Development Approach

This is pure code-change work — no SAP system interaction, no E2E surface, no new config. Three small fixes + unit tests. Order tasks so each helper lands with its own tests, so any regression in mid-stream is bisectable: stripper first (alert #6), then the two entity decoders (alerts #7, #8). Final task is a sweep + verification — `grep` for any other regex-based HTML processing in the codebase that might have similar bugs.

All test additions live in the existing `tests/unit/adt/diagnostics.test.ts` and `tests/unit/adt/xml-parser.test.ts` files (matching the source file mirror convention from CLAUDE.md). No new test files needed.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Fix stripHtmlTags (alert #6) + tests

**Files:**
- Modify: `src/adt/diagnostics.ts`
- Modify: `tests/unit/adt/diagnostics.test.ts`

`stripHtmlTags()` at [src/adt/diagnostics.ts:1111](src/adt/diagnostics.ts:1111) does a single-pass regex strip: `String(html ?? '').replace(/<[^>]*>/g, '')`. CodeQL alert #6 (`js/incomplete-multi-character-sanitization`) flags this because adversarial nested input like `<<script>script>` only strips one round and leaves `<script>` behind. Fix by looping until the string stops changing (or, equivalently, iterating until no `<` is matched). The function is private (only used by `sanitizeHtmlCellValue` in the same file), so changes are local.

- [ ] In `src/adt/diagnostics.ts`, replace the body of `stripHtmlTags` (line ~1111) with a loop:
  ```ts
  function stripHtmlTags(html: string): string {
    let result = String(html ?? '');
    let prev: string;
    do {
      prev = result;
      result = result.replace(/<[^>]*>/g, '');
    } while (result !== prev);
    return result;
  }
  ```
- [ ] Add an inline comment above the function explaining the loop: "Loop until stable so adversarial nested input (`<<script>script>`) is fully stripped — single-pass regex would leave `<script>` behind. Closes CodeQL alert `js/incomplete-multi-character-sanitization`."
- [ ] In `tests/unit/adt/diagnostics.test.ts`, add a new `describe('stripHtmlTags', ...)` block with **~5 unit tests**:
  - Happy path: `<p>hello</p>` → `hello`
  - Nested tags: `<div><span>x</span></div>` → `x`
  - Adversarial nested (the CodeQL case): `<<script>script>alert(1)</script>` → `alert(1)`
  - Empty / nullish input: `""`, `null`, `undefined` → `""`
  - Pre-stripped (no tags): `plain text` → `plain text`
- [ ] Note: `stripHtmlTags` is not exported. Either export it from `diagnostics.ts` for testability, or add an `export` only for tests via a dedicated test export. Prefer exporting it directly (the helper is small and standalone) — also export `decodeHtmlEntities` for the next task. If the export creates an unused-symbol lint warning, add `/** @internal */` JSDoc.
- [ ] Run `npm test` — all tests must pass, including the 5 new ones.
- [ ] Run `npm run lint` — no new issues.
- [ ] Run `npm run typecheck` — no new issues.

### Task 2: Fix decodeHtmlEntities (alert #7) + tests

**Files:**
- Modify: `src/adt/diagnostics.ts`
- Modify: `tests/unit/adt/diagnostics.test.ts`

`decodeHtmlEntities()` at [src/adt/diagnostics.ts:1115](src/adt/diagnostics.ts:1115) decodes a chain of HTML entities. The bug: `&amp;` is the second `.replace()`, so input `&amp;lt;` first becomes `&lt;`, then the next `.replace(/&lt;/gi, '<')` turns it into `<`. Final output is `<` — wrong. The expected output for `&amp;lt;` is `&lt;` (the literal four-character entity reference). Fix by moving the `&amp;` replacement to the **last** position so any `&amp;` produced by other replacements doesn't get further decoded.

- [ ] In `src/adt/diagnostics.ts`, reorder the `.replace()` calls in `decodeHtmlEntities` so `&amp;` → `&` is the LAST replacement, after all other named entities and numeric entities. Numeric entity replacements (`&#…;` and `&#x…;`) can stay where they are since their patterns don't overlap with `&amp;`. Final order:
  1. `&nbsp;` → space
  2. `&lt;` → `<`
  3. `&gt;` → `>`
  4. `&quot;` → `"`
  5. `&apos;` → `'`
  6. `&ndash;` → `–`
  7. `&mdash;` → `—`
  8. Numeric `&#(\d+);` → `String.fromCodePoint`
  9. Numeric `&#x([0-9a-f]+);` → `String.fromCodePoint`
  10. **`&amp;` → `&`** (last)
- [ ] Add an inline comment above the function: "`&amp;` is decoded LAST so chained entities like `&amp;lt;` resolve to `&lt;` (literal) rather than `<`. Closes CodeQL alert `js/double-escaping`."
- [ ] In `tests/unit/adt/diagnostics.test.ts`, add a `describe('decodeHtmlEntities', ...)` block with **~6 unit tests**:
  - Happy path: `&lt;p&gt;` → `<p>`
  - Single-pass entities: `&amp;` → `&`, `&nbsp;` → space, `&quot;` → `"`
  - Chained entity (the CodeQL case): `&amp;lt;` → `&lt;` (NOT `<`)
  - Mixed: `&amp;lt;p&gt;` → `&lt;p>` (the `&amp;` resolves last; `&gt;` resolves earlier)
  - Numeric entities: `&#65;` → `A`, `&#x41;` → `A`
  - Empty / nullish: `""`, `null`, `undefined` → `""`
- [ ] Run `npm test` — all tests must pass.
- [ ] Run `npm run lint` and `npm run typecheck` — no new issues.

### Task 3: Fix decodeXmlEntities (alert #8) + tests

**Files:**
- Modify: `src/adt/xml-parser.ts`
- Modify: `tests/unit/adt/xml-parser.test.ts`

`decodeXmlEntities()` at [src/adt/xml-parser.ts:907](src/adt/xml-parser.ts:907) is exported and used by `xml-parser`'s callers when `fast-xml-parser` is configured with `processEntities: false`. Same `&amp;`-first ordering bug as `decodeHtmlEntities`. Fix: move `&amp;` to last position.

- [ ] In `src/adt/xml-parser.ts`, reorder the `.replace()` calls in `decodeXmlEntities` so `&amp;` → `&` is the LAST replacement. Final order:
  1. `&lt;` → `<`
  2. `&gt;` → `>`
  3. `&quot;` → `"`
  4. `&apos;` → `'`
  5. **`&amp;` → `&`** (last)
- [ ] Update or extend the existing JSDoc above the function (currently lines 902–906) to mention the ordering: "`&amp;` is decoded LAST so chained entities like `&amp;lt;` resolve to the literal `&lt;` rather than `<`. Closes CodeQL alert `js/double-escaping`."
- [ ] In `tests/unit/adt/xml-parser.test.ts`, add a `describe('decodeXmlEntities', ...)` block with **~5 unit tests**:
  - Happy path: `&lt;tag/&gt;` → `<tag/>`
  - Single-pass entities: each of the 5 supported entities decodes correctly
  - Chained entity (the CodeQL case): `&amp;lt;` → `&lt;` (NOT `<`)
  - Round-trip: input with no entities passes through unchanged
  - Mixed: `&amp;quot;hello&quot;` → `&quot;hello"`
- [ ] Run `npm test` — all tests must pass.
- [ ] Run `npm run lint` and `npm run typecheck` — no new issues.

### Task 4: Codebase sweep for similar regex-based HTML/XML hygiene bugs

**Files:**
- Read-only sweep across `src/`
- Modify: `src/adt/diagnostics.ts` and/or `src/adt/xml-parser.ts` if other latent bugs are found
- Modify: relevant test file if a fix is added

The same bug class (single-pass regex strip OR `&amp;`-first decode) may exist elsewhere. Sweep to make sure we're not leaving siblings of #6/#7/#8 in the codebase. This task may end with no code change if the audit comes back clean.

- [ ] Run these greps from the repo root and read the matching code:
  - `grep -rnE "replace\(/<\[\\^>\]\*>" src/` — single-pass HTML tag strip
  - `grep -rnE "replace\(/&amp;" src/` — `&amp;` replacement (audit ordering at each site)
  - `grep -rn "decodeURIComponent\|decodeHTMLEntities\|stripHtml\|sanitiz" src/` — generic entity / sanitization helpers
- [ ] For each match outside the three already-fixed call sites: assess whether it has the same bug class. Document each finding in a short comment in the task's PR description (or in the code if a fix is needed).
- [ ] If a similar bug is found in another file: fix it in this same task using the same loop-until-stable / reorder pattern. Add unit tests in the corresponding `tests/unit/<area>/*.test.ts`. Cap any fix at ~10 LOC + 3 tests; if the work is bigger, defer to a follow-up issue and document in this task.
- [ ] If no other instances are found: note "Sweep clean — no other latent HTML/XML hygiene bugs in `src/`" in the PR description.
- [ ] Run `npm test` — all tests must pass.
- [ ] Run `npm run lint` and `npm run typecheck` — no new issues.

### Task 5: Final verification

- [ ] Run full test suite: `npm test` — all tests pass (including ~16 new tests across Tasks 1–3).
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] Manually verify the three CodeQL-flagged inputs return the expected output by running a one-shot script or a Node REPL:
  - `stripHtmlTags("<<script>script>x</script>")` → `"x"`
  - `decodeHtmlEntities("&amp;lt;")` → `"&lt;"`
  - `decodeXmlEntities("&amp;lt;")` → `"&lt;"`
- [ ] After PR merges to `main`: confirm CodeQL re-scans and auto-closes alerts #6, #7, #8 on the Security tab. (Default Setup runs CodeQL on every push to `main`.)
- [ ] Move this plan to `docs/plans/completed/codeql-alerts-html-hygiene.md`.
