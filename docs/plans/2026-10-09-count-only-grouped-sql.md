# Count-only grouped SQL and the separate 7.40 length report (#955)

## Research and reproduction

The issue combines two failures. Keep them separate:

| Probe | SAP 7.58 SP02 | SAP 8.16 | Available SAP 7.50 SP02 |
|---|---|---|---|
| Long SELECT after existing line fitting | Succeeds, including 3,200 characters | Succeeds | Freestyle endpoint returns 404 |
| `SELECT COUNT(*) AS n FROM t000 GROUP BY cccategory` | HTTP 400, CATCH without TRY | HTTP 400, SELECT missing ENDSELECT before ENDMETHOD | Not verifiable |
| Project `cccategory` alongside COUNT(*) | Succeeds | Succeeds | Not verifiable |
| COUNT(*) without GROUP BY | Succeeds | Succeeds | Not verifiable |

Read-only queries use the tiny T000 system table. Installed handler source
explains the aggregate failure: `parse_comma_separated_select` marks a lone COUNT
projection as single-row without considering GROUP BY; `replace_into_upto_clause`
selects a scalar target, and the generated program lacks the SELECT loop's
ENDSELECT. This breaks nesting. The two releases report different ABAP tokens for
the same failure. SAP injects INTO/UP TO, visible in `executedQueryString`; ARC-1
does not append those clauses to its posted body. SAP source was inspected
locally, not copied into this repository.

## Reviewed implementation plan

1. After a real HTTP 400, recognize a lone COUNT(*) projection, one SELECT,
   GROUP BY, and either TRY/CATCH or ENDSELECT/ENDMETHOD in the diagnostic.
   Use ABAP tokens rather than logon-language wording. Requiring ENDMETHOD too
   avoids misclassifying an unknown column named ENDSELECT.
2. Explain the backend scalar-result generation problem. Suggest explicitly
   projecting the grouping columns and disclose the extra result columns.
   Do not rewrite SQL, preempt a successful backend, or retry.
3. Preserve minimal-error redaction. Test language variants, unrelated errors,
   different query shapes, and failed/successful public-handler behavior.
4. Verify the public tool and explicit workaround on 758 and 816. Keep #955 open
   for the separate 7.40 investigation.

Review: this is a diagnostic change using the existing classifier. Automatic
projection changes alter the result contract and can change DISTINCT semantics.
The optional COUNT(DISTINCT field) extension remains outside this narrow hint;
SELECT DISTINCT COUNT(*) must not receive the grouping-column advice. No
release-specific COALESCE workaround or general SQL rewriting is added.

## Length/framing evidence from Claude's review and independent probes

- Raw single input lines over 255 characters can be truncated in
  `CL_ADT_DP_FREESTYLE_RES->POST`: conversion to the source-line table has CHAR255
  rows. On 758, a 255-character valid head followed by `AND mandt = '000'` on the
  same line silently returns all three clients; `executedQueryString` omits the
  tail. LF or CRLF before the tail preserves it and returns just client 000.
- The installed 816 POST first condenses spaces on each line. Consequently the
  whitespace-padded 758 reproducer does **not** truncate on 816. Compact SQL must
  be tested separately; character counts based on padding alone are misleading.
  A second, compact 255-character head using valid short literals independently
  reproduced silent tail loss on **both** releases: 758 returned three clients
  and 816 two, while LF/CRLF retained the restriction and returned one. The first
  compact fixture used an overlong C(25) comparison literal and was rejected;
  shortening that literal produced the valid truncation comparison.
- ARC-1 already fits each posted line to 255 characters, preserving tokens,
  literals and comment boundaries. Wrapped lines currently use bare LF. It is
  unverified whether the reporter's 7.40 handler recognizes that separator.
- [SAP Note 2807133](https://me.sap.com/notes/2807133), independently checked in
  the SAP Notes service, addresses incorrect CRLF/LF handling in ADT SQL Console.
  Its correction targets this POST method on SAP_BASIS 750–754 (SPs 75016,
  75109, 75205, 75303 and 75401). It is **not** valid for 740 and does not prove
  the cause there.
- Independent LF/CRLF comparisons on 758 and 816 preserved rows/columns for a
  statement over 3,200 characters, column-one and inline comments, quoted
  literals and the restrictive tail. This supports a CRLF prototype, not a
  verified 7.40 fix. Claude also reported a neutral 40-value IN-chunking probe;
  final per-chunk framing coverage is needed if the production change is adopted.

## Remaining 7.40 investigation and conditional plan

No authorized 7.40 target or sanitized reporter wire trace is available. The
reported 253/256 boundary is credible but not established by newer systems.

Leading hypothesis: 7.40 does not split bare LF, so fitted lines remain embedded
inside one input line that is truncated or mis-tokenized. Alternatives are a
whole-statement size limit or rejoining lines without separators. Only the first
is directly addressed by the proposed CRLF change.

Use read-only T000 probes on the failing system:

1. Record the exact SAP_BASIS support package and read POST, GET_INSTANCE,
   SPLIT_QUERY_STRING, TOKENISE_QUERY, REPLACE_INTO_UPTO_CLAUSE and
   GENERATE_SUBROUTINE from its installed handler classes.
2. Compare compact single lines of 254/255/256/300 characters at `rowNumber=100`.
3. Compare the same 300-character query split into sub-100-character lines with
   LF and CRLF. If CRLF works, repeat at 3,200 characters.
4. Add a restrictive predicate after a valid 255-character head; verify returned
   rows and `executedQueryString`, not only status or total-row metrics.
5. Compare row caps 1 and 100000 at 250–256 characters. Capture each actual posted
   chunk after fitting, visible line endings, status and original SAP diagnostics.

If CRLF fixes the failing target, normalize line endings in
`fitFreestyleSqlLines` and test actual posted bytes after IN-list chunking,
including literals/comments and tail preservation. Existing manually supplied
CRLF lines that already fit are preserved, so that experiment needs no product
change. If a whole-statement limit remains, establish its exact release/SP or
capability boundary before adding a refusal after chunking. Do not guess a
250-character cap. If only CRLF plus leading continuation spaces works, investigate
SAP's join behavior before choosing a different transformation.

Decision: retain the CRLF change as a tested prototype and conditional follow-up,
not production code in this diagnostic PR. Newer-system neutrality does not
establish the missing 7.40 root cause. COMPAT-13 is P1 research because silent
predicate loss would be more serious than a visible error; that risk remains
unverified through ARC-1 on 7.40.

## Validation

The original hint regression fails on main. The follow-up adds three failing
816/language/redaction cases against the previous PR head; all 21 cases now pass.
All 8,088 unit tests, typecheck, lint, policy validation, build and file/schema
budgets and strict docs build pass. Public SAPQuery on 758 SP02 and 816, client 001, direct HTTPS/Basic,
now gives the hint with normal errors and suppresses SAP details in minimal mode.
The explicit grouping-column workaround and ungrouped COUNT both succeed.
No SAP writes were needed for this investigation.

Final review kept SQL and result shapes unchanged, confirmed successful calls are
not intercepted, and rechecked the roadmap. COMPAT-13 records the remaining
framing/truncation evidence and experiments. GitHub's PR description was corrected
to remove an unintended automatic-closing keyword; #955 remains open.
