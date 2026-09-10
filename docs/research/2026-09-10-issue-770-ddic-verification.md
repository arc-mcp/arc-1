# Issue #770: DDIC batch follow-up verification

## Request and reviewed decision

The [requester's PR comment](https://github.com/arc-mcp/arc-1/pull/772#issuecomment-5613046844)
asks to include TABL, DTEL and DOMA in the 20-object batch. This extends the
[original implementation and verification](2026-09-09-issue-770-implementation-verification.md).

Add exactly those three types to the shared batch enum. Use ATC references of
the form `/sap/bc/adt/atc/objects/R3TR/<type>/<encoded-name>` for these selections.
The existing normalization accepts TABL/DT and TABL/DS as TABL, DTEL/DE as DTEL,
and DOMA/DD as DOMA. A table and a structure share the R3TR type TABL; their names
identify the objects without an editor subtype lookup.

This adds one small URI helper and uses it in the existing batch handler. The
shared enum feeds both runtime validation and public tool schemas. Other batch
routes, single/package calls, authorization, the 20-entry limit, one verification
run, cancellation and the original deadline remain unchanged.

The plan review rejected a new metadata resolver: it would add SAP requests and
release-specific routes without resolving the observed missing-result behavior.
Direct ATC references avoid that dependency. In particular, blindly constructing
`/ddic/tables/T000` failed with an HTTP 500 URI-mapping error on 750, while the
equivalent ATC reference was accepted. Acceptance alone does not prove that SAP
checked or reported the selected object.

## Before implementation

- All **5,912 existing unit tests** passed across 198 files.
- The first 21 DDIC regression cases ran against the old implementation:
  **16 failed and five passed**. Valid DDIC selections were rejected; the five
  invalid-name cases already passed. A mixed DDIC/class routing case was added
  during review, bringing the new test file to 22 cases.
- Native probes compared discovered metadata/editor URIs against ATC R3TR URIs
  on SAP_BASIS 750 SP02, 758 SP02 and 816 SP01. All used HTTPS, read-only safety
  configuration and existing objects; no repository objects were created or edited.
  ATC itself produces temporary worklists/results.

The final custom-object comparison used the same selection and DEFAULT variant
within each system:

| System | Selected types | Metadata URI records | ATC URI records | Interpretation |
|---|---|---:|---:|---|
| 750 | Domain, data element, table, structure | 0/4 | 0/4 | Neither route established coverage |
| 758 | Domain, data element, table | 0/3 | 0/3 | Neither route established coverage |
| 816 | Domain, data element, table, structure | 1/4 | 1/4 | Both reported only structure ZABAPGIT_CI_RESULT |

On 758, metadata confirmed the selected domain ZARC1_BDOM_MNWYCGTZ1CSF, data
element ZARC1_BDTL_MNWYCGTZRXE and table ZDEMO_SOH were active. Repeating the
758 and 816 comparisons with DDIC_CHECKMAN_TL did not change their reported
object sets. Standard-object probes (MANDT, T000 and BAPIRET2) also yielded no
processed records through the ATC references on these systems.

These observations do **not** establish why SAP omits each object. They show that
switching to metadata URIs does not fix these examples and that object existence
or activation cannot substitute for ATC result evidence. The unbatched executor
called the 816 run complete with one processed record; the batch wrapper must
still account for all four requested objects.

## After implementation: live production dispatch

These calls used the real `handleToolCall` normalization, validation, handler,
batch orchestration and SAP HTTP client. Timings are individual observations,
not repeated performance benchmarks.

| System / selection | Time | Result |
|---|---:|---|
| 750, same four custom DDIC objects | 11.48 s | 0/4 reported; incomplete, no verification after empty first evidence |
| 758, same three custom DDIC objects | 3.68 s | 0/3 reported; incomplete, no verification after empty first evidence |
| 816, same four custom DDIC objects | 9.40 s | 1/4 reported; structure has zero findings, remaining objects unknown after one verification |
| 750, class plus DDIC aliases and missing objects | 22.66 s | Class finding retained; DDIC omissions unknown; one verification |
| 758, duplicate table aliases, structure and missing domain/data element | 12.76 s | 1/4 unique objects reported; table ZABAPGIT has zero findings, others unknown |
| 816, duplicate structure aliases and missing domain/data element | 9.21 s | 1/3 unique objects reported; structure has zero findings, missing objects unknown |
| 758, 20 unique DDIC objects: 7 domains, 7 elements, 6 tables | 9.28 s | 2/20 reported; 18 unknown after one verification, incomplete |
| 758, tables ZABAPGIT and ZARBINEMRJBGOGXG | 5.79 s | Complete, 2/2 reported with zero findings, no verification |
| 816, table ZABAPGIT and structure ZABAPGIT_CI_RESULT | 13.50 s | Structure reported with zero findings; table unknown, incomplete after one verification |
| 758, original 20-class regression selection | 25.32 s | Complete, 20/20 reported across two runs, 150 findings |

The last class run's 150 findings exactly match the pre-change native result as
a multiset of priority, check title, message, URI and line. Existing class routing
and the missing-only verification behavior are preserved.

Every unresolved DDIC coverage entry has `findingCount: null`. Default output
returns an error for incomplete evidence; structured output retains the same
evidence with `complete: false`. A successfully reported clean table or structure
does get a zero count. This distinction is the main correctness check.

## Offline verification and final review

- **5,933 tests passed across 199 files** after implementation: 22 new DDIC cases
  and removal of the old test that rejected TABL/DS.
- New tests cover bare and slash types, case/whitespace normalization, a mixed
  domain/element/table/structure batch, mixed class routing, same-name objects of
  different types, alias deduplication, namespaced URI encoding, finding ownership,
  missing-only verification, incomplete default/structured results, wrong returned
  types and invalid path/XML names. Unexpected metadata calls fail the mocked tests.
- Existing single/package, lifecycle, deadline/cancellation, schema parity,
  read-only authorization and multi-target tests remain in the full suite.
- Typecheck, build, Biome, policy validation and size/schema budgets passed.
- Seven public schema snapshots change only by adding TABL, DTEL and DOMA to the
  batch item enum: 21 additional serialized bytes. No further budget increase is
  needed; hyperfocused mode is unchanged.
- Review verified enum/validator agreement, batch-only routing, encoded name
  segments, existing XML escaping, no additional metadata requests, and preservation
  of unknown coverage. Documentation was corrected to distinguish accepted selection
  from evidence that SAP actually checked an object.

## Evidence limits

Live tests demonstrate reported table and structure records, accepted DDIC
selections on all three releases, and honest handling of omitted domain/data
element records. **No tested live domain or data element produced a processed
record.** Their reported-result path is covered with mocked SAP responses, but
successful checks for those types still need confirmation with a suitable object,
variant and target system. Repeated retries or invented zero counts cannot bridge
that evidence gap.

The 816 system is on-premises, not a BTP ABAP tenant. Namespace encoding is covered
offline, without claiming a successful live namespaced DDIC check. Full local
probe scripts and JSON captures are retained outside this commit; this note records
the relevant observations without publishing redundant backend responses.
