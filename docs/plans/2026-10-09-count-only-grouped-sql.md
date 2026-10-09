# Count-only grouped SQL and the separate 7.40 length report (#955)

## Research and reproduction

The issue combines two failures. Keep them separate:

| Probe | SAP 7.58 SP02 | Available SAP 7.50 SP02 |
|---|---|---|
| 253, 256, 512 and 3,200-character SELECT with repeated predicates | All succeed after existing line fitting | Freestyle endpoint returns 404 |
| `SELECT COUNT(*) AS n FROM t000 GROUP BY cccategory` | HTTP 400, CATCH without TRY | Freestyle endpoint returns 404 |
| Add `MIN( mandt ) AS m` to that projection | Succeeds | Not verifiable |
| Project `cccategory` alongside COUNT(*) | Succeeds; same sorted count values as MIN workaround | Not verifiable |
| COUNT(*) without GROUP BY | Succeeds | Not verifiable |

Queries use the tiny T000 system table; no business data or writes. Length probes
use repeated `AND mandt <> '000'` predicates and interior padding to reach the
specified sizes. Their actual posted bodies and longest lines were measured.
ARC-1 fits the posted SQL but does **not** append INTO/UP TO text to that body;
SAP injects those clauses, visible in `executedQueryString`.

Read-only inspection of the installed 7.58 `CL_ADT_DP_OPEN_SQL_HANDLER` supports
the aggregate root cause: `parse_comma_separated_select` marks a lone COUNT projection as
single-row without considering GROUP BY; `replace_into_upto_clause` selects a
scalar target, and `generate_subroutine` surrounds the statement with TRY/CATCH
without supplying the SELECT loop terminator. The grouped SELECT therefore
breaks the generated program's nesting. This is not a query-length failure.
The source was inspected locally, not copied into this repository.

No authorized 7.40 target or sanitized reporter wire trace is available. The
reported 253/256 boundary is credible but not established by these probes;
7.50's missing endpoint cannot establish a release boundary either. Do not
invent a 250-character limit or silently add projected columns.

## Reviewed plan

1. Add a narrow error hint after a real HTTP 400 for a lone COUNT(*) projection,
   one SELECT, GROUP BY, and the generated-program TRY/CATCH diagnostic. Match
   the ABAP keywords, not a particular logon-language sentence.
2. Explain that this is an ADT scalar-result generation problem. Suggest
   explicitly selecting the grouping columns too and make the extra result
   columns clear. Do not alter SQL, preempt a successful backend or retry.
3. Preserve normal diagnostics/minimal-error redaction. Test language variants,
   unrelated shapes/errors, failed and successful public-handler behavior.
4. Retest the public tool and the proposed query on 7.58. Keep #955 open and
   record the missing 7.40 evidence as a separate roadmap gap.

Review: a diagnostic correction is the smallest verified client fix. Automatic
projection changes would change the tool result contract; a guessed release
length guard could reject valid queries, especially after IN-list chunking.

## Remaining 7.40 investigation

Obtain an authorized target or sanitized traces with exact SAP_BASIS support
package, ADT component/kernel versions, original SQL, **every posted chunk**,
line/byte/character lengths, `rowNumber`, status and original SAP error body.
Compare 249/250/253/254/255/256/257 lengths, one line versus LF/CRLF, and multiple
row caps. Distinguish input truncation from SAP's generated target/row-limit
suffix. Compare installed handler versions before selecting a narrow capability
or release gate. Any eventual refusal belongs after chunking and must leave
successful newer backends unaffected.

## Validation

The regression file fails on main (six failures) and all 15 final cases pass
with the hint. Full suite: 8,082 tests. Typecheck, lint, policy validation, build,
file/schema budgets and strict docs build pass. Public SAPQuery calls on 7.58 now
show the hint with normal errors and redact SAP details with minimal errors.
The explicit grouping-column workaround returns three groups; the ungrouped
count still succeeds. No SQL is rewritten or retried by the new hint.

Final review confirmed the diagnostic is constrained to the reproduced failure,
not just the shared ADT message number, and does not intercept successful calls.
Roadmap impact: COMPAT-13 records only the unverified 7.40 length boundary and its
resume evidence. This PR does not close #955.
