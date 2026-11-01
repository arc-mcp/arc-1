# Class enhancement discovery

CLAS combines two independent providers in the request-local extension session. The source plug-in
adapter checks the selected class main/local source; native Relation Explorer EXTED_OBJ checks
identities bound to the owning class. Denying `SAPNavigate.relations` suppresses all native
class/interface relation reads and reports that provider as denied; independent source hooks can
still run under their own SAPRead permissions. Empty hooks do not imply an empty native result. In particular,
CL_OO_ADT_ENHANCED_CLASS has a structural enhancement despite empty authored/hook source.

The native provider requires exact activeContext, active root identity and parent/child references
connected to that root through validated ENHO ownership. Native nested edges retain their direction;
hook replacement semantics come from the separate source element response. It retains enhancement-to-base edges and native ENHO types. An ENHO/XH identity
is not proof of its enhancement technology or runtime switch applicability. ENV/WUL consumers retain
their original behavior. INTF ENV fallback is unsupported_context; 750's unsupported provider is
reported explicitly. BTP SAP_BASIS 920 is read-only qualified through direct service-key/browser
OAuth: native structural identities and main hooks work; authored structural/local source reads
return 403 for the tested identity and remain denied without fallback. INTF still returns ENV.
Positive interface coverage, other releases and BTP principal propagation remain unqualified.

Sources remain separate labelled representations. The active known-subtype ENHO reader may use a
generated include revision only for a qualified source-unavailable failure: 404/resource-read failure,
or the observed 750 unsupported-technology/758 null-reference error with its release guard. Ordinary
500s, authorization, throttle, network and exhausted budgets do not permit fallback. Returned authored
metadata must name the requested enhancement and its owning class or discovered parent. The
observed XHH parent `/source/main` URI is accepted only with the exact native parent name/type.

The shared PR #1124 helper is hardened here: candidate names are validated, the feed must name the
same include with type REPS, and only one id 00000 is eligible. Its canonical content URI must refer
to the same include and active entry. The 1970 timestamp in a returned path is retained verbatim and
never used to choose a revision. Missing active entries never select history or inactive drafts.
The exact feed MIME application/atom+xml;type=feed is required on 758. Every read carries the same
actual-send, aggregate-response-byte, deadline and cancellation budgets and the user's SAPRead deny
rules, including ENHO and INCL.

Generated source can omit implementation names. It is returned unchanged under the generated include
identity; it is not an inferred edit target. Only an actual INCLUDE statement bound to that owner
permits an EMnnn child read. The existing include parser handles comments/literals; a request-local
scan substitution handles generated '=' names that its authored-source grammar does not accept.
No child name is guessed. Source graph limits and output omissions remain visible.

Tests: class-extensions, class-extension-budgets, enhancement-include, source-plugin-parser and
repository-relations. The real HTTP oracle covers direct and Connectivity sends, streamed bytes,
deadlines and terminal failures. Sanitized fixtures live in tests/fixtures/class-extensions and
source hook fixtures in tests/fixtures/extensions/source. Live qualification is recorded in
../research/2026-10-29-class-extension-live.json (early helper runs) and
../research/2026-10-29-class-extension-discovery/README.md (final public-flow evidence).
The 2026-10-31 test-gap audit and BTP results are in that directory's `test-gap-audit.md` and
`btp-public.json`; the latter contains hashes and provider observations, never source bodies.

Integration dependencies: DDIC PR #1143 and source plug-in PR #1158 are merged into main.
The 2026-11-01 integration retains their final budget, CSRF-recovery, provider-status, parser and
renderer fixes. The class stage adds only its independent providers, strict generated-source
helper and selected-section routing. Existing source-context/filter labels remain intact.

This PR incorporates and supersedes the routing/fallback work from #1124, inspected at
ab5d58b48. Its original authored patch is retained as commit 707e474eb in the branch history,
followed by the stricter identity, active-revision, URI, deny-rule and budget checks required
by the approved class-discovery plan. #1124 remains open until this replacement is merged;
it is not an additional runtime dependency to merge first. This does not qualify native
class identity discovery on 750.
