# Native procedural observer framing correction

The once-only `f6a8b532aa9529b2469c44c48a506d99797d0fd6` attempt completed group
creation/generation, FUNC creation/activation, the stale-hash negative control and signature update.
The INCL collection POST and source PUT also succeeded, and the production writer returned
`saved-inactive` with exact stored hash. The qualification observer then stopped at `include-create`
because it compared the requested LF source hash against native CRLF source without its final newline.
No include editing, text-pool work, later activation or DELETE occurred. Three owners remain.

The original failed result has SHA256
`1353216906940ad13eaa9fba241897aef10fa4acf058b5cde23b0838b3e65fd2` and intent
`fc1b04ee3294ee6f1bd46190f3519bdd0e1d7223ba42185e748f09f63c5f531a`.
The issued private execution audit has SHA256
`95bb4b780de90747baff8fbdef62b929f3374ae145390f8c40271dccec2cb150`; its separate final
post-control addendum has SHA256
`f6e090875b49a6a04a685c5ad53b54a61a8fd873baa74b62f9e1738ce886e42f`.
The native root and all original receipts remain consumed and unchanged. Actual post-stop user
and suffix searches showed zero locks; this confirms those searches, not object absence.

The correction changes only two qualification assertions. INCL expected-content comparison now
uses the same `editableSourceEquals` contract as the production writer: CRLF versus LF and terminal
newlines only. The untouched sibling FORM check converts CRLF to LF before its existing exact
substring proof. Nonempty bytes, indentation, literals and internal blank lines remain significant.
Returned hashes, fresh receipt/payload agreement, stale source checks, before-send proof, activation,
metadata identity/package/author/marker and owning-session cleanup stay exact and unchanged.
No production adapter, permission, public schema or protocol claim is changed.

The minimal own-source fixture binds the actual164-byte submitted and172-byte stored include
source. The stored SHA256 is
`73ee1e44e20e34455195eb5c4181cd34d11addf7bf5a7b0d4ce3ef1bbe626362`.
Real shared-driver/HTTP mock regressions exercise LF/CRLF/end-newline variants through the full
synthetic graph, actual stored hashes, sibling content/internal-blank-line refusals and a
normalization-equivalent drift that must still fail the exact stale hash before a FORM PUT.
Mocked successful later stages do not create native evidence. Before the correction, three positive
framing cases failed at the observer and the late-drift test could not reach its intended stage.

This is an author correction awaiting independent review. It does not permit rerunning the original
entry. A separately reviewed fixed retained continuation must bind the original graph and history,
fresh generated-tree/text-pool baseline and active/inactive FUNC/INCL state before continuing after
the already acknowledged include save. No generic resume or replay is introduced here. Full native
cleanup, later text variants, current PP/recording and whole-PR acceptance remain separate gates.
