# Claude review 1 — verified diagnostics PR #1011

| | |
|---|---|
| Reviewed commit | **`d93272adc2dcd389e5d730aa3997b758b73d1fc0`** (`chore: integrate reviewed policy and release compatibility`) |
| Base | `4efe147271287f74d6c07eb257ee783d81568e40` (the merged policy `70388fa1` and notebook release-compatibility `a72a81df` work) |
| Range | `c1519d4c` feat, merges `5bc693b3`/`6ffd1255`, `d2e5946d` docs, `cf586296` ambiguity fix, merge `d93272ad`. Product code: 14 `src` files, +623/−62. |
| Repository | `/Users/marianzeis/.codex/worktrees/verified-diagnostics/arc-1` (read only) |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Immutable `git archive` exports of head and base, tested offline with the real dispatcher (`handleToolCall`) and stubbed HTTP. No SAP calls, no credentials, no shared-worktree edits, nothing published or merged. Scratch files are kept. |

Line numbers refer to `d93272ad`.

## Verdict

**Changes requested: three small must-fix items, then approve.**

The core evidence logic is sound:

- I found no false `passed` for any response shape SAP's checkrun API produces. The only false
  pass I could construct needs a nested report (O1).
- URI handling fails closed.
- The policy, deny-rule, multi-target, hyperfocused and `explain_policy` paths are consistent.
- The source and version claims in the research record are accurate.

The three must-fix items:

- **M1:** a strict-client backward-compatibility regression, plus an input-parity gap between the
  two batch routes.
- **M2:** namespaced DDIC objects can never use `activation_log`.
- **M3:** size-limit errors give data-preview advice for the four new budget families.

Each fix is small. All three are reproduced offline, and a validated reference diff is attached.

## Must-fix

### M1 — Strict-client placeholders are rejected (Medium: regression plus parity)

**(a) Empty-array placeholders break unrelated calls.** This PR advertises two new optional
arrays, SAPRead `objects` and SAPDiagnose `filters`, but does not tolerate an empty placeholder on
calls that don't use them.

Strict-schema clients send `[]` for unused array properties. ARC-1 already handles this for
SAPDiagnose `objects` (`object-types.ts:364-375`, comment: "Strict-schema clients may supply an
empty placeholder…"). That rule exists because of the PR #772 review, which confirmed "Empty arrays
break unrelated calls" (`docs/research/2026-09-10-pr772-claude-review.md:17`). The new properties
have no equivalent rule:

- the SAPRead case in `object-types.ts:275-295` normalizes `objects` but never drops `[]`;
- `schemas.ts:123-124` rejects `objects` on any non-SYNTAX read;
- `diagnostic-inputs.ts:14` (`min(1)`) and `:61-62` reject `filters` outside dumps list mode.

Repro, real dispatcher (`claude-review-1-checks/zz-dg-filler.test.ts`):

```text
head  advertised: SAPRead.objects=true  SAPDiagnose.filters=true
SAPRead     {type:"PROG",name:"ZX",objects:[]}                      → Invalid arguments for SAPRead
SAPRead     {type:"SYNTAX",objectType:"PROG",name:"ZX",objects:[]}  → Invalid arguments for SAPRead
SAPDiagnose {action:"syntax",type:"PROG",name:"ZX",objects:[]}      → ok (existing #772 rule)
SAPDiagnose {action:"dumps",filters:[]}                             → Invalid arguments for SAPDiagnose
SAPDiagnose {action:"object_state",type:"PROG",name:"ZX",filters:[]} → Invalid arguments for SAPDiagnose
base  advertised: SAPRead.objects=false SAPDiagnose.filters=false (a schema-following client never sends them)
```

For a client that fills every advertised property, every ordinary SAPRead and SAPDiagnose call
now fails validation.

**(b) Filler parity between the two batch routes.** SAPRead `SYNTAX` already ignores harmless
strict-client filler: `false`, `[]`, `format:"text"` and `maxResults:0` (`schemas.ts:110-119`).
The new SAPDiagnose allowlists (`diagnostic-inputs.ts:83-85`) apply no such rule. The user guide
says the compatibility route "returns the same evidence" (`docs_page/diagnostic-evidence.md:23-24`),
yet (`zz-dg-filler2.test.ts`):

```text
SAPRead     {type:"SYNTAX",objects,maxResults:0,format:"text"}   → ok
SAPDiagnose {action:"syntax",objects,coverage:false}            → "coverage is not supported for syntax."
SAPDiagnose {action:"syntax",objects,maxResults:0}              → "maxResults is not supported for syntax."
SAPDiagnose {action:"feed_schema",coverage:false}               → rejected
SAPDiagnose {action:"activation_log",…,coverage:false}          → rejected
SAPDiagnose {action:"dumps",filters:[…],coverage:false}         → rejected
SAPDiagnose {action:"dumps",coverage:false}                     → ok (existing action)
SAPDiagnose {action:"object_state",…,coverage:false}            → ok (existing action)
```

**Fix (validated; first three hunks of `suggested-fixes.diff`):**

1. On SAPRead, drop `objects: []` unless the call is a SYNTAX batch with no single-object
   selector.
2. Drop an empty `filters` list; it means no typed filter.
3. Move the existing filler predicate into `diagnostic-inputs.ts` and use it in both validators.

An empty batch with no selector still fails before any SAP request, and a meaningful value such as
`maxResults: 5` on `feed_schema` is still refused.

### M2 — Namespaced DDIC objects are accepted, then refused as "unsafe" (Medium-Low)

The input schema accepts namespaced names (`ATC_BATCH_NAME_PATTERN`, `atc-batch.ts:43`).
`objectUrlForType` encodes `/DMO/OBJ` as `%2FDMO%2FOBJ` (`object-types.ts:563-568`). But
`readDdicActivationLog` checks the URI with `canonicalHostRelativeAdtPath(object.uri)` without
`allowRawEncodedSlash` (`ddic-activation-log.ts:91`), so every namespaced name is rejected before
any request.

The other code paths that build object URIs from names all pass the option: `atc-batch.ts:158`,
`devtools.ts:798`, `aunit-package.ts:82` and `repository-relations.ts:57`. The advertised log link
(`:126`) and the log's own references (`:53`) use the same strict default. A namespaced reference
inside a log is therefore silently dropped.

Repro (`zz-dg-dispatch.test.ts`, case A1):

```text
A1 plain       DOMA ZDOM      → available (metadata GET + log GET)
A1 namespaced  DOMA /DMO/OBJ  → isError "Unsupported or unsafe object URI."  requests: 0
A1 namespaced  DTEL /DMO/OBJ  → same
A1 namespaced  TABL /DMO/OBJ  → same
A1 namespaced  DDLS /DMO/OBJ  → same
```

This affects every namespaced DOMA/DTEL/TABL/DDLS (for example `/DMO/` objects on BTP, and partner
or customer namespaces). The error is deterministic and wrongly labels ARC-1's own URI as unsafe.
It fails closed, so no false evidence results.

**Fix (validated):** pass `{ allowRawEncodedSlash: true }` at all three call sites. The prefix,
dot-segment, double-encoding and origin checks still apply; the regression test confirms that
`%2e%2e%2f` in an advertised link is still refused.

The log URL format for a namespaced object is not live-verified, so record that as offline-only.
If you prefer, refuse namespaced names at validation with an accurate message instead.

### M3 — Size-limit errors give data-preview advice for the new families (Low)

At base, each non-data-preview response budget had its own error text in `dispatch.ts:198-203`
(`repository-relations`, `transport-review`). This PR adds four families without one:

- `syntax-batch` (`syntax-batch.ts:134`)
- `feed-schema` (`feed-schema.ts:34`)
- `dumps` (`diagnostics.ts:243`)
- `ddic-activation-log` (`ddic-activation-log.ts:103`)

All four fall through to the data-preview message at `dispatch.ts:204-216`. Repro (case A2):

```text
SAPRead SYNTAX objects → {"error":"DATA_RESPONSE_TOO_LARGE","message":"The SAP data-preview result exceeded the 524288-byte server limit. Submit a new request with lower maxRows, fewer columns, or a restrictive non-overlapping key-range WHERE clause.",…}
SAPDiagnose dumps      → … "exceeded the 2 MiB server limit. Submit a new request with lower maxRows, fewer columns, or … WHERE clause."
activation_log         → … "exceeded the 524288-byte server limit. … maxRows … WHERE clause."
```

None of these tools has `maxRows`, columns or a WHERE clause, so an LLM client following the
advice would retry with arguments the strict schema rejects.

This also reaches **existing** calls. `listDumps` now applies the 30-second deadline and 2-MiB
budget to every list call, filtered or not (`diagnostics.ts:240-244`, passed to each page GET).
Base comparison (`zz-dg-base.test.ts`, case B1):

- an unfiltered call whose page exceeds 2 MiB succeeds at base (`[]`);
- at head, the same call fails with the advice above.

The user guide mentions the bound only under "Filter short dumps"
(`docs_page/diagnostic-evidence.md:63-65`). The bound itself is reasonable hardening: the
fixture's entries are about 0.7 KB, so 500 dumps should stay well below 2 MiB (not live-measured).
The PR test at `tests/unit/handlers/diagnostic-contracts.test.ts:110-122` checks only the error
code.

**Fix (validated):** make the generic branch family-aware and keep the JSON shape and error code.
That keeps the PR test and the notebook classifier
(`/^(?:\{"error":")?DATA_RESPONSE_TOO_LARGE\b/`) working. Also add one docs sentence saying the
bound applies to every `dumps` list call.

## Optional (not blocking)

### O1 — A nested duplicate report can produce `passed` (synthetic shape only)

`collectNodes` stops descending once it matches `checkReport` (`syntax-batch.ts:21-24`). The
duplicate check at `:34-43` and the per-object match at `:55-59` therefore see only top-level
reports. A processed report for an object that contains a nested `notProcessed` report for the same
object returns `status: passed` with `unexpectedReports: []` (`zz-dg-syntax.test.ts`).

SAP's checkrun responses don't nest reports, which is why this is optional. The hardening is two
lines (in `suggested-fixes.diff`): exclude reports that contain a nested report from
`ownedReports`, and take per-object matches from `ownedReports`. Regression O1 covers it.

The other shapes I tried are handled correctly:

- error texts containing `"`, `&`, `<` and `'` survive the `XMLBuilder` round trip, so the batch
  is still `failed`;
- a text-only message makes the batch `incomplete`.

### O2 — `unavailable`/`denied` don't say which request failed

`ddic-activation-log.ts:136-138` maps a 401/403/404 from **either** GET to the same status.

- A mistyped object name and a missing log both report `unavailable`.
- `TABL` always resolves to `/ddic/tables/`. A DDIC structure (stored under `/ddic/structures/`)
  therefore reports `unavailable`, although single-object syntax falls back for exactly this case
  (`syntax.ts:37-40`).

A `step: "metadata" | "log"` field or one docs sentence would remove the ambiguity. The live 758
TABL sample advertised no relation anyway, so the practical impact is small.

### O3 — `user` is not trimmed when combined with typed filters

`diagnostics.ts:245-247` appends `options.user` as is, whereas the legacy path trims it (`:1467`).
`user:" DEVELOPER"` plus filters fails with "Filter value contains unsupported wire delimiters or
characters."; without filters the same call succeeds (case A4). The fix is one `.trim()`, covered
by regression O3.

### O4 — BTP text names PROG

The shared SAPDiagnose `objects` description (`tools.ts:1211`, "Syntax: CLAS/PROG/INTF/DDLS") and
the batch errors (`syntax.ts:15`, `diagnostic-inputs.ts:81`) name PROG, which the BTP enum
correctly excludes. Nit.

### O5 — Import order in `tools.ts`

`tools.ts:1-3`: two new imports sit above the file's doc comment. Nit.

### O6 — Pre-existing: the legacy `user` is not validated (out of scope)

Without typed filters, `user` is still placed into `$query` unvalidated (`diagnostics.ts:1467-1470`):
`X),notEquals(user,Y` becomes `and(equals(user,X),notEquals(user,Y))` (case A3). Base behaves
identically (case B2). The call is read-only and scoped to the caller. A follow-up could apply the
new string charset check without a schema read.

## Verified without findings

**Batch syntax**

- One POST to `/sap/bc/adt/checkruns`, with escaped object URIs in the body.
- 30-second deadline, context abort signal and 512 KiB budget; the PR test shows one POST, then
  `DATA_RESPONSE_TOO_LARGE`.
- XML is validated and size-checked before parsing.
- `passed` requires exactly one processed `abapCheckRun` report per URI. Unknown severities give
  `not-checked`; foreign or unattributed messages and unexpected reports give `incomplete`.
- `sourceHash: null` and a "no immutable source proof" statement are returned.
- The default `active` version matches single-object behavior.
- Single-object syntax is unchanged, including the TABL→structure fallback and the `notChecked`
  contract.

**Dump schema and filters**

- Only the exact `/sap/bc/adt/runtime/dumps` entry is used. Duplicate entries, data, containers,
  datatypes, attributes and operators fail.
- Ids must be alphanumeric, operand counts must be 1–2, and `queryDepth` must be a safe integer
  (≥ 2 for compilation).
- Filter values exclude grammar delimiters, quotes and backslashes. Datetimes round-trip through
  UTC, and reversed ranges are refused.
- At most 8 terms, including `user`.
- The compiled `$query` replaces the legacy one rather than being added beside it, and the legacy
  URL is unchanged without filters (`?$top=50`).
- No schema cache and no feed URL input.

**DDIC log**

- The object URI is built by ARC-1. The metadata root name must match the object, and exactly one
  advertised relation of the right media type is accepted.
- The relation must be a canonical path under `/sap/bc/adt/ddic/logs/` with no query. Absolute,
  foreign and dot-segment links are refused (PR tests).
- References inside a log are listed, never followed; the fixture's nested `activationlog` link
  stays a reference.
- Bounded at 20 s, 8 attempts, 512 KiB, depth 8, 250 entries and 2,000 characters, with a
  `truncated` flag.
- `activationTime: null` and `correlation: "not-established"`. Raw severity is retained.

**Policy and target parity**

- `ACTION_POLICY` gains two read entries (`policy.ts:145-146`).
- Deny rules apply before any request: `SAPDiagnose.syntax` covers SAPRead batches.
- The multi-target SAPDiagnose allowlist gains exactly the two read actions. SAPRead exposes
  `objects` because it has no action rule.
- Hyperfocused `SAP {action:"read",type:"SYNTAX",params:{objects}}` works.
- `explain_policy` returns `allowed` for all five new proposal forms, with no SAP request (case A5).
- Note: a `SAPDiagnose.feed_schema` deny rule does not stop filtered `dumps` from reading the
  schema internally. The schema is never returned, so I consider this acceptable.

**Schema sync and backward compatibility**

- The Zod and JSON `objects` schemas come from one helper. The ATC `objects` schema moved without
  change, and the BTP variants exclude PROG on both layers.
- The snapshot fixtures change only by the new properties and descriptions.

**Source and version claims**

- In `diagnostics-live-summary.json`, three of the four `sourceHashes` match head
  (`ddic-activation-log.ts`, `syntax-batch.ts`, `diagnostic-inputs.ts`).
- `feed-schema.ts` differs because `cf586296` came after the live run. The research note says
  exactly this (live run at `5bc693b3`; the stricter parser replayed offline).
- `listDumps` is unchanged since `c1519d4c`, so the live dumps path matches head.

**History research**

- `scripts/probe-review-history.ts` is pinned to one host and client, takes credentials only from
  the environment, and writes a new `0700` directory with `wx`/`0600` files.
- Every read goes through origin and canonical-path checks, and a fixture-owned tail regex
  restricts revision reads.
- The evidence JSON holds metrics only (15 reads, 30,985 bytes); I found no credentials or user
  names.
- No adapter is added, and the roadmap is consistent: FEAT-69/71/74 are removed and the history
  item is narrowed.

## Checks run (scratch copy of `d93272ad`, Node 22.21.1)

| Check | Result |
|---|---|
| PR-focused tests: 22 files (adt diagnostic contracts, DDIC log, diagnostics, devtools, xml-parser; handler diagnostic contracts, syntax, read, schemas, key sync, Zod/JSON parity, tool snapshots, hyperfocused, policy explanation, action policy, schema pollution, dispatch; multi-target tools; authz policy) | **22 files / 1,534 tests passed** |
| `tsc --noEmit` (src and tests configs) | pass |
| Biome on the 19 changed code files | pass (one info-level `useTemplate` hint at `tests/unit/adt/ddic-activation-log.test.ts:53`) |
| Repros through the real dispatcher (`zz-dg-dispatch`, `zz-dg-filler`, `zz-dg-filler2`, `zz-dg-syntax`; base comparison `zz-dg-base`, `zz-dg-filler-base`) | results quoted above |
| Reference fixes (M1–M3, O1, O3) in a separate scratch copy, with `zz-dg-fix.test.ts` (6 regressions) | **6/6 fail on head; 6/6 pass with the fixes.** PR-focused suite plus regressions on the fixed copy: **23 files / 1,540 passed**. `tsc` and Biome pass. |

Per your instructions I did not rerun the full suite or the remaining gates.

## Limitations

- No live SAP. The A4H 758 results are Codex's record at `5bc693b3`.
- Only a non-matching typed filter ran live (zero rows), which indicates SAP honors the
  re-serialized query. Filtered calls are built with `URLSearchParams` (`%24query`, `%24top`,
  space as `+`), unlike the legacy encoder. A positive match and values containing spaces are not
  live-verified.
- Namespaced objects are untested live, both in batch syntax (a mismatch would give `incomplete`)
  and in `activation_log`.
- Real dump-entry sizes, which determine headroom under the 2 MiB bound, were not measured.
- Node 22.21.1 locally.

## Files

- `claude-review-1-checks/suggested-fixes.diff`: reference patch (7 files, 69 changed lines).
- `claude-review-1-checks/zz-dg-fix.test.ts`: the six regressions.
- `claude-review-1-checks/zz-dg-*.test.ts`: the repro scripts (run them from `tests/unit/handlers/`
  or `tests/unit/adt/`).
- Scratch exports are kept, nothing deleted: `dg-head`, `dg-base`, `dg-fix`, `dg-checks` under
  `/private/tmp/claude-501/-Users-marianzeis-DEV-arc-1--claude-worktrees-arc1-transport-pr-review-b24d1c/29107839-8912-4998-9d5d-8d61b1d3fd68/scratchpad/`.

## Final verdict

**Request changes on PR #1011 at `d93272adc2dcd389e5d730aa3997b758b73d1fc0`.**

- **Must fix:** M1 (placeholders and filler parity), M2 (namespaced activation logs) and M3
  (family-aware size-limit message plus one docs sentence), each with a regression test.
- **Optional:** O1–O5. O1 and O3 are two-line hardenings already covered by the attached
  regressions.
- **Pre-existing, separate follow-up:** O6.

With M1–M3 fixed, I expect to approve after a focused verification.
