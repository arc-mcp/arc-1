# Claude review 1 — dump-filter extraction implementation

| | |
|---|---|
| Reviewed commit | **`44d649da715ead68a5d75a9ea6d32d1312ba1da1`** (`feat: extract bounded dump filtering from diagnostic research`), whose only parent is main **`498c12bbab1b4c6337e01e3451c5811ba8b8aa97`** |
| Scope | 31 files; `src` changes limited to filters, `feed_schema`, limit advice, the policy entry and the multi-target allowlist entry. The lockfile is unchanged. |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Immutable `git archive` export, offline. No SAP, models, network, shared edits or GitHub. The archived plan review in the commit is byte-identical to mine. |

## Verdict

**Changes requested: two existing unit tests fail at this commit (P1).** The filter logic itself is
correct, minimal and thoroughly tested, and all four plan conditions are implemented. The fixes are
small: one test assertion or one wording restore, and two documentation lines. Two evidence items
(P2) should be settled before the draft is opened.

**Correction to my plan review (P4).** The premise that the two query paths are encoded differently
was wrong. `http.ts:1288-1294` adds `sap-client`/`sap-language` through `url.searchParams.set`,
which re-serializes the legacy and typed queries identically. Reusing the helper, plus the test
that checks both the helper input and the decoded final request, is the right resolution.

## P1 — Must fix (failing tests)

### 1. `tests/unit/handlers/tools.test.ts:752` fails

The test expects the SAPDiagnose description to contain `Server-driven types unsupported`. The
shortened text now says `No server-driven types.`

```text
AssertionError: expected 'ABAP diagnostics. Actions:\n- "syntax…' to contain 'Server-driven types unsupported'
```

**Fix:** update the assertion to the new wording (it still guards the `object_state` warning), or
restore the phrase. Restoring may not fit, because the token headroom is nearly gone (see P3-5).

### 2. `tests/unit/server/btp-docs-contract.test.ts` ("keeps the maintained maximum action table in sync") fails

`MULTI_TARGET_ACTION_RULES` now allows `feed_schema`, but `docs_page/multi-target-setup.md:355`
does not list it:

```text
AssertionError: SAPDiagnose: expected [ 'atc', 'atc_variants', …(15) ] to deeply equal [ 'atc', 'atc_variants', …(16) ]
```

The normative allowlist sentence in `docs/plans/destination-discovered-multi-target-v1.md:1080-1084`
also omits it; AGENTS.md makes that plan normative for multi-target changes, and #1011 had updated
both.

**Fix:** add `` `feed_schema` `` in both places.

Both failures are deterministic: 37 ms and 14 ms, failing the same way when re-run alone. The full
suite you have running will report them.

## P2 — Settle before opening the draft

### 3. Live-qualification claims come before their evidence

- `docs_page/tools.md`: "The extraction is live-qualified on A4H/001 (last recorded SAP_BASIS 758
  SP02)."
- Roadmap FEAT-74: "…with A4H/001 positive/negative runtime-error matches."

This build has not been probed. The earlier match ran on #1011's code at `b5f441da`, and the
research note says the live evidence follows. Run `scripts/probe-dump-filters.ts` on the final
commit and record it (the script captures `HEAD`), or word both lines as pending until then.

### 4. The `filters` example matches the planned model-check answer

The new schema description and the `tools.md` example both use `values:["TIME_OUT"]`. That is
exactly the predicate of the existing rare-error task the plan's model check reuses. A candidate
model can copy the example verbatim, inflating its apparent success.

**Fix:** use a neutral example value, such as `["MESSAGE_TYPE_X"]` in the same JSON form, or a
different eval target. State whichever you choose in the evidence.

## P3 — Optional

5. **Unrelated description rewrites.** To stay under the ceilings, twelve unrelated SAPDiagnose
   action lines were rewritten. The ceilings are now almost exhausted:

   | Surface | Used | Ceiling | Headroom |
   |---|---|---|---|
   | BTP full | 17,645 tokens | 17,650 | 5 |
   | On-prem full | 18,602 tokens / 74,407 bytes | 18,625 / 74,500 | 23 tokens / 93 bytes |
   | Read-only | 11,915 tokens | 12,000 | 85 |

   #1011's own research found that catalog wording changes coincided with a small-model regression
   on an existing route, and the planned model check does not exercise these actions. Prefer
   restoring the unrelated lines and raising the ceilings deliberately by the measured delta (the
   ratchet allows this with a comment). Otherwise, state in the research note that their wording
   changed without model evaluation.

   Also restore **"newest first"** for `dumps`. It now appears nowhere in the schema or
   `tools.md`, and "most recent" requests rely on it.
6. **Human docs.** `docs_page/tools.md` has no token budget, yet its `dumps` bullet lost the
   detail description ("error type, exception, program, stack trace, formatted output") and the
   ordering. Restore them.
7. **Error message.** A non-string, non-dateTime attribute type gets "Datetime filters require
   UTC …". This is unreachable with the 758 schema.

## Verified without findings

- **Unfiltered compatibility (P1 of the plan).**
  - `prepareDumpFilterQuery` returns `{}` without filters, and `listDumps` then calls
    `http.get(path, headers)` with exactly two arguments.
  - The existing `diagnostics.test.ts` expectations pass unchanged.
  - `filters: []` and `null` keep the old URL (`$top=50`, legacy `user` `$query`) and a single
    request.
  - `maxResults: 0` still maps to the handler's default of 50.
- **Limit advice (P2 of the plan).** `dumps` and `feed-schema` hints, with the stable JSON code, in
  normal and minimal-error modes. The data-preview text is unchanged.
- **Scope (P3 of the plan).** Only `feed-schema.ts`, `dump-filter-inputs.ts` and minimal handler,
  schema, tool, policy and multi-target hooks. No batch, log, transport or notebook code.
- **Values (P4 of the plan).** `[A-Za-z0-9_/$.-]{1,128}` excludes `*`, whitespace, quotes,
  backslashes and grammar delimiters. A `user` combined with filters follows the narrower rule,
  while legacy `user` is unchanged (FEAT-89 records the gap).
- **Dates and paging.**
  - `from`/`to` are normalized before the single schema read; an invalid date makes zero requests.
  - The predicate is on every page, the inclusive cursor deduplicates, and mixed-day rows are
    excluded.
  - The same-second limit still errors.
- **Budgets and cancellation.**
  - One cumulative 2 MiB budget across the schema and pages, with a 30 s deadline that is not reset
    between them.
  - The standalone schema read is limited to 15 s / 256 KiB.
  - Aborting before the schema read, or between pages, stops further requests.
- **Policy.**
  - Both actions need read scope, and deny rules apply before any I/O.
  - A `SAPDiagnose.feed_schema` deny hides discovery only, which is documented and tested.
  - There is no schema cache across identities.
- **Input validation.** Filters work in list mode only; detail, other actions, `feed_schema`, extra
  keys and meaningful unrelated options (for example `includeFullText: true`) are refused. The
  limit of eight conditions includes `user`, and false/empty/0 filler is tolerated.
- **Catalogs.** BTP and multi-target catalogs expose `feed_schema` and `filters`, and the
  hyperfocused pass-through works.
- **Budget scripts.** The file-size budgets rise by +6 (`tools.ts`) and +5 (`diagnostics.ts`), with
  comments. Only `descriptionCount` changes in the schema budget script.
- **Probe script.** Pinned to A4H/001 over HTTPS with read-only safety. It writes raw output to a
  new private directory with `wx`/`0600`, prints only the aggregate summary, and records `HEAD`.

## Checks run (scratch export of `44d649da`, Node 22.21.1)

| Check | Result |
|---|---|
| `tests/unit/handlers` (98 files), plus `adt/dump-filters`, `adt/diagnostics`, `server/multi-target-tools` and `authz` | **3,395 passed, 1 failed** (`tools.test.ts:752`) |
| `tests/unit/server`, `tests/unit/cli`, `tests/unit/evals` | **1,399 passed, 5 failed**: `btp-docs-contract` (deterministic) plus four load-sensitive subprocess tests that pass alone (`shutdown` 12/12, `cli/runtime` 42/42) |
| `tsc --noEmit` (src and tests) | pass |
| Biome (13 changed code/JSON files) | pass |
| `validate:policy` | pass (131 entries) |
| Strict `docs:build` | pass |
| `check:sizes` (file ratchet and tool-schema budget) | pass (657 files; tight token headroom, see P3-5) |

## Limitations

- No live or model evidence yet; both are pending, as you noted.
- I didn't run the full unit suite; the subsets above cover every directory this change touches.
- Node 22.21.1.
