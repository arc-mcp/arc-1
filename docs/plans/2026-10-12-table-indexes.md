# Classic secondary indexes — #938 / FEAT-72

## Research

Native `TABL/DTI` metadata/source create, update, activation and deletion worked on
758, 816 and BTP 920. Listing must use repository `nodestructure` POST: the similarly
named objectstructure GET returns broken index URLs. 750 lacks the index collection.
The existing blues/AFF engine matches the lifecycle; only creation needs the actual
parent table's container reference and package.

## Plan

1. Register `TABL/DTI` in the existing server-driven engine. Use `TABLE~INDEX` names,
   JSON source, native metadata/version checks and separate activation. Do not collapse
   the type into TABL. Read pending versions explicitly, following the two-user settings finding.
2. Create with a verified parent table/package and containerRef. Supplied package is
   only an assertion. Keep existing safety gates and native validation; updates replace
   the complete index definition, so document reading the pending source first.
3. Add `SAPRead(type="TABL", include="indexes")` using the verified nodestructure
   response. Return canonical names and native URIs; validate identity and never guess
   suffixes or execute catalog SQL. Return an empty list for a valid empty tree only.
4. Test namespaces, source transport, partial-create and delete failure reporting,
   package/read-only/scope gates and unavailable discovery. Live-test fresh listing
   before/after activation, populated tables, unique-index duplicate rejection/repair,
   normal activation preaudit, and transport recording where available. Clean fixtures.
5. Keep docs concise, refresh tool snapshots and narrow FEAT-72 to unqualified variants.

## Plan review

Reuse the blues engine; no new table-settings/index transaction, automatic index
selection, performance promise, upload protocol or generic parent-object framework.
Creation and source save can partially succeed, so preserve the engine's explicit
created-but-source-failed warning. An index activation may build a database structure;
a timeout is an unknown result and must not trigger a blind retry. XINX and CDS table-
entity/index variants remain out of scope. Review native activation outcomes before
adding any additional state helper.

## Implementation review

Reused the existing engine as planned. Native warning-only failure on 758 requires a
small post-activation check: warnings are unverified, otherwise metadata must be active.
Normalize encoded URI identities so `%7e` warnings map to the submitted `~` index.
No message-text matching or database conversion was added. Focused/public tests cover
these outcomes; full unit suite passes. JSON header description is not an update
mechanism on tested SAP, and pending metadata may report `new`; documentation states both.
