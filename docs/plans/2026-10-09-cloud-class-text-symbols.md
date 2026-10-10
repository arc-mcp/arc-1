# Cloud class text-symbol writes

## Root cause and scoped plan

BTP already supports the class text-symbol read alias and the native pool lifecycle
was exercised on ABAP Environment 920 in the October 9 audit. The public BTP action
schema still excludes `edit_text_symbols` because of an outdated assumption that
Cloud has no text pools.

Expose the existing action for CLAS symbols only. Add the action and optional
`textPart="symbols"` to the BTP JSON/runtime schemas; require type CLAS for this
action before HTTP. Reuse the existing locked PUT, matching MIME/Accept, unlock,
pool-only activation, package enforcement and cache invalidation. Add no new
endpoint, pool parser, activation path, transport behavior or read type. Existing
`SAPRead(type="CLAS", include="text_symbols")` remains the read path.

## Plan review

A general TEXT_ELEMENTS/BTP type flip would advertise unsupported owners/parts.
Keep PROG/FUGR writes excluded and reject INTF and other Cloud object types for
this action. Empty source means explicit clear; omitted source remains an error.
Pool activation must leave pending class source unchanged. Preserve activation
failure hints and test scope, write ceiling, deny action, package and discovery
refusals. Keep the schema budget by removing redundant action enumerations from
BTP property descriptions, not by raising limits.

## Validation and final review

All 8,081 unit tests pass, including 14 Cloud-specific public-dispatch tests:
accept/clear, unsupported owner/part refusal before HTTP, missing discovery,
package/write-ceiling/action denial, read-only scope, and failed activation hints.
Typecheck, Biome, policy, build, file/schema budgets and strict docs build pass.
Snapshots were updated and reviewed; the on-prem snapshots are unchanged.

Fresh compiled public lifecycles pass on 758 and 816 (HTTPS/Basic, client 001) and
BTP 920 SP04 (named-user OAuth, client 100, owned Cloud package): write two symbols,
replace with one, explicitly clear, read through the existing class alias, and
verify byte-for-byte preservation of both active and pending class source after
every pool activation. Every class was deleted and its absence confirmed by 404.
750 passes the explicit missing-service refusal and owner cleanup. A first test
harness attempt supplied getClass options in the include argument; it failed
before text writes, cleaned its fixtures, was corrected, and was rerun successfully.

Final review found no further change needed. This is direct public-dispatch/native
qualification, not an HTTP/PP or recording-transport test. FEAT-83 existed only in
the local audit; no completed roadmap entry is added. Generic Cloud TEXT_ELEMENTS
reads remain outside this narrow feature; the class read alias is already public.
