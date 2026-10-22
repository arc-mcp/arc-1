# Legacy package browsing: contract before fallback

Tracking: [#1065](https://github.com/arc-mcp/arc-1/issues/1065), COMPAT-17; parent
[#996](https://github.com/arc-mcp/arc-1/issues/996). Research only; no new public input.

## Decision

Defer the implementation; keep the current refusal when discovery lacks package-filtered quick search. A native
**direct-contents** browser is feasible, but it must be an explicit mode with bounded
client work and honest completeness. It cannot silently replace descendant-inclusive
indexed search. Native 740 SP04 remains untested.

## Read-only evidence, 22 October 2026

Controls used ARC-1 1.7.0 (`7b210cbf`) against SAP_BASIS 750 SP02 and 758 SP02,
verified from component metadata. No objects or configuration were changed.

| Check | 750 SP02 | 758 SP02 |
|---|---|---|
| Discovery advertises package filter | No | Yes |
| Quick search, `packageName=SABP_UNIT`, limit 3 | All 3 objects outside package | Descendant-package objects included |
| Native root for `SABP_UNIT` | Direct subpackages and type-node IDs | Same shape, with descriptions |
| Expand returned class node, `maxResults=1` | 55 objects / 22,500 bytes in `SABP_UNIT_CORE` | 75 objects / 54,596 bytes in `SABP_UNIT_CORE_RUNTIME` |
| Short descriptions on expanded nodes | Absent | Present |
| Nonexistent package, native root | HTTP 200, empty body | HTTP 200, empty body |
| Package metadata GET, real / nonexistent package | Both 404 | 200 / 404 |

The tested packages differ because 758 subdivides the old core package. Counts are
observations, not portable fixture expectations. `maxResults` did not cap either native
response. Inspection of the 750 handler `CL_SEU_ADT_RES_REPO_STRUCTURE` confirms that
it consumes node IDs, not a result limit, and omits object texts when expanding folders.

Use the request envelope in the [existing endpoint study](2026-05-28-package-subtree-endpoints.md):
`POST /sap/bc/adt/repository/nodestructure`, explicit `parent_type=DEVC/K`, parent name
and technical name, vendor `application/vnd.sap.as+xml` body with `TV_NODEKEY=000000`.
Expand only IDs returned by that root. IDs differ by package and release. These are
read-only POSTs; retain CSRF handling. Never call the unscoped root.

A second control expanded the returned class ID through a fresh `AdtClient` with no
shared cookies or explicit stateful session. Both systems again returned HTTP 200 and
55/75 objects. This supports cross-client use for the tested controls, not a permanent
node-ID cache or a 740 guarantee. Sanitized projections of the native root/expansion:

```xml
<!-- 750 SABP_UNIT_CORE root; other fields/nodes omitted -->
<SEU_ADT_OBJECT_TYPE_INFO><OBJECT_TYPE>CLAS/OC</OBJECT_TYPE><NODE_ID>000033</NODE_ID></SEU_ADT_OBJECT_TYPE_INFO>
<!-- 758 SABP_UNIT_CORE_RUNTIME root; other fields/nodes omitted -->
<SEU_ADT_OBJECT_TYPE_INFO><OBJECT_TYPE>CLAS/OC</OBJECT_TYPE><NODE_ID>000035</NODE_ID></SEU_ADT_OBJECT_TYPE_INFO>
```

Expanded 750 rows had `OBJECT_TYPE`, `OBJECT_NAME`, `TECH_NAME`, `OBJECT_URI`,
`OBJECT_VIT_URI`, `EXPANDABLE`; 758 additionally supplied `DESCRIPTION` and other
metadata. These projections document observed wire fields; they are not full test fixtures.

## Proposed small implementation

1. Agree an explicit direct-contents mode on `SAPRead type=DEVC`. Keep indexed search
   unchanged, including its descriptions and descendant scope. Return `scope=direct`.
2. Propose one root call and one expansion call containing only selected returned type IDs.
   Combining multiple IDs in one expansion still needs a native contract test; the
   controls above expanded one folder per request.
   Do not recurse into subpackages or fetch descriptions per object. Return absent
   descriptions as absent; preserve names, types and URIs from validated native fields.
3. Share a cumulative response-byte budget and deadline across the two calls. Proposed
   starting limits: 2 MiB and 10 seconds, with at most 16 type folders. Enforce while
   streaming, before XML parsing. An exceeded limit is an explicit incomplete/error
   result; slicing after download alone does not bound memory or SAP work.
4. Apply the existing requested result cap locally. Report truncation and unexpanded
   folders. Do not promise a snapshot or globally complete inventory. An empty body
   means **unknown: missing, inaccessible or empty**, unless separate verified evidence
   disambiguates it. A 750 package-metadata 404 cannot establish absence.
5. Preserve normal SAP identity, read scope, request audit and cancellation. Never use
   this listing as new authorization evidence for writes or change the package gate.

Client budgets cannot cancel work SAP has already begun. Before enabling the mode,
measure the largest relevant package with an owner-approved read and agree whether
this residual load is acceptable. There is no proven native pagination contract here.

## Tests and resume criteria

- Sanitized 750/758 fixtures: root, one/multiple returned folders, absent descriptions,
  namespace names, duplicates, malformed XML and empty bodies. Do not invent 740 fixtures.
- HTTP contract: exact parent scope, returned IDs only, no recursion or per-object calls;
  401/403/404, cancellation, byte/deadline/folder limits and result truncation.
- Public-tool checks: explicit scope and completeness, stable modern search behavior,
  separate package safety tests, no broader-system search on failure.
- Native 750/758: direct versus descendant scope, known populated/empty/missing packages,
  namespaces and approved large-package load. Obtain 740 confirmation with the recipe below.

For the 740 reporter: fetch a CSRF token with `GET /sap/bc/adt/discovery` and retain
that session's cookies locally. POST the scoped root envelope above for one known
package, then POST one returned type-node ID using the same headers and identity.
Report status, Content-Type, byte length, type/node counts and whether descriptions
exist; omit credentials, tokens, cookies and object names if sensitive. Do not use an
unscoped root or change services/authorizations. This is a research request, not a
prerequisite for closing already-fixed client bugs in #996.

The API choice, empty-package distinction and large-package load are still open.
Keep #1065 and COMPAT-17 open; this research does not enable package browsing on 740.
