# Function-module dependencies: PR #911

## Independent reproduction

Investigated untouched main `cf7879bfd75387585e2b6091bb5e4e3e02457730` before reading the PR
implementation. On 2026-10-04, read-only local ARC-1 calls with Basic authentication, HTTPS 443,
client 001 reproduced zero dependency candidates for `SU_USER/BAPI_USER_GET_DETAIL` on NPL
SAP_BASIS 750 SP02 and A4H SAP_BASIS 758 SP02. Both sources contain class and function calls.

An independent matrix using installed `@abaplint/core` 2.120.60 isolated two causes:

| Input to abaplint | Main file | AST structure |
|---|---|---|
| Main's standalone `.fugr.abap` source | Missing | Missing |
| Only change the extension to `.prog.abap` | Present | Missing |
| Only reduce the inline signature to `FUNCTION name.` | Missing | Missing |
| Both changes | Present | Present |

A FUGR needs a separate main program. ADT's inline FUNCTION parameters also exceed abaplint's
FUNCTION grammar. Dependency-only program parsing with a classic header fixes both, without
changing shared lint filename detection or the actual source returned to callers.

## Decision and reviewed plan

Keep the contributor's PR and underlying approach. Replace its multiline signature regex: the
regressions demonstrated shifted dependency lines and missing same-line body statements.

1. Parse the standalone module as a program and use abaplint statement tokens to locate the
   FUNCTION header. Blank parameter text while retaining line breaks and character positions.
   Tokenization handles dots in comments and literal defaults; leave the body and terminator intact.
2. Reuse a classic module's first parse. Reparse only an inline signature; reject FUNCTION-POOL
   as a standalone module. Preserve caller-selected parser versions and existing filtering.
3. Exercise source positions, CRLF, namespaces, quoted defaults, comments, same-line statements,
   and nested function-to-class dependency expansion, with and without the cache.
4. Run full checks and real stdio MCP reads on both releases. Keep source fetching, contracts,
   cache ownership, and safety checks in their existing paths.

Depth testing exposed a related lookup inconsistency: NPL labels the exact search hit
`/UI2/CATALOG_PFCG_CHANGE (Function Module)`. The cached resolver compared that display name
literally and failed. The uncached compressor's separate fallback accepted any function URI,
including an unrelated first hit, and passed the encoded group through another encoding step.
NPL tolerated the latter encoding in this probe; it was not the original parser failure.

The reviewed adjustment is small: match the requested function against the decoded function URI
in the existing shared resolver, and use it from both compressor paths. This removes the duplicate
fallback and keeps group names decoded exactly once. Tests include an earlier unrelated search hit.
No new lookup framework, cache, feature flag, or public schema is needed.

The shared resolver also serves SAPRead, existing-function SAPWrite, SAPActivate, transport,
version/transport diffs, typed where-used, and editable-source reads. Consequently the fix benefits
these callers when they already allow an omitted group; it does not make the group optional for
FUNC creation or SAPContext root-source fetching. Real-package write gates and authorization stay
in their existing callers. The release note records this wider effect.

Generic `lookupObjects` is a separate unresolved path. On 750, its exact-name comparison discards
`BAPI_USER_GET_DETAIL (Function Module)` even though the URI identifies the requested function;
`SAPContext(usages)` without a type then reports no match. The same lookup succeeds on 758.
COMPAT-09 records this verified follow-up; typed FUNC resolution already uses the repaired resolver.

## Limits and verification

Signature types remain excluded. Body DDIC types are currently guessed as classes; failed reads
can consume `maxDeps` before later class candidates are tried. Roadmap FEAT-79 records this separate
resolver/contract work. This repair does not claim complete dependency coverage.

Independent source checks preserve `CL_IDENTITY_FACTORY` references at original line 173 on 750
and 196 on 758. The contributor separately reports 757/816 coverage at `87927ac1`; that is not the
750/758 evidence here. Final tested commit, actual MCP scenarios and checks are recorded in the PR.
BTP/principal propagation and SAP writes are outside these live checks; no SAP objects are changed.
