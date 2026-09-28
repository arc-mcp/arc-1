# Surgical FORM/MODULE insertion (#776)

## Root cause and design

`edit_unit` deliberately requires an existing named block. Adding a small new FORM
therefore requires a whole-source update today. Keep edit_unit's replacement contract
and add one on-prem `add_unit` action for PROG/INCL, including routed FUGR includes.

Reuse the existing locked read, source hash, release-aware parser/lint, PUT and unlock
lifecycle. `unit` names the new block; `source` contains that complete FORM or MODULE.
Optional `beforeUnit` or `afterUnit` selects one existing unambiguous block; without
an anchor append at the physical file end. Do not guess where trailing INCLUDEs
belong, expand includes or build a general text editor. SAP recommends placing
[subroutines at program end](https://help.sap.com/saphelp_gbt10/helpdata/en/9f/db976935c111d1829f0000e829fbfe/content.htm).

## Implementation and verification

1. Prove add_unit is rejected through the dispatcher before implementation.
2. Reuse the unit AST and fragment validation; reject duplicate names, incomplete
   structures, missing/ambiguous anchors and both anchors together. Insert only at
   a line boundary outside the anchor block. Preserve all existing source bytes
   except the existing CRLF normalization contract, and preserve its line endings.
3. Share edit_unit's lifecycle; keep safety gates, hash guard, lint/release selection,
   transport and failure cleanup. No activation, event editing or include traversal.
4. Sync runtime/model schemas, policy, descriptions, snapshots and docs. No BTP action.
5. Tests cover append/placement, MODULE, CRLF, malformed/duplicate source, concurrent
   drafts, stale hashes, routed FUGR includes, hyperfocused mode and safety gates.
   Before implementation, both dispatcher insertion cases failed. All local gates pass.
   Live dispatcher round trips on 758 and 816 (direct HTTPS Basic, client 001)
   preserved source, rejected duplicates, activated and read back both PROG/FORM and
   INCL/MODULE. Disposable objects were deleted and absence verified with GET 404.

Explicit limits: names are checked in this physical source only. The caller must
choose an include intended for complete processing blocks and use SAP activation
for whole-program validation; this does not inspect externally included units.
Roadmap checked: no item covers this requested gap; no roadmap impact.
