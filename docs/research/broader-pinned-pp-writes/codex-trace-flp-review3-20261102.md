# Trace/FLP follow-up review 3

Independent parent Codex review of `f5930bece5fea73aac42bd9e2dde1fc2e031a6f4` against `35242656dd64f3ffcb00c46e9f6146516b2ef2f2`. The reviewer authored neither change nor tests. Codex fallback follows the confirmed external Claude limit.

**Private integration: GO. No new findings in this focused delta.** All three review 2 P2s are closed. This is not native/public admission or whole-PR readiness.

- Tile-page rows now need exact requested page identity, nonempty native instance/chip IDs and unique instance identity before mapping. Invalid rows throw rather than being filtered into absence or false membership. Existing mutation readers also refuse truncated collections; post-write errors retain the submitted/unconfirmed state. Regression coverage includes source/group preflight and foreign-page readback after an accepted assignment.
- Generic OData404 inference is removed. Keyed success must identify the exact requested entity. Catalog/group create explicitly refuses before any SAP request, and DELETE never reports verified deletion under this incomplete absence contract. JSON/XML/HTML/malformed service errors remain unknown. The removed speculative create branches and documented implementation gap are consistent with the accepted rule that unknown native recording/resource contracts stay unavailable.
- ST05 XML validators no longer assert a submission outcome. The caller prefixes validation detail with actual preflight/rejected/unconfirmed state. Malformed, unknown-shape and wrong-namespace readback after a successful PUT require GET→PUT→GET once and preserve inspection guidance.

Public capabilities and FLP recording lock remain closed, legacy single-target calls are untouched, and remaining native absence/recording/two-writer qualification is explicit in research, plan and FEAT93. Integration must preserve the newer main-branch native-cleanup evidence when resolving documentation changes from this older base.

First and final verifiers each confirmed4,558 files unchanged. Independently ran9 focused private, legacy, handler, admission and aggregate suites: 494 tests passed under Node 22.21.1. Full 507 files / 13,727 tests and all other checks are author-reported with retained logs; they were not repeated for this narrow delta. No source edit, install, live action, credential access or external-service call was performed in this review. No custom mutant was executed. Broad diff output was truncated; decisive production hunks and checks were re-read in bounded ranges. No source reads after final verifier.
