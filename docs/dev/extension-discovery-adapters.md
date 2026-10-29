# Extension discovery adapter contract

Foundation for the approved 2026-10-29 extension-discovery stages. Stable exports live in
`src/adt/extension-discovery.ts`: `ExtensionAdapter`, `ExtensionRequest`,
`ExtensionDiscoverySession`, result/identity/provider/node/edge/source types, `extensionKey`,
`EXTENSION_LIMITS`, `ExtensionProtocolError`, and `renderExtensionDiscovery`.

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
include occurrence, suffix and replacement edge separately in `result.edges`. `sourceCache` is
request-local and may only be populated after authorized reads. Add source bodies to `result.sources`
with their exact representation; never splice them into the base. Record omissions by category.
Throw `ExtensionProtocolError` for malformed, wrong-owner or unsafe linked data. Adapters must
validate metadata-linked URIs before sending, and explicitly qualify any compatibility fallback.

Finish once, then append `renderExtensionDiscovery(result)` to the existing ToolResult content.
The original content blocks remain unchanged. Sources are separate labelled, byte-bounded blocks.
No automatic family registration or persistent caches are introduced here; downstream stages add
their adapter routing in the handler integration module. `none` skips the phase entirely.
