# Extension discovery adapter contract

Foundation for the approved 2026-10-29 extension-discovery stages. Stable exports live in
`src/adt/extension-discovery.ts`: `ExtensionAdapter`, `ExtensionRequest`,
`ExtensionDiscoverySession`, result/identity/provider/node/edge/source types, `extensionKey`,
`EXTENSION_LIMITS`, `assertExtensionReadAllowed`, `ExtensionProtocolError`, and `renderExtensionDiscovery`.

An adapter has signature `(session, request) => Promise<void>`. The caller creates one session
after the successful base read and passes it through all providers and child traversal. Use
`session.provider(provider, operation)` as each optional provider's failure boundary. Every
metadata, relation, revision and source operation uses `session.read(SAPReadType, options => ...)`;
forward the identical options to transport/client methods. The callback runs with the same user's
client. Do not create another session for child reads or bypass this entry point. Caller cancellation
propagates; auth, throttle, unsafe protocol and budget failures stop subsequent reads. Transient
transport retries are disabled. Normal session/CSRF handling remains inside actual-send caps.

Record provider-specific status/coverage/version/reason. An empty provider is evidence for its
scope only. `addNode` bounds and deduplicates canonical type/name/version; preserve every attachment,
include occurrence, suffix and replacement edge separately through `session.addEdge` (80 edges in sources mode; excess occurrences are counted). `sourceCache` is
request-local and may only be populated after authorized reads. Add source bodies to `result.sources`
with their exact representation; never splice them into the base. Record omissions by category.
Throw `ExtensionProtocolError` for malformed, wrong-owner or unsafe linked data. Adapters must
validate metadata-linked URIs before sending, and explicitly qualify any compatibility fallback.

Finish once, then append `renderExtensionDiscovery(result)` to the existing ToolResult content.
The original content blocks remain unchanged. Sources are separate labelled, byte-bounded blocks.
No automatic family registration or persistent caches are introduced here; downstream stages add
their adapter routing in the handler integration module. `none` skips the phase entirely.


DDIC integration is in `src/adt/ddic-extensions.ts` (linked identities/parser),
`src/adt/ddic-extension-adapter.ts` (bounded source traversal), and
`src/handlers/extension-read.ts` (mode/routing boundary). Add later family routing there; keep
family parsers outside the handler. `extension-input.ts` owns the shared schema fields/property
projection and validation. `handleSAPRead` wraps the unchanged base result; its captured version
and unfiltered TABL source seed the optional phase after base completion.

Discovery's `DataResponseBudget(..., true)` opts into aggregate error/control response accounting.
CSRF fallback bodies keep that allowance; other data consumers retain success-only accounting.
`extension_discovery` audit events carry provider statuses/counts/consumption only, without sources.
The compact renderer groups repeated provider observations and caps identities independently from
source/graph expansion. The handler routes source plug-ins, CLAS/INTF provider coverage and
BDEF verification through the same session. Family adapters must use `addEdge` to retain
occurrences within the shared edge cap and report omitted edges.

BDEF's `discoverBdefExtensions(client, session, request, baseSource, capabilities)` consumes the
already-read unfiltered base and optional cached capability hints. It checks at most two candidates
in summary, never treats descriptions as evidence, and records `candidates` omissions independently
from wire, source and rendered-output limits. No secondary session, SQL or alternate candidate fallback is used.
The renderer keeps aggregate provider statuses if the full provider list cannot fit the output cap.

Graph edges use `extensionKey` of the exact discovered owner identity, including for nested
append traversal. `observationVersion` qualifies the edge's separate metadata/source observation:
DDIC append relations are `provider_current`, include edges parsed from active source are `active`.
Explicit structure context exposes its occurrence `tree`; its `extensionDiscovery` metadata omits
the provider's append-only `edges` projection, which cannot represent that complete tree.
An active source body does not relabel its unversioned discovery identity. Canonical node
deduplication remains type/name/version; distinct version observations are not collapsed.
A completed data read or final non-auth HTTP error from the data request clears intermediate
auth/CSRF retry evidence. A failed CSRF bootstrap or blocked redirect is not such a response.
Final 401/403/429, unresolved transport failures with auth evidence, unsafe protocol,
cancellation and budget failures retain their terminal behavior. Empty/malformed index responses
are protocol failures, not valid empty provider lists.
