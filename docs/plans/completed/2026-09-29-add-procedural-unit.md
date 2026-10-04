# Surgical FORM/MODULE insertion (#776)

## Root cause and design

`edit_unit` deliberately requires an existing named block. Adding a small new FORM
therefore requires a whole-source update today. Keep edit_unit's replacement contract
and add one on-prem `add_unit` action for PROG/INCL, including routed FUGR includes.

Reuse the existing locked read, source hash, release-aware parser/lint, PUT and unlock
lifecycle. `unit` names the new block; `source` contains that complete FORM or MODULE.
Append at the physical end of the selected source, leaving existing units, their
headers and trailing INCLUDEs in place. SAP recommends placing
[subroutines at program end](https://help.sap.com/saphelp_gbt10/helpdata/en/9f/db976935c111d1829f0000e829fbfe/content.htm).

## Implementation and verification

1. Prove add_unit is rejected through the dispatcher before implementation.
2. Reuse the unit AST and fragment validation; reject duplicate names, incomplete
   structures (including flat, unterminated MODULEs retained by abaplint). Preserve
   all existing source bytes except the existing CRLF normalization contract, and preserve its line endings.
3. Share edit_unit's lifecycle; keep safety gates, hash guard, lint/release selection,
   transport and failure cleanup. No activation, event editing or include traversal.
4. Sync runtime/model schemas, policy, descriptions, snapshots and docs. No BTP action.
5. Tests cover append, MODULE, CRLF, malformed/duplicate source, concurrent
   drafts, stale hashes, routed FUGR includes, hyperfocused mode and safety gates.
   Before implementation, both dispatcher insertion cases failed. All local gates pass.
   Live dispatcher round trips on 758 and 816 (direct HTTPS Basic, client 001)
   preserved source, rejected duplicates, activated and read back both PROG/FORM and
   INCL/MODULE. Both append-only cases were repeated on both releases after review.
   Disposable objects were deleted and absence verified with GET 404.

Explicit limits: names are checked in this physical source only. The caller must
choose an include intended for complete processing blocks and use SAP activation
for whole-program validation; this does not inspect externally included units.
Roadmap checked: no item covers this requested gap; no roadmap impact.
