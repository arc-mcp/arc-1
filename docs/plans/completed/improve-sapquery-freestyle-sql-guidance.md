# Improve SAPQuery Freestyle SQL Guidance & Multi-IN Auto-Chunking

## Overview

`SAPQuery` runs freestyle SQL against the ADT Data Preview endpoint
(`/sap/bc/adt/datapreview/freestyle`), which parses **ABAP Open SQL** — not native/standard SQL.
LLM clients routinely write native-SQL constructs that this parser rejects, and ARC-1 currently
mis-guides them: the tool description and an error hint blame `JOIN`s (citing SAP Note 3605050) and
tell the model to split queries, when live testing proves JOINs work fine and the real failures are
(1) dot field access `alias.field` instead of the Open-SQL tilde `alias~field`, (2) `ASC`/`DESC`
instead of the ABAP keywords `ASCENDING`/`DESCENDING`, and (3) long `IN (…)` lists that some
backends mis-parse. ARC-1 also auto-splits a long literal `IN`-list, but only when the query has
exactly **one** `IN`-clause — so a query like `… WHERE spras IN ('D','E') AND matnr IN (<many>)`
passes the long list through un-split and fails on stricter backends.

This plan makes `SAPQuery` steer the LLM correctly, at minimal always-on token cost, using a
two-tier design: a tight, correct **tool description** (paid every conversation) plus richer
**on-failure error hints** (paid only when a query 400s). It also extends auto-chunking to the
multi-`IN`-clause case so a plain "one short IN + one long IN" **filter** query just works — while
adding a semantics guard (no chunking of `ORDER BY`/`GROUP BY`/`DISTINCT`/aggregate queries) that also
fixes a pre-existing correctness bug in today's single-`IN` chunker. Finally it corrects the docs that
carried the wrong JOIN-split guidance and a stale `intent.ts` reference.

Success criteria (folded here as plain bullets, per ralphex Rule 2 — not a checkbox section):
- The `SAPQuery` tool description states the Open-SQL syntax rules that prevent the common failures (tilde field access, `ASCENDING`/`DESCENDING`, one SELECT) and states that JOINs/aggregates/subqueries work.
- On a 400 parser error, `SAPQuery` returns a specific, correct recovery hint for dot-notation, `ASC`/`DESC`, and long-`IN` mis-parse — and never re-emits the wrong "split the JOIN / SAP Note 3605050" advice.
- A query with multiple `IN`-clauses auto-chunks its longest literal `IN`-list; single-`IN` behavior is byte-for-byte unchanged.
- `docs_page/tools.md` and the freestyle capability-matrix research doc match the live-verified behavior; no code claims JOINs must be split.
- `npm test`, `npm run typecheck`, `npm run lint` all pass.

## Context

### Current State

- `src/handlers/tools.ts` → `SAPQUERY_DESC_ONPREM` (at HEAD): the middle sentence says the parser "can reject valid-looking statements on some releases … if parsing still fails, use one SELECT and stage multi-table logic (SAP Note 3605050)" — the wrong steer this plan removes.
- `src/handlers/query.ts` → `classifySapQueryParserError()` (at HEAD): builds the 400-error hint and appends a JOIN-specific hint (`SAP Note 3605050`, "split into staged single-table queries") whenever the SQL contains the word `JOIN` (the `if (/\bJOIN\b/i.test(sql))` block). It has no dot-notation, `ASC`/`DESC`, or long-`IN` handling.
- `src/handlers/query.ts` → `planSimpleInListChunking()`: auto-chunks a long literal `IN`-list **only when there is exactly one** `IN`-clause (`if (matches.length !== 1) return undefined;`). Multi-`IN` queries are never chunked.
- `src/handlers/shared.ts` → `hasSqlParserSignature()`: recognizes `only one select statement is allowed`, `invalid query string`, `due to grammar`, `is invalid here`, `is invalid at this position`. It does **not** recognize the `"… is not allowed here"` (ASC/DESC) or `"… longer than 255 characters"` messages.
- `docs_page/tools.md` (SAPQuery section, ~line 664–690): says JOINs "can fail on some backend versions" and to "split complex logic into staged queries"; example uses the correct `ORDER BY … DESCENDING`.
- `docs/research/2026-04-21-sapquery-freestyle-capability-matrix.md`: already correct on `ASC/DESC → ASCENDING/DESCENDING` (row) but (a) has **no** dot-vs-tilde row (the single most common failure), (b) repeats the "split JOINs" fallback, (c) references the removed `src/handlers/intent.ts` (now `src/handlers/query.ts`).

### Target State

- The `SAPQuery` description carries only high-leverage, correct Open-SQL rules; error hints carry the detailed recovery for dot / `ASC`·`DESC` / long-`IN`. JOINs are never described as needing a split.
- `planSimpleInListChunking()` chunks the **longest literal `IN`-list** even when other `IN`-clauses (or a short `IN`-list) are present; the other clauses stay constant in every chunk, so results are complete and duplicate-free. Single-`IN` behavior is unchanged.
- `docs_page/tools.md` and the capability-matrix doc match live-verified behavior; the stale `intent.ts` reference is fixed; a `SAPQuery`/freestyle row is added to the AGENTS.md Key Files table.

### Key Files

| File | Role |
|------|------|
| `src/handlers/tools.ts` | `SAPQUERY_DESC_ONPREM` — LLM-visible tool description (JSON Schema surface) |
| `src/handlers/query.ts` | `classifySapQueryParserError()` (error hints) + `planSimpleInListChunking()`/`runChunkedSapQuery()` (auto-chunking) |
| `src/handlers/shared.ts` | `hasSqlParserSignature()` — parser-signature gate for the generic hint |
| `tests/unit/handlers/search-navigate.test.ts` | `describe('SAPSearch / SAPQuery / …')` — SAPQuery handler + parser-hint tests |
| `tests/unit/handlers/tools.test.ts` | Tool-description content assertions for SAPQuery |
| `tests/unit/handlers/tool-definitions-snapshot.test.ts` + `tests/fixtures/tool-definitions/*.json` | Frozen LLM-visible tool surface (regenerate with `vitest -u`) |
| `docs_page/tools.md` | Published SAPQuery reference |
| `docs/research/2026-04-21-sapquery-freestyle-capability-matrix.md` | Freestyle capability matrix (research) |
| `AGENTS.md` | Key Files table (add a SAPQuery/freestyle row) |

### Verified Live Evidence

Captured **2026-07-09 against a4h.marianzeis.de (S/4HANA 2023, SAP_BASIS 758)** by POSTing raw SQL
to `/sap/bc/adt/datapreview/freestyle?rowNumber=N` with `Accept: application/vnd.sap.adt.datapreview.table.v1+xml`
and `Content-Type: text/plain` (CSRF token fetched via a prior GET on the same path). Recipe is the
CSRF-fetch-then-POST curl loop; equivalently `arc1-cli call SAPQuery --sql '<sql>'` with
`SAP_ALLOW_FREE_SQL=true` and `sql` scope (see `INFRASTRUCTURE.md`).

Parser = ABAP Open SQL. On 758:

| SQL fragment | Result | Note |
|---|---|---|
| `SELECT b~tabname FROM dd02l AS b` | 200 | tilde field access works |
| `SELECT b.tabname FROM dd02l AS b` | 400 `Only one SELECT statement is allowed.` | **dot** read as statement terminator |
| `… INNER JOIN dd02t AS t ON b~tabname = t~tabname …` | 200, real rows | JOIN works |
| `… LEFT OUTER JOIN …`, subquery `IN (SELECT …)`, `CASE`, `CAST`, `DISTINCT`, `COUNT(*)`, `GROUP BY`/`HAVING` | 200 | all supported |
| `ORDER BY tabname` / `ORDER BY tabname ASCENDING` / `… DESCENDING` / multi-col | 200 | plain + ABAP keywords work |
| `ORDER BY tabname ASC` **and** `… DESC` | 400 `"ASC"/"DESC" is not allowed here. "." is expected.` | **use `ASCENDING`/`DESCENDING`** |
| space-separated select list `SELECT a b …` | 400 `The elements in the "SELECT LIST" list must be separated using commas.` | comma-separate |
| host var `WHERE x = @lv` | 400 `Field "LV_NAME" is unknown.` | literals only, no `@host` vars |
| `INTO TABLE @DATA(lt)` / `UP TO 5 ROWS` appended | 200 (ignored) | tolerated on 758; do not rely on it |
| genuinely >255-char string literal | 400 `Only one SELECT statement is allowed.` | 758 message; SA1 (reporter) showed `text literal "'0000…  INTO  TABL…" is longer than 255 characters` — the endpoint's internal `INTO TABLE` wrapper, backend/release variance |
| user's exact 2-`IN` + ORDER BY shape (on `dd02l`) | 200 | the **shape** is valid; the reporter's 400 is a backend parser limit on the long list, not a syntax error |

Release note: the exact wording of the over-long-literal error varies by backend (758 → "only one SELECT"; the reporter's SA1 → "longer than 255 … INTO TABL"). Both mean "a literal was mis-parsed as too long" and both are recovered by splitting the `IN`-list. The tilde / `ASCENDING`·`DESCENDING` / comma / host-var rules are Open-SQL-fundamental and release-invariant.

### Design Principles

1. **Two-tier token economy.** The tool description is re-sent every conversation (`tools/list`), so it carries only the highest-leverage rules that prevent first-attempt failures; detailed recovery lives in error hints that are emitted only when a query 400s. The description token ratchet (`scripts/ci/check-tool-schema-budget.ts`) has ample headroom and this change is ~token-neutral — it replaces a wrong sentence with a correct one of similar length; the budget test (`tests/unit/scripts/check-tool-schema-budget.test.ts`) confirms.
2. **Correct the ORDER BY fact.** The freestyle parser rejects BOTH `ASC` and `DESC`; the fix is the ABAP keywords `ASCENDING`/`DESCENDING` (live-verified). Any text that says "ascending-only / sort client-side" is wrong and must be replaced.
3. **JOINs are supported.** Never tell the LLM (in description, hint, or docs) that JOINs must be split. The historical "SAP Note 3605050 / staged single-table queries" advice is removed — Note 3605050 is about ABAP keywords in field names, unrelated to JOINs.
4. **Chunking must preserve query semantics (Codex P1/P2).** `runChunkedSapQuery()` concatenates and row-caps chunk results with no global reduction/sort/dedup, so chunking is valid ONLY for a plain projection SELECT: bail (send whole) on `SELECT SINGLE`, `UP TO n ROWS`, `GROUP BY`/`HAVING`/`DISTINCT`/`UNION`/aggregate/`ORDER BY`. This guard also fixes a pre-existing latent bug in today's single-`IN` chunker (which chunks such queries and returns partial counts / per-chunk-sorted rows). Dedup the selected list's literals (order-preserving) before partitioning so a repeated literal across a chunk boundary can't duplicate rows. Chunk only a **literal** `IN`-list. Single-`IN` behavior for plain SELECTs stays byte-identical (regression-guarded). Consequence: an ordered/aggregated long-`IN` query (including the reporter's `… ORDER BY matnr, spras`) is NOT auto-chunked — the error hint (Task 2) guides the LLM to split and re-sort it.
5. **Scope boundaries.** No new env vars, config flags, tool params, or ADT endpoints. `SAPQuery`'s scope/safety gates and the `TABLE_QUERY`/`buildTableQuerySql` structured path are out of scope. Read behavior of every other tool is unchanged.

## Development Approach

TDD where practical: for each error-hint and the multi-`IN` chunker, write the failing unit test
first (mock the exact live-captured SAP message via `mockResponse(400, '<message>')`), then implement
until green. Reuse the existing `describe('… SAPQuery …')` block in
`tests/unit/handlers/search-navigate.test.ts` and the `mockResponse`/`vi.mock('undici', …)` pattern
from `tests/helpers/mock-fetch.ts`. Cover failure/negative and input-pollution paths, not just happy
paths: a query that contains `JOIN` **and** a dot must get the tilde hint (not a JOIN hint); a query
with `ASC` in a string literal (`WHERE text = 'BASIC'`) must **not** trigger the ASC/DESC hint
(mask string literals first); a tilde `JOIN` with an `INTO` clause must not be mis-flagged as
dot-notation. The tool-description change alters the frozen tool-definition JSON — regenerate with
`npx vitest run -u tests/unit/handlers/tool-definitions-snapshot.test.ts` and review the fixture diff
(it must touch only the SAPQuery description across the on-prem variants that expose SAPQuery).
Fixture provenance: the SAP error strings mocked in tests are copied verbatim from the live captures
above — do not paraphrase them (the hint triggers match on them).

Note for an in-session implementer (not a fresh ralphex run): this branch's working tree may already
contain a partial, in-flight implementation of Tasks 1–2 from earlier turns — including an **incorrect**
`ORDER BY ascending-only … sort client-side` hint. Reconcile the working tree to the end state described
in these tasks (the correct rule is `ASCENDING`/`DESCENDING`). A fresh ralphex run starts from HEAD, which
has none of those edits, and should follow the tasks verbatim.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Correct the SAPQuery tool description (Open-SQL syntax guidance)

**Files:**
- Modify: `src/handlers/tools.ts` (`SAPQUERY_DESC_ONPREM`, near `// ─── SAPQuery ───`)
- Modify: `tests/unit/handlers/tools.test.ts` (the `on-premise SAPQuery description …` test)
- Modify: `tests/fixtures/tool-definitions/*.json` (regenerate — see below)
- Verify: `scripts/ci/check-tool-schema-budget.ts` budget still passes

Context: the description is the always-on nudge that shapes the LLM's first attempt. It currently
carries the wrong "split multi-table logic (SAP Note 3605050)" steer and (in the working tree) a wrong
"ORDER BY ascending-only / sort client-side" claim. Replace the middle sentence with a tight, correct
Open-SQL rule. Keep the first sentence (reverse-engineering metadata tables) and the last sentence
(CDS-consumer → SAPContext) intact.

- [x] Replace the SAPQuery-syntax sentence in `SAPQUERY_DESC_ONPREM` with exactly the following (a single `'…'`-quoted JS string literal `+`-concatenated to the surrounding sentences — the inner double quotes need no escaping inside a single-quoted literal; keep the trailing space):

      'Syntax = ABAP Open SQL, read-only, one SELECT per call: field access is alias~field (tilde, NOT alias.field — a dot reads as end-of-statement → error "only one SELECT is allowed"); sort with ORDER BY … ASCENDING/DESCENDING (the SQL abbreviations ASC/DESC are rejected). JOINs, GROUP BY, aggregates and subqueries all work; ARC-1 auto-chunks long literal IN-lists. '

- [x] Do NOT touch `SAPQUERY_DESC_BTP` (its queries hit released CDS views; the shared error hints cover syntax there). Leave it unchanged.
- [x] Regenerate the frozen tool surface: `npx vitest run -u tests/unit/handlers/tool-definitions-snapshot.test.ts`. Confirm `git diff tests/fixtures/tool-definitions/` shows ONLY the SAPQuery `description` text changing, and only in the on-prem variants that include SAPQuery (read-only variant excludes it; BTP variants use the BTP description).
- [x] Update the `on-premise SAPQuery description …` test in `tools.test.ts`: assert the description contains `alias~field`, `ASCENDING/DESCENDING`, `JOINs`, and `auto-chunks long literal IN-lists`; assert it does NOT contain `3605050` or `stage multi-table`.
- [x] Run `npm test` — all tests pass (tool-definitions snapshot + tools.test + budget guard).

### Task 2: Correct and complete the 400-error recovery hints

**Files:**
- Modify: `src/handlers/query.ts` (`classifySapQueryParserError()`)
- Modify: `tests/unit/handlers/search-navigate.test.ts` (`describe` block covering SAPQuery parser hints)

Context: on a 400 the handler calls `classifySapQueryParserError(err, sql)` (see `handleSAPQuery` catch
block). Make it emit a specific, correct hint for the three live-verified failure modes and remove the
wrong JOIN advice. `combined = err.message + '\n' + (err.responseBody ?? '')`. Use the existing
`maskSqlStringLiterals()` helper so quoted text can't false-trigger. Ordering matters: the dot and
ASC/DESC and 255 checks run BEFORE the `hasSqlParserSignature(combined)` gate (their messages are not
generic signatures); the dot check runs inside the signature branch (its message
`only one select statement is allowed` IS a signature). The function must still start with
`if (err.statusCode !== 400) return undefined;`.

- [x] **Dot-notation** (inside the signature branch, first): if `maskSqlStringLiterals(sql)` matches `/\b[A-Za-z_]\w*\.[A-Za-z_]\w*/` (identifier·dot·identifier; the letter-after-dot excludes numeric literals like `100.50`), return a hint naming the exact tilde fix — e.g. suggest `dot[0].replace('.', '~')` ("write `b~trkorr`, not `b.trkorr`") and state that JOINs/WHERE work once dots become tildes. Do NOT mention Note 3605050 or splitting JOINs.
- [x] **ASC/DESC** (before the signature gate): if the SQL has `ORDER BY … (ASC|DESC)` as a standalone keyword (mask literals first; match on masked SQL so `WHERE x = 'BASIC'` does not trigger) AND `combined` matches `/\bis not allowed here\b/i`, return: use the ABAP keywords `ASCENDING`/`DESCENDING`, not `ASC`/`DESC`. (Correct the prior working-tree hint that said "ascending-only / sort client-side" — that is wrong.)
- [x] **Long-IN / over-long literal** (before the signature gate): if `combined` matches `/longer than 255 characters/i`, return: a text literal was parsed as >255 chars — typically a long `IN`-list this backend mis-read as one literal; split the largest `IN`-list into batches (~5–8 values), union the results (and re-sort client-side if the query is ordered). State the real boundary accurately (Codex P2): ARC-1 auto-chunks the longest literal `IN`-list of a **plain** SELECT, but does NOT chunk queries with `ORDER BY`/`GROUP BY`/`DISTINCT`/aggregates (to preserve semantics), so those must be split manually. Use the `chunkingAttempted` flag already threaded into the `catch` block (see `handleSAPQuery`) to tailor the wording when a chunk was attempted and still failed — do NOT claim ARC-1 "cannot" chunk multiple `IN`-clauses.
- [x] **Generic fallback** (after the signature gate, when none of the above matched): keep the existing "one SELECT / remove INTO/APPENDING/PACKAGE SIZE" hints. Remove the `if (/\bJOIN\b/i.test(sql)) …` block entirely — JOINs are supported.
- [x] Update the pre-existing test `returns parser hint with JOIN-specific addendum when a JOIN query fails with 400` in `search-navigate.test.ts` — at HEAD it asserts the now-removed `SAP Note 3605050` / `staged single-table queries` strings and will fail once the JOIN block is gone. Repurpose it into the JOIN-with-INTO case below (assert the generic target-clause hint, and `not.toContain('3605050')`).
- [x] Tests (~6, in the SAPQuery parser-hint `describe`), each mocking the verbatim live SAP message via `mockResponse(400, '<message>')`:
      - dot-notation: SQL `… b.trkorr … INNER JOIN … ORDER BY b.trkorr`, body `Only one SELECT statement is allowed.` → hint contains `b~trkorr` and `tilde`, and NOT `3605050` / `single-table`.
      - ASC/DESC: SQL `… ORDER BY tabname DESC`, body `"DESC" is not allowed here. "." is expected.` → hint contains `ASCENDING`/`DESCENDING`; also a case with `… ORDER BY tabname ASC` + `"ASC" is not allowed here.`
      - false-positive guard: SQL `SELECT descr FROM zt WHERE descr = 'ASC TEST'` with a generic 400 signature must NOT return the ASC/DESC hint (the `ASC` is inside a literal / not an ORDER BY direction).
      - long-IN: SQL = the reporter's 2-`IN` makt query, body `The text literal "'0000000000 INTO TABL..." is longer than 255 characters.` → hint contains `Split the largest IN-list` and `multiple IN-clauses`.
      - JOIN-with-INTO: SQL `… a~x … INNER JOIN … INTO TABLE @DATA(lt)`, body `"INTO" is invalid at this position` → generic hint (`Remove ABAP target clauses`), NOT a tilde hint and NOT a JOIN-split hint.
- [x] Run `npm test` — all tests pass.

### Task 3: Extend auto-chunking to multi-IN-list queries

**Files:**
- Modify: `src/handlers/query.ts` (`planSimpleInListChunking()`; `SAPQUERY_IN_LIST_CHUNK_SIZE` unchanged)
- Modify: `tests/unit/handlers/search-navigate.test.ts` (chunking `describe`)

Context: `planSimpleInListChunking()` currently bails when the query has more than one `IN`-clause
(`if (matches.length !== 1) return undefined;`), so `… spras IN ('D','E') AND matnr IN (<10>)` is sent
whole and can fail on stricter backends. Change it to pick the **longest literal `IN`-list** to chunk
while holding all other clauses constant.

**Semantics guard (Codex P1 — also fixes a pre-existing bug).** `runChunkedSapQuery()` (same file) merely
runs each chunk statement and concatenates the rows up to `maxRows` — it performs no global reduction,
sort, or dedup. So chunking is only valid for a **plain projection SELECT**. A query that has `SELECT SINGLE`,
`UP TO n ROWS`, `GROUP BY`, `HAVING`, `DISTINCT`, `UNION`, an aggregate
(`COUNT(`/`SUM(`/`AVG(`/`MIN(`/`MAX(`/`STRING_AGG(`), or `ORDER BY` would
return partial-per-chunk results (e.g. two partial `COUNT`s instead of one total, or rows sorted only
within each chunk). The current single-`IN` chunker has this latent bug today; this task fixes it for both
single- and multi-`IN` by adding the guard to the shared planner. Keep the existing `;`-guard and
`countSelectKeywords(masked) !== 1` guard (a subquery makes count ≥ 2 → no chunking).

- [x] Add the semantics guard early in `planSimpleInListChunking()`, on the **masked** SQL (so a keyword
      inside a string literal can't trigger it): `return undefined` if `maskedSql` matches any of
      `/\bSELECT\s+SINGLE\b/i`, `/\bUP\s+TO\s+\d+\s+ROWS?\b/i`, `/\bGROUP\s+BY\b/i`, `/\bHAVING\b/i`,
      `/\bORDER\s+BY\b/i`, `/\bUNION\b/i`, `/\bDISTINCT\b/i`, or
      `/\b(?:COUNT|SUM|AVG|MIN|MAX|STRING_AGG)\s*\(/i`. This applies to the single-`IN` path too — it is the pre-existing
      bug fix, not just a multi-`IN` gate.
- [x] Replace the single-match logic with multi-match selection. For each `field IN (` match from
      `[...maskedSql.matchAll(/\b[A-Za-z_][A-Za-z0-9_~.]*\s+IN\s*\(/gi)]`:
      - resolve `fieldName`; skip if it is `NOT` (i.e. a `NOT IN`);
      - compute its `openParen`/`closeParen` via `findMatchingParen(maskedSql, openParen)`; skip if `< 0`;
      - parse `literals = parseSingleQuotedLiteralList(sql.slice(openParen + 1, closeParen))`; skip if
        falsy/empty (this drops `IN (SELECT …)` subqueries and non-literal lists).
      Track the candidate with the **most** literals.
- [x] Dedup the winning list's literals order-preservingly BEFORE partitioning (Codex P2): a repeated
      literal split across a chunk boundary would otherwise duplicate rows, because `IN` has set semantics
      but chunk rows are concatenated. Dedup the **input literals** (e.g. keep first occurrence via a
      `Set`), NOT the result rows (result rows may be legitimately duplicated by a non-unique projection).
- [x] If no literal candidate has `literals.length > chunkSize` (after dedup), return `undefined`
      (unchanged behavior: short lists and no-literal-`IN` queries are not chunked). Otherwise chunk the
      winning candidate: `prefix = sql.slice(0, winner.openParen + 1)`, `suffix = sql.slice(winner.closeParen)`,
      and emit `statements` of `chunkSize` deduped literals each. Every other clause (including a second
      short `IN`-list) rides along in `prefix`/`suffix` unchanged.
- [x] Regression guard: a single-`IN` **plain** SELECT that chunks today (e.g. the existing
      `SELECT object_name FROM tadir WHERE object_name IN (<10>)` test) must produce the identical
      `statements` array (same order, same content). Add an explicit assertion.
- [x] Tests (~7, in the chunking `describe`; mock CSRF-200 then one 200 `mockResponse` per expected chunk
      using `dataPreviewXmlWithMetrics(...)`, then assert merged rows):
      - multi-`IN`: `… WHERE spras IN ('D','E') AND matnr IN (<10 literals>)`, no ORDER BY → chunks the
        `matnr` list (2 statements), each still carrying `spras IN ('D','E')`; assert outgoing statements
        contain `spras IN ('D','E')` and disjoint `matnr` slices.
      - longest-list selection: two literal `IN`-lists where the SECOND is longer → the second is chunked.
      - **semantics guard (P1):** a long single-`IN` query WITH `ORDER BY` → NOT chunked (`undefined`); one
        with `COUNT(*)`/`GROUP BY` → NOT chunked. (These would have chunked before this task — the failure path.)
      - **dedup (P2):** a long `IN` list containing a duplicate literal spanning a chunk boundary → the
        planned `statements` contain the literal exactly once (no cross-chunk duplication).
      - subquery skip: `… matnr IN (SELECT …)` → not chunked (also trips the `countSelectKeywords` guard).
      - `NOT IN` skip: the long list is a `NOT IN` → that candidate is skipped.
      - single-`IN` regression: unchanged statement array vs the pre-existing single-`IN` chunk test.
- [x] Run `npm test` — all tests pass.

### Task 4: Update documentation to match live-verified behavior

**Files:**
- Modify: `docs_page/tools.md` (SAPQuery section, ~line 664–690)
- Modify: `docs/research/2026-04-21-sapquery-freestyle-capability-matrix.md`
- Modify: `AGENTS.md` (Key Files table)

Context: docs currently repeat the "JOINs can fail → split" myth and the capability matrix references the
removed `src/handlers/intent.ts`. Docs run after code so they describe as-shipped behavior. State the
release caveat (over-long-literal wording varies by backend) explicitly rather than over-promising.

- [x] `docs_page/tools.md`: in the SAPQuery "Important" block, add the two rules that prevent the common
      failures — field access `alias~field` (tilde, not `alias.field`) and `ORDER BY … ASCENDING/DESCENDING`
      (not `ASC`/`DESC`). Replace the "JOINs can fail … split complex logic into staged queries" wording
      with: JOINs, aggregates, and subqueries are supported; ARC-1 auto-chunks a long literal `IN`-list
      (the longest one, even with several `IN`-clauses) for **plain** SELECTs — queries with
      `ORDER BY`/`GROUP BY`/`DISTINCT`/aggregates are sent whole (chunking would break their semantics),
      so split those manually if a backend rejects the long list. Keep the working `DESCENDING` example. Verify the
      capability-matrix link target `docs/research/2026-04-21-sapquery-freestyle-capability-matrix.md`
      resolves (it does — do not "fix" it to a non-dated name).
- [x] `docs/research/2026-04-21-sapquery-freestyle-capability-matrix.md`: (a) ADD a matrix row for dot vs
      tilde field access (`alias.field` → rejected `Only one SELECT statement is allowed`; use `alias~field`)
      — the current #1 gap; (b) correct the `JOIN` row: JOINs are supported and reliable on tested backends
      (750/758/816 as applicable) — the historical failures attributed to JOINs are dot-notation; remove the
      "split into staged single-table selects" as the primary fallback; (c) add a row/note for the long-`IN`
      over-long-literal mis-parse and ARC-1's multi-`IN` auto-chunking — noting it is limited to plain SELECTs
      (no `ORDER BY`/`GROUP BY`/`DISTINCT`/aggregate) to preserve semantics; (d) fix the stale
      `src/handlers/intent.ts` reference in "Sources" to `src/handlers/query.ts` (`handleSAPQuery`,
      `classifySapQueryParserError`, `planSimpleInListChunking`).
- [x] `AGENTS.md`: add a Key Files row, e.g. `| SAPQuery freestyle SQL hints + IN-list chunking | src/handlers/query.ts (classifySapQueryParserError, planSimpleInListChunking) — freestyle = ABAP Open SQL: alias~field not alias.field, ASCENDING/DESCENDING not ASC/DESC; auto-chunks longest literal IN-list of plain SELECTs only |`. Keep it terse (one gotcha), per the AGENTS.md conventions.
- [x] No test changes required for docs. Run `npm run lint` to confirm markdown/format hooks pass; run `npm test` to confirm nothing regressed.

### Task 5: Final verification

- [x] Run full test suite: `npm test` — all tests pass.
- [x] Run typecheck: `npm run typecheck` — passes cleanly.
- [x] Run lint: `npm run lint` — no errors.
- [x] Grep guard: `grep -rn "3605050\|staged single-table\|split into staged\|ascending-only" src/` returns nothing (all wrong guidance removed from code).
- [x] Confirm `git diff tests/fixtures/tool-definitions/` is limited to the SAPQuery description text.
- [x] Live verification (creds per `INFRASTRUCTURE.md`, `SAP_ALLOW_FREE_SQL=true` + `sql` scope) on a4h (758): run three `SAPQuery` calls end-to-end and confirm 200 + rows — (a) a tilde JOIN, (b) `ORDER BY … DESCENDING`, (c) a two-`IN` query whose long list exceeds `chunkSize` (confirm it returns merged rows, i.e. auto-chunked). Use `arc1-cli call SAPQuery --sql '<sql>'` or the datapreview curl recipe; do not commit throwaway scripts. If the box is down, note it as unverified.
- [x] Move this plan to `docs/plans/completed/`, then fix any relative links inside it (completed plans sit one directory deeper — `../` paths gain a level).
