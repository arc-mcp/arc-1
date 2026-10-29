# Class enhancement discovery

CLAS combines two independent providers in the request-local extension session. The source plug-in
adapter checks the selected class main/local source; native Relation Explorer EXTED_OBJ checks
identities bound to the owning class. Empty hooks do not imply an empty native result. In particular,
CL_OO_ADT_ENHANCED_CLASS has a structural enhancement despite empty authored/hook source.

The native provider requires exact activeContext, active root identity and parent/child references
bound to that root. It retains enhancement-to-base edges and native ENHO types. An ENHO/XH identity
is not proof of its enhancement technology or runtime switch applicability. ENV/WUL consumers retain
their original behavior. INTF ENV fallback is unsupported_context; 750's unsupported provider is
reported explicitly. Positive interface coverage and other SAP releases/BTP remain unqualified.

Sources remain separate labelled representations. The active known-subtype ENHO reader may use a
generated include revision only for a qualified source-unavailable failure: 404/resource-read failure,
or the observed 750 unsupported-technology/758 null-reference error with its release guard. Ordinary
500s, authorization, throttle, network and exhausted budgets do not permit fallback. Returned authored
metadata must name the requested enhancement and its owning class.

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
../research/2026-10-29-class-extension-live.json, with public-flow checks recorded separately.

Integration dependencies: shared contract commit 67e570344 and the source plug-in adapter/parser
from stage 2. PR #1124 was open at ab5d58b48 when inspected; its original patch is retained as a
local predecessor, followed by the strict helper changes. This branch is not a claim that #1124
has merged or that 750 supports native class identity discovery.
