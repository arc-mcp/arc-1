# Source plug-in discovery implementation evidence

Stage 2 of the approved automatic extension-discovery plan. Started from current main
`ac8385fa47b6c40c2c77c6507e03c376bfc3b613`; shared contract imported from foundation
`67e5703449c133e575d893d3184b531f3725bf2d` (local cherry-pick `38d8d7bba`).
No SAP writes, execution, RFC or helper installation. Targets use HTTPS 443, client 001.

## Reusable API for stage 3

- `parseSourcePluginElements(xml, {mainObjectUri, selectedObjectUri?, sources,
  maxImplementations?, maxDecodedBytes?, maxSourceBytes?})`: validates bounded XML,
  root/selected-owner chains and implementation URIs, preserves 750 `fullname` and
  758 `full_name`, observed versions, individual attachments, replacement edges and
  decoded UTF-8 bodies. Replacements are separate graph nodes, even at equal locations.
- `parseSourcePluginIdentities(xml)`: outer/specific HOOK_IMPL identities with observed
  switch metadata; no claim about switch runtime applicability or nested completeness.
- `sourcePluginResources(xml, unit)`: validates metadata owner/type/version and links;
  selects only the requested CLAS source section. The qualified legacy 750 route needs
  an advertised source and exact 750 grammar marker and is labelled unadvertised.
- `discoverSourcePlugins(client, session, request, {unit, source?})`: reuses the shared
  ExtensionDiscoverySession. A unit is PROG/INCL/FUNC/FUGR/CLAS with name, FUNC group
  and optional CLAS section. Pass unfiltered already-read root source when available;
  omit it when unavailable. Every hidden read uses session.read and the same transport
  options and identity. Never create a separate child session. Stage 3 owns CLAS public
  integration and native class-bound identity/generated-source providers.

Sources are `rendered_plugin_source`. Per-source decode cap is 16 KiB, aggregate decode
cap 64 KiB per bounded response; invalid base64/UTF-8 and unavailable bodies are explicit
source omissions. Traversal shares 20 nodes/depth 5 and actual-send/deadline/wire budgets.
Include occurrences are retained as edges; fetch/body deduplication is request-local.
Source scanning is capped at 256 KiB. Auth/throttle/protocol/budget failures stop traversal.

## Qualified observations

- 750 ENH_NESTED_DEMO: four nested implementations and four rendered sources, 3 sends,
  8,273 wire bytes, 4.08 s in the saved live run. The provider was not advertised in
  metadata; its qualified legacy route is explicitly labelled.
- 758 FUGR SEEF_ADT_TEST_AUNIT_FUGR1: cheap list contains one outer identity; main-source
  element response is empty; actual F01 has three implementations and two replacement
  edges. Bounded traversal found an additional include-owned implementation, retained
  6 plug-in source bodies, then stopped at exactly 20 sends (request omission reported).
  No whole-group completeness claim is made.
- 758 ENH_PROG_INCL_IMPLICIT_OPT with PROG_ENH_SUBOBJ_CHECK context: positive in earlier
  implementation runs (1.19–4.07 s, 3 sends). The final saved run hit the 12 s deadline
  during its element read; this is retained as bounded partial-coverage evidence.
- 758 selected FUNC SAPBC_GLOBAL_CANCEL_UPDATE (SAPBC_GLOBAL_FIS) and
  BDS_CONNECTION_CREATE (BDS_CONNECTIONS): one implementation/source each. Ordinary
  function source omits those injected bodies. FUNC coverage remains selected-function.
- Offline class fixtures on 750 and 758: seven implementations, three replacement edges;
  cheap 758 list contains two outer identities. CLAS public behavior is stage 3.

`live-*.json` records provider states, identities, graph edges, actual sends/bytes/time,
output bytes and source hashes, without credentials, diagnostic bodies or source bodies.
Timing is an observation, not a latency guarantee. Other releases, BTP, runtime switch
applicability and atomic snapshots remain unqualified.

## Reproduction

Use Node 24 with locked repository dependencies. Supply the target's existing SAP_USER
and SAP_PASSWORD quietly via environment, then run `npx tsx scripts/smoke-source-plugins.ts`
with SOURCE_PLUGIN_TARGET=a4h or npl and SAP_URL=https://<target>.marianzeis.de.
SOURCE_PLUGIN_OUTPUT optionally saves sanitized JSON. SOURCE_PLUGIN_METADATA_DIR captures
only the script's exact standard-SAP metadata fixtures. No source or secrets are printed
by the script. Use the unit suites `source-plugin-{parser,discovery,budget}.test.ts` for
replay, traversal and actual HTTP streaming/send/deadline/cancellation tests.
