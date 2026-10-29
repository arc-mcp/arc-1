# Stage 3 implementation handoff

Implementation commit: `6994d2f447a18780871ae27bded04e026cda95e5` on
`codex/automatic-extension-clas`. Final validation: **10,788 tests**; typecheck, lint,
policy validation, build, file sizes and tool-schema budgets pass. Standard full schema is
74,971 bytes under the existing 75,000-byte ceiling. Snapshot changes describe extension modes.

Dependencies integrated: DDIC foundation `67e57034` + implementation `a761b5e2`;
source plug-in implementation/public integration through `c1fc0684`. The class review base is
pinned to that stage-2 commit. Open #1124 remains at `ab5d58b4`; its routing commit is reused,
with strict active-feed/content ownership, request-budget and denial checks added here.
Coordinate that dependency before merging. No release or SAP mutation was performed.

Final read-only public runs are `a4h-public.json` (758) and `npl-public.json` (750), with
implementation revision, key source-file hashes, base-block hashes, provider states, graph/source
labels and consumption. Repeated full-root reads match the none-mode base hash. Selected-section
hashes are recorded separately; preservation is also covered by handler tests. Sources and
credentials are not recorded. HTTPS 443/client 001; the launcher used IPv4-first DNS ordering.

- 758: structural identity CL_OO_ADT_ENHANCED_CLASS1 is independent of empty hook source;
  its generated E and discovered EM001 active revisions are returned separately. The hook
  example retains seven implementations, seven native ownership edges, eight rendered bodies
  and three replacement edges. Definitions hook coverage is empty while native owning-class
  coverage and seven authored bodies remain available. The nested XHH parent source reference
  is bound to the same discovered parent identity, never followed as an arbitrary link.
- 750: hook source expansion returns eight bodies and three replacement edges. Native class
  and interface relations remain unsupported. `npl-known-generated.json` separately qualifies
  named generated source retrieval and its discovered child; it does not establish automatic
  identity/class-binding coverage. Earlier bounded deadline observations are preserved in
  `npl-earlier-deadlines.json`; these timings are not a latency SLA.
- INTF: 758 ENV fallback is unsupported_context; 750 is unsupported_provider. Neither means
  absence. Positive interface source coverage, BTP, other releases, runtime switch applicability
  and an atomic cross-provider snapshot are unqualified. BDEF remains a separate stage.

Reproduce public reads with existing SAP_* environment credentials and
CLASS_EXTENSION_TARGET=a4h|npl, SAP_URL=https://<target>.marianzeis.de, optionally
CLASS_EXTENSION_OUTPUT=<path>, then run:

    node --dns-result-order=ipv4first --import tsx scripts/smoke-class-extensions.ts

The shared session owns all budgets and rendering. `discoverClassExtensions` combines the native
provider and the reused `discoverSourcePlugins` adapter; direct helper exports support focused
replays. ENV/WUL behavior remains compatible. New class, generated-source, real direct/Connectivity
budget and public-handler suites cover wrong roots/feeds/URIs, inactive separation, denials,
terminal failures, raw source preservation, selected sections, depth and omission accounting.

Roadmap checked: no roadmap impact. FEAT-03 concerns enhancement authoring and stays unchanged.
