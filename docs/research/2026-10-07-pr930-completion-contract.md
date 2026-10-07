# Completion request, parser, and completeness contract (#930)

## Reproduction and implementation choice

Main sends completion to the nonexistent plural `/abapsource/codecompletion/proposals`
resource with separate `line`/`column` query parameters. It then expects `<proposal>`
elements. On 2026-10-07 the exact main request returned HTTP 404, "No suitable resource
found", on both NPL (SAP_BASIS 750 SP02) and A4H (SAP_BASIS 758 SP02).

The existing contributor [PR #930](https://github.com/arc-mcp/arc-1/pull/930) repairs
all three contract errors: singular `/proposal`, cursor in the encoded source URI
fragment `#start=<line>,<column>`, and `SCC_COMPLETION/IDENTIFIER` records inside
SAP AS XML. The [abap-adt-api source](https://github.com/marcellourbani/abap-adt-api/blob/master/src/api/syntax.ts)
corroborates the request shape and marker removal. Continuing that PR preserves its
useful work and avoids a competing implementation. Its 757/816 checks remain
contributor evidence, separate from the 750/758 checks below.

Requests use `Content-Type: text/plain`, `Accept: application/vnd.sap.as+xml`,
`signalCompleteness=true`, and the full posted source. Nonempty replies on both tested releases return
HTTP 200 with `application/vnd.sap.as+xml; charset=utf-8;
dataname=com.sap.adt.codecompletion.Results`. A caller-supplied old URI fragment is
replaced, not appended. Numeric `KIND` values are not translated into invented labels.

## The review finding: `@end` does not always mean truncation

The initial PR inferred known truncation from `@end`. That worked in the reported
757/816 examples and our first 758 checks, but failed the 750 empty-result case:
`zzqqxxvvww` returned a single record with `KIND=0`, `IDENTIFIER=@end`, and no proposals.

Inspection of the authorized 750 source `CL_CC_ADT_RES_BASE`, method
`CALL_CODE_COMPLETION`, established why:

- The backend adds `@end` after deleting metadata entries that signify additional
  choices, and when wildcard handling exceeds its maximum hits.
- It also adds `@end` when the result is empty, the source line is empty, or the
  requested position is beyond the supplied source.
- Lists without that marker are the backend's complete-list path.

Therefore the final envelope is `{proposals: [{text}], complete, hint?}`.
`complete` is false when `@end` is present; that means completeness is unconfirmed,
not proof that undisplayed matches exist. The hint asks the caller to check the
cursor/source or narrow the prefix. Marker-only and empty-without-marker responses
have distinct unit coverage. No release guess, fixed limit, or fabricated total
is needed. The 750 broad-prefix result contains 51 actual class names, including
`CL_STUN_PAHI_ACCESS`; it is not evidence for a universal limit of 50. The parser
preserves the returned order and count.

## Final live matrix

Test date: 2026-10-07. Tested source: contributor `05364201` plus the normal main merge
`e1137f0f` and the follow-up implementation in this PR. Built with Node 24.19.0;
called the built `getCompletion` and `handleSAPNavigate` with default read-only
safety. Both routes used direct Basic authentication and verified HTTPS; A4H used
`https://a4h.marianzeis.de`, client 001, through nginx on port 443. Credentials were
loaded locally in memory and never included in evidence. These were stateless
source-analysis calls, with no saved SAP objects or repository mutations.

Unless stated otherwise, the source URI was
`/sap/bc/adt/programs/programs/rsparam/source/main`, followed by an intentionally
stale `#start=999,999` fragment that explicit coordinates replaced. Posted source
started `REPORT rsparam.`; the local-variable case added `DATA lv_counter TYPE i.`.
The cursor was immediately after each prefix, using 1-based lines and 0-based columns.

| Case | 750 | 758 |
|---|---|---|
| Main's plural resource | 404 | 404 |
| Unsaved `lv_co` | `LV_COUNTER`, complete | Same |
| `DAT` | 3 keyword proposals, complete | Same |
| `cl_abap_typedescr=>describe_by` | 4 methods, complete | Same |
| `cl_` | 51 proposals, completeness unconfirmed | 50 proposals, completeness unconfirmed |
| `zzqqxxvvww` | 0 proposals, completeness unconfirmed (`@end` only) | 0 proposals, complete (empty HTTP 200 body) |
| Unmodified backend RSPARAM source at line 1, column 3 (`REP`) | Includes `REPORT`, complete | Same |
| Raw keyword response MIME | Exact SAP AS XML, 200 | Same |

Unit coverage additionally checks escaped namespaces/fragment replacement, XML
entity decoding exactly once, numeric-looking identifiers, missing/fractional
coordinates, zero-based column zero, missing URI with symbolic names without SAP
lookup, backend error propagation, default read-only operation, and explicit action
denial. An unrecognized HTTP 200 response envelope raises an explicit error
instead of an empty complete list. SAP 758's real empty result is HTTP 200 with
an empty body and no Content-Type; that specific response is accepted explicitly,
alongside an empty XML DATA container. The final live check caught and corrected
an overly strict DATA-only envelope guard before publication. Input guidance snapshots change only the existing `uri` description.

## Limits and roadmap

BTP principal propagation was not independently tested. The shared 816 environment
was unavailable during this review because authentication failed its SAP license
check (E00179); the existing contributor 816 result is not a fresh maintainer rerun.
Namespaced source URIs are covered by unit tests and the contributor's 816 live
example, not a new 750/758 namespaced live case. No source is persisted by completion.

FEAT-80 is removed from both roadmap overview and detail: its required 750/758
current/unsaved source, useful/empty results, cursor, parser, and MIME checks are
now verified. Rich insertion templates and descriptions remain outside this repair.
