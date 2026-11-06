# Claude plan review — dump-filter extraction

| | |
|---|---|
| Plan | `docs/plans/2026-10-17-dump-filter-extraction.md`, **untracked** in `/Users/marianzeis/.codex/worktrees/dump-filter-extraction/arc-1` (SHA-256 `724932f1…3c50`) |
| Base | main **`498c12bbab1b4c6337e01e3451c5811ba8b8aa97`** |
| Source | #1011 at **`5725fab6515f7a410e3e488003ae1a7aa3d8c249`** |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Read-only: `git show` against main and the source commit. No edits, tests, SAP, models or network. |

## Verdict

**The plan is sound and well bounded, and approved once four items are made explicit (P1–P4).**

Already right:

- the scope (filters plus optional `feed_schema` only, with no transport/notebook dependency,
  cache, preflight, new tool or query engine);
- the plan-review questions;
- the test matrix;
- validating dates before any schema request, which also corrects #1011's order;
- the #1011 disposition (stays open for batch syntax).

P1–P4 are places where a verbatim port of #1011 would contradict the plan's own goals. Each needs
one sentence in the plan and one test.

## Must be explicit before implementation

### P1 — Keep unfiltered calls unbounded and unchanged (do not port #1011's choice)

#1011 passes its 30 s deadline and 2-MiB `DataResponseBudget` to **every** dump page, filtered or
not. It also changed `tests/unit/adt/diagnostics.test.ts` to expect those options, and it
documents that "page bounds also apply to existing unfiltered dump lists".

On main, a response budget changes the wire behavior. In the connectivity-proxy path,
`http.ts:1421-1436` forces `Accept-Encoding: identity` and stops reusing the stateful proxy client.
Every path also gets the new overall deadline and byte cap. That conflicts with plan item 3 ("keep
the legacy unfiltered path's wire behavior and request count").

**Required:**

- pass the request options only when filters are present;
- do not port the test or doc change;
- add a test that an unfiltered list calls `http.get` with exactly the previous `(path, headers)`,
  the same URL and no schema read.

### P2 — Port the dump and schema limit advice, nothing else

On main, `dispatch.ts:197-200` has a dedicated branch only for `repository-relations`. Every other
`AdtResponseLimitError` gets the data-preview text ("lower maxRows … WHERE clause"); this was
review-1 M3.

**Required:**

- port only the `dumps` and `feed-schema` hints from #1011's `dispatch.ts`, keeping the stable
  JSON code;
- test both normal and minimal-error modes.

### P3 — Split the mixed #1011 files; filter hunks only

`src/handlers/diagnostic-inputs.ts` imports `SYNTAX_BATCH_TYPES` from `syntax-batch.js` and
defines the batch `objects` schemas. Port only:

- `dumpFilters`/`dumpFiltersJson`;
- the "filters only in list mode without `id`" rule;
- the `feed_schema` allowlist with the placeholder predicate.

Explicitly exclude:

- the `diagnosticObjectsSchema` rename and the SAPDiagnose `objects`-for-`syntax` rule;
- SAPRead `objects` and its placeholder rule, and the SYNTAX filler refactor in `schemas.ts`;
- the `activation_log` policy, catalog and description entries;
- the `syntax-batch`/`ddic-activation-log` dispatch hints;
- the `devtools.ts` exports.

Keep `filters: []` normalization (review-1 M1a) and the trimmed `user` composition (O3).

### P4 — Answer "can a filter silently broaden?" for unqualified targets

The filtered path re-serializes with `URLSearchParams` (`%24query`, `%24top`, space as `+`). The
long-standing `user` path sends a literal `$query=` with `encodeURIComponent`. The code does not
check that returned rows satisfy the filter. A target that ignored the encoded key would therefore
return unfiltered rows labelled as filtered. Only A4H 758 is verified, and only its negative probe
rules this out.

**Minimal fix:**

- reuse the legacy encoder for the compiled query (less code, one wire format);
- decide whether the first extraction allows `*` and space in string values. Their SAP semantics
  are untested, and `*` may itself broaden matches. Dropping both fits "runtime-error equality
  first".

**Optional:** a cheap client-side check that `runtimeError`/`user` equality matches the returned
`error`/`user`, failing closed otherwise.

## Nits

1. **File-size budget.** Main's `src/adt/diagnostics.ts` is exactly at its budget (1,933/1,933).
   Put filter composition in `feed-schema.ts` and keep the `listDumps` change minimal, or raise the
   budget deliberately with a comment.
2. **Description example.** Avoid `values=[MESSAGE_TYPE_X]` in the `dumps` description; Llama
   copied it as an attribute name (value review 3, R3). A JSON-shaped example is clearer:
   `{"attribute":"runtimeError","operator":"equals","values":["MESSAGE_TYPE_X"]}`.
3. **Deny-rule semantics.** Document that `SAPDiagnose.feed_schema` hides discovery only; a
   filtered `dumps` call still reads the schema internally under `SAPDiagnose.dumps`.
4. **`user` with filters.** A `user` value outside the filter character set is refused when
   combined with filters, but still accepted without them. Test and document it; FEAT-89 still
   covers the unfiltered path.
5. **Model check proportionality.** The eval harness lives only on the #1011 branch. Run any model
   check from there against the frozen extraction commit and commit aggregate evidence only;
   don't port the harness into the product PR unless it is meant to be maintained.
6. **Hyperfocused.** Add one pass-through test (`SAP {action:"diagnose", params:{action:"dumps", filters}}`).
7. **Live claims.** Name the exact build probed (758 only). The earlier positive/negative match
   was at `b5f441da`.
8. **Cancellation.** Assert that an invalid date makes **zero** requests, and that a cancelled
   signal stops further pages.

## Not needed

- No schema cache, query builder, OR/nesting support, new tool or permission preflight.
- No change to legacy `user` validation in this PR (FEAT-89).

## Limitations

This is a plan review only. I read code with `git show` and ran nothing. The implementation will
be reviewed at the frozen commit you send.
