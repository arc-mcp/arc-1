# SKTD same-owner relative state alternatives

The consumed RAP-document retained attempt at `9748d084` saved a second document edit
with HTTP200. Its default readback declared native `inactive` state and the exact
relative objectstates link `./zrrp_8e66923bdef5?version=active`. The strict pinned document
parser rejected that representation. Fresh default/inactive metadata has the same
7,911-byte hash as the stopped readback; the active counterpart is a distinct document
with the first edit and a relative inactive link. The submitted and stored documents
have equal existing `documentStableValue` values. This is a state-link representation
gap, not evidence that an active readback should be accepted as a saved draft.

The reader now accepts only the literal `./<encoded-own-leaf>?version=active|inactive`
form for SKTD. The leaf is exactly the selected canonical owner URI's final segment,
including its case and percent-encoding spelling. It is not resolved, decoded or
followed. Foreign names, traversal, authorities, extra or duplicate parameters,
fragments, malformed versions and duplicate alternatives remain refused. Existing
absolute-link behavior and ENHO admission are unchanged.

Full canonical metadata hashes still include the native link and opaque fields;
optimistic and under-lock comparisons remain exact. Existing stable document equality
still omits only its qualified response bookkeeping/state links. A successful save
still requires native inactive/new state, matching content/package, and owning cleanup.
Tests replay the actual outgoing XML and all three fresh views privately, including the
real write/readback path, and preserve the old-source failures. Committed synthetic
controls cover literal shape, encoded namespace identity, changed metadata/opaque
fields, unknown state links and active-state refusal.

The original claim and failure remain consumed. No PUT, activation, native phase or
cleanup was repeated during this source correction. A separate fixed continuation
must adopt both confirmed document contents and actual active/inactive states, skip
the already submitted edits and completed activation, and bind fresh controls before
any later stage. FEAT-93's remaining native/PP and final integration gates stay open.
