# Declarative v4 failure and retained pair

Status on 3 November 2026: the one v4 attempt failed; its BDEF and abstract DDLS remain pending separate reviewed cleanup. The attempt is permanently consumed. This is Basic-native contract work on A4H/001 as MARIAN, not Principal Propagation or public-admission qualification.

## Observed run

The exact reviewed source was `99a375a16efd8891adbff9d2995d2684c5e550fb`. New GET preflight, fresh zero-lock SM12 captures, independent baseline audit, a clear GitHub native-job window and the nonclaiming check preceded the single execution at 02:19:39–02:20:44 UTC. The source candidate generalizes exact-owned relative state-link recognition while preserving typed ownership checks; this failed native run is not evidence of a complete six-owner lifecycle.

The view DDLS, abstract DDLS, DCLS and DDLX each completed create, activate, comment update and activate. The BDEF was created and saved, but native preaudit explicitly reported `activationExecuted=false` and `generationExecuted=false`. Its `mandatory:execute` field lacked entity-level `with control`. SRVD creation was never sent. SAP documents this prerequisite in [Modeling Parameters for Non-Standard Operations](https://help.sap.com/docs/abap-cloud/abap-rap/modeling-parameters-for-non-standard-operations); this supports a future fixture correction, not a claim that corrected source has activated.

DDLX, DCLS and the view DDLS were deleted in dependency order, with typed absence and successful owning cleanup. All twelve own LOCK/UNLOCK pairs succeeded. The BDEF and its abstract DDLS dependency were preserved. Fresh post-run user/suffix SM12 searches at 02:28:07 and 02:28:59 UTC showed zero locks; an earlier expired browser-session capture is excluded. Zero locks do not establish object absence.

The [independent failure audit](2026-11-03-native-declarative-v4-failure-audit-verbatim.md) verified all 622 unchanged protocol files, 600 journal records, native outcomes and both saved post-run images. The result SHA-256 is `3cb95d1620f6dfad4402d61eba1171d955e02f375c7f7cb434c392f161afb940`; audit SHA-256 is `927171cb558de07af18fdf20b34603d1e40153ee713414bd5b3be8e643bcdcf7`. Its scope ends before the fresh inspection below.

## Fresh read-only inspection

A separate fixed GET-only collector at 02:31:25 UTC inspected default/active metadata and default/active/inactive source for both retained owners, plus the four other owner endpoints. It used HTTPS443, client001, no redirects, no mutation and bounded responses. Collector, manifest and all fourteen response bodies remain private under `pr1142-v4-failure-get-inspection-2026-11-03T023125763Z`.

- BDEF `ZARC1_V4A_013FECCE68663763` has both a native active generated unmanaged shell and the intended inactive abstract source. Active-source SHA-256: `7be05fcec2b5134a6ee5e91aebdb3ce65351924a341704b079a707eb930182de`; inactive-source SHA-256: `8f34e7d608334e42ab6eaf4d10cf662928461c4898746a46582ccf16d083effb`. Active metadata for the initial shell does not mean the requested abstract source activated.
- Abstract DDLS with the same name is active, with source SHA-256 `4b8b2e43dd62759a3a41215e6fc7b9cff36d010ca89ab3fcb5205bd60a3213b8`. Its inactive-source GET returns the same bytes; HTTP200 alone does not establish an inactive draft.
- The view DDLS, DCLS, DDLX and SRVD return owner-specific native absence responses.
- The active BDEF shell references `ZBP_ARC1_V4A_013FECCE68663763`. A separate fixed GET at 02:33:43 UTC returned native `ExceptionResourceNotFound` for that exact class. This reference is not ownership or permission to delete a class. The response is retained in `pr1142-v4-referenced-class-inspection-2026-11-03T023343009Z`.

## Subsequent cleanup and next boundary

The [separate recovery at 04826cc7](2026-11-03-native-declarative-v4-recovery.md) removed the exact BDEF
and then its abstract DDLS on 3 November at 06:13 UTC. Independent audit confirms two DELETE200s,
all six owners/reference CLAS typed absent, successful own cleanup predicates and fresh zero-lock
controls. The original failure evidence above is unchanged; no owner remains from this run.
The failed lifecycle and successful recovery both remain consumed. A later lifecycle needs fresh,
corrected fixtures and a new reviewed protocol. Full native, current-code two-writer PP and public
admission remain open. FEAT-93 remains open for these gaps.
