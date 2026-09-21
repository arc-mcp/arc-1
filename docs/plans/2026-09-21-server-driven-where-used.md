# Server-driven where-used routing — #809

## Root cause and alternatives

`SAPNavigate(references, type, name)` resolves the object URI before calling the common
where-used engine. Server-driven objects are registered in `server-driven.ts`, while
`objectUrlForType` has no case for them and retains a legacy unknown-type program fallback.
The wrong program URI is syntactically valid, so a successful empty SAP response masks the
routing error. Explicit `uri` navigation and search-resolved context usages avoid that path.

SAP describes scalar function definitions as their own CDS development objects in its
[ADT guide](https://help.sap.com/docs/ABAP_PLATFORM_NEW/4726775c8bfc483abb210252604515b2/8a109ffd0c9947bf841a7a951dc34d4a.html).
The exact ARC-1 endpoints and subtype contracts are already live-verified in the SDO registry
and developer guide; do not infer URLs from SAP's user documentation.

Options considered:

- Search every symbolic object before navigation: additional SAP calls and ambiguity where
  the registered object collection is already known.
- Expand the generic object URL resolver: affects unrelated read/write callers and the
  deliberate generic fallback contract.
- Use the existing SDO registry in `resolveWhereUsedUri`: one guard and one return, the
  same encoded URL builder already used by server-driven reads and writes. Keep this option.

## Plan

1. Keep the existing narrow registry dispatch. Shorten its comment and remove the reference
   to unsupported DRTY and the unrelated example from the runtime source.
2. Retain the nine-type regression, add a namespaced mixed-case input to verify normalization
   and one-time path encoding, and prove the tests fail against the old resolver.
3. Compare old program-URI lookup with the corrected URI and the actual tool handler on
   existing SAP scalar functions. Use read-only direct ADT access, client 001, verified TLS;
   create no objects and change no SAP configuration.
4. Run focused navigation, context and SDO tests plus the normal static/build gates. Review
   for explicit-URI precedence, authorization, fallback behavior and schema stability.
5. Push additive commits and document exact live evidence and any untested releases in #809.

## Validation

- Independently reproduced on SAP S/4HANA 2023, SAP_BASIS 758 SP02, client 001,
  direct Basic ADT over verified HTTPS. Both CALENDAR_OPERATION and RATIO_OF returned zero
  references through the original program URI and five through the registered DSFD URI.
  Neither lookup used the old-endpoint fallback. The actual `handleToolCall(SAPNavigate,
  {action:"references", type:"DSFD", name, maxResults:20})` also returned all five.
  These are reference entries (including package nodes), not five distinct code callers.
- The ten public-dispatch regression cases fail with the original resolver; all pass after
  the correction. All 257 tests across navigation, where-used output, context and SDO pass.
- Typecheck, build, lint, policy validation and file/tool-schema budgets pass. Lint reports
  two pre-existing informational notices. No schema snapshots or public inputs changed.
- Reviewed explicit-URI precedence, existing FUNC/TABL resolution, fallback handling,
  name encoding and existing safety gates. No additional resolver or discovery request is needed.
- The contributor's earlier 816 verification remains useful; this turn tested 758 only.
  No SAP objects were created or edited. This is live handler/ADT evidence, not an installed
  MCP client's end-to-end session.

No roadmap impact: this repairs existing registered types, without adding a type or
implementing ARCH-01's general discovery resolver.
