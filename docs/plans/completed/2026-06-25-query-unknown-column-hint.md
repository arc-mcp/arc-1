# Self-Correcting "Unknown Column" Hint for SAPQuery / Table Preview (FEAT-64)

## Overview

When a SQL query or table preview references a column that doesn't exist, SAP returns a bare
`Unknown column name "X"` 400 — a dead end for an LLM agent, which then guesses again or escalates.
ARC-1 already self-corrects unknown *table* names in `SAPQuery` (suggests similar names via
`searchObject`), but not unknown *columns*. This plan adds the column equivalent: on an unknown-column
error, enrich the message with the table's **actual** column list so the agent retries in one shot.

Competitor parity: dassian-adt `afc1b66` (`unknownColumnHint` — detect "unknown column name", fetch
the table's field list, append "Available columns: …"; best-effort, never throws).

> **Update — #502 review (language-independence).** The shipped `extractUnknownColumn` does **not** match
> the localized English prose described below. SAP localizes the error text by logon language
> (live-verified DE: `Unbekannter Spaltenname "X"`), so detection now anchors on the language-stable
> T100 message id — class `ADT_DATAPREVIEW_MSG` number `004` (missing-table is `022`, used as a
> false-positive guard) — and extracts the always-quoted column from `T100KEY-V1`. Verified end-to-end
> on 758 + 816 in EN **and** DE (the hint now fires under DE; it did not before); 7.50's datapreview is
> unbound (404) so the hint is N/A there. The regex references in the sections below describe the
> original English-only detection, kept for historical context.

Ponytail: two tiny pure helpers + two best-effort call-site enrichments that reuse existing primitives
(`runQuery` / `getTableContents`). No new ADT endpoint, no new scope, no config.

Success criteria (plain bullets):
- A `SAPQuery` with a bad column returns the valid column list; a clean query is unchanged.
- A `SAPRead(type=TABLE_CONTENTS, sqlFilter=…bad column…)` does the same.
- If column discovery fails (e.g. the endpoint is unavailable), the original error is shown unchanged
  (best-effort — never throw, never mask the real error).

## Context

### Current State

- `src/handlers/query.ts` `handleSAPQuery` catch block (~`:179`): on a 404 (`isNotFound`) it extracts the
  table from the SQL `FROM` and suggests similar table names; then an `AdtApiError` branch calls the
  local `classifySapQueryParserError` (`:9`). Unknown-column errors are 400s — they fall through to the
  parser-hint branch with no column help.
- `src/handlers/read.ts` `TABLE_CONTENTS` case (~`:585`): `client.getTableContents(name, maxRows, sqlFilter)`
  with no catch — an unknown-column error in `sqlFilter` propagates raw.
- Column sources already exist: `client.runQuery(sql, maxRows)` → `{ columns, rows }` (free-SQL gate);
  `client.getTableContents(name, maxRows, sqlFilter?)` → `{ columns, rows }` (data-preview gate). A
  `SELECT *` / no-filter call returns the full column list.
- `src/adt/errors.ts` already hosts `AdtApiError`; `tests/unit/adt/errors.test.ts` exists. There is **no**
  `tests/unit/handlers/query.test.ts`.

### Target State

- Two pure exported helpers in `src/adt/errors.ts`: `extractUnknownColumn(err)` and
  `formatUnknownColumnHint(badCol, table, columns)`.
- `query.ts` and `read.ts` enrich unknown-column errors using their own gate-appropriate column fetch.

### Verified Live Evidence

- **2026-06-24, a4h 758 AND a4h-2025 816 — identical:** `SAPQuery(sql='SELECT mandt, nosuchcol FROM t000')`
  → `POST /sap/bc/adt/datapreview/freestyle` `400`, message **`Unknown column name "NOSUCHCOL".`**
  (`AdtApiError`, `statusCode 400`). The bad column name is in the message.
- **2026-06-24, a4h 758:** `SAPQuery(sql='SELECT * FROM t000', maxRows=1)` → `{ "columns": ["MANDT","MTEXT",…] }`
  — confirms `runQuery('SELECT * FROM <table>', 1)` is a valid column source.
- **2026-06-24, NPL 7.50:** `/datapreview/freestyle` returns **`404 No suitable resource found`**
  (`icf-handler-not-bound`) — the datapreview ABAP handler is not bound on this SP (same as
  `datapreview/ddic`, see INFRASTRUCTURE.md). So SAPQuery free-SQL does not work on 7.50 at all and the
  hint is correctly **N/A** there (no unknown-column error to enrich; the original 404 is shown). This
  is graceful by construction — `extractUnknownColumn` returns null for a 404.
- Detection regex live-validated against the real message: `/Unknown column name\s+"?([A-Za-z0-9_/]+)"?/i`
  captures `NOSUCHCOL`.

### Design Principles

1. **Best-effort, never throw, never mask.** The enrichment is a `try/catch` that returns null on any
   failure; the original error is the fallback. A column fetch that fails (404 on 7.50, perms, etc.)
   leaves behavior unchanged.
2. **Gate-appropriate column fetch.** SAPQuery path fetches columns with `runQuery` (free-SQL is already
   on in that path); TABLE_CONTENTS path fetches with `getTableContents` (data-preview already on). Do
   NOT cross gates (using `runQuery` in the TABLE_CONTENTS path could hit a disabled free-SQL gate).
3. **Validate the table name** parsed from SQL before interpolating it into `SELECT * FROM <table>`
   (regex `^[A-Za-z0-9_/]+$`; the name already came from the user's gate-passed SQL, this is defence in
   depth — `sanitizeIdentifier` is private to client.ts, so inline-validate).
4. **Release-aware:** 758/816 → hint applies; 7.50 → N/A (datapreview unbound), degrades to the original
   error. No new release gate needed — the best-effort catch handles it.
5. No new scope/config/endpoint.

## Development Approach

TDD on the pure helpers first (they carry the logic): `extractUnknownColumn` returns the column for the
real 400 message and null for unrelated errors / 404 / non-AdtApiError; `formatUnknownColumnHint`
renders the list. Then wire the two call sites (best-effort). Failure paths are inherent: the
column-fetch `catch` (return original error) is the negative path and must be covered.

Wiring is verified **live** (integration), not by mocking datapreview wire XML: SAPQuery with a bad
column on 758 + 816 must surface "Available columns: …"; TABLE_CONTENTS with a bad `sqlFilter` column
must too. 7.50 asserts the graceful path (original 404, no hint).

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Pure helpers in errors.ts + unit tests

**Files:**
- Modify: `src/adt/errors.ts` (add `extractUnknownColumn`, `formatUnknownColumnHint`)
- Modify: `tests/unit/adt/errors.test.ts`

- [ ] Add `export function extractUnknownColumn(err: unknown): string | null` — returns the column name
      iff `err instanceof AdtApiError` and `err.message` matches
      `/Unknown column name\s+"?([A-Za-z0-9_/]+)"?/i`; else null.
- [ ] Add `export function formatUnknownColumnHint(badColumn: string, tableName: string, columns: string[]): string`
      → e.g. ``Unknown column "${badColumn}" on ${tableName.toUpperCase()}. Available columns: ${columns.join(', ')}.``
- [ ] Unit tests (~6): the real message `Unknown column name "NOSUCHCOL".` → `NOSUCHCOL`; case variants;
      a 404 / not-found AdtApiError → null; a non-AdtApiError → null; a parser error without the phrase →
      null; `formatUnknownColumnHint` renders the list + upper-cases the table.
- [ ] Run `npm test`.

### Task 2: Enrich SAPQuery (free-SQL path)

**Files:**
- Modify: `src/handlers/query.ts` (the `catch` in `handleSAPQuery`, ~`:179`; import the two helpers from `../adt/errors.js`)
- Modify: `tests/unit/adt/errors.test.ts` is Task 1; for the handler, add a focused test only if the existing harness supports it (no `query.test.ts` exists — prefer the live integration test in Task 4)

- [ ] In the `AdtApiError` branch (after the `isNotFound` table-suggestion block), add: `const badCol =
      extractUnknownColumn(err);` if `badCol`, parse the table from the SQL (reuse the existing
      `sql.match(/FROM\s+["']?([A-Za-z0-9_/$]+)["']?/i)`), validate it `^[A-Za-z0-9_/]+$`, then in a
      `try { const { columns } = await client.runQuery(\`SELECT * FROM ${table}\`, 1); if (columns.length)
      return errorResult(formatUnknownColumnHint(badCol, table, columns)); } catch { /* best-effort */ }`.
      Fall through to the existing `classifySapQueryParserError` hint when discovery yields nothing.
- [ ] Run `npm test`.

### Task 3: Enrich SAPRead TABLE_QUERY (data-preview path)

> **Live correction (2026-06-24):** the named-table unknown-column error surfaces via **`TABLE_QUERY`**
> (explicit `columns`, which builds a `SELECT col… FROM t` on `/datapreview/freestyle` → `Unknown column
> name "X"`), NOT `TABLE_CONTENTS` — a bad `sqlFilter` column there returns a generic "Invalid query
> string" (already hinted). So the wrap goes on the `TABLE_QUERY` case (`read.ts:~605`,
> `client.runTableQuery`), with `getTableContents(name, 1)` as the column source. Verified live on 758.

**Files:**
- Modify: `src/handlers/read.ts` (`TABLE_CONTENTS` case ~`:585`; import the helpers)
- Modify: `tests/unit/handlers/read.test.ts`

- [ ] Wrap the `getTableContents` call: on catch, `const badCol = extractUnknownColumn(err);` if `badCol`,
      `try { const { columns } = await client.getTableContents(name, 1); if (columns.length) return
      errorResult(formatUnknownColumnHint(badCol, name, columns)); } catch {}` then `throw err` (preserve
      the original error path for the dispatcher when no hint is produced).
- [ ] Unit test in `read.test.ts` (mockFetch harness): a `getTableContents` that 400s with
      `Unknown column name "X"`, followed by a clean `getTableContents(name,1)` returning columns →
      result contains "Available columns"; AND a probe-failure case where the second call also errors →
      the original error propagates (best-effort). (If wiring at the mockFetch layer proves brittle for
      the datapreview/ddic shape, cover this path via the live integration test in Task 4 instead and
      keep only the rethrow-on-no-hint unit assertion.)
- [ ] Run `npm test`.

### Task 4: Live integration tests + docs

**Files:**
- Modify: `tests/integration/adt.integration.test.ts` (or the existing SAPQuery/table integration suite — verify the real path)
- Modify: `docs_page/tools.md` (SAPQuery / TABLE_CONTENTS — note the self-correcting column hint), `AGENTS.md` if a row fits

- [ ] Integration (guarded by `TEST_SAP_URL` + `SAP_ALLOW_FREE_SQL`/`SAP_ALLOW_DATA_PREVIEW`): SAPQuery
      `SELECT mandt, nosuchcol FROM t000` → error text contains `Available columns:` and `MANDT`.
      TABLE_CONTENTS on `T000` with a bad `sqlFilter` column → same. On 7.50 (`requireOrSkip` /
      expect the datapreview-unbound 404) assert no crash and the original error.
- [ ] Docs note.
- [ ] Run `npm test`.

### Task 5: Final verification

- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — green.
- [ ] Live smoke on 758 + 816: `SAPQuery(sql='SELECT mandt, nosuchcol FROM t000')` shows the column
      list; 7.50 shows the graceful original error. (creds per INFRASTRUCTURE.md; do not commit scripts).
- [ ] Move this plan to `docs/plans/completed/`.
