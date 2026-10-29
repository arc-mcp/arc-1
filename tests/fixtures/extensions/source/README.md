# Source plug-in wire fixtures

Sanitized read-only SAP ADT responses qualified on 2026-10-29. No authentication/session
material or business-table data is present. Source is standard SAP demo/test repository code.
Original evidence is in the shared checkout's
`docs/research/2026-10-29-automatic-extension-and-append-discovery/`.

- `nested-750.xml`: `fixtures.json`, `npl/enh_nested_demo-source-enhancements`.
- `class-750.xml`: `continuation/npl-legacy-scope.json`, `legacy-class-elements`.
- `class-758.xml` and `include-context-758.xml`: `continuation/a4h-source-sections.json`.
- Class metadata/identities and FUGR metadata/main source: `continuation/a4h-plugin-context.json`.
- FUGR F01 source/elements: `continuation/a4h-fugr-sections.json`.
- Function source/elements: `fixtures.json`, `a4h/sapbc_global_cancel_update-*`.

750 returns `fullname` and legacy implementation/element URIs. 758 returns `full_name`,
XHH source URIs and `replaced` attachment ids. The class fixtures contain seven
implementations with three replacement edges; its cheap HOOK_IMPL list contains two.
An empty FUGR main enhancement list does not cover F01 or the whole group. The include
fixture requires PROG_ENH_SUBOBJ_CHECK context. These fixtures establish observed provider
scope, not atomic snapshots or effective runtime switch applicability.

Focused implementation probes additionally captured `prog-metadata-npl.xml`,
`func-metadata-a4h.xml`, `incl-metadata-a4h.xml`, and `include-own-parent-758.xml`.
The 750 program metadata omits enhancement links; exact 750 grammar plus advertised source
permits the qualified legacy source endpoint, recorded as unadvertised-provider coverage.
The include-own-parent response identifies the selected include itself even with FUGR
context. Accept that selected owner or inherited main owner, never an unrelated object.
