# Correct DDLX annotation preflight (#941)

## Research and reproduction

Base: `c7bbfb5376c90a172538fb440c30b7b41405732f`; no existing PR for #941.
Roadmap checked: no matching unfinished idea or impact.

The current rule puts UI.headerInfo, Search.searchable and every ObjectModel
annotation in one on-prem 750–759 rejection, also assuming 7.5x for unknown releases.

Independent 758 SP02 HTTPS/Basic test: created a disposable `$TMP` DDLS view entity
over T100 with Metadata.allowExtensions, then tested a separate metadata extension.
With the default preflight, every tested annotation was blocked. With only that
preflight bypassed, native activation had these outcomes:

| Annotation | Native result |
|---|---|
| UI.headerInfo (typeName/typeNamePlural) | Activates; explicit active read retains it |
| Search.searchable with Search.defaultSearchElement | Activates |
| ObjectModel.semanticKey | Rejected: not permitted in metadata extensions |
| ObjectModel.text.element | Rejected: not permitted in metadata extensions |

The first test fixture listed unannotated elements, which SAP correctly rejected.
Corrected the fixture and reran the matrix. Deleted both objects after each run.

Primary evidence: SAP's [7.52 annotation table](https://help.sap.com/doc/abapdocu_752_index_htm/7.52/de-de/abencds_annotations_frmwrk_tables.htm)
already marks UI.headerInfo and Search.searchable as permitted in metadata extensions.
The [current header guidance](https://help.sap.com/docs/abap-cloud/abap-rap/defining-table-header-of-list-report)
also places headerInfo in metadata extensions. Eligibility is defined per annotation
by [MetadataExtension.usageAllowed and Scope](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCDS_1537649007_ANNO.html),
not by the assumption that all 7.5x systems reject these annotation families.

## Plan and review

1. Remove only the disproven UI.headerInfo and Search.searchable checks from the
   existing scope rule. Retain the ObjectModel guard and duplicate-UI checks.
2. Correct its diagnostic and comment so permitted annotations are not named as
   forbidden. Do not change the shared release classifier or other RAP rules.
3. Add regression tests across known/unknown releases, retained ObjectModel and
   duplicate-annotation controls. Exercise create/update/batch through the handler.
4. Verify default-preflight create, activation, label-only update, active read-back,
   batch creation, and retained native-invalid controls; run full local gates.

Plan review: no new release cutoff is justified because SAP already documented
support in 7.52. Looking up active source or fetching annotation vocabularies on
every write is unnecessary for this fix. Do not remove the whole preflight family:
the negative controls independently confirm the existing ObjectModel examples fail.

## Verification and final review

Seventeen regression cases failed before the fix: fourteen annotation/release cases
and all three create/update/batch handler cases. After the change, all 7,964 unit
tests pass, as do typecheck, lint, policy validation, build, and file/schema budgets.
Lint retains two existing informational notices.

The final compiled implementation was tested through the dispatcher on SAP_BASIS
758 SP02, client 001, using Node 24.11.1 and direct HTTPS/Basic authentication:

- Default-preflight DDLX create and activation retain both annotations in an explicit
  active read.
- A label-only update activates and preserves both annotations.
- Batch creation with `activateAtEnd:true` activates a second extension in the
  PARTNER layer; active read-back contains both annotations.
- ObjectModel.semanticKey and duplicate UI.lineItem controls are rejected with
  zero mutating HTTP calls. The existing active extension remains unchanged.
- Both disposable extensions and their DDLS view were deleted; raw ADT GETs return
  404 for all three objects.

Final review found no remaining issue in the patch. The implementation removes two
incorrect checks and leaves the release classifier, ObjectModel guard, duplicate
checks, write gates, and tool schemas unchanged. Roadmap rechecked: no roadmap impact.

Live coverage does not include 750, BTP/PP, an installed MCP client, or transportable
packages. The 816 target remains unavailable due to its previously verified license
error; no 816 live success is claimed. Unit tests cover known and unknown release
classification without asserting backend support on untested systems.
