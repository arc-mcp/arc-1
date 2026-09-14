# Package listing completeness (customer B-5)

## Root cause and evidence

`SAPRead(type=DEVC)` returns only an array from ADT quick search. The effective
limit defaults to 200 and clamps to 1–1000; the response says nothing about that
cap. This encourages callers to mistake a partial listing for a package inventory.

Read-only requests on A4H (SAP_BASIS 758 SP02, client 001, 14 September 2026)
listed `SABAPDEMOS` with limits 1, 2 and 5. Every request returned HTTP 200 and
exactly that many references. The XML root contained only object references and
its namespace: no total, continuation link or explicit truncation flag. Existing
package-reader documentation records another limitation: ADT search omits some
legacy objects, including SEGW service versions. Fewer rows than requested cannot
establish a complete repository inventory.

## Plan and compatibility review

1. Share package-limit normalization between the request and response metadata.
   Preserve `AdtClient.getPackageContents` and its array return type for all callers.
2. Keep the default first MCP text block as the existing JSON array. Add a second
   text block containing `listing` metadata: returned count, effective limit,
   limit reached, possible truncation, unknown completeness/total, coverage note.
3. Support existing `format="structured"` for DEVC as `{objects, listing}` in one
   JSON text block. Verify both existing input schemas accept it, broaden the
   handler's format guard, and update tool descriptions and user docs.
4. Test empty, below-cap, exact-cap and above-cap inputs, numeric normalization,
   both response modes, the legacy first-block contract and unknown total semantics.
5. Review snapshots, run the repository gates, and verify the built handler live.

Plan review: fetching one extra object could prove truncation below the hard cap
but changes request costs and still cannot settle coverage at 1000. This change
reports evidence honestly with one bounded request. `possiblyTruncated` means the
requested cap was reached, not confirmed extra rows. `completeness="unknown"`
also applies below the cap. No guessed pagination, total or complete flag.

Compatibility: first-block JSON array and public client arrays remain unchanged.
Consumers that concatenate all default text blocks and parse them as a single
JSON value should select `format="structured"`. This is an intentional additive
MCP response change; it is documented rather than silently replacing the array.

## Verification and final review

All nine new dispatch tests failed against the old implementation. After the
change, 6,588 unit tests across 214 files passed, along with typecheck, Biome,
policy validation, build, and file/schema size budgets. Both on-premise and BTP
input schemas accept structured DEVC reads. Reviewed the seven tool snapshots:
only format/limit descriptions changed. Existing direct-client normalization and
array-contract tests remain green.

The compiled dispatcher was also called live against A4H/SABAPDEMOS with limit 2
in text and structured modes. Both returned two objects, effectiveLimit 2,
limitReached/possiblyTruncated true, unknown completeness and null total. The
default mode preserved its first-block array. No extra request, write capability,
cache, identity or safety-policy change was introduced.

Remote E2E review found one stale assumption in the package lifecycle test: its
shared helper required exactly one text block. Updated that test to assert the
two-block contract explicitly and compare the structured envelope against it.
The shared helper's one-block assertion remains intact for other calls.
The focused lifecycle E2E passed against A4H 7.58 through a freshly built MCP
server: package creation, both response formats, and package deletion. Typecheck
and build also passed after this test-only follow-up.

## Follow-up review of Claude's findings

Restored the default-text guidance for TABL/TTYP/DTEL/DOMA/INTF metadata; those
handlers still reject structured format. Reviewed all seven regenerated snapshots:
only this guidance changed. Documented that CLI text-mode package reads print two
JSON documents, with both supported script alternatives (outer MCP JSON or one
structured {objects, listing} document). Broadened the coverage note because ADT
omissions are not limited to legacy SEGW types.

Retained the listing contract: limitReached and possiblyTruncated distinguish an
observed cap from the resulting possibility, and explicit unknown completeness
prevents consumers from treating a below-cap result as a full inventory. Did not
couple the package-specific default/clamp to unrelated URL-limit callers.

All 6,588 unit tests (214 files), build, typecheck, lint, policy and size/schema
gates passed. These follow-up changes alter guidance only, so the original live
package-listing evidence remains applicable.
