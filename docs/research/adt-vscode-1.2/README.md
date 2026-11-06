# ADT for VS Code: ARC-1 research index

**Updated 19 October 2026.** Current decisions are deliberately smaller than the original
1.2 adoption proposal. Existing ARC-1 capabilities are the starting point, not client parity.

| Area | Decision after review |
|---|---|
| Transport review, #1008 | Merged: source attribution, missing parts, scope and bounds through MCP; no CLI/HTML/report framework |
| SQL notebook, #1009 | Closed after #1023: native .abapsql guidance and zero-count regression; no runner |
| Policy preview, #1010 | Rejected broad preview; deny-rule documentation/BOR regression merged in #1016 |
| Broad diagnostics, #1011 | Dump filters merged in #1020; bounded syntax in draft #1029. Saved DDIC logs deferred; do not merge the umbrella |

Current transport [plan](../../plans/2026-10-18-transport-review-mcp.md),
[fresh SAP evidence](../2026-10-18-transport-review-mcp.md), and
[user workflow](../../../docs_page/review-workflows.md).
The [syntax extraction evidence](../2026-10-19-bounded-syntax-extraction.md) records current validation and review limits.
The original reports used older revisions; their claims are not current acceptance evidence.

## All 19 workflow areas

| ADT area | ARC-1 decision | Next step / resume trigger |
|---|---|---|
| Destination restrictions | Reuse merged opt-in XSUAA target grants, #677 / ADR-0008 | Release and landscape acceptance; no second ACL engine or incidental writes |
| Package write restrictions | Reuse real-package exact/prefix/subtree checks | Explain clearly: write-package rules are not read/data restrictions |
| Effective access explanation | Extract only evaluator/denial improvements; no policy-preview tool | Inspect actual enforcement/denial feedback; no extra preflight call |
| SQL notebooks | Native .abapsql guidance and exact-count regression merged in #1023; runner rejected | Use the native format; no custom runner or notebook schema |
| Timeline / comparisons | MCP source diff improvements in #1008; no renderer | Preserve provenance and uncertainty; avoid another diff engine |
| Transport Organizer | Reuse list/get/history/mutations; build review workflow | Specific missing task/member action needs its own use case; owner fix #1003 is merged |
| Diagnostic feeds | Dump filtering merged in #1020; broader #1011 remains separate | Dumps first; Gateway/ATC/Unit feeds only with advertised, verified contracts |
| Dictionary activation log | Saved DOMA log GET verified; latest-attempt correlation unverified. Saved application logs are separately merged in #1024 | FEAT-71: historical-log use case or independent correlation evidence; never reactivate merely to get a log |
| Object checking | Empty-report fix #1019 merged; draft #1029 validated on A4H and awaiting Claude review | FEAT-69: other releases/live BTP, additional types and source reconciliation before transport integration |
| Source-code search | Reuse SAPSearch source_code | Reuse merged #1006/#1007; unavailable is not zero matches |
| Explanation / documentation | Reuse SAPContext, KTD and existing explanation skills | Improve citations/templates against a representative corpus; no core model-service dependency |
| Source/file editing | Reuse method surgery; review open #586 | Validate duplicate anchors, stale source and locks; editor buffers need an explicit client bridge |
| Object-action discovery | Conditional catalog of already classified operations | Concrete discovery use case; derive policy/capability-filtered catalog; never execute unknown advertised actions |
| ATC exemptions | Demand-driven governed workflow | Confirm classic/cloud family, approvers and CHKE contract; request preparation before explicit mutation |
| Service consumption models | Conditional SRVC/OData importer | Customer integration need, EDMX contract, generated ownership/package/transport/readback; RFC/WSDL later |
| Swagger / service testing | Conditional bounded OData inspection | Service-binding metadata and selected safe GETs first; no arbitrary write console |
| Additional repository objects | Per-family matrix below | Prove lifecycle and backend release; do not copy an enum list |
| RFC without SAP Logon Pad | No parity work | ARC-1 already connects through HTTP/BTP; RFC needs a separately justified workflow |
| Solution Manager systems | Customer-triggered compatibility investigation | Verify the exact managed transport flow; no blanket ChaRM claim |

## Repository object families

| Family | Current baseline / next useful work | Evidence gate |
|---|---|---|
| DEVC, DTEL, MSAG | Already supported; examples and specific compatibility fixes | Actual failing workflow, not registry parity |
| ENHO / ENHS | BAdI implementation writes on main; FEAT-03 covers broader authoring | Definition/container lifecycle, lock/package ownership and activation |
| TABL/DTT | Main has technical-settings support; FEAT-70 holds remaining fields | Partial updates preserve untouched values; parent package and active readback |
| DSFD, DTDC, DTSC | Existing registered support | Definition support does not prove scalar-function implementation support |
| DRTY and further CDS families | Reuse DRTY; FEAT-73 for specific additions such as DSFI/DRAS | Per-type discovery, MIME, source state and lifecycle |
| CDS indexes / TABL/DTI | Table indexes on main; FEAT-72 CDS indexes blocked | Existing seed object plus reproducible CDS index lifecycle |
| UIAD / UIPG / UIST | UIAD exists; page/space templates need research | Customer need and native lifecycle; legacy FLP groups/catalogs are different |
| SAJC / SAJT / APLO | Existing server-driven implementation | Backend gating and actual lifecycle; no duplicate type additions |
| SMBC | Read path on main | Authoring only for a concrete configuration workflow; read support is not CRUD |
| SRVC | No native authoring established | EDMX import and generated-object reporting first |
| CHKE | No native exemption workflow established | Governed classic/cloud contract, permissions and approver flow |
| SIA6 / SWCR / PCFN | No native lifecycle established | Specific use case plus each type's contract |
| TRAN | Metadata read; source/write remains FEAT-62 | Required endpoint absent on tested systems; resume on observed backend support |
| XSLT | Native lifecycle not established | Migration/customer requirement and source/lock/readback contract |

For each writable family, establish native identity, create schema, source representation,
lock owner, real package, transport, inactive/active state and readback. Use the generic
server-driven engine only when the observed type follows that contract.

## Historical coverage research queue

| Gap | Evidence so far | Next bounded spike / stop condition |
|---|---|---|
| Text pools / REPT | Current program/class metadata; no history relation in inspected samples | Two historical text-only versions, language and symbols/selections/headings; otherwise keep explicit gap |
| FUGR | Sample main history active-only; structural ownership incomplete | Two numbered include histories and owner mapping; whole main is not complete group coverage |
| DOMA / DTEL / TABL | Feeds advertised, historical content refused for DOMA/DTEL/TTYP on A4H | Two retrievable differing historical payloads, stable field meaning and attribution |
| METH across requests | Existing class sample proves main/CCIMP changes only | Different methods in two requests; retain whole-part scope warning until attribution proven |
| Test transports | Upstream flag found; none observed live, no filtering added | Verify an intermediate flagged snapshot and a directly requested flagged task before changing selection |
| History continuation | Synthetic `rel=next`; none observed live | Actual continuation contract before following links; partial evidence meanwhile |
| Deletion / Customizing keys | No representative before/after fixture | Capture operation/key metadata; a 404 never proves deletion |

## Preserved research

All original reports, handoff, scripts, results, notebook demo, manifests and earlier Claude
reviews remain available at the immutable [research archive at 19c7287](https://github.com/arc-mcp/arc-1/tree/19c728722e87b59f4915f6252af4ecee4dbf8e36/docs/research/adt-vscode-1.2/evidence).
The [earlier plan](https://github.com/arc-mcp/arc-1/blob/19c728722e87b59f4915f6252af4ecee4dbf8e36/docs/plans/2026-10-17-transport-review.md)
and [validation record](https://github.com/arc-mcp/arc-1/blob/19c728722e87b59f4915f6252af4ecee4dbf8e36/docs/research/2026-10-17-transport-review-validation.md)
cover that superseded implementation. Original local inputs and uncommitted work are preserved.

Primary references: [SAP Marketplace](https://marketplace.visualstudio.com/items?itemName=SAPSE.adt-vscode),
[SAP MCP tools](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/mcp-tools),
[SAP SQL console](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/working-with-sql-console).
Follow the [current roadmap](../../../docs_page/roadmap.md) for deferred work and evidence gates.
