# Definition navigation: PR #910

## Independent reproduction

Investigated `main` at `cf7879bfd75387585e2b6091bb5e4e3e02457730` before reading the PR's
implementation. On 2026-10-04, local ARC-1 with Basic authentication, HTTPS port 443, client 001
reproduced the failure on NPL SAP_BASIS 750 SP02 and A4H SAP_BASIS 758 SP02. All probes were reads;
the navigation POST analyzes supplied source without saving it.

The symbol was `cl_identity_factory` in `SU_USER/BAPI_USER_GET_DETAIL`, at line 173, column 21 on
750 and line 196, column 21 on 758. Main's SAPNavigate call and the equivalent raw ADT call both failed.

| Request variation, same source and symbol | Both releases |
|---|---|
| Separate `line` and `column` query parameters | 400 `I::000` |
| Cursor inside encoded `uri` as `#start=line,column` | 200 `adtcore:objectReference` |
| Same fragment plus `filter=definition` | Same successful result |
| Empty POST body | 200 with no target |
| Different unsaved source referencing `cl_abap_regex` | Target changes to that class |
| URI containing two cursor fragments | 400, invalid fragment |
| Source URI query `?version=active` before cursor fragment | Successful result |

The successful response identifies `/sap/bc/adt/oo/classes/cl_identity_factory/source/main#start=1,6`.
It supplies no object name/type. Main's parser looks only for `<navigation>`, so fixing the request
alone still loses the target. The source URI is necessary: the function's metadata URI produced
500 on 750 and 400 on 758. Automatically resolving `type`+`name` to metadata is not a substitute.

The independent [abap-adt-api reference](https://github.com/marcellourbani/abap-adt-api/blob/master/src/api/syntax.ts)
also places cursor coordinates in the URI fragment and reads `adtcore:objectReference`.

## Decision and reviewed plan

Keep PR #910: its central request/response repair matches the independent evidence. Add follow-up
commits on the contributor branch; a replacement PR would duplicate sound work.

1. Keep the encoded cursor fragment, explicit definition filter, and objectReference parser.
   Preserve the legacy navigation response fallback and the optional returned line/column.
2. Replace an existing fragment with the caller's explicit cursor; retain encoded names and query.
3. Require the source URI, non-blank source, and integer ADT cursor coordinates (line >= 1,
   column >= 0) before SAP calls. Make these requirements visible in tool descriptions and examples.
4. Extend regressions for URI reuse and invalid inputs; remove the erroneous 400 E2E skip.
5. Verify actual stdio MCP calls on both releases, including namespaced functions, class/interface
   navigation, changed source, empty targets, and returned URI reuse. Run the full repository checks.

Plan review: no source auto-fetch, new navigation mode, shared URI framework, or completion changes.
The cursor refers to the caller's text, which may contain unsaved changes. Only definition requires
these inputs; reference navigation keeps its symbolic type/name behavior.

## Cursor and completion evidence

Both releases use 1-based lines and 0-based cursor columns. In the BAPI source above,
`cl_identity_factory` begins at column 20; columns 20 through 39 resolve it, column 19 returns
no target, and column 40 (`>` in `=>`) fails with 400. An unindented reference in supplied source
resolves at column 0. Returned URI coordinates are passed through with the same convention.

The existing completion call to `/abapsource/codecompletion/proposals` returns 404 on both
releases. The singular `/proposal` resource with a cursor fragment returns `asx:abap` containing
`SCC_COMPLETION` records; the current parser expects `<proposal>`. FEAT-80 records this separate
request/response repair, including media negotiation (758 needed an Accept retry in the probe).

The contributor also reports 757/816 testing; that evidence is separate from the 750/758 probes here.
BTP/principal propagation is not covered. Exact final-build checks and outcomes are recorded in the PR.
